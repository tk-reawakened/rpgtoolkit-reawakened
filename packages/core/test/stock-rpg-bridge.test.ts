// The stock RPG actor and dialogue bridges (docs/spec/engine/actors.md, EMIT-13, EMIT-21).
//
// `stock_rpg` keeps its native `actor:*` fallen listener and its real package startup forwards
// completed dialogue to one `talked` event on the speaking actor.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actorEmitterKey,
  actorFromSource,
  addActor,
  advanceScriptTick,
  assetKey,
  COMPILER_VERSION,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  createGameState,
  createCollectingSink,
  createLogger,
  drainDiagnostics,
  ENGINE_DEFAULT_MANIFEST,
  hashGameState,
  killThread,
  PACKAGE_ROOT,
  registerActorObject,
  restoreGameState,
  runPackageStartup,
  snapshot,
  startProgram,
  STEP_BUDGET,
  STOCK_RPG_PLUGIN,
  UI_PLUGIN,
  writeBoard,
} from "../src/index.ts";
import { resolveManifestPlugins } from "../src/engine/boot.ts";
import { createScriptServices } from "./script-test-services.ts";
import { removeActor } from "../src/actors/model.ts";
import { queueNativeEvent } from "../src/events/emitter.ts";
import type { CommandView, Diagnostic, EventView, GameState, PackageCatalogueEntry, PluginDefinition, ResolvedPlugin, ScriptServices, Thread, WaitPoll, WorldBoard } from "../src/index.ts";
import { readEvent } from "../src/events/native.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLUGINS: readonly ResolvedPlugin[] = resolveManifestPlugins(ENGINE_DEFAULT_MANIFEST).plugins;



/** A test package whose listener names one concrete actor key, to prove actor isolation. */
function oneActorListener(): PluginDefinition {
  return {
    id: "bridge-one-actor",
    version: "1.0.0",
    commands: [{
      name: "noteactorone",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view) => {
        if (view.state !== undefined) view.state.vm.globals.noteactorone = Number(view.state.vm.globals.noteactorone ?? 0) + 1;
        return { value: null };
      },
    }],
    listeners: [{ emitter: "actor:1", type: "fallen", command: "noteactorone" }],
  };
}
function fallenGameListener(): PluginDefinition {
  return {
    id: "bridge-game-listener",
    version: "1.0.0",
    commands: [{
      name: "recordfallen",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state !== undefined) {
          const event = readEvent(view.state, args[0]?.value);
          if (event !== undefined) {
            view.state.vm.globals.log = `${String(view.state.vm.globals.log ?? "")}${String(event.detail.actor)}:${String(event.detail.cause)}|`;
          }
        }
        return { value: null };
      },
    }],
    listeners: [{ emitter: "game", type: "stock-rpg.fallen", command: "recordfallen" }],
  };
}


/** A host package that hurts an actor through the owner, so a transition comes from a real operation. */
function hurtPackage(): PluginDefinition {
  return {
    id: "bridge-probe",
    version: "1.0.0",
    commands: [{
      name: "hurt",
      aliases: [],
      params: [
        { name: "id", optional: false, byRef: false, variadic: false },
        { name: "amount", optional: false, byRef: false, variadic: false },
      ],
      call: (view, args) => {
        const actors = view.actors;
        if (actors === undefined) return { value: 0 };
        const id = Number(args[0]?.value ?? 0);
        const before = actors.readActor(id);
        if (before === null) return { value: 0 };
        actors.updateStats(id, { hp: before.stats.hp - Number(args[1]?.value ?? 0) }, { cause: "damage" });
        return { value: before.stats.hp };
      },
    }],
  };
}

