/**
 * Reading a main game file (docs/spec/formats/main-file.md#layout): the binary layout of
 * `RPGTLKIT MAIN` across minors 0–9.
 *
 * Pure (G2): it consumes a `BinaryReader` the caller positioned and never
 * touches a host. A wrong magic, a version outside 0–9, a truncated file or a
 * short read is a `Result` carrying a located `FormatError`, never a throw
 * (AD-18). The reader consumes exactly the fields listed in `docs/spec/formats/main-file.md#layout`
 * for the file's minor, then keeps any bytes after them as the file's `residue`
 * and warns once (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 *
 * The twelve version-dependent rows are read here in the order listed in
 * `docs/spec/formats/main-file.md#layout`;
 * each is guarded by the condition the spec gives it (`minor < 3`, `minor ≤ 2`,
 * `minor ≥ 3`, `minor ≥ 4`, `minor = 5`, `minor ≥ 6`, `minor ≥ 7`, `minor ≥ 8`,
 * reproduces them (AD-18).
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import type { Colorref } from "../binary/color.ts";
import {
  MAIN_MAGIC,
  MAIN_MAX_MINOR,
  MAIN_MIN_MINOR,
  decodeGameSpeed,
  MAIN_AUDIO_BUILTIN_TRACKS,
  MAIN_AUDIO_EXTENSION_TAG,
  MAIN_AUDIO_MAX_FONT_BYTES,
  MAIN_AUDIO_MAX_NAME_BYTES,
  MAIN_AUDIO_MAX_TRACKS,
  MAIN_AUDIO_MAX_VOICE_CAP,
  MAIN_AUDIO_MIN_TRACKS,
  MAIN_AUDIO_MIN_VOICE_CAP,
  MAIN_PACKAGE_EXTENSION_TAG,
  MAIN_PACKAGE_MAX_BYTES,
  MAIN_PACKAGE_MAX_COUNT,
  MAIN_SECTION,
  type MainFile,
  type MainFileAudioSettings,
  type MainFileAudioTrack,
  type MainFileEnemy,
  type MainFileExtKey,
  type MainFilePlugin,
  type MainFileReservedRuns,
} from "./model.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { asciiLower } from "./layout.ts";

const NO_BYTES: Uint8Array = new Uint8Array(0);
const NO_COLOR: Colorref = { r: 0, g: 0, b: 0 };

/** A located error for a main-file field (AD-18). */
function fail(reader: BinaryReader, offset: number, message: string): Result<never> {
  return err({
    ...(reader.path === undefined ? {} : { path: reader.path }),
    offset,
    section: MAIN_SECTION,
    message,
  });
}

