// Native terrain roles (story 8, T-25): the rule situations a native terrain covers, reported from the built-in matcher's
// own reduction, and the authored arrangements the existing scene provider resolves from them. Native roles are rules,
// not the legacy 52-slot order of docs/spec/editor/autotiling.md.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readTileset } from "@tk-reawakened/native-data";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { loadTerrainSceneProjectInventory } from "../src/terrain-scene-project.ts";
import { inspectTerrainRoles, terrainSceneAssets, terrainSceneTilesets } from "../src/index.ts";
import { resolveSceneTerrain, type TerrainScene } from "../src/scene-terrain.ts";
import type { TerrainRecipe } from "../src/terrain-matcher.ts";

const letters = (n: boolean, e: boolean, s: boolean, w: boolean): string => `${n ? "n" : ""}${e ? "e" : ""}${s ? "s" : ""}${w ? "w" : ""}` || "none";

/** All sixteen four-neighbour situations, each with its own tile named for the sides that hold the same terrain. */
function everySituation(): TerrainRecipe {
  const rules: TerrainRecipe["rules"][number][] = [];
  for (let mask = 0; mask < 16; mask += 1) {
    const [n, e, s, w] = [1, 2, 4, 8].map((bit) => (mask & bit) !== 0) as [boolean, boolean, boolean, boolean];
    const name = letters(n, e, s, w);
    rules.push({ id: `r-${name}`, when: { n: n ? "same" : "other", e: e ? "same" : "other", s: s ? "same" : "other", w: w ? "same" : "other" }, use: { tile: `t-${name}.tkrtle` } });
  }
  return { neighbours: "cardinal-4", coverage: "complete", rules };
}

const pond = { floor: "ground", terrain: { tileset: "Tiles/Pond.tkrtst", terrain: "water" }, coverage: { shape: "tile-grid", spans: [[0, 0, 3], [0, 1, 3]] } } as const;
const scene: TerrainScene = { projection: "2d", size: { width: 6, height: 4 }, floors: [{ id: "ground" }] };

function resolved(terrainRegions: NonNullable<TerrainScene["terrainRegions"]>, tileOverrides: NonNullable<TerrainScene["tileOverrides"]> = [], recipe = everySituation()): (number | string)[][] {
  const result = resolveSceneTerrain({ ...scene, terrainRegions, tileOverrides }, () => recipe);
  ok(result.ok, JSON.stringify(result));
  const floor = result.floors.get("ground")!;
  return Array.from({ length: 4 }, (_, y) => Array.from({ length: 6 }, (_, x) => {
    const cell = floor.get(y * 6 + x)?.tile;
    return cell === undefined ? "." : "tile" in cell && cell.tile !== undefined ? cell.tile.replace(".tkrtle", "") : "empty";
  }));
}

test("a complete native terrain reports every neighbourhood covered once, and its rules resolve the authored arrangement", () => {
  const report = inspectTerrainRoles(everySituation());
  equal(report.situations, 16);
  deepEqual(report.missing, []);
  deepEqual(report.problems, []);
  ok(report.rules.every((rule) => rule.situations === 1 && rule.tiles.length === 1));
  equal(report.rules.find((rule) => rule.id === "r-es")?.when, "n other, e same, s same, w other");
  // A 3 × 2 pond: the expected tile is read from which sides touch the same terrain.
  deepEqual(resolved([pond]), [
    ["t-es", "t-esw", "t-sw", ".", ".", "."],
    ["t-ne", "t-new", "t-nw", ".", ".", "."],
    [".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", "."],
  ]);
});

test("a partial native terrain names the neighbourhoods with no tile, and painting one is a located error", () => {
  const partial: TerrainRecipe = { neighbours: "cardinal-4", coverage: "partial", rules: [{ id: "east", when: { e: "same" }, use: { tile: "water.tkrtle" } }] };
  const report = inspectTerrainRoles(partial);
  equal(report.situations, 16);
  deepEqual(report.missing, ["isolated", "n", "s", "n+s", "w", "n+w", "s+w", "n+s+w"]);
  deepEqual(report.problems, []);
  equal(report.rules[0]!.situations, 8);
  const built = resolveSceneTerrain({ ...scene, terrainRegions: [{ ...pond, coverage: { shape: "tile-grid", spans: [[0, 0, 2]] } }] }, () => partial);
  ok(!built.ok);
  equal(built.problems[0]!.message, "No tile rule matches ground at (1, 0).", "the cell with only its west neighbour is the reported 'w'");
});