/** The host catalogue reads the real `stock_rpg` manifest and its declared startup program. */
function catalogue(): readonly PackageCatalogueEntry[] {
  const folder = join(testDir, "..", "..", "..", "stock", "stock_rpg");
  const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8")) as {
    readonly name: string;
    readonly version: string;
    readonly namespace: string;
    readonly requests: PackageCatalogueEntry["requests"];
    readonly program: string;
  };
  return [{
    name: manifest.name,
    version: manifest.version,
    namespace: manifest.namespace,
    requests: manifest.requests,
    definition: STOCK_RPG_PLUGIN,
    startup: {
      kind: "inline",
      text: readFileSync(join(folder, manifest.program), "utf8"),
      compiler: COMPILER_VERSION,
      dialect: "tk3",
    },
  }];
}

const STOCK_RPG_RESOLVED: readonly ResolvedPlugin[] = resolveManifestPlugins(
  [{ id: "stock_rpg", version: "1.0.0", namespace: "stock_rpg", requests: [] }],
  "main.gam",
  catalogue(),
).plugins;

function startStockRpg(state: GameState, extraPlugins: readonly PluginDefinition[] = []): ScriptServices {
  const services = createScriptServices(state, [UI_PLUGIN, ...STOCK_RPG_RESOLVED, ...extraPlugins]);
  const startups = STOCK_RPG_RESOLVED.flatMap((plugin) => plugin.startup === undefined ? [] : [plugin.startup]);
  runPackageStartup(state, services, startups, STOCK_RPG_RESOLVED);
  return services;
}

type TalkedRun = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly thread: Thread;
  readonly speakerId: number;
  readonly targetId: number;
  readonly heard: EventView[];
};

function prepareTalkedRun(withSource = true, withTarget = true): TalkedRun {
  const state = createGameState({ seed: 0 });
  const speakerActor = addActor(state.actors, { kind: "npc", source: "speaker.tem" });
  const targetActor = addActor(state.actors, { kind: "npc", source: "target.tem" });
  registerActorObject(state.vm, state.events, state.actors, speakerActor.id);
  registerActorObject(state.vm, state.events, state.actors, targetActor.id);
  const board = { coordType: 0 } as WorldBoard;
  const speaker = actorFromSource({
    id: "dialogue-speaker",
    kind: "player",
    source: "speaker.tem",
    actorId: speakerActor.id,
    x: 0,
    y: 0,
    layer: 0,
  }, board, 0, null);
  const target = actorFromSource({
    id: "dialogue-target",
    kind: "player",
    source: "target.tem",
    actorId: targetActor.id,
    x: 1,
    y: 0,
    layer: 0,
  }, board, 0, null);
  state.sprites.players.push(speaker, target);
  const heard: EventView[] = [];
  const probe: PluginDefinition = {
    id: "talked-probe",
    version: "1.0.0",
    commands: [{
      name: "recordtalked",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state !== undefined) {
          const event = readEvent(view.state, args[0]?.value);
          if (event !== undefined) heard.push(event);
        }
        return { value: null };
      },
    }],
    listeners: [
      { emitter: actorEmitterKey(speakerActor.id), type: "talked", command: "recordtalked" },
      { emitter: actorEmitterKey(targetActor.id), type: "talked", command: "recordtalked" },
    ],
  };
  const services = startStockRpg(state, [probe]);
  const thread = startProgram(state.vm, {
    kind: "inline",
    text: 'result = dialogue("Hello, <name>")\nend()\n',
    compiler: COMPILER_VERSION,
  });
  if (withSource) thread.source = speaker.id;
  if (withTarget) thread.target = target.id;
  state.vm.globals.name = "Ada";
  return { state, services, thread, speakerId: speakerActor.id, targetId: targetActor.id, heard };
}

const acceptEnter: WaitPoll = (_view, wait) =>
  wait.kind === "input.key" ? { value: "Enter", ok: true } : null;

