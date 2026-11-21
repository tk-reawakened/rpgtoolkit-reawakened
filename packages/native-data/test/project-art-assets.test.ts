import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { checkProjectArtAssets } from "../src/project-art-assets.ts";

const tileset = `contract: tileset
version: 1.0.0-pre.2
name: Village
expects: {projection: 2d, cellSize: [32, 32]}
tiles:
  - {tile: Tiles/grass.tkrtle}
sources:
  - id: sheet
    file: Bitmap/sheet.png
    grid: {width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0}
    transparent: {mode: alpha}
isoBlocks:
  - id: stone
    name: Stone
    heightPixels: 32
    faces:
      top: {source: sheet, cell: [1, 1]}
      left: {source: sheet, cell: [2, 0]}
      right: {source: sheet, cell: [0, 0]}
    collision: solid
outputBinding:
  target: Tiles/village.tst
  detail: 1
  slots:
    - {slot: 1, tile: Tiles/grass.tkrtle}
`;

const pack = `contract: asset-pack
version: 1.0.0-pre.1
name: Props
projection: 2d
grid: {tileWidth: 32, tileHeight: 32}
sources:
  - {id: sheet, file: Bitmap/props.png}
assets:
  - id: rock
    name: Rock
    kind: prop
    anchor: {x: 0, y: 0, snap: bottom-center}
    visuals: [{source: sheet, rect: [0, 0, 8, 8]}, {source: sheet, rect: [60, 0, 8, 8]}]
`;

const tile = `contract: tile
version: 1.0.0-pre.1
name: Grass
projection: 2d
role: floor
visual:
  transparent: {mode: alpha}
  sample: {file: Bitmap/tile.png, rect: [0, 0, 8, 8]}
`;

const inputs = [
  { path: "Tiles/village.tkrtst", text: tileset },
  { path: "Props/props.tkrpack", text: pack },
];

void test("a standalone tile's raster sample must exist and contain its rectangle", () => {
  const missing = checkProjectArtAssets([{ path: "Tiles/grass.tkrtle", text: tile }], () => null);
  deepEqual(missing.map((report) => [report.field, report.message]), [["visual.sample.file", "source image Bitmap/tile.png is missing or unreadable"]]);
  const outside = checkProjectArtAssets([{ path: "Tiles/grass.tkrtle", text: tile }], () => ({ width: 4, height: 4 }));
  deepEqual(outside.map((report) => report.field), ["visual.sample.rect"]);
  equal(outside[0]!.message.includes("[0, 0, 8, 8]"), true);
});

test("images big enough for every cell and crop produce no reports", () => {
  deepEqual(checkProjectArtAssets(inputs, () => ({ width: 96, height: 64 })), []);
});

test("a missing or unreadable source image is reported once per source", () => {
  const reports = checkProjectArtAssets(inputs, () => null);
  deepEqual(reports, [
    { class: "native-art", path: "Props/props.tkrpack", field: "sources[0].file", message: "source image Bitmap/props.png is missing or unreadable", line: null },
    { class: "native-art", path: "Tiles/village.tkrtst", field: "sources[0].file", message: "source image Bitmap/sheet.png is missing or unreadable", line: null },
  ]);
});

test("isometric block faces and pack crops outside the real image are reported by field", () => {
  const reports = checkProjectArtAssets(inputs, (file) => (file === "Bitmap/sheet.png" ? { width: 64, height: 64 } : { width: 64, height: 32 }));
  equal(reports.length, 2);
  deepEqual(reports.map((report) => [report.class, report.path, report.field, report.line]), [
    ["native-art", "Props/props.tkrpack", "assets[0].visuals[1].rect", null],
    ["native-art", "Tiles/village.tkrtst", "isoBlocks[0].faces.left.cell", null],
  ]);
  equal(reports[0]!.message.includes("[60, 0, 8, 8]"), true);
  equal(reports[1]!.message.includes("[2, 0]"), true);
});

test("a cell on a partial final cell is outside the image", () => {
  const reports = checkProjectArtAssets([inputs[0]!], () => ({ width: 80, height: 64 }));
  deepEqual(reports.map((report) => report.field), ["isoBlocks[0].faces.left.cell"]);
});

test("unreadable and non-art documents are left to the document checker", () => {
  const reports = checkProjectArtAssets(
    [
      { path: "Tiles/bad.tkrtst", text: "contract: tileset\n" },
      { path: "Tiles/gone.tkrtst", unreadable: "not UTF-8" },
      { path: "Notes/readme.md", text: tileset },
    ],
    () => null,
  );
  deepEqual(reports, []);
});
