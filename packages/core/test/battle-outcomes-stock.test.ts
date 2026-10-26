import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import { UI_PLUGIN } from "../src/script/packs/ui.ts";
import {
  addActor,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createGameState,
  createPluginLayers,
  createScriptServices,
  defaultWaitPoll,
  fileProgramRef,
  hashGameState,
  nextUint32,
  PACKAGE_ROOT,
  registerActorObject,
  restoreGameState,
  runEventsPhase,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  STATUS_EFFECT_MAGIC,
  verifyRestoredHandles,
  WORLD_PLUGIN,
  type GameState,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";


const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const authoredDirectory = join(testDirectory, "fixtures", "authored");
const fixture = (name: string): string => readFileSync(join(authoredDirectory, name), "utf8");
const scriptSources: Record<string, string> = {
  "stock-battle.prg": readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8"),
  "battle-outcome-loop.prg": fixture("battle-outcome-loop.prg"),
  "battle-outcome-levelup.prg": fixture("battle-outcome-levelup.prg"),
  "battle-outcome-last-win.prg": fixture("battle-outcome-last-win.prg"),
  "battle-outcome-win-program.prg": fixture("battle-outcome-win-program.prg"),
  "battle-outcome-run-program.prg": fixture("battle-outcome-run-program.prg"),
  "battle-outcome-first-run-program.prg": fixture("battle-outcome-first-run-program.prg"),
  "battle-outcome-game-over.prg": fixture("battle-outcome-game-over.prg"),
};
const scriptBytes = Object.fromEntries(Object.entries(scriptSources).map(([name, source]) =>
  [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(scriptBytes)),
  root: PACKAGE_ROOT,
  read: (key) => scriptBytes[key],
};
const plugins = [
  { definition: CORE_PLUGIN },
  { definition: CATALOGUE_STUBS_PLUGIN },
  { definition: CATALOGUE_RESPONDERS_PLUGIN },
  { definition: WORLD_PLUGIN },
  { definition: BATTLE_PLUGIN },
  { definition: UI_PLUGIN },
] as const;
const stockBattlePlugin: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};

type EnemyOptions = {
  readonly name?: string;
  readonly canRun?: number;
  readonly experience?: number;
  readonly gold?: number;
  readonly winProgram?: string;
  readonly runProgram?: string;
};

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly seed: number;
  readonly enemies: readonly number[];
  readonly players: readonly number[];
  readonly enemyAssets: Readonly<Record<string, Uint8Array>>;
  readonly characterAssets: Readonly<Record<string, Uint8Array>>;
  readonly background: Uint8Array;
  readonly status: Uint8Array;
  readonly messages: string[];
  readonly seenMessageEffects: Set<object>;
};

function boundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  for (const value of values) writer.str(value);
}

function enemyBytes(options: EnemyOptions = {}): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ENEMY");
  writer.i16(2);
  writer.i16(1);
  writer.str(options.name ?? "Slime");
  for (const value of [8, 3, 3, 2]) writer.i32(value);
  writer.i8(options.canRun ?? 1);
  writer.i16(-1);
  writer.i16(-1);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  writer.i8(0);
  writer.i8(0);
  writer.str("");
  writer.i32(options.experience ?? 0);
  writer.i32(options.gold ?? 0);
  writer.str(options.winProgram ?? "");
  writer.str(options.runProgram ?? "");
  boundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return writer.toBytes();
}

function characterBytes(levelUpProgram = ""): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT CHAR");
  writer.i16(2);
  writer.i16(8);
  writer.str("Hero");
  for (const name of ["exp!", "dp!", "fp!", "hp!", "maxhp!", "name$", "smp!", "maxsm!", "level!"]) writer.str(name);
  for (const value of [10, 100, 100, 10, 40, 40, 40, 1]) writer.i32(value);
  writer.str("");
  for (let index = 0; index < 201; index += 1) {
    writer.str("");
    writer.i32(0);
    writer.i32(0);
    writer.str("");
    writer.str("");
  }
  writer.str("");
  writer.i8(0);
  for (let index = 0; index < 11; index += 1) writer.str("");
  for (let index = 0; index < 7; index += 1) writer.i8(1);
  writer.i32(90);
  writer.i16(5);
  writer.i32(0);
  for (let index = 0; index < 4; index += 1) writer.i16(5);
  writer.str(levelUpProgram);
  writer.i8(0);
  writer.i8(1);
  for (let index = 0; index < 8; index += 1) writer.str("");
  for (let index = 0; index < 6; index += 1) writer.str("");
  for (let index = 0; index < 8; index += 1) writer.str("");
  writer.f64(3);
  writer.f64(0.05);
  writer.i32(-1);
  writer.i16(-1);
  return writer.toBytes();
}

