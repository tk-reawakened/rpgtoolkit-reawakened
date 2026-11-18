/**
 * The native asset pack (docs/spec/formats/native-asset-pack.md): the typed model, the
 * reader, the writer and the in-place edit.
 *
 * Reference reader, writer and editor for contract `asset-pack`, version `1.0.0-pre.1`.
 * It follows the clip module's conventions (`clip.ts`): the same result and problem shapes,
 * the same refusal to regenerate plugin blocks, and the same splice-based edit. Everything
 * works on text already in memory: no file, image, timer or host API is touched (G2). A
 * source's `file` is checked only to be a project-relative path; whether the file
 * exists, and whether a visual's crop lies inside its image, are questions for the project
 * checker, which can see the files.
 *
 * The contract's field layout is settled, but the layout of a written document is not
 * prescribed, so it is provisional here: the stamp first, block mappings for records, and
 * flow style for the small geometric values (`anchor`, `rect`, `points`, colours, `tags`),
 * as in the contract's illustration.
 */

import {
  Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";
import { formatClipPath, type ClipJson, type ClipPath } from "./clip.ts";
import { readDocument } from "./document.ts";
import { validatePluginData, type PluginBlockProblem } from "./plugin-data.ts";
import { applySplices, rangeOf, scalarText, type Splice } from "./splice.ts";
import { parseVersion } from "./version.ts";

export const ASSET_PACK_CONTRACT = "asset-pack";
export const ASSET_PACK_VERSION = "1.0.0-pre.1";

/** The pack-wide layout every asset inherits. */
export const ASSET_PACK_PROJECTIONS = ["2d", "iso-stacked", "iso-rotated"] as const;
export type AssetPackProjection = (typeof ASSET_PACK_PROJECTIONS)[number];

/** What an asset is for. The kind does not change placement or collision rules. */
export const ASSET_PACK_KINDS = ["stamp", "prop", "backdrop"] as const;
export type AssetPackKind = (typeof ASSET_PACK_KINDS)[number];

/**
 * The snap modes the contract recommends. The vocabulary is open to the owner's review, so
 * the checker accepts any snap written in the shared identifier form and this list is advice.
 */
export const ASSET_PACK_RECOMMENDED_SNAPS = ["bottom-center", "iso-diamond-center"] as const;

/** Anything the free-form `metadata` may hold: JSON values. */
export type AssetPackJson = ClipJson;

/** A source's transparency rule: the source's own alpha, or one RGB value taken as transparent. */
export type AssetPackTransparency =
  | { readonly mode: "alpha" }
  | { readonly mode: "colorKey"; readonly color: readonly [number, number, number] };

export type AssetPackSource = {
  /** Local to the pack; visuals name it. */
  readonly id: string;
  /** A project asset path with `/` separators; not a native document ID. */
  readonly file: string;
  /** Absent means the contract states no transparency rule. */
  readonly transparent?: AssetPackTransparency;
};

export type AssetPackAnchor = { readonly x: number; readonly y: number; readonly snap: string };

export type AssetPackVisual = {
  /** The `id` of a source in this pack. */
  readonly source: string;
  /** `[x, y, width, height]` of the crop, in the source's pixels; the size is positive. */
  readonly rect: readonly [number, number, number, number];
  /** Board layer steps; absent means 0. */
  readonly layerOffset?: number;
};

/** A labeled shape of integer points, offsets in logical pixels from the asset anchor. */
export type AssetPackVector = {
  readonly label: string;
  readonly closed: boolean;
  readonly points: readonly (readonly [number, number])[];
};

/** A walk-behind region: a closed polygon with the existing mask bits (1, 2 and 4). */
export type AssetPackUnderVector = AssetPackVector & { readonly attributes: number };

export type AssetPackAsset = {
  /** Local to the pack; a scene selects an asset by the pack's path and this ID. */
  readonly id: string;
  readonly name: string;
  readonly category?: string;
  readonly kind: AssetPackKind;
  readonly anchor: AssetPackAnchor;
  readonly visuals: readonly AssetPackVisual[];
  readonly solid?: readonly AssetPackVector[];
  readonly under?: readonly AssetPackUnderVector[];
};

export type AssetPack = {
  readonly contract: typeof ASSET_PACK_CONTRACT;
  /** The stamp's version as written, with any `+build` suffix. */
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: AssetPackJson };
  readonly name: string;
  readonly projection: AssetPackProjection;
  readonly grid: { readonly tileWidth: number; readonly tileHeight: number };
  readonly sources: readonly AssetPackSource[];
  readonly assets: readonly AssetPackAsset[];
  /** Exact source of the `pluginData` block, from its key to the end of its last line; used only to verify opaque block preservation. */
  readonly pluginSource?: string;
  /** Opaque plugin envelopes; never regenerated from these parsed values. */
  readonly pluginData?: {
    readonly [pluginId: string]: {
      readonly version: string;
      readonly data: { readonly [key: string]: AssetPackJson };
    };
  };
};

