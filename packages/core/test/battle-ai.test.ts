// Enemy AI is exercised through the authored stock_battle package in the RPGCode VM.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createBattleOwner,
  createEmptySpecialMove,
  createGameState,
  createPluginLayers,
  createScriptServices as coreCreateScriptServices,
  defaultWaitPoll,
  fileProgramRef,
  hashGameState,
  nextUint32,
  PACKAGE_ROOT,
  readStepCounters,
  registerActorObject,
  restoreGameState,
  runEventsPhase,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  STEP_BUDGET,
  verifyRestoredHandles,
  WORLD_PLUGIN,
  writeSpecialMove,
  type ActorRecord,
  type GameState,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type Result,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const authoredDirectory = join(testDirectory, "fixtures", "authored");
const startup = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const programSources: Record<string, string> = {
  "stock-battle.prg": startup,
  "battle-ai.prg": readFileSync(join(authoredDirectory, "battle-ai.prg"), "utf8"),
  "battle-ai-read.prg": readFileSync(join(authoredDirectory, "battle-ai-read.prg"), "utf8"),
  "battle-ai-loop.prg": readFileSync(join(authoredDirectory, "battle-ai-loop.prg"), "utf8"),
  "battle-ai-custom.prg": readFileSync(join(authoredDirectory, "battle-ai-custom.prg"), "utf8"),
};
const programBytes = Object.fromEntries(Object.entries(programSources).map(([name, source]) =>
  [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
const loader: ProgramLoader = {
  index: createAssetIndex(Object.keys(programBytes)),
  root: PACKAGE_ROOT,
  read: (key) => programBytes[key],
};
const startupRef = { ...fileProgramRef(loader, "stock-battle.prg"), owner: "stock_battle" };
const stockBattle: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [] },
};

type EnemyDefinition = {
  readonly aiLevel?: number;
  readonly customAi?: number;
  readonly aiProgram?: string;
  readonly specialMoves?: readonly string[];
  readonly hp?: number;
  readonly maxHp?: number;
  readonly smp?: number;
  readonly maxSmp?: number;
  readonly fp?: number;
  readonly dp?: number;
};
type PlayerDefinition = {
  readonly hp?: number;
  readonly maxHp?: number;
  readonly smp?: number;
  readonly maxSmp?: number;
  readonly dp?: number;
};
type RunOptions = {
  readonly seed?: number;
  readonly enemies?: readonly EnemyDefinition[];
  readonly players?: readonly PlayerDefinition[];
  readonly script?: string;
  readonly customMode?: string;
  readonly extraAssets?: Readonly<Record<string, string>>;
  readonly holdSpecialOnce?: boolean;
  readonly saveMidSpecial?: boolean;
  readonly secondTurn?: boolean;
};
type ActorFixture = {
  readonly record: ActorRecord;
  readonly value: { readonly kind: "object"; readonly handle: number; readonly className: string };
};
type Rig = {
  state: GameState;
  services: ScriptServices;
  readonly enemies: readonly ActorFixture[];
  readonly players: readonly ActorFixture[];
  readonly assets: Record<string, string>;
  readonly seed: number;
};
type RunResult = Rig & {
  readonly requested: readonly string[];
  readonly steps: number;
  readonly peakTickSteps: number;
  readonly saved: boolean;
};

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`authored asset did not write: ${result.error.message}`);
  return result.value;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bound(count: number): number {
  return count === 0 ? -1 : count - 1;
}

function putBoundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(bound(values.length));
  for (const value of values) writer.str(value);
}

function enemyAsset(definition: EnemyDefinition): string {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ENEMY");
  writer.i16(2);
  writer.i16(1);
  writer.str("Authored enemy");
  for (const value of [100, 20, definition.fp ?? 8, definition.dp ?? 0]) writer.i32(value);
  writer.i8(1);
  writer.i16(-1);
  writer.i16(-1);
  putBoundedStrings(writer, definition.specialMoves ?? []);
  putBoundedStrings(writer, []);
  putBoundedStrings(writer, []);
  writer.i8(definition.aiLevel ?? 0);
  writer.i8(definition.customAi ?? 0);
  writer.str(definition.aiProgram ?? "");
  writer.i32(0);
  writer.i32(0);
  writer.str("");
  writer.str("");
  putBoundedStrings(writer, ["", "", "", "", "", ""]);
  writer.i32(-1);
  return hex(writer.toBytes());
}

