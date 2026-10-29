// The tile bitmap of `docs/spec/formats/tiles.md#tile-bitmap-tbm` (AD-18):
// the header, the inclusive bounds, the x-outer/y-inner cell grid with its
// padding row and column, the three tints, the cell helper, and the writer's
// refusals — plus the three committed examples under `docs/spec/examples/`.
//
// The reader never throws, so the tests assert on values and on the error's
// offset and section rather than on exceptions. The synthetic input is built here
// byte by byte from the layout, so no test can pass by sharing the writer's code.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BinaryReader,
  compositeTileBitmap,
  readTileBitmap,
  TILE_BITMAP_CELL_SIZE,
  tileBitmapCell,
  TILE_BITMAP_MAGIC,
  TILE_BITMAP_SECTION,
  writeTileBitmap,
  type Result,
  type TileBitmap,
  type TileBitmapCell,
  type TileBitmapTile,
} from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

/** One synthetic cell: its tile reference and its three tints. */
type CellFields = readonly [tile: string, r: number, g: number, b: number];

/** The fields a synthetic tile bitmap lets a test vary; the bounds are stored raw. */
interface BuildOptions {
  readonly magic?: string;
  readonly major?: number;
  readonly minor?: number;
  /** The stored `width` bound, written verbatim (so `-1` is testable). */
  readonly width?: number;
  /** The stored `height` bound, written verbatim. */
  readonly height?: number;
  readonly cells?: readonly CellFields[];
  readonly tail?: readonly number[];
}

/**
 * Serialise a synthetic tile bitmap straight from `docs/spec/formats/tiles.md#tile-bitmap-tbm`, byte by byte.
 * No core writer is involved, so a test cannot pass by sharing the writer code.
 */
function buildBytes(options: BuildOptions = {}): Uint8Array {
  const out: number[] = [];
  const pushI16 = (value: number): void => {
    const stored = value & 0xffff;
    out.push(stored & 0xff, (stored >> 8) & 0xff);
  };
  const pushString = (text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      out.push(text.charCodeAt(i) & 0xff);
    }
    out.push(0);
  };
  pushString(options.magic ?? TILE_BITMAP_MAGIC);
  pushI16(options.major ?? 3);
  pushI16(options.minor ?? 0);
  pushI16(options.width ?? 0);
  pushI16(options.height ?? 0);
  for (const [tile, r, g, b] of options.cells ?? []) {
    pushString(tile);
    pushI16(r);
    pushI16(g);
    pushI16(b);
  }
  for (const byte of options.tail ?? []) {
    out.push(byte & 0xff);
  }
  return new Uint8Array(out);
}

/** A cell with zeroed tints, for the tests that vary only the tile reference. */
function plainCell(tile: string): TileBitmapCell {
  return { tile, r: 0, g: 0, b: 0 };
}

/** Read a committed example from `docs/spec/examples/`. */
function exampleBytes(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(join(repoRoot, "docs", "spec", "examples", relative)));
}

test("reads the header, the bounds and every cell, x outer and y inner", () => {
  const bytes = buildBytes({
    width: 1,
    height: 1,
    cells: [
      ["village.tst8", 1, 2, 3],
      ["village.tst9", -4, 5, -6],
      ["", 0, 0, 0],
      ["grass.iso2", 255, -255, 0],
    ],
  });
  const reader = new BinaryReader(bytes);
  const bitmap = unwrap(readTileBitmap(reader));
  equal(bitmap.magic, TILE_BITMAP_MAGIC);
  equal(bitmap.major, 3);
  equal(bitmap.minor, 0);
  equal(bitmap.width, 1);
  equal(bitmap.height, 1);
  equal(bitmap.cells.length, 4);
  deepEqual(bitmap.cells, [
    { tile: "village.tst8", r: 1, g: 2, b: 3 },
    { tile: "village.tst9", r: -4, g: 5, b: -6 },
    { tile: "", r: 0, g: 0, b: 0 },
    { tile: "grass.iso2", r: 255, g: -255, b: 0 },
  ]);
  equal(bitmap.residue.length, 0);
  equal(reader.remaining, 0, "the reader consumes the whole file");
  equal(reader.offset, bytes.length);
});

