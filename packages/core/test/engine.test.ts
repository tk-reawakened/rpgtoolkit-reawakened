import { deepEqual, equal } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { addActor, applyEmitterOp, COMPILER_VERSION, createAssetIndex, createEmptyBoard, createEmptyMainFile, createEngine, ENGINE_PHASES, ENGINE_PLUGIN_TABLE, PACKAGE_ROOT, writeBoard, writeMainFile, type Board, type EffectRecord, type GameState, type PluginDefinition, type ResolvedPlugin } from "../src/index.ts";

function boardBytes(board: Board): Uint8Array {
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

test("createEngine exposes its initial board request at advance(0) and missing bytes unblock loading", () => {
  const engine = createEngine({ seed: 7, assetIndex: createAssetIndex(["Boards/start.brd"]), assetRoot: PACKAGE_ROOT, initialBoard: "start.brd", width: 512, height: 384, maxTicks: 8 });
  const first = engine.advance(0, []);
  equal(first.requests.length, 1);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  equal(request.reqId, 1);
  deepEqual(request.key, "boards/start.brd");
  equal(first.loading, true);
  const missing = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(missing.ticksRun, 0);
  equal(missing.loading, false);
  equal(missing.diagnostics[0]?.code, "asset.missing");
});

test("engine queues non-asset inputs while loading and respects consuming ticks", () => {
  const engine = createEngine({ seed: 7, assetIndex: createAssetIndex(["Boards/start.brd"]), assetRoot: PACKAGE_ROOT, initialBoard: "start.brd", width: 512, height: 384, maxTicks: 8 });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const futureReply = engine.advance(0, [{ tick: 1, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(futureReply.consumed.length, 0);
  const queued = engine.advance(0, [{ tick: 0, event: { kind: "key", name: "A", code: "KeyA", char: "a", down: true } }]);
  equal(queued.consumed.length, 0);
  const failed = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: null } }]);
  equal(failed.consumed.length, 1);
  const afterFailure = engine.advance(0, []);
  equal(afterFailure.consumed.length, 1);
  equal(afterFailure.consumed[0]?.event.kind, "key");
});

function loadedEngine(registrations: Parameters<typeof createEngine>[0]["phaseRegistrations"] = []) {
  const board = createEmptyBoard();
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 60,
    phaseRegistrations: registrations,
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  if (loaded.loading) throw new Error("expected authored board to load");
  return engine;
}

test("createEngine routes actor alias writes through package behaviour hooks", () => {
  const plugin: ResolvedPlugin = {
    namespace: "engine-actors",
    definition: {
      id: "engine-actors",
      version: "1.0.0",
      commands: [],
      behaviourStartup(register) {
        register("engine-actors.hero", { statsChanged: () => ({ dp: 33 }) });
      },
    },
  };
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  let seen: GameState["actors"]["actors"][number] | undefined;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "HP! = 5\n",
    plugins: [plugin],
    phaseRegistrations: [
      {
        phase: "input",
        run: (state) => {
          if (state.time.tick !== 0) return;
          const actor = addActor(state.actors, {
            kind: "party",
            source: "hero.tem",
            behaviour: "engine-actors.hero",
            stats: { hp: 10, maxHp: 10, dp: 1 },
          });
          state.party.members = [actor.id];
          state.party.selected = actor.id;
        },
      },
      {
        phase: "movement",
        run: (state) => { seen = state.actors.actors[0]; },
      },
    ],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected authored board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encoded.value } }]);
  engine.advance(3, []);
  equal(seen?.stats.hp, 5);
  equal(seen?.stats.dp, 33);
});

