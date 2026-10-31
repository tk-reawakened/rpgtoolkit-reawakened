// The environment table and shared cells (FUN-8; ADR 0004 decision 8; entry
// 18.5): a callable stored under a command's name intercepts it, `bindingOf`
// reaches what the name ran before so wrappers chain and stack, a plain value
// never reassigns (R-35 unchanged), `#redirect` stays a parse-time substitution,
// and a captured local's cell is shared with the frame that made the closure.
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
  type BuiltinSpec,
  type GameState,
  type ProgramLoader,
  type ResolvedPlugin,
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

/** Run the main thread's one tick and return the state, failing on any diagnostic. */
function runOnce(program: string, plugins: readonly ResolvedPlugin[] = []): GameState {
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state, plugins));
  return state;
}

/** Advance until the main thread finishes, or `limit` ticks have passed. */
function runToRest(state: GameState, services: ScriptServices, limit = 30): void {
  for (let ticks = 0; state.vm.threads[0]!.status !== "finished" && ticks < limit; ticks += 1) {
    advanceOrFail(state, services);
  }
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

function pack(id: string, commands: readonly BuiltinSpec[]): ResolvedPlugin {
  return { definition: { id, version: "1.0.0", commands } };
}

// --- Legacy compatibility: only a callable reassigns a name (R-35) ---------------------------

test("assigning a number or text to a command's name never reassigns it (R-35 unchanged)", () => {
  const state = runOnce('castint = 99\na = castint(4.75)\nb = castint\ncastint = "text"\nc = castint(4.75)\n');

  equal(state.vm.globals.a, 4, "the command still answers the call");
  equal(state.vm.globals.b, 99, "a read of the name is the variable, never the command");
  equal(state.vm.globals.c, 4);
  equal(state.vm.globals.castint, "text");
});

test("a read of a command's name is the unset variable, never a handle", () => {
  const state = runOnce("v = castint\nw = random\n");

  equal(state.vm.globals.v, 0);
  equal(state.vm.globals.w, 0);
  equal(state.vm.cells, undefined);
});

test("a plain-name call of a name that holds a non-callable and is no command is still unknown.command", () => {
  const state = makeState("y = 5\nr = y(2)\n");
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));
  equal(error.code, "unknown.command");
});

// --- Interception ------------------------------------------------------------------------

test("a callable stored under a command's name intercepts every later call of it (FUN-8)", () => {
  const state = runOnce("before = castint(4.75)\ncastint = (x) => 100\nafter = castint(4.75)\n");

  equal(state.vm.globals.before, 4);
  equal(state.vm.globals.after, 100);
});

test("storing a non-callable under an intercepted name, or killing it, ends the interception", () => {
  const state = runOnce(`
castint = (x) => 100
a = castint(4.75)
castint = 0
b = castint(4.75)
castint = (x) => 200
c = castint(4.75)
kill(castint)
d = castint(4.75)
`);

  equal(state.vm.globals.a, 100);
  equal(state.vm.globals.b, 4);
  equal(state.vm.globals.c, 200);
  equal(state.vm.globals.d, 4);
});

test("interception takes a script function's name too, ahead of the function", () => {
  const state = runOnce(`
function greet(who) { return "hi " + who }
a = greet("a")
greet = (who) => "yo " + who
b = greet("b")
`);

  equal(state.vm.globals.a, "hi a");
  equal(state.vm.globals.b, "yo b");
});

test("a local binding intercepts from its own frame only; a callee and a hiding local see the engine", () => {
  const state = runOnce(`
function inner() { return castint(4.75) }
function outer() {
  local(castint)
  castint = (x) => 99
  mine = castint(4.75)
  theirs = inner()
  return 0
}
outer()
castint = (x) => 7
function hides() {
  local(castint)
  castint = 5
  return castint(4.75)
}
hidden = hides()
global = castint(4.75)
`);

  equal(state.vm.globals.mine, 99, "the frame that holds the binding is intercepted");
  equal(state.vm.globals.theirs, 4, "a function it calls does not see its caller's locals");
  equal(state.vm.globals.hidden, 4, "a local that holds a non-callable hides the callable global");
  equal(state.vm.globals.global, 7, "the global binding is reached from the frame with no local of that name");
});