test("a complete recipe with a gap, an overlap or an impossible rule is described the way the matcher refuses it", () => {
  const report = inspectTerrainRoles({ neighbours: "cardinal-4", coverage: "complete", rules: [
    { id: "no-east", when: { e: "other" }, use: { tile: "edge.tkrtle" } },
    { id: "no-north", when: { n: "other" }, use: { tile: "edge.tkrtle" } },
    { id: "diagonal", when: { ne: "other" }, use: { tile: "corner.tkrtle" } },
  ] });
  deepEqual(report.problems, [
    "Rules no-east and no-north both match isolated.",
    "Rules no-east and no-north both match s.",
    "Rules no-east and no-north both match w.",
    "Rules no-east and no-north both match s+w.",
    "Rule diagonal cannot match any neighbourhood.",
    "4 neighbourhood patterns have no rule, and the recipe says it is complete.",
  ]);
  equal(report.rules.find((rule) => rule.id === "diagonal")?.situations, 0);
  deepEqual(report.missing, ["n+e", "n+e+s", "n+e+w", "n+e+s+w"], "the four situations with north and east both same hold no rule");
});

test("blob-8 has 47 situations because a corner needs both of its sides, and weighted rules list every tile they may choose", () => {
  const report = inspectTerrainRoles({ neighbours: "blob-8", coverage: "complete", rules: [
    { id: "any", when: {}, variants: [{ tile: "plain.tkrtle", weight: 3 }, { tile: "ripple.tkrtle", weight: 1 }] },
  ] });
  equal(report.situations, 47);
  deepEqual(report.missing, []);
  deepEqual(report.rules, [{ id: "any", when: "any neighbourhood", tiles: ["plain.tkrtle", "ripple.tkrtle"], situations: 47 }]);
});

test("adding a neighbouring region re-evaluates the boundary, keeps manual overrides and other cells, and removing it restores the arrangement", () => {
  const before = resolved([pond], [{ floor: "ground", cell: [0, 0], tile: {} }]);
  const island = { ...pond, coverage: { shape: "tile-grid", spans: [[3, 0, 1], [3, 1, 1]] } } as const;
  const after = resolved([pond, island], [{ floor: "ground", cell: [0, 0], tile: {} }]);
  deepEqual(after, [
    ["empty", "t-esw", "t-esw", "t-sw", ".", "."],
    ["t-ne", "t-new", "t-new", "t-nw", ".", "."],
    [".", ".", ".", ".", ".", "."],
    [".", ".", ".", ".", ".", "."],
  ]);
  deepEqual(after[1]!.slice(0, 2), before[1]!.slice(0, 2), "cells away from the new edge keep their tile");
  equal(after[0]![1], before[0]![1], "the neighbour of an override is untouched");
  equal(after[0]![0], "empty", "an explicit empty override survives the reshape");
  equal(before[0]![0], "empty");
  deepEqual(resolved([pond, { ...island, coverage: { ...island.coverage, spans: [] } }], [{ floor: "ground", cell: [0, 0], tile: {} }]), before);
});

test("the scene view's terrain list comes from the tileset's own recipes", () => {
  const read = readTileset(`contract: tileset
version: 1.0.0-pre.2
name: Pond
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: Tiles/water.tkrtle}]
terrains:
  - id: water
    name: Water
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules:
      - {id: east, when: {e: same}, use: {tile: Tiles/water.tkrtle}}
outputBinding: {target: Tiles/pond.tst, detail: 1, slots: [{slot: 1, tile: Tiles/water.tkrtle}]}
`);
  ok(read.ok, JSON.stringify(read));
  const [entry] = terrainSceneTilesets(new Map([["Tiles/Pond.tkrtst", read.tileset]]));
  equal(entry?.path, "Tiles/Pond.tkrtst");
  equal(entry?.terrains[0]?.label, "Water");
  equal(entry?.terrains[0]?.roles.missing.length, 8);
  deepEqual(entry?.terrains[0]?.roles.rules.map(({ id, tiles }) => [id, tiles]), [["east", ["Tiles/water.tkrtle"]]]);
});

