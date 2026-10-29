// Stock-battle player actions (Epic 7.5 / issue #508; BAT-5, E-74, R11-Q7).
// The authored fixture drives the shared public stockBattle surface and the
// native helpers through the real RPGCode VM. Expected damage comes from an
// independent oracle that replays the seeded generator exactly as E-74 words
// it: luck, then the offensive draw, then the defensive draw. random(n) is
// 1 + nextUint32 % n (pure.ts), so the luck percentage is nextUint32 % 20 - 10
// and a critical draw against limit n is nextUint32 % (n + 1) === 0.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  addActor,
  applyMenuStateEffect,
  assetKey,
  BATTLE_PLUGIN,
  BinaryWriter,
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  createAssetIndex,
  createEmptyCharacter,
  createEmptyItem,
  createEmptySpecialMove,
  createGameState,
  createMenuOwnerPorts,
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
  STATUS_EFFECT_MAGIC,
  STEP_BUDGET,
  verifyRestoredHandles,
  WORLD_PLUGIN,
  writeCharacter,
  writeItem,
  writeSpecialMove,
  type GameState,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type Result,
  type RngState,
  type ScriptServices,
  type Wait,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const startup = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const fixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-actions.prg"), "utf8");
const actionProgram = readFileSync(join(testDirectory, "fixtures", "authored", "battle-action-program.prg"), "utf8");
const actionWaitProgram = readFileSync(join(testDirectory, "fixtures", "authored", "battle-action-wait.prg"), "utf8");
const actionErrorProgram = readFileSync(join(testDirectory, "fixtures", "authored", "battle-action-error.prg"), "utf8");
const programBytes = Object.fromEntries(Object.entries({
  "stock-battle.prg": startup,
  "battle-actions.prg": fixture,
  "battle-action-program.prg": actionProgram,
  "battle-action-wait.prg": actionWaitProgram,
  "battle-action-error.prg": actionErrorProgram,
}).map(([name, source]) => [assetKey(`Prg/${name}`), new TextEncoder().encode(source)]));
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

// ---- authored asset bytes ---------------------------------------------------

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`authored asset did not write: ${result.error.message}`);
  return result.value;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function characterAsset(specialStance: string): string {
  return hex(unwrap(writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["fight.anm", "defend.anm", specialStance, "die.anm", "rest.anm", ""],
    customStances: [],
  })));
}

function moveAsset(values: { fp: number; targetSmp: number; cost: number; animation: string; program?: string; status?: string }): string {
  return hex(unwrap(writeSpecialMove({
    ...createEmptySpecialMove(),
    minor: 3,
    name: "Move",
    damage: values.fp,
    smpCost: values.cost,
    targetSmpDrain: values.targetSmp,
    animation: values.animation,
    program: values.program ?? "",
    statusEffect: values.status ?? "",
  })));
}

function itemAsset(values: { hp: number; smp: number; animation: string; program?: string }): string {
  return hex(unwrap(writeItem({
    ...createEmptyItem(),
    minor: 4,
    movementAnimations: Array(8).fill(""),
    restAnimation: "",
    reservedAnimation: "",
    customStances: [],
    name: "Potion",
    battleUsable: 1,
    battleUseHp: values.hp,
    battleUseSmp: values.smp,
    battleUseProgram: values.program ?? "",
    battleAnimation: values.animation,
  })));
}

const battlePotionDefinition = { ...createEmptyItem(), name: "Potion", battleUsable: 1 };

function statusEffectAsset(rounds: number): string {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("Authored battle status");
  writer.i16(rounds);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.str("");
  return hex(writer.toBytes());
}

// ---- the seeded oracle ------------------------------------------------------

type Oracle = { readonly damage: number; readonly used: number; readonly critical: boolean; readonly luck: number | null; readonly rng: RngState };

function oracle(seed: number, amount: number, dp: number, by: number, on: number): Oracle {
  const rng = createGameState({ seed }).rng;
  let used = 0;
  const draw = (): number => { used += 1; return nextUint32(rng); };
  let value = amount;
  let critical = false;
  let luck: number | null = null;
  if (amount > 0) {
    luck = draw() % 20 - 10;
    value = Math.trunc(amount * (100 + luck) / 100);
    if (by >= 0) critical = draw() % (by + 1) === 0;
    if (!critical && on >= 0) critical = draw() % (on + 1) === 0;
    if (!critical) value -= dp;
  }
  if (value < 1) value = 1;
  return { damage: value, used, critical, luck, rng: { ...rng } };
}

function firstDraws(seed: number, count: number): number[] {
  const rng = createGameState({ seed }).rng;
  return Array.from({ length: count }, () => nextUint32(rng));
}

function findSeed(predicate: (draws: readonly number[]) => boolean, from = 1): number {
  for (let seed = from; seed < from + 40000; seed += 1) if (predicate(firstDraws(seed, 3))) return seed;
  throw new Error("no seed satisfies the draw predicate");
}

function freshRng(seed: number): RngState {
  return { ...createGameState({ seed }).rng };
}

// ---- the rig ----------------------------------------------------------------

type ActorSpec = { hp?: number; maxHp?: number; smp?: number; maxSmp?: number; fp?: number; dp?: number; by?: number; on?: number; kind?: "party" | "enemy"; source?: string };

type RunOptions = {
  readonly scenario: string;
  readonly seed?: number;
  readonly hookmode?: "record" | "wait" | "none";
  readonly attacker?: ActorSpec | null;
  readonly target?: ActorSpec | null;
  readonly second?: ActorSpec;
  readonly amount?: number;
  readonly pool?: string;
  readonly file?: string;
  readonly rounds?: number;
  readonly itemMutate?: number;
  readonly itemCancel?: number;
  readonly assets?: Readonly<Record<string, string>>;
  readonly saveWhen?: (state: GameState) => boolean;
  readonly inventory?: GameState["inventory"];
  readonly applyInventoryOwner?: boolean;
  readonly watchFallen?: boolean;
};

type RunResult = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly steps: number;
  readonly saved: boolean;
  readonly requested: readonly string[];
  readonly inventoryEvents: readonly InventoryEventObservation[];
};

