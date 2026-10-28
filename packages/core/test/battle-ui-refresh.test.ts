// BAT-11: changes to visible fighter data must reach the rendered screen without keyboard input.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { actor, awaitMenu, bootUiRig, regionHash, ui, type UiRig } from "./battle-ui-rig.ts";

type Box = { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
type Context = "idle" | "command" | "list" | "target";
type Change = { readonly name: string; readonly box: Box; readonly mutate: (rig: UiRig) => void };

const nameBox = { x1: 172, y1: 356, x2: 275, y2: 371 };
const hpBox = { x1: 276, y1: 356, x2: 387, y2: 369 };
const smpBox = { x1: 396, y1: 356, x2: 491, y2: 369 };
const chargeBox = { x1: 500, y1: 404, x2: 611, y2: 417 };
const enemyName = { x1: 40, y1: 107, x2: 103, y2: 114 };
const enemyHp = { x1: 40, y1: 118, x2: 103, y2: 123 };

const changes: readonly Change[] = [
  { name: "party name", box: nameBox, mutate: (rig) => { actor(rig, "hero.tem").name = "Zelda"; } },
  { name: "party HP", box: hpBox, mutate: (rig) => { actor(rig, "hero.tem").stats.hp = 13; } },
  { name: "party maximum HP", box: hpBox, mutate: (rig) => { actor(rig, "hero.tem").stats.maxHp = 80; } },
  { name: "party SMP", box: smpBox, mutate: (rig) => { actor(rig, "hero.tem").stats.smp = 2; } },
  { name: "party maximum SMP", box: smpBox, mutate: (rig) => { actor(rig, "hero.tem").stats.maxSmp = 40; } },
  { name: "fallen status", box: nameBox, mutate: (rig) => { actor(rig, "hero.tem").stats.hp = 0; } },
  { name: "enemy name", box: enemyName, mutate: (rig) => { actor(rig, "slime.ene").name = "Dragon"; } },
  { name: "enemy HP", box: enemyHp, mutate: (rig) => { actor(rig, "slime.ene").stats.hp = 10; } },
  { name: "enemy maximum HP", box: enemyHp, mutate: (rig) => { actor(rig, "slime.ene").stats.maxHp = 60; } },
  // The fallen Rogue does not accumulate charge in idle, so only this mutation can change its bar.
  { name: "party charge", box: chargeBox, mutate: (rig) => { rig.state().battle!.parties[1][2]!.charge = 60; } },
];

function ready(context: Context): UiRig {
  const rig = bootUiRig();
  if (context === "idle") {
    // Stop before the first ready turn, and keep charges away from the turn threshold.
    rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
    for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
    rig.tick(4);
    equal(ui(rig)["mode"], "idle");
  } else {
    awaitMenu(rig);
    if (context === "list") {
      rig.press("DOWN", 12);
      rig.press("ENTER", 12);
    } else if (context === "target") {
      rig.press("ENTER", 12);
    }
    equal(ui(rig)["mode"], context);
    rig.tick(8);
  }
  return rig;
}

for (const context of ["idle", "command", "list", "target"] as const) {
  for (const change of changes) {
    // The full-screen list obscures battlefield labels and bars.
    if (context === "list" && change.name.startsWith("enemy ")) continue;
    test(`${context}: ${change.name} updates its pixels without input within six ticks`, () => {
      const rig = ready(context);
      const before = regionHash(rig, change.box);
      change.mutate(rig);
      rig.tick(6);
      equal(ui(rig)["mode"], context, "no key or action changed the UI mode");
      ok(regionHash(rig, change.box) !== before, `${change.name} remained stale`);
      deepEqual(rig.diagnostics, []);
    });
  }
}

test("target picker and message update a renamed target without cursor movement", () => {
  const rig = ready("target");
  const picker = { x1: 8, y1: 255, x2: 151, y2: 323 };
  const message = { x1: 0, y1: 324, x2: 639, y2: 343 };
  const oldPicker = regionHash(rig, picker);
  const oldMessage = regionHash(rig, message);
  const cursor = ui(rig)["targetcursor"];
  actor(rig, "slime.ene").name = "Dragon";
  rig.tick(6);
  equal(ui(rig)["targetcursor"], cursor);
  ok(regionHash(rig, picker) !== oldPicker);
  ok(regionHash(rig, message) !== oldMessage);
  ok(ui(rig)["mode"] === "target");
  deepEqual(rig.diagnostics, []);
});

test("a nine-fighter idle battle refreshes simultaneous changes at both ends of the roster", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
  for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
  rig.tick(12);
  equal(ui(rig)["mode"], "idle");
  const lastRow = { x1: 172, y1: 452, x2: 275, y2: 467 };
  const firstEnemy = regionHash(rig, enemyName);
  const lastPlayer = regionHash(rig, lastRow);
  const battle = rig.state().battle!;
  const first = rig.state().actors.actors.find((entry) => entry.id === battle.parties[0][0]!.actorId)!;
  const last = rig.state().actors.actors.find((entry) => entry.id === battle.parties[1][4]!.actorId)!;
  first.name = "Dragon";
  last.name = "Wizard";
  rig.tick(6);
  equal(ui(rig)["mode"], "idle");
  ok(regionHash(rig, enemyName) !== firstEnemy, "first enemy name");
  ok(regionHash(rig, lastRow) !== lastPlayer, "last player name");
  deepEqual(rig.diagnostics, []);
});