/** Why a document, model or edit is refused. */
export type AssetPackProblem = {
  /** `stamp`: the document's stamp; `shape`: the contract; `plugin-block`: an opaque plugin envelope; `edit`: an edit that cannot be made. */
  readonly kind: "stamp" | "shape" | "plugin-block" | "edit";
  /** Specific shared-validator kind when `kind` is `plugin-block`. */
  readonly pluginKind?: PluginBlockProblem["kind"];
  /** Where, for example `assets[1].visuals[0].source`; `(document)` for the whole document. */
  readonly path: string;
  /** What is wrong, in words. */
  readonly message: string;
  /** 1-based line in the text, or `null` when there is none. */
  readonly line: number | null;
};

export type AssetPackReadResult =
  | { readonly ok: true; readonly assetPack: AssetPack; readonly source: string }
  | { readonly ok: false; readonly problems: readonly AssetPackProblem[] };

export type AssetPackWriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly AssetPackProblem[] };

export type AssetPackPath = ClipPath;

export const formatAssetPackPath: (path: AssetPackPath) => string = formatClipPath;

/** One line per problem, for an error message or a command's output. */
export function formatAssetPackProblems(problems: readonly AssetPackProblem[]): string {
  return problems.map((problem) => `${problem.path}${problem.line === null ? "" : ` (line ${problem.line})`}: ${problem.message}`).join("\n");
}

// ---------------------------------------------------------------- validation

type Raw = { readonly path: AssetPackPath; readonly message: string };

/** The shared authoring form of a local ID: lowercase kebab-case. */
const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ROOT_KEYS = ["contract", "version", "tags", "metadata", "name", "projection", "grid", "sources", "assets", "pluginData"] as const;
const GRID_KEYS = ["tileWidth", "tileHeight"] as const;
const SOURCE_KEYS = ["id", "file", "transparent"] as const;
const TRANSPARENT_KEYS = ["mode", "color"] as const;
const ASSET_KEYS = ["id", "name", "category", "kind", "anchor", "visuals", "solid", "under"] as const;
const ANCHOR_KEYS = ["x", "y", "snap"] as const;
const VISUAL_KEYS = ["source", "rect", "layerOffset"] as const;
const SOLID_KEYS = ["label", "closed", "points"] as const;
const UNDER_KEYS = ["label", "attributes", "closed", "points"] as const;

/** Mask bits an `under` region may use: 1 background, 2 lower layers, 4 intersects the frame. */
const MAX_ATTRIBUTES = 7;

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
function wrongType(path: AssetPackPath, wanted: string, value: unknown, out: Raw[]): void {
  const extra = value === null || value === undefined ? `; it is ${describe(value)}, and no key accepts that: leave the key out` : `; it is ${describe(value)}`;
  out.push({ path, message: `must be ${wanted}${extra}` });
}

function checkKeys(value: Record<string, unknown>, known: readonly string[], path: AssetPackPath, owner: string, out: Raw[]): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) out.push({ path: [...path, key], message: `\`${key}\` is not a key of ${owner}; the contract is closed` });
  }
}

function required(value: Record<string, unknown>, key: string, path: AssetPackPath, out: Raw[]): boolean {
  if (Object.hasOwn(value, key)) return true;
  out.push({ path, message: `\`${key}\` is required` });
  return false;
}

function checkWhole(value: unknown, path: AssetPackPath, wanted: string, out: Raw[], min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) wrongType(path, wanted, value, out);
}

function checkText(value: unknown, path: AssetPackPath, wanted: string, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, wanted, value, out);
  if (value.trim() === "") out.push({ path, message: "is empty text, which is not accepted; leave an optional key out for no value" });
}

