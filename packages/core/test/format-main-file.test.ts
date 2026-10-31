// The main game file (.gam) reader, writer and project layout of docs/spec/formats/main-file.md#layout and docs/spec/formats/README.md#paths-inside-files (AD-18).
//
// Synthetic buffers, one per minor, pin the layout and all twelve of docs/spec/formats/main-file.md#layout's
// version-dependent rows. The fetched corpus `demo.gam` is exercised by
// `pnpm dump:check`.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BinaryReader,
  BinaryWriter,
  decodeGameSpeed,
  encodeGameSpeed,
  foldPath,
  MAIN_PROJECT_PATH_OFFSET,
  MAIN_SECTION,
  projectFolder,
  readMainFile,
  resolveReference,
  stripTypeFolder,
  toSlashes,
  typeFolder,
  writeMainFile,
} from "../src/index.ts";
import type { MainFile, Result } from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

/** Append a string, throwing if it cannot be encoded (the fixtures are ASCII). */
function putStr(writer: BinaryWriter, value: string): void {
  const r = writer.str(value);
  if (!r.ok) {
    throw new Error(r.error.message);
  }
}

/** The fields a synthetic main file lets a test vary. */
interface BuildOptions {
  /** The raw stored `gameSpeed` byte; defaults per the minor. */
  readonly gameSpeedStored?: number;
  /** The raw stored `fightingDisabled` i16; defaults to 0 (fighting enabled). */
  readonly fightingDisabled?: number;
}

/** A built fixture: its bytes plus the offset each marked field group starts at. */
interface Built {
  readonly bytes: Uint8Array;
  readonly offsets: Readonly<Record<string, number>>;
}

const MAGIC = "RPGTLKIT MAIN";
const PARALLAX = new Uint8Array([0x11, 0x22]);
const MENU_FALLBACK = new Uint8Array([0x51, 0x52]);
const MULTITASK = new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65, 0x66]);
const FIGHT_STYLE = new Uint8Array([0x71, 0x72]);
const SCAN_CODES = [30, 31, 32, 33, 34, 35, 36, 37];

/**
 * Serialise a synthetic `.gam` for `minor`, writing the rows docs/spec/formats/main-file.md#layout lists for that
 * minor with distinctive sentinels and recording where each conditional group
 * begins. Built independently of `writeMainFile` so a reader/writer agreement
 * bug cannot hide behind a shared serialiser.
 */
function buildGam(minor: number, options: BuildOptions = {}): Built {
  const writer = new BinaryWriter();
  const offsets: Record<string, number> = {};
  const mark = (name: string): void => {
    offsets[name] = writer.toBytes().length;
  };

  putStr(writer, MAGIC);
  writer.i16(2);
  writer.i16(minor);
  mark("registrationFlag");
  writer.i16(1);
  mark("registrationCode");
  putStr(writer, "NOCODE");
  mark("projectPath");
  putStr(writer, "demo");
  putStr(writer, "Demo Game");
  writer.i16(2);
  writer.i16(1);
  writer.i16(1);
  if (minor < 3) {
    mark("parallax");
    writer.writeBytes(PARALLAX);
  }
  writer.i16(7);
  putStr(writer, "lang.txt");
  putStr(writer, "start.prg");
  putStr(writer, "start.brd");
  putStr(writer, "hero.tem");
  putStr(writer, "rt.prg");
  writer.i16(82);
  writer.i16(77);
  writer.i16(32);
  writer.i16(1); // extKeys upper bound: two entries
  writer.i16(65);
  putStr(writer, "a.prg");
  writer.i16(66);
  putStr(writer, "");
  if (minor >= 3) {
    mark("menuPlugin");
    putStr(writer, "menu.plg");
    putStr(writer, "fight.plg");
  } else {
    mark("menuPluginFallback");
    writer.writeBytes(MENU_FALLBACK);
  }
  if (minor <= 2) {
    mark("multitask");
    writer.writeBytes(MULTITASK);
  }
  writer.i16(options.fightingDisabled ?? 0);
  writer.i16(1); // enemy upper bound: two entries
  putStr(writer, "slime.ene");
  writer.i16(3);
  putStr(writer, "bat.ene");
  writer.i16(-1);
  writer.i16(1);
  writer.i32(25);
  writer.i16(1);
  putStr(writer, "fight.prg");
  if (minor < 3) {
    mark("fightStyle");
    writer.writeBytes(FIGHT_STYLE);
  }
  putStr(writer, "over.prg");
  putStr(writer, "btn.png");
  putStr(writer, "win.png");
  writer.i16(1); // plugin upper bound: two entries
  if (minor <= 2) {
    writer.i16(1);
    writer.i16(-1);
  } else {
    putStr(writer, "plug1.dll");
    putStr(writer, "plug2.dll");
  }
  writer.i16(1);
  writer.i16(1);
  writer.i32(1440);
  if (minor >= 3) {
    mark("cursorMoveSound");
    putStr(writer, "cm.wav");
    putStr(writer, "cs.wav");
    putStr(writer, "cc.wav");
    writer.u8(1);
    writer.u8(24);
  }
  if (minor >= 4) {
    mark("gameSpeed");
    writer.u8(options.gameSpeedStored ?? (minor >= 8 ? 125 : 2));
    writer.u8(1);
  }
  if (minor === 5) {
    mark("cursorEnabled");
    writer.u8(1);
  }
  if (minor >= 6) {
    mark("mouseCursor");
    putStr(writer, "TK DEFAULT");
    mark("hotSpotX");
    writer.u8(3);
    mark("hotSpotY");
    writer.u8(4);
    mark("transparent");
    writer.color({ r: 0xff, g: 0x00, b: 0x00 });
  }
  if (minor >= 7) {
    mark("resX");
    writer.i32(1280);
    mark("resY");
    writer.i32(720);
  }
  if (minor >= 8) {
    mark("showFpsInTitle");
    writer.u8(1);
  }
  if (minor >= 9) {
    mark("pathfindHeuristic");
    writer.i16(1);
    mark("drawVectorsFlags");
    writer.i32(11);
    mark("pathColor");
    writer.color({ r: 0x00, g: 0x00, b: 0xff });
    mark("movementControls");
    writer.i32(5);
    mark("movementScanCodes");
    for (const scan of SCAN_CODES) {
      writer.i16(scan);
    }
  }

  return { bytes: writer.toBytes(), offsets };
}

