// Legacy classes on the one object storage (OOP-5, OOP-8, OOP-9, OOP-10, OOP-11, R-34;
// entry 19.5). A class instance and a dictionary are one record shape in one handle
// table; the class is a tag, its declaration is found in the running program, and the
// 3.1 behaviour of OOP-1 to OOP-9 is the one the other class tests pin. These tests
// pin what the cutover itself decides: the saved shape and its validation, the fields
// an instance holds, which class dispatch uses, the one call path, `kill` of a field,
// and what keeps an object (and a callable's receiver) alive across a save.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createGameState,
  hashState,
  isDictionary,
  objectKeys,
  restoreGameState,
  snapshot,
  startProgram,
  verifyRestoredHandles,
  type GameState,
  type ScriptError,
  type ScriptServices,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function makeState(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, compiler: "2" });
  return state;
}

function runOnce(program: string): GameState {
  const state = makeState(program);
  advanceOrFail(state, createScriptServices(state));
  return state;
}

function errorOf(program: string): ScriptError {
  try {
    runOnce(program);
  } catch (error) {
    return error as ScriptError;
  }
  throw new Error("expected the program to fail");
}

function runToRest(state: GameState, services: ScriptServices, limit = 60): void {
  const finished = (): boolean => state.vm.threads.every((thread) => thread.status === "finished");
  for (let ticks = 0; !finished() && ticks < limit; ticks += 1) advanceOrFail(state, services);
  equal(finished(), true, "the program finished within the tick limit");
}

/** Load a save the way a host does: the shape check, then the program-aware handle check. */
function restoreChecked(json: string): { state: GameState; services: ScriptServices } {
  const state = restoreGameState(json);
  const services = createScriptServices(state);
  verifyRestoredHandles(state.vm, services);
  return { state, services };
}

function rawRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected a JSON object");
  return value as Record<string, unknown>;
}

function rawArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected a JSON array");
  return value;
}

function refusal(json: string, change: (objects: Array<Record<string, unknown>>) => void): string {
  const raw = rawRecord(JSON.parse(json));
  const vm = rawRecord(raw.vm);
  change(rawArray(vm.objects).map(rawRecord));
  try {
    restoreGameState(JSON.stringify(raw));
  } catch (error) {
    equal((error as ScriptError).code, "restore.shape");
    return (error as Error).message;
  }
  throw new Error("expected the restore to throw");
}

function restoreShapeRefusal(json: string, change: (vm: Record<string, unknown>) => void): string {
  const raw = rawRecord(JSON.parse(json));
  change(rawRecord(raw.vm));
  try {
    restoreGameState(JSON.stringify(raw));
  } catch (error) {
    equal((error as ScriptError).code, "restore.shape");
    return (error as Error).message;
  }
  throw new Error("expected the restore to throw");
}

// --- One record shape ---------------------------------------------------------------------

const HIERARCHY = `
class Base {
  public:
  var shared
  var slots[2]
  var grow[]
}
class Mid : Base {
  public:
  var midField
  var shared
}
class Leaf : Mid {
  private:
  var leafField
  public:
  method Leaf() { shared = 5 }
}
x = Leaf()
d = { k: 1 }
`;

test("a class instance holds every declared field of its class and ancestors, in one enumeration order (OOP-10)", () => {
  const state = runOnce(HIERARCHY);
  const [instance, dictionary] = state.vm.objects;
  equal(instance!.className, "leaf");
  deepEqual(instance!.program, { kind: "inline", text: HIERARCHY, compiler: "2" });
  deepEqual(
    objectKeys(instance!),
    ["leaffield", "midfield", "shared", "slots[0]", "slots[1]", "grow"],
    "own fields first, then each ancestor in the walk order; a field two classes declare is one member",
  );
  deepEqual(instance!.members, { leaffield: 0, midfield: 0, shared: 5, "slots[0]": 0, "slots[1]": 0, grow: 0 });
  equal(isDictionary(dictionary!), true);
  equal(dictionary!.program, null);
  deepEqual(objectKeys(dictionary!), ["k"]);
});

test("a class instance and a dictionary are the same record shape in the same handle table", () => {
  const state = runOnce(HIERARCHY);
  const [instance, dictionary] = state.vm.objects;
  deepEqual(Object.keys(instance!).sort(), Object.keys(dictionary!).sort());
  deepEqual([instance!.handle, dictionary!.handle], [1, 2]);
});

