/**
 * The native scene (docs/spec/formats/native-scene.md): the typed model, the reader, the writer,
 * the model check and the in-place edit.
 *
 * Reference reader, writer and editor for contract `scene`, version `1.0.0-pre.1`. It follows the
 * conventions of the animation clip, the tileset and the asset pack (`clip.ts`, `tileset.ts`,
 * `asset-pack.ts`): results are `{ ok, ... }` values, problems are located and never repaired, a
 * document that holds a plugin block is only ever written back from its own source, and an edit
 * is a list of splices into the original text (G2: nothing but text in memory is touched). The
 * contract page is a draft pending the owner's approval; this module implements it as written and
 * records no approval.
 *
 * Besides problems (errors), the reader reports **findings**: the warnings and notes the contract
 * names (a `layer` that a floor could name, a light whose node count does not fit its type, a
 * shade channel outside -255 to 255 carried as stored). A finding never refuses a document.
 *
 * What this module cannot judge is whatever needs the project: whether a native tile or a pack
 * asset resolves (V15, V16), whether a legacy file exists (V17), whether the text fits the board's
 * code page (V18) and whether the scene lies under `Boards/` (V21). {@link sceneNativeReferences}
 * gives a project checker the native references to resolve.
 */

import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, Scalar, visit, type Node, type YAMLMap } from "yaml";
import { formatClipPath, formatClipProblems, type ClipJson, type ClipPath, type ClipProblem } from "./clip.ts";
import { readDocument } from "./document.ts";
import { validatePluginData } from "./plugin-data.ts";
import { extensionOf, lookupExtension, REGISTRY } from "./registry.ts";
import { applySplices, rangeOf, scalarText, type Splice } from "./splice.ts";
import { parseVersion } from "./version.ts";

export const SCENE_CONTRACT = "scene";
export const SCENE_VERSION = "1.0.0-pre.1";

// ---------------------------------------------------------------- model

export type SceneProjection = "2d" | "iso-stacked" | "iso-rotated";

/** `[x, y]`, whole numbers in board pixels. */
export type ScenePoint = readonly [x: number, y: number];

/** `[red, green, blue]`, each 0 to 255. */
export type SceneColour = readonly [red: number, green: number, blue: number];

/** `[red, green, blue]`, each a signed whole number (an i16), carried exactly as stored. */
export type SceneOffset = readonly [red: number, green: number, blue: number];

/** `[count, index]`: `count` consecutive cells that show palette entry `index`. */
export type SceneRun = readonly [count: number, index: number];

/** `[count, red, green, blue]`: `count` consecutive cells that have one tint. */
export type SceneShadeRun = readonly [count: number, red: number, green: number, blue: number];

/** A legacy tile reference, carried exactly as stored (`village.tst12`, `water.tan`). */
export type SceneLegacyTile = { readonly legacy: string; readonly tileset?: never; readonly tile?: never };

/** A tile of a native tileset: the path of the `.tkrtst` and the tile's local id. */
export type SceneNativeTile = { readonly tileset: string; readonly tile: string; readonly legacy?: never };

/** An empty palette slot, `{}`: it keeps later indices where they were. */
export type SceneEmptyTile = { readonly legacy?: never; readonly tileset?: never; readonly tile?: never };

export type SceneTileReference = SceneLegacyTile | SceneNativeTile;
export type ScenePaletteEntry = SceneEmptyTile | SceneLegacyTile | SceneNativeTile;

/** The layer a record sits on: the id of a floor of this document, or a layer number no floor has. */
export type SceneLayerRef = { readonly floor: string; readonly layer?: never } | { readonly layer: number; readonly floor?: never };

export type SceneConditionMode = "always" | "conditional";
export type SceneCondition = { readonly mode?: SceneConditionMode; readonly variable?: string; readonly value?: string };
export type SceneVariableValue = { readonly variable?: string; readonly value?: string };
export type SceneImageType = "normal" | "parallax" | "stretch";

export type SceneBoundarySources = {
  readonly walkableTiles?: readonly SceneTileReference[];
  readonly autoWallCaps?: boolean;
};

export type SceneFloor = {
  readonly id: string;
  readonly title?: string;
  readonly tiles?: readonly SceneRun[];
  readonly boundarySources?: SceneBoundarySources;
};

export type SceneShading = SceneLayerRef & {
  readonly id?: string;
  readonly cells: readonly SceneShadeRun[];
  readonly legacy?: { readonly excessCells?: SceneShadeRun };
};

export type SceneLightType = "ellipse" | "gradient" | "clipped-gradient";

export type SceneLight = SceneLayerRef & {
  readonly id?: string;
  readonly type: SceneLightType;
  readonly nodes: readonly ScenePoint[];
  readonly colors: readonly SceneOffset[];
};

export type SceneVectorType = "none" | "solid" | "under" | "unidirectional" | "stairs" | "waypoint";

export type SceneVector = SceneLayerRef & {
  readonly id?: string;
  readonly label?: string;
  readonly type: SceneVectorType;
  readonly closed: boolean;
  readonly points: readonly ScenePoint[];
  readonly handle?: string;
  readonly attributes?: number;
  readonly toFloor?: string;
  readonly toLayer?: number;
};

export type SceneTrigger = SceneLayerRef & {
  readonly id?: string;
  readonly program?: string;
  readonly condition?: SceneCondition;
  readonly afterRun?: SceneVariableValue;
  readonly activation?: {
    readonly keyPress?: boolean;
    readonly repeat?: boolean;
    readonly stopsMovement?: boolean;
    readonly repeatDistance?: number;
  };
  readonly points?: readonly ScenePoint[];
  readonly closed?: boolean;
  readonly legacy?: { readonly graphic?: string; readonly reserved?: string };
};

export type SceneItem = SceneLayerRef & {
  readonly id?: string;
  readonly item?: string;
  readonly x: number;
  readonly y: number;
  readonly activationProgram?: string;
  readonly multitaskProgram?: string;
  readonly condition?: SceneCondition;
  readonly afterRun?: SceneVariableValue;
  readonly loadCondition?: SceneVariableValue;
  readonly activation?: { readonly keyPress?: boolean; readonly repeat?: boolean };
  readonly legacy?: { readonly reserved?: number };
};

export type SceneImage = SceneLayerRef & {
  readonly id?: string;
  readonly source?: string;
  readonly x: number;
  readonly y: number;
  readonly type?: SceneImageType;
  readonly transparent: SceneColour;
  readonly legacy?: { readonly reserved?: number };
};

export type ScenePlacedPack = {
  readonly instanceId: string;
  readonly pack: string;
  readonly asset: string;
  readonly floor: string;
  readonly x: number;
  readonly y: number;
};

export type SceneAtmosphere = {
  readonly ambient?: SceneOffset;
  readonly music?: string;
  readonly background?: { readonly image?: string; readonly type?: SceneImageType; readonly color?: SceneColour };
};

export type SceneStart = { readonly x?: number; readonly y?: number } & (SceneLayerRef | { readonly floor?: never; readonly layer?: never });

export type SceneLinks = { readonly north?: string; readonly south?: string; readonly east?: string; readonly west?: string };
export type SceneBattle = { readonly background?: string; readonly skill?: number; readonly allowed?: boolean };

/** Data the board holds that the model has no other place for; a closed block, written by an import. */
export type SceneLegacy = {
  readonly layerTitleZero?: string;
  /** Standard padded base64 (RFC 4648). */
  readonly trailingBytes?: string;
  readonly excessTiles?: SceneRun;
};

export type SceneJson = ClipJson;

export type Scene = {
  readonly contract: typeof SCENE_CONTRACT;
  /** The stamp's version as written, with any `+build` suffix. */
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: SceneJson };
  readonly name?: string;
  readonly projection: SceneProjection;
  readonly pixelCoordinates?: boolean;
  readonly size: { readonly width: number; readonly height: number };
  readonly floors: readonly SceneFloor[];
  readonly tilePalette?: readonly ScenePaletteEntry[];
  readonly shading?: readonly SceneShading[];
  readonly lights?: readonly SceneLight[];
  readonly vectors?: readonly SceneVector[];
  readonly triggers?: readonly SceneTrigger[];
  readonly items?: readonly SceneItem[];
  readonly images?: readonly SceneImage[];
  readonly placedPacks?: readonly ScenePlacedPack[];
  readonly atmosphere?: SceneAtmosphere;
  readonly start?: SceneStart;
  readonly links?: SceneLinks;
  readonly enterProgram?: string;
  readonly battle?: SceneBattle;
  readonly savingDisabled?: boolean;
  readonly threads?: readonly string[];
  readonly constants?: readonly string[];
  readonly legacy?: SceneLegacy;
  /** Exact source from `pluginData` onward, used only to verify opaque block preservation. */
  readonly pluginSource?: string;
  /** Opaque plugin envelopes; never regenerated from these parsed values. */
  readonly pluginData?: {
    readonly [pluginId: string]: {
      readonly version: string;
      readonly data: { readonly [key: string]: SceneJson };
    };
  };
};

/** Why a document, model or edit is refused; the shape is the clip's (`ClipProblem`). */
export type SceneProblem = ClipProblem;

export type ScenePath = ClipPath;

/** A warning or a note the contract names: written and reported, never a refusal. */
export type SceneFinding = {
  readonly severity: "warning" | "note";
  /** Where, for example `vectors[2].layer`. */
  readonly path: string;
  readonly message: string;
  /** 1-based line in the text, or `null` when there is none. */
  readonly line: number | null;
};

