// Control flow: if/elseif/else, while, until, for, switch, labels and control effects.
import { equal } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  advanceScriptTick,
  assetKey,
  createAssetIndex,
  createGameState,
  PACKAGE_ROOT,
  hashState,
  restoreGameState,
  snapshot,
  startProgram,
  type BuiltinSpec,
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

test("if/elseif/else selects the matching branch and skips the rest", () => {
  const script = `
function classify(x) {
  if (x == 1) {
    return "one"
  } elseif (x == 2) {
    return "two"
  } else if (x == 3) {
    return "three"
  } else {
    return "other"
  }
}
r1 = classify(1)
r2 = classify(2)
r3 = classify(3)
r4 = classify(99)
`;
  const state = runScript(script);
  equal(state.vm.globals.r1, "one");
  equal(state.vm.globals.r2, "two");
  equal(state.vm.globals.r3, "three");
  equal(state.vm.globals.r4, "other");
});

test("while loops until false and skips when initially false", () => {
  const script = `
i = 0
sum = 0
while (i < 5) {
  sum = sum + i
  i = i + 1
}
skipped = 0
while (0) {
  skipped = 1
}
`;
  const state = runScript(script);
  equal(state.vm.globals.i, 5);
  equal(state.vm.globals.sum, 10);
  equal(state.vm.globals.skipped, 0);
});

test("until checks first (SEM-2) and loops until true", () => {
  const script = `
i = 0
sum = 0
until (i >= 5) {
  sum = sum + i
  i = i + 1
}
// Initially true condition skips immediately
skipped = 0
until (1) {
  skipped = 1
}
`;
  const state = runScript(script);
  equal(state.vm.globals.i, 5);
  equal(state.vm.globals.sum, 10);
  equal(state.vm.globals.skipped, 0);
});

test("for header allows empty parts (STX-4)", () => {
  const script = `
n = 0
for (; n < 3; ) {
  n = n + 1
}
// with step only
m = 0
for (; m < 3; m = m + 1) {
}
`;
  const state = runScript(script);
  equal(state.vm.globals.n, 3);
  equal(state.vm.globals.m, 3);
});

test("switch/case with colon or colon-less labels and default has no fall-through (STX-2)", () => {
  const script = `
function pick(v) {
  switch (v) {
    case (0) {
      hit = 0
      return "zero"
    }
    case (1): {
      hit = 1
      return "one"
    }
    case 2: {
      hit = 2
      return "two"
    }
    default: {
      hit = 99
      return "many"
    }
  }
}
r0 = pick(0)
r1 = pick(1)
r2 = pick(2)
r3 = pick(10)
`;
  const state = runScript(script);
  equal(state.vm.globals.r0, "zero");
  equal(state.vm.globals.r1, "one");
  equal(state.vm.globals.r2, "two");
  equal(state.vm.globals.r3, "many");
});

test("labels are function-scoped and duplicate label is rejected (STX-5)", () => {
  // Duplicate label in one scope throws compile.duplicate-label
  equal(
    errorOf(() =>
      runScript(`
function f() {
  :loop
  x = 1
  :loop
  return x
}
`),
    ).code,
    "compile.duplicate-label",
  );

  // Same label name in different functions is allowed
  const state = runScript(`
function f1() {
  :loop
  return 1
}
function f2() {
  :loop
  return 2
}
r1 = f1()
r2 = f2()
`);
  equal(state.vm.globals.r1, 1);
  equal(state.vm.globals.r2, 2);
});

test("vm.control effects: end unwinds all frames and finishes thread (FUN-7)", () => {
  const script = `
function deep() {
  end()
  return "unreachable"
}
function middle() {
  return deep()
}
middle()
result = "done"
`;
  const state = runScript(script);
  equal(state.vm.threads[0]!.status, "finished");
  equal(state.vm.threads[0]!.frames.length, 0);
  equal(state.vm.globals.result, undefined);
});