test("a write to a declared field keeps its place and a write to a new element appends (OOP-10)", () => {
  const state = runOnce(`${HIERARCHY}
x->shared = 8
x->slots[1] = 4
`);
  const [instance] = state.vm.objects;
  deepEqual(objectKeys(instance!), ["leaffield", "midfield", "shared", "slots[0]", "slots[1]", "grow"]);
  equal(instance!.members.shared, 8);
  equal(instance!.members["slots[1]"], 4);
});

test("a class instance round-trips through a save with equal hashes and the same keys (G1)", () => {
  const state = runOnce(HIERARCHY);
  const { state: restored } = restoreChecked(snapshot(state));
  equal(hashState(restored), hashState(state));
  deepEqual(restored.vm.objects, state.vm.objects);
});

// --- Dispatch uses the object's class; access uses the running method's class -------------

test("`this` inside an inherited method dispatches operators on the object's own class (OOP-8, OOP-10)", () => {
  const state = runOnce(`
class A {
  public:
  var v
  method A(n) { v = n }
  method sum(o) { return this + o }
  method self() { return this }
  method operator+(r) { return 100 }
}
class C : A {
  public:
  method C(n) { v = n }
  method operator+(r) { return 7 }
}
c = C(1)
d = C(2)
r = c->sum(d)
me = c->self()
direct = c + d
`);
  equal(state.vm.globals.r, 7, "C's operator+ answers, not the operator+ of the class that defined sum");
  equal(state.vm.globals.direct, 7);
  deepEqual(state.vm.globals.me, { kind: "object", handle: 1, className: "c" }, "`this` names the object's own class");
});

test("a bare call and a bare field name inside a method find the object's own class, not the defining class (OOP-6, OOP-8, OOP-10)", () => {
  const state = runOnce(`
class Base {
  public:
  method step() { return 1 }
  method run() { return step() }
  method viaThis() { return this->step() }
  method writeKid() { kf = 9 }
  method readKid() { return kf }
}
class Kid : Base {
  public:
  var kf
  method step() { return 2 }
}
base = Base()
kid = Kid()
kr = kid->run()
kt = kid->viaThis()
kid->writeKid()
kw = kid->readKid()
br = base->run()
`);
  equal(state.vm.globals.kr, 2, "a bare step() reaches the override, as this->step() does");
  equal(state.vm.globals.kt, 2);
  equal(state.vm.globals.kw, 9, "a name only the object's class declares is that field");
  equal(state.vm.objects.find((record) => record.className === "kid")!.members.kf, 9);
  equal(state.vm.globals.kf, undefined, "and not a global");
  equal(state.vm.globals.br, 1, "an object of the defining class still reaches its own method");
});

test("access still starts from the class of the running method: a base method cannot reach a private field through this-> on a derived object", () => {
  // Preserved, pre-existing OOP-9 behaviour (entry 19.5 does not change access): the field check compares the running
  // method's class with the object's class. A bare name is not an access check, so it still reads the field.
  const bare = runOnce(`
class Base { private: var secret; public: method Base() { secret = 5 } method peek() { return secret } }
class Kid : Base { public: method Kid() { secret = 6 } }
k = Kid()
r = k->peek()
`);
  equal(bare.vm.globals.r, 6);
  equal(
    errorOf(`
class Base { private: var secret; public: method Base() { secret = 5 } method peek() { return this->secret } }
class Kid : Base { public: method Kid() { secret = 6 } }
k = Kid()
r = k->peek()
`).code,
    "object.inaccessible-member",
  );
});

test("the dot-call qualifier is found like any bare name: a field of the running object, else a local or a global (a parameter first, below)", () => {
  const state = runOnce(`
class Engine {
  public:
  var power
  method Engine(p) { power = p }
  method get() { return power }
}
class Car {
  public:
  var eng
  method Car() { eng = Engine(5) }
  method viaDot() { return eng.get() }
  method viaArrow() { return eng->get() }
}
eng = Engine(7)
c = Car()
dot = c->viaDot()
arrow = c->viaArrow()
outside = eng.get()
`);
  equal(state.vm.globals.dot, 5, "the field, not the global of the same name");
  equal(state.vm.globals.arrow, 5);
  equal(state.vm.globals.outside, 7, "outside any method the qualifier is the global");
  equal(state.vm.globals.arrow, state.vm.globals.dot, "eng.get() reaches the same eng as eng->get()");
});