function parsePackageExtension(bytes: Uint8Array, path: string | undefined, baseOffset: number): Result<{ readonly packagePlugins: readonly string[]; readonly packagePluginsExtension: boolean; readonly residue: Uint8Array }> {
  const tag = MAIN_PACKAGE_EXTENSION_TAG;
  const located = <T>(result: Result<T>): Result<T> => result.ok ? result : err({ ...result.error, offset: result.error.offset + baseOffset });
  if (bytes.length < tag.length || tag.some((value, index) => bytes[index] !== value)) {
    return ok({ packagePlugins: [], packagePluginsExtension: false, residue: bytes });
  }
  const extension = new BinaryReader(bytes, path);
  extension.readBytes(tag.length);
  const count = located(extension.u16());
  if (!count.ok) return count;
  if (count.value > MAIN_PACKAGE_MAX_COUNT) return fail(extension, baseOffset + tag.length, `TKR package list count ${count.value} exceeds ${MAIN_PACKAGE_MAX_COUNT} (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
  const packagePlugins: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count.value; index += 1) {
    const nameStart = extension.offset;
    const scanLimit = Math.min(extension.bytes.length, nameStart + MAIN_PACKAGE_MAX_BYTES + 1);
    let nulAt = nameStart;
    while (nulAt < scanLimit && extension.bytes[nulAt] !== 0) nulAt += 1;
    if (nulAt === scanLimit && scanLimit - nameStart > MAIN_PACKAGE_MAX_BYTES) {
      return fail(extension, baseOffset + nameStart, `TKR package name exceeds ${MAIN_PACKAGE_MAX_BYTES} bytes (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
    }
    const name = located(extension.str());
    if (!name.ok) return name;
    if (name.value.includes("\0")) return fail(extension, baseOffset + extension.offset, "TKR package names must not contain NUL (docs/spec/formats/main-file.md#tkr-package-list-extension)");
    if (name.value.length === 0) return fail(extension, baseOffset + extension.offset, "TKR package names must not be empty (docs/spec/formats/main-file.md#tkr-package-list-extension)");
    if (name.value.length > MAIN_PACKAGE_MAX_BYTES) return fail(extension, baseOffset + extension.offset, `TKR package name exceeds ${MAIN_PACKAGE_MAX_BYTES} bytes (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
    const folded = asciiLower(name.value);
    if (seen.has(folded)) return fail(extension, baseOffset + extension.offset, `duplicate TKR package name "${name.value}" (docs/spec/formats/main-file.md#tkr-package-list-extension)`);
    seen.add(folded);
    packagePlugins.push(name.value);
  }
  const residue = located(extension.readBytes(extension.remaining));
  if (!residue.ok) return residue;
  return ok({ packagePlugins, packagePluginsExtension: true, residue: residue.value });
}

/**
 * The TKR audio-settings block (docs/spec/formats/main-file.md#tkr-audio-settings-extension): a tagged
 * sibling of the package list, recognised at the start of whatever the package parser left as
 * residue. A non-matching tag leaves the bytes untouched, so legacy files keep their residue.
 */
function parseAudioExtension(
  bytes: Uint8Array,
  path: string | undefined,
  baseOffset: number,
): Result<{ readonly audioSettings: MainFileAudioSettings | null; readonly residue: Uint8Array }> {
  const tag = MAIN_AUDIO_EXTENSION_TAG;
  const anchor = "docs/spec/formats/main-file.md#tkr-audio-settings-extension";
  const located = <T>(result: Result<T>): Result<T> => (result.ok ? result : err({ ...result.error, offset: result.error.offset + baseOffset, section: anchor, message: `${result.error.message} (${anchor})` }));
  if (bytes.length < tag.length || tag.some((value, index) => bytes[index] !== value)) {
    return ok({ audioSettings: null, residue: bytes });
  }
  const extension = new BinaryReader(bytes, path);
  extension.readBytes(tag.length);
  const count = located(extension.u16());
  if (!count.ok) return count;
  if (count.value < MAIN_AUDIO_MIN_TRACKS || count.value > MAIN_AUDIO_MAX_TRACKS) {
    return fail(extension, baseOffset + tag.length, `TKR audio track count ${count.value} is outside ${MAIN_AUDIO_MIN_TRACKS}–${MAIN_AUDIO_MAX_TRACKS} (${anchor})`);
  }
  const tracks: MainFileAudioTrack[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count.value; index += 1) {
    const nameStart = extension.offset;
    const scanLimit = Math.min(extension.bytes.length, nameStart + MAIN_AUDIO_MAX_NAME_BYTES + 1);
    let nulAt = nameStart;
    while (nulAt < scanLimit && extension.bytes[nulAt] !== 0) nulAt += 1;
    if (nulAt === scanLimit && scanLimit - nameStart > MAIN_AUDIO_MAX_NAME_BYTES) {
      return fail(extension, baseOffset + nameStart, `TKR audio track name exceeds ${MAIN_AUDIO_MAX_NAME_BYTES} bytes (${anchor})`);
    }
    const name = located(extension.str());
    if (!name.ok) return name;
    if (name.value.includes("\0") || name.value.length === 0) {
      return fail(extension, baseOffset + extension.offset, `a TKR audio track name must be 1–${MAIN_AUDIO_MAX_NAME_BYTES} bytes (${anchor})`);
    }
    const folded = asciiLower(name.value);
    if (name.value.length > MAIN_AUDIO_MAX_NAME_BYTES || !/^[a-z0-9_.-]+$/.test(folded)) {
      return fail(extension, baseOffset + extension.offset, `TKR audio track name "${name.value}" must match [A-Za-z0-9_.-]+ in 1–${MAIN_AUDIO_MAX_NAME_BYTES} bytes (${anchor})`);
    }
    if (index < MAIN_AUDIO_BUILTIN_TRACKS.length && folded !== MAIN_AUDIO_BUILTIN_TRACKS[index]) {
      return fail(extension, baseOffset + extension.offset, `TKR audio track ${index} must be the built-in "${MAIN_AUDIO_BUILTIN_TRACKS[index]}" (${anchor})`);
    }
    if (seen.has(folded)) return fail(extension, baseOffset + extension.offset, `duplicate TKR audio track name "${name.value}" (${anchor})`);
    seen.add(folded);
    const voiceCount = located(extension.u16());
    if (!voiceCount.ok) return voiceCount;
    if (voiceCount.value < 1 || voiceCount.value > MAIN_AUDIO_MAX_VOICE_CAP) {
      return fail(extension, baseOffset + extension.offset, `TKR audio track "${name.value}" voice count ${voiceCount.value} is outside 1–${MAIN_AUDIO_MAX_VOICE_CAP} (${anchor})`);
    }
    tracks.push({ name: name.value, voiceCount: voiceCount.value });
  }
  const voiceCap = located(extension.u16());
  if (!voiceCap.ok) return voiceCap;
  if (voiceCap.value < MAIN_AUDIO_MIN_VOICE_CAP || voiceCap.value > MAIN_AUDIO_MAX_VOICE_CAP) {
    return fail(extension, baseOffset + extension.offset, `TKR audio voice cap ${voiceCap.value} is outside ${MAIN_AUDIO_MIN_VOICE_CAP}–${MAIN_AUDIO_MAX_VOICE_CAP} (${anchor})`);
  }
  const fontPresent = located(extension.u8());
  if (!fontPresent.ok) return fontPresent;
  if (fontPresent.value !== 0 && fontPresent.value !== 1) {
    return fail(extension, baseOffset + extension.offset, `TKR audio font-present flag ${fontPresent.value} must be 0 or 1 (${anchor})`);
  }
  let defaultSoundFont: string | null = null;
  if (fontPresent.value === 1) {
    const fontStart = extension.offset;
    const fontScanLimit = Math.min(extension.bytes.length, fontStart + MAIN_AUDIO_MAX_FONT_BYTES + 1);
    let fontNul = fontStart;
    while (fontNul < fontScanLimit && extension.bytes[fontNul] !== 0) fontNul += 1;
    if (fontNul === fontScanLimit && fontScanLimit - fontStart > MAIN_AUDIO_MAX_FONT_BYTES) {
      return fail(extension, baseOffset + fontStart, `TKR audio default SoundFont exceeds ${MAIN_AUDIO_MAX_FONT_BYTES} bytes (${anchor})`);
    }
    const font = located(extension.str());
    if (!font.ok) return font;
    if (font.value.length === 0 || font.value.length > MAIN_AUDIO_MAX_FONT_BYTES) {
      return fail(extension, baseOffset + extension.offset, `a TKR audio default SoundFont must be 1–${MAIN_AUDIO_MAX_FONT_BYTES} bytes (${anchor})`);
    }
    defaultSoundFont = font.value;
  }
  const residue = located(extension.readBytes(extension.remaining));
  if (!residue.ok) return residue;
  return ok({
    audioSettings: { tracks, voiceCap: voiceCap.value, defaultSoundFont },
    residue: residue.value,
  });
}

/** An empty placeholder main file for zero-byte files (Z-1). */
export function createEmptyMainFile(): MainFile {
  return {
    magic: MAIN_MAGIC,
    major: 2,
    minor: 0,
    registrationFlag: 0,
    registrationCode: "NOCODE",
    projectPath: "",
    gameTitle: "",
    screenType: 2,
    extendToFullScreen: 0,
    resolution: 0,
    disableProtectReg: 0,
    languageFile: "",
    startupPrg: "",
    initBoard: "",
    initChar: "",
    runTimePrg: "",
    runTimeKey: 0,
    menuKey: 0,
    activationKey: 0,
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
    audioSettings: null,
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
    transparent: NO_COLOR,
    resX: 0,
    resY: 0,
    showFpsInTitle: 0,
    pathfindHeuristic: 0,
    drawVectorsFlags: 0,
    pathColor: NO_COLOR,
    movementControls: 0,
    movementScanCodes: [0, 0, 0, 0, 0, 0, 0, 0],
    reservedRuns: {
      parallax: NO_BYTES,
      menuPluginFallback: NO_BYTES,
      multitask: NO_BYTES,
      fightStyle: NO_BYTES,
    },
    residue: NO_BYTES,
  };
}

/**
 * The stock packages a new project names in its TKR package list
 * (docs/spec/formats/main-file.md#tkr-package-list-extension). The list is the
 * explicit surface the editor saves; the legacy DLL rows stay data.
 */
export const NEW_PROJECT_PACKAGE_PLUGINS: readonly string[] = ["stock_battle", "stock_menu"];

/**
 * A new-project main file: the current minor and both stock packages in the package list, so a
 * project saved from the editor names its menu and battle systems explicitly. The menu and battle
 * DLL rows stay empty — a new project has no legacy rows to preserve.
 */
export function newProjectMainFile(): MainFile {
  return {
    ...createEmptyMainFile(),
    minor: MAIN_MAX_MINOR,
    packagePlugins: [...NEW_PROJECT_PACKAGE_PLUGINS],
    packagePluginsExtension: true,
  };
}

/** Parse a Toolkit 2 line-oriented text main file (docs/spec/formats/legacy/text-formats.md#main-file-toolkit-2-text). */
export function readTextMainFile(bytes: Uint8Array, path?: string): Result<MainFile> {
  const reader = new TextLineReader(bytes, path);

  const magic = reader.nextLine("magic", MAIN_SECTION);
  if (!magic.ok) return magic;
  const magicTrim = magic.value.trim();
  if (magicTrim !== MAIN_MAGIC && magicTrim !== "RPGTLKIT mainForm") {
    return err({
      ...(path === undefined ? {} : { path }),
      offset: 0,
      section: MAIN_SECTION,
      message: `not a main file: magic is "${magic.value}", expected "${MAIN_MAGIC}"`,
    });
  }

  const major = reader.nextInt("major", MAIN_SECTION, 2);
  if (!major.ok) return major;
  const minor = reader.nextInt("minor", MAIN_SECTION, 0);
  if (!minor.ok) return minor;

  const regFlag = reader.nextInt("registered", MAIN_SECTION, 0);
  if (!regFlag.ok) return regFlag;
  const startupPrg = reader.nextLine("startupPrg", MAIN_SECTION);
  if (!startupPrg.ok) return startupPrg;
  const runTimePrg = reader.nextLine("runTimePrg", MAIN_SECTION);
  if (!runTimePrg.ok) return runTimePrg;
  const useBuiltinMenu = reader.nextLine("useBuiltinMenu", MAIN_SECTION);
  if (!useBuiltinMenu.ok) return useBuiltinMenu;

  const runKey = reader.nextInt("runKey", MAIN_SECTION, 0);
  if (!runKey.ok) return runKey;
  const menuKey = reader.nextInt("menuKey", MAIN_SECTION, 0);
  if (!menuKey.ok) return menuKey;
  const activationKey = reader.nextInt("activationKey", MAIN_SECTION, 0);
  if (!activationKey.ok) return activationKey;

  const initBoard = reader.nextLine("initBoard", MAIN_SECTION);
  if (!initBoard.ok) return initBoard;
  const initChar = reader.nextLine("initChar", MAIN_SECTION);
  if (!initChar.ok) return initChar;

  const fightingDisabled = reader.nextInt("fightGameYn", MAIN_SECTION, 0);
  if (!fightingDisabled.ok) return fightingDisabled;

  const multitaskSpeed = reader.nextLine("multitaskSpeed", MAIN_SECTION);
  if (!multitaskSpeed.ok) return multitaskSpeed;
  const memProtect = reader.nextLine("memoryProtection", MAIN_SECTION);
  if (!memProtect.ok) return memProtect;

  const enemies: MainFileEnemy[] = [];
  for (let k = 0; k < 501; k++) {
    const enemy = reader.nextLine(`enemy[${k}]`, MAIN_SECTION);
    if (!enemy.ok) return enemy;
    const skill = reader.nextInt(`skill[${k}]`, MAIN_SECTION, 0);
    if (!skill.ok) return skill;
    enemies.push({ enemyFile: enemy.value, skillLevel: skill.value });
  }

  const fightType = reader.nextInt("fightType", MAIN_SECTION, 0);
  if (!fightType.ok) return fightType;
  const chances = reader.nextInt("chances", MAIN_SECTION, 0);
  if (!chances.ok) return chances;
  const useCustomFightPrg = reader.nextInt("useCustomFightPrg", MAIN_SECTION, 0);
  if (!useCustomFightPrg.ok) return useCustomFightPrg;
  const customFightPrg = reader.nextLine("customFightPrg", MAIN_SECTION);
  if (!customFightPrg.ok) return customFightPrg;

  const ignored18 = reader.nextLine("ignored18", MAIN_SECTION);
  if (!ignored18.ok) return ignored18;

  const gameTitle = reader.nextLine("gameTitle", MAIN_SECTION);
  if (!gameTitle.ok) return gameTitle;
  const screenType = reader.nextInt("screenType", MAIN_SECTION, 2);
  if (!screenType.ok) return screenType;

  const ignored21 = reader.nextLine("ignoredFightingStyle", MAIN_SECTION);
  if (!ignored21.ok) return ignored21;

  const gameOverPrg = reader.nextLine("gameOverPrg", MAIN_SECTION);
  if (!gameOverPrg.ok) return gameOverPrg;
  const projectPath = reader.nextLine("projectPath", MAIN_SECTION);
  if (!projectPath.ok) return projectPath;
  const skinButton = reader.nextLine("skinButton", MAIN_SECTION);
  if (!skinButton.ok) return skinButton;
  const skinWindow = reader.nextLine("skinWindow", MAIN_SECTION);
  if (!skinWindow.ok) return skinWindow;

  const ignored26 = reader.nextLine("ignoredTargetPlatform", MAIN_SECTION);
  if (!ignored26.ok) return ignored26;

  const extKeys: MainFileExtKey[] = [];
  for (let k = 0; k < 51; k++) {
    const key = reader.nextInt(`extKey[${k}]`, MAIN_SECTION, 0);
    if (!key.ok) return key;
    const prg = reader.nextLine(`extPrg[${k}]`, MAIN_SECTION);
    if (!prg.ok) return prg;
    extKeys.push({ asciiKey: key.value, program: prg.value });
  }

  const registrationCode = reader.nextLine("registrationCode", MAIN_SECTION);
  if (!registrationCode.ok) return registrationCode;

  let extendToFullScreen = 0;
  let resolution = 0;
  const plugins: MainFilePlugin[] = [];
  let useDayNight = 0;
  let dayNightType = 0;
  let dayLengthMinutes = 0;
  let disableProtectReg = 0;
  let languageFile = "";

  if (reader.hasMore()) {
    const ext = reader.nextInt("extendToFullScreen", MAIN_SECTION, 0);
    if (!ext.ok) return ext;
    extendToFullScreen = ext.value;
  }
  if (reader.hasMore()) {
    const res = reader.nextInt("resolution", MAIN_SECTION, 0);
    if (!res.ok) return res;
    resolution = res.value;
  }
  if (reader.hasMore()) {
    const pCount = reader.nextInt("pluginCount", MAIN_SECTION, 0);
    if (!pCount.ok) return pCount;
    for (let k = 0; k < pCount.value && reader.hasMore(); k++) {
      const flag = reader.nextInt(`pluginFlag[${k}]`, MAIN_SECTION, 0);
      if (!flag.ok) return flag;
      plugins.push({ enabled: flag.value, pluginFile: "" });
    }
  }
  if (reader.hasMore()) {
    const dnUse = reader.nextInt("useDayNight", MAIN_SECTION, 0);
    if (!dnUse.ok) return dnUse;
    useDayNight = dnUse.value;
  }
  if (reader.hasMore()) {
    const dnType = reader.nextInt("dayNightType", MAIN_SECTION, 0);
    if (!dnType.ok) return dnType;
    dayNightType = dnType.value;
  }
  if (reader.hasMore()) {
    const dnLen = reader.nextInt("dayLengthMinutes", MAIN_SECTION, 0);
    if (!dnLen.ok) return dnLen;
    dayLengthMinutes = dnLen.value;
  }
  if (reader.hasMore()) {
    const prot = reader.nextInt("disableProtectReg", MAIN_SECTION, 0);
    if (!prot.ok) return prot;
    disableProtectReg = prot.value;
  }
  if (reader.hasMore()) {
    const px = reader.nextLine("parallax", MAIN_SECTION);
    if (!px.ok) return px;
  }
  if (reader.hasMore()) {
    const lang = reader.nextLine("languageFile", MAIN_SECTION);
    if (!lang.ok) return lang;
    languageFile = lang.value;
  }

  const finished = reader.finish(MAIN_SECTION);
  if (!finished.ok) return finished;

  return ok({
    magic: MAIN_MAGIC,
    major: major.value,
    minor: minor.value,
    audioSettings: null,
    registrationFlag: regFlag.value,
    registrationCode: registrationCode.value,
    projectPath: projectPath.value,
    gameTitle: gameTitle.value,
    screenType: screenType.value,
    extendToFullScreen,
    resolution,
    disableProtectReg,
    languageFile,
    startupPrg: startupPrg.value,
    initBoard: initBoard.value,
    initChar: initChar.value,
    runTimePrg: runTimePrg.value,
    runTimeKey: runKey.value,
    menuKey: menuKey.value,
    activationKey: activationKey.value,
    extKeys,
    menuPlugin: "",
    fightPlugin: "",
    fightingDisabled: fightingDisabled.value,
    enemies,
    fightType: fightType.value,
    chances: chances.value,
    useCustomFightPrg: useCustomFightPrg.value,
    customFightPrg: customFightPrg.value,
    gameOverPrg: gameOverPrg.value,
    skinButton: skinButton.value,
    skinWindow: skinWindow.value,
    plugins,
    useDayNight,
    dayNightType,
    dayLengthMinutes,
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
    transparent: NO_COLOR,
    resX: 0,
    resY: 0,
    showFpsInTitle: 0,
    pathfindHeuristic: 0,
    drawVectorsFlags: 0,
    pathColor: NO_COLOR,
    movementControls: 0,
    movementScanCodes: [0, 0, 0, 0, 0, 0, 0, 0],
    reservedRuns: {
      parallax: NO_BYTES,
      menuPluginFallback: NO_BYTES,
      multitask: NO_BYTES,
      fightStyle: NO_BYTES,
    },
    residue: NO_BYTES,
  });
}


/**
 * Read a main game file from `reader` (docs/spec/formats/main-file.md#layout). The header's minor must
 * be 0–9; every field listed for that minor is read in order. Any bytes after
 * the last row are kept as `residue` and reported as one warning (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 */
export function readMainFile(reader: BinaryReader): Result<MainFile> {
  const start = reader.offset;

  if (reader.remaining === 0) {
    return fail(reader, start, "unexpected end of data reading magic: need 1 byte(s), 0 remain");
  }

  const detection = reader.isBinaryAt(start + MAIN_MAGIC.length);
  if (detection.ok && !detection.value) {
    const bytes = reader.readBytes(reader.remaining);
    if (!bytes.ok) {
      return bytes;
    }
    return readTextMainFile(bytes.value, reader.path);
  }

  const header = reader.header();
  if (!header.ok) {
    return header;
  }
  const { magic, major, minor } = header.value;
  if (magic !== MAIN_MAGIC) {
    return fail(reader, start, `not a main file: magic is "${magic}", expected "${MAIN_MAGIC}"`);
  }
  if (major < 0) {
    return fail(reader, start + MAIN_MAGIC.length + 1, `negative major version ${major} (docs/spec/formats/README.md#header-and-version)`);
  }
  if (minor < MAIN_MIN_MINOR || minor > MAIN_MAX_MINOR) {
    return fail(
      reader,
      start + MAIN_MAGIC.length + 3,
      `unsupported main-file minor ${minor}: this layout accepts ${MAIN_MIN_MINOR}–${MAIN_MAX_MINOR}`,
    );
  }

  // Rows 3–4: the registration quirk. The editor writes an i16 flag and then
  // the `"NOCODE"` str; the legacy C++ reader read an i32 here, eating two bytes
  // of the string and then reading `"CODE"`, and both land at the same offset
  // (`projectPath`, `docs/spec/formats/main-file.md#layout`, rows 4–5). Reading the editor's shape round-trips.
  const registrationFlag = reader.i16();
  if (!registrationFlag.ok) {
    return registrationFlag;
  }
  const registrationCode = reader.str();
  if (!registrationCode.ok) {
    return registrationCode;
  }

  // Row 5: projectPath.
  const projectPath = reader.str();
  if (!projectPath.ok) {
    return projectPath;
  }
  const gameTitle = reader.str();
  if (!gameTitle.ok) {
    return gameTitle;
  }
  const screenType = reader.i16();
  if (!screenType.ok) {
    return screenType;
  }
  const extendToFullScreen = reader.i16();
  if (!extendToFullScreen.ok) {
    return extendToFullScreen;
  }
  const resolution = reader.i16();
  if (!resolution.ok) {
    return resolution;
  }

  // Row 10, minor < 3: reserved i16 (old parallax value, R-18).
  let parallax = NO_BYTES;
  if (minor < 3) {
    const r = reader.readBytes(2);
    if (!r.ok) {
      return r;
    }
    parallax = r.value;
  }

  const disableProtectReg = reader.i16();
  if (!disableProtectReg.ok) {
    return disableProtectReg;
  }
  const languageFile = reader.str();
  if (!languageFile.ok) {
    return languageFile;
  }
  const startupPrg = reader.str();
  if (!startupPrg.ok) {
    return startupPrg;
  }
  const initBoard = reader.str();
  if (!initBoard.ok) {
    return initBoard;
  }
  const initChar = reader.str();
  if (!initChar.ok) {
    return initChar;
  }
  const runTimePrg = reader.str();
  if (!runTimePrg.ok) {
    return runTimePrg;
  }
  const runTimeKey = reader.i16();
  if (!runTimeKey.ok) {
    return runTimeKey;
  }
  const menuKey = reader.i16();
  if (!menuKey.ok) {
    return menuKey;
  }
  const activationKey = reader.i16();
  if (!activationKey.ok) {
    return activationKey;
  }

  // Row 19: the extra run-time keys. The upper bound is `n` meaning `n + 1`
  // entries (`-1` means none, `docs/spec/formats/README.md#counts-are-usually-upper-bounds`); empty-program entries are kept so the file
  // round-trips, even though the engine skips them at runtime (`docs/spec/formats/main-file.md#layout`, row 22).
  const extKeys: MainFileExtKey[] = [];
  const extBound = reader.readUpperBound("i16");
  if (!extBound.ok) {
    return extBound;
  }
  for (let i = 0; i < extBound.value; i += 1) {
    const asciiKey = reader.i16();
    if (!asciiKey.ok) {
      return asciiKey;
    }
    const program = reader.str();
    if (!program.ok) {
      return program;
    }
    extKeys.push({ asciiKey: asciiKey.value, program: program.value });
  }

  // Row 21 (conditional): menuPlugin/fightPlugin at minor ≥ 3, a reserved i16
  // below it (R-18).
  let menuPlugin = "";
  let fightPlugin = "";
  let menuPluginFallback = NO_BYTES;
  if (minor >= 3) {
    const mp = reader.str();
    if (!mp.ok) {
      return mp;
    }
    menuPlugin = mp.value;
    const fp = reader.str();
    if (!fp.ok) {
      return fp;
    }
    fightPlugin = fp.value;
  } else {
    const r = reader.readBytes(2);
    if (!r.ok) {
      return r;
    }
    menuPluginFallback = r.value;
  }

  // Row 22 (conditional, minor ≤ 2): reserved i32 + i16.
  let multitask = NO_BYTES;
  if (minor <= 2) {
    const r = reader.readBytes(6);
    if (!r.ok) {
      return r;
    }
    multitask = r.value;
  }

  // Row 20: the inverted fighting flag (0 = enabled).
  const fightingDisabled = reader.i16();
  if (!fightingDisabled.ok) {
    return fightingDisabled;
  }

  // Row 21: the random-encounter pool.
  const enemies: MainFileEnemy[] = [];
  const enemyBound = reader.readUpperBound("i16");
  if (!enemyBound.ok) {
    return enemyBound;
  }
  for (let i = 0; i < enemyBound.value; i += 1) {
    const enemyFile = reader.str();
    if (!enemyFile.ok) {
      return enemyFile;
    }
    const skillLevel = reader.i16();
    if (!skillLevel.ok) {
      return skillLevel;
    }
    enemies.push({ enemyFile: enemyFile.value, skillLevel: skillLevel.value });
  }

  const fightType = reader.i16();
  if (!fightType.ok) {
    return fightType;
  }
  const chances = reader.i32();
  if (!chances.ok) {
    return chances;
  }
  const useCustomFightPrg = reader.i16();
  if (!useCustomFightPrg.ok) {
    return useCustomFightPrg;
  }
  const customFightPrg = reader.str();
  if (!customFightPrg.ok) {
    return customFightPrg;
  }

  // Row 11, minor < 3: reserved i16 (old fight style).
  let fightStyle = NO_BYTES;
  if (minor < 3) {
    const r = reader.readBytes(2);
    if (!r.ok) {
      return r;
    }
    fightStyle = r.value;
  }

  const gameOverPrg = reader.str();
  if (!gameOverPrg.ok) {
    return gameOverPrg;
  }
  const skinButton = reader.str();
  if (!skinButton.ok) {
    return skinButton;
  }
  const skinWindow = reader.str();
  if (!skinWindow.ok) {
    return skinWindow;
  }

  // Row 37: the plugin list. Entries are `i16 enabled` at minor ≤ 2 (the name is
  // implied as `tkplug<N>`) and `str pluginFile` at minor ≥ 3.
  const plugins: MainFilePlugin[] = [];
  const pluginBound = reader.readUpperBound("i16");
  if (!pluginBound.ok) {
    return pluginBound;
  }
  for (let i = 0; i < pluginBound.value; i += 1) {
    if (minor <= 2) {
      const enabled = reader.i16();
      if (!enabled.ok) {
        return enabled;
      }
      plugins.push({ enabled: enabled.value, pluginFile: "" });
    } else {
      const pluginFile = reader.str();
      if (!pluginFile.ok) {
        return pluginFile;
      }
      plugins.push({ enabled: 0, pluginFile: pluginFile.value });
    }
  }

  const useDayNight = reader.i16();
  if (!useDayNight.ok) {
    return useDayNight;
  }
  const dayNightType = reader.i16();
  if (!dayNightType.ok) {
    return dayNightType;
  }
  const dayLengthMinutes = reader.i32();
  if (!dayLengthMinutes.ok) {
    return dayLengthMinutes;
  }

  // Row 37 (conditional, minor ≥ 3): the cursor sounds and the joystick/colour
  // settings.
  let cursorMoveSound = "";
  let cursorSelectSound = "";
  let cursorCancelSound = "";
  let useJoystick = 0;
  let colorDepth = 0;
  if (minor >= 3) {
    const cms = reader.str();
    if (!cms.ok) {
      return cms;
    }
    cursorMoveSound = cms.value;
    const css = reader.str();
    if (!css.ok) {
      return css;
    }
    cursorSelectSound = css.value;
    const ccs = reader.str();
    if (!ccs.ok) {
      return ccs;
    }
    cursorCancelSound = ccs.value;
    const joy = reader.u8();
    if (!joy.ok) {
      return joy;
    }
    useJoystick = joy.value;
    const depth = reader.u8();
    if (!depth.ok) {
      return depth;
    }
    colorDepth = depth.value;
  }

  // Row 38 (conditional, minor ≥ 4): gameSpeed (biased at minor ≥ 8) and
  // pixelMovement.
  let gameSpeed = 0;
  let pixelMovement = 0;
  if (minor >= 4) {
    const gs = reader.u8();
    if (!gs.ok) {
      return gs;
    }
    gameSpeed = decodeGameSpeed(minor, gs.value);
    const pm = reader.u8();
    if (!pm.ok) {
      return pm;
    }
    pixelMovement = pm.value;
  }

  // Row 39 (conditional, minor = 5): cursorEnabled.
  let cursorEnabled = 0;
  if (minor === 5) {
    const ce = reader.u8();
    if (!ce.ok) {
      return ce;
    }
    cursorEnabled = ce.value;
  }

  // Row 40 (conditional, minor ≥ 6): the mouse cursor and its hot spot.
  let mouseCursor = "";
  let hotSpotX = 0;
  let hotSpotY = 0;
  let transparent = NO_COLOR;
  if (minor >= 6) {
    const mc = reader.str();
    if (!mc.ok) {
      return mc;
    }
    mouseCursor = mc.value;
    const hx = reader.u8();
    if (!hx.ok) {
      return hx;
    }
    hotSpotX = hx.value;
    const hy = reader.u8();
    if (!hy.ok) {
      return hy;
    }
    hotSpotY = hy.value;
    const t = reader.color();
    if (!t.ok) {
      return t;
    }
    transparent = t.value;
  }

  // Row 41 (conditional, minor ≥ 7): the custom resolution.
  let resX = 0;
  let resY = 0;
  if (minor >= 7) {
    const x = reader.i32();
    if (!x.ok) {
      return x;
    }
    resX = x.value;
    const y = reader.i32();
    if (!y.ok) {
      return y;
    }
    resY = y.value;
  }

  // Row 42 (conditional, minor ≥ 8): showFpsInTitle.
  let showFpsInTitle = 0;
  if (minor >= 8) {
    const fps = reader.u8();
    if (!fps.ok) {
      return fps;
    }
    showFpsInTitle = fps.value;
  }

  // Row 43 (conditional, minor ≥ 9): pathfinding, debug overlays, the path
  // colour, movement controls and the eight movement scan codes.
  let pathfindHeuristic = 0;
  let drawVectorsFlags = 0;
  let pathColor = NO_COLOR;
  let movementControls = 0;
  const movementScanCodes: number[] = [];
  if (minor >= 9) {
    const heuristic = reader.i16();
    if (!heuristic.ok) {
      return heuristic;
    }
    pathfindHeuristic = heuristic.value;
    const vectors = reader.i32();
    if (!vectors.ok) {
      return vectors;
    }
    drawVectorsFlags = vectors.value;
    const colour = reader.color();
    if (!colour.ok) {
      return colour;
    }
    pathColor = colour.value;
    const controls = reader.i32();
    if (!controls.ok) {
      return controls;
    }
    movementControls = controls.value;
    for (let i = 0; i < 8; i += 1) {
      const scan = reader.i16();
      if (!scan.ok) {
        return scan;
      }
      movementScanCodes.push(scan.value);
    }
  }

  const reservedRuns: MainFileReservedRuns = { parallax, menuPluginFallback, multitask, fightStyle };

  const trailingStart = reader.offset;
  const trailing = reader.readBytes(reader.remaining);
  if (!trailing.ok) return trailing;
  const extension = parsePackageExtension(trailing.value, reader.path, trailingStart);
  if (!extension.ok) return extension;
  const audioStart = trailingStart + trailing.value.length - extension.value.residue.length;
  const audio = parseAudioExtension(extension.value.residue, reader.path, audioStart);
  if (!audio.ok) return audio;
  const warnings: string[] = [];
  if (audio.value.residue.length > 0) {
    warnings.push(
      `${audio.value.residue.length} trailing byte(s) after the main file were kept as residue (docs/spec/formats/README.md#bytes-after-the-last-documented-field)`,
    );
  }

  return ok({
    magic,
    major,
    minor,
    registrationFlag: registrationFlag.value,
    registrationCode: registrationCode.value,
    projectPath: projectPath.value,
    gameTitle: gameTitle.value,
    screenType: screenType.value,
    extendToFullScreen: extendToFullScreen.value,
    resolution: resolution.value,
    disableProtectReg: disableProtectReg.value,
    languageFile: languageFile.value,
    startupPrg: startupPrg.value,
    initBoard: initBoard.value,
    initChar: initChar.value,
    runTimePrg: runTimePrg.value,
    runTimeKey: runTimeKey.value,
    menuKey: menuKey.value,
    activationKey: activationKey.value,
    extKeys,
    menuPlugin,
    fightPlugin,
    fightingDisabled: fightingDisabled.value,
    enemies,
    fightType: fightType.value,
    chances: chances.value,
    useCustomFightPrg: useCustomFightPrg.value,
    customFightPrg: customFightPrg.value,
    gameOverPrg: gameOverPrg.value,
    skinButton: skinButton.value,
    skinWindow: skinWindow.value,
    plugins,
    ...(extension.value.packagePluginsExtension
      ? { packagePlugins: extension.value.packagePlugins, packagePluginsExtension: true }
      : {}),
    audioSettings: audio.value.audioSettings,
    useDayNight: useDayNight.value,
    dayNightType: dayNightType.value,
    dayLengthMinutes: dayLengthMinutes.value,
    cursorMoveSound,
    cursorSelectSound,
    cursorCancelSound,
    useJoystick,
    colorDepth,
    gameSpeed,
    pixelMovement,
    cursorEnabled,
    mouseCursor,
    hotSpotX,
    hotSpotY,
    transparent,
    resX,
    resY,
    showFpsInTitle,
    pathfindHeuristic,
    drawVectorsFlags,
    pathColor,
    movementControls,
    movementScanCodes,
    reservedRuns,
    residue: audio.value.residue,
  }, warnings);
}
