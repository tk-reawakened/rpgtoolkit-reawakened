import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { readAssetPack } from "../src/asset-pack.ts";
import { setAssetPackGeometry, setTileGeometry, type OwnerGeometry } from "../src/native-asset-geometry.ts";
import { readTile } from "../src/tile.ts";

const TILE = `contract: tile
version: 1.0.0-pre.1
# A village fence.
name: Fence # display name
projection: 2d
role: decorative
visual:
  transparent: {mode: alpha}
  sample: {file: art/fence.png, rect: [0, 0, 32, 32]} # sample
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4} # opaque
`;

const PACK = `contract: asset-pack
version: 1.0.0-pre.1
name: Props # kit
projection: 2d
grid:
  tileWidth: 32
  tileHeight: 32
sources:
  - id: atlas
    file: Bitmap/props.png
    transparent: {mode: alpha}
assets:
  - id: gate
    name: Gate
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [0, 0, 32, 32]
  # A fence follows.
  - id: fence
    name: Fence
    category: Walls
    kind: prop
    anchor: {x: 16, y: 32, snap: bottom-center}
    visuals:
      - source: atlas
        rect: [32, 0, 32, 32]
    solid:
      - label: Rail
        closed: false
        points: [[-16, -8], [16, -8]]
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {bloom: 0.4} # opaque
`;

const RAIL = { label: "Rail", closed: false, points: [[-4, 20], [36, 20]] } as const;
const POST = { label: "Post", closed: true, points: [[-4, -8], [4, -8], [4, 0], [-4, 0]] } as const;
const LINTEL = { label: "Lintel", attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]] } as const;
const NONE: OwnerGeometry = { solid: [], under: [] };

void test("a tile gets its barrier right after its visual and nothing else changes", () => {
  const result = setTileGeometry(TILE, { solid: [RAIL], under: [] });
  ok(result.ok);
  equal(result.text, TILE.replace("# sample\n", "# sample\nsolid:\n  - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}\n"));
  const read = readTile(result.text);
  ok(read.ok);
  deepEqual(read.tile.solid, [RAIL]);
  equal(read.tile.pluginSource, "pluginData:\n  com.example.glow:\n    version: 1.0.0\n    data: {bloom: 0.4} # opaque\n");
});

void test("tile solid and walk-behind are added in contract order, with negative coordinates", () => {
  const result = setTileGeometry(TILE, { solid: [RAIL], under: [LINTEL] });
  ok(result.ok);
  equal(result.text, TILE.replace("# sample\n", [
    "# sample",
    "solid:",
    "  - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}",
    "under:",
    "  - {label: Lintel, attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]]}",
    "",
  ].join("\n")));
});

void test("an unchanged tile geometry leaves the text as written, and clearing removes only that entry", () => {
  const withRail = setTileGeometry(TILE, { solid: [RAIL], under: [] });
  ok(withRail.ok);
  const same = setTileGeometry(withRail.text, { solid: [RAIL], under: [] });
  ok(same.ok);
  equal(same.text, withRail.text);
  const cleared = setTileGeometry(withRail.text, NONE);
  ok(cleared.ok);
  equal(cleared.text, TILE);
});

void test("a hand-written block-style list is replaced in place and a comment above it stays", () => {
  const source = TILE.replace("# sample\n", "# sample\n# collision below\nsolid:\n  - label: Old\n    closed: false\n    points: [[0, 0], [8, 0]]\nunder: []\n");
  const result = setTileGeometry(source, { solid: [RAIL], under: [LINTEL] });
  ok(result.ok);
  equal(result.text, TILE.replace("# sample\n", [
    "# sample",
    "# collision below",
    "solid:",
    "  - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}",
    "under:",
    "  - {label: Lintel, attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]]}",
    "",
  ].join("\n")));
});

void test("a document with CRLF line endings keeps them", () => {
  const crlf = TILE.replaceAll("\n", "\r\n");
  const result = setTileGeometry(crlf, { solid: [RAIL], under: [LINTEL] });
  ok(result.ok);
  equal(/(?<!\r)\n/.test(result.text), false);
  ok(result.text.startsWith(crlf.slice(0, crlf.indexOf("# sample"))));
  ok(result.text.endsWith(crlf.slice(crlf.indexOf("pluginData:"))));
  ok(readTile(result.text).ok);
});