export type SceneReadResult =
  | { readonly ok: true; readonly scene: Scene; readonly source: string; readonly findings: readonly SceneFinding[] }
  | { readonly ok: false; readonly problems: readonly SceneProblem[] };

export type SceneWriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly SceneProblem[] };

export const formatScenePath = formatClipPath;
export const formatSceneProblems = formatClipProblems;

// ---------------------------------------------------------------- the shape of the contract

/**
 * What a mapping of the contract holds, in the contract's key order: the one table the checker's
 * closed-key rule, the writer's key order and its one-line mappings, and the editor's placement
 * of a new key all read.
 */
type Shape = {
  readonly keys: readonly string[];
  /** Keys whose value is a mapping with a shape of its own. */
  readonly maps?: { readonly [key: string]: Shape };
  /** Keys whose value is a list of mappings with a shape of their own. */
  readonly lists?: { readonly [key: string]: Shape };
  /** Written on one line (`{a: 1, b: 2}`) by a writer that creates a document. */
  readonly flow?: boolean;
};

const SIZE: Shape = { keys: ["width", "height"], flow: true };
const TILE_REF: Shape = { keys: ["legacy", "tileset", "tile"], flow: true };
const BOUNDARY: Shape = { keys: ["walkableTiles", "autoWallCaps"], lists: { walkableTiles: TILE_REF } };
const FLOOR: Shape = { keys: ["id", "title", "tiles", "boundarySources"], maps: { boundarySources: BOUNDARY } };
const CONDITION: Shape = { keys: ["mode", "variable", "value"], flow: true };
const VARIABLE_VALUE: Shape = { keys: ["variable", "value"], flow: true };
const TRIGGER_ACTIVATION: Shape = { keys: ["keyPress", "repeat", "stopsMovement", "repeatDistance"], flow: true };
const ITEM_ACTIVATION: Shape = { keys: ["keyPress", "repeat"], flow: true };
const SHADING: Shape = {
  keys: ["id", "floor", "layer", "cells", "legacy"],
  maps: { legacy: { keys: ["excessCells"], flow: true } },
};
const LIGHT: Shape = { keys: ["id", "floor", "layer", "type", "nodes", "colors"] };
const VECTOR: Shape = { keys: ["id", "label", "floor", "layer", "type", "closed", "points", "handle", "attributes", "toFloor", "toLayer"] };
const TRIGGER: Shape = {
  keys: ["id", "floor", "layer", "program", "condition", "afterRun", "activation", "points", "closed", "legacy"],
  maps: {
    condition: CONDITION,
    afterRun: VARIABLE_VALUE,
    activation: TRIGGER_ACTIVATION,
    legacy: { keys: ["graphic", "reserved"], flow: true },
  },
};
const ITEM: Shape = {
  keys: ["id", "floor", "layer", "item", "x", "y", "activationProgram", "multitaskProgram", "condition", "afterRun", "loadCondition", "activation", "legacy"],
  maps: {
    condition: CONDITION,
    afterRun: VARIABLE_VALUE,
    loadCondition: VARIABLE_VALUE,
    activation: ITEM_ACTIVATION,
    legacy: { keys: ["reserved"], flow: true },
  },
};
const IMAGE: Shape = {
  keys: ["id", "floor", "layer", "source", "x", "y", "type", "transparent", "legacy"],
  maps: { legacy: { keys: ["reserved"], flow: true } },
};
const PLACED_PACK: Shape = { keys: ["instanceId", "pack", "asset", "floor", "x", "y"] };
const ATMOSPHERE: Shape = {
  keys: ["ambient", "music", "background"],
  maps: { background: { keys: ["image", "type", "color"] } },
};
const START: Shape = { keys: ["x", "y", "floor", "layer"], flow: true };
const LINKS: Shape = { keys: ["north", "south", "east", "west"], flow: true };
const BATTLE: Shape = { keys: ["background", "skill", "allowed"], flow: true };
const LEGACY: Shape = { keys: ["layerTitleZero", "trailingBytes", "excessTiles"], flow: true };

const ROOT: Shape = {
  keys: [
    "contract",
    "version",
    "tags",
    "metadata",
    "name",
    "projection",
    "pixelCoordinates",
    "size",
    "floors",
    "tilePalette",
    "shading",
    "lights",
    "vectors",
    "triggers",
    "items",
    "images",
    "placedPacks",
    "atmosphere",
    "start",
    "links",
    "enterProgram",
    "battle",
    "savingDisabled",
    "threads",
    "constants",
    "legacy",
    "pluginData",
  ],
  maps: { size: SIZE, atmosphere: ATMOSPHERE, start: START, links: LINKS, battle: BATTLE, legacy: LEGACY },
  lists: {
    floors: FLOOR,
    tilePalette: TILE_REF,
    shading: SHADING,
    lights: LIGHT,
    vectors: VECTOR,
    triggers: TRIGGER,
    items: ITEM,
    images: IMAGE,
    placedPacks: PLACED_PACK,
  },
};

const ROOT_KEYS = ROOT.keys;

/** The mapping a path ending at a mapping names, or `null` when the path names no mapping of the contract. */
function shapeOf(path: ClipPath): Shape | null {
  let shape = ROOT;
  let at = 0;
  while (at < path.length) {
    const key = path[at];
    if (typeof key !== "string") return null;
    const map = shape.maps?.[key];
    const list = shape.lists?.[key];
    if (map !== undefined) {
      shape = map;
      at += 1;
    } else if (list !== undefined) {
      if (typeof path[at + 1] !== "number") return null;
      shape = list;
      at += 2;
    } else return null;
  }
  return shape;
}

// ---------------------------------------------------------------- validation

type Raw = { readonly path: ClipPath; readonly message: string; readonly severity?: "warning" | "note" };

/** `lowercase-kebab-case`, the shared authoring convention for local ids. */
const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Standard padded base64 (RFC 4648). */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const PROJECTIONS: readonly string[] = ["2d", "iso-stacked", "iso-rotated"];
const LIGHT_TYPES: readonly string[] = ["ellipse", "gradient", "clipped-gradient"];
const VECTOR_TYPES: readonly string[] = ["none", "solid", "under", "unidirectional", "stairs", "waypoint"];
const IMAGE_TYPES: readonly string[] = ["normal", "parallax", "stretch"];
const CONDITION_MODES: readonly string[] = ["always", "conditional"];

type Range = readonly [min: number, max: number];
const I16: Range = [-32768, 32767];
const I32: Range = [-2147483648, 2147483647];
const BYTE: Range = [0, 255];
const COUNT: Range = [1, Number.POSITIVE_INFINITY];
const TILE_INDEX: Range = [0, 32767];

/** The board's size limits: cells over all floors, and the number of floors. */
const MAX_CELLS = 4_194_304;
const MAX_FLOORS = 32767;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a mapping";
  if (typeof value === "string") return "text";
  return typeof value === "number" ? `the number ${value}` : `a ${typeof value}`;
}

/** The contract allows no `null`: an absent value is written by leaving the key out. */
function wrongType(path: ClipPath, wanted: string, value: unknown, out: Raw[]): void {
  const extra = value === null || value === undefined ? `; it is ${describe(value)}, and no key accepts that: leave the key out` : `; it is ${describe(value)}`;
  out.push({ path, message: `must be ${wanted}${extra}` });
}

function checkKeys(value: Record<string, unknown>, shape: Shape, path: ClipPath, owner: string, out: Raw[]): void {
  for (const key of Object.keys(value)) {
    if (!shape.keys.includes(key)) out.push({ path: [...path, key], message: `\`${key}\` is not a key of ${owner}; the contract is closed` });
  }
}

function required(value: Record<string, unknown>, key: string, path: ClipPath, out: Raw[]): boolean {
  if (Object.hasOwn(value, key)) return true;
  out.push({ path, message: `\`${key}\` is required` });
  return false;
}

const isWhole = (value: unknown, [min, max]: Range): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function rangeWords([min, max]: Range): string {
  if (max === Number.POSITIVE_INFINITY) return min === 0 ? "zero or more" : `at least ${min}`;
  return `from ${min} to ${max}`;
}

function checkWhole(value: unknown, path: ClipPath, range: Range, out: Raw[]): void {
  if (!isWhole(value, range)) wrongType(path, `a whole number, ${rangeWords(range)}`, value, out);
}

/** A fixed-length list of whole numbers, each in its own range; the numbers when it is exactly that, else `null`. */
function checkTuple(value: unknown, path: ClipPath, ranges: readonly Range[], wanted: string, out: Raw[]): number[] | null {
  if (!Array.isArray(value) || value.length !== ranges.length) {
    wrongType(path, wanted, value, out);
    return null;
  }
  let fine = true;
  value.forEach((part: unknown, index) => {
    if (!isWhole(part, ranges[index]!)) {
      checkWhole(part, [...path, index], ranges[index]!, out);
      fine = false;
    }
  });
  return fine ? (value as number[]) : null;
}

/** A keyed text is never empty: the empty string is written by leaving the key out. */
function checkText(value: unknown, path: ClipPath, what: string, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, `text: ${what}`, value, out);
  if (value === "") out.push({ path, message: "is empty text, which is not accepted here: an empty value is written by leaving the key out" });
}

