import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readSurfacePixels } from "../src/index.ts";
import { awaitMenu, bootUiRig, countColour, pinnedCount, SELECTION_YELLOW, ui, type UiRig } from "./battle-ui-rig.ts";

test("damage numbers are on the real screen for 36 ticks after they are drawn, plus the redraw that clears them", () => {
  const rig = bootUiRig({ slimeHp: 60 });
  awaitMenu(rig);
  rig.press("ENTER", 6);
  rig.press("ENTER", 1);
  // The first contiguous run of ticks on which the damage colour is on the field; a later action has its own run.
  let shown = 0;
  for (let step = 0; step < 100; step += 1) {
    rig.tick(1);
    const visible = countColour(rig, { x1: 0, y1: 0, x2: 639, y2: 340 }, [255, 96, 96]).count > 0;
    if (visible) shown += 1;
    else if (shown > 0) break;
  }
  ok(shown >= 36 && shown <= 44, `the number was on screen for ${shown} ticks`);
  deepEqual(rig.diagnostics, []);
});

test("a second battle in the same game starts a working screen with live canvases and its own pictures", () => {
  const rig = bootUiRig({ enemies: ["slime"], slimeHp: 1, fights: 2 });
  awaitMenu(rig);
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  rig.until((state) => state.vm.globals.afterfight === 1, 3000);
  rig.until(() => ui(rig)["mode"] === "command", 3000);
  rig.tick(8);
  equal(rig.state().vm.globals.afterfight, 1, "the first fight is over and the second is on");
  equal(pinnedCount(rig), 4, "three party pictures and one enemy picture of the second battle");
  const frame = rig.frame();
  const at = (348 * frame.w + 160) * 4;
  deepEqual([...frame.rgba.subarray(at, at + 3)], [180, 190, 255], "the second battle's party panel frame is on screen");
  ok(countColour(rig, { x1: 8, y1: 348, x2: 151, y2: 479 }, SELECTION_YELLOW).count > 0, "the command panel's selected label is yellow");
  // The reserved overlay persists, while the battle owns its buffer, target scratch and HUD backup.
  const fullSize = Object.values(rig.state().surfaces.entries).filter((entry) => entry.id !== (0 as never) && entry.bitmap.w === 640 && entry.bitmap.h === 480).map((entry) => entry.id);
  equal(fullSize.length, 4, `the overlay, buffer, target scratch and overlay back-up (${fullSize.join(",")})`);
  equal(rig.state().surfaces.renderNow as number, 2, "the second battle draws on the reserved canvas the first one used");
  const buffer = rig.ui()?.["buffer"] as number;
  ok(fullSize.map((id) => id as number).includes(buffer), "the buffer of the second battle is live");
  rig.press("ENTER", 6);
  rig.press("ENTER", 6);
  rig.until((state) => state.vm.globals.afterfight === 2, 3000);
  rig.tick(10);
  const left = Object.values(rig.state().surfaces.entries).filter((entry) => entry.id !== (0 as never) && entry.bitmap.w === 640 && entry.bitmap.h === 480);
  deepEqual(left.map((entry) => entry.id as number), [rig.state().surfaces.renderNow as number], "between and after battles only the reserved overlay is left");
  equal(rig.state().surfaces.renderNowOn, false, "the game had no HUD, so the overlay is switched off again");
  deepEqual(rig.diagnostics, []);
});

function overlayPixel(rig: UiRig, x: number, y: number): number[] {
  const surfaces = rig.state().surfaces;
  const handle = surfaces.renderNow as number;
  const pixels = readSurfacePixels(surfaces, handle as never, surfaces.entries[String(handle)]!.rev);
  if (pixels === null) throw new Error("the overlay is not readable");
  return [...pixels.rgba.subarray((y * pixels.w + x) * 4, (y * pixels.w + x) * 4 + 4)];
}

for (const hud of ["on", "off", undefined] as const) {
  test(`a battle borrows the game's overlay and hands it back: the HUD's pixels and flag survive (${hud ?? "no HUD"})`, () => {
    const rig = bootUiRig({ enemies: ["slime"], slimeHp: 1, ...(hud === undefined ? {} : { hud }) });
    awaitMenu(rig);
    const handle = rig.state().surfaces.renderNow as number;
    if (hud !== undefined) equal(handle, rig.state().vm.globals.hud, "the battle drew on the game's own reserved canvas");
    ok(overlayPixel(rig, 10, 10)[0] !== 200, "during the battle the screen owns the overlay");
    rig.press("ENTER", 6);
    rig.press("ENTER", 6);
    rig.until((state) => state.vm.globals.afterfight === 1, 3000);
    rig.tick(10);
    const surfaces = rig.state().surfaces;
    equal(surfaces.renderNow, handle, "the reserved canvas persisted");
    equal(surfaces.renderNowOn, hud === "on", "the on/off flag is what the game had (off when there was no HUD)");
    deepEqual(overlayPixel(rig, 10, 10), hud === undefined ? [0, 0, 0, 0] : [200, 30, 30, 255], hud === undefined ? "a canvas the battle created is left clear" : "the HUD's pixels are back");
    deepEqual(overlayPixel(rig, 300, 200), [0, 0, 0, 0], "nothing of the battle screen is left on it");
    const frame = rig.frame();
    const at = (10 * frame.w + 10) * 4;
    const shown = frame.rgba[at] === 200 && frame.rgba[at + 1] === 30 && frame.rgba[at + 2] === 30;
    equal(shown, hud === "on", "the HUD shows on the real screen only when the game had it on");
    deepEqual(rig.diagnostics, []);
  });
}