function specialMoveAsset(values: { fp: number; smp?: number; targetSmp?: number }): string {
  return hex(unwrap(writeSpecialMove({
    ...createEmptySpecialMove(),
    minor: 3,
    name: "Authored special",
    damage: values.fp,
    smpCost: values.smp ?? 1,
    targetSmpDrain: values.targetSmp ?? 0,
    animation: "",
    program: "",
    statusEffect: "",
  })));
}

function makeActor(state: GameState, kind: "party" | "enemy", name: string, source: string, spec: EnemyDefinition | PlayerDefinition): ActorFixture {
  const record = addActor(state.actors, {
    kind,
    source,
    name,
    stats: {
      experience: 0,
      hp: spec.hp ?? 100,
      maxHp: spec.maxHp ?? 100,
      smp: spec.smp ?? 20,
      maxSmp: spec.maxSmp ?? 20,
      fp: "fp" in spec ? spec.fp ?? 0 : 0,
      dp: spec.dp ?? 0,
      level: 1,
      criticalBy: -1,
      criticalOn: -1,
    },
  });
  const object = registerActorObject(state.vm, state.events, state.actors, record.id);
  if (object === null || object.className === null) throw new Error(`could not hydrate ${name}`);
  return { record, value: { kind: "object" as const, handle: object.handle, className: object.className } };
}

function servicesFor(state: GameState, layers: PluginLayers): ScriptServices {
  return coreCreateScriptServices(
    state,
    [
      { definition: CORE_PLUGIN },
      { definition: CATALOGUE_STUBS_PLUGIN },
      { definition: CATALOGUE_RESPONDERS_PLUGIN },
      { definition: WORLD_PLUGIN },
      { definition: BATTLE_PLUGIN },
      stockBattle,
    ],
    undefined, undefined, loader, "default", undefined, undefined, layers,
  );
}

function makeRig(options: RunOptions): Rig {
  const seed = options.seed ?? 11;
  const definitions = options.enemies ?? [{}];
  const playerDefinitions = options.players ?? [{}];
  const state = createGameState({ seed });
  const enemies = definitions.map((definition, index) =>
    makeActor(state, "enemy", `Enemy ${index}`, `enemy-${index}.ene`, definition));
  const players = playerDefinitions.map((definition, index) =>
    makeActor(state, "party", `Player ${index}`, `player-${index}.tem`, definition));
  state.party.members = players.map(({ record }) => record.id);
  state.party.selected = players[0]?.record.id ?? null;
  state.battle = {
    id: 1,
    boardKey: "boards/enemy-ai.brd",
    background: "enemy-ai.bkg",
    canRun: true,
    outcome: null,
    parties: [
      enemies.map(({ record }) => ({ party: 0 as const, actorId: record.id, charge: 0 })),
      players.map(({ record }) => ({ party: 1 as const, actorId: record.id, charge: 0 })),
    ],
  };
  const layers = createPluginLayers();
  const services = servicesFor(state, layers);
  runPackageStartup(state, services, [startupRef], [stockBattle]);
  const assets: Record<string, string> = { ...options.extraAssets };
  definitions.forEach((definition, index) => { assets[`enemy-${index}.ene`] = enemyAsset(definition); });
  state.vm.globals.secondturn = options.secondTurn === true ? 1 : 0;
  state.vm.globals.custommode = options.customMode ?? "noop";
  state.vm.globals.customcalls = 0;
  state.vm.globals.customerrorresumed = 0;
  state.vm.globals.done = 0;
  startProgram(state.vm, { ...fileProgramRef(loader, options.script ?? "battle-ai.prg"), owner: "battle-ai-test" });
  return { state, services, enemies, players, assets, seed };
}