function checkEnum(value: unknown, path: ClipPath, allowed: readonly string[], out: Raw[]): void {
  if (typeof value === "string" && allowed.includes(value)) return;
  wrongType(path, `one of ${allowed.map((word) => `\`${word}\``).join(", ")}`, value, out);
}

function checkBool(value: unknown, path: ClipPath, out: Raw[]): void {
  if (typeof value !== "boolean") wrongType(path, "`true` or `false`", value, out);
}

/** The reason `value` is not a project-relative `/` path to a file, or `null` when it is one. */
function pathProblem(value: string): string | null {
  if (value === "") return "is empty text";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "must be one line without control characters";
  if (value.trim() !== value) return "must have no space at either end";
  if (value.includes("\\")) return "must use `/` as the separator; `\\` is not one";
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return "must be relative to the project root, not absolute";
  const parts = value.split("/");
  if (parts.includes("..")) return "must not contain a `..` part, which is not resolved";
  if (value.endsWith("/")) return "names a folder, not a file";
  if (parts.every((part) => part === "" || part === ".")) return "names no file";
  return null;
}

/** A native document path: a project-relative `/` path whose extension is the one of `contract`. */
function checkDocumentPath(value: unknown, path: ClipPath, contract: string, what: string, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, `text: ${what}`, value, out);
  const problem = pathProblem(value);
  if (problem !== null) {
    out.push({ path, message: `${problem} (a project-relative \`/\` path)` });
    return;
  }
  const extension = extensionOf(value);
  const entry = extension === null ? undefined : lookupExtension(extension);
  if (entry?.contract !== contract) {
    const wanted = REGISTRY.find((row) => row.contract === contract)?.extension ?? contract;
    out.push({ path, message: `must name ${what}, a document with the extension \`${wanted}\`` });
  }
}

/** A local id used as a reference or name only: the grammar, with no uniqueness. */
function checkLocalName(value: unknown, path: ClipPath, what: string, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, `text: ${what}`, value, out);
  if (!LOCAL_ID.test(value)) out.push({ path, message: `\`${value}\` is not a lowercase kebab-case id (letters a to z and digits, joined by single hyphens)` });
}

/** Checks a local id and records it in `seen`; a repeated id names the entry that has it. */
function checkLocalId(value: unknown, path: ClipPath, listName: string, seen: Map<string, number>, index: number, out: Raw[]): string | null {
  if (typeof value !== "string") {
    wrongType(path, "text: a lowercase kebab-case id", value, out);
    return null;
  }
  if (!LOCAL_ID.test(value)) {
    out.push({ path, message: `\`${value}\` is not a lowercase kebab-case id (letters a to z and digits, joined by single hyphens)` });
    return null;
  }
  const first = seen.get(value);
  if (first !== undefined) {
    out.push({ path, message: `\`${value}\` is already the id of ${listName}[${first}]; ids are unique within their list` });
    return null;
  }
  seen.set(value, index);
  return value;
}

/** Whether `value` is something the free-form `metadata` may hold. */
function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (!isObject(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.values(value).every(isJson);
}

/** What the checks that cross fields need to know about the document. */
type Env = {
  /** The cells of the effective grid, when the projection and the size are sound. */
  cells: number | null;
  /** `[width, height]`, when the size is sound. */
  size: readonly [number, number] | null;
  projection: string | null;
  floorCount: number | null;
  /** The floor ids in order, when every id is sound; `null` skips every check against the floors. */
  floorIds: readonly string[] | null;
  /** The palette length, `0` for no palette, or `null` when the palette cannot be used. */
  paletteSize: number | null;
  /** The palette index of the last cell of the last floor, when known. */
  lastTileIndex: number | null;
};

/** The cells of one floor of a board: the effective grid of the projection. */
function effectiveCells(projection: string, width: number, height: number): number {
  return projection === "iso-rotated" ? (width + height) * (width + height) : width * height;
}

/** The grid in words for a message: its two sides and its cells. */
function gridWords(env: Env): string {
  const [width, height] = env.size!;
  return env.projection === "iso-rotated"
    ? `${width + height} by ${width + height} (a rotated isometric board of ${width} by ${height} stores ${width + height} by ${width + height}), ${env.cells} cells`
    : `${width} by ${height}, ${env.cells} cells`;
}

const POINT_WANTED = "a point: a list of two whole numbers, [x, y]";
const COLOUR_WANTED = "a colour: a list of three whole numbers from 0 to 255, [r, g, b]";
const OFFSET_WANTED = "a signed offset: a list of three whole numbers, [r, g, b]";

function checkPoints(value: unknown, path: ClipPath, least: number, out: Raw[]): readonly unknown[] | null {
  if (!Array.isArray(value)) {
    wrongType(path, `a list of points, [x, y]${least > 0 ? `, at least ${least}` : ""}`, value, out);
    return null;
  }
  if (value.length < least) out.push({ path, message: `must have at least ${least} points; it has ${value.length}` });
  value.forEach((point: unknown, index) => checkTuple(point, [...path, index], [I32, I32], POINT_WANTED, out));
  return value;
}

function checkColour(value: unknown, path: ClipPath, out: Raw[]): void {
  checkTuple(value, path, [BYTE, BYTE, BYTE], COLOUR_WANTED, out);
}

/** A signed offset: i16 channels, carried as stored; one outside -255 to 255 is a note, never a refusal. */
function checkOffset(value: unknown, path: ClipPath, out: Raw[]): void {
  const channels = checkTuple(value, path, [I16, I16, I16], OFFSET_WANTED, out);
  channels?.forEach((channel, index) => noteChannel(channel, [...path, index], out));
}

function noteChannel(channel: number, path: ClipPath, out: Raw[]): void {
  if (channel < -255 || channel > 255) {
    out.push({ path, severity: "note", message: `${channel} is outside -255 to 255; it is carried exactly as stored and the shading arithmetic clamps it` });
  }
}

function checkFloorName(value: unknown, path: ClipPath, env: Env, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, "text: the id of a floor of this document", value, out);
  if (env.floorIds !== null && !env.floorIds.includes(value)) out.push({ path, message: `\`${value}\` names no floor of this document` });
}

type LayerKeys = {
  readonly floor: string;
  readonly layer: string;
  /** The range of the layer number; its lower end is a floor, not a board, so `start` raises it to 1. */
  readonly range: Range;
  /** The record may have neither key (`start`). */
  readonly optional?: boolean;
};

const LAYER_I16: LayerKeys = { floor: "floor", layer: "layer", range: I16 };
const LAYER_I32: LayerKeys = { floor: "floor", layer: "layer", range: I32 };
const LAYER_START: LayerKeys = { floor: "floor", layer: "layer", range: [1, 32767], optional: true };
const LAYER_STAIRS: LayerKeys = { floor: "toFloor", layer: "toLayer", range: I16 };

/** Exactly one of `floor` and `layer`; a `layer` that a floor of this document has is a warning. */
function checkLayerRef(record: Record<string, unknown>, path: ClipPath, keys: LayerKeys, env: Env, out: Raw[]): void {
  const hasFloor = Object.hasOwn(record, keys.floor);
  const hasLayer = Object.hasOwn(record, keys.layer);
  if (hasFloor && hasLayer) out.push({ path, message: `has both \`${keys.floor}\` and \`${keys.layer}\`; give exactly one` });
  if (!hasFloor && !hasLayer) {
    if (keys.optional !== true) out.push({ path, message: `needs \`${keys.floor}\` (the id of a floor) or \`${keys.layer}\` (a layer number no floor has); it has neither` });
    return;
  }
  if (hasFloor) checkFloorName(record[keys.floor], [...path, keys.floor], env, out);
  if (hasLayer) {
    const layer = record[keys.layer];
    checkWhole(layer, [...path, keys.layer], keys.range, out);
    if (isWhole(layer, keys.range) && env.floorCount !== null && layer >= 1 && layer <= env.floorCount) {
      const named = env.floorIds === null ? "" : `, floor \`${env.floorIds[layer - 1]}\``;
      out.push({
        path: [...path, keys.layer],
        severity: "warning",
        message: `${layer} is a layer of this board${named}; write \`${keys.floor}\` with the floor's id, which survives a floor being added, removed or reordered (\`${keys.layer}\` is for a layer no floor has)`,
      });
    }
  }
}

/** A mapping with its closed keys checked; `null` (after a problem) when `value` is not a mapping. */
function checkMapping(value: unknown, path: ClipPath, shape: Shape, owner: string, out: Raw[]): Record<string, unknown> | null {
  if (!isObject(value)) {
    wrongType(path, `${owner}: a mapping`, value, out);
    return null;
  }
  checkKeys(value, shape, path, owner, out);
  return value;
}

function checkCondition(value: unknown, path: ClipPath, out: Raw[]): void {
  const condition = checkMapping(value, path, CONDITION, "a condition", out);
  if (condition === null) return;
  if (Object.hasOwn(condition, "mode")) checkEnum(condition.mode, [...path, "mode"], CONDITION_MODES, out);
  if (Object.hasOwn(condition, "variable")) checkText(condition.variable, [...path, "variable"], "a variable name", out);
  if (Object.hasOwn(condition, "value")) checkText(condition.value, [...path, "value"], "the value it is compared with", out);
}

function checkVariableValue(value: unknown, path: ClipPath, owner: string, out: Raw[]): void {
  const pair = checkMapping(value, path, VARIABLE_VALUE, owner, out);
  if (pair === null) return;
  if (Object.hasOwn(pair, "variable")) checkText(pair.variable, [...path, "variable"], "a variable name", out);
  if (Object.hasOwn(pair, "value")) checkText(pair.value, [...path, "value"], "a value", out);
}

