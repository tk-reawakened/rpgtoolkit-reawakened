import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ASSIGN_READ_ONLY,
  actorFromSource,
  type WorldBoard,
  actorEmitterKey,
  addActor,
  createActorHostType,
  createActorService,
  createActorsSection,
  createDefaultVirtuals,
  createGameState,
  createStatsPort,
  advanceScriptTick,
  startProgram,
  KILL_SYSTEM_OWNED,
  hashGameState,
  hydrateCharacterResult,
  actorInputFromCharacter,
  hydrateEnemyResult,
  readCharacter,
  readEnemy,
  readItem,
  patchActor,
  BinaryReader,
  readEvent,
  type EventView,
  type PluginDefinition,
  resetActorsSection,
  restoreGameState,
  registerActorObject,
  snapshot,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const examplesDirectory = join(testDirectory, "..", "..", "..", "docs", "spec", "examples", "game");

function example(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(examplesDirectory, path)));
}

test("actor hydration maps character and enemy reader fields deterministically", () => {
  const characterPath = join(examplesDirectory, "Game", "Example", "Chrs", "ada.tem");
  const enemyPath = join(examplesDirectory, "Game", "Example", "Enemy", "slime.ene");
  const character = readCharacter(new BinaryReader(example("Game/Example/Chrs/ada.tem"), characterPath));
  const enemy = readEnemy(new BinaryReader(example("Game/Example/Enemy/slime.ene"), enemyPath));
  equal(character.ok, true);
  equal(enemy.ok, true);
  if (!character.ok || !enemy.ok) return;

  const first = createActorsSection();
  const firstCharacter = hydrateCharacterResult(first, "ada.tem", "party", character);
  const firstEnemy = hydrateEnemyResult(first, "slime.ene", enemy);
  equal(firstCharacter.ok, true);
  equal(firstEnemy.ok, true);
  if (!firstCharacter.ok || !firstEnemy.ok) return;
  equal(firstCharacter.value.name, character.value.name);
  deepEqual(firstCharacter.value.stats, {
    experience: character.value.stats.experience,
    hp: character.value.stats.hp,
    maxHp: character.value.stats.maxHp,
    dp: character.value.stats.dp,
    fp: character.value.stats.fp,
    smp: character.value.stats.smp,
    maxSmp: character.value.stats.maxSmp,
    level: character.value.stats.level,
    criticalOn: -1,
    criticalBy: -1,
  });
  deepEqual(firstCharacter.value.progression, {
    levelType: character.value.firstLevelExp,
    experienceIncrease: character.value.experienceIncrease,
    maxLevel: character.value.maxLevel,
    levelHp: character.value.levelIncreases[0],
    levelDp: character.value.levelIncreases[1],
    levelFp: character.value.levelIncreases[2],
    levelSm: character.value.levelIncreases[3],
    levelUpType: character.value.levelUpType,
    remainingExperience: Math.max(0, character.value.firstLevelExp - character.value.stats.experience),
    nextRequirement: character.value.firstLevelExp,
    legacyLevelUp: character.value.levelUpProgram.length > 0,
  });
  deepEqual(firstCharacter.value.statuses, {});
  deepEqual(firstEnemy.value.stats, {
    experience: 0,
    hp: enemy.value.hp,
    maxHp: enemy.value.hp,
    dp: enemy.value.dp,
    fp: enemy.value.fp,
    smp: enemy.value.smp,
    maxSmp: enemy.value.smp,
    level: 0,
    criticalOn: enemy.value.criticalOn,
    criticalBy: enemy.value.criticalBy,
  });

  const second = createActorsSection();
  const secondCharacter = hydrateCharacterResult(second, "ada.tem", "party", character);
  const secondEnemy = hydrateEnemyResult(second, "slime.ene", enemy);
  equal(secondCharacter.ok, true);
  equal(secondEnemy.ok, true);
  deepEqual(second, first);
});

