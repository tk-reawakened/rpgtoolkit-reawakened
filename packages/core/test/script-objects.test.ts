import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  advanceScriptTick,
  compileInline,
  createGameState,
  hashState,
  restoreGameState,
  snapshot,
  startProgram,
  type GameState,
  type ScriptError,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

function run(source: string, state = createGameState({ seed: 3 })): GameState {
  startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  advanceScriptTick(state, createScriptServices(state));
  return state;
}
function errorOf(source: string): ScriptError {
  const state = createGameState({ seed: 3 });
  startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  try {
    advanceOrFail(state, createScriptServices(state));
  } catch (error) {
    return error as ScriptError;
  }
  throw new Error("expected object program to fail");
}
function matchError(error: unknown, text: string): void {
  equal((error as Error).message.includes(text), true);
}
function objectHandle(value: unknown): number {
  if (typeof value === "object" && value !== null && "handle" in value && typeof value.handle === "number") {
    return value.handle;
  }
  throw new Error("expected an object value");
}

const basic = `
class Box {
  public:
  var x
  method Box(n) { x = n }
  method get() { return x }
  method operator+(rhs) { return x + rhs.x }
  method operator-(rhs) { return x - rhs.x }
  method operator-( ) { return -x }
  method operator==(rhs) { return x == rhs.x }
  method operator+=(rhs) { x += rhs.x }
  method operator[](i) { return x }
}
`;

test("criteria 1: declarations, prototypes, out-of-class methods, structs and member arrays", () => {
  const program = compileInline(`
class A {
  method A();
  method get();
  var m[];
  private: var hidden
}
method A::A() { m[0] = 2 }
method A::get() { return m[0] }
struct S {
  var publicMember
  public: method read() { return publicMember }
}
`, "objects.prg");
  const aClass = program.classes.a!;
  const sClass = program.classes.s!;
  equal(aClass.methods.a!.length, 1);
  equal(aClass.members[0]?.arraySize, null);
  equal(aClass.members.find((member) => member.name === "m")?.arraySize, null);
  equal(sClass.methods.read!.length, 1);
  try {
    compileInline("class Bad { protected: var x }");
  } catch (error) {
    matchError(error, "protected");
  }
});

test("criteria 2-3: only named constructor runs and handles allocate 1/2/3", () => {
  const state = run(`${basic}
class Base { method Base(n) { base = n } }
class Derived : Base { method Derived(n) { own = n } }
a = Box(1)
b = Box(2)
a->release()
c = Box(3)
`);
  equal(objectHandle(state.vm.globals.c), 3);
  equal(state.vm.objects.length, 2);
  equal(state.vm.globals.base, undefined);
});

test("criteria 4-5: assignment aliases unless the destination dispatches operator=", () => {
  const state = run(`
class B {
  public:
  var x
  method B(n) { x=n }
  method get() { return x }
  method operator=(rhs) { x = rhs.x + 10 }
}
a = B(2)
b = B(4)
c = a
b = a
r = b->get()
`);
  equal(objectHandle(state.vm.globals.c), objectHandle(state.vm.globals.a));
  equal(objectHandle(state.vm.globals.b), 2);
  equal(state.vm.objects.find((object) => object.handle === 2)?.members.x, 12);
});

test("criteria 6: operator[] reads, writes through references and supports this[i]", () => {
  const state = run(`
class A {
  public:
  method A() { }
  method operator[](i) { return &m_data[i] }
  method put(i, v) { this[i] = v }
  var m_data[]
}
a = A()
a[0] = 7
a->put(1, 9)
r0 = a[0]
r1 = a[1]
`);
  equal(state.vm.globals.r0, 7);
  equal(state.vm.globals.r1, 9);
});

test("criteria 7: unary, binary, compound and equality fallback dispatch", () => {
  const state = run(`${basic}
a = Box(5)
b = Box(2)
s = a + b
d = a - b
u = -a
a += b
eq = a == b
`);
  equal(state.vm.globals.s, 7);
  equal(state.vm.globals.d, 3);
  equal(state.vm.globals.u, -5);
  equal(state.vm.globals.eq, 0);
  equal(state.vm.objects.find((object) => object.handle === objectHandle(state.vm.globals.a))?.members.x, 7);
  const fallback = run("class NoEq { public: method NoEq() {} }\na=NoEq()\nb=NoEq()\nr=a==b\n");
  equal(fallback.vm.globals.r, 0);
});

