/**
 * The native tileset (docs/spec/formats/native-tileset.md): the typed model, the reader, the
 * writer, the model check and the in-place edit.
 *
 * Reference reader, writer and editor for contract `tileset`, version `1.0.0-pre.1`. It follows
 * the animation clip's conventions (`clip.ts`): results are `{ ok, ... }` values, problems are
 * located and never repaired, a document that holds a plugin block is only ever written back
 * from its own source, and an edit is a list of splices into the original text (G2: nothing but
 * text in memory is touched). The contract page is a draft pending the owner's approval; this
 * module implements it as written and records no approval.
 *
 * What this module cannot judge is whatever needs the project: whether a source image exists,
 * how big it is (so whether a cell lies inside it), and whether a path collides with another
 * document. {@link tilesetAssetPaths}, {@link tilesetCellReferences} and
 * {@link tilesetCellBounds} give a project checker what it needs to do that.
 */

import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node, type YAMLMap } from "yaml";
import { formatClipPath, formatClipProblems, type ClipJson, type ClipPath, type ClipProblem } from "./clip.ts";
import { readDocument } from "./document.ts";
import { foldId } from "./fold.ts";
import { validatePluginData } from "./plugin-data.ts";
import { classifyExtension, extensionOf } from "./registry.ts";
import { applySplices, rangeOf, scalarText, type Splice } from "./splice.ts";
import { parseVersion } from "./version.ts";

export const TILESET_CONTRACT = "tileset";
export const TILESET_VERSION = "1.0.0-pre.1";

/** `[column, row]`, zero-based. */
export type TilesetCell = readonly [column: number, row: number];

/** An integer RGB value; a colour key's channels are 0 to 255, a tint's are -255 to 255. */
export type TilesetRgb = readonly [red: number, green: number, blue: number];

export type TilesetProjection = "2d" | "iso-stacked" | "iso-rotated";
export type TilesetRole = "floor" | "wall" | "wall-cap" | "decorative";
export type TilesetCollision = "walkable" | "solid";

export type TilesetGrid = {
  readonly width: number;
  readonly height: number;
  readonly marginX: number;
  readonly marginY: number;
  readonly gapX: number;
  readonly gapY: number;
};

export type TilesetTransparent = { readonly mode: "alpha" } | { readonly mode: "colorKey"; readonly color: TilesetRgb };

export type TilesetSource = {
  readonly id: string;
  /** A project-relative `/` path of the source image. */
  readonly file: string;
  readonly grid: TilesetGrid;
  readonly transparent: TilesetTransparent;
};

export type TilesetDiagonal = "north-west" | "north-east" | "south-east" | "south-west";

/** The only kitbash operation the contract defines. */
export type TilesetKitbashOp = { readonly op: "cutCorner"; readonly diagonal: TilesetDiagonal; readonly clearHalf: boolean };

export type TilesetTile = {
  readonly id: string;
  readonly name: string;
  /** The `id` of a source of this document. */
  readonly source: string;
  readonly cell: TilesetCell;
  readonly role: TilesetRole;
  readonly collision: TilesetCollision;
  readonly kitbash?: readonly TilesetKitbashOp[];
};

export type TilesetIsoFace = {
  readonly source: string;
  readonly cell: TilesetCell;
  /** Absent means `[0, 0, 0]`. */
  readonly tint?: TilesetRgb;
};

export type TilesetIsoBlock = {
  readonly id: string;
  readonly name: string;
  readonly heightPixels: number;
  readonly faces: { readonly top: TilesetIsoFace; readonly left: TilesetIsoFace; readonly right: TilesetIsoFace };
  readonly collision: TilesetCollision;
  /** Absent means `false`. */
  readonly wallCapUnder?: boolean;
};

export type TilesetSourceCell = { readonly source: string; readonly cell: TilesetCell };

export type TilesetAutotile = {
  readonly id: string;
  readonly name: string;
  readonly mode: "blob-47";
  readonly base: TilesetSourceCell;
  readonly border: TilesetSourceCell;
  readonly innerCorner: TilesetSourceCell;
  readonly exportOrder: "t25-canonical";
};

export type TilesetOutputBinding = {
  /** A project-relative `/` path of the generated `.tst`. */
  readonly target: string;
  readonly detail: number;
};

export type TilesetJson = ClipJson;

