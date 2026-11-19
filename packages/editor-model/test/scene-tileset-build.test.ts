import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { expandTileToRgba, readTileset } from "@tk-reawakened/core";
import type { Tileset } from "@tk-reawakened/native-data";
import { encodeScenePng } from "../src/scene-png.ts";
import { lowerSceneTileset } from "../src/scene-tileset-build.ts";

function document(overrides: Partial<Tileset> = {}): Tileset {
  return {
    contract: "tileset", version: "1.0.0-pre.1", name: "Sheet", projection: "2d", cellSize: [32, 32],
    sources: [{ id: "sheet", file: "Bitmap/sheet.png", grid: { width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0 }, transparent: { mode: "alpha" } }],
    tiles: [{ id: "first", name: "First", source: "sheet", cell: [0, 0], role: "floor", collision: "walkable" }],
    outputBinding: { target: "Tiles/sheet.tst", detail: 1 },
    ...overrides,
  };
}

function sheet(width: number, height: number, colorAt: (x: number, y: number) => readonly [number, number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(colorAt(x, y), (y * width + x) * 4);
  return encodeScenePng({ w: width, h: height, rgba: pixels });
}

function rgbaAt(bytes: Uint8Array, x: number, y: number): readonly number[] {
  const at = (x * 32 + y) * 4;
  return [...bytes.subarray(at, at + 4)];
}

test("lowers ordered tiles in an isometric scene and notes native-only fields", async () => {
  const png = sheet(64, 32, (x, y) => x === 0 && y === 0 ? [88, 99, 111, 0] : [x < 32 ? 10 + x % 20 : 90 + x % 20, y, 33, 255]);
  const model = document({
    projection: "iso-stacked",
    tags: ["preserved"],
    metadata: { source: "native" },
    pluginData: { "com.example.test": { version: "1.0.0", data: { setting: true } } },
    sources: [{ id: "sheet", file: "Bitmap/sheet.png", grid: { width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0 }, transparent: { mode: "alpha" } }],
    tiles: [
      { id: "first", name: "First", source: "sheet", cell: [0, 0], role: "floor", collision: "walkable" },
      { id: "second", name: "Second", source: "sheet", cell: [1, 0], role: "wall", collision: "solid" },
    ],
  });
  const result = await lowerSceneTileset(model, async () => png);
  ok(result.ok, result.ok ? "" : result.problems.map((problem) => problem.message).join("; "));
  deepEqual(result.tiles.map(({ id, index }) => [id, index]), [["first", 1], ["second", 2]]);
  equal(result.target, "Tiles/sheet.tst");
  deepEqual(result.notes.map(({ path }) => path), ["tags", "metadata", "pluginData"]);
  const parsed = readTileset(result.bytes);
  ok(parsed.ok);
  equal(parsed.value.tiles.length, 2);
  for (const [index, x] of [0, 32].entries()) {
    const expanded = expandTileToRgba(parsed.value, index);
    ok(expanded.ok);
    deepEqual(rgbaAt(expanded.value, 0, 0), index === 0 ? [0, 1, 2, 0] : [102, 0, 33, 255]);
    deepEqual(rgbaAt(expanded.value, 1, 0), [x === 0 ? 11 : 103, 0, 33, 255]);
  }
});

test("crops using source margins and grid gaps and applies color-key transparency", async () => {
  const png = sheet(68, 34, (x, y) => x === 36 && y === 1 ? [255, 0, 255, 255] : [x, y, 77, 255]);
  const model = document({
    sources: [{ id: "sheet", file: "Bitmap/sheet.png", grid: { width: 32, height: 32, marginX: 1, marginY: 1, gapX: 2, gapY: 0 }, transparent: { mode: "colorKey", color: [255, 0, 255] } }],
    tiles: [{ id: "cropped", name: "Cropped", source: "sheet", cell: [1, 0], role: "decorative", collision: "walkable" }],
  });
  const result = await lowerSceneTileset(model, async () => png);
  ok(result.ok, result.ok ? "" : result.problems.map((problem) => problem.message).join("; "));
  const parsed = readTileset(result.bytes);
  ok(parsed.ok);
  const expanded = expandTileToRgba(parsed.value, 0);
  ok(expanded.ok);
  deepEqual(rgbaAt(expanded.value, 0, 0), [35, 1, 77, 255]);
  deepEqual(rgbaAt(expanded.value, 1, 0), [0, 1, 2, 0]);
});

test("applies cutCorner masks to cropped pixels before encoding", async () => {
  const png = sheet(32, 32, () => [20, 30, 40, 255]);
  const diagonals = ["north-west", "north-east", "south-east", "south-west"] as const;
  const tiles = diagonals.map((diagonal, index) => ({
    id: `corner-${index}`, name: `Corner ${index}`, source: "sheet", cell: [0, 0] as const,
    role: "decorative" as const, collision: "walkable" as const,
    kitbash: [{ op: "cutCorner" as const, diagonal, clearHalf: true }],
  }));
  const result = await lowerSceneTileset(document({ tiles }), async () => png);
  ok(result.ok, result.ok ? "" : result.problems.map((problem) => problem.message).join("; "));
  const parsed = readTileset(result.bytes);
  ok(parsed.ok);
  const images = parsed.value.tiles.map((_, index) => expandTileToRgba(parsed.value, index));
  const points = [
    [[0, 0], [31, 31]],
    [[31, 0], [0, 31]],
    [[31, 31], [0, 0]],
    [[0, 31], [31, 0]],
  ] as const;
  for (const [index, [[cutX, cutY], [keepX, keepY]]] of points.entries()) {
    const image = images[index]!;
    ok(image.ok);
    deepEqual(rgbaAt(image.value, cutX, cutY), [0, 1, 2, 0]);
    deepEqual(rgbaAt(image.value, keepX, keepY), [20, 30, 40, 255]);
    const [diagonalX, diagonalY] = index % 2 === 0 ? [15, 16] : [15, 15];
    deepEqual(rgbaAt(image.value, diagonalX!, diagonalY!), [20, 30, 40, 255]);
  }
  const nw = images[0]!;
  ok(nw.ok);
  deepEqual(rgbaAt(nw.value, 15, 15), [0, 1, 2, 0]);
});

test("reports unsupported block recipes and out-of-bounds cells", async () => {
  const png = sheet(32, 32, () => [20, 30, 40, 255]);
  const outside = document({ tiles: [{ id: "first", name: "First", source: "sheet", cell: [1, 0], role: "floor", collision: "walkable" }] });
  const bounds = await lowerSceneTileset(outside, async () => png);
  ok(!bounds.ok);
  ok(bounds.problems.some(({ path, message }) => path === "tiles[0].cell" && message.includes("outside source")));
  const iso = document({ isoBlocks: [{ id: "block", name: "Block", heightPixels: 32, faces: {
    top: { source: "sheet", cell: [0, 0] }, left: { source: "sheet", cell: [0, 0] }, right: { source: "sheet", cell: [0, 0] },
  }, collision: "solid" }] });
  const isoResult = await lowerSceneTileset(iso, async () => png);
  ok(!isoResult.ok);
  ok(isoResult.problems.some(({ path }) => path === "isoBlocks"));
  const autotile = document({ autotiles: [{ id: "water", name: "Water", mode: "blob-47", base: { source: "sheet", cell: [0, 0] }, border: { source: "sheet", cell: [0, 0] }, innerCorner: { source: "sheet", cell: [0, 0] }, exportOrder: "t25-canonical" }] });
  const autotileResult = await lowerSceneTileset(autotile, async () => png);
  ok(!autotileResult.ok);
  ok(autotileResult.problems.some(({ path }) => path === "autotiles"));
});