function totalSteps(state: GameState): number {
  return Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
}

function requestPath(state: GameState, wait: Wait): string | undefined {
  if (wait.kind !== "request") return undefined;
  const path = state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.path;
  return typeof path === "string" ? path : undefined;
}

function pendingSpecialRequest(state: GameState): boolean {
  return state.vm.threads.some((thread) => thread.wait?.kind === "request"
    && requestPath(state, thread.wait)?.toLowerCase().endsWith(".spc"));
}

function runScenario(options: RunOptions): RunResult {
  const rig = makeRig(options);
  let state = rig.state;
  let services = rig.services;
  let saved = false;
  let peakTickSteps = 0;
  const before = totalSteps(state);
  const requests: string[] = [];
  const seenRequests = new Set<number>();
  const heldRequests = new Set<number>();
  for (let elapsed = 0; elapsed < 128; elapsed += 1) {
    const tickBefore = totalSteps(state);
    runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events }, (view, wait) => {
      if (wait.kind !== "request") return defaultWaitPoll(view as never, wait);
      if (!seenRequests.has(wait.reqId)) {
        seenRequests.add(wait.reqId);
        const path = requestPath(state, wait);
        if (path !== undefined) requests.push(path.toLowerCase().split(/[\\/]/).at(-1) ?? path.toLowerCase());
      }
      const path = requestPath(state, wait);
      const name = path?.toLowerCase().split(/[\\/]/).at(-1) ?? "";
      if (options.holdSpecialOnce && name.endsWith(".spc") && !heldRequests.has(wait.reqId)) {
        heldRequests.add(wait.reqId);
        return null;
      }
      const bytes = rig.assets[name];
      return bytes === undefined ? { ok: false as const, value: null } : { ok: true as const, value: bytes };
    }, undefined, services);
    runThreadsPhase(state.vm, services, STEP_BUDGET);
    runEventsPhase(state, services, STEP_BUDGET);
    state.time.tick += 1;
    const tickSteps = totalSteps(state) - tickBefore;
    peakTickSteps = Math.max(peakTickSteps, tickSteps);
    if (!saved && options.saveMidSpecial && pendingSpecialRequest(state)) {
      const savedState = snapshot(state);
      const restoreLayers = createPluginLayers();
      const scratch = createGameState({ seed: rig.seed });
      runPackageStartup(scratch, servicesFor(scratch, restoreLayers), [startupRef], [stockBattle]);
      state = restoreGameState(savedState);
      services = servicesFor(state, restoreLayers);
      verifyRestoredHandles(state.vm, services);
      saved = true;
    }
    if (state.vm.globals.done === 1) {
      return { ...rig, state, services, requested: requests, steps: totalSteps(state) - before, peakTickSteps, saved };
    }
  }
  throw new Error(`enemy AI fixture did not finish; requests=${requests.join(",")}`);
}

function drawValues(seed: number, count: number): number[] {
  const rng = { ...createGameState({ seed }).rng };
  return Array.from({ length: count }, () => nextUint32(rng));
}
function expectedRngAfter(seed: number, draws: number) {
  const rng = { ...createGameState({ seed }).rng };
  for (let index = 0; index < draws; index += 1) nextUint32(rng);
  return rng;
}

function findSeed(predicate: (draws: readonly number[]) => boolean, from = 1): number {
  for (let seed = from; seed < from + 10000; seed += 1) {
    if (predicate(drawValues(seed, 8))) return seed;
  }
  throw new Error("no seed satisfied the authored RNG boundary");
}

function stat(state: GameState, id: number, field: "hp" | "smp"): number {
  const record = state.actors.actors.find((actor) => actor.id === id);
  if (record === undefined) throw new Error(`missing actor ${id}`);
  return record.stats[field];
}

function setCharge(state: GameState, party: 0 | 1, index: number, charge: number): void {
  const owner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
    readBattleCounter: () => state.engine.nextBattleId,
    commitBattleCounter: (next) => { state.engine = { ...state.engine, nextBattleId: next }; },
  });
  const result = owner.apply({ type: "setCharge", party, index, charge });
  if (!result.ok) throw new Error(result.error.message);
}

