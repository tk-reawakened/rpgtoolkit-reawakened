/**
 * The main game file (`.gam`) model and its constants
 * (`docs/spec/formats/main-file.md#layout`).
 *
 * A main file is the one file a game cannot boot without (`docs/spec/formats/main-file.md#layout`): it carries
 * `projectPath`, the startup program and board, the window settings and the
 * active plugins. The layout documents 43 logical rows across minors 0–9, twelve of
 * them version-dependent; this model holds every row, including the reserved
 * runs, so an unchanged file writes back byte-for-byte (AD-18).
 *
 * The reserved runs are kept as raw bytes rather than as parsed numbers: they
 * are unmodelled for the minor that wrote them, so re-emitting the exact bytes
 * is the only way to guarantee a byte-identical round-trip (AD-18). Bytes after
 * the last documented row are the file's `residue`, kept and re-emitted too
 * (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 */

import type { Colorref } from "../binary/color.ts";

/** The magic every binary main file starts with (docs/spec/formats/main-file.md#layout row 1). */
export const MAIN_MAGIC = "RPGTLKIT MAIN";

/** The format specification anchor the main-file reader, writer and model implement (G7). */
export const MAIN_SECTION = "docs/spec/formats/main-file.md#layout";

/** The lowest minor version this reader accepts (docs/spec/formats/main-file.md#layout). */
export const MAIN_MIN_MINOR = 0;

/** The highest minor version this reader accepts (9 = 3.1.0, docs/spec/formats/main-file.md#layout). */
export const MAIN_MAX_MINOR = 9;

/**
 * The offset `projectPath` starts at when the registration rows are written the
 * way the editor writes them and the registration code is the default
 * `"NOCODE"` (docs/spec/formats/main-file.md#layout rows 3–4): magic (13 + NUL) + two `i16` versions +
 * the `i16` flag + `"NOCODE\0"` = 0x1B.
 */
export const MAIN_PROJECT_PATH_OFFSET = 0x1b;

/** The minor from which `gameSpeed` is stored biased by +128 (docs/spec/formats/main-file.md#layout row 38). */
export const GAME_SPEED_BIAS_MINOR = 8;

/** The bias `gameSpeed` carries at minor ≥ 8 (docs/spec/formats/main-file.md#layout row 38). */
export const GAME_SPEED_BIAS = 128;

/** TKR trailing package-list extension (docs/spec/formats/main-file.md#tkr-package-list-extension). */
export const MAIN_PACKAGE_EXTENSION_TAG = new Uint8Array([0x54, 0x4b, 0x52, 0x50, 0x4c, 0x55, 0x47, 0x00]);
export const MAIN_PACKAGE_MAX_COUNT = 256;
export const MAIN_PACKAGE_MAX_BYTES = 255;

/** TKR audio-settings extension (docs/spec/formats/main-file.md#tkr-audio-settings-extension). */
export const MAIN_AUDIO_EXTENSION_TAG = new Uint8Array([0x54, 0x52, 0x4b, 0x41, 0x55, 0x44, 0x00]);
export const MAIN_AUDIO_MIN_TRACKS = 5;
export const MAIN_AUDIO_MAX_TRACKS = 16;
export const MAIN_AUDIO_MAX_NAME_BYTES = 32;
export const MAIN_AUDIO_MAX_FONT_BYTES = 255;
export const MAIN_AUDIO_MIN_VOICE_CAP = 1;
export const MAIN_AUDIO_MAX_VOICE_CAP = 32;
/** The five built-in tracks, always first in this order (docs/spec/engine/audio-media.md#media-4). */
export const MAIN_AUDIO_BUILTIN_TRACKS: readonly string[] = ["music", "sfx", "ambience", "voice", "ui"];

/**
 * Decode the stored `gameSpeed` byte (docs/spec/formats/main-file.md#layout row 38). At minor ≥ 8 the
 * byte is `speed + 128`, so the speed is in −4…+4 (each step ±10 %); below 8 the
 * byte is the raw speed and is returned unchanged.
 */
export function decodeGameSpeed(minor: number, stored: number): number {
  return minor >= GAME_SPEED_BIAS_MINOR ? stored - GAME_SPEED_BIAS : stored;
}

/** Encode a `gameSpeed` back to its stored byte (docs/spec/formats/main-file.md#layout row 38). */
export function encodeGameSpeed(minor: number, speed: number): number {
  return minor >= GAME_SPEED_BIAS_MINOR ? speed + GAME_SPEED_BIAS : speed;
}

/** One extra run-time key: an ASCII key code plus the program it runs (`docs/spec/formats/main-file.md#layout`, row 22). */
export interface MainFileExtKey {
  /** The ASCII code of the key (an uppercase letter or digit, `docs/spec/formats/main-file.md#layout`, row 22). */
  readonly asciiKey: number;
  /** The program bound to the key; empty entries are kept but skipped at runtime. */
  readonly program: string;
}

