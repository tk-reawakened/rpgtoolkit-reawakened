// Story 13.10 (T-57, T-58): what the special move and status effect editors save is loaded by the real stock_battle
// package in a whole seeded fight (docs/spec/engine/battle.md#bat-5, #bat-6, #bat-11), with the authored slime as the
// fixture enemy and no enemy-editor UI. The bytes here are the editor's save output, field for field, built with the
// core writers this test alone can reach: the editor's own documents write exactly these bytes, proved independently in
// `packages/editor-model/test/battle-data-documents.test.ts`, and the editor never rewrites a flag the author did not
// touch (docs/spec/formats/battle-data.md#battle-data-editor-rules).
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { BinaryReader, assetKey, readEnemy, readSpecialMove, readStatusEffect, writeEnemy, writeSpecialMove, writeStatusEffect, type SpecialMove, type StatusEffect } from "@tk-reawakened/core";
import { actor, awaitMenu, bootUiRig, entries, gameFiles, ui, type UiRig } from "./battle-ui-rig.ts";

const authored = gameFiles().files;
/** The bytes the editor saved for the authored enemy's move and its linked status, reopened from its own fixture. */
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/editor/${name}`, import.meta.url)));
const readMove = (path: string): SpecialMove => {
  const read = readSpecialMove(new BinaryReader(authored.get(assetKey(path))!));
  ok(read.ok, path);
  return read.value;
};
const moveBytes = (model: SpecialMove): Uint8Array => {
  const written = writeSpecialMove(model);
  ok(written.ok, "the authored bytes write");
  return written.value;
};
/** A status effect as the editor writes one of its own: a new minor-2 file with the editor's fields set. */
const authoredStatus = (fields: Partial<StatusEffect>): StatusEffect => ({ magic: "RPGTLKIT STATUSE", major: 2, minor: 2, name: "Poison", rounds: 2, speedUp: 0, slowDown: 0, disable: 0, hpEnabled: 1, hpPerRound: 2, smpEnabled: 0, smpPerRound: 0, runProgram: 0, program: "", residue: new Uint8Array(), ...fields });
const statusBytes = (model: StatusEffect): Uint8Array => {
  const written = writeStatusEffect(model);
  ok(written.ok, "the authored bytes write");
  return written.value;
};
const savedMove = (bytes: Uint8Array): SpecialMove => {
  const read = readSpecialMove(new BinaryReader(bytes));
  ok(read.ok);
  return read.value;
};

/** Boot a fight whose game files are the editor's saved output, before the provider asks for any of them. */
function boot(replacements: Readonly<Record<string, Uint8Array>>, options: Parameters<typeof bootUiRig>[0] = {}): UiRig {
  const rig = bootUiRig(options);
  for (const [path, bytes] of Object.entries(replacements)) rig.files.set(assetKey(path), bytes);
  return rig;
}

test("the stock Special list shows a move exactly when the editor left its stored battle byte at 0", () => {
  // The editor's "not usable" writes 1, and an untouched authored -1 stays -1 (battle-data.md#battle-data-editor-rules).
  const hidden = moveBytes({ ...readMove("SpcMove/fire.spc"), usableInBattle: 1 });
  const untouched = moveBytes({ ...readMove("SpcMove/blaze.spc"), usableInBattle: -1, description: "Burns everything." });
  equal(savedMove(hidden).usableInBattle, 1);
  equal(savedMove(untouched).usableInBattle, -1);
  const none = boot({ "SpcMove/fire.spc": hidden, "SpcMove/blaze.spc": untouched });
  awaitMenu(none);
  equal(ui(none)["specialcount"], 0, "fire (1) and blaze (-1) are both not usable in battle");

  const usable = moveBytes({ ...readMove("SpcMove/blaze.spc"), usableInBattle: 0 });
  const both = boot({ "SpcMove/fire.spc": authored.get(assetKey("SpcMove/fire.spc"))!, "SpcMove/blaze.spc": usable });
  awaitMenu(both);
  equal(ui(both)["specialcount"], 2);
  deepEqual(entries(ui(both)["specials"], 2).map((entry) => entry["label"]), ["fire", "blaze"]);
  deepEqual([none, both].flatMap((rig) => rig.diagnostics), []);
});

test("a negative damage the editor stored heals a fallen ally through the stock battle, and the cost the editor stored is paid", () => {
  const healing = moveBytes({ ...readMove("SpcMove/fire.spc"), damage: -12, smpCost: 2 });
  deepEqual([savedMove(healing).damage, savedMove(healing).smpCost], [-12, 2]);
  const rig = boot({ "SpcMove/fire.spc": healing });
  awaitMenu(rig);
  const caster = ["hero.tem", "mage.tem", "rogue.tem"][Number(ui(rig)["menuindex"])]!;
  const smpBefore = actor(rig, caster).stats.smp;
  equal(actor(rig, "rogue.tem").stats.hp, 0, "the rogue starts fallen");
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  equal(ui(rig)["listkind"], "special");
  rig.press("ENTER", 6);
  equal(ui(rig)["mode"], "target", "a healing move chooses among the party");
  equal(ui(rig)["targetparty"], 1);
  // The party is listed in order, so two steps down choose the rogue.
  rig.press("DOWN", 6);
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  rig.until(() => actor(rig, "rogue.tem").stats.hp > 0, 2000);
  equal(actor(rig, "rogue.tem").stats.hp, 12, "the stored -12 raised the fallen rogue by 12");
  equal(actor(rig, caster).stats.smp, smpBefore - 2, "the stored cost of 2 was deducted from the caster");
  deepEqual(rig.diagnostics, []);
});

test("a move's linked status effect, as the editor stored it, is applied by the move and ticks its signed HP amount on the afflicted fighter's turns", () => {
  const poison = statusBytes(authoredStatus({ hpPerRound: 4 }));
  const read = readStatusEffect(new BinaryReader(poison));
  ok(read.ok);
  deepEqual([read.value.rounds, read.value.hpEnabled, read.value.hpPerRound], [2, 1, 4]);
  const poisonous = moveBytes({ ...readMove("SpcMove/fire.spc"), smpCost: 2, statusEffect: "poison.ste" });
  const rig = boot({ "SpcMove/fire.spc": poisonous, "StatusE/poison.ste": poison }, { slimeHp: 400 });
  awaitMenu(rig);
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  equal(ui(rig)["mode"], "target");
  rig.press("ENTER", 6);
  // The live state is replaced as the fight runs, so the slime is looked up again each time it is read.
  const slime = () => actor(rig, "slime.ene");
  rig.until(() => slime().statuses["poison.ste"] !== undefined, 2000);
  equal(slime().stats.hp, 400 - 12, "the move's own damage landed first");
  equal(slime().statuses["poison.ste"], 2, "the status effect the move links is applied with the rounds the editor stored");
  rig.until(() => slime().stats.hp < 400 - 12, 4000);
  equal(slime().stats.hp, 400 - 12 - 4, "the stored per-round HP amount was removed on the slime's turn");
  equal(slime().statuses["poison.ste"], 1, "and one round was used");
  deepEqual(rig.diagnostics, []);
});

test("a negative per-round HP amount the editor stored heals the afflicted fighter before its turn, clamped at its maximum", () => {
  const regen = statusBytes(authoredStatus({ name: "Regen", rounds: 3, hpPerRound: -5 }));
  const rig = boot({ "StatusE/regen.ste": regen });
  rig.until((state) => state.party.members.length === 3, 2000);
  rig.mutateNextTick((state) => {
    for (const record of state.actors.actors) {
      if (record.source === "hero.tem" || record.source === "mage.tem") {
        record.stats.hp = record.source === "hero.tem" ? 10 : 28;
        record.statuses["regen.ste"] = 3;
      }
    }
  });
  rig.tick(2);
  awaitMenu(rig);
  const first = ["hero.tem", "mage.tem"][Number(ui(rig)["menuindex"])]!;
  equal(actor(rig, first).stats.hp, first === "hero.tem" ? 15 : 30, "the status healed 5 before the turn, and not past the maximum of 30");
  equal(actor(rig, first).statuses["regen.ste"], 2);
  deepEqual(rig.diagnostics, []);
});

// Guard-rail exception log (docs/guardrails.md#exceptions, owner rule 2026-11-11): the fast-test rule (AGENTS.md,
// "Tests stay fast").
//
// - Rule: an ordinary unit test finishes in under 1 second individually.
// - Where: the five cases in this file.
// - Why: the story's acceptance is "each format opens, edits, saves, reopens and loads through the chosen real battle
//   provider using an authored enemy fixture". These cases boot the whole `stock_battle` game through the real engine with
//   the core suite's authored rig, because the provider's own behaviour (which moves the Special list holds, what a signed
//   FP amount does to an actor, when a status ticks and where it clamps) exists only inside that running package. No
//   smaller test can show it: a stubbed battle would be asserting the stub.
// - Way out: a permanent exception. No fix is possible or wanted here. AGENTS.md allows a full-engine test that "covers
//   only the smallest scenario needed to prove a cross-layer contract" and asks for the explanation above; a ticket cannot
//   remove the engine boot without removing the proof. The paper work over the same documents is the fast half and lives
//   in `packages/editor-model/test/battle-data-documents.test.ts` (16 cases, whole file under 0.5 s), which also asserts
//   these files are byte-for-byte what `writeSpecialMove` / `writeStatusEffect` produce.
// - Measured bound (do not let it grow): 0.5-1.3 s per case for the four menu cases, and 2.6-7 s for the authored-enemy
//   case, which plays several whole turns on the development machine, 2026-11-24; the limit this exception may not
//   exceed is 2 s per menu case and 12 s for the enemy case. The file's total is about 12 s.

test("an authored enemy that lists the editor's saved move uses it in the fight, and the move's linked status ticks on the party", () => {
  // The bytes are the editor's own save, committed under test/fixtures/editor and tied back to the documents by
  // `packages/editor-model/test/battle-data-documents.test.ts`. The enemy is authored here: the rig's slime, taught one
  // move and the AI level that always reaches for it.
  const move = fixture("burner.spc");
  const status = fixture("burn.ste");
  const slime = readEnemy(new BinaryReader(authored.get(assetKey("Enemy/slime.ene"))!));
  ok(slime.ok);
  const taught = writeEnemy({ ...slime.value, specialMoves: ["burner.spc"], aiLevel: 3 });
  ok(taught.ok);
  const rig = boot({
    "SpcMove/burner.spc": move,
    "StatusE/burn.ste": status,
    "Enemy/slime.ene": taught.value,
  }, { slimeHp: 400 });
  awaitMenu(rig);
  const hero = () => actor(rig, "hero.tem");
  const enemy = () => actor(rig, "slime.ene");
  const hpBefore = hero().stats.hp;
  const smpBefore = enemy().stats.smp;
  // The party takes its turns (Fight, then the first enemy) so the enemies' charges fill and the taught slime acts.
  for (let turn = 0; turn < 8 && hero().statuses["burn.ste"] === undefined; turn += 1) {
    awaitMenu(rig);
    rig.press("ENTER", 6);
    rig.press("ENTER", 6);
    rig.tick(180);
  }
  rig.until(() => hero().statuses["burn.ste"] !== undefined, 20000);
  ok(hero().stats.hp <= hpBefore - 10, `the saved move's damage landed on the party (${hpBefore} -> ${hero().stats.hp})`);
  equal(enemy().stats.smp, smpBefore, "the saved cost of 0 was paid");
  ok(hero().statuses["burn.ste"]! >= 1, `the saved link applied its stored rounds (${hero().statuses["burn.ste"]} left)`);
  const roundsLeft = hero().statuses["burn.ste"]!;
  const afterMove = hero().stats.hp;
  rig.until(() => hero().stats.hp < afterMove, 20000);
  equal(hero().stats.hp, afterMove - 3, "the stored per-round HP amount ticked on the hero's turn");
  equal(hero().statuses["burn.ste"], roundsLeft - 1, "and one of its stored rounds was used");
  deepEqual(rig.diagnostics, []);
});
