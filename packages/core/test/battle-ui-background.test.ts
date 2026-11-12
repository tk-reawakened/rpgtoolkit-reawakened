// A tile-bitmap (`.tbm`) battle background (entry 7.23, issue #743; docs/spec/formats/tiles.md#tile-bitmap-tbm,
// docs/spec/formats/battle-data.md#fight-background-bkg, docs/spec/engine/battle.md#bat-11).
//
// The rig authors a 20 × 15 tile picture of solid tiles, three tile rows per band, so the composed 640 × 480
// background is a 1:1 copy of the authored art and every battlefield pixel has one expected colour. The screen is
// read back from the engine, so a decoded picture, a wrong picture and the stock flat fallback are distinguishable.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetKey, expandTileToRgba, readTileset } from "../src/index.ts";
import { awaitMenu, bootUiRig, tbmColourAt, type UiRig } from "./battle-ui-rig.ts";

/** The stock screen's flat fallback colour when the `.bkg` names no picture (BAT-11 item 3). */
const FLAT_FALLBACK: readonly [number, number, number] = [20, 28, 56];

/** The battlefield area no panel, fighter slot, list or message covers while the command box is open. */
const FIELD = { x1: 240, y1: 56, x2: 520, y2: 320 } as const;

type Frame = { readonly w: number; readonly h: number; readonly rgba: Uint8Array };

function pixel(frame: Frame, x: number, y: number): readonly [number, number, number] {
  const at = (y * frame.w + x) * 4;
  return [frame.rgba[at]!, frame.rgba[at + 1]!, frame.rgba[at + 2]!];
}

/** How many pixels of `box` differ from the colour the authored tile bitmap puts there. */
function offPicture(frame: Frame, box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }): number {
  let different = 0;
  for (let y = box.y1; y <= box.y2; y += 1) {
    for (let x = box.x1; x <= box.x2; x += 1) {
      const expected = tbmColourAt(x, y);
      const at = (y * frame.w + x) * 4;
      if (frame.rgba[at] !== expected[0] || frame.rgba[at + 1] !== expected[1] || frame.rgba[at + 2] !== expected[2]) different += 1;
    }
  }
  return different;
}

/** How many pixels of `box` are the flat fallback colour. */
function fallbackPixels(frame: Frame, box: { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }): number {
  let flat = 0;
  for (let y = box.y1; y <= box.y2; y += 1) {
    for (let x = box.x1; x <= box.x2; x += 1) {
      const at = (y * frame.w + x) * 4;
      if (frame.rgba[at] === FLAT_FALLBACK[0] && frame.rgba[at + 1] === FLAT_FALLBACK[1] && frame.rgba[at + 2] === FLAT_FALLBACK[2]) flat += 1;
    }
  }
  return flat;
}

function openScreen(rig: UiRig): Frame {
  awaitMenu(rig);
  rig.tick(6);
  return rig.frame();
}

test("a .tbm battle background is decoded and drawn behind the battle UI", () => {
  const rig = bootUiRig({ background: "tbm" });
  const frame = openScreen(rig);

  // The picture is fetched through the image path, and its cells pull their tileset through the tile path.
  ok(rig.requested.includes(assetKey("Bitmap/meadow.tbm")), `the .tbm background was requested (${rig.requested.join(", ")})`);
  ok(rig.requested.includes(assetKey("Tiles/meadow.tst")), "the tile bitmap's tileset was requested");
  deepEqual(rig.diagnostics, [], "decoding the tile bitmap reports no diagnostic");

  // Every battlefield pixel is the authored tile with its cell tint, so neither the flat fallback nor a wrong picture
  // can pass.
  equal(offPicture(frame, FIELD), 0, "the whole battlefield matches the authored tile bitmap");
  equal(fallbackPixels(frame, FIELD), 0, "no battlefield pixel is the flat fallback colour");
  equal((FIELD.x2 - FIELD.x1 + 1) * (FIELD.y2 - FIELD.y1 + 1), 281 * 265, "the checked field is the whole clear battlefield");

  // Each row band at a point the UI leaves clear; the second and fourth bands carry a cell tint.
  for (const y of [60, 150, 250, 330]) {
    deepEqual(pixel(frame, 300, y), tbmColourAt(300, y), `row y=${y} shows its tile colour and tint`);
  }
  // The last band sits under the panels; the strip right of the party panel still shows it.
  deepEqual(pixel(frame, 635, 400), tbmColourAt(635, 400), "the bottom band shows beside the panels");
});

test("a .bkg with no picture keeps the flat fallback, so the .tbm path is not a blanket substitution", () => {
  const rig = bootUiRig({ background: "none" });
  const frame = openScreen(rig);
  equal(fallbackPixels(frame, FIELD), (FIELD.x2 - FIELD.x1 + 1) * (FIELD.y2 - FIELD.y1 + 1), "the battlefield is the flat fallback colour");
  deepEqual(rig.diagnostics, []);
});