test("a tileset's revision follows the whole recipe, not only the roles it reports", () => {
  const text = (extra: string, weight: number): string => `contract: tileset
version: 1.0.0-pre.2
name: Pond
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: Tiles/water.tkrtle}, {tile: Tiles/lily.tkrtle}]
terrains:
  - id: water
    name: Water
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: complete
    sync: independent
${extra}    rules: [{id: any, when: {}, variants: [{tile: Tiles/water.tkrtle, weight: ${weight}}, {tile: Tiles/lily.tkrtle, weight: 1}]}]
outputBinding: {target: Tiles/pond.tst, detail: 1, slots: [{slot: 1, tile: Tiles/water.tkrtle}, {slot: 2, tile: Tiles/lily.tkrtle}]}
`;
  const revisionOf = (source: string): string => {
    const read = readTileset(source);
    ok(read.ok, JSON.stringify(read));
    const [entry] = terrainSceneTilesets(new Map([["Tiles/Pond.tkrtst", read.tileset]]));
    return entry!.revision;
  };
  const base = revisionOf(text("", 3));
  equal(revisionOf(text("", 3)), base, "an identical read has the same revision");
  ok(revisionOf(text("    outside: same\n", 3)) !== base, "only the outside policy changed");
  ok(revisionOf(text("    seed: 7\n", 3)) !== base, "only the seed changed");
  ok(revisionOf(text("", 5)) !== base, "only a variant weight changed");
});
test("a tileset's preview revision follows its referenced tile documents and sampled source bytes", async () => {
  const recipe = `contract: tileset
version: 1.0.0-pre.2
name: Pond
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: Tiles/water.tkrtle}]
terrains:
  - id: water
    name: Water
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules: [{id: east, when: {e: same}, use: {tile: Tiles/water.tkrtle}}]
outputBinding: {target: Tiles/pond.tst, detail: 1, slots: [{slot: 1, tile: Tiles/water.tkrtle}]}
`;
  const usedScene = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors:
  - id: ground
    tiles: [[1, 1]]
tilePalette: [{}, {}]
terrainRegions:
  - id: water
    floor: ground
    terrain: {tileset: Tiles/Pond.tkrtst, terrain: water}
    coverage: {shape: tile-grid, spans: [[0, 0, 1]]}
`;
  const emptyScene = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors:
  - id: ground
    tiles: [[1, 1]]
tilePalette: [{}, {}]
`;
  const load = (name: string, rectX: number, image: Uint8Array | null = new Uint8Array([1, 2, 3]), sceneText: string = usedScene) => {
    const files: Record<string, Uint8Array> = {
      "Tiles/Pond.tkrtst": new TextEncoder().encode(recipe),
      "Tiles/water.tkrtle": new TextEncoder().encode(JSON.stringify({
        contract: "tile", version: "1.0.0-pre.1", name, projection: "2d", role: "floor",
        visual: { transparent: { mode: "alpha" }, sample: { file: "Bitmap/water.bin", rect: [rectX, 0, 32, 32] } },
      })),
    };
    if (image !== null) files["Bitmap/water.bin"] = image;
    const storage = createMemoryPlatformServices({ files });
    return loadTerrainSceneProjectInventory(storage.fs, "Boards/pond.tkrscn", sceneText);
  };
  const initial = await load("Water", 0);
  ok(initial.ok, JSON.stringify(initial));
  const base = terrainSceneAssets(initial).tilesets[0]!.revision;
  const same = await load("Water", 0);
  ok(same.ok, JSON.stringify(same));
  equal(terrainSceneAssets(same).tilesets[0]!.revision, base);
  const changedTile = await load("Updated water", 0);
  ok(changedTile.ok, JSON.stringify(changedTile));
  ok(terrainSceneAssets(changedTile).tilesets[0]!.revision !== base, "a tile document edit invalidates the recipe preview");
  const changedCrop = await load("Water", 1);
  ok(changedCrop.ok, JSON.stringify(changedCrop));
  ok(terrainSceneAssets(changedCrop).tilesets[0]!.revision !== base, "the sample crop x coordinate invalidates the recipe preview");
  const changedSource = await load("Water", 0, new Uint8Array([1, 2, 4]));
  ok(changedSource.ok, JSON.stringify(changedSource));
  ok(terrainSceneAssets(changedSource).tilesets[0]!.revision !== base, "sample bytes changing at the same path invalidates the recipe preview");
  const unrelatedMissingSource = await load("Water", 0, null, emptyScene);
  ok(unrelatedMissingSource.ok, JSON.stringify(unrelatedMissingSource));
  ok(terrainSceneAssets(unrelatedMissingSource).tilesets.length > 0, "an unused tileset's missing sample does not prevent scene inventory");
  const missingSource = await load("Water", 0, null);
  ok(!missingSource.ok);
  deepEqual(terrainSceneAssets(missingSource).tilesets, [], "a broken current inventory clears prior roles and recipe previews");
});
test("a failed inventory read clears the roles and says why, so older rules are never kept as current", () => {
  const cleared = terrainSceneAssets({ ok: false, problems: [{ path: "Tiles/pond.tkrtst", message: "rules[0] must name a palette member" }] });
  deepEqual(cleared.tilesets, []);
  deepEqual(cleared.assetTiles, []);
  deepEqual(cleared.problems, ["Tiles/pond.tkrtst: rules[0] must name a palette member"]);
});
test("scene inventory classifies every build tile-owner route and ignores ambiguous owners", async () => {
  const tileset = (name: string): string => `contract: tileset
version: 1.0.0-pre.2
name: ${name}
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: Tiles/water.tkrtle}]
terrains:
  - id: water
    name: Water
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules: [{id: east, when: {e: same}, use: {tile: Tiles/water.tkrtle}}]
outputBinding: {target: Tiles/${name}.tst, detail: 1, slots: [{slot: 1, tile: Tiles/water.tkrtle}]}
`;
  const tile = JSON.stringify({
    contract: "tile", version: "1.0.0-pre.1", name: "Water", projection: "2d", role: "floor",
    visual: { transparent: { mode: "alpha" }, sample: { file: "Bitmap/missing.bin", rect: [0, 0, 32, 32] } },
  });
  const files = {
    "Tiles/one.tkrtst": new TextEncoder().encode(tileset("One")),
    "Tiles/water.tkrtle": new TextEncoder().encode(tile),
  };
  const scenes = [
    ["tilePalette", `[{id: ground}]`, `tilePalette: [{}, {tile: Tiles/water.tkrtle}]`],
    ["tileOverrides", `[{id: ground}]`, `tileOverrides: [{floor: ground, cell: [0, 0], tile: {tile: Tiles/water.tkrtle}}]`],
    ["walkableTiles", `[{id: ground, boundarySources: {walkableTiles: [{tile: Tiles/water.tkrtle}]}}]`, ""],
  ] as const;
  for (const [route, floors, source] of scenes) {
    const storage = createMemoryPlatformServices({ files });
    const text = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: ${floors}
${source}
`;
    const result = await loadTerrainSceneProjectInventory(storage.fs, "Boards/pond.tkrscn", text);
    ok(!result.ok, `${route} makes the referenced tileset's missing artwork blocking`);
    if (!result.ok) ok(result.problems.some(({ path }) => path === "Bitmap/missing.bin"), `${route} failed for missing artwork`);
  }

  const unusedStorage = createMemoryPlatformServices({ files });
  const unused = await loadTerrainSceneProjectInventory(unusedStorage.fs, "Boards/pond.tkrscn", `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
`);
  ok(unused.ok, "an unused tileset's missing artwork remains nonblocking");
  if (unused.ok) equal(unused.tilesets.size, 1, "the tileset was successfully inventoried");

  const duplicateStorage = createMemoryPlatformServices({ files: {
    ...files,
    "Tiles/two.tkrtst": new TextEncoder().encode(tileset("Two")),
  } });
  const duplicate = await loadTerrainSceneProjectInventory(duplicateStorage.fs, "Boards/pond.tkrscn", `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
tilePalette: [{tile: Tiles/water.tkrtle}]
`);
  ok(duplicate.ok, "a duplicated tile owner is not classified as used, matching the build's ambiguous-owner behavior");
  if (duplicate.ok) equal(duplicate.tilesets.size, 2, "both owners were successfully inventoried");

  const regionStorage = createMemoryPlatformServices({ files });
  const region = await loadTerrainSceneProjectInventory(regionStorage.fs, "Boards/pond.tkrscn", `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 1, height: 1}
floors: [{id: ground}]
terrainRegions: [{id: pond, floor: ground, terrain: {tileset: Tiles/one.tkrtst, terrain: water}, coverage: {shape: tile-grid, spans: [[0, 0, 1]]}}]
`);
  ok(!region.ok, "terrainRegions directly mark their tileset as used");
  if (!region.ok) ok(region.problems.some(({ path }) => path === "Bitmap/missing.bin"), "terrainRegions fail for missing artwork");
});