test("a parameter of an inherited method shadows a field only the object's class declares: value, by-reference, closure, qualifier and index (OOP-6)", () => {
  const state = runOnce(`
class Part {
  public:
  var n
  method Part(v) { n = v }
  method get() { return n }
}
class Base {
  public:
  method run(x) { return x }
  method inc(&x) { x = x + 1 }
  method write(x) { x = 99; return x }
  method close(x) { f = () => { x = x + 1; return x }; f(); return x }
  method viaDot(eng) { return eng.get() }
  method viaArrow(eng) { return eng->get() }
  method indexed(x) { x[1] = 5; return x[1] }
}
class Kid : Base {
  public:
  var x
  var eng
  method Kid() { x = 5; eng = Part(8) }
}
k = Kid()
v = 10
byValue = k->run(42)
k->inc(v)
written = k->write(1)
closed = k->close(10)
viaDot = k->viaDot(Part(3))
viaArrow = k->viaArrow(Part(3))
indexed = k->indexed(0)
`);
  const kid = state.vm.objects.find((record) => record.className === "kid")!;
  equal(state.vm.globals.byvalue, 42, "the parameter, not the field x");
  equal(state.vm.globals.v, 11, "a by-reference parameter writes the caller's variable");
  equal(state.vm.globals.written, 99);
  equal(state.vm.globals.closed, 11, "a parameter a closure captures");
  equal(state.vm.globals.viadot, 3, "the qualifier is the parameter eng, not the field eng");
  equal(state.vm.globals.viaarrow, 3);
  equal(state.vm.globals.indexed, 5);
  equal(kid.members.x, 5, "no parameter write reached the field");
  equal(Object.hasOwn(kid.members, "x[1]"), false, "and no element landed on the object");
});

test("a parameter shadows a field of the same name in the class that declares both; a field still comes before a local (OOP-6)", () => {
  const state = runOnce(`
class A {
  public:
  var v
  method A() { v = 3 }
  method read(v) { return v }
  method bump(v) { v = v + 1; return v }
  method viaLocal() { local(v); v = 4; return v }
}
a = A()
read = a->read(7)
bumped = a->bump(10)
afterBump = a->viaLocal()
`);
  equal(state.vm.globals.read, 7, "the parameter, not the field");
  equal(state.vm.globals.bumped, 11);
  equal(state.vm.globals.afterbump, 4, "a local declared with a field's name does not hide the field");
  equal(state.vm.objects[0]!.members.v, 4, "the write after local(v) reached the field");
});

test("an operator compared on a released object's handle falls back to the handle comparison", () => {
  const state = runOnce(`
class A { public: var x }
a = A()
b = a
a->release()
same = a == b
other = a ~= b
`);
  equal(state.vm.globals.same, 1);
  equal(state.vm.globals.other, 0);
});

test("a private member is reachable from a method of its own class and not from outside (OOP-9)", () => {
  const inside = runOnce(`
class A {
  private:
  var secret
  method A() { secret = 4 }
  public:
  method reveal() { return secret }
}
a = A()
r = a->reveal()
`);
  equal(inside.vm.globals.r, 4);
  equal(errorOf("class A { private: var s; method A() { s = 1 } }\na = A()\nr = a.s\n").code, "object.inaccessible-member");
  equal(errorOf("class A { public: var s }\na = A()\nr = a.nothing\n").code, "object.invalid");
});

// --- One call path ------------------------------------------------------------------------

test("obj.name(args) is the call obj->name(args): the method runs, by-reference arguments included (OOP-10, EXP-7)", () => {
  const state = runOnce(`
class A {
  public:
  var v
  method A(n) { v = n }
  method get() { return v }
  method add(k, &out) { out = v + k }
}
a = A(5)
viaDot = a.get()
viaArrow = a->get()
a.add(3, sum)
box = { inner: a }
nested = box.inner.get()
`);
  equal(state.vm.globals.viadot, 5);
  equal(state.vm.globals.viaarrow, 5);
  equal(state.vm.globals.sum, 8);
  equal(state.vm.globals.nested, 5);
});