function checkActivation(value: unknown, path: ClipPath, shape: Shape, out: Raw[]): void {
  const activation = checkMapping(value, path, shape, "an activation", out);
  if (activation === null) return;
  for (const flag of ["keyPress", "repeat", "stopsMovement"]) {
    if (shape.keys.includes(flag) && Object.hasOwn(activation, flag)) checkBool(activation[flag], [...path, flag], out);
  }
  if (shape.keys.includes("repeatDistance") && Object.hasOwn(activation, "repeatDistance")) checkWhole(activation.repeatDistance, [...path, "repeatDistance"], I16, out);
}

/** A list of mappings: each has its closed keys and its optional `idKey` checked; `body` does the rest. */
function checkRecords(
  value: unknown,
  listName: string,
  shape: Shape,
  owner: string,
  idKey: string,
  out: Raw[],
  body: (record: Record<string, unknown>, path: ClipPath, index: number) => void,
): void {
  if (!Array.isArray(value)) return wrongType([listName], `a list of ${owner.replace(/^an? /, "")}s`, value, out);
  const seen = new Map<string, number>();
  value.forEach((record: unknown, index) => {
    const path: ClipPath = [listName, index];
    const mapping = checkMapping(record, path, shape, owner, out);
    if (mapping === null) return;
    if (idKey === "instanceId") {
      if (required(mapping, idKey, path, out)) checkLocalId(mapping[idKey], [...path, idKey], listName, seen, index, out);
    } else if (Object.hasOwn(mapping, idKey)) checkLocalId(mapping[idKey], [...path, idKey], listName, seen, index, out);
    body(mapping, path, index);
  });
}

// ---- the tile references and the palette

const TILE_WANTED = "a tile reference: `{legacy: <text>}` or `{tileset: <path of a .tkrtst>, tile: <local tile id>}`";

/** A native or legacy tile reference; an empty `{}` is accepted only where `allowEmpty` (a palette slot). */
function checkTileReference(value: unknown, path: ClipPath, allowEmpty: boolean, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, allowEmpty ? `${TILE_WANTED}, or \`{}\` for an empty slot` : TILE_WANTED, value, out);
  checkKeys(value, TILE_REF, path, "a tile reference", out);
  const hasLegacy = Object.hasOwn(value, "legacy");
  const hasNative = Object.hasOwn(value, "tileset") || Object.hasOwn(value, "tile");
  if (hasLegacy && hasNative) {
    out.push({ path, message: "mixes `legacy` with `tileset` and `tile`; a tile reference is a legacy tile or a native tile, not both" });
  } else if (hasLegacy) {
    checkText(value.legacy, [...path, "legacy"], "a legacy tile reference, as stored (for example `village.tst12`)", out);
  } else if (hasNative) {
    if (required(value, "tileset", path, out)) checkDocumentPath(value.tileset, [...path, "tileset"], "tileset", "the path of a tileset document", out);
    if (required(value, "tile", path, out)) checkLocalName(value.tile, [...path, "tile"], "the local id of a tile of that tileset", out);
  } else if (Object.keys(value).length === 0 && !allowEmpty) {
    out.push({ path, message: `is an empty mapping, which is not a tile here; name ${TILE_WANTED}` });
  }
}

/** Returns the palette length, `0` for an absent palette, or `null` when the palette cannot be used. */
function checkPalette(value: Record<string, unknown>, out: Raw[]): number | null {
  if (!Object.hasOwn(value, "tilePalette")) return 0;
  const palette = value.tilePalette;
  if (!Array.isArray(palette)) {
    wrongType(["tilePalette"], "a list of tile references and empty slots", palette, out);
    return null;
  }
  if (palette.length === 0) {
    out.push({ path: ["tilePalette"], message: "has no position 0; a palette always starts with `{}` (no tile), and a board with no table leaves the key out" });
  }
  palette.forEach((entry: unknown, index) => {
    checkTileReference(entry, ["tilePalette", index], true, out);
    if (index === 0 && isObject(entry) && Object.keys(entry).length > 0) {
      out.push({ path: ["tilePalette", 0], message: "must be `{}`: palette index 0 is always no tile" });
    }
  });
  return palette.length;
}

// ---- the cells

/** The runs of one floor: the sum of the counts and the index of the last cell, or `null` when a run is unsound. */
function checkTiles(value: unknown, path: ClipPath, env: Env, out: Raw[]): { readonly sum: number; readonly last: number } | null {
  if (!Array.isArray(value)) {
    wrongType(path, "a list of runs, [count, index]", value, out);
    return null;
  }
  const limit = env.paletteSize === null ? TILE_INDEX[1] : Math.max(env.paletteSize, 1) - 1;
  let sum = 0;
  let last = 0;
  let fine = true;
  value.forEach((run: unknown, index) => {
    const parts = checkTuple(run, [...path, index], [COUNT, TILE_INDEX], "a run: a list of two whole numbers, [count, index], with a count of at least 1 and an index from 0 to 32767", out);
    if (parts === null) {
      fine = false;
      return;
    }
    const [count, tile] = parts as [number, number];
    sum += count;
    last = tile;
    if (env.paletteSize !== null && tile > limit) {
      fine = false;
      out.push({
        path: [...path, index, 1],
        message: env.paletteSize === 0 ? `is ${tile}, but the scene has no \`tilePalette\`, so every index must be 0` : `is ${tile}, but the palette has positions 0 to ${limit}`,
      });
    }
  });
  if (fine && env.cells !== null && sum !== env.cells) {
    out.push({ path, message: `covers ${sum} cells, but the board's grid has ${gridWords(env)}; the runs of a floor cover it exactly, once` });
  }
  return fine ? { sum, last } : null;
}

const SHADE_WANTED = "a run: a list of four whole numbers, [count, r, g, b], with a count of at least 1 and channels as 16-bit whole numbers";

function checkShadeRun(value: unknown, path: ClipPath, count: Range, out: Raw[]): number[] | null {
  const parts = checkTuple(value, path, [count, I16, I16, I16], SHADE_WANTED, out);
  parts?.slice(1).forEach((channel, index) => noteChannel(channel, [...path, index + 1], out));
  return parts;
}

function checkShadingLayer(record: Record<string, unknown>, path: ClipPath, env: Env, out: Raw[]): void {
  checkLayerRef(record, path, LAYER_I32, env, out);
  const tint: { last: number[] | null } = { last: null };
  if (required(record, "cells", path, out)) {
    const cells = record.cells;
    if (!Array.isArray(cells)) wrongType([...path, "cells"], "a list of runs, [count, r, g, b]", cells, out);
    else {
      let sum = 0;
      let fine = true;
      cells.forEach((run: unknown, index) => {
        const parts = checkShadeRun(run, [...path, "cells", index], COUNT, out);
        if (parts === null) fine = false;
        else {
          sum += parts[0]!;
          tint.last = parts.slice(1);
        }
      });
      if (fine && env.cells !== null && sum !== env.cells) {
        out.push({ path: [...path, "cells"], message: `covers ${sum} cells, but the board's grid has ${gridWords(env)}; a shading layer covers it exactly, once, with no layers` });
      }
      if (!fine) tint.last = null;
    }
  }
  if (Object.hasOwn(record, "legacy")) {
    const legacy = checkMapping(record.legacy, [...path, "legacy"], SHADING.maps!.legacy!, "a shading layer's legacy data", out);
    if (legacy !== null && Object.hasOwn(legacy, "excessCells")) {
      const excessPath = [...path, "legacy", "excessCells"];
      const parts = checkShadeRun(legacy.excessCells, excessPath, [1, 32766], out);
      const tail = tint.last;
      if (parts !== null && tail !== null && [1, 2, 3].some((at) => parts[at] !== tail[at - 1])) {
        out.push({ path: excessPath, message: `must continue the final record: its channels are [${tail.join(", ")}], the tint of the last cell of the grid; they are [${parts.slice(1).join(", ")}]` });
      }
    }
  }
}

// ---- the records

function checkFloors(value: unknown, env: Env, out: Raw[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    wrongType(["floors"], "a non-empty list of floors", value, out);
    return;
  }
  if (value.length > MAX_FLOORS) out.push({ path: ["floors"], message: `has ${value.length} floors; a board has at most ${MAX_FLOORS}` });
  env.floorCount = value.length;
  const seen = new Map<string, number>();
  const ids: string[] = [];
  let sound = true;
  value.forEach((floor: unknown, index) => {
    const path: ClipPath = ["floors", index];
    const mapping = checkMapping(floor, path, FLOOR, "a floor", out);
    if (mapping === null) {
      sound = false;
      return;
    }
    const id = required(mapping, "id", path, out) ? checkLocalId(mapping.id, [...path, "id"], "floors", seen, index, out) : null;
    if (id === null) sound = false;
    else ids.push(id);
    if (Object.hasOwn(mapping, "title")) checkText(mapping.title, [...path, "title"], "the layer title scripts read", out);
    let tail: number | null = 0;
    if (Object.hasOwn(mapping, "tiles")) tail = checkTiles(mapping.tiles, [...path, "tiles"], env, out)?.last ?? null;
    if (index === value.length - 1) env.lastTileIndex = tail;
    if (Object.hasOwn(mapping, "boundarySources")) {
      const sources = checkMapping(mapping.boundarySources, [...path, "boundarySources"], BOUNDARY, "a floor's boundary sources", out);
      if (sources !== null) {
        if (Object.hasOwn(sources, "walkableTiles")) {
          const tiles = sources.walkableTiles;
          const where = [...path, "boundarySources", "walkableTiles"];
          if (!Array.isArray(tiles) || tiles.length === 0) wrongType(where, "a non-empty list of tile references", tiles, out);
          else tiles.forEach((tile: unknown, at) => checkTileReference(tile, [...where, at], false, out));
        }
        if (Object.hasOwn(sources, "autoWallCaps")) checkBool(sources.autoWallCaps, [...path, "boundarySources", "autoWallCaps"], out);
      }
    }
  });
  if (sound) env.floorIds = ids;
}

