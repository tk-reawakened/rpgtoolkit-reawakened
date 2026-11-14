// The `dump` subcommand: the extension → reader dispatch, the skip-vs-fail
// classification, the deterministic ordering and digests of the JSON report,
// and the corpus expectation's record/check round trip.
//
// The report and digest cases run in memory (`PackageFile`s, no file system);
// the exit codes, the folder walk and the expectation file go through the real
// CLI in a temp directory. A valid PNG is built here with `node:zlib` so the
// image path is exercised end to end.
import { equal, notEqual, deepEqual, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  BinaryWriter,
  PACKAGE_LIMITS,
  writeAnimation,
  writeDistributionPackage,
  writeMainFile,
  writeSpecialMove,
  writeStatusEffect,
  writeTileBitmap,
  writeTileset,
  type Animation,
  type MainFile,
  type PackageFile,
  type Result,
  type SpecialMove,
  type StatusEffect,
  type Tileset,
  type TileBitmap,
} from "@tk-reawakened/core";
import { main } from "../src/index.ts";
import { digestModel, digestRgba } from "../src/dump/digest.ts";
import { classify, type DataFormatId } from "../src/dump/formats.ts";
import {
  buildExpectation,
  compareGame,
  driftLines,
  parseExpectation,
  serializeExpectation,
  toExpectationGame,
  type ExpectationGame,
} from "../src/dump/expectation.ts";
import { buildReport, digestsOf, serializeReport, type DumpEntry, type DumpReport } from "../src/dump/report.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PATH = join(PACKAGE_ROOT, "dist/cli.js");

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A reader/writer result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

// ------------------------------------------------------------- test fixtures

const ANIMATION: Animation = {
  magic: "RPGTLKIT ANIM",
  major: 2,
  minor: 3,
  width: 32,
  height: 32,
  frames: [
    { image: "man_s.tst1", transparent: { r: 0, g: 0, b: 0 }, sound: "" },
    { image: "", transparent: { r: 0, g: 0, b: 0 }, sound: "die.wav" },
  ],
  delay: 0.15,
  residue: new Uint8Array(0),
};

const ANIMATION_BYTES = unwrap(writeAnimation(ANIMATION));

const TILESET: Tileset = {
  version: 20,
  detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
  tiles: [{ pixels: new Uint8Array(32 * 32 * 3) }, { pixels: new Uint8Array(32 * 32 * 3).fill(7) }],
  residue: new Uint8Array(0),
};

const TILESET_BYTES = unwrap(writeTileset(TILESET));

/** A docs/spec/formats/tiles.md#tile-bitmap-tbm tile bitmap: a 1×1 drawn grid, so four cells are stored and one is drawn. */
const TILE_BITMAP: TileBitmap = {
  magic: "TK3 TILEBITMAP",
  major: 3,
  minor: 0,
  width: 1,
  height: 1,
  cells: [
    { tile: "village.tst9", r: 0, g: 0, b: 0 },
    { tile: "village.tst8", r: 0, g: 0, b: 0 },
    { tile: "", r: 0, g: 0, b: 0 },
    { tile: "village.tst10", r: 0, g: 0, b: 0 },
  ],
  residue: new Uint8Array(0),
};

const TILE_BITMAP_BYTES = unwrap(writeTileBitmap(TILE_BITMAP));

/** A minimal docs/spec/formats/main-file.md#layout main file at minor 0, the layout docs/spec/formats/main-file.md#layout documents for the earliest games. */
const MAIN_FILE: MainFile = {
  magic: "RPGTLKIT MAIN",
  major: 2,
  minor: 0,
  audioSettings: null,
  inputSettings: null,
  registrationFlag: 1,
  registrationCode: "NOCODE",
  projectPath: "demo",
  gameTitle: "Demo Game",
  screenType: 2,
  extendToFullScreen: 1,
  resolution: 1,
  disableProtectReg: 7,
  languageFile: "lang.txt",
  startupPrg: "start.prg",
  initBoard: "start.brd",
  initChar: "hero.tem",
  runTimePrg: "rt.prg",
  runTimeKey: 82,
  menuKey: 77,
  activationKey: 32,
  extKeys: [],
  menuPlugin: "",
  fightPlugin: "",
  fightingDisabled: 0,
  enemies: [],
  fightType: 0,
  chances: 0,
  useCustomFightPrg: 0,
  customFightPrg: "",
  gameOverPrg: "",
  skinButton: "",
  skinWindow: "",
  plugins: [],
  useDayNight: 0,
  dayNightType: 0,
  dayLengthMinutes: 0,
  cursorMoveSound: "",
  cursorSelectSound: "",
  cursorCancelSound: "",
  useJoystick: 0,
  colorDepth: 0,
  gameSpeed: 0,
  pixelMovement: 0,
  cursorEnabled: 0,
  mouseCursor: "",
  hotSpotX: 0,
  hotSpotY: 0,
  transparent: { r: 0, g: 0, b: 0 },
  resX: 0,
  resY: 0,
  showFpsInTitle: 0,
  pathfindHeuristic: 0,
  drawVectorsFlags: 0,
  pathColor: { r: 0, g: 0, b: 0 },
  movementControls: 0,
  movementScanCodes: [],
  // Minor 0 carries the four pre-3 reserved runs at the widths docs/spec/formats/main-file.md#layout gives them (R-18).
  reservedRuns: {
    parallax: new Uint8Array(2),
    menuPluginFallback: new Uint8Array(2),
    multitask: new Uint8Array(6),
    fightStyle: new Uint8Array(2),
  },
  residue: new Uint8Array(0),
};

const MAIN_FILE_BYTES = unwrap(writeMainFile(MAIN_FILE));

const SPECIAL_MOVE: SpecialMove = {
  magic: "RPGTLKIT SPLMOVE",
  major: 2,
  minor: 2,
  name: "Fireball",
  damage: 40,
  smpCost: 5,
  program: "fire.prg",
  targetSmpDrain: 0,
  usableInBattle: 1,
  usableFromMenu: 0,
  statusEffect: "burn.ste",
  animation: "fire.anm",
  description: "A ball of fire",
  residue: new Uint8Array(0),
};

const SPECIAL_MOVE_BYTES = unwrap(writeSpecialMove(SPECIAL_MOVE));

const STATUS_EFFECT: StatusEffect = {
  magic: "RPGTLKIT STATUSE",
  major: 2,
  minor: 2,
  name: "Poison",
  rounds: 3,
  speedUp: 0,
  slowDown: -2,
  disable: 0,
  hpEnabled: 1,
  hpPerRound: -5,
  smpEnabled: 0,
  smpPerRound: 0,
  runProgram: 0,
  program: "",
  residue: new Uint8Array(0),
};