/** Read a fixture and assert it consumed every byte. */
function readBuilt(built: Built): MainFile {
  const reader = new BinaryReader(built.bytes);
  const model = unwrap(readMainFile(reader));
  equal(reader.remaining, 0, "the reader must consume the whole file");
  return model;
}

test("the header, registration rows and always-present fields read back", () => {
  const built = buildGam(9);
  const model = readBuilt(built);
  equal(model.magic, MAGIC);
  equal(model.major, 2);
  equal(model.minor, 9);
  equal(model.registrationFlag, 1);
  equal(model.registrationCode, "NOCODE");
  equal(model.projectPath, "demo");
  equal(model.gameTitle, "Demo Game");
  equal(model.screenType, 2);
  equal(model.extendToFullScreen, 1);
  equal(model.resolution, 1);
  equal(model.disableProtectReg, 7);
  equal(model.languageFile, "lang.txt");
  equal(model.startupPrg, "start.prg");
  equal(model.initBoard, "start.brd");
  equal(model.initChar, "hero.tem");
  equal(model.runTimePrg, "rt.prg");
  equal(model.runTimeKey, 82);
  equal(model.menuKey, 77);
  equal(model.activationKey, 32);
  equal(model.fightType, 1);
  equal(model.chances, 25);
  equal(model.useCustomFightPrg, 1);
  equal(model.customFightPrg, "fight.prg");
  equal(model.gameOverPrg, "over.prg");
  equal(model.skinButton, "btn.png");
  equal(model.skinWindow, "win.png");
  equal(model.useDayNight, 1);
  equal(model.dayNightType, 1);
  equal(model.dayLengthMinutes, 1440);
});

test("the upper-bound lists keep empty entries and round-trip", () => {
  const model = readBuilt(buildGam(9));
  deepEqual(model.extKeys, [
    { asciiKey: 65, program: "a.prg" },
    { asciiKey: 66, program: "" },
  ]);
  deepEqual(model.enemies, [
    { enemyFile: "slime.ene", skillLevel: 3 },
    { enemyFile: "bat.ene", skillLevel: -1 },
  ]);
});