function checkLights(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "lights", LIGHT, "a light", "id", out, (record, path) => {
    checkLayerRef(record, path, LAYER_I32, env, out);
    const type = record.type;
    if (required(record, "type", path, out)) checkEnum(type, [...path, "type"], LIGHT_TYPES, out);
    const nodes = required(record, "nodes", path, out) ? checkPoints(record.nodes, [...path, "nodes"], 0, out) : null;
    let colours: readonly unknown[] | null = null;
    if (required(record, "colors", path, out)) {
      if (!Array.isArray(record.colors)) wrongType([...path, "colors"], "a list of signed offsets, [r, g, b]", record.colors, out);
      else {
        colours = record.colors;
        record.colors.forEach((colour: unknown, index) => checkOffset(colour, [...path, "colors", index], out));
      }
    }
    if (nodes !== null && typeof type === "string") {
      const wanted = type === "ellipse" ? 3 : type === "gradient" ? 2 : null;
      if (wanted !== null && nodes.length !== wanted) {
        out.push({ path: [...path, "nodes"], severity: "warning", message: `has ${nodes.length} nodes; ${type === "ellipse" ? "an ellipse has 3 (the centre and two radius points)" : "a gradient has 2"}` });
      } else if (type === "clipped-gradient" && nodes.length < 2) {
        out.push({ path: [...path, "nodes"], severity: "warning", message: `has ${nodes.length} nodes; a clipped gradient has the gradient's 2 and then its clip shape` });
      }
    }
    if (colours !== null && colours.length < 2 && (type === "ellipse" || type === "gradient")) {
      out.push({ path: [...path, "colors"], severity: "warning", message: `has ${colours.length} colours; colour 0 is the edge or start and colour 1 the centre or end, so there are two` });
    }
  });
}

function checkVectors(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "vectors", VECTOR, "a vector", "id", out, (record, path) => {
    checkLayerRef(record, path, LAYER_I16, env, out);
    if (Object.hasOwn(record, "label")) checkText(record.label, [...path, "label"], "a human label for the editor", out);
    if (required(record, "type", path, out)) checkEnum(record.type, [...path, "type"], VECTOR_TYPES, out);
    if (required(record, "closed", path, out)) checkBool(record.closed, [...path, "closed"], out);
    if (required(record, "points", path, out)) checkPoints(record.points, [...path, "points"], 2, out);
    if (Object.hasOwn(record, "handle")) checkText(record.handle, [...path, "handle"], "the script-visible name", out);
    const type = record.type;
    if (Object.hasOwn(record, "attributes")) {
      if (type === "under") checkWhole(record.attributes, [...path, "attributes"], [0, 7], out);
      else if (typeof type === "string" && VECTOR_TYPES.includes(type)) out.push({ path: [...path, "attributes"], message: "is allowed only on an `under` vector" });
    }
    const hasTarget = Object.hasOwn(record, "toFloor") || Object.hasOwn(record, "toLayer");
    if (type === "stairs") checkLayerRef(record, path, LAYER_STAIRS, env, out);
    else if (hasTarget && typeof type === "string" && VECTOR_TYPES.includes(type)) {
      for (const key of ["toFloor", "toLayer"]) {
        if (Object.hasOwn(record, key)) out.push({ path: [...path, key], message: "is allowed only on a `stairs` vector" });
      }
    }
  });
}

function checkTriggers(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "triggers", TRIGGER, "a trigger", "id", out, (record, path) => {
    checkLayerRef(record, path, LAYER_I16, env, out);
    if (Object.hasOwn(record, "program")) checkText(record.program, [...path, "program"], "a program file or inline code", out);
    if (Object.hasOwn(record, "condition")) checkCondition(record.condition, [...path, "condition"], out);
    if (Object.hasOwn(record, "afterRun")) checkVariableValue(record.afterRun, [...path, "afterRun"], "the variable set after the program runs", out);
    if (Object.hasOwn(record, "activation")) checkActivation(record.activation, [...path, "activation"], TRIGGER_ACTIVATION, out);
    if (Object.hasOwn(record, "points")) checkPoints(record.points, [...path, "points"], 0, out);
    if (Object.hasOwn(record, "closed")) checkBool(record.closed, [...path, "closed"], out);
    if (Object.hasOwn(record, "legacy")) {
      const legacy = checkMapping(record.legacy, [...path, "legacy"], TRIGGER.maps!.legacy!, "a trigger's legacy data", out);
      if (legacy !== null) {
        if (Object.hasOwn(legacy, "graphic")) checkText(legacy.graphic, [...path, "legacy", "graphic"], "the associated graphic", out);
        if (Object.hasOwn(legacy, "reserved")) checkText(legacy.reserved, [...path, "legacy", "reserved"], "the reserved string", out);
      }
    }
  });
}

function checkItems(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "items", ITEM, "an item placement", "id", out, (record, path) => {
    checkLayerRef(record, path, LAYER_I16, env, out);
    if (Object.hasOwn(record, "item")) checkText(record.item, [...path, "item"], "an item file, relative to `Item\\`", out);
    for (const key of ["x", "y"]) {
      if (required(record, key, path, out)) checkWhole(record[key], [...path, key], I16, out);
    }
    for (const key of ["activationProgram", "multitaskProgram"]) {
      if (Object.hasOwn(record, key)) checkText(record[key], [...path, key], "a program name", out);
    }
    if (Object.hasOwn(record, "condition")) checkCondition(record.condition, [...path, "condition"], out);
    if (Object.hasOwn(record, "afterRun")) checkVariableValue(record.afterRun, [...path, "afterRun"], "the variable set after the program runs", out);
    if (Object.hasOwn(record, "loadCondition")) checkVariableValue(record.loadCondition, [...path, "loadCondition"], "the loading condition", out);
    if (Object.hasOwn(record, "activation")) checkActivation(record.activation, [...path, "activation"], ITEM_ACTIVATION, out);
    if (Object.hasOwn(record, "legacy")) {
      const legacy = checkMapping(record.legacy, [...path, "legacy"], ITEM.maps!.legacy!, "an item's legacy data", out);
      if (legacy !== null && Object.hasOwn(legacy, "reserved")) checkWhole(legacy.reserved, [...path, "legacy", "reserved"], I16, out);
    }
  });
}

function checkImages(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "images", IMAGE, "an image", "id", out, (record, path) => {
    checkLayerRef(record, path, LAYER_I16, env, out);
    if (Object.hasOwn(record, "source")) checkText(record.source, [...path, "source"], "an image file, relative to `Bitmap\\`", out);
    for (const key of ["x", "y"]) {
      if (required(record, key, path, out)) checkWhole(record[key], [...path, key], I32, out);
    }
    if (Object.hasOwn(record, "type")) checkEnum(record.type, [...path, "type"], IMAGE_TYPES, out);
    if (required(record, "transparent", path, out)) checkColour(record.transparent, [...path, "transparent"], out);
    if (Object.hasOwn(record, "legacy")) {
      const legacy = checkMapping(record.legacy, [...path, "legacy"], IMAGE.maps!.legacy!, "an image's legacy data", out);
      if (legacy !== null && Object.hasOwn(legacy, "reserved")) checkWhole(legacy.reserved, [...path, "legacy", "reserved"], I16, out);
    }
  });
}

function checkPlacedPacks(value: unknown, env: Env, out: Raw[]): void {
  checkRecords(value, "placedPacks", PLACED_PACK, "a pack placement", "instanceId", out, (record, path) => {
    if (required(record, "pack", path, out)) checkDocumentPath(record.pack, [...path, "pack"], "asset-pack", "the path of an asset pack document", out);
    if (required(record, "asset", path, out)) checkLocalName(record.asset, [...path, "asset"], "the local id of an asset of that pack", out);
    if (required(record, "floor", path, out)) checkFloorName(record.floor, [...path, "floor"], env, out);
    for (const key of ["x", "y"]) {
      if (required(record, key, path, out)) checkWhole(record[key], [...path, key], I32, out);
    }
  });
}

function checkAtmosphere(value: unknown, out: Raw[]): void {
  const atmosphere = checkMapping(value, ["atmosphere"], ATMOSPHERE, "the atmosphere", out);
  if (atmosphere === null) return;
  if (Object.hasOwn(atmosphere, "ambient")) checkOffset(atmosphere.ambient, ["atmosphere", "ambient"], out);
  if (Object.hasOwn(atmosphere, "music")) checkText(atmosphere.music, ["atmosphere", "music"], "a music file, relative to `Media\\`", out);
  if (Object.hasOwn(atmosphere, "background")) {
    const path: ClipPath = ["atmosphere", "background"];
    const background = checkMapping(atmosphere.background, path, ATMOSPHERE.maps!.background!, "the background", out);
    if (background !== null) {
      if (Object.hasOwn(background, "image")) checkText(background.image, [...path, "image"], "an image file, relative to `Bitmap\\`", out);
      if (Object.hasOwn(background, "type")) checkEnum(background.type, [...path, "type"], IMAGE_TYPES, out);
      if (Object.hasOwn(background, "color")) checkColour(background.color, [...path, "color"], out);
    }
  }
}

