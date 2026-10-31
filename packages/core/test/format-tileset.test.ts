// The tileset reader and writer of docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso (AD-18): synthetic buffers
// pin the header, the column-major pixel order, both transparent keys, the
// palette path and the isometric diamond mask; located errors cover EOF
// and bounds. Two committed, independently authored/editor-produced fixtures
// (ticket 2.22) are read and round-tripped too, so the happy path does not rest
// on the writer's own primitives. When the legacy sample games are fetched, both
// `char.tst` and `default.tst` parse with zero trailing bytes and round-trip
// byte-identically.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BinaryWriter,
  DOS_PALETTE,
  dosPaletteEntry,
  expandTileToRgba,
  isInsideIsoDiamond,
  ISO_INSIDE_PIXEL_COUNT,
  readTileset,
  tilesetDetail,
  TRANSPARENT_INDEX,
  writeTileset,
} from "../src/index.ts";
import type { Result, Tileset } from "../src/index.ts";

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

/** The 6-byte header plus raw pixels, as a synthetic tileset file. */
function tilesetBytes(
  version: number,
  tileCount: number,
  detail: number,
  pixels: Uint8Array | readonly Uint8Array[],
): Uint8Array {
  const w = new BinaryWriter();
  w.i16(version);
  w.i16(tileCount);
  w.i16(detail);
  for (const chunk of Array.isArray(pixels) ? pixels : [pixels]) {
    w.writeBytes(chunk);
  }
  return w.toBytes();
}

/** `size × size` stored pixels where stored index `k` carries `k` in R/G. */
function indexedPixels(size: number, bytesPerPixel: 1 | 3): Uint8Array {
  const out = new Uint8Array(size * size * bytesPerPixel);
  for (let k = 0; k < size * size; k += 1) {
    const at = k * bytesPerPixel;
    if (bytesPerPixel === 3) {
      out[at] = k & 0xff;
      out[at + 1] = (k >> 8) & 0xff;
      out[at + 2] = 5;
    } else {
      out[at] = k & 0xff;
    }
  }
  return out;
}

test("a committed tileset round-trips and the writer reproduces the bytes", () => {
  // A real, editor-produced detail-2 file (ticket 2.22), not a buffer built
  // with the writer's own primitives.
  const bytes = new Uint8Array(readFileSync(join(testDir, "fixtures", "real", "16x16.tst")));
  const model = unwrap(readTileset(bytes));
  equal(model.version, 20);
  equal(model.detail.code, 2);
  equal(model.tiles.length, 1);
  equal(model.residue.length, 0);

  const written = unwrap(writeTileset(model));
  deepEqual([...written], [...bytes]);
});

test("the committed two-tile tileset reads and writes both tiles at their offsets", () => {
  const bytes = new Uint8Array(readFileSync(join(testDir, "fixtures", "authored", "detail4.tst")));
  const model = unwrap(readTileset(bytes));
  equal(model.tiles.length, 2);
  // Tile 0's stored index at k is `k mod 256`; tile 1's is `(k + 64) mod 256`, so
  // a reader that ignored the per-tile stride would return tile 0 twice.
  deepEqual([...(model.tiles[0]?.pixels.subarray(0, 3) ?? [])], [0, 1, 2]);
  deepEqual([...(model.tiles[1]?.pixels.subarray(0, 3) ?? [])], [64, 65, 66]);
  deepEqual([...unwrap(writeTileset(model))], [...bytes]);
});

test("the committed isometric .iso round-trips", () => {
  const bytes = new Uint8Array(readFileSync(join(testDir, "fixtures", "authored", "iso.iso")));
  const model = unwrap(readTileset(bytes));
  equal(model.version, 30);
  equal(model.detail.isometric, true);
  deepEqual([...unwrap(writeTileset(model))], [...bytes]);
});

test("the detail table matches the tileset spec", () => {
  deepEqual(tilesetDetail(1), { code: 1, size: 32, bytesPerPixel: 3, isometric: false });
  deepEqual(tilesetDetail(2), { code: 2, size: 16, bytesPerPixel: 3, isometric: false });
  deepEqual(tilesetDetail(3), { code: 3, size: 32, bytesPerPixel: 1, isometric: false });
  deepEqual(tilesetDetail(4), { code: 4, size: 16, bytesPerPixel: 1, isometric: false });
  deepEqual(tilesetDetail(5), { code: 5, size: 32, bytesPerPixel: 1, isometric: false });
  deepEqual(tilesetDetail(6), { code: 6, size: 16, bytesPerPixel: 1, isometric: false });
  deepEqual(tilesetDetail(150), { code: 150, size: 32, bytesPerPixel: 3, isometric: true });
  equal(tilesetDetail(7), undefined);
});