test("a call is intercepted by the name written at the call site, under the redirect already applied", () => {
  const state = runOnce(`
redirect("mine", "castint")
a = mine(4.75)
castint = (x) => 100
b = mine(4.75)
mine = (x) => 5
c = mine(4.75)
`);

  equal(state.vm.globals.a, 4, "a 3.1 redirect still reaches the command");
  equal(state.vm.globals.b, 100, "the substituted name is looked up under its new spelling");
  equal(state.vm.globals.c, 100, "the redirected spelling is gone from the program text, so storing under it does nothing");
});

// --- bindingOf: wrappers reach and chain to what they replaced ------------------------------

test("a wrapper reaches the engine command it replaced through bindingOf (FUN-8)", () => {
  const state = runOnce(`
function wrap() {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + 1000
}
wrap()
r = castint(4.75)
`);

  equal(state.vm.globals.r, 1004);
  equal(state.vm.globals.original, undefined, "the wrapper's saved original is a captured local, not a global");
  deepEqual(state.vm.cells, { cell1: { type: "callable", def: "castint", captures: [], receiver: null } });
});

test("wrappers stack: each bindingOf answers with the binding in force, so every layer runs", () => {
  const state = runOnce(`
function wrapAdd(n) {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + n
}
wrapAdd(1000)
wrapAdd(20)
r = castint(4.75)
`);

  equal(state.vm.globals.r, 1024, "4 from the engine, plus 1000, plus 20");
  equal(Object.keys(state.vm.cells ?? {}).length, 4, "each wrapper's `original` and `n` have a cell of their own");
});

test("a handle bindingOf made keeps running the binding it named after the name is reassigned", () => {
  const state = runOnce(`
old = bindingOf("castint")
castint = (x) => 7
a = old(4.75)
b = castint(4.75)
`);

  equal(state.vm.globals.a, 4);
  equal(state.vm.globals.b, 7);
});

test("bindingOf answers with the scope's own callable when there is one, and with a script function otherwise", () => {
  const state = runOnce(`
function greet(who) { return "hi " + who }
fromFunction = bindingOf("greet")
greet = (who) => "yo " + who
fromScope = bindingOf("GREET")
a = fromFunction("a")
b = fromScope("b")
`);

  equal(state.vm.globals.a, "hi a");
  equal(state.vm.globals.b, "yo b", "the name folds and the scope's callable is answered");
  deepEqual(state.vm.globals.fromfunction, { type: "callable", def: "greet", captures: [], receiver: null });
  deepEqual(state.vm.globals.fromscope, state.vm.globals.greet);
});

test("bindingOf of a name nothing binds, or of a non-string, is a located catchable failure", () => {
  const unknown = makeState('x = 1\nh = bindingOf("nothingbindsthis")\n');
  const missing = errorOf(() => advanceOrFail(unknown, createScriptServices(unknown)));
  equal(missing.code, "unknown.command");
  equal(missing.line, 2);
  equal(missing.message.includes("nothingbindsthis"), true);

  const number = makeState("h = bindingOf(5)\n");
  equal(errorOf(() => advanceOrFail(number, createScriptServices(number))).code, "builtin.bad-arg");

  const arity = makeState('h = bindingOf("castint", 1)\n');
  equal(errorOf(() => advanceOrFail(arity, createScriptServices(arity))).code, "arity.mismatch");
});

test("a handle to an engine command with the wrong number of arguments fails as the command does", () => {
  const state = makeState('old = bindingOf("castint")\nr = old()\n');
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));

  equal(error.code, "arity.mismatch");
  equal(error.line, 2);
});

test("a handle to a script function with the wrong number of arguments raises the callable arity error", () => {
  const state = makeState("function greet(who) { return who }\nold = bindingOf(\"greet\")\nr = old()\n");
  const error = errorOf(() => advanceOrFail(state, createScriptServices(state)));

  equal(error.code, "callable.arity");
  equal(error.line, 3);
});