test("n means n + 1 stored cells on each axis, and the padding row and column are kept", () => {
  const cells: CellFields[] = [];
  for (let x = 0; x <= 2; x += 1) {
    for (let y = 0; y <= 1; y += 1) {
      cells.push([`tile_${x}_${y}.gph`, x, y, 0]);
    }
  }
  const bitmap = unwrap(readTileBitmap(new BinaryReader(buildBytes({ width: 2, height: 1, cells }))));
  equal(bitmap.cells.length, 6, "(width + 1) x (height + 1)");
  deepEqual(bitmap.cells[2], { tile: "tile_1_0.gph", r: 1, g: 0, b: 0 });
  // The padding cells are stored, not dropped: x == width and y == height are present.
  deepEqual(bitmap.cells[4], { tile: "tile_2_0.gph", r: 2, g: 0, b: 0 });
  deepEqual(bitmap.cells[5], { tile: "tile_2_1.gph", r: 2, g: 1, b: 0 });
  equal(bitmap.cells.length, (bitmap.width + 1) * (bitmap.height + 1));
});

test("a bound of -1 means no cells, and the file ends after the two bounds", () => {
  for (const options of [{ width: -1 }, { height: -1 }, { width: -1, height: -1 }]) {
    const bytes = buildBytes(options);
    const reader = new BinaryReader(bytes);
    const bitmap = unwrap(readTileBitmap(reader));
    equal(bitmap.cells.length, 0);
    equal(bitmap.width, options.width ?? 0);
    equal(bitmap.height, options.height ?? 0);
    equal(reader.remaining, 0);
    deepEqual(unwrap(writeTileBitmap(bitmap)), bytes, "it writes back to the same bytes");
  }
});

test("width 0 and height 0 store one cell", () => {
  const bytes = buildBytes({ width: 0, height: 0, cells: [["only.tst1", 7, 7, 7]] });
  const bitmap = unwrap(readTileBitmap(new BinaryReader(bytes)));
  equal(bitmap.cells.length, 1);
  deepEqual(bitmap.cells[0], { tile: "only.tst1", r: 7, g: 7, b: 7 });
  // Only the cell (0, 0) exists — nothing is drawn at width 0, and there is no (1, 0).
  deepEqual(tileBitmapCell(bitmap, 0, 0), { tile: "only.tst1", r: 7, g: 7, b: 7 });
  equal(tileBitmapCell(bitmap, 1, 0), undefined);
});

test("the cell helper reads by (x, y) in the file's x-outer, y-inner order", () => {
  const bitmap = unwrap(
    readTileBitmap(
      new BinaryReader(
        buildBytes({
          width: 1,
          height: 2,
          cells: [
            ["a.tst1", 0, 0, 0],
            ["b.tst2", 0, 0, 0],
            ["c.tst3", 0, 0, 0],
            ["d.tst4", 0, 0, 0],
            ["e.tst5", 0, 0, 0],
            ["f.tst6", 0, 0, 0],
          ],
        }),
      ),
    ),
  );
  deepEqual(tileBitmapCell(bitmap, 0, 0), plainCell("a.tst1"));
  deepEqual(tileBitmapCell(bitmap, 0, 1), plainCell("b.tst2"));
  deepEqual(tileBitmapCell(bitmap, 0, 2), plainCell("c.tst3"), "the padding row");
  deepEqual(tileBitmapCell(bitmap, 1, 0), plainCell("d.tst4"));
  deepEqual(tileBitmapCell(bitmap, 1, 2), plainCell("f.tst6"), "the padding corner");

  // Out of the grid: past an axis, negative or fractional.
  equal(tileBitmapCell(bitmap, 2, 0), undefined);
  equal(tileBitmapCell(bitmap, 0, 3), undefined);
  equal(tileBitmapCell(bitmap, -1, 0), undefined);
  equal(tileBitmapCell(bitmap, 0.5, 0), undefined);

  const empty = unwrap(readTileBitmap(new BinaryReader(buildBytes({ width: -1, height: -1 }))));
  equal(tileBitmapCell(empty, 0, 0), undefined);
});

