/**
 * The transport-free debug session (TOOL-1, TOOL-8; AD-21).
 *
 * One session drives one launched scene through the `Engine` port only:
 * `setBreakpoints` installs the client's breakpoints, `debugView()` answers
 * `threads`, `stackTrace`, `scopes` and `variables`, `evaluate()` reads a watch,
 * and every stop is produced by `advance`. Stepping is computed here, not in the
 * VM (THR-3): a step issues one `advance(0, [], undefined, "step")` per
 * instruction and compares the frame depth of the stop with the depth the step
 * started at — over goes past a call, in enters it, out returns to the caller.
 *
 * A transport lives with the host: `serveDebugSession` reads and writes the
 * length-prefixed frames of `protocol.ts` on a pair of streams, and the stdio
 * binary is outside this package's public export.
 *
 * docs/spec/engine/rpgcode-tooling.md#tool-8-server
 */

import type { DebugFrame, DebugValue, DebugView, Engine, InputRecord, ResumeMode, TickReport } from "@tk-reawakened/core";
import type { SceneDebugTarget } from "@tk-reawakened/runner-harness";
import type { DapEvent, DapMessage, DapRequest, DapResponse } from "./protocol.ts";

/** Where the last `advance` stopped: thread, frame and line, exactly as `TickReport.paused` reports it. */
type Stop = { readonly thread: number; readonly frame: number; readonly line: number };

type Outcome = { readonly kind: "stop"; readonly stop: Stop } | { readonly kind: "ended" } | { readonly kind: "limit" };

export type DebugSessionOptions = {
  /**
   * Build the scene to debug from the client's `launch` arguments. A host that
   * must read the program and the board first (an editor reading the workspace
   * through its own file API) returns a promise; the session answers `launch`
   * and sends `initialized` when it settles, so no request can arrive before
   * the target exists.
   */
  readonly launch: (launchArguments: Record<string, unknown>) => SceneDebugTarget | Promise<SceneDebugTarget>;
  /** The most whole ticks one `continue`, `next`, `stepIn` or `stepOut` may run (default 600). */
  readonly tickLimit?: number;
  /** The most one-instruction resumes one `next`, `stepIn` or `stepOut` may run (default 10000). */
  readonly stepLimit?: number;
};

export type DebugSession = {
  /** Answer one request. The response and any events go to the sink the session was made with. */
  handle(request: DapRequest): void;
  dispose(): void;
};

/** `frameId = threadId * 1000 + frameIndex + 1`, so a frame is named by its own place in the view. */
const FRAMES_PER_THREAD = 1000;
const LOCALS_BASE = 1_000_000;
const GLOBALS_REFERENCE = 2_000_000;

function frameIdOf(thread: number, index: number): number {
  return thread * FRAMES_PER_THREAD + index + 1;
}

function decodeFrameId(id: number): { readonly thread: number; readonly index: number } | null {
  if (!Number.isInteger(id) || id < 1) return null;
  return { thread: Math.floor((id - 1) / FRAMES_PER_THREAD), index: (id - 1) % FRAMES_PER_THREAD };
}

/** How a `DebugValue` reads in a client's variables and evaluate view. */
function debugText(value: DebugValue): string {
  if (value === null) return "<unset>";
  if (typeof value === "number") return `${value}`;
  if (typeof value === "string") return value;
  return value.kind === "object" ? `<${value.className} #${value.handle}>` : `<callable ${value.def}>`;
}

