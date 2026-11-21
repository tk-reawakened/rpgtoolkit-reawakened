import { deepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { resolveSceneTerrain, type TerrainScene } from "../src/scene-terrain.ts";

const lake = { floor: "ground", terrain: { tileset: "Tiles/Pond.tkrtst", terrain: "water" }, coverage: { shape: "tile-grid", spans: [[0, 0, 5]] } } as const;
const scene = { projection: "2d", size: { width: 7, height: 2 }, floors: [{ id: "ground", tiles: [[14, 1]] }, { id: "roof" }] } as const;

void test("a later region hides terrain without clipping it, and an empty override survives reshaping", () => {
  const bank = { floor: "ground", terrain: { tileset: "Tiles/Bank.tkrtst", terrain: "water" }, coverage: { shape: "tile-grid", spans: [[2, 0, 2]] } } as const;
  const spill = { ...lake, terrain: { tileset: "tiles/./pond.tkrtst", terrain: "water" }, coverage: { shape: "tile-grid", spans: [[5, 0, 1]] } } as const;
  const tileOverrides = [{ floor: "ground", cell: [3, 0], tile: {} }] as const;
  function ground(regions: NonNullable<TerrainScene["terrainRegions"]>) {
    const result = resolveSceneTerrain({ ...scene, terrainRegions: regions, tileOverrides }, ({ tileset }) => ({
      neighbours: "cardinal-4", coverage: "complete",
      rules: tileset.includes("Bank") ? [{ id: "bank", when: {}, use: { tile: "bank.tkrtle" } }] : [
        { id: "east", when: { e: "same" }, use: { tile: "water.tkrtle" } },
        { id: "edge", when: { e: "other" }, use: { tile: "edge.tkrtle" } },
      ],
    }));
    ok(result.ok);
    const ground = result.floors.get("ground");
    ok(ground);
    return Array.from({ length: 7 }, (_, i) => ground.get(i)?.tile);
  }
  const water = { tile: "water.tkrtle" }, edge = { tile: "edge.tkrtle" };
  deepEqual(ground([lake, spill, bank]), [water, edge, { tile: "bank.tkrtle" }, {}, water, edge, undefined]);
  deepEqual(ground([lake, spill, { ...bank, coverage: { ...bank.coverage, spans: [] } }]), [water, water, water, {}, water, edge, undefined]);
  deepEqual(ground([spill]), [undefined, undefined, undefined, {}, undefined, edge, undefined]);
});

void test("an explicitly empty tile suppresses a missing match without changing its neighbour", () => {
  const terrainRegions = [{ ...lake, coverage: { ...lake.coverage, spans: [[0, 0, 2]] } }] as const;
  const picked = () => ({ neighbours: "cardinal-4", coverage: "partial", rules: [
    { id: "east", when: { e: "same" }, use: { tile: "water.tkrtle" } },
  ] } as const);
  const without = resolveSceneTerrain({ ...scene, terrainRegions }, picked);
  ok(!without.ok);
  deepEqual(without.problems, [{ code: "terrain-pattern-uncovered", path: "terrainRegions[0]", message: "No tile rule matches ground at (1, 0)." }]);
  const withOverride = resolveSceneTerrain({ ...scene, terrainRegions, tileOverrides: [{ floor: "ground", cell: [1, 0], tile: {} }] }, picked);
  ok(withOverride.ok);
  deepEqual(withOverride.floors.get("ground")?.get(0)?.tile, { tile: "water.tkrtle" });
  deepEqual(withOverride.floors.get("ground")?.get(1)?.tile, {});
  deepEqual(withOverride.notes, [{ code: "terrain-pattern-uncovered", path: "terrainRegions[0].terrain", message: "8 neighbourhood patterns have no rule." }]);
});

void test("the outside policy uses the rotated effective grid, not neighbors on another floor", () => {
  const result = resolveSceneTerrain({
    projection: "iso-rotated", size: { width: 2, height: 1 }, floors: [{ id: "ground" }, { id: "roof" }],
    terrainRegions: [
      { ...lake, coverage: { ...lake.coverage, spans: [[2, 0, 1], [1, 2, 1]] } },
      { ...lake, floor: "roof", coverage: { ...lake.coverage, spans: [[2, 2, 1]] } },
    ],
  }, () => ({ neighbours: "cardinal-4", coverage: "complete", outside: "same", rules: [
    { id: "east", when: { e: "same" }, use: { tile: "continued.tkrtle" } },
    { id: "edge", when: { e: "other" }, use: { tile: "edge.tkrtle" } },
  ] }));
  ok(result.ok);
  deepEqual(result.floors.get("ground")?.get(2)?.tile, { tile: "continued.tkrtle" });
  deepEqual(result.floors.get("ground")?.get(7)?.tile, { tile: "edge.tkrtle" });
  deepEqual(result.floors.get("roof")?.get(8)?.tile, { tile: "continued.tkrtle" });
});