test("a bound below -1 is refused at its own offset", () => {
  const widthResult = readTileBitmap(new BinaryReader(buildBytes({ width: -2 })));
  equal(widthResult.ok, false);
  if (!widthResult.ok) {
    equal(widthResult.error.section, TILE_BITMAP_SECTION);
    // magic (14 bytes + NUL) + major + minor = the width field starts at 19.
    equal(widthResult.error.offset, 19);
    equal(widthResult.error.message.includes("-2"), true, widthResult.error.message);
  }

  const heightResult = readTileBitmap(new BinaryReader(buildBytes({ height: -32768 })));
  equal(heightResult.ok, false);
  if (!heightResult.ok) {
    equal(heightResult.error.section, TILE_BITMAP_SECTION);
    equal(heightResult.error.offset, 21);
    equal(heightResult.error.message.includes("-32768"), true, heightResult.error.message);
  }
});

test("a bound the file cannot pay for is refused before anything is allocated", () => {
  const bytes = buildBytes({ width: 32767, height: 32767 });
  const reader = new BinaryReader(bytes);
  const result = readTileBitmap(reader);
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, TILE_BITMAP_SECTION);
  // The cell block starts at 19 + 2 + 2 = 23; nothing was read from it.
  equal(result.error.offset, 23);
  equal(reader.offset, 23, "the reader did not walk the claimed cells");
  equal(result.error.message.includes("1073741824"), true, result.error.message);
  equal(result.error.message.includes("remain"), true, result.error.message);
});

test("a file that ends inside a cell is refused at the cell's first byte", () => {
  // An unterminated tile reference: 9 bytes of "cell" remain, so the bound check
  // passes and the string scan is what fails.
  const bytes = buildBytes({ width: 0, height: 0, cells: [["abcdefghij", 0, 0, 0]] }).slice(0, 32);
  const result = readTileBitmap(new BinaryReader(bytes));
  equal(result.ok, false);
  if (!result.ok) {
    // The `str` primitive reports the unterminated string under its own `docs/spec/formats/README.md#primitive-encoding`.
    equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
    equal(result.error.offset, 23, "the cell's first byte");
    equal(result.error.message.includes("unterminated"), true, result.error.message);
  }
});

test("a file cut inside a cell's tints is refused at the missing field", () => {
  const full = buildBytes({ width: 0, height: 0, cells: [["village.tst8", 1, 2, 3]] });
  equal(full.length, 42);
  const result = readTileBitmap(new BinaryReader(full.slice(0, 41)));
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section.startsWith("docs/spec/"), true);
    // The blue tint is the field that runs off the end, at offset 40.
    equal(result.error.offset, 40);
  }
});

test("a wrong magic is refused at offset 0", () => {
  const result = readTileBitmap(new BinaryReader(buildBytes({ magic: "TK3 TILEBITMAP!" })));
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section, TILE_BITMAP_SECTION);
    equal(result.error.offset, 0);
  }
});

test("a version other than 3.0 is read as the same layout with one warning", () => {
  const bytes = buildBytes({ major: 4, minor: 9, width: 0, height: 0, cells: [["a.tst1", 0, 0, 0]] });
  const result = readTileBitmap(new BinaryReader(bytes));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.major, 4);
  equal(result.value.minor, 9);
  equal(result.value.cells.length, 1);
  equal(result.warnings.length, 1);
  equal(result.warnings[0]?.includes("4.9"), true, result.warnings[0]);
});

test("a tint outside -255..255 is kept verbatim with one warning per file", () => {
  const bytes = buildBytes({
    width: 1,
    height: 0,
    cells: [
      ["a.tst1", 1000, 0, 0],
      ["b.tst2", 0, -1000, 0],
    ],
  });
  const result = readTileBitmap(new BinaryReader(bytes));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  deepEqual(result.value.cells, [
    { tile: "a.tst1", r: 1000, g: 0, b: 0 },
    { tile: "b.tst2", r: 0, g: -1000, b: 0 },
  ]);
  equal(result.warnings.length, 1, "one warning, not one per offending tint");
  equal(result.warnings[0]?.includes("1000"), true, result.warnings[0]);
  // The kept values write back unchanged.
  deepEqual(unwrap(writeTileBitmap(result.value)), bytes);
});

test("bytes after the last cell are kept as residue with one warning and round-trip", () => {
  const bytes = buildBytes({ width: 0, height: 0, cells: [["a.tst1", 0, 0, 0]], tail: [1, 2, 3] });
  const reader = new BinaryReader(bytes);
  const result = readTileBitmap(reader);
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  deepEqual([...result.value.residue], [1, 2, 3]);
  equal(result.warnings.length, 1);
  equal(result.warnings[0]?.includes("3 trailing byte(s)"), true, result.warnings[0]);
  equal(reader.remaining, 0);
  deepEqual(unwrap(writeTileBitmap(result.value)), bytes);
});

