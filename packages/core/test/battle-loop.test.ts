// Behavioural BAT-4 tests run the authored stock package through the real RPGCode VM.
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
  CORE_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CATALOGUE_RESPONDERS_PLUGIN,
  createBattleOwner,
  createGameState,
  createPluginLayers,
  createAssetIndex,
  createScriptServices as coreCreateScriptServices,
  defaultWaitPoll,
  fileProgramRef,
  PACKAGE_ROOT,
  hashGameState,
  nextUint32,
  readStepCounters,
  registerActorObject,
  restoreGameState,
  runPackageStartup,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  startThread,
  STATUS_EFFECT_MAGIC,
  STEP_BUDGET,
  verifyRestoredHandles,
  WORLD_PLUGIN,
  type ActorRecord,
  type GameState,
  type PluginLayers,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
  type Wait,
  type WaitPoll,
} from "../src/index.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDirectory, "..", "..", "..");
const startup = readFileSync(join(repoRoot, "stock", "stock_battle", "startup.prg"), "utf8");
const fixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-loop.prg"), "utf8");
const decisionFixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-decision.prg"), "utf8");
const decisionReadFixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-decision-read.prg"), "utf8");
const programSources: Record<string, string> = {
  "stock-battle.prg": startup,
  "battle-loop.prg": fixture,
  "battle-decision.prg": decisionFixture,
  "battle-decision-read.prg": decisionReadFixture,
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

type BattleRig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly enemies: readonly ActorRecord[];
  readonly players: readonly ActorRecord[];
  readonly seed: number;
};

function actor(state: GameState, kind: "party" | "enemy", name: string, hp = 20, statuses: Record<string, number> = {}): ActorRecord {
  const value = addActor(state.actors, {
    kind,
    source: `${name.toLowerCase()}.tem`,
    name,
    statuses,
    stats: { experience: 0, hp, maxHp: 20, smp: 10, maxSmp: 10, fp: 0, dp: 0, level: 1, criticalOn: -1, criticalBy: -1 },
  });
  const object = registerActorObject(state.vm, state.events, state.actors, value.id);
  if (object === null || object.className === null) throw new Error(`could not hydrate ${name}`);
  return value;
}

function makeState(options: {
  seed?: number;
  enemies?: number;
  players?: number;
  fallenPlayers?: readonly number[];
  enemyStatuses?: Record<string, number>;
  playerStatuses?: Record<string, number>;
} = {}): BattleRig {
  const seed = options.seed ?? 17;
  const state = createGameState({ seed });
  const enemies = Array.from({ length: options.enemies ?? 1 }, (_, index) =>
    actor(state, "enemy", `Enemy${index}`, 20, options.enemyStatuses));
  const players = Array.from({ length: options.players ?? 1 }, (_, index) =>
    actor(state, "party", `Player${index}`, options.fallenPlayers?.includes(index) ? 0 : 20, options.playerStatuses));
  state.party.members = players.map(({ id }) => id);
  state.party.selected = players[0]?.id ?? null;
  // No start operation exists yet; seed the saved section as in battle-api.test.ts.
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "test.bkg",
    canRun: true,
    outcome: null,
    parties: [
      enemies.map(({ id }) => ({ party: 0 as const, actorId: id, charge: 0 })),
      players.map(({ id }) => ({ party: 1 as const, actorId: id, charge: 0 })),
    ],
  };
  const layers = createPluginLayers();
  const services = servicesFor(state, layers);
  runPackageStartup(state, services, [startupRef], [stockBattle]);
  startProgram(state.vm, { ...fileProgramRef(loader, "battle-loop.prg"), owner: "battle-loop-test" });
  return { state, services, enemies, players, seed };
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
    undefined,
    undefined,
    loader,
    "default",
    undefined,
    undefined,
    layers,
  );
}

function restoreRig(json: string, seed: number): { readonly state: GameState; readonly services: ScriptServices } {
  const layers = createPluginLayers();
  const scratch = createGameState({ seed });
  const scratchServices = servicesFor(scratch, layers);
  runPackageStartup(scratch, scratchServices, [startupRef], [stockBattle]);
  const state = restoreGameState(json);
  const services = servicesFor(state, layers);
  verifyRestoredHandles(state.vm, services);
  return { state, services };
}
function setCharge(state: GameState, party: 0 | 1, index: number, charge: number): void {
  const owner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (section) => { state.battle = section; },
  });
  const result = owner.apply({ type: "setCharge", party, index, charge });
  if (!result.ok) throw new Error(result.error.message);
}

