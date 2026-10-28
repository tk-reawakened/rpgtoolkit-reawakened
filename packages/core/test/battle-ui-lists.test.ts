import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import {
  actor,
  awaitMenu,
  bootUiRig,
  countColour,
  pinnedCount,
  pinnedTimelines,
  regionHash,
  SELECTION_YELLOW,
  TARGET_MESSAGE_FIELD,
  TARGET_PICKER_FIELD,
  LIST_FIELD,
  LIST_HIGHLIGHT,
  ENEMY_BAR_RED,
  COMMAND_FIELD,
  PARTY_FIELD,
  THRESHOLD,
  MAGE,
  ui,
} from "./battle-ui-rig.ts";

test("the selected list row highlights both columns across long labels and details", () => {
  const rig = bootUiRig({
    extraItems: 18,
    extraItemLabelPrefix: "Gem with an exceptionally long label ",
    extraItemQuantity: 987654321,
  });
  awaitMenu(rig);
  const press = (name: string): void => rig.press(name, 12);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  press("DOWN");
  press("DOWN");
  rig.tick(24);
  const firstColumn = countColour(rig, LIST_FIELD, LIST_HIGHLIGHT);
  ok(firstColumn.count > 200, `highlight covers the selected row (${firstColumn.count} pixels)`);
  ok(firstColumn.minX <= 24 && firstColumn.maxX >= 300, `highlight spans the first column's label and detail (${firstColumn.minX}..${firstColumn.maxX})`);
  ok(firstColumn.minY >= 130 && firstColumn.maxY <= 170, `first selected row stays within its row bounds (${firstColumn.minY}..${firstColumn.maxY})`);
  for (let step = 0; step < 6; step += 1) press("DOWN");
  rig.tick(24);
  equal(ui(rig)["listcursor"], 8);
  const secondColumn = countColour(rig, LIST_FIELD, LIST_HIGHLIGHT);
  ok(secondColumn.minX >= 320 && secondColumn.maxX >= 600, `highlight spans the second column's label and detail (${secondColumn.minX}..${secondColumn.maxX})`);
  ok(secondColumn.minY >= 70 && secondColumn.maxY <= 110, `second selected row stays within its row bounds (${secondColumn.minY}..${secondColumn.maxY})`);
  deepEqual(rig.diagnostics, []);
});

test("the selected command stays yellow beside the open target list and matches the active party name", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  rig.press("ENTER", 8);
  equal(ui(rig)["mode"], "target");
  rig.tick(8);
  const commandHighlight = countColour(rig, COMMAND_FIELD, SELECTION_YELLOW);
  ok(commandHighlight.count > 20, `the selected command remains yellow (${commandHighlight.count} pixels)`);
  const partyHighlight = countColour(rig, PARTY_FIELD, SELECTION_YELLOW);
  ok(partyHighlight.count > 0, "the active party member's name uses the same yellow highlight");
  const pickerHighlight = countColour(rig, TARGET_PICKER_FIELD, SELECTION_YELLOW);
  ok(pickerHighlight.count > 20, "the selected target name is yellow in the compact picker");
  ok(countColour(rig, TARGET_PICKER_FIELD, LIST_HIGHLIGHT).count > 200, "the target row highlight fills the compact picker row");
  ok(countColour(rig, TARGET_MESSAGE_FIELD, [255, 255, 255]).count > 0, "the selected target name is shown in the message strip");
  ok(pinnedCount(rig) > 0, "fighter animations remain visible while the target picker is open");
  ok(commandHighlight.minY >= COMMAND_FIELD.y1 && commandHighlight.maxY <= COMMAND_FIELD.y2);
  deepEqual(rig.diagnostics, []);
});

test("revive confirmation follows the fallen ally's displayed name, not its current cursor index", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const rogue = actor(rig, "rogue.tem");
  equal(rogue.stats.hp, 0);
  rogue.name = "Fallen Rogue";
  const press = (name: string): void => rig.press(name, 12);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  const firstTargetName = regionHash(rig, TARGET_MESSAGE_FIELD);
  press("RIGHT");
  press("RIGHT");
  equal(ui(rig)["targetcursor"], 2);
  ok(regionHash(rig, TARGET_MESSAGE_FIELD) !== firstTargetName, "the message strip changes to the selected Fallen Rogue name");
  ok(countColour(rig, TARGET_PICKER_FIELD, SELECTION_YELLOW).count > 0, "Fallen Rogue is highlighted by name in the target picker");
  equal(rogue.stats.hp, 0, "opening and selecting the named target does not revive it yet");
  press("ENTER");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  equal(actor(rig, "rogue.tem").stats.hp, 20, "confirming Fallen Rogue applies the Potion to that named ally");
  deepEqual(rig.diagnostics, []);
});