export type Tileset = {
  readonly contract: typeof TILESET_CONTRACT;
  /** The stamp's version as written, with any `+build` suffix. */
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: TilesetJson };
  readonly name: string;
  readonly projection: TilesetProjection;
  readonly cellSize: readonly [width: number, height: number];
  readonly sources: readonly TilesetSource[];
  readonly tiles: readonly TilesetTile[];
  readonly isoBlocks?: readonly TilesetIsoBlock[];
  readonly autotiles?: readonly TilesetAutotile[];
  readonly outputBinding: TilesetOutputBinding;
  /** Exact source of the `pluginData` entry, up to the next top-level key or the end of the text; used only to verify opaque block preservation. */
  readonly pluginSource?: string;
  /** Opaque plugin envelopes; never regenerated from these parsed values. */
  readonly pluginData?: {
    readonly [pluginId: string]: {
      readonly version: string;
      readonly data: { readonly [key: string]: TilesetJson };
    };
  };
};

/** Why a document, model or edit is refused; the shape is the clip's (`ClipProblem`). */
export type TilesetProblem = ClipProblem;

export type TilesetPath = ClipPath;

export type TilesetReadResult =
  | { readonly ok: true; readonly tileset: Tileset; readonly source: string }
  | { readonly ok: false; readonly problems: readonly TilesetProblem[] };

export type TilesetWriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly TilesetProblem[] };

export const formatTilesetPath = formatClipPath;
export const formatTilesetProblems = formatClipProblems;

// ---------------------------------------------------------------- validation

type Raw = { readonly path: ClipPath; readonly message: string };

/** `lowercase-kebab-case`, the shared authoring convention for local ids. */
const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ROOT_KEYS = [
  "contract",
  "version",
  "tags",
  "metadata",
  "name",
  "projection",
  "cellSize",
  "sources",
  "tiles",
  "isoBlocks",
  "autotiles",
  "outputBinding",
  "pluginData",
] as const;
const SOURCE_KEYS = ["id", "file", "grid", "transparent"] as const;
const GRID_KEYS = ["width", "height", "marginX", "marginY", "gapX", "gapY"] as const;
const TILE_KEYS = ["id", "name", "source", "cell", "role", "collision", "kitbash"] as const;
const CUT_CORNER_KEYS = ["op", "diagonal", "clearHalf"] as const;
const BLOCK_KEYS = ["id", "name", "heightPixels", "faces", "collision", "wallCapUnder"] as const;
const FACE_NAMES = ["top", "left", "right"] as const;
const FACE_KEYS = ["source", "cell", "tint"] as const;
const AUTOTILE_KEYS = ["id", "name", "mode", "base", "border", "innerCorner", "exportOrder"] as const;
const SOURCE_CELL_KEYS = ["source", "cell"] as const;
const OUTPUT_KEYS = ["target", "detail"] as const;

const PROJECTIONS: readonly string[] = ["2d", "iso-stacked", "iso-rotated"];
const ROLES: readonly string[] = ["floor", "wall", "wall-cap", "decorative"];
const COLLISIONS: readonly string[] = ["walkable", "solid"];
const DIAGONALS: readonly string[] = ["north-west", "north-east", "south-east", "south-west"];

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

function checkKeys(value: Record<string, unknown>, known: readonly string[], path: ClipPath, owner: string, out: Raw[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) out.push({ path: [...path, key], message: `\`${key}\` is not a key of ${owner}; the contract is closed` });
  }
}

function required(value: Record<string, unknown>, key: string, path: ClipPath, out: Raw[]): boolean {
  if (Object.hasOwn(value, key)) return true;
  out.push({ path, message: `\`${key}\` is required` });
  return false;
}

const isWhole = (value: unknown, min: number, max = Number.POSITIVE_INFINITY): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function checkWhole(value: unknown, path: ClipPath, min: number, max: number | undefined, out: Raw[]): void {
  if (isWhole(value, min, max)) return;
  const range = max === undefined ? (min === 0 ? "zero or more" : `at least ${min}`) : `from ${min} to ${max}`;
  wrongType(path, `a whole number, ${range}`, value, out);
}

function checkWholeList(value: unknown, path: ClipPath, count: number, min: number, max: number | undefined, wanted: string, out: Raw[]): void {
  if (!Array.isArray(value) || value.length !== count) return wrongType(path, wanted, value, out);
  value.forEach((part: unknown, index) => checkWhole(part, [...path, index], min, max, out));
}

const CELL_WANTED = "a cell: a list of two whole numbers, [column, row], zero or more";

function checkText(value: unknown, path: ClipPath, what: string, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, `text: ${what}`, value, out);
  if (value === "") out.push({ path, message: "is empty text, which is not accepted" });
}