type InventoryEventObservation = {
  readonly type: string;
  readonly detail: unknown;
  readonly targetStats: { readonly hp: number; readonly smp: number } | null;
  readonly scriptOrder: string;
};

function makeActor(state: GameState, spec: ActorSpec, fallbackSource: string) {
  const record = addActor(state.actors, {
    kind: spec.kind ?? "party",
    source: spec.source ?? fallbackSource,
    name: fallbackSource,
    stats: {
      experience: 0, hp: spec.hp ?? 20, maxHp: spec.maxHp ?? 20, smp: spec.smp ?? 20, maxSmp: spec.maxSmp ?? 20,
      fp: spec.fp ?? 0, dp: spec.dp ?? 0, level: 1, criticalBy: spec.by ?? -1, criticalOn: spec.on ?? -1,
    },
  });
  const object = registerActorObject(state.vm, state.events, state.actors, record.id);
  if (object === null || object.className === null) throw new Error("actor did not hydrate");
  return { record, value: { kind: "object" as const, handle: object.handle, className: object.className } };
}

function servicesFor(
  state: GameState,
  layers: PluginLayers,
  inventoryEvents?: InventoryEventObservation[],
): ScriptServices {
  const menuPorts = createMenuOwnerPorts(state, undefined, {
    item: (source) => source === "item/potion.itm" ? battlePotionDefinition : undefined,
    character: () => undefined,
    applyEquipment: () => true,
  }, (event) => {
    inventoryEvents?.push({
      type: event.type,
      detail: event.detail,
      targetStats: state.actors.actors.some((actor) => actor.id === TARGET)
        ? { hp: stat(state, TARGET, "hp"), smp: stat(state, TARGET, "smp") }
        : null,
      scriptOrder: String(state.vm.globals.order),
    });
  });
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
    undefined, undefined, loader, "default",
    inventoryEvents === undefined ? undefined : (section, effect) => {
      if (section === "inventory" && effect.name === "battleconsume") applyMenuStateEffect(menuPorts, effect);
    },
    undefined, layers, [], false, undefined, undefined, menuPorts,
  );
}

function totalSteps(state: GameState): number {
  return Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
}

function run(options: RunOptions): RunResult {
  const seed = options.seed ?? 5;
  const assets = options.assets ?? {};
  const inventoryEvents: InventoryEventObservation[] = [];
  const applyInventoryOwner = options.applyInventoryOwner === true;
  const requested: string[] = [];
  let state = createGameState({ seed });
  if (options.inventory !== undefined) state.inventory = options.inventory;
  const attackerSpec = options.attacker === undefined ? { fp: 10, smp: 10 } : options.attacker;
  const attacker = attackerSpec === null ? null : makeActor(state, { source: "hero.tem", ...attackerSpec }, "hero.tem");
  const target = options.target === null ? null : makeActor(state, { kind: "enemy", hp: 1000, maxHp: 1000, ...options.target }, "slime.tem");
  const second = makeActor(state, { kind: "enemy", ...options.second }, "bat.tem");
  if (attacker !== null && target !== null) {
    state.battle = {
      id: 1,
      boardKey: "boards/battle-actions.brd",
      background: "battle-actions.bkg",
      canRun: true,
      outcome: null,
      parties: [
        [
          { party: 0, actorId: target.record.id, charge: 0 },
          { party: 0, actorId: second.record.id, charge: 0 },
        ],
        [{ party: 1, actorId: attacker.record.id, charge: 0 }],
      ],
    };
  }
  const layers = createPluginLayers();
  let services = servicesFor(state, layers, applyInventoryOwner ? inventoryEvents : undefined);
  runPackageStartup(state, services, [startupRef], [stockBattle]);
  const globals = state.vm.globals;
  globals.scenario = options.scenario;
  globals.hookmode = options.hookmode ?? "none";
  globals.attacker = attacker === null ? null : attacker.value;
  globals.target = target === null ? null : target.value;
  globals.second = second.value;
  globals.third = null;
  globals.amountin = options.amount ?? 0;
  globals.poolin = options.pool ?? "hp";
  globals.filein = options.file ?? "";
  globals.rounds = options.rounds ?? 0;
  globals.itemmutate = options.itemMutate ?? 0;
  globals.itemcancel = options.itemCancel ?? 0;
  globals.watchfallen = options.watchFallen === true ? 1 : 0;
  startProgram(state.vm, { ...fileProgramRef(loader, "battle-actions.prg"), owner: "battle-actions-test" });
  const before = totalSteps(state);
  let saved = false;
  const poll = (current: () => GameState) => (_view: unknown, wait: Wait) => {
    if (wait.kind !== "request") return defaultWaitPoll(_view as never, wait);
    const path = current().vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.path;
    const name = typeof path === "string" ? path.toLowerCase().split(/[\\/]/).at(-1) ?? "" : "";
    requested.push(name);
    const bytes = assets[name];
    return bytes === undefined ? { ok: false as const, value: null } : { ok: true as const, value: bytes };
  };
  const answer = poll(() => state);
  for (let tick = 0; tick < 120; tick += 1) {
    runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events }, answer as never, undefined, services);
    runThreadsPhase(state.vm, services, STEP_BUDGET);
    runEventsPhase(state, services, STEP_BUDGET);
    state.time.tick += 1;
    if (!saved && options.saveWhen !== undefined && options.saveWhen(state)) {
      const json = snapshot(state);
      const scratchLayers = createPluginLayers();
      const scratch = createGameState({ seed });
      runPackageStartup(scratch, servicesFor(scratch, scratchLayers), [startupRef], [stockBattle]);
      state = restoreGameState(json);
      services = servicesFor(state, scratchLayers, applyInventoryOwner ? inventoryEvents : undefined);
      verifyRestoredHandles(state.vm, services);
      saved = true;
    }
    if (state.vm.globals.ended === 1) return { state, services, steps: totalSteps(state) - before, saved, requested, inventoryEvents };
  }
  throw new Error(`scenario ${options.scenario} did not finish; order=${String(state.vm.globals.order)}`);
}

