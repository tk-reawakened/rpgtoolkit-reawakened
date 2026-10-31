// The game emitter, the registration seam and the one bus for TypeScript plugins
// (EMIT-7 to EMIT-9, EMIT-19 to EMIT-22; entry 19.12): a script and a native test plugin
// listen and emit on the same queue and in the same order, the game `error` event reports
// every runtime error, and a section owner makes an emitter through `registerEmitter`.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  actorFromSource,
  addActor,
  advanceScriptTick,
  canon,
  createCollectingSink,
  createEmptyBoard,
  createGameState,
  createLogger,
  drainDiagnostics,
  emitEffect,
  hashState,
  readEvent,
  queueNativeEvent,
  registerEmitter,
  restoreGameState,
  runEventsPhase,
  runThreadsPhase,
  runWaitsPhase,
  ScriptError,
  snapshot,
  startProgram,
  STEP_BUDGET,
  unregisterEmitter,
  UI_PLUGIN,
  verifyRestoredHandles,
  type BuiltinSpec,
  type Diagnostic,
  type EventView,
  type GameState,
  type PlainData,
  type PluginDefinition,
  type ScriptServices,
  type Value,
  type WaitPoll,
  type WorldBoard,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

function ok(condition: unknown, message?: string): asserts condition {
  equal(Boolean(condition), true, message);
}

const param = (name: string) => ({ name, optional: false, byRef: false, variadic: false });

/** What the native test plugin's listener heard, in the order it was called. */
type Heard = { readonly event: EventView; readonly tick: number; readonly log: Value | undefined };

/**
 * A native test plugin: `tsemit(type, n)` emits `type` on the game with `{ n }`; `tsemitto(key, type)`
 * emits on any key; `tsbad()` emits a detail the bus refuses; `tsheard(event)` is the command its
 * listeners name and records what it was given; `killowned()` fails with the ERR-2 code of entry 19.1.
 */
function makePlugin(heard: Heard[], listeners: PluginDefinition["listeners"]): PluginDefinition {
  const commands: BuiltinSpec[] = [
    {
      name: "tsemit",
      aliases: [],
      params: [param("type"), param("n")],
      call: (_view, args) => ({ value: 0, effects: [emitEffect("game", String(args[0]!.value), { n: args[1]!.value, ok: true, none: null })] }),
    },
    {
      name: "tsemitto",
      aliases: [],
      params: [param("key"), param("type")],
      call: (_view, args) => ({ value: 0, effects: [emitEffect(String(args[0]!.value), String(args[1]!.value))] }),
    },
    {
      name: "tsbad",
      aliases: [],
      params: [],
      call: () => ({ value: 0, effects: [{ kind: "emit", args: ["game", "x", { nested: { a: 1 } }] }] }),
    },
    {
      name: "tsheard",
      aliases: [],
      params: [param("event")],
      call: (view, args) => {
        const event = readEvent(view.state!, args[0]!.value);
        if (event !== undefined) heard.push({ event, tick: view.clock.tick(), log: view.state!.vm.globals.log });
        return { value: 0 };
      },
    },
    {
      name: "killowned",
      aliases: [],
      params: [],
      call: () => {
        throw new ScriptError("kill.system-owned", "kill: \"music\" is owned by the engine");
      },
    },
  ];
  return { id: "ping", version: "1.0.0", commands, ...(listeners === undefined ? {} : { listeners }) };
}

const PING_LISTENER = [{ emitter: "game", type: "ping", command: "tsheard" }] as const;

type Run = { readonly state: GameState; readonly services: ScriptServices; readonly heard: Heard[]; readonly diagnostics: Diagnostic[] };

/** Start `program` with the test plugin and run `ticks` ticks, collecting every diagnostic. */
function run(program: string, ticks = 6, listeners: PluginDefinition["listeners"] = PING_LISTENER): Run {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  const heard: Heard[] = [];
  const services = createScriptServices(state, [makePlugin(heard, listeners)]);
  const diagnostics: Diagnostic[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceScriptTick(state, services);
    diagnostics.push(...drainDiagnostics(services));
  }
  return { state, services, heard, diagnostics };
}

const globalOf = (result: Run, name: string): Value | undefined => result.state.vm.globals[name];