test("a clean synthetic tile bitmap has no residue and no warnings", () => {
  const bytes = buildBytes({
    width: 1,
    height: 1,
    cells: [
      ["a.tst1", 0, 0, 0],
      ["b.tst2", 0, 0, 0],
      ["", 0, 0, 0],
      ["c.tst3", 0, 0, 0],
    ],
  });
  const result = readTileBitmap(new BinaryReader(bytes));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  deepEqual(result.warnings, []);
  equal(result.value.residue.length, 0);
  deepEqual(unwrap(writeTileBitmap(result.value)), bytes, "write(read(bytes)) equals bytes");
});

test("the writer refuses a cell count that disagrees with the bounds, naming both numbers", () => {
  const good = unwrap(
    readTileBitmap(
      new BinaryReader(
        buildBytes({
          width: 1,
          height: 1,
          cells: [
            ["a.tst1", 0, 0, 0],
            ["b.tst2", 0, 0, 0],
            ["c.tst3", 0, 0, 0],
            ["d.tst4", 0, 0, 0],
          ],
        }),
      ),
    ),
  );
  equal(good.cells.length, 4, "width 1 and height 1 store four cells");

  const result = writeTileBitmap({ ...good, cells: [plainCell("a.tst1")] });
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.message.includes("1 cell"), true, result.error.message);
  equal(result.error.message.includes("4 stored cell"), true, result.error.message);
  equal(result.error.section, TILE_BITMAP_SECTION);
});

test("the writer refuses a bound, a version or a tint the stored fields cannot hold", () => {
  const base = unwrap(
    readTileBitmap(new BinaryReader(buildBytes({ width: 0, height: 0, cells: [["a.tst1", 0, 0, 0]] }))),
  );

  const wide = writeTileBitmap({ ...base, width: -2 });
  equal(wide.ok, false);
  if (!wide.ok) {
    equal(wide.error.message.includes("-2"), true, wide.error.message);
  }

  const huge = writeTileBitmap({ ...base, height: 40000 });
  equal(huge.ok, false);
  if (!huge.ok) {
    equal(huge.error.message.includes("40000"), true, huge.error.message);
  }

  const version = writeTileBitmap({ ...base, major: -1 });
  equal(version.ok, false);
  if (!version.ok) {
    equal(version.error.message.includes("-1.0"), true, version.error.message);
  }

  const tint = writeTileBitmap({ ...base, cells: [{ tile: "a.tst1", r: 40000, g: 0, b: 0 }] });
  equal(tint.ok, false);
  if (!tint.ok) {
    equal(tint.error.message.includes("40000"), true, tint.error.message);
  }
});

test("an unencodable tile reference fails the writer at the character's index", () => {
  const base = unwrap(
    readTileBitmap(new BinaryReader(buildBytes({ width: 0, height: 0, cells: [["a.tst1", 0, 0, 0]] }))),
  );
  const result = writeTileBitmap({ ...base, cells: [{ tile: "a\u0100.tst1", r: 0, g: 0, b: 0 }] });
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.offset, 1, "the UTF-16 index of the offending character");
    equal(result.error.message.includes("U+0100"), true, result.error.message);
  }
});

// --- The committed examples under `docs/spec/examples/` ----------------------
//
// Three files authored under G7 and listed byte by byte in
// `docs/spec/examples/listings/`: the version example and the game's two
// bitmaps. Their annotated listings are the expectation below.

test("the version example parses to the last byte and round-trips", () => {
  const bytes = exampleBytes(join("versions", "tile-bitmap", "tilebitmap.tbm"));
  equal(bytes.length, 89);
  const reader = new BinaryReader(bytes);
  const result = readTileBitmap(reader);
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.width, 2);
  equal(result.value.height, 1);
  equal(result.value.cells.length, 6);
  deepEqual(
    result.value.cells.map((cell) => cell.tile),
    ["village.tst8", "", "village.tst9", "", "", ""],
  );
  equal(reader.remaining, 0);
  deepEqual(result.warnings, []);
  equal(result.value.residue.length, 0);
  deepEqual(unwrap(writeTileBitmap(result.value)), bytes);
});

