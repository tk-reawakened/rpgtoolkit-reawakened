/**
 * Source-preserving writers for the two lists a native tile and a pack asset own: collision
 * (`solid`) and walk-behind (`under`). A standalone tile keeps them at its top level
 * (docs/spec/formats/native-tile.md#geometry-and-program-activation); a pack asset keeps them
 * inside its `assets` entry (docs/spec/formats/native-asset-pack.md#fields). The points are
 * integer offsets from the owner's anchor and may be negative; nothing here knows about art,
 * scenes or placement.
 *
 * An edit is a splice into the original text, so every byte outside the replaced list (author
 * comments, unrelated keys, the whole `pluginData` block) stays as written. Only the entry of
 * the list being replaced, added or removed is rewritten. Pure text in, text out: no file is
 * touched (G2).
 */

import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, type Node, type Pair, type YAMLMap } from "yaml";
import { readAssetPack } from "./asset-pack.ts";
import { applySplices, rangeOf, type Splice } from "./splice.ts";
import { readTile } from "./tile.ts";

export type GeometryPoint = readonly [number, number];
/** A labeled collision outline: an open path is a barrier, a closed outline a filled area. */
export type GeometrySolid = { readonly label: string; readonly closed: boolean; readonly points: readonly GeometryPoint[] };
/** A walk-behind region: a closed polygon with the mask bits 1 (background), 2 (lower layers) and 4 (intersects the frame). */
export type GeometryUnder = GeometrySolid & { readonly attributes: number };
/** Everything an owner says about movement and walk-behind; an empty list means the owner has none of that kind. */
export type OwnerGeometry = { readonly solid: readonly GeometrySolid[]; readonly under: readonly GeometryUnder[] };

export type GeometryProblem = {
  readonly kind: "stamp" | "shape" | "plugin-block" | "edit";
  readonly path: string;
  readonly message: string;
  /** 1-based line in the text, or `null` when there is none. */
  readonly line: number | null;
};
export type GeometryEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly GeometryProblem[] };

const TILE_ORDER = ["contract", "version", "tags", "metadata", "name", "projection", "role", "visual", "solid", "under", "activationAreas", "kitbash", "pluginData"] as const;
const ASSET_ORDER = ["id", "name", "category", "kind", "anchor", "visuals", "solid", "under"] as const;

type Key = "solid" | "under";
type Located = { readonly owner: YAMLMap; readonly order: readonly string[] } | { readonly error: string };
type Locate = (document: Document.Parsed) => Located;
type Step = { readonly text: string } | { readonly error: string };
type Verified =
  | { readonly ok: true; readonly geometry: OwnerGeometry; readonly pluginSource: string | undefined }
  | { readonly ok: false; readonly problems: readonly GeometryProblem[] };

const editProblem = (path: string, message: string): GeometryEditResult => ({ ok: false, problems: [{ kind: "edit", path, message, line: null }] });

function nodeEnd(node: Node): number {
  if ((isMap(node) || isSeq(node)) && node.flow !== true) {
    const last = node.items.at(-1);
    if (last === undefined) return rangeOf(node)[1];
    return isMap(node) ? pairEnd(last as Pair) : nodeEnd(last as Node);
  }
  return rangeOf(node)[1];
}

/** The offset just past a pair's value, before any trailing comment. */
function pairEnd(pair: Pair): number {
  const value = pair.value as Node | null;
  return value === null || value === undefined ? rangeOf(pair.key as Node)[1] : nodeEnd(value);
}

const keyName = (pair: Pair): string => (isScalar(pair.key) ? String(pair.key.value) : "");

/** One entry as block text: the key, then a block list of one-line flow records, as the contract's illustrations write them. */
function renderEntry(key: Key, shapes: readonly (GeometrySolid | GeometryUnder)[], indent: string, eol: string): string {
  const records = shapes.map((shape) => ({
    label: shape.label,
    ...(key === "under" ? { attributes: (shape as GeometryUnder).attributes } : {}),
    closed: shape.closed,
    points: shape.points.map((point) => [point[0], point[1]]),
  }));
  const document = new Document(records, { version: "1.2", schema: "core" });
  records.forEach((_, index) => {
    for (const path of [[index], [index, "points"], ...records[index]!.points.map((_, point) => [index, "points", point])]) {
      const node = document.getIn(path, true);
      if ((isMap(node) || isSeq(node)) && node.flow !== true) node.flow = true;
    }
  });
  const body = document.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\r?\n$/, "");
  return [`${indent}${key}:`, ...body.split("\n").map((line) => `${indent}  ${line}`)].join(eol);
}

function sameShapes(left: readonly (GeometrySolid | GeometryUnder)[], right: readonly (GeometrySolid | GeometryUnder)[]): boolean {
  return left.length === right.length && left.every((shape, index) => {
    const other = right[index]!;
    return shape.label === other.label
      && shape.closed === other.closed
      && ("attributes" in shape ? shape.attributes : undefined) === ("attributes" in other ? other.attributes : undefined)
      && shape.points.length === other.points.length
      && shape.points.every((point, at) => point[0] === other.points[at]![0] && point[1] === other.points[at]![1]);
  });
}