function backgroundBytes(cantDoSound = ""): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT BKG");
  writer.i16(2);
  writer.i16(3);
  for (const value of ["", "", "", "", "", cantDoSound]) writer.str(value);
  return writer.toBytes();
}
function outcomeStatusBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("late-turn");
  writer.i16(1);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(1);
  writer.i16(2);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.str("");
  return writer.toBytes();
}


function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeRig(options: {
  readonly seed?: number;
  readonly enemyOptions?: readonly EnemyOptions[];
  readonly players?: number;
  readonly fallenPlayers?: readonly number[];
  readonly statusPlayerIndex?: number;
  readonly gameOverProgram?: string | null;
} = {}): Rig {
  const seed = options.seed ?? 17;
  const enemyOptions = options.enemyOptions ?? [{}];
  const state = createGameState({ seed });
  const enemies = enemyOptions.map((_, index) => {
    const enemy = addActor(state.actors, {
      kind: "enemy",
      source: `enemy${index}.ene`,
      name: `Enemy${index}`,
      stats: { hp: 20, maxHp: 20, smp: 10, maxSmp: 10, fp: 5, dp: 0, criticalOn: -1, criticalBy: -1 },
    });
    registerActorObject(state.vm, state.events, state.actors, enemy.id);
    return enemy.id;
  });
  const playerCount = options.players ?? 1;
  const players = Array.from({ length: playerCount }, (_, index) => {
    const player = addActor(state.actors, {
      kind: "party",
      source: `player${index}.tem`,
      name: `Player${index}`,
      statuses: options.statusPlayerIndex === index ? { "late.ste": 1 } : {},
      stats: {
        experience: 0,
        hp: options.fallenPlayers?.includes(index) ? 0 : 20,
        maxHp: 20,
        smp: 6,
        maxSmp: 10,
        fp: 2,
        dp: 3,
        level: 1,
        criticalOn: -1,
        criticalBy: -1,
      },
      progression: {
        levelType: 10,
        experienceIncrease: 5,
        maxLevel: index === 0 ? 3 : 1,
        levelHp: 5,
        levelDp: 2,
        levelFp: 3,
        levelSm: 4,
        levelUpType: 1,
        remainingExperience: 10,
        nextRequirement: 10,
        legacyLevelUp: index === 0,
      },
    });
    registerActorObject(state.vm, state.events, state.actors, player.id);
    return player.id;
  });
  state.party.members = players;
  state.party.selected = players[0] ?? null;
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "test.bkg",
    canRun: true,
    outcome: null,
    parties: [
      [ ...enemies.map((actorId) => ({ party: 0 as const, actorId, charge: 0 })) ],
      [ ...players.map((actorId) => ({ party: 1 as const, actorId, charge: 0 })) ],
    ],
  };
  const layers = createPluginLayers();
  const services = createScriptServices(
    state,
    [...plugins, stockBattlePlugin],
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    options.gameOverProgram ?? null,
  );
  const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
  runPackageStartup(state, services, [startupRef], [stockBattlePlugin]);
  startProgram(state.vm, { ...fileProgramRef(loader, "battle-outcome-loop.prg"), owner: "battle-outcome-test" });
  const enemyAssets = Object.fromEntries(enemyOptions.map((entry, index) => [`enemy${index}.ene`, enemyBytes(entry)]));
  const characterAssets = Object.fromEntries(players.map((_, index) => [
    `player${index}.tem`, characterBytes(index === 0 ? "battle-outcome-levelup.prg" : ""),
  ]));
  return {
    state, services, seed, enemies, players, enemyAssets, characterAssets,
    background: backgroundBytes(""),
    status: outcomeStatusBytes(),
    messages: [],
    seenMessageEffects: new Set(),
  };
}

function pollAssets(rig: Rig): WaitPoll {
  return (view, wait: Wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(view, wait);
    const request = rig.state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request;
    if (request === null || request === undefined) return defaultWaitPoll(view, wait);
    const name = typeof request.path === "string" ? request.path.toLowerCase().split("/").at(-1) ?? "" : "";
    let bytes: Uint8Array | undefined;
    if (request.area === "enemies") bytes = rig.enemyAssets[name];
    if (request.area === "characters") bytes = rig.characterAssets[name];
    if (request.area === "backgrounds") bytes = rig.background;
    if (request.area === "statusEffects") bytes = rig.status;
    return bytes === undefined ? { ok: false, value: null } : { ok: true, value: hex(bytes) };
  };
}