function checkStart(value: unknown, env: Env, out: Raw[]): void {
  const start = checkMapping(value, ["start"], START, "the start", out);
  if (start === null) return;
  for (const key of ["x", "y"]) {
    if (Object.hasOwn(start, key)) checkWhole(start[key], ["start", key], [1, 32767], out);
  }
  checkLayerRef(start, ["start"], LAYER_START, env, out);
}

function checkTextList(value: unknown, name: string, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType([name], "a list of text; an empty entry is `\"\"` and keeps its slot", value, out);
  value.forEach((entry: unknown, index) => {
    if (typeof entry !== "string") wrongType([name, index], "text; an empty entry is `\"\"`", entry, out);
  });
}

function checkLegacy(value: unknown, env: Env, out: Raw[]): void {
  const legacy = checkMapping(value, ["legacy"], LEGACY, "the legacy data", out);
  if (legacy === null) return;
  if (Object.hasOwn(legacy, "layerTitleZero")) checkText(legacy.layerTitleZero, ["legacy", "layerTitleZero"], "the title at layer index 0", out);
  if (Object.hasOwn(legacy, "trailingBytes")) {
    const bytes = legacy.trailingBytes;
    if (typeof bytes !== "string") wrongType(["legacy", "trailingBytes"], "text: the bytes after the last field, as padded base64", bytes, out);
    else if (bytes === "") out.push({ path: ["legacy", "trailingBytes"], message: "is empty text; it is written only when there are bytes" });
    else if (!BASE64.test(bytes)) out.push({ path: ["legacy", "trailingBytes"], message: "is not padded base64 (RFC 4648: groups of four of A-Z, a-z, 0-9, + and /, with = padding)" });
  }
  if (Object.hasOwn(legacy, "excessTiles")) {
    const path: ClipPath = ["legacy", "excessTiles"];
    const parts = checkTuple(legacy.excessTiles, path, [[1, 32767], TILE_INDEX], "a run: a list of two whole numbers, [count, index], with a count from 1 to 32767 and an index from 0 to 32767", out);
    if (parts !== null && env.lastTileIndex !== null && parts[1] !== env.lastTileIndex) {
      out.push({ path: [...path, 1], message: `must continue the final run: it is the index of the last cell of the last floor, ${env.lastTileIndex}; it is ${parts[1]}` });
    }
  }
}

/** Every rule of the contract page that needs no file of the project, on the JSON form of a document. */
function validateValue(value: unknown): Raw[] {
  const out: Raw[] = [];
  if (!isObject(value)) {
    wrongType([], "a mapping of keys to values", value, out);
    return out;
  }
  checkKeys(value, ROOT, [], "the scene contract", out);

  if (required(value, "contract", [], out) && value.contract !== SCENE_CONTRACT) {
    out.push({ path: ["contract"], message: `must be \`${SCENE_CONTRACT}\`` });
  }
  if (required(value, "version", [], out)) {
    const version = value.version;
    const parsed = typeof version === "string" ? parseVersion(version) : null;
    if (typeof version !== "string") wrongType(["version"], "text in the version form", version, out);
    else if (parsed === null || !parsed.ok) out.push({ path: ["version"], message: parsed !== null && !parsed.ok ? parsed.reason : "is not a version" });
    else if (parsed.major !== "1" || parsed.minor !== "0" || parsed.patch !== "0" || parsed.pre !== "1") {
      out.push({ path: ["version"], message: `\`${version}\` is not a version this reader knows; it reads ${SCENE_VERSION} (a \`+build\` suffix is allowed)` });
    }
  }

  if (Object.hasOwn(value, "tags")) {
    const tags = value.tags;
    if (!Array.isArray(tags)) wrongType(["tags"], "a list of non-empty text", tags, out);
    else {
      tags.forEach((tag: unknown, index) => {
        if (typeof tag !== "string" || tag === "") wrongType(["tags", index], "non-empty text", tag, out);
      });
    }
  }
  if (Object.hasOwn(value, "metadata")) {
    const metadata = value.metadata;
    if (!isObject(metadata)) wrongType(["metadata"], "a mapping", metadata, out);
    else if (!isJson(metadata)) out.push({ path: ["metadata"], message: "may hold only text, numbers, booleans, null, lists and mappings" });
  }

  const env: Env = { cells: null, size: null, projection: null, floorCount: null, floorIds: null, paletteSize: null, lastTileIndex: null };

  if (Object.hasOwn(value, "name")) checkText(value.name, ["name"], "a display name", out);
  if (required(value, "projection", [], out)) {
    checkEnum(value.projection, ["projection"], PROJECTIONS, out);
    if (typeof value.projection === "string" && PROJECTIONS.includes(value.projection)) env.projection = value.projection;
  }
  if (Object.hasOwn(value, "pixelCoordinates")) checkBool(value.pixelCoordinates, ["pixelCoordinates"], out);

  if (required(value, "size", [], out)) {
    const size = checkMapping(value.size, ["size"], SIZE, "the size", out);
    if (size !== null) {
      let width: number | null = null;
      let height: number | null = null;
      if (required(size, "width", ["size"], out)) {
        checkWhole(size.width, ["size", "width"], [1, 32767], out);
        if (isWhole(size.width, [1, 32767])) width = size.width;
      }
      if (required(size, "height", ["size"], out)) {
        checkWhole(size.height, ["size", "height"], [1, 32767], out);
        if (isWhole(size.height, [1, 32767])) height = size.height;
      }
      if (width !== null && height !== null) env.size = [width, height];
    }
  }
  if (env.projection !== null && env.size !== null) env.cells = effectiveCells(env.projection, env.size[0], env.size[1]);

  env.paletteSize = checkPalette(value, out);
  if (required(value, "floors", [], out)) checkFloors(value.floors, env, out);
  if (env.cells !== null && env.floorCount !== null && env.cells * env.floorCount > MAX_CELLS) {
    out.push({
      path: ["size"],
      message: `${gridWords(env)} on ${env.floorCount} floor${env.floorCount === 1 ? "" : "s"} is ${env.cells * env.floorCount} cells; a board has at most 4,194,304`,
    });
  }

  if (Object.hasOwn(value, "shading")) {
    checkRecords(value.shading, "shading", SHADING, "a shading layer", "id", out, (record, path) => checkShadingLayer(record, path, env, out));
  }
  if (Object.hasOwn(value, "lights")) checkLights(value.lights, env, out);
  if (Object.hasOwn(value, "vectors")) checkVectors(value.vectors, env, out);
  if (Object.hasOwn(value, "triggers")) checkTriggers(value.triggers, env, out);
  if (Object.hasOwn(value, "items")) checkItems(value.items, env, out);
  if (Object.hasOwn(value, "images")) checkImages(value.images, env, out);
  if (Object.hasOwn(value, "placedPacks")) checkPlacedPacks(value.placedPacks, env, out);
  if (Object.hasOwn(value, "atmosphere")) checkAtmosphere(value.atmosphere, out);
  if (Object.hasOwn(value, "start")) checkStart(value.start, env, out);
  if (Object.hasOwn(value, "links")) {
    const links = checkMapping(value.links, ["links"], LINKS, "the links", out);
    for (const edge of LINKS.keys) {
      if (links !== null && Object.hasOwn(links, edge)) checkText(links[edge], ["links", edge], "a board or program name, as stored", out);
    }
  }
  if (Object.hasOwn(value, "enterProgram")) checkText(value.enterProgram, ["enterProgram"], "a program name", out);
  if (Object.hasOwn(value, "battle")) {
    const battle = checkMapping(value.battle, ["battle"], BATTLE, "the battle settings", out);
    if (battle !== null) {
      if (Object.hasOwn(battle, "background")) checkText(battle.background, ["battle", "background"], "a battle background, relative to `Bkrounds\\`", out);
      if (Object.hasOwn(battle, "skill")) checkWhole(battle.skill, ["battle", "skill"], I16, out);
      if (Object.hasOwn(battle, "allowed")) checkBool(battle.allowed, ["battle", "allowed"], out);
    }
  }
  if (Object.hasOwn(value, "savingDisabled")) checkBool(value.savingDisabled, ["savingDisabled"], out);
  if (Object.hasOwn(value, "threads")) checkTextList(value.threads, "threads", out);
  if (Object.hasOwn(value, "constants")) checkTextList(value.constants, "constants", out);
  if (Object.hasOwn(value, "legacy")) checkLegacy(value.legacy, env, out);

  if (Object.hasOwn(value, "pluginData") && !isObject(value.pluginData)) {
    wrongType(["pluginData"], "a mapping of plugin ids to opaque plugin blocks", value.pluginData, out);
  }
  return out;
}

function toProblems(raw: readonly Raw[], lineOf: (path: ClipPath) => number | null): SceneProblem[] {
  return raw.filter((problem) => problem.severity === undefined).map((problem) => ({ kind: "shape", path: formatClipPath(problem.path), message: problem.message, line: lineOf(problem.path) }));
}

function toFindings(raw: readonly Raw[], lineOf: (path: ClipPath) => number | null): SceneFinding[] {
  return raw.flatMap((finding) =>
    finding.severity === undefined ? [] : [{ severity: finding.severity, path: formatClipPath(finding.path), message: finding.message, line: lineOf(finding.path) }],
  );
}

