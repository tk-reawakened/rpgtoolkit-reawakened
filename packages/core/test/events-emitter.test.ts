// The first-class emitter: on, off, once and a queued emit (EMIT-2 to EMIT-4, EMIT-10,
// EMIT-14, EMIT-15; entry 19.10). Listeners run later, in registration order, on their own
// threads; add and remove follow the ruled rules also during a dispatch; the `events`
// section is plain JSON and a save taken at any step finishes as the unsaved run does.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  canon,
  createGameState,
  drainDiagnostics,
  hashState,
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

function ok(condition: unknown, message?: string): asserts condition {
  equal(Boolean(condition), true, message);
}

function makeState(program: string): GameState {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return state;
}

/** Run `program` for `ticks` ticks and return the state; any diagnostic fails the test. */
function run(program: string, ticks = 6): GameState {
  const state = makeState(program);
  const services = createScriptServices(state);
  for (let tick = 0; tick < ticks; tick += 1) advanceOrFail(state, services);
  return state;
}

function errorOf(program: string): ScriptError {
  try {
    run(program, 2);
  } catch (error) {
    return error as ScriptError;
  }
  throw new Error("expected the program to fail");
}

const log = (state: GameState): unknown => state.vm.globals.log;

// --- Delivery -------------------------------------------------------------------------------