test("a file-qualified call never asks the scope: it reaches that file's own definition", () => {
  const loader = loaderOf({
    "main.prg": "castint = (x) => 99\na = castint(4.75)\nb = other.castint(4.75)\n",
    "other.prg": "function castint(x) { return 50 }\n",
  });
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, fileProgramRef(loader, "main.prg"));
  runToRest(state, createScriptServices(state, [], undefined, undefined, loader));

  equal(state.vm.globals.a, 99, "the unqualified call is intercepted");
  equal(state.vm.globals.b, 50, "the qualified call is not");
});

test("a dictionary callable wins over the same-named file, while no binding keeps file-qualified semantics", () => {
  const loader = loaderOf({
    "object-main.prg": "d = { f: () => 7 }\nobjectResult = d.f()\n",
    "file-main.prg": "fileResult = d.f()\n",
    "d.prg": "function f() { return 50 }\n",
  });
  const objectState = createGameState({ seed: 0 });
  startProgram(objectState.vm, fileProgramRef(loader, "object-main.prg"));
  const objectServices = createScriptServices(objectState, [], undefined, undefined, loader);
  runToRest(objectState, objectServices);
  equal(objectState.vm.globals.objectresult, 7);

  const fileState = createGameState({ seed: 0 });
  startProgram(fileState.vm, fileProgramRef(loader, "file-main.prg"));
  const fileServices = createScriptServices(fileState, [], undefined, undefined, loader);
  runToRest(fileState, fileServices);
  equal(fileState.vm.globals.fileresult, 50);
});

test("a plugin's command is wrapped the same way, through the extension entry", () => {
  const say: BuiltinSpec = {
    name: "say",
    aliases: [],
    params: [{ name: "text", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [{ kind: "state-write", args: [String(args[0]!.value)] }] }),
  };
  const state = runOnce(
    `
function wrap() {
  local(original)
  original = bindingOf("say")
  say = (text) => original("[" + text + "]")
}
say("a")
wrap()
say("b")
`,
    [pack("test.say", [say])],
  );

  deepEqual(
    state.vm.effects.map((effect) => [effect.name, effect.args]),
    [["say", ["a"]], ["say", ["[b]"]]],
    "the log names the command the handle ran, and the wrapper's changed text reaches it",
  );
});

test("a wrapper over a waiting command parks the thread and resumes it where the original left off", () => {
  const state = makeState(`
function wrap() {
  local(original)
  original = bindingOf("sleep")
  sleep = (ticks) => { original(ticks + 1); return 0 }
}
wrap()
sleep(2)
after = 1
`);
  const services = createScriptServices(state);

  advanceOrFail(state, services);
  const thread = state.vm.threads[0]!;
  equal(thread.status, "waiting");
  deepEqual(thread.wait, { kind: "sleep", global: true, until: 3, resumesCall: true });
  equal(thread.frames.length, 2, "the wrapper's frame is parked on the original's wait");
  equal(state.vm.globals.after, undefined);

  runToRest(state, services);
  equal(state.vm.globals.after, 1);
});

// --- Shared cells -------------------------------------------------------------------------

test("an assignment the creating frame makes after the closure exists is visible inside it (FUN-8)", () => {
  const state = runOnce(`
function make() {
  local(n)
  n = 1
  f = () => n
  n = 2
  return 0
}
make()
r = f()
`);

  equal(state.vm.globals.r, 2);
  equal(state.vm.globals.n, undefined);
  deepEqual(state.vm.cells, { cell1: 2 });
});

test("an assignment the closure makes is visible in the creating frame (FUN-8)", () => {
  const state = runOnce(`
function make() {
  local(n)
  n = 1
  bump = () => { n = n + 10; return n }
  bump()
  return n
}
r = make()
`);

  equal(state.vm.globals.r, 11);
});

