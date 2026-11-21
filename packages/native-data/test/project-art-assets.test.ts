import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import { checkProjectArtAssets } from "../src/project-art-assets.ts";

const tileset = `contract: tileset
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
  - {id: grass, name: Grass, source: sheet, cell: [1, 1], role: floor, collision: walkable}
  - {id: far, name: Far, source: sheet, cell: [2, 0], role: floor, collision: walkable}
outputBinding: {target: Tiles/village.tst, detail: 1}
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

const inputs = [
  { path: "Tiles/village.tkrtst", text: tileset },
  { path: "Props/props.tkrpack", text: pack },
];

test("images big enough for every cell and crop produce no reports", () => {
  const reports = checkProjectArtAssets(inputs, () => ({ width: 96, height: 64 }));
  deepEqual(reports, []);
});

test("a missing or unreadable source image is reported once per source", () => {
  const reports = checkProjectArtAssets(inputs, () => null);
  deepEqual(reports, [
    { class: "native-art", path: "Props/props.tkrpack", field: "sources[0].file", message: "source image Bitmap/props.png is missing or unreadable", line: null },
    { class: "native-art", path: "Tiles/village.tkrtst", field: "sources[0].file", message: "source image Bitmap/sheet.png is missing or unreadable", line: null },
  ]);
});

test("tileset cells and pack crops outside the real image are reported by field", () => {
  const reports = checkProjectArtAssets(inputs, (file) => (file === "Bitmap/sheet.png" ? { width: 64, height: 64 } : { width: 64, height: 32 }));
  equal(reports.length, 2);
  deepEqual(reports.map((report) => [report.class, report.path, report.field, report.line]), [
    ["native-art", "Props/props.tkrpack", "assets[0].visuals[1].rect", null],
    ["native-art", "Tiles/village.tkrtst", "tiles[1].cell", null],
  ]);
  equal(reports[0]!.message.includes("[60, 0, 8, 8]"), true);
  equal(reports[1]!.message.includes("[2, 0]"), true);
});

test("a cell on a partial final cell is outside the image", () => {
  const reports = checkProjectArtAssets([inputs[0]!], () => ({ width: 80, height: 64 }));
  deepEqual(reports.map((report) => report.field), ["tiles[1].cell"]);
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