const STATUS_EFFECT_BYTES = unwrap(writeStatusEffect(STATUS_EFFECT));

/**
 * A `.anm` whose delay is NaN (docs/spec/formats/animation.md#layout): the reader accepts the `f64`
 * — it does not check finiteness — and only `canon` rejects the value, so this
 * is the one file whose model cannot be digested.
 */
function nanDelayAnimation(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT ANIM");
  writer.i16(2);
  writer.i16(3);
  writer.i32(32);
  writer.i32(32);
  writer.i32(-1); // frame upper bound: no slots
  writer.f64(Number.NaN);
  return writer.toBytes();
}

const NAN_DELAY_ANM = nanDelayAnimation();

/** The ASCII bytes of a literal, for a text `.prg` and a truncated board header. */
function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    out[index] = text.charCodeAt(index);
  }
  return out;
}

const PRG_TEXT = asciiBytes("walk()\nwait(5)\n");

/** The PNG CRC-32 (PNG spec §5.5), so the test needs no zlib version beyond `deflateSync`. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** One big-endian PNG chunk: length, type, payload, CRC over type+payload. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A 1×1 RGB PNG of the given pixel, built with `deflateSync` (a zlib stream). */
function onePixelPng(red: number, green: number, blue: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const idat = deflateSync(new Uint8Array([0, red, green, blue]));
  return concat([PNG_SIGNATURE, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))]);
}

const PIXEL_PNG = onePixelPng(200, 100, 50);
const PIXEL_RGBA = new Uint8Array([200, 100, 50, 255]);

/**
 * A 1×1 24-bit Windows bitmap of the given pixel
 * (docs/spec/formats/images.md): the two headers, then B, G, R and the byte of
 * row padding the 4-byte stride requires.
 */
function onePixelBmp(red: number, green: number, blue: number): Uint8Array {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setInt32(2, bytes.length, true); // bfSize
  view.setInt32(10, 54, true); // bfOffBits
  view.setInt32(14, 40, true); // biSize
  view.setInt32(18, 1, true); // biWidth
  view.setInt32(22, 1, true); // biHeight
  view.setInt16(26, 1, true); // biPlanes
  view.setInt16(28, 24, true); // biBitCount
  view.setInt32(34, 4, true); // biSizeImage
  bytes[54] = blue;
  bytes[55] = green;
  bytes[56] = red;
  return bytes;
}

const PIXEL_BMP = onePixelBmp(200, 100, 50);

function onePixelGif(red: number, green: number, blue: number): Uint8Array {
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x37, 0x61, // GIF87a
    1, 0, 1, 0, 0x80, 0, 0, // 1×1 screen, 2-entry GCT
    red, green, blue, 0, 0, 0, // GCT
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, // 1×1 image descriptor
    2, 2, 0x44, 0x01, 0, // LZW data
    0x3b, // trailer
  ]);
}

const PIXEL_GIF = onePixelGif(200, 100, 50);
/** A board file truncated just after its magic, so `readBoard` reports a located EOF. */
const TRUNCATED_BOARD = asciiBytes("RPGTLKIT BOARD\0");

/** An animation truncated just after its magic, so `readAnimation` fails at its header. */
const TRUNCATED_ANIMATION = asciiBytes("RPGTLKIT ANIM\0");

/** The stored upper bound for `count` entries (docs/spec/formats/README.md#counts-are-usually-upper-bounds). */
function bound(count: number): number {
  return count === 0 ? -1 : count - 1;
}

/**
 * A minimal minor-3 pre-vector board (docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector), serialised in the
 * docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector field order; the same shape the core pre-vector test builds, trimmed to
 * the one board this case needs. Minor 4 and above take the docs/spec/formats/board.md#vector-layout-minor-4-and-later vector path
 * instead, so this is the only form that reaches `readPreVectorBoard`.
 */
function buildPreVectorBoard(): Uint8Array {
  const writer = new BinaryWriter();
  writer.str("RPGTLKIT BOARD");
  writer.i16(2); // major
  writer.i16(3); // minor
  writer.i16(0); // registration flag
  writer.str(""); // registration key
  writer.i16(2); // sizeX
  writer.i16(2); // sizeY
  writer.i16(1); // sizeL
  writer.i16(1); // startX
  writer.i16(1); // startY
  writer.i16(1); // startLayer
  writer.i16(0); // disableSaving
  writer.i16(bound(2)); // LUT upper bound: two slots
  writer.str("");
  writer.str("default.tst1");
  // One run marker covering all four cells (a count above 1 is stored negated).
  writer.i16(-4);
  writer.i16(1); // LUT index
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.i8(0); // tile type: normal
  writer.str(""); // background image
  writer.str(""); // foreground image (unused)
  writer.str(""); // border image (unused)
  writer.color({ r: 0, g: 0, b: 0 }); // background colour
  writer.color({ r: 0, g: 0, b: 0 }); // border colour (unused)
  writer.i16(0); // ambient preset
  for (let index = 0; index < 4; index += 1) writer.str(""); // links
  writer.i16(0); // battle skill
  writer.str(""); // battle background
  writer.i16(0); // allow battles
  writer.i16(0);
  writer.i16(0);
  writer.i16(0);
  writer.str(""); // day/night text (unused)
  for (let index = 0; index < 11; index += 1) writer.i16(0); // constants
  writer.str(""); // background music
  for (let index = 0; index < 9; index += 1) writer.str(""); // layer titles
  writer.i16(bound(0)); // programs
  writer.str(""); // enter program
  writer.str(""); // reserved
  writer.i16(bound(0)); // sprites
  writer.i32(bound(0)); // threads (minor >= 3)
  writer.i8(0); // coordType (minor >= 3)
  return writer.toBytes();
}

const PRE_VECTOR_BOARD = buildPreVectorBoard();

const FILES: readonly PackageFile[] = [
  { path: "Prg/main.prg", bytes: PRG_TEXT },
  { path: "walk.anm", bytes: ANIMATION_BYTES },
  { path: "Tiles/base.tst", bytes: TILESET_BYTES },
  { path: "pic.png", bytes: PIXEL_PNG },
  { path: "Media/song.mid", bytes: new Uint8Array([1, 2, 3]) },
  { path: "Boards/broken.brd", bytes: TRUNCATED_BOARD },
  { path: "Plugin/tk3fight.dll", bytes: new Uint8Array([4, 5]) },
  { path: "readme.zzz", bytes: new Uint8Array(0) },
];