function charge(state: GameState, party: 0 | 1, index: number): number {
  const fighter = state.battle?.parties[party][index];
  if (fighter === undefined) throw new Error(`missing fighter ${party}:${index}`);
  return fighter.charge;
}

function tick(state: GameState, services: ScriptServices, poll?: WaitPoll): number {
  const before = totalSteps(state);
  runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events },
    (view, wait) => wait.kind === "request" && poll !== undefined ? poll(view, wait) : defaultWaitPoll(view, wait),
    undefined, services);
  runThreadsPhase(state.vm, services, STEP_BUDGET);
  runEventsPhase(state, services, STEP_BUDGET);
  state.time.tick += 1;
  return totalSteps(state) - before;
}

function pollAssets(rig: Rig): WaitPoll {
  return (_view, wait) => {
    const path = requestPath(rig.state, wait);
    const name = path?.toLowerCase().split(/[\\/]/).at(-1) ?? "";
    const bytes = rig.assets[name];
    return bytes === undefined ? { ok: false as const, value: null } : { ok: true as const, value: bytes };
  };
}

test("battleenemydata reads the active enemy's documented fields as plain data", () => {
  const result = runScenario({
    script: "battle-ai-read.prg",
    enemies: [{ aiLevel: 3, customAi: 5, aiProgram: "battle-ai-custom.prg", specialMoves: ["", "move-a.spc"] }],
  });
  equal(result.state.vm.globals.readailevel, 3);
  equal(result.state.vm.globals.readcustomai, 5);
  equal(result.state.vm.globals.readprogram, "battle-ai-custom.prg");
  equal(result.state.vm.globals.readspecialcount, 2);
  equal(result.state.vm.globals.readspecial0, "");
  equal(result.state.vm.globals.readspecial1, "move-a.spc");
  equal(result.requested[0], "enemy-0.ene");
});

test("all four AI levels follow their coin, special and target boundaries across seeds", () => {
  const headSeed = findSeed((draws) => draws[0]! % 2 === 0);
  const tailSeed = findSeed((draws) => draws[0]! % 2 === 1);
  const hit = specialMoveAsset({ fp: 9, smp: 1 });
  const assets = { "hit.spc": hit };

  const level0Attack = runScenario({
    seed: headSeed,
    enemies: [{ aiLevel: 0, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 100 }, { hp: 100 }],
    extraAssets: assets,
  });
  equal(stat(level0Attack.state, level0Attack.enemies[0]!.record.id, "smp"), 20);
  const level0Target = drawValues(headSeed, 3)[1]! % 2;
  ok(stat(level0Attack.state, level0Attack.players[level0Target]!.record.id, "hp") < 100);
  equal(stat(level0Attack.state, level0Attack.players[1 - level0Target]!.record.id, "hp"), 100);
  ok(!level0Attack.requested.includes("hit.spc"), "heads attacks without loading special moves");

  const level0Special = runScenario({
    seed: tailSeed,
    enemies: [{ aiLevel: 0, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 100 }, { hp: 100 }],
    extraAssets: assets,
  });
  equal(stat(level0Special.state, level0Special.enemies[0]!.record.id, "smp"), 19);
  const level0SpecialTarget = drawValues(tailSeed, 3)[2]! % 2;
  equal(stat(level0Special.state, level0Special.players[level0SpecialTarget]!.record.id, "hp"), 91);
  equal(stat(level0Special.state, level0Special.players[1 - level0SpecialTarget]!.record.id, "hp"), 100);

  const level1 = runScenario({
    seed: headSeed,
    enemies: [{ aiLevel: 1, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 100 }, { hp: 100 }],
    extraAssets: assets,
  });
  equal(stat(level1.state, level1.enemies[0]!.record.id, "smp"), 19, "level 1 tries specials even when the first draw is heads");
  const level1Target = drawValues(headSeed, 2)[1]! % 2;
  equal(stat(level1.state, level1.players[level1Target]!.record.id, "hp"), 91);
  equal(stat(level1.state, level1.players[1 - level1Target]!.record.id, "hp"), 100);

  const level2Attack = runScenario({
    seed: headSeed,
    enemies: [{ aiLevel: 2, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 80 }, { hp: 35 }],
    extraAssets: assets,
  });
  equal(stat(level2Attack.state, level2Attack.players[0]!.record.id, "hp"), 80);
  ok(stat(level2Attack.state, level2Attack.players[1]!.record.id, "hp") < 35, "level 2 attacks the weakest player on heads");
  equal(stat(level2Attack.state, level2Attack.enemies[0]!.record.id, "smp"), 20);

  const level2Special = runScenario({
    seed: tailSeed,
    enemies: [{ aiLevel: 2, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 80 }, { hp: 35 }],
    extraAssets: assets,
  });
  equal(stat(level2Special.state, level2Special.players[0]!.record.id, "hp"), 80);
  equal(stat(level2Special.state, level2Special.players[1]!.record.id, "hp"), 26, "level 2 special targets the weakest player");

  const level3 = runScenario({
    seed: headSeed,
    enemies: [{ aiLevel: 3, specialMoves: ["hit.spc"], fp: 5 }],
    players: [{ hp: 80 }, { hp: 35 }],
    extraAssets: assets,
  });
  equal(stat(level3.state, level3.players[0]!.record.id, "hp"), 80);
  equal(stat(level3.state, level3.players[1]!.record.id, "hp"), 26, "level 3 always tries a special on the weakest player");
});