test("stock_rpg forwards completed dialogue to the speaker with exact details", () => {
  const run = prepareTalkedRun();
  advanceScriptTick(run.state, run.services);
  equal(run.thread.wait?.kind, "input.key");
  advanceScriptTick(run.state, run.services, STEP_BUDGET, acceptEnter);
  equal(run.thread.status, "finished");
  equal(run.state.vm.globals.result, "Enter");
  deepEqual(run.heard.map((event) => ({
    type: event.type,
    emitter: event.emitter,
    detail: event.detail,
  })), [{
    type: "talked",
    emitter: actorEmitterKey(run.speakerId),
    detail: { actorId: run.speakerId, targetId: run.targetId, text: "Hello, Ada" },
  }]);
  equal(run.state.events.queue.length, 0);
});

test("stock_rpg preserves native null targetId and emits only to the speaker", () => {
  const run = prepareTalkedRun(true, false);
  advanceScriptTick(run.state, run.services);

  advanceScriptTick(run.state, run.services, STEP_BUDGET, acceptEnter);
  deepEqual(run.heard.map(({ emitter, detail: eventDetail }) => ({ emitter, detail: eventDetail })), [{
    emitter: actorEmitterKey(run.speakerId),
    detail: { actorId: run.speakerId, targetId: null, text: "Hello, Ada" },
  }]);
});

test("stock_rpg preserves a queued target ID removed before dialogue completion dispatch", () => {
  const run = prepareTalkedRun();
  queueNativeEvent(run.state.vm, run.state.events, "game", "dialogue.completed", {
    actorId: run.speakerId,
    targetId: run.targetId,
    text: "Hello, Ada",
  });
  equal(removeActor(run.state.actors, run.targetId), true);
  killThread(run.state.vm, run.thread.id);
  advanceScriptTick(run.state, run.services);
  equal(run.state.events.queue.length, 0, "the queued completion event was dispatched");
  deepEqual(run.heard.map(({ emitter, detail }) => ({ emitter, detail })), [{
    emitter: actorEmitterKey(run.speakerId),
    detail: { actorId: run.speakerId, targetId: run.targetId, text: "Hello, Ada" },
  }]);
});

test("stock_rpg emits no talked event when dialogue is interrupted or lacks a source", () => {
  const interrupted = prepareTalkedRun();
  advanceScriptTick(interrupted.state, interrupted.services);
  killThread(interrupted.state.vm, interrupted.thread.id);
  advanceScriptTick(interrupted.state, interrupted.services, STEP_BUDGET, acceptEnter);
  equal(interrupted.heard.length, 0);

  const missingSource = prepareTalkedRun(false);
  advanceScriptTick(missingSource.state, missingSource.services);
  ok(drainDiagnostics(missingSource.services).some(({ code }) => code === "dialogue.no-source"));
  equal(missingSource.heard.length, 0);
});

test("stock_rpg startup runs again on reset of the same engine without duplicating its listener", () => {
  const entry = catalogue()[0]!;
  const plugins = resolveManifestPlugins(
    [{ id: "stock_rpg", version: "1.0.0", namespace: "stock_rpg", requests: [] }],
    "main.gam",
    [entry],
  ).plugins;
  let resetRequested = false;
  let resets = 0;
  const latest: { state: GameState | null } = { state: null };
  const engine = createEngine({
    seed: 0,
    assetIndex: createAssetIndex([assetKey("boards/test.brd")]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 20,
    program: "end()\n",
    plugins,
    packageCatalogue: [entry],
    phaseRegistrations: [{
      phase: "audio",
      run: (state, postEffect) => {
        latest.state = state;
        if (resetRequested || !state.events.listeners.some(({ emitter, type }) => emitter === "game" && type === "dialogue.completed")) return;
        resetRequested = true;
        postEffect?.("engine", { thread: 0, name: "reset", kind: "state-write", args: [], out: {}, result: null, patch: null, wait: null, request: null });
      },
    }],
    resetRegistrations: [{ section: "events", reset: () => { resets += 1; } }],
  });
  let report = engine.advance(0, []);
  for (let guard = 0; guard < 10 && resets === 0; guard += 1) {
    const replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: BOARD } }]
      : []);
    report = engine.advance(report.loading ? 0 : 1, replies);
  }
  equal(resets, 1, "the engine lifecycle reset ran once");
  const finalState = latest.state;
  if (finalState === null) throw new Error("the engine did not reach the audio phase after reset");
  equal(finalState.events.listeners.filter(({ emitter, type }) =>
    emitter === "game" && type === "dialogue.completed"
  ).length, 1, "the same engine reran stock_rpg startup exactly once after reset");
});

