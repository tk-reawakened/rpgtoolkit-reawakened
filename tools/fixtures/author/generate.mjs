// Author the fixtures the legacy corpus cannot supply (ticket 2.22).
//
//   node tools/fixtures/author/generate.mjs [--out <dir>] [--check]
//
// Every byte here is written straight from `docs/spec/`'s normative format layouts
// and nothing else: this tool imports no code from `packages/core` and uses no
// `BinaryWriter`/`writeTileset`, so the committed fixtures under
// `packages/core/test/fixtures/authored/` cannot "pass by sharing the writer
// primitives". The output is deterministic — a fixed timestamp in the ZIPs and
// closed-form pixel patterns — so `--check` can re-run the generator and prove
// the committed bytes are byte-identical (guard-rail G3's spirit, G7's
// doc-first rule).
//
// What is authored, and why:
//   * detail 4, 5 and 6 tilesets(docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso) — the whole-archive crawl found tilesets
//     only at detail 1, 2 and 3, so detail 4, 5 and 6 have **no real sample
//     anywhere**: they are **authored from spec, unverified against a real
//     file**. The detail-4 set holds two tiles, so the per-tile offset stays
//     covered without the sample games.
//   * a self-contained iso-oracle project with minor-4 stacked and rotated boards
//     plus `.iso` and ordinary `.tst` tiles, because no fetched game has an
//     isometric board (docs/spec/formats/board.md#coordinates).
//   * an isometric `.iso`(docs/spec/formats/tiles.md#isometric-tiles, version 30,
//     detail 150) because the oracle needs an authored diamond tile.
//   * a `.tpk` and a `CMP1` standalone EXE(docs/spec/formats/packaging-and-paths.md#loose-folder) — no real `.tpk` or
//     standalone EXE sample has these forms (`Setup` ZIP installers did ship,
//     and `Game/<project>/` archives do, but no `.tpk` and no `CMP1` trailer was
//     found in the archive).
//   * a Setup ZIP(docs/spec/formats/packaging-and-paths.md#loose-folder `Main/` + `Game/`), a backslash-separated project ZIP,
//     and two negative EXE stubs (a Toolkit 2 launcher with a private payload
//     and no trailer, and the shape of a self-extracting `zip.exe`: a launcher
//     prefix, then a ZIP, with no trailer locating it).
//   * a deflated (method 8) copy of the `.tpk`, because real packages are
//     deflated and every other fixture here is STORE.
//   * three Windows bitmaps (docs/spec/formats/images.md) — 24-bit with padded
//     rows, 1-bit with a two-entry palette, and an 8-bit RLE8 stream — so the
//     BMP decoder is pinned without a real game file in the repository.
//   * four GIFs (docs/spec/formats/images.md#gif) — still GIF87a, animated
//     three-page GIF89a with sub-rectangles and disposal, interlaced GIF89a,
//     and a 128×64 page that exercises the deferred clear code.
//   * the movement oracle's fourteen named scenes (ticket 5.2,
//     `tools/fixtures/movement/`): authored boards, actors and fixed-tick recorded
//     inputs with expected per-tick outcome facts (positions, layers, fired
//     triggers, events) derived by that directory's own reference simulation.
//     No state or draw hashes; no import from `packages/core` (the check below
//     scans for one). Written to `packages/core/test/fixtures/movement/`.
//   * the audio oracle's fifteen named scenes and authored WAV/MIDI files (ticket 6.4,
//     `tools/fixtures/audio/`): recorded effect, command and input scripts with expected
//     per-tick track states, cues, wait wake-ups and end events derived by that
//     directory's own reference timeline, plus tiny PCM, MS-ADPCM, IMA-ADPCM and MIDI files
//     with hand-worked lengths. No state or cue hashes; no import from `packages/core`.
//     Written to `packages/core/test/fixtures/audio/`.
//   * the Save/Load fixture (ticket #934): a tiny package (loose `game/` folder and `saveload.tpk`) whose board enter
//     program performs a real `Save("slot")` and, on a second launch, a real `Load("slot")`, plus the expectation
//     `saveload.expect.json` recorded from the real engine by `pnpm saveload:record` and bound to the `.tpk`'s
//     SHA-256 (see the Save/Load section below). Written to `packages/core/test/fixtures/saveload/`.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendCmp1, ascii, buildZip, concat, le16, le32 } from "./zip.mjs";
import { MOVEMENT_OUT, checkMovementCorpus, checkMovementImports, movementFixtureFiles } from "../movement/index.mjs";
import { AUDIO_OUT, audioFixtureFiles, checkAudioCorpus, checkAudioFiles, checkAudioImports } from "../audio/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const defaultOut = join(repoRoot, "packages", "core", "test", "fixtures", "authored");

/**
 * A Windows bitmap (docs/spec/formats/images.md): the 14-byte file header, the
 * 40-byte DIB header, the palette and the pixel array. `pixelBytes` is the
 * array exactly as stored (rows in file order, bottom row first for a positive
 * height, each already padded to its stride, or the RLE8 stream), so the row
 * padding is part of the fixture on purpose. `palette` is a list of
 * `[r, g, b]` triples.
 */
function bmp({ width, height, bits, palette = [], pixelBytes, compression = 0, clrUsed = palette.length }) {
  const paletteBytes = concat(palette.map(([r, g, b]) => new Uint8Array([b, g, r, 0])));
  const offBits = 14 + 40 + paletteBytes.length;
  return concat([
    ascii("BM"),
    le32(offBits + pixelBytes.length), // bfSize
    le32(0), // bfReserved1..2
    le32(offBits),
    le32(40), // biSize
    le32(width),
    le32(height), // positive: stored bottom-up
    le16(1), // biPlanes
    le16(bits),
    le32(compression),
    le32(pixelBytes.length), // biSizeImage
    le32(0), // biXPelsPerMeter
    le32(0), // biYPelsPerMeter
    le32(clrUsed), // biClrUsed (0 means the full set of 2^bits entries)
    le32(0), // biClrImportant
    paletteBytes,
    pixelBytes,
  ]);
}

/** One stored 24-bit row of `width` pixels: B, G, R per pixel, padded to 4 bytes. */
function rgb24Row(pixels) {
  const stride = Math.floor((24 * pixels.length + 31) / 32) * 4;
  const row = new Uint8Array(stride);
  pixels.forEach(([r, g, b], x) => {
    row[x * 3] = b;
    row[x * 3 + 1] = g;
    row[x * 3 + 2] = r;
  });
  return row;
}

