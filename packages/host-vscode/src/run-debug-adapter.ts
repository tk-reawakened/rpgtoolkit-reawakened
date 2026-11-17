import type { Disposable, PlatformResult, RunHandle, RunStatus } from "@tk-reawakened/platform-services";

/**
 * The `tkr` debug adapter's protocol logic (ADR 0037 items 5–7), without `vscode`: VS Code's inline adapter hands it
 * parsed Debug Adapter Protocol requests and forwards what it sends. A session runs one launch at a time through the
 * same run service as the palette commands; the debug toolbar's Stop and Restart drive the run handle, and the run's
 * state and diagnostics go to the Debug Console. It has no threads and never stops: breakpoints are #2920.
 */

/** A Debug Adapter Protocol request, as far as this adapter reads it. */
export interface DapRequest {
  readonly seq: number;
  readonly type: string;
  readonly command: string;
  readonly arguments?: unknown;
}

/** What the session runs: one resolved configuration, through the host's run service (save first, snapshot, player). */
export type StartRun = (configuration: Readonly<Record<string, unknown>>) => Promise<PlatformResult<RunHandle>>;

export class RunDebugSession {
  readonly #start: StartRun;
  readonly #send: (message: Record<string, unknown>) => void;
  #seq = 1;
  #configuration: Readonly<Record<string, unknown>> = {};
  #handle: RunHandle | undefined;
  #watch: Disposable | undefined;
  /** Bumped by every launch, restart and stop, so a start that resolves after it is stopped at once. */
  #epoch = 0;
  #closed = false;

  constructor(start: StartRun, send: (message: Record<string, unknown>) => void) {
    this.#start = start;
    this.#send = send;
  }

  handle(request: DapRequest): void {
    void this.#dispatch(request);
  }

  /** End the session's run; VS Code calls this when the session goes away. */
  dispose(): void {
    this.#closed = true;
    this.#stopCurrent();
  }