test("enemy AI pins coin, special pick, target, and post-target combat draw order", () => {
  const moveAssets = {
    "move-a.spc": specialMoveAsset({ fp: 7, smp: 1 }),
    "move-b.spc": specialMoveAsset({ fp: 13, smp: 1 }),
  };
  const specialSeed = findSeed((draws) => draws[0]! % 2 === 1 && draws[1]! % 2 !== draws[2]! % 2);
  const specialDraws = drawValues(specialSeed, 3);
  const pickedDamage = [7, 13][specialDraws[1]! % 2]!;
  const specialTarget = specialDraws[2]! % 2;
  const special = runScenario({
    seed: specialSeed,
    enemies: [{ aiLevel: 0, specialMoves: ["move-a.spc", "move-b.spc"] }],
    players: [{ hp: 100 }, { hp: 100 }],
    extraAssets: moveAssets,
  });
  equal(stat(special.state, special.players[specialTarget]!.record.id, "hp"), 100 - pickedDamage);
  equal(stat(special.state, special.players[1 - specialTarget]!.record.id, "hp"), 100);
  deepEqual(special.state.rng, expectedRngAfter(specialSeed, 3),
    "the coin, move pick and target each draw once; the special action adds no combat draws");

  const attackSeed = findSeed((draws) => draws[0]! % 2 === 0 && draws[1]! % 2 !== draws[2]! % 2 && draws[1]! % 20 !== draws[2]! % 20);
  const attackDraws = drawValues(attackSeed, 3);
  const attackTarget = attackDraws[1]! % 2;
  const attackDamage = Math.trunc(100 * (100 + attackDraws[2]! % 20 - 10) / 100);
  const attack = runScenario({
    seed: attackSeed,
    enemies: [{ aiLevel: 0, fp: 100 }],
    players: [{ hp: 200, maxHp: 200 }, { hp: 200, maxHp: 200 }],
  });
  equal(stat(attack.state, attack.players[attackTarget]!.record.id, "hp"), 200 - attackDamage);
  equal(stat(attack.state, attack.players[1 - attackTarget]!.record.id, "hp"), 200);
  deepEqual(attack.state.rng, expectedRngAfter(attackSeed, 3),
    "the coin and target draws precede the attack's one luck draw");
});