/** One 1-bit stored row: `pixels[0]` the leftmost pixel, high bit first, padded to 4. */
function monoRow(pixels) {
  const stride = Math.floor((pixels.length + 31) / 32) * 4;
  const row = new Uint8Array(stride);
  pixels.forEach((value, x) => {
    if (value !== 0) row[x >> 3] |= 0x80 >> (x & 7);
  });
  return row;
}

/**
 * The size bits a GIF packed field stores for a colour table of `entries`
 * entries: `N` in `2^(N+1)`
 * (docs/spec/formats/images.md#logical-screen-descriptor-7-bytes-at-offset-6).
 */
function gifTableBits(entries) {
  let bits = 0;
  while (1 << (bits + 1) < entries) bits += 1;
  return bits;
}

/** A GIF colour table: three bytes per `[r, g, b]` entry. */
function gifColorTable(colors) {
  return concat(colors.map(([r, g, b]) => new Uint8Array([r, g, b])));
}

/**
 * A GIF sub-block chain (docs/spec/formats/images.md#the-sub-block-chain): the
 * payload split into 255-byte sub-blocks, then the zero terminator.
 */
function gifSubBlocks(bytes) {
  const parts = [];
  for (let at = 0; at < bytes.length; at += 255) {
    const chunk = bytes.subarray(at, at + 255);
    parts.push(new Uint8Array([chunk.length]), chunk);
  }
  parts.push(new Uint8Array([0x00]));
  return concat(parts);
}

/** A GIF header and logical screen descriptor, with the global colour table. */
function gifScreen(version, { width, height, colors, background = 0 }) {
  const bits = gifTableBits(colors.length);
  return concat([
    ascii(version),
    le16(width),
    le16(height),
    new Uint8Array([0x80 | (bits << 4) | bits, background, 0]),
    gifColorTable(colors),
  ]);
}

/** A GIF image descriptor, with the page's local colour table when `colors` is given. */
function gifImage({ left = 0, top = 0, width, height, colors, interlaced = false }) {
  const local = colors !== undefined;
  return concat([
    new Uint8Array([0x2c]),
    le16(left),
    le16(top),
    le16(width),
    le16(height),
    new Uint8Array([
      (local ? 0x80 : 0) | (interlaced ? 0x40 : 0) | (local ? gifTableBits(colors.length) : 0),
    ]),
    ...(local ? [gifColorTable(colors)] : []),
  ]);
}

/** A GIF graphic control extension, applied to the page that follows. */
function gifControl({ disposal = 0, delay = 0, transparent = -1 }) {
  const flagged = transparent >= 0;
  return concat([
    new Uint8Array([0x21, 0xf9, 0x04, ((disposal & 0x07) << 2) | (flagged ? 0x01 : 0)]),
    le16(delay),
    new Uint8Array([flagged ? transparent : 0, 0x00]),
  ]);
}

/**
 * A GIF page: its optional control extension, its image descriptor and its LZW
 * stream. `entries` is the entry count of the table the page reads through (its
 * local one, or the global one), and the minimum code size is the smallest that
 * addresses it.
 */
function gifPage({
  control,
  colors,
  left,
  top,
  width,
  height,
  interlaced = false,
  entries = colors === undefined ? 4 : colors.length,
  indices,
}) {
  const minimum = Math.max(2, gifTableBits(entries) + 1);
  return concat([
    ...(control === undefined ? [] : [gifControl(control)]),
    gifImage({ left, top, width, height, colors, interlaced }),
    new Uint8Array([minimum]),
    gifSubBlocks(lzwEncode(indices, minimum).bytes),
  ]);
}

/**
 * A GIF LZW encoder of the algorithm
 * docs/spec/formats/images.md#the-lzw-image-data-stream describes, so a fixture
 * can carry a stream a real encoder would produce: LSB-first with no padding to
 * a byte boundary, a code width that grows with the table, and — once the table
 * holds 4096 entries — no further entry (the format's deferred clear), so the
 * stream keeps emitting 12-bit codes. Returns the stream and how many **data**
 * codes it emitted after the table froze (the end code is not counted).
 */
function lzwEncode(indices, minimum) {
  const clearCode = 1 << minimum;
  const endCode = clearCode + 1;
  const bytes = [];
  let width = minimum + 1;
  let hi = clearCode + 1;
  let overflow = clearCode << 1;
  let acc = 0;
  let bits = 0;
  let afterFreeze = 0;

  const emit = (code) => {
    if (hi >= 4096) afterFreeze += 1;
    acc |= code << bits;
    bits += width;
    while (bits >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };
  const incHi = () => {
    if (hi < 4096) {
      hi += 1;
      if (hi === overflow && width < 12) {
        width += 1;
        overflow <<= 1;
      }
    }
  };

  emit(clearCode);
  let code = indices[0];
  const table = new Map();

  for (let i = 1; i < indices.length; i += 1) {
    const literal = indices[i];
    const key = (code << 16) | literal;
    if (table.has(key)) {
      code = table.get(key);
      continue;
    }
    emit(code);
    code = literal;
    incHi();
    if (hi < 4096) {
      table.set(key, hi);
    }
  }
  emit(code);
  incHi();
  const dataCodesAfterFreeze = afterFreeze;
  emit(endCode);
  if (bits > 0) bytes.push(acc & 0xff);
  return { bytes: new Uint8Array(bytes), afterFreeze: dataCodesAfterFreeze };
}

/** The four-colour table every GIF fixture below shares. */
const GIF_COLORS = [
  [10, 20, 30],
  [40, 50, 60],
  [70, 80, 90],
  [100, 110, 120],
];

/**
 * A still GIF87a (docs/spec/formats/images.md#gif): 3×2, a four-entry global
 * colour table and no control extension, so its delay is 0, it has no
 * transparent index and its disposal is 0.
 */
function gifStill87a() {
  const indices = [];
  for (let k = 0; k < 6; k += 1) indices.push(k & 3);
  return concat([
    gifScreen("GIF87a", { width: 3, height: 2, colors: GIF_COLORS }),
    gifPage({ width: 3, height: 2, indices }),
    new Uint8Array([0x3b]),
  ]);
}

/**
 * A three-page GIF89a on a 4×3 screen: page 1 full-screen with a transparent
 * index 1 and a 10-hundredths delay, page 2 a 2×2 sub-rectangle at (1, 1) with
 * its own two-entry local table, no delay and disposal 2 (restore to
 * background), and page 3 the same 2×2 rectangle again with a 20-hundredths
 * delay, so its frame shows nothing of page 2.
 */
function gifAnimated() {
  const first = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) first.push((x + y) & 3);
  }
  const second = [];
  const third = [];
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      second.push((x + y) & 1);
      third.push((x + y + 1) & 3);
    }
  }
  return concat([
    gifScreen("GIF89a", { width: 4, height: 3, colors: GIF_COLORS, background: 1 }),
    gifPage({ control: { disposal: 1, delay: 10, transparent: 1 }, width: 4, height: 3, indices: first }),
    gifPage({
      control: { disposal: 2 },
      left: 1,
      top: 1,
      width: 2,
      height: 2,
      colors: [
        [200, 0, 0],
        [0, 200, 0],
      ],
      indices: second,
    }),
    gifPage({ control: { disposal: 0, delay: 20 }, left: 1, top: 1, width: 2, height: 2, indices: third }),
    new Uint8Array([0x3b]),
  ]);
}