test("nine on-screen fighters charge once per tick during unchanged idle passes", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  rig.until(() => rig.ui()?.["on"] === 1 && rig.ui()?.["staticsig"] !== "", 1000);
  for (const party of rig.state().battle!.parties) for (const fighter of party) fighter.charge = 0;
  rig.tick(12);
  equal(ui(rig)["mode"], "idle");
  for (let tick = 0; tick < 8; tick += 1) {
    const before = rig.charges();
    rig.tick(1);
    deepEqual(rig.charges(), before.map((party) => party.map((charge) => charge + 3)), `idle tick ${tick + 1}`);
  }
  deepEqual(rig.diagnostics, []);
});

test("a nine-fighter command screen refreshes the last party member without input", () => {
  const rig = bootUiRig({
    enemies: ["slime", "bat", "slime", "bat"],
    party: [
      { key: "hero", hp: 42, smp: 12 }, { key: "mage", hp: 30, smp: 3 },
      { key: "rogue", hp: 42, smp: 6 }, { key: "hero", hp: 42, smp: 12 },
      { key: "mage", hp: 30, smp: 3 },
    ],
  });
  awaitMenu(rig);
  const lastRow = { x1: 172, y1: 452, x2: 275, y2: 467 };
  const before = regionHash(rig, lastRow);
  const id = rig.state().battle!.parties[1][4]!.actorId;
  rig.state().actors.actors.find((entry) => entry.id === id)!.name = "Wizard";
  rig.tick(6);
  equal(ui(rig)["mode"], "command");
  ok(regionHash(rig, lastRow) !== before);
  deepEqual(rig.diagnostics, []);
});

test("renaming a duplicate target removes the other target's obsolete suffix glyphs", () => {
  const changed = ready("target");
  const reference = bootUiRig();
  awaitMenu(reference);
  actor(reference, "slime.ene").name = "Dragon";
  reference.press("ENTER", 20);
  reference.tick(16);
  equal(ui(reference)["mode"], "target");
  const otherSlimeName = { x1: 40, y1: 219, x2: 103, y2: 226 };
  const picker = { x1: 8, y1: 255, x2: 151, y2: 323 };
  actor(changed, "slime.ene").name = "Dragon";
  changed.tick(6);
  equal(regionHash(changed, otherSlimeName), regionHash(reference, otherSlimeName), "other duplicate's label matches a freshly composed target screen");
  equal(regionHash(changed, picker), regionHash(reference, picker), "picker labels match a freshly composed target screen");
  deepEqual(changed.diagnostics, []);
  deepEqual(reference.diagnostics, []);
});