function tick(state: GameState, services: ScriptServices, budget = STEP_BUDGET, poll?: WaitPoll): number {
  const before = Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
  runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events },
    (view, wait) => wait.kind === "request" && poll !== undefined ? poll(view, wait) : defaultWaitPoll(view, wait),
    undefined, services);
  runThreadsPhase(state.vm, services, budget);
  state.time.tick += 1;
  const after = Object.values(readStepCounters(state.vm)).reduce((total, count) => total + count, 0);
  return after - before;
}

function startUntilFirstSleep(rig: BattleRig, poll?: WaitPoll): void {
  for (let elapsed = 0; elapsed < 32; elapsed += 1) {
    tick(rig.state, rig.services, STEP_BUDGET, poll);
    if (rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep")) return;
  }
  throw new Error("stock battle loop did not reach its initial tick sleep");
}

function statusBytes(speed: number, slow: number, disable: number, rounds = 0): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("authored loop status");
  writer.i16(rounds);
  writer.i16(speed);
  writer.i16(slow);
  writer.i16(disable);
  for (let index = 0; index < 5; index += 1) writer.i16(0);
  writer.str("");
  return writer.toBytes();
}

function statusPoll(state: GameState, flags: Readonly<Record<string, readonly [number, number, number]>>): WaitPoll {
  const encodings = new Map(Object.entries(flags).map(([name, values]) => [
    name.toLowerCase(),
    Array.from(statusBytes(...values)).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  ]));
  return (_view, wait: Wait) => {
    if (wait.kind !== "request") return null;
    const path = state.vm.effects.find((effect) => effect.request?.reqId === wait.reqId)?.request?.path;
    const name = typeof path === "string" ? path.toLowerCase().split("/").at(-1) ?? "" : "";
    const bytes = encodings.get(name);
    return bytes === undefined ? { ok: false, value: null } : { ok: true, value: bytes };
  };
}

function charges(state: GameState): number[][] {
  if (state.battle === null) throw new Error("battle unexpectedly ended");
  return state.battle.parties.map((party) => party.map(({ charge }) => charge));
}

function globals(state: GameState): Record<string, unknown> {
  return state.vm.globals;
}
function ownerSteps(state: GameState, owner: string): number {
  return readStepCounters(state.vm)[owner] ?? 0;
}

function expectedSeedCharges(seed: number, enemyCount: number, playerCount: number): number[][] {
  const rng = createGameState({ seed }).rng;
  const enemy: number[] = [];
  const player: number[] = [];
  for (let index = 0; index < enemyCount; index += 1) enemy.push(nextUint32(rng) % 123);
  for (let index = 0; index < playerCount; index += 1) player.push(nextUint32(rng) % 75);
  return [enemy, player];
}

test("speed, slow, multiple status files, and zero-round counters produce the unbounded exact rate", () => {
  const flags = {
    "speed-a.ste": [1, 0, 0] as const,
    "speed-b.ste": [1, 0, 0] as const,
    "slow.ste": [0, 1, 0] as const,
    "slow-a.ste": [0, 1, 0] as const,
    "slow-b.ste": [0, 1, 0] as const,
  };
  const rig = makeState({
    enemyStatuses: { "speed-a.ste": 0, "speed-b.ste": 2, "slow.ste": 1 },
    playerStatuses: { "slow-a.ste": 0, "slow-b.ste": 1 },
  });
  const poll = statusPoll(rig.state, flags);
  startUntilFirstSleep(rig, poll);
  const statusesBefore = rig.state.actors.actors.map(({ id, statuses }) => [id, { ...statuses }] as const);
  setCharge(rig.state, 0, 0, 10);
  setCharge(rig.state, 1, 0, 10);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[15], [9]], "3 + 2 + 2 - 2 = 5; 3 - 2 - 2 = -1");
  deepEqual(rig.state.actors.actors.map(({ id, statuses }) => [id, { ...statuses }] as const), statusesBefore, "the loop reads status flags without ticking or expiring statuses");
  equal(rig.services.diagnostics.length, 0);
});

test("a nonpositive charge rate stays below threshold instead of being clamped to zero", () => {
  const rig = makeState({ enemies: 0, playerStatuses: { "slow-a.ste": 0, "slow-b.ste": 0 } });
  const poll = statusPoll(rig.state, { "slow-a.ste": [0, 1, 0], "slow-b.ste": [0, 1, 0] });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 1, 0, 74);
  for (let pass = 0; pass < 100; pass += 1) tick(rig.state, rig.services, STEP_BUDGET, poll);
  equal(charges(rig.state)[1]?.[0], -26, "3 - 2 - 2 is -1 per pass, with no floor at zero");
  equal(globals(rig.state).turncount, 0);
});