/** Write the same corpus to a temp project folder, optionally with the broken board. */
function createProject(options?: { brokenBoard?: boolean; extra?: ReadonlyArray<readonly [string, Uint8Array]> }): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "rpg-dump-test-"));
  const written: ReadonlyArray<readonly [string, Uint8Array]> = [
    ...FILES.filter((file) => options?.brokenBoard === true || file.path !== "Boards/broken.brd").map(
      (file) => [file.path, file.bytes] as const,
    ),
    ...(options?.extra ?? []),
  ];
  for (const [path, bytes] of written) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// ------------------------------------------------------------------ dispatch

/** Every data extension and the reader it must reach. */
const DISPATCH: ReadonlyArray<readonly [string, DataFormatId, string]> = [
  ["Main/demo.gam", "gam", "docs/spec/formats/main-file.md#layout"],
  ["Boards/start.brd", "board", "docs/spec/formats/board.md#vector-layout-minor-4-and-later"],
  ["Tiles/base.tst", "tileset", "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso"],
  ["Tiles/iso.iso", "tileset", "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso"],
  ["Bitmap/house.tbm", "tile-bitmap", "docs/spec/formats/tiles.md#tile-bitmap-tbm"],
  ["Misc/man/man_s.anm", "animation", "docs/spec/formats/animation.md#layout"],
  ["Chrs/start.tem", "character", "docs/spec/formats/character.md#layout"],
  ["Item/man.itm", "item", "docs/spec/formats/item.md#layout"],
  ["Enemy/pirate.ene", "enemy", "docs/spec/formats/enemy.md#layout"],
  ["Bkrounds/bkg.bkg", "battle-background", "docs/spec/formats/battle-data.md#fight-background-bkg"],
  ["SpcMove/fire.spc", "special-move", "docs/spec/formats/battle-data.md#special-move-spc"],
  ["StatusE/poison.ste", "status-effect", "docs/spec/formats/battle-data.md#status-effect-ste"],
  ["Tiles/single.gph", "single-tile", "docs/spec/formats/tiles.md#single-tile-gph"],
  ["Tiles/animated.tan", "tile-animation", "docs/spec/formats/tiles.md#animated-tile-tan"],
  ["Font/legacy.fnt", "font", "docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text"],
  ["Bitmap/bkg.jpg", "image", "docs/spec/formats/images.md#the-shared-decode-contract"],
  ["Bitmap/bkg.jpeg", "image", "docs/spec/formats/images.md#the-shared-decode-contract"],
  ["Bitmap/mwin.bmp", "image", "docs/spec/formats/images.md#the-shared-decode-contract"],
  ["Bitmap/layout.png", "image", "docs/spec/formats/images.md#the-shared-decode-contract"],
];

test("classify sends every data extension to the reader its section names", () => {
  for (const [path, format, section] of DISPATCH) {
    const cls = classify(path);
    equal(cls.kind, "data", path);
    if (cls.kind !== "data") continue;
    equal(cls.format, format, path);
    equal(cls.section, section, path);
  }
});

test("classify excludes the named School2Demo placeholder board", () => {
  const cls = classify("Boards/SchoolFloor1.brd");
  equal(cls.kind, "skip");
  if (cls.kind === "skip") {
    equal(cls.reason, "named legacy placeholder excluded from the TK2 corpus gate");
  }
});

test("the TK2 tile and font examples parse through dump", () => {
  const examples = join(PACKAGE_ROOT, "..", "..", "docs", "spec", "examples", "versions");
  const files: PackageFile[] = [
    "single-tile/tile_v2_compressed.gph",
    "tile-animation/water.tan",
    "font/base.fnt",
  ].map((relativePath) => ({
    path: relativePath,
    bytes: new Uint8Array(readFileSync(join(examples, relativePath))),
  }));
  const report = buildReport(files);
  deepEqual(report.counts, { parsed: 3, skipped: 0, failed: 0 });
  for (const entry of report.files) {
    ok(entry.status === "parsed", `${entry.path} should parse`);
  }
});

test("classify is case-insensitive, so the legacy uppercase names land on the same row", () => {
  const upper = classify("Media/VIP - Village1.MID");
  const lower = classify("Media/village1.mid");
  equal(upper.kind, "skip");
  equal(lower.kind, "skip");
  if (upper.kind === "skip" && lower.kind === "skip") {
    equal(upper.reason, lower.reason);
  }
  const upperBmp = classify("Bitmap/OLD.BMP");
  const lowerBmp = classify("Bitmap/old.bmp");
  equal(upperBmp.kind, "data");
  equal(lowerBmp.kind, "data");
  if (upperBmp.kind === "data" && lowerBmp.kind === "data") {
    equal(upperBmp.format, lowerBmp.format);
    equal(upperBmp.format, "image");
  }
});

test("classify parses .bmp and .gif", () => {
  for (const path of ["Bitmap/old.bmp", "Bitmap/OLD.BMP", "Bitmap/anim.gif", "Bitmap/ANIM.GIF"]) {
    const cls = classify(path);
    equal(cls.kind, "data", path);
    if (cls.kind === "data") {
      equal(cls.format, "image", path);
      equal(cls.section, "docs/spec/formats/images.md#the-shared-decode-contract", path);
    }
  }
  // A bitmap or GIF in a project is parsed and digested, and a truncated one is a
  // failure, not a skip(docs/spec/formats/images.md#windows-bitmap-bmp refuses rather than approximating).
  const parsed = buildReport([
    { path: "Bitmap/mwin.bmp", bytes: PIXEL_BMP },
    { path: "Bitmap/mwin.gif", bytes: PIXEL_GIF },
  ]);
  deepEqual(parsed.counts, { parsed: 2, skipped: 0, failed: 0 });
  const bmpEntry = parsed.files[0];
  ok(bmpEntry !== undefined && bmpEntry.status === "parsed");
  if (bmpEntry?.status === "parsed") {
    equal(bmpEntry.format, "image");
    equal(bmpEntry.digest, digestRgba(PIXEL_RGBA));
    ok(bmpEntry.summary.includes("image bmp 1×1"), bmpEntry.summary);
  }
  const gifEntry = parsed.files[1];
  ok(gifEntry !== undefined && gifEntry.status === "parsed");
  if (gifEntry?.status === "parsed") {
    equal(gifEntry.format, "image");
    equal(gifEntry.digest, digestRgba(PIXEL_RGBA));
    ok(gifEntry.summary.includes("image gif 1×1"), gifEntry.summary);
  }
  const truncatedBmp = buildReport([{ path: "Bitmap/mwin.bmp", bytes: new Uint8Array([0x42, 0x4d]) }]);
  deepEqual(truncatedBmp.counts, { parsed: 0, skipped: 0, failed: 1 });
  const truncatedGif = buildReport([{ path: "Bitmap/mwin.gif", bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) }]);
  deepEqual(truncatedGif.counts, { parsed: 0, skipped: 0, failed: 1 });
});

