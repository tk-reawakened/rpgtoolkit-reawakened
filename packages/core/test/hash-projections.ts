// Independent re-statements of the state-hash projection, for tests only. They use the plain canonicalizer
// (`hashState`), never `hashGameState`'s surface-fragment cache, so a test can compare the optimized hash with
// the straightforward one (docs/spec/formats/save-game.md#state-hash-request-projection).
import { withoutSettings } from "../src/audio/model.ts";
import { hashState } from "../src/canon/canon.ts";
import type { GameState } from "../src/save/state.ts";

/**
 * The current projection: the whole state without `vm.stepCounters`, `audio.settings`, `engine.nextRequestId`, and the
 * two screen surfaces — the derived presented frame (0) and the script-screen layer it is composited from, whose id the
 * section records (docs/spec/engine/runners.md#surface-read-and-state-hash). The pending-request list stays in it, ids
 * included.
 */
export function projectedState(state: GameState) {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  const section = state.surfaces as Partial<GameState["surfaces"]>;
  const { scriptScreen: _scriptScreen, ...surfaces } = section;
  let surfacesProjection: unknown = surfaces;
  if (section.entries !== undefined) {
    const screenKeys = new Set(["0", String(section.scriptScreen)]);
    const entries = Object.fromEntries(Object.entries(section.entries).filter(([id]) => !screenKeys.has(id)));
    surfacesProjection = { ...surfaces, entries };
  }
  return { ...state, vm, engine, audio: withoutSettings(state.audio), surfaces: surfacesProjection as GameState["surfaces"] };
}

/** `hashGameState` must equal this for every state. */
export function referenceHashProjection(state: GameState): string {
  return hashState(projectedState(state));
}

/**
 * The projection before the 2026-11-01 owner ruling (#1047): identical except that the saved request-id counter was
 * hashed. Only the counter regressions use it, to show that the old projection moved with bookkeeping the new one
 * ignores.
 */
export function hashWithRequestCounter(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  return hashState({ ...state, vm, audio: withoutSettings(state.audio) });
}