function checkLocalId(value: unknown, path: AssetPackPath, out: Raw[]): value is string {
  if (typeof value !== "string") {
    wrongType(path, "text: a lowercase kebab-case ID", value, out);
    return false;
  }
  if (!LOCAL_ID.test(value)) {
    out.push({ path, message: `\`${value}\` is not a local ID: use lowercase letters and digits joined by single hyphens` });
    return false;
  }
  return true;
}

function checkEnum(value: unknown, allowed: readonly string[], path: AssetPackPath, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, `one of ${allowed.map((item) => `\`${item}\``).join(", ")}`, value, out);
  if (!allowed.includes(value)) out.push({ path, message: `\`${value}\` is not one of ${allowed.map((item) => `\`${item}\``).join(", ")}` });
}

/** A source `file` is non-empty text naming a project-relative asset path; the contract states no other form restriction. */
function checkAssetFile(value: unknown, path: AssetPackPath, out: Raw[]): void {
  if (typeof value !== "string") return wrongType(path, "text: a project asset path", value, out);
  if (value === "") out.push({ path, message: "is empty text, which is not an asset path" });
  else if (value.startsWith("/")) out.push({ path, message: "must be relative to the project, not an absolute path" });
}

function checkColour(value: unknown, path: AssetPackPath, out: Raw[]): void {
  if (!Array.isArray(value) || value.length !== 3) return wrongType(path, "a colour: a list of red, green and blue", value, out);
  value.forEach((channel: unknown, index) => checkWhole(channel, [...path, index], "a whole number from 0 to 255", out, 0, 255));
}

function checkSource(value: unknown, path: AssetPackPath, ids: Set<string>, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "a source: a mapping with an id and a file", value, out);
  checkKeys(value, SOURCE_KEYS, path, "a source", out);
  if (required(value, "id", [...path, "id"], out) && checkLocalId(value.id, [...path, "id"], out)) {
    if (ids.has(value.id)) out.push({ path: [...path, "id"], message: `the source ID \`${value.id}\` is used more than once in this pack` });
    ids.add(value.id);
  }
  if (required(value, "file", [...path, "file"], out)) checkAssetFile(value.file, [...path, "file"], out);
  if (!Object.hasOwn(value, "transparent")) return;

  const transparent = value.transparent;
  const where = [...path, "transparent"];
  if (!isObject(transparent)) return wrongType(where, "a mapping with a mode", transparent, out);
  checkKeys(transparent, TRANSPARENT_KEYS, where, "a transparency rule", out);
  if (!required(transparent, "mode", [...where, "mode"], out)) return;
  checkEnum(transparent.mode, ["alpha", "colorKey"], [...where, "mode"], out);
  if (transparent.mode === "colorKey") {
    if (required(transparent, "color", [...where, "color"], out)) checkColour(transparent.color, [...where, "color"], out);
  } else if (transparent.mode === "alpha" && Object.hasOwn(transparent, "color")) {
    out.push({ path: [...where, "color"], message: "is only for the `colorKey` mode; `alpha` keeps the source's own alpha" });
  }
}

function checkAnchor(value: unknown, path: AssetPackPath, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "an anchor: a mapping of x, y and snap", value, out);
  checkKeys(value, ANCHOR_KEYS, path, "an anchor", out);
  for (const key of ["x", "y"] as const) {
    if (required(value, key, [...path, key], out)) checkWhole(value[key], [...path, key], "a whole number of logical pixels", out);
  }
  if (required(value, "snap", [...path, "snap"], out)) checkLocalId(value.snap, [...path, "snap"], out);
}

function checkVisual(value: unknown, path: AssetPackPath, sourceIds: ReadonlySet<string> | null, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "a visual: a mapping with a source and a rect", value, out);
  checkKeys(value, VISUAL_KEYS, path, "a visual", out);
  if (required(value, "source", [...path, "source"], out)) {
    const source = value.source;
    if (typeof source !== "string") wrongType([...path, "source"], "text: the ID of a source in this pack", source, out);
    else if (sourceIds !== null && !sourceIds.has(source)) {
      out.push({ path: [...path, "source"], message: `\`${source}\` is not the ID of a source in this pack; nothing is substituted for it` });
    }
  }
  if (required(value, "rect", [...path, "rect"], out)) {
    const rect = value.rect;
    const where = [...path, "rect"];
    if (!Array.isArray(rect) || rect.length !== 4) wrongType(where, "a crop: a list of x, y, width and height", rect, out);
    else {
      checkWhole(rect[0], [...where, 0], "a whole number of pixels, 0 or more", out, 0);
      checkWhole(rect[1], [...where, 1], "a whole number of pixels, 0 or more", out, 0);
      checkWhole(rect[2], [...where, 2], "a whole number of pixels, at least 1", out, 1);
      checkWhole(rect[3], [...where, 3], "a whole number of pixels, at least 1", out, 1);
    }
  }
  if (Object.hasOwn(value, "layerOffset")) checkWhole(value.layerOffset, [...path, "layerOffset"], "a whole number of board layer steps", out);
}

