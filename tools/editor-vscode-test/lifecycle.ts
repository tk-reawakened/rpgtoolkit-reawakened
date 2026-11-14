import type { ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";

export interface ClosableBrowser { close(): Promise<void> }
export interface TrackedProcess {
  readonly child: ChildProcess;
  readonly error: Promise<never>;
  readonly closed: Promise<number>;
  readonly errors: unknown[];
}

/** Attach spawn-error and close listeners immediately, before the caller awaits readiness. */
export function trackProcess(child: ChildProcess): TrackedProcess {
  const errors: unknown[] = [];
  let rejectProcessError!: (error: unknown) => void;
  const error = new Promise<never>((_, reject) => { rejectProcessError = reject; });
  child.on("error", (processError) => {
    errors.push(processError);
    rejectProcessError(processError);
  });
  const closed = new Promise<number>((resolve) => {
    child.once("close", (code, signal) => resolve(code ?? (signal === "SIGTERM" ? 0 : 1)));
  });
  return { child, error, closed, errors };
}

/** Attempt every cleanup action and return all failures instead of masking the proof result. */
export async function cleanupTestRun(browser: ClosableBrowser | undefined, process: TrackedProcess | undefined, workspace: string): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (browser !== undefined) {
    try { await browser.close(); } catch (error) { errors.push(error); }
  }
  if (process !== undefined) {
    try { process.child.kill("SIGTERM"); } catch (error) { errors.push(error); }
    try {
      const code = await process.closed;
      if (code !== 0 && process.errors.length === 0) errors.push(new Error(`vscode-test-web exited with ${code}`));
    } catch (error) { errors.push(error); }
    errors.push(...process.errors);
  }
  try { await rm(workspace, { recursive: true, force: true }); } catch (error) { errors.push(error); }
  return errors;
}
/** Require an HTTP success response before treating the workbench as ready. */
export async function waitForHttpServer(child: Pick<ChildProcess, "exitCode">, url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let pause = 100;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vscode-test-web exited early (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pause));
    pause = Math.min(pause * 2, 2_000);
  }
  throw new Error(`Timed out waiting for vscode-test-web at ${url}: ${String(lastError)}`);
}
export function combineProofErrors(primary: unknown, cleanupErrors: readonly unknown[]): unknown | undefined {
  const additional = primary === undefined ? cleanupErrors : cleanupErrors.filter((error) => error !== primary);
  if (primary !== undefined && additional.length === 0) return primary;
  if (primary === undefined && additional.length === 1) return additional[0];
  if (primary === undefined && additional.length === 0) return undefined;
  return new AggregateError(primary === undefined ? [...additional] : [primary, ...additional], "VS Code web proof or cleanup failed");
}

/** Report an incomplete settings write as a poll observation, not an aborted proof. */
export function autosaveSetting(bytes: Uint8Array): unknown {
  try {
    const settings: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return "invalid settings JSON: expected an object";
    return (settings as Record<string, unknown>)["files.autoSave"];
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return `invalid settings JSON: ${error.message}`;
  }
}

/** Decode a byte-probe payload, including the valid encoding of an empty file. */
export function decodePersistedBytes(encoded: string, panelId: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`Probe panel ${panelId} did not contain a valid Base64 persisted-byte payload (${encoded.length} characters)`);
  }
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}
