// Dictionary objects at run time (OOP-10, KILL-1; entry 19.3): a literal makes an
// object in the one handle table, `.`, `->` and `["key"]` are the same read and the
// same write, a missing key reads unset, `kill(obj.key)` removes the key, the
// enumeration order is the order keys were first written and survives a save, and
// an unreachable dictionary goes at the end of the tick with the closures in it.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  canon,
  collectGarbage,
  createGameState,
  hashState,
  isDictionary,
  objectKeys,
  replyToRequest,
  restoreGameState,
  snapshot,
  startProgram,
  verifyRestoredHandles,
  type BuiltinSpec,
  type GameState,
  type ObjectRecord,
  type ResolvedPlugin,
  type ScriptError,
  type ScriptServices,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function ok(condition: unknown, message?: string): asserts condition {
  equal(Boolean(condition), true, message);
}

function makeState(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return state;
}

/** Run the main thread's first tick and return the state, failing on any diagnostic. */
function runOnce(program: string): GameState {
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state));
  return state;
}

function runToRest(state: GameState, services: ScriptServices, limit = 60): void {
  const finished = (): boolean => state.vm.threads.every((thread) => thread.status === "finished");
  for (let ticks = 0; !finished() && ticks < limit; ticks += 1) advanceOrFail(state, services);
  ok(finished(), "the program finished within the tick limit");
}

function errorOf(program: string): ScriptError {
  try {
    runOnce(program);
  } catch (error) {
    return error as ScriptError;
  }
  throw new Error("expected the program to fail");
}

function dictionaries(state: GameState): ObjectRecord[] {
  return state.vm.objects.filter(isDictionary);
}

function only(state: GameState): ObjectRecord {
  const found = dictionaries(state);
  equal(found.length, 1, "exactly one dictionary is alive");
  return found[0]!;
}

function restoreChecked(json: string): { state: GameState; services: ScriptServices } {
  const state = restoreGameState(json);
  const services = createScriptServices(state);
  verifyRestoredHandles(state.vm, services);
  return { state, services };
}

// --- Literals and storage ------------------------------------------------------------------

test("a dictionary literal makes one classless object in the handle table (OOP-10)", () => {
  const state = runOnce('d = { name: "Health Potion", healAmount: 50 }\n');
  const record = only(state);

  equal(record.className, "");
  equal(record.program, null);
  deepEqual(record.members, { name: "Health Potion", healamount: 50 });
  deepEqual(record.keys, ["name", "healamount"], "a bare key is folded like any name (LEX-10)");
  deepEqual(state.vm.globals.d, { kind: "object", handle: record.handle, className: "" });
});

test("a key is a bare identifier or a string; a repeated key keeps the last value and its first place", () => {
  const state = runOnce('d = { a: 1, "two words": 2, a: 3, b: 4 }\n');
  const record = only(state);

  deepEqual(record.members, { a: 3, "two words": 2, b: 4 });
  deepEqual(objectKeys(record), ["a", "two words", "b"]);
});

test("the literal creates its object first, then evaluates the values in the order written (OOP-10)", () => {
  const state = runOnce("d = { inner: { x: 1 }, y: { z: 2 } }\n");
  const handles = state.vm.objects.map((record) => record.handle);

  deepEqual(handles, [1, 2, 3], "outer first, then each nested literal in written order");
  const outer = state.vm.objects[0]!;
  deepEqual(outer.members.inner, { kind: "object", handle: 2, className: "" });
  deepEqual(outer.members.y, { kind: "object", handle: 3, className: "" });
  deepEqual(outer.keys, ["inner", "y"]);
});

test("the empty dictionary and a trailing comma are valid", () => {
  const state = runOnce("a = {}\nb = { k: 1, }\n");
  deepEqual(state.vm.objects.map((record) => record.keys), [[], ["k"]]);
});

// --- Access ------------------------------------------------------------------------------

