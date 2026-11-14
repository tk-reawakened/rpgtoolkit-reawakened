import {
  BUILTIN_TRACKS,
  DEFAULT_MOVEMENT_SCAN_CODES,
  DIRECT_INPUT_PHYSICAL_KEYS,
  MAIN_AUDIO_MAX_FONT_BYTES,
  MAIN_PACKAGE_MAX_BYTES,
  MAIN_PACKAGE_MAX_COUNT,
  encodeCp1252,
  mainFileLegacyPluginRows,
  type Colorref,
  type MainFile,
  type MainFileEnemy,
  type MainFileExtKey,
} from "@tk-reawakened/core";

/** ASCII-only case fold: how package names are compared (`#tkr-package-list-extension`, PKG-4); never a locale fold. */
function foldNamespace(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 0x20));
}

/**
 * The game settings of editor-features T-10 to T-14 over a main file (`docs/spec/formats/main-file.md#layout`), as plain
 * data a view stages and a command carries. Each setting names one or more rows of the file; the editor changes only the
 * rows a setting names, so every row and block it does not edit (the reserved runs, the stored-only fields, the bytes
 * after the last block it reads) is written back as it was read.
 *
 * A setting a file's minor version does not store is shown with the value the engine uses for an absent row, and is
 * never stored: the document saves at the minor it was opened at (AD-18, ADR 0022 D2.1), so the editor never upgrades a
 * file silently. Values the editor would not offer (a legacy path-finding mode 0, an unknown colour depth) stay as they
 * are until the creator changes them, and are disclosed by `mainSettingsNotes`.
 */

/** Every editable game setting. Booleans stand for flag rows; a stored legacy flag value (such as `-1`) is kept unless the flag is turned over. */
export interface MainSettings {
  // T-10 Project settings.
  /** Row 6: the project folder relative to the Toolkit folder, with a trailing `\`. */
  readonly projectPath: string;
  /** Row 45, minor ≥ 3: whether the game offers controllers. */
  readonly useJoystick: boolean;
  /** Rows 42–44, minor ≥ 3: menu cursor sounds in `Media\`. */
  readonly cursorMoveSound: string;
  readonly cursorSelectSound: string;
  readonly cursorCancelSound: string;
  /** Row 60, minor ≥ 9, bit 1: walking with the keyboard. */
  readonly keyboardMovement: boolean;
  /** Row 60, minor ≥ 9, bit 2: walking with the mouse. */
  readonly mouseMovement: boolean;
  /** Row 60, minor ≥ 9, bit 4: diagonal movement. */
  readonly diagonalMovement: boolean;
  /** Row 61, minor ≥ 9: eight DirectInput key offsets, E, SE, S, SW, W, NW, N, NE; 0 = unbound. */
  readonly movementScanCodes: readonly number[];
  /** TKR audio-settings block: the default SoundFont `AssetKey`, or `null` for none. */
  readonly defaultSoundFont: string | null;
  // T-11 Startup.
  /** Row 15: the first board in `Boards\`. */
  readonly initBoard: string;
  /** Row 16: the first character in `Chrs\`. */
  readonly initChar: string;
  /** Row 14: the program run at start. */
  readonly startupPrg: string;
  /** Row 34: the program run when the party loses; empty = built-in game over. */
  readonly gameOverPrg: string;
  /** Row 17: the run-time program. */
  readonly runTimePrg: string;
  /** Row 18: the ASCII code of the run-time key. */
  readonly runTimeKey: number;
  /** Row 19: the ASCII code of the menu key. */
  readonly menuKey: number;
  /** Row 20: the ASCII code of the activation key. */
  readonly activationKey: number;
  /** Rows 21–22: the extended run-time keys, one entry per stored slot. */
  readonly extKeys: readonly MainFileExtKey[];
  /** Row 48, minor ≥ 4: 0 tile, 1 pixel with tile pushes, 2 pixel with pixel pushes. */
  readonly pixelMovement: number;
  /** Row 47, minor ≥ 4: the decoded game speed, −4 to +4. */
  readonly gameSpeed: number;
  /** Rows 49–50: `TK DEFAULT`, `""` for none, or an image in `Bitmap\` (minor ≥ 6). */
  readonly mouseCursor: string;
  /** Rows 51–52, minor ≥ 6: the cursor hot spot, pixels. */
  readonly hotSpotX: number;
  readonly hotSpotY: number;
  /** Row 53, minor ≥ 6: the cursor's transparent colour. */
  readonly transparent: Colorref;
  /** Row 57, minor ≥ 9: 1 axial, 2 diagonal, 3 vector. */
  readonly pathfindHeuristic: number;
  // T-12 Fighting.
  /** Row 26 (stored inverted as `fightGameYn`): random battles happen. */
  readonly battlesEnabled: boolean;
  /** Rows 27–28: the random-encounter pool, one entry per stored slot. */
  readonly enemies: readonly MainFileEnemy[];
  /** Row 29: 0 random chance per step, 1 every `chances` steps. */
  readonly fightType: number;
  /** Row 30: the "1 in N" chance, or the step count. */
  readonly chances: number;
  /** Row 31: run `customFightPrg` instead of the built-in battle. */
  readonly useCustomFightPrg: boolean;
  /** Row 32: the custom battle program. */
  readonly customFightPrg: string;
  // T-13 Graphics.
  /** Row 46, minor ≥ 3: 0 16-bit, 1 24-bit, 2 32-bit. */
  readonly colorDepth: number;
  /** Row 9: full screen. */
  readonly extendToFullScreen: boolean;
  /** Row 10: 0 640×480, 1 800×600, 2 1024×768, 4 custom. */
  readonly resolution: number;
  /** Rows 54–55, minor ≥ 7: the custom size. */
  readonly resX: number;
  readonly resY: number;
  /** Row 56, minor ≥ 8: frames per second in the title bar. */
  readonly showFpsInTitle: boolean;
  /** Row 58, minor ≥ 9: debug drawing bits (1 board vectors, 2 sprite vectors, 4 paths, 8 destinations, 16 the selected player's path, 32 its destination). */
  readonly drawVectorsFlags: number;
  /** Row 59, minor ≥ 9: the path debug colour. */
  readonly pathColor: Colorref;
  // T-14 Plugins.
  /** Row 23, minor ≥ 3: the legacy menu plugin name. */
  readonly menuPlugin: string;
  /** Row 24, minor ≥ 3: the legacy battle plugin name. */
  readonly fightPlugin: string;
  /** Rows 37–38b, minor ≥ 3: the legacy RPGCode command plugin names, one per stored slot. */
  readonly commandPlugins: readonly string[];
  /** The TKR package list, in load order (`#tkr-package-list-extension`). */
  readonly packages: readonly string[];
}