test("createEngine preserves manifest package behaviours and actor operations across reset", () => {
  let registrations = 0;
  let startupProgramRuns = 0;
  let retainedGuardFailures = 0;
  let retainedView: { readonly packageStartup?: boolean; readonly rng: { readonly nextUint32: () => number } } | undefined;
  const plugin: PluginDefinition = {
    id: "test-reset-package",
    version: "1.0.0",
    commands: [{
      name: "seedactor",
      aliases: [],
      params: [],
      call: (view) => {
        if (view.state !== undefined) {
          const actor = addActor(view.state.actors, {
            kind: "party",
            source: "hero.tem",
            behaviour: "test-reset-package.hero",
            stats: { hp: 10, maxHp: 10, dp: 1 },
          });
          view.state.party.members = [actor.id];
          view.state.party.selected = actor.id;
        }
        return { value: null };
      },
    }, {
      name: "countstartup",
      aliases: [],
      params: [],
      call: (view) => {
        if (retainedView === undefined) retainedView = view;
        else if (view.packageStartup) {
          try { retainedView.rng.nextUint32(); } catch { retainedGuardFailures += 1; }
        }
        startupProgramRuns += 1;
        return { value: null };
      },
    }],
    behaviourStartup(register) {
      registrations += 1;
      register("test-reset-package.hero", { statsChanged: () => ({ dp: 42 }) });
    },
  };
  const resolvedPlugin: ResolvedPlugin = {
    definition: plugin,
    startup: { kind: "inline", text: "countstartup()\nend()\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  };
  const main = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    projectPath: "",
    plugins: [],
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    packagePluginsExtension: true,
    packagePlugins: ["test-reset-package"],
  });
  if (!main.ok) throw new Error(main.error.message);
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const files = new Map([
    ["main.gam", main.value],
    ["prg/start.prg", new TextEncoder().encode("seedactor()\nHP! = 5\nend()\n")],
    ["boards/start.brd", board.value],
    ["chrs/hero.tem", new Uint8Array([0])],
  ]);
  const table = ENGINE_PLUGIN_TABLE as Record<string, PluginDefinition>;
  const previous = table["test-reset-package"];
  table["test-reset-package"] = plugin;
  try {
    let resetRequested = false;
    let latestActor: GameState["actors"]["actors"][number] | undefined;
    const engine = createEngine({
      seed: 7,
      assetIndex: createAssetIndex([...files.keys()]),
      assetRoot: PACKAGE_ROOT,
      mainFile: "main.gam",
      plugins: [resolvedPlugin],
      startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
      width: 32,
      height: 32,
      maxTicks: 8,
      phaseRegistrations: [
        {
          phase: "events",
          run: (state, postEffect) => {
            if (state.time.tick === 2 && !resetRequested) {
              resetRequested = true;
              postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
            }
          },
        },
        { phase: "movement", run: (state) => { latestActor = state.actors.actors[0]; } },
      ],
    });
    let report = engine.advance(0, []);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const replies = report.requests.flatMap((request) => {
        if (request.kind !== "asset") return [];
        return [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? null } }];
      });
      report = engine.advance(report.loading ? 0 : 1, replies);
    }
    equal(resetRequested, true);
    equal(registrations, 2);
    equal(startupProgramRuns, 2);
    equal(retainedGuardFailures, 1);
    equal(latestActor?.stats.hp, 5);
    equal(latestActor?.stats.dp, 42);
  } finally {
    if (previous === undefined) delete table["test-reset-package"];
    else table["test-reset-package"] = previous;
  }
});