test("obj.key, obj->key and obj[\"key\"] are the same read and the same write (OOP-10)", () => {
  const state = runOnce(`
d = { hp: 10 }
a = d.hp
b = d->hp
c = d["hp"]
d.hp = 20
e = d->hp
d->hp = 30
f = d["hp"]
d["hp"] = 40
g = d.hp
`);
  deepEqual(
    ["a", "b", "c", "e", "f", "g"].map((name) => state.vm.globals[name]),
    [10, 10, 10, 20, 30, 40],
  );
  deepEqual(only(state).members, { hp: 40 });
});

test("a write to a missing key creates it at the end of the order; a rewrite keeps its place", () => {
  const state = runOnce(`
d = { a: 1, b: 2 }
d.c = 3
d["d"] = 4
d.a = 10
`);
  const record = only(state);
  deepEqual(objectKeys(record), ["a", "b", "c", "d"]);
  deepEqual(record.members, { a: 10, b: 2, c: 3, d: 4 });
});

test("reading a key that is not there gives the unset value and creates nothing", () => {
  const state = runOnce(`
d = { a: 1 }
x = d.missing
y = d["also missing"]
z = d.missing + 5
`);
  equal(state.vm.globals.x, 0);
  equal(state.vm.globals.y, 0);
  equal(state.vm.globals.z, 5);
  deepEqual(objectKeys(only(state)), ["a"]);
});

test("keys that clash with JavaScript names are ordinary data", () => {
  const state = runOnce(`
d = {}
a = d.toString
d["constructor"] = 7
d["__proto__"] = 8
b = d["constructor"]
c = d["__proto__"]
`);
  equal(state.vm.globals.a, 0);
  equal(state.vm.globals.b, 7);
  equal(state.vm.globals.c, 8);
  deepEqual(objectKeys(only(state)), ["constructor", "__proto__"]);
});

test("a numeric index is the key written with six significant digits, like an array index", () => {
  const state = runOnce(`
d = {}
d[1] = "one"
d[2.5] = "two and a half"
a = d["1"]
b = d["2.5"]
`);
  equal(state.vm.globals.a, "one");
  equal(state.vm.globals.b, "two and a half");
  deepEqual(objectKeys(only(state)), ["1", "2.5"]);
});

test("a key written as a bare name is folded like any name; a string key keeps its case", () => {
  const state = runOnce(`
d = { Mixed: 1, "Exact": 2 }
a = d.mixed
b = d["Exact"]
c = d["exact"]
`);
  equal(state.vm.globals.a, 1);
  equal(state.vm.globals.b, 2);
  equal(state.vm.globals.c, 0);
  deepEqual(objectKeys(only(state)), ["mixed", "Exact"]);
});

test("a string index keeps dictionary key case at the object boundary", () => {
  const state = runOnce(`
o = { "Foo": 1 }
exact = o["Foo"]
lower = o["foo"]
`);
  equal(state.vm.globals.exact, 1);
  equal(state.vm.globals.lower, 0);
});

test("nested access reads and updates through every form, and a compound write works", () => {
  const state = runOnce(`
d = { stats: { hp: 10, mp: 4 }, tags: { first: "a" } }
d.stats.hp += 5
d["stats"]["mp"] = d->stats.mp * 2
d.tags["second"] = "b"
a = d.stats.hp
b = d.stats["mp"]
c = d["tags"].second
`);
  equal(state.vm.globals.a, 15);
  equal(state.vm.globals.b, 8);
  equal(state.vm.globals.c, "b");
  const records = state.vm.objects;
  deepEqual(records.map((record) => record.members), [
    { stats: { kind: "object", handle: 2, className: "" }, tags: { kind: "object", handle: 3, className: "" } },
    { hp: 15, mp: 8 },
    { first: "a", second: "b" },
  ]);
});

test("++ and -- work on a member", () => {
  const state = runOnce("d = { n: 1 }\nd.n++\nd->n++\n++d.n\nd[\"n\"]--\nr = d.n\n");
  equal(state.vm.globals.r, 3);
});