test("a plain emit queues: no listener runs inside the call, then they run in registration order (EMIT-3)", () => {
  const state = makeState(`
log = ""
h = {}
h.on("hit", (e) => { log = log + "a" })
on(h, "hit", (e) => { log = log + "b" })
h.on("hit", (e) => { log = log + "c" })
h.emit("hit")
log = log + "|"
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(log(state), "|abc", "the emitter finished its tick first; the same tick's events phase then ran a, b, c");
});

test("the event object holds type, target, detail, cancelable and canceled; the listener gets it as its one argument (EMIT-6)", () => {
  const state = run(`
log = ""
h = {}
h.on("hit", (e) => { log = e.type + "," + e.detail.dmg + "," + e.cancelable + "," + e.canceled; t = e.target })
h.emit("hit", { dmg: 7 })
`);
  equal(log(state), "hit,7,0,0");
  deepEqual(state.vm.globals.t, { kind: "object", handle: 1, className: "" });
});

test("detail is copied when emitted: a later change by the emitter does not alter the queued event (EMIT-6)", () => {
  const state = run(`
log = ""
h = {}
d = { dmg: 1 }
h.on("hit", (e) => { log = log + e.detail.dmg })
h.emit("hit", d)
d.dmg = 99
`);
  equal(log(state), "1");
});

test("a listener's change to detail is seen by the next listener (one event object per dispatch)", () => {
  const state = run(`
log = ""
h = {}
h.on("hit", (e) => { e.detail.dmg = e.detail.dmg / 2 })
h.on("hit", (e) => { log = log + e.detail.dmg })
h.emit("hit", { dmg: 10 })
`);
  equal(log(state), "5");
});

test("a type nothing listens to is not an error, and each type has its own listeners (EMIT-12)", () => {
  const state = run(`
log = ""
h = {}
h.on("a", (e) => { log = log + "A" })
h.emit("nobody")
h.emit("b")
h.emit("a")
`);
  equal(log(state), "A");
});

test("listeners belong to one emitter: another object's emit does not reach them", () => {
  const state = run(`
log = ""
h = {}
g = {}
h.on("x", (e) => { log = log + "h" })
g.on("x", (e) => { log = log + "g" })
g.emit("x")
`);
  equal(log(state), "g");
});

test("events are delivered in the order they were queued; an emit inside a listener queues, it does not recurse", () => {
  const state = run(`
log = ""
h = {}
h.on("one", (e) => { log = log + "1("; h.emit("three"); log = log + ")" })
h.on("one", (e) => { log = log + "1b" })
h.on("two", (e) => { log = log + "2" })
h.on("three", (e) => { log = log + "3" })
h.emit("one")
h.emit("two")
`);
  equal(log(state), "1()1b23", "three was queued during dispatch and follows the events already queued");
});

test("an emit made in the events phase is delivered in the same phase while the budget lasts", () => {
  const state = makeState(`
log = ""
h = {}
h.on("one", (e) => { h.emit("two") })
h.on("two", (e) => { log = log + "2" })
h.emit("one")
`);
  advanceOrFail(state, createScriptServices(state));
  equal(log(state), "2");
  deepEqual(state.events.queue, []);
  equal(state.events.dispatch, null);
});

test("a listener keeps the receiver its callable carries (OOP-11)", () => {
  const state = run(`
log = ""
c = { n: 0 }
c.bump = (e) => { this.n = this.n + 1; log = log + this.n }
c.on("tick", c.bump)
c.emit("tick")
c.emit("tick")
`);
  equal(log(state), "12");
});

// --- Adding and removing listeners ------------------------------------------------------------

test("off(type, fn) removes the first matching listener only; a callable registered twice is two listeners", () => {
  const state = run(`
log = ""
h = {}
f = (e) => { log = log + "f" }
h.on("x", f)
h.on("x", f)
h.off("x", f)
h.emit("x")
`);
  equal(log(state), "f");
});

test("off(type) removes every listener of that type and no other", () => {
  const state = run(`
log = ""
h = {}
h.on("x", (e) => { log = log + "x1" })
h.on("x", (e) => { log = log + "x2" })
h.on("y", (e) => { log = log + "y" })
h.off("x")
h.emit("x")
h.emit("y")
`);
  equal(log(state), "y");
});

test("off matches the callable by definition, captures and receiver: another lambda is not the same listener (EMIT-4)", () => {
  const state = run(`
log = ""
h = {}
f = (e) => { log = log + "f" }
g = (e) => { log = log + "g" }
h.on("x", f)
h.off("x", g)
h.emit("x")
`);
  equal(log(state), "f");
});

test("off for a listener that is not registered does nothing", () => {
  const state = run(`
log = ""
h = {}
h.off("x", (e) => { log = log + "?" })
h.off("x")
h.emit("x")
log = log + "ok"
`);
  equal(log(state), "ok");
});

test("once fires exactly once", () => {
  const state = run(`
log = ""
h = {}
h.once("x", (e) => { log = log + "o" })
h.on("x", (e) => { log = log + "n" })
h.emit("x")
h.emit("x")
h.emit("x")
`);
  equal(log(state), "onnn");
});

test("removing a once listener before it fires prevents it from firing", () => {
  const state = run(`
log = ""
h = {}
f = (e) => { log = log + "o" }
h.once("x", f)
h.off("x", f)
h.emit("x")
log = log + "."
`);
  equal(log(state), ".");
});

test("a once listener is removed from the table just before it runs", () => {
  const state = makeState(`
log = ""
h = {}
h.once("x", (e) => { log = log + "o" })
h.emit("x")
`);
  advanceOrFail(state, createScriptServices(state));
  equal(state.events.listeners.length, 0);
  equal(log(state), "o");
});

test("a listener removed during dispatch is skipped if it has not run yet; one that already ran is unaffected (EMIT-4)", () => {
  const state = run(`
log = ""
h = {}
fb = (e) => { log = log + "b" }
fa = (e) => { log = log + "a"; h.off("x", fb); h.off("x", fa) }
h.on("x", fa)
h.on("x", fb)
h.on("x", (e) => { log = log + "c" })
h.emit("x")
h.emit("x")
`);
  equal(log(state), "acc", "b never ran; a ran once and removed itself; c ran for both events");
});

test("a listener added during dispatch does not run for that event and runs from the next one (EMIT-4)", () => {
  const state = run(`
log = ""
h = {}
added = 0
h.on("x", (e) => { log = log + "a"; if (added == 0) { added = 1; h.on("x", (e2) => { log = log + "n" }) } })
h.emit("x")
h.emit("x")
`);
  equal(log(state), "aan", "the second event was queued before any listener ran, and it takes its list when it is taken: a, then n");
});

test("a removal of every listener of the type during dispatch skips the ones not yet run", () => {
  const state = run(`
log = ""
h = {}
h.on("x", (e) => { log = log + "a"; h.off("x") })
h.on("x", (e) => { log = log + "b" })
h.emit("x")
`);
  equal(log(state), "a");
});

test("the listener list is fixed when the event is taken, not when it is emitted (EMIT-14)", () => {
  const state = run(`
log = ""
h = {}
h.emit("x")
h.on("x", (e) => { log = log + "late" })
`);
  equal(log(state), "late");
});

// --- Methods and the free-function alias --------------------------------------------------

test("the method form and the free-function form are one operation; a method read without a call is a bound callable", () => {
  const state = run(`
log = ""
h = {}
reg = h.on
reg("x", (e) => { log = log + "t" })
once(h, "x", (e) => { log = log + "o" })
emit(h, "x")
emit(h, "x")
`);
  equal(log(state), "tot");
  const removed = run(`
log = ""
h = {}
on(h, "x", (e) => { log = log + "t" })
off(h, "x")
emit(h, "x")
log = log + "."
`);
  equal(log(removed), ".");
});

test("an author's own data field named on shadows the method, and the free function still reaches the emitter (OOP-12)", () => {
  const state = run(`
log = ""
h = { on: (x) => { log = log + "own" + x } }
h.on(1)
on(h, "x", (e) => { log = log + "L" })
h.emit("x")
`);
  equal(log(state), "own1L");
});

test("a class instance is an emitter too", () => {
  const state = run(`
log = ""
class Thing {
  public:
  var v
  method Thing() { v = 1 }
}
t = Thing()
t.on("x", (e) => { log = log + "T" })
t.emit("x")
`);
  equal(log(state), "T");
});

// --- Errors --------------------------------------------------------------------------------

test("a bad emitter, type, listener or detail is a catchable error", () => {
  equal(errorOf('on(5, "x", (e) => { })').code, "object.invalid");
  equal(errorOf('h = {}\non(h, 5, (e) => { })').code, "builtin.bad-arg");
  equal(errorOf('h = {}\nh.on("x", 5)').code, "callable.not-callable");
  equal(errorOf('h = {}\nh.off("x", 5)').code, "callable.not-callable");
  equal(errorOf('h = {}\nh.emit("x", 5)').code, "builtin.bad-arg");
  equal(errorOf('h = {}\nh.emit(5)').code, "builtin.bad-arg");
});

test("an error in a listener is reported and does not stop the other listeners or the later events", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { log = log + "a"; q = missingfunction() })
h.on("x", (e) => { log = log + "b" })
h.emit("x")
h.emit("x")
`);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 4; tick += 1) advanceScriptTick(state, services);
  equal(log(state), "abab");
  equal(drainDiagnostics(services).length, 2, "one located diagnostic per failing listener");
});