/** The own keys of a real event detail a script listener kept, in the order the emitter wrote them. */
function detailKeys(state: GameState, value: unknown): string[] {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object" || !("handle" in value) || typeof value.handle !== "number") {
    throw new Error("the global did not hold an event detail");
  }
  const record = state.vm.objects.find((object) => object.handle === value.handle);
  if (record === undefined) throw new Error("the event detail handle is dangling");
  return [...record.keys];
}

function stat(state: GameState, id: number, field: "hp" | "smp"): number {
  const record = state.actors.actors.find((actor) => actor.id === id);
  if (record === undefined) throw new Error(`no actor ${id}`);
  return record.stats[field];
}

const ATTACKER = 1;
const TARGET = 2;
const SECOND = 3;

function codes(services: ScriptServices): string[] {
  return services.diagnostics.map(({ code }) => code);
}

function attackWith(seed: number, amount: number, dp: number, by: number, on: number) {
  const result = run({ scenario: "attack", seed, attacker: { fp: amount, by }, target: { dp, on } });
  const expected = oracle(seed, amount, dp, by, on);
  return { result, expected };
}

function expectAttack(seed: number, amount: number, dp: number, by: number, on: number): Oracle {
  const { result, expected } = attackWith(seed, amount, dp, by, on);
  equal(result.state.vm.globals.dealt, expected.damage, "reported damage");
  equal(stat(result.state, TARGET, "hp"), 1000 - expected.damage, "HP written through the actor owner");
  deepEqual({ ...result.state.rng }, expected.rng, `exactly ${expected.used} draw(s), in luck/offensive/defensive order`);
  deepEqual(codes(result.services), []);
  return expected;
}

// ---- ordinary attack: seeded damage table -----------------------------------

test("luck swing edges: -10 and +9 percent, truncation toward zero, minimum 1", () => {
  const minusTen = findSeed(([u]) => u! % 20 - 10 === -10);
  const plusNine = findSeed(([u]) => u! % 20 - 10 === 9);
  equal(expectAttack(minusTen, 100, 0, -1, -1).damage, 90);
  equal(expectAttack(plusNine, 100, 0, -1, -1).damage, 109);
  equal(expectAttack(minusTen, 15, 0, -1, -1).damage, 13, "13.5 drops to 13");
  equal(expectAttack(plusNine, 15, 0, -1, -1).damage, 16, "16.35 drops to 16");
  equal(expectAttack(minusTen, 1, 0, -1, -1).damage, 1, "0.9 truncates to 0 and the floor lifts it to 1");
  equal(expectAttack(plusNine, 1, 0, -1, -1).damage, 1);
  const minusOne = findSeed(([u]) => u! % 20 - 10 === -1);
  equal(expectAttack(minusOne, 7, 0, -1, -1).damage, 6, "6.93 drops to 6");
});

test("DP is subtracted and the damage floor is 1 when DP exceeds the damage", () => {
  const seed = findSeed(([u]) => u! % 20 - 10 === 0);
  equal(expectAttack(seed, 30, 12, -1, -1).damage, 18);
  equal(expectAttack(seed, 10, 50, -1, -1).damage, 1);
  equal(expectAttack(seed, 10, 10, -1, -1).damage, 1, "damage equal to DP is 0 and floors to 1");
});

test("a supplied amount of 0 or less draws nothing, skips DP and deals the floor of 1", () => {
  for (const amount of [0, -5]) {
    const result = run({ scenario: "attackamount", seed: 9, amount, pool: "hp", target: { dp: 7 } });
    equal(result.state.vm.globals.dealt, 1);
    equal(stat(result.state, TARGET, "hp"), 999);
    deepEqual({ ...result.state.rng }, freshRng(9), `amount ${amount} consumed no random number`);
    deepEqual(codes(result.services), []);
  }
});

test("critical draws: offensive first and short-circuits defensive, -1 draws nothing, limit 0 always skips DP", () => {
  const offensive = findSeed(([, o]) => o! % 4 === 0);
  const offensiveCrit = expectAttack(offensive, 40, 9, 3, 3);
  equal(offensiveCrit.critical, true);
  equal(offensiveCrit.used, 2, "an offensive critical never draws the defensive value");
  equal(offensiveCrit.damage, Math.trunc(40 * (100 + offensiveCrit.luck!) / 100), "critical hit skips DP");

  const defensive = findSeed(([, o, d]) => o! % 4 !== 0 && d! % 4 === 0);
  const defensiveCrit = expectAttack(defensive, 40, 9, 3, 3);
  equal(defensiveCrit.critical, true);
  equal(defensiveCrit.used, 3);

  const neither = findSeed(([, o, d]) => o! % 4 !== 0 && d! % 4 !== 0);
  const plain = expectAttack(neither, 40, 9, 3, 3);
  equal(plain.critical, false);
  equal(plain.used, 3);
  equal(plain.damage, Math.trunc(40 * (100 + plain.luck!) / 100) - 9, "no critical subtracts DP");

  const none = expectAttack(neither, 40, 9, -1, -1);
  equal(none.used, 1, "-1 on both sides draws only the luck number");
  equal(none.damage, Math.trunc(40 * (100 + none.luck!) / 100) - 9);

  const defensiveOnly = findSeed(([, o]) => o! % 3 === 0);
  const onlyDefensive = expectAttack(defensiveOnly, 40, 9, -1, 2);
  equal(onlyDefensive.used, 2, "the offensive -1 draws nothing, so the defensive draw is the second number");
  equal(onlyDefensive.critical, true);

  const limitZero = expectAttack(neither, 40, 9, 0, 5);
  equal(limitZero.critical, true, "a limit of 0 is always a critical hit");
  equal(limitZero.used, 2, "a limit of 0 still draws once, and then skips the defensive side");

  const defensiveZero = expectAttack(neither, 40, 9, -1, 0);
  equal(defensiveZero.critical, true);
  equal(defensiveZero.used, 2);
});