test("classify skips the non-format, media and plugin files with a reason", () => {
  for (const path of ["Prg/start.prg", "Media/song.mid", "Media/die.wav", "readme.txt", "Plugin/tk3.dll", "readme.zzz", "LICENSE"]) {
    const cls = classify(path);
    equal(cls.kind, "skip", path);
    if (cls.kind === "skip") {
      ok(cls.reason.length > 0, path);
    }
  }
  const prg = classify("Prg/start.prg");
  ok(prg.kind === "skip" && prg.reason.includes("docs/spec/engine/rpgcode-language.md#programs-and-encodings"), "the .prg reason cites the programs page");
  const unknown = classify("readme.zzz");
  ok(unknown.kind === "skip" && unknown.reason.includes("unrecognised"), "an unknown extension says so");
});

test("the .prg skip reports size and line count, not just a reason", () => {
  const cls = classify("Prg/main.prg");
  ok(cls.kind === "skip");
  if (cls.kind !== "skip") return;
  equal(cls.describe?.(PRG_TEXT), "15 bytes, 2 lines");
  equal(cls.describe?.(new Uint8Array(0)), "0 bytes, 0 lines");
  equal(cls.describe?.(new Uint8Array([0x61])), "1 bytes, 1 lines");
  // docs/spec/engine/rpgcode-language.md's compiled form: a first byte of `00` is a compiled program, not source
  // text (docs/spec/formats/rpgcode-program.md#compiled-form, R-12).
  const compiled = new Uint8Array(
    readFileSync(
      join(PACKAGE_ROOT, "..", "..", "docs", "spec", "examples", "versions", "program", "start_compiled.prg"),
    ),
  );
  equal(compiled[0], 0x00, "the committed example starts with the compiled marker");
  ok(cls.describe?.(compiled)?.includes("compiled"), `the compiled example is reported as compiled`);
  // The 0x00-first rule wins over any line count, and an empty file is not compiled.
  equal(cls.describe?.(new Uint8Array([0x00, 0x0a])), `compiled (docs/spec/formats/rpgcode-program.md#compiled-form), 2 bytes`);
  ok(cls.describe?.(new Uint8Array([0x0a]))?.includes("lines"), "a text file still reports lines");
});

test("the .gam, .spc and .ste rows parse the models their writers produced", () => {
  const report = buildReport([
    { path: "Main/demo.gam", bytes: MAIN_FILE_BYTES },
    { path: "SpcMove/fire.spc", bytes: SPECIAL_MOVE_BYTES },
    { path: "StatusE/poison.ste", bytes: STATUS_EFFECT_BYTES },
  ]);
  deepEqual(report.counts, { parsed: 3, skipped: 0, failed: 0 });
  const byPath: { [path: string]: DumpEntry } = Object.fromEntries(
    report.files.map((entry) => [entry.path, entry] as const),
  );

  const gam = byPath["Main/demo.gam"];
  ok(gam !== undefined && gam.status === "parsed");
  if (gam?.status === "parsed") {
    equal(gam.format, "gam");
    equal(gam.digest, digestModel(MAIN_FILE));
    ok(gam.summary.includes('project "demo"'), gam.summary);
  }

  const spc = byPath["SpcMove/fire.spc"];
  ok(spc !== undefined && spc.status === "parsed");
  if (spc?.status === "parsed") {
    equal(spc.format, "special-move");
    equal(spc.digest, digestModel(SPECIAL_MOVE));
  }

  const ste = byPath["StatusE/poison.ste"];
  ok(ste !== undefined && ste.status === "parsed");
  if (ste?.status === "parsed") {
    equal(ste.format, "status-effect");
    equal(ste.digest, digestModel(STATUS_EFFECT));
  }
});

test("a pre-vector board is read, converted and parsed", () => {
  const report = buildReport([{ path: "Boards/old.brd", bytes: PRE_VECTOR_BOARD }]);
  deepEqual(report.counts, { parsed: 1, skipped: 0, failed: 0 });
  const entry = report.files[0];
  ok(entry !== undefined && entry.status === "parsed");
  if (entry?.status === "parsed") {
    equal(entry.format, "board");
    // The summary names the conversion: the docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector minor-3 board became a docs/spec/formats/board.md#vector-layout-minor-4-and-later minor-4 model.
    ok(entry.summary.includes("2.4 (pre-vector, converted to vectors)"), entry.summary);
  }
});

test("a tile bitmap is parsed, not skipped, and its summary counts drawn and stored cells", () => {
  const report = buildReport([{ path: "Bitmap/house.tbm", bytes: TILE_BITMAP_BYTES }]);
  deepEqual(report.counts, { parsed: 1, skipped: 0, failed: 0 });
  const entry = report.files[0];
  equal(entry?.status, "parsed");
  if (entry?.status === "parsed") {
    equal(entry.format, "tile-bitmap");
    equal(entry.section, "docs/spec/formats/tiles.md#tile-bitmap-tbm");
    ok(entry.summary.includes("1×1 tiles drawn"), entry.summary);
    ok(entry.summary.includes("4 cells stored (1 drawn)"), entry.summary);
  }
});

test("a model the digest cannot canonicalise fails only its own file", () => {
  const report = buildReport([
    { path: "walk.anm", bytes: ANIMATION_BYTES },
    { path: "bad.anm", bytes: NAN_DELAY_ANM },
    { path: "pic.png", bytes: PIXEL_PNG },
  ]);
  deepEqual(report.counts, { parsed: 2, skipped: 0, failed: 1 });
  const byPath: { [path: string]: DumpEntry } = Object.fromEntries(
    report.files.map((entry) => [entry.path, entry] as const),
  );
  equal(byPath["walk.anm"]?.status, "parsed");
  equal(byPath["pic.png"]?.status, "parsed");
  const bad = byPath["bad.anm"];
  ok(bad !== undefined && bad.status === "failed");
  if (bad?.status === "failed") {
    equal(bad.format, "animation");
    equal(bad.section, "docs/spec/formats/animation.md#layout");
    ok(bad.error.message.includes("digest"), bad.error.message);
  }
});

// -------------------------------------------------------------- digest values

test("digestModel is stable, key-order independent and field sensitive", () => {
  const first = { a: 1, bytes: new Uint8Array([1, 2]), nested: { d: "x" } };
  const reordered = { nested: { d: "x" }, bytes: new Uint8Array([1, 2]), a: 1 };
  equal(digestModel(first), digestModel(reordered));
  notEqual(digestModel(first), digestModel({ a: 2, bytes: new Uint8Array([1, 2]), nested: { d: "x" } }));
  notEqual(digestModel(first), digestModel({ a: 1, bytes: new Uint8Array([1, 3]), nested: { d: "x" } }));
  notEqual(digestModel(first), digestModel({ a: 1, bytes: new Uint8Array([1, 2]), nested: { d: "y" } }));
});

