// Board coordinates for the canvas (docs/editor-features.md, "Reawakened rules for the P0 board canvas and tile tools"):
// every layout snaps a pixel to the cell the engine calls the same tile, and neighbours are the cells that share an edge.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { boardGrid } from "@tk-reawakened/core";
import {
  ZOOM_STEPS,
  boardExtent,
  cellCentre,
  cellNeighbours,
  cellOnBoard,
  cellOutline,
  cellsInRect,
  clampViewport,
  pixelToCell,
  revealCell,
  screenToBoard,
  boardToScreen,
  zoomTo,
  type BoardShape,
  type Viewport,
} from "../src/index.ts";

const TOP_DOWN: BoardShape = { sizeX: 5, sizeY: 4, coordType: 0 };
const STACKED: BoardShape = { sizeX: 4, sizeY: 6, coordType: 1 };
const ROTATED: BoardShape = { sizeX: 4, sizeY: 3, coordType: 2 };
/** The pixel-coordinates flag changes no tile geometry. */
const ROTATED_PIXELS: BoardShape = { sizeX: 4, sizeY: 3, coordType: 6 };
const ALL: readonly (readonly [string, BoardShape])[] = [
  ["top-down", TOP_DOWN],
  ["iso-stacked", STACKED],
  ["iso-rotated", ROTATED],
  ["iso-rotated with pixel coordinates", ROTATED_PIXELS],
];

function onBoardCells(shape: BoardShape): { x: number; y: number }[] {
  const grid = boardGrid(shape.sizeX, shape.sizeY, shape.coordType);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) if (cellOnBoard(shape, x, y)) cells.push({ x, y });
  return cells;
}

test("the board's pixel size is the layout's own (board.md#board-pixel-dimensions)", () => {
  deepEqual(boardExtent(TOP_DOWN), { width: 160, height: 128 });
  deepEqual(boardExtent(STACKED), { width: 224, height: 80 });
  deepEqual(boardExtent(ROTATED), { width: 224, height: 96 });
});

test("a top-down pixel snaps by floor(px / 32) and a pixel off the board names no cell", () => {
  deepEqual(pixelToCell(TOP_DOWN, 0, 0), { x: 0, y: 0 });
  deepEqual(pixelToCell(TOP_DOWN, 31, 31), { x: 0, y: 0 });
  deepEqual(pixelToCell(TOP_DOWN, 32, 63), { x: 1, y: 1 });
  deepEqual(pixelToCell(TOP_DOWN, 159, 127), { x: 4, y: 3 });
  equal(pixelToCell(TOP_DOWN, 160, 0), null);
  equal(pixelToCell(TOP_DOWN, 0, 128), null);
  equal(pixelToCell(TOP_DOWN, -1, 5), null);
  equal(pixelToCell(TOP_DOWN, Number.NaN, 5), null);
});

for (const [name, shape] of ALL) {
  test(`${name}: the centre of every on-board cell snaps back to that cell`, () => {
    const cells = onBoardCells(shape);
    ok(cells.length > 0);
    for (const cell of cells) {
      const centre = cellCentre(shape, cell.x, cell.y);
      deepEqual(pixelToCell(shape, centre.x, centre.y), cell, `cell ${cell.x},${cell.y} at ${centre.x},${centre.y}`);
    }
  });

  test(`${name}: neighbours share an edge on the picture and are on the board`, () => {
    for (const cell of onBoardCells(shape)) {
      const here = cellCentre(shape, cell.x, cell.y);
      const neighbours = cellNeighbours(shape, cell.x, cell.y);
      ok(neighbours.length <= 4);
      for (const next of neighbours) {
        ok(cellOnBoard(shape, next.x, next.y));
        const there = cellCentre(shape, next.x, next.y);
        const dx = Math.abs(there.x - here.x);
        const dy = Math.abs(there.y - here.y);
        // A top-down neighbour is a whole tile away; an isometric one is half a diamond across and a quarter of a tile down.
        const expected = shape.coordType === 0 ? [[32, 0], [0, 32]] : [[32, 16]];
        ok(expected.some(([ex, ey]) => ex === dx && ey === dy), `${cell.x},${cell.y} to ${next.x},${next.y} is ${dx},${dy}`);
      }
      // Neighbourhood is symmetric.
      for (const next of neighbours) ok(cellNeighbours(shape, next.x, next.y).some((back) => back.x === cell.x && back.y === cell.y));
    }
  });

  test(`${name}: an outline has four corners around the centre`, () => {
    const cell = onBoardCells(shape)[0]!;
    const outline = cellOutline(shape, cell.x, cell.y);
    equal(outline.length, 4);
    const centre = cellCentre(shape, cell.x, cell.y);
    equal(outline.reduce((sum, corner) => sum + corner.x, 0) / 4, centre.x);
    equal(outline.reduce((sum, corner) => sum + corner.y, 0) / 4, centre.y);
  });
}

