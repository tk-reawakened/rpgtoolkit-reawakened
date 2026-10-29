// Stock-battle damage (Epic 7.14 / issue #565): the package's RPGCode
// battle thread emits beforeDamage once per operation, waits for the shared
// cancelable dispatch, then writes the surviving mutation through actor owners.
// The fixture also saves while one listener is sleeping inside the dispatch.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  addActor,
  COMPILER_VERSION,
  createGameState,
  registerActorObject,
  restoreGameState,
  runPackageStartup,
  runEventsPhase,
  runThreadsPhase,
  runWaitsPhase,
  snapshot,
  startProgram,
  type ActorRecord,
  type ScriptServices,
  type BuiltinSpec,
  type GameState,
  type ResolvedPlugin,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = join(testDirectory, "..", "..", "..");
const fixture = readFileSync(join(testDirectory, "fixtures", "authored", "battle-damage.prg"), "utf8");
const startup = readFileSync(join(root, "stock", "stock_battle", "startup.prg"), "utf8");
const startupProgram = startup.slice(0, startup.indexOf("registerPlugin({"));

const stockBattleFightEnemy: BuiltinSpec = {
  name: "fightenemy",
  aliases: [],
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  call: () => ({ value: null }),
};

const stockBattle: ResolvedPlugin = {
  namespace: "stock_battle",
  definition: { id: "stock_battle", version: "1.0.0", commands: [stockBattleFightEnemy] },
};

function actorStats(hp = 20, smp = 20) {
  return { experience: 0, hp, maxHp: 20, dp: 0, fp: 0, smp, maxSmp: 20, level: 1, criticalOn: -1, criticalBy: -1 };
}

function actorProgression() {
  return {
    levelType: 0,
    experienceIncrease: 1,
    maxLevel: 99,
    levelHp: 0,
    levelDp: 0,
    levelFp: 0,
    levelSm: 0,
    levelUpType: 1,
    remainingExperience: 0,
    nextRequirement: 1,
    legacyLevelUp: false,
  };
}

function makeActor(state: GameState, hp = 20, smp = 20): ActorRecord {
  return addActor(state.actors, {
    kind: "party",
    source: "hero.tem",
    stats: actorStats(hp, smp),
    progression: actorProgression(),
  });
}

function objectValue(handle: number, className: string) {
  return { kind: "object" as const, handle, className };
}

/** The VM record a script global holds, so a test can read a real event detail's own keys. */
function objectRecord(state: GameState, value: unknown) {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object" || !("handle" in value) || typeof value.handle !== "number") {
    throw new Error("the global does not hold an object handle");
  }
  const record = state.vm.objects.find((object) => object.handle === value.handle);
  if (record === undefined) throw new Error("the object handle is dangling");
  return record;
}

function makeState(): GameState {
  const state = createGameState({ seed: 11 });
  const source = makeActor(state);
  const mutationTarget = makeActor(state);
  const cancelTarget = makeActor(state, 5);
  const specialTarget = makeActor(state);
  const smpTarget = makeActor(state);
  const allFirst = makeActor(state);
  const allSecond = makeActor(state);
  const drainFirst = makeActor(state);
  const saveTarget = makeActor(state);
  const plainTarget = makeActor(state);
  const lethalPhysical = makeActor(state, 5);
  const lethalSpecial = makeActor(state, 5);
  const clampHp = makeActor(state, 5);
  const clampSmp = makeActor(state, 20, 8);
  const actors = { source, mutationTarget, cancelTarget, specialTarget, smpTarget, allFirst, allSecond, drainFirst, saveTarget, plainTarget, lethalPhysical, lethalSpecial, clampHp, clampSmp };
  for (const actor of Object.values(actors)) {
    const object = registerActorObject(state.vm, state.events, state.actors, actor.id);
    if (object === null) throw new Error(`actor ${actor.id} did not hydrate`);
    if (object.className === null) throw new Error(`actor ${actor.id} did not receive a host class`);
    const name = Object.entries(actors).find(([, value]) => value.id === actor.id)![0];
    state.vm.globals[name.toLowerCase()] = objectValue(object.handle, object.className);
  }
  const services = createScriptServices(state, [stockBattle]);
  runPackageStartup(
    state,
    services,
    [{ kind: "inline", text: startup, compiler: COMPILER_VERSION, dialect: "tk3", owner: "stock_battle" }],
    [stockBattle],
  );
  startProgram(state.vm, { kind: "inline", text: `${startupProgram}\n${fixture}`, compiler: COMPILER_VERSION, dialect: "tk3", owner: "battle-damage-fixture" });
  return state;
}
function runBattleTick(state: GameState, services: ScriptServices): void {
  runWaitsPhase(state.vm, { tick: state.time.tick, events: state.events });
  runThreadsPhase(state.vm, services, 1000);
  runEventsPhase(state, services, 1000);
  state.time.tick += 1;
}


