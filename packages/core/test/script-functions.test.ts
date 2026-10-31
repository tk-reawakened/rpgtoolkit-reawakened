// Functions, recursion, scope, parameters, by-reference aliasing and overloading.
import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  runThreadsPhase,
  startProgram,
  type GameState,
  type PluginDefinition,
  type ScriptError,
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

function runScript(source: string, plugins: readonly PluginDefinition[] = []): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  advanceOrFail(state, createScriptServices(state, plugins));
  return state;
}

test("deep recursion runs without host stack overflow (iterative VM loop)", () => {
  const script = `
function fact(n) {
  if (n <= 1) {
    return 1
  }
  return n * fact(n - 1)
}
function sum(n) {
  if (n <= 0) {
    return 0
  }
  return n + sum(n - 1)
}
r_fact = fact(500)
r_sum = sum(500)
`;

  function runDeep(): { state: GameState; maxFrames: number } {
    const state = createGameState({ seed: 0 });
    startProgram(state.vm, { kind: "inline", text: script, ir: "1" });
    const services = createScriptServices(state);
    let maxFrames = 0;
    while (state.vm.threads[0]?.status === "ready") {
      maxFrames = Math.max(maxFrames, state.vm.threads[0].frames.length);
      runThreadsPhase(state.vm, services, 1);
    }
    return { state, maxFrames };
  }

  const s1 = runDeep();
  const s2 = runDeep();

  equal(s1.state.vm.globals.r_fact, s2.state.vm.globals.r_fact);
  equal(s1.maxFrames >= 500, true);
  equal(s1.state.vm.globals.r_sum, 125250); // 500 * 501 / 2
  equal(s2.state.vm.globals.r_sum, 125250);
});

test("locals shadow globals and global(x) reaches past locals (SEM-4)", () => {
  const script = `
x = 1
function f() {
  local(x) = 9
  return x
}
function g() {
  local(x) = 9
  global(x) = 2
  return x
}
ret_f = f()
after_f = x
ret_g = g()
after_g = x
`;
  const state = runScript(script);
  equal(state.vm.globals.ret_f, 9);
  equal(state.vm.globals.after_f, 1);
  equal(state.vm.globals.ret_g, 9);
  equal(state.vm.globals.after_g, 2);
});

test("& by-reference parameter aliasing and non-variable fallback (FUN-1, EXP-3)", () => {
  const script = `
function inc1(&n) {
  n = n + 1
}
function inc2(n &) {
  n = n + 10
}
x = 1
inc1(x)
after1 = x
inc2(x)
after2 = x

// Passing non-variable argument leaves it as plain local without error
inc1(1 + 2)
after3 = x
`;
  const state = runScript(script);
  equal(state.vm.globals.after1, 2);
  equal(state.vm.globals.after2, 12);
  equal(state.vm.globals.after3, 12);
});

test("return &lvalue allows function call as assignment target (FUN-3)", () => {
  const script = `
g = 1
function pick() {
  return &g
}
pick() = 5
after_g = g

arr[1] = "original"
function pickArr() {
  return &arr[1]
}
pickArr() = "updated"
after_arr = arr[1]
`;
  const state = runScript(script);
  equal(state.vm.globals.after_g, 5);
  equal(state.vm.globals.after_arr, "updated");

  // Assigning to a call that returned a non-reference value throws vm.bad-lvalue
  const badScript = `
function noRef() {
  return 10
}
noRef() = 20
`;
  equal(errorOf(() => runScript(badScript)).code, "vm.bad-lvalue");
});

test("overloads dispatch by parameter count and duplicate arity is rejected (FUN-1)", () => {
  const script = `
function f(a) {
  return "one"
}
function f(a, b) {
  return "two"
}
r1 = f(1)
r2 = f(1, 2)
`;
  const state = runScript(script);
  equal(state.vm.globals.r1, "one");
  equal(state.vm.globals.r2, "two");

  // Duplicate definition with same arity in one program throws compile.duplicate-function
  const duplicate = `
function dup(a) {
  return 1
}
function dup(x) {
  return 2
}
`;
  equal(errorOf(() => runScript(duplicate)).code, "compile.duplicate-function");
});

test("typed parameter is accepted as documentation only (FUN-1)", () => {
  const script = `
method clone(CArray rhs) {
  return rhs + 1
}
r = clone(41)
`;
  const state = runScript(script);
  equal(state.vm.globals.r, 42);
});