/** The rows the four interlace passes store, in stored order. */
function gifInterlaceOrder(height) {
  const order = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ]) {
    for (let y = start; y < height; y += step) order.push(y);
  }
  return order;
}

/** An interlaced GIF89a: 5×9, so all four passes carry rows. */
function gifInterlaced() {
  const indices = [];
  for (const y of gifInterlaceOrder(9)) {
    for (let x = 0; x < 5; x += 1) indices.push((x * 2 + y * 3) & 3);
  }
  return concat([
    gifScreen("GIF89a", { width: 5, height: 9, colors: GIF_COLORS }),
    gifPage({ width: 5, height: 9, interlaced: true, indices }),
    new Uint8Array([0x3b]),
  ]);
}

/**
 * The number of data codes the full-table fixture emits after its LZW table has
 * frozen at 4096 entries. The generator refuses to build the fixture if the
 * pattern does not reach exactly this, so the committed bytes always carry the
 * deferred-clear path.
 */
const FULL_TABLE_TAIL = 110;

/**
 * The 128×64 pattern the full-table fixture encodes: a deterministic 32-bit
 * xorshift stream reduced modulo 24, over a 32-entry palette. Twenty-four
 * equally likely symbols make the LZW table fill (4096 entries) before the last
 * pixel and leave `FULL_TABLE_TAIL` codes after it, and both the generator and
 * the decoder's test reproduce the same stream.
 */
function fullTableIndices(count) {
  const indices = new Uint8Array(count);
  let state = 49;
  for (let k = 0; k < count; k += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    indices[k] = state % 24;
  }
  return indices;
}

/** The 32-entry grey palette the full-table fixture reads through. */
const FULL_TABLE_COLORS = Array.from({ length: 32 }, (_, k) => [k * 8, k * 8, k * 8]);

/**
 * A GIF whose LZW table fills and then keeps emitting 12-bit codes: 128×64 of
 * the pattern above fills the 4096-entry table before the last pixel, and the
 * tail of the stream is a run of 12-bit codes that add no entry (the deferred
 * clear). The generator refuses to build it unless the tail is exactly
 * `FULL_TABLE_TAIL` codes.
 */
function gifTableFull() {
  const indices = fullTableIndices(128 * 64);
  const stream = lzwEncode(indices, 5);
  if (stream.afterFreeze !== FULL_TABLE_TAIL) {
    throw new Error(
      `the full-table fixture emits ${stream.afterFreeze} data codes after its table froze; ` +
        `${FULL_TABLE_TAIL} are expected`,
    );
  }
  return concat([
    gifScreen("GIF87a", { width: 128, height: 64, colors: FULL_TABLE_COLORS }),
    gifPage({ width: 128, height: 64, entries: FULL_TABLE_COLORS.length, indices }),
    new Uint8Array([0x3b]),
  ]);
}

/**
 * One tileset of docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso: the 6-byte header (`i16 version`, `i16 tileCount`,
 * `i16 detail`) then tightly packed column-major pixels. `pixel(k, tile)` returns
 * the stored bytes of the k-th stored pixel of tile `tile`, so a fixture's
 * content is a closed-form function the tests can reproduce.
 */
function tileset(version, detail, size, bytesPerPixel, pixel, count = 1) {
  const pixels = new Uint8Array(count * size * size * bytesPerPixel);
  for (let tile = 0; tile < count; tile += 1) {
    for (let k = 0; k < size * size; k += 1) {
      const at = (tile * size * size + k) * bytesPerPixel;
      if (bytesPerPixel === 3) {
        const [r, g, b] = pixel(k, tile);
        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
      } else {
        pixels[at] = pixel(k, tile);
      }
    }
  }
  return concat([le16(version), le16(count), le16(detail), pixels]);
}

/**
 * An 8-bit palette pixel: the stored index is `k mod 256`, so the transparent
 * key (index 255) appears once per 256-pixel block. `tile` shifts the pattern,
 * so two tiles of one set never look alike.
 */
const palettePixel = (k, tile) => (k + tile * 64) & 0xff;

/** A 24-bit pixel that never hits the transparent key R=0, G=1, B=2(docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso). */
const rgbPixel = (k) => [k & 0xff, (k >> 8) & 0xff, 7];

const zstr = (value) => concat([ascii(value), new Uint8Array([0])]);
const i16 = (value) => le16(value);
const i32 = (value) => le32(value);

/**
 * A minor-4 board writer assembled directly from docs/spec/formats/board.md.
 * The parser's strings are NUL-terminated CP1252 and all numeric fields are
 * little-endian signed values.
 */