test("minor 2 reads every reserved run of the pre-3 layout", () => {
  const built = buildGam(2);
  const model = readBuilt(built);
  deepEqual(model.reservedRuns.parallax, PARALLAX);
  deepEqual(model.reservedRuns.menuPluginFallback, MENU_FALLBACK);
  deepEqual(model.reservedRuns.multitask, MULTITASK);
  deepEqual(model.reservedRuns.fightStyle, FIGHT_STYLE);
  // The minor ≥ 3 rows are absent: their models hold the defaults.
  equal(model.menuPlugin, "");
  equal(model.fightPlugin, "");
  equal(model.cursorMoveSound, "");
  equal(model.gameSpeed, 0);
  equal(model.cursorEnabled, 0);
  equal(model.mouseCursor, "");
  equal(model.resX, 0);
  equal(model.showFpsInTitle, 0);
  equal(model.pathfindHeuristic, 0);
  equal(model.movementScanCodes.length, 0);
  // The plugin list stores the implied-name form at minor ≤ 2.
  deepEqual(model.plugins, [
    { enabled: 1, pluginFile: "" },
    { enabled: -1, pluginFile: "" },
  ]);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("minors 0 and 1 read the same pre-3 rows as minor 2", () => {
  for (const minor of [0, 1, 2]) {
    const model = readBuilt(buildGam(minor));
    deepEqual(model.reservedRuns.parallax, PARALLAX);
    deepEqual(model.reservedRuns.multitask, MULTITASK);
    deepEqual(model.reservedRuns.fightStyle, FIGHT_STYLE);
    equal(model.minor, minor);
  }
});

test("minor 3 switches on the plugin names and the cursor block", () => {
  const built = buildGam(3);
  const model = readBuilt(built);
  equal(model.menuPlugin, "menu.plg");
  equal(model.fightPlugin, "fight.plg");
  deepEqual(model.reservedRuns.parallax, new Uint8Array(0));
  deepEqual(model.reservedRuns.menuPluginFallback, new Uint8Array(0));
  deepEqual(model.reservedRuns.multitask, new Uint8Array(0));
  deepEqual(model.reservedRuns.fightStyle, new Uint8Array(0));
  equal(model.cursorMoveSound, "cm.wav");
  equal(model.cursorSelectSound, "cs.wav");
  equal(model.cursorCancelSound, "cc.wav");
  equal(model.useJoystick, 1);
  equal(model.colorDepth, 24);
  deepEqual(model.plugins, [
    { enabled: 0, pluginFile: "plug1.dll" },
    { enabled: 0, pluginFile: "plug2.dll" },
  ]);
  // Rows keyed on minor ≥ 4 are absent.
  equal(model.gameSpeed, 0);
  equal(model.pixelMovement, 0);
  equal(model.cursorEnabled, 0);
  equal(model.mouseCursor, "");
  equal(model.resX, 0);
  equal(model.pathfindHeuristic, 0);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("minor 4 adds gameSpeed and pixelMovement, un-biased below minor 8", () => {
  const built = buildGam(4, { gameSpeedStored: 2 });
  const model = readBuilt(built);
  equal(model.gameSpeed, 2);
  equal(model.pixelMovement, 1);
  equal(model.mouseCursor, "");
  equal(model.resX, 0);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("below minor 8 the stored gameSpeed byte is the raw speed", () => {
  const model = readBuilt(buildGam(6, { gameSpeedStored: 200 }));
  equal(model.gameSpeed, 200);
  equal(decodeGameSpeed(6, 200), 200);
  equal(encodeGameSpeed(6, 200), 200);
});

test("minor 5 stores cursorEnabled and no mouse-cursor block", () => {
  const built = buildGam(5);
  const model = readBuilt(built);
  equal(model.cursorEnabled, 1);
  equal(model.mouseCursor, "");
  equal(model.hotSpotX, 0);
  equal(model.gameSpeed, 2);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("minor 6 adds the mouse cursor, hot spot and transparent colour", () => {
  const built = buildGam(6);
  const model = readBuilt(built);
  equal(model.mouseCursor, "TK DEFAULT");
  equal(model.hotSpotX, 3);
  equal(model.hotSpotY, 4);
  deepEqual(model.transparent, { r: 0xff, g: 0x00, b: 0x00 });
  equal(model.cursorEnabled, 0);
  equal(model.resX, 0);
  equal(model.showFpsInTitle, 0);
  // Widths: `"TK DEFAULT\0"` is 11 bytes, then two u8s, then a 4-byte colour.
  equal(built.offsets.hotSpotX! - built.offsets.mouseCursor!, 11);
  equal(built.offsets.hotSpotY! - built.offsets.hotSpotX!, 1);
  equal(built.offsets.transparent! - built.offsets.hotSpotY!, 1);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("minor 7 adds the custom resolution as two i32s", () => {
  const built = buildGam(7);
  const model = readBuilt(built);
  equal(model.resX, 1280);
  equal(model.resY, 720);
  equal(built.offsets.resY! - built.offsets.resX!, 4);
  equal(model.showFpsInTitle, 0);
  equal(model.pathfindHeuristic, 0);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("minor 8 biases the stored gameSpeed byte by +128, negative speeds included", () => {
  const built = buildGam(8, { gameSpeedStored: 125 });
  const model = readBuilt(built);
  equal(model.gameSpeed, -3);
  equal(model.showFpsInTitle, 1);
  equal(model.pathfindHeuristic, 0);
  // The stored byte really is speed + 128.
  equal(built.bytes[built.offsets.gameSpeed!], 125);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);

  equal(decodeGameSpeed(8, 124), -4);
  equal(decodeGameSpeed(8, 132), 4);
  equal(encodeGameSpeed(8, -4), 124);
});

test("minor 9 adds pathfinding, debug vectors and the eight scan codes", () => {
  const built = buildGam(9);
  const model = readBuilt(built);
  equal(model.pathfindHeuristic, 1);
  equal(model.drawVectorsFlags, 11);
  deepEqual(model.pathColor, { r: 0x00, g: 0x00, b: 0xff });
  equal(model.movementControls, 5);
  deepEqual(model.movementScanCodes, SCAN_CODES);
  // Order and widths: i16 heuristic, i32 flags, colour, i32 controls, 8 × i16.
  equal(built.offsets.drawVectorsFlags! - built.offsets.pathfindHeuristic!, 2);
  equal(built.offsets.pathColor! - built.offsets.drawVectorsFlags!, 4);
  equal(built.offsets.movementControls! - built.offsets.pathColor!, 4);
  equal(built.offsets.movementScanCodes! - built.offsets.movementControls!, 4);
  deepEqual(unwrap(writeMainFile(model)), built.bytes);
});

test("every conditional scalar row follows the spec page's own condition, and only that condition", () => {
  // Source: docs/spec/formats/main-file.md#layout "Present when". Each entry cites the row and repeats the
  // page's wording, so this table is checkable against the page rather than against the builder.
  const rows: readonly (readonly [number, string, string, (minor: number) => boolean])[] = [
    [11, "parallax", "minor < 3", (minor) => minor < 3],
    [23, "menuPlugin", "minor ≥ 3", (minor) => minor >= 3],
    [23, "menuPluginFallback", "minor < 3 (row 23′)", (minor) => minor < 3],
    [25, "multitask", "minor ≤ 2", (minor) => minor <= 2],
    [33, "fightStyle", "minor < 3", (minor) => minor < 3],
    [42, "cursorMoveSound", "minor ≥ 3", (minor) => minor >= 3],
    [47, "gameSpeed", "minor ≥ 4", (minor) => minor >= 4],
    [49, "cursorEnabled", "minor = 5", (minor) => minor === 5],
    [50, "mouseCursor", "minor ≥ 6", (minor) => minor >= 6],
    [54, "resX", "minor ≥ 7", (minor) => minor >= 7],
    [56, "showFpsInTitle", "minor ≥ 8", (minor) => minor >= 8],
    [57, "pathfindHeuristic", "minor ≥ 9", (minor) => minor >= 9],
  ];
  for (const [row, name, condition, expected] of rows) {
    let transitions = 0;
    let previous: boolean | undefined;
    for (let minor = 0; minor <= 9; minor += 1) {
      const present = buildGam(minor).offsets[name] !== undefined;
      equal(present, expected(minor), `row ${row} (${name}) at minor ${minor}: the page says "${condition}"`);
      if (previous !== undefined && present !== previous) transitions += 1;
      previous = present;
    }
    // A condition that is an inequality changes presence once; `minor = 5` changes it twice.
    equal(transitions, condition === "minor = 5" ? 2 : 1, `row ${row} (${name}) changes presence ${transitions} time(s)`);
  }
});

test("the inverted fighting flag: 0 is enabled and non-zero is disabled", () => {
  equal(readBuilt(buildGam(9, { fightingDisabled: 0 })).fightingDisabled, 0);
  const disabled = readBuilt(buildGam(9, { fightingDisabled: 1 }));
  equal(disabled.fightingDisabled, 1);
  deepEqual(unwrap(writeMainFile(disabled)), buildGam(9, { fightingDisabled: 1 }).bytes);
});

test("the registration quirk: the editor and the legacy reader land at the same offset", () => {
  const built = buildGam(0);

  // The editor's shape: an i16 flag then `"NOCODE"`.
  const editor = new BinaryReader(built.bytes);
  equal(unwrap(editor.str()), MAGIC);
  unwrap(editor.i16());
  unwrap(editor.i16());
  equal(unwrap(editor.i16()), 1);
  equal(unwrap(editor.str()), "NOCODE");
  equal(editor.offset, MAIN_PROJECT_PATH_OFFSET);

  // The legacy C++ reader's shape: an i32 then a str, eating two bytes of the
  // string and reading the rest. Same landing offset.
  const legacy = new BinaryReader(built.bytes);
  unwrap(legacy.str());
  unwrap(legacy.i16());
  unwrap(legacy.i16());
  equal(unwrap(legacy.i32()), 0x4f4e0001);
  equal(unwrap(legacy.str()), "CODE");
  equal(legacy.offset, MAIN_PROJECT_PATH_OFFSET);

  // Our reader follows the editor, so the registration rows round-trip.
  const model = readBuilt(built);
  equal(model.registrationFlag, 1);
  equal(model.registrationCode, "NOCODE");
  equal(model.projectPath, "demo");
  equal(built.offsets.projectPath, MAIN_PROJECT_PATH_OFFSET);
});

test("every minor 0–9 reads with zero trailing bytes and writes back byte-for-byte", () => {
  for (let minor = 0; minor <= 9; minor += 1) {
    const built = buildGam(minor);
    const model = readBuilt(built);
    equal(model.minor, minor);
    deepEqual(unwrap(writeMainFile(model)), built.bytes, `minor ${minor} round-trip`);
  }
});
test("TKR package extension round-trips ordered names, explicit empty state, residue, and legacy rows", () => {
  const legacy = readBuilt(buildGam(9));
  const authored = { ...legacy, menuPlugin: "menu.dll", fightPlugin: "fight.dll", plugins: legacy.plugins, packagePlugins: ["zeta", "Alpha"], packagePluginsExtension: true, residue: new Uint8Array([0x99]) };
  const bytes = unwrap(writeMainFile(authored));
  const decoded = unwrap(readMainFile(new BinaryReader(bytes, "authored.gam")));
  deepEqual(decoded.packagePlugins, ["zeta", "Alpha"]);
  deepEqual(decoded.residue, new Uint8Array([0x99]));
  equal(decoded.menuPlugin, "menu.dll");
  equal(decoded.fightPlugin, "fight.dll");
  const empty = unwrap(readMainFile(new BinaryReader(unwrap(writeMainFile({ ...legacy, packagePlugins: [], packagePluginsExtension: true })))));
  deepEqual(empty.packagePlugins, []);
  equal(legacy.packagePlugins, undefined);
});

test("TKR package extension rejects NUL names and reports malformed bytes at file offsets", () => {
  const legacy = readBuilt(buildGam(9));
  equal(writeMainFile({ ...legacy, packagePlugins: ["core\0rogue"] }).ok, false);
  const bytes = unwrap(writeMainFile({ ...legacy, packagePlugins: ["one"], packagePluginsExtension: true }));
  const malformed = bytes.slice(0, -1);
  const result = readMainFile(new BinaryReader(malformed, "bad.gam"));
  equal(result.ok, false);
  if (!result.ok) equal(result.error.offset, bytes.length - 4);
});
test("TKR package extension enforces independent count, empty, duplicate, and 255-byte boundaries", () => {
  const legacy = readBuilt(buildGam(9));
  const base = unwrap(writeMainFile(legacy));
  const append = (count: number, names: readonly Uint8Array[]): Uint8Array => {
    const tail = new Uint8Array(10 + names.reduce((sum, name) => sum + name.length + 1, 0));
    tail.set([0x54, 0x4b, 0x52, 0x50, 0x4c, 0x55, 0x47, 0, count & 0xff, count >> 8]);
    let at = 10;
    for (const name of names) { tail.set(name, at); at += name.length; tail[at++] = 0; }
    const out = new Uint8Array(base.length + tail.length);
    out.set(base, 0);
    out.set(tail, base.length);
    return out;
  };
  equal(readMainFile(new BinaryReader(append(1, [new Uint8Array(0)]))).ok, false);
  equal(readMainFile(new BinaryReader(append(2, [new Uint8Array([0x78])]))).ok, false);
  equal(readMainFile(new BinaryReader(append(2, [new Uint8Array([0x78]), new Uint8Array([0x58])]))).ok, false);
  equal(readMainFile(new BinaryReader(append(1, [new Uint8Array(255).fill(0x61)]))).ok, true);
  equal(readMainFile(new BinaryReader(append(1, [new Uint8Array(256).fill(0x61)]))).ok, false);
});

// --- TKR audio-settings extension -------------------------------------------
// docs/spec/formats/main-file.md#tkr-audio-settings-extension

const AUDIO_TRACKS = [
  { name: "music", voiceCount: 2 },
  { name: "sfx", voiceCount: 2 },
  { name: "ambience", voiceCount: 4 },
  { name: "voice", voiceCount: 2 },
  { name: "ui", voiceCount: 4 },
  { name: "weather", voiceCount: 1 },
] as const;

function audioTail(
  tracks: readonly { readonly name: string; readonly voiceCount: number }[],
  voiceCap: number,
  font: string | null,
  tag: readonly number[] = [0x54, 0x52, 0x4b, 0x41, 0x55, 0x44, 0],
): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeBytes(new Uint8Array(tag));
  writer.u16(tracks.length);
  for (const track of tracks) {
    putStr(writer, track.name);
    writer.u16(track.voiceCount);
  }
  writer.u16(voiceCap);
  if (font === null) {
    writer.u8(0);
  } else {
    writer.u8(1);
    putStr(writer, font);
  }
  return writer.toBytes();
}

function withTail(base: Uint8Array, tail: Uint8Array): Uint8Array {
  const out = new Uint8Array(base.length + tail.length);
  out.set(base, 0);
  out.set(tail, base.length);
  return out;
}

test("TKR audio extension round-trips tracks, counts, cap, font, both-block order and residue", () => {
  const legacy = readBuilt(buildGam(9));
  const audioSettings = { tracks: AUDIO_TRACKS, voiceCap: 20, defaultSoundFont: "Media/town.sf2" };
  const authored = {
    ...legacy,
    packagePlugins: ["quests"],
    packagePluginsExtension: true,
    audioSettings,
    residue: new Uint8Array([0x99]),
  };
  const bytes = unwrap(writeMainFile(authored));
  const decoded = unwrap(readMainFile(new BinaryReader(bytes, "audio.gam")));
  deepEqual(decoded.audioSettings, audioSettings);
  deepEqual(decoded.packagePlugins, ["quests"]);
  deepEqual(decoded.residue, new Uint8Array([0x99]));
  deepEqual(unwrap(writeMainFile(decoded)), bytes);

  // The audio tag follows the package block, and it is the literal seven bytes TRKAUD\0.
  const packageEnd = bytes.length - audioTail(AUDIO_TRACKS, 20, "Media/town.sf2").length - 1;
  deepEqual([...bytes.slice(packageEnd, packageEnd + 7)], [0x54, 0x52, 0x4b, 0x41, 0x55, 0x44, 0]);
  equal(unwrap(readMainFile(new BinaryReader(new Uint8Array([...bytes.slice(0, packageEnd)])))).audioSettings, null);
});

test("an audio block without a package list round-trips, and an absent block leaves the model unchanged", () => {
  const legacy = readBuilt(buildGam(9));
  deepEqual(unwrap(writeMainFile(legacy)), buildGam(9).bytes);
  equal(legacy.audioSettings, null);
  const noFont = { tracks: AUDIO_TRACKS, voiceCap: 12, defaultSoundFont: null };
  const bytes = unwrap(writeMainFile({ ...legacy, audioSettings: noFont }));
  const decoded = unwrap(readMainFile(new BinaryReader(bytes)));
  deepEqual(decoded.audioSettings, noFont);
  equal(decoded.packagePlugins, undefined);
  equal(decoded.audioSettings?.defaultSoundFont, null);
  equal(unwrap(writeMainFile(decoded)).length, bytes.length);
});

test("the audio writer refuses names, order, counts, caps and fonts it cannot represent", () => {
  const legacy = readBuilt(buildGam(9));
  const bad: readonly { readonly settings: unknown; readonly why: string }[] = [
    { settings: { tracks: AUDIO_TRACKS.slice(0, 4), voiceCap: 12 }, why: "four tracks" },
    { settings: { tracks: [...AUDIO_TRACKS, { name: "x", voiceCount: 1 }, { name: "y", voiceCount: 1 }, { name: "z", voiceCount: 1 }, { name: "w", voiceCount: 1 }, { name: "v", voiceCount: 1 }, { name: "u", voiceCount: 1 }, { name: "t", voiceCount: 1 }, { name: "s", voiceCount: 1 }, { name: "r", voiceCount: 1 }, { name: "q", voiceCount: 1 }, { name: "p", voiceCount: 1 }], voiceCap: 32 }, why: "seventeen tracks" },
    { settings: { tracks: AUDIO_TRACKS.map((track, index) => index === 0 ? { ...track, name: "sfx" } : track), voiceCap: 20 }, why: "wrong first built-in" },
    { settings: { tracks: [...AUDIO_TRACKS, { name: "Weather", voiceCount: 1 }], voiceCap: 20 }, why: "duplicate under folding" },
    { settings: { tracks: AUDIO_TRACKS.map((track, index) => index === 5 ? { ...track, name: "bad name" } : track), voiceCap: 20 }, why: "invalid name" },
    { settings: { tracks: AUDIO_TRACKS.map((track, index) => index === 5 ? { ...track, voiceCount: 0 } : track), voiceCap: 20 }, why: "zero voices" },
    { settings: { tracks: AUDIO_TRACKS, voiceCap: 0 }, why: "cap zero" },
    { settings: { tracks: AUDIO_TRACKS, voiceCap: 33 }, why: "cap 33" },
    { settings: { tracks: AUDIO_TRACKS, voiceCap: 20, defaultSoundFont: "" }, why: "empty font" },
  ];
  for (const item of bad) {
    equal(writeMainFile({ ...legacy, audioSettings: { defaultSoundFont: null, ...item.settings as object } as never }).ok, false, item.why);
  }
  // An aggregate over the cap is representable data; the engine reports it at load.
  equal(writeMainFile({ ...legacy, audioSettings: { tracks: AUDIO_TRACKS, voiceCap: 10, defaultSoundFont: null } }).ok, true);
  equal(writeMainFile({ ...legacy, audioSettings: { tracks: AUDIO_TRACKS, voiceCap: 20 } as never }).ok, false, "missing nullable font is not a typed settings shape");
  equal(writeMainFile({ ...legacy, audioSettings: undefined } as never).ok, false, "missing nullable audioSettings is not a typed main-file shape");
});

test("the audio reader rejects malformed envelopes at a located offset", () => {
  const base = unwrap(writeMainFile(readBuilt(buildGam(9))));
  const rejects = (tail: Uint8Array): void => {
    const result = readMainFile(new BinaryReader(withTail(base, tail)));
    equal(result.ok, false);
    if (!result.ok) {
      equal(result.error.message.includes("tkr-audio-settings-extension"), true);
      equal(result.error.offset >= base.length, true);
    }
  };
  rejects(audioTail(AUDIO_TRACKS.slice(0, 4), 12, null));
  rejects(audioTail(AUDIO_TRACKS.map((track, index) => index === 0 ? { ...track, name: "sfx" } : track), 20, null));
  rejects(audioTail([...AUDIO_TRACKS, { name: "Weather", voiceCount: 1 }], 20, null));
  rejects(audioTail(AUDIO_TRACKS.map((track, index) => index === 5 ? { ...track, name: "" } : track), 20, null));
  rejects(audioTail(AUDIO_TRACKS.map((track, index) => index === 5 ? { ...track, voiceCount: 0 } : track), 20, null));
  rejects(audioTail(AUDIO_TRACKS, 0, null));
  rejects(audioTail(AUDIO_TRACKS, 33, null));
  rejects(audioTail(AUDIO_TRACKS, 20, ""));
  const badFlag = audioTail(AUDIO_TRACKS, 20, null);
  badFlag[badFlag.length - 1] = 2;
  rejects(badFlag);
  rejects(audioTail(AUDIO_TRACKS, 20, "Media/town.sf2").slice(0, -3));
});



// --- The writer refuses a model it cannot represent (AD-18) ------------------
//
// `BinaryWriter` truncates an out-of-range integer and the serialiser derives
// the list bounds, so without a check a model the reader could never produce
// would be written as a different, valid file. Each of these mutates one field
// of a model that came from `readMainFile` and asserts the write is refused at
// docs/spec/formats/main-file.md#layout.

test("the writer refuses a model whose magic is not the main-file magic", () => {
  const model = readBuilt(buildGam(9));
  const result = writeMainFile({ ...model, magic: "RPGTLKIT BOARD" });
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section, MAIN_SECTION);
  }
});

test("the writer refuses a minor outside 0–9", () => {
  const model = readBuilt(buildGam(9));
  for (const minor of [-1, 10]) {
    const result = writeMainFile({ ...model, minor });
    equal(result.ok, false, `minor ${minor} must be refused`);
    if (!result.ok) {
      equal(result.error.section, MAIN_SECTION);
    }
  }
});

test("the writer refuses an i16 field the BinaryWriter would truncate", () => {
  const model = readBuilt(buildGam(9));
  const scalar = writeMainFile({ ...model, screenType: 40_000 });
  equal(scalar.ok, false);
  if (!scalar.ok) {
    equal(scalar.error.section, MAIN_SECTION);
  }
  // The per-entry i16 fields are checked too.
  const entry = writeMainFile({
    ...model,
    enemies: [{ enemyFile: "slime.ene", skillLevel: 40_000 }],
  });
  equal(entry.ok, false);
  if (!entry.ok) {
    equal(entry.error.section, MAIN_SECTION);
  }
});

test("the writer refuses an i32 field the BinaryWriter would truncate", () => {
  const model = readBuilt(buildGam(9));
  const result = writeMainFile({ ...model, chances: 2_147_483_648 });
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section, MAIN_SECTION);
  }
});

test("the writer refuses a u8 field the BinaryWriter would truncate", () => {
  const model = readBuilt(buildGam(9));
  const colour = writeMainFile({ ...model, colorDepth: 256 });
  equal(colour.ok, false);
  if (!colour.ok) {
    equal(colour.error.section, MAIN_SECTION);
  }
  // The biased gameSpeed byte wraps to a negative speed at minor ≥ 8.
  const speed = writeMainFile({ ...model, gameSpeed: 200 });
  equal(speed.ok, false);
  if (!speed.ok) {
    equal(speed.error.section, MAIN_SECTION);
  }
  // Below minor 8 the byte is the raw speed, so 200 is representable.
  const raw = readBuilt(buildGam(6, { gameSpeedStored: 200 }));
  deepEqual(unwrap(writeMainFile(raw)), buildGam(6, { gameSpeedStored: 200 }).bytes);
});

test("the writer refuses a list longer than its i16 upper bound", () => {
  const model = readBuilt(buildGam(9));
  const extKeys = Array.from({ length: 32_769 }, () => ({ asciiKey: 65, program: "" }));
  const result = writeMainFile({ ...model, extKeys });
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section, MAIN_SECTION);
  }
  // 32 768 entries is the last count the derived bound can carry.
  const most = writeMainFile({ ...model, extKeys: extKeys.slice(0, 32_768) });
  equal(most.ok, true);
});

test("the writer refuses a scan-code row that is not eight codes", () => {
  const model = readBuilt(buildGam(9));
  for (const movementScanCodes of [[30, 31, 32], [...SCAN_CODES, 38]]) {
    const result = writeMainFile({ ...model, movementScanCodes });
    equal(result.ok, false, `${movementScanCodes.length} scan codes must be refused`);
    if (!result.ok) {
      equal(result.error.section, MAIN_SECTION);
    }
  }
});

test("the writer refuses a reserved run of the wrong width for the minor", () => {
  // A pre-3 minor carries a 2-byte parallax row (R-18).
  const pre3 = readBuilt(buildGam(2));
  const short = writeMainFile({
    ...pre3,
    reservedRuns: { ...pre3.reservedRuns, parallax: new Uint8Array(1) },
  });
  equal(short.ok, false);
  if (!short.ok) {
    equal(short.error.section, MAIN_SECTION);
  }
  // A minor that does not carry it must leave it empty, not silently drop it.
  const post3 = readBuilt(buildGam(9));
  const stale = writeMainFile({
    ...post3,
    reservedRuns: { ...post3.reservedRuns, parallax: PARALLAX },
  });
  equal(stale.ok, false);
  if (!stale.ok) {
    equal(stale.error.section, MAIN_SECTION);
  }
});

test("a clean buffer leaves an empty residue and warns about nothing", () => {
  const result = readMainFile(new BinaryReader(buildGam(9).bytes));
  equal(result.ok, true);
  if (result.ok) {
    deepEqual(result.value.residue, new Uint8Array(0));
    deepEqual(result.warnings, []);
  }
});

test("trailing bytes become the residue, warn once and round-trip", () => {
  const trailing = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const clean = buildGam(9).bytes;
  const bytes = new Uint8Array(clean.length + trailing.length);
  bytes.set(clean);
  bytes.set(trailing, clean.length);

  const reader = new BinaryReader(bytes);
  const result = readMainFile(reader);
  equal(result.ok, true);
  if (result.ok) {
    deepEqual(result.value.residue, trailing);
    equal(reader.remaining, 0);
    deepEqual(result.warnings, [
      "4 trailing byte(s) after the main file were kept as residue (docs/spec/formats/README.md#bytes-after-the-last-documented-field)",
    ]);
    deepEqual(unwrap(writeMainFile(result.value)), bytes);
  }
});

test("a wrong magic is rejected at offset 0", () => {
  const writer = new BinaryWriter();
  putStr(writer, "RPGTLKIT BOARD");
  writer.i16(2);
  writer.i16(9);
  const result = readMainFile(new BinaryReader(writer.toBytes()));
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.offset, 0);
    equal(result.error.section, MAIN_SECTION);
    equal(result.error.message.includes("not a main file"), true);
  }
});

test("a minor above 9 is rejected at its own offset", () => {
  const result = readMainFile(new BinaryReader(buildGam(10).bytes));
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.offset, 16);
    equal(result.error.section, MAIN_SECTION);
    equal(result.error.message.includes("minor 10"), true);
  }
});