test("createEngine runs inline-program package startup exactly once", () => {
  let registrations = 0;
  const plugin: PluginDefinition = {
    id: "test-inline-package",
    version: "1.0.0",
    commands: [],
    behaviourStartup(register) {
      registrations += 1;
      register("test-inline-package.hero", { statsChanged: () => ({ dp: 1 }) });
    },
  };
  createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "end()\n",
    plugins: [{ definition: plugin }],
  });
  equal(registrations, 1);
});
test("createEngine installs one native listener for inline package boot", () => {
  let listenerCalls = 0;
  const plugin: PluginDefinition = {
    id: "test-inline-listener-package",
    version: "1.0.0",
    commands: [{ name: "onping", aliases: [], params: [{ name: "event", optional: false, byRef: false, variadic: false }], call: () => { listenerCalls += 1; return { value: null }; } }],
    listeners: [{ emitter: "game", type: "ping", command: "onping" }],
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: 'game.emit("ping")\nend()\n',
    plugins: [{ definition: plugin }],
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected authored board request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: boardBytes(createEmptyBoard()) } }]);
  engine.advance(2, []);
  equal(listenerCalls, 1);
});
test("createEngine does not start inline main program after package startup failure", () => {
  let mainRuns = 0;
  const plugin: ResolvedPlugin = {
    definition: {
      id: "test-inline-failure-package",
      version: "1.0.0",
      commands: [{
        name: "markmain",
        aliases: [],
        params: [],
        call: () => {
          mainRuns += 1;
          return { value: null };
        },
      }],
    },
    startup: { kind: "inline", text: "sleep(1)\n", compiler: COMPILER_VERSION, dialect: "tk3" },
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "markmain()\nend()\n",
    plugins: [plugin],
  });
  engine.advance(0, []);
  equal(mainRuns, 0);
});


test("engine runs the fixed phase order, registers audio after animation, and pauses on focus loss", () => {
  deepEqual(ENGINE_PHASES, ["input", "waits", "threads", "events", "movement", "edges", "triggers", "animation", "audio", "time"]);
  const phases: string[] = [];
  const engine = loadedEngine([
    { phase: "movement", run: (state) => phases.push(`movement:${state.time.tick}`) },
    { phase: "events", run: (state) => phases.push(`events:${state.time.tick}`) },
    { phase: "audio", run: (state) => phases.push(`audio:${state.time.tick}`) },
  ]);
  const paused = engine.advance(2, [{ tick: 0, event: { kind: "focus", state: "lost" } }]);
  equal(paused.ticksRun, 0);
  const resumed = engine.advance(60, [{ tick: 0, event: { kind: "focus", state: "gained" } }], 2);
  equal(resumed.ticksRun, 2);
  equal(resumed.tickAfter, 2);
  deepEqual(phases, ["events:0", "movement:0", "audio:0", "events:1", "movement:1", "audio:1"]);
});

test("engine displays no-enemies handoffs, reports custom starts for owner ruling, and rejects absent stock_battle", () => {
  let triggerCount = 0;
  const observed: { state: GameState | null } = { state: null };
  const uiEffects: EffectRecord[] = [];
  const board = createEmptyBoard();
  const encodedBoard = writeBoard(board);
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{
      phase: "triggers",
      run: (state, post) => {
        observed.state = state;
        if (post === undefined || triggerCount >= 3) return;
        const noEnemies = triggerCount === 0;
        const randomEncounter = triggerCount === 1;
        triggerCount += 1;
        const common = {
          trigger: "random",
          board: { key: "boards/test.brd", skill: 1, background: "night.bkg" },
          actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 0, y: 0, layer: 1 },
        };
        const payload = noEnemies
          ? { ...common, message: "No enemies of skill level 1 found." }
          : randomEncounter
            ? {
                ...common,
                fighters: [
                  { party: "player", id: "player:0", index: 0, source: "hero.tem", skill: null },
                  { party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 },
                ],
              }
            : { ...common, program: "custom.prg" };
        const name = noEnemies ? "battle.noEnemies" : randomEncounter ? "battle.randomEncounter" : "battle.customFight";
        post("battle", {
          thread: 0,
          name,
          args: [payload],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    }],
    effectAppliers: [{ section: "ui", applier: (effect) => uiEffects.push(effect) }],
  });
  const initial = engine.advance(0, []);
  const request = initial.requests[0];
  if (request?.kind !== "asset") throw new Error("expected initial board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: encodedBoard.value } }]);
  equal(loaded.loading, false);

  engine.advance(1, []);
  equal(uiEffects[0]?.name, "mwin");
  equal(uiEffects[0]?.args[0], "No enemies of skill level 1 found.");
  engine.advance(1, []);
  const missingPackage = engine.advance(1, []);
  equal(missingPackage.diagnostics.some((diagnostic) => diagnostic.code === "battle.package-missing"), true);
  equal(missingPackage.diagnostics.some((diagnostic) => diagnostic.code === "battle.custom-fight-owner-ruling"), true);
  equal(observed.state?.battle, null);
});