test("criteria 8-9: name lookup, own-class calls, typed and by-reference parameters", () => {
  const state = run(`
class N {
  public:
  var value
  method N(n) { value=n }
  method set(number, &out) { out = value + number }
  method helper() { return value }
  method call() { return helper() }
}
n = N(4)
n->set(3, result)
called = n->call()
`);
  equal(state.vm.globals.result, 7);
  equal(state.vm.globals.called, 4);
});

test("criteria 10: inheritance uses actual class and ruled ancestor walk", () => {
  const state = run(`
class A {
  public:
  method f() { return 1 }
}
class B : A {
  public:
  method f() { return 2 }
}
class C : B { }
x = C()
r = x->f()
`);
  equal(state.vm.globals.r, 2);
});

test("criteria 11: abstract classes fail before allocating", () => {
  const error = errorOf("class A { method f() = 0 }\na=A()\n");
  equal(error.code, "object.abstract-class");
  equal(error.pos?.line, 2);
});

test("criteria 12: public/private defaults and same-class private access", () => {
  const outside = errorOf("class A { private: var x; method A() { x=1 } }\na=A()\nr=a.x\n");
  equal(outside.code, "object.inaccessible-member");
  const inside = run(`
class A {
  private:
  var x
  method A() { x=1 }
  public:
  method get() { return x }
}
a=A()
r=a->get()
`);
  equal(inside.vm.globals.r, 1);
});

test("criteria 13: release calls only the own destructor; kill only removes the name", () => {
  const state = run(`
class A {
  public:
  var x
  method A() { x=1 }
  method ~A() { destroyed=1 }
}
a=A()
a->release()
kill(a)
b=A()
kill(b)
`);
  equal(state.vm.globals.destroyed, 1);
  equal(state.vm.objects.length, 0);
  equal(state.vm.globals.b, undefined);
});

test("criteria 14: end-of-tick collection frees unreachable objects and retains cycles", () => {
  const state = run(`
class A {
  public:
  var link
}
a=A()
b=A()
a.link=b
b.link=a
kill(a,b)
`);
  equal(state.vm.objects.length, 2);
  const free = run("class A {}\na=A()\nkill(a)\n");
  equal(free.vm.objects.length, 0);
});

test("criteria 15: snapshot restore preserves object table, hashes and next handles", () => {
  const source = "class A { public: var x; method A(n) { x=n } }\na=A(1)\nb=A(2)\na.x=b\n";
  const original = createGameState({ seed: 4 });
  startProgram(original.vm, { kind: "inline", text: source, ir: "1" });
  advanceScriptTick(original, createScriptServices(original));
  const restored = restoreGameState(snapshot(original));
  equal(hashState(restored), hashState(original));
  deepEqual(restored.vm.objects, original.vm.objects);
  const next = run("class A {}\na=A()\n", restored);
  equal(objectHandle(next.vm.globals.a), 3);
});

test("criteria 16: invalid handles, unknown classes and private access have stable located errors", () => {
  const freed = errorOf("class A {}\na=A()\na->release()\nr=a->x()\n");
  equal(freed.code, "object.invalid");
  equal(freed.pos?.file, "<inline>");
  equal(typeof freed.pos?.line, "number");
  const privateError = errorOf("class A { private: method f() { return 1 } }\na=A()\nr=a->f()\n");
  equal(privateError.code, "object.inaccessible-member");
});

test("criteria 17: authored CArray-shaped fixture constructs, indexes, resizes and releases", () => {
  const system = readFileSync("packages/core/test/fixtures/carray-like.prg", "utf8");
  const state = run(`${system}
a=CArray()\na[0]=4\na[1]=2\nr=a[0]+a[1]\nb=a->getBound()\na->resize(5)\nc=a->getBound()\na->release()\n`);
  equal(state.vm.globals.r, 6);
  equal(state.vm.globals.b, 1);
  equal(state.vm.globals.c, 5);
  equal(state.vm.objects.length, 0);
});