export type MainSettingKey = keyof MainSettings;

/** A staged set of changes: only the settings the creator changed. */
export type MainSettingsChanges = { readonly [Key in MainSettingKey]?: MainSettings[Key] };

/** The editor-features section a setting belongs to. */
export type SettingsCategory = "project" | "startup" | "fighting" | "graphics" | "plugins";

export const SETTINGS_CATEGORIES: readonly { readonly id: SettingsCategory; readonly label: string; readonly feature: string }[] = [
  { id: "project", label: "Project", feature: "T-10" },
  { id: "startup", label: "Startup", feature: "T-11" },
  { id: "fighting", label: "Fighting", feature: "T-12" },
  { id: "graphics", label: "Graphics", feature: "T-13" },
  { id: "plugins", label: "Plugins", feature: "T-14" },
];

type Shape = "text" | "font" | "flag" | "integer" | "choice" | "colour" | "scan-codes" | "ext-keys" | "enemies" | "names";

export interface SettingInfo {
  readonly label: string;
  readonly category: SettingsCategory;
  readonly shape: Shape;
  /** The lowest minor version that stores the setting. */
  readonly since: number;
  /** The rows of `docs/spec/formats/main-file.md#layout` (or the TKR block) the setting owns. */
  readonly owner: string;
  /** For `integer`: the inclusive range. */
  readonly min?: number;
  readonly max?: number;
  /** For `choice`: the values the editor offers, with their words. */
  readonly choices?: readonly { readonly value: number; readonly label: string }[];
}

const I16_MIN = -32768;
const I16_MAX = 32767;
const I32_MAX = 2147483647;
/** The editor writes 51 run-time key slots and 501 enemy slots (`docs/spec/formats/main-file.md#compatibility-notes`, array sizes). */
export const EXT_KEY_SLOTS = 51;
export const ENEMY_SLOTS = 501;

