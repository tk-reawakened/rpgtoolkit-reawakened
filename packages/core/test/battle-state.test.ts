import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  addActor,
  createGameState,
  hashGameState,
  isBattleFighterUsable,
  restoreGameState,
  SCHEMA_VERSIONS,
  snapshot,
  type BattleState,
  type Diagnostic,
  validateBattleSection,
} from "../src/index.ts";
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save", "battle-v1.json");
function makeBattle(state: ReturnType<typeof createGameState>): BattleState {
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy" });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player", stats: { hp: 10, maxHp: 10, smp: 3, maxSmp: 3 } });
  return {
    id: 9, boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, outcome: 2,
    parties: [[{ party: 0, actorId: enemy.id, charge: 123.5 }], [{ party: 1, actorId: player.id, charge: 74 }]],
  };
}
test("battle state snapshots preserve fighters, charge and outcome in the canonical hash", () => {
  const state = createGameState({ seed: 27 });
  state.battle = makeBattle(state);
  const restored = restoreGameState(snapshot(state));
  deepEqual(restored.battle, state.battle);
  equal(hashGameState(restored), hashGameState(state));
  ok(!JSON.stringify(restored.battle).match(/\"(hp|smp|status|stats)\"/));
});

test("restored mid-fight battle continues to the uninterrupted canonical hash", () => {
  const uninterrupted = createGameState({ seed: 27 });
  uninterrupted.battle = makeBattle(uninterrupted);
  const resumed = restoreGameState(snapshot(uninterrupted));
  for (const current of [uninterrupted, resumed]) {
    current.time.tick += 1;
    current.battle!.parties[0][0]!.charge += 1;
  }
  equal(hashGameState(resumed), hashGameState(uninterrupted));
});

test("battle section schema v1 empty placeholder restores to null", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { battle: unknown; schema: { battle: number } };
  equal(raw.schema.battle, 1);
  deepEqual(raw.battle, {});
  const restored = restoreGameState(JSON.stringify(raw));
  equal(restored.battle, null);
  equal(restored.schema.battle, SCHEMA_VERSIONS.battle);
});

test("dangling and duplicate fighter ids are retained with one located diagnostic each", () => {
  const state = createGameState({ seed: 1 });
  const battle = makeBattle(state);
  battle.parties[0].push({ party: 0, actorId: 900 as never, charge: 2 });
  battle.parties[1].push({ ...battle.parties[1][0]!, charge: 3 });
  state.battle = battle;
  const diagnostics: Diagnostic[] = [];
  const restored = restoreGameState(snapshot(state), diagnostics);
  equal(diagnostics.length, 2);
  ok(diagnostics.every((item) => item.code === "restore.battle-fighter"));
  ok(diagnostics.some((item) => item.message.includes("battle.parties[0][1].actorId")));
  ok(diagnostics.some((item) => item.message.includes("battle.parties[1][1].actorId")));
  equal(restored.battle?.parties[0].length, 2);
  equal(restored.battle?.parties[1].length, 2);
  ok(restored.battle !== null);
  ok(isBattleFighterUsable(restored.battle, 0, 0, restored.actors));
  equal(isBattleFighterUsable(restored.battle, 0, 1, restored.actors), false);
  equal(isBattleFighterUsable(restored.battle, 1, 1, restored.actors), false);
});

test("battle validation locates malformed outcomes and non-finite charge", () => {
  const state = createGameState({ seed: 1 });
  const battle = makeBattle(state);
  const malformed = { ...battle, outcome: 5, parties: [battle.parties[0], [{ ...battle.parties[1][0]!, charge: Number.NaN }]] };
  const issues = validateBattleSection(malformed, state.actors);
  ok(issues.some((issue) => issue.path === "battle.outcome"));
  ok(issues.some((issue) => issue.path === "battle.parties[1][0].charge"));
});

test("malformed battle shapes reject restore with the standard shape error", () => {
  const state = createGameState({ seed: 1 });
  state.battle = makeBattle(state);
  for (const battle of [
    { ...state.battle, outcome: 5 },
    { ...state.battle, parties: [state.battle.parties[0], [{ ...state.battle.parties[1][0]!, charge: Number.NaN }]] },
    { ...state.battle, parties: [state.battle.parties[0]] },
  ]) {
    const malformed = { ...JSON.parse(snapshot(state)), battle };
    throws(() => restoreGameState(JSON.stringify(malformed)), (error: unknown) => (error as { code?: string }).code === "restore.shape");
  }
});

test("a fresh game state has no active battle", () => {
  equal(createGameState({ seed: 1 }).battle, null);
});
