import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { checkSceneTerrainFields, type SceneTerrainRegion, type SceneTileOverride } from "../src/scene-terrain.ts";

const floors = new Set(["ground", "roof"]);
const region: SceneTerrainRegion = {
  id: "grass",
  floor: "ground",
  terrain: { tileset: "tiles/field.tkrtst", terrain: "grass" },
  coverage: { shape: "tile-grid", spans: [[0, 0, 2], [0, 1, 3], [1, 2, 1]] },
};
const override: SceneTileOverride = { id: "empty-slot", floor: "roof", cell: [3, 2], tile: {} };

test("accepts valid terrain spans, native paths, and an explicit empty override without registration", () => {
  deepEqual(checkSceneTerrainFields({ terrainRegions: [region], tileOverrides: [override] }, floors, 4, 3), []);
});

test("checks closed mappings, ids, floor names, paths, cells, span order and overlap", () => {
  const problems = checkSceneTerrainFields({
    terrainRegions: [
      { ...region, extra: true },
      { ...region, id: "grass", floor: "missing", terrain: { tileset: "../field.tkrscn", terrain: "Bad_ID" }, coverage: { shape: "tile-grid", spans: [[2, 0, 2], [3, 0, 1], [0, 0, 1]] } },
    ],
    tileOverrides: [
      { floor: "ground", cell: [1, 1], tile: { tile: "tiles/one.tkrscn" } },
      { floor: "ground", cell: [1, 1], tile: { legacy: "village.tst1", tile: "tiles/one.tkr tle" } },
      { floor: "ground", cell: [4, 0], tile: {} },
    ],
  }, floors, 4, 3);
  const messages = problems.map((item) => item.message);
  equal(messages.some((message) => message.includes("not a key")), true);
  equal(messages.some((message) => message.includes("already the id")), true);
  equal(messages.some((message) => message.includes("names no floor")), true);
  equal(messages.some((message) => message.includes("safe project-relative")), true);
  equal(messages.some((message) => message.includes("lowercase kebab-case")), true);
  equal(messages.some((message) => message.includes("sorted by row")), true);
  equal(messages.some((message) => message.includes("must not overlap")), true);
  equal(messages.some((message) => message.includes("already names this floor and cell")), true);
  equal(messages.some((message) => message.includes("both native and legacy")), true);
  equal(messages.some((message) => message.includes("outside the effective grid width")), true);
});

test("checks span boundaries only when effective dimensions are known", () => {
  deepEqual(checkSceneTerrainFields({ terrainRegions: [region], tileOverrides: [override] }, null, null, null), []);
  const problems = checkSceneTerrainFields({ terrainRegions: [{ ...region, coverage: { shape: "tile-grid", spans: [[3, 0, 2]] } }] }, floors, 4, 3);
  equal(problems.some((item) => item.message.includes("stay within its row")), true);
});