export const MAIN_SETTINGS: { readonly [Key in MainSettingKey]: SettingInfo } = {
  projectPath: { label: "Project folder", category: "project", shape: "text", since: 0, owner: "row 6" },
  useJoystick: { label: "Legacy joystick input", category: "project", shape: "flag", since: 3, owner: "row 45" },
  cursorMoveSound: { label: "Cursor move sound", category: "project", shape: "text", since: 3, owner: "row 42" },
  cursorSelectSound: { label: "Cursor select sound", category: "project", shape: "text", since: 3, owner: "row 43" },
  cursorCancelSound: { label: "Cursor cancel sound", category: "project", shape: "text", since: 3, owner: "row 44" },
  keyboardMovement: { label: "Walk with the keyboard", category: "project", shape: "flag", since: 9, owner: "row 60, bit 1" },
  mouseMovement: { label: "Walk with the mouse", category: "project", shape: "flag", since: 9, owner: "row 60, bit 2" },
  diagonalMovement: { label: "Allow diagonal movement", category: "project", shape: "flag", since: 9, owner: "row 60, bit 4" },
  movementScanCodes: { label: "Movement keys", category: "project", shape: "scan-codes", since: 9, owner: "row 61" },
  defaultSoundFont: { label: "Default SoundFont", category: "project", shape: "font", since: 0, owner: "TKR audio-settings block" },
  initBoard: { label: "Initial board", category: "startup", shape: "text", since: 0, owner: "row 15" },
  initChar: { label: "Initial character", category: "startup", shape: "text", since: 0, owner: "row 16" },
  startupPrg: { label: "Start program", category: "startup", shape: "text", since: 0, owner: "row 14" },
  gameOverPrg: { label: "Game-over program", category: "startup", shape: "text", since: 0, owner: "row 34" },
  runTimePrg: { label: "Run-time program", category: "startup", shape: "text", since: 0, owner: "row 17" },
  runTimeKey: { label: "Run-time key (ASCII code)", category: "startup", shape: "integer", since: 0, owner: "row 18", min: 0, max: 255 },
  menuKey: { label: "Menu key (ASCII code)", category: "startup", shape: "integer", since: 0, owner: "row 19", min: 0, max: 255 },
  activationKey: { label: "Activation key (ASCII code)", category: "startup", shape: "integer", since: 0, owner: "row 20", min: 0, max: 255 },
  extKeys: { label: "Extended run-time keys", category: "startup", shape: "ext-keys", since: 0, owner: "rows 21–22" },
  pixelMovement: {
    label: "Movement style", category: "startup", shape: "choice", since: 4, owner: "row 48",
    choices: [{ value: 0, label: "Tile movement" }, { value: 1, label: "Pixel movement, tile-sized pushes" }, { value: 2, label: "Pixel movement, pixel pushes" }],
  },
  gameSpeed: { label: "Game speed (−4 to +4)", category: "startup", shape: "integer", since: 4, owner: "row 47", min: -4, max: 4 },
  mouseCursor: { label: "Mouse cursor", category: "startup", shape: "text", since: 5, owner: "rows 49–50" },
  hotSpotX: { label: "Cursor hot spot x", category: "startup", shape: "integer", since: 6, owner: "row 51", min: 0, max: 255 },
  hotSpotY: { label: "Cursor hot spot y", category: "startup", shape: "integer", since: 6, owner: "row 52", min: 0, max: 255 },
  transparent: { label: "Cursor transparent colour", category: "startup", shape: "colour", since: 6, owner: "row 53" },
  pathfindHeuristic: {
    label: "Default path-finding", category: "startup", shape: "choice", since: 9, owner: "row 57",
    choices: [{ value: 1, label: "Axial (4-way grid)" }, { value: 2, label: "Diagonal (8-way grid)" }, { value: 3, label: "Vector (any angle)" }],
  },
  battlesEnabled: { label: "Random battles", category: "fighting", shape: "flag", since: 0, owner: "row 26" },
  enemies: { label: "Enemy pool", category: "fighting", shape: "enemies", since: 0, owner: "rows 27–28" },
  fightType: {
    label: "Encounter type", category: "fighting", shape: "choice", since: 0, owner: "row 29",
    choices: [{ value: 0, label: "Random: a 1 in N chance each step" }, { value: 1, label: "Planned: every N steps" }],
  },
  chances: { label: "Encounter N", category: "fighting", shape: "integer", since: 0, owner: "row 30", min: 1, max: I32_MAX },
  useCustomFightPrg: { label: "Use a custom battle program", category: "fighting", shape: "flag", since: 0, owner: "row 31" },
  customFightPrg: { label: "Custom battle program", category: "fighting", shape: "text", since: 0, owner: "row 32" },
  colorDepth: {
    label: "Colour depth", category: "graphics", shape: "choice", since: 3, owner: "row 46",
    choices: [{ value: 0, label: "16-bit" }, { value: 1, label: "24-bit" }, { value: 2, label: "32-bit" }],
  },
  extendToFullScreen: { label: "Full screen", category: "graphics", shape: "flag", since: 0, owner: "row 9" },
  resolution: {
    label: "Resolution", category: "graphics", shape: "choice", since: 0, owner: "row 10",
    choices: [{ value: 0, label: "640 × 480" }, { value: 1, label: "800 × 600" }, { value: 2, label: "1024 × 768" }, { value: 4, label: "Custom" }],
  },
  resX: { label: "Custom width", category: "graphics", shape: "integer", since: 7, owner: "row 54", min: 1, max: I32_MAX },
  resY: { label: "Custom height", category: "graphics", shape: "integer", since: 7, owner: "row 55", min: 1, max: I32_MAX },
  showFpsInTitle: { label: "Frames per second in the window bar", category: "graphics", shape: "flag", since: 8, owner: "row 56" },
  drawVectorsFlags: { label: "Debug drawing", category: "graphics", shape: "integer", since: 9, owner: "row 58", min: 0, max: 63 },
  pathColor: { label: "Path debug colour", category: "graphics", shape: "colour", since: 9, owner: "row 59" },
  menuPlugin: { label: "Menu plugin", category: "plugins", shape: "text", since: 3, owner: "row 23" },
  fightPlugin: { label: "Battle plugin", category: "plugins", shape: "text", since: 3, owner: "row 24" },
  commandPlugins: { label: "RPGCode command plugins", category: "plugins", shape: "names", since: 3, owner: "rows 37–38b" },
  packages: { label: "Packages", category: "plugins", shape: "names", since: 0, owner: "TKR package-list block" },
};

export const MAIN_SETTING_KEYS = Object.keys(MAIN_SETTINGS) as readonly MainSettingKey[];

