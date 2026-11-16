/**
 * Diagnostics mode for the live players (docs/spec/engine/runners.md#diagnostics-mode).
 *
 * It is off unless a launch flag turns it on. With it off a player shows no tick, hash or draw numbers and hashes the
 * state only on request; with it on the player shows them and reads the state hash on every presented frame. The mode
 * is host presentation only: switching it never changes state, pixels, sound or the game's own diagnostics.
 */

export interface DiagnosticsMode {
  /** Whether diagnostics are shown now. */
  readonly on: () => boolean;
  /** Turn the mode on or off; listeners run only when the value changes. */
  readonly set: (on: boolean) => void;
  readonly toggle: () => void;
  /** Call `listener` after every change. Returns a function that stops listening. */
  readonly onChange: (listener: (on: boolean) => void) => () => void;
}

/** The tooling hook a page exposes so a harness that cannot pass a flag (an installed mobile app) can switch the mode. */
export type DiagnosticsHook = (on?: boolean) => boolean;

/** `?diagnostics`, `?diagnostics=1` or `?diagnostics=on` asks for the mode at launch; `0`, `false` or `off` does not. */
export function diagnosticsRequested(search: string): boolean {
  const value = new URLSearchParams(search).get("diagnostics");
  if (value === null) return false;
  return !["0", "false", "off"].includes(value.toLowerCase());
}

/** F3 toggles the mode on a player with a keyboard. */
export function isDiagnosticsToggle(event: Pick<KeyboardEvent, "code">): boolean {
  return event.code === "F3";
}

export function createDiagnosticsMode(initial: boolean): DiagnosticsMode {
  let current = initial;
  const listeners = new Set<(on: boolean) => void>();
  const set = (on: boolean): void => {
    if (on === current) return;
    current = on;
    for (const listener of [...listeners]) listener(on);
  };
  return {
    on: () => current,
    set,
    toggle: () => set(!current),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Publish `mode` as `target.__tkrDiagnostics`: called with a boolean it sets the mode, and it always returns whether the
 * mode is on. Returns a function that removes the hook.
 */
export function exposeDiagnosticsMode(mode: DiagnosticsMode, target: { __tkrDiagnostics?: DiagnosticsHook }): () => void {
  const hook: DiagnosticsHook = (on) => {
    if (on !== undefined) mode.set(on);
    return mode.on();
  };
  target.__tkrDiagnostics = hook;
  return () => {
    if (target.__tkrDiagnostics === hook) delete target.__tkrDiagnostics;
  };
}