function runFixture(): { readonly state: GameState; readonly savedDuringDispatch: boolean } {
  let state = makeState();
  let services = createScriptServices(state, [stockBattle]);
  let savedDuringDispatch = false;
  for (let tick = 0; tick < 80; tick += 1) {
    runBattleTick(state, services);
    if (!savedDuringDispatch && state.events.dispatch !== null) {
      const saved = snapshot(state);
      state = restoreGameState(saved);
      services = createScriptServices(state, [stockBattle]);
      savedDuringDispatch = true;
    }
    if (state.vm.globals.ended === 1) return { state, savedDuringDispatch };
  }
  throw new Error("stock battle damage fixture did not finish");
}

test("stock battle sends one cancelable beforeDamage for every damage path", () => {
  const result = runFixture();
  equal(result.savedDuringDispatch, true, "save/restore must occur while the event dispatcher is active");
  const state = result.state;
  equal(state.vm.globals.order, "m1m2c1c21s1s2");
  equal(state.vm.globals.sourcedetail, 1, "source actor ids are carried in the detail");
  equal(state.vm.globals.targetdetail, 2);
  const detail = objectRecord(state, state.vm.globals.mutationdetail);
  deepEqual([...detail.keys], ["source", "target", "damage"], "beforeDamage carries exactly its ruled detail keys");
  equal(detail.members.source, 1, "the detail's source is the attacking actor id");
  equal(detail.members.target, 2, "the detail's target is the damaged actor id");
  equal(state.vm.globals.mutationinitialdamage, 10, "the detail's damage is the request amount before a listener mutates it");
  equal(detail.members.damage, 5, "a listener mutation is written into the same detail the owner then applies");
  equal(state.vm.globals.nullsourcedetail, 0, "source-null uses the engine's zero actor-id sentinel");
  equal(state.vm.globals.mutationtaken, 5);
  equal(state.vm.globals.canceltaken, 0);
  equal(state.vm.globals.cancelfallen, 0, "cancellation prevents the actor fallen transition");
  equal(state.vm.globals.smptaken, 7);
  equal(state.vm.globals.alltaken, 12);
  equal(state.vm.globals.drainalltaken, 4);
  equal(state.vm.globals.savedtaken, 4);
  equal(state.vm.globals.plaintaken, 3);
  equal(state.vm.globals.lethalphysicaltaken, 5);
  equal(state.vm.globals.lethalspecialtaken, 5);
  equal(state.vm.globals.lethalphysicalcause, "damage");
  equal(state.vm.globals.lethalphysicalsource, 1);
  equal(state.vm.globals.lethalspecialcause, "damage");
  equal(state.vm.globals.lethalspecialsource, 1);
  equal(state.vm.globals.clamphpmutated, 45, "a listener pushed the HP amount past the target's remaining HP");
  equal(state.vm.globals.clamphptaken, 5, "the owner clamps HP at zero and the package reports only the amount that moved");
  equal(state.vm.globals.clampsmpmutated, 42, "a listener pushed the SMP amount past the target's remaining SMP");
  equal(state.vm.globals.clampsmptaken, 8, "the owner clamps SMP at zero and the package reports only the amount that moved");
  equal(state.actors.actors.find((actor) => actor.id === 11)?.stats.hp, 0);
  equal(state.actors.actors.find((actor) => actor.id === 12)?.stats.hp, 0);
  equal(state.actors.actors.find((actor) => actor.id === 13)?.stats.hp, 0, "the mutated HP amount stops at zero");
  equal(state.actors.actors.find((actor) => actor.id === 14)?.stats.smp, 0, "the mutated SMP amount stops at zero");
  equal(state.actors.actors.find((actor) => actor.id === 3)?.stats.hp, 5, "cancellation prevents HP and fallen transitions");
  equal(state.actors.actors.find((actor) => actor.id === 4)?.stats.hp, 13);
  equal(state.actors.actors.find((actor) => actor.id === 5)?.stats.smp, 13);
  equal(state.actors.actors.find((actor) => actor.id === 6)?.stats.hp, 15);
  equal(state.actors.actors.find((actor) => actor.id === 7)?.stats.hp, 13);
  equal(state.actors.actors.find((actor) => actor.id === 8)?.stats.smp, 16);
  equal(state.actors.actors.find((actor) => actor.id === 9)?.stats.hp, 16);
  equal(state.actors.actors.find((actor) => actor.id === 10)?.stats.hp, 17);
  ok(state.events.dispatch === null, "the battle thread resumes only after the final listener");
});

test("stock battle damage detail remains plain and saveable", () => {
  const state = makeState();
  const services = createScriptServices(state, [stockBattle]);
  runBattleTick(state, services);
  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  deepEqual(JSON.parse(snapshot(restored)), JSON.parse(saved));
});