/** One entry of the random-encounter pool (`docs/spec/formats/main-file.md#layout`, row 28). */
export interface MainFileEnemy {
  /** The enemy file reference, relative to `Enemy/` (`docs/spec/formats/README.md#paths-inside-files`, `docs/spec/formats/main-file.md#layout`, row 28). */
  readonly enemyFile: string;
  /** The enemy's skill level. */
  readonly skillLevel: number;
}

/**
 * One plugin-list entry (`docs/spec/formats/main-file.md#layout`, row 38). The layout differs by minor: at minor ≤ 2
 * each entry is an `i16 enabled` and the plugin name is implied as `tkplug<N>`;
 * at minor ≥ 3 each entry is a `str pluginFile`. Both fields are carried, and
 * the writer emits the one the file's minor stores, so no entry can be written
 * at the wrong width.
 */
export interface MainFilePlugin {
  /** The stored `i16 enabled` at minor ≤ 2; `0` when the minor stores a name. */
  readonly enabled: number;
  /** The stored `str pluginFile` at minor ≥ 3; `""` when the minor stores a flag. */
  readonly pluginFile: string;
}

/**
 * The reserved runs the spec says to ignore, kept verbatim so the writer can
 * reproduce them (AD-18). Each is empty when the minor does not carry it.
 */
export interface MainFileReservedRuns {
  /** Row 10, minor < 3: an `i16` between `resolution` and `disableProtectReg` (R-18). */
  readonly parallax: Uint8Array;
  /** Row 21, minor < 3: the `i16` in place of `menuPlugin`/`fightPlugin` (R-18). */
  readonly menuPluginFallback: Uint8Array;
  /** Row 22, minor ≤ 2: the `i32` + `i16` multitask-speed / memory-protection run. */
  readonly multitask: Uint8Array;
  /** Row 11, minor < 3: the `i16` old fight style after `customFightPrg`. */
  readonly fightStyle: Uint8Array;
}

/** One configured audio track: its authored name and positive voice count (docs/spec/formats/main-file.md#tkr-audio-settings-extension). */
export interface MainFileAudioTrack {
  /** The stored track name, 1–32 bytes; canonicalised by ASCII folding at load. */
  readonly name: string;
  /** The number of voice slots, 1–32. */
  readonly voiceCount: number;
}

/** The TKR audio-settings block (docs/spec/formats/main-file.md#tkr-audio-settings-extension). */
export interface MainFileAudioSettings {
  /** The full ordered list: the five built-ins first, then authored tracks. */
  readonly tracks: readonly MainFileAudioTrack[];
  /** The game's total voice budget, 1–32. */
  readonly voiceCap: number;
  /** The authored default bank as an `AssetKey`, or `null` when the game supplies none. */
  readonly defaultSoundFont: string | null;
}