test("disable reference-counts active status files, clamps ready charge, and resumes after the last owner removal", () => {
  const rig = makeState({ playerStatuses: { "freeze-a.ste": 0, "freeze-b.ste": 2 } });
  const poll = statusPoll(rig.state, { "freeze-a.ste": [0, 0, 1], "freeze-b.ste": [0, 0, 1] });
  startUntilFirstSleep(rig, poll);
  setCharge(rig.state, 0, 0, 0);
  setCharge(rig.state, 1, 0, 123);
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[3], [74]]);
  rig.services.actors.removeStatus(rig.players[0]!.id, "freeze-a.ste");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[6], [74]], "one remaining disable still freezes the fighter");
  rig.services.actors.removeStatus(rig.players[0]!.id, "freeze-b.ste");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[9], [77]], "after final removal the former charge grows immediately");
  tick(rig.state, rig.services, STEP_BUDGET, poll);
  deepEqual(charges(rig.state), [[12], [0]], "the threshold crossing acts on the following pass");
  equal(globals(rig.state).turnorder, "1:0,");
});

test("failed status loads contribute nothing and are requested only once per fighter and battle", () => {
  const rig = makeState({
    enemies: 2,
    players: 1,
    enemyStatuses: { "missing.ste": 0 },
    playerStatuses: { "missing.ste": 0 },
  });
  const requests: string[] = [];
  const missing: WaitPoll = (_view, wait) => {
    if (wait.kind !== "request") return null;
    requests.push(wait.file);
    return { ok: false, value: null };
  };
  startUntilFirstSleep(rig, missing);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 2, 1));
  equal(requests.length, 3, "one missing asset diagnostic/request per fighter");
  equal(rig.services.diagnostics.filter(({ code }) => code === "asset.missing").length, 3);
  for (let index = 0; index < 2; index += 1) setCharge(rig.state, 0, index, 20);
  setCharge(rig.state, 1, 0, 20);
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  deepEqual(charges(rig.state), [[23, 23], [23]], "a missing status contributes no speed, slow, or disable flag");
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  equal(requests.length, 3, "subsequent passes use the per-fighter failed-load cache");
  equal(rig.services.diagnostics.filter(({ code }) => code === "asset.missing").length, 3);
  rig.services.actors.removeStatus(rig.enemies[0]!.id, "missing.ste");
  rig.services.actors.applyStatus(rig.enemies[0]!.id, "missing.ste", 0);
  tick(rig.state, rig.services, STEP_BUDGET, missing);
  equal(requests.length, 3, "removing and reapplying a failed file does not request it again");
});

test("stock startup seeds each fighter once in enemy/player order, including fallen players, then sleeps before advancing", () => {
  const rig = makeState({ seed: 291, enemies: 2, players: 3, fallenPlayers: [1] });
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), expectedSeedCharges(rig.seed, 2, 3));
  ok(rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"), "initial charge is observable after the initial sleep is scheduled");
  equal(rig.state.time.tick, 1);
  const expectedRng = createGameState({ seed: rig.seed }).rng;
  for (let index = 0; index < 5; index += 1) nextUint32(expectedRng);
  deepEqual(rig.state.rng, expectedRng, "the loop consumes exactly one draw per fighter");
  tick(rig.state, rig.services);
  const expected = expectedSeedCharges(rig.seed, 2, 3);
  for (let index = 0; index < 2; index += 1) expected[0]![index] = expected[0]![index]! + 3;
  expected[1]![0] = expected[1]![0]! + 3;
  expected[1]![2] = expected[1]![2]! + 3;
  deepEqual(charges(rig.state), expected);
  equal(globals(rig.state).turncount, 0);
});

test("a seeded 60-pass timeline and each pass's restored continuation match the charge oracle", () => {
  const rig = makeState({ seed: 312, enemies: 2, players: 2 });
  startUntilFirstSleep(rig);
  const expected = expectedSeedCharges(rig.seed, 2, 2);
  let order = "";
  for (let pass = 0; pass < 60; pass += 1) {
    const restored = restoreRig(snapshot(rig.state), rig.seed);
    for (const party of [0, 1] as const) {
      for (let index = 0; index < 2; index += 1) {
        const charge = expected[party]![index]!;
        if (charge >= (party === 0 ? 123 : 75)) {
          expected[party]![index] = 0;
          order += `${party}:${index},`;
        } else {
          expected[party]![index] = charge + 3;
        }
      }
    }
    tick(rig.state, rig.services);
    tick(restored.state, restored.services);
    deepEqual(charges(rig.state), expected, `charge after pass ${pass}`);
    equal(globals(rig.state).turnorder, order, `turn order after pass ${pass}`);
    equal(hashGameState(restored.state), hashGameState(rig.state), `restore at pass ${pass}`);
  }
  deepEqual(rig.services.diagnostics, []);
});

