import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  applyUiEffect,
  BATTLE_PLUGIN,
  BinaryWriter,
  composeUi,
  CORE_PLUGIN,
  createGameState,
  createScriptServices,
  defaultWaitPoll,
  GRAPHICS_PLUGIN,
  hashDrawList,
  hashState,
  MOVEMENT_PLUGIN,
  restoreGameState,
  runEventsPhase,
  snapshot,
  startProgram,
  STATUS_EFFECT_MAGIC,
  UI_PLUGIN,
  type DrawList,
  type GameState,
  type ScriptServices,
  type WaitPoll,
} from "../src/index.ts";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authored");
const customFight = readFileSync(join(fixtureDirectory, "battle-custom-fight.prg"), "utf8");
const plugins = [
  { definition: CORE_PLUGIN },
  { definition: BATTLE_PLUGIN },
  { definition: UI_PLUGIN },
  { definition: GRAPHICS_PLUGIN },
  { definition: MOVEMENT_PLUGIN },
] as const;

function statusEffectBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("Custom fight status");
  writer.i16(2);
  for (const value of [0, 0, 0, 0, 0, 0, 0, 0]) writer.i16(value);
  writer.str("");
  return writer.toBytes();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Rig = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly threadId: number;
  readonly poll: WaitPoll;
  releaseInput(): void;
};