// --- One bus, both directions ----------------------------------------------------------------
test("dialogue completion is queued once after the input wait resumes", () => {
  const state = createGameState({ seed: 0 });
  const actor = addActor(state.actors, { kind: "npc", source: "speaker.tem" });
  const speaker = actorFromSource({ id: "speaker", kind: "player", source: "speaker.tem", actorId: actor.id, x: 0, y: 0, layer: 0 }, { coordType: 0 } as WorldBoard, 0, null);
  state.sprites.players.push(speaker);
  const thread = startProgram(state.vm, { kind: "inline", text: 'result = dialogue("Hello")', ir: "1" });
  thread.source = speaker.id;
  const heard: Heard[] = [];
  const services = createScriptServices(state, [
    UI_PLUGIN,
    makePlugin(heard, [{ emitter: "game", type: "dialogue.completed", command: "tsheard" }]),
  ]);
  advanceScriptTick(state, services);
  equal(heard.length, 0);
  const wait = thread.wait;
  if (wait?.kind !== "input.key") throw new Error("dialogue did not wait for input");
  equal(wait.dialogue?.actorId, actor.id);
  const inputPoll: WaitPoll = (_view, pending) => pending.kind === "input.key" ? { value: "Enter", ok: true } : null;
  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  const restoredThread = restored.vm.threads[0]!;
  const restoredHeard: Heard[] = [];
  const restoredServices = createScriptServices(restored, [
    UI_PLUGIN,
    makePlugin(restoredHeard, [{ emitter: "game", type: "dialogue.completed", command: "tsheard" }]),
  ]);
  advanceScriptTick(restored, restoredServices, STEP_BUDGET, inputPoll);
  equal(restoredHeard.length, 1);
  deepEqual(restoredHeard[0]?.event.detail, { actorId: actor.id, targetId: null, text: "Hello" });
  equal(restoredThread.wait, null);
  equal(restored.vm.globals.result, "Enter");
});

test("a script listens on the game and receives an event a TypeScript plugin emitted, in registration order, in the phase a script emit is delivered in (EMIT-7, EMIT-21)", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, {
    kind: "inline",
    ir: "1",
    text: `
log = ""
game.on("tick", (e) => { log = log + "a" + e.detail.n })
game.on("tick", (e) => { log = log + "b" })
tsemit("tick", 7)
game.emit("tick", { n: 8 })
mid = log
`,
  });
  const services = createScriptServices(state, [makePlugin([], undefined)]);
  const budget = STEP_BUDGET;
  runWaitsPhase(state.vm, { tick: 0, events: state.events });
  runThreadsPhase(state.vm, services, budget);
  equal(state.vm.globals.mid, "", "no listener ran inside either emit call");
  equal(state.events.queue.length, 2, "both emits are queued behind one another: the TypeScript one first, in call order");
  runEventsPhase(state, services, budget);
  equal(state.vm.globals.log, "a7ba8b", "both events were delivered in the same events phase, in emit order, each to its listeners in registration order");
});

test("a script emit reaches a TypeScript listener, which runs only when the dispatcher starts it (EMIT-7, EMIT-21)", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", ir: "1", text: `game.emit("ping", { n: 5, s: "x" })\ngame.emit("other")\n` });
  const heard: Heard[] = [];
  const services = createScriptServices(state, [makePlugin(heard, PING_LISTENER)]);
  runWaitsPhase(state.vm, { tick: 0, events: state.events });
  runThreadsPhase(state.vm, services, STEP_BUDGET);
  equal(heard.length, 0, "the TypeScript listener has not run when the script's emit returned");
  runEventsPhase(state, services, STEP_BUDGET);
  deepEqual(
    heard.map((item) => item.event),
    [{ type: "ping", emitter: "game", detail: { n: 5, s: "x" }, cancelable: false, canceled: false }],
    "the listener got a plain-data copy of the event, and only the type it listens to",
  );
});

