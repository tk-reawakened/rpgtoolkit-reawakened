import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Scene } from "@tk-reawakened/native-data";
import { generateSceneTileCollision, type SceneTileCollisionFlag } from "../src/scene-tile-collision.ts";

const palette = [{}, { tileset: "Tiles/terrain.tkrtile", tile: "rock" }] as const;
function scene(projection: Scene["projection"], width: number, height: number, floors: Scene["floors"], extra: Partial<Scene> = {}): Scene {
  return { contract: "scene", version: "1.0.0-pre.1", projection, size: { width, height }, floors, tilePalette: palette, ...extra };
}
const flags: readonly SceneTileCollisionFlag[] = [null, "solid"];

test("2D solid footprints use 32-by-32 cell bounds and skip zero-index cells", () => {
  const result = generateSceneTileCollision(scene("2d", 2, 1, [{ id: "ground", tiles: [[1, 0], [1, 1]] }]), flags);
  equal(result.length, 1);
  equal(result[0]?.layer, 1);
  equal(result[0]?.type, 1);
  equal(result[0]?.closed, -1);
  deepEqual(result[0]!.points, [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }, { x: 32, y: 32 }]);
});

test("iso-stacked solid footprints use the shared tile-to-board conversion", () => {
  const result = generateSceneTileCollision(scene("iso-stacked", 2, 2, [{ id: "ground", tiles: [[1, 0], [1, 1], [2, 0]] }]), flags);
  equal(result.length, 1);
  deepEqual(result[0]!.points, [{ x: 96, y: -16 }, { x: 128, y: 0 }, { x: 96, y: 16 }, { x: 64, y: 0 }]);
});

test("iso-rotated solid footprints use the effective square grid and board conversion", () => {
  const result = generateSceneTileCollision(scene("iso-rotated", 2, 1, [{ id: "ground", tiles: [[4, 0], [1, 1], [4, 0]] }]), flags);
  equal(result.length, 1);
  deepEqual(result[0]!.points, [{ x: 64, y: 0 }, { x: 96, y: 16 }, { x: 64, y: 32 }, { x: 32, y: 16 }]);
});

test("generated vectors keep floor then row-major cell order", () => {
  const result = generateSceneTileCollision(scene("2d", 2, 1, [
    { id: "lower", tiles: [[2, 1]] },
    { id: "upper", tiles: [[1, 0], [1, 1]] },
  ]), flags);
  deepEqual(result.map((vector) => vector.layer), [1, 1, 2]);
  deepEqual(result.map((vector) => vector.points[0]), [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 0 }]);
});

test("empty, legacy, walkable, and out-of-grid excess cells produce no collision", () => {
  const withLegacy = scene("2d", 3, 1, [{ id: "ground", tiles: [[1, 0], [1, 1], [1, 2]] }], {
    tilePalette: [{}, { tileset: "Tiles/terrain.tkrtile", tile: "grass" }, { legacy: "old.tst4" }],
    legacy: { excessTiles: [9, 1] },
  });
  deepEqual(generateSceneTileCollision(withLegacy, [null, "walkable", null]), []);
  deepEqual(generateSceneTileCollision(scene("2d", 1, 1, [{ id: "ground" }]), [null, "solid"]), []);
});

test("invalid collision flags and vector-table overflow fail instead of dropping data", () => {
  const oneCell = scene("2d", 1, 1, [{ id: "ground", tiles: [[1, 1]] }]);
  throws(() => generateSceneTileCollision(oneCell, [null]), /palette length/);
  throws(() => generateSceneTileCollision(oneCell, [null, "unknown" as SceneTileCollisionFlag]), /tilePalette\[1\]/);
  const full = scene("2d", 1, 1, [{ id: "ground", tiles: [[1, 1]] }], { vectors: Array.from({ length: 32768 }, () => ({ floor: "ground", type: "none", closed: false, points: [[0, 0], [1, 1]] as const })) });
  throws(() => generateSceneTileCollision(full, flags), /32768/);
});