test("actor hydration derives the current threshold for stored levels above one", () => {
  const source = readCharacter(new BinaryReader(new Uint8Array(example("Game/Example/Chrs/ada.tem")), "threshold.tem"));
  equal(source.ok, true);
  if (!source.ok) return;
  const base = source.value;
  const character = {
    ...base,
    firstLevelExp: 10,
    experienceIncrease: 5,
    levelUpType: 1,
    stats: { ...base.stats, level: 2, experience: 24 },
  };
  const near = actorInputFromCharacter("threshold.tem", "party", character);
  ok(near.progression);
  equal(near.progression.nextRequirement, 15);
  equal(near.progression.remainingExperience, 1);
  const crossing = actorInputFromCharacter("threshold.tem", "party", {
    ...character,
    stats: { ...character.stats, experience: 25 },
  });
  ok(crossing.progression);
  equal(crossing.progression.nextRequirement, 15);
  equal(crossing.progression.remainingExperience, 0);
});

test("actor hydration preserves reader warnings from character residue", () => {
  const source = new Uint8Array([...example("Game/Example/Chrs/ada.tem"), 0]);
  const read = readCharacter(new BinaryReader(source, "ada-residue.tem"));
  equal(read.ok, true);
  if (!read.ok) return;
  equal(read.value.residue.length, 1);
  equal(read.warnings.length, 1);

  const hydrated = hydrateCharacterResult(createActorsSection(), "ada-residue.tem", "party", read);
  equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  deepEqual(hydrated.warnings, read.warnings);
  equal(hydrated.value.name, read.value.name);
});

test("actor hydration carries defaults from an authored minor-zero character", () => {
  const path = join(examplesDirectory, "..", "versions", "character", "character_text_minor0.tem");
  const read = readCharacter(new BinaryReader(new Uint8Array(readFileSync(path)), path));
  equal(read.ok, true);
  if (!read.ok) return;
  equal(read.value.minor, 0);
  equal(read.value.movementAnimations, undefined);
  equal(read.value.idleAnimations, undefined);
  equal(read.value.vectorBases, undefined);

  const hydrated = hydrateCharacterResult(createActorsSection(), "character_text_minor0.tem", "party", read);
  equal(hydrated.ok, true);
  if (!hydrated.ok) return;
  deepEqual(hydrated.value.stats, {
    experience: read.value.stats.experience,
    hp: read.value.stats.hp,
    maxHp: read.value.stats.maxHp,
    dp: read.value.stats.dp,
    fp: read.value.stats.fp,
    smp: read.value.stats.smp,
    maxSmp: read.value.stats.maxSmp,
    level: read.value.stats.level,
    criticalOn: -1,
    criticalBy: -1,
  });
  deepEqual(hydrated.value.progression, {
    levelType: read.value.firstLevelExp,
    experienceIncrease: read.value.experienceIncrease,
    maxLevel: read.value.maxLevel,
    levelHp: read.value.levelIncreases[0],
    levelDp: read.value.levelIncreases[1],
    levelFp: read.value.levelIncreases[2],
    levelSm: read.value.levelIncreases[3],
    levelUpType: read.value.levelUpType,
    remainingExperience: Math.max(0, read.value.firstLevelExp - read.value.stats.experience),
    nextRequirement: read.value.firstLevelExp,
    legacyLevelUp: read.value.levelUpProgram.length > 0,
  });
  deepEqual(hydrated.value.statuses, {});
  equal(hydrated.value.behaviour, null);
  deepEqual(hydrated.value.customEvents, []);
});