test("a native listener preserves an own nested __proto__ detail key without prototype mutation", () => {
  const state = createGameState({ seed: 0 });
  const heard: Heard[] = [];
  const services = createScriptServices(state, [makePlugin(heard, PING_LISTENER)]);
  const detail = JSON.parse('{"nested":{"__proto__":{"safe":1},"ok":2}}') as PlainData;
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) throw new Error("test detail must be a record");
  queueNativeEvent(state.vm, state.events, "game", "ping", detail);
  runEventsPhase(state, services, STEP_BUDGET);
  equal(heard.length, 1);
  const nested = heard[0]!.event.detail.nested;
  ok(typeof nested === "object" && nested !== null);
  equal(Object.hasOwn(nested, "__proto__"), true);
  deepEqual(Object.getOwnPropertyDescriptor(nested, "__proto__")?.value, { safe: 1 });
  equal(({} as { readonly safe?: unknown }).safe, undefined);
});

test("the TypeScript side cannot call a listener synchronously: its emit only queues, in the same step the command returns (EMIT-21)", () => {
  const result = run(`
seen = 0
game.on("ping", (e) => { seen = seen + 1 })
tsemit("ping", 1)
atonce = seen
`);
  equal(globalOf(result, "atonce"), 0, "the script listener had not run when the TypeScript emit returned to the script");
  equal(globalOf(result, "seen"), 1, "it ran once, later, from the dispatcher");
  equal(result.heard.length, 1, "the TypeScript listener ran once, from the dispatcher");
  const effect = emitEffect("game", "ping", { n: 1 });
  deepEqual(JSON.parse(JSON.stringify(effect)), effect, "the emit effect is plain data: nothing in it can be called");
  const logged = result.state.vm.effects.filter((record) => record.kind === "emit");
  equal(logged.length, 1, "the emit is recorded in the effect log under the kind emit");
  equal(logged[0]!.patch, null, "and names no section");
});

test("a native listener sits ahead of the script listeners of its type, in the one registration order, and runs from the same dispatcher (EMIT-21)", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", ir: "1", text: `log = ""\ngame.on("ping", (e) => { log = log + "s" })\ngame.emit("ping")\n` });
  const heard: Heard[] = [];
  const services = createScriptServices(state, [makePlugin(heard, PING_LISTENER)]);
  equal(state.events.listeners.length, 1, "the package's listener was added when the package started, before any script ran");
  runWaitsPhase(state.vm, { tick: 0, events: state.events });
  runThreadsPhase(state.vm, services, STEP_BUDGET);
  deepEqual(
    state.events.listeners.map((listener) => listener.id),
    [1, 2],
    "the script's listener was appended after the native one",
  );
  runEventsPhase(state, services, STEP_BUDGET);
  equal(heard.length, 1);
  equal(heard[0]!.log, "", "the native listener ran first: the script listener had not run yet");
  equal(state.vm.globals.log, "s", "and the script listener ran after it");
});

test("a TypeScript listener is called with a cancelable event and may not change it (EMIT-17, EMIT-21)", () => {
  const result = run(`r = game.emitCancelable("ping", { n: 2 })\nc = r.canceled\n`);
  equal(result.heard.length, 1);
  equal(result.heard[0]!.event.cancelable, true);
  equal(globalOf(result, "c"), 0);
});

test("an emit effect with a nested detail is the catchable builtin.bad-arg and a key that names no emitter is object.invalid (EMIT-21)", () => {
  const bad = run(`tsbad()\nafter = 1\n`);
  deepEqual(bad.diagnostics.map((item) => item.code), ["builtin.bad-arg"]);
  equal(globalOf(bad, "after"), 1, "the script went on");
  equal(bad.state.events.queue.length, 0, "nothing was queued");
  const missing = run(`tsemitto("board:nowhere", "x")\nafter = 1\n`);
  deepEqual(missing.diagnostics.map((item) => item.code), ["object.invalid"]);
  const text = run(`tsemitto("object:99", "x")\n`);
  deepEqual(text.diagnostics.map((item) => item.code), ["object.invalid"]);
});

// --- The name game ---------------------------------------------------------------------------

test("`game` reads as one dictionary object for the whole run, kept alive by the engine and listed in emitters (EMIT-19, EMIT-20)", () => {
  const result = run(`
a = game
b = game
same = (a == b)
game.mark = 5
`);
  equal(globalOf(result, "same"), 1);
  const handle = result.state.events.emitters?.game;
  ok(handle !== undefined);
  equal(result.state.vm.objects.length, 1, "one object, made once");
  equal(result.state.vm.objects[0]!.handle, handle);
  equal(result.state.vm.objects[0]!.className, "", "an ordinary dictionary");
  equal(result.state.vm.objects[0]!.members.mark, 5, "a script may keep fields on it");
  const free = run(`x = 1\n`);
  equal(free.state.events.emitters, undefined, "a state that never needed the game keeps the shape it had");
  equal(free.state.vm.objects.length, 0);
});

