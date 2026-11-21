import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { NativeTile, Scene } from "@tk-reawakened/native-data";
import { generateSceneTileCollision } from "../src/scene-tile-collision.ts";

const palette = [{}, { tile: "Tiles/rock.tkrtle" }] as const;
function scene(projection: Scene["projection"], width: number, height: number, floors: Scene["floors"], extra: Partial<Scene> = {}): Scene {
  return { contract: "scene", version: "1.0.0-pre.2", projection, size: { width, height }, floors, tilePalette: palette, ...extra };
}
const tile = (geometry: Pick<NativeTile, "solid" | "under"> = {}): NativeTile => ({
  contract: "tile", version: "1.0.0-pre.1", name: "Rock", projection: "2d", role: "wall",
  visual: { transparent: { mode: "alpha" }, sample: { file: "Tiles/rock.png", rect: [0, 0, 32, 32] } }, ...geometry,
});
const outline = { label: "face", closed: true, points: [[0, 0], [32, 0], [32, 32], [0, 32]] as const };

test("2D solid geometry follows painted cells and skips zero-index cells", () => {
  const result = generateSceneTileCollision(scene("2d", 2, 1, [{ id: "ground", tiles: [[1, 0], [1, 1]] }]), [null, tile({ solid: [outline] })]);
  equal(result.length, 1);
  equal(result[0]?.layer, 1);
  equal(result[0]?.type, 1);
  equal(result[0]?.closed, -1);
  deepEqual(result[0]!.points, [{ x: 32, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }, { x: 32, y: 32 }]);
});

test("under geometry keeps its attributes and type after the solid outlines", () => {
  const under = { label: "lintel", closed: true as const, attributes: 7, points: [[0, 0], [32, 0], [32, 8], [0, 8]] as const };
  const result = generateSceneTileCollision(scene("2d", 1, 1, [{ id: "ground", tiles: [[1, 1]] }]), [null, tile({ solid: [outline], under: [under] })]);
  deepEqual(result.map(({ type, attributes }) => [type, attributes]), [[1, 0], [2, 7]]);
  deepEqual(result[1]?.points, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 8 }, { x: 0, y: 8 }]);
});

test("generated geometry keeps floor then row-major cell order", () => {
  const result = generateSceneTileCollision(scene("2d", 2, 1, [
    { id: "lower", tiles: [[2, 1]] },
    { id: "upper", tiles: [[1, 0], [1, 1]] },
  ]), [null, tile({ solid: [outline] })]);
  deepEqual(result.map((vector) => vector.layer), [1, 1, 2]);
  deepEqual(result.map((vector) => vector.points[0]), [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 0 }]);
});

test("legacy, empty, unpainted and excess cells produce no geometry", () => {
  const withLegacy = scene("2d", 3, 1, [{ id: "ground", tiles: [[1, 0], [1, 1], [1, 2]] }], {
    tilePalette: [{}, { tile: "Tiles/grass.tkrtle" }, { legacy: "old.tst4" }],
    legacy: { excessTiles: [9, 1] },
  });
  deepEqual(generateSceneTileCollision(withLegacy, [null, null, null]), []);
  deepEqual(generateSceneTileCollision(scene("2d", 1, 1, [{ id: "ground" }]), [null, tile({ solid: [outline] })]), []);
});

test("isometric tile geometry and vector-table overflow fail instead of dropping data", () => {
  const solid = tile({ solid: [outline] });
  throws(() => generateSceneTileCollision(scene("iso-stacked", 1, 1, [{ id: "ground", tiles: [[1, 1]] }]), [null, solid]), /Isometric/);
  throws(() => generateSceneTileCollision(scene("2d", 1, 1, [{ id: "ground", tiles: [[1, 1]] }]), [null]), /palette length/);
  const full = scene("2d", 1, 1, [{ id: "ground", tiles: [[1, 1]] }], { vectors: Array.from({ length: 32768 }, () => ({ floor: "ground", type: "none", closed: false, points: [[0, 0], [1, 1]] as const })) });
  throws(() => generateSceneTileCollision(full, [null, solid]), /32768/);
});
