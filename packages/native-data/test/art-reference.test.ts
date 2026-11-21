import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { checkDocuments } from "../src/check.ts";
import type { DocumentInput } from "../src/document.ts";
import { applyPlanToDocuments, planRename, type RenameConfig } from "../src/rename.ts";

const TILE = `contract: tile
version: 1.0.0-pre.1
name: Grass
projection: 2d
role: floor
visual:
  transparent: {mode: alpha}
  sample: {file: art/field.png, rect: [0, 0, 32, 32]}
`;

const EDGE = TILE.replace("name: Grass", "name: Edge");

const TILESET = `contract: tileset
version: 1.0.0-pre.2
name: Field
expects: {projection: 2d, cellSize: [32, 32]}
tiles:
  - {tile: Tiles/grass.tkrtle}
  - {tile: Tiles/edge.tkrtle}
terrains:
  - id: meadow
    name: Meadow
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    rules:
      - id: plain
        when: {}
        use: {tile: Tiles/grass.tkrtle}
      - id: varied
        when: {e: same}
        variants:
          - {tile: Tiles/grass.tkrtle, weight: 1}
          - {tile: Tiles/edge.tkrtle, weight: 1}
outputBinding:
  target: Tiles/field.tst
  detail: 1
  slots:
    - {slot: 1, tile: Tiles/grass.tkrtle}
    - {slot: 2, tile: Tiles/edge.tkrtle}
pluginData:
  com.example.weather:
    version: 1.0.0
    data: {future: 1.10} # opaque
`;

const PACK = `contract: asset-pack
version: 1.0.0-pre.1
name: Props
projection: 2d
grid: {tileWidth: 32, tileHeight: 32}
sources:
  - {id: sheet, file: Bitmap/sheet.png}
assets:
  - id: rock
    name: Rock
    kind: prop
    anchor: {x: 0, y: 0, snap: bottom-center}
    visuals: [{source: sheet, rect: [0, 0, 8, 8]}]
`;

const SCENE = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 2, height: 2}
floors:
  - id: ground
    tiles: [[4, 1]]
    boundarySources:
      walkableTiles: [{tile: Tiles/grass.tkrtle}]
tilePalette:
  - {}
  - {tile: Tiles/grass.tkrtle}
terrainRegions:
  - id: paint
    floor: ground
    terrain: {tileset: Tiles/field.tkrtst, terrain: meadow}
    coverage: {shape: tile-grid, spans: [[0, 0, 2]]}
tileOverrides:
  - floor: ground
    cell: [1, 1]
    tile: {tile: Tiles/edge.tkrtle}
placedPacks:
  - instanceId: rock-1
    pack: Props/props.tkrpack
    asset: rock
    floor: ground
    x: 0
    y: 0
