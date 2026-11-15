/**
 * Performance budgets for the state hash (docs/adr/0035-performance-budgets.md). Budgets count work, never time:
 * `fnv1a64ScannedBytes()` is the number of bytes the FNV loops scanned, which is the same on every machine.
 *
 * The state is shaped like the demo's: the same large inline program owner repeated once per definition
 * (`vm.defOwners`, #2767), part of it non-ASCII like `stock_menu`'s em dash (#2766), beside a stored canvas.
 */

import { equal, ok } from "node:assert/strict";
import test from "node:test";
import { fnv1a64ScannedBytes } from "../src/canon/fnv1a.ts";
import { createGameState, hashGameState } from "../src/index.ts";
import type { GameState } from "../src/save/state.ts";
import { referenceHashProjection } from "./hash-projections.ts";

/**
 * Budget: re-hashing a state whose shape the cache has seen re-scans at most this many bytes, however large the
 * repeated program text is. The first hash after a change may scan more: the transition cache learns each incoming
 * FNV low byte the first time it meets it (canon/fnv1a-transition.ts), so its cost is amortised over a run.
 */
const WARM_REHASH_SCAN_BUDGET = 64 * 1024;

function demoShapedState(): GameState {
  const state = createGameState({ seed: 7 });
  state.surfaces = {
    nextId: 2,
    entries: { "1": { id: 1 as GameState["surfaces"]["entries"][string]["id"], rev: 1, bitmap: { t: "rgba", w: 64, h: 64, b64: "QUFB".repeat(5000) } } },
    slots: {},
    colours: {},
  };
  const menu = { kind: "inline" as const, text: "// stock_menu — the default player menu\n" + "menu();\n".repeat(5000), ir: "1", owner: "stock_menu" };
  const battle = { kind: "inline" as const, text: "// stock_battle\n" + "fight();\n".repeat(5000), ir: "1", owner: "stock_battle" };
  state.vm.defOwners = Object.fromEntries([
    ...Array.from({ length: 24 }, (_, i) => [`menu${i}`, menu] as const),
    ...Array.from({ length: 24 }, (_, i) => [`battle${i}`, battle] as const),
  ]);
  return state;
}

test("budget: re-hashing seen states scans a bounded number of bytes however many program owners repeat", () => {
  const state = demoShapedState();
  const cold = fnv1a64ScannedBytes();
  // Warm the cache on two ticks, as a live player warms it over its first frames.
  for (const tick of [1, 2]) {
    state.time.tick = tick;
    hashGameState(state);
  }
  const coldBytes = fnv1a64ScannedBytes() - cold;
  ok(coldBytes > 1_000_000, `the fixture is large enough to matter (${coldBytes} bytes while warming)`);
  for (const tick of [1, 2, 1]) {
    state.time.tick = tick;
    const before = fnv1a64ScannedBytes();
    const hash = hashGameState(state);
    const scanned = fnv1a64ScannedBytes() - before;
    ok(scanned <= WARM_REHASH_SCAN_BUDGET, `tick ${tick} re-scanned ${scanned} bytes; budget ${WARM_REHASH_SCAN_BUDGET}`);
    equal(hash, referenceHashProjection(state));
  }
});
