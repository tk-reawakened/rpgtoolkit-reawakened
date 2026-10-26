import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  addActor,
  advanceScriptTick,
  BATTLE_PLUGIN,
  BinaryWriter,
  CORE_PLUGIN,
  createBattleOwner,
  createGameState,
  createScriptServices,
  registerActorObject,
  restoreGameState,
  snapshot,
  startProgram,
  STATUS_EFFECT_MAGIC,
  type GameState,
  type WaitPoll,
} from "../src/index.ts";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authored");
const facingFixture = readFileSync(join(fixtureDirectory, "battle-facing-api.prg"), "utf8");
const statusFixture = readFileSync(join(fixtureDirectory, "battle-status-api.prg"), "utf8");
const plugins = [{ definition: CORE_PLUGIN }, { definition: BATTLE_PLUGIN }] as const;

function makeState(canRun = true) {
  const state = createGameState({ seed: 11 });
  const enemy = addActor(state.actors, {
    kind: "enemy", source: "slime.tem", name: "Slime",
    stats: { hp: 8, maxHp: 8, smp: 3, maxSmp: 3, dp: 2, fp: 3 },
  });
  const hero = addActor(state.actors, {
    kind: "party", source: "hero.tem", name: "Hero",
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
  state.party.members = [hero.id];
  state.party.selected = hero.id;
  state.battle = {
    id: 1,
    boardKey: "boards/test.brd",
    background: "night.bkg",
    canRun,
    outcome: null,
    parties: [
      [{ party: 0, actorId: enemy.id, charge: 123.5 }],
      [{ party: 1, actorId: hero.id, charge: 74 }],
    ],
  };
  return { state, enemy, hero };
}
test("battle owner starts ordered parties with fallen players and a fresh battle id", () => {
  const { state, enemy, hero } = makeState();
  const fallen = addActor(state.actors, {
    kind: "party",
    source: "fallen.tem",
    name: "Fallen",
    stats: { hp: 0, maxHp: 20 },
  });
  state.party.members = [hero.id, fallen.id];
  const owner = createBattleOwner({
    readBattle: () => state.battle,
    readActors: () => state.actors,
    commit: (battle) => { state.battle = battle; },
  });
  const result = owner.start({
    boardKey: "boards/field.brd",
    background: "night.bkg",
    canRun: false,
    enemies: [enemy.id],
    players: state.party.members,
  });
  ok(result.ok);
  equal(result.value.id, 2);
  equal(result.value.boardKey, "boards/field.brd");
  equal(result.value.background, "night.bkg");
  equal(result.value.canRun, false);
  deepEqual(result.value.parties, [
    [{ party: 0, actorId: enemy.id, charge: 0 }],
    [
      { party: 1, actorId: hero.id, charge: 0 },
      { party: 1, actorId: fallen.id, charge: 0 },
    ],
  ]);
  const empty = owner.start({
    boardKey: "boards/field.brd",
    background: "night.bkg",
    canRun: true,
    enemies: [enemy.id],
    players: [],
  });
  equal(empty.ok, false);
  if (!empty.ok) equal(empty.error.code, "battle.empty-party");
  equal(state.battle?.id, 2, "a rejected empty party leaves the current section intact");
});

function runScript(state: GameState, text: string, poll?: WaitPoll) {
  const services = createScriptServices(state, plugins);
  const thread = startProgram(state.vm, { kind: "inline", text, compiler: "2" });
  thread.source = "Hero";
  thread.target = "Slime";
  let finished = false;
  for (let tick = 0; tick < 64; tick += 1) {
    if (advanceScriptTick(state, services, undefined, poll) === "finished") {
      finished = true;
      break;
    }
  }
  return { services, finished, diagnostics: [...services.diagnostics] };
}

function handleOf(value: unknown): number {
  if (value === null || typeof value !== "object" || !("kind" in value) || value.kind !== "object" ||
      !("handle" in value) || typeof value.handle !== "number") {
    throw new Error("expected an actor object value");
  }
  return value.handle;
}

function statusEffectBytes(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(STATUS_EFFECT_MAGIC);
  writer.i16(2);
  writer.i16(2);
  writer.str("Poison");
  writer.i16(4);
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i16(1);
  writer.i16(-5);
  writer.i16(1);
  writer.i16(-3);
  writer.i16(1);
  writer.str("not-run.prg");
  return writer.toBytes();
}

function hex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
}

test("battle object and legacy stat aliases resolve live actor objects from authored RPGCode", () => {
  const { state, enemy, hero } = makeState();
  const result = runScript(state, facingFixture);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), []);

  equal(state.vm.globals.party0size, 1);
  equal(state.vm.globals.party1size, 1);
  equal(state.vm.globals.sourcehp, 10);
  equal(state.vm.globals.targethp, 8);
  equal(state.vm.globals.partynamehp, 10);
  equal(state.vm.globals.enemyreferencehp, 8);
  equal(state.vm.globals.initialplayercharge, 74);
  equal(state.vm.globals.storedplayercharge, 274);
  equal(state.vm.globals.playerpercenthigh, 100);
  equal(state.vm.globals.enemypercent, 50);
  equal(state.vm.globals.playerpercentlow, 0);
  equal(state.vm.globals.releasedcharge, 0);
  equal(state.vm.globals.runallowed, 1);
  equal(state.vm.globals.outcomebefore, 0);
  equal(state.vm.globals.fighterhp, 7);
  equal(state.vm.globals.aliashp, 7);
  equal(state.vm.globals.maxhpread, 22);
  equal(state.vm.globals.smpread, 5);
  equal(state.vm.globals.maxsmpread, 9);
  equal(state.vm.globals.fpread, 6);
  equal(state.vm.globals.dpread, 7);
  equal(state.vm.globals.experienceread, 1);
  equal(state.vm.globals.secondaliashp, 6);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.hp, 6);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.experience, 1);
  equal(state.battle?.parties[0][0]?.charge, 61.5);
  equal(state.battle?.parties[1][0]?.charge, 0);
  equal(state.battle?.outcome, 1);

  const expectedHero = registerActorObject(state.vm, state.events, state.actors, hero.id);
  const expectedEnemy = registerActorObject(state.vm, state.events, state.actors, enemy.id);
  ok(expectedHero !== null && expectedEnemy !== null);
  equal(handleOf(state.vm.globals.fighter), expectedHero.handle);
  equal(handleOf(state.vm.globals.enemyfighter), expectedEnemy.handle);
});