test("digestModel drops undefined fields, which a reader's optional model fields are", () => {
  equal(digestModel({ a: 1, absent: undefined }), digestModel({ a: 1 }));
  equal(digestModel({ a: 1, list: [1, undefined, 2] }), digestModel({ a: 1, list: [1, null, 2] }));
});

test("digestRgba hashes the decoded bytes", () => {
  equal(digestRgba(PIXEL_RGBA), digestRgba(new Uint8Array([200, 100, 50, 255])));
  notEqual(digestRgba(PIXEL_RGBA), digestRgba(new Uint8Array([200, 100, 50, 254])));
});

// ------------------------------------------------------------ the report

test("buildReport classifies each file, digests the parsed ones and counts the rest", () => {
  const report = buildReport(FILES);
  deepEqual(report.counts, { parsed: 3, skipped: 4, failed: 1 });

  const byPath: { [path: string]: DumpEntry } = Object.fromEntries(
    report.files.map((entry) => [entry.path, entry] as const),
  );
  equal(byPath["walk.anm"]?.status, "parsed");
  equal(byPath["Tiles/base.tst"]?.status, "parsed");
  equal(byPath["pic.png"]?.status, "parsed");
  equal(byPath["Prg/main.prg"]?.status, "skipped");
  equal(byPath["Media/song.mid"]?.status, "skipped");
  equal(byPath["Plugin/tk3fight.dll"]?.status, "skipped");
  equal(byPath["readme.zzz"]?.status, "skipped");
  equal(byPath["Boards/broken.brd"]?.status, "failed");

  const broken = byPath["Boards/broken.brd"];
  ok(broken !== undefined && broken.status === "failed");
  if (broken?.status === "failed") {
    ok(broken.error.section.includes("docs/spec/"), broken.error.section);
    equal(broken.format, "board");
    ok(broken.error.offset >= 0);
  }

  const prg = byPath["Prg/main.prg"];
  ok(prg !== undefined && prg.status === "skipped" && prg.reason.includes("2 lines"));

  // The image digest is the decoded RGBA's, and the summary carries the dimensions.
  const image = byPath["pic.png"];
  ok(image !== undefined && image.status === "parsed");
  if (image?.status === "parsed") {
    equal(image.digest, digestRgba(PIXEL_RGBA));
    ok(image.summary.includes("1×1"), image.summary);
    equal(image.format, "image");
  }

  const animation = byPath["walk.anm"];
  ok(animation !== undefined && animation.status === "parsed");
  if (animation?.status === "parsed") {
    equal(animation.digest, digestModel(ANIMATION));
    ok(animation.summary.includes("2 frame slots"), animation.summary);
  }
});

test("buildReport orders files by path and serialises byte-identically every time", () => {
  const first = buildReport(FILES);
  const second = buildReport([...FILES].reverse());
  equal(serializeReport(first), serializeReport(second));

  const paths = first.files.map((entry) => entry.path);
  deepEqual(paths, [...paths].sort());

  const parsed = JSON.parse(serializeReport(first)) as {
    schema: number;
    counts: { parsed: number };
    files: ReadonlyArray<{ path: string; status: string }>;
  };
  equal(parsed.schema, 1);
  equal(parsed.counts.parsed, 3);
  equal(parsed.files.length, FILES.length);
  equal(parsed.files[0]?.path, "Boards/broken.brd");
});

test("digestsOf keeps only the parsed files", () => {
  deepEqual(Object.keys(digestsOf(buildReport(FILES))).sort(), ["Tiles/base.tst", "pic.png", "walk.anm"]);
});

// ------------------------------------------------------------ the expectation

test("the expectation round-trips through its committed form", () => {
  const report = buildReport(FILES);
  const expectation = buildExpectation({ sample: toExpectationGame(report) });
  const text = serializeExpectation(expectation);
  const parsed = parseExpectation(text, "expectation.json");
  deepEqual(parsed.games, expectation.games);
  equal(serializeExpectation(parsed), text);
});

test("compareGame and driftLines name the file that drifted, went missing or is new", () => {
  const report = buildReport(FILES);
  const expected = toExpectationGame(report);
  deepEqual(driftLines(compareGame("sample", expected, report)), []);

  const drifted: ExpectationGame = {
    counts: expected.counts,
    digests: { ...expected.digests, "walk.anm": "0000000000000000", "ghost.anm": "1111111111111111" },
  };
  const lines = driftLines(compareGame("sample", drifted, report));
  ok(lines.some((line) => line.includes("walk.anm") && line.includes("differs")), lines.join("\n"));
  ok(lines.some((line) => line.includes("ghost.anm") && line.includes("missing")), lines.join("\n"));

  const withoutAnimation: ExpectationGame = {
    counts: expected.counts,
    digests: Object.fromEntries(Object.entries(expected.digests).filter(([path]) => path !== "walk.anm")),
  };
  const extra = driftLines(compareGame("sample", withoutAnimation, report));
  ok(extra.some((line) => line.includes("walk.anm") && line.includes("does not list it")), extra.join("\n"));
});

test("parseExpectation refuses a malformed expectation, naming the file", () => {
  for (const [text, pattern] of [
    ["not json", /not JSON/],
    ["{}", /schema must be 1/],
    ['{"schema":1,"games":{"x":{"counts":{"parsed":0,"skipped":0,"failed":0},"digests":{"a.brd":"zz"}}}}', /16-hex digest/],
    ['{"schema":1,"games":[]}', /games must be an object/],
  ] as ReadonlyArray<readonly [string, RegExp]>) {
    let caught: unknown;
    try {
      parseExpectation(text, "expectation.json");
    } catch (cause) {
      caught = cause;
    }
    ok(caught instanceof Error, `expected a throw for ${text}`);
    ok(pattern.test(caught.message), caught.message);
    ok(caught.message.includes("expectation.json"));
  }
});

test("the expectation round-trips with ignore, expectedFailures, and expectedResidue", () => {
  const report = buildReport(FILES);
  const game = toExpectationGame(
    report,
    { "text.anm": "16.5" },
    { "legacy.tem": "16.6" },
  );
  const expectation = buildExpectation({ sample: game }, "Custom comment", ["listings", "renders"]);
  const text = serializeExpectation(expectation);
  const parsed = parseExpectation(text, "spec-examples.json");
  deepEqual(parsed.games, expectation.games);
  deepEqual(parsed.ignore, ["listings", "renders"]);
  equal(serializeExpectation(parsed), text);
});

