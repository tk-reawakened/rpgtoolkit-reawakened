// The cancelable emit (EMIT-5, EMIT-6, EMIT-16 to EMIT-18; entry 19.11): the emitting thread
// parks on a plain-JSON `event.dispatch` wait until every listener ran in registration order,
// then resumes with the event; listeners may cancel it or change its fields; a save taken at
// any tick of the dispatch restores and finishes as the unsaved run does.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  canon,
  createGameState,
  drainDiagnostics,
  hashState,
  restoreGameState,
  runEventsPhase,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  stepThread,
  verifyRestoredHandles,
  type GameState,
  type ScriptError,
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
function run(program: string, ticks = 8): GameState {
  const state = makeState(program);
  const services = createScriptServices(state);
  for (let tick = 0; tick < ticks; tick += 1) advanceOrFail(state, services);
  return state;
}

/** The diagnostic codes a program reports over `ticks` ticks. */
function codesOf(program: string, ticks = 8): string[] {
  const state = makeState(program);
  const services = createScriptServices(state);
  const codes: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceScriptTick(state, services);
    for (const diagnostic of drainDiagnostics(services)) codes.push(diagnostic.code);
  }
  return codes;
}

function errorOf(program: string): ScriptError {
  try {
    run(program, 4);
  } catch (error) {
    return error as ScriptError;
  }
  throw new Error("expected the program to fail");
}

const log = (state: GameState): unknown => state.vm.globals.log;

// --- The result the emitter gets --------------------------------------------------------------

test("listeners that change fields and cancel give the ruled result to the emitter (EMIT-5, EMIT-6)", () => {
  const state = run(`
log = ""
hero = {}
hero.on("damage", (e) => { e.detail.dmg = e.detail.dmg / 2; log = log + "S" })
hero.on("damage", (e) => { if (e.detail.dmg < 6) { e.cancel() }; log = log + "C" })
hero.on("damage", (e) => { log = log + "L" + e.canceled })
r = hero.emitCancelable("damage", { dmg: 10 })
log = log + "|" + r.canceled + "," + r.detail.dmg + "," + r.type + "," + r.cancelable
`);
  equal(log(state), "SCL1|1,5,damage,1", "a cancel does not stop the later listener, which sees canceled set");
});

test("without a cancel the emitter reads canceled 0 and the changed detail", () => {
  const state = run(`
log = ""
hero = {}
hero.on("damage", (e) => { e.detail.dmg = e.detail.dmg - 3 })
r = hero.emitCancelable("damage", { dmg: 10 })
log = r.canceled + "," + r.detail.dmg
`);
  equal(log(state), "0,7");
});

test("the free-function forms emitCancelable(emitter, type, detail) and cancelEvent(event) are the same operation", () => {
  const state = run(`
log = ""
h = {}
on(h, "x", (e) => { cancelEvent(e); log = log + "x" })
r = emitCancelable(h, "x")
log = log + r.canceled
`);
  equal(log(state), "x1");
});

test("the event object ends with a cancel callable bound to the event; a plain emit's event has one too (EMIT-16)", () => {
  const state = run(`
log = ""
h = {}
h.on("p", (e) => { log = log + e.cancelable + e.canceled })
h.emit("p")
h.on("c", (e) => { f = e.cancel; f(); log = log + "." + e.canceled })
h.emitCancelable("c")
`);
  equal(log(state), "00.1");
});

test("with no listeners the emitter still waits for the delivery and gets the event back untouched", () => {
  const state = run(`
log = ""
h = {}
r = h.emitCancelable("nobody", { k: 4 })
log = r.canceled + "," + r.detail.k + "," + r.cancelable
`);
  equal(log(state), "0,4,1");
});

test("the emitter waits on this event only: a listener that waits keeps it parked, other threads carry on", () => {
  const state = makeState(`
log = ""
h = {}
h.on("x", (e) => { threadSleep(getThreadId(), 0.05); log = log + "L" })
r = h.emitCancelable("x")
log = log + "R"
`);
  const services = createScriptServices(state);
  const seen: unknown[] = [];
  for (let tick = 0; tick < 40 && !String(log(state)).includes("R"); tick += 1) {
    advanceOrFail(state, services);
    seen.push(log(state));
  }
  equal(log(state), "LR", "the emitter resumed only after the sleeping listener finished");
  ok(seen.some((value) => value === ""), "the emitter was parked while the listener slept");
});

test("an emit made after a cancelable emit is delivered after it, and a cancelable event waits behind earlier events", () => {
  const state = run(`
log = ""
h = {}
h.on("a", (e) => { log = log + "a" })
h.on("b", (e) => { log = log + "b" })
h.emit("a")
r = h.emitCancelable("b")
log = log + "|"
h.emit("a")
`);
  equal(log(state), "ab|a");
});

// --- One tick of latency and a plain emit never blocks ------------------------------------------