test("a negative version is rejected", () => {
  const negativeMinor = readMainFile(new BinaryReader(buildGam(-1).bytes));
  equal(negativeMinor.ok, false);
  if (!negativeMinor.ok) {
    equal(negativeMinor.error.offset, 16);
  }
  const writer = new BinaryWriter();
  putStr(writer, MAGIC);
  writer.i16(-1);
  writer.i16(9);
  const negativeMajor = readMainFile(new BinaryReader(writer.toBytes()));
  equal(negativeMajor.ok, false);
  if (!negativeMajor.ok) {
    equal(negativeMajor.error.offset, 14);
    equal(negativeMajor.error.message.includes("negative major"), true);
  }
});

test("a truncated file reports a located error", () => {
  const full = buildGam(9).bytes;
  const result = readMainFile(new BinaryReader(full.slice(0, 40)));
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section.startsWith("docs/spec/"), true);
    equal(result.error.offset < full.length, true);
  }
});

test("an empty buffer and a garbage buffer both report clean errors", () => {
  const empty = readMainFile(new BinaryReader(new Uint8Array(0)));
  equal(empty.ok, false);
  if (!empty.ok) {
    equal(empty.error.offset, 0);
    equal(empty.error.section.startsWith("docs/spec/"), true);
  }
  const garbage = readMainFile(
    new BinaryReader(new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x02, 0x00, 0x09, 0x00])),
  );
  equal(garbage.ok, false);
  if (!garbage.ok) {
    equal(garbage.error.offset, 0);
    equal(garbage.error.message.includes("not a main file"), true);
  }
});