function makeRig(seed: number, outcomeCode = 1): Rig {
  const state = createGameState({ seed });
  const enemy = addActor(state.actors, {
    kind: "enemy", source: "slime-a.ene", name: "Slime A",
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const enemy2 = addActor(state.actors, {
    kind: "enemy", source: "slime-b.ene", name: "Slime B",
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const hero = addActor(state.actors, {
    kind: "party", source: "hero-a.tem", name: "Hero",
    stats: { experience: 0, hp: 10, maxHp: 20, smp: 4, maxSmp: 8, dp: 3, fp: 2, level: 1 },
    progression: {
      levelType: 10,
      nextRequirement: 10,
      remainingExperience: 10,
      maxLevel: 10,
      experienceIncrease: 100,
      levelHp: 0,
      levelDp: 0,
      levelFp: 0,
      levelSm: 0,
      levelUpType: 1,
    },
  });
  const hero2 = addActor(state.actors, {
    kind: "party", source: "hero-b.tem", name: "Hero B",
    stats: { experience: 0, hp: 12, maxHp: 20, smp: 2, maxSmp: 5, dp: 1, fp: 4, level: 1 },
  });
  state.party.members = [hero.id, hero2.id];
  state.party.selected = hero.id;
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "night.bkg",
    canRun: true,
    outcome: null,
    parties: [
      [
        { party: 0, actorId: enemy.id, charge: 123 },
        { party: 0, actorId: enemy2.id, charge: 60 },
      ],
      [
        { party: 1, actorId: hero.id, charge: 75 },
        { party: 1, actorId: hero2.id, charge: 12 },
      ],
    ],
  };
  state.vm.globals.outcomecode = outcomeCode;
  const services = createScriptServices(state, plugins);
  const thread = startProgram(state.vm, { kind: "inline", text: customFight, compiler: "2" });
  let inputReady = false;
  const encodedStatus = hex(statusEffectBytes());
  const poll: WaitPoll = (view, wait) => {
    if (wait.kind === "request") return { ok: true, value: encodedStatus };
    if (wait.kind === "input.key") return inputReady ? { ok: true, value: "Enter" } : null;
    return defaultWaitPoll(view, wait);
  };

  return {
    state,
    services,
    threadId: thread.id,
    poll,
    releaseInput: () => { inputReady = true; },
  };
}

function threadOf(rig: Rig) {
  const thread = rig.state.vm.threads.find((candidate) => candidate.id === rig.threadId);
  if (thread === undefined) throw new Error("custom fight thread disappeared");
  return thread;
}

function runToInput(rig: Rig): void {
  for (let tick = 0; tick < 80; tick += 1) {
    advanceScriptTick(rig.state, rig.services, undefined, rig.poll);
    if (threadOf(rig).wait?.kind === "input.key") return;
    if (threadOf(rig).status === "finished") break;
  }
  throw new Error("custom fight did not reach its input wait");
}

function resumeToFinish(rig: Rig): void {
  rig.releaseInput();
  for (let tick = 0; tick < 80; tick += 1) {
    advanceScriptTick(rig.state, rig.services, undefined, rig.poll);
    runEventsPhase(rig.state, rig.services);
    if (threadOf(rig).status === "finished" && rig.state.events.queue.length === 0 && rig.state.events.dispatch === null) return;
  }
  throw new Error("custom fight did not finish");
}
function applyUiEffects(state: GameState): void {
  for (const effect of state.vm.effects) {
    if (effect.patch?.section === "ui") applyUiEffect(state, effect.name, effect.args);
  }
}
function drawListFor(state: GameState): DrawList {
  return {
    tick: state.time.tick,
    width: 640,
    height: 480,
    commands: composeUi(state.ui, 640, 480, state.input, false),
  };
}



test("custom fight program drives the public battle and actor APIs without stock package internals", () => {

  const rig = makeRig(11);
  runToInput(rig);
  equal(threadOf(rig).wait?.kind, "input.key");

  resumeToFinish(rig);
  applyUiEffects(rig.state);
  deepEqual(rig.services.diagnostics.map(({ code }) => code), []);
  equal(rig.state.vm.globals.coverage, "party-size;battle-read;charge;stats;status;damage-defeated;draw;input;finish;");
  equal(rig.state.vm.globals.enemycount, 2);
  equal(rig.state.vm.globals.herocount, 2);
  equal(rig.state.vm.globals.initialoutcome, 0);
  equal(rig.state.vm.globals.runallowed, 1);
  equal(rig.state.vm.globals.battlebackground, "night.bkg");
  equal(rig.state.vm.globals.initialenemycharge, 123);
  equal(rig.state.vm.globals.addedenemycharge, 131);
  equal(rig.state.vm.globals.releasedenemycharge, 0);
  equal(rig.state.vm.globals.enemypercent, 18);
  equal(rig.state.vm.globals.heropercent, 100);
  equal(rig.state.vm.globals.herohp, 9);
  equal(rig.state.vm.globals.heromaxhp, 21);
  equal(rig.state.vm.globals.herosmp, 5);
  equal(rig.state.vm.globals.heromaxsmp, 9);
  equal(rig.state.vm.globals.herofp, 6);
  equal(rig.state.vm.globals.herodp, 7);
  equal(rig.state.vm.globals.statusname, "custom-fight.ste");
  equal(rig.state.vm.globals.statuschanges, 2);
  equal(rig.state.vm.globals.enemydamage, 8);
  equal(rig.state.vm.globals.enemy2damage, 8);
  equal(rig.state.vm.globals.enemydefeated, 1);
  equal(rig.state.vm.globals.enemy2defeated, 1);
  equal(typeof rig.state.vm.globals.seededroll, "number");
  equal(rig.state.vm.globals.pressed, "Enter");
  equal(rig.state.battle?.outcome, 1);
  deepEqual(rig.state.actors.actors.find((actor) => actor.name === "Hero")?.statuses, {});
  equal(rig.state.actors.actors.find((actor) => actor.name === "Slime A")?.stats.hp, 0);
  ok(rig.state.ui.draws.some((draw) => draw.text.startsWith("Custom fight ")));
});
test("custom fight seed and mid-battle save restore preserve state and drawing", () => {
  const first = makeRig(11);
  const repeated = makeRig(11);
  const differentSeed = makeRig(12);
  for (const rig of [first, repeated, differentSeed]) {
    runToInput(rig);
    applyUiEffects(rig.state);
    equal(rig.state.battle?.outcome, null);
    equal(threadOf(rig).wait?.kind, "input.key");
  }

  const stateHash = hashState(first.state);
  const drawHash = hashDrawList(drawListFor(first.state));
  equal(stateHash, hashState(repeated.state));
  equal(drawHash, hashDrawList(drawListFor(repeated.state)));
  equal(stateHash === hashState(differentSeed.state), false);
  equal(drawHash === hashDrawList(drawListFor(differentSeed.state)), false);
  equal(stateHash, "f89983678b63bf24");
  equal(drawHash, "3fa17af6365a9ba5");

  const restoredState = restoreGameState(snapshot(first.state));
  const restoredRig: Rig = {
    state: restoredState,
    services: createScriptServices(restoredState, plugins),
    threadId: first.threadId,
    poll: first.poll,
    releaseInput: first.releaseInput,
  };
  resumeToFinish(first);
  resumeToFinish(restoredRig);
  deepEqual(first.services.diagnostics.map(({ code }) => code), []);
  deepEqual(restoredRig.services.diagnostics.map(({ code }) => code), []);
  equal(hashState(first.state), hashState(restoredState));
  equal(first.state.battle?.outcome, 1);
  equal(restoredState.battle?.outcome, 1);
});
test("a custom program cannot resolve stock battle internals without the package", () => {
  const state = createGameState({ seed: 7 });
  const services = createScriptServices(state, plugins);
  const thread = startProgram(state.vm, { kind: "inline", text: "stockBattle.turn(0, 0)", compiler: "2" });

  advanceScriptTick(state, services);
  equal(thread.status, "finished");
  equal(services.diagnostics[0]?.code, "include.missing");
});