const withoutPluginSource = (scene: unknown): unknown => {
  if (!isObject(scene) || !Object.hasOwn(scene, "pluginSource")) return scene;
  const contract = { ...scene };
  delete contract.pluginSource;
  return contract;
};

/** Check a scene model, for example one an importer made, against every rule of the contract; nothing is written. */
export function checkScene(scene: unknown): readonly SceneProblem[] {
  return toProblems(validateValue(withoutPluginSource(scene)), () => null);
}

/** The warnings and notes of a scene model, for example one an importer made; a finding never refuses a scene. */
export function sceneFindings(scene: unknown): readonly SceneFinding[] {
  return toFindings(validateValue(withoutPluginSource(scene)), () => null);
}

// ---------------------------------------------------------------- what a project checker needs

/** A native reference the scene makes, for a project checker to resolve (V15, V16) and a rename to rewrite. */
export type SceneNativeReference = {
  /** The mapping that holds it, for example `tilePalette[2]`; its keys are `tileset` and `tile`, or `pack` and `asset`. */
  readonly path: string;
  /** `tile`: a tile of a `.tkrtst`; `asset`: an asset of a `.tkrpack`. */
  readonly kind: "tile" | "asset";
  /** The path of the native document, as written. */
  readonly document: string;
  /** The local id inside that document. */
  readonly id: string;
};

/**
 * Every native reference of a scene, in document order: the palette, each floor's walkable tiles
 * and the pack placements. A legacy tile reference is not a native document and is not listed.
 */
export function sceneNativeReferences(scene: Scene): readonly SceneNativeReference[] {
  const found: SceneNativeReference[] = [];
  const tile = (path: string, reference: ScenePaletteEntry): void => {
    if (reference.tileset !== undefined) found.push({ path, kind: "tile", document: reference.tileset, id: reference.tile });
  };
  scene.tilePalette?.forEach((entry, index) => tile(`tilePalette[${index}]`, entry));
  scene.floors.forEach((floor, index) => floor.boundarySources?.walkableTiles?.forEach((entry, at) => tile(`floors[${index}].boundarySources.walkableTiles[${at}]`, entry)));
  scene.placedPacks?.forEach((placement, index) => found.push({ path: `placedPacks[${index}]`, kind: "asset", document: placement.pack, id: placement.asset }));
  return found;
}

/**
 * The cells of one floor of the effective grid: `width` by `height`, or for an `iso-rotated`
 * board `(width + height)` by `(width + height)`. The cells of a floor, and of a shading layer,
 * run row by row with x fastest.
 */
export function sceneCellCount(scene: Pick<Scene, "projection" | "size">): number {
  return effectiveCells(scene.projection, scene.size.width, scene.size.height);
}

// ---------------------------------------------------------------- reading

/** 1-based line of the place `path` names in a parsed document, or `null` when it cannot be found. */
function lineLocator(document: Document.Parsed, lines: LineCounter): (path: ClipPath) => number | null {
  return (path) => {
    let node: unknown = document.contents;
    let anchor: number | null = null;
    for (const segment of path) {
      if (isMap(node)) {
        const pair = node.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === segment);
        if (pair === undefined) break;
        const key = pair.key as Node;
        anchor = key.range === undefined || key.range === null ? anchor : key.range[0];
        node = pair.value;
      } else if (isSeq(node) && typeof segment === "number") {
        node = node.items[segment];
        const range = (node as Node | undefined)?.range;
        anchor = range === undefined || range === null ? anchor : range[0];
      } else break;
    }
    return anchor === null ? null : lines.linePos(anchor).line;
  };
}

/** A problem for each alias that names no anchor: reading its value would throw, so the document is refused before that. */
function unresolvedAliases(text: string): SceneProblem[] {
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const problems: SceneProblem[] = [];
  visit(document, {
    Alias(_key, alias) {
      if (alias.resolve(document) !== undefined) return;
      const at = alias.range?.[0];
      problems.push({
        kind: "shape",
        path: "(document)",
        message: `YAML error: Unresolved alias (the anchor must be set before the alias): ${alias.source}`,
        line: at === undefined ? null : lines.linePos(at).line,
      });
    },
  });
  return problems;
}

/**
 * Read a scene document and retain its original source. A missing, repeated, malformed or
 * not-first stamp is refused first, by the stamp rules of `readDocument`; then every rule of the
 * contract that needs no project file is checked, local references included, and every problem is
 * reported, never only the first. A document that holds plugin blocks also carries an exact
 * source token so a writer can refuse stale source. Warnings and notes come back as `findings`.
 */
export function readScene(text: string): SceneReadResult {
  const unresolved = unresolvedAliases(text);
  if (unresolved.length > 0) return { ok: false, problems: unresolved };
  const stamp = readDocument({ path: "(scene)", text }, []);
  if (stamp.stampReports.length > 0) {
    return {
      ok: false,
      problems: stamp.stampReports.map((report) => ({
        kind: "stamp",
        path: report.key ?? "(document)",
        message: report.problem === "unreadable" ? `document unreadable: ${report.reason}` : `stamp ${report.problem}: ${report.reason}`,
        line: report.line,
      })),
    };
  }

  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const pluginProblems = validatePluginData(document, text, lines, ROOT_KEYS);
  const yamlProblems: SceneProblem[] = document.errors.map((error) => ({
    kind: "shape",
    path: "(document)",
    message: `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`,
    line: error.linePos?.[0]?.line ?? null,
  }));
  if (yamlProblems.length > 0 || pluginProblems.length > 0) {
    return {
      ok: false,
      problems: [
        ...pluginProblems.map((problem) => ({
          kind: "plugin-block" as const,
          pluginKind: problem.kind,
          path: problem.pluginId === null ? "pluginData" : `pluginData.${problem.pluginId}`,
          message: `${problem.kind}: ${problem.reason} (found ${JSON.stringify(problem.found)})`,
          line: problem.line,
        })),
        ...yamlProblems,
      ],
    };
  }
  let value: unknown;
  try {
    value = document.toJS();
  } catch (error) {
    // Expanding aliases is bounded by the parser's own limit; hitting it is a diagnostic, not a crash.
    let line: number | null = null;
    visit(document, {
      Alias(_key, alias) {
        const at = alias.range?.[0];
        if (line === null && at !== undefined) line = lines.linePos(at).line;
      },
    });
    return { ok: false, problems: [{ kind: "shape", path: "(document)", message: `YAML error: ${error instanceof Error ? error.message : String(error)}`, line }] };
  }
  const raw = validateValue(value);
  const locate = lineLocator(document, lines);
  const problems = toProblems(raw, locate);
  if (problems.length > 0) return { ok: false, problems };
  const scene = value as Scene;
  const entries = isMap(document.contents) ? document.contents.items : [];
  const pluginIndex = entries.findIndex((pair) => isScalar(pair.key) && pair.key.value === "pluginData");
  const pluginStart = pluginIndex < 0 ? undefined : (entries[pluginIndex]!.key as Node).range?.[0];
  // The block runs to the next top-level key, or to the end of the text when it is the last entry.
  const nextKey = pluginIndex < 0 ? undefined : (entries[pluginIndex + 1]?.key as Node | undefined)?.range?.[0];
  return {
    ok: true,
    scene: pluginStart === undefined ? scene : { ...scene, pluginSource: text.slice(pluginStart, nextKey ?? text.length) },
    source: text,
    findings: toFindings(raw, locate),
  };
}

// ---------------------------------------------------------------- writing

/** The model with every mapping's keys in the contract's order; a key the contract does not list is left out. */
function ordered(value: Record<string, unknown>, shape: Shape): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of shape.keys) {
    if (!Object.hasOwn(value, key)) continue;
    const part = value[key];
    const map = shape.maps?.[key];
    const list = shape.lists?.[key];
    if (map !== undefined && isObject(part)) result[key] = ordered(part, map);
    else if (list !== undefined && Array.isArray(part)) result[key] = part.map((item: unknown) => (isObject(item) ? ordered(item, list) : item));
    else result[key] = part;
  }
  return result;
}

/** Sets `flow` on the mappings the layout writes on one line, walking the node tree with the shape. */
function flowMappings(node: unknown, shape: Shape): void {
  if (!isMap(node)) return;
  if (shape.flow === true) node.flow = true;
  for (const pair of node.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
    const map = shape.maps?.[pair.key.value];
    const list = shape.lists?.[pair.key.value];
    if (map !== undefined) flowMappings(pair.value, map);
    else if (list !== undefined && isSeq(pair.value)) for (const item of pair.value.items) flowMappings(item, list);
  }
}

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    if (seen.get(left)?.has(right)) return true;
    const peers = seen.get(left) ?? new WeakSet<object>();
    peers.add(right);
    seen.set(left, peers);
    return left.every((item, index) => sameValue(item, right[index], seen));
  }
  if (!isObject(left) || !isObject(right)) return false;
  if (seen.get(left)?.has(right)) return true;
  const peers = seen.get(left) ?? new WeakSet<object>();
  peers.add(right);
  seen.set(left, peers);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key], seen));
}

/** A list of lists (the runs, points and colours) is written on one line up to this many entries, and one entry per line above it. */
const FLOW_LIST_LIMIT = 8;