test("tile pixels are stored column-major, not row-major", () => {
  // Stored pixel k carries k: pixel (x, y) is stored at x*size + y, so its R is
  // x*32 + y. A row-major read would give y*32 + x instead.
  const model = unwrap(readTileset(tilesetBytes(20, 1, 1, indexedPixels(32, 3))));
  const rgba = unwrap(expandTileToRgba(model, 0));
  equal(rgba.length, 32 * 32 * 4);

  const rAt = (x: number, y: number): number => rgba[(x * 32 + y) * 4] ?? 0;
  equal(rAt(1, 0), 32); // column-major; row-major would read 0
  equal(rAt(0, 1), 1); // column-major; row-major would read 32
  equal(rAt(5, 7), 5 * 32 + 7);
  equal(rAt(7, 5), 7 * 32 + 5);
});

test("the 24-bit transparent key is exactly R=0, G=1, B=2", () => {
  const pixels = new Uint8Array(32 * 32 * 3);
  pixels.set([0, 1, 2], 0); // the key → transparent
  pixels.set([0, 1, 3], 3); // one byte off → opaque
  pixels.set([1, 1, 2], 6); // one byte off → opaque
  const model = unwrap(readTileset(tilesetBytes(20, 1, 1, pixels)));

  const rgba = unwrap(expandTileToRgba(model, 0));
  equal(rgba[3], 0);
  equal(rgba[7], 255);
  equal(rgba[11], 255);
});

test("8-bit tiles use the DOS palette and index 255 is transparent", () => {
  const pixels = new Uint8Array(32 * 32);
  pixels.set([1, TRANSPARENT_INDEX, 0, 2], 0);
  const model = unwrap(readTileset(tilesetBytes(20, 1, 3, pixels)));

  const rgba = unwrap(expandTileToRgba(model, 0));
  deepEqual([rgba[0], rgba[1], rgba[2], rgba[3]], [0x00, 0x00, 0xa8, 255]); // dos-palette[1]
  deepEqual([rgba[4], rgba[5], rgba[6], rgba[7]], [0, 0, 0, 0]); // index 255
  deepEqual([rgba[8], rgba[9], rgba[10], rgba[11]], [0, 0, 0, 255]); // dos-palette[0]
  deepEqual([rgba[12], rgba[13], rgba[14], rgba[15]], [0x00, 0xa8, 0x00, 255]); // dos-palette[2]
});

test("the DOS palette ships as 256 entries", () => {
  equal(DOS_PALETTE.length, 768);
  deepEqual(dosPaletteEntry(0), { r: 0x00, g: 0x00, b: 0x00 });
  deepEqual(dosPaletteEntry(1), { r: 0x00, g: 0x00, b: 0xa8 });
  deepEqual(dosPaletteEntry(2), { r: 0x00, g: 0xa8, b: 0x00 });
  deepEqual(dosPaletteEntry(15), { r: 0xff, g: 0xff, b: 0xff });
  deepEqual(dosPaletteEntry(255), { r: 0x00, g: 0x00, b: 0x00 });
  // The table is the programs' own palette, not the IBM VGA mode-13h default:
  // entry 6 is 168, 88, 0 where VGA has 170, 85, 0, and entry 1 is 0, 0, 168
  // where VGA has 0, 0, 170 (docs/spec/formats/dos-palette.json, R-01).
  deepEqual(dosPaletteEntry(6), { r: 0xa8, g: 0x58, b: 0x00 });
  deepEqual(dosPaletteEntry(29), { r: 0xc8, g: 0xc8, b: 0xc8 });
});

test("the isometric diamond mask has exactly 1024 inside pixels", () => {
  let inside = 0;
  for (let x = 0; x < 64; x += 1) {
    for (let y = 0; y < 32; y += 1) {
      if (isInsideIsoDiamond(x, y)) {
        inside += 1;
      }
    }
  }
  equal(inside, 1024);
  equal(inside, ISO_INSIDE_PIXEL_COUNT);
  equal(isInsideIsoDiamond(0, 0), false); // top-left corner
  equal(isInsideIsoDiamond(63, 31), false); // bottom-right corner
  equal(isInsideIsoDiamond(0, 15), false); // the x=0 column is outside the mask
  equal(isInsideIsoDiamond(1, 15), true); // left-most inside pixel
  equal(isInsideIsoDiamond(31, 15), true); // centre region
});

test("detail 150 unpacks the diamond column-major", () => {
  const model = unwrap(readTileset(tilesetBytes(30, 1, 150, indexedPixels(32, 3))));
  const rgba = unwrap(expandTileToRgba(model, 0));
  equal(rgba.length, 64 * 32 * 4);

  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 255) {
      opaque += 1;
    }
  }
  equal(opaque, 1024);

  // The column-major walk meets x=1 before x=2, and within a column y before
  // y+1, so the first inside pixels are (1, 15), (1, 16), (2, 15). They take
  // stored pixels 0, 1 and 2 in order.
  equal(rgba[(1 * 32 + 15) * 4], 0);
  equal(rgba[(1 * 32 + 16) * 4], 1);
  equal(rgba[(2 * 32 + 15) * 4], 2);
  equal(rgba[(0 * 32 + 0) * 4 + 3], 0); // outside the diamond → transparent
});