test("parseExpectation validates ignore, expectedFailures, and expectedResidue", () => {
  const cases: ReadonlyArray<readonly [string, RegExp]> = [
    ['{"schema":1,"ignore":"not-array","games":{}}', /ignore must be an array/],
    ['{"schema":1,"ignore":[""],"games":{}}', /ignore\[0\] must be a non-empty string/],
    [
      '{"schema":1,"games":{"x":{"counts":{"parsed":0,"skipped":0,"failed":0},"digests":{},"expectedFailures":"bad"}}}',
      /expectedFailures must be an object/,
    ],
    [
      '{"schema":1,"games":{"x":{"counts":{"parsed":0,"skipped":0,"failed":0},"digests":{},"expectedFailures":{"f":""}}}}',
      /must be a non-empty string ticket reference/,
    ],
    [
      '{"schema":1,"games":{"x":{"counts":{"parsed":0,"skipped":0,"failed":0},"digests":{},"expectedResidue":{"f":""}}}}',
      /must be a non-empty string ticket reference/,
    ],
  ];
  for (const [text, pattern] of cases) {
    let caught: unknown;
    try {
      parseExpectation(text, "expectation.json");
    } catch (cause) {
      caught = cause;
    }
    equal(caught instanceof Error, true);
    if (caught instanceof Error) {
      equal(pattern.test(caught.message), true);
      equal(caught.message.includes("expectation.json"), true);
    }
  }
});

test("compareGame passes on expected failures and expected residue", () => {
  const parsedEntry = {
    path: "legacy.tem",
    status: "parsed" as const,
    format: "character" as const,
    section: "docs/spec/formats/character.md#layout",
    digest: "1234567890abcdef",
    summary: "character with residue",
    warnings: ["326 trailing byte(s) after the character were kept as residue (docs/spec/formats/character.md#layout)"],
  };
  const failedEntry = {
    path: "text.anm",
    status: "failed" as const,
    format: "animation" as const,
    section: "docs/spec/formats/animation.md#layout",
    error: { offset: 0, section: "docs/spec/formats/animation.md#layout", message: "unterminated string" },
  };
  const report: DumpReport = {
    schema: 1,
    counts: { parsed: 1, skipped: 0, failed: 1 },
    files: [parsedEntry, failedEntry],
  };
  const expected: ExpectationGame = {
    counts: { parsed: 1, skipped: 0, failed: 1 },
    digests: { "legacy.tem": "1234567890abcdef" },
    expectedFailures: { "text.anm": "16.5" },
    expectedResidue: { "legacy.tem": "16.6" },
  };
  const drift = compareGame("sample", expected, report);
  deepEqual(driftLines(drift), []);
});

test("compareGame fails when an expected failure starts passing", () => {
  const parsedEntry = {
    path: "text.anm",
    status: "parsed" as const,
    format: "animation" as const,
    section: "docs/spec/formats/animation.md#layout",
    digest: "fedcba0987654321",
    summary: "animation parsed",
    warnings: [],
  };
  const report: DumpReport = {
    schema: 1,
    counts: { parsed: 1, skipped: 0, failed: 0 },
    files: [parsedEntry],
  };
  const expected: ExpectationGame = {
    counts: { parsed: 0, skipped: 0, failed: 1 },
    digests: {},
    expectedFailures: { "text.anm": "16.5" },
  };
  const lines = driftLines(compareGame("sample", expected, report));
  equal(
    lines.some((l) => l.includes("text.anm") && l.includes("expected to fail") && l.includes("16.5")),
    true,
  );
});

test("compareGame fails when expected residue clears without expectation update", () => {
  const parsedEntry = {
    path: "legacy.tem",
    status: "parsed" as const,
    format: "character" as const,
    section: "docs/spec/formats/character.md#layout",
    digest: "1234567890abcdef",
    summary: "character with 0 residue",
    warnings: [],
  };
  const report: DumpReport = {
    schema: 1,
    counts: { parsed: 1, skipped: 0, failed: 0 },
    files: [parsedEntry],
  };
  const expected: ExpectationGame = {
    counts: { parsed: 1, skipped: 0, failed: 0 },
    digests: { "legacy.tem": "1234567890abcdef" },
    expectedResidue: { "legacy.tem": "16.6" },
  };
  const lines = driftLines(compareGame("sample", expected, report));
  equal(
    lines.some((l) => l.includes("legacy.tem") && l.includes("expected to leave residue") && l.includes("16.6")),
    true,
  );
});

test("compareGame fails when a current-format file leaves unexpected residue", () => {
  const parsedEntry = {
    path: "modern.brd",
    status: "parsed" as const,
    format: "board" as const,
    section: "docs/spec/formats/board.md#vector-layout-minor-4-and-later",
    digest: "abcdef1234567890",
    summary: "board with residue",
    warnings: ["4 trailing byte(s) after the board were kept as residue (docs/spec/formats/board.md#vector-layout-minor-4-and-later)"],
  };
  const report: DumpReport = {
    schema: 1,
    counts: { parsed: 1, skipped: 0, failed: 0 },
    files: [parsedEntry],
  };
  const expected: ExpectationGame = {
    counts: { parsed: 1, skipped: 0, failed: 0 },
    digests: { "modern.brd": "abcdef1234567890" },
  };
  const lines = driftLines(compareGame("sample", expected, report));
  equal(lines.some((l) => l.includes("modern.brd") && l.includes("left unconsumed residue")), true);
});

test("dump --check ignores directories in expectation.ignore", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const alpha = join(games, "alpha");
  const listings = join(games, "listings");
  try {
    mkdirSync(alpha, { recursive: true });
    mkdirSync(listings, { recursive: true });
    writeFileSync(join(alpha, "walk.anm"), ANIMATION_BYTES);
    writeFileSync(join(listings, "readme.txt"), "hello");
    const expectationPath = join(games, "expectation.json");
    const exp = buildExpectation(
      { alpha: { counts: { parsed: 1, skipped: 0, failed: 0 }, digests: { "walk.anm": "0d05a2f01d4863be" } } },
      "test",
      ["listings"],
    );
    writeFileSync(expectationPath, serializeExpectation(exp), "utf8");
    const checked = runCli(["dump", "--check", expectationPath, games]);
    equal(checked.status, 0, checked.stderr);
    equal(checked.stdout.includes("alpha: 1 parsed, 0 skipped, 0 failed, 1 digests match"), true);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});

test("the committed spec-examples dump expectation matches docs/spec/examples", () => {
  const root = join(PACKAGE_ROOT, "..", "..");
  const expectationPath = join(root, "golden", "spec-examples.json");
  const examplesDir = join(root, "docs", "spec", "examples");
  const checked = runCli(["dump", "--check", expectationPath, examplesDir]);
  equal(checked.status, 0, checked.stderr);
  equal(checked.stdout.includes("files: 1 parsed, 2 skipped, 0 failed, 1 digests match"), true);
  equal(checked.stdout.includes("game: 21 parsed, 5 skipped, 0 failed, 21 digests match"), true);
  equal(checked.stdout.includes("versions: 60 parsed, 61 skipped, 2 expected failure(s), 60 digests match"), true);
});

