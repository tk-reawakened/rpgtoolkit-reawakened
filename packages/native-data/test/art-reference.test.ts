import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { checkDocuments } from "../src/check.ts";
import { applyPlanToDocuments, planRename } from "../src/rename.ts";

const config = {};
const tiles = `contract: tileset
version: 1.0.0-pre.1
name: Village
projection: 2d
cellSize: [32, 32]
sources:
  - id: sheet
    file: Bitmap/sheet.png
    grid: {width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0}
    transparent: {mode: alpha}
tiles:
  - {id: grass, name: Grass, source: sheet, cell: [0, 0], role: floor, collision: walkable}
outputBinding: {target: Tiles/village.tst, detail: 1}
`;
const pack = `contract: asset-pack
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
const scene = `contract: scene
version: 1.0.0-pre.1
projection: 2d
size: {width: 1, height: 1}
tilePalette:
  - {}
  - {tileset: tiles/village.tkrtst, tile: grass} # retain
floors:
  - id: ground
    boundarySources:
      walkableTiles:
        - {tileset: tiles/village.tkrtst, tile: grass}
placedPacks:
  - {instanceId: rock-1, pack: packs/props.tkrpack, asset: rock, floor: ground, x: 0, y: 0}
pluginData:
  com.example.notes:
    version: 1.0.0
    data: {pack: packs/props.tkrpack} # plugin-owned
`;
const inputs = [
  { path: "tiles/village.tkrtst", text: tiles },
  { path: "packs/props.tkrpack", text: pack },
  { path: "scenes/village.tkrscn", text: scene },
];

void test("checker resolves art references and reports an absent local asset", () => {
  deepEqual(checkDocuments(inputs, config), []);
  const broken = inputs.map((input) => input.path.endsWith(".tkrscn") ? { ...input, text: input.text.replace("asset: rock", "asset: absent") } : input);
  const reports = checkDocuments(broken, config);
  ok(reports.some((report) => report.class === "native-art" && report.path === "scenes/village.tkrscn" && report.message.includes("absent")));
});

void test("checker reports a pack whose projection differs from the scene", () => {
  const broken = inputs.map((input) => input.path.endsWith(".tkrpack")
    ? { ...input, text: input.text.replace("projection: 2d", "projection: iso-rotated") }
    : input);
  ok(checkDocuments(broken, config).some((report) => report.class === "native-scene" && report.message.includes("projection")));
});

void test("rename updates nested art references without touching plugin payload", () => {
  const result = planRename(inputs, [
    { from: "tiles/village.tkrtst", to: "tiles/new.tkrtst" },
    { from: "packs/props.tkrpack", to: "packs/new.tkrpack" },
  ], config);
  ok(result.ok, result.ok ? "" : JSON.stringify(result.refusals));
  const after = applyPlanToDocuments(inputs, result.plan);
  deepEqual(checkDocuments(after, config), []);
  const changed = after.find((input) => input.path === "scenes/village.tkrscn");
  ok(changed && "text" in changed);
  equal(changed.text, scene.replaceAll("tiles/village.tkrtst", '"tiles/new.tkrtst"').replace("pack: packs/props.tkrpack, asset:", 'pack: "packs/new.tkrpack", asset:'));
});

void test("rename resolves normalized references and quotes flow-map punctuation", () => {
  const original = inputs.map((input) => input.path.endsWith(".tkrscn")
    ? { ...input, text: input.text.replaceAll("tiles/village.tkrtst", "./tiles//village.tkrtst") }
    : input);
  const result = planRename(original, [{ from: "tiles/village.tkrtst", to: "tiles/winter, snow.tkrtst" }], config);
  ok(result.ok, result.ok ? "" : JSON.stringify(result.refusals));
  const after = applyPlanToDocuments(original, result.plan);
  deepEqual(checkDocuments(after, config), []);
  const changed = after.find((input) => input.path.endsWith(".tkrscn"));
  ok(changed && "text" in changed);
  ok(changed.text.includes('"tiles/winter, snow.tkrtst"'));
});

void test("checker rejects an incomplete native pack reference before rename", () => {
  const broken = inputs.map((input) => input.path.endsWith(".tkrscn")
    ? { ...input, text: input.text.replace("asset: rock", "assset: rock") }
    : input);
  ok(checkDocuments(broken, config).some((report) => report.class === "native-art" && report.message.includes("local ID")));
  const result = planRename(broken, [{ from: "packs/props.tkrpack", to: "packs/new.tkrpack" }], config);
  equal(result.ok, false);
});
