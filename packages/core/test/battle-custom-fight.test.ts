// A custom encounter is spelled out, not drawn (BAT-9 rule 2, docs/spec/engine/battle.md#bat-9): the 5.11 request
// carries no fighters, the engine runs the main file's fight program in place of the draw, and the program names
// its own enemies with FightEnemy. The first half drives the real `__battle_custom_fight` start command and the
// real stock_battle package on the script VM; the second half boots a whole game through the engine.
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
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_PLUGIN,
  BinaryWriter,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  COMPILER_VERSION,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyBoard,
  createEmptyMainFile,
  createEngine,
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
  startThread,
  STEP_BUDGET,
  verifyRestoredHandles,
  writeBattleBackground,
  WORLD_PLUGIN,
  writeBoard,
  writeMainFile,
  type Engine,
  type GameState,
  type PackageCatalogueEntry,
  type PluginLayers,
  type ProgramLoader,
  type BattleBackground,
  type ResolvedPlugin,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const stockSource = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const stockManifest = JSON.parse(readFileSync(join(repoRoot, "stock", "stock_battle", "manifest.json"), "utf8")) as {
  readonly name: string;
  readonly version: string;
  readonly namespace: string;
  readonly requests: PackageCatalogueEntry["requests"];
};
const fightSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-custom-fight.prg"), "utf8");
const replacementBattleSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-replacement-package.prg"), "utf8");
const replacementStartSource = readFileSync(join(testDirectory, "fixtures", "authored", "battle-replacement-start.prg"), "utf8");
const encoder = new TextEncoder();

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The engine's inline-script encoding of a request: four hex digits per UTF-16 code unit. */
function encodeRequest(value: unknown): string {
  const serialized = JSON.stringify(value);
  let encoded = "";
  for (let index = 0; index < serialized.length; index += 1) encoded += serialized.charCodeAt(index).toString(16).padStart(4, "0");
  return encoded;
}

// ---- authored assets ---------------------------------------------------------------------------------------

function boundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  for (const value of values) writer.str(value);
}

function enemyBytes(name: string): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ENEMY");
  writer.i16(2);
  writer.i16(1);
  writer.str(name);
  for (const value of [8, 3, 3, 2]) writer.i32(value);
  writer.i8(1);
  writer.i16(-1);
  writer.i16(-1);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  boundedStrings(writer, []);
  writer.i8(0);
  writer.i8(0);
  writer.str("");
  writer.i32(5);
  writer.i32(3);
  writer.str("");
  writer.str("");
  boundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return writer.toBytes();
}