test("closures built by one frame for one name share one cell; separate frames never do", () => {
  const state = runOnce(`
function counter() {
  local(c)
  c = 0
  inc = () => { c = c + 1; return c }
  get = () => c
  return 0
}
counter()
inc()
inc()
r = get()
function make() {
  local(k)
  k = 0
  return () => { k = k + 1; return k }
}
a = make()
b = make()
a1 = a()
a2 = a()
b1 = b()
`);

  equal(state.vm.globals.r, 2, "inc and get read and write the same cell");
  equal(state.vm.globals.a1, 1);
  equal(state.vm.globals.a2, 2);
  equal(state.vm.globals.b1, 1, "a second run of the same code has a cell of its own");
  equal(Object.keys(state.vm.cells ?? {}).length, 3);
});

test("a nested closure shares the enclosing lambda's cell, so the lambda's later writes reach it", () => {
  const state = runOnce(`
make = (a) => {
  inc = () => { a = a + 1; return a }
  a = 10
  return inc
}
f = make(1)
r = f()
`);

  equal(state.vm.globals.r, 11);
});

test("a by-reference parameter is captured by value: the alias and the cell then diverge", () => {
  const state = runOnce(`
function make(&v) {
  g = () => { v = v + 1; return v }
  v = 100
  return 0
}
x = 5
make(x)
r = g()
`);

  equal(state.vm.globals.x, 100, "the frame's alias still writes the caller's variable");
  equal(state.vm.globals.r, 6, "the closure counts on its own copy of the value it captured");
});

test("a closure can call a local callable of its creating function by name (FUN-8)", () => {
  const state = runOnce(`
function make() {
  local(add)
  add = (a, b) => a + b
  return (x) => add(x, 1)
}
f = make()
r = f(41)
`);

  equal(state.vm.globals.r, 42);
  equal(state.vm.globals.add, undefined);
});

test("a recursive local lambda finds itself through its own cell", () => {
  const state = runOnce(`
function make() {
  local(fact)
  fact = (n) => { if (n < 2) { return 1 } return n * fact(n - 1) }
  return fact(5)
}
r = make()
`);

  equal(state.vm.globals.r, 120);
});

test("a captured name's plain-name call is a capture site; a file-qualified call and a parameter are not", () => {
  const state = makeState("f = (a) => g(a) + x + other.h(a) + a\n");
  const services = createScriptServices(state);
  const program = services.programs.get(state.vm.threads[0]!.frames[0]!.program);

  deepEqual(program.functions["<inline>#lambda_1"]![0]!.captures, ["g", "x"]);
});

test("a frame with a captured local, parked mid-run, round-trips through a snapshot and finishes the same", () => {
  const program = `
function make() {
  local(n)
  n = 1
  f = () => n
  sleep(2)
  n = 2
  return 0
}
make()
r = f()
`;
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state));
  const frame = state.vm.threads[0]!.frames[1]!;
  equal(frame.locals.n!.ref, "cell:cell1", "the frame's slot is redirected to the closure's cell");

  const restored = restoreGameState(snapshot(state));
  equal(canon(restored), canon(state));
  runToRest(restored, createScriptServices(restored));
  runToRest(state, createScriptServices(state));

  equal(state.vm.globals.r, 2);
  equal(restored.vm.globals.r, 2);
  equal(canon(restored), canon(state));
});

test("two runs of the same program produce the same cells and the same canonical state (G1, G3)", () => {
  const program = `
function wrap() {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + 1
}
wrap()
r = castint(4.75)
`;
  const first = runOnce(program);
  const second = runOnce(program);

  equal(first.vm.globals.r, 5);
  equal(canon(first), canon(second));
  equal(canon(restoreGameState(snapshot(first))), canon(first));
});

test("the step budget preempts inside a wrapper chain and resumes it", () => {
  const state = makeState(`
function wrap() {
  local(original)
  original = bindingOf("castint")
  castint = (x) => original(x) + 1
}
wrap()
r = castint(4.75)
`);
  const services = createScriptServices(state);
  let ticks = 0;
  while (state.vm.threads[0]!.status !== "finished" && ticks < 50) {
    advanceScriptTick(state, services, 3);
    ticks += 1;
  }

  equal(state.vm.globals.r, 5);
  equal(state.vm.threads[0]!.status, "finished");
  equal(ticks > 1, true, "a budget of three steps cannot finish the program in one tick");
});