test("duplicate party names remain distinguishable in the target list and revive the selected actor", () => {
  const rig = bootUiRig();
  awaitMenu(rig);
  const hero = actor(rig, "hero.tem");
  const rogue = actor(rig, "rogue.tem");
  hero.name = "Ally";
  rogue.name = "Ally";
  const press = (name: string): void => rig.press(name, 12);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  rig.tick(8);
  const firstTargetName = regionHash(rig, TARGET_MESSAGE_FIELD);
  ok(countColour(rig, TARGET_PICKER_FIELD, SELECTION_YELLOW).count > 0, "the duplicated-name target row is yellow in the compact picker");
  press("RIGHT");
  press("RIGHT");
  equal(ui(rig)["targetcursor"], 2);
  ok(regionHash(rig, TARGET_MESSAGE_FIELD) !== firstTargetName, "the message strip distinguishes the selected duplicate-name target");
  press("ENTER");
  rig.until(() => rig.charges()[1]![MAGE]! < THRESHOLD, 400);
  equal(actor(rig, "hero.tem").stats.hp, 42, "the living same-named Ally was not revived");
  equal(actor(rig, "rogue.tem").stats.hp, 20, "the selected fallen same-named Ally was revived");
  deepEqual(rig.diagnostics, []);
});


test("an item list longer than sixteen entries pages inside its box, and the fighters' pictures and labels stay off it while it is open", () => {
  const rig = bootUiRig({ extraItems: 20, stanceDelayTicks: 2 });
  awaitMenu(rig);
  ok(pinnedCount(rig) > 0, "the fighters' pictures are showing before the list opens");
  const timelines = pinnedTimelines(rig);
  equal(timelines.length, 6, "three party members and three enemies");
  ok(countColour(rig, LIST_FIELD, ENEMY_BAR_RED).count > 0, "an enemy's HP bar shows on the field before the list opens");
  const press = (name: string): void => rig.press(name, 6);
  press("DOWN");
  press("DOWN");
  press("ENTER");
  equal(ui(rig)["listkind"], "item");
  equal(ui(rig)["listcount"], 22, "Potion, Ether and twenty gems; the key is not usable in a fight");
  rig.tick(6);
  equal(pinnedCount(rig), 0, "no picture is drawn over the open list");
  deepEqual(pinnedTimelines(rig), timelines, "the pictures are hidden, not ended: the same animations on the same timelines");
  equal(countColour(rig, LIST_FIELD, ENEMY_BAR_RED).count, 0, "no enemy label is drawn over the open list");
  // Each move redraws the list, which takes the turn loop several ticks, so presses queue up behind it; none is lost.
  for (let step = 0; step < 17; step += 1) press("DOWN");
  rig.until(() => ui(rig)["listcursor"] === 17, 120);
  rig.tick(8);
  equal(ui(rig)["listcursor"], 17);
  equal(ui(rig)["listtop"], 16, "the second page starts at entry 16");
  const highlight = countColour(rig, LIST_FIELD, LIST_HIGHLIGHT);
  ok(highlight.count > 200, `the selected row is drawn (${highlight.count} pixels)`);
  ok(highlight.minY >= 70 && highlight.maxY <= 326, `the selected row stays inside the list box (y ${highlight.minY}..${highlight.maxY})`);
  press("ENTER");
  equal(ui(rig)["mode"], "target");
  equal((ui(rig)["pendingentry"] as { label: string }).label, "Gem 16", "entry 17 is the sixteenth gem");
  press("ESC");
  press("ESC");
  rig.tick(8);
  equal(ui(rig)["mode"], "command");
  equal(pinnedCount(rig), 6, "the pictures return when the list is closed");
  deepEqual(pinnedTimelines(rig), timelines, "the same animations, none restarted");
  const dying = rig.state().fx.animations.filter((animation) => animation.pinned === true && !animation.loop);
  equal(dying.length, 1, "the fallen Rogue's die animation");
  equal(dying[0]!.frame, dying[0]!.frames.length - 1, "its die pose is still held on the last frame, not replayed");
  deepEqual(rig.diagnostics, []);
});