/** The debug-drawing bits of row 58, in order. */
export const DEBUG_DRAWING_BITS: readonly { readonly bit: number; readonly label: string }[] = [
  { bit: 1, label: "Board vectors" },
  { bit: 2, label: "Sprite vectors" },
  { bit: 4, label: "Paths" },
  { bit: 8, label: "Destination circles" },
  { bit: 16, label: "The selected player's path" },
  { bit: 32, label: "The selected player's destination" },
];

/** Row 61's slots, in stored order. */
export const MOVEMENT_DIRECTION_LABELS: readonly string[] = ["East", "South-east", "South", "South-west", "West", "North-west", "North", "North-east"];

/** The cursor value for the built-in arrow (row 50). */
export const DEFAULT_CURSOR = "TK DEFAULT";

/** The engine's default tracks and voice cap when a file carries no audio block (`#tkr-audio-settings-extension`). */
const DEFAULT_AUDIO_VOICE_CAP = 32;

const WHITE: Colorref = { r: 255, g: 255, b: 255 };

/**
 * Packages this editor can describe. Adding any other name is allowed and stays data: the engine loads a name only when
 * its host supplies the package, and reports `plugin.unresolved` otherwise (`docs/spec/engine/main-loop-and-startup.md#reawakened-boot-sequence`).
 */
export const KNOWN_PACKAGES: Readonly<Record<string, string>> = {
  stock_menu: "The stock menu screens: the main menu, items, equipment, abilities and shops (docs/spec/engine/plugins-and-battle.md).",
  stock_battle: "The stock battle system: who fights, their charge bars, the default battle screen and its sounds (docs/spec/engine/battle.md#bat-1).",
};

/** Whether `minor` stores `key`. */
export function settingStored(key: MainSettingKey, minor: number): boolean {
  return minor >= MAIN_SETTINGS[key].since;
}

/** The DirectInput offset of a physical key code (`KeyboardEvent.code`), or `null` when row 61 cannot name it. */
export function scanCodeOfKey(code: string): number | null {
  for (const [offset, name] of Object.entries(DIRECT_INPUT_PHYSICAL_KEYS)) if (name === code) return Number(offset);
  return null;
}

/** The physical key a stored DirectInput offset names, or `null`. */
export function keyOfScanCode(scanCode: number): string | null {
  return DIRECT_INPUT_PHYSICAL_KEYS[scanCode] ?? null;
}

/** The settings a main file holds, with each row the minor does not store shown at the value the engine uses for it. */
export function mainSettingsOf(model: MainFile): MainSettings {
  const minor = model.minor;
  const controls = minor >= 9 ? model.movementControls : 1 + 4;
  return {
    projectPath: model.projectPath,
    useJoystick: minor >= 3 ? model.useJoystick !== 0 : true,
    cursorMoveSound: model.cursorMoveSound,
    cursorSelectSound: model.cursorSelectSound,
    cursorCancelSound: model.cursorCancelSound,
    keyboardMovement: (controls & 1) !== 0,
    mouseMovement: (controls & 2) !== 0,
    diagonalMovement: (controls & 4) !== 0,
    movementScanCodes: minor >= 9 ? [...model.movementScanCodes] : [...DEFAULT_MOVEMENT_SCAN_CODES],
    defaultSoundFont: model.audioSettings?.defaultSoundFont ?? null,
    initBoard: model.initBoard,
    initChar: model.initChar,
    startupPrg: model.startupPrg,
    gameOverPrg: model.gameOverPrg,
    runTimePrg: model.runTimePrg,
    runTimeKey: model.runTimeKey,
    menuKey: model.menuKey,
    activationKey: model.activationKey,
    extKeys: model.extKeys.map((entry) => ({ asciiKey: entry.asciiKey, program: entry.program })),
    pixelMovement: model.pixelMovement,
    gameSpeed: model.gameSpeed,
    mouseCursor: minor >= 6 ? model.mouseCursor : minor === 5 ? (model.cursorEnabled !== 0 ? DEFAULT_CURSOR : "") : DEFAULT_CURSOR,
    hotSpotX: model.hotSpotX,
    hotSpotY: model.hotSpotY,
    transparent: { ...model.transparent },
    pathfindHeuristic: minor >= 9 ? model.pathfindHeuristic : 2,
    battlesEnabled: model.fightingDisabled === 0,
    enemies: model.enemies.map((entry) => ({ enemyFile: entry.enemyFile, skillLevel: entry.skillLevel })),
    fightType: model.fightType,
    chances: model.chances,
    useCustomFightPrg: model.useCustomFightPrg !== 0,
    customFightPrg: model.customFightPrg,
    colorDepth: model.colorDepth,
    extendToFullScreen: model.extendToFullScreen !== 0,
    resolution: model.resolution,
    resX: model.resX,
    resY: model.resY,
    showFpsInTitle: model.showFpsInTitle !== 0,
    drawVectorsFlags: model.drawVectorsFlags,
    pathColor: minor >= 9 ? { ...model.pathColor } : WHITE,
    menuPlugin: minor >= 3 ? model.menuPlugin : "tk3menu.dll",
    fightPlugin: minor >= 3 ? model.fightPlugin : "tk3fight.dll",
    commandPlugins: model.plugins.map((entry, index) => (minor >= 3 ? entry.pluginFile : entry.enabled !== 0 ? `tkplug${index}.dll` : "")),
    packages: [...(model.packagePlugins ?? [])],
  };
}