test("stock_rpg rejects malformed dialogue details and unknown actor IDs at its command boundary", () => {
  const command = STOCK_RPG_PLUGIN.commands.find(({ name }) => name === "bridgetalked");
  if (command === undefined) throw new Error("stock_rpg must expose bridgetalked");
  for (const { emitter, type, detail } of [
    { emitter: "game", type: "dialogue.completed", detail: { actorId: 999, targetId: null, text: "unknown actor" } },
    { emitter: "game", type: "dialogue.completed", detail: { actorId: 1, targetId: "not-an-actor", text: "malformed target" } },
    { emitter: "game", type: "unrelated.event", detail: { actorId: 1, targetId: null, text: "wrong event type" } },
    { emitter: actorEmitterKey(1), type: "dialogue.completed", detail: { actorId: 1, targetId: null, text: "wrong emitter" } },
  ]) {
    const run = prepareTalkedRun();
    const eventHandle = queueNativeEvent(run.state.vm, run.state.events, emitter, type, detail);
    const eventObject = run.state.vm.objects.find(({ handle }) => handle === eventHandle);
    if (eventObject === undefined) throw new Error("native dialogue event was not materialized");
    const result = command.call(
      { state: run.state, actors: run.services.actors } as CommandView,
      [{ value: { kind: "object", handle: eventHandle, className: eventObject.className }, ref: null }],
      () => ({ value: null }),
    );
    equal(result.value, 0, JSON.stringify(detail));
    deepEqual(result.effects ?? [], [], JSON.stringify(detail));
  }
});

type BridgeRun = {
  readonly state: GameState;
  readonly diagnostics: readonly Diagnostic[];
  readonly snapshots: readonly string[];
  readonly hashes: readonly string[];
};

const BOARD = (() => {
  const encoded = writeBoard(createEmptyBoard());
  if (!encoded.ok) throw new Error(encoded.error.message);
  return encoded.value;
})();

const SCRIPT = [
  "spawn(10)",
  "spawn(10)",
  "log = \"\"",
  "hurt(1, 10)",
  "hurt(1, 10)",
  "hurt(2, 4)",
  "hurt(2, 6)",
  "sleep(4)",
  "ended = 1",
  "end()",
].join("\n");

function runBridge(): BridgeRun {
  const hashes: string[] = [];
  const snapshots: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const capture: { state: GameState | null } = { state: null };
  let recorded = -1;
  const spawn: PluginDefinition = {
    id: "bridge-spawn",
    version: "1.0.0",
    commands: [{
      name: "spawn",
      aliases: [],
      params: [{ name: "hp", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        if (view.state === undefined) return { value: 0 };
        const hp = Number(args[0]?.value ?? 0);
        const actor = addActor(view.state.actors, {
          kind: "party",
          source: "hero.tem",
          stats: { experience: 0, hp, maxHp: hp, dp: 0, fp: 0, smp: 0, maxSmp: 0, level: 1, criticalOn: 0, criticalBy: 0 },
        });
        registerActorObject(view.state.vm, view.state.events, view.state.actors, actor.id);
        return { value: actor.id };
      },
    }],
  };
  const stockRpgPackage = catalogue().find((entry) => entry.name === "stock_rpg");
  if (stockRpgPackage === undefined) throw new Error("stock_rpg must be present in the host catalogue");
  const stockRpgStartup = stockRpgPackage.startup;
  if (stockRpgStartup === undefined) throw new Error("stock_rpg package has no startup program");
  const engine = createEngine({
    seed: 3,
    assetIndex: createAssetIndex([assetKey("boards/test.brd")]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 600,
    program: SCRIPT,
    plugins: [...DEFAULT_PLUGINS, { definition: fallenGameListener() }, { definition: oneActorListener() }, { definition: hurtPackage() }, { definition: spawn }, { namespace: "stock_rpg", definition: stockRpgPackage.definition, startup: stockRpgStartup }],
    packageCatalogue: catalogue(),
    phaseRegistrations: [{
      phase: "audio",
      run: (state) => {
        capture.state = state;
        if (state.time.tick === recorded) return;
        recorded = state.time.tick;
        snapshots.push(snapshot(state));
        hashes.push(hashGameState(state));
      },
    }],
  });
  let report = engine.advance(0, []);
  diagnostics.push(...report.diagnostics);
  for (let guard = 0; guard < 400; guard += 1) {
    const replies = report.requests.flatMap((request) => request.kind === "asset"
      ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: request.key === assetKey("boards/test.brd") ? BOARD : null } }]
      : []);
    report = engine.advance(report.loading ? 0 : 1, replies);
    diagnostics.push(...report.diagnostics);
    if (report.loading) continue;
    if (capture.state !== null && Number(capture.state.vm.globals.ended ?? 0) === 1) break;
  }
  if (capture.state === null) throw new Error("the bridge script never ran");
  ok(Number(capture.state.vm.globals.ended ?? 0) === 1, "the bridge script must reach end()");
  return { state: capture.state, diagnostics, snapshots, hashes };
}