test("a plain emit never blocks; a cancelable emit parks and resumes the tick after its delivery (EMIT-16)", () => {
  const state = makeState(`
log = "E"
h = {}
h.on("x", (e) => { log = log + "L" })
h.emit("x")
log = log + "p"
r = h.emitCancelable("x")
log = log + "R"
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  equal(log(state), "EpLL", "the plain emit did not block; the cancelable one parked, and both were delivered in tick 0's events phase");
  advanceOrFail(state, services);
  equal(log(state), "EpLLR", "the emitter resumed in the next tick");
});

test("the parked thread holds a plain-JSON event.dispatch wait that is never global (EMIT-16, G1)", () => {
  const state = makeState(`
h = {}
h.on("x", (e) => { threadSleep(getThreadId(), 0.05) })
r = h.emitCancelable("x")
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  const parked = state.vm.threads.find((thread) => thread.wait?.kind === "event.dispatch");
  ok(parked !== undefined, "the emitter is parked on an event.dispatch wait");
  deepEqual(parked.wait, { kind: "event.dispatch", global: false, id: "emitCancelable", payload: [state.events.dispatch!.event], resumeRefs: [] });
  deepEqual(JSON.parse(JSON.stringify(parked.wait)), parked.wait);
});

// --- Cancel rules (EMIT-17) ----------------------------------------------------------------------

test("cancel() on a plain event is the catchable event.not-cancelable", () => {
  equal(errorOf('h = {}\nh.on("x", (e) => { e.cancel() })\nh.emit("x")').code, "event.not-cancelable");
  equal(errorOf('h = {}\nh.on("x", (e) => { cancelEvent(e) })\nh.emit("x")').code, "event.not-cancelable");
});

test("cancel() outside the delivery of its event is the catchable event.not-dispatching", () => {
  equal(errorOf('h = {}\nr = h.emitCancelable("x")\nf = r.cancel\nf()').code, "event.not-dispatching");
  equal(errorOf('h = {}\nbox = {}\nh.on("x", (e) => { box.e = e })\nh.emitCancelable("x")\nf = box.e.cancel\nf()').code, "event.not-dispatching");
});

test("cancelEvent on something that is not an event object is builtin.bad-arg", () => {
  equal(errorOf("cancelEvent(5)").code, "builtin.bad-arg");
  equal(errorOf("d = {}\ncancelEvent(d)").code, "builtin.bad-arg");
});

test("cancelling twice is the same as once", () => {
  const state = run(`
log = ""
h = {}
h.on("x", (e) => { e.cancel(); e.cancel() })
r = h.emitCancelable("x")
log = r.canceled
`);
  equal(log(state), 1);
});

// --- Arguments and re-entry --------------------------------------------------------------------

test("a bad emitter, type or detail of emitCancelable is a catchable error", () => {
  equal(errorOf('emitCancelable(5, "x")').code, "object.invalid");
  equal(errorOf("h = {}\nemitCancelable(h, 5)").code, "builtin.bad-arg");
  equal(errorOf('h = {}\nh.emitCancelable("x", 5)').code, "builtin.bad-arg");
  equal(errorOf("h = {}\nh.emitCancelable(5)").code, "builtin.bad-arg");
});

test("a listener cannot wait for a cancelable event: emit.reentrant, and delivery carries on (EMIT-18)", () => {
  const program = `
log = ""
h = {}
h.on("x", (e) => { log = log + "a"; h.emitCancelable("y"); log = log + "!" })
h.on("x", (e) => { log = log + "b" })
h.on("y", (e) => { log = log + "y" })
r = h.emitCancelable("x")
log = log + "R"
h.emit("y")
`;
  deepEqual(codesOf(program), ["emit.reentrant"]);
  const state = makeState(program);
  const services = createScriptServices(state);
  for (let tick = 0; tick < 8; tick += 1) {
    advanceScriptTick(state, services);
    drainDiagnostics(services);
  }
  equal(log(state), "a!bRy", "the failing call was skipped (ERR-2), the second listener and the emitter ran, the plain emit was delivered");
});

test("a listener may send a plain emit, delivered after the event in progress", () => {
  const state = run(`
log = ""
h = {}
h.on("x", (e) => { h.emit("y"); log = log + "x" })
h.on("y", (e) => { log = log + "y" })
r = h.emitCancelable("x")
log = log + "R"
`);
  equal(log(state), "xyR");
});

// --- Liveness and restore (EMIT-10, EMIT-15, EMIT-16) -------------------------------------------

test("the event and its detail stay alive while a thread waits on them and until it resumes", () => {
  const state = makeState(`
log = ""
h = {}
r = h.emitCancelable("x", { k: 9 })
log = r.detail.k
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  ok(state.events.queue.length === 0 && state.events.dispatch === null, "delivered in tick 0");
  equal(state.vm.objects.length, 3, "the emitter, the event and its detail survived the end-of-tick pass with only the wait naming them");
  advanceOrFail(state, services);
  equal(log(state), 9);
});

const SAVE_PROGRAM = `
log = ""
h = {}
c = 0
h.on("hit", (e) => { for (i = 0; i < 5; i = i + 1) { c = c + 1 }; e.detail.dmg = e.detail.dmg / 2; log = log + "s" })
h.on("hit", (e) => { if (e.detail.dmg < 6) { e.cancel() }; log = log + "c" })
h.once("hit", (e) => { log = log + "o" + e.canceled })
h.on("hit", (e) => { threadSleep(getThreadId(), 0.02); log = log + "z" })
r1 = h.emitCancelable("hit", { dmg: 10 })
log = log + "|" + r1.canceled + r1.detail.dmg
r2 = h.emitCancelable("hit", { dmg: 40 })
log = log + "|" + r2.canceled + r2.detail.dmg
`;

test("a save taken at every tick of a dispatch restores and finishes with the same hash as the unsaved run (EMIT-10, EMIT-16)", () => {
  const straight = makeState(SAVE_PROGRAM);
  const straightServices = createScriptServices(straight);
  const ticks = 60;
  const hashes: string[] = [];
  const saves: string[] = [];
  let parkedSaves = 0;
  let midDispatch = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceOrFail(straight, straightServices, 7);
    hashes.push(hashState(straight as never));
    saves.push(snapshot(straight));
    if (straight.vm.threads.some((thread) => thread.wait?.kind === "event.dispatch")) parkedSaves += 1;
    if (straight.events.dispatch !== null) midDispatch += 1;
  }
  equal(log(straight), "sco1z|15scz|020", "the first event is halved and cancelled, the second only halved; the once listener ran for the first only");
  ok(parkedSaves > 0, "some saves were taken while the emitter was parked");
  ok(midDispatch > 0, "some saves were taken in the middle of a dispatch");
  for (let tick = 0; tick < ticks; tick += 1) {
    const restored = restoreGameState(saves[tick]!);
    const services = createScriptServices(restored);
    verifyRestoredHandles(restored.vm, services, restored.events);
    equal(canon(restored as never), saves[tick], `tick ${tick}: the restored state is the saved one`);
    for (let next = tick + 1; next < ticks; next += 1) advanceOrFail(restored, services, 7);
    equal(hashState(restored as never), hashes[ticks - 1], `a save after tick ${tick} finishes as the unsaved run does`);
  }
});

test("restore refuses an event.dispatch wait whose event is not a live object", () => {
  const state = makeState(`
h = {}
h.on("x", (e) => { threadSleep(getThreadId(), 0.05) })
r = h.emitCancelable("x")
`);
  const services = createScriptServices(state);
  advanceOrFail(state, services);
  const raw = JSON.parse(snapshot(state)) as { vm: { threads: { wait: { kind: string; payload: unknown[] } | null }[] } };
  const parked = raw.vm.threads.find((thread) => thread.wait?.kind === "event.dispatch");
  ok(parked?.wait);
  restoreGameState(JSON.stringify(raw));
  parked.wait.payload = [99];
  try {
    restoreGameState(JSON.stringify(raw));
  } catch (error) {
    equal((error as ScriptError).code, "restore.shape");
    return;
  }
  throw new Error("expected the restore to be refused");
});

// --- Step cost against the 19.2 measurement ------------------------------------------------------

/** The least budget under which one cancelable event with `listeners` listeners is delivered in one events phase. */
function leastDispatchBudget(listeners: number): number {
  const program = `
h = {}
${"h.on(\"damage\", (e) => { e.detail.dmg = e.detail.dmg - 1 })\n".repeat(listeners)}r = h.emitCancelable("damage", { dmg: 50 })
`;
  for (let budget = 1; budget <= STEP_BUDGET; budget += 1) {
    const state = makeState(program);
    const services = createScriptServices(state);
    runWaitsPhase(state.vm, { tick: 0, events: state.events });
    runThreadsPhase(state.vm, services, STEP_BUDGET);
    runEventsPhase(state, services, budget);
    if (state.events.dispatch === null && state.events.queue.length === 0) return budget;
  }
  throw new Error("the dispatch did not fit one STEP_BUDGET");
}

/** The steps the emitter thread spends in its first tick. */
function emitterSteps(call: string): number {
  const state = makeState(`h = {}\nh.on("damage", (e) => { })\n${call}\n`);
  const services = createScriptServices(state);
  const thread = state.vm.threads[0]!;
  return stepThread(thread, state.vm, services, STEP_BUDGET);
}

test("step cost: the emit costs its thread the call and no more; a dispatch of three or eight listeners fits the 19.2 headroom", () => {
  const plain = emitterSteps('h.emit("damage", { dmg: 50 })');
  const cancelable = emitterSteps('r = h.emitCancelable("damage", { dmg: 50 })');
  ok(cancelable <= plain + 1, `parking costs the emitting thread the call, not more: ${cancelable} steps against ${plain} for a plain emit`);
  // 19.2 spike (discovery/step-budget-spike.md), per-fighter threads with inline listeners: three listeners cost
  // 565 - 346 = 219 steps of a tick and eight 937 - 346 = 591, leaving 435 and 63 steps under STEP_BUDGET.
  // The core-owned dispatcher is cheaper per listener, so it must come in at or under both.
  ok(leastDispatchBudget(3) <= 219, `three listeners: ${leastDispatchBudget(3)} steps`);
  ok(leastDispatchBudget(8) <= 591, `eight listeners: ${leastDispatchBudget(8)} steps`);
});