/** A stored flag turned to `wanted`: the stored value is kept while its truth agrees, so a legacy `-1` or `2` survives. */
function flag(stored: number, wanted: boolean): number {
  return (stored !== 0) === wanted ? stored : wanted ? 1 : 0;
}

function bit(stored: number, mask: number, wanted: boolean): number {
  return wanted ? stored | mask : stored & ~mask;
}

/** `model` with `changes` applied to the rows they own. Pure; validation is `settingsErrors`'s, storage the writer's. */
export function applyMainSettings(model: MainFile, changes: MainSettingsChanges): MainFile {
  let next: { -readonly [Key in keyof MainFile]: MainFile[Key] } = { ...model };
  const set = <Key extends MainSettingKey>(key: Key, apply: (value: MainSettings[Key]) => void): void => {
    const value = changes[key];
    if (value !== undefined) apply(value as MainSettings[Key]);
  };
  set("projectPath", (value) => { next.projectPath = value; });
  set("useJoystick", (value) => { next.useJoystick = flag(next.useJoystick, value); });
  set("cursorMoveSound", (value) => { next.cursorMoveSound = value; });
  set("cursorSelectSound", (value) => { next.cursorSelectSound = value; });
  set("cursorCancelSound", (value) => { next.cursorCancelSound = value; });
  set("keyboardMovement", (value) => { next.movementControls = bit(next.movementControls, 1, value); });
  set("mouseMovement", (value) => { next.movementControls = bit(next.movementControls, 2, value); });
  set("diagonalMovement", (value) => { next.movementControls = bit(next.movementControls, 4, value); });
  set("movementScanCodes", (value) => { next.movementScanCodes = [...value]; });
  set("defaultSoundFont", (value) => {
    if (next.audioSettings !== null) next.audioSettings = { ...next.audioSettings, defaultSoundFont: value };
    else if (value !== null) {
      // A file with no block plays the default tracks under cap 32; the block written here says exactly that, plus the font.
      next.audioSettings = {
        tracks: BUILTIN_TRACKS.map(([name, voiceCount]) => ({ name, voiceCount })),
        voiceCap: DEFAULT_AUDIO_VOICE_CAP,
        defaultSoundFont: value,
      };
    }
  });
  set("initBoard", (value) => { next.initBoard = value; });
  set("initChar", (value) => { next.initChar = value; });
  set("startupPrg", (value) => { next.startupPrg = value; });
  set("gameOverPrg", (value) => { next.gameOverPrg = value; });
  set("runTimePrg", (value) => { next.runTimePrg = value; });
  set("runTimeKey", (value) => { next.runTimeKey = value; });
  set("menuKey", (value) => { next.menuKey = value; });
  set("activationKey", (value) => { next.activationKey = value; });
  set("extKeys", (value) => { next.extKeys = value.map((entry) => ({ asciiKey: entry.asciiKey, program: entry.program })); });
  set("pixelMovement", (value) => { next.pixelMovement = value; });
  set("gameSpeed", (value) => { next.gameSpeed = value; });
  set("mouseCursor", (value) => {
    if (next.minor === 5) next.cursorEnabled = flag(next.cursorEnabled, value !== "");
    else next.mouseCursor = value;
  });
  set("hotSpotX", (value) => { next.hotSpotX = value; });
  set("hotSpotY", (value) => { next.hotSpotY = value; });
  set("transparent", (value) => { next.transparent = { r: value.r, g: value.g, b: value.b }; });
  set("pathfindHeuristic", (value) => { next.pathfindHeuristic = value; });
  set("battlesEnabled", (value) => { next.fightingDisabled = flag(next.fightingDisabled, !value); });
  set("enemies", (value) => { next.enemies = value.map((entry) => ({ enemyFile: entry.enemyFile, skillLevel: entry.skillLevel })); });
  set("fightType", (value) => { next.fightType = value; });
  set("chances", (value) => { next.chances = value; });
  set("useCustomFightPrg", (value) => { next.useCustomFightPrg = flag(next.useCustomFightPrg, value); });
  set("customFightPrg", (value) => { next.customFightPrg = value; });
  set("colorDepth", (value) => { next.colorDepth = value; });
  set("extendToFullScreen", (value) => { next.extendToFullScreen = flag(next.extendToFullScreen, value); });
  set("resolution", (value) => { next.resolution = value; });
  set("resX", (value) => { next.resX = value; });
  set("resY", (value) => { next.resY = value; });
  set("showFpsInTitle", (value) => { next.showFpsInTitle = flag(next.showFpsInTitle, value); });
  set("drawVectorsFlags", (value) => { next.drawVectorsFlags = value; });
  set("pathColor", (value) => { next.pathColor = { r: value.r, g: value.g, b: value.b }; });
  set("menuPlugin", (value) => { next.menuPlugin = value; });
  set("fightPlugin", (value) => { next.fightPlugin = value; });
  set("commandPlugins", (value) => {
    next.plugins = value.map((pluginFile, index) => ({ enabled: model.plugins[index]?.enabled ?? 0, pluginFile }));
  });
  set("packages", (value) => {
    next = { ...next, packagePlugins: [...value], packagePluginsExtension: true };
  });
  return next;
}

