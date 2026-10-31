import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  hashGameState,
  incrementStepCounter,
  isCallableValue,
  readStepCounters,
  restoreGameState,
  snapshot,
  startProgram,
  startThread,
  stepThread,
  verifyRestoredHandles,
  withOwner,
  type GameState,
  type ProgramRef,
  type ScriptError,
} from "../src/index.ts";
import type { Value } from "../src/ports/value.ts";
import { createScriptServices } from "./script-test-services.ts";

const ir = "1";

function packageRef(text: string, owner: string): ProgramRef {
  return withOwner({ kind: "inline", text, ir }, owner);
}

function makeState(): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, packageRef("f = (x) => x + 1\nr = f(1)\n", "alpha"));
  startThread(state.vm, { ref: packageRef("g = (x) => x * 2\ns = g(2)\n", "beta"), kind: "item", owner: "world" });
  return state;
}

function finish(state: GameState): number {
  const services = createScriptServices(state);
  let total = 0;
  for (const thread of state.vm.threads) {
    total += stepThread(thread, state.vm, services, 1000);
  }
  return total;
}

function ownerOf(value: Value | undefined): string | undefined {
  return isCallableValue(value) ? value.owner : undefined;
}

test("per-package counters attribute direct and callable instructions and sum to thread steps", () => {
  const state = makeState();
  const steps = finish(state);

  deepEqual(readStepCounters(state.vm), {
    alpha: state.vm.stepCounters!.alpha,
    beta: state.vm.stepCounters!.beta,
  });
  equal((state.vm.stepCounters?.alpha ?? 0) + (state.vm.stepCounters?.beta ?? 0), steps);
  equal(state.vm.globals.r, 2);
  equal(state.vm.globals.s, 4);
  equal(ownerOf(state.vm.globals.f), "alpha");
  equal(ownerOf(state.vm.globals.g), "beta");
});

test("same-source direct functions keep each package's instruction attribution", () => {
  const state = createGameState({ seed: 0 });
  const text = "function add(x) { return x + 1 }\nr = add(1)\n";
  const alpha = startProgram(state.vm, packageRef(text, "alpha"));
  const services = createScriptServices(state);
  while (alpha.status === "ready") stepThread(alpha, state.vm, services, 1000);

  const beta = startThread(state.vm, { ref: packageRef(text, "beta"), kind: "item", owner: "world" });
  while (beta.status === "ready") stepThread(beta, state.vm, services, 1000);

  deepEqual(readStepCounters(state.vm), { alpha: 10, beta: 10 });
  equal(state.vm.globals.r, 2);
});

test("per-package counters are deterministic across runs, snapshots and restore", () => {
  const first = makeState();
  const second = makeState();
  finish(first);
  finish(second);
  equal(snapshot(first), snapshot(second));
  equal(hashGameState(first), hashGameState(second));

  const resumed = makeState();
  for (const thread of resumed.vm.threads) stepThread(thread, resumed.vm, createScriptServices(resumed), 1);
  const restored = restoreGameState(snapshot(resumed));
  const services = createScriptServices(restored);
  verifyRestoredHandles(restored.vm, services);
  finish(restored);
  finish(resumed);
  equal(snapshot(restored), snapshot(resumed));
  deepEqual(readStepCounters(restored.vm), readStepCounters(resumed.vm));
});

test("step counters are excluded from the game-state hash", () => {
  const plain = createGameState({ seed: 0 });
  const counted = createGameState({ seed: 0 });
  counted.vm.stepCounters = { alpha: 17, beta: 4 };
  equal(hashGameState(counted), hashGameState(plain));
  ok(snapshot(counted).includes('"stepCounters"'));
});

test("reserved package IDs count as own numeric counters through snapshot restore", () => {
  const owners = ["__proto__", "constructor", "toString", "ordinary"];
  const state = createGameState({ seed: 0 });
  for (const owner of owners) {
    incrementStepCounter(state.vm, owner);
    incrementStepCounter(state.vm, owner);
  }

  const counters = state.vm.stepCounters!;
  deepEqual(Object.keys(counters), owners);
  for (const owner of owners) {
    equal(Object.hasOwn(counters, owner), true);
    equal(counters[owner], 2);
    equal(typeof counters[owner], "number");
  }

  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.vm.stepCounters, counters);
  for (const owner of owners) incrementStepCounter(restored.vm, owner);
  for (const owner of owners) equal(restored.vm.stepCounters![owner], 3);

  const replay = createGameState({ seed: 0 });
  for (const owner of owners) {
    incrementStepCounter(replay.vm, owner);
    incrementStepCounter(replay.vm, owner);
  }
  equal(snapshot(replay), snapshot(state));
  equal(hashGameState(state), hashGameState(createGameState({ seed: 0 })));
});

test("restore validates messagesOff and stepCounters shapes", () => {
  const state = createGameState({ seed: 0 });
  state.vm.stepCounters = { alpha: 17, beta: 4 };
  const base = JSON.parse(snapshot(state)) as {
    vm: { messagesOff?: unknown; stepCounters?: unknown };
  };

  deepEqual(restoreGameState(JSON.stringify(base)).vm.stepCounters, state.vm.stepCounters);
  base.vm.messagesOff = true;
  deepEqual(restoreGameState(JSON.stringify(base)).vm.stepCounters, state.vm.stepCounters);

  const malformed = [
    ["messagesOff=false", (raw: typeof base) => { raw.vm.messagesOff = false; }, "the snapshot's vm.messagesOff is invalid"],
    ["messagesOff=0", (raw: typeof base) => { raw.vm.messagesOff = 0; }, "the snapshot's vm.messagesOff is invalid"],
    ["messagesOff=text", (raw: typeof base) => { raw.vm.messagesOff = "true"; }, "the snapshot's vm.messagesOff is invalid"],
    ["messagesOff=null", (raw: typeof base) => { raw.vm.messagesOff = null; }, "the snapshot's vm.messagesOff is invalid"],
    ["stepCounters empty owner", (raw: typeof base) => { raw.vm.stepCounters = { "": 1 }; }, "the snapshot's vm.stepCounters. must be a non-negative whole number"],
    ["stepCounters non-number", (raw: typeof base) => { raw.vm.stepCounters = { alpha: "1" }; }, "the snapshot's vm.stepCounters.alpha must be a non-negative whole number"],
    ["stepCounters negative", (raw: typeof base) => { raw.vm.stepCounters = { alpha: -1 }; }, "the snapshot's vm.stepCounters.alpha must be a non-negative whole number"],
    ["stepCounters fractional", (raw: typeof base) => { raw.vm.stepCounters = { alpha: 1.5 }; }, "the snapshot's vm.stepCounters.alpha must be a non-negative whole number"],
    ["stepCounters unsafe integer", (raw: typeof base) => { raw.vm.stepCounters = { alpha: 9007199254740992 }; }, "the snapshot's vm.stepCounters.alpha must be a non-negative whole number"],
    ["stepCounters malformed record", (raw: typeof base) => { raw.vm.stepCounters = []; }, "the snapshot's vm.stepCounters must be an object"],
  ] as const;

  for (const [label, change, message] of malformed) {
    const raw = JSON.parse(JSON.stringify(base)) as typeof base;
    change(raw);
    throws(
      () => restoreGameState(JSON.stringify(raw)),
      (error: unknown) => {
        equal((error as ScriptError).code, "restore.shape", label);
        equal((error as ScriptError).message, message, label);
        return true;
      },
    );
  }
});