test("actor hydration keeps reader errors and routes item data outside actor records", () => {
  const section = createActorsSection();
  const failed = hydrateCharacterResult(section, "broken.tem", "party", readCharacter(new BinaryReader(new Uint8Array(), "broken.tem")));
  equal(failed.ok, false);
  if (!failed.ok) {
    deepEqual({ path: failed.error.path, offset: failed.error.offset, section: failed.error.section }, {
      path: "broken.tem",
      offset: 0,
      section: "docs/spec/formats/character.md#layout",
    });
    equal(typeof failed.error.message, "string");
  }

  const failedEnemy = hydrateEnemyResult(section, "broken.ene", readEnemy(new BinaryReader(new Uint8Array(), "broken.ene")));
  equal(failedEnemy.ok, false);
  if (!failedEnemy.ok) {
    deepEqual({ path: failedEnemy.error.path, offset: failedEnemy.error.offset, section: failedEnemy.error.section }, {
      path: "broken.ene",
      offset: 0,
      section: "docs/spec/formats/README.md#primitive-encoding",
    });
    equal(typeof failedEnemy.error.message, "string");
  }

  const item = readItem(new BinaryReader(example("Game/Example/Item/chest.itm"), join(examplesDirectory, "Game", "Example", "Item", "chest.itm")));
  equal(item.ok, true);
  equal(section.actors.length, 0);
  if (item.ok) equal(item.value.name.length > 0, true);
  if (item.ok) {
    const sprite = actorFromSource({
      id: "chest",
      kind: "item",
      source: "chest.itm",
      x: 0,
      y: 0,
      layer: 0,
      item: item.value,
    }, { coordType: 0 } as WorldBoard, 0, 0);
    equal(sprite.source, "chest.itm");
    deepEqual(sprite.visual.movement, item.value.movementAnimations);
    equal(sprite.multitaskProgram, item.value.multitaskProgram === "" ? null : item.value.multitaskProgram);
    deepEqual(sprite.visual.idle, item.value.idleAnimations ?? []);
    deepEqual(sprite.visual.custom, (item.value.customStances ?? []).map((stance) => ({ animation: stance.animation, handle: stance.handle })));
    if (item.value.vectorBases?.[0] !== undefined) deepEqual(sprite.collisionBase.points, item.value.vectorBases[0].points);
    if (item.value.vectorBases?.[1] !== undefined) deepEqual(sprite.activationBase.points, item.value.vectorBases[1].points);
  }
});

const partyFixture = {
  kind: "party" as const,
  source: "hero.tem",
  name: "Hero",
  stats: { hp: 12, maxHp: 12, smp: 4, maxSmp: 4, dp: 2, fp: 3, level: 1 },
  behaviour: "stock-rpg.hero",
};

function hasCallable(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) return value.some(hasCallable);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(hasCallable);
}

test("party, enemy and NPC actors use one plain-data record shape and stable scalar ids", () => {
  const actors = createActorsSection();
  const party = addActor(actors, partyFixture);
  const enemy = addActor(actors, { kind: "enemy", source: "slime.ene", stats: { hp: 9, maxHp: 9 } });
  const npc = addActor(actors, { kind: "npc", source: "merchant.tem", customEvents: ["talkedTo"] });

  deepEqual(actors.actors.map((actor) => actor.id), [1, 2, 3]);
  deepEqual(actors.actors.map((actor) => actor.kind), ["party", "enemy", "npc"]);
  equal(actorEmitterKey(party.id), "actor:1");
  equal(actorEmitterKey(enemy.id), "actor:2");
  equal(actorEmitterKey(npc.id), "actor:3");
  ok(!("handle" in party), "actor data does not persist a VM object handle");
  ok(!hasCallable(actors), "actor section contains no callable");
});

test("actor records round-trip through the owned state section with equal hash", () => {
  const state = createGameState({ seed: 27 });
  addActor(state.actors, partyFixture);
  addActor(state.actors, {
    kind: "enemy",
    source: "slime.ene",
    stats: { hp: 9, maxHp: 9, fp: 2 },
    statuses: { poison: 3 },
    equipment: { equipped: ["ring.itm"], bonuses: { hp: 2 } },
  });
  addActor(state.actors, { kind: "npc", source: "merchant.tem", behaviour: null });

  const saved = snapshot(state);
  const restored = restoreGameState(saved);
  deepEqual(restored.actors, state.actors);
  equal(hashGameState(restored), hashGameState(state));
  equal(snapshot(restored), saved);
});