// --- Project layout (docs/spec/formats/README.md#paths-inside-files) --------------------------------------

test("the type folder is the path subfolder for the kind", () => {
  equal(typeFolder("tiles"), "Tiles");
  equal(typeFolder("boards"), "Boards");
  equal(typeFolder("characters"), "Chrs");
  equal(typeFolder("items"), "Item");
  equal(typeFolder("enemies"), "Enemy");
  equal(typeFolder("specialMoves"), "SpcMove");
  equal(typeFolder("statusEffects"), "StatusE");
  equal(typeFolder("backgrounds"), "Bkrounds");
  equal(typeFolder("animations"), "Misc");
  equal(typeFolder("bitmaps"), "Bitmap");
  equal(typeFolder("media"), "Media");
  equal(typeFolder("programs"), "Prg");
  equal(typeFolder("fonts"), "Font");
  equal(typeFolder("plugins"), "Plugin");
});

test("the project folder is <root>/Game/<projectPath>/", () => {
  equal(projectFolder("/games/root", { projectPath: "demo" }), "/games/root/Game/demo/");
  equal(projectFolder("/games/root/", { projectPath: "demo" }), "/games/root/Game/demo/");
  // The legacy separator in the project path is normalised too.
  equal(projectFolder("/games/root", { projectPath: "a\\b" }), "/games/root/Game/a/b/");
});