function collectMessages(rig: Rig): void {
  for (const effect of rig.state.vm.effects) {
    if (
      effect.name === "mwin"
      && typeof effect.args[0] === "string"
      && !rig.seenMessageEffects.has(effect)
    ) {
      rig.seenMessageEffects.add(effect);
      rig.messages.push(effect.args[0]);
    }
  }
}

function tick(rig: Rig, poll: WaitPoll): void {
  runWaitsPhase(rig.state.vm, { tick: rig.state.time.tick, events: rig.state.events }, poll, undefined, rig.services);
  collectMessages(rig);
  runThreadsPhase(rig.state.vm, rig.services, STEP_BUDGET);
  collectMessages(rig);
  runEventsPhase(rig.state, rig.services, STEP_BUDGET);
  collectMessages(rig);
  rig.state.time.tick += 1;
}

function tickUntil(rig: Rig, poll: WaitPoll, ready: () => boolean, limit = 128): void {
  for (let elapsed = 0; elapsed < limit; elapsed += 1) {
    tick(rig, poll);
    if (ready()) return;
  }
  throw new Error(`battle outcome did not reach expected state: tick=${rig.state.time.tick} outcome=${rig.state.battle?.outcome ?? "null"} turns=${String(globals(rig).outcometurncount)} diagnostics=${JSON.stringify(rig.services.diagnostics.map(({ code }) => code))}`);
}

function stockBattleMember(rig: Rig, name: string): unknown {
  const value = rig.state.vm.globals.stockbattle;
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object" || typeof value.handle !== "number") {
    return undefined;
  }
  return rig.state.vm.objects.find((object) => object.handle === value.handle)?.members[name.toLowerCase()];
}

function start(rig: Rig, poll: WaitPoll): void {
  tickUntil(rig, poll, () => rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"));
  tickUntil(rig, poll, () => stockBattleMember(rig, "defeatedListenerCount") === rig.enemies.length + rig.players.length);
}

function globals(rig: Rig): Record<string, unknown> {
  return rig.state.vm.globals;
}

function setCharge(rig: Rig, party: 0 | 1, index: number, charge: number): void {
  const section = rig.state.battle;
  if (section === null) throw new Error("battle unexpectedly ended");
  const entries = section.parties[party].slice();
  const current = entries[index];
  if (current === undefined) throw new Error("battle fighter missing");
  entries[index] = { ...current, charge };
  rig.state.battle = { ...section, parties: party === 0 ? [entries, section.parties[1]] : [section.parties[0], entries] };
}

function seededRunValue(seed: number, precedingDraws = 2): number {
  const rng = createGameState({ seed }).rng;
  for (let draw = 0; draw < precedingDraws; draw += 1) nextUint32(rng);
  return 1 + (nextUint32(rng) % 5);
}

function seedForRunValue(value: number, precedingDraws = 2): number {
  for (let seed = 0; seed < 100_000; seed += 1) {
    if (seededRunValue(seed, precedingDraws) === value) return seed;
  }
  throw new Error(`no seed found for run draw ${value}`);
}

test("a stock victory sums XP/gold, rewards fallen and living members, orders level-up growth, and runs only the last win program", () => {
  const rig = makeRig({
    enemyOptions: [
      { experience: 20, gold: 2, winProgram: "battle-outcome-win-program.prg" },
      { name: "Last", experience: 10, gold: 5, winProgram: "battle-outcome-last-win.prg" },
    ],
    players: 2,
    fallenPlayers: [1],
  });
  const poll = pollAssets(rig);
  start(rig, poll);
  globals(rig).outcomemode = "win";
  setCharge(rig, 1, 0, 75);
  setCharge(rig, 0, 0, 0);
  setCharge(rig, 0, 1, 0);
  tickUntil(rig, poll, () => globals(rig).winprogramcount === 1 && globals(rig).levelprogramcontinuation === 2);

  equal(rig.state.battle?.outcome, 2);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.experience, 30);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.level, 3);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.maxHp, 30);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.hp, 20);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[1])?.stats.experience, 30);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[1])?.stats.level, 1, "a member at max level does not loop");
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[1])?.stats.hp, 0, "fallen party members receive XP without being revived");
  equal(globals(rig).levelprogramcount, 2);
  equal(globals(rig).levelprogramcontinuation, 2, "the level-up program continues after a reported command error");
  equal(globals(rig).levelprogramlog, "1:30:20;2:30:25;");
  equal(globals(rig).outcomesequence, "level1;level2;win;");
  equal(globals(rig).outcomeeventcount, 2);
  ok(rig.services.diagnostics.some(({ code }) => code === "unknown.command"));
  const inventory = rig.state.vm.effects.filter((effect) => effect.patch?.section === "inventory");
  equal(inventory.length, 1);
  deepEqual(inventory[0]?.args, [{ type: "addGold", amount: 7 }]);
  const messages = rig.messages;
  ok(messages.indexOf("Gained 30 experience.") < messages.indexOf("Player0 gained a level"));
  ok(messages.indexOf("Player0 gained a level") < messages.indexOf("Gained 7 GP."));
  ok(messages.indexOf("Gained 7 GP.") < messages.indexOf("Win program."));
  const experienceMessage = rig.state.vm.effects.findIndex((effect) =>
    effect.name === "mwin" && effect.args[0] === "Gained 30 experience.");
  const goldWrite = rig.state.vm.effects.findIndex((effect) =>
    effect.kind === "state-write" && effect.patch?.section === "inventory");
  const goldMessage = rig.state.vm.effects.findIndex((effect) =>
    effect.name === "mwin" && effect.args[0] === "Gained 7 GP.");
  ok(goldWrite >= 0 && goldWrite < experienceMessage && experienceMessage < goldMessage,
    "gold is written silently before XP and its message follows the level-up messages");
});