test("EOF and bounds errors carry the field offset and a section", () => {
  const empty = readTileset(new Uint8Array(0));
  equal(empty.ok, false);
  if (!empty.ok) {
    equal(empty.error.offset, 0);
  }

  const shortHeader = readTileset(new Uint8Array([0x14, 0x00, 0x01, 0x00]));
  equal(shortHeader.ok, false);
  if (!shortHeader.ok) {
    equal(shortHeader.error.offset, 4);
    equal(shortHeader.error.section, "docs/spec/formats/README.md#primitive-encoding");
  }

  const unknownVersion = readTileset(tilesetBytes(25, 0, 1, new Uint8Array(0)));
  equal(unknownVersion.ok, false);
  if (!unknownVersion.ok) {
    equal(unknownVersion.error.offset, 0);
    equal(unknownVersion.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }

  const negativeCount = readTileset(tilesetBytes(20, -5, 1, new Uint8Array(0)));
  equal(negativeCount.ok, false);
  if (!negativeCount.ok) {
    equal(negativeCount.error.offset, 2);
    equal(negativeCount.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }

  const unknownDetail = readTileset(tilesetBytes(20, 0, 7, new Uint8Array(0)));
  equal(unknownDetail.ok, false);
  if (!unknownDetail.ok) {
    equal(unknownDetail.error.offset, 4);
    equal(unknownDetail.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }

  const shortTiles = readTileset(tilesetBytes(20, 2, 1, indexedPixels(32, 3)));
  equal(shortTiles.ok, false);
  if (!shortTiles.ok) {
    equal(shortTiles.error.offset, 6 + 32 * 32 * 3);
    equal(shortTiles.error.section, "docs/spec/formats/README.md#primitive-encoding");
  }
});

test("expandTileToRgba reports an out-of-range tile", () => {
  const model = unwrap(readTileset(tilesetBytes(20, 1, 1, indexedPixels(32, 3))));
  const out = expandTileToRgba(model, 1);
  equal(out.ok, false);
  if (!out.ok) {
    equal(out.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }
});

test("expandTileToRgba reports a tileset that has no tiles", () => {
  const model = unwrap(readTileset(tilesetBytes(20, 0, 1, new Uint8Array(0))));
  equal(model.tiles.length, 0);
  const out = expandTileToRgba(model, 0);
  equal(out.ok, false);
  if (!out.ok) {
    equal(out.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }
});

test("trailing bytes are kept as residue and round-trip", () => {
  const base = tilesetBytes(20, 1, 1, indexedPixels(32, 3));
  const bytes = new Uint8Array([...base, 9, 9, 9]);
  const result = readTileset(bytes);
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  equal(result.warnings.length, 1);
  const model = result.value;
  equal(model.residue.length, 3);
  deepEqual([...unwrap(writeTileset(model))], [...bytes]);
});

test("the writer rejects a tile whose stored size does not match the detail", () => {
  const model: Tileset = {
    version: 20,
    detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: new Uint8Array(10) }],
    residue: new Uint8Array(0),
  };
  const written = writeTileset(model);
  equal(written.ok, false);
  if (!written.ok) {
    equal(written.error.offset, 6);
    equal(written.error.section, "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso");
  }
});

// The legacy sample games are fetched, not committed (G5 rule 4). Skip cleanly
// when they are absent.
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");
// Every fetched tileset, not only `demo` and `Basic`: the other four games add the geometry and palette
// variants a two-game list never reached (#852).
const SAMPLE_TILESETS = existsSync(join(repoRoot, "fixtures", "legacy"))
  ? readdirSync(join(repoRoot, "fixtures", "legacy"), { recursive: true })
    .filter((name) => name.toLowerCase().endsWith(".tst"))
    .map((name) => join(repoRoot, "fixtures", "legacy", name))
  : [];
const fixturesFetched = existsSync(join(repoRoot, "fixtures", "legacy"));

test(
  "the sample tilesets parse with zero trailing bytes and round-trip",
  { skip: fixturesFetched ? false : "legacy fixtures are not fetched" },
  () => {
    for (const file of SAMPLE_TILESETS) {
      const bytes = new Uint8Array(readFileSync(file));
      if (bytes.length === 0) continue; // an empty placeholder is not a tileset
      const model = unwrap(readTileset(bytes, file));
      equal(model.tiles.length > 0, true, `${file} should hold tiles`);
      equal(model.residue.length, 0, `${file} should have no trailing bytes`);
      // Compare the typed arrays directly: spreading 51 MB of tilesets into number arrays cost ~2.5 s of
      // the sweep's runtime and proves nothing extra.
      deepEqual(unwrap(writeTileset(model)), bytes, `${file} should round-trip exactly`);
    }
  },
);