test("direction: only the attacker's offensive criticalBy and the target's defensive criticalOn take part", () => {
  const seed = findSeed(() => true);
  const result = run({ scenario: "attack", seed, attacker: { fp: 40, on: 0 }, target: { dp: 9, by: 0 } });
  const expected = oracle(seed, 40, 9, -1, -1);
  equal(result.state.vm.globals.dealt, expected.damage);
  equal(expected.used, 1);
  deepEqual({ ...result.state.rng }, expected.rng, "the attacker's defensive and the target's offensive values are ignored");
});

test("no attacker, no target or a fallen attacker changes nothing, reports 0 and consumes no random number", () => {
  const cases: RunOptions[] = [
    { scenario: "attack", seed: 3, attacker: null },
    { scenario: "attack", seed: 3, target: null },
    { scenario: "attack", seed: 3, attacker: { fp: 12, hp: 0 } },
    { scenario: "attackamount", seed: 3, attacker: null, amount: 8 },
    { scenario: "attackamount", seed: 3, attacker: { fp: 12, hp: 0 }, amount: 8 },
    { scenario: "attackamount", seed: 3, target: null, amount: 8 },
  ];
  for (const options of cases) {
    const result = run(options);
    equal(result.state.vm.globals.dealt, 0, JSON.stringify(options));
    deepEqual({ ...result.state.rng }, freshRng(3), "no draw");
    if (options.target !== null) equal(stat(result.state, options.attacker === null ? ATTACKER : TARGET, "hp"), 1000);
    deepEqual(codes(result.services), []);
  }

  // BAT-6: a fallen attacker's moves and items do nothing either. The assets are
  // present, so only the source guard can keep the target unchanged.
  const move = run({
    scenario: "special", seed: 3, file: "fire.spc",
    attacker: { hp: 0, smp: 10 }, target: { hp: 1000, smp: 20 },
    assets: { "fire.spc": moveAsset({ fp: 7, targetSmp: 3, cost: 2, animation: "" }) },
  });
  equal(move.state.vm.globals.movedhp, 0, "a fallen attacker's move deals no HP damage");
  equal(move.state.vm.globals.movedsmp, 0, "a fallen attacker's move drains no SMP");
  equal(move.state.vm.globals.movedcost, 0, "a fallen attacker's move costs no SMP");
  equal(stat(move.state, TARGET, "hp"), 1000);
  equal(stat(move.state, TARGET, "smp"), 20);
  equal(stat(move.state, ATTACKER, "smp"), 10);
  deepEqual({ ...move.state.rng }, freshRng(3), "no draw");

  const item = run({
    scenario: "item", seed: 3, file: "potion.itm",
    attacker: { hp: 0 }, target: { hp: 10, maxHp: 20, smp: 12 },
    assets: { "potion.itm": itemAsset({ hp: 5, smp: 3, animation: "" }) },
  });
  equal(item.state.vm.globals.usedhp, 0, "a fallen attacker's item heals nothing");
  equal(item.state.vm.globals.usedsmp, 0);
  equal(stat(item.state, TARGET, "hp"), 10);
  equal(stat(item.state, TARGET, "smp"), 12);
  deepEqual({ ...item.state.rng }, freshRng(3), "no draw");
});

test("attackAmount supplies the base: pool selects SMP, and a product beyond 32 bits stays exact", () => {
  const seed = findSeed(([u]) => u! % 20 - 10 === 9);
  const smp = run({ scenario: "attackamount", seed, amount: 6, pool: "smp", attacker: { fp: 99 }, target: { smp: 50, maxSmp: 50 } });
  equal(smp.state.vm.globals.dealt, 6, "the supplied amount replaces the attacker's FP; 6 * 1.09 drops to 6");
  equal(stat(smp.state, TARGET, "smp"), 44);
  equal(stat(smp.state, TARGET, "hp"), 1000, "HP is untouched by an SMP attack");
  // 1.5e9 * 109 is about 1.6e11, far beyond 32 bits, yet the quotient stays below 2^31.
  const base = 1_500_000_000;
  const huge = run({ scenario: "attackamount", seed, amount: base, pool: "hp", target: { hp: 2_000_000_000, maxHp: 2_000_000_000 } });
  equal(huge.state.vm.globals.dealt, 1_635_000_000, "exact integer arithmetic: 1.5e9 * 109 / 100");
  equal(stat(huge.state, TARGET, "hp"), 365_000_000);
  deepEqual({ ...huge.state.rng }, oracle(seed, base, 0, -1, -1).rng);
  deepEqual(codes(huge.services), []);
});

test("attackAmount clamps an SMP-pool underflow at zero", () => {
  const result = run({
    scenario: "attackamount", seed: 14, amount: 30, pool: "smp",
    attacker: { fp: 99 }, target: { smp: 4, maxSmp: 20 },
  });
  equal(stat(result.state, TARGET, "smp"), 0);
});

// ---- special moves (R11-Q7) -------------------------------------------------

const heroChar = characterAsset("cast.anm");
const specialAssets = (move: Parameters<typeof moveAsset>[0], stance = "cast.anm") => ({
  "hero.tem": stance === "cast.anm" ? heroChar : characterAsset(stance),
  "fire.spc": moveAsset(move),
});

test("special move clamps HP, SMP and the user's cost; no luck, DP, critical or floor", () => {
  const basic = run({
    scenario: "special", seed: 4, file: "fire.spc",
    attacker: { smp: 10, fp: 99, by: 0 }, target: { hp: 20, smp: 20, dp: 99, on: 0 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "" }, ""),
  });
  const g = basic.state.vm.globals;
  deepEqual([g.movedhp, g.movedsmp, g.movedcost], [7, 3, 4]);
  equal(stat(basic.state, TARGET, "hp"), 13);
  equal(stat(basic.state, TARGET, "smp"), 17);
  equal(stat(basic.state, ATTACKER, "smp"), 6);
  deepEqual({ ...basic.state.rng }, freshRng(4), "no random draw");
  deepEqual(codes(basic.services), []);

  const clamped = run({
    scenario: "special", file: "fire.spc", attacker: { smp: 10 }, target: { hp: 5, smp: 3 },
    assets: specialAssets({ fp: 50, targetSmp: 50, cost: 10, animation: "" }, ""),
  });
  deepEqual([clamped.state.vm.globals.movedhp, clamped.state.vm.globals.movedsmp, clamped.state.vm.globals.movedcost], [5, 3, 10]);
  equal(stat(clamped.state, TARGET, "hp"), 0);
  equal(stat(clamped.state, TARGET, "smp"), 0);
  equal(stat(clamped.state, ATTACKER, "smp"), 0, "a cost equal to the user's SMP is affordable and stops at 0");
});