test("a.release() releases a class instance like a->release() and runs only its own destructor", () => {
  const state = runOnce(`
class A {
  public:
  var x
  method ~A() { destroyed = 1 }
}
a = A()
a.release()
`);
  equal(state.vm.globals.destroyed, 1);
  equal(state.vm.objects.length, 0);
});

test("a callable stored in a class field is called through the name with the object as its receiver (OOP-11)", () => {
  const state = runOnce(`
class Button {
  public:
  var label
  var onPress
  method Button(t) { label = t }
}
b = Button("go")
b.onPress = () => this.label
viaDot = b.onPress()
viaArrow = b->onPress()
`);
  equal(state.vm.globals.viadot, "go");
  equal(state.vm.globals.viaarrow, "go");
});

test("calling a member that is neither a method nor a callable is a located, catchable error", () => {
  equal(errorOf("class A { public: var x }\na = A()\na.x()\n").code, "callable.not-callable");
  equal(errorOf("class A { public: var x }\na = A()\na.missing()\n").code, "object.invalid");
  equal(errorOf("class A { private: var cb }\na = A()\na.cb()\n").code, "object.inaccessible-member");
  equal(errorOf("d = { x: 1 }\nd.x()\n").code, "callable.not-callable");
});

// --- kill of a field ----------------------------------------------------------------------

test("kill(obj->field) removes the field from a class instance; it stays declared and re-enters last (KILL-1)", () => {
  const state = runOnce(`
class A {
  public:
  var x
  var y
  method A() { x = 3; y = 4 }
}
a = A()
kill(a->x)
afterKill = a->x
`);
  equal(state.vm.globals.afterkill, 0);
  deepEqual(objectKeys(state.vm.objects[0]!), ["y"]);
  const again = runOnce(`
class A { public: var x; var y; method A() { x = 3; y = 4 } }
a = A()
kill(a->x)
a->x = 9
`);
  deepEqual(objectKeys(again.vm.objects[0]!), ["y", "x"]);
  equal(again.vm.objects[0]!.members.x, 9);
});

// --- What keeps an object, a receiver and a callable's cells alive ------------------------

test("a garbage cycle that holds a callable keeps that callable's receiver, so the save still loads (R-34, OOP-11)", () => {
  const state = runOnce(`
class G { public: var link; var cb }
function build() {
  g = G()
  h = G()
  q = { n: 4, f: () => this.n }
  g.link = h
  h.link = g
  g.cb = q.f
  kill(q)
}
build()
kill(g, h)
`);
  equal(state.vm.objects.length, 3, "the two cycle members and the dictionary their callable remembers");
  const { state: restored, services } = restoreChecked(snapshot(state));
  equal(hashState(restored), hashState(state));
  startProgram(restored.vm, { kind: "inline", text: "r = 1\n", compiler: "2" });
  advanceOrFail(restored, services);
  equal(restored.vm.objects.length, 3, "a restored state collects exactly like the original");
});

test("a callable kept only by a freed holder frees its receiver with it", () => {
  const state = runOnce(`
class G { public: var cb }
function build() {
  g = G()
  q = { n: 4, f: () => this.n }
  g.cb = q.f
  kill(q)
}
build()
kill(g)
`);
  equal(state.vm.objects.length, 0);
});