function checkEnum(value: unknown, path: ClipPath, allowed: readonly string[], out: Raw[]): void {
  if (typeof value === "string" && allowed.includes(value)) return;
  wrongType(path, `one of ${allowed.map((word) => `\`${word}\``).join(", ")}`, value, out);
}

function checkLiteral(value: unknown, path: ClipPath, word: string, out: Raw[]): void {
  if (value !== word) out.push({ path, message: `must be \`${word}\`, the only value the contract defines${typeof value === "string" ? `; it is \`${value}\`` : ""}` });
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

/** A path as identity compares it: empty and `.` parts dropped, ASCII-folded. */
const comparable = (path: string): string => foldId(path.split("/").filter((part) => part !== "" && part !== ".").join("/"));

function checkPath(value: unknown, path: ClipPath, what: string, out: Raw[]): string | null {
  if (typeof value !== "string") {
    wrongType(path, `text: ${what}`, value, out);
    return null;
  }
  const problem = pathProblem(value);
  if (problem !== null) {
    out.push({ path, message: `${problem} (a project-relative \`/\` path)` });
    return null;
  }
  return value;
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

function checkSourceName(value: unknown, path: ClipPath, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, "text: the id of a source of this document", value, out);
  if (sourceIds !== null && !sourceIds.has(value)) out.push({ path, message: `\`${value}\` names no source of this document` });
}

function checkSourceCell(value: unknown, path: ClipPath, keys: readonly string[], owner: string, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, `${owner}: a mapping of source and cell`, value, out);
  checkKeys(value, keys, path, owner, out);
  if (required(value, "source", path, out)) checkSourceName(value.source, [...path, "source"], sourceIds, out);
  if (required(value, "cell", path, out)) checkWholeList(value.cell, [...path, "cell"], 2, 0, undefined, CELL_WANTED, out);
  if (keys.includes("tint") && Object.hasOwn(value, "tint")) {
    checkWholeList(value.tint, [...path, "tint"], 3, -255, 255, "a tint: a list of three whole numbers from -255 to 255", out);
  }
}

function checkSources(value: unknown, out: Raw[]): ReadonlySet<string> | null {
  if (!Array.isArray(value)) {
    wrongType(["sources"], "a list of sources", value, out);
    return null;
  }
  if (value.length === 0) out.push({ path: ["sources"], message: "must list at least one source" });
  const seen = new Map<string, number>();
  value.forEach((source: unknown, index) => {
    const path: ClipPath = ["sources", index];
    if (!isObject(source)) return wrongType(path, "a source: a mapping with an id, file, grid and transparent", source, out);
    checkKeys(source, SOURCE_KEYS, path, "a source", out);
    if (required(source, "id", path, out)) checkLocalId(source.id, [...path, "id"], "sources", seen, index, out);
    if (required(source, "file", path, out)) checkPath(source.file, [...path, "file"], "a project-relative path of the source image", out);
    if (required(source, "grid", path, out)) {
      const grid = source.grid;
      const gridPath = [...path, "grid"];
      if (!isObject(grid)) wrongType(gridPath, "a grid: a mapping of width, height, marginX, marginY, gapX and gapY", grid, out);
      else {
        checkKeys(grid, GRID_KEYS, gridPath, "a grid", out);
        for (const key of GRID_KEYS) {
          if (!required(grid, key, gridPath, out)) continue;
          checkWhole(grid[key], [...gridPath, key], key === "width" || key === "height" ? 1 : 0, undefined, out);
        }
      }
    }
    if (required(source, "transparent", path, out)) {
      const transparent = source.transparent;
      const transparentPath = [...path, "transparent"];
      if (!isObject(transparent)) wrongType(transparentPath, "a mapping: `{mode: alpha}` or `{mode: colorKey, color: [r, g, b]}`", transparent, out);
      else if (transparent.mode === "alpha") checkKeys(transparent, ["mode"], transparentPath, "the alpha transparency mode", out);
      else if (transparent.mode === "colorKey") {
        checkKeys(transparent, ["mode", "color"], transparentPath, "the colorKey transparency mode", out);
        if (required(transparent, "color", transparentPath, out)) {
          checkWholeList(transparent.color, [...transparentPath, "color"], 3, 0, 255, "a colour: a list of three whole numbers from 0 to 255", out);
        }
      } else if (!Object.hasOwn(transparent, "mode")) out.push({ path: transparentPath, message: "`mode` is required" });
      else wrongType([...transparentPath, "mode"], "`alpha` or `colorKey`", transparent.mode, out);
    }
  });
  return new Set(seen.keys());
}

