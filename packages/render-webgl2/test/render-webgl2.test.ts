import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { cropTile, presentationFrame } from "../src/index.ts";
import type { TexturePixels } from "../src/index.ts";

// The replayer's GPU work is entry 9.4's Playwright lane; what a Node test pins are the two pure decisions beside it —
// a tileset strip cropped to one tile (a strip wider than MAX_TEXTURE_SIZE samples as black otherwise) and AD-33's
// presentation geometry.

/** A strip of four 2×1 tiles: tile n is filled with the byte n. */
function strip(): TexturePixels {
  const rgba = new Uint8Array(2 * 4 * 4);
  for (let tile = 1; tile <= 4; tile += 1) {
    for (let x = 0; x < 2; x += 1) {
      const at = (x + (tile - 1) * 2) * 4;
      rgba[at] = tile;
      rgba[at + 3] = 255;
    }
  }
  return { w: 8, h: 1, rgba };
}

test("cropTile keeps exactly the tile it names", () => {
  const cropped = cropTile(strip(), 2, 3);
  equal(cropped.w, 2);
  equal(cropped.h, 1);
  deepEqual([...cropped.rgba], [3, 0, 0, 255, 3, 0, 0, 255]);
});

test("cropTile clamps a tile that runs past the strip instead of over-reading", () => {
  const cropped = cropTile(strip(), 2, 5);
  equal(cropped.w, 0);
  equal(cropped.rgba.length, 0);
});

test("letterbox scales the logical frame by an integer factor and centres it", () => {
  const frame = presentationFrame({ mode: "letterbox", scale: 3 }, { width: 320, height: 200 });
  deepEqual(frame.canvas, { width: 960, height: 600 });
  deepEqual(frame.viewport, { x: 0, y: 0, width: 960, height: 600 });
});

test("letterbox never scales by a fraction or below one", () => {
  for (const scale of [0, -2, 1.9]) {
    const frame = presentationFrame({ mode: "letterbox", scale }, { width: 100, height: 50 });
    deepEqual(frame.canvas, { width: 100, height: 50 }, `scale ${scale} is one`);
  }
  const fallback = presentationFrame({ mode: "letterbox" }, { width: 7, height: 3 });
  deepEqual(fallback.viewport, { x: 0, y: 0, width: 7, height: 3 });
});

test("expand shows the logical frame at 1:1 and leaves the surround black", () => {
  const frame = presentationFrame({ mode: "expand", width: 400, height: 300 }, { width: 320, height: 200 });
  deepEqual(frame.canvas, { width: 400, height: 300 });
  deepEqual(frame.viewport, { x: 40, y: 50, width: 320, height: 200 });
});

test("expand never crops the logical frame when the canvas is smaller", () => {
  const frame = presentationFrame({ mode: "expand", width: 100, height: 60 }, { width: 320, height: 200 });
  deepEqual(frame.canvas, { width: 320, height: 200 });
  deepEqual(frame.viewport, { x: 0, y: 0, width: 320, height: 200 });
});