test("a by-reference parameter into a member keeps the object while the call runs", () => {
  const state = makeState(`
class A { public: var x }
function setLater(&r) {
  kill(a)
  sleep(2)
  r = 5
  sleep(2)
}
a = A()
setLater(a->x)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.objects.length, 1, "the only name left for the object is the reference the call holds");
  runToRest(state, services);
  equal(state.vm.objects.length, 0, "freed once the call has returned and nothing names it");
});

test("a method parked in a wait keeps its object, saves, restores and finishes with an equal hash (G1)", () => {
  const program = `
class Door {
  public:
  var opened
  method run() {
    opened = 1
    kill(door)
    sleep(2)
    opened = opened + 1
  }
}
door = Door()
door->run()
`;
  const state = makeState(program);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.vm.threads[0]!.status, "waiting");
  equal(state.vm.objects.length, 1, "the running method is the only name left for its object");

  const { state: restored, services: restoredServices } = restoreChecked(snapshot(state));
  equal(hashState(restored), hashState(state));
  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(hashState(restored), hashState(state));
  equal(state.vm.objects.length, 0);
});

test("a class instance and a dictionary hold each other across a wait and a restore (one object runtime)", () => {
  const program = `
class Party {
  public:
  var lead
  var bag
  method Party(name) { lead = name; bag = { gold: 10, use: () => this.gold } }
  method spend(n) { bag.gold = bag.gold - n }
}
p = Party("Ada")
p->spend(3)
sleep(2)
p->spend(2)
total = p->bag.use()
`;
  const state = makeState(program);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  const { state: restored, services: restoredServices } = restoreChecked(snapshot(state));
  equal(hashState(restored), hashState(state));
  runToRest(state, services);
  runToRest(restored, restoredServices);
  equal(restored.vm.globals.total, 5);
  equal(state.vm.globals.total, 5);
  equal(hashState(restored), hashState(state));
});

// --- The saved shape is validated, and a missing class is a runtime error ------------------

test("a save with a record that is not the one object shape is refused, naming the place (restore.shape)", () => {
  const json = snapshot(runOnce("class A { public: var x }\na = A()\nd = { k: 1 }\n"));
  const first = (message: string, change: (objects: Array<Record<string, unknown>>) => void): void => {
    equal(refusal(json, change).includes(message), true, message);
  };
  first("vm.objects[0].keys", (objects) => void delete objects[0]!.keys);
  first("vm.objects[0].keys", (objects) => void (objects[0]!.keys = ["x", "x"]));
  first("vm.objects[1].keys", (objects) => void (objects[1]!.keys = []));
  first("vm.objects[0].program", (objects) => void (objects[0]!.program = null));
  first("vm.objects[1].program", (objects) => void (objects[1]!.program = objects[0]!.program));
  first("vm.objects[1].handle", (objects) => void (objects[1]!.handle = objects[0]!.handle));
  first("vm.objects[0].className", (objects) => void delete objects[0]!.className);
});

test("a saved object value must name a live object with its exact class tag", () => {
  const json = snapshot(runOnce("class A { public: var x }\na = A()\n"));
  const dangling = restoreShapeRefusal(json, (vm) => {
    rawRecord(rawRecord(vm.globals).a).handle = 99;
  });
  equal(dangling.includes("vm.globals.a"), true);
  const mismatched = restoreShapeRefusal(json, (vm) => {
    rawRecord(rawRecord(vm.globals).a).className = "other";
  });
  equal(mismatched.includes("vm.globals.a"), true);
});

test("a saved object-member reference and frame receiver must name live objects", () => {
  const state = makeState(`
class A { public: var x }
function setLater(&r) { sleep(2) }
a = A()
setLater(a->x)
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  const json = snapshot(state);
  const danglingReference = restoreShapeRefusal(json, (vm) => {
    const thread = rawRecord(rawArray(vm.threads)[0]);
    const frames = rawArray(thread.frames);
    const locals = rawRecord(rawRecord(frames[1]).locals);
    rawRecord(locals.r).ref = "object:99:x";
  });
  equal(danglingReference.includes(".ref"), true);

  const method = makeState(`
class A { public: method wait() { sleep(2) } }
a = A()
a->wait()
`);
  advanceOrFail(method, createScriptServices(method));
  const danglingReceiver = restoreShapeRefusal(snapshot(method), (vm) => {
    const thread = rawRecord(rawArray(vm.threads)[0]);
    const frames = rawArray(thread.frames);
    rawRecord(frames[1]).objectHandle = 99;
  });
  equal(danglingReceiver.includes(".objectHandle"), true);
});


test("an instance whose class the running program no longer declares is a catchable error and keeps its data", () => {
  const original = runOnce("class A { public: var v; method A(n) { v = n } method get() { return v } }\na = A(7)\n");
  const { state: restored } = restoreChecked(snapshot(original));
  startProgram(restored.vm, { kind: "inline", text: "r = a->get()\n", compiler: "2" });
  const services = createScriptServices(restored);
  let failure: ScriptError | undefined;
  try {
    advanceOrFail(restored, services);
  } catch (error) {
    failure = error as ScriptError;
  }
  equal(failure?.code, "object.invalid");
  equal(restored.vm.objects[0]!.members.v, 7, "the object's data stays");
});
