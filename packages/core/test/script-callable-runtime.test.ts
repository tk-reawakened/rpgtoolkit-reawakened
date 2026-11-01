// First-class callables at run time (FUN-8; ADR 0004 decision 8; entry 18.4):
// `load_fn` makes a callable value whose captured names each get a fresh cell
// in `vm.cells`, `call_indirect` and a plain-name call of a variable push a
// frame exactly as a direct call does, waits and the step budget behave the
// same, and every failure stays located and catchable.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  advanceScriptTick,
  assetKey,
  canon,
  createAssetIndex,
  createGameState,
  fileProgramRef,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  startProgram,
  STEP_BUDGET,
  stepThread,
  type GameState,
  type ProgramLoader,
  type ScriptError,
  type ScriptServices,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

/** A loader over `Prg/<name>` files, as `script-modules.test.ts` builds one. */
function loaderOf(files: Record<string, string>): ProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(files)) {
    bytes.set(assetKey(`Prg/${name}`), new TextEncoder().encode(content));
  }
  return {
    index: createAssetIndex(Object.keys(files).map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key) => bytes.get(key),
  };
}

function makeState(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return state;
}

function errorOf(run: () => unknown): { code: string; message: string; line: number | null } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message, line: scriptError.pos?.line ?? null };
  }
  throw new Error("expected the call to throw");
}

/** Run the main thread's one tick and return the state, failing on any diagnostic. */
function runOnce(program: string): GameState {
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state));
  return state;
}

/** Advance until the main thread finishes, or `limit` ticks have passed. */
function runToRest(state: GameState, services: ScriptServices, limit = 30): void {
  for (let ticks = 0; state.vm.threads[0]!.status !== "finished" && ticks < limit; ticks += 1) {
    advanceOrFail(state, services);
  }
}

test("a lambda value is a plain-data callable, and a plain-name call runs it (FUN-8)", () => {
  const state = runOnce("x = 5\nf = (y) => y + x\nr = f(2)\n");

  equal(state.vm.globals.r, 7);
  deepEqual(state.vm.globals.f, {
    type: "callable",
    def: "<inline>#lambda_1",
    captures: [""],
    receiver: null,
  });
  // `x` is a global, so it is not captured: no cell exists and every call reads it live.
  equal(state.vm.cells, undefined);
  equal(state.vm.cellSeq, undefined);
  equal(state.vm.globals.x, 5);
});

test("an indirect call through an expression returns its value to the caller (FUN-8)", () => {
  equal(runOnce("r = ((x) => x * 3)(4)\n").vm.globals.r, 12);

  // The callee is below its arguments on the stack: (0)(1, 2) adds them up.
  const state = runOnce("sum = (a, b) => a + b\nr = (sum)(1, 2)\n");
  equal(state.vm.globals.r, 3);
});

test("a nested lambda captures from the frame that made it (FUN-8)", () => {
  const state = runOnce("adder = (a) => (b) => a + b\nadd2 = adder(2)\nr = add2(3)\n");

  equal(state.vm.globals.r, 5);
  // `rer` is the outer lambda's parameter, captured by the inner one when it was built.
  deepEqual(state.vm.globals.add2, {
    type: "callable",
    def: "<inline>#lambda_2",
    captures: ["cell1"],
    receiver: null,
  });
  deepEqual(state.vm.cells, { cell1: 2 });
});

test("a global is read and written live, never captured (FUN-8)", () => {
  const state = runOnce("x = 10\nadd = (y) => y + x\nfirst = add(1)\nx = 100\nsecond = add(2)\n");

  equal(state.vm.globals.first, 11);
  equal(state.vm.globals.second, 102);
  deepEqual(state.vm.globals.add, {
    type: "callable",
    def: "<inline>#lambda_1",
    captures: [""],
    receiver: null,
  });
  equal(state.vm.cells, undefined, "no cell is allocated for a global");

  const written = runOnce("n = 0\ncounter = () => { n = n + 1; return n }\na = counter()\nb = counter()\n");
  equal(written.vm.globals.n, 2);
  equal(written.vm.globals.b, 2);
});

test("a local of the creating function is captured into a private cell (FUN-8)", () => {
  const state = runOnce(`
function make() {
  local(n)
  n = 0
  return () => { n = n + 1; return n }
}
c = make()
a = c()
b = c()
`);

  equal(state.vm.globals.a, 1);
  equal(state.vm.globals.b, 2);
  equal(state.vm.globals.n, undefined, "the closure's writes never create a global");
  deepEqual(state.vm.cells, { cell1: 2 });
});