// ------------------------------------------------------------------ the CLI

test("dump on a clean project exits 0 and prints a line per file plus the counts", () => {
  const project = createProject();
  try {
    const result = runCli(["dump", project.root]);
    equal(result.status, 0, result.stderr);
    ok(result.stdout.includes("walk.anm  animation"), result.stdout);
    ok(result.stdout.includes("pic.png  image  image png 1×1"));
    ok(result.stdout.includes("Prg/main.prg  skipped"));
    ok(result.stdout.includes("3 parsed, 4 skipped, 0 failed"));
  } finally {
    project.cleanup();
  }
});

test("a data file that fails to parse exits non-zero and names the file and the error", () => {
  const project = createProject({ brokenBoard: true });
  try {
    const result = runCli(["dump", project.root]);
    equal(result.status, 1);
    ok(result.stdout.includes("Boards/broken.brd  FAILED"), result.stdout);
    ok(result.stdout.includes("docs/spec/"), result.stdout);
    ok(result.stdout.includes("offset"), result.stdout);
    ok(result.stdout.includes("3 parsed, 4 skipped, 1 failed"));
  } finally {
    project.cleanup();
  }
});

test("a model the digest cannot canonicalise fails that file and still reports the rest", () => {
  const project = createProject({ extra: [["bad.anm", NAN_DELAY_ANM]] });
  try {
    const result = runCli(["dump", project.root]);
    equal(result.status, 1);
    ok(result.stdout.includes("bad.anm  FAILED"), result.stdout);
    ok(result.stdout.includes("walk.anm  animation"), result.stdout);
    ok(result.stdout.includes("3 parsed, 4 skipped, 1 failed"), result.stdout);
  } finally {
    project.cleanup();
  }
});