test("special move with 0 FP does no damage; a negative FP heals and stops at the maximum", () => {
  const zero = run({
    scenario: "special", file: "fire.spc", attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 0, targetSmp: 0, cost: 2, animation: "" }, ""),
  });
  equal(zero.state.vm.globals.movedhp, 0);
  equal(stat(zero.state, TARGET, "hp"), 20);
  equal(stat(zero.state, ATTACKER, "smp"), 8, "the cost is still paid");

  const heal = run({
    scenario: "special", file: "fire.spc", attacker: { smp: 10 }, target: { hp: 18, maxHp: 20, smp: 5, maxSmp: 20 },
    assets: specialAssets({ fp: -10, targetSmp: -40, cost: 0, animation: "" }, ""),
  });
  equal(stat(heal.state, TARGET, "hp"), 20, "a heal stops at the maximum");
  equal(stat(heal.state, TARGET, "smp"), 20);
  equal(Math.abs(Number(heal.state.vm.globals.movedhp)), 2, "only the 2 HP actually restored is reported");
  equal(Math.abs(Number(heal.state.vm.globals.movedsmp)), 15);
});

test("an unaffordable special move mutates nothing, draws nothing and reports battle.unaffordable", () => {
  const result = run({
    scenario: "special", seed: 6, file: "fire.spc", hookmode: "record",
    attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 11, animation: "fire.anm", program: "fire.prg" }),
  });
  const g = result.state.vm.globals;
  deepEqual([g.movedhp, g.movedsmp, g.movedcost], [0, 0, 0]);
  equal(stat(result.state, TARGET, "hp"), 20);
  equal(stat(result.state, TARGET, "smp"), 20);
  equal(stat(result.state, ATTACKER, "smp"), 10);
  equal(g.order, "", "no animation and no program for a refused move");
  deepEqual({ ...result.state.rng }, freshRng(6));
  ok(codes(result.services).includes("battle.unaffordable"), `diagnostics: ${codes(result.services).join(",")}`);
});

test("a special move whose asset cannot be read returns zeros and mutates nothing", () => {
  const result = run({ scenario: "special", file: "missing.spc", attacker: { smp: 10 }, target: { hp: 20, smp: 20 }, hookmode: "record" });
  const g = result.state.vm.globals;
  deepEqual([g.movedhp, g.movedsmp, g.movedcost], [0, 0, 0]);
  equal(stat(result.state, TARGET, "hp"), 20);
  equal(stat(result.state, ATTACKER, "smp"), 10);
  equal(g.order, "");
});

const fireAssets = specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "fire.anm", program: "fire.prg" });

test("special move presentation order: user stance animation, move animation, program, all after the effect", () => {
  const result = run({ scenario: "special", file: "fire.spc", hookmode: "record", attacker: { smp: 10 }, target: { hp: 20, smp: 20 }, assets: fireAssets });
  equal(result.state.vm.globals.order,
    `cast.anm@${ATTACKER}:20:6;fire.anm@${TARGET}:13:17;P:fire.prg:${ATTACKER}>${TARGET}:;`,
    "user (hook argument order file, fighter) then move animation over the target, then the program with source and target");
  ok(result.requested.includes("hero.tem"), "the stance file is read from the user's actor.source asset");
});

test("a special move applies its status after the move program runs", () => {
  const result = run({
    scenario: "special", file: "fire.spc", hookmode: "record",
    attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: {
      ...specialAssets({ fp: 5, targetSmp: 0, cost: 0, animation: "", program: "fire.prg", status: "burn.ste" }),
      "burn.ste": statusEffectAsset(2),
    },
  });
  ok(result.requested.includes("burn.ste"), "the move's referenced status asset is loaded");
  equal(result.state.vm.globals.order,
    `cast.anm@${ATTACKER}:20:10;P:fire.prg:${ATTACKER}>${TARGET}:;`,
    "the program reads no status because it runs before the status is applied");
  deepEqual(result.state.actors.actors.find(({ id }) => id === TARGET)?.statuses, { "burn.ste": 2 });
});

test("a lethal Fight fires fallen exactly once", () => {
  const result = run({
    scenario: "attack", seed: 17, watchFallen: true,
    attacker: { fp: 30 }, target: { hp: 3, maxHp: 20 },
  });
  equal(stat(result.state, TARGET, "hp"), 0);
  equal(result.state.vm.globals.fallen1, 1);
});

test("a lethal Special Move fires fallen exactly once", () => {
  const result = run({
    scenario: "special", watchFallen: true, file: "fire.spc",
    attacker: { smp: 10 }, target: { hp: 3, maxHp: 20 },
    assets: specialAssets({ fp: 20, targetSmp: 0, cost: 0, animation: "" }),
  });
  equal(stat(result.state, TARGET, "hp"), 0);
  equal(result.state.vm.globals.fallen1, 1);
});

test("an empty stance or move animation skips the hook; an empty program is not run", () => {
  const noStance = run({
    scenario: "special", file: "fire.spc", hookmode: "record", attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "fire.anm", program: "fire.prg" }, ""),
  });
  equal(noStance.state.vm.globals.order, `fire.anm@${TARGET}:13:17;P:fire.prg:${ATTACKER}>${TARGET}:;`);
  const noMove = run({
    scenario: "special", file: "fire.spc", hookmode: "record", attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "", program: "" }),
  });
  equal(noMove.state.vm.globals.order, `cast.anm@${ATTACKER}:20:6;`);
});
const nestedMoveAssets = specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "", program: "battle-action-program.prg" });
test("special move executes a nested program with actor handles and restores both slots", () => {
  const result = run({
    scenario: "special", file: "fire.spc", hookmode: "none", attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: nestedMoveAssets,
  });
  const globals = result.state.vm.globals;
  equal(globals.programcalls, 1);
  equal(globals.programsource, String(ATTACKER));
  equal(globals.programtarget, String(TARGET));
  equal(globals.programcontextsource, String(ATTACKER));
  equal(globals.programcontexttarget, String(TARGET));
  equal(globals.postsource, 0);
  equal(globals.posttarget, 0);
  equal(stat(result.state, TARGET, "hp"), 13);
  equal(stat(result.state, ATTACKER, "smp"), 6);
  deepEqual(codes(result.services), []);
});