function authoredBoard({ sizeX, sizeY, sizeL, coordType, lut, cells, shades, lights = [], ambient = [0, 0, 0], start = [1, 1, 1], enterPrg = "" }) {
  const grid = (coordType & 3) === 2 ? sizeX + sizeY : sizeX;
  const gridHeight = (coordType & 3) === 2 ? grid : sizeY;
  const total = grid * gridHeight * sizeL;
  const matrix = new Array(total).fill(0);
  for (const [index, tile] of cells) matrix[index] = tile;
  const stream = [];
  for (let index = 0; index < matrix.length;) {
    let end = index + 1;
    while (end < matrix.length && matrix[end] === matrix[index]) end += 1;
    const count = end - index;
    if (count > 1) stream.push(i16(-count), i16(matrix[index]));
    else stream.push(i16(matrix[index]));
    index = end;
  }
  const out = [
    zstr("RPGTLKIT BOARD"), i16(3), i16(4),
    i16(sizeX), i16(sizeY), i16(sizeL), i16(coordType),
    i16(lut.length - 1), ...lut.map(zstr), ...stream,
    i16(shades.length - 1),
  ];
  for (const shade of shades) {
    out.push(i32(shade.layer));
    for (const [count, r, g, b] of shade.runs) out.push(i16(count), i16(r), i16(g), i16(b));
  }
  out.push(
    lights.length - 1 < 0 ? i16(-1) : i16(lights.length - 1), // light upper bound
  );
  for (const light of lights) {
    out.push(i32(light.layer), i32(light.type), i16(light.nodes.length - 1));
    for (const [x, y] of light.nodes) out.push(i32(x), i32(y));
    out.push(i16(light.colours.length - 1));
    for (const colour of light.colours) out.push(i16(colour.r), i16(colour.g), i16(colour.b));
  }
  out.push(
    i16(-1), // vectors
    i16(-1), // programs
    i16(-1), // sprites
    i16(-1), // images
    i16(-1), // threads
    i16(-1), // constants
    ...Array.from({ length: sizeL + 1 }, (_, layer) => zstr(`layer-${layer + 1}`)),
    zstr(""), zstr(""), zstr(""), zstr(""), // N/S/E/W links
    zstr(""), i32(0), i32(0), // background image/type/colour
    zstr(""), zstr(enterPrg), zstr(""), // music, enter program, battle background
    i16(-1), i16(0), i16(0), // battle skill/allow battles/disable saving
    i16(ambient[0]), i16(ambient[1]), i16(ambient[2]),
    i16(start[0]), i16(start[1]), i16(start[2]),
  );
  return concat(out);
}

const ISO_ORACLE_ISO = tileset(30, 150, 32, 3, rgbPixel);
const ISO_ORACLE_TST = tileset(20, 1, 32, 3, rgbPixel);
const STACKED_BOARD = authoredBoard({
  sizeX: 3,
  sizeY: 5,
  sizeL: 2,
  coordType: 1,
  lut: ["", "iso-oracle-grass.iso1", "iso-oracle-ordinary.tst1"],
  cells: [
    [0, 1], [1, 2], [2, 1], [5, 2], [7, 1], [10, 1], [12, 2],
    [15, 2], [16, 1], [17, 2], [23, 1], [26, 1],
  ],
  shades: [{ layer: 0, runs: [[1, 18, -12, 4], [14, 0, 0, 0]] }],
  start: [2, 3, 1],
});
const ROTATED_BOARD = authoredBoard({
  sizeX: 3,
  sizeY: 2,
  sizeL: 2,
  coordType: 2,
  lut: ["", "iso-oracle-grass.iso1", "iso-oracle-ordinary.tst1"],
  cells: [
    [2, 1], [8, 2], [12, 1], [18, 2], [22, 1],
    [25, 2], [31, 1], [37, 2], [42, 1], [48, 2],
  ],
  shades: [{ layer: 0, runs: [[3, -8, 12, 0], [22, 0, 0, 0]] }],
  start: [2, 1, 1],
});

// A flat, authored 24-bit tileset keeps the light oracle readable: tile 1 is
// mid-grey and tiles 2-5 form a coloured strip. None is the transparent key.
const LIGHT_COLOURS = [[128, 128, 128], [220, 64, 64], [64, 196, 80], [72, 96, 220], [224, 176, 48]];
const LIGHT_TST = tileset(20, 2, 16, 3, (_k, tile) => LIGHT_COLOURS[tile] ?? LIGHT_COLOURS[0], LIGHT_COLOURS.length);
const LIGHT_LUT = ["", ...LIGHT_COLOURS.map((_colour, tile) => `light-oracle.tst${tile + 1}`)];
const LIGHT_CELLS = Array.from({ length: 32 }, (_unused, index) => [index, index < 8 ? 2 + (index % 4) : 1]);
const asRgb = ([r, g, b]) => ({ r, g, b });
const ellipseLight = (edge, centre) => ({ layer: 1, type: 0, nodes: [[128, 64], [224, 64], [128, 112]], colours: [asRgb(edge), asRgb(centre)] });
const gradientLight = (start, end) => ({ layer: 1, type: 1, nodes: [[0, 16], [256, 112]], colours: [asRgb(start), asRgb(end)] });
const clippedGradientLight = (start, end) => ({
  layer: 1,
  type: 2,
  nodes: [[0, 112], [256, 16], [64, 16], [192, 16], [192, 112], [64, 112]],
  colours: [asRgb(start), asRgb(end)],
});
const LIGHT_BOARD_BASE = { sizeX: 8, sizeY: 4, sizeL: 1, coordType: 0, lut: LIGHT_LUT, cells: LIGHT_CELLS, shades: [] };
const LIGHT_ELLIPSE_BOARD = authoredBoard({ ...LIGHT_BOARD_BASE, lights: [ellipseLight([-80, -40, -20], [80, 120, 40])] });
const LIGHT_GRADIENT_BOARD = authoredBoard({ ...LIGHT_BOARD_BASE, lights: [gradientLight([-70, 20, -40], [90, -20, 70])] });
const LIGHT_CLIPPED_BOARD = authoredBoard({ ...LIGHT_BOARD_BASE, lights: [clippedGradientLight([-30, -80, 40], [110, 60, -40])] });
const LIGHT_OVERLAP_BOARD = authoredBoard({
  ...LIGHT_BOARD_BASE,
  lights: [
    ellipseLight([20, 0, 40], [180, 140, 180]),
    gradientLight([80, 30, 0], [80, 30, 0]),
    ellipseLight([255, 255, 255], [255, 255, 255]),
  ],
});
const LIGHT_NIGHT_BOARD = authoredBoard({
  ...LIGHT_BOARD_BASE,
  ambient: [-110, -110, -110],
  lights: [ellipseLight([0, 0, 0], [130, 130, 130])],
});
// Round-7 boundary: centre and radii chosen so ellipse boundary points land exactly on
// 32x32 cell centres, e.g. (208,80) and (112,16); both must stay unlit.
const LIGHT_BOUNDARY_BOARD = authoredBoard({
  ...LIGHT_BOARD_BASE,
  lights: [{ layer: 1, type: 0, nodes: [[112, 80], [208, 80], [112, 144]], colours: [asRgb([-80, -40, -20]), asRgb([80, 120, 40])] }],
});