test("a stored project path that already starts with Game is not double-prefixed", () => {
  // The shipped demo stores the full `Game\demo\` form; every spelling maps to
  // the same folder (docs/spec/formats/README.md#paths-inside-files). Only the leading `Game` segment is
  // canonicalised; the remaining segments keep their stored casing.
  for (const stored of ["Game\\demo\\", "game/demo", "/Game/demo/", "\\Game\\demo"]) {
    equal(projectFolder("/games/root", { projectPath: stored }), "/games/root/Game/demo/", stored);
  }
  equal(projectFolder("/games/root", { projectPath: "GAME\\Demo" }), "/games/root/Game/Demo/");
  // A bare folder name still lands under `Game/`; a bare `Game` is a single
  // segment and so becomes `Game/Game/`.
  equal(projectFolder("/games/root", { projectPath: "demo" }), "/games/root/Game/demo/");
  equal(projectFolder("/games/root", { projectPath: "Game" }), "/games/root/Game/Game/");
  equal(projectFolder("/games/root", { projectPath: "Game\\Game\\" }), "/games/root/Game/Game/");
  // Leading and trailing separators on a bare name change nothing.
  equal(projectFolder("/games/root", { projectPath: "\\demo\\" }), "/games/root/Game/demo/");
  // An empty project path is `<root>/Game/`.
  equal(projectFolder("/games/root", { projectPath: "" }), "/games/root/Game/");
});