test("a state that only uses ordinary emitters never gets an emitters section (EMIT-15)", () => {
  const result = run(`h = {}\nh.on("x", (e) => { n = 1 })\nh.emit("x")\n`);
  equal(Object.hasOwn(result.state.events, "emitters"), false);
});

// --- The error event -------------------------------------------------------------------------

/** The error events a listener on the game saw, as `code:file:line:handled` strings. */
const ERRORS = `
seen = ""
game.on("error", (e) => { seen = seen + e.detail.code + ":" + e.detail.file + ":" + e.detail.line + ":" + e.detail.handled + ";" })
`;

test("an uncaught runtime error fires the non-cancelable error event with handled 0 and the script's own handling is unchanged (EMIT-9, EMIT-22)", () => {
  const withListener = run(`${ERRORS}nope()\nafter = 1\n`);
  const bare = run(`nope()\nafter = 1\n`);
  equal(globalOf(withListener, "seen"), "unknown.command:<inline>:4:0;");
  equal(globalOf(withListener, "after"), 1, "the program continued with the next step, as without the listener");
  equal(globalOf(bare, "after"), 1);
  equal(withListener.diagnostics.filter((item) => item.code === "unknown.command").length, 1, "the host still receives the one diagnostic");
  const type = withListener.state.vm.objects.find((record) => record.members.type === "error");
  equal(type, undefined, "the delivered event and its detail were collected after delivery");
});

test("a caught kill.system-owned fires the error event with handled 1 and the handler still runs (EMIT-9, EMIT-22)", () => {
  const result = run(`${ERRORS}
function guarded() {
  setErrorHandler(:oops)
  killowned()
  skipped = 1
  return 0
  :oops
  caught = 1
  return 0
}
guarded()
`);
  equal(globalOf(result, "seen"), "kill.system-owned:<inline>:7:1;");
  equal(globalOf(result, "caught"), 1, "the script's own handler took the error");
  equal(Object.hasOwn(result.state.vm.globals, "skipped"), false);
});

test("the resume-next handler counts as handling; a handler that could not be installed because its label is missing does not (EMIT-22)", () => {
  const resumeNext = run(`${ERRORS}
function f() {
  setResumeNextHandler()
  x = nope()
  return 0
}
f()
`);
  equal(globalOf(resumeNext, "seen"), "unknown.command:<inline>:7:1;");
  const missing = run(`${ERRORS}
function f() {
  setErrorHandler(:gone)
  x = nope()
  return 0
}
f()
`);
  equal(
    globalOf(missing, "seen"),
    "handler.unknown-label:<inline>:6:0;unknown.command:<inline>:7:0;",
    "the setErrorHandler call itself failed and set nothing, so neither failure was handled",
  );
});

test("an error callee's failure is reported once and is not seen as handled by its caller's handler (EMIT-22, ERR-1)", () => {
  const result = run(`${ERRORS}
function inner() {
  nope()
  return 0
}
function outer() {
  setErrorHandler(:oops)
  inner()
  return 0
  :oops
  caught = 1
  return 0
}
outer()
`);
  equal(globalOf(result, "seen"), "unknown.command:<inline>:6:0;");
  equal(Object.hasOwn(result.state.vm.globals, "caught"), false);
});

test("debug(false) silences the log but not the event (EMIT-22)", () => {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", ir: "1", text: `${ERRORS}debug(false)\nnope()\n` });
  const { sink, records } = createCollectingSink();
  const services = createScriptServices(state, [], createLogger([sink]));
  for (let tick = 0; tick < 3; tick += 1) advanceScriptTick(state, services);
  equal(records.length, 0, "no log record");
  equal(state.vm.globals.seen, "unknown.command:<inline>:5:0;");
});