test("an image-only battle background still paints its authored PNG", () => {
  const rig = bootUiRig({ background: "png" });
  rig.until(() => Number(rig.ui()?.["backgroundcount"] ?? 0) > 0, 2000);
  rig.tick(8);
  const frame = rig.frame();
  deepEqual(pixel(frame, 300, 150), [36, 48, 90]);
  ok(rig.requested.includes(assetKey("Bitmap/meadow.png")));
  deepEqual(rig.diagnostics, []);
});

test("an image path resembling the old internal prefix remains an ordinary bitmap", () => {
  const rig = bootUiRig({ background: "prefix-png" });
  rig.until(() => Number(rig.ui()?.["backgroundcount"] ?? 0) > 0, 2000);
  rig.tick(8);
  deepEqual(pixel(rig.frame(), 300, 150), [36, 48, 90]);
  ok(rig.requested.includes(assetKey("Bitmap/@battle-background/meadow.png")));
  deepEqual(rig.diagnostics, []);
});

test("text background cell tints retain their signed channels and positions", () => {
  const rig = bootUiRig({ background: "tinted-text" });
  rig.until(() => Number(rig.ui()?.["backgroundcount"] ?? 0) > 0, 2000);
  rig.tick(8);
  const frame = rig.frame();
  const cell = (column: number, row: number) =>
    pixel(frame, Math.floor((column * 32 + 16) * 640 / 608), Math.floor((row * 32 + 16) * 480 / 352));
  deepEqual(cell(8, 4), [70, 70, 70]);
  deepEqual(cell(9, 2), [30, 105, 35]);
  deepEqual(cell(8, 3), [40, 90, 60]);
  deepEqual(rig.diagnostics, []);
});

test("a cold text background requests all independent tiles in one batch", () => {
  // Count the row copies out of decoded tile strips, while delivering the
  // independently requested files one at a time. This catches eager retries
  // that re-copy all previously resolved tiles as well as serial requests.
  const originalSet = Uint8Array.prototype.set;
  let tileRowCopies = 0;
  Uint8Array.prototype.set = function (source, offset) {
    if (this.length === 4096 && source.length === 128 && new Error().stack?.includes("tileCellPixels")) tileRowCopies += 1;
    return originalSet.call(this, source, offset);
  };
  try {
    const rig = bootUiRig({ background: "many-tiles", staggerColdTiles: true });
    rig.until(() => Number(rig.ui()?.["backgroundcount"] ?? 0) > 0, 2000);
    rig.tick(8);
    const batches = rig.requestBatches.map((batch) => batch.filter((key) => /tiles\/cold\d+\.tst$/i.test(key))).filter((batch) => batch.length > 0);
    equal(batches.length, 1, "independent tile files must not require serial host round trips");
    equal(new Set(batches[0]).size, 19);
    equal(tileRowCopies, 19 * 32, "each distinct 32-row tile is copied once");
    deepEqual(pixel(rig.frame(), 256, 128), [40, 90, 60]);
    equal(rig.diagnostics.length, 0);
  } finally {
    Uint8Array.prototype.set = originalSet;
  }
});

test("Final Destiny's text background paints its stored tiles in a stock fight", () => {
  const rig = bootUiRig({ background: "final-destiny" });
  rig.until(() => Number(rig.ui()?.["backgroundcount"] ?? 0) > 0, 2000);
  rig.tick(8);
  const frame = rig.frame();
  deepEqual(rig.diagnostics, [], `requests: ${rig.requested.join(", ")}`);
  const parsed = readTileset(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/legacy/FinalDestiny/Tiles/default.tst")));
  ok(parsed.ok);
  for (const [column, row, tileNumber] of [[9, 2, 12], [12, 4, 12], [8, 4, 1]] as const) {
    const x = Math.floor((column * 32 + 16) * 640 / 608);
    const y = Math.floor((row * 32 + 16) * 480 / 352);
    const sourceX = Math.floor(x * 608 / 640) % 32;
    const sourceY = Math.floor(y * 352 / 480) % 32;
    const expanded = expandTileToRgba(parsed.value, tileNumber - 1);
    ok(expanded.ok);
    const offset = (sourceX * 32 + sourceY) * 4;
    deepEqual(pixel(frame, x, y), Array.from(expanded.value.slice(offset, offset + 3)), `tile ${tileNumber} at ${column},${row}`);
  }
  ok(rig.requested.includes(assetKey("Tiles/default.tst")));
  deepEqual(rig.diagnostics, []);
});