test("one-tick passes advance charge deterministically; crossing threshold acts on the next pass and releases to zero", () => {
  const rig = makeState({ enemies: 1, players: 1 });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 120);
  setCharge(rig.state, 1, 0, 72);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[123], [75]]);
  equal(globals(rig.state).turncount, 0);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [0]]);
  equal(globals(rig.state).turncount, 2);
  equal(globals(rig.state).turnorder, "0:0,1:0,");
  for (let pass = 0; pass < 18; pass += 1) tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[54], [54]], "18 idle passes each add exactly the base rate of 3");
  equal(globals(rig.state).turncount, 2);

});

test("thresholds are 123 for enemies and 75 for players; all already-ready fighters act in party order", () => {
  const rig = makeState({ enemies: 3, players: 3 });
  tick(rig.state, rig.services);
  for (let index = 0; index < 3; index += 1) setCharge(rig.state, 0, index, 123);
  for (let index = 0; index < 3; index += 1) setCharge(rig.state, 1, index, 75);
  tick(rig.state, rig.services);
  equal(globals(rig.state).turnorder, "0:0,0:1,0:2,1:0,1:1,1:2,");
  deepEqual(charges(rig.state), [[0, 0, 0], [0, 0, 0]]);
});

test("a parked pass does not run until an engine tick wakes the thread", () => {
  const rig = makeState();
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 123);
  const beforeTick = snapshot(rig.state);
  for (let attempt = 0; attempt < 3; attempt += 1) runThreadsPhase(rig.state.vm, rig.services, STEP_BUDGET);
  equal(hashGameState(rig.state), hashGameState(restoreGameState(beforeTick)));
  equal(globals(rig.state).turncount, 0);
  tick(rig.state, rig.services);
  equal(globals(rig.state).turncount, 1);
  equal(charges(rig.state)[0]?.[0], 0);
});

test("the hook's multi-tick sleep freezes every fighter, including the actor whose turn is running", () => {
  const rig = makeState({ enemies: 1, players: 1 });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 123);
  setCharge(rig.state, 1, 0, 74);
  globals(rig.state).turnsleepticks = 4;
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[123], [74]]);
  for (let index = 0; index < 3; index += 1) {
    tick(rig.state, rig.services);
    deepEqual(charges(rig.state), [[123], [74]]);
  }
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [77]]);
  equal(globals(rig.state).turncount, 1);
});

test("fallen fighters keep charge without advancing or acting; reviving resumes from the retained charge", () => {
  const rig = makeState({ enemies: 1, players: 1, fallenPlayers: [0] });
  tick(rig.state, rig.services);
  setCharge(rig.state, 0, 0, 122);
  setCharge(rig.state, 1, 0, 80);
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[125], [80]]);
  equal(globals(rig.state).turncount, 0);
  rig.services.actors.updateStats(rig.players[0]!.id, { hp: 20 }, { cause: "script" });
  tick(rig.state, rig.services);
  deepEqual(charges(rig.state), [[0], [0]]);
  equal(globals(rig.state).turnorder, "0:0,1:0,");
});

test("outcomes 0 and 2 stop the stock loop only between passes, while unset outcome remains live", () => {
  const live = makeState();
  tick(live.state, live.services);
  setCharge(live.state, 0, 0, 1);
  setCharge(live.state, 1, 0, 0);
  tick(live.state, live.services);
  deepEqual(charges(live.state), [[4], [3]]);
  equal(live.state.battle?.outcome, null);

  for (const outcome of [0, 2]) {
    const decided = makeState();
    tick(decided.state, decided.services);
    globals(decided.state).finishonturn = 1;
    globals(decided.state).finishcode = outcome;
    setCharge(decided.state, 0, 0, 123);
    setCharge(decided.state, 1, 0, 75);
    tick(decided.state, decided.services);
    equal(decided.state.battle?.outcome, outcome);
    equal(globals(decided.state).turncount, 2, "later ready fighters in the deciding pass still act");
    tick(decided.state, decided.services);
    equal(globals(decided.state).turncount, 2, `outcome ${outcome} prevents another pass`);
  }

});

