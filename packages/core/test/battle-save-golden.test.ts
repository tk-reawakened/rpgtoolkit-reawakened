// Epic 7.2 save golden (#692, BAT-2/BAT-13): the same deterministic game saved
// out of battle and mid-battle differs only under the root `battle` section.
// Fixtures: fixtures/save/battle-v2-{out,mid}.json. Regenerate deliberately with
// `UPDATE_GOLDEN=1`; the schema-v1 migration fixture `battle-v1.json` is untouched.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { addActor, createGameState, restoreGameState, SCHEMA_VERSIONS, snapshot, type BattleState } from "../src/index.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "save");

function build(inBattle: boolean): string {
  const state = createGameState({ seed: 27 });
  const enemy = addActor(state.actors, { kind: "enemy", source: "enemy", name: "enemy", stats: { hp: 7, maxHp: 9 } });
  const player = addActor(state.actors, { kind: "party", source: "player", name: "player", statuses: { "poison.ste": 2 }, stats: { hp: 10, maxHp: 10, smp: 3, maxSmp: 3 } });
  if (inBattle) {
    state.battle = {
      id: 9, boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, outcome: null,
      parties: [[{ party: 0, actorId: enemy.id, charge: 123.5 }], [{ party: 1, actorId: player.id, charge: 74 }]],
    };
  }
  return snapshot(state);
}

function golden(name: string, actual: string): string {
  const path = join(dir, name);
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(path, actual);
  return readFileSync(path, "utf8");
}

test("save golden: out-of-battle and mid-battle saves differ only under `battle`", () => {
  const out = golden("battle-v2-out.json", build(false));
  const mid = golden("battle-v2-mid.json", build(true));
  equal(build(false), out);
  equal(build(true), mid);

  const outRoot = JSON.parse(out) as Record<string, unknown>;
  const midRoot = JSON.parse(mid) as Record<string, unknown>;
  deepEqual(Object.keys(midRoot), Object.keys(outRoot));
  const changed = Object.keys(midRoot).filter((key) => JSON.stringify(midRoot[key]) !== JSON.stringify(outRoot[key]));
  deepEqual(changed, ["battle"]);
  equal(outRoot.battle, null);
  equal((midRoot.schema as { battle: number }).battle, SCHEMA_VERSIONS.battle);

  const battle = midRoot.battle as BattleState;
  deepEqual(battle, {
    id: 9, boardKey: "boards/castle.brd", background: "night.bkg", canRun: false, outcome: null,
    parties: [[{ party: 0, actorId: 1, charge: 123.5 }], [{ party: 1, actorId: 2, charge: 74 }]],
  });
  const text = JSON.stringify(battle);
  ok(!/"(hp|smp|maxHp|maxSmp|stats|statuses|status|audio)"/.test(text));
  // Actor state lives only in the `actors` section, identical in both saves.
  deepEqual(midRoot.actors, outRoot.actors);
  equal(restoreGameState(mid).battle?.parties[1][0]?.charge, 74);
});