test("a file above core's size limit is refused while walking, before it is read", () => {
  const root = mkdtempSync(join(tmpdir(), "rpg-dump-limit-"));
  try {
    // A sparse file costs no disk: only its size exists.
    const huge = join(root, "bbb/huge.tst");
    mkdirSync(dirname(huge), { recursive: true });
    writeFileSync(huge, new Uint8Array(0));
    truncateSync(huge, PACKAGE_LIMITS.maxEntryUncompressedBytes + 1);
    // The loader refuses a link too, and this one sorts before the oversize
    // file, so the size refusal is the one reported only if the walk makes it
    // first — i.e. only if the file was never read.
    symlinkSync(join(root, "gone.anm"), join(root, "aaa.anm"));

    const folder = runCli(["dump", root]);
    equal(folder.status, 1);
    ok(folder.stderr.includes("bbb/huge.tst"), folder.stderr);
    ok(folder.stderr.includes(String(PACKAGE_LIMITS.maxEntryUncompressedBytes)), folder.stderr);
    ok(!folder.stderr.includes("symbolic link"), folder.stderr);

    const tpk = join(root, "game.tpk");
    writeFileSync(tpk, new Uint8Array(0));
    truncateSync(tpk, PACKAGE_LIMITS.maxCompressedInputBytes + 1);
    const packed = runCli(["dump", tpk]);
    equal(packed.status, 1);
    ok(packed.stderr.includes(String(PACKAGE_LIMITS.maxCompressedInputBytes)), packed.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dump reads a .tpk and an appended-ZIP .exe, both with a known digest", () => {
  const zip = unwrap(
    writeDistributionPackage({
      files: [{ path: "walk.anm", bytes: ANIMATION_BYTES }],
      manifest: { schema: 1, main: "walk.anm", index: ["walk.anm"] },
    }),
  );
  const root = mkdtempSync(join(tmpdir(), "rpg-dump-package-"));
  try {
    const tpk = join(root, "game.tpk");
    writeFileSync(tpk, zip);
    const tpkResult = runCli(["dump", "--json", tpk]);
    equal(tpkResult.status, 0, tpkResult.stderr);
    const tpkReport = JSON.parse(tpkResult.stdout) as {
      counts: { parsed: number; failed: number };
      files: ReadonlyArray<{ path: string; digest?: string }>;
    };
    equal(tpkReport.counts.parsed, 1);
    equal(tpkReport.counts.failed, 0);
    equal(tpkReport.files.find((file) => file.path === "walk.anm")?.digest, digestModel(ANIMATION));

    // docs/spec/formats/packaging-and-paths.md's standalone EXE: any stub, then the ZIP, then the 12-byte CMP1 trailer.
    const stub = asciiBytes("MZ this is a stub executable");
    const trailer = new Uint8Array(12);
    trailer.set(asciiBytes("CMP1"), 0);
    const view = new DataView(trailer.buffer);
    view.setInt32(4, stub.length, true);
    view.setInt32(8, zip.length, true);
    const exe = join(root, "game.exe");
    writeFileSync(exe, concat([stub, zip, trailer]));

    const exeResult = runCli(["dump", "--json", exe]);
    equal(exeResult.status, 0, exeResult.stderr);
    const exeReport = JSON.parse(exeResult.stdout) as {
      counts: { parsed: number; failed: number };
      files: ReadonlyArray<{ path: string; digest?: string }>;
    };
    equal(exeReport.counts.parsed, 1);
    equal(exeReport.counts.failed, 0);
    equal(exeReport.files.find((file) => file.path === "walk.anm")?.digest, digestModel(ANIMATION));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dump --json is byte-identical across runs and carries the counts", () => {
  const clean = createProject();
  const broken = createProject({ brokenBoard: true });
  try {
    const first = runCli(["dump", "--json", clean.root]);
    const second = runCli(["dump", "--json", clean.root]);
    equal(first.status, 0, first.stderr);
    equal(first.stdout, second.stdout);

    const report = JSON.parse(first.stdout) as {
      schema: number;
      counts: { parsed: number; skipped: number; failed: number };
      files: ReadonlyArray<{ path: string; status: string; digest?: string }>;
    };
    equal(report.schema, 1);
    deepEqual(report.counts, { parsed: 3, skipped: 4, failed: 0 });
    equal(report.files.length, 7);
    const animation = report.files.find((file) => file.path === "walk.anm");
    equal(animation?.digest, digestModel(ANIMATION));

    // A failure still prints the whole report, and the exit code carries the verdict.
    const failing = runCli(["dump", "--json", broken.root]);
    equal(failing.status, 1);
    const parsed = JSON.parse(failing.stdout) as { counts: { failed: number } };
    equal(parsed.counts.failed, 1);
  } finally {
    clean.cleanup();
    broken.cleanup();
  }
});

test("dump --record then --check round-trips, and a drifted digest fails naming the file", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const game = join(games, "alpha");
  try {
    for (const [path, bytes] of [
      ["walk.anm", ANIMATION_BYTES],
      ["Tiles/base.tst", TILESET_BYTES],
      ["Media/song.mid", new Uint8Array([1, 2, 3])],
    ] as ReadonlyArray<readonly [string, Uint8Array]>) {
      const target = join(game, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }

    const expectationPath = join(games, "expectation.json");
    const recorded = runCli(["dump", "--record", expectationPath, games]);
    equal(recorded.status, 0, recorded.stderr);

    const checked = runCli(["dump", "--check", expectationPath, games]);
    equal(checked.status, 0, checked.stderr);
    ok(checked.stdout.includes("alpha: 2 parsed, 1 skipped, 0 failed, 2 digests match"), checked.stdout);

    writeFileSync(join(game, "walk.anm"), unwrap(writeAnimation({ ...ANIMATION, delay: 0.5 })));
    const drifted = runCli(["dump", "--check", expectationPath, games]);
    equal(drifted.status, 1);
    ok(drifted.stderr.includes("alpha: walk.anm"), drifted.stderr);
    ok(drifted.stderr.includes("differs"), drifted.stderr);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});
test("dump --record prunes cleared expectedFailures while preserving active ones", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const game = join(games, "alpha");
  try {
    mkdirSync(join(game, "Boards"), { recursive: true });
    writeFileSync(join(game, "walk.anm"), ANIMATION_BYTES);
    writeFileSync(join(game, "Boards/broken.brd"), TRUNCATED_BOARD);

    const expectationPath = join(games, "expectation.json");
    const initial = buildExpectation({
      alpha: {
        counts: { parsed: 0, skipped: 0, failed: 2 },
        digests: {},
        expectedFailures: {
          "walk.anm": "ticket-cleared",
          "Boards/broken.brd": "ticket-still-failing",
        },
      },
    });
    writeFileSync(expectationPath, serializeExpectation(initial), "utf8");

    const recorded = runCli(["dump", "--record", expectationPath, games]);
    equal(recorded.status, 0, recorded.stderr);

    const parsed = parseExpectation(readFileSync(expectationPath, "utf8"), expectationPath);
    equal(parsed.games["alpha"]?.expectedFailures?.["walk.anm"], undefined);
    equal(parsed.games["alpha"]?.expectedFailures?.["Boards/broken.brd"], "ticket-still-failing");
    ok(parsed.games["alpha"]?.digests["walk.anm"] !== undefined);

    const checked = runCli(["dump", "--check", expectationPath, games]);
    equal(checked.status, 0, checked.stderr);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});


test("dump --check fails naming a game folder the expectation does not name", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const alpha = join(games, "alpha");
  try {
    mkdirSync(alpha, { recursive: true });
    writeFileSync(join(alpha, "walk.anm"), ANIMATION_BYTES);
    const expectationPath = join(games, "expectation.json");
    const recorded = runCli(["dump", "--record", expectationPath, games]);
    equal(recorded.status, 0, recorded.stderr);

    // A folder the expectation does not name is a gate failure, not silence.
    const beta = join(games, "beta");
    mkdirSync(beta, { recursive: true });
    writeFileSync(join(beta, "start.prg"), PRG_TEXT);

    const checked = runCli(["dump", "--check", expectationPath, games]);
    equal(checked.status, 1);
    ok(checked.stderr.includes("beta"), checked.stderr);
    ok(checked.stderr.includes("does not name"), checked.stderr);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});

test("check reports a file that is present but no longer parses, not one that is missing", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const game = join(games, "alpha");
  try {
    mkdirSync(game, { recursive: true });
    writeFileSync(join(game, "walk.anm"), ANIMATION_BYTES);
    const expectationPath = join(games, "expectation.json");
    const recorded = runCli(["dump", "--record", expectationPath, games]);
    equal(recorded.status, 0, recorded.stderr);

    // Present, but no longer an animation: it failed, it did not vanish.
    writeFileSync(join(game, "walk.anm"), TRUNCATED_ANIMATION);
    const checked = runCli(["dump", "--check", expectationPath, games]);
    equal(checked.status, 1);
    ok(checked.stderr.includes("alpha: walk.anm"), checked.stderr);
    ok(checked.stderr.includes("failed to parse"), checked.stderr);
    ok(!checked.stderr.includes("is missing"), checked.stderr);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});

test("dump --record refuses a corpus that does not parse", () => {
  const games = mkdtempSync(join(tmpdir(), "rpg-dump-games-"));
  const game = join(games, "broken");
  try {
    mkdirSync(join(game, "Boards"), { recursive: true });
    writeFileSync(join(game, "Boards/broken.brd"), TRUNCATED_BOARD);
    const result = runCli(["dump", "--record", join(games, "expectation.json"), games]);
    equal(result.status, 1);
    ok(result.stderr.includes("refusing to record"), result.stderr);
    ok(result.stderr.includes("Boards/broken.brd"), result.stderr);
  } finally {
    rmSync(games, { recursive: true, force: true });
  }
});

test("a symbolic link in a project folder is refused, never followed", () => {
  const project = createProject();
  try {
    symlinkSync(join(project.root, "walk.anm"), join(project.root, "linked.anm"));
    const result = runCli(["dump", project.root]);
    equal(result.status, 1);
    ok(result.stderr.includes("symbolic link"), result.stderr);
  } finally {
    project.cleanup();
  }
});

test("a plain file that is not a package is refused with the three accepted forms", () => {
  const project = createProject();
  try {
    const result = runCli(["dump", join(project.root, "walk.anm")]);
    equal(result.status, 1);
    ok(result.stderr.includes("not a project folder, a .tpk or a .exe"), result.stderr);
  } finally {
    project.cleanup();
  }
});

test("dump usage errors exit 1 with a named message", () => {
  const cases: ReadonlyArray<readonly [string[], RegExp]> = [
    [["dump"], /missing path/],
    [["dump", "--nope"], /unknown flag: --nope/],
    [["dump", "one", "two"], /unexpected argument 'two'/],
    [["dump", "--check"], /--check needs a file/],
    [["dump", "--check", "e.json", "--record", "r.json", "games"], /cannot be combined/],
    [["dump", "--json", "--check", "e.json", "games"], /--json is for a single project/],
  ];
  for (const [args, pattern] of cases) {
    const result = runCli(args);
    equal(result.status, 1, args.join(" "));
    ok(pattern.test(result.stderr), `${args.join(" ")}: ${result.stderr}`);
  }

  equal(main(["dump"]), 1);
  equal(main(["dump", "--nope"]), 1);
});