test("executeProgram receives actor handles and extra context data", () => {
  const result = run({
    scenario: "programcontext", file: "battle-action-program.prg", hookmode: "none",
    attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
  });
  const globals = result.state.vm.globals;
  equal(globals.programcalls, 1);
  equal(globals.programsource, String(ATTACKER));
  equal(globals.programtarget, String(TARGET));
  equal(globals.programcontextsource, String(ATTACKER));
  equal(globals.programcontexttarget, String(TARGET));
  equal(globals.programcontextlabel, "extra");
  equal(globals.programcontextvalue, 17);
  equal(globals.postsource, 0);
  equal(globals.posttarget, 0);
});

test("executeProgram with a blank program name does nothing", () => {
  const result = run({
    scenario: "programcontext", file: "", hookmode: "none",
    attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
  });
  equal(result.state.vm.globals.programcalls, 0);
  equal(result.state.vm.globals.postsource, 0);
  equal(result.state.vm.globals.posttarget, 0);
  deepEqual(codes(result.services), []);
});

test("an error in a special-move program is reported without breaking the action", () => {
  const result = run({
    scenario: "special", file: "fire.spc", hookmode: "none", attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "", program: "battle-action-error.prg" }),
  });
  equal(result.state.vm.globals.programerrorresumed, 1);
  equal(result.state.vm.globals.postsource, 0);
  equal(result.state.vm.globals.posttarget, 0);
  equal(stat(result.state, TARGET, "hp"), 13);
  equal(stat(result.state, ATTACKER, "smp"), 6);
  ok(codes(result.services).includes("unknown.command"));
});

test("saving inside a nested special-move program restores its execution and source/target pair", () => {
  const options = {
    scenario: "special", seed: 19, file: "fire.spc", hookmode: "none" as const,
    attacker: { smp: 10 }, target: { hp: 20, smp: 20 },
    assets: specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "", program: "battle-action-wait.prg" }),
  };
  const straight = run(options);
  const parked = run({ ...options, saveWhen: (state) => state.vm.globals.programstarted === 1 });
  equal(parked.saved, true);
  equal(parked.state.vm.globals.programcalls, 1);
  equal(parked.state.vm.globals.programresumed, 1);
  equal(parked.state.vm.globals.programsource, String(ATTACKER));
  equal(parked.state.vm.globals.programtarget, String(TARGET));
  equal(parked.state.vm.globals.postsource, 0);
  equal(parked.state.vm.globals.posttarget, 0);
  equal(hashGameState(parked.state), hashGameState(straight.state));
  equal(stat(parked.state, TARGET, "hp"), 13);
  equal(stat(parked.state, ATTACKER, "smp"), 6);
});


test("the default animate hook draws nothing and returns without parking", () => {
  const assets = specialAssets({ fp: 7, targetSmp: 3, cost: 4, animation: "fire.anm", program: "" });
  const result = run({ scenario: "special", file: "fire.spc", hookmode: "none", attacker: { smp: 10 }, target: { hp: 20, smp: 20 }, assets });
  equal(stat(result.state, TARGET, "hp"), 13);
  equal(result.state.vm.globals.order, "");
  deepEqual(codes(result.services), []);
});

test("a waiting animate or program hook parks the action thread; save/restore while parked is deterministic", () => {
  const options = { scenario: "special", seed: 8, file: "fire.spc", hookmode: "wait" as const, attacker: { smp: 10 }, target: { hp: 20, smp: 20 }, assets: fireAssets };
  const straight = run(options);
  equal(straight.state.vm.globals.order, "w1 cast.anm;w2 cast.anm;w1 fire.anm;w2 fire.anm;p1 fire.prg;p2 fire.prg;");
  const markers = ["w1 cast.anm;", "w1 cast.anm;w2 cast.anm;w1 fire.anm;", "w1 cast.anm;w2 cast.anm;w1 fire.anm;w2 fire.anm;p1 fire.prg;"];
  for (const marker of markers) {
    const parked = run({
      ...options,
      saveWhen: (state) => state.vm.globals.order === marker,
    });
    equal(parked.saved, true, `saved while parked after ${marker}`);
    equal(parked.state.vm.globals.order, straight.state.vm.globals.order);
    equal(hashGameState(parked.state), hashGameState(straight.state), `restore at ${marker} reproduces the same state hash`);
    equal(stat(parked.state, TARGET, "hp"), 13, "the effect happens exactly once");
    equal(stat(parked.state, ATTACKER, "smp"), 6);
  }
});

// ---- items ------------------------------------------------------------------

type Effect = { kind: string; item: string; target: number; hp: number; smp: number };