test("availableSpecials filters unaffordable moves; affordable moves are chosen equally and no affordable move falls back to attack", () => {
  const definitions = [
    { name: "move-a.spc", fp: 7, smp: 1 },
    { name: "move-b.spc", fp: 13, smp: 2 },
    { name: "too-costly.spc", fp: 50, smp: 3 },
  ] as const;
  const extraAssets = Object.fromEntries(definitions.map((move) => [move.name, specialMoveAsset(move)]));
  const chooseA = findSeed((draws) => draws[0]! % 2 === 0);
  const chooseB = findSeed((draws) => draws[0]! % 2 === 1);
  for (const [seed, damage, cost] of [[chooseA, 7, 1], [chooseB, 13, 2]] as const) {
    const result = runScenario({
      seed,
      enemies: [{ aiLevel: 1, smp: 2, specialMoves: definitions.map(({ name }) => name) }],
      extraAssets,
    });
    equal(stat(result.state, result.players[0]!.record.id, "hp"), 100 - damage);
    equal(stat(result.state, result.enemies[0]!.record.id, "smp"), 2 - cost);
    ok(result.requested.includes("too-costly.spc"), "the move cost is read before it is filtered out");
  }
  const noAffordable = runScenario({
    enemies: [{ aiLevel: 1, smp: 0, fp: 6, specialMoves: ["too-costly.spc"] }],
    extraAssets,
  });
  ok(stat(noAffordable.state, noAffordable.players[0]!.record.id, "hp") < 100);
  equal(stat(noAffordable.state, noAffordable.enemies[0]!.record.id, "smp"), 0);
});

test("healing specials choose living allies by level and may target an already-full ally", () => {
  const heal = specialMoveAsset({ fp: -10, smp: 1 });
  const extraAssets = { "heal.spc": heal };
  const targetFull = findSeed((draws) => draws[1]! % 2 === 1);
  const level1Full = runScenario({
    seed: targetFull,
    enemies: [
      { aiLevel: 1, hp: 30, maxHp: 100, specialMoves: ["heal.spc"] },
      { hp: 100, maxHp: 100 },
    ],
    extraAssets,
  });
  equal(stat(level1Full.state, level1Full.enemies[0]!.record.id, "hp"), 30);
  equal(stat(level1Full.state, level1Full.enemies[1]!.record.id, "hp"), 100);
  equal(stat(level1Full.state, level1Full.enemies[0]!.record.id, "smp"), 19, "the action still costs SMP when the random ally is full");

  const targetSelf = findSeed((draws) => draws[1]! % 2 === 0);
  const level1Random = runScenario({
    seed: targetSelf,
    enemies: [
      { aiLevel: 1, hp: 30, maxHp: 100, specialMoves: ["heal.spc"] },
      { hp: 100, maxHp: 100 },
    ],
    extraAssets,
  });
  equal(stat(level1Random.state, level1Random.enemies[0]!.record.id, "hp"), 40, "levels 0/1 may choose any living ally, including self");

  const level0Seed = findSeed((draws) => draws[0]! % 2 === 1 && draws[2]! % 2 === 1);
  const level0 = runScenario({
    seed: level0Seed,
    enemies: [
      { aiLevel: 0, hp: 30, maxHp: 100, specialMoves: ["heal.spc"] },
      { hp: 50, maxHp: 100 },
    ],
    extraAssets,
  });
  equal(stat(level0.state, level0.enemies[0]!.record.id, "hp"), 30, "level 0 may randomly choose an ally other than itself");
  equal(stat(level0.state, level0.enemies[1]!.record.id, "hp"), 60, "the randomly selected non-caster ally is healed");
  equal(stat(level0.state, level0.enemies[0]!.record.id, "smp"), 19, "the move is used even though another ally receives its healing");

  const level2Seed = findSeed((draws) => draws[0]! % 2 === 1 && draws[2]! % 2 === 0);
  const level2 = runScenario({
    seed: level2Seed,
    enemies: [
      { aiLevel: 2, hp: 50, maxHp: 100, specialMoves: ["heal.spc"] },
      { hp: 30, maxHp: 100 },
    ],
    extraAssets,
  });
  equal(stat(level2.state, level2.enemies[0]!.record.id, "hp"), 50, "the caster is not healed over the lower-HP ally");
  equal(stat(level2.state, level2.enemies[1]!.record.id, "hp"), 40, "level 2 heals the lowest-HP ally");

  const level3Weakest = runScenario({
    seed: targetFull,
    enemies: [
      { aiLevel: 3, hp: 30, maxHp: 100, specialMoves: ["heal.spc"] },
      { hp: 100, maxHp: 100 },
    ],
    extraAssets,
  });
  equal(stat(level3Weakest.state, level3Weakest.enemies[0]!.record.id, "hp"), 40, "levels 2/3 choose the lowest-HP living ally");
  equal(stat(level3Weakest.state, level3Weakest.enemies[1]!.record.id, "hp"), 100);
});