test("a successful seeded run skips later turns but ticks later statuses, runs only the last program, and grants no reward", () => {
  const seed = seedForRunValue(2, 4);
  const rig = makeRig({
    seed,
    enemyOptions: [
      { experience: 99, gold: 99, runProgram: "battle-outcome-first-run-program.prg" },
      { experience: 1, gold: 1, runProgram: "battle-outcome-run-program.prg" },
    ],
    players: 2,
    statusPlayerIndex: 1,
  });
  const poll = pollAssets(rig);
  start(rig, poll);
  globals(rig).outcomemode = "run";
  setCharge(rig, 1, 0, 75);
  setCharge(rig, 1, 1, 75);
  setCharge(rig, 0, 0, 0);
  setCharge(rig, 0, 1, 0);
  tickUntil(rig, poll, () => globals(rig).runprogramcount === 1);
  equal(rig.state.battle?.outcome, 0);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.experience, 0);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[1])?.stats.hp, 18, "later charged players still tick statuses");
  deepEqual(rig.state.actors.actors.find(({ id }) => id === rig.players[1])?.statuses, {});
  equal(globals(rig).outcometurncount, 1, "later charged players do not take turns after a successful run");
  equal(globals(rig).firstrunprogramcount ?? 0, 0, "only the last enemy's non-empty run program runs");
  equal(globals(rig).levelprogramcount, 0);
  equal(rig.state.vm.effects.some((effect) => effect.patch?.section === "inventory"), false);
  equal(seededRunValue(seed, 4), 2, "the upper successful result of random(5)");
  ok(rig.messages.includes("Escaped."));
});

test("a failed seeded run spends its turn; the run roll is deterministic at both sides of the 2-in-5 boundary", () => {
  const seed = seedForRunValue(3);
  const replay = (): Rig => {
    const rig = makeRig({ seed, enemyOptions: [{ runProgram: "battle-outcome-run-program.prg" }] });
    const poll = pollAssets(rig);
    start(rig, poll);
    globals(rig).outcomemode = "run";
    setCharge(rig, 1, 0, 75);
    setCharge(rig, 0, 0, 0);
    tickUntil(rig, poll, () => globals(rig).outcometurncount === 1 && rig.state.battle?.parties[1][0]?.charge === 0);
    return rig;
  };
  const first = replay();
  const second = replay();
  equal(first.state.battle?.outcome, null);
  equal(first.state.battle?.parties[1][0]?.charge, 0);
  ok(first.messages.includes("Could not escape."));
  equal(hashGameState(first.state), hashGameState(second.state));
});