test("two callables built by two runs of the same code get separate cells", () => {
  const state = runOnce(`
function make(start) {
  local(v)
  v = 0
  return () => { v = v + 1; return v + start }
}
c1 = make(10)
c2 = make(20)
a = c1()
b = c1()
c = c2()
`);

  equal(state.vm.globals.a, 11);
  equal(state.vm.globals.b, 12);
  equal(state.vm.globals.c, 21);
  equal(state.vm.cellSeq, 4);
  deepEqual(Object.keys(state.vm.cells ?? {}).sort(), ["cell1", "cell2", "cell3", "cell4"]);
});

test("a wait inside the callee parks the caller and resumes it with the return value", () => {
  const state = makeState("f = () => { sleep(2); return 7 }\nr = f()\nafter = 1\n");
  const services = createScriptServices(state);

  advanceScriptTick(state, services);
  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  deepEqual(thread.wait, { kind: "sleep", global: true, until: 2, resumesCall: true });
  // The callee's frame is on the stack above the caller's, parked at its own call.
  equal(thread.frames.length, 2);
  deepEqual(thread.frames[1]!.program, thread.frames[0]!.program);
  // `r` exists already, unset, because the assignment's target is read first
  // (SEM-4): the parked call has not returned, so `after` does not exist yet.
  equal(state.vm.globals.r, 0);
  equal(state.vm.globals.after, undefined);

  runToRest(state, services);
  equal(state.vm.globals.r, 7);
  equal(state.vm.globals.after, 1);
  equal(thread.status, "finished");
});

test("the per-tick budget preempts in the middle of an indirect call and resumes it", () => {
  const state = makeState("f = () => { while (1) { n = n + 1 } }\nf()\n");
  const services = createScriptServices(state);
  const thread = state.vm.threads[0]!;

  equal(stepThread(thread, state.vm, services, 40), 40);
  equal(thread.status, "ready");
  equal(thread.frames.length, 2, "the callee frame survives the preemption");
  const parked = thread.frames[1]!.ip;
  equal(parked > 0, true);
  const counted = Number(state.vm.globals.n ?? 0);

  equal(stepThread(thread, state.vm, services, STEP_BUDGET), STEP_BUDGET);
  equal(thread.status, "ready");
  equal(Number(state.vm.globals.n ?? 0) > counted, true, "the loop kept counting the live global");
});

test("calling a non-callable raises a located, catchable error (FUN-8)", () => {
  const indirect = errorOf(() => {
    const state = makeState("\ny = 5\nr = (y + 1)(2)\n");
    advanceOrFail(state, createScriptServices(state));
  });
  equal(indirect.code, "callable.not-callable");
  equal(indirect.line, 3);

  // A plain-name call to a name that holds a non-callable is the legacy failure,
  // so a 3.1 program's errors do not change (R-35, FUN-8).
  const named = errorOf(() => {
    const state = makeState("y = 5\nr = y(2)\n");
    advanceOrFail(state, createScriptServices(state));
  });
  equal(named.code, "unknown.command");
  equal(named.message.includes('"y"'), true);
});

test("a callable called with the wrong number of arguments is a located arity failure", () => {
  const state = makeState("f = (a, b) => a + b\nr = f(1)\n");
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
  equal(error.code, "callable.arity");
  equal(error.line, 2);
  equal(error.message.includes("takes 2 argument(s), got 1"), true);
});
test("a bound class-method tear-off keeps overload dispatch and the original object through a dictionary", () => {
  const state = runOnce(`
class Base {
public:
  var value
  method read() { return this->value }
  method read(extra) { return this->value + extra }
}
class Derived : Base {
public:
  method read(extra) { return this->value + extra * 10 }
}
item = Derived()
item.value = 2
callbacks = { read: item.read }
reader = callbacks.read
noArg = reader()
withArg = reader(3)
`);

  equal(state.vm.globals.noarg, 2);
  equal(state.vm.globals.witharg, 32);
  const reader = state.vm.globals.reader;
  if (reader === null || typeof reader !== "object" || !("type" in reader) || reader.type !== "callable") {
    throw new Error("expected a bound callable");
  }
  equal(reader.def, "@class-method:read");
  equal(reader.receiver !== null, true);
  equal(reader.captures.length, 0);
});
test("a bound class-method tear-off still rejects arities not declared by the overload set", () => {
  const state = makeState(`
class Matcher {
public:
  method close(expected) { return expected }
  method close(expected, tolerance) { return expected + tolerance }
}
matcher = Matcher()
close = matcher.close
close(1, 2, 3)
`);
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
  equal(error.code, "callable.arity");
  equal(error.message.includes("takes 1 or 2 argument(s), got 3"), true);
});