`;

const PROJECT: DocumentInput[] = [
  { path: "Tiles/grass.tkrtle", text: TILE },
  { path: "Tiles/edge.tkrtle", text: EDGE },
  { path: "Tiles/field.tkrtst", text: TILESET },
  { path: "Props/props.tkrpack", text: PACK },
  { path: "Boards/field.tkrscn", text: SCENE },
];

function plan(documents: readonly DocumentInput[], config: RenameConfig = {}) {
  const result = planRename(documents, [], config);
  if (!result.ok) throw new Error(result.refusals.map((refusal) => refusal.message).join(" | "));
  return result.plan;
}

function renamed(documents: readonly DocumentInput[], from: string, to: string, config: RenameConfig = {}) {
  const result = planRename(documents, [{ from, to }], config);
  if (!result.ok) throw new Error(result.refusals.map((refusal) => refusal.message).join(" | "));
  return result.plan;
}

function text(inputs: readonly DocumentInput[], path: string): string {
  const input = inputs.find((candidate) => candidate.path === path);
  if (input === undefined || !("text" in input)) throw new Error(`expected ${path}`);
  return input.text;
}

void test("the canonical project is checker-clean", () => {
  deepEqual(checkDocuments(PROJECT), []);
});

void test("checker resolves standalone tile paths, terrain documents and local terrain IDs", () => {
  const missingTile = checkDocuments(PROJECT.filter((input) => input.path !== "Tiles/edge.tkrtle"));
  ok(missingTile.some((report) => report.class === "native-art" && report.message === "cannot resolve tile Tiles/edge.tkrtle"));

  const missingTerrain = checkDocuments(PROJECT.map((input) => input.path === "Boards/field.tkrscn" ? { ...input, text: SCENE.replace("terrain: meadow", "terrain: unknown") } : input));
  ok(missingTerrain.some((report) => report.class === "native-art" && report.message.includes("terrain") && report.message.includes("unknown")));
});

void test("checker reports an ambiguous case-folded target instead of choosing one", () => {
  const reports = checkDocuments([...PROJECT, { path: "Tiles/EDGE.tkrtle", text: EDGE }]);
  ok(reports.some((report) => report.class === "native-art" && report.message.startsWith("ambiguous tile Tiles/edge.tkrtle")));
});

void test("obsolete embedded tile fields are rejected by the tileset and scene readers", () => {
  const embedded = TILESET.replace("  - {tile: Tiles/grass.tkrtle}\n  - {tile: Tiles/edge.tkrtle}\n", "  - {id: grass, name: Grass, source: sheet, cell: [0, 0], role: floor, collision: walkable}\n");
  const rejectedTileset = checkDocuments([{ path: "Tiles/field.tkrtst", text: embedded }]);
  ok(rejectedTileset.some((report) => report.class === "native-art" && report.message.includes("not allowed")));

  const oldWire = SCENE.replace("  - {tile: Tiles/grass.tkrtle}", "  - {tileset: Tiles/field.tkrtst, tile: grass}");
  const rejectedScene = checkDocuments([{ path: "Boards/field.tkrscn", text: oldWire }]);
  ok(rejectedScene.some((report) => report.class === "native-scene" && report.field.includes("tileset")));
});

void test("renaming a standalone tile rewrites palette, boundary, override and tileset rule/slot paths without renumbering slots", () => {
  const result = renamed(PROJECT, "Tiles/grass.tkrtle", "Tiles/meadow-grass.tkrtle");
  deepEqual(result.moves, [{ from: "Tiles/grass.tkrtle", to: "Tiles/meadow-grass.tkrtle" }]);
  const after = applyPlanToDocuments(PROJECT, result);
  deepEqual(checkDocuments(after), []);

  const tileset = text(after, "Tiles/field.tkrtst");
  ok(tileset.includes("{tile: Tiles/meadow-grass.tkrtle}"));
  ok(tileset.includes("use: {tile: Tiles/meadow-grass.tkrtle}"));
  ok(tileset.includes("variants:\n          - {tile: Tiles/meadow-grass.tkrtle, weight: 1}\n          - {tile: Tiles/edge.tkrtle, weight: 1}"));
  ok(tileset.includes("{slot: 1, tile: Tiles/meadow-grass.tkrtle}"));
  ok(tileset.includes("{slot: 2, tile: Tiles/edge.tkrtle}"));
  ok(tileset.includes("future: 1.10"), "the opaque plugin block is untouched");

  const scene = text(after, "Boards/field.tkrscn");
  ok(scene.includes("tilePalette:\n  - {}\n  - {tile: Tiles/meadow-grass.tkrtle}"));
  ok(scene.includes("walkableTiles: [{tile: Tiles/meadow-grass.tkrtle}]"));
  ok(scene.includes("tile: {tile: Tiles/edge.tkrtle}"));
});

void test("renaming a tile to a filename with flow punctuation preserves scene and tileset references", () => {
  const original = "Tiles/grass.tkrtle";
  const next = "Tiles/winter, [snow].tkrtle";
  const scene = SCENE.replace(`walkableTiles: [{tile: ${original}}]`, `walkableTiles: [{tile: '${original}'}]`);
  const project = PROJECT.map((input) => input.path === "Boards/field.tkrscn" ? { path: input.path, text: scene } : input);
  const after = applyPlanToDocuments(project, renamed(project, original, next));
  equal(text(after, "Tiles/field.tkrtst"), TILESET.replaceAll(original, `"${next}"`));
  equal(text(after, "Boards/field.tkrscn"), scene
    .replace(`walkableTiles: [{tile: '${original}'}]`, `walkableTiles: [{tile: '${next}'}]`)
    .replace(`- {tile: ${original}}`, `- {tile: "${next}"}`));
  deepEqual(checkDocuments(after), []);
});

void test("renaming a tileset rewrites a scene terrain document path and keeps its local terrain ID", () => {
  const result = renamed(PROJECT, "Tiles/field.tkrtst", "Tiles/field/field.tkrtst");
  const after = applyPlanToDocuments(PROJECT, result);
  deepEqual(checkDocuments(after), []);
  ok(text(after, "Boards/field.tkrscn").includes("terrain: {tileset: Tiles/field/field.tkrtst, terrain: meadow}"));
});

void test("renaming a terrain rewrites the tileset id and every scene local reference, with no slot change", () => {
  const result = plan(PROJECT, { terrainRenames: [{ document: "Tiles/field.tkrtst", from: "meadow", to: "grass-meadow" }] });
  deepEqual(result.moves, []);
  const after = applyPlanToDocuments(PROJECT, result);
  deepEqual(checkDocuments(after), []);
  const tileset = text(after, "Tiles/field.tkrtst");
  ok(tileset.includes("id: grass-meadow"));
  ok(tileset.includes("{slot: 1, tile: Tiles/grass.tkrtle}"));
  ok(text(after, "Boards/field.tkrscn").includes("terrain: {tileset: Tiles/field.tkrtst, terrain: grass-meadow}"));
});

void test("terrain renames refuse unknown IDs, invalid grammar and collisions", () => {
  const refusal = (config: RenameConfig): string => {
    const result = planRename(PROJECT, [], config);
    return result.ok ? "planned" : result.refusals.map((item) => item.code).join(",");
  };
  equal(refusal({ terrainRenames: [{ document: "Tiles/field.tkrtst", from: "missing", to: "other" }] }), "unknown-terrain");
  equal(refusal({ terrainRenames: [{ document: "Tiles/field.tkrtst", from: "meadow", to: "Bad_ID" }] }), "invalid-terrain-id");
  equal(refusal({ terrainRenames: [{ document: "Tiles/grass.tkrtle", from: "meadow", to: "other" }] }), "terrain-document-not-tileset");
});