test("zero-FP moves are harmful and target players", () => {
  const drain = specialMoveAsset({ fp: 0, smp: 1, targetSmp: 5 });
  const result = runScenario({
    enemies: [{ aiLevel: 1, smp: 20, specialMoves: ["drain.spc"] }],
    players: [{ smp: 20 }],
    extraAssets: { "drain.spc": drain },
  });
  equal(stat(result.state, result.players[0]!.record.id, "smp"), 15);
  equal(stat(result.state, result.enemies[0]!.record.id, "smp"), 19);
});

test("weak-target ties preserve earlier party position and no living player draws no RNG", () => {
  const seed = findSeed((draws) => draws[0]! % 2 === 0);
  const tie = runScenario({
    seed,
    enemies: [{ aiLevel: 2, fp: 5 }],
    players: [{ hp: 50 }, { hp: 50 }],
  });
  ok(stat(tie.state, tie.players[0]!.record.id, "hp") < 50);
  equal(stat(tie.state, tie.players[1]!.record.id, "hp"), 50);

  const noPlayers = runScenario({
    enemies: [{ aiLevel: 3, specialMoves: ["hit.spc"] }],
    players: [{ hp: 0 }],
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 9 }) },
  });
  deepEqual(noPlayers.state.rng, createGameState({ seed: 11 }).rng);
  deepEqual(noPlayers.requested, [], "the enemy asset is not loaded when no player can be targeted");
});

test("equal seeds produce the same enemy decision state hash", () => {
  const options = {
    seed: 197,
    enemies: [{ aiLevel: 0, fp: 11, specialMoves: ["hit.spc"] }],
    players: [{ hp: 75 }, { hp: 42 }],
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 9, smp: 1 }) },
  };
  const first = runScenario(options);
  const second = runScenario(options);
  equal(hashGameState(first.state), hashGameState(second.state));
});

test("save/restore while a special asset is pending preserves the in-progress decision", () => {
  const options = {
    seed: 29,
    enemies: [{ aiLevel: 1, specialMoves: ["hit.spc"] }],
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 9, smp: 1 }) },
    holdSpecialOnce: true,
  };
  const uninterrupted = runScenario(options);
  const restored = runScenario({ ...options, saveMidSpecial: true });
  equal(restored.saved, true);
  equal(hashGameState(restored.state), hashGameState(uninterrupted.state));
  deepEqual(restored.requested, uninterrupted.requested);
});