const AUTHORED = {
  // Authored from spec, unverified against a real file (no detail-4 sample
  "light-oracle.tst": LIGHT_TST,
  "light-oracle-ellipse.brd": LIGHT_ELLIPSE_BOARD,
  "light-oracle-gradient.brd": LIGHT_GRADIENT_BOARD,
  "light-oracle-clipped.brd": LIGHT_CLIPPED_BOARD,
  "light-oracle-overlap.brd": LIGHT_OVERLAP_BOARD,
  "light-oracle-night.brd": LIGHT_NIGHT_BOARD,
  "light-oracle-boundary.brd": LIGHT_BOUNDARY_BOARD,

  // exists in the archive). Two tiles pin the per-tile offset(docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso).
  "detail4.tst": tileset(20, 4, 16, 1, palettePixel, 2),
  // Authored from spec, unverified against a real file (no detail-5 sample).
  "detail5.tst": tileset(20, 5, 32, 1, palettePixel),
  "iso.iso": ISO_ORACLE_ISO,
  // The iso oracle project is generated from the board and tile layouts in the
  // normative spec; its two boards exercise both effective grid conventions.
  "iso-oracle-grass.iso": ISO_ORACLE_ISO,
  "iso-oracle-ordinary.tst": ISO_ORACLE_TST,
  "iso-oracle-stacked.brd": STACKED_BOARD,
  "iso-oracle-rotated.brd": ROTATED_BOARD,

  // The image decoders' fixtures (docs/spec/formats/images.md). A 24-bit
  // bitmap whose 3-pixel rows pad to 12 bytes, stored bottom-up; a 1-bit
  // bitmap with two palette entries (biClrUsed 0) and 10-pixel rows; and an
  // 8-bit RLE8 stream that exercises a run, an odd-length absolute run with
  // its padding byte, end-of-line, a delta and end-of-bitmap.
  "bmp-rgb24.bmp": bmp({
    width: 3,
    height: 2,
    bits: 24,
    pixelBytes: concat([
      rgb24Row([[10, 20, 30], [40, 50, 60], [70, 80, 90]]), // bottom row
      rgb24Row([[100, 110, 120], [130, 140, 150], [160, 170, 180]]), // top row
    ]),
  }),
  "bmp-mono1.bmp": bmp({
    width: 10,
    height: 2,
    bits: 1,
    clrUsed: 0,
    palette: [[255, 255, 255], [0, 0, 0]],
    pixelBytes: concat([
      monoRow([1, 0, 1, 0, 1, 0, 1, 0, 1, 0]), // bottom row
      monoRow([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]), // top row
    ]),
  }),
  "bmp-rle8.bmp": bmp({
    width: 4,
    height: 3,
    bits: 8,
    compression: 1,
    palette: [[10, 20, 30], [200, 0, 0], [0, 200, 0], [0, 0, 200]],
    pixelBytes: new Uint8Array([
      0x03, 0x01, // run: three pixels of index 1
      0x01, 0x02, // run: one pixel of index 2
      0x00, 0x00, // end of line
      0x00, 0x03, 0x03, 0x00, 0x03, 0x00, // absolute run of 3 bytes, then padding
      0x01, 0x00, // run: one pixel of index 0
      0x00, 0x00, // end of line
      0x00, 0x02, 0x01, 0x00, // delta: right 1
      0x02, 0x02, // run: two pixels of index 2
      0x00, 0x01, // end of bitmap
    ]),
  }),

  // The GIF decoder's fixtures (docs/spec/formats/images.md#gif): a still
  // GIF87a with no control extension, a three-page GIF89a whose middle page is
  // a sub-rectangle with its own local table and disposal 2, an interlaced
  // GIF89a 5 wide and 9 tall so all four passes carry rows, and a 128×64 page
  // whose LZW stream fills the table and then keeps emitting 12-bit codes
  // (the deferred clear).
  "gif-still87a.gif": gifStill87a(),
  "gif-anim89a.gif": gifAnimated(),
  "gif-interlace.gif": gifInterlaced(),
  "gif-table-full.gif": gifTableFull(),
};

/**
 * The project tree the authored packages carry: a project folder's contents at
 * the archive root, plus the legacy pak's root `main.gam`(docs/spec/formats/packaging-and-paths.md#loose-folder). The tileset
 * is the authored detail-4 one, so a package fixture carries a real authored
 * tileset rather than arbitrary bytes.
 */
function projectFiles() {
  return [
    { name: "main.gam", bytes: concat([ascii("RPGTLKIT MAIN"), new Uint8Array([0]), le16(2), le16(9), new Uint8Array(8)]) },
    { name: "Tiles/set.tst", bytes: AUTHORED["detail4.tst"] },
    { name: "Boards/start.brd", bytes: concat([ascii("RPGTLKIT BOARD"), new Uint8Array([0]), le16(3), le16(4), ascii("authored board")]) },
    { name: "Media/theme.mid", bytes: concat([ascii("MThd"), le32(6)]) },
    { name: "README.txt", bytes: ascii("Authored fixture project for the package-loader tests (ticket 2.22).\n") },
  ];
}

/** A `.tpk`(docs/spec/formats/packaging-and-paths.md#loose-folder): the project folder at the archive root, `main.gam` at the root. */
function tpk() {
  return buildZip(projectFiles());
}

/** A Setup ZIP(docs/spec/formats/packaging-and-paths.md#loose-folder): a plain ZIP of the `Main/` and `Game/` folders. */
function setupZip(files) {
  const main = files.find((file) => file.name === "main.gam");
  const project = files.filter((file) => file.name !== "main.gam");
  return buildZip([
    { name: "Main/game.gam", bytes: main.bytes },
    ...project.map((file) => ({ name: `Game/demo/${file.name}`, bytes: file.bytes })),
  ]);
}

/** The same project ZIP with the legacy backslash separators in its entry names. */
function backslashZip(files) {
  return buildZip(files.map((file) => ({ name: file.name.replaceAll("/", "\\"), bytes: file.bytes })));
}

