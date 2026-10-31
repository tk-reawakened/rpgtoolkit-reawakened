// BAT-11: a battle ended from outside the menu (a script calls `battle.finish`), per-turn Special availability, and
// the duplicate-aware target names (docs/spec/engine/battle.md#bat-11).
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readSurfacePixels, startThread } from "../src/index.ts";
import { actor, awaitMenu, bootUiRig, countColour, entries, pinnedCount, ui, type UiRig } from "./battle-ui-rig.ts";

function overlayPixel(rig: UiRig, x: number, y: number): number[] {
  const surfaces = rig.state().surfaces;
  const handle = surfaces.renderNow as number;
  const pixels = readSurfacePixels(surfaces, handle as never, surfaces.entries[String(handle)]!.rev);
  if (pixels === null) throw new Error("the overlay is not readable");
  return [...pixels.rgba.subarray((y * pixels.w + x) * 4, (y * pixels.w + x) * 4 + 4)];
}

for (const mode of ["command", "list", "target"] as const) {
  test(`a battle ended from outside unwinds the open ${mode} menu and hands the screen back`, () => {
    const rig = bootUiRig({ enemies: ["slime"], slimeHp: 10, hud: "on" });
    awaitMenu(rig);
    ok(pinnedCount(rig) > 0, "the fighters' pictures are showing");
    if (mode === "list") {
      rig.press("DOWN", 6);
      rig.press("ENTER", 6);
    }
    if (mode === "target") rig.press("ENTER", 6);
    equal(ui(rig)["mode"], mode);
    equal(rig.state().battle?.outcome, null);
    startThread(rig.state().vm, { ref: { kind: "inline", text: "battle.finish(2)\nend()", ir: "1" }, kind: "persistent", owner: "script" });
    rig.tick(100);
    equal(rig.state().battle?.outcome, 2);
    equal(rig.state().vm.globals.afterfight, 1, "the battle loop returned to the fight program");
    equal(ui(rig)["on"], 0, "the screen is off");
    equal(ui(rig)["mode"], "idle", "no menu is left open");
    equal(pinnedCount(rig), 0, "no fighter animation stays pinned");
    equal(rig.state().surfaces.renderNowOn, true, "the game's HUD flag is back");
    deepEqual(overlayPixel(rig, 10, 10), [200, 30, 30, 255], "the HUD's pixels are back");
    deepEqual(overlayPixel(rig, 300, 200), [0, 0, 0, 0], "nothing of the battle screen is left on the overlay");
    deepEqual(rig.diagnostics, []);
  });
}

function otherMember(rig: UiRig): number {
  return Number(ui(rig)["menuindex"]) === 0 ? 1 : 0;
}

function waitForMenu(rig: UiRig, index: number): void {
  rig.until(() => {
    const dictionary = rig.ui();
    return dictionary !== null && dictionary["mode"] === "command" && dictionary["menuindex"] === index;
  }, 4000);
  rig.tick(8);
}

function finishTurn(rig: UiRig): void {
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
}

test("the Special list is read again each turn: a move learned between turns is listed", () => {
  const rig = bootUiRig({ slimeHp: 400, learnSpecialsAt: { minExp: 100, minLevel: 99 } });
  awaitMenu(rig);
  const next = otherMember(rig);
  equal(ui(rig)["specialcount"], 0, "nothing is learned in the first turn");
  actor(rig, ["hero.tem", "mage.tem"][next]!).stats.experience = 100;
  finishTurn(rig);
  waitForMenu(rig, next);
  equal(ui(rig)["specialcount"], 2, "the moves the next player has learned since the battle began are listed");
  deepEqual(rig.diagnostics, []);
});

test("the Special list is read again each turn: the SMP check follows the player's current SMP", () => {
  const rig = bootUiRig({
    slimeHp: 400,
    party: [{ key: "hero", hp: 42, smp: 0 }, { key: "mage", hp: 30, smp: 0 }, { key: "rogue", hp: 0, smp: 6 }],
  });
  awaitMenu(rig);
  const next = otherMember(rig);
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  deepEqual(entries(ui(rig)["list"], 2).map((entry) => entry["affordable"]), [0, 0]);
  rig.press("ESC", 6);
  rig.press("UP", 6);
  actor(rig, ["hero.tem", "mage.tem"][next]!).stats.smp = 20;
  finishTurn(rig);
  waitForMenu(rig, next);
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  deepEqual(entries(ui(rig)["list"], 2).map((entry) => [entry["label"], entry["affordable"]]), [["fire", 1], ["blaze", 0]], "the 4 SMP move is now affordable, the 30 SMP move is not");
  deepEqual(rig.diagnostics, []);
});

const WHITE: readonly [number, number, number] = [255, 255, 255];

test("duplicate-aware target names replace the plain names instead of drawing over them", () => {
  const rig = bootUiRig({ enemies: ["slime", "bat", "slime"] });
  awaitMenu(rig);
  for (const record of rig.state().actors.actors) if (record.source === "slime.ene") record.name = "ABCDEFGH";
  rig.tick(4);
  rig.press("ENTER", 6);
  equal(ui(rig)["mode"], "target");
  rig.tick(8);
  // The first slime's label, at x = 40 and y = 107: "ABCDEF A", whose seventh cell is blank. A leftover letter of the
  // plain name "ABCDEFGH" would show white pixels there.
  equal(countColour(rig, { x1: 88, y1: 107, x2: 95, y2: 114 }, WHITE).count, 0, "no letter of the plain name shows through the suffix");
  ok(countColour(rig, { x1: 96, y1: 107, x2: 103, y2: 114 }, WHITE).count > 0, "the suffix letter is drawn");
  deepEqual(rig.diagnostics, []);
});

test("party names stop before the HP bar, in the row and in target mode", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  for (const record of rig.state().actors.actors) if (record.kind === "party") record.name = "ABCDEFGH";
  rig.tick(4);
  const gap = { x1: 269, y1: 380, x2: 275, y2: 470 };
  const nameColours = [WHITE, [255, 224, 64], [130, 130, 140]] as const;
  for (const colour of nameColours) equal(countColour(rig, gap, colour).count, 0, "the plain row stops short of the bar");
  // Items, Potion: the party is the target, so its rows are renamed with the duplicate letters.
  rig.press("DOWN", 6);
  rig.press("DOWN", 6);
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  equal(ui(rig)["mode"], "target");
  rig.tick(8);
  for (const colour of nameColours) equal(countColour(rig, gap, colour).count, 0, "the lettered row stops short of the bar");
  ok(countColour(rig, { x1: 172, y1: 380, x2: 268, y2: 470 }, WHITE).count + countColour(rig, { x1: 172, y1: 380, x2: 268, y2: 470 }, [255, 224, 64]).count > 0, "the names are drawn");
  deepEqual(rig.diagnostics, []);
});
