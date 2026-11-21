import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { DOS_PALETTE, expandTileToRgba, isInsideIsoDiamond, readTileset, tileDimensions, tilesetDetail, writeTileset } from "@tk-reawakened/core";
import { encodeSceneTile } from "../src/scene-tile-encoder.ts";

function result(detailCode: number, width: number, height: number, pixels: Uint8Array) {
  const encoded = encodeSceneTile(detailCode, { width, height, pixels });
  ok(encoded.ok, encoded.ok ? "" : encoded.error.message);
  return encoded.tile;
}

function rgbaFor(detailCode: number, x: number, y: number): readonly [number, number, number, number] {
  if (detailCode === 1 || detailCode === 2 || detailCode === 150) {
    return (x + y) % 19 === 0 ? [0, 1, 2, 0] : [(x * 7 + y) % 256, (x + y * 9) % 256, (x * 3 + y * 5) % 256, 255];
  }
  if ((x + y) % 19 === 0) return [0, 0, 0, 0];
  const index = (x + y * 3) % (detailCode >= 5 ? 16 : 32);
  const at = index * 3;
  return [DOS_PALETTE[at]!, DOS_PALETTE[at + 1]!, DOS_PALETTE[at + 2]!, 255];
}
function rowMajorFromColumnMajor(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const rowMajor = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const from = (x * height + y) * 4;
    rowMajor.set(pixels.subarray(from, from + 4), (y * width + x) * 4);
  }
  return rowMajor;
}

function fillTransparentRgb(pixels: Uint8Array): void {
  for (let at = 0; at < pixels.length; at += 4) pixels.set([0, 1, 2, 0], at);
}


for (const detailCode of [1, 2, 3, 4, 5, 6, 150]) {
  test(`detail ${detailCode} round-trips composed RGBA through writer and reader`, () => {
    const detail = tilesetDetail(detailCode)!;
    const { width, height } = tileDimensions(detail);
    const image = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const color = detailCode === 150 && !isInsideIsoDiamond(x, y) ? [0, 0, 0, 0] : rgbaFor(detailCode, x, y);
        image.set(color, at);
      }
    }
    const tile = result(detailCode, width, height, image);
    const written = writeTileset({ version: detailCode === 150 ? 30 : 20, detail, tiles: [tile], residue: new Uint8Array() });
    ok(written.ok);
    const parsed = readTileset(written.value);
    ok(parsed.ok);
    const decoded = expandTileToRgba(parsed.value, 0);
    ok(decoded.ok);
    deepEqual(rowMajorFromColumnMajor(decoded.value, width, height), image);
  });
}

test("encoder stores RGB and indexed pixels in column-major output order", () => {
  const image = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    image.set([x, y, 77, 255], (y * 32 + x) * 4);
  }
  const encoded = result(1, 32, 32, image);
  deepEqual(Array.from(encoded.pixels.slice(0, 6)), [0, 0, 77, 0, 1, 77]);
  deepEqual(Array.from(encoded.pixels.slice((3 * 32 + 7) * 3, (3 * 32 + 7) * 3 + 3)), [3, 7, 77]);
});

test("rejects wrong size and reports unsupported detail", () => {
  const wrongSize = encodeSceneTile(1, { width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4) });
  ok(!wrongSize.ok);
  equal(wrongSize.error.section, "size");
  const unknown = encodeSceneTile(7, { width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4) });
  ok(!unknown.ok);
  equal(unknown.error.section, "detail");
});

test("rejects partial alpha and RGB key mismatches at the source pixel", () => {
  const partial = new Uint8Array(32 * 32 * 4);
  fillTransparentRgb(partial);
  partial.set([1, 2, 3, 128], (5 * 32 + 4) * 4);
  const partialResult = encodeSceneTile(1, { width: 32, height: 32, pixels: partial });
  ok(!partialResult.ok);
  equal(partialResult.error.section, "pixel");
  equal(partialResult.error.x, 4);
  equal(partialResult.error.y, 5);
  const keyMismatch = new Uint8Array(32 * 32 * 4);
  fillTransparentRgb(keyMismatch);
  keyMismatch.set([0, 1, 2, 255], (2 * 32 + 3) * 4);
  const mismatch = encodeSceneTile(1, { width: 32, height: 32, pixels: keyMismatch });
  ok(!mismatch.ok);
  ok(mismatch.error.message.includes("transparency key"));
});

test("rejects non-palette colors and non-black indexed transparency", () => {
  const color = new Uint8Array(32 * 32 * 4);
  color.set([1, 2, 3, 255], (8 * 32 + 9) * 4);
  const unlisted = encodeSceneTile(3, { width: 32, height: 32, pixels: color });
  ok(!unlisted.ok);
  equal(unlisted.error.x, 9);
  equal(unlisted.error.y, 8);
  color.set([4, 5, 6, 0], (8 * 32 + 9) * 4);
  const alpha = encodeSceneTile(3, { width: 32, height: 32, pixels: color });
  ok(!alpha.ok);
  ok(alpha.error.message.includes("transparent black"));
});

test("rejects nontransparent isometric mask pixels and preserves exact diamond scan", () => {
  const image = new Uint8Array(64 * 32 * 4);
  let inside = 0;
  for (let x = 0; x < 64; x += 1) for (let y = 0; y < 32; y += 1) {
    if (isInsideIsoDiamond(x, y)) {
      image.set([x, y, 9, 255], (y * 64 + x) * 4);
      inside += 1;
    }
  }
  equal(inside, 1024);
  const encoded = result(150, 64, 32, image);
  equal(encoded.pixels.length, 32 * 32 * 3);
  const invalid = image.slice();
  const outside = Array.from({ length: 64 * 32 }, (_, i) => ({ x: i % 64, y: Math.floor(i / 64) })).find(({ x, y }) => !isInsideIsoDiamond(x, y))!;
  invalid.set([1, 1, 1, 255], (outside.y * 64 + outside.x) * 4);
  const rejected = encodeSceneTile(150, { width: 64, height: 32, pixels: invalid });
  ok(!rejected.ok);
  equal(rejected.error.x, outside.x);
  equal(rejected.error.y, outside.y);
});