test("hp writes update the actor store and are visible through a second alias and fighter object", () => {
  const { state, hero } = makeState();
  const result = runScript(state, `
fighter = battle.fighter(1, 0)
hp("Hero", 4)
aliasHp = gethp("Hero")
objectHp = fighter.hp
`);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), []);
  equal(state.vm.globals.aliashp, 4);
  equal(state.vm.globals.objecthp, 4);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.hp, 4);
});

test("givehp uses actor damage and heal transitions exactly once", () => {
  const { state, hero } = makeState();
  const result = runScript(state, `
fighter = battle.fighter(1, 0)
fallenCount = 0
revivedCount = 0
fighter.on("fallen", (event) => { fallenCount = fallenCount + 1 })
fighter.on("revived", (event) => { revivedCount = revivedCount + 1 })
givehp("Hero", -20)
givehp("Hero", -1)
givehp("Hero", 5)
`);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), []);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.hp, 5);
  equal(state.vm.globals.fallencount, 1);
  equal(state.vm.globals.revivedcount, 1);
});

test("status built-ins read rounds and use file identity without ticking effects", () => {
  const { state, hero } = makeState();
  const encoded = hex(statusEffectBytes());
  const poll: WaitPoll = (_view, wait) => wait.kind === "request" ? { ok: true, value: encoded } : null;
  const result = runScript(state, statusFixture, poll);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), []);
  equal(state.vm.globals.statuslog, "4:0:2;0:1:2;");
  deepEqual(state.actors.actors.find((actor) => actor.id === hero.id)?.statuses, {});
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.hp, 10);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.smp, 4);
});

test("equal display names in different status files stay distinct and reapplication restarts by file", () => {
  const { state, hero } = makeState();
  const encoded = hex(statusEffectBytes());
  const poll: WaitPoll = (_view, wait) => wait.kind === "request" ? { ok: true, value: encoded } : null;
  const first = runScript(state, `
applystatus("Hero", "StatusE/First")
applystatus("Hero", "second.ste")
`, poll);
  equal(first.finished, true);
  deepEqual(first.diagnostics, []);
  const statuses = () => state.actors.actors.find((actor) => actor.id === hero.id)!.statuses;
  deepEqual(statuses(), { "First.ste": 4, "second.ste": 4 });
  statuses()["First.ste"] = 1;
  const reapplied = runScript(state, `applystatus("Hero", "fIRST.STE")`, poll);
  equal(reapplied.finished, true);
  deepEqual(reapplied.diagnostics, []);
  deepEqual(statuses(), { "First.ste": 4, "second.ste": 4 });
  const removed = runScript(state, `removestatus("Hero", "FIRST")`, poll);
  equal(removed.finished, true);
  deepEqual(removed.diagnostics, []);
  deepEqual(statuses(), { "second.ste": 4 });
});

