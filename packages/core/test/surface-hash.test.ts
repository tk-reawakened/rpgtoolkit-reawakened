import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { withoutSettings } from "../src/audio/model.ts";
import { hashState } from "../src/canon/canon.ts";
import { createGameState, hashGameState } from "../src/index.ts";
import type { GameState } from "../src/save/state.ts";

function previousHashProjection(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  return hashState({ ...state, vm, audio: withoutSettings(state.audio) });
}

function withSurfaceBytes(b64: string): GameState {
  const state = createGameState({ seed: 712 });
  state.surfaces = {
    nextId: 2,
    entries: {
      "1": {
        id: 1 as GameState["surfaces"]["entries"][string]["id"],
        rev: 5,
        bitmap: { t: "rgba", w: 1, h: 1, b64 },
      },
    },
    slots: {},
    colours: {},
  };
  return state;
}

test("game-state hash matches the legacy projection after prefix, suffix and non-finite edits", () => {
  const state = createGameState({ seed: 712 });
  const expectLegacyHash = () => equal(hashGameState(state), previousHashProjection(state));

  expectLegacyHash();
  state.schema.schema += 1;
  expectLegacyHash();
  state.time.tick = 12;
  expectLegacyHash();
  state.time.tick = Number.POSITIVE_INFINITY;
  expectLegacyHash();
});

test("surface hashes observe direct bitmap edits and equal-revision clones", () => {
  const state = withSurfaceBytes("AAAA");
  const clone = withSurfaceBytes("BBBB");
  const entry = state.surfaces.entries["1"]!;
  const cloneEntry = clone.surfaces.entries["1"]!;

  equal(entry.id, cloneEntry.id);
  equal(entry.rev, cloneEntry.rev);
  const initialHash = hashGameState(state);
  equal(initialHash, previousHashProjection(state));
  ok(initialHash !== hashGameState(clone));
  equal(hashGameState(clone), previousHashProjection(clone));

  const bitmap = entry.bitmap as { t: "rgba"; w: number; h: number; b64: string };
  bitmap.b64 = "CCCC";
  equal(entry.rev, 5);
  const changedHash = hashGameState(state);
  ok(changedHash !== initialHash);
  equal(changedHash, previousHashProjection(state));
});

test("surface hashes retain UTF-8 parity for non-ASCII surface keys", () => {
  const state = withSurfaceBytes("AAAA");
  state.surfaces.colours["café"] = state.surfaces.entries["1"]!.id;
  equal(hashGameState(state), previousHashProjection(state));
  state.time.tick += 1;
  equal(hashGameState(state), previousHashProjection(state));
});