  async #dispatch(request: DapRequest): Promise<void> {
    switch (request.command) {
      case "initialize":
        this.#respond(request, true, {
          supportsConfigurationDoneRequest: true,
          supportsRestartRequest: true,
          supportsTerminateRequest: true,
        });
        this.#event("initialized");
        return;
      case "launch":
        this.#configuration = record(request.arguments);
        await this.#run(request);
        return;
      case "restart": {
        const args = record(request.arguments);
        if (typeof args.arguments === "object" && args.arguments !== null) this.#configuration = record(args.arguments);
        this.#stopCurrent();
        this.#output("Restarting: saving and taking a new run snapshot.\n");
        await this.#run(request);
        return;
      }
      case "terminate":
        this.#closed = true;
        this.#stopCurrent();
        this.#respond(request, true);
        this.#event("terminated");
        return;
      case "disconnect":
        this.#closed = true;
        this.#stopCurrent();
        this.#respond(request, true);
        return;
      case "configurationDone":
      case "setExceptionBreakpoints":
      case "setFunctionBreakpoints":
        this.#respond(request, true);
        return;
      case "setBreakpoints": {
        const source = record(record(request.arguments).source);
        const asked = Array.isArray(record(request.arguments).breakpoints) ? record(request.arguments).breakpoints as unknown[] : [];
        this.#respond(request, true, {
          breakpoints: asked.map((breakpoint) => ({
            verified: false,
            line: record(breakpoint).line,
            source,
            message: "Breakpoints in the running game are not supported yet (#2920); use the RPGCode debugger.",
          })),
        });
        return;
      }
      case "threads":
        this.#respond(request, true, { threads: [] });
        return;
      default:
        this.#respond(request, false, undefined, `The game launcher does not support "${request.command}".`);
    }
  }

  async #run(request: DapRequest): Promise<void> {
    const epoch = ++this.#epoch;
    let result: PlatformResult<RunHandle>;
    try {
      result = await this.#start(this.#configuration);
    } catch (error) {
      result = { ok: false, error: { code: "io-error", message: String(error) } };
    }
    if (!result.ok) {
      this.#respond(request, false, undefined, result.error.message);
      if (request.command === "restart") this.#event("terminated");
      return;
    }
    const handle = result.value;
    if (epoch !== this.#epoch || this.#closed) {
      handle.stop();
      this.#respond(request, true);
      return;
    }
    this.#handle = handle;
    this.#respond(request, true);
    this.#output(describeSnapshot(handle));
    let last: RunStatus | undefined;
    const update = (status: RunStatus): void => {
      if (this.#handle !== handle) return;
      this.#report(last, status);
      last = status;
      if (status.state === "ended" || status.state === "failed") {
        this.#detach();
        this.#event("exited", { exitCode: status.state === "failed" ? 1 : 0 });
        this.#event("terminated");
      }
    };
    this.#watch = handle.onStatus(update);
    update(handle.status());
  }

  #report(previous: RunStatus | undefined, status: RunStatus): void {
    const seen = previous?.diagnostics.length ?? 0;
    for (const diagnostic of status.diagnostics.slice(seen)) {
      this.#send(this.#message("event", {
        event: "output",
        body: {
          category: "stderr",
          output: `${diagnostic.file}:${diagnostic.line}: ${diagnostic.code}: ${diagnostic.message}\n`,
          ...(diagnostic.file === "" ? {} : { source: { name: diagnostic.file.split("/").at(-1), path: diagnostic.file }, line: diagnostic.line }),
        },
      }));
    }
    const changed = previous === undefined || previous.state !== status.state
      || (status.state === "stalled" && previous.stalledOn !== status.stalledOn)
      || (status.state === "running" && previous.board !== status.board);
    if (!changed) return;
    const line = status.state === "starting" ? "Starting the player."
      : status.state === "running" ? `Running at tick ${status.tick}${status.board === null ? "" : ` on ${status.board}`}.`
        : status.state === "stalled" ? `Waiting for ${status.stalledOn ?? "an asset"}.`
          : status.state === "ended" ? `Run ended at tick ${status.tick}${status.message === null ? "." : `: ${status.message}`}`
            : `Run failed at tick ${status.tick}: ${status.message ?? "no reason given."}`;
    const hash = (status.state === "ended" || status.state === "failed") && status.stateHash !== null ? ` State hash ${status.stateHash}.` : "";
    this.#output(`${line}${hash}\n`, status.state === "failed" ? "stderr" : "console");
  }

  #stopCurrent(): void {
    this.#epoch += 1;
    const handle = this.#handle;
    this.#detach();
    handle?.stop();
  }

  #detach(): void {
    this.#watch?.dispose();
    this.#watch = undefined;
    this.#handle = undefined;
  }

  #respond(request: DapRequest, success: boolean, body?: unknown, message?: string): void {
    this.#send(this.#message("response", {
      request_seq: request.seq, command: request.command, success,
      ...(message === undefined ? {} : { message }),
      ...(body === undefined ? {} : { body }),
    }));
  }

  #event(event: string, body?: unknown): void {
    this.#send(this.#message("event", { event, ...(body === undefined ? {} : { body }) }));
  }

  #output(output: string, category: "console" | "stderr" = "console"): void {
    this.#event("output", { category, output });
  }

  #message(type: "response" | "event", fields: Record<string, unknown>): Record<string, unknown> {
    return { seq: this.#seq++, type, ...fields };
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The run snapshot (ADR 0022 D8.3) in a few Debug Console lines. */
export function describeSnapshot(handle: RunHandle): string {
  const snapshot = handle.snapshot;
  const lines = [`Run snapshot: ${snapshot.kind} launch, runner ${snapshot.runner}, seed ${snapshot.seed}.`];
  for (const target of snapshot.targets) lines.push(`  ${target.path}  sha256 ${target.sha256}`);
  lines.push(`  ${snapshot.manifestFiles} other file(s), manifest sha256 ${snapshot.manifest}`);
  if (snapshot.start !== null) lines.push(`  Start: ${snapshot.start.board} at ${snapshot.start.x}, ${snapshot.start.y}, layer ${snapshot.start.layer}`);
  if (snapshot.party.length > 0) lines.push(`  Party: ${snapshot.party.join(", ")}`);
  if (snapshot.fixture !== null) lines.push(`  Fixture: ${snapshot.fixture}`);
  return `${lines.join("\n")}\n`;
}