function consumeEffects(state: GameState): Effect[] {
  const found: Effect[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if ("kind" in value && value.kind === "inventory.consume") {
      const payload: Effect = value as Effect; // the payload was just discriminated on its kind
      found.push(payload);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const effect of state.vm.effects) visit(effect);
  return found;
}

test("battle helper applies clamped HP and SMP and posts one consume request without editing inventory", () => {
  const assets = { "potion.itm": itemAsset({ hp: 15, smp: -30, animation: "" }) };
  const inventoryBefore = JSON.stringify(createGameState({ seed: 2 }).inventory);
  const result = run({ scenario: "item", seed: 2, file: "potion.itm", attacker: { smp: 10 }, target: { hp: 10, maxHp: 20, smp: 12 }, assets });
  const g = result.state.vm.globals;
  equal(stat(result.state, TARGET, "hp"), 20, "10 + 15 stops at the maximum");
  equal(stat(result.state, TARGET, "smp"), 0, "12 - 30 stops at 0");
  equal(Math.abs(Number(g.usedhp)), 10, "the applied, clamped HP change is reported");
  equal(Math.abs(Number(g.usedsmp)), 12);
  deepEqual({ ...result.state.rng }, freshRng(2), "no luck, critical or DP");
  const effects = consumeEffects(result.state);
  equal(effects.length, 1, "exactly one inventory.consume effect");
  equal(effects[0]!.kind, "inventory.consume");
  equal(effects[0]!.item, "potion.itm");
  equal(effects[0]!.target, TARGET);
  equal(JSON.stringify(result.state.inventory), inventoryBefore, "the helper edits no inventory list");
  equal(stat(result.state, ATTACKER, "smp"), 10, "using an item costs the user no SMP");
});

test("item damage sends exactly one cancelable beforeDamage with the ruled detail and clamps at the owner maximum", () => {
  const options: RunOptions = { scenario: "itemdispatch", seed: 2, file: "potion.itm", attacker: { smp: 10 }, target: { hp: 10, maxHp: 20, smp: 12 }, assets: { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "" }) } };
  const straight = run(options);
  const view = straight.state.vm.globals;
  equal(view.bd1, 1, "an item action dispatches exactly one cancelable beforeDamage");
  deepEqual(detailKeys(straight.state, view.itemdetail), ["source", "target", "damage"], "the item's dispatch carries exactly the ruled detail keys");
  equal(view.itemdetailsource, ATTACKER, "the detail's source is the item's user");
  equal(view.itemdetailtarget, TARGET, "the detail's target is the recipient");
  equal(view.itemdetaildamage, -5, "the item's HP gain is the negative damage the package dispatches");
  equal(Math.abs(Number(view.usedhp)), 5, "the package reports the item's HP change");
  equal(stat(straight.state, TARGET, "hp"), 15);

  const mutated = run({ ...options, itemMutate: 1 });
  equal(mutated.state.vm.globals.bd1, 1, "a listener mutation does not add a second dispatch");
  equal(mutated.state.vm.globals.itemdetaildamage, -5, "the captured detail is the amount before mutation");
  equal(mutated.state.vm.globals.itemmutateddamage, -45, "the listener wrote the mutated amount into the detail");
  equal(stat(mutated.state, TARGET, "hp"), 20, "the mutated heal stops at the owner maximum");
  equal(Math.abs(Number(mutated.state.vm.globals.usedhp)), 10, "the package reports only the clamped amount that moved");

  const canceled = run({ ...options, itemCancel: 1 });
  equal(canceled.state.vm.globals.bd1, 1, "a cancelled item action still dispatched once");
  equal(canceled.state.vm.globals.usedhp, 0, "a cancelled item damage applies nothing");
  equal(stat(canceled.state, TARGET, "hp"), 10);
});

test("a damaging item fires fallen exactly once", () => {
  const result = run({
    scenario: "item", watchFallen: true, file: "potion.itm",
    attacker: { smp: 10 }, target: { hp: 3, maxHp: 20 },
    assets: { "potion.itm": itemAsset({ hp: -20, smp: 0, animation: "" }) },
  });
  equal(stat(result.state, TARGET, "hp"), 0);
  equal(result.state.vm.globals.fallen1, 1);
});

test("battle helper leaves inventory quantity changes to the owner", () => {
  const inventory: GameState["inventory"] = {
    ...createGameState({ seed: 2 }).inventory,
    nextId: 3,
    items: [
      { id: 1, source: "item/potion.itm", handle: "Potion", quantity: 2 },
      { id: 2, source: "item/ether.itm", handle: "Ether", quantity: 1 },
    ],
    gold: 45,
  };
  const expectedInventory = JSON.parse(JSON.stringify(inventory)) as GameState["inventory"];
  const result = run({
    scenario: "item", seed: 2, file: "item/potion.itm", inventory,
    attacker: { smp: 10 }, target: { hp: 10, maxHp: 20, smp: 12 },
    assets: { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "" }) },
  });
  deepEqual(result.state.inventory, expectedInventory);
  equal(consumeEffects(result.state)[0]!.item, "item/potion.itm");
  equal(result.state.inventory.items.find(({ source }) => source === "item/potion.itm")?.quantity, 2);
});

test("battle consume routes one selected canonical stack through the owner before animation and program", () => {
  const inventory: GameState["inventory"] = {
    ...createGameState({ seed: 2 }).inventory,
    nextId: 3,
    items: [
      { id: 1, source: "item/potion.itm", handle: "Potion alias", quantity: 1 },
      { id: 2, source: "item/potion.itm", handle: "Potion", quantity: 1 },
    ],
  };
  const result = run({
    scenario: "item",
    file: "potion.itm",
    hookmode: "wait",
    inventory,
    applyInventoryOwner: true,
    attacker: { smp: 10 },
    target: { hp: 10, smp: 12 },
    saveWhen: (state) => state.vm.globals.order === "w1 heal.anm;",
    assets: { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "heal.anm", program: "heal.prg" }) },
  });
  equal(result.saved, true, "saved after consumption while the animation is parked");
  equal(consumeEffects(result.state).length, 1);
  deepEqual(result.state.inventory.items, [
    { id: 1, source: "item/potion.itm", handle: "Potion alias", quantity: 1 },
  ]);
  deepEqual(result.inventoryEvents, [
    {
      type: "itemRemoved",
      detail: { entryId: 2, source: "item/potion.itm", handle: "Potion", amount: 1, previousQuantity: 1, currentQuantity: 0 },
      targetStats: { hp: 15, smp: 12 },
      scriptOrder: "",
    },
  ]);
  equal(result.state.vm.globals.order, "w1 heal.anm;w2 heal.anm;p1 heal.prg;p2 heal.prg;");
});

test("an item use with no live target neither posts consumption nor changes inventory", () => {
  const inventory: GameState["inventory"] = {
    ...createGameState({ seed: 2 }).inventory,
    nextId: 2,
    items: [{ id: 1, source: "item/potion.itm", handle: "Potion", quantity: 1 }],
  };
  const result = run({
    scenario: "item",
    file: "potion.itm",
    target: null,
    inventory,
    applyInventoryOwner: true,
    assets: { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "" }) },
  });
  equal(consumeEffects(result.state).length, 0);
  deepEqual(result.state.inventory, inventory);
  deepEqual(result.inventoryEvents, []);
});