void test("tile geometry that the contract refuses is refused, and nothing is returned", () => {
  const open = setTileGeometry(TILE, { solid: [{ label: "Dot", closed: true, points: [[0, 0], [1, 1]] }], under: [] });
  ok(!open.ok);
  ok(open.problems[0]!.message.startsWith("the edit would leave a document the reader refuses"));
  const huge = setTileGeometry(TILE, { solid: [{ label: "Far", closed: false, points: [[0, 2147483648], [0, 0]] }], under: [] });
  ok(!huge.ok);
  const loose = setTileGeometry(TILE, { solid: [], under: [{ label: "Roof", attributes: 1, closed: false, points: [[0, 0], [8, 0], [8, 8]] }] });
  ok(!loose.ok);
  const masked = setTileGeometry(TILE, { solid: [], under: [{ ...LINTEL, attributes: 8 }] });
  ok(!masked.ok);
});

void test("a tile that cannot be read is not edited", () => {
  const result = setTileGeometry("contract: tile\nversion: 1.0.0-pre.1\n", NONE);
  ok(!result.ok);
});

void test("a tile whose visual is written on one line still takes its lists", () => {
  const flat = "contract: tile\nversion: 1.0.0-pre.1\nname: Fence\nprojection: 2d\nrole: decorative\nvisual: {transparent: {mode: alpha}, sample: {file: art/fence.png, rect: [0, 0, 32, 32]}}\n";
  const result = setTileGeometry(flat, { solid: [RAIL], under: [] });
  ok(result.ok);
  ok(result.text.startsWith(flat.trimEnd()));
  ok(readTile(result.text).ok);
});

void test("an asset's lists are inserted after its visuals and other assets, comments and plugin data stay byte for byte", () => {
  const result = setAssetPackGeometry(PACK, "gate", { solid: [POST], under: [LINTEL] });
  ok(result.ok);
  equal(result.text, PACK.replace("        rect: [0, 0, 32, 32]\n  # A fence follows.", [
    "        rect: [0, 0, 32, 32]",
    "    solid:",
    "      - {label: Post, closed: true, points: [[-4, -8], [4, -8], [4, 0], [-4, 0]]}",
    "    under:",
    "      - {label: Lintel, attributes: 7, closed: true, points: [[-16, -40], [16, -40], [16, -24], [-16, -24]]}",
    "  # A fence follows.",
  ].join("\n")));
  const read = readAssetPack(result.text);
  ok(read.ok);
  deepEqual(read.assetPack.assets[0]!.under, [LINTEL]);
  deepEqual(read.assetPack.assets[1]!.solid, [{ label: "Rail", closed: false, points: [[-16, -8], [16, -8]] }]);
});

void test("an existing asset list is replaced without touching the sibling asset", () => {
  const result = setAssetPackGeometry(PACK, "fence", { solid: [RAIL, POST], under: [] });
  ok(result.ok);
  equal(result.text, PACK.replace("      - label: Rail\n        closed: false\n        points: [[-16, -8], [16, -8]]\n", [
    "      - {label: Rail, closed: false, points: [[-4, 20], [36, 20]]}",
    "      - {label: Post, closed: true, points: [[-4, -8], [4, -8], [4, 0], [-4, 0]]}",
    "",
  ].join("\n")));
});

void test("clearing an asset's list removes its entry and keeps the neighbours", () => {
  const result = setAssetPackGeometry(PACK, "fence", NONE);
  ok(result.ok);
  equal(result.text, PACK.replace("    solid:\n      - label: Rail\n        closed: false\n        points: [[-16, -8], [16, -8]]\n", ""));
  ok(readAssetPack(result.text).ok);
});

void test("an asset that is not in the pack, or geometry the pack refuses, is refused", () => {
  const missing = setAssetPackGeometry(PACK, "nope", { solid: [POST], under: [] });
  ok(!missing.ok);
  ok(missing.problems[0]!.path.includes("nope"));
  ok(!setAssetPackGeometry(PACK, "gate", { solid: [], under: [{ ...LINTEL, closed: false }] }).ok);
  ok(!setAssetPackGeometry(PACK, "gate", { solid: [{ label: "Dot", closed: false, points: [[0, 0]] }], under: [] }).ok);
});

void test("a label that needs quoting survives a round trip", () => {
  const result = setAssetPackGeometry(PACK, "gate", { solid: [{ label: "yes: no, # maybe", closed: false, points: [[0, 0], [1, 1]] }], under: [] });
  ok(result.ok);
  const read = readAssetPack(result.text);
  ok(read.ok);
  equal(read.assetPack.assets[0]!.solid![0]!.label, "yes: no, # maybe");
});