test("StatsPort reads and writes the actor-owned stats without a vm.globals copy", () => {
  const state = createGameState({ seed: 5 });
  const actor = addActor(state.actors, partyFixture);
  const port = createStatsPort(state.actors, () => ({}));
  const before = port.read(actor.id);
  ok(before === actor.stats);
  ok(!Object.hasOwn(state.vm.globals, "HP!"));
  equal(port.write(actor.id, { hp: 7 }), true);
  equal(port.read(actor.id)?.hp, 7);
  equal(state.actors.actors[0]?.stats.hp, 7);
  ok(!Object.hasOwn(state.vm.globals, "HP!"));
});

test("actor reset clears records and restarts deterministic allocation", () => {
  const section = createActorsSection();
  addActor(section, partyFixture);
  section.actors[0]!.statuses.poison = 2;
  resetActorsSection(section);
  deepEqual(section, createActorsSection());
  equal(addActor(section, { kind: "npc", source: "merchant.tem" }).id, 1);
});

test("actor patches retain identity and reject accidental executable state", () => {
  const section = createActorsSection();
  const actor = addActor(section, { ...partyFixture, id: 7 });
  const patched = patchActor(section, actor.id, { stats: { hp: 10 }, behaviour: "stock-rpg.hero" });
  equal(patched?.id, actor.id);
  equal(patched?.stats.hp, 10);
  ok(!hasCallable(section));
});

test("actor script object is the owner-backed emitter registration", () => {
  const state = createGameState({ seed: 8 });
  const actor = addActor(state.actors, partyFixture);
  const object = registerActorObject(state.vm, state.events, state.actors, actor.id);
  ok(object !== null);
  equal(object?.hostType, "actor");
  equal(state.events.emitters?.[actorEmitterKey(actor.id)], object?.handle);
  const duplicate = registerActorObject(state.vm, state.events, state.actors, actor.id);
  equal(duplicate?.handle, object?.handle);
  equal(state.vm.objects.length, 1);

  const host = createActorHostType(createActorService(state.actors));
  const context = { state, events: state.events, vm: state.vm, record: object! };
  equal(host.read?.(context, "hp"), 12);
  equal(host.write?.(context, "hp", 5), "written");
  equal(state.actors.actors[0]?.stats.hp, 5);
  patchActor(state.actors, actor.id, { stats: { hp: 9 } });
  equal(host.read?.(context, "hp"), 9);
});