function programEngine(program: string, registrations: NonNullable<Parameters<typeof createEngine>[0]["phaseRegistrations"]>) {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program,
    phaseRegistrations: registrations,
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

test("the events phase delivers an emit made earlier in the tick; an emit made by a later phase waits for the next tick (EMIT-3, EMIT-14)", () => {
  const seen: string[] = [];
  const engine = programEngine(
    'log = ""\nh = {}\nh.on("x", (e) => { log = log + "x" })\nh.on("late", (e) => { log = log + "L" })\nh.emit("x")\n',
    [
      {
        phase: "movement",
        run: (state) => {
          if (state.time.tick === 0) {
            const emitter = state.vm.globals.h;
            if (typeof emitter !== "object" || emitter === null || !("kind" in emitter) || emitter.kind !== "object") {
              throw new Error("expected h to be an emitter object");
            }
            applyEmitterOp(state.vm, state.events, "emit", emitter, ["late"], null);
          }
        },
      },
      { phase: "audio", run: (state) => seen.push(`${state.time.tick}:${String(state.vm.globals.log)}`) },
    ],
  );
  const report = engine.advance(3, []);
  equal(report.diagnostics.length, 0);
  deepEqual(seen, ["0:x", "1:xL", "2:xL"]);
});

test("the events section is part of the state hash and a mid-dispatch run replays to the same hash", () => {
  const program = 'h = {}\nh.on("x", (e) => { for (i = 0; i < 400; i = i + 1) { n = i } })\nh.emit("x")\nh.emit("x")\n';
  const straight = programEngine(program, []);
  const split = programEngine(program, []);
  const final = straight.advance(6, []);
  for (let tick = 0; tick < 6; tick += 1) split.advance(1, []);
  equal(split.advance(0, []).stateHash, final.stateHash);
});

test("batching the same stamped input log produces the same state hash", () => {
  const one = loadedEngine();
  const batched = loadedEngine();
  const inputs = [
    { tick: 0, event: { kind: "key" as const, name: "A", code: "KeyA", char: "a", down: true } },
    { tick: 12, event: { kind: "pointer" as const, x: 4, y: 5, buttons: 1 } },
    { tick: 30, event: { kind: "key" as const, name: "A", code: "KeyA", char: "a", down: false } },
  ];
  for (let tick = 0; tick < 60; tick += 1) one.advance(1, inputs.filter((input) => input.tick === tick));
  const final = batched.advance(60, inputs);
  equal(final.ticksRun, 60);
  equal(final.stateHash, one.advance(0, []).stateHash);
});

test("an authored RPGCode program executes through the engine VM", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: "x = 1\nsleep(1)\nend()\n",
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  const started = engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  equal(started.ticksRun, 1);
  equal(started.diagnostics.length, 0);
  const resumed = engine.advance(1, []);
  equal(resumed.ticksRun, 1);
  equal(resumed.diagnostics.length, 0);
});