function checkVector(value: unknown, path: AssetPackPath, under: boolean, out: Raw[]): void {
  const purpose = under ? "a walk-behind (`under`) region" : "a collision (`solid`) outline";
  if (!isObject(value)) return wrongType(path, `${purpose}: a mapping with a label, closed and points`, value, out);
  if (!under && Object.hasOwn(value, "attributes")) {
    out.push({ path: [...path, "attributes"], message: "belongs only on `under` regions; a `solid` outline has no mask" });
  }
  checkKeys(
    value,
    under ? UNDER_KEYS : [...SOLID_KEYS, "attributes"],
    path,
    purpose,
    out,
  );
  if (required(value, "label", [...path, "label"], out)) checkText(value.label, [...path, "label"], "text: a label", out);

  let closed: boolean | null = null;
  if (required(value, "closed", [...path, "closed"], out)) {
    if (typeof value.closed !== "boolean") wrongType([...path, "closed"], "true or false", value.closed, out);
    else {
      closed = value.closed;
      if (under && !closed) out.push({ path: [...path, "closed"], message: "must be true: a walk-behind region is a closed polygon" });
    }
  }
  if (under && required(value, "attributes", [...path, "attributes"], out)) {
    checkWhole(value.attributes, [...path, "attributes"], `a whole number from 0 to ${MAX_ATTRIBUTES}: the mask of bits 1, 2 and 4`, out, 0, MAX_ATTRIBUTES);
  }
  if (!required(value, "points", [...path, "points"], out)) return;

  const points = value.points;
  const where = [...path, "points"];
  if (!Array.isArray(points)) return wrongType(where, "a list of [x, y] points", points, out);
  points.forEach((point: unknown, index) => {
    if (!Array.isArray(point) || point.length !== 2) return wrongType([...where, index], "a point: a list of x and y", point, out);
    checkWhole(point[0], [...where, index, 0], "a whole number of logical pixels", out);
    checkWhole(point[1], [...where, index, 1], "a whole number of logical pixels", out);
  });
  if (closed !== null) {
    const least = closed ? 3 : 2;
    if (points.length < least) out.push({ path: where, message: `a ${closed ? "closed" : "open"} shape needs at least ${least} points; this has ${points.length}` });
  }
}

function checkVectors(value: unknown, path: AssetPackPath, under: boolean, out: Raw[]): void {
  if (!Array.isArray(value)) return wrongType(path, under ? "a list of walk-behind regions" : "a list of collision outlines", value, out);
  value.forEach((vector: unknown, index) => checkVector(vector, [...path, index], under, out));
}