test("a listener that does not take exactly one parameter is the catchable callable.arity, and the rest still run", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", () => { log = log + "z" })
h.on("x", (e) => { log = log + "b" })
h.emit("x")
`);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 3; tick += 1) advanceScriptTick(state, services);
  equal(log(state), "b");
  equal(drainDiagnostics(services)[0]?.code, "callable.arity");
});

// --- Budget, waits and the cursor ----------------------------------------------------------

test("a listener the budget interrupts carries on next tick and the dispatch waits for it; order is kept", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { for (i = 0; i < 8; i = i + 1) { n = i }; log = log + "a" })
h.on("x", (e) => { log = log + "b" })
h.emit("x")
h.emit("x")
`);
  const services = createScriptServices(state);
  const seen: unknown[] = [];
  for (let tick = 0; tick < 80 && log(state) !== "abab"; tick += 1) {
    advanceOrFail(state, services, 12);
    seen.push(log(state));
  }
  equal(log(state), "abab");
  ok(seen.some((value) => value === ""), "the first listener took more than one tick");
});

test("a listener may wait; the dispatch waits for it and nothing is delivered out of order", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { threadSleep(getThreadId(), 0.05); log = log + "a" })
h.on("x", (e) => { log = log + "b" })
h.emit("x")
h.emit("x")
`);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 30 && log(state) !== "abab"; tick += 1) advanceOrFail(state, services);
  equal(log(state), "abab");
});

test("nothing is delivered while a blocking command waits (R-32)", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { log = log + "L" })
h.emit("x")
sleep(3)
log = log + "|"
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(log(state), "", "the emitter entered its blocking sleep; no delivery yet");
  for (let tick = 0; tick < 6; tick += 1) advanceOrFail(state, services);
  equal(log(state), "|L");
});

test("a finished listener thread is removed; the listener threads do not pile up", () => {
  const state = run(`
log = ""
h = {}
for (i = 0; i < 5; i = i + 1) { h.on("x", (e) => { log = log + "." }) }
h.emit("x")
h.emit("x")
`, 10);
  equal(log(state), "..........");
  ok(state.vm.threads.every((thread) => thread.kind !== "persistent"), "no listener thread is left registered");
});

// --- Save and restore ------------------------------------------------------------------------

const SAVE_PROGRAM = `
log = ""
h = {}
g = {}
c = 0
h.on("x", (e) => { for (i = 0; i < 6; i = i + 1) { c = c + 1 }; log = log + "a" })
h.once("x", (e) => { log = log + "o" })
h.on("x", (e) => { h.emit("y"); log = log + "b" })
h.on("y", (e) => { log = log + "y" })
g.on("z", (e) => { log = log + "g" })
h.emit("x")
g.emit("z")
h.emit("x")
`;

test("a save taken between any two steps restores and finishes with the same hash as the unsaved run (EMIT-10)", () => {
  const straight = makeState(SAVE_PROGRAM);
  const straightServices = createScriptServices(straight);
  const ticks = 40;
  const hashes: string[] = [];
  const saves: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceOrFail(straight, straightServices, 7);
    hashes.push(hashState(straight as never));
    saves.push(snapshot(straight));
  }
  ok((log(straight) as string).includes("g"), "the program ran to the end");
  let midDispatch = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    const restored = restoreGameState(saves[tick]!);
    const services = createScriptServices(restored);
    verifyRestoredHandles(restored.vm, services, restored.events);
    equal(canon(restored as never), saves[tick], `tick ${tick}: the restored state is the saved one`);
    if (restored.events.dispatch !== null) midDispatch += 1;
    for (let next = tick + 1; next < ticks; next += 1) advanceOrFail(restored, services, 7);
    equal(hashState(restored as never), hashes[ticks - 1], `a save after tick ${tick} finishes as the unsaved run does`);
  }
  ok(midDispatch > 0, "some of the saves were taken in the middle of a dispatch");
});

/** A state stopped in the middle of a dispatch: the one listener was interrupted by the budget. */
function midDispatch(): GameState {
  const state = makeState(`