test("actor owner transitions are queued on the actor emitter and reach script listeners", () => {
  const state = createGameState({ seed: 41 });
  const actor = addActor(state.actors, { ...partyFixture, stats: { ...partyFixture.stats, hp: 4 }, statuses: { poison: 2 } });
  const object = registerActorObject(state.vm, state.events, state.actors, actor.id);
  ok(object !== null);
  state.vm.globals.actor = { kind: "object", handle: object!.handle, className: object!.className };
  const nativeEvents: EventView[] = [];
  const nativePlugin: PluginDefinition = {
    id: "actor-native-test",
    version: "1.0.0",
    commands: [{
      name: "observeactorevent",
      aliases: [],
      params: [{ name: "event", optional: false, byRef: false, variadic: false }],
      call: (view, args) => {
        const event = readEvent(view.state!, args[0]!.value);
        if (event !== undefined) nativeEvents.push(event);
        return { value: 0 };
      },
    }],
    listeners: [{ emitter: actorEmitterKey(actor.id), type: "statusChanged", command: "observeactorevent" }],
  };
  const services = createScriptServices(state, [nativePlugin]);
  startProgram(state.vm, {
    kind: "inline",
    compiler: "2",
    text: `
fallenCause = ""
fallenSource = 99
fallenCount = 0
revivedCause = ""
revivedSource = 99
revivedCount = 0
statusName = ""
statusSource = 99
statusExpired = -1
actor.on("fallen", (event) => { fallenCause = event.detail.cause; fallenSource = event.detail.source; fallenCount = fallenCount + 1 })
actor.on("revived", (event) => { revivedCause = event.detail.cause; revivedSource = event.detail.source; revivedCount = revivedCount + 1 })
actor.on("statusChanged", (event) => { statusName = event.detail.status + ":" + event.detail.previousRounds + ":" + event.detail.rounds; statusSource = event.detail.source; statusExpired = event.detail.expired })
actor.hp = 0
actor.hp = 0
`,
  });
  for (let tick = 0; tick < 5; tick += 1) advanceScriptTick(state, services);
  equal(state.vm.globals.fallencause, "script");
  equal(state.vm.globals.fallensource, 0);
  equal(state.vm.globals.fallencount, 1);
  equal(state.actors.actors[0]?.statuses.poison, 2);
  const statusResult = services.actors.advanceStatus(actor.id, 1, { source: 7 });
  equal(statusResult?.transitions[0]?.type, "statusChanged");
  for (let tick = 0; tick < 10; tick += 1) advanceScriptTick(state, services);
  equal(state.vm.globals.statusname, "poison:2:1");
  equal(state.vm.globals.statussource, 7);
  equal(state.vm.globals.statusexpired, 0);
  const expiredResult = services.actors.advanceStatus(actor.id, 1);
  equal(expiredResult?.transitions[0]?.type, "statusChanged");
  for (let tick = 0; tick < 10; tick += 1) advanceScriptTick(state, services);
  equal(state.vm.globals.statusname, "poison:1:0");
  equal(state.vm.globals.statussource, 0);
  equal(state.vm.globals.statusexpired, 1);
  equal(nativeEvents.length, 2);
  deepEqual(nativeEvents.map((event) => event.detail), [
    { status: "poison", previousRounds: 2, rounds: 1, expired: false, source: 7 },
    { status: "poison", previousRounds: 1, rounds: 0, expired: true, source: null },
  ]);
  const reviveResult = services.actors.updateStats(actor.id, { hp: 4 }, { cause: "damage", source: 7 });
  deepEqual(reviveResult?.transitions.map((transition) => transition.type), ["revived"]);
  for (let tick = 0; tick < 10; tick += 1) advanceScriptTick(state, services);
  equal(state.vm.globals.revivedcause, "damage");
  equal(state.vm.globals.revivedsource, 7);
  equal(state.vm.globals.revivedcount, 1);
});

test("actor transition events deliver revive and level details only to the changed actor", () => {
  const state = createGameState({ seed: 42 });
  const progression = { levelType: 0, experienceIncrease: 1, maxLevel: 3, levelHp: 1, levelDp: 1, levelFp: 1, levelSm: 1, levelUpType: 1, remainingExperience: 1, nextRequirement: 1, legacyLevelUp: false };
  const first = addActor(state.actors, { ...partyFixture, id: 1, stats: { ...partyFixture.stats, hp: 0, level: 1, experience: 0 }, progression });
  const second = addActor(state.actors, { ...partyFixture, id: 2, stats: { ...partyFixture.stats, hp: 0 }, progression });
  const firstObject = registerActorObject(state.vm, state.events, state.actors, first.id);
  const secondObject = registerActorObject(state.vm, state.events, state.actors, second.id);
  ok(firstObject !== null && secondObject !== null);
  state.vm.globals.first = { kind: "object", handle: firstObject!.handle, className: firstObject!.className };
  state.vm.globals.second = { kind: "object", handle: secondObject!.handle, className: secondObject!.className };
  const services = createScriptServices(state);
  startProgram(state.vm, {
    kind: "inline",
    compiler: "2",
    text: `
firstRevived = 0
secondRevived = 0
leveled = 0
leveledExperience = 0
leveledApplied = 0
first.on("revived", (event) => { firstRevived = event.detail.cause })
second.on("revived", (event) => { secondRevived = event.detail.cause })
first.on("leveledUp", (event) => { leveled = event.detail.level; leveledExperience = event.detail.experience; leveledApplied = event.detail.applied["maxHp"] + event.detail.applied["dp"] + event.detail.applied["fp"] + event.detail.applied["maxSmp"] })
`,
  });
  advanceScriptTick(state, services);
  services.actors.updateStats(first.id, { hp: 4 }, { cause: "script" });
  const levelResult = services.actors.awardExperience(first.id, 1);
  deepEqual(levelResult?.transitions.map((transition) => transition.type), ["leveledUp"]);
  advanceScriptTick(state, services);
  equal(state.vm.globals.firstrevived, "script");
  equal(state.vm.globals.secondrevived, 0);
  equal(state.vm.globals.leveled, 2);
  equal(state.vm.globals.leveledexperience, 1);
  equal(state.vm.globals.leveledapplied, 4);
});

