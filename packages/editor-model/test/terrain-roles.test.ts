// Native terrain roles (story 8, T-25): the rule situations a native terrain covers, reported from the built-in matcher's
// own reduction, and the authored arrangements the existing scene provider resolves from them. Native roles are rules,
// not the legacy 52-slot order of docs/spec/editor/autotiling.md.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { readTileset } from "@tk-reawakened/native-data";
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

test("a failed inventory read clears the roles and says why, so older rules are never kept as current", () => {
  const cleared = terrainSceneAssets({ ok: false, problems: [{ path: "Tiles/pond.tkrtst", message: "rules[0] must name a palette member" }] });
  deepEqual(cleared.tilesets, []);
  deepEqual(cleared.assetTiles, []);
  deepEqual(cleared.problems, ["Tiles/pond.tkrtst: rules[0] must name a palette member"]);
});
