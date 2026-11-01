import { equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { withoutSettings } from "../src/audio/model.ts";
import { hashState } from "../src/canon/canon.ts";
import { canon, fnv1a64, createAssetIndex, createEmptyBoard, createEngine, createGameState, createSurface, hashGameState, nextUint32, PACKAGE_ROOT, writeBoard } from "../src/index.ts";
import type { GameState } from "../src/save/state.ts";

function previousHashProjection(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const { nextRequestId: _nextRequestId, ...engine } = state.engine;
  return hashState({ ...state, vm, engine, audio: withoutSettings(state.audio) });
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
test("request counters are hash-neutral while outstanding request IDs remain state", () => {
  const completedA = createGameState({ seed: 31 });
  const completedB = createGameState({ seed: 31 });
  completedA.engine.nextRequestId = 8;
  completedB.engine.nextRequestId = 19;
  equal(hashGameState(completedA), hashGameState(completedB), "different completed request histories do not affect state hash");

  const waitingA = createGameState({ seed: 31 });
  const waitingB = createGameState({ seed: 31 });
  waitingA.engine.pending = [{ reqId: 4, key: "media/a.mid", kind: "asset" }];
  waitingB.engine.pending = [{ reqId: 5, key: "media/a.mid", kind: "asset" }];
  equal(waitingA.engine.nextRequestId, waitingB.engine.nextRequestId);
  ok(hashGameState(waitingA) !== hashGameState(waitingB), "simultaneous pending requests with different IDs are distinguishable");
});

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

test("unchanged large surfaces preserve hash parity across suffix-only ticks", () => {
  const state = withSurfaceBytes("A".repeat(640 * 480 * 4 * 4 / 3));
  const first = state.surfaces.entries["1"]!;
  for (let id = 2; id <= 4; id += 1) {
    state.surfaces.entries[String(id)] = { id: id as typeof first.id, rev: first.rev, bitmap: { ...first.bitmap } };
  }
  equal(hashGameState(state), previousHashProjection(state));
  state.time.tick += 1;
  equal(hashGameState(state), previousHashProjection(state));
});

test("advance preserves hash parity for large surfaces when pre-surface RNG changes", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let captured: GameState | undefined;
  let changeRng = false;
  const engine = createEngine({
    seed: 7, assetIndex: createAssetIndex(["Boards/test.brd"]), assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd", width: 640, height: 480, maxTicks: 1,
    phaseRegistrations: [{ phase: "input", run(state) {
      if (captured === undefined) {
        captured = state;
        for (let i = 0; i < 3; i += 1) createSurface(state.surfaces, 640, 480);
      }
      if (changeRng) nextUint32(state.rng);
    } }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  engine.advance(1, []);
  if (captured === undefined) throw new Error("expected engine state");
  const state: GameState = captured;
  equal(engine.advance(1, []).stateHash, previousHashProjection(state));
  changeRng = true;
  for (let i = 0; i < 8; i += 1) equal(engine.advance(1, []).stateHash, previousHashProjection(state));
});

test("surface hashes match legacy FNV for all incoming low-byte lanes", () => {
  const state = withSurfaceBytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".repeat(256));
  const counts = new Uint8Array(256);
  let covered = 0;
  let seed = 0x12345678;
  for (let i = 0; i < 10000 && covered < 256; i += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    state.rng.s0 = seed >>> 0;
    const { stepCounters: _stepCounters, ...vm } = state.vm;
    const text = canon({ ...state, vm, audio: withoutSettings(state.audio) });
    const position = text.indexOf(',"surfaces":');
    ok(position >= 0);
    const lane = Number.parseInt(fnv1a64(text.slice(0, position + 1)).slice(-2), 16);
    if (counts[lane]! >= 2) continue;
    counts[lane] = counts[lane]! + 1;
    equal(hashGameState(state), previousHashProjection(state));
    if (counts[lane] === 2) covered += 1;
  }
  equal(covered, 256);
});


test("prepared chunks preserve hashes across changing prefixes and direct surface mutations", () => {
  const state = withSurfaceBytes("A".repeat(32768));
  const expectLegacyHash = () => equal(hashGameState(state), previousHashProjection(state));
  expectLegacyHash();
  for (let i = 0; i < 8; i += 1) {
    state.schema.schema += 1;
    expectLegacyHash();
  }
  const bitmap = state.surfaces.entries["1"]!.bitmap as { b64: string };
  bitmap.b64 = bitmap.b64.slice(0, 9000) + "B" + bitmap.b64.slice(9001);
  expectLegacyHash();
  for (let i = 0; i < 4; i += 1) {
    state.schema.schema += 1;
    expectLegacyHash();
  }
  state.surfaces.entries["1"]!.rev += 1;
  expectLegacyHash();
  state.surfaces.slots["new"] = state.surfaces.entries["1"]!.id;
  expectLegacyHash();
  const clone = JSON.parse(JSON.stringify(state)) as GameState;
  equal(hashGameState(clone), previousHashProjection(clone));
});

test("bitmap fragments preserve canonical escaping, ordering and manual metadata edits", () => {
  const state = withSurfaceBytes('long"\\\\café' + "A".repeat(9000));
  const first = state.surfaces.entries["1"]!;
  state.surfaces.entries["10"] = { id: first.id, rev: 0, bitmap: { ...first.bitmap, b64: "quoted\\nvalue" } };
  state.surfaces.renderNow = first.id;
  state.surfaces.colours['quote\"'] = first.id;
  state.surfaces.slots["2"] = first.id;
  equal(hashGameState(state), previousHashProjection(state));
  first.bitmap = { ...first.bitmap, w: 2 };
  equal(hashGameState(state), previousHashProjection(state));
  state.surfaces.entries["10"]!.bitmap = { ...state.surfaces.entries["10"]!.bitmap, b64: "new value" };
  equal(hashGameState(state), previousHashProjection(state));
});

test("distinct ASCII chunks stay exact while incrementally preparing transitions", () => {
  let seed = 0x12345678;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let payload = "";
  for (let i = 0; i < 25000; i += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    payload += alphabet[seed & 63]!;
  }
  const state = withSurfaceBytes(payload);
  for (let i = 0; i < 12; i += 1) {
    state.schema.schema += 1;
    equal(hashGameState(state), previousHashProjection(state));
  }
  state.surfaces.colours["café"] = state.surfaces.entries["1"]!.id;
  for (let i = 0; i < 3; i += 1) {
    state.schema.schema += 1;
    equal(hashGameState(state), previousHashProjection(state));
  }
});

test("very large distinct surfaces preserve hashes after prefix and bitmap edits", () => {
  const payload = Array.from({ length: 2050 }, (_, i) => i.toString(36).padStart(6, "0") + "A".repeat(4090)).join("");
  const state = withSurfaceBytes(payload);
  equal(hashGameState(state), previousHashProjection(state));
  state.rng.s0 ^= 12345;
  equal(hashGameState(state), previousHashProjection(state));
  const bitmap = state.surfaces.entries["1"]!.bitmap as { b64: string };
  bitmap.b64 = "B" + bitmap.b64.slice(1);
  equal(hashGameState(state), previousHashProjection(state));
});

test("surface hashes preserve renderNowOn presence, values and direct mutations", () => {
  const state = withSurfaceBytes("A".repeat(10000));
  const surfaces = state.surfaces as typeof state.surfaces & { renderNowOn?: boolean };
  const absentHash = hashGameState(state);
  equal(absentHash, previousHashProjection(state));

  surfaces.renderNowOn = true;
  const trueHash = hashGameState(state);
  equal(trueHash, previousHashProjection(state));
  ok(trueHash !== absentHash);

  surfaces.renderNowOn = false;
  const falseHash = hashGameState(state);
  equal(falseHash, previousHashProjection(state));
  ok(falseHash !== trueHash);

  surfaces.renderNowOn = true;
  equal(hashGameState(state), trueHash);
  delete surfaces.renderNowOn;
  equal(hashGameState(state), absentHash);
});

test("aliased program owners preserve canonical hashes through direct edits and evolving prefixes", () => {
  const state = withSurfaceBytes("A".repeat(10000));
  const ref = { kind: "inline" as const, text: "x".repeat(9000), ir: "1", owner: "pack" };
  state.vm.defOwners = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`def${i}`, ref]));
  for (let i = 0; i < 30; i += 1) {
    state.rng.s0 = i;
    state.time.tick = i;
    equal(hashGameState(state), previousHashProjection(state));
  }
  ref.text = "changed\n" + ref.text;
  equal(hashGameState(state), previousHashProjection(state));
  ref.owner = "changed";
  equal(hashGameState(state), previousHashProjection(state));
  delete state.vm.defOwners.def3;
  state.vm.defOwners.def4 = { ...ref };
  equal(hashGameState(state), previousHashProjection(state));
  const cloned = JSON.parse(JSON.stringify(state)) as GameState;
  equal(hashGameState(cloned), previousHashProjection(cloned));
  ref.text = "café 😀\n" + ref.text;
  equal(hashGameState(state), previousHashProjection(state));
  state.vm.defOwners.def4 = { ...ref, includes: ["one.prg"], redirects: [["old", "new"]] };
  equal(hashGameState(state), previousHashProjection(state));
  state.vm.defOwners.def4.includes!.push("two.prg");
  state.vm.defOwners.def4.redirects![0]![1] = "newer";
  equal(hashGameState(state), previousHashProjection(state));
});

test("many independent program owners retain parity as they are replaced", () => {
  const state = withSurfaceBytes("A".repeat(10000));
  state.vm.defOwners = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [
    `def${i}`,
    { kind: "inline" as const, text: `${i}:` + "x".repeat(8200), ir: "1" },
  ]));
  equal(hashGameState(state), previousHashProjection(state));
  for (let i = 0; i < 8; i += 1) {
    delete state.vm.defOwners[`def${i}`];
    state.vm.defOwners[`replacement${i}`] = { kind: "inline", text: `${i}:` + "y".repeat(8200), ir: "1" };
    state.rng.s0 = i;
    equal(hashGameState(state), previousHashProjection(state));
  }
});

test("a large definition table hashes without exceeding call argument limits", () => {
  const state = withSurfaceBytes("");
  const ref = { kind: "inline" as const, text: "x", ir: "1" };
  state.vm.defOwners = Object.fromEntries(Array.from({ length: 65000 }, (_, i) => [`d${i}`, ref]));
  equal(hashGameState(state), previousHashProjection(state));
});

test("surface canonical cache falls back for extra fields and rejects accessors", () => {
  const state = withSurfaceBytes("A".repeat(10000));
  equal(hashGameState(state), previousHashProjection(state));
  const surfaces = state.surfaces as unknown as { renderNowOn?: unknown };
  surfaces.renderNowOn = "yes";
  equal(hashGameState(state), previousHashProjection(state));
  delete surfaces.renderNowOn;
  Object.assign(state.surfaces.entries["1"]!, { extra: "visible" });
  equal(hashGameState(state), previousHashProjection(state));
  delete (state.surfaces.entries["1"]! as { extra?: string }).extra;
  Object.defineProperty(state.surfaces.entries["1"]!.bitmap, "w", { enumerable: true, get: () => 1 });
  throws(() => hashGameState(state), /accessor/);
});
