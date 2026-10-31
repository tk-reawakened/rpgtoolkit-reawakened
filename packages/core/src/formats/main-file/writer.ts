/**
 * Writing a main game file (docs/spec/formats/main-file.md#layout): the binary layout of
 * `RPGTLKIT MAIN` across minors 0–9.
 *
 * It emits the minor it was given and reproduces the bytes of a model that came
 * from `readMainFile` exactly (AD-18): the version-dependent rows are written
 * under the same conditions the reader read them, the reserved runs are
 * re-emitted verbatim, and the file's `residue` follows the last row (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 * Pure (G2): it writes into a `BinaryWriter` and never touches a host. Only an
 * unencodable string or a model the writer cannot represent — a magic that is
 * not the main-file magic, a minor outside 0–9, an integer too wide for the
 * field it is stored in, a list longer than its `i16` upper bound, a scan-code
 * row that is not eight codes, or a reserved run of the wrong width — fails;
 * those come back as a located `FormatError` (AD-18).
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryWriter } from "../binary/writer.ts";
import {
  encodeGameSpeed,
  MAIN_AUDIO_BUILTIN_TRACKS,
  MAIN_AUDIO_EXTENSION_TAG,
  MAIN_AUDIO_MAX_FONT_BYTES,
  MAIN_AUDIO_MAX_NAME_BYTES,
  MAIN_AUDIO_MAX_TRACKS,
  MAIN_AUDIO_MAX_VOICE_CAP,
  MAIN_AUDIO_MIN_TRACKS,
  MAIN_AUDIO_MIN_VOICE_CAP,
  MAIN_MAGIC,
  MAIN_MAX_MINOR,
  MAIN_MIN_MINOR,
  MAIN_PACKAGE_EXTENSION_TAG,
  MAIN_PACKAGE_MAX_BYTES,
  MAIN_PACKAGE_MAX_COUNT,
  MAIN_SECTION,
  type MainFile,
  type MainFileAudioSettings,
} from "./model.ts";
import { asciiLower } from "./layout.ts";

/** The signed 16-bit range every `i16` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const I16_MIN = -32_768;
const I16_MAX = 32_767;

/** The signed 32-bit range every `i32` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;

/** The unsigned 8-bit range every `u8` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const U8_MAX = 255;

/** The most entries an `i16` upper bound can index (docs/spec/formats/README.md#counts-are-usually-upper-bounds). */
const MAX_LIST_ENTRIES = 32_768;

/** A located error for a value the writer cannot encode (AD-18). */
function fail(writer: BinaryWriter, message: string): Result<never> {
  return err({ offset: writer.toBytes().length, section: MAIN_SECTION, message });
}

/** `undefined` when `value` fits an `i16`; otherwise a located error (`docs/spec/formats/README.md#primitive-encoding`). */
function checkI16(writer: BinaryWriter, field: string, value: number): Result<never> | undefined {
  if (Number.isInteger(value) && value >= I16_MIN && value <= I16_MAX) {
    return undefined;
  }
  return fail(writer, `${field} is ${value}; an i16 field holds ${I16_MIN}–${I16_MAX} (docs/spec/formats/README.md#primitive-encoding)`);
}

/** `undefined` when `value` fits an `i32`; otherwise a located error (`docs/spec/formats/README.md#primitive-encoding`). */
function checkI32(writer: BinaryWriter, field: string, value: number): Result<never> | undefined {
  if (Number.isInteger(value) && value >= I32_MIN && value <= I32_MAX) {
    return undefined;
  }
  return fail(writer, `${field} is ${value}; an i32 field holds ${I32_MIN}–${I32_MAX} (docs/spec/formats/README.md#primitive-encoding)`);
}

/** `undefined` when `value` fits a `u8`; otherwise a located error (`docs/spec/formats/README.md#primitive-encoding`). */
function checkU8(writer: BinaryWriter, field: string, value: number): Result<never> | undefined {
  if (Number.isInteger(value) && value >= 0 && value <= U8_MAX) {
    return undefined;
  }
  return fail(writer, `${field} is ${value}; a u8 field holds 0–${U8_MAX} (docs/spec/formats/README.md#primitive-encoding)`);
}