/**
 * The same project ZIP again, but every entry deflated (method 8) over a
 * stored-block DEFLATE stream. Real `.tpk` and Setup files are deflated, so this
 * pins the reader's method-8 path without any compressor.
 */
function deflatedTpk(files) {
  return buildZip(files.map((file) => ({ name: file.name, bytes: file.bytes, deflate: true })));
}

/** A `CMP1` standalone EXE(docs/spec/formats/packaging-and-paths.md#loose-folder): an engine image, the ZIP, then the 12-byte trailer. */
function cmp1Exe(zip) {
  const prefix = new Uint8Array(64).fill(0x90);
  return appendCmp1(prefix, zip);
}

/** A Toolkit 2 launcher stub: an `MZ` image with no `CMP1` trailer(docs/spec/formats/packaging-and-paths.md#loose-folder, L21). */
function tk2Stub() {
  const stub = new Uint8Array(100).fill(0x90);
  stub.set([0x4d, 0x5a], 0); // "MZ"
  stub[2] = 0x90;
  stub[3] = 0x00;
  return stub;
}

/** A self-extracting `zip.exe` shape: a PE-ish prefix followed by a ZIP, no trailer(docs/spec/formats/packaging-and-paths.md#loose-folder, L21). */
function pePrefixedZip(zip) {
  const prefix = new Uint8Array(64).fill(0x90);
  prefix.set([0x4d, 0x5a], 0); // "MZ"
  return concat([prefix, zip]);
}

