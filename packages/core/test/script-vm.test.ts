// The tracer's step machine (G1; AD-8/AD-9/AD-26; docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-3):
// stores and loads, by-reference binding and write-back, error codes, the sleep
// yield and wait order, and the per-tick step budget.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  canon,
  createGameState,
  createVmState,
  globalRef,
  hashState,
  pollSleep,
  restoreGameState,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  type Arg,
  type BuiltinSpec,
  type GameState,
  type PluginDefinition,
  type ScriptError,
  type Thread,
  type WaitPoll,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

function makeState(program: string, seed = 0): GameState {
  const state = createGameState({ seed });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return state;
}

function waitingThread(id: number, until: number): Thread {
  return {
    id,
    kind: "board",
    owner: "script",
    source: null,
    target: null,
    frames: [
      {
        program: { kind: "inline", text: "", ir: "1" },
        ip: 0,
        locals: {},
        operands: [],
        errorHandler: null,
        autoLocal: false,
      },
    ],
    status: "waiting",
    wait: { kind: "sleep", global: false, until, resumesCall: true },
    queue: [],
    pending: null,
    detached: [],
    collect: null,
  };
}

function readyThread(id: number, text: string): Thread {
  return {
    id,
    kind: "board",
    owner: "script",
    source: null,
    target: null,
    frames: [
      {
        program: { kind: "inline", text, ir: "1" },
        ip: 0,
        locals: {},
        operands: [],
        errorHandler: null,
        autoLocal: false,
      },
    ],
    status: "ready",
    wait: null,
    queue: [],
    pending: null,
    detached: [],
    collect: null,
  };
}

test("stores and loads a global and reads an unset name as 0", () => {
  const state = makeState("x = 1\ny = x\nz = n\n");
  advanceScriptTick(state, createScriptServices(state));

  equal(state.vm.globals.x, 1);
  equal(state.vm.globals.y, 1);
  equal(state.vm.globals.z, 0);
  equal(Object.hasOwn(state.vm.globals, "n"), true);
  equal(state.vm.globals.n, 0);
  equal(state.vm.threads[0]!.status, "finished");
});

test("binds a variable argument with its RefId and a literal without", () => {
  let captured: readonly Arg[] = [];
  const probe: BuiltinSpec = {
    name: "probe",
    aliases: [],
    params: [
      { name: "a", optional: false, byRef: false, variadic: false },
      { name: "b", optional: false, byRef: false, variadic: false },
    ],
    call: (_view, args) => {
      captured = args;
      return { value: null };
    },
  };
  const plugins: readonly PluginDefinition[] = [
    { id: "test.probe", version: "1.0.0", commands: [probe] },
  ];

  const state = makeState("x = 5\nprobe(x, 7)\n");
  advanceScriptTick(state, createScriptServices(state, plugins));

  deepEqual(captured, [
    { value: 5, ref: globalRef("x") },
    { value: 7, ref: null },
  ]);
});

test("writes a by-ref out back into the caller's variable inside the hash", () => {
  const writer: BuiltinSpec = {
    name: "writev",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: true, variadic: false }],
    call: () => ({ value: null, out: [[0, 9]] }),
  };
  const passthrough: BuiltinSpec = {
    name: "writev",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: true, variadic: false }],
    call: () => ({ value: null }),
  };
  const writerPack: readonly PluginDefinition[] = [
    { id: "test.writer", version: "1.0.0", commands: [writer] },
  ];
  const passthroughPack: readonly PluginDefinition[] = [
    { id: "test.passthrough", version: "1.0.0", commands: [passthrough] },
  ];

  const written = makeState("writev(v)\n");
  advanceScriptTick(written, createScriptServices(written, writerPack));
  equal(written.vm.globals.v, 9);

  const untouched = makeState("writev(v)\n");
  advanceScriptTick(untouched, createScriptServices(untouched, passthroughPack));

  equal(written.vm.globals.v === untouched.vm.globals.v, false);
  equal(hashState(written) === hashState(untouched), false);

  const badOut: BuiltinSpec = {
    name: "bad",
    aliases: [],
    params: [{ name: "x", optional: false, byRef: false, variadic: false }],
    call: () => ({ value: null, out: [[0, 1]] }),
  };
  const broken = makeState("bad(z)\n");
  equal(
    errorOf(() =>
      advanceOrFail(broken, createScriptServices(broken, [
        { id: "test.bad", version: "1.0.0", commands: [badOut] },
      ])),
    ).code,
    "builtin.out-not-by-ref",
  );

  // A null output stores as 0, exactly as `store` does.
  const nullout: BuiltinSpec = {
    name: "nullout",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: true, variadic: false }],
    call: () => ({ value: null, out: [[0, null]] }),
  };
  const nulled = makeState("nullout(v)\n");
  advanceScriptTick(nulled, createScriptServices(nulled, [
    { id: "test.nullout", version: "1.0.0", commands: [nullout] },
  ]));
  equal(nulled.vm.globals.v, 0);
});

test("throws unknown.command and arity.mismatch", () => {
  const unknown = makeState("nope()\n");
  equal(
    errorOf(() => advanceOrFail(unknown, createScriptServices(unknown))).code,
    "unknown.command",
  );

  const tooMany = makeState("sleep(1, 2)\n");
  equal(
    errorOf(() => advanceOrFail(tooMany, createScriptServices(tooMany))).code,
    "arity.mismatch",
  );

  const tooFew = makeState("sleep()\n");
  equal(
    errorOf(() => advanceOrFail(tooFew, createScriptServices(tooFew))).code,
    "arity.mismatch",
  );
});