test("done and stop share end's full unwind semantics", () => {
  for (const command of ["done", "stop"]) {
    const state = runScript(`function deep() {\n  ${command}()\n}\ndeep()\nafter = 1\n`);
    equal(state.vm.threads[0]?.status, "finished");
    equal(state.vm.threads[0]?.frames.length, 0);
    equal(state.vm.globals.after, undefined);
  }
});

test("run abandons its caller and starts the replacement file", () => {
  const source = "child = 2\n";
  const key = assetKey("Prg/child.prg");
  const bytes = new TextEncoder().encode(source);
  const loader = {
    index: createAssetIndex(["Prg/child.prg"]),
    root: PACKAGE_ROOT,
    read: (asset: typeof key) => asset === key ? bytes : undefined,
  };
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: 'before = 1\nrun("child.prg")\nafter = 3\n', ir: "1" });
  const services = createScriptServices(state, [], undefined, undefined, loader);
  advanceOrFail(state, services);
  advanceOrFail(state, services);
  equal(state.vm.globals.before, 1);
  equal(state.vm.globals.child, 2);
  equal(state.vm.globals.after, undefined);
  equal(state.vm.threads[0]?.status, "finished");
  equal(state.vm.threads[0]?.frames.length, 0);
});

test("snapshot before end resumes identically after the final unwind", () => {
  const state = createGameState({ seed: 7 });
  startProgram(state.vm, {
    kind: "inline",
    text: "marker = 1\nsleep(1)\nend()\nafter = 2\n",
    ir: "1",
  });
  const services = createScriptServices(state);
  advanceScriptTick(state, services);
  const restored = restoreGameState(snapshot(state));
  advanceScriptTick(state, services);
  advanceScriptTick(restored, createScriptServices(restored));
  equal(hashState(restored), hashState(state));
  equal(restored.vm.threads[0]?.status, "finished");
  equal(restored.vm.globals.after, undefined);
});

test("vm.control effects: run replaces program and jump jumps to label", () => {
  const jumpCmd: BuiltinSpec = {
    name: "dojump",
    aliases: [],
    params: [{ name: "target", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({
      value: null,
      effects: [{ kind: "vm.control", args: ["jump", String(args[0]?.value)] }],
    }),
  };

  const plugins: readonly PluginDefinition[] = [
    { id: "test.jump", version: "1.0.0", commands: [jumpCmd] },
  ];

  // Test jump
  const jumpScript = `
function f() {
  x = 1
  dojump(:target)
  x = 99
  :target
  return x
}
r = f()
`;
  const state = runScript(jumpScript, plugins);
  equal(state.vm.globals.r, 1);

  // Unknown label raises vm.unknown-label
  const badJump = `
function f() {
  dojump(:nonexistent)
}
f()
`;
  equal(errorOf(() => runScript(badJump, plugins)).code, "vm.unknown-label");
});

test("fbranch is an alias of branch: jumps without returning to caller and survives mid-run snapshot/restore", () => {
  const script = `
x = 1
fbranch(:jump_dest)
x = 99
:jump_dest
x = x + 10
sleep(1)
x = x + 100
end()
`;
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: script, ir: "1" });
  const services = createScriptServices(state);

  advanceOrFail(state, services);
  equal(state.vm.globals.x, 11);
  equal(state.vm.threads[0]?.status, "waiting");

  const snap = snapshot(state);
  const restored = restoreGameState(snap);
  const restoredServices = createScriptServices(restored);

  state.time.tick += 1;
  restored.time.tick += 1;
  advanceOrFail(state, services);
  advanceOrFail(restored, restoredServices);

  equal(state.vm.globals.x, 111);
  equal(restored.vm.globals.x, 111);
  equal(state.vm.threads[0]?.status, "finished");
  equal(restored.vm.threads[0]?.status, "finished");
  equal(hashState(state), hashState(restored));

  const fnScript = `
function worker() {
  val = 5
  fbranch(:skip_me)
  val = 999
  :skip_me
  val = val + 20
  return val
}
res = worker()
`;
  const fnState = runScript(fnScript);
  equal(fnState.vm.globals.res, 25);
});