function breakpointEngine(program: string, seed = 7) {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program,
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

test("breakpoints stop inside a tick and continue to the uninterrupted hash", () => {
  const uninterrupted = breakpointEngine("x = 1\nx = 2\nend()\n");
  const debugged = breakpointEngine("x = 1\nx = 2\nend()\n");
  const baseline = uninterrupted.advance(1, []);
  debugged.setBreakpoints([{ file: "<inline>", line: 2 }]);
  const stopped = debugged.advance(2, []);
  equal(stopped.ticksRun, 0);
  equal(stopped.tickAfter, 0);
  equal(stopped.paused?.line, 2);
  const resumed = debugged.advance(1, []);
  equal(resumed.ticksRun, 1);
  equal(resumed.paused, null);
  equal(resumed.stateHash, baseline.stateHash);
});

test("breakpoints that never hit preserve every tick hash", () => {
  const plain = breakpointEngine("x = 1\nend()\n", 11);
  const debugged = breakpointEngine("x = 1\nend()\n", 11);
  debugged.setBreakpoints([{ file: "<inline>", line: 99 }]);
  for (let tick = 0; tick < 3; tick += 1) equal(debugged.advance(1, []).stateHash, plain.advance(1, []).stateHash);
});

test("step resume executes one VM instruction and pauses again", () => {
  const engine = breakpointEngine("x = 1\nx = 2\nend()\n", 13);
  engine.setBreakpoints([{ file: "<inline>", line: 2 }]);
  const stopped = engine.advance(1, []);
  equal(stopped.paused?.line, 2);
  const stepped = engine.advance(0, [], undefined, "step");
  equal(stepped.ticksRun, 0);
  equal(stepped.tickAfter, 0);
  equal(stepped.paused?.thread, 1);
});

function authoredBmp(): Uint8Array {
  const bytes = new Uint8Array(62);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  const put32 = (at: number, value: number): void => {
    bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; bytes[at + 2] = (value >>> 16) & 255; bytes[at + 3] = (value >>> 24) & 255;
  };
  const put16 = (at: number, value: number): void => { bytes[at] = value & 255; bytes[at + 1] = (value >>> 8) & 255; };
  put32(2, 62); put32(10, 54); put32(14, 40); put32(18, 2); put32(22, 1); put16(26, 1); put16(28, 24); put32(34, 8);
  bytes.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return bytes;
}

function authoredBoard(backgroundImage = ""): Uint8Array {
  const empty = createEmptyBoard();
  const board = { ...empty, properties: { ...empty.properties, backgroundImage } };
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
}

function pixelsAfter(command: string, boardBytes = authoredBoard()): Uint8Array {
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/pixel.bmp"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 4,
    height: 2,
    maxTicks: 20,
    program: `createcanvas(4, 2, c)\n${command}\nend()\n`,
  });
  let result = engine.advance(0, []);
  for (let step = 0; step < 8; step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === "boards/test.brd" ? boardBytes : authoredBmp() } }));
    result = engine.advance(1, events);
    if (result.requests.length === 0 && !result.loading) break;
  }
  const surface = engine.surfacePixels(1 as never, 1) ?? engine.surfacePixels(1 as never, 2) ?? engine.surfacePixels(1 as never, 0);
  if (surface === null) throw new Error("expected rendered screen pixels");
  return surface.rgba;
}

test("image graphics command families apply exact decoded pixels", () => {
  deepEqual(pixelsAfter('bitmap("pixel.bmp", c)').slice(0, 8), new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]));
  deepEqual(pixelsAfter('setimage("pixel.bmp", 1, 0, 2, 1, c)').slice(4, 12), new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
  deepEqual(pixelsAfter('setimagetransparent("pixel.bmp", 0, 0, 2, 1, 255, 0, 0, c)').slice(0, 8), new Uint8Array([0, 0, 0, 0, 0, 255, 0, 255]));
  deepEqual(pixelsAfter('setimagetranslucent("pixel.bmp", 0, 0, 2, 1, c)').slice(0, 8), new Uint8Array([128, 0, 0, 255, 0, 128, 0, 255]));
  deepEqual(pixelsAfter('setimageadditive("pixel.bmp", 0, 0, 2, 1, 50, c)').slice(0, 8), new Uint8Array([127, 0, 0, 255, 0, 127, 0, 255]));
});