function checkAsset(value: unknown, path: AssetPackPath, sourceIds: ReadonlySet<string> | null, ids: Set<string>, out: Raw[]): void {
  if (!isObject(value)) return wrongType(path, "an asset: a mapping with an id, name, kind, anchor and visuals", value, out);
  checkKeys(value, ASSET_KEYS, path, "an asset", out);
  if (required(value, "id", [...path, "id"], out) && checkLocalId(value.id, [...path, "id"], out)) {
    if (ids.has(value.id)) out.push({ path: [...path, "id"], message: `the asset ID \`${value.id}\` is used more than once in this pack` });
    ids.add(value.id);
  }
  if (required(value, "name", [...path, "name"], out)) checkText(value.name, [...path, "name"], "text: the display name", out);
  if (Object.hasOwn(value, "category")) checkText(value.category, [...path, "category"], "text: a category", out);
  if (required(value, "kind", [...path, "kind"], out)) checkEnum(value.kind, ASSET_PACK_KINDS, [...path, "kind"], out);
  if (required(value, "anchor", [...path, "anchor"], out)) checkAnchor(value.anchor, [...path, "anchor"], out);
  if (required(value, "visuals", [...path, "visuals"], out)) {
    const visuals = value.visuals;
    if (!Array.isArray(visuals)) wrongType([...path, "visuals"], "a list of visuals", visuals, out);
    else if (visuals.length === 0) out.push({ path: [...path, "visuals"], message: "must list at least one visual" });
    else visuals.forEach((visual: unknown, index) => checkVisual(visual, [...path, "visuals", index], sourceIds, out));
  }
  if (Object.hasOwn(value, "solid")) checkVectors(value.solid, [...path, "solid"], false, out);
  if (Object.hasOwn(value, "under")) checkVectors(value.under, [...path, "under"], true, out);
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
  checkKeys(value, ROOT_KEYS, [], "the asset-pack contract", out);

  if (required(value, "contract", ["contract"], out) && value.contract !== ASSET_PACK_CONTRACT) {
    out.push({ path: ["contract"], message: `must be \`${ASSET_PACK_CONTRACT}\`` });
  }
  if (required(value, "version", ["version"], out)) {
    const version = value.version;
    const parsed = typeof version === "string" ? parseVersion(version) : null;
    if (typeof version !== "string") wrongType(["version"], "text in the version form", version, out);
    else if (parsed === null || !parsed.ok) out.push({ path: ["version"], message: parsed !== null && !parsed.ok ? parsed.reason : "is not a version" });
    else if (parsed.major !== "1" || parsed.minor !== "0" || parsed.patch !== "0" || parsed.pre !== "1") {
      out.push({ path: ["version"], message: `\`${version}\` is not a version this reader knows; it reads ${ASSET_PACK_VERSION} (a \`+build\` suffix is allowed)` });
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

  if (required(value, "name", ["name"], out)) checkText(value.name, ["name"], "text: the pack's display name", out);
  if (required(value, "projection", ["projection"], out)) checkEnum(value.projection, ASSET_PACK_PROJECTIONS, ["projection"], out);
  if (required(value, "grid", ["grid"], out)) {
    const grid = value.grid;
    if (!isObject(grid)) wrongType(["grid"], "a mapping of tileWidth and tileHeight", grid, out);
    else {
      checkKeys(grid, GRID_KEYS, ["grid"], "the grid", out);
      for (const key of GRID_KEYS) {
        if (required(grid, key, ["grid", key], out)) checkWhole(grid[key], ["grid", key], "a whole number of logical pixels, at least 1", out, 1);
      }
    }
  }

  let sourceIds: Set<string> | null = null;
  if (required(value, "sources", ["sources"], out)) {
    const sources = value.sources;
    if (!Array.isArray(sources)) wrongType(["sources"], "a list of sources", sources, out);
    else if (sources.length === 0) out.push({ path: ["sources"], message: "must list at least one source" });
    else {
      const ids = new Set<string>();
      sources.forEach((source: unknown, index) => checkSource(source, ["sources", index], ids, out));
      sourceIds = ids;
    }
  }
  if (required(value, "assets", ["assets"], out)) {
    const assets = value.assets;
    if (!Array.isArray(assets)) wrongType(["assets"], "a list of assets", assets, out);
    else if (assets.length === 0) out.push({ path: ["assets"], message: "must list at least one asset" });
    else {
      const ids = new Set<string>();
      assets.forEach((asset: unknown, index) => checkAsset(asset, ["assets", index], sourceIds, ids, out));
    }
  }
  if (Object.hasOwn(value, "pluginData") && !isObject(value.pluginData)) {
    wrongType(["pluginData"], "a mapping of plugin ids to opaque plugin blocks", value.pluginData, out);
  }
  return out;
}

function toProblems(raw: readonly Raw[], lineOf: (path: AssetPackPath) => number | null): AssetPackProblem[] {
  return raw.map((problem) => ({ kind: "shape", path: formatAssetPackPath(problem.path), message: problem.message, line: lineOf(problem.path) }));
}

/** Check an asset-pack model, for example one an importer made, against every rule of the contract; nothing is written. */
export function checkAssetPack(pack: unknown): readonly AssetPackProblem[] {
  if (!isObject(pack) || !Object.hasOwn(pack, "pluginSource")) return toProblems(validateValue(pack), () => null);
  const contract = { ...pack };
  delete contract.pluginSource;
  return toProblems(validateValue(contract), () => null);
}

// ---------------------------------------------------------------- reading

/** 1-based line of the place `path` names in a parsed document, or `null` when it cannot be found. */
function lineLocator(document: Document.Parsed, lines: LineCounter): (path: AssetPackPath) => number | null {
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
 * Read an asset-pack document and retain its original source. A missing, repeated,
 * malformed or not-first stamp is refused first, by the stamp rules of `readDocument`; then
 * every rule of the contract is checked. Plugin-bearing packs also carry an exact source
 * token so a writer can refuse stale source. The token covers the `pluginData` block only.
 */
export function readAssetPack(text: string): AssetPackReadResult {
  const stamp = readDocument({ path: "(asset-pack)", text }, []);
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
  const yamlProblems: AssetPackProblem[] = document.errors.map((error) => ({
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
  const pack = value as AssetPack;
  const pluginEntry = isMap(document.contents)
    ? document.contents.items.find((pair) => isScalar(pair.key) && pair.key.value === "pluginData")
    : undefined;
  let pluginSource: string | undefined;
  if (pluginEntry !== undefined) {
    // The block is the `pluginData` key through the end of the line holding its last value, with any
    // comment on that line: text after it (other top-level fields) is not the plugin's.
    const start = rangeOf(pluginEntry.key as Node)[0];
    const valueEnd = pairEnd(pluginEntry);
    const newline = text.indexOf("\n", valueEnd);
    let end = newline < 0 ? text.length : newline;
    if (end > valueEnd && text[end - 1] === "\r") end -= 1;
    pluginSource = text.slice(start, end);
  }
  return {
    ok: true,
    assetPack: pluginSource === undefined ? pack : { ...pack, pluginSource },
    source: text,
  };
}

// ---------------------------------------------------------------- writing

function ordered(pack: AssetPack): Record<string, unknown> {
  const vector = (source: AssetPackVector | AssetPackUnderVector): Record<string, unknown> => ({
    label: source.label,
    ...("attributes" in source ? { attributes: source.attributes } : {}),
    closed: source.closed,
    points: source.points.map((point) => [point[0], point[1]]),
  });
  const asset = (source: AssetPackAsset): Record<string, unknown> => ({
    id: source.id,
    name: source.name,
    ...(source.category === undefined ? {} : { category: source.category }),
    kind: source.kind,
    anchor: { x: source.anchor.x, y: source.anchor.y, snap: source.anchor.snap },
    visuals: source.visuals.map((visual) => ({
      source: visual.source,
      rect: [...visual.rect],
      ...(visual.layerOffset === undefined ? {} : { layerOffset: visual.layerOffset }),
    })),
    ...(source.solid === undefined ? {} : { solid: source.solid.map(vector) }),
    ...(source.under === undefined ? {} : { under: source.under.map(vector) }),
  });
  const transparent = (source: AssetPackTransparency): Record<string, unknown> =>
    source.mode === "alpha" ? { mode: "alpha" } : { mode: "colorKey", color: [...source.color] };
  return {
    contract: pack.contract,
    version: pack.version,
    ...(pack.tags === undefined ? {} : { tags: [...pack.tags] }),
    ...(pack.metadata === undefined ? {} : { metadata: pack.metadata }),
    name: pack.name,
    projection: pack.projection,
    grid: { tileWidth: pack.grid.tileWidth, tileHeight: pack.grid.tileHeight },
    sources: pack.sources.map((source) => ({
      id: source.id,
      file: source.file,
      ...(source.transparent === undefined ? {} : { transparent: transparent(source.transparent) }),
    })),
    assets: pack.assets.map(asset),
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
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key], seen));
}

/**
 * Write an asset pack as YAML text. With the document's `source`, the source is returned
 * unchanged when it still reads as exactly this pack, so comments and plugin blocks stay
 * byte for byte; a pack that no longer matches its source is refused rather than reprinted.
 * Plugin-bearing packs are returned only from their matching source; parsed plugin values
 * are never printed or normalized.
 */
export function writeAssetPack(pack: AssetPack, source?: string): AssetPackWriteResult {
  const problems = checkAssetPack(pack);
  if (problems.length > 0) return { ok: false, problems };

  if ((pack.pluginData !== undefined || pack.pluginSource !== undefined) && source === undefined) {
    return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  }
  if (source !== undefined) {
    const parsed = readAssetPack(source);
    if (!parsed.ok) return { ok: false, problems: parsed.problems };
    if (!sameValue(parsed.assetPack, pack)) {
      return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested asset pack", line: null }] };
    }
    return { ok: true, text: source };
  }

  const document = new Document(ordered(pack), { version: "1.2", schema: "core" });
  const flow = (path: readonly (string | number)[]): void => {
    const node = document.getIn(path, true);
    if ((isMap(node) || isSeq(node)) && node.flow !== true) node.flow = true;
  };
  flow(["tags"]);
  pack.sources.forEach((_, index) => {
    flow(["sources", index, "transparent"]);
    flow(["sources", index, "transparent", "color"]);
  });
  pack.assets.forEach((asset, index) => {
    flow(["assets", index, "anchor"]);
    asset.visuals.forEach((_, visual) => flow(["assets", index, "visuals", visual, "rect"]));
    for (const kind of ["solid", "under"] as const) {
      (asset[kind] ?? []).forEach((vector, at) => {
        flow(["assets", index, kind, at, "points"]);
        vector.points.forEach((_, point) => flow(["assets", index, kind, at, "points", point]));
      });
    }
  });
  return { ok: true, text: document.toString({ lineWidth: 0, flowCollectionPadding: false }) };
}

// ---------------------------------------------------------------- editing

/** A scalar, or a list of whole numbers (nested for `points`) that replaces an existing one-line flow list. */
export type AssetPackEditValue = string | number | boolean | readonly AssetPackEditNumbers[];
export type AssetPackEditNumbers = number | readonly AssetPackEditNumbers[];

export type AssetPackEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly AssetPackProblem[] };

/** What `plan*` return instead of splices when an edit cannot be made. */
type EditError = { readonly error: string };

/** The order a contract's keys are written in, so an added key lands where a reader expects it. */
function keyOrder(path: AssetPackPath): readonly string[] {
  const [first, , third] = path;
  if (path.length === 0) return ROOT_KEYS;
  if (path.length === 1 && first === "grid") return GRID_KEYS;
  if (path.length === 2 && first === "sources") return SOURCE_KEYS;
  if (path.length === 3 && first === "sources" && third === "transparent") return TRANSPARENT_KEYS;
  if (path.length === 2 && first === "assets") return ASSET_KEYS;
  if (path.length === 3 && first === "assets" && third === "anchor") return ANCHOR_KEYS;
  if (path.length === 4 && first === "assets" && third === "visuals") return VISUAL_KEYS;
  if (path.length === 4 && first === "assets" && third === "solid") return SOLID_KEYS;
  if (path.length === 4 && first === "assets" && third === "under") return UNDER_KEYS;
  return [];
}

type Context = { readonly text: string; readonly document: Document.Parsed; readonly lines: LineCounter };

/** The offset just past the last character of a pair's value, before any comment. */
function pairEnd(pair: Pair): number {
  const value = pair.value as Node | null;
  if (value === null || value === undefined) return rangeOf(pair.key as Node)[1];
  return nodeEnd(value);
}

function nodeEnd(node: Node): number {
  if ((isMap(node) || isSeq(node)) && node.flow !== true) {
    const last = node.items.at(-1);
    if (last === undefined) return rangeOf(node)[1];
    return isMap(node) ? pairEnd(last as Pair) : nodeEnd(last as Node);
  }
  return rangeOf(node)[1];
}

function listText(value: readonly AssetPackEditNumbers[]): string {
  return `[${value.map((item) => (typeof item === "number" ? String(item) : listText(item))).join(", ")}]`;
}

function planReplace(context: Context, node: unknown, value: AssetPackEditValue): Splice[] | EditError {
  const [start, end] = isScalar(node) || isSeq(node) ? rangeOf(node as Node) : [0, 0];
  if (typeof value === "object") {
    if (!isSeq(node) || node.flow !== true) return { error: "only an existing one-line list written in flow style, such as `[0, 0, 32, 32]`, can be replaced by a list" };
    if (context.text.slice(start, end).includes("\n")) return { error: "the list runs over more than one line, so it cannot be replaced in place" };
    return [{ start, end, text: listText(value) }];
  }
  if (!isScalar(node) || node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL") return { error: "the value is not a one-line scalar, so it cannot be replaced in place" };
  if (context.text.slice(start, end).includes("\n")) return { error: "the value runs over more than one line, so it cannot be replaced in place" };
  return [{ start, end, text: typeof value === "boolean" ? String(value) : scalarText(value, node) }];
}

function planInsert(context: Context, parent: YAMLMap, parentPath: AssetPackPath, key: string, value: AssetPackEditValue): Splice[] | EditError {
  const { text, lines } = context;
  const last = parent.items.at(-1);
  if (last === undefined) return { error: "the mapping is empty, and where its first entry goes is not decided" };
  if (typeof value === "object") return { error: "a list is set only by replacing an existing list; adding a list entry or a missing list is not an edit this reader makes" };
  const order = keyOrder(parentPath);
  const rank = order.indexOf(key);
  const names = parent.items.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : ""));
  // The new entry follows the last entry that precedes it in the contract's key order,
  // or the last entry when the key has no place in that order.
  let after = last;
  if (rank >= 0) {
    const before = parent.items.filter((_, index) => {
      const at = order.indexOf(names[index]!);
      return at >= 0 && at < rank;
    });
    if (before.length === 0) return { error: `there is no entry for \`${key}\` to follow` };
    after = before.at(-1)!;
  }
  const end = pairEnd(after);
  const entry = `${scalarText(key, null)}: ${typeof value === "boolean" ? String(value) : scalarText(value, null)}`;
  if (parent.flow === true) return [{ start: end, end, text: `, ${entry}` }];

  const first = parent.items[0]!.key as Node;
  const indent = " ".repeat(lines.linePos(rangeOf(first)[0]).col - 1);
  const newline = text.indexOf("\n", end);
  const crlf = newline > 0 && text[newline - 1] === "\r";
  const at = newline < 0 ? text.length : crlf ? newline - 1 : newline;
  return [{ start: at, end: at, text: `${crlf ? "\r\n" : "\n"}${indent}${entry}` }];
}

function planSet(context: Context, path: AssetPackPath, value: AssetPackEditValue): Splice[] | EditError {
  const parentPath = path.slice(0, -1);
  const last = path.at(-1);
  if (last === undefined) return { error: "an edit names a place in the document" };
  const parent: unknown = context.document.getIn(parentPath, true);
  if (isSeq(parent)) {
    if (typeof last !== "number" || last < 0 || last >= parent.items.length) return { error: "there is no such list entry; adding or removing list entries is not an edit this reader makes" };
    return planReplace(context, parent.items[last], value);
  }
  if (!isMap(parent) || typeof last !== "string") return { error: "there is no such place in the document" };
  const pair = parent.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === last);
  if (pair === undefined) return planInsert(context, parent, parentPath, last, value);
  return planReplace(context, pair.value, value);
}

/**
 * Set one property of an existing asset-pack document in place. Only the text of the value
 * changes: a replaced value is a splice into the original text, so every other byte, every
 * comment, the spacing in front of a trailing comment and the whole `pluginData` block stay
 * as written. A path names a place as the reader reports it, for example
 * `["assets", 0, "solid", 0, "points", 1, 0]`. Setting an optional key that is absent adds
 * one line (or one `, key: value` in a flow mapping) after the entry that precedes it in the
 * contract's key order. A one-line flow list, such as a `rect` or a colour, is replaced by
 * a list of numbers. A document the reader refuses is not edited, plugin blocks are never
 * edited, and an edit that would leave a document the reader refuses is not made.
 */
export function setAssetPackProperty(text: string, path: AssetPackPath, value: AssetPackEditValue): AssetPackEditResult {
  const fail = (message: string): AssetPackEditResult => ({ ok: false, problems: [{ kind: "edit", path: formatAssetPackPath(path), message, line: null }] });
  if (path[0] === "pluginData") return fail("plugin blocks are opaque and cannot be edited by the asset-pack writer");
  const before = readAssetPack(text);
  if (!before.ok) return before;
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const splices = planSet({ text, document, lines }, path, value);
  if (!Array.isArray(splices)) return fail((splices as EditError).error);

  const edited = applySplices(text, splices);
  const after = readAssetPack(edited);
  if (!after.ok) {
    return { ok: false, problems: after.problems.map((problem) => ({ ...problem, message: `the edit would leave a document the reader refuses: ${problem.message}` })) };
  }
  if (before.assetPack.pluginSource !== after.assetPack.pluginSource) return fail("the edit would change the plugin blocks, which are preserved byte for byte");
  return { ok: true, text: edited };
}