test("the default item program runs with source and target, then restores both slots", () => {
  const assets = {
    "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "", program: "battle-action-program.prg" }),
  };
  const result = run({
    scenario: "item", file: "potion.itm", hookmode: "none", attacker: { smp: 10 }, target: { hp: 10, smp: 12 }, assets,
  });
  const globals = result.state.vm.globals;
  equal(globals.programcalls, 1);
  equal(globals.programsource, String(ATTACKER));
  equal(globals.programtarget, String(TARGET));
  equal(globals.programcontextsource, String(ATTACKER));
  equal(globals.programcontexttarget, String(TARGET));
  equal(globals.postsource, 0);
  equal(globals.posttarget, 0);
  equal(stat(result.state, TARGET, "hp"), 15);
  equal(globals.usedhp, -5);
  equal(consumeEffects(result.state).length, 1);
  deepEqual(codes(result.services), []);
});



test("item animation runs over the target, then the item program, after the stat change", () => {
  const assets = { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "heal.anm", program: "heal.prg" }) };
  const result = run({ scenario: "item", file: "potion.itm", hookmode: "record", attacker: { smp: 10 }, target: { hp: 10, smp: 12 }, assets });
  equal(result.state.vm.globals.order, `heal.anm@${TARGET}:15:12;P:heal.prg:${ATTACKER}>${TARGET}:;`);
  const empty = run({
    scenario: "item", file: "potion.itm", hookmode: "record", target: { hp: 10, smp: 12 },
    assets: { "potion.itm": itemAsset({ hp: 5, smp: 0, animation: "" }) },
  });
  equal(empty.state.vm.globals.order, "", "an empty animation skips the hook");
});

test("an unreadable item asset mutates nothing and posts no consume effect", () => {
  const result = run({ scenario: "item", file: "missing.itm", hookmode: "record", target: { hp: 10, smp: 12 } });
  deepEqual([result.state.vm.globals.usedhp, result.state.vm.globals.usedsmp], [0, 0]);
  equal(stat(result.state, TARGET, "hp"), 10);
  equal(consumeEffects(result.state).length, 0);
});

// ---- all-target seam --------------------------------------------------------

test("attackall emits beforeDamage once per target and fallen once for each lethal hit", () => {
  const result = run({ scenario: "all", amount: 6, attacker: { fp: 1 }, target: { hp: 20, maxHp: 20 }, second: { hp: 4, maxHp: 20 } });
  const g = result.state.vm.globals;
  equal(g.bd1, 1);
  equal(g.bd2, 1);
  equal(g.fallen1, 0);
  equal(g.fallen2, 1, "a lethal hit fires fallen once");
  equal(g.dealt, 10, "6 on the first target and the 4 HP left on the second");
  equal(stat(result.state, TARGET, "hp"), 14);
  equal(stat(result.state, SECOND, "hp"), 0);
  deepEqual({ ...result.state.rng }, freshRng(5), "attackall draws nothing");
});

test("attackall and drainall ignore active critical limits and consume no random draws", () => {
  for (const [scenario, field] of [["all", "hp"], ["drainall", "smp"]] as const) {
    const seed = 5;
    const result = run({
      scenario, seed, amount: 6,
      attacker: { fp: 10, by: 0, on: 0 },
      target: { hp: 20, smp: 20, by: 0, on: 0 },
      second: { hp: 20, smp: 20, by: 0, on: 0 },
    });
    equal(result.state.vm.globals.dealt, 12, `${scenario} returns both target damage amounts`);
    equal(stat(result.state, TARGET, field), 14);
    equal(stat(result.state, SECOND, field), 14);
    deepEqual({ ...result.state.rng }, freshRng(seed), `${scenario} consumes no critical or combat draws`);
  }
});

test("a parked beforeDamage listener saves and restores to the same state", () => {
  const options = { scenario: "parked", seed: 12, amount: 50, attacker: { fp: 1 }, target: { hp: 5, maxHp: 20 } };
  const straight = run(options);
  const parked = run({ ...options, saveWhen: (state) => state.events.dispatch !== null });
  equal(parked.saved, true, "saved while the event dispatcher was active");
  equal(parked.state.vm.globals.order, "b1;b2;");
  equal(parked.state.vm.globals.fallen1, 1);
  equal(parked.state.events.dispatch, null);
  equal(hashGameState(parked.state), hashGameState(straight.state));
});

// ---- determinism and cost ---------------------------------------------------

test("the same action stream and seed give the same state hash; another seed does not", () => {
  const options = { scenario: "stream", rounds: 6, attacker: { fp: 12, smp: 30, maxSmp: 30, dp: 1, by: 4 }, target: { hp: 400, maxHp: 400, smp: 60, maxSmp: 60, dp: 2, on: 5, fp: 9 } };
  const a = run({ ...options, seed: 3 });
  const b = run({ ...options, seed: 3 });
  equal(hashGameState(a.state), hashGameState(b.state));
  equal(a.state.vm.globals.total, b.state.vm.globals.total);
  ok(hashGameState(run({ ...options, seed: 4 }).state) !== hashGameState(a.state), "another seed gives another state");
  const saved = run({ ...options, seed: 3, saveWhen: (state) => state.time.tick === 2 });
  equal(hashGameState(saved.state), hashGameState(a.state), "a mid-stream save/restore changes nothing");
});

test("VM instruction cost of one full attack stays inside one thread budget", () => {
  const baseline = run({ scenario: "noop" });
  const attack = run({ scenario: "attack", seed: 7, attacker: { fp: 20, by: 3 }, target: { dp: 2, on: 3 } });
  const cost = attack.steps - baseline.steps;
  ok(cost > 0, "the attack executes script steps");
  ok(cost < STEP_BUDGET, `one attack (${cost} steps) fits inside a single thread budget of ${STEP_BUDGET}`);
});
