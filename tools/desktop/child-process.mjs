// Bounded shutdown for a spawned Electron child (entry 9.11, #2169).
//
// `child.kill()` only *sends* a signal; the process is gone some time later. Awaiting its `close` without a bound is how
// the desktop measurement hung for twenty minutes when Electron ignored SIGTERM, and killing on the success path without
// waiting let the next launch overlap a GPU process that was still tearing down. `stopChild` always returns: SIGTERM, a
// grace period, then SIGKILL, then a bounded wait, then `{ exited: false }`. Callers must treat that last answer as a
// loud failure rather than as "probably fine".

/** The default pause, resolved by a timer that never keeps the process alive on its own. */
export function sleep(ms) {
  // Ref'd on purpose: a top-level flow awaiting this timer must not let the event loop drain (exit 13).
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExited(child) {
  return (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined);
}

/**
 * Resolve with the child's close result, or null once `ms` elapses. An injected `delay` lets tests prove the ordering
 * without a real wait; the default timer is cleared as soon as the child closes.
 */
function waitForClose(closed, ms, delay) {
  if (delay !== undefined) {
    return Promise.race([closed.then((value) => ({ value })), delay(ms).then(() => null)]);
  }
  return new Promise((resolve) => {
    // Ref'd on purpose: this timer is the bound a top-level `stopChild` await depends on.
    const timer = setTimeout(() => resolve(null), ms);
    closed.then((value) => {
      clearTimeout(timer);
      resolve({ value });
    });
  });
}

/**
 * Stop a spawned child within a known bound. Returns `{ exited, escalated }`: `escalated` records that SIGTERM was not
 * enough, and `exited: false` means the process outlived both signals and the bounded waits.
 */
export async function stopChild(child, {
  graceMs = 5_000,
  killMs = 2_000,
  signal = "SIGTERM",
  delay,
} = {}) {
  if (zeroOrNegative(graceMs) && zeroOrNegative(killMs)) {
    throw new Error("stopChild needs a positive grace or kill bound");
  }
  if (hasExited(child)) return { exited: true, escalated: false };
  const closed = new Promise((resolve) => {
    child.once("close", (code, closeSignal) => resolve({ code: code ?? null, signal: closeSignal ?? null }));
  });
  // The child may have exited between the check above and the listener attaching; re-check before signalling.
  if (hasExited(child)) return { exited: true, escalated: false };
  killQuietly(child, signal);
  if (await waitForClose(closed, Math.max(0, graceMs), delay) !== null) return { exited: true, escalated: false };
  killQuietly(child, "SIGKILL");
  if (await waitForClose(closed, Math.max(0, killMs), delay) !== null) return { exited: true, escalated: true };
  // No `close` event means the piped stdio sockets are still open and ref'ed; `unref()` alone would not release them.
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy?.();
  child.unref?.();
  return { exited: false, escalated: true };
}

function zeroOrNegative(value) {
  return typeof value !== "number" || value <= 0;
}

function killQuietly(child, signal) {
  try {
    child.kill(signal);
  } catch {
    // ESRCH or an already-closed handle: the close listener is the authority on whether it is gone.
  }
}
