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
export function combineProofErrors(primary: unknown, cleanupErrors: readonly unknown[]): unknown | undefined {
  const additional = primary === undefined ? cleanupErrors : cleanupErrors.filter((error) => error !== primary);
  if (primary !== undefined && additional.length === 0) return primary;
  if (primary === undefined && additional.length === 1) return additional[0];
  if (primary === undefined && additional.length === 0) return undefined;
  return new AggregateError(primary === undefined ? [...additional] : [primary, ...additional], "VS Code web proof or cleanup failed");
}