test("the event detail holds code, message, file, line and handled in that order, and the event is the game's non-cancelable error (EMIT-22)", () => {
  const result = run(`
game.on("error", (e) => { keys = ""; t = e.type; c = e.cancelable; tg = (e.target == game); m = e.detail.message })
nope()
`);
  equal(globalOf(result, "t"), "error");
  equal(globalOf(result, "c"), 0);
  equal(globalOf(result, "tg"), 1);
  equal(globalOf(result, "m"), 'no built-in or function named "nope"');
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", ir: "1", text: `nope()\n` });
  const services = createScriptServices(state, []);
  runWaitsPhase(state.vm, { tick: 0, events: state.events });
  runThreadsPhase(state.vm, services, STEP_BUDGET);
  const queued = state.events.queue;
  equal(queued.length, 1);
  equal(queued[0]!.emitter, "game");
  const event = state.vm.objects.find((record) => record.handle === queued[0]!.event)!;
  const detailHandle = event.members.detail;
  ok(typeof detailHandle === "object" && detailHandle !== null && "handle" in detailHandle);
  const detail = state.vm.objects.find((record) => record.handle === detailHandle.handle)!;
  deepEqual(detail.keys, ["code", "message", "file", "line", "handled"]);
});

test("an error in a listener of the error event is reported and handled as usual and is not emitted again (EMIT-22)", () => {
  const result = run(`
count = 0
game.on("error", (e) => { count = count + 1; broken() })
nope()
`, 12);
  equal(globalOf(result, "count"), 1, "the first failure was delivered once; the listener's own failure raised no second event");
  deepEqual(result.diagnostics.map((item) => item.code), ["unknown.command", "unknown.command"], "both failures reached the host");
});

test("a failure in a thread an error listener starts is emitted like any other (EMIT-22)", () => {
  const result = run(`
count = 0
game.on("error", (e) => { count = count + 1; if (count < 3) { thread("broken()", 0) } })
nope()
`, 20);
  equal(globalOf(result, "count"), 3);
});

test("an error raised while there are no listeners queues the event and costs nothing else; a later listener is in the list if it registered before delivery (EMIT-14, EMIT-22)", () => {
  const result = run(`nope()\ngame.on("error", (e) => { late = 1 })\n`);
  equal(globalOf(result, "late"), 1, "the listener registered after the failure but before the event was taken heard it");
});

test("an error event reaches a native listener on the game (EMIT-21, EMIT-22)", () => {
  const result = run(`nope()\n`, 6, [{ emitter: "game", type: "error", command: "tsheard" }]);
  equal(result.heard.length, 1);
  deepEqual(result.heard[0]!.event.detail, {
    code: "unknown.command",
    message: 'no built-in or function named "nope"',
    file: "<inline>",
    line: 1,
    handled: 0,
  });
});

// --- The registration seam -------------------------------------------------------------------

test("a section owner registers an emitter once, the engine keeps it alive and its listeners are filed under its key (EMIT-20)", () => {
  const state = createGameState({ seed: 0 });
  const first = registerEmitter(state.vm, state.events, "board:cave");
  const again = registerEmitter(state.vm, state.events, "board:cave");
  equal(first.handle, again.handle, "registering a registered key returns its object and changes nothing");
  equal(state.vm.objects.length, 1);
  startProgram(state.vm, {
    kind: "inline",
    ir: "1",
    text: `log = ""\ncave.on("entered", (e) => { log = log + "e" })\ncave.once("entered", (e) => { log = log + "o" })\ntsemitto("board:cave", "entered")\ncave.emit("entered")\n`,
  });
  const services = createScriptServices(state, [makePlugin([], undefined)]);
  // How a script reaches a board's emitter is its owner's rule (entries 20.4, 20.9); here a global names it.
  state.vm.globals.cave = { kind: "object", handle: first.handle, className: first.className };
  for (let tick = 0; tick < 4; tick += 1) {
    advanceScriptTick(state, services);
    equal(drainDiagnostics(services).length, 0);
  }
  equal(state.vm.globals.log, "eoe", "a TypeScript emit and a script emit reach the board's listeners; the once listener ran for the first only");
  delete state.vm.globals.cave;
  advanceScriptTick(state, services);
  deepEqual([...new Set(state.events.listeners.map((listener) => listener.emitter))], ["board:cave"]);
  equal(state.vm.objects.some((record) => record.handle === first.handle), true, "the registered object survived the end-of-tick pass although no variable names it");
  unregisterEmitter(state.events, "board:cave");
  equal(state.events.listeners.length, 0, "unregistering drops the key's listeners");
  equal(state.events.emitters, undefined, "and the table goes back to its absent shape");
  advanceScriptTick(state, services);
  equal(state.vm.objects.some((record) => record.handle === first.handle), false, "the object is then ordinary garbage");
  unregisterEmitter(state.events, "board:cave");
});