test("sleep leaves the thread waiting with ip past the call", () => {
  const state = makeState('greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n');
  advanceScriptTick(state, createScriptServices(state));

  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  deepEqual(thread.wait, { kind: "sleep", global: true, until: 2, resumesCall: true });
  equal(thread.frames[0]!.ip, 10);
  equal(thread.frames[0]!.operands.length, 0);
  equal(state.time.tick, 1);
});

test("the waits phase wakes exactly at until and polls in ascending id order", () => {
  const vm = createVmState();
  // Pushed as ids 3, 1, 2 so array order (3, 1, 2) differs from id order.
  vm.threads.push(waitingThread(3, 10), waitingThread(1, 4), waitingThread(2, 7));

  const polled: Array<number | null> = [];
  const spy: WaitPoll = (view, wait) => {
    polled.push(wait.kind === "sleep" ? wait.until : null);
    return pollSleep(view, wait);
  };

  runWaitsPhase(vm, { tick: 3 }, spy);
  deepEqual(polled, [4, 7, 10]); // ascending id, never the array order
  deepEqual(
    vm.threads.map((thread) => thread.status),
    ["waiting", "waiting", "waiting"],
  );

  polled.length = 0;
  runWaitsPhase(vm, { tick: 4 }, spy);
  deepEqual(polled, [4, 7, 10]);
  deepEqual(
    vm.threads.map((thread) => thread.status),
    ["waiting", "ready", "waiting"],
  );

  polled.length = 0;
  runWaitsPhase(vm, { tick: 7 }, spy);
  deepEqual(polled, [7, 10]);
  deepEqual(
    vm.threads.map((thread) => thread.status),
    ["waiting", "ready", "ready"],
  );

  polled.length = 0;
  runWaitsPhase(vm, { tick: 10 }, spy);
  deepEqual(polled, [10]);
  deepEqual(
    vm.threads.map((thread) => thread.status),
    ["ready", "ready", "ready"],
  );

  for (const thread of vm.threads) {
    equal(thread.wait, null);
    equal(thread.frames[0]!.operands.length, 1);
  }
});

test("the threads phase runs ready threads in ascending id order", () => {
  const vm = createVmState();
  const order: number[] = [];
  const mark: BuiltinSpec = {
    name: "mark",
    aliases: [],
    params: [{ name: "n", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => {
      order.push(args[0]!.value as number);
      return { value: null };
    },
  };
  // Pushed as ids 3, 1, 2 so array order (3, 1, 2) differs from id order.
  vm.threads.push(readyThread(3, "mark(300)\n"), readyThread(1, "mark(100)\n"), readyThread(2, "mark(200)\n"));

  const plugins: readonly PluginDefinition[] = [
    { id: "test.mark", version: "1.0.0", commands: [mark] },
  ];
  runThreadsPhase(
    vm,
    createScriptServices(createGameState({ seed: 0 }), plugins),
    STEP_BUDGET,
  );
  deepEqual(order, [100, 200, 300]);
});

test("treats constructor and __proto__ as ordinary variables", () => {
  const state = makeState("x = constructor\nconstructor = 7\nz = constructor\n__proto__ = 5\ny = __proto__\n");
  advanceScriptTick(state, createScriptServices(state));

  equal(state.vm.globals.x, 0);
  equal(state.vm.globals.constructor, 7);
  equal(state.vm.globals.z, 7);
  equal(state.vm.globals.__proto__, 5);
  equal(state.vm.globals.y, 5);
  equal(Object.hasOwn(state.vm.globals, "constructor"), true);
  equal(Object.hasOwn(state.vm.globals, "__proto__"), true);

  const json = canon(state);
  equal(json.includes('"constructor":7'), true);
  equal(json.includes('"__proto__":5'), true);
  equal(typeof hashState(state), "string");
  equal(canon(restoreGameState(snapshot(state))), json);
});

test("stores end's null result as the number 0", () => {
  const state = makeState("x = end()\n");
  advanceScriptTick(state, createScriptServices(state));
  equal(state.vm.globals.x, 0);
});

test("the step budget preempts a long program with ip advanced by exactly the budget", () => {
  const statements = Math.ceil((STEP_BUDGET + 10) / 4);
  const state = makeState("x = 1\n".repeat(statements));
  advanceScriptTick(state, createScriptServices(state));

  const thread = state.vm.threads[0]!;
  equal(thread.status, "ready");
  equal(thread.frames[0]!.ip, STEP_BUDGET);
});

test("sleep rejects zero, fractional and negative counts", () => {
  const zero = makeState("sleep(0)\n");
  equal(
    errorOf(() => advanceOrFail(zero, createScriptServices(zero))).code,
    "builtin.bad-arg",
  );

  const fractional = makeState("sleep(1.5)\n");
  equal(
    errorOf(() => advanceOrFail(fractional, createScriptServices(fractional))).code,
    "builtin.bad-arg",
  );

  const setnegative: BuiltinSpec = {
    name: "setnegative",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: true, variadic: false }],
    call: () => ({ value: null, out: [[0, -1]] }),
  };
  const plugins: readonly PluginDefinition[] = [
    { id: "test.negative", version: "1.0.0", commands: [setnegative] },
  ];
  const negative = makeState("setnegative(n)\nsleep(n)\n");
  equal(
    errorOf(() => advanceOrFail(negative, createScriptServices(negative, plugins))).code,
    "builtin.bad-arg",
  );
});

test("a second blocking thread is refused", () => {
  const state = createGameState({ seed: 0 });
  const ref = { kind: "inline", text: "end()", ir: "1" } as const;
  startProgram(state.vm, ref);
  equal(errorOf(() => startProgram(state.vm, ref)).code, "thread.blocking-exists");
});