function checkKitbash(value: unknown, path: ClipPath, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType(path, "a list of kitbash operations", value, out);
  value.forEach((operation: unknown, index) => {
    const opPath = [...path, index];
    if (!isObject(operation)) return wrongType(opPath, "an operation: a mapping with an op", operation, out);
    if (!required(operation, "op", opPath, out)) return;
    if (operation.op !== "cutCorner") {
      out.push({ path: [...opPath, "op"], message: `${typeof operation.op === "string" ? `\`${operation.op}\` is` : "it is"} not a kitbash operation the contract defines; the only one is \`cutCorner\`` });
      return;
    }
    checkKeys(operation, CUT_CORNER_KEYS, opPath, "the cutCorner operation", out);
    if (required(operation, "diagonal", opPath, out)) checkEnum(operation.diagonal, [...opPath, "diagonal"], DIAGONALS, out);
    if (required(operation, "clearHalf", opPath, out) && typeof operation.clearHalf !== "boolean") wrongType([...opPath, "clearHalf"], "true or false", operation.clearHalf, out);
  });
}

function checkTiles(value: unknown, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType(["tiles"], "a list of tiles", value, out);
  if (value.length === 0) out.push({ path: ["tiles"], message: "must list at least one tile" });
  const seen = new Map<string, number>();
  value.forEach((tile: unknown, index) => {
    const path: ClipPath = ["tiles", index];
    if (!isObject(tile)) return wrongType(path, "a tile: a mapping with an id, name, source, cell, role and collision", tile, out);
    checkKeys(tile, TILE_KEYS, path, "a tile", out);
    if (required(tile, "id", path, out)) checkLocalId(tile.id, [...path, "id"], "tiles", seen, index, out);
    if (required(tile, "name", path, out)) checkText(tile.name, [...path, "name"], "a display name", out);
    if (required(tile, "source", path, out)) checkSourceName(tile.source, [...path, "source"], sourceIds, out);
    if (required(tile, "cell", path, out)) checkWholeList(tile.cell, [...path, "cell"], 2, 0, undefined, CELL_WANTED, out);
    if (required(tile, "role", path, out)) checkEnum(tile.role, [...path, "role"], ROLES, out);
    if (required(tile, "collision", path, out)) checkEnum(tile.collision, [...path, "collision"], COLLISIONS, out);
    if (Object.hasOwn(tile, "kitbash")) checkKitbash(tile.kitbash, [...path, "kitbash"], out);
  });
}

function checkIsoBlocks(value: unknown, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType(["isoBlocks"], "a list of isometric blocks", value, out);
  const seen = new Map<string, number>();
  value.forEach((block: unknown, index) => {
    const path: ClipPath = ["isoBlocks", index];
    if (!isObject(block)) return wrongType(path, "a block: a mapping with an id, name, heightPixels, faces and collision", block, out);
    checkKeys(block, BLOCK_KEYS, path, "an isometric block", out);
    if (required(block, "id", path, out)) checkLocalId(block.id, [...path, "id"], "isoBlocks", seen, index, out);
    if (required(block, "name", path, out)) checkText(block.name, [...path, "name"], "a display name", out);
    if (required(block, "heightPixels", path, out)) checkWhole(block.heightPixels, [...path, "heightPixels"], 1, undefined, out);
    if (required(block, "faces", path, out)) {
      const faces = block.faces;
      const facesPath = [...path, "faces"];
      if (!isObject(faces)) wrongType(facesPath, "a mapping of exactly top, left and right", faces, out);
      else {
        checkKeys(faces, FACE_NAMES, facesPath, "the faces of a block", out);
        for (const face of FACE_NAMES) {
          if (required(faces, face, facesPath, out)) checkSourceCell(faces[face], [...facesPath, face], FACE_KEYS, "a face", sourceIds, out);
        }
      }
    }
    if (required(block, "collision", path, out)) checkEnum(block.collision, [...path, "collision"], COLLISIONS, out);
    if (Object.hasOwn(block, "wallCapUnder") && typeof block.wallCapUnder !== "boolean") wrongType([...path, "wallCapUnder"], "true or false", block.wallCapUnder, out);
  });
}

function checkAutotiles(value: unknown, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType(["autotiles"], "a list of autotiles", value, out);
  const seen = new Map<string, number>();
  value.forEach((autotile: unknown, index) => {
    const path: ClipPath = ["autotiles", index];
    if (!isObject(autotile)) return wrongType(path, "an autotile: a mapping with an id, name, mode, base, border, innerCorner and exportOrder", autotile, out);
    checkKeys(autotile, AUTOTILE_KEYS, path, "an autotile", out);
    if (required(autotile, "id", path, out)) checkLocalId(autotile.id, [...path, "id"], "autotiles", seen, index, out);
    if (required(autotile, "name", path, out)) checkText(autotile.name, [...path, "name"], "a display name", out);
    if (required(autotile, "mode", path, out)) checkLiteral(autotile.mode, [...path, "mode"], "blob-47", out);
    for (const part of ["base", "border", "innerCorner"] as const) {
      if (required(autotile, part, path, out)) checkSourceCell(autotile[part], [...path, part], SOURCE_CELL_KEYS, `the ${part} reference`, sourceIds, out);
    }
    if (required(autotile, "exportOrder", path, out)) checkLiteral(autotile.exportOrder, [...path, "exportOrder"], "t25-canonical", out);
  });
}