test("custom AI receives source/target handles, can act or hand off, and ERR-2 continues after errors", () => {
  const attack = runScenario({
    seed: 23,
    enemies: [{ aiLevel: 3, customAi: 5, aiProgram: "battle-ai-custom.prg" }],
    customMode: "attack",
  });
  equal(attack.state.vm.globals.customcalls, 1);
  equal(String(attack.state.vm.globals.customsource), String(attack.enemies[0]!.record.id));
  equal(String(attack.state.vm.globals.customtarget), String(attack.players[0]!.record.id));
  equal(attack.state.vm.globals.customsourceactorid, attack.enemies[0]!.record.id, `custom AI diagnostics: ${attack.services.diagnostics.map(({ code }) => code).join(",")}`);
  equal(attack.state.vm.globals.customtargetactorid, attack.players[0]!.record.id);
  ok(stat(attack.state, attack.players[0]!.record.id, "hp") < 100, `custom action diagnostics: ${attack.services.diagnostics.map(({ code }) => code).join(",")}`);

  const error = runScenario({
    seed: 31,
    enemies: [{ aiLevel: 0, customAi: 1, aiProgram: "battle-ai-custom.prg" }],
    customMode: "error",
  });
  equal(error.state.vm.globals.customerrorresumed, 1);
  ok(error.services.diagnostics.some(({ code }) => code === "unknown.command"));
  ok(stat(error.state, error.players[0]!.record.id, "hp") < 100, "the custom program's action after its error still runs under ERR-2");

  const headSeed = findSeed((draws) => draws[0]! % 2 === 0);
  const handoff = runScenario({
    seed: headSeed,
    enemies: [{ aiLevel: 1, customAi: 1, aiProgram: "battle-ai-custom.prg" }],
    players: [{ hp: 75 }, { hp: 20 }],
    customMode: "handoff",
  });
  equal(stat(handoff.state, handoff.players[0]!.record.id, "hp"), 75);
  ok(stat(handoff.state, handoff.players[1]!.record.id, "hp") < 20, "ai(2) hands off to level 2 rather than the stored level 1");

  const invalid = runScenario({
    enemies: [{ customAi: 1, aiProgram: "battle-ai-custom.prg" }],
    customMode: "invalid",
  });
  equal(invalid.state.vm.globals.customerrorresumed, 1);
  ok(invalid.services.diagnostics.some(({ code }) => code === "builtin.bad-arg"));
});

test("ai(level) handoff leaves another enemy's level-three behavior unchanged", () => {
  const seed = findSeed((draws) => draws[1]! % 2 === 0 && draws[3]! % 2 === 0);
  const draws = drawValues(seed, 4);
  const firstAttackDamage = Math.max(1, Math.trunc(5 * (100 + draws[2]! % 20 - 10) / 100));
  const result = runScenario({
    seed,
    enemies: [
      { aiLevel: 1, customAi: 1, aiProgram: "battle-ai-custom.prg", fp: 5 },
      { aiLevel: 3, specialMoves: ["hit.spc"] },
    ],
    players: [{ hp: 75 }, { hp: 20 }],
    customMode: "handoff",
    secondTurn: true,
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 9, smp: 1 }) },
  });
  equal(stat(result.state, result.players[1]!.record.id, "hp"), 20 - firstAttackDamage - 9);
  equal(stat(result.state, result.enemies[1]!.record.id, "smp"), 19, "the second enemy still follows its level 3 special-first rule");
});

test("a no-op custom AI spends its turn without an automatic attack", () => {
  const rig = makeRig({
    enemies: [{ aiLevel: 3, customAi: 1, aiProgram: "battle-ai-custom.prg", specialMoves: ["hit.spc"] }],
    script: "battle-ai-loop.prg",
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 40, smp: 1 }) },
  });
  let reachedSleep = false;
  for (let elapsed = 0; elapsed < 32; elapsed += 1) {
    tick(rig.state, rig.services, pollAssets(rig));
    if (rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) {
      reachedSleep = true;
      break;
    }
  }
  equal(reachedSleep, true);
  setCharge(rig.state, 0, 0, 123);
  setCharge(rig.state, 1, 0, 0);
  const poll = pollAssets(rig);
  let completed = false;
  for (let elapsed = 0; elapsed < 32; elapsed += 1) {
    tick(rig.state, rig.services, poll);
    if (rig.state.vm.globals.customcalls === 1 && charge(rig.state, 0, 0) === 0) {
      completed = true;
      break;
    }
  }
  equal(completed, true, "the battle loop released enemy charge after the no-op program returned");
  equal(stat(rig.state, rig.players[0]!.record.id, "hp"), 100);
});

test("a normal enemy turn stays below STEP_BUDGET", () => {
  const result = runScenario({
    seed: 41,
    enemies: [{ aiLevel: 1, specialMoves: ["hit.spc"] }],
    extraAssets: { "hit.spc": specialMoveAsset({ fp: 9, smp: 1 }) },
  });
  ok(result.steps < STEP_BUDGET);
  ok(result.peakTickSteps <= STEP_BUDGET);
});