test("a forbidden run keeps charge and consumes no random draw", () => {
  const rig = makeRig({ enemyOptions: [{ canRun: 0 }] });
  const poll = pollAssets(rig);
  start(rig, poll);
  globals(rig).outcomemode = "run";
  setCharge(rig, 1, 0, 75);
  setCharge(rig, 0, 0, 0);
  const rngBefore = { ...rig.state.rng };
  tickUntil(rig, poll, () => globals(rig).outcometurncount === 1 && rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"));
  equal(rig.state.battle?.outcome, null);
  equal(rig.state.battle?.parties[1][0]?.charge, 75);
  deepEqual(rig.state.rng, rngBefore);
});

test("a simultaneous player and enemy fall selects loss before victory", () => {
  const rig = makeRig({ enemyOptions: [{ experience: 20, gold: 5 }], gameOverProgram: "battle-outcome-game-over.prg" });
  const poll = pollAssets(rig);
  start(rig, poll);
  globals(rig).outcomemode = "simultaneous";
  setCharge(rig, 1, 0, 75);
  setCharge(rig, 0, 0, 0);
  tickUntil(rig, poll, () => rig.state.battle === null && globals(rig).gameoverprogramcount === 1);
  equal(rig.state.actors.actors.find(({ id }) => id === rig.players[0])?.stats.experience, 0);
  equal(rig.state.vm.effects.some((effect) => effect.patch?.section === "inventory"), false);
  equal(globals(rig).winprogramcount ?? 0, 0);
});
test("an all-fallen party resolves loss through the stock outcome path", () => {
  const rig = makeRig({
    players: 2,
    fallenPlayers: [0, 1],
    gameOverProgram: "battle-outcome-game-over.prg",
  });
  const poll = pollAssets(rig);
  tickUntil(rig, poll, () => rig.state.battle === null && globals(rig).gameoverprogramcount === 1);
  equal(globals(rig).winprogramcount ?? 0, 0);
});

test("enemy defeated re-emits once with damage source and plain payload, including after event-queue restore", () => {
  const rig = makeRig();
  const poll = pollAssets(rig);
  start(rig, poll);
  rig.services.actors.damage(rig.enemies[0]!, 99, rig.players[0]!);
  const restoredState = restoreGameState(snapshot(rig.state));
  const restoredLayers = createPluginLayers();
  const restoredServices = createScriptServices(restoredState, [...plugins, stockBattlePlugin], undefined, undefined, loader, "default", undefined, undefined, restoredLayers);
  verifyRestoredHandles(restoredState.vm, restoredServices);
  equal(hashGameState(restoredState), hashGameState(rig.state));
  for (let phase = 0; phase < 3; phase += 1) {
    runEventsPhase(rig.state, rig.services, STEP_BUDGET);
    runEventsPhase(restoredState, restoredServices, STEP_BUDGET);
    equal(hashGameState(restoredState), hashGameState(rig.state), `re-emitted event restore phase ${phase}`);
  }
  equal(globals(rig).outcomeeventcount, 1);
  equal(globals(rig).outcomeeventcause, "damage");
  equal(globals(rig).outcomeeventsource, rig.players[0]);
  rig.services.actors.updateStats(rig.enemies[0]!, { hp: 20 }, { cause: "script", source: null });
  rig.services.actors.damage(rig.enemies[0]!, 99, rig.players[0]!);
  for (let phase = 0; phase < 3; phase += 1) runEventsPhase(rig.state, rig.services, STEP_BUDGET);
  equal(globals(rig).outcomeeventcount, 1, "reviving and falling again does not re-emit in the same battle");
});

test("a level-up program parked mid-outcome resumes identically after save and restore", () => {
  const rig = makeRig({ enemyOptions: [{ experience: 25, gold: 1, winProgram: "battle-outcome-last-win.prg" }] });
  const poll = pollAssets(rig);
  start(rig, poll);
  globals(rig).outcomemode = "win";
  setCharge(rig, 1, 0, 75);
  setCharge(rig, 0, 0, 0);
  tickUntil(rig, poll, () => globals(rig).levelprogramcount === 1 && globals(rig).levelprogramcontinuation === 0);
  const restoredState = restoreGameState(snapshot(rig.state));
  const restoredLayers = createPluginLayers();
  const restoredServices = createScriptServices(
    restoredState, [...plugins, stockBattlePlugin], undefined, undefined, loader, "default", undefined, undefined,
    restoredLayers, undefined, false, undefined, undefined, undefined, null,
  );
  verifyRestoredHandles(restoredState.vm, restoredServices);
  const restoredRig: Rig = { ...rig, state: restoredState, services: restoredServices };
  const restoredPoll = pollAssets(restoredRig);
  equal(hashGameState(restoredState), hashGameState(rig.state));
  for (let elapsed = 0; elapsed < 12; elapsed += 1) {
    tick(rig, poll);
    tick(restoredRig, restoredPoll);
    equal(hashGameState(restoredState), hashGameState(rig.state), `mid-outcome restored tick ${elapsed}`);
    if (globals(rig).winprogramcount === 1) break;
  }
  equal(globals(rig).levelprogramcontinuation, 2);
  equal(globals(rig).winprogramcount, 1);
  equal(rig.state.battle?.outcome, 2);
});