test("a native listener names a registered built-in key before its object exists (EMIT-20, EMIT-21)", () => {
  const state = createGameState({ seed: 0 });
  const heard: Heard[] = [];
  createScriptServices(state, [makePlugin(heard, [{ emitter: "board:cave", type: "entered", command: "tsheard" }])]);
  equal(state.events.listeners[0]!.emitter, "board:cave");
  equal(state.vm.objects.length, 0, "registering a native listener makes no object");
});

test("a native listener that names a command its package does not define is not registered and is warned about (EMIT-21)", () => {
  const state = createGameState({ seed: 0 });
  const { sink, records } = createCollectingSink();
  createScriptServices(state, [makePlugin([], [{ emitter: "game", type: "ping", command: "nosuch" }])], createLogger([sink]));
  equal(state.events.listeners.length, 0);
  deepEqual(records.map((record) => record.code), ["plugin.listener-unknown-command"]);
});

// --- Save and restore ------------------------------------------------------------------------

const SAVE_PROGRAM = `
log = ""
game.on("ping", (e) => { log = log + "a" + e.detail.n })
game.on("ping", (e) => { sleep(2); log = log + "b" })
game.on("error", (e) => { log = log + "E" })
nope()
tsemit("ping", 1)
tsemit("ping", 2)
`;

test("a save taken at every tick restores, does not double the native listener and finishes with the same hash (EMIT-10, EMIT-15, EMIT-21)", () => {
  const heard: Heard[] = [];
  const plugin = makePlugin(heard, PING_LISTENER);
  const straight = createGameState({ seed: 0 });
  startProgram(straight.vm, { kind: "inline", ir: "1", text: SAVE_PROGRAM });
  const straightServices = createScriptServices(straight, [plugin]);
  const ticks = 24;
  const hashes: string[] = [];
  const saves: string[] = [];
  let withEmitters = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    advanceScriptTick(straight, straightServices, 7);
    drainDiagnostics(straightServices);
    hashes.push(hashState(straight as never));
    saves.push(snapshot(straight));
    if (straight.events.emitters !== undefined) withEmitters += 1;
  }
  ok(withEmitters > 0, "some saves hold the emitters table");
  equal((straight.vm.globals.log as string).includes("E"), true, "the error listener ran");
  for (let tick = 0; tick < ticks; tick += 1) {
    const restored = restoreGameState(saves[tick]!);
    const services = createScriptServices(restored, [plugin]);
    verifyRestoredHandles(restored.vm, services, restored.events);
    equal(canon(restored as never), saves[tick], `tick ${tick}: the restored state is the saved one, with no second native listener`);
    for (let next = tick + 1; next < ticks; next += 1) {
      advanceScriptTick(restored, services, 7);
      drainDiagnostics(services);
    }
    equal(hashState(restored as never), hashes[ticks - 1], `a save after tick ${tick} finishes as the unsaved run does`);
  }
});

test("loading refuses an emitters table that names a freed object or one handle under two keys (EMIT-15)", () => {
  const state = createGameState({ seed: 0 });
  registerEmitter(state.vm, state.events, "game");
  const raw = JSON.parse(snapshot(state)) as { events: { emitters: { [key: string]: number } } };
  raw.events.emitters.other = raw.events.emitters.game!;
  let message = "";
  try {
    restoreGameState(JSON.stringify(raw));
  } catch (error) {
    message = (error as Error).message;
  }
  ok(message.includes("events.emitters.other"), message);
  raw.events.emitters = { game: 99 };
  message = "";
  try {
    restoreGameState(JSON.stringify(raw));
  } catch (error) {
    message = (error as Error).message;
  }
  ok(message.includes("events.emitters.game"), message);
});