test("fighter, party-name and enemy handles report stable errors without changing either section", () => {
  const { state } = makeState();
  const beforeBattle = JSON.stringify(state.battle);
  const beforeActors = JSON.stringify(state.actors);
  const result = runScript(state, `
badParty = battle.partySize(2)
badIndex = battle.fighter(1, 9)
unknownName = gethp("Missing")
badEnemy = gethp({ party: 1, index: 0 })
`);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), [
    "battle.bad-fighter", "battle.bad-fighter", "battle.bad-fighter", "battle.bad-fighter",
  ]);
  ok(result.diagnostics[0]?.message.includes("party=2") && result.diagnostics[0]?.message.includes("index=n/a"));
  ok(result.diagnostics[1]?.message.includes("party=1") && result.diagnostics[1]?.message.includes("index=9"));
  ok(result.diagnostics[2]?.message.includes("party=unknown") && result.diagnostics[2]?.message.includes("index=unknown"));
  ok(result.diagnostics[3]?.message.includes("party=1") && result.diagnostics[3]?.message.includes("index=0"));
  equal(JSON.stringify(state.battle), beforeBattle);
  equal(JSON.stringify(state.actors), beforeActors);
});

test("finish validates outcomes, records once, and refuses a disallowed run atomically", () => {
  const invalid = makeState();
  const beforeInvalid = JSON.stringify(invalid.state.battle);
  const invalidResult = runScript(invalid.state, "battle.finish(5)\n");
  deepEqual(invalidResult.diagnostics.map(({ code }) => code), ["battle.bad-outcome"]);
  equal(JSON.stringify(invalid.state.battle), beforeInvalid);

  const cannotRun = makeState(false);
  const beforeRun = JSON.stringify(cannotRun.state.battle);
  const runResult = runScript(cannotRun.state, "battle.finish(0)\n");
  deepEqual(runResult.diagnostics.map(({ code }) => code), ["battle.cannot-run"]);
  equal(JSON.stringify(cannotRun.state.battle), beforeRun);

  const alreadyFinished = makeState();
  const finishResult = runScript(alreadyFinished.state, "battle.finish(3)\nbattle.finish(5)\n");
  deepEqual(finishResult.diagnostics.map(({ code }) => code), ["battle.already-finished"]);
  equal(alreadyFinished.state.battle?.outcome, 3);
});

test("battle.finish emits one battleEnded event with its outcome after outcome handling", () => {
  const { state } = makeState();
  const result = runScript(state, `
battleEndedCount = 0
game.on("battleEnded", (event) => {
  battleEndedCount = battleEndedCount + 1
  battleEndedOutcome = event.detail.outcome
})
battle.finish(3)
`);
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), []);
  equal(state.battle?.outcome, 3);
  equal(state.vm.globals.battleendedcount, 1);
  equal(state.vm.globals.battleendedoutcome, 3);
});


test("battle-only reads report not-active while legacy stat aliases still work outside battle", () => {
  const { state, hero } = makeState();
  state.battle = null;
  const result = runScript(state, "outsideHp = gethp(\"Hero\")\npartySize = battle.partySize(1)\nbattle.finish(2)\n");
  equal(result.finished, true);
  deepEqual(result.diagnostics.map(({ code }) => code), ["battle.not-active", "battle.not-active"]);
  equal(state.vm.globals.outsidehp, 10);
  equal(state.battle, null);
  equal(state.actors.actors.find((actor) => actor.id === hero.id)?.stats.hp, 10);
});

test("mid-battle charge and actor stats restore and remain readable through the API", () => {
  const first = makeState();
  const written = runScript(first.state, "battle.setCharge(1, 0, 250)\nhp(\"Hero\", 6)\n");
  equal(written.finished, true);
  deepEqual(written.diagnostics.map(({ code }) => code), []);

  const restored = restoreGameState(snapshot(first.state));
  const readback = runScript(restored, `
restoredCharge = battle.charge(1, 0)
restoredHp = gethp("Hero")
restoredFighter = battle.fighter(1, 0)
restoredOutcome = battle.outcome
`);
  equal(readback.finished, true);
  deepEqual(readback.diagnostics.map(({ code }) => code), []);
  equal(restored.vm.globals.restoredcharge, 250);
  equal(restored.vm.globals.restoredhp, 6);
  equal(restored.vm.globals.restoredoutcome, 0);
  equal(restored.battle?.parties[1][0]?.charge, 250);
  const expected = registerActorObject(restored.vm, restored.events, restored.actors, first.hero.id);
  ok(expected !== null);
  equal(handleOf(restored.vm.globals.restoredfighter), expected.handle);
});