function characterBytes(): Uint8Array {
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
  writer.str("");
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

function backgroundBytes(): Uint8Array {
  const result = writeBattleBackground({
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: "",
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "",
    cantDoSound: "",
    residue: new Uint8Array(),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const authoredAssets: Readonly<Record<string, Uint8Array>> = {
  "night.bkg": backgroundBytes(),
  "slime.ene": enemyBytes("Slime"),
  "bat.ene": enemyBytes("Bat"),
  "player0.tem": characterBytes(),
  "player1.tem": characterBytes(),
};

/** The 5.11 custom request the evaluator posts: the board, the player and the program's name, and no fighters. */
function customRequest(program: string): Record<string, unknown> {
  return {
    trigger: "random",
    board: { key: "boards/field.brd", skill: 1, background: "night.bkg" },
    actor: { id: "player:0", kind: "player", index: 0, source: "player0.tem", x: 80, y: 63, layer: 0 },
    program,
  };
}

/** A dictionary object value as plain data, nested dictionaries included. */
function plain(state: GameState, value: unknown): unknown {
  if (typeof value === "object" && value !== null && "kind" in value && value.kind === "object" && "handle" in value && typeof value.handle === "number") {
    const record = state.vm.objects.find((object) => object.handle === value.handle);
    if (record === undefined) throw new Error("the context object is not live");
    return Object.fromEntries(Object.entries(record.members).map(([name, member]) => [name, plain(state, member)]));
  }
  return value;
}

function actorSources(state: GameState, entries: readonly { readonly actorId: number }[]): (string | undefined)[] {
  return entries.map(({ actorId }) => state.actors.actors.find((actor) => actor.id === actorId)?.source);
}

// ---- the script VM rig -------------------------------------------------------------------------------------

const scriptBytes: Record<string, Uint8Array> = {
  [assetKey("Prg/stock-battle.prg")]: encoder.encode(stockSource),
  [assetKey("Prg/fight.prg")]: encoder.encode(fightSource),
  [assetKey("Prg/replacement-battle.prg")]: encoder.encode(replacementBattleSource),
  [assetKey("Prg/replacement-start.prg")]: encoder.encode(replacementStartSource),
};
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
const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
const replacementBattlePlugin: ResolvedPlugin = {
  namespace: "replacement_battle",
  definition: { id: "replacement_battle", version: "1.0.0", commands: [] },
};
const replacementStartupRef = { ...fileProgramRef(loader, "replacement-battle.prg"), owner: "replacement_battle" };
// A non-empty pool the custom path must never read: a drawn fight would request one of these files.
const enemyPool = [
  { enemyFile: "pool-a.ene", skillLevel: 1 },
  { enemyFile: "pool-b.ene", skillLevel: 1 },
] as const;
type EnemyPoolEntry = { readonly enemyFile: string; readonly skillLevel: number };
const replacementEnemyPool: readonly EnemyPoolEntry[] = [
  { enemyFile: "slime.ene", skillLevel: 1 },
  { enemyFile: "bat.ene", skillLevel: 1 },
];

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly layers: PluginLayers;
  readonly seed: number;
  readonly stock: boolean;
  readonly replacement: boolean;
  readonly pool: readonly EnemyPoolEntry[];
  readonly players: readonly number[];
};

function servicesFor(
  state: GameState,
  layers: PluginLayers,
  stock: boolean,
  replacement = false,
  pool: readonly EnemyPoolEntry[] = enemyPool,
): ScriptServices {
  const battlePlugins = [
    ...(stock ? [stockBattlePlugin] : []),
    ...(replacement ? [replacementBattlePlugin] : []),
  ];
  return createScriptServices(
    state,
    [...plugins, ...battlePlugins],
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
    null,
    { enemies: pool, stockBattleAvailable: stock },
  );
}

function makeRig(options: {
  readonly mode: string;
  readonly seed?: number;
  readonly players?: number;
  readonly stock?: boolean;
  readonly replacement?: boolean;
  readonly pool?: readonly EnemyPoolEntry[];
}): Rig {
  const seed = options.seed ?? 17;
  const stock = options.stock ?? true;
  const replacement = options.replacement ?? false;
  const pool = options.pool ?? enemyPool;
  const state = createGameState({ seed });
  const players = Array.from({ length: options.players ?? 1 }, (_, index) => {
    const actor = addActor(state.actors, {
      kind: "party",
      source: `player${index}.tem`,
      name: `Player${index}`,
      stats: { experience: 0, hp: 20, maxHp: 20, smp: 6, maxSmp: 10, fp: 2, dp: 3, level: 1, criticalOn: -1, criticalBy: -1 },
    });
    registerActorObject(state.vm, state.events, state.actors, actor.id);
    return actor.id;
  });
  state.party.members = [...players];
  state.party.selected = players[0] ?? null;
  state.world = {
    board: {
      key: assetKey("boards/field.brd"),
      coordType: 0,
      sizeX: 1,
      sizeY: 1,
      sizeL: 1,
      width: 1,
      height: 1,
      background: { r: 0, g: 0, b: 0 },
      ambient: { r: 0, g: 0, b: 0 },
      layers: [],
    },
  };
  const layers = createPluginLayers();
  const battlePlugins = [
    ...(stock ? [stockBattlePlugin] : []),
    ...(replacement ? [replacementBattlePlugin] : []),
  ];
  const startupRefs = [
    ...(stock ? [startupRef] : []),
    ...(replacement ? [replacementStartupRef] : []),
  ];
  const services = servicesFor(state, layers, stock, replacement, pool);
  if (startupRefs.length > 0) runPackageStartup(state, services, startupRefs, battlePlugins);
  Object.assign(state.vm.globals, { custommode: options.mode, customcalls: 0, afterfight: 0, turncount: 0 });
  return { state, services, layers, seed, stock, replacement, pool, players };
}

/** Start the custom request the way the engine's battle applier does: one blocking thread, the encoded request. */
function startCustomRequest(rig: Rig, request: unknown): void {
  startThread(rig.state.vm, {
    ref: { kind: "inline", text: `__battle_custom_fight(${JSON.stringify(encodeRequest(request))})`, compiler: COMPILER_VERSION },
    kind: "blocking",
    owner: "script",
  });
}
function startReplacementProgram(rig: Rig): void {
  startThread(rig.state.vm, {
    ref: fileProgramRef(loader, "replacement-start.prg"),
    kind: "blocking",
    owner: "script",
  });
}

function pollAssets(rig: Rig): WaitPoll {
  return (view, wait: Wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(view, wait);
    const request = rig.state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request;
    if (request === null || request === undefined) return defaultWaitPoll(view, wait);
    const name = typeof request.path === "string" ? request.path.toLowerCase().split("/").at(-1) ?? "" : "";
    const bytes = request.area === "enemies" || request.area === "characters" || request.area === "backgrounds" ? authoredAssets[name] : undefined;
    return bytes === undefined ? { ok: false, value: null } : { ok: true, value: hex(bytes) };
  };
}

function tick(rig: Rig, poll: WaitPoll): void {
  runWaitsPhase(rig.state.vm, { tick: rig.state.time.tick, events: rig.state.events }, poll, undefined, rig.services);
  runThreadsPhase(rig.state.vm, rig.services, STEP_BUDGET);
  runEventsPhase(rig.state, rig.services, STEP_BUDGET);
  rig.state.time.tick += 1;
}

function alive(state: GameState): boolean {
  return state.vm.threads.some((thread) => thread.status !== "finished");
}

function sleeping(state: GameState): boolean {
  return state.vm.threads.some((thread) => thread.wait?.kind === "sleep");
}

function tickUntil(rig: Rig, poll: WaitPoll, ready: () => boolean, limit = 600): void {
  for (let elapsed = 0; elapsed < limit; elapsed += 1) {
    tick(rig, poll);
    if (ready()) return;
  }
  throw new Error(`the custom fight did not reach the expected state: tick=${rig.state.time.tick} diagnostics=${JSON.stringify(rig.services.diagnostics.map(({ code }) => code))}`);
}

function runToEnd(rig: Rig, poll = pollAssets(rig)): void {
  tickUntil(rig, poll, () => !alive(rig.state));
}

function globals(rig: Rig): Record<string, unknown> {
  return rig.state.vm.globals;
}

function charges(state: GameState): number[][] {
  if (state.battle === null) throw new Error("no battle is active");
  return state.battle.parties.map((party) => party.map(({ charge }) => charge));
}

/** What the stock loop's seeding draws, in its order: every enemy against 123, then every player against 75. */
function expectedSeedCharges(seed: number, enemyCount: number, playerCount: number): number[][] {
  const rng = createGameState({ seed }).rng;
  const enemy: number[] = [];
  const player: number[] = [];
  for (let index = 0; index < enemyCount; index += 1) enemy.push(nextUint32(rng) % 123);
  for (let index = 0; index < playerCount; index += 1) player.push(nextUint32(rng) % 75);
  return [enemy, player];
}

test("a custom encounter runs the main file's program with the request as its context, loads no enemy and takes no random number", () => {
  const rig = makeRig({ mode: "record" });
  const rngBefore = clonePlain(rig.state.rng);
  const request = customRequest("fight.prg");
  startCustomRequest(rig, request);
  runToEnd(rig);
  const seen = globals(rig);
  equal(seen.customcalls, 1);
  equal(seen.seentrigger, "random");
  equal(seen.seenkey, "boards/field.brd");
  equal(seen.seenskill, 1);
  equal(seen.seenbackground, "night.bkg");
  equal(seen.seenactorid, "player:0");
  equal(seen.seenactorsource, "player0.tem");
  equal(seen.seenactorx, 80);
  equal(seen.seenactorlayer, 0);
  equal(seen.seenprogram, "fight.prg");
  equal(seen.afterfight, 1);
  equal(seen.seensource, 0, "the program starts with no source: the handle commands answer 0 for an empty slot");
  equal(seen.seentarget, 0, "the program starts with no target");
  deepEqual(plain(rig.state, seen.seencontext), { ...request, source: null, target: null }, "the request is the context");
  equal("fighters" in (plain(rig.state, seen.seencontext) as object), false, "a custom request carries no fighters");
  deepEqual(rig.state.rng, rngBefore, "the engine takes no random number for a custom encounter");
  equal(rig.state.battle, null);
  equal(rig.state.actors.actors.length, 1, "no enemy was loaded: only the party member exists");
  deepEqual(rig.services.diagnostics, []);
});

test("a custom request that carries fighters, a blank program or malformed fields is a located battle.bad-handoff and runs nothing", () => {
  const withoutProgram = customRequest("fight.prg");
  delete withoutProgram.program;
  const withoutBoard = customRequest("fight.prg");
  delete withoutBoard.board;
  const cases: readonly (readonly [string, unknown])[] = [
    ["fighters", { ...customRequest("fight.prg"), fighters: [{ party: "enemy", id: "enemy:0", index: 0, source: "slime.ene", skill: 1 }] }],
    ["blank program", customRequest("  ")],
    ["no program", withoutProgram],
    ["no board", withoutBoard],
    ["not a random trigger", { ...customRequest("fight.prg"), trigger: "board" }],
  ];
  for (const [label, request] of cases) {
    const rig = makeRig({ mode: "record" });
    startCustomRequest(rig, request);
    runToEnd(rig);
    ok(rig.services.diagnostics.some(({ code }) => code === "battle.bad-handoff"), `${label}: a located battle.bad-handoff`);
    equal(globals(rig).customcalls, 0, `${label}: the program did not run`);
    equal(rig.state.battle, null, `${label}: no battle exists`);
  }
});

test("a program that spells its enemies out with FightEnemy gets the BAT-9 setup and a complete stock battle", () => {
  const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
  startCustomRequest(rig, customRequest("fight.prg"));
  const poll = pollAssets(rig);
  // The loop's first park is its one-tick sleep after it seeds every fighter's charge from the game's RNG.
  tickUntil(rig, poll, () => rig.state.battle !== null && sleeping(rig.state));
  const started = rig.state.battle;
  if (started === null) throw new Error("the battle did not start");
  deepEqual(actorSources(rig.state, started.parties[0]), ["bat.ene", "slime.ene", "bat.ene"], "the enemies are the written ones, in the order written, with the repeat kept");
  deepEqual(actorSources(rig.state, started.parties[1]), ["player0.tem", "player1.tem"]);
  equal(started.background, "night.bkg", "the context supplies the board's background");
  equal(started.canRun, true);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 3, 2), "nothing drew a random number before the loop seeded the charges");
  tickUntil(rig, poll, () => globals(rig).afterfight === 1);
  equal(rig.state.battle?.outcome, 2, "the stock outcome path decided a win");
  equal(globals(rig).customcalls, 1);
  ok(Number(globals(rig).turncount) >= 1, "a player took a turn");
  deepEqual(rig.state.battle?.parties[0].map(({ actorId }) => rig.state.actors.actors.find((actor) => actor.id === actorId)?.stats.hp), [0, 0, 0]);
  const gold = rig.state.vm.effects.filter((effect) => effect.patch?.section === "inventory");
  equal(gold.length, 1, "the outcome adapter posted its one gold effect");
  deepEqual(gold[0]?.args, [{ type: "addGold", amount: 9 }]);
  deepEqual(rig.services.diagnostics, []);
  equal(alive(rig.state), false, "the program returned from FightEnemy and ended");
});

test("FightEnemy from a custom program accepts one to four enemies and refuses none or five without starting a battle", () => {
  for (const [mode, expected] of [["fight-one", ["slime.ene"]], ["fight-four", ["slime.ene", "bat.ene", "slime.ene", "bat.ene"]]] as const) {
    const rig = makeRig({ mode });
    startCustomRequest(rig, customRequest("fight.prg"));
    const poll = pollAssets(rig);
    tickUntil(rig, poll, () => rig.state.battle !== null);
    deepEqual(actorSources(rig.state, rig.state.battle!.parties[0]), expected, mode);
  }
  for (const mode of ["fight-none", "fight-five"]) {
    const rig = makeRig({ mode });
    startCustomRequest(rig, customRequest("fight.prg"));
    runToEnd(rig);
    ok(rig.services.diagnostics.some(({ code }) => code === "builtin.bad-arg"), `${mode}: a catchable builtin.bad-arg`);
    equal(rig.state.battle, null, `${mode}: no battle exists`);
    equal(globals(rig).afterfight, 1, `${mode}: the program carried on after the reported error`);
  }
});

test("a custom program name that matches no file is a catchable program.missing and starts no battle", () => {
  const rig = makeRig({ mode: "fight-order" });
  const rngBefore = clonePlain(rig.state.rng);
  startCustomRequest(rig, customRequest("missing.prg"));
  runToEnd(rig);
  ok(rig.services.diagnostics.some(({ code }) => code === "program.missing"), "the located program.missing diagnostic");
  equal(globals(rig).customcalls, 0, "nothing ran");
  equal(rig.state.battle, null);
  deepEqual(rig.state.rng, rngBefore);
});

test("without the stock_battle package a custom program still runs and its FightEnemy call is a catchable battle.package-missing", () => {
  const rig = makeRig({ mode: "fight-nopackage", stock: false });
  startCustomRequest(rig, customRequest("fight.prg"));
  runToEnd(rig);
  equal(globals(rig).customcalls, 1);
  ok(rig.services.diagnostics.some(({ code }) => code === "battle.package-missing"));
  equal(globals(rig).afterfight, 1, "the program carried on after the reported error");
  equal(rig.state.battle, null);
});
test("FightEnemy starts a core-prepared battle through a replacement loop without stock_battle", () => {
  const rig = makeRig({ mode: "replacement", stock: false, replacement: true });
  globals(rig).replacementstart = "explicit";
  globals(rig).replacementoutcome = 2;
  startReplacementProgram(rig);
  runToEnd(rig);
  equal(globals(rig).replacementbattlecalls, 1, `globals=${JSON.stringify(globals(rig))} diagnostics=${JSON.stringify(rig.services.diagnostics)} battle=${JSON.stringify(rig.state.battle)}`);
  equal(globals(rig).replacementfightcalls, 0, "FightEnemy does not dispatch through the fight wrapper");
  equal(globals(rig).replacementenemycount, 1);
  equal(globals(rig).replacementplayercount, 1);
  equal(globals(rig).replacementafter, 1);
  equal(rig.state.battle?.outcome, 2);
  deepEqual(rig.services.diagnostics, []);
});

test("the same seed and program reproduce the same state, diagnostics and hash", () => {
  const run = (): { hash: string; diagnostics: readonly string[]; tick: number } => {
    const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
    startCustomRequest(rig, customRequest("fight.prg"));
    const poll = pollAssets(rig);
    tickUntil(rig, poll, () => globals(rig).afterfight === 1);
    return { hash: hashGameState(rig.state), diagnostics: rig.services.diagnostics.map(({ code }) => code), tick: rig.state.time.tick };
  };
  const first = run();
  deepEqual(run(), first);
  const other = makeRig({ mode: "fight-order", seed: 292, players: 2 });
  startCustomRequest(other, customRequest("fight.prg"));
  tickUntil(other, pollAssets(other), () => globals(other).afterfight === 1);
  ok(hashGameState(other.state) !== first.hash, "a different seed gives a different battle");
});

/** Save at `saveTick`, restore into fresh services, and require the restored run to match the straight one tick by tick. */
function restoredRunMatches(saveTick: number): void {
  const rig = makeRig({ mode: "fight-order", seed: 291, players: 2 });
  startCustomRequest(rig, customRequest("fight.prg"));
  const poll = pollAssets(rig);
  while (rig.state.time.tick < saveTick) tick(rig, poll);
  const saved = snapshot(rig.state);
  const layers = createPluginLayers();
  const scratch = createGameState({ seed: rig.seed });
  runPackageStartup(scratch, servicesFor(scratch, layers, true), [startupRef], [stockBattlePlugin]);
  const state = restoreGameState(saved);
  const services = servicesFor(state, layers, true);
  verifyRestoredHandles(state.vm, services);
  const restored: Rig = { ...rig, state, services, layers };
  const restoredPoll = pollAssets(restored);
  equal(hashGameState(state), hashGameState(rig.state), `restored at tick ${saveTick}`);
  for (let elapsed = 0; elapsed < 600 && globals(rig).afterfight !== 1; elapsed += 1) {
    tick(rig, poll);
    tick(restored, restoredPoll);
    equal(hashGameState(state), hashGameState(rig.state), `restored at tick ${saveTick}, then tick ${rig.state.time.tick}`);
  }
  equal(globals(rig).afterfight, 1);
  equal(globals(restored).afterfight, 1);
  equal(restored.state.battle?.outcome, 2);
  deepEqual(restored.services.diagnostics, []);
}

test("a save taken while the custom program waits on its enemy files, inside the stock loop and during the outcome restores to the same run", () => {
  // With seed 291 the program starts on tick 0, ticks 1 to 3 wait on the three enemy files, ticks 4 to 7 sleep in the
  // stock loop, ticks 8 to 10 sit inside the cancelable damage event, and from tick 12 the outcome adapter waits on
  // the enemy and character files. These save points cross each of those stages.
  for (const saveTick of [1, 2, 4, 9, 11, 13, 15]) restoredRunMatches(saveTick);
});

// ---- the engine: a whole game boots, a custom request is posted, the program runs -----------------------------

type GameFiles = Map<string, Uint8Array>;

function fieldBoard(): Uint8Array {
  const empty = createEmptyBoard();
  return unwrap(writeBoard({
    ...empty,
    sizeX: 40,
    sizeY: 30,
    sizeL: 1,
    tileMatrix: Array.from({ length: 40 * 30 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 40 * 30, marker: true }],
    layerTitles: ["", ""],
    properties: { ...empty.properties, start: { x: 64, y: 64, layer: 1 } },
  }));
}

function authorGame(programs: Readonly<Record<string, string>>): { readonly files: GameFiles; readonly paths: readonly string[] } {
  const files: GameFiles = new Map();
  const paths = ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Enemy/slime.ene", "Enemy/bat.ene", "Bkrounds/night.bkg"];
  const main = {
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "start.prg",
    initBoard: "start.brd",
    initChar: "hero.tem",
    useCustomFightPrg: 1,
    customFightPrg: "fight.prg",
    packagePlugins: ["stock_battle"],
  };
  files.set(assetKey("main.gam"), unwrap(writeMainFile(main)));
  files.set(assetKey("boards/start.brd"), fieldBoard());
  files.set(assetKey("chrs/hero.tem"), characterBytes());
  files.set(assetKey("enemy/slime.ene"), authoredAssets["slime.ene"]!);
  files.set(assetKey("enemy/bat.ene"), authoredAssets["bat.ene"]!);
  files.set(assetKey("Bkrounds/night.bkg"), backgroundBytes());
  for (const [name, text] of Object.entries(programs)) {
    paths.push(`Prg/${name}`);
    files.set(assetKey(`Prg/${name}`), encoder.encode(text));
  }
  return { files, paths };
}

function stockCatalogue(): readonly PackageCatalogueEntry[] {
  return [{
    name: stockManifest.name,
    version: stockManifest.version,
    namespace: stockManifest.namespace,
    requests: stockManifest.requests,
    definition: { id: stockManifest.name, version: stockManifest.version, commands: [] },
    startup: { kind: "inline", text: stockSource, compiler: COMPILER_VERSION, dialect: "tk3" },
  }];
}

type Booted = {
  readonly engine: Engine;
  readonly files: GameFiles;
  readonly diagnostics: { readonly code: string; readonly message: string }[];
  readonly posted: { rngAtPost: unknown };
  peek(): GameState | null;
  state(): GameState;
};

/**
 * Boot a game whose start program only sets `customMode` and `ready`. One phase registration then seeds a party member
 * and posts the custom request the evaluator would post, as a `triggers` effect, on the first running tick.
 */
function bootGame(mode: string, program = "fight.prg", extra: Readonly<Record<string, string>> = {}): Booted {
  const game = authorGame({
    "start.prg": `customMode = "${mode}"\ncustomCalls = 0\nafterFight = 0\nturnCount = 0\nready = 1\nend()\n`,
    "fight.prg": fightSource,
    ...extra,
  });
  let latest: GameState | null = null;
  let seeded = false;
  const posted = { rngAtPost: null as unknown };
  const engine = createEngine({
    seed: 291,
    assetIndex: createAssetIndex(game.paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    width: 320,
    height: 240,
    maxTicks: 4000,
    packageCatalogue: stockCatalogue(),
    phaseRegistrations: [{
      phase: "triggers",
      run: (state, post) => {
        latest = state;
        if (seeded || post === undefined || state.vm.globals.ready !== 1 || state.world.board === null || state.world.board === undefined) return;
        seeded = true;
        const hero = addActor(state.actors, {
          kind: "party",
          source: "hero.tem",
          name: "Hero",
          stats: { experience: 0, hp: 20, maxHp: 20, smp: 6, maxSmp: 10, fp: 2, dp: 3, level: 1, criticalOn: -1, criticalBy: -1 },
        });
        registerActorObject(state.vm, state.events, state.actors, hero.id);
        state.party.members = [hero.id];
        state.party.selected = hero.id;
        posted.rngAtPost = clonePlain(state.rng);
        post("battle", {
          thread: 0,
          name: "battle.customFight",
          kind: "state-write",
          args: [{ ...customRequest(program), actor: { id: "player:0", kind: "player", index: 0, source: "hero.tem", x: 80, y: 63, layer: 0 } }],
          out: {},
          result: null,
          patch: null,
          wait: null,
          request: null,
        });
      },
    }],
  });
  const diagnostics: { code: string; message: string }[] = [];
  return {
    engine,
    files: game.files,
    diagnostics,
    posted,
    peek: () => latest,
    state: () => {
      if (latest === null) throw new Error("no tick has run yet");
      return latest;
    },
  };
}

/** Play the host: answer every asset request from the game's files until `done` holds or the guard runs out. */
function play(booted: Booted, done: (state: GameState) => boolean): void {
  let replies: { readonly tick: number; readonly event: { readonly kind: "asset"; readonly reqId: number; readonly bytes: Uint8Array | null } }[] = [];
  for (let guard = 0; guard < 4000; guard += 1) {
    const report = booted.engine.advance(1, replies);
    replies = [];
    booted.diagnostics.push(...report.diagnostics);
    if (report.loading) {
      replies = report.requests.flatMap((request) => request.kind === "asset"
        ? [{ tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: booted.files.get(request.key) ?? null } }]
        : []);
      continue;
    }
    const state = booted.peek();
    if (state !== null && done(state)) return;
  }
  throw new Error(`the engine did not settle: ${JSON.stringify(booted.diagnostics.map(({ code }) => code))}`);
}

test("the engine runs a custom request's program on a new thread with the request as context and takes no random number", () => {
  const booted = bootGame("record");
  play(booted, (state) => state.vm.globals.afterfight === 1);
  const state = booted.state();
  const seen = state.vm.globals;
  equal(seen.customcalls, 1);
  equal(seen.seentrigger, "random");
  equal(seen.seenkey, "boards/field.brd");
  equal(seen.seenbackground, "night.bkg");
  equal(seen.seenactorsource, "hero.tem");
  equal(seen.seenprogram, "fight.prg");
  equal("fighters" in (plain(state, seen.seencontext) as object), false);
  deepEqual(state.rng, booted.posted.rngAtPost, "no random number was taken between the request and the program's end");
  equal(state.battle, null);
  deepEqual(booted.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
});

test("the engine reports a custom request whose program is not in the game as program.missing and the game carries on", () => {
  const booted = bootGame("record", "nothing-here.prg");
  play(booted, (state) => state.vm.globals.ready === 1 && booted.diagnostics.some(({ code }) => code === "program.missing"));
  equal(booted.state().vm.globals.customcalls, 0);
  equal(booted.state().battle, null);
  for (let tick = 0; tick < 5; tick += 1) booted.engine.advance(1, []);
  equal(booted.state().engine.boot?.stage, "running");
});

test("the engine hands a custom program's FightEnemy call to the stock loop with the BAT-9 setup and no draw before the loop seeds", () => {
  const booted = bootGame("fight-order");
  // The loop's first park is its one-tick sleep after it seeds every fighter's charge from the game's RNG.
  play(booted, (state) => state.battle !== null && sleeping(state));
  const state = booted.state();
  const battle = state.battle;
  if (battle === null) throw new Error("the battle did not start");
  deepEqual(actorSources(state, battle.parties[0]), ["bat.ene", "slime.ene", "bat.ene"], "the written enemies, in the order written");
  deepEqual(actorSources(state, battle.parties[1]), ["hero.tem"]);
  equal(battle.background, "night.bkg");
  equal(battle.canRun, true);
  deepEqual(charges(state), expectedSeedCharges(291, 3, 1), "nothing drew a random number between the request and the loop's seeding");
  equal(state.vm.globals.customcalls, 1);
  equal(state.vm.globals.afterfight, 0, "the program is still inside FightEnemy, waiting on the stock loop");
  equal(alive(state), true);
  deepEqual(booted.diagnostics.map(({ code, message }) => `${code}: ${message}`), []);
});

test("the engine applies stock battle win rewards through Epic 8 inventory", () => {
  const booted = bootGame("fight-order");
  play(booted, (state) => state.vm.globals.afterfight === 1);
  const state = booted.state();
  equal(state.battle?.outcome, 2);
  equal(state.inventory.gold, 9);
  equal(booted.diagnostics.some(({ code }) => code === "menu.state-invalid"), false);
});