test("an empty root gives no prefix and the stored project path is still applied", () => {
  equal(projectFolder("", { projectPath: "demo" }), "Game/demo/");
  equal(projectFolder("", { projectPath: "Game\\demo\\" }), "Game/demo/");
  equal(projectFolder("", { projectPath: "" }), "Game/");
});

test("a reference resolves under the project folder and its type folder", () => {
  equal(
    resolveReference("/games/root", { projectPath: "demo" }, "boards", "village\\inn.brd"),
    "/games/root/Game/demo/Boards/village/inn.brd",
  );
  equal(
    resolveReference("/games/root", { projectPath: "demo" }, "programs", "start.prg"),
    "/games/root/Game/demo/Prg/start.prg",
  );
  // The stored `Game\demo\` form names the same folder as the bare `demo`.
  equal(
    resolveReference("/games/root", { projectPath: "Game\\demo\\" }, "boards", "village\\inn.brd"),
    "/games/root/Game/demo/Boards/village/inn.brd",
  );
});

test("backslash and forward slash are equivalent", () => {
  equal(toSlashes("village\\inn.brd"), "village/inn.brd");
  equal(
    resolveReference("/games/root", { projectPath: "demo" }, "boards", "village/inn.brd"),
    resolveReference("/games/root", { projectPath: "demo" }, "boards", "village\\inn.brd"),
  );
});