test("actor host fields hydrate through dot and indexed VM access", () => {
  const state = createGameState({ seed: 10 });
  const actor = addActor(state.actors, partyFixture);
  const object = registerActorObject(state.vm, state.events, state.actors, actor.id);
  ok(object !== null);
  state.vm.globals.actor = { kind: "object", handle: object!.handle, className: object!.className };
  startProgram(state.vm, { kind: "inline", text: "dot = actor.hp\nactor.hp = 7\nindexed = actor[\"hp\"]\n", compiler: "2" });
  advanceScriptTick(state, createScriptServices(state));
  equal(state.vm.globals.dot, 12);
  equal(state.actors.actors[0]?.stats.hp, 7);
  equal(state.vm.globals.indexed, 7);
});

test("actor aliases write through and protected virtuals keep their links", () => {
  const state = createGameState({ seed: 9 });
  const actor = addActor(state.actors, partyFixture);
  state.party.members = [actor.id];
  state.party.selected = actor.id;
  const virtuals = createDefaultVirtuals(state, createActorService(state.actors));
  equal(virtuals.read("HP!"), 12);
  equal(virtuals.write?.("HP!", 4), "written");
  equal(state.actors.actors[0]?.stats.hp, 4);
  equal(virtuals.read("HP!"), 4);
  equal(virtuals.write?.("gametime", 99), "read-only");
  equal(virtuals.read("gametime"), 0);
  try {
    virtuals.kill?.("HP!");
    ok(false, "kill should reject an actor alias");
  } catch (error) {
    equal((error as { code?: string }).code, KILL_SYSTEM_OWNED);
  }
  equal(virtuals.write?.("threads[1]", 2), "read-only");
  ok(!Object.hasOwn(state.vm.globals, "HP!"));
  equal(virtuals.write?.("tkDIR_N", 99), "read-only");
  try {
    virtuals.kill?.("tkDIR_N");
    ok(false, "kill should reject compile-time constants");
  } catch (error) {
    equal((error as { code?: string }).code, KILL_SYSTEM_OWNED);
  }
  equal(ASSIGN_READ_ONLY, "assign.read-only");
});

test("snapshot rejects a non-string host type name", () => {
  const state = createGameState({ seed: 11 });
  const actor = addActor(state.actors, partyFixture);
  ok(registerActorObject(state.vm, state.events, state.actors, actor.id) !== null);
  const saved = JSON.parse(snapshot(state)) as { vm: { objects: Array<{ hostType?: unknown }> } };
  saved.vm.objects[0]!.hostType = 7;
  try {
    restoreGameState(saved as never);
    ok(false, "restore should reject non-string hostType");
  } catch (error) {
    equal((error as { code?: string }).code, "restore.shape");
  }
});