test("a dictionary is shared by handle: two variables name one object (OOP-4)", () => {
  const state = runOnce(`
a = { n: 1 }
b = a
b.n = 99
same = (a == b)
other = { n: 99 }
diff = (a == other)
`);
  deepEqual(state.vm.objects.map((record) => record.members), [{ n: 99 }, { n: 99 }]);
  equal(state.vm.globals.same, 1);
  equal(state.vm.globals.diff, 0);
});

test("a dictionary passes through a function and changes made there are seen by the caller", () => {
  const state = runOnce(`
function bump(box) { box.count = box.count + 1 }
d = { count: 0 }
bump(d)
bump(d)
r = d.count
`);
  equal(state.vm.globals.r, 2);
});

test("a dictionary can be a local, and an index on a local dictionary reaches it", () => {
  const state = runOnce(`
function f() {
  local(d)
  d = { k: 5 }
  d["j"] = 6
  return d.k + d["j"]
}
r = f()
`);
  equal(state.vm.globals.r, 11);
});

test("a member can hold a callable, the callable survives, and the dictionary stores it as a value", () => {
  const state = runOnce(`
d = { double: (n) => n * 2 }
fn = d.double
r = fn(21)
`);
  equal(state.vm.globals.r, 42);
  const stored = only(state).members.double;
  deepEqual(stored, { type: "callable", def: "<inline>#lambda_1", captures: [], receiver: null });
});

test("dictionary callable members bind this for direct calls, tear-offs and arrows, while bindThis rebinds a copy", () => {
  const state = runOnce(`
d = { n: 2, f: () => this.n }
direct = d.f()
arrow = d->f()
bracket = d["f"]()
tear = d.f
fromTear = tear()
e = { n: 9 }
rebound = bindThis(tear, e)
fromRebound = rebound()
original = tear()
`);
  deepEqual(
    ["direct", "arrow", "bracket", "fromtear", "fromrebound", "original"].map((name) => state.vm.globals[name]),
    [2, 2, 2, 2, 9, 2],
  );
  const stored = state.vm.objects.find((record) => Object.hasOwn(record.members, "f"))?.members.f;
  deepEqual(stored, { type: "callable", def: "<inline>#lambda_1", captures: [], receiver: null });
});

test("standalone lambda this is null and member access fails as a located catchable error", () => {
  const error = errorOf("f = () => this.n\nr = f()\n");
  equal(error.code, "object.invalid");
  equal(error.pos?.line, 1);
});

test("bindThis rejects a non-callable or non-object with a located catchable error", () => {
  equal(errorOf("d = {}\nr = bindThis(1, d)\n").code, "callable.not-callable");
  const badObject = errorOf("f = () => 1\nr = bindThis(f, 1)\n");
  equal(badObject.code, "object.invalid");
  equal(badObject.pos?.line, 2);
});

test("a bound callable keeps its receiver alive and survives JSON restore", () => {
  const state = runOnce(`
d = { n: 7, f: () => this.n }
f = d.f
kill(d)
`);
  equal(state.vm.objects.length, 1, "the callable is the sole receiver root");
  const saved = snapshot(state);
  const restored = restoreChecked(saved);
  equal(restored.state.vm.objects.length, 1);
  startProgram(restored.state.vm, { kind: "inline", text: "r = f()\n", ir: "1" });
  runToRest(restored.state, restored.services);
  equal(restored.state.vm.globals.r, 7);
});