/**
 * Write a scene as YAML text. With the original `source` the text is returned unchanged, and only
 * when it still reads as exactly this model: nothing is printed from a parsed tree, so comments,
 * quoting and plugin blocks stay as authored. A model that holds plugin blocks has no other way to
 * be written. Without a source, a new document is laid out in the contract's key order (the stamp,
 * `tags`, `metadata`, the core fields, `pluginData` last, and inside a record the keys in the
 * order of its table): block mappings, two-space indent, and lists of numbers or text, the small
 * mappings (`size`, `start`, `condition`, a tile reference) and short lists of runs or points in
 * flow style. The layout is provisional, as the clip's is.
 */
export function writeScene(scene: Scene, source?: string): SceneWriteResult {
  const problems = checkScene(scene);
  if (problems.length > 0) return { ok: false, problems };

  if ((scene.pluginData !== undefined || scene.pluginSource !== undefined) && source === undefined) {
    return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  }
  if (source !== undefined) {
    const parsed = readScene(source);
    if (!parsed.ok) return { ok: false, problems: parsed.problems };
    if (!sameValue(parsed.scene, scene)) {
      return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested scene", line: null }] };
    }
    return { ok: true, text: source };
  }

  const document = new Document(ordered(scene as unknown as Record<string, unknown>, ROOT), { version: "1.2", schema: "core" });
  flowMappings(document.contents, ROOT);
  visit(document, {
    Seq(_key, node) {
      if (node.items.every((item) => isScalar(item))) node.flow = true;
      else if (node.items.length <= FLOW_LIST_LIMIT && node.items.every((item) => isSeq(item) && item.items.every((part) => isScalar(part)))) node.flow = true;
    },
  });
  return { ok: true, text: document.toString({ lineWidth: 0, flowCollectionPadding: false }) };
}

// ---------------------------------------------------------------- editing

/** A value an edit can set: text, a number or a boolean. Lists and mappings are not set whole. */
export type SceneEditValue = string | number | boolean;

export type SceneEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly SceneProblem[] };

/** What `plan*` return instead of splices when an edit cannot be made. */
type EditError = { readonly error: string };

type Context = { readonly text: string; readonly document: Document.Parsed; readonly lines: LineCounter };

/**
 * One value as YAML on one line. Inside a flow collection (`[a, b]`, `{a: 1}`) a text with `,`, `[`,
 * `]`, `{` or `}` is double-quoted, because plain it would split into several entries.
 */
const editText = (value: SceneEditValue, like: Node | null, flow: boolean): string => {
  if (typeof value === "boolean") return String(value);
  const quoted = isScalar(like) && (like.type === "QUOTE_DOUBLE" || like.type === "QUOTE_SINGLE");
  if (flow && typeof value === "string" && (/[\r\n]/.test(value) || (!quoted && /[,[\]{}]/.test(value)))) {
    const forced = new Scalar("");
    forced.type = "QUOTE_DOUBLE";
    return scalarText(value, forced);
  }
  return scalarText(value, isScalar(like) ? like : null);
};

function planReplace(context: Context, node: unknown, value: SceneEditValue, flow: boolean): Splice[] | EditError {
  if (!isScalar(node) || node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL") return { error: "the value is not a one-line scalar, so it cannot be replaced in place" };
  if (node.anchor !== undefined) return { error: "the value is anchored, so another place may share it; it cannot be replaced in place" };
  const [start, end] = rangeOf(node);
  if (context.text.slice(start, end).includes("\n")) return { error: "the value runs over more than one line, so it cannot be replaced in place" };
  return [{ start, end, text: editText(value, node, flow) }];
}

/** The offset of the end of the line that holds `from`, before its `\r\n` or `\n`. */
function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  if (newline < 0) return text.length;
  return newline > 0 && text[newline - 1] === "\r" ? newline - 1 : newline;
}

/** Where an entry ends, for a new entry to follow it: the end of its last line, trailing comment included. */
function entryEnd(text: string, value: Node): number {
  const end = rangeOf(value)[1];
  return lineEnd(text, end > 0 && text[end - 1] === "\n" ? end - 1 : end);
}

/**
 * Add a key that is absent from an existing mapping: after the nearest key that the contract's
 * key order puts before it, or before the nearest that it puts after, and as the only key of an
 * empty `{}` (an empty palette slot). Only the keys the contract lists for that mapping can be
 * added; the reader judges the result, so a key that takes a list or a mapping is refused there.
 */
function planInsert(context: Context, parent: YAMLMap, parentPath: ClipPath, key: string, value: SceneEditValue): Splice[] | EditError {
  const shape = shapeOf(parentPath);
  if (shape === null || !shape.keys.includes(key) || key === "contract" || key === "version" || key === "pluginData") {
    return { error: "there is no such key; the contract is closed, and only a key it lists for that mapping can be added" };
  }
  const { text, lines } = context;
  const entry = `${key}: ${editText(value, null, parent.flow === true)}`;
  const order = shape.keys.indexOf(key);
  type Placed = { readonly key: Node; readonly value: Node; readonly order: number };
  const present = parent.items.flatMap((pair): Placed[] => {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || pair.value === null || typeof pair.value !== "object") return [];
    return [{ key: pair.key, value: pair.value as Node, order: shape.keys.indexOf(pair.key.value) }];
  });
  if (present.length === 0) {
    if (parent.flow !== true) return { error: "the mapping has no entries to place the new key beside" };
    const [start, end] = rangeOf(parent as unknown as Node);
    return [{ start, end, text: `{${entry}}` }];
  }
  const before = present.filter((candidate) => candidate.order < order).sort((left, right) => right.order - left.order)[0];
  const after = present.filter((candidate) => candidate.order > order).sort((left, right) => left.order - right.order)[0];

  if (parent.flow === true) {
    if (before !== undefined) {
      const at = rangeOf(before.value)[1];
      return [{ start: at, end: at, text: `, ${entry}` }];
    }
    const at = rangeOf(after!.key)[0];
    return [{ start: at, end: at, text: `${entry}, ` }];
  }

  const indent = " ".repeat(lines.linePos(rangeOf(parent.items[0]!.key as Node)[0]).col - 1);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (before !== undefined) {
    const at = entryEnd(text, before.value);
    return [{ start: at, end: at, text: `${newline}${indent}${entry}` }];
  }
  const keyStart = rangeOf(after!.key)[0];
  const lineStart = text.lastIndexOf("\n", keyStart - 1) + 1;
  if (text.slice(lineStart, keyStart).trim() !== "") {
    // The key follows a `- ` on its line, so the new key joins that line and pushes the old one down.
    return [{ start: keyStart, end: keyStart, text: `${entry}${newline}${indent}` }];
  }
  // A comment on the lines just above the key belongs to it, so the new key goes above the comment.
  let at = lineStart;
  while (at > 0) {
    const previous = text.lastIndexOf("\n", at - 2) + 1;
    if (!/^\s*#/.test(text.slice(previous, at))) break;
    at = previous;
  }
  return [{ start: at, end: at, text: `${indent}${entry}${newline}` }];
}

function planSet(context: Context, path: ClipPath, value: SceneEditValue): Splice[] | EditError {
  const last = path.at(-1);
  if (last === undefined) return { error: "an edit names a place in the document" };
  if (typeof value === "number" && !Number.isFinite(value)) return { error: "a number must be finite" };
  const parentPath = path.slice(0, -1);
  const parent: unknown = context.document.getIn(parentPath, true);
  if (isSeq(parent)) {
    if (typeof last !== "number" || last < 0 || last >= parent.items.length) return { error: "there is no such list entry; adding or removing list entries is not an edit this reader makes" };
    return planReplace(context, parent.items[last], value, parent.flow === true);
  }
  if (!isMap(parent) || typeof last !== "string") return { error: "there is no such place in the document" };
  const pair = parent.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === last);
  if (pair === undefined) return planInsert(context, parent, parentPath, last, value);
  return planReplace(context, pair.value, value, parent.flow === true);
}

/**
 * Set one property of an existing scene document in place, for example `["atmosphere", "music"]`
 * to `"theme.ogg"`, `["floors", 0, "tiles", 1, 1]` to `3` or `["triggers", 1, "program"]` to
 * `"door.prg"`. Only the text of the value changes: a replaced value is a splice into the original
 * text, so every other byte, every comment, the quoting and the plugin blocks stay as written. A
 * key the document leaves out (an optional key, or an empty slot's `program` or `item`) is added in
 * the contract's key order, and the empty slot `{}` of a palette takes a `legacy` entry; adding or
 * removing a list entry is not an edit this function makes, so no later slot's index shifts. A
 * plugin block is opaque here and cannot be edited. A document the reader refuses is not edited,
 * and an edit that would leave one (an invalid value, a dangling floor reference, runs that no
 * longer cover the grid) is not made.
 */
export function setSceneProperty(text: string, path: ScenePath, value: SceneEditValue): SceneEditResult {
  if (path[0] === "pluginData") {
    return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: "plugin blocks are opaque and cannot be edited by the scene writer", line: null }] };
  }
  const before = readScene(text);
  if (!before.ok) return before;
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const splices = planSet({ text, document, lines }, path, value);
  if (!Array.isArray(splices)) return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: (splices as EditError).error, line: null }] };

  const edited = applySplices(text, splices);
  const after = readScene(edited);
  if (!after.ok) {
    return { ok: false, problems: after.problems.map((problem) => ({ ...problem, message: `the edit would leave a document the reader refuses: ${problem.message}` })) };
  }
  if (after.scene.pluginSource !== before.scene.pluginSource) {
    return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: "the edit would change a plugin block, which this writer never changes", line: null }] };
  }
  return { ok: true, text: edited };
}