/** `undefined` when `count` fits the derived `i16` upper bound; otherwise a located error (`docs/spec/formats/README.md#counts-are-usually-upper-bounds`). */
function checkCount(writer: BinaryWriter, field: string, count: number): Result<never> | undefined {
  if (count <= MAX_LIST_ENTRIES) {
    return undefined;
  }
  return fail(
    writer,
    `the ${field} has ${count} entries; an i16 upper bound holds at most ${MAX_LIST_ENTRIES} (docs/spec/formats/README.md#counts-are-usually-upper-bounds)`,
  );
}

/** `undefined` when `run` has the width the minor stores; otherwise a located error (`docs/spec/formats/main-file.md#layout`). */
function checkRun(
  writer: BinaryWriter,
  field: string,
  run: Uint8Array,
  width: number,
  row: string,
): Result<never> | undefined {
  if (run.length === width) {
    return undefined;
  }
  return fail(
    writer,
    `the ${field} reserved run is ${run.length} byte(s); the ${row} row stores ${width} (docs/spec/formats/main-file.md#layout)`,
  );
}

/**
 * Check that `model` is a main file this writer can represent (docs/spec/formats/main-file.md#layout)
 * before it writes a byte of it. `BinaryWriter` truncates an out-of-range
 * integer, and the serialiser derives the list bounds, pads the scan-code row
 * and drops the reserved runs a minor does not carry, so without this check a
 * model no reader could produce would quietly be written as a different, valid
 * file (AD-18). Runs before serialising, so a failing `fail` locates its field
 * by name and cites `docs/spec/formats/main-file.md#layout`; the offset is the start of the output.
 */
