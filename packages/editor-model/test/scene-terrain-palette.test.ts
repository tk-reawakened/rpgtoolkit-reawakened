import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { lowerSceneTerrainPalette, type TerrainPaletteCell } from "../src/scene-terrain-palette.ts";

const scene = {
  projection: "2d",
  size: { width: 4, height: 2 },
  floors: [{ id: "ground", tiles: [[2, 1], [6, 0]] }, { id: "roof" }],
  tilePalette: [{}, { tile: "Tiles/./grass.tkrtle" }, { legacy: "water.tan" }],
} as const;
const cell = (tile: TerrainPaletteCell["tile"], path: string): TerrainPaletteCell => ({ tile, path });

void test("resolved cells preserve base slots and allocate references by floor-row-column first use", () => {
  const result = lowerSceneTerrainPalette(scene, new Map([
    ["ground", new Map([[1, cell({ legacy: "new.tan" }, "tileOverrides[0]")], [2, cell({ tile: "tiles/grass.tkrtle" }, "tileOverrides[1]")], [7, cell({}, "tileOverrides[2]")]])],
    ["roof", new Map([[0, cell({ tile: "wall.tkrtle" }, "tileOverrides[3]")], [1, cell({ legacy: "new.tan" }, "tileOverrides[4]")]])],
  ]));
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  deepEqual(result.palette, [{}, { tile: "Tiles/./grass.tkrtle" }, { legacy: "water.tan" }, { legacy: "new.tan" }, { tile: "wall.tkrtle" }]);
  deepEqual(result.floors, [
    { id: "ground", tiles: [[1, 1], [1, 3], [1, 1], [5, 0]] },
    { id: "roof", tiles: [[1, 4], [1, 3], [6, 0]] },
  ]);
});

void test("absent palette stays absent until a non-empty resolved tile is needed", () => {
  const empty = lowerSceneTerrainPalette({ projection: "2d", size: { width: 2, height: 1 }, floors: [{ id: "ground" }] }, new Map([
    ["ground", new Map([[0, cell({}, "tileOverrides[0]")]])],
  ]));
  if (!empty.ok) throw new Error(JSON.stringify(empty.problems));
  equal(empty.palette, null);
  deepEqual(empty.floors, [{ id: "ground", tiles: [[2, 0]] }]);

  const generated = lowerSceneTerrainPalette({ projection: "2d", size: { width: 2, height: 1 }, floors: [{ id: "ground" }] }, new Map([
    ["ground", new Map([[0, cell({ legacy: "water.tan" }, "tileOverrides[0]")]])],
  ]));
  if (!generated.ok) throw new Error(JSON.stringify(generated.problems));
  deepEqual(generated.palette, [{}, { legacy: "water.tan" }]);
});

void test("refuses a resolved last-cell index that differs from legacy excess tiles", () => {
  const result = lowerSceneTerrainPalette({
    projection: "2d", size: { width: 2, height: 1 }, floors: [{ id: "ground" }],
    tilePalette: [{}, { legacy: "base.tan" }], legacy: { excessTiles: [1, 1] },
  }, new Map([["ground", new Map([[1, cell({ legacy: "override.tan" }, "tileOverrides[0]")]])]]));
  if (result.ok) throw new Error("Expected the overshoot mismatch to refuse.");
  deepEqual(result.problems, [{ code: "terrain-excess-tiles-mismatch", path: "legacy.excessTiles", message: "The excess tile index must match the resolved last cell's palette index." }]);
});

void test("locates palette overflow at the first new resolved reference", () => {
  const tilePalette = Array.from({ length: 32_768 }, (_, index) => index === 0 ? {} as const : { legacy: `slot-${index}` } as const);
  const result = lowerSceneTerrainPalette({
    projection: "2d", size: { width: 1, height: 1 }, floors: [{ id: "ground" }], tilePalette,
  }, new Map([["ground", new Map([[0, cell({ legacy: "new.tan" }, "terrainRegions[2]")]])]]));
  if (result.ok) throw new Error("Expected palette overflow to refuse.");
  deepEqual(result.problems, [{ code: "terrain-palette-overflow", path: "terrainRegions[2]", message: "The resolved tile exceeds the board's 32768-slot tile palette limit." }]);
});