h = {}
h.on("x", (e) => { for (i = 0; i < 30; i = i + 1) { n = i } })
h.emit("x")
`);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 30 && state.events.dispatch === null; tick += 1) advanceOrFail(state, services, 5);
  return state;
}

test("the events section is plain JSON: ids, emitter keys, callable records and the cursor (EMIT-15)", () => {
  const state = midDispatch();
  const events = JSON.parse(JSON.stringify(state.events)) as GameState["events"];
  deepEqual(events, state.events);
  equal(events.nextListener, 2);
  equal(events.listeners[0]?.emitter, "object:1");
  equal(events.listeners[0]?.type, "x");
  equal(events.listeners[0]?.once, false);
  ok(events.dispatch !== null, "the listener was interrupted, so the dispatch is in progress");
  deepEqual(events.dispatch?.order, [1]);
  equal(events.dispatch?.index, 0);
  equal(typeof events.dispatch?.thread, "number");
});

test("restore refuses an events section that names an object or a thread that is not there", () => {
  const state = midDispatch();
  const raw = JSON.parse(snapshot(state)) as { events: { dispatch: { thread: number; event: number }; queue: unknown[]; nextListener: number; listeners: { id: number }[] } };
  const code = (mutate: (value: typeof raw) => void): string => {
    const copy = JSON.parse(JSON.stringify(raw)) as typeof raw;
    mutate(copy);
    try {
      restoreGameState(JSON.stringify(copy));
    } catch (error) {
      return (error as ScriptError).code;
    }
    return "restored";
  };
  equal(code(() => undefined), "restored");
  equal(code((value) => { value.events.dispatch.thread = 99; }), "restore.shape");
  equal(code((value) => { value.events.dispatch.event = 99; }), "restore.shape");
  equal(code((value) => { value.events.queue.push({ emitter: "object:1", event: 99 }); }), "restore.shape");
  equal(code((value) => { value.events.listeners[0]!.id = 7; }), "restore.shape");
});

// --- Collection and freed emitters -----------------------------------------------------------

test("an emitter nothing names is freed and its listeners go with it; the next object does not inherit them (EMIT-14)", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { log = log + "stale" })
h = 0
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(state.events.listeners.length, 0);
  equal(state.vm.objects.length, 0);
  startProgram(state.vm, { kind: "inline", text: 'h = {}\nh.emit("x")\n', ir: "1" });
  for (let tick = 0; tick < 3; tick += 1) advanceOrFail(state, services);
  equal(log(state), "");
});

test("a registered closure keeps its captured state, and the cells and objects it names, alive", () => {
  const state = run(`
log = ""
h = {}
makeCounter = () => { local(n); n = 0; return (e) => { n = n + 1; log = log + n } }
h.on("x", makeCounter())
h.emit("x")
h.emit("x")
h.emit("x")
`);
  equal(log(state), "123");
  ok(Object.keys(state.vm.cells ?? {}).length > 0, "the closure's cell is still held");
});

test("queued events keep their event object and detail alive until delivered", () => {
  const state = makeState(`
h = {}
h.emit("x", { k: 1 })
sleep(30)
`);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 3; tick += 1) advanceOrFail(state, services);
  equal(state.events.queue.length, 1, "the blocking sleep holds delivery, so the event stays queued across ticks");
  equal(state.vm.objects.length, 3, "the emitter, the event and its detail survive the end-of-tick pass");
  const restored = restoreGameState(snapshot(state));
  verifyRestoredHandles(restored.vm, createScriptServices(restored), restored.events);
});

// --- The section and the phase --------------------------------------------------------------

test("a new game state has an empty events section at schema version 1", () => {
  const state = createGameState({ seed: 0 });
  deepEqual(state.events, { nextListener: 1, listeners: [], queue: [], dispatch: null });
  equal(state.schema.events, 1);
});