function checkModel(writer: BinaryWriter, model: MainFile): Result<never> | undefined {
  if (model.magic !== MAIN_MAGIC) {
    return fail(
      writer,
      `the magic is "${model.magic}" but a main file starts with "${MAIN_MAGIC}" (docs/spec/formats/main-file.md#layout row 1)`,
    );
  }
  if (!Number.isInteger(model.minor) || model.minor < MAIN_MIN_MINOR || model.minor > MAIN_MAX_MINOR) {
    return fail(
      writer,
      `minor ${model.minor} is outside ${MAIN_MIN_MINOR}–${MAIN_MAX_MINOR}, the layouts documented by docs/spec/formats/main-file.md#layout`,
    );
  }
  const minor = model.minor;

  // Rows 2, 3, 7–10: the header scalars.
  const header =
    checkI16(writer, "major", model.major) ??
    checkI16(writer, "registrationFlag", model.registrationFlag) ??
    checkI16(writer, "screenType", model.screenType) ??
    checkI16(writer, "extendToFullScreen", model.extendToFullScreen) ??
    checkI16(writer, "resolution", model.resolution) ??
    checkI16(writer, "disableProtectReg", model.disableProtectReg);
  if (header !== undefined) {
    return header;
  }

  // Rows 16–18: the key codes.
  const keys =
    checkI16(writer, "runTimeKey", model.runTimeKey) ??
    checkI16(writer, "menuKey", model.menuKey) ??
    checkI16(writer, "activationKey", model.activationKey);
  if (keys !== undefined) {
    return keys;
  }

  // Row 19: the extra run-time keys.
  const extKeys = checkCount(writer, "extra run-time key list", model.extKeys.length);
  if (extKeys !== undefined) {
    return extKeys;
  }
  for (const key of model.extKeys) {
    const asciiKey = checkI16(writer, "an extra run-time key's asciiKey", key.asciiKey);
    if (asciiKey !== undefined) {
      return asciiKey;
    }
  }

  // Rows 20–24: the fight settings, then row 21's encounter pool.
  const fight =
    checkI16(writer, "fightingDisabled", model.fightingDisabled) ??
    checkI16(writer, "fightType", model.fightType) ??
    checkI32(writer, "chances", model.chances) ??
    checkI16(writer, "useCustomFightPrg", model.useCustomFightPrg);
  if (fight !== undefined) {
    return fight;
  }
  const enemies = checkCount(writer, "enemy list", model.enemies.length);
  if (enemies !== undefined) {
    return enemies;
  }
  for (const enemy of model.enemies) {
    const skillLevel = checkI16(writer, "an enemy's skillLevel", enemy.skillLevel);
    if (skillLevel !== undefined) {
      return skillLevel;
    }
  }

  // Row 37: the plugin list; only the field the minor stores is written.
  const plugins = checkCount(writer, "plugin list", model.plugins.length);
  if (plugins !== undefined) {
    return plugins;
  }
  if (minor <= 2) {
    for (const plugin of model.plugins) {
      const enabled = checkI16(writer, "a plugin's enabled flag", plugin.enabled);
      if (enabled !== undefined) {
        return enabled;
      }
    }
  }

  // Rows 30–32: the day/night settings.
  const dayNight =
    checkI16(writer, "useDayNight", model.useDayNight) ??
    checkI16(writer, "dayNightType", model.dayNightType) ??
    checkI32(writer, "dayLengthMinutes", model.dayLengthMinutes);
  if (dayNight !== undefined) {
    return dayNight;
  }

  // Row 37 (minor ≥ 3): the joystick and colour depth.
  if (minor >= 3) {
    const cursor =
      checkU8(writer, "useJoystick", model.useJoystick) ?? checkU8(writer, "colorDepth", model.colorDepth);
    if (cursor !== undefined) {
      return cursor;
    }
  }

  // Row 38 (minor ≥ 4): the *stored* gameSpeed byte, which is biased at minor
  // ≥ 8, so it is the byte that must fit a `u8`, not the decoded speed.
  if (minor >= 4) {
    const speed =
      checkU8(writer, "the stored gameSpeed byte", encodeGameSpeed(minor, model.gameSpeed)) ??
      checkU8(writer, "pixelMovement", model.pixelMovement);
    if (speed !== undefined) {
      return speed;
    }
  }

  // Row 39 (minor = 5).
  if (minor === 5) {
    const cursorEnabled = checkU8(writer, "cursorEnabled", model.cursorEnabled);
    if (cursorEnabled !== undefined) {
      return cursorEnabled;
    }
  }

  // Row 40 (minor ≥ 6): the mouse cursor's hot spot and transparent colour.
  if (minor >= 6) {
    const mouseCursor =
      checkU8(writer, "hotSpotX", model.hotSpotX) ??
      checkU8(writer, "hotSpotY", model.hotSpotY) ??
      checkU8(writer, "the transparent colour's red", model.transparent.r) ??
      checkU8(writer, "the transparent colour's green", model.transparent.g) ??
      checkU8(writer, "the transparent colour's blue", model.transparent.b);
    if (mouseCursor !== undefined) {
      return mouseCursor;
    }
  }

  // Row 41 (minor ≥ 7): the custom resolution.
  if (minor >= 7) {
    const resolution = checkI32(writer, "resX", model.resX) ?? checkI32(writer, "resY", model.resY);
    if (resolution !== undefined) {
      return resolution;
    }
  }

  // Row 42 (minor ≥ 8).
  if (minor >= 8) {
    const fps = checkU8(writer, "showFpsInTitle", model.showFpsInTitle);
    if (fps !== undefined) {
      return fps;
    }
  }

  // Row 43 (minor ≥ 9): the pathfinding block and its eight scan codes.
  if (minor >= 9) {
    const path =
      checkI16(writer, "pathfindHeuristic", model.pathfindHeuristic) ??
      checkI32(writer, "drawVectorsFlags", model.drawVectorsFlags) ??
      checkU8(writer, "the path colour's red", model.pathColor.r) ??
      checkU8(writer, "the path colour's green", model.pathColor.g) ??
      checkU8(writer, "the path colour's blue", model.pathColor.b) ??
      checkI32(writer, "movementControls", model.movementControls);
    if (path !== undefined) {
      return path;
    }
    if (model.movementScanCodes.length !== 8) {
      return fail(
        writer,
        `minor 9 stores exactly eight movement scan codes but the model has ${model.movementScanCodes.length} (docs/spec/formats/main-file.md#layout row 43)`,
      );
    }
    for (const scan of model.movementScanCodes) {
      const code = checkI16(writer, "a movement scan code", scan);
      if (code !== undefined) {
        return code;
      }
    }
  }

  // The reserved runs are re-emitted under the conditions the reader read them,
  // so a run the minor carries must be exactly the row's width and one the
  // minor does not carry must be empty (`docs/spec/formats/main-file.md#layout`).
  const runs =
    checkRun(writer, "parallax", model.reservedRuns.parallax, minor < 3 ? 2 : 0, "row 10") ??
    checkRun(writer, "menuPluginFallback", model.reservedRuns.menuPluginFallback, minor < 3 ? 2 : 0, "row 21") ??
    checkRun(writer, "multitask", model.reservedRuns.multitask, minor <= 2 ? 6 : 0, "row 22") ??
    checkRun(writer, "fightStyle", model.reservedRuns.fightStyle, minor < 3 ? 2 : 0, "row 29");
  if (runs !== undefined) {
    return runs;
  }

  const packagePlugins = model.packagePlugins ?? [];
  if (packagePlugins.length > MAIN_PACKAGE_MAX_COUNT) {
    return fail(writer, `TKR package list has ${packagePlugins.length} names; maximum is ${MAIN_PACKAGE_MAX_COUNT} (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
  }
  const seen = new Set<string>();
  for (const name of packagePlugins) {
    if (name.length === 0 || name.length > MAIN_PACKAGE_MAX_BYTES || name.includes("\0")) {
      return fail(writer, `TKR package name must be 1–${MAIN_PACKAGE_MAX_BYTES} bytes and must not contain NUL (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
    }
    const folded = asciiLower(name);
    if (seen.has(folded)) return fail(writer, `duplicate TKR package name "${name}" (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
    seen.add(folded);
  }
  return checkAudioSettings(writer, model.audioSettings);
}

/**
 * `undefined` when the audio-settings block is absent or representable; otherwise a located error
 * (docs/spec/formats/main-file.md#tkr-audio-settings-extension). An aggregate count above the cap is
 * representable: the block is data, and the engine reports it once at load.
 */
function checkAudioSettings(writer: BinaryWriter, settings: MainFileAudioSettings | null): Result<never> | undefined {
  if (settings === null) return undefined;
  const anchor = "docs/spec/formats/main-file.md#tkr-audio-settings-extension";
  if (settings === undefined || typeof settings !== "object" || !Array.isArray(settings.tracks)) {
    return fail(writer, `TKR audio settings must be null or an explicit settings object (${anchor})`);
  }
  if (settings.tracks.length < MAIN_AUDIO_MIN_TRACKS || settings.tracks.length > MAIN_AUDIO_MAX_TRACKS) {
    return fail(writer, `TKR audio track count ${settings.tracks.length} is outside ${MAIN_AUDIO_MIN_TRACKS}–${MAIN_AUDIO_MAX_TRACKS} (${anchor})`);
  }
  if (!Number.isInteger(settings.voiceCap) || settings.voiceCap < MAIN_AUDIO_MIN_VOICE_CAP || settings.voiceCap > MAIN_AUDIO_MAX_VOICE_CAP) {
    return fail(writer, `TKR audio voice cap ${settings.voiceCap} is outside ${MAIN_AUDIO_MIN_VOICE_CAP}–${MAIN_AUDIO_MAX_VOICE_CAP} (${anchor})`);
  }
  const seen = new Set<string>();
  for (let index = 0; index < settings.tracks.length; index += 1) {
    const track = settings.tracks[index]!;
    const folded = asciiLower(track.name);
    if (track.name.length === 0 || track.name.length > MAIN_AUDIO_MAX_NAME_BYTES || track.name.includes("\0") || !/^[a-z0-9_.-]+$/.test(folded)) {
      return fail(writer, `TKR audio track name "${track.name}" must match [A-Za-z0-9_.-]+ in 1–${MAIN_AUDIO_MAX_NAME_BYTES} bytes (${anchor})`);
    }
    if (index < MAIN_AUDIO_BUILTIN_TRACKS.length && folded !== MAIN_AUDIO_BUILTIN_TRACKS[index]) {
      return fail(writer, `TKR audio track ${index} must be the built-in "${MAIN_AUDIO_BUILTIN_TRACKS[index]}" (${anchor})`);
    }
    if (seen.has(folded)) return fail(writer, `duplicate TKR audio track name "${track.name}" (${anchor})`);
    seen.add(folded);
    if (!Number.isInteger(track.voiceCount) || track.voiceCount < 1 || track.voiceCount > MAIN_AUDIO_MAX_VOICE_CAP) {
      return fail(writer, `TKR audio track "${track.name}" voice count ${track.voiceCount} is outside 1–${MAIN_AUDIO_MAX_VOICE_CAP} (${anchor})`);
    }
  }
  const font = settings.defaultSoundFont;
  if (font !== null && (typeof font !== "string" || font.length === 0 || font.length > MAIN_AUDIO_MAX_FONT_BYTES || font.includes("\0"))) {
    return fail(writer, `a TKR audio default SoundFont must be 1–${MAIN_AUDIO_MAX_FONT_BYTES} bytes and must not contain NUL (${anchor})`);
  }
  return undefined;
}

/**
 * Serialise `model` to the main-file layout (docs/spec/formats/main-file.md#layout). Which rows are
 * written is decided by `model.minor`, exactly as the reader decided which to
 * read, and `model.residue` is appended after the last row, so a file the
 * reader accepted writes back byte for byte (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`). A model the writer cannot
 * represent is refused by `checkModel` before a byte is written (AD-18).
 */
export function writeMainFile(model: MainFile): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const minor = model.minor;

  const checked = checkModel(writer, model);
  if (checked !== undefined) {
    return checked;
  }

  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return magic;
  }
  writer.i16(model.major);
  writer.i16(model.minor);

  // Rows 3–4: the editor's i16 flag followed by the `"NOCODE"` str (the quirk
  // the reader explains in `model.ts`).
  writer.i16(model.registrationFlag);
  const registrationCode = writer.str(model.registrationCode);
  if (!registrationCode.ok) {
    return registrationCode;
  }

  const projectPath = writer.str(model.projectPath);
  if (!projectPath.ok) {
    return projectPath;
  }
  const gameTitle = writer.str(model.gameTitle);
  if (!gameTitle.ok) {
    return gameTitle;
  }
  writer.i16(model.screenType);
  writer.i16(model.extendToFullScreen);
  writer.i16(model.resolution);
  if (minor < 3) {
    writer.writeBytes(model.reservedRuns.parallax);
  }
  writer.i16(model.disableProtectReg);
  const languageFile = writer.str(model.languageFile);
  if (!languageFile.ok) {
    return languageFile;
  }
  const startupPrg = writer.str(model.startupPrg);
  if (!startupPrg.ok) {
    return startupPrg;
  }
  const initBoard = writer.str(model.initBoard);
  if (!initBoard.ok) {
    return initBoard;
  }
  const initChar = writer.str(model.initChar);
  if (!initChar.ok) {
    return initChar;
  }
  const runTimePrg = writer.str(model.runTimePrg);
  if (!runTimePrg.ok) {
    return runTimePrg;
  }
  writer.i16(model.runTimeKey);
  writer.i16(model.menuKey);
  writer.i16(model.activationKey);

  // Row 19: the extra run-time keys. The upper bound is derived from the list
  // length (`-1` for none, `docs/spec/formats/README.md#counts-are-usually-upper-bounds`).
  writer.i16(model.extKeys.length === 0 ? -1 : model.extKeys.length - 1);
  for (const key of model.extKeys) {
    writer.i16(key.asciiKey);
    const program = writer.str(key.program);
    if (!program.ok) {
      return program;
    }
  }

  // Row 21 (conditional).
  if (minor >= 3) {
    const menuPlugin = writer.str(model.menuPlugin);
    if (!menuPlugin.ok) {
      return menuPlugin;
    }
    const fightPlugin = writer.str(model.fightPlugin);
    if (!fightPlugin.ok) {
      return fightPlugin;
    }
  } else {
    writer.writeBytes(model.reservedRuns.menuPluginFallback);
  }

  // Row 22 (conditional, minor ≤ 2).
  if (minor <= 2) {
    writer.writeBytes(model.reservedRuns.multitask);
  }

  // Row 20: the inverted fighting flag.
  writer.i16(model.fightingDisabled);

  // Row 21: the random-encounter pool.
  writer.i16(model.enemies.length === 0 ? -1 : model.enemies.length - 1);
  for (const enemy of model.enemies) {
    const enemyFile = writer.str(enemy.enemyFile);
    if (!enemyFile.ok) {
      return enemyFile;
    }
    writer.i16(enemy.skillLevel);
  }

  writer.i16(model.fightType);
  writer.i32(model.chances);
  writer.i16(model.useCustomFightPrg);
  const customFightPrg = writer.str(model.customFightPrg);
  if (!customFightPrg.ok) {
    return customFightPrg;
  }

  // Row 11 (conditional, minor < 3).
  if (minor < 3) {
    writer.writeBytes(model.reservedRuns.fightStyle);
  }

  const gameOverPrg = writer.str(model.gameOverPrg);
  if (!gameOverPrg.ok) {
    return gameOverPrg;
  }
  const skinButton = writer.str(model.skinButton);
  if (!skinButton.ok) {
    return skinButton;
  }
  const skinWindow = writer.str(model.skinWindow);
  if (!skinWindow.ok) {
    return skinWindow;
  }

  // Row 37: the plugin list; entries are `i16 enabled` at minor ≤ 2 and
  // `str pluginFile` at minor ≥ 3.
  writer.i16(model.plugins.length === 0 ? -1 : model.plugins.length - 1);
  for (const plugin of model.plugins) {
    if (minor <= 2) {
      writer.i16(plugin.enabled);
    } else {
      const pluginFile = writer.str(plugin.pluginFile);
      if (!pluginFile.ok) {
        return pluginFile;
      }
    }
  }

  writer.i16(model.useDayNight);
  writer.i16(model.dayNightType);
  writer.i32(model.dayLengthMinutes);

  // Row 37 (conditional, minor ≥ 3).
  if (minor >= 3) {
    const cursorMoveSound = writer.str(model.cursorMoveSound);
    if (!cursorMoveSound.ok) {
      return cursorMoveSound;
    }
    const cursorSelectSound = writer.str(model.cursorSelectSound);
    if (!cursorSelectSound.ok) {
      return cursorSelectSound;
    }
    const cursorCancelSound = writer.str(model.cursorCancelSound);
    if (!cursorCancelSound.ok) {
      return cursorCancelSound;
    }
    writer.u8(model.useJoystick);
    writer.u8(model.colorDepth);
  }

  // Row 38 (conditional, minor ≥ 4).
  if (minor >= 4) {
    writer.u8(encodeGameSpeed(minor, model.gameSpeed));
    writer.u8(model.pixelMovement);
  }

  // Row 39 (conditional, minor = 5).
  if (minor === 5) {
    writer.u8(model.cursorEnabled);
  }

  // Row 40 (conditional, minor ≥ 6).
  if (minor >= 6) {
    const mouseCursor = writer.str(model.mouseCursor);
    if (!mouseCursor.ok) {
      return mouseCursor;
    }
    writer.u8(model.hotSpotX);
    writer.u8(model.hotSpotY);
    writer.color(model.transparent);
  }

  // Row 41 (conditional, minor ≥ 7).
  if (minor >= 7) {
    writer.i32(model.resX);
    writer.i32(model.resY);
  }

  // Row 42 (conditional, minor ≥ 8).
  if (minor >= 8) {
    writer.u8(model.showFpsInTitle);
  }

  // Row 43 (conditional, minor ≥ 9).
  if (minor >= 9) {
    writer.i16(model.pathfindHeuristic);
    writer.i32(model.drawVectorsFlags);
    writer.color(model.pathColor);
    writer.i32(model.movementControls);
    for (const scan of model.movementScanCodes) {
      writer.i16(scan);
    }
  }

  const packagePlugins = model.packagePlugins ?? [];
  if (packagePlugins.length > 0 || model.packagePluginsExtension === true) {
    writer.writeBytes(MAIN_PACKAGE_EXTENSION_TAG);
    writer.u16(packagePlugins.length);
    for (const name of packagePlugins) {
      const encoded = writer.str(name);
      if (!encoded.ok) return encoded;
    }
  }

  // The audio-settings block follows the package list and precedes residue
  // (`docs/spec/formats/main-file.md#tkr-audio-settings-extension`).
  if (model.audioSettings !== null) {
    writer.writeBytes(MAIN_AUDIO_EXTENSION_TAG);
    writer.u16(model.audioSettings.tracks.length);
    for (const track of model.audioSettings.tracks) {
      const name = writer.str(track.name);
      if (!name.ok) return name;
      writer.u16(track.voiceCount);
    }
    writer.u16(model.audioSettings.voiceCap);
    if (model.audioSettings.defaultSoundFont === null) {
      writer.u8(0);
    } else {
      writer.u8(1);
      const font = writer.str(model.audioSettings.defaultSoundFont);
      if (!font.ok) return font;
    }
  }
  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}