test("board preview image pixels are applied after the image reply", () => {
  const rgba = pixelsAfter('viewbrd("test.brd", 0, 0, c)', authoredBoard("pixel.bmp"));
  deepEqual(rgba.slice(0, 8), new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
});

test("missing image reply is located and leaves the screen unchanged", () => {
  const engine = createEngine({ seed: 19, assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/pixel.bmp"]), assetRoot: PACKAGE_ROOT, initialBoard: "test.brd", width: 4, height: 2, maxTicks: 20, program: 'createcanvas(4, 2, c)\nsetimage("pixel.bmp", 0, 0, 2, 1, c)\nend()\n' });
  let result = engine.advance(0, []);
  for (let step = 0; step < 6; step += 1) {
    const events = result.requests.filter((request) => request.kind === "asset").map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === "boards/test.brd" ? authoredBoard() : null } }));
    result = engine.advance(1, events);
    if (result.diagnostics.some((diagnostic) => diagnostic.code === "asset.missing")) break;
  }
  const surface = engine.surfacePixels(1 as never, 1) ?? engine.surfacePixels(1 as never, 2) ?? engine.surfacePixels(1 as never, 0);
  if (surface === null) throw new Error("expected unchanged screen pixels");
  deepEqual(surface.rgba, new Uint8Array(4 * 2 * 4));
  equal(result.diagnostics.some((diagnostic) => diagnostic.code === "asset.missing" && diagnostic.file === "bitmap/pixel.bmp"), true);
});

test("engine classifies .tbm board-image dependencies as tile requests", () => {
  const empty = createEmptyBoard();
  const board: Board = {
    ...empty,
    images: [{
      file: "tiles.tbm",
      left: 0,
      top: 0,
      layer: 0,
      drawType: 0,
      transparent: { r: 255, g: 0, b: 255 },
      reserved: 0,
    }],
  };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd", "Bitmap/tiles.tbm"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 1,
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: boardBytes(board) } }]);
  const imageRequest = loaded.requests[0];
  if (imageRequest?.kind !== "asset") throw new Error("expected tile bitmap request");
  equal(imageRequest.key, "bitmap/tiles.tbm");
});

test("engine classifies .tan tile-animation dependencies as tile requests", () => {
  const board: Board = { ...createEmptyBoard(), lut: ["anim.tan"] };
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd", "Tiles/anim.tan"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 1,
  });
  const initial = engine.advance(0, []);
  const boardRequest = initial.requests[0];
  if (boardRequest?.kind !== "asset") throw new Error("expected board request");
  const loaded = engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: boardRequest.reqId, bytes: boardBytes(board) } }]);
  const animationRequest = loaded.requests[0];
  if (animationRequest?.kind !== "asset") throw new Error("expected tile animation request");
  equal(animationRequest.key, "tiles/anim.tan");
});

test("the end-of-tick object pass runs in the engine as it does in the script host (R-34)", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
    program: "class Box {\n  public:\n  var v\n  method Box(x) { v = x }\n}\na = Box(1)\nsleep(1)\na = 0\nsleep(1)\nend()\n",
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  const initialObjects = latest!.vm.objects.length;
  equal(initialObjects > 1, true, "built-in actor and event objects remain rooted alongside the script object");
  engine.advance(1, []);
  equal(latest!.vm.objects.length, initialObjects - 1, "the tick that dropped the last script reference frees only that object");
});

test("the engine frees a closure cell no script can reach, then the objects it alone kept (R-34, FUN-8)", () => {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  let latest: GameState | null = null;
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state; } }],
    program: [
      "class Box {",
      "  public:",
      "  var v",
      "  method Box(x) { v = x }",
      "}",
      "function mk() {",
      "  local(o)",
      "  o = Box(1)",
      "  return () => o",
      "}",
      "f = mk()",
      "sleep(1)",
      "f = 0",
      "sleep(1)",
      "end()",
      "",
    ].join("\n"),
  });
  const request = engine.advance(0, []).requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(1, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  deepEqual(Object.keys(latest!.vm.cells ?? {}), ["cell1"], "the closure's cell is reachable through f");
  const initialObjects = latest!.vm.objects.length;
  equal(initialObjects > 1, true, "built-in actor and event objects remain rooted alongside the closure-owned object");
  engine.advance(1, []);
  deepEqual(Object.keys(latest!.vm.cells ?? {}), [], "the tick that dropped f frees its cell");
  equal(latest!.vm.objects.length, initialObjects - 1, "and the object only that cell named is freed in the same pass");
});