test("an iso-stacked interior cell has the four staggered neighbours the rules name", () => {
  // Even stored row: (x, y±1) and (x+1, y±1); odd stored row: (x−1, y±1) and (x, y±1).
  deepEqual(cellNeighbours(STACKED, 1, 2), [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 3 }]);
  deepEqual(cellNeighbours(STACKED, 1, 3), [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 4 }, { x: 1, y: 4 }]);
});

test("an iso-rotated board stores a square grid of which only the cells inside the picture are on the board", () => {
  const grid = boardGrid(ROTATED.sizeX, ROTATED.sizeY, ROTATED.coordType);
  equal(grid.width, 7);
  equal(grid.height, 7);
  const on = onBoardCells(ROTATED).length;
  ok(on > 0 && on < 49, `${on} of 49 cells are on the board`);
  equal(cellOnBoard(ROTATED, 0, 6), false);
  equal(pixelToCell(ROTATED, -100, -100), null);
  equal(cellOnBoard(ROTATED, 7, 0), false);
  equal(cellOnBoard(ROTATED, 0.5, 0), false);
});

const VIEW: Viewport = { x: 0, y: 0, zoomIndex: 2, width: 100, height: 100 };

test("a view smaller than the board cannot scroll past its edges and a larger one centres the board", () => {
  deepEqual(clampViewport(TOP_DOWN, { ...VIEW, x: 500, y: 500 }), { ...VIEW, x: 60, y: 28 });
  deepEqual(clampViewport(TOP_DOWN, { ...VIEW, x: -50, y: -50 }), { ...VIEW, x: 0, y: 0 });
  const big = clampViewport(TOP_DOWN, { ...VIEW, width: 400, height: 300, x: 7, y: 9 });
  deepEqual([big.x, big.y], [-120, -86]);
});

test("zoom steps are fixed and zooming keeps the board pixel under the pointer where it is", () => {
  deepEqual([...ZOOM_STEPS], [0.25, 0.5, 1, 2, 4, 8]);
  const wide: BoardShape = { sizeX: 50, sizeY: 50, coordType: 0 };
  const start: Viewport = { x: 400, y: 300, zoomIndex: 2, width: 200, height: 200 };
  const focus = { x: 50, y: 80 };
  const under = screenToBoard(start, focus.x, focus.y);
  const zoomed = zoomTo(wide, start, 3, focus);
  equal(zoomed.zoomIndex, 3);
  deepEqual(screenToBoard(zoomed, focus.x, focus.y), under);
  deepEqual(boardToScreen(zoomed, under.x, under.y), focus);
  equal(zoomTo(wide, start, 99).zoomIndex, 5);
  equal(zoomTo(wide, start, -3).zoomIndex, 0);
});

test("revealing a cell scrolls only as far as it needs", () => {
  const wide: BoardShape = { sizeX: 50, sizeY: 50, coordType: 0 };
  const view: Viewport = { x: 0, y: 0, zoomIndex: 2, width: 200, height: 200 };
  deepEqual(revealCell(wide, view, 1, 1), view);
  const moved = revealCell(wide, view, 20, 0);
  ok(moved.x > 0);
  equal(moved.y, 0);
  const centre = cellCentre(wide, 20, 0);
  ok(centre.x >= moved.x && centre.x <= moved.x + 200);
});

for (const [name, shape] of ALL) {
  test(`${name}: the cells found for a rectangle include every on-board cell whose centre is inside it and nothing off the board`, () => {
    const extent = boardExtent(shape);
    for (const [left, top, right, bottom] of [
      [0, 0, extent.width, extent.height],
      [40, 20, 130, 70],
      [-50, -50, 20, 20],
      [extent.width - 30, extent.height - 30, extent.width + 90, extent.height + 90],
    ] as const) {
      const found = new Set(cellsInRect(shape, left, top, right, bottom).map((cell) => `${cell.x},${cell.y}`));
      for (const cell of onBoardCells(shape)) {
        const centre = cellCentre(shape, cell.x, cell.y);
        if (centre.x >= left && centre.x < right && centre.y >= top && centre.y < bottom) ok(found.has(`${cell.x},${cell.y}`), `${cell.x},${cell.y} for ${left},${top},${right},${bottom}`);
      }
      for (const key of found) {
        const [x, y] = key.split(",").map(Number) as [number, number];
        ok(cellOnBoard(shape, x, y));
      }
      equal(found.size, cellsInRect(shape, left, top, right, bottom).length, "no cell twice");
    }
  });
}
