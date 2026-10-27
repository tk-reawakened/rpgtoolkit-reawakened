import {
  canonSplitRoot,
  hashState,
  tagNonFinite,
} from "../canon/canon.ts";
import {
  createFnv1a64State,
  fnv1a64Finish,
  fnv1a64Update,
  fnv1a64UpdateAscii,
  type Fnv1a64State,
} from "../canon/fnv1a.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { withoutSettings } from "../audio/model.ts";
import type { GameState } from "./state.ts";

type SurfaceHashCache = {
  before: string;
  surface: string;
  afterSurface: Fnv1a64State;
  working: Fnv1a64State;
};

const surfaceHashCaches = new WeakMap<GameState, SurfaceHashCache>();

/**
 * The state hash of a whole game state (AD-11): `hashState` of the tree
 * without `audio.settings`. The script volume settings are not game state a
 * replay compares (docs/spec/engine/audio-media.md#audio-core-pins item 7), so
 * they never enter the hash; a snapshot still carries them.
 *
 * The private cache skips UTF-8 encoding and FNV work for the canonical fields
 * through `surfaces` only when both exact canonical strings still match. It
 * canonicalizes and compares those fields on every call: plain save data can
 * be modified directly, including `bitmap.b64` without a `rev` change. A
 * changed prefix or surface is re-hashed; the suffix is always re-canonicalized
 * and re-hashed. This avoids identity/revision-only caches, but does not avoid
 * scanning canonical text to detect external writes.
 */
export function hashGameState(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const projected = { ...state, vm, audio: withoutSettings(state.audio) };
  const tagged = tagNonFinite(projected) as PlainData;
  const parts = canonSplitRoot(tagged, "surfaces");
  if (!parts.hasSelected) return hashState(tagged);

  let cache = surfaceHashCaches.get(state);
  if (cache === undefined) {
    cache = {
      before: "",
      surface: "",
      afterSurface: createFnv1a64State(),
      working: createFnv1a64State(),
    };
    surfaceHashCaches.set(state, cache);
  }

  if (cache.before !== parts.before || cache.surface !== parts.selected) {
    cache.before = parts.before;
    cache.surface = parts.selected;
    cache.afterSurface = createFnv1a64State();
    fnv1a64Update("{", cache.afterSurface);
    if (parts.before !== "") {
      fnv1a64Update(parts.before, cache.afterSurface);
      fnv1a64Update(",", cache.afterSurface);
    }
    if (/[^\x00-\x7f]/.test(parts.selected)) fnv1a64Update(parts.selected, cache.afterSurface);
    else fnv1a64UpdateAscii(parts.selected, cache.afterSurface);
  }

  cache.working.high = cache.afterSurface.high;
  cache.working.low = cache.afterSurface.low;
  if (parts.after !== "") {
    fnv1a64Update(",", cache.working);
    fnv1a64Update(parts.after, cache.working);
  }
  fnv1a64Update("}", cache.working);
  return fnv1a64Finish(cache.working);
}