test("matching is case-insensitive", () => {
  equal(
    foldPath(resolveReference("/games/root", { projectPath: "demo" }, "items", "ITEM\\NPC.ITM")),
    foldPath(resolveReference("/games/root", { projectPath: "demo" }, "items", "item/npc.itm")),
  );
});

test("the fold is ASCII only: U+212A and U+0130 keep their own identity", () => {
  equal(foldPath("K.BRD"), "k.brd");
  // KELVIN SIGN is a different name from ASCII k, and is not lower-cased.
  equal(foldPath("\u212A.brd"), "\u212A.brd");
  equal(foldPath("\u212A.brd") === foldPath("k.brd"), false);
  // LATIN CAPITAL I WITH DOT ABOVE stays one code point, not `i` + U+0307.
  equal(foldPath("\u0130.brd"), "\u0130.brd");
  equal(foldPath("\u0130.brd").length, 5);
  // Letters above 0x7F do not fold by case.
  equal(foldPath("Caf\u00C9.brd") === foldPath("Caf\u00E9.brd"), false);
  // The same rule covers the type-folder prefix.
  equal(stripTypeFolder("items", "ITEM/\u212A.itm"), "\u212A.itm");
});

test("a leading type-folder prefix is stripped, case-insensitively", () => {
  equal(stripTypeFolder("items", "Item\\npc.itm"), "npc.itm");
  equal(stripTypeFolder("items", "ITEM/npc.itm"), "npc.itm");
  equal(stripTypeFolder("items", "Item"), "");
  equal(stripTypeFolder("items", "sub\\npc.itm"), "sub/npc.itm");
  equal(
    resolveReference("/games/root", { projectPath: "demo" }, "items", "Item\\npc.itm"),
    "/games/root/Game/demo/Item/npc.itm",
  );
  equal(
    resolveReference("/games/root", { projectPath: "demo" }, "programs", "PRG\\start.prg"),
    "/games/root/Game/demo/Prg/start.prg",
  );
});

// --- Sample fixtures (guard-rail G5 rule 4: fetched, never committed) --------

/** Every binary `.gam` under `root`, recursively; text TK2 mains are covered by the text-reader tests. */
function collectGam(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true })
    .filter((name) => name.toLowerCase().endsWith(".gam"))
    .map((name) => join(root, name))
    .filter((file) => readFileSync(file)[13] === 0);
}

// The fixture fetch copies only `Build/game/<game>`, so the corpus normally
// ships no `.gam` at all; this test exists for a source tree that has one.
const sampleGam = collectGam(join(repoRoot, "fixtures", "legacy"));

test(
  "every sample .gam parses with zero trailing bytes and round-trips",
  { skip: sampleGam.length === 0 ? "no .gam ships in the fixture corpus" : false },
  () => {
    for (const file of sampleGam) {
      const reader = new BinaryReader(readFileSync(file), file);
      const model = unwrap(readMainFile(reader));
      equal(model.residue.length, 0, `${file} should have an empty residue`);
      deepEqual(unwrap(writeMainFile(model)), new Uint8Array(readFileSync(file)), file);
    }
  },
);

test("the committed main-file version examples parse with zero trailing bytes and round-trip", () => {
  for (let minor = 1; minor <= 9; minor++) {
    const file = join(repoRoot, "docs", "spec", "examples", "versions", "main", `main_minor${minor}.gam`);
    const bytes = new Uint8Array(readFileSync(file));
    const reader = new BinaryReader(bytes, file);
    const model = unwrap(readMainFile(reader));
    equal(reader.remaining, 0, `minor ${minor}: trailing bytes`);
    equal(model.residue.length, 0, `minor ${minor}: residue bytes`);
    equal(model.minor, minor, `minor ${minor}: expected minor`);
    if (minor < 3) {
      equal(model.reservedRuns.parallax.length, 2, `minor ${minor}: 2-byte parallax (R-18)`);
      equal(model.reservedRuns.menuPluginFallback.length, 2, `minor ${minor}: 2-byte menuPluginFallback (R-18)`);
    }
    deepEqual(unwrap(writeMainFile(model)), bytes, `minor ${minor}: byte-identical round-trip`);
  }
});