test("every actor fallen transition is one stock-rpg.fallen event on the game", () => {
  const run = runBridge();
  equal(run.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("plugin.listener")).length, 0);
  equal(run.state.events.listeners.some((listener) => listener.emitter === "game" && listener.type === "dialogue.completed"), true, "the real stock package startup registers its game listener");
  ok(run.state.events.listeners.some((listener) => listener.emitter === "actor:*" && listener.type === "fallen" && listener.callable.def === "bridgefallen"), "stock_rpg registers its native actor listener");
  ok(run.state.events.listeners.some((listener) => listener.emitter === "game" && listener.type === "stock-rpg.fallen" && listener.callable.def === "recordfallen"), "the game event probe is registered");
  // Two HP-zero writes on the first actor: the transition happens once, so one re-emit; the
  // second actor falls on its second hit. Actor isolation holds and no duplicate is delivered.
  equal(run.state.vm.globals.log, "1:damage|2:damage|");
  equal(String(run.state.vm.globals.log).split("|").length - 1, 2, "one game event per transition");
  equal(run.state.vm.globals.noteactorone, 1, "a listener on actor:1 hears only that actor's transition");
  deepEqual(run.state.actors.actors.map((actor) => actor.stats.hp), [0, 0]);
});

test("a restored save delivers the same bridge events and hashes the same", () => {
  const run = runBridge();
  ok(run.snapshots.length > 2, "the bridge must span several ticks");
  run.snapshots.forEach((json, index) => {
    equal(hashGameState(restoreGameState(json)), run.hashes[index], `tick ${index} restores to its own hash`);
  });
  const again = runBridge();
  deepEqual([...again.hashes], [...run.hashes]);
  equal(again.state.vm.globals.log, run.state.vm.globals.log);
});

test("an unsupported listener pattern is a located warning and registers nothing", () => {
  for (const emitter of ["actor:*:x", "board:*", "game*", "*"]) {
    const state = createGameState({ seed: 0 });
    const { sink, records } = createCollectingSink();
    const definition: PluginDefinition = {
      id: "broken-bridge",
      version: "1.0.0",
      commands: [{ name: "nop", aliases: [], params: [], call: () => ({ value: null }) }],
      listeners: [{ emitter, type: "fallen", command: "nop" }],
    };
    createScriptServices(state, [{ definition }], createLogger([sink]));
    equal(state.events.listeners.length, 0, `${emitter} registers nothing`);
    deepEqual(records.filter((record) => record.code.startsWith("plugin.listener")).map((record) => record.code), ["plugin.listener-bad-emitter"], emitter);
  }
});