test("house.tbm parses to the last byte, keeps its tints and round-trips", () => {
  const bytes = exampleBytes(join("game", "Game", "Example", "Bitmap", "house.tbm"));
  equal(bytes.length, 135);
  const reader = new BinaryReader(bytes);
  const result = readTileBitmap(reader);
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const bitmap = result.value;
  equal(bitmap.width, 2);
  equal(bitmap.height, 2);
  equal(bitmap.cells.length, 9);
  deepEqual(bitmap.cells.map((cell) => cell.tile), [
    "village.tst9",
    "village.tst8",
    "",
    "village.tst9",
    "village.tst10",
    "",
    "",
    "",
    "",
  ]);
  deepEqual(bitmap.cells[1], { tile: "village.tst8", r: 0, g: 0, b: 0 });
  equal(reader.remaining, 0);
  deepEqual(result.warnings, []);
  equal(bitmap.residue.length, 0);
  deepEqual(unwrap(writeTileBitmap(bitmap)), bytes);

  // The listing's drawn cells and the padding row and column, through the helper.
  deepEqual(tileBitmapCell(bitmap, 0, 0), plainCell("village.tst9"));
  deepEqual(tileBitmapCell(bitmap, 0, 1), plainCell("village.tst8"));
  deepEqual(tileBitmapCell(bitmap, 0, 2), plainCell(""));
  deepEqual(tileBitmapCell(bitmap, 1, 1), plainCell("village.tst10"));
  deepEqual(tileBitmapCell(bitmap, 2, 2), plainCell(""), "the padding corner");
});

test("forest.tbm parses to the last byte and round-trips", () => {
  const bytes = exampleBytes(join("game", "Game", "Example", "Bitmap", "forest.tbm"));
  equal(bytes.length, 89);
  const reader = new BinaryReader(bytes);
  const result = readTileBitmap(reader);
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.width, 1);
  equal(result.value.height, 2);
  equal(result.value.cells.length, 6);
  deepEqual(
    result.value.cells.map((cell) => cell.tile),
    ["village.tst6", "village.tst7", "", "", "", ""],
  );
  equal(reader.remaining, 0);
  deepEqual(result.warnings, []);
  deepEqual(unwrap(writeTileBitmap(result.value)), bytes);
  deepEqual(tileBitmapCell(result.value, 0, 0), plainCell("village.tst6"));
  deepEqual(tileBitmapCell(result.value, 0, 1), plainCell("village.tst7"));
});

// ---- compositing the cells into one picture ----------------------------------------------------------------
//
// A `.tbm` "can be used wherever an image file is accepted" (docs/spec/formats/tiles.md#tile-bitmap-tbm), so the
// compositor paints the drawn cells at the picture's own size: 32 pixels per cell, the tile at its own size at the
// cell's corner, its tint added to every non-transparent pixel (docs/spec/formats/tiles.md#shading, R-15).

/** A solid row-major tile, with one pixel optionally left transparent or given a distinct colour. */
function solidTile(size: number, colour: readonly [number, number, number]): TileBitmapTile {
  const rgba = new Uint8Array(size * size * 4);
  for (let at = 0; at < rgba.length; at += 4) {
    rgba[at] = colour[0];
    rgba[at + 1] = colour[1];
    rgba[at + 2] = colour[2];
    rgba[at + 3] = 255;
  }
  return { w: size, h: size, rgba };
}

/** The RGBA of one pixel of a composed picture. */
function at(picture: { readonly w: number; readonly rgba: Uint8Array }, x: number, y: number): number[] {
  const from = (y * picture.w + x) * 4;
  return [picture.rgba[from]!, picture.rgba[from + 1]!, picture.rgba[from + 2]!, picture.rgba[from + 3]!];
}

