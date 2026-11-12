/**
 * Session-only observation windows over a thread's unhandled runtime failures (TOOL-5 `toThrow`; ERR-2).
 *
 * A window is bookkeeping the VM keeps while a test command watches one call: it is never part of `GameState`,
 * is not saved and is not hashed (ADR 0010). The VM records into it each failure it routed to a thread with no
 * handler to take it; closing the window hands those failures back so the caller can consume them. Windows nest
 * per thread: a failure belongs to the innermost window the failing thread has open, so an inner window consumes
 * what it saw and the outer one never does.
 */

import type { Diagnostic } from "../ports/engine.ts";

/** One failure no handler took: its host diagnostic and the object handle of its queued `error` event, if any. */
export type UnhandledFailure = {
  readonly diagnostic: Diagnostic;
  readonly event: number | null;
};

export type ErrorWindows = {
  /** Open a window on `thread`; it is the innermost one until closed. */
  readonly open: (thread: number) => void;
  /** Record an unhandled failure of `thread` into its innermost window; a thread with no window records nothing. */
  readonly record: (thread: number, failure: UnhandledFailure) => void;
  /** Close the innermost window of `thread` and return what it saw in raise order, or `null` when none was open. */
  readonly close: (thread: number) => readonly UnhandledFailure[] | null;
};

export function createErrorWindows(): ErrorWindows {
  const windows: { readonly thread: number; readonly failures: UnhandledFailure[] }[] = [];
  const innermost = (thread: number): number => {
    for (let index = windows.length - 1; index >= 0; index -= 1) if (windows[index]!.thread === thread) return index;
    return -1;
  };
  return {
    open: (thread) => {
      windows.push({ thread, failures: [] });
    },
    record: (thread, failure) => {
      const index = innermost(thread);
      if (index >= 0) windows[index]!.failures.push(failure);
    },
    close: (thread) => {
      const index = innermost(thread);
      return index < 0 ? null : windows.splice(index, 1)[0]!.failures;
    },
  };
}