/** One finding about a setting: an `error` stops Apply; a `warning` is shown and does not. */
export interface SettingIssue {
  readonly key: MainSettingKey;
  readonly severity: "error" | "warning";
  readonly message: string;
}

/** Whether `text` is a string the file can store: Windows-1252 only, and no NUL, which would end the stored string early. */
function storableText(text: string): string | null {
  if (text.includes("\0")) return "it cannot contain a NUL character";
  const encoded = encodeCp1252(text);
  return encoded.ok ? null : `${encoded.error.message}, so the file cannot store it`;
}

function isWhole(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The settings `changes` would actually change in `current`. */
export function changedSettings(changes: MainSettingsChanges, current: MainSettings): MainSettingsChanges {
  const out: Record<string, unknown> = {};
  for (const key of MAIN_SETTING_KEYS) {
    const value = changes[key];
    if (value !== undefined && !sameValue(value, current[key])) out[key] = value;
  }
  return out as MainSettingsChanges;
}

/**
 * The errors in `changes` against the settings in force and the file's minor. Only changed values are checked: a legacy
 * value the creator did not touch is disclosed (`mainSettingsNotes`), never refused.
 */
export function settingsErrors(changes: MainSettingsChanges, current: MainSettings, minor: number): SettingIssue[] {
  const issues: SettingIssue[] = [];
  const error = (key: MainSettingKey, message: string): void => { issues.push({ key, severity: "error", message: `${MAIN_SETTINGS[key].label}: ${message}.` }); };
  const text = (key: MainSettingKey, value: string, label = ""): void => {
    const problem = storableText(value);
    if (problem !== null) error(key, `${label}${problem}`);
  };
  const colour = (key: MainSettingKey, value: Colorref): void => {
    if (![value.r, value.g, value.b].every((channel) => isWhole(channel, 0, 255))) error(key, "each channel is a whole number from 0 to 255");
  };
  for (const key of MAIN_SETTING_KEYS) {
    const value = changes[key];
    if (value === undefined || sameValue(value, current[key])) continue;
    const info = MAIN_SETTINGS[key];
    if (minor < info.since) {
      error(key, `this file is minor ${minor}, which does not store it (minor ${info.since} and later do); the editor keeps the file's version, so it cannot be changed here`);
      continue;
    }
    switch (info.shape) {
      case "text":
        text(key, value as string);
        break;
      case "font": {
        const font = value as string | null;
        if (font !== null) {
          if (font.length === 0 || font.length > MAIN_AUDIO_MAX_FONT_BYTES) error(key, `an asset key is 1 to ${MAIN_AUDIO_MAX_FONT_BYTES} characters; leave it empty for none`);
          else text(key, font);
        }
        break;
      }
      case "flag":
        break;
      case "integer":
      case "choice": {
        const number = value as number;
        if (info.choices !== undefined) {
          if (!info.choices.some((choice) => choice.value === number)) error(key, `choose one of ${info.choices.map((choice) => choice.label).join(", ")}`);
        } else if (!isWhole(number, info.min ?? I16_MIN, info.max ?? I16_MAX)) {
          error(key, `enter a whole number from ${info.min ?? I16_MIN} to ${info.max ?? I16_MAX}`);
        }
        break;
      }
      case "colour":
        colour(key, value as Colorref);
        break;
      case "scan-codes": {
        const codes = value as readonly number[];
        const was = current.movementScanCodes;
        if (codes.length !== 8) error(key, "there are exactly eight directions");
        codes.forEach((code, slot) => {
          if (code !== was[slot] && code !== 0 && keyOfScanCode(code) === null) error(key, `${MOVEMENT_DIRECTION_LABELS[slot] ?? `slot ${slot}`} names no physical key the player can read`);
        });
        break;
      }
      case "ext-keys": {
        const rows = value as readonly MainFileExtKey[];
        if (rows.length > Math.max(EXT_KEY_SLOTS, current.extKeys.length)) error(key, `there are at most ${EXT_KEY_SLOTS} slots`);
        rows.forEach((row, slot) => {
          const was = current.extKeys[slot];
          if (was !== undefined && sameValue(was, row)) return;
          if (!isWhole(row.asciiKey, 0, 255)) error(key, `slot ${slot + 1}'s key is an ASCII code from 0 to 255`);
          text(key, row.program, `slot ${slot + 1}'s program: `);
        });
        break;
      }
      case "enemies": {
        const rows = value as readonly MainFileEnemy[];
        if (rows.length > Math.max(ENEMY_SLOTS, current.enemies.length)) error(key, `there are at most ${ENEMY_SLOTS} slots`);
        rows.forEach((row, slot) => {
          const was = current.enemies[slot];
          if (was !== undefined && sameValue(was, row)) return;
          if (!isWhole(row.skillLevel, I16_MIN, I16_MAX)) error(key, `slot ${slot + 1}'s skill level is a whole number from ${I16_MIN} to ${I16_MAX}`);
          text(key, row.enemyFile, `slot ${slot + 1}'s enemy: `);
        });
        break;
      }
      case "names": {
        const names = value as readonly string[];
        if (key === "packages") {
          if (names.length > MAIN_PACKAGE_MAX_COUNT) error(key, `the list holds at most ${MAIN_PACKAGE_MAX_COUNT} names`);
          const seen = new Set<string>();
          for (const name of names) {
            const folded = foldNamespace(name);
            if (name.length === 0 || name.length > MAIN_PACKAGE_MAX_BYTES) error(key, `a package name is 1 to ${MAIN_PACKAGE_MAX_BYTES} characters`);
            else text(key, name, `"${name}": `);
            if (seen.has(folded)) error(key, `"${name}" is listed twice (names are compared ignoring ASCII case)`);
            seen.add(folded);
          }
        } else {
          if (names.length > I16_MAX) error(key, `the list holds at most ${I16_MAX} slots`);
          for (const name of names) text(key, name, `"${name}": `);
        }
        break;
      }
    }
  }
  if (changes.mouseCursor !== undefined && changes.mouseCursor !== current.mouseCursor && minor === 5 && changes.mouseCursor !== "" && changes.mouseCursor !== DEFAULT_CURSOR) {
    error("mouseCursor", "this file is minor 5, which stores only the built-in arrow or no cursor; an image needs minor 6");
  }
  if (changes.resolution === 4 && current.resolution !== 4 && minor < 7) {
    error("resolution", `this file is minor ${minor}, which does not store a custom size (minor 7 and later do)`);
  }
  return issues;
}

const asciiName = (code: number): string => (code === 13 ? "Enter" : code === 32 ? "Space" : code === 27 ? "Escape" : code > 32 && code < 127 ? `"${String.fromCharCode(code)}"` : `${code}`);

/** Conflicts and likely mistakes in a whole set of settings: shown beside the fields, never refused. */
export function settingsWarnings(settings: MainSettings, minor: number): SettingIssue[] {
  const issues: SettingIssue[] = [];
  const warn = (key: MainSettingKey, message: string): void => { issues.push({ key, severity: "warning", message }); };
  if (minor >= 9) {
    const byCode = new Map<number, string[]>();
    settings.movementScanCodes.forEach((code, slot) => {
      if (code === 0) return;
      byCode.set(code, [...(byCode.get(code) ?? []), MOVEMENT_DIRECTION_LABELS[slot] ?? `slot ${slot}`]);
    });
    for (const [code, directions] of byCode) {
      if (directions.length > 1) warn("movementScanCodes", `${keyOfScanCode(code) ?? `Scan code ${code}`} moves the player ${directions.join(" and ")}.`);
    }
    if (!settings.keyboardMovement && !settings.mouseMovement) warn("keyboardMovement", "Neither the keyboard nor the mouse walks the player.");
  }
  const asciiUses: { readonly code: number; readonly name: string; readonly key: MainSettingKey }[] = [];
  if (settings.runTimeKey !== 0) asciiUses.push({ code: settings.runTimeKey, name: "the run-time key", key: "runTimeKey" });
  if (settings.menuKey !== 0) asciiUses.push({ code: settings.menuKey, name: "the menu key", key: "menuKey" });
  if (settings.activationKey !== 0) asciiUses.push({ code: settings.activationKey, name: "the activation key", key: "activationKey" });
  settings.extKeys.forEach((row, slot) => {
    if (row.asciiKey !== 0 && row.program !== "") asciiUses.push({ code: row.asciiKey, name: `extended run-time key ${slot + 1}`, key: "extKeys" });
    else if (row.asciiKey !== 0) warn("extKeys", `Extended run-time key ${slot + 1} (${asciiName(row.asciiKey)}) has no program, so the game ignores it.`);
    else if (row.program !== "") warn("extKeys", `Extended run-time key ${slot + 1} runs ${row.program} but has no key.`);
  });
  const byAscii = new Map<number, typeof asciiUses>();
  for (const use of asciiUses) byAscii.set(use.code, [...(byAscii.get(use.code) ?? []), use]);
  for (const [code, uses] of byAscii) {
    if (uses.length > 1) warn(uses[0]!.key, `${asciiName(code)} is ${uses.map((use) => use.name).join(" and ")}.`);
  }
  if (settings.runTimePrg !== "" && settings.runTimeKey === 0) warn("runTimeKey", "The run-time program has no key to run it.");
  if (settings.useCustomFightPrg && settings.customFightPrg === "") warn("customFightPrg", "A custom battle program is turned on but none is named.");
  if (settings.battlesEnabled && !settings.enemies.some((row) => row.enemyFile !== "")) warn("enemies", "Random battles are on, but the enemy pool is empty.");
  for (const name of settings.packages) {
    if (KNOWN_PACKAGES[foldNamespace(name)] === undefined) {
      warn("packages", `"${name}" is not a package this editor knows. It is kept as written and loads only if the game's host supplies it; otherwise the game reports plugin.unresolved.`);
    }
  }
  return issues;
}

/** A disclosure about the file: a legacy value the editor would not offer, a row this version does not store, data kept unchanged. */
export interface SettingsNote {
  readonly key: MainSettingKey | null;
  readonly message: string;
}

/** Where a package the game starts with comes from (the effective plugin list and its owning rows). */
export interface PluginSource {
  /** The package the engine appends, or `null` when the row loads nothing. */
  readonly package: string | null;
  /** The row or block that owns it, in words. */
  readonly owner: string;
  readonly detail: string;
}

/** The packages the engine appends to its default manifest for this file, in order, with the row that names each (E-02 step 3). */
export function pluginSources(model: MainFile): PluginSource[] {
  const sources: PluginSource[] = [];
  const named = new Set<string>();
  for (const name of model.packagePlugins ?? []) {
    const id = foldNamespace(name);
    if (id === "" || named.has(id)) continue;
    named.add(id);
    sources.push({ package: id, owner: "the TKR package list", detail: KNOWN_PACKAGES[id] ?? "Not a package this editor knows; it loads only if the host supplies it." });
  }
  for (const row of mainFileLegacyPluginRows(model)) {
    const owner = row.field === "plugins" ? `command plugin slot ${row.index + 1} ("${row.file}")` : `the legacy ${row.field === "menuPlugin" ? "menu" : "battle"} plugin row ("${row.file}")`;
    if (row.package === null) {
      sources.push({ package: null, owner, detail: "A Windows plugin the player cannot load. The name is kept as data and the game reports plugin.legacy-unmapped." });
      continue;
    }
    if (named.has(row.package)) continue;
    named.add(row.package);
    sources.push({ package: row.package, owner, detail: "Mapped to the stock package when the game starts; the file keeps the legacy name and the editor does not rewrite it." });
  }
  return sources;
}

/** What the editor discloses about `model`: unsupported legacy values, rows its version does not store, data kept unchanged. */
export function mainSettingsNotes(model: MainFile): SettingsNote[] {
  const notes: SettingsNote[] = [];
  const minor = model.minor;
  const unstored = MAIN_SETTING_KEYS.filter((key) => !settingStored(key, minor));
  if (unstored.length > 0) {
    notes.push({
      key: null,
      message: `This file is minor ${minor}. It does not store ${unstored.map((key) => MAIN_SETTINGS[key].label.toLowerCase()).join(", ")}; those are shown with the value the engine uses for a file of this version and cannot be changed here, because the editor always saves a file at the version it was opened at.`,
    });
  }
  const offered = (key: MainSettingKey, value: number): void => {
    const choices = MAIN_SETTINGS[key].choices;
    if (settingStored(key, minor) && choices !== undefined && !choices.some((choice) => choice.value === value)) {
      notes.push({ key, message: `${MAIN_SETTINGS[key].label} is stored as ${value}, a value the editor does not offer. It is kept unless you choose another.` });
    }
  };
  offered("pixelMovement", model.pixelMovement);
  offered("colorDepth", model.colorDepth);
  offered("fightType", model.fightType);
  offered("resolution", model.resolution);
  if (minor >= 9) offered("pathfindHeuristic", model.pathfindHeuristic);
  if (settingStored("gameSpeed", minor) && (model.gameSpeed < -4 || model.gameSpeed > 4)) {
    notes.push({ key: "gameSpeed", message: `Game speed is stored as ${model.gameSpeed}, outside the −4 to +4 the editor offers. It is kept unless you change it.` });
  }
  if (minor >= 9) {
    model.movementScanCodes.forEach((code, slot) => {
      if (code !== 0 && keyOfScanCode(code) === null) {
        notes.push({ key: "movementScanCodes", message: `${MOVEMENT_DIRECTION_LABELS[slot]} is bound to DirectInput scan code 0x${code.toString(16)}, which names no physical key; the player leaves it unbound (input.unsupported-scan-code).` });
      }
    });
  }
  if (model.fightingDisabled !== 0 && model.fightingDisabled !== 1) {
    notes.push({ key: "battlesEnabled", message: `Random battles are off, stored as ${model.fightingDisabled}; the value is kept unless you turn battles on.` });
  }
  if (minor < 3) {
    notes.push({ key: "commandPlugins", message: "This file stores command plugins as on/off flags for tkplug<n>.dll, and the menu and battle plugins as the defaults tk3menu.dll and tk3fight.dll; they are shown read-only." });
  }
  if (model.residue.length > 0) {
    notes.push({ key: null, message: `The file has ${model.residue.length} bytes after the last block this editor reads (data from a newer tool, such as another Reawakened block). They are kept byte for byte.` });
  }
  notes.push({ key: "useJoystick", message: "The legacy joystick row is separate from the TKR input-settings block. This editor does not yet read or edit native action bindings, controller enablement or locked actions; any such block is kept as opaque data." });
  notes.push({ key: null, message: "Stored-only fields (the display API choice, the language file, the skins and the day/night settings) are not edited here and are kept as they are." });
  return notes;
}
