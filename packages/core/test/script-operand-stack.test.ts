// Synthetic test program, operand stack snapshots, mid-expression yields, and deterministic restore.
import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  canon,
  createGameState,
  hashState,
  restoreGameState,
  runThreadsPhase,
  runTimePhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  type GameState,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const SYNTHETIC = `global(hits) = 0
count = 4
function twice(n) { return n + n }
function bump(&n) { n = n + 1 }
function ref() { return &count }
function sum(n)
{
  if (n <= 0) { return 0 }
  return n + sum(n - 1)
}
function fact(n) {
  if (n <= 1) { return 1 }
  return n * fact(n - 1)
}
function classify(v) {
  switch (v) {
    case (0) { return "none" }
    case (1): { return "one" }
    default: { return "many" }
  }
  return "unreachable"
}
local(i) = 0
total = 0
while (i < 3) { total = total + twice(i); i = i + 1 }
until (i >= 5) { i = i + 1 }
for (local(j) = 0; j < 2; ++j) { hits = hits + 1 }
bump(total)
ref() = 10
deep = sum(20)
big = fact(8)
label = classify(1)
off = "off"
if (off) { label = "truthy" } else { label = label + "!" }
mid = 1 + sleep(2) + 3
end()
`;

test("the synthetic program produces all pinned outcomes with a stable state hash", () => {
  function run(): { state: GameState; hash: string } {
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, { kind: "inline", text: SYNTHETIC, ir: "1" });
    const services = createScriptServices(state);

    let ticks = 0;
    while (state.vm.threads[0]?.status !== "finished" && ticks < 20) {
      advanceScriptTick(state, services);
      ticks++;
    }
    return { state, hash: hashState(state) };
  }

  const run1 = run();
  const run2 = run();

  equal(run1.hash, run2.hash);
  equal(run1.state.vm.threads[0]!.status, "finished");
  equal(run1.state.vm.globals.hits, 2);
  equal(run1.state.vm.globals.count, 10);
  equal(run1.state.vm.globals.total, 7);
  equal(run1.state.vm.globals.deep, 210);
  equal(run1.state.vm.globals.big, 40320);
  equal(run1.state.vm.globals.label, "one!");
  equal(run1.state.vm.globals.mid, 4);
  equal(run1.state.vm.globals.off, "off");

  // Top-level local(i) and local(j) never entered globals
  equal(Object.hasOwn(run1.state.vm.globals, "i"), false);
  equal(Object.hasOwn(run1.state.vm.globals, "j"), false);
});

test("per-step snapshot and restore round-trips with non-empty operand stack", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: SYNTHETIC, ir: "1" });
  const services = createScriptServices(state);

  let totalSteps = 0;
  let seenNonEmptyOperands = 0;
  const sampleSnapshots: string[] = [];

  while (totalSteps < 2000) {
    const thread = state.vm.threads[0];
    if (!thread || thread.status === "finished") break;

    if (thread.status === "waiting") {
      runWaitsPhase(state.vm, state.time);
      if (thread.status === "waiting") {
        runTimePhase(state.time);
        continue;
      }
    }

    const frame = thread.frames[thread.frames.length - 1];
    if (frame && frame.operands.length > 0) {
      seenNonEmptyOperands++;
    }

    const snap = snapshot(state);
    const restored = restoreGameState(snap);
    equal(canon(restored), snap);

    if (frame && frame.operands.length > 0 && sampleSnapshots.length < 10) {
      sampleSnapshots.push(snap);
    }

    runThreadsPhase(state.vm, services, 1);
    totalSteps++;
  }

  equal(seenNonEmptyOperands > 0, true);
  const targetHash = hashState(state);

  // Restore from mid-expression snapshots and verify each finishes with identical final hash
  for (const snap of sampleSnapshots) {
    const freshState = restoreGameState(snap);
    const freshServices = createScriptServices(freshState);
    let guard = 0;
    while (guard < 2000) {
      const freshThread = freshState.vm.threads[0];
      if (!freshThread || freshThread.status === "finished") break;

      if (freshThread.status === "waiting") {
        runWaitsPhase(freshState.vm, freshState.time);
        if (freshThread.status === "waiting") {
          runTimePhase(freshState.time);
          continue;
        }
      }
      runThreadsPhase(freshState.vm, freshServices, 1);
      guard++;
    }
    equal(hashState(freshState), targetHash);
  }
});