test("battleDecided distinguishes unset from outcomes 0 and 2, including after save restore", () => {
  for (const outcome of [null, 0, 2] as const) {
    const rig = makeState();
    startUntilFirstSleep(rig);
    globals(rig.state).finishcode = outcome ?? -1;
    startThread(rig.state.vm, { ref: fileProgramRef(loader, "battle-decision.prg"), kind: "persistent", owner: "world" });
    tick(rig.state, rig.services);
    equal(globals(rig.state).beforedecision, 0, "an unset null outcome is not decided");
    equal(rig.state.battle?.outcome, outcome);
    equal(globals(rig.state).afterdecision, outcome === null ? 0 : 1, `outcome ${outcome} helper result`);

    const { state: restored, services: restoredServices } = restoreRig(snapshot(rig.state), rig.seed);
    startThread(restored.vm, { ref: fileProgramRef(loader, "battle-decision-read.prg"), kind: "persistent", owner: "world" });
    tick(restored, restoredServices);
    equal(globals(restored).restoreddecision, outcome === null ? 0 : 1, `restored outcome ${outcome} helper result`);
  }
});

test("a sleeping battle hook and loop state round-trip exactly at every pass and mid-turn", () => {
  const uninterrupted = makeState({ seed: 603, enemies: 2, players: 2 });
  tick(uninterrupted.state, uninterrupted.services);
  setCharge(uninterrupted.state, 0, 0, 123);
  globals(uninterrupted.state).turnsleepticks = 3;
  const firstPassSteps = tick(uninterrupted.state, uninterrupted.services);
  ok(firstPassSteps < STEP_BUDGET);
  const duringTurn = snapshot(uninterrupted.state);
  const { state: restored, services: restoredServices } = restoreRig(duringTurn, 603);
  equal(hashGameState(restored), hashGameState(uninterrupted.state));
  for (let index = 0; index < 5; index += 1) {
    const stepRestore = restoreRig(snapshot(uninterrupted.state), 603);
    tick(uninterrupted.state, uninterrupted.services);
    tick(restored, restoredServices);
    tick(stepRestore.state, stepRestore.services);
    equal(hashGameState(restored), hashGameState(uninterrupted.state), `continuous restored branch after tick ${index}`);
    equal(hashGameState(stepRestore.state), hashGameState(uninterrupted.state), `one-step restore replay after tick ${index}`);
  }
});

test("nine-fighter idle pass uses 897 VM steps within STEP_BUDGET, excluding startup", () => {
  const rig = makeState({ seed: 71, enemies: 5, players: 4 });
  startUntilFirstSleep(rig); // exclude all initialization, even if budget-preempted
  for (let index = 0; index < 5; index += 1) setCharge(rig.state, 0, index, 0);
  for (let index = 0; index < 4; index += 1) setCharge(rig.state, 1, index, 0);
  tick(rig.state, rig.services); // first entry omits the steady-state loop back-edge
  deepEqual(charges(rig.state), [[3, 3, 3, 3, 3], [3, 3, 3, 3]], "one complete pass fits a real tick");
  const beforeMeasured = ownerSteps(rig.state, "stock_battle");
  tick(rig.state, rig.services);
  const measured = ownerSteps(rig.state, "stock_battle") - beforeMeasured;
  ok(rig.state.vm.threads.some((thread) => thread.wait?.kind === "sleep"), "the measured idle pass completes and parks for its next tick");
  const beforeRepeated = ownerSteps(rig.state, "stock_battle");
  tick(rig.state, rig.services);
  const repeated = ownerSteps(rig.state, "stock_battle") - beforeRepeated;
  equal(measured, 897, "measured stock_battle instructions per steady idle pass");
  equal(repeated, measured, `stable idle pass uses ${measured} VM steps`);
  ok(measured <= STEP_BUDGET, `nine-fighter idle pass used ${measured} steps, budget is ${STEP_BUDGET}`);
  equal(globals(rig.state).turncount, 0);
});

test("fake-host multi-tick catch-up matches the same sequence of engine ticks and hashes", () => {
  const stepped = makeState({ seed: 441, enemies: 2, players: 2 });
  const caughtUp = makeState({ seed: 441, enemies: 2, players: 2 });
  const hashes: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    tick(stepped.state, stepped.services);
    hashes.push(hashGameState(stepped.state));
  }
  // Bursts model a lagged host catching up; every missed tick remains an ordinary engine tick.
  let tickIndex = 0;
  for (const missedTicks of [4, 1, 5]) {
    for (let count = 0; count < missedTicks; count += 1) {
      tick(caughtUp.state, caughtUp.services);
      equal(hashGameState(caughtUp.state), hashes[tickIndex], `caught-up state after engine tick ${tickIndex + 1}`);
      tickIndex += 1;
    }
  }
  equal(tickIndex, 10);
});