test("a suspended callable frame keeps its receiver alive through a mid-wait snapshot", () => {
  const state = makeState(`
d = { n: 7, f: () => { kill(d); sleep(2); return this.n } }
r = d.f()
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.threads[0]!.status, "waiting");
  equal(state.vm.objects.length, 1, "the suspended receiver frame is an object root");
  equal(state.vm.threads[0]!.frames.at(-1)?.objectHandle, 1);

  const restored = restoreChecked(snapshot(state));
  runToRest(restored.state, restored.services);
  equal(restored.state.vm.globals.r, 7);
});

test("a callable receiver in a request reply stays alive through collection and restore", () => {
  const ask2: BuiltinSpec = {
    name: "ask2",
    aliases: [],
    params: [],
    call: () => ({ value: null, request: { kind: "asset", name: "reply" } }),
  };
  const plugins: ResolvedPlugin[] = [{ definition: { id: "test.receiver-wait", version: "1.0.0", commands: [ask2] } }];
  const state = makeState(`
d = { n: 7, f: () => this.n }
f = d.f
kill(d)
r = ask2()
result = r()
`);
  const services = createScriptServices(state, plugins);
  advanceOrFail(state, services);
  const request = state.vm.threads[0]!.wait;
  if (request?.kind !== "request") throw new Error("expected a request wait");
  const callable = state.vm.globals.f;
  if (callable === undefined) throw new Error("expected callable global");
  replyToRequest(state.vm, request.reqId, { ok: true, value: callable });
  delete state.vm.globals.f;
  collectGarbage(state.vm);
  equal(state.vm.objects.length, 1, "the reply value is the receiver root");

  const restored = restoreChecked(snapshot(state));
  runToRest(restored.state, restored.services);
  equal(restored.state.vm.globals.result, 7);
});

test("a read of a member of something that is not an object is a located, catchable error", () => {
  const error = errorOf("n = 0\nr = n.field\n");
  equal(error.code, "object.invalid");
  equal(error.pos?.line, 2);
  equal(errorOf('d = { a: 1 }\nd.a.b = 3\n').code, "object.invalid");
});

test("a dictionary key that is neither a string nor a number is refused", () => {
  const error = errorOf("d = { a: 1 }\nk = { }\nr = d[k]\n");
  equal(error.code, "object.invalid");
  equal(error.pos?.line, 3);
});

// --- kill ----------------------------------------------------------------------------------

test("kill(obj.key) and kill(obj[\"key\"]) remove the key; removing then re-adding puts it last (KILL-1)", () => {
  const state = runOnce(`
d = { a: 1, b: 2, c: 3 }
kill(d.a)
kill(d["c"])
kill(d.nothing)
x = d.a
d.a = 9
`);
  const record = only(state);
  deepEqual(record.members, { b: 2, a: 9 });
  deepEqual(objectKeys(record), ["b", "a"]);
  equal(state.vm.globals.x, 0);
});

test("kill removes a nested key and several members in one call, and kill(d) removes only the name", () => {
  const state = runOnce(`
d = { in: { x: 1, y: 2 }, p: 1, q: 2 }
kill(d.in.x, d.p, d["q"])
e = d
kill(d)
`);
  deepEqual(
    state.vm.objects.map((record) => objectKeys(record)),
    [["in"], ["y"]],
  );
  equal(Object.hasOwn(state.vm.globals, "d"), false);
  ok(Object.hasOwn(state.vm.globals, "e"), "the object stays alive through the other name");
});

// --- Collection ----------------------------------------------------------------------------

test("a dictionary nothing names is freed at the end of the tick it became unreachable, with what is nested in it", () => {
  const state = runOnce("d = { inner: { deep: { v: 1 } } }\n");
  equal(state.vm.objects.length, 3, "all three are reachable through d");

  const services = createScriptServices(state);
  startProgram(state.vm, { kind: "inline", text: "kill(d)\n", ir: "1" });
  advanceOrFail(state, services);
  equal(state.vm.objects.length, 0, "dropping the outer drops the chain in the same tick");
});

test("a dictionary only a local named is freed when the frame ends", () => {
  const state = runOnce(`
function f() {
  local(d)
  d = { a: 1 }
  return 0
}
r = f()
`);
  equal(state.vm.objects.length, 0);
});

test("a dictionary holding a closure is freed at once; the closure's cell goes in the next tick's pass (FUN-8)", () => {
  const program = `
function make() {
  local(n)
  n = 0
  return { next: () => { n = n + 1; return n } }
}
d = make()
step = d.next
a = step()
b = step()
`;
  const state = runOnce(program);
  const services = createScriptServices(state);
  equal(state.vm.globals.b, 2);
  deepEqual(state.vm.cells, { cell1: 2 });
  equal(state.vm.objects.length, 1);

  startProgram(state.vm, { kind: "inline", text: "kill(step)\n", ir: "1" });
  advanceOrFail(state, services);
  deepEqual(state.vm.cells, { cell1: 2 }, "the dictionary still holds the closure, so its cell stays");
  startProgram(state.vm, { kind: "inline", text: "kill(d)\n", ir: "1" });
  advanceOrFail(state, services);
  equal(state.vm.objects.length, 0, "the dictionary is freed in the tick it became unreachable");
  deepEqual(state.vm.cells, { cell1: 2 }, "the cell only it reached was still reachable when the cell pass ran");
  advanceOrFail(state, services);
  deepEqual(state.vm.cells ?? {}, {}, "the next tick's pass frees the cell");
  deepEqual(state.vm.defOwners ?? {}, {});
});

test("a dictionary that names itself is never freed (R-34), and one that is named stays", () => {
  const state = runOnce("d = {}\nd.me = d\n");
  startProgram(state.vm, { kind: "inline", text: "kill(d)\n", ir: "1" });
  advanceOrFail(state, createScriptServices(state));
  equal(state.vm.objects.length, 1);
});

// --- Save and restore ----------------------------------------------------------------------

const PARKED = `
function make() {
  local(n)
  n = 10
  return { count: () => { n = n + 1; return n }, meta: { id: 7 } }
}
box = make()
box.extra = "x"
box["2"] = "numeric key"
box.alpha = 5
count = box.count
first = count()
sleep(3)
second = count()
box.alpha += 1
`;

test("a dictionary saved mid-run restores to an equal hash and finishes exactly as the original does", () => {
  const state = makeState(PARKED);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.threads[0]!.status, "waiting");
  deepEqual(objectKeys(state.vm.objects[0]!), ["count", "meta", "extra", "2", "alpha"]);

  const json = snapshot(state);
  const { state: restored, services: restoredServices } = restoreChecked(json);
  equal(canon(restored), json);
  equal(hashState(restored), hashState(state));
  deepEqual(objectKeys(restored.vm.objects[0]!), ["count", "meta", "extra", "2", "alpha"], "the order survives a save");

  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(restored.vm.globals.second, 12, "the lambda stored in a member survives and still owns its cell");
  equal(state.vm.globals.second, 12);
  equal(restored.vm.objects[0]!.members.alpha, 6);
  equal(hashState(restored), hashState(state));
});

test("the save keeps a dictionary's order even though a canonical JSON object does not", () => {
  const state = runOnce('d = {}\nd["2"] = 1\nd.b = 2\nd["1"] = 3\n');
  const { state: restored } = restoreChecked(snapshot(state));
  deepEqual(objectKeys(restored.vm.objects[0]!), ["2", "b", "1"]);
});

function edited(json: string, change: (raw: { vm: { objects: Array<Record<string, unknown>> } }) => void): string {
  const raw = JSON.parse(json);
  change(raw);
  return JSON.stringify(raw);
}

test("a snapshot whose dictionary keys disagree with its members is refused", () => {
  const json = snapshot(runOnce("d = { a: 1, b: 2 }\n"));
  const refuse = (change: (record: Record<string, unknown>) => void): string => {
    try {
      restoreGameState(edited(json, (raw) => change(raw.vm.objects[0]!)));
    } catch (error) {
      return (error as ScriptError).message;
    }
    throw new Error("expected the restore to throw");
  };

  ok(refuse((record) => void (record.keys = ["a"])).includes("vm.objects[0].keys"));
  ok(refuse((record) => void (record.keys = ["a", "a"])).includes("vm.objects[0].keys"));
  ok(refuse((record) => void (record.keys = ["a", "c"])).includes("vm.objects[0].keys"));
});

test("advanceScriptTick on a restored state collects like the original", () => {
  const state = runOnce("d = { a: { b: 1 } }\n");
  const { state: restored } = restoreChecked(snapshot(state));
  startProgram(restored.vm, { kind: "inline", text: "kill(d)\n", ir: "1" });
  advanceScriptTick(restored, createScriptServices(restored));
  equal(restored.vm.objects.length, 0);
});