/** Every authored fixture, as `name -> bytes`, in a fixed order. */
export function authoredFixtures() {
  const files = projectFiles();
  const zip = tpk();
  return [
    ...Object.entries(AUTHORED),
    ["package.tpk", zip],
    ["package-deflated.tpk", deflatedTpk(files)],
    ["setup.zip", setupZip(files)],
    ["backslash.zip", backslashZip(files)],
    ["package-cmp1.exe", cmp1Exe(zip)],
    ["exe-tk2-stub.exe", tk2Stub()],
    ["exe-pe-zip.exe", pePrefixedZip(zip)],
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// The Save/Load fixture (ticket #934, plan AC2).
//
// A tiny boot-mode game whose board enter program performs a real `Save("slot")` and, on the next launch, a real
// `Load("slot")` (docs/spec/engine/main-loop-and-startup.md#e-120, #e-121; docs/spec/formats/save-game.md
// "Reawakened full-engine save and load"). Every byte is written from the format pages here, not by `packages/core`.
// The *expectation* beside it (`saveload.expect.json`: the `saveBlob`/`loadBlob` request key, the save's byte length
// and the state hashes) can only come from running the real engine, which this tool must not import; it is recorded
// by `pnpm saveload:record` (tools/fixtures/saveload/record.mjs) and bound to these bytes by their SHA-256, so
// `--check` fails when the fixture changes and the expectation was not re-recorded. A drift of the engine itself is
// caught by packages/runner-harness/test/saveload.test.ts, which re-runs the fixture and compares every value.
// ---------------------------------------------------------------------------------------------------------------

/** Where the Save/Load fixture goes: beside `authored/` by default, else under the output directory. */
export const SAVELOAD_OUT = join(repoRoot, "packages", "core", "test", "fixtures", "saveload");
function saveloadOut(out) {
  return out === defaultOut ? SAVELOAD_OUT : join(out, "saveload");
}

/**
 * The enter program. Launch one finds no "slot" save, so `Load` fails and the script falls through to write the
 * distinctive value, save it, then change it. Launch two finds the save: `Load` replaces the live state with the
 * snapshot (the value as it was *at* the save, 4242) and the saved thread resumes after `Save`, never re-running
 * the first lines (so a second `saveBlob` means the load restored nothing).
 */
const SAVELOAD_PROGRAM = [
  "// Save/Load fixture (#934). See tools/fixtures/author/generate.mjs.",
  'load("slot")',
  "marker = 4242",
  'save("slot")',
  "delay(1)",
  "marker = 17",
  "end()",
  "",
].join("\n");

/**
 * A minor-9 main file written from docs/spec/formats/main-file.md#layout, row by row. Run-time key, enemy and
 * plugin lists each carry one empty entry (upper bound 0) so the file stays a few hundred bytes.
 */
function saveloadMainFile() {
  const byte = (value) => new Uint8Array([value & 0xff]);
  return concat([
    zstr("RPGTLKIT MAIN"), i16(2), i16(9), // 1-3: header, major, minor
    i16(1), zstr("NOCODE"), // 4-5: registered, registration code
    zstr(""), zstr("Save Load Fixture"), // 6-7: projectPath (ignored from a package), gameTitle
    i16(1), i16(0), i16(0), // 8-10: mainScreenType, extendToFullScreen, mainResolution (640x480)
    i16(0), zstr(""), // 12-13: mainDisableProtectReg, language file (row 11 is minor < 3 only)
    zstr("start.prg"), zstr("start.brd"), zstr(""), // 14-16: startupPrg, initBoard, initChar
    zstr(""), i16(0), i16(13), i16(32), // 17-20: runTime, runKey, menuKey, key
    i16(0), i16(0), zstr(""), // 21-22: run-time keys UB, one empty (key, program)
    zstr(""), zstr(""), // 23-24: menuPlugin, fightPlugin
    i16(1), // 26: fightGameYn (1 = random battles disabled)
    i16(0), zstr(""), i16(0), // 27-28: enemy list UB, one empty (enemy, skill)
    i16(0), i32(0), // 29-30: fightType, chances
    i16(0), zstr(""), zstr(""), // 31-32, 34: fprgYn, fightPrg, gameOverPrg (row 33 is minor < 3 only)
    zstr(""), zstr(""), // 35-36: skinButton, skinWindow
    i16(0), zstr(""), // 37, 38b: plugin list UB, one empty plugin
    i16(0), i16(0), i32(0), // 39-41: day/night flag, type, length
    zstr(""), zstr(""), zstr(""), // 42-44: cursor sounds
    byte(0), byte(2), // 45-46: useJoystick, colorDepth (32-bit)
    byte(128), byte(0), // 47-48: gameSpeed (speed + 128), pixelMovement (tile)
    zstr(""), byte(0), byte(0), i32(0), // 50-53: mouseCursor, hotSpotX, hotSpotY, transpColor (row 49 is minor = 5 only)
    i32(0), i32(0), byte(0), // 54-56: resX, resY, bFpsInTitleBar
    i16(2), i32(0), i32(0x00ffffff), i32(5), // 57-60: pfHeuristic, drawVectors, pathColor, movementControls
    i16(0xcd), i16(0xd0), i16(0xcb), i16(0xc8), i16(0), i16(0), i16(0), i16(0), // 61: movement keys
  ]);
}

/** The Save/Load game's files, in archive order. */
function saveloadGameFiles() {
  const board = authoredBoard({ sizeX: 2, sizeY: 2, sizeL: 1, coordType: 0, lut: [""], cells: [], shades: [], enterPrg: "saveload.prg" });
  return [
    { name: "main.gam", bytes: saveloadMainFile() },
    { name: "Boards/start.brd", bytes: board },
    { name: "Prg/start.prg", bytes: ascii("end()\n") },
    { name: "Prg/saveload.prg", bytes: ascii(SAVELOAD_PROGRAM) },
  ];
}

/** The Save/Load fixture's committed bytes as `relative name -> bytes`: the loose game folder and its `.tpk`. */
export function saveloadFixtureFiles() {
  const files = saveloadGameFiles();
  return [...files.map((file) => [`game/${file.name}`, file.bytes]), ["saveload.tpk", buildZip(files)]];
}

function writeSaveloadFixtures(dir) {
  for (const [name, bytes] of saveloadFixtureFiles()) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
}

function checkSaveloadFixtures(dir) {
  const problems = [];
  const files = saveloadFixtureFiles();
  for (const [name, expected] of files) {
    let actual;
    try { actual = readFileSync(join(dir, name)); } catch { problems.push(`saveload/${name}: missing`); continue; }
    if (!actual.equals(expected)) problems.push(`saveload/${name}: differs from a fresh run`);
  }
  // The expectation is recorded from the real engine, never written here; it must describe exactly these bytes.
  const tpkBytes = files.find(([name]) => name === "saveload.tpk")?.[1];
  let expectation;
  try { expectation = JSON.parse(readFileSync(join(dir, "saveload.expect.json"), "utf8")); } catch { problems.push("saveload/saveload.expect.json: missing or not JSON (run `pnpm saveload:record`)"); return problems; }
  const digest = createHash("sha256").update(tpkBytes).digest("hex");
  if (expectation?.fixture?.sha256 !== digest || expectation?.fixture?.size !== tpkBytes.length) {
    problems.push(`saveload/saveload.expect.json: recorded for a different fixture (expected sha256 ${digest}, ${tpkBytes.length} bytes); re-record with \`pnpm saveload:record\``);
  }
  return problems;
}

const defaultSceneOut = join(repoRoot, "golden", "scenes");

const ORACLE_SCENES = {
  "S-01.json": {
    schema: 1,
    name: "S-01",
    boardFiles: ["docs/spec/examples/game/Game/Example/Boards/village.brd", "docs/spec/examples/game/Game/Example/Tiles/village.tst", "docs/spec/examples/game/Game/Example/Tiles/water.tan"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [512, 384], camera: [0, 0], include: { shading: false, images: false, sprites: false } },
    tick: 0,
  },
  "S-01b.json": {
    schema: 1,
    name: "S-01b",
    boardFiles: ["docs/spec/examples/game/Game/Example/Boards/village.brd", "docs/spec/examples/game/Game/Example/Tiles/village.tst", "docs/spec/examples/game/Game/Example/Tiles/water.tan", "docs/spec/examples/game/Game/Example/Bitmap/house.tbm"],
    sprites: [],
    ambient: [0, 0, 0],
    view: {
      viewport: [512, 384],
      camera: [0, 0],
      include: { shading: true, images: true, sprites: false },
      layerImages: [
        { type: "normal", file: "house.tbm", x: 448, y: 288, layer: 1 },
        { type: "parallax", file: "house.tbm", x: 0, y: 0, layer: 1 },
        { type: "stretch", file: "house.tbm", x: 0, y: 0, layer: 2 },
      ],
      blits: [
        { mode: "translucent", rect: [16, 16, 32, 16], alpha: 128 },
        { mode: "additive", rect: [48, 16, 32, 16], alpha: 96 },
      ],
    },
    tick: 0,
  },
  "S-01c.json": {
    schema: 1,
    name: "S-01c",
    boardFiles: ["docs/spec/examples/game/Game/Example/Boards/village.brd", "docs/spec/examples/game/Game/Example/Tiles/village.tst", "docs/spec/examples/game/Game/Example/Tiles/water.tan", "docs/spec/examples/game/Game/Example/Bitmap/house.tbm"],
    sprites: [
      { id: "player", key: "player", layer: 1, x: 208, y: 191, drawId: 1, under: [1, 2, 4], prev: [208, 191] },
      { id: "item-chest", key: "chest", layer: 1, x: 304, y: 191, drawId: 2, under: [1, 2, 4] },
    ],
    ambient: [0, 0, 0],
    view: { viewport: [512, 384], camera: [0, 0], include: { shading: true, images: true, sprites: true } },
    tick: 0,
  },
  "S-01d.json": {
    schema: 1,
    name: "S-01d",
    boardFiles: ["docs/spec/examples/game/Game/Example/Boards/village.brd", "docs/spec/examples/game/Game/Example/Tiles/village.tst", "docs/spec/examples/game/Game/Example/Tiles/water.tan", "docs/spec/examples/game/Game/Example/Bitmap/house.tbm"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [640, 480], camera: [0, 0], include: { shading: true, images: true, sprites: false }, smallBoard: "center-if-small" },
    tick: 0,
  },
  "S-ISO-STACKED.json": {
    schema: 1,
    name: "S-ISO-STACKED",
    layout: "iso-stacked",
    boardFiles: [
      "packages/core/test/fixtures/authored/iso-oracle-stacked.brd",
      "packages/core/test/fixtures/authored/iso-oracle-grass.iso",
      "packages/core/test/fixtures/authored/iso-oracle-ordinary.tst",
    ],
    sprites: [
      { id: "player", key: "player", layer: 1, x: 64, y: 32, drawId: 1, under: [1, 2, 4] },
      { id: "item", key: "item", layer: 1, x: 96, y: 40, drawId: 2, under: [1, 2, 4] },
    ],
    ambient: [12, -5, 0],
    view: {
      viewport: [128, 64],
      camera: [999, 999],
      include: { shading: true, images: false, sprites: true },
    },
    tick: 0,
  },
  "S-ISO-ROTATED.json": {
    schema: 1,
    name: "S-ISO-ROTATED",
    layout: "iso-rotated",
    boardFiles: [
      "packages/core/test/fixtures/authored/iso-oracle-rotated.brd",
      "packages/core/test/fixtures/authored/iso-oracle-grass.iso",
      "packages/core/test/fixtures/authored/iso-oracle-ordinary.tst",
    ],
    sprites: [
      { id: "player", key: "player", layer: 1, x: 64, y: 24, drawId: 1, under: [1, 2, 4] },
      { id: "item", key: "item", layer: 1, x: 96, y: 40, drawId: 2, under: [1, 2, 4] },
    ],
    ambient: [-4, 8, 2],
    view: {
      viewport: [128, 64],
      camera: [999, 999],
      include: { shading: true, images: false, sprites: true },
    },
    tick: 0,
  },
  "S-LIGHT-ELLIPSE.json": {
    schema: 1,
    name: "S-LIGHT-ELLIPSE",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-ellipse.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
  "S-LIGHT-GRADIENT.json": {
    schema: 1,
    name: "S-LIGHT-GRADIENT",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-gradient.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
  "S-LIGHT-CLIPPED.json": {
    schema: 1,
    name: "S-LIGHT-CLIPPED",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-clipped.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
  "S-LIGHT-OVERLAP.json": {
    schema: 1,
    name: "S-LIGHT-OVERLAP",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-overlap.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
  "S-LIGHT-BOUNDARY.json": {
    schema: 1,
    name: "S-LIGHT-BOUNDARY",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-boundary.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
  "S-LIGHT-NIGHT.json": {
    schema: 1,
    name: "S-LIGHT-NIGHT",
    boardFiles: ["packages/core/test/fixtures/authored/light-oracle-night.brd", "packages/core/test/fixtures/authored/light-oracle.tst"],
    sprites: [],
    ambient: [0, 0, 0],
    view: { viewport: [256, 128], camera: [0, 0], include: { shading: true, images: false, sprites: false } },
    tick: 0,
  },
};

function oracleSceneFiles() {
  return Object.entries(ORACLE_SCENES).map(([name, scene]) => [name, Buffer.from(`${JSON.stringify(scene, null, 2)}\n`)]);
}

function writeOracleScenes(out = defaultSceneOut) {
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of oracleSceneFiles()) writeFileSync(join(out, name), bytes);
}

function checkOracleScenes(out = defaultSceneOut) {
  const problems = [];
  for (const [name, expected] of oracleSceneFiles()) {
    let actual;
    try { actual = readFileSync(join(out, name)); } catch { problems.push(`${name}: missing`); continue; }
    if (!actual.equals(expected)) problems.push(`${name}: differs from a fresh run`);
  }
  return problems;
}

/** Where the movement oracle's scenes go: beside `authored/` by default, else under the output directory. */
function movementOut(out) {
  return out === defaultOut ? MOVEMENT_OUT : join(out, "movement");
}

function writeMovementFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of movementFixtureFiles()) writeFileSync(join(dir, name), bytes);
}

function checkMovementFixtures(dir) {
  const problems = [];
  for (const [name, expected] of movementFixtureFiles()) {
    let actual;
    try { actual = readFileSync(join(dir, name)); } catch { problems.push(`movement/${name}: missing`); continue; }
    if (!actual.equals(expected)) problems.push(`movement/${name}: differs from a fresh run`);
  }
  return problems;
}

/** Where the audio oracle's scenes and authored files go: beside `authored/` by default, else under the output directory. */
function audioOut(out) {
  return out === defaultOut ? AUDIO_OUT : join(out, "audio");
}

function writeAudioFixtures(dir) {
  for (const [name, bytes] of audioFixtureFiles()) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
}

function checkAudioFixtures(dir) {
  const problems = [];
  for (const [name, expected] of audioFixtureFiles()) {
    let actual;
    try { actual = readFileSync(join(dir, name)); } catch { problems.push(`audio/${name}: missing`); continue; }
    if (!actual.equals(expected)) problems.push(`audio/${name}: differs from a fresh run`);
  }
  return problems;
}

/** Write every authored fixture and oracle scene under their canonical output paths. */
export function generate(out = defaultOut) {
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of authoredFixtures()) {
    const destination = join(out, name);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
  if (out === defaultOut) writeOracleScenes();
  writeMovementFixtures(movementOut(out));
  writeAudioFixtures(audioOut(out));
  writeSaveloadFixtures(saveloadOut(out));
  return out;
}

/**
 * Re-run the generator in memory and compare with what is on disk. Returns the
 * list of mismatches (empty when the committed fixtures are byte-identical).
 */
export function check(out = defaultOut) {
  const problems = [];
  for (const [name, expected] of authoredFixtures()) {
    let actual;
    try {
      actual = readFileSync(join(out, name));
    } catch {
      problems.push(`${name}: missing`);
      continue;
    }
    if (actual.length !== expected.length) {
      problems.push(`${name}: ${actual.length} bytes on disk, ${expected.length} generated`);
      continue;
    }
    if (!actual.every((byte, index) => byte === expected[index])) {
      problems.push(`${name}: bytes differ from a fresh run`);
    }
  }
  if (out === defaultOut) problems.push(...checkOracleScenes());
  problems.push(...checkMovementFixtures(movementOut(out)), ...checkMovementImports(), ...checkMovementCorpus());
  problems.push(...checkAudioFixtures(audioOut(out)), ...checkAudioFiles(), ...checkAudioImports(), ...checkAudioCorpus());
  problems.push(...checkSaveloadFixtures(saveloadOut(out)));
  return problems;
}

function main(argv) {
  let out = defaultOut;
  let checkOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") out = resolve(argv[index + 1]);
    else if (argv[index] === "--check") checkOnly = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (checkOnly) {
    const problems = check(out);
    for (const problem of problems) console.error(`generate.mjs: ${problem}`);
    if (problems.length > 0) return 1;
    console.log(`authored fixtures in ${out} match a fresh run`);
    return 0;
  }
  generate(out);
  console.log(`wrote ${authoredFixtures().length} authored fixtures, ${movementFixtureFiles().length} movement oracle files, ${audioFixtureFiles().length} audio oracle files and ${saveloadFixtureFiles().length} save/load fixture files to ${out}`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