function checkOutputBinding(value: unknown, sourceFiles: readonly string[], out: Raw[]): void {
  if (!isObject(value)) return wrongType(["outputBinding"], "a mapping of target and detail", value, out);
  checkKeys(value, OUTPUT_KEYS, ["outputBinding"], "the output binding", out);
  if (required(value, "target", ["outputBinding"], out)) {
    const target = checkPath(value.target, ["outputBinding", "target"], "the project-relative path of the generated .tst", out);
    if (target !== null) {
      const extension = extensionOf(target);
      if (extension === null || foldId(extension) !== ".tst") out.push({ path: ["outputBinding", "target"], message: "must name the generated `.tst` output" });
      else if (classifyExtension(extension) === "native-registered") out.push({ path: ["outputBinding", "target"], message: "must not be a native document" });
      else if (sourceFiles.includes(comparable(target))) out.push({ path: ["outputBinding", "target"], message: "must not be a source file of this document; the build would overwrite it" });
    }
  }
  if (required(value, "detail", ["outputBinding"], out)) checkWhole(value.detail, ["outputBinding", "detail"], 1, undefined, out);
}

/** Whether `value` is something the free-form `metadata` may hold. */
function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every(isJson);
  if (!isObject(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  return Object.values(value).every(isJson);
}

/** Every rule the contract page gives for the document's content, on the JSON form of a document. */
function validateValue(value: unknown): Raw[] {
  const out: Raw[] = [];
  if (!isObject(value)) {
    wrongType([], "a mapping of keys to values", value, out);
    return out;
  }
  checkKeys(value, ROOT_KEYS, [], "the tileset contract", out);

  if (required(value, "contract", [], out) && value.contract !== TILESET_CONTRACT) {
    out.push({ path: ["contract"], message: `must be \`${TILESET_CONTRACT}\`` });
  }
  if (required(value, "version", [], out)) {
    const version = value.version;
    const parsed = typeof version === "string" ? parseVersion(version) : null;
    if (typeof version !== "string") wrongType(["version"], "text in the version form", version, out);
    else if (parsed === null || !parsed.ok) out.push({ path: ["version"], message: parsed !== null && !parsed.ok ? parsed.reason : "is not a version" });
    else if (parsed.major !== "1" || parsed.minor !== "0" || parsed.patch !== "0" || parsed.pre !== "1") {
      out.push({ path: ["version"], message: `\`${version}\` is not a version this reader knows; it reads ${TILESET_VERSION} (a \`+build\` suffix is allowed)` });
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

  if (required(value, "name", [], out)) checkText(value.name, ["name"], "a display name", out);
  if (required(value, "projection", [], out)) checkEnum(value.projection, ["projection"], PROJECTIONS, out);
  if (required(value, "cellSize", [], out)) {
    checkWholeList(value.cellSize, ["cellSize"], 2, 1, undefined, "a cell size: a list of two whole numbers of pixels, [width, height], at least 1", out);
  }

  const sourceIds = required(value, "sources", [], out) ? checkSources(value.sources, out) : null;
  if (required(value, "tiles", [], out)) checkTiles(value.tiles, sourceIds, out);
  if (Object.hasOwn(value, "isoBlocks")) checkIsoBlocks(value.isoBlocks, sourceIds, out);
  if (Object.hasOwn(value, "autotiles")) checkAutotiles(value.autotiles, sourceIds, out);

  const sourceFiles = Array.isArray(value.sources)
    ? value.sources.flatMap((source: unknown) => (isObject(source) && typeof source.file === "string" ? [comparable(source.file)] : []))
    : [];
  if (required(value, "outputBinding", [], out)) checkOutputBinding(value.outputBinding, sourceFiles, out);

  if (Object.hasOwn(value, "pluginData") && !isObject(value.pluginData)) {
    wrongType(["pluginData"], "a mapping of plugin ids to opaque plugin blocks", value.pluginData, out);
  }
  return out;
}

function toProblems(raw: readonly Raw[], lineOf: (path: ClipPath) => number | null): TilesetProblem[] {
  return raw.map((problem) => ({ kind: "shape", path: formatClipPath(problem.path), message: problem.message, line: lineOf(problem.path) }));
}

/** Check a tileset model, for example one an importer made, against every rule of the contract; nothing is written. */
export function checkTileset(tileset: unknown): readonly TilesetProblem[] {
  if (!isObject(tileset) || !Object.hasOwn(tileset, "pluginSource")) return toProblems(validateValue(tileset), () => null);
  const contract = { ...tileset };
  delete contract.pluginSource;
  return toProblems(validateValue(contract), () => null);
}

// ---------------------------------------------------------------- what a project checker needs

/** A path the document names, for a project checker to resolve: where it is written and what it says. */
export type TilesetAssetPath = {
  /** For example `sources[0].file`. */
  readonly path: string;
  /** `source`: a source image that must exist; `output`: the generated `.tst`, which is not read. */
  readonly role: "source" | "output";
  readonly value: string;
};

/** The project paths of a tileset: each source image, then the output target. */
export function tilesetAssetPaths(tileset: Tileset): readonly TilesetAssetPath[] {
  return [
    ...tileset.sources.map((source, index): TilesetAssetPath => ({ path: `sources[${index}].file`, role: "source", value: source.file })),
    { path: "outputBinding.target", role: "output", value: tileset.outputBinding.target },
  ];
}

/** A source cell the document uses, for a project checker to test against the source image's size. */
export type TilesetCellReference = { readonly path: string; readonly source: string; readonly cell: TilesetCell };

/** Every source cell a tileset uses: tiles, block faces and autotile references, in document order. */
export function tilesetCellReferences(tileset: Tileset): readonly TilesetCellReference[] {
  const found: TilesetCellReference[] = [];
  tileset.tiles.forEach((tile, index) => found.push({ path: `tiles[${index}].cell`, source: tile.source, cell: tile.cell }));
  tileset.isoBlocks?.forEach((block, index) => {
    for (const face of FACE_NAMES) found.push({ path: `isoBlocks[${index}].faces.${face}.cell`, source: block.faces[face].source, cell: block.faces[face].cell });
  });
  tileset.autotiles?.forEach((autotile, index) => {
    for (const part of ["base", "border", "innerCorner"] as const) found.push({ path: `autotiles[${index}].${part}.cell`, source: autotile[part].source, cell: autotile[part].cell });
  });
  return found;
}

/**
 * How many whole cells a grid addresses in an image of `width` by `height` pixels: after the
 * margin, each cell takes its size and a gap follows every cell but the last, and a partial final
 * cell is not addressable. A cell `[column, row]` lies inside the image when
 * `column < columns` and `row < rows`.
 */
export function tilesetCellBounds(grid: TilesetGrid, width: number, height: number): { readonly columns: number; readonly rows: number } {
  const count = (size: number, margin: number, cell: number, gap: number): number => Math.max(0, Math.floor((size - margin + gap) / (cell + gap)));
  return { columns: count(width, grid.marginX, grid.width, grid.gapX), rows: count(height, grid.marginY, grid.height, grid.gapY) };
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

/**
 * Read a tileset document and retain its original source. A missing, repeated, malformed or
 * not-first stamp is refused first, by the stamp rules of `readDocument`; then every rule of the
 * contract is checked, local references included. A document that holds plugin blocks also
 * carries an exact source token so a writer can refuse stale source.
 */
export function readTileset(text: string): TilesetReadResult {
  const stamp = readDocument({ path: "(tileset)", text }, []);
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
  const yamlProblems: TilesetProblem[] = document.errors.map((error) => ({
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
  const value: unknown = document.toJS();
  const raw = validateValue(value);
  if (raw.length > 0) return { ok: false, problems: toProblems(raw, lineLocator(document, lines)) };
  const tileset = value as Tileset;
  const entries = isMap(document.contents) ? document.contents.items : [];
  const pluginIndex = entries.findIndex((pair) => isScalar(pair.key) && pair.key.value === "pluginData");
  const pluginStart = pluginIndex < 0 ? undefined : (entries[pluginIndex]!.key as Node).range?.[0];
  // The block runs to the next top-level key, or to the end of the text when it is the last entry.
  const nextKey = pluginIndex < 0 ? undefined : (entries[pluginIndex + 1]?.key as Node | undefined)?.range?.[0];
  return {
    ok: true,
    tileset: pluginStart === undefined ? tileset : { ...tileset, pluginSource: text.slice(pluginStart, nextKey ?? text.length) },
    source: text,
  };
}

// ---------------------------------------------------------------- writing

const sourceCellOf = (reference: TilesetSourceCell): Record<string, unknown> => ({ source: reference.source, cell: [...reference.cell] });

function ordered(tileset: Tileset): Record<string, unknown> {
  const faceOf = (face: TilesetIsoFace): Record<string, unknown> => ({
    source: face.source,
    cell: [...face.cell],
    ...(face.tint === undefined ? {} : { tint: [...face.tint] }),
  });
  return {
    contract: tileset.contract,
    version: tileset.version,
    ...(tileset.tags === undefined ? {} : { tags: [...tileset.tags] }),
    ...(tileset.metadata === undefined ? {} : { metadata: tileset.metadata }),
    name: tileset.name,
    projection: tileset.projection,
    cellSize: [...tileset.cellSize],
    sources: tileset.sources.map((source) => ({
      id: source.id,
      file: source.file,
      grid: {
        width: source.grid.width,
        height: source.grid.height,
        marginX: source.grid.marginX,
        marginY: source.grid.marginY,
        gapX: source.grid.gapX,
        gapY: source.grid.gapY,
      },
      transparent: source.transparent.mode === "alpha" ? { mode: "alpha" } : { mode: "colorKey", color: [...source.transparent.color] },
    })),
    tiles: tileset.tiles.map((tile) => ({
      id: tile.id,
      name: tile.name,
      source: tile.source,
      cell: [...tile.cell],
      role: tile.role,
      collision: tile.collision,
      ...(tile.kitbash === undefined ? {} : { kitbash: tile.kitbash.map((operation) => ({ op: operation.op, diagonal: operation.diagonal, clearHalf: operation.clearHalf })) }),
    })),
    ...(tileset.isoBlocks === undefined
      ? {}
      : {
          isoBlocks: tileset.isoBlocks.map((block) => ({
            id: block.id,
            name: block.name,
            heightPixels: block.heightPixels,
            faces: { top: faceOf(block.faces.top), left: faceOf(block.faces.left), right: faceOf(block.faces.right) },
            collision: block.collision,
            ...(block.wallCapUnder === undefined ? {} : { wallCapUnder: block.wallCapUnder }),
          })),
        }),
    ...(tileset.autotiles === undefined
      ? {}
      : {
          autotiles: tileset.autotiles.map((autotile) => ({
            id: autotile.id,
            name: autotile.name,
            mode: autotile.mode,
            base: sourceCellOf(autotile.base),
            border: sourceCellOf(autotile.border),
            innerCorner: sourceCellOf(autotile.innerCorner),
            exportOrder: autotile.exportOrder,
          })),
        }),
    outputBinding: { target: tileset.outputBinding.target, detail: tileset.outputBinding.detail },
  };
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

/** The small mappings the layout writes on one line. */
const FLOW_MAPS: readonly unknown[] = ["transparent", "top", "left", "right", "base", "border", "innerCorner"];

/**
 * Write a tileset as YAML text. With the original `source` the text is returned unchanged, and
 * only when it still reads as exactly this model: nothing is printed from a parsed tree, so
 * comments, quoting and plugin blocks stay as authored. A model that holds plugin blocks has no
 * other way to be written. Without a source, a new document is laid out in the contract's key
 * order: block mappings, two-space indent, and lists of numbers or text and the small mappings
 * (`transparent`, a face, a source-cell reference) in flow style. The layout is provisional, as
 * the clip's is.
 */
export function writeTileset(tileset: Tileset, source?: string): TilesetWriteResult {
  const problems = checkTileset(tileset);
  if (problems.length > 0) return { ok: false, problems };

  if ((tileset.pluginData !== undefined || tileset.pluginSource !== undefined) && source === undefined) {
    return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  }
  if (source !== undefined) {
    const parsed = readTileset(source);
    if (!parsed.ok) return { ok: false, problems: parsed.problems };
    if (!sameValue(parsed.tileset, tileset)) {
      return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested tileset", line: null }] };
    }
    return { ok: true, text: source };
  }

  const document = new Document(ordered(tileset), { version: "1.2", schema: "core" });
  visit(document, {
    Seq(_key, node) {
      if (node.items.every((item) => isScalar(item))) node.flow = true;
    },
    Pair(_key, pair) {
      if (isScalar(pair.key) && FLOW_MAPS.includes(pair.key.value) && isMap(pair.value)) pair.value.flow = true;
    },
  });
  return { ok: true, text: document.toString({ lineWidth: 0, flowCollectionPadding: false }) };
}

// ---------------------------------------------------------------- editing

/** A value an edit can set: text, a number or a boolean. Lists and mappings are not set whole. */
export type TilesetEditValue = string | number | boolean;

export type TilesetEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly TilesetProblem[] };

/** What `plan*` return instead of splices when an edit cannot be made. */
type EditError = { readonly error: string };

type Context = { readonly text: string; readonly document: Document.Parsed; readonly lines: LineCounter };

const editText = (value: TilesetEditValue, like: Node | null): string =>
  typeof value === "boolean" ? String(value) : scalarText(value, isScalar(like) ? like : null);

function planReplace(context: Context, node: unknown, value: TilesetEditValue): Splice[] | EditError {
  if (!isScalar(node) || node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL") return { error: "the value is not a one-line scalar, so it cannot be replaced in place" };
  if (node.anchor !== undefined) return { error: "the value is anchored, so another place may share it; it cannot be replaced in place" };
  const [start, end] = rangeOf(node);
  if (context.text.slice(start, end).includes("\n")) return { error: "the value runs over more than one line, so it cannot be replaced in place" };
  return [{ start, end, text: editText(value, node) }];
}

/**
 * The one key that may be absent and set: an isometric block's `wallCapUnder`, which follows
 * `collision`, the entry before it in the contract's key order.
 */
function planInsert(context: Context, parent: YAMLMap, path: ClipPath, value: TilesetEditValue): Splice[] | EditError {
  const isWallCap = path.length === 3 && path[0] === "isoBlocks" && typeof path[1] === "number" && path[2] === "wallCapUnder";
  if (!isWallCap) return { error: "there is no such key; only an isometric block's `wallCapUnder` can be added to a document" };
  if (typeof value !== "boolean") return { error: "`wallCapUnder` is true or false" };
  const collision = parent.items.find((pair) => isScalar(pair.key) && pair.key.value === "collision");
  if (collision === undefined || !isScalar(collision.value)) return { error: "there is no `collision` entry for `wallCapUnder` to follow" };
  const { text, lines } = context;
  const end = rangeOf(collision.value)[1];
  const entry = `wallCapUnder: ${value}`;
  if (parent.flow === true) return [{ start: end, end, text: `, ${entry}` }];
  const first = parent.items[0]!.key as Node;
  const indent = " ".repeat(lines.linePos(rangeOf(first)[0]).col - 1);
  const newline = text.indexOf("\n", end);
  const crlf = newline > 0 && text[newline - 1] === "\r";
  const at = newline < 0 ? text.length : crlf ? newline - 1 : newline;
  return [{ start: at, end: at, text: `${crlf ? "\r\n" : "\n"}${indent}${entry}` }];
}

function planSet(context: Context, path: ClipPath, value: TilesetEditValue): Splice[] | EditError {
  const last = path.at(-1);
  if (last === undefined) return { error: "an edit names a place in the document" };
  if (typeof value === "number" && !Number.isFinite(value)) return { error: "a number must be finite" };
  const parentPath = path.slice(0, -1);
  const parent: unknown = context.document.getIn(parentPath, true);
  if (isSeq(parent)) {
    if (typeof last !== "number" || last < 0 || last >= parent.items.length) return { error: "there is no such list entry; adding or removing list entries is not an edit this reader makes" };
    return planReplace(context, parent.items[last], value);
  }
  if (!isMap(parent) || typeof last !== "string") return { error: "there is no such place in the document" };
  const pair = parent.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === last);
  if (pair === undefined) return planInsert(context, parent, path, value);
  return planReplace(context, pair.value, value);
}

/**
 * Set one property of an existing tileset document in place, for example
 * `["tiles", 0, "collision"]` to `"solid"` or `["tiles", 0, "cell", 1]` to `2`. Only the text of
 * the value changes: a replaced value is a splice into the original text, so every other byte,
 * every comment, the quoting and the plugin blocks stay as written. A plugin block is opaque
 * here and cannot be edited. Setting an isometric block's absent `wallCapUnder` adds one line
 * (or one `, wallCapUnder: ...` in a flow mapping). A document the reader refuses is not edited,
 * and an edit that would leave one (an invalid value, a dangling local reference) is not made.
 */
export function setTilesetProperty(text: string, path: TilesetPath, value: TilesetEditValue): TilesetEditResult {
  if (path[0] === "pluginData") {
    return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: "plugin blocks are opaque and cannot be edited by the tileset writer", line: null }] };
  }
  const before = readTileset(text);
  if (!before.ok) return before;
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const splices = planSet({ text, document, lines }, path, value);
  if (!Array.isArray(splices)) return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: (splices as EditError).error, line: null }] };

  const edited = applySplices(text, splices);
  const after = readTileset(edited);
  if (!after.ok) {
    return { ok: false, problems: after.problems.map((problem) => ({ ...problem, message: `the edit would leave a document the reader refuses: ${problem.message}` })) };
  }
  if (after.tileset.pluginSource !== before.tileset.pluginSource) {
    return { ok: false, problems: [{ kind: "edit", path: formatClipPath(path), message: "the edit would change a plugin block, which this writer never changes", line: null }] };
  }
  return { ok: true, text: edited };
}
