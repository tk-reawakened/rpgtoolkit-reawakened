// The Shading and Lighting canvas tools as pure functions (docs/spec/formats/board.md#lights, "Shading tools").
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { encodeShade } from "../src/board-document.ts";
import { floodShade, lightNodeAt, newLight, paintShade, rectangleShade, shadeAt, type ShadeBoard } from "../src/index.ts";

/** A 4×3 top-down board whose shading is `values` (r, g, b per cell, row by row). */
function board(values: readonly number[] = new Array<number>(36).fill(0)): ShadeBoard & { readonly layers: number; readonly lut: readonly string[]; readonly tileMatrix: readonly number[] } {
  return {
    sizeX: 4, sizeY: 3, coordType: 0, grid: { width: 4, height: 3 }, layers: 1, lut: [""], tileMatrix: new Array<number>(12).fill(0),
    shadeLayers: [{ castLayer: 1, records: encodeShade(Int32Array.from(values), 12) }],
  };
}

test("Draw and Erase set the named cells on the board and nothing else", () => {
  const painted = paintShade(board(), [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 9, y: 9 }], { r: 64, g: 64, b: 64 });
  ok(painted.ok);
  deepEqual(painted.cells, [{ x: 1, y: 1, r: 64, g: 64, b: 64 }]);
  const erased = paintShade(board(), [{ x: 0, y: 0 }], { r: 0, g: 0, b: 0 });
  ok(erased.ok);
  equal(erased.cells.length, 1);
});

test("Rectangle is an outline in cell numbers, filled when asked", () => {
  const outline = rectangleShade(board(), { x: 0, y: 0 }, { x: 2, y: 2 }, false, { r: 1, g: 2, b: 3 });
  ok(outline.ok);
  equal(outline.cells.length, 8, "the middle cell is left out");
  const filled = rectangleShade(board(), { x: 0, y: 0 }, { x: 2, y: 2 }, true, { r: 1, g: 2, b: 3 });
  ok(filled.ok);
  equal(filled.cells.length, 9);
});

test("Flood replaces the connected area, channel by channel", () => {
  // Left column red=10; the rest zero. Flood from (3,0) with (5,5,5): green and blue fill everywhere, red fills only the zero-red area.
  const values = new Array<number>(36).fill(0);
  for (let y = 0; y < 3; y += 1) values[(y * 4) * 3] = 10;
  const flooded = floodShade(board(values), { x: 3, y: 0 }, { r: 5, g: 5, b: 5 });
  ok(flooded.ok);
  equal(flooded.cells.length, 12);
  const left = flooded.cells.find((cell) => cell.x === 0 && cell.y === 0);
  deepEqual(left, { x: 0, y: 0, r: 10, g: 5, b: 5 }, "red 10 is a different area from red 0");
  const right = flooded.cells.find((cell) => cell.x === 3 && cell.y === 2);
  deepEqual(right, { x: 3, y: 2, r: 5, g: 5, b: 5 });
  deepEqual(floodShade(board(), { x: 1, y: 1 }, { r: 0, g: 0, b: 0 }), { ok: true, cells: [] }, "flooding with the same shade changes nothing");
});

test("a board with two shading layers is refused, and the Dropper reads a cell's shade", () => {
  const two = { ...board(), shadeLayers: [{ castLayer: 1, records: [] }, { castLayer: 2, records: [] }] };
  equal(paintShade(two, [{ x: 0, y: 0 }], { r: 1, g: 1, b: 1 }).ok, false);
  const values = new Array<number>(36).fill(0);
  values.splice(3 * 5, 3, 9, 8, 7);
  deepEqual(shadeAt(board(values), { x: 1, y: 1 }), { r: 9, g: 8, b: 7 });
  deepEqual(shadeAt(board(), { x: 9, y: 9 }), { r: 0, g: 0, b: 0 });
});

test("the pointer finds the nearest light node within its radius", () => {
  const lights = [newLight(0, { x: 100, y: 100 }, { r: 0, g: 0, b: 0 }), newLight(1, { x: 300, y: 40 }, { r: 0, g: 0, b: 0 })];
  deepEqual(lightNodeAt(lights, { x: 104, y: 98 }, 8), { light: 0, node: 1 });
  deepEqual(lightNodeAt(lights, { x: 310, y: 40 }, 8), null);
  deepEqual(lightNodeAt(lights, { x: 460, y: 40 }, 8), { light: 1, node: 1 });
});