/** A parsed main game file (docs/spec/formats/main-file.md#layout). */
export interface MainFile {
  /** The magic string, `"RPGTLKIT MAIN"` (`docs/spec/formats/main-file.md#layout`, row 1). */
  readonly magic: string;
  /** The major version; informational only (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/main-file.md#layout`, row 2). */
  readonly major: number;
  /** The minor version; selects the layout, 0–9 (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/main-file.md#layout`, row 3). */
  readonly minor: number;
  /**
   * Row 4: the old registration flag. The editor writes it as an `i16`; the
   * legacy C++ reader read an `i32` here, consuming 2 bytes of the following
   * `"NOCODE\0"`. Both land at the same offset (`docs/spec/formats/main-file.md#layout`, rows 4–5), and this reader
   * follows the editor's `i16` so the write round-trips.
   */
  readonly registrationFlag: number;
  /** Row 5: the old registration code, default `"NOCODE"`. */
  readonly registrationCode: string;
  /**
   * Row 6: the stored project path, relative to `<root>` (`docs/spec/formats/README.md#paths-inside-files`). Either a bare
   * folder name placed under `Game/` (`demo`) or a path that already begins with
   * `Game/` (`Game\demo\`); `projectFolder` tells the two apart by the first
   * segment.
   */
  readonly projectPath: string;
  /** Row 6: the window title. */
  readonly gameTitle: string;
  /** Row 7: `0`/`1` full-screen accelerated, `2` windowed. */
  readonly screenType: number;
  /** Row 8: `0`/`1`. */
  readonly extendToFullScreen: number;
  /** Row 9: `0` = 640×480, `1` = 800×600, `2` = 1024×768, other = custom. */
  readonly resolution: number;
  /** Row 10: obsolete. */
  readonly disableProtectReg: number;
  /** Row 11: obsolete language file. */
  readonly languageFile: string;
  /** Row 12: the program run at boot. */
  readonly startupPrg: string;
  /** Row 13: the first board. */
  readonly initBoard: string;
  /** Row 14: the first player character (`.tem`). */
  readonly initChar: string;
  /** Row 15: the program bound to the run-time key. */
  readonly runTimePrg: string;
  /** Row 16: the ASCII code of the run-time key. */
  readonly runTimeKey: number;
  /** Row 17: the ASCII code of the menu key. */
  readonly menuKey: number;
  /** Row 18: the ASCII code of the "interact" key. */
  readonly activationKey: number;
  /** Row 19: the extra run-time keys, in file order (the upper bound is derived). */
  readonly extKeys: readonly MainFileExtKey[];
  /** Row 21, minor ≥ 3: the menu plugin; empty when the minor does not carry it. */
  readonly menuPlugin: string;
  /** Row 21, minor ≥ 3: the fight plugin; empty when the minor does not carry it. */
  readonly fightPlugin: string;
  /**
   * Row 26: the inverted fighting flag — **0 = fighting enabled**, non-zero =
   * disabled (`docs/spec/formats/main-file.md#layout`, row 26). Kept as stored, so the legacy `-1` round-trips.
   */
  readonly fightingDisabled: number;
  /** Row 21: the random-encounter pool (the upper bound is derived). */
  readonly enemies: readonly MainFileEnemy[];
  /** Row 22: `0` = random, `1` = planned. */
  readonly fightType: number;
  /** Row 23: the encounter chance / tile interval. */
  readonly chances: number;
  /** Row 24: `0`/`1`. */
  readonly useCustomFightPrg: number;
  /** Row 25: the RPGCode run instead of the built-in battle. */
  readonly customFightPrg: string;
  /** Row 26: the program run when the party is defeated. */
  readonly gameOverPrg: string;
  /** Row 27: legacy UI skin image. */
  readonly skinButton: string;
  /** Row 28: legacy UI skin image. */
  readonly skinWindow: string;
  /** Row 37: the plugin list (the upper bound is derived). */
  readonly plugins: readonly MainFilePlugin[];
  /** TKR package names from the optional trailing extension, in authored order. */
  readonly packagePlugins?: readonly string[];
  /** Whether the TKR package-list block was present, including an explicit empty list. */
  readonly packagePluginsExtension?: boolean;
  /** The TKR audio-settings block, or `null` when the file carries none. */
  readonly audioSettings: MainFileAudioSettings | null;
  /** Row 30: `0`/`1`. */
  readonly useDayNight: number;
  /** Row 31: `0` = real clock, `1` = game clock. */
  readonly dayNightType: number;
  /** Row 32: minutes per day. */
  readonly dayLengthMinutes: number;
  /** Row 37, minor ≥ 3. */
  readonly cursorMoveSound: string;
  /** Row 37, minor ≥ 3. */
  readonly cursorSelectSound: string;
  /** Row 37, minor ≥ 3. */
  readonly cursorCancelSound: string;
  /** Row 37, minor ≥ 3: `u8`. */
  readonly useJoystick: number;
  /** Row 37, minor ≥ 3: `u8`. */
  readonly colorDepth: number;
  /**
   * Row 38, minor ≥ 4: the decoded speed. At minor ≥ 8 the stored byte is
   * `speed + 128` (range −4…+4); below 8 it is the raw speed (`docs/spec/formats/main-file.md#layout`, row 47).
   */
  readonly gameSpeed: number;
  /** Row 38, minor ≥ 4: `0` = tile steps, `1` = pixel steps. */
  readonly pixelMovement: number;
  /** Row 39, minor = 5: `u8`; the cursor is `"TK DEFAULT"` or none. */
  readonly cursorEnabled: number;
  /** Row 40, minor ≥ 6: `"TK DEFAULT"`, `""` (none) or an image/tile reference. */
  readonly mouseCursor: string;
  /** Row 40, minor ≥ 6: `u8`. */
  readonly hotSpotX: number;
  /** Row 40, minor ≥ 6: `u8`. */
  readonly hotSpotY: number;
  /** Row 40, minor ≥ 6: the transparent colour. */
  readonly transparent: Colorref;
  /** Row 41, minor ≥ 7: custom resolution width. */
  readonly resX: number;
  /** Row 41, minor ≥ 7: custom resolution height. */
  readonly resY: number;
  /** Row 42, minor ≥ 8: `u8`. */
  readonly showFpsInTitle: number;
  /** Row 43, minor ≥ 9: axial / diagonal / vector. */
  readonly pathfindHeuristic: number;
  /** Row 43, minor ≥ 9: debug-overlay bit flags. */
  readonly drawVectorsFlags: number;
  /** Row 43, minor ≥ 9: the path colour. */
  readonly pathColor: Colorref;
  /** Row 43, minor ≥ 9: movement-control bits (1 = keyboard, 2 = mouse, 4 = diagonals). */
  readonly movementControls: number;
  /** Row 43, minor ≥ 9: eight scan codes, ordered E, SE, S, SW, W, NW, N, NE. */
  readonly movementScanCodes: readonly number[];
  /** The reserved runs, kept verbatim (AD-18). */
  readonly reservedRuns: MainFileReservedRuns;
  /**
   * The bytes after the last documented row, kept verbatim so the writer puts
   * them back and the file round-trips byte for byte (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`). Empty when the
   * file has no trailing bytes.
   */
  readonly residue: Uint8Array;
}