function debugType(value: DebugValue): string {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return value.kind;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Whether two source names are the same document. A client reports a document as a path
 * (`/Prg/probe.prg`) or as a URI (`vscode-test-web://mount/Prg/probe.prg`) depending on the
 * file system it is on, so a breakpoint matches when either side names the same path.
 */
function sameSource(left: string, right: string): boolean {
  if (left === right) return true;
  const asPath = (value: string): string => {
    const at = value.indexOf("://");
    if (at < 0) return value;
    const rest = value.slice(at + 3);
    const slash = rest.indexOf("/");
    return slash < 0 ? "/" : rest.slice(slash);
  };
  return asPath(left) === asPath(right);
}

function sameStop(left: Stop, right: Stop): boolean {
  return left.thread === right.thread && left.frame === right.frame && left.line === right.line;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberAt(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * One session over one launched scene. `send` receives every response and
 * event in order; the session never throws for a client's mistake — an
 * unsupported or malformed request is a failed response.
 */
export function createDebugSession(options: DebugSessionOptions, send: (message: DapMessage) => void): DebugSession {
  const tickLimit = options.tickLimit ?? 600;
  const stepLimit = options.stepLimit ?? 10_000;
  let seq = 1;
  let target: SceneDebugTarget | null = null;
  let stop: Stop | null = null;
  /** The string `Breakpoint.file` must carry for the launched program (its `DebugProgram.key`). */
  let engineFile: string | null = null;
  let configured = false;
  let disposed = false;
  let pending: readonly InputRecord[] = [];
  const breakpoints = new Map<string, readonly number[]>();
  const sources = new Map<number, string>();
  const sourceRefs = new Map<string, number>();

  const respond = (request: DapRequest, body?: unknown): void => {
    const response: DapResponse = {
      seq: seq++,
      type: "response",
      request_seq: request.seq,
      success: true,
      command: request.command,
      ...(body === undefined ? {} : { body }),
    };
    send(response);
  };
  const fail = (request: DapRequest, message: string): void => {
    const response: DapResponse = { seq: seq++, type: "response", request_seq: request.seq, success: false, command: request.command, message };
    send(response);
  };
  const event = (name: string, body?: unknown): void => {
    const message: DapEvent = { seq: seq++, type: "event", event: name, ...(body === undefined ? {} : { body }) };
    send(message);
  };

  const engine = (): Engine | null => target?.engine ?? null;
  const view = (): DebugView | null => engine()?.debugView() ?? null;

  /** One `advance`, carrying the replies to the requests the previous one posted. */
  function advanceOnce(ticks: number, resume?: ResumeMode): TickReport {
    const running = engine();
    const scene = target;
    if (running === null || scene === null) throw new Error("the session has no scene");
    const report = resume === undefined ? running.advance(ticks, pending) : running.advance(ticks, pending, undefined, resume);
    pending = scene.answer(report);
    return report;
  }

  function stopOf(paused: { readonly thread: number; readonly frame: number; readonly line: number }): Stop {
    return { thread: paused.thread, frame: paused.frame, line: paused.line };
  }

  function depthOf(thread: number): number {
    const threads = view()?.threads ?? [];
    return threads.find((entry) => entry.id === thread)?.frames.length ?? 0;
  }

  function anyLiveThread(): boolean {
    const threads = view()?.threads ?? [];
    return threads.some((thread) => thread.status !== "finished");
  }

  /**
   * The source string the engine matches a breakpoint against: the key of the
   * frame whose program text is the launched program's. It is `<inline>` for an
   * inline program and the asset path for a file program (TOOL-8).
   */
  function resolveEngineFile(scene: SceneDebugTarget): string | null {
    for (const thread of scene.engine.debugView().threads) {
      for (const frame of thread.frames) {
        if (frame.program.text === scene.program.text) return frame.program.key;
      }
    }
    return null;
  }

  function applyBreakpoints(scene: SceneDebugTarget): void {
    engineFile ??= resolveEngineFile(scene);
    // A client may name the document by path or by URI; the session accepted either when the
    // breakpoints were set, so every stored entry that names this program is applied.
    const lines: number[] = [];
    for (const [source, requested] of breakpoints) {
      if (sameSource(source, scene.program.path)) lines.push(...requested);
    }
    scene.engine.setBreakpoints(lines.map((line) => ({ file: engineFile!, line })));
  }

  /** The stop a client sees for a frame: its thread, its depth and its line. */
  function stopAt(thread: number, frame: DebugFrame): Stop {
    return { thread, frame: frame.index, line: frame.line };
  }

  function runningStop(): Stop | null {
    const current = stop;
    if (current !== null) return current;
    const threads = view()?.threads ?? [];
    for (const thread of threads) {
      const top = thread.frames[thread.frames.length - 1];
      if (top !== undefined) return stopAt(thread.id, top);
    }
    return null;
  }

  /**
   * Report one stop twice: the standard DAP `stopped` event, and the custom event
   * `rpgcode.stopped` with `{ reason, threadId, line }`. A host driving the adapter from
   * outside its own UI (an extension-host test, a script) has no deterministic signal from
   * the standard event, because the client consumes it; the companion is what such a host
   * waits on.
   */
  function emitStop(at: Stop, reason: string): void {
    event("stopped", { reason, threadId: at.thread, allThreadsStopped: true });
    event("rpgcode.stopped", { reason, threadId: at.thread, line: at.line });
  }

  function announce(outcome: Outcome, reason: "breakpoint" | "step" | "entry" | "pause"): void {
    if (outcome.kind === "ended") {
      stop = null;
      event("terminated");
      return;
    }
    if (outcome.kind === "limit") {
      const current = runningStop();
      stop = current;
      if (current === null) {
        event("terminated");
        return;
      }
      emitStop(current, "pause");
      return;
    }
    stop = outcome.stop;
    emitStop(outcome.stop, reason);
  }

  function runContinue(from: Stop): Outcome {
    let ticks = 0;
    for (;;) {
      const report = advanceOnce(1);
      ticks += report.ticksRun;
      if (report.paused !== null) {
        const next = stopOf(report.paused);
        // A breakpoint can re-hit the line it stopped on while that statement's own call runs;
        // a client expects the resume to move past the stop it left, not to stop where it was.
        if (!sameStop(next, from)) return { kind: "stop", stop: next };
      }
      if (!anyLiveThread()) return { kind: "ended" };
      if (ticks >= tickLimit) return { kind: "limit" };
      if (report.ticksRun === 0 && report.paused === null) return report.loading ? { kind: "limit" } : { kind: "ended" };
    }
  }

  function stepReached(kind: "next" | "stepIn" | "stepOut", from: Stop, startDepth: number, next: Stop): boolean {
    if (next.thread !== from.thread) return true;
    const depth = depthOf(next.thread);
    if (kind === "stepOut") return depth < startDepth;
    const moved = next.line !== from.line;
    return kind === "stepIn" ? moved || depth > startDepth : moved && depth <= startDepth;
  }

  function runStep(kind: "next" | "stepIn" | "stepOut", from: Stop): Outcome {
    const startDepth = depthOf(from.thread);
    let ticks = 0;
    for (let instructions = 0; instructions < stepLimit; instructions += 1) {
      let report = advanceOnce(0, "step");
      if (report.paused === null) {
        // A step that ran the open tick's last instruction leaves no pause to compare; the next
        // tick has to be opened, and that whole tick is what a step is allowed to spend there.
        report = advanceOnce(1);
        ticks += report.ticksRun;
      }
      if (report.paused !== null) {
        const next = stopOf(report.paused);
        if (stepReached(kind, from, startDepth, next)) return { kind: "stop", stop: next };
      } else if (!anyLiveThread()) {
        return { kind: "ended" };
      }
      if (ticks >= tickLimit) return { kind: "limit" };
    }
    return { kind: "limit" };
  }

  function resume(kind: "next" | "stepIn" | "stepOut" | "continue", request: DapRequest): void {
    if (target === null) {
      fail(request, "no program is launched");
      return;
    }
    const from = runningStop();
    if (from === null) {
      fail(request, "no thread is stopped");
      return;
    }
    const outcome = kind === "continue" ? runContinue(from) : runStep(kind, from);
    respond(request, kind === "continue" ? { allThreadsContinued: true } : undefined);
    announce(outcome, kind === "continue" ? "breakpoint" : "step");
  }

  function frameSource(scene: SceneDebugTarget, frame: DebugFrame): { readonly name: string; readonly path?: string; readonly sourceReference?: number } {
    if (frame.program.text === scene.program.text) return { name: baseName(scene.program.path), path: scene.program.path };
    const known = sourceRefs.get(frame.program.text);
    if (known !== undefined) return { name: frame.program.key, sourceReference: known };
    const reference = sourceRefs.size + 1;
    sourceRefs.set(frame.program.text, reference);
    sources.set(reference, frame.program.text);
    return { name: frame.program.key, sourceReference: reference };
  }

  function stackFrames(scene: SceneDebugTarget, threadId: number): readonly Record<string, unknown>[] {
    const thread = scene.engine.debugView().threads.find((entry) => entry.id === threadId);
    if (thread === undefined) return [];
    // DAP lists the innermost frame first; the view lists them outermost to innermost.
    return [...thread.frames].reverse().map((frame) => ({
      id: frameIdOf(threadId, frame.index),
      name: frame.function ?? "<top level>",
      line: frame.line,
      column: 1,
      source: frameSource(scene, frame),
    }));
  }

  function variablesBody(scene: SceneDebugTarget, reference: number): readonly Record<string, unknown>[] | null {
    if (reference === GLOBALS_REFERENCE) {
      return scene.engine.debugView().globals.map((variable) => ({
        name: variable.name,
        value: debugText(variable.value),
        type: debugType(variable.value),
        variablesReference: 0,
      }));
    }
    if (reference < LOCALS_BASE) return null;
    const decoded = decodeFrameId(reference - LOCALS_BASE);
    if (decoded === null) return null;
    const thread = scene.engine.debugView().threads.find((entry) => entry.id === decoded.thread);
    const frame = thread?.frames[decoded.index];
    if (frame === undefined) return null;
    return frame.locals.map((variable) => ({
      name: variable.name,
      value: debugText(variable.value),
      type: debugType(variable.value),
      variablesReference: 0,
    }));
  }

  function evaluateBody(scene: SceneDebugTarget, request: DapRequest): void {
    const args = asRecord(request.arguments);
    const expression = typeof args.expression === "string" ? args.expression : "";
    const frameId = numberAt(args, "frameId");
    let thread = 0;
    let depth: number | undefined;
    if (frameId !== undefined) {
      const decoded = decodeFrameId(frameId);
      if (decoded === null) {
        fail(request, `frame ${frameId} is not one this session made`);
        return;
      }
      thread = decoded.thread;
      depth = decoded.index;
    } else {
      const current = runningStop();
      if (current === null) {
        fail(request, "no thread is stopped");
        return;
      }
      thread = current.thread;
      depth = current.frame;
    }
    const result = scene.engine.evaluate(expression, thread, depth);
    if (result.error !== null) {
      fail(request, `${result.error.code}: ${result.error.message}`);
      return;
    }
    respond(request, { result: debugText(result.value), type: debugType(result.value), variablesReference: 0 });
  }

  function started(scene: SceneDebugTarget, request: DapRequest): void {
    target = scene;
    stop = null;
    pending = [];
    engineFile = null;
    applyBreakpoints(scene);
    respond(request);
    event("initialized");
  }

  function launch(request: DapRequest): void {
    let pendingLaunch: SceneDebugTarget | Promise<SceneDebugTarget>;
    try {
      pendingLaunch = options.launch(asRecord(request.arguments));
    } catch (error) {
      fail(request, error instanceof Error ? error.message : String(error));
      return;
    }
    if (typeof (pendingLaunch as Promise<SceneDebugTarget>).then === "function") {
      void (pendingLaunch as Promise<SceneDebugTarget>).then(
        (scene) => started(scene, request),
        (error: unknown) => fail(request, error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    started(pendingLaunch as SceneDebugTarget, request);
  }

  function configurationDone(request: DapRequest): void {
    if (target === null) {
      fail(request, "no program is launched");
      return;
    }
    configured = true;
    respond(request);
    const current = runningStop();
    stop = current;
    if (current === null) {
      event("terminated");
      return;
    }
    emitStop(current, "entry");
  }

  function setBreakpoints(request: DapRequest): void {
    const args = asRecord(request.arguments);
    const source = asRecord(args.source);
    const path = typeof source.path === "string" ? source.path : null;
    const requested = Array.isArray(args.breakpoints) ? args.breakpoints : [];
    const lines: number[] = [];
    for (const entry of requested) {
      const line = numberAt(asRecord(entry), "line");
      if (line !== undefined) lines.push(line);
    }
    if (path === null) {
      fail(request, "setBreakpoints needs a source path");
      return;
    }
    breakpoints.set(path, lines);
    const scene = target;
    if (scene === null) {
      // Before a launch the session cannot name the program to the engine; it keeps the lines
      // and applies them when the target arrives.
      respond(request, { breakpoints: lines.map((line) => ({ verified: false, line })) });
      return;
    }
    applyBreakpoints(scene);
    const verified = engineFile !== null && sameSource(path, scene.program.path);
    respond(request, { breakpoints: lines.map((line) => ({ verified, line })) });
    const current = runningStop();
    if (verified && current !== null && !configured) stop = current;
  }

  return {
    handle(request: DapRequest): void {
      if (disposed) return;
      if (request.type !== "request" || typeof request.command !== "string") {
        fail(request, "only requests are accepted");
        return;
      }
      const scene = target;
      switch (request.command) {
        case "initialize":
          respond(request, {
            supportsConfigurationDoneRequest: true,
            supportsEvaluateForHovers: true,
            supportsTerminateRequest: false,
            supportsRestartRequest: false,
            supportsConditionalBreakpoints: false,
            supportsHitConditionalBreakpoints: false,
            supportsLogPoints: false,
            supportsSetVariable: false,
            supportsFunctionBreakpoints: false,
            supportsExceptionOptions: false,
            exceptionBreakpointFilters: [],
            linesStartAt1: true,
            columnsStartAt1: true,
            pathFormat: "path",
          });
          return;
        case "launch":
          launch(request);
          return;
        case "configurationDone":
          configurationDone(request);
          return;
        case "setBreakpoints":
          setBreakpoints(request);
          return;
        case "threads": {
          if (scene === null) {
            fail(request, "no program is launched");
            return;
          }
          respond(request, {
            threads: scene.engine.debugView().threads.map((thread) => ({ id: thread.id, name: `${thread.kind} thread ${thread.id}` })),
          });
          return;
        }
        case "stackTrace": {
          if (scene === null) {
            fail(request, "no program is launched");
            return;
          }
          const args = asRecord(request.arguments);
          const threadId = numberAt(args, "threadId");
          if (threadId === undefined) {
            fail(request, "stackTrace needs a threadId");
            return;
          }
          const frames = stackFrames(scene, threadId);
          const start = numberAt(args, "startFrame") ?? 0;
          const levels = numberAt(args, "levels") ?? frames.length;
          respond(request, {
            stackFrames: frames.slice(start, levels <= 0 ? undefined : start + levels),
            totalFrames: frames.length,
          });
          return;
        }
        case "scopes": {
          if (scene === null) {
            fail(request, "no program is launched");
            return;
          }
          const frameId = numberAt(asRecord(request.arguments), "frameId");
          if (frameId === undefined || decodeFrameId(frameId) === null) {
            fail(request, `frame ${frameId ?? "?"} is not one this session made`);
            return;
          }
          respond(request, {
            scopes: [
              { name: "Locals", variablesReference: LOCALS_BASE + frameId, expensive: false },
              { name: "Globals", variablesReference: GLOBALS_REFERENCE, expensive: false },
            ],
          });
          return;
        }
        case "variables": {
          if (scene === null) {
            fail(request, "no program is launched");
            return;
          }
          const reference = numberAt(asRecord(request.arguments), "variablesReference");
          const variables = reference === undefined ? null : variablesBody(scene, reference);
          if (variables === null) {
            fail(request, `variables reference ${reference ?? "?"} is not one this session made`);
            return;
          }
          respond(request, { variables });
          return;
        }
        case "evaluate": {
          if (scene === null) {
            fail(request, "no program is launched");
            return;
          }
          evaluateBody(scene, request);
          return;
        }
        case "continue":
          resume("continue", request);
          return;
        case "next":
          resume("next", request);
          return;
        case "stepIn":
          resume("stepIn", request);
          return;
        case "stepOut":
          resume("stepOut", request);
          return;
        case "source": {
          const reference = numberAt(asRecord(request.arguments), "sourceReference");
          const content = reference === undefined ? undefined : sources.get(reference);
          if (content === undefined) {
            fail(request, `no source ${reference ?? "?"} is loaded`);
            return;
          }
          respond(request, { content, mimeType: "text/plain" });
          return;
        }
        case "disconnect":
        case "terminate":
          respond(request);
          disposed = true;
          event("terminated");
          return;
        default:
          fail(request, `unsupported request "${request.command}"`);
      }
    },
    dispose(): void {
      disposed = true;
    },
  };
}