test("compositing paints the drawn cells at 32 pixels each and leaves the padding row and column out", () => {
  const bitmap = unwrap(readTileBitmap(new BinaryReader(buildBytes({
    width: 2,
    height: 1,
    cells: [
      ["a.tst1", 0, 0, 0],
      ["", 0, 0, 0],
      ["a.tst2", 0, 0, 0],
      ["", 0, 0, 0],
      ["padding.tst1", 0, 0, 0],
      ["padding.tst1", 0, 0, 0],
    ],
  }))));
  const tiles = new Map<string, TileBitmapTile>([
    ["a.tst1", solidTile(32, [0, 255, 128])],
    ["a.tst2", solidTile(32, [40, 50, 60])],
  ]);
  const picture = unwrap(compositeTileBitmap(bitmap, tiles));
  equal(TILE_BITMAP_CELL_SIZE, 32);
  equal(picture.w, 64);
  equal(picture.h, 32);
  deepEqual(at(picture, 0, 0), [0, 255, 128, 255], "the first cell's tile, with a zero tint keeping pure black and white");
  deepEqual(at(picture, 31, 31), [0, 255, 128, 255]);
  deepEqual(at(picture, 32, 0), [40, 50, 60, 255], "the second cell starts at x = 32");
  deepEqual(at(picture, 63, 31), [40, 50, 60, 255]);
  deepEqual(at(picture, 32, 31), [40, 50, 60, 255]);
});

test("compositing adds each cell's tint, with R-15's white and black substitution and one clamp", () => {
  const bitmap = unwrap(readTileBitmap(new BinaryReader(buildBytes({
    width: 2,
    height: 1,
    cells: [
      ["white.tst1", 3, -20, 0],
      ["", 0, 0, 0],
      ["edge.tst1", 5, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
    ],
  }))));
  const white = solidTile(32, [255, 255, 255]);
  const edge = solidTile(32, [0, 0, 250]);
  // A transparent pixel in the first cell must stay untouched: the picture starts at alpha 0 there.
  white.rgba[3] = 0;
  const picture = unwrap(compositeTileBitmap(bitmap, new Map([["white.tst1", white], ["edge.tst1", edge]])));
  deepEqual(at(picture, 1, 0), [248, 225, 245, 255], "pure white becomes 245 before the tint is added");
  deepEqual(at(picture, 0, 0), [0, 0, 0, 0], "a transparent pixel is not tinted");
  deepEqual(at(picture, 32, 0), [15, 10, 250, 255], "pure black becomes 10 before the tint is added, and 250 keeps its value");
});

test("compositing refuses a cell whose tile was not resolved and a picture with no drawn cells", () => {
  const bitmap = unwrap(readTileBitmap(new BinaryReader(buildBytes({
    width: 2,
    height: 1,
    cells: [
      ["a.tst1", 0, 0, 0],
      ["", 0, 0, 0],
      ["missing.tst4", 0, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
    ],
  }))));
  const refused = compositeTileBitmap(bitmap, new Map([["a.tst1", solidTile(32, [1, 2, 3])]]));
  equal(refused.ok, false);
  if (!refused.ok) {
    equal(refused.error.section, TILE_BITMAP_SECTION);
    equal(refused.error.message.includes("missing.tst4"), true);
    equal(refused.error.message.includes("(1, 0)"), true);
  }
  const empty = unwrap(readTileBitmap(new BinaryReader(buildBytes({ width: -1, height: -1 }))));
  const none = compositeTileBitmap(empty, new Map());
  equal(none.ok, false, "a picture with no drawn cells is an error, not an empty image");
});

test("a 16-pixel tile sits at its cell's corner and the rest of the cell stays transparent", () => {
  const bitmap = unwrap(readTileBitmap(new BinaryReader(buildBytes({
    width: 1,
    height: 1,
    cells: [
      ["small.gph", 0, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
      ["", 0, 0, 0],
    ],
  }))));
  const picture = unwrap(compositeTileBitmap(bitmap, new Map([["small.gph", solidTile(16, [7, 8, 9])]])));
  equal(picture.w, 32);
  deepEqual(at(picture, 15, 15), [7, 8, 9, 255]);
  deepEqual(at(picture, 16, 16), [0, 0, 0, 0], "outside the tile, inside the cell");
});

test("compositing refuses a picture over the shared decode contract's pixel ceiling", () => {
  const huge: TileBitmap = { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 3500, height: 3500, cells: [], residue: new Uint8Array() };
  const refused = compositeTileBitmap(huge, new Map());
  equal(refused.ok, false, "3500 x 3500 cells is 112000 x 112000 pixels");
  if (!refused.ok) equal(refused.error.message.includes("112000"), true);
});