test("class-method tear-offs preserve private access checks and dictionary callable receivers", () => {
  const allowed = runOnce(`
class Guarded {
private:
  method reveal() { return 9 }
public:
  method borrow() { return this->reveal }
}
item = Guarded()
inside = item.borrow()
insideValue = inside()
`);
  equal(allowed.vm.globals.insidevalue, 9);

  const state = makeState(`
class Guarded {
private:
  method reveal() { return 9 }
}
item = Guarded()
outside = item.reveal
outside()
`);
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
  equal(error.code, "object.inaccessible-member");
  // The read is the access (R3-Q1, OOP-11): the outside tear-off fails on the
  // line that reads it, not on the later call of a handle it never got.
  equal(error.line, 7);

  const dictionary = runOnce(`
values = { value: 7, read: () => this->value }
read = values.read
dictionaryValue = read()
`);
  equal(dictionary.vm.globals.dictionaryvalue, 7);
});

test("a bound class-method tear-off survives snapshot restore with its receiver", () => {
  const state = makeState(`
class Counter {
public:
  var value
  method read() { return this->value }
}
counter = Counter()
counter.value = 4
callbacks = { read: counter.read }
sleep(1)
result = callbacks.read()
`);
  const services = createScriptServices(state);
  advanceScriptTick(state, services);

  const restored = restoreGameState(snapshot(state));
  runToRest(restored, createScriptServices(restored));
  equal(restored.vm.globals.result, 4);
});

test("a handle whose definition is in no compiled program fails, not silently", () => {
  const state = makeState("r = alien(1)\n");
  state.vm.globals.alien = { type: "callable", def: "nowhere.prg#lambda_9", captures: [], receiver: null };
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
  equal(error.code, "callable.unknown-def");
  equal(error.line, 1);
});

test("a handle whose captured-cell count disagrees with its definition fails, not silently", () => {
  const state = makeState("x = 3\nf = (y) => y + x\nsleep(1)\nr = f(4)\n");
  const services = createScriptServices(state);
  advanceScriptTick(state, services);

  // The forged handle claims the lambda captured nothing, as a save from a
  // different build of the same source would.
  state.vm.globals.f = { type: "callable", def: "<inline>#lambda_1", captures: [], receiver: null };
  const error = errorOf(() => runToRest(state, services));
  equal(error.code, "callable.unknown-def");
  equal(error.message.includes("captures 1 name(s)"), true);
});

test("a callable is truthy and prints as [Function: <def>] (FUN-8)", () => {
  const state = runOnce('f = (x) => x\nok = 0\nif (f) { ok = 1 }\ntext = "" + f\n');

  equal(state.vm.globals.ok, 1);
  equal(state.vm.globals.text, "[Function: <inline>#lambda_1]");
});

test("an indirect call binds a by-reference parameter to the caller's variable (FUN-1)", () => {
  const state = runOnce("f = (&v) => { v = 99 }\nn = 1\nf(n)\n");

  equal(state.vm.globals.n, 99);
});

test("a handle that names a command runs that command (FUN-8)", () => {
  const state = makeState("r = pause(1)\n");
  state.vm.globals.pause = { type: "callable", def: "sleep", captures: [], receiver: null };
  const services = createScriptServices(state);
  advanceScriptTick(state, services);

  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  deepEqual(thread.wait, { kind: "sleep", global: true, until: 1, resumesCall: true });
});

test("a callable made in one program is callable from the program a run() starts", () => {
  const loader = loaderOf({
    "main.prg": 'f = (x) => x * 2\nrun("b.prg")\n',
    "b.prg": "r = f(3)\n",
  });
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, fileProgramRef(loader, "main.prg"));
  // `run()` yields its turn, so the program it starts runs on the next tick.
  runToRest(state, createScriptServices(state, [], undefined, undefined, loader));

  equal(state.vm.globals.r, 6);
  deepEqual(state.vm.globals.f, {
    type: "callable",
    def: "prg/main.prg#lambda_1",
    captures: [],
    receiver: null,
  });
});

test("a state holding closures is plain data and round-trips (G1, G3)", () => {
  const program = "function make(x) {\n  return (y) => y + x\n}\nf = make(4)\nr = f(1)\n";
  const state = runOnce(program);
  const json = snapshot(state);
  const restored = restoreGameState(json);

  equal(canon(restored), json);
  deepEqual(restored.vm.cells, { cell1: 4 });
  deepEqual(restored.vm.globals.f, {
    type: "callable",
    def: "<inline>#lambda_1",
    captures: ["cell1"],
    receiver: null,
  });

  // Two runs of the same program produce the same cells and the same canonical state.
  const second = runOnce(program);
  deepEqual(second.vm.cells, { cell1: 4 });
  equal(canon(second), canon(state));
});