/** Replace, add or remove one list of the owner mapping. An unchanged list leaves the text untouched. */
function editKey(text: string, locate: Locate, key: Key, shapes: readonly (GeometrySolid | GeometryUnder)[]): Step {
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const located = locate(document);
  if ("error" in located) return located;
  const { owner, order } = located;
  if (owner.flow === true) return { error: "the owner is written as a one-line mapping, so its lists cannot be replaced in place; edit it in the text editor" };
  const first = owner.items[0];
  if (first === undefined) return { error: "the owner mapping is empty" };
  const pair = owner.items.find((candidate) => keyName(candidate) === key);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = " ".repeat(lines.linePos(rangeOf(first.key as Node)[0]).col - 1);

  if (pair !== undefined) {
    const current = (pair.value as Node | null)?.toJS?.(document) as readonly GeometrySolid[] | undefined;
    if (Array.isArray(current) && sameShapes(current, shapes)) return { text };
    if (shapes.length === 0 && !Array.isArray(current)) return { error: `\`${key}\` is not a list, so it cannot be cleared in place` };
    const start = rangeOf(pair.key as Node)[0];
    const end = pairEnd(pair);
    if (shapes.length > 0) return { text: applySplices(text, [{ start, end, text: renderEntry(key, shapes, indent, eol).slice(indent.length) }]) };
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    if (text.slice(lineStart, start).trim() !== "") return { error: `\`${key}\` shares its line with other text, so it cannot be removed in place` };
    const newline = text.indexOf("\n", end);
    return { text: applySplices(text, [{ start: lineStart, end: newline < 0 ? text.length : newline + 1, text: "" }]) };
  }

  if (shapes.length === 0) return { text };
  const rank = order.indexOf(key);
  const before = owner.items.filter((candidate) => {
    const at = order.indexOf(keyName(candidate));
    return at >= 0 && at < rank;
  });
  const after = before.at(-1);
  if (after === undefined) return { error: `there is no entry for \`${key}\` to follow` };
  const end = pairEnd(after);
  const newline = text.indexOf("\n", end);
  const at = newline < 0 ? text.length : newline > 0 && text[newline - 1] === "\r" ? newline - 1 : newline;
  const insert: Splice = { start: at, end: at, text: `${eol}${renderEntry(key, shapes, indent, eol)}` };
  return { text: applySplices(text, [insert]) };
}

function setGeometry(text: string, geometry: OwnerGeometry, locate: Locate, path: string, verify: (source: string) => Verified): GeometryEditResult {
  const before = verify(text);
  if (!before.ok) return before;
  let edited = text;
  for (const key of ["solid", "under"] as const) {
    const step = editKey(edited, locate, key, geometry[key]);
    if ("error" in step) return editProblem(`${path}${path === "" ? "" : "."}${key}`, step.error);
    edited = step.text;
  }
  const after = verify(edited);
  if (!after.ok) {
    return { ok: false, problems: after.problems.map((problem) => ({ ...problem, message: `the edit would leave a document the reader refuses: ${problem.message}` })) };
  }
  if (before.pluginSource !== after.pluginSource) return editProblem("pluginData", "the edit would change the plugin blocks, which are preserved byte for byte");
  if (!sameShapes(after.geometry.solid, geometry.solid) || !sameShapes(after.geometry.under, geometry.under)) {
    return editProblem(path === "" ? "(document)" : path, "the edit did not produce the requested geometry");
  }
  return { ok: true, text: edited };
}

/**
 * Set a standalone tile's `solid` and `under` lists in place. A list that is empty is removed
 * from the document; the other keys, comments and the plugin block stay as written.
 */
export function setTileGeometry(text: string, geometry: OwnerGeometry): GeometryEditResult {
  const locate: Locate = (document) => {
    const owner = isMap(document.contents) ? document.contents : null;
    return owner === null ? { error: "the document is not a mapping" } : { owner, order: TILE_ORDER };
  };
  return setGeometry(text, geometry, locate, "", (source) => {
    const read = readTile(source);
    return read.ok
      ? { ok: true, geometry: { solid: read.tile.solid ?? [], under: read.tile.under ?? [] }, pluginSource: read.tile.pluginSource }
      : { ok: false, problems: read.problems.map(({ kind, path, message, line }) => ({ kind, path, message, line })) };
  });
}

/**
 * Set one pack asset's `solid` and `under` lists in place. The asset is named by its pack-local
 * ID; every other asset, the sources, comments and the plugin block stay as written.
 */
export function setAssetPackGeometry(text: string, asset: string, geometry: OwnerGeometry): GeometryEditResult {
  const locate: Locate = (document) => {
    const assets = isMap(document.contents) ? document.contents.get("assets", true) : undefined;
    if (!isSeq(assets)) return { error: "the pack has no assets list" };
    const owner = assets.items.find((item) => isMap(item) && item.get("id") === asset);
    return isMap(owner) ? { owner, order: ASSET_ORDER } : { error: `the pack has no asset \`${asset}\`` };
  };
  return setGeometry(text, geometry, locate, `assets[${asset}]`, (source) => {
    const read = readAssetPack(source);
    if (!read.ok) return { ok: false, problems: read.problems.map(({ kind, path, message, line }) => ({ kind, path, message, line })) };
    const found = read.assetPack.assets.find((candidate) => candidate.id === asset);
    return found === undefined
      ? { ok: false, problems: [{ kind: "edit", path: `assets[${asset}]`, message: `the pack has no asset \`${asset}\``, line: null }] }
      : { ok: true, geometry: { solid: found.solid ?? [], under: found.under ?? [] }, pluginSource: read.assetPack.pluginSource };
  });
}
