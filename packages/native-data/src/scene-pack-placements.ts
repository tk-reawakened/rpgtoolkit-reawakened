/**
 * In-place edits of a scene's `placedPacks` list (docs/spec/formats/native-scene.md#pack-placements).
 *
 * A placement names a pack asset; it never copies one. The list is a top-level block sequence, so an
 * edit is a set of splices into the original text: every other byte, every comment outside the
 * records it changes, the quoting and the plugin blocks stay as written. An existing record's
 * properties change through the scene writer's one-value edit; a removed record takes its own lines
 * with it; a new record is written in the contract's key order beside the entry it follows. The
 * reader judges the result, so an edit that would leave an invalid scene (a dangling floor, a
 * repeated instance ID, a path that is not a pack) is refused and nothing is written.
 */

import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { readScene, setSceneProperty, type SceneEditResult, type ScenePlacedPack } from "./scene.ts";
import { applySplices, rangeOf, scalarText } from "./splice.ts";

/** The record's keys in the contract's order. */
const PLACEMENT_KEYS = ["instanceId", "pack", "asset", "floor", "x", "y"] as const;

/** Root keys that follow `placedPacks` in the contract's order; a new list goes before the first present one. */
const SUCCESSOR_KEYS = ["atmosphere", "start", "links", "enterProgram", "battle", "savingDisabled", "threads", "constants", "legacy", "pluginData"] as const;

type EditError = { readonly error: string };

function samePlacements(left: readonly ScenePlacedPack[], right: readonly ScenePlacedPack[]): boolean {
  return left.length === right.length && left.every((record, index) =>
    PLACEMENT_KEYS.every((key) => record[key] === right[index]![key]));
}

/** The 0-based line the offset is on starts here. */
function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** Walk back over whole-line comments, so an insertion leaves a comment with the entry it describes. */
function beforeComments(text: string, start: number): number {
  let at = start;
  while (at > 0) {
    const previous = lineStartOf(text, at - 1);
    if (!/^[ \t]*#/.test(text.slice(previous, at))) break;
    at = previous;
  }
  return at;
}

type Located = { readonly root: YAMLMap; readonly pair: Pair | undefined; readonly list: YAMLSeq | undefined };

/** The root mapping and the `placedPacks` node, refusing the shapes this edit cannot splice safely. */
function locate(text: string): Located | EditError {
  const document = parseDocument(text, { version: "1.2", schema: "core" });
  const root = document.contents;
  if (!isMap(root)) return { error: "Pack placement editing needs a block scene mapping." };
  if (root.flow === true) return { error: "Pack placement editing needs a block scene mapping, not a flow mapping." };
  const pair = root.items.find((entry) => isScalar(entry.key) && entry.key.value === "placedPacks");
  if (pair === undefined) return { root, pair, list: undefined };
  const list = pair.value;
  if (!isSeq(list)) return { error: "`placedPacks` is not a list, so a placement cannot be edited." };
  if (list.flow === true && list.items.length > 0) return { error: "Pack placement edits need a block list; this document writes `placedPacks` in flow style." };
  return { root, pair, list };
}

/** The whitespace before the `- ` bullet of a block list entry, and the line it starts on. */
function bullet(text: string, item: Node): { readonly indent: string; readonly lineStart: number } | null {
  const start = rangeOf(item)[0];
  const lineStart = lineStartOf(text, start);
  const prefix = text.slice(lineStart, start);
  if (!/^[ \t]*-[ \t]+$/.test(prefix)) return null;
  return { indent: prefix.replace(/-[ \t]+$/, ""), lineStart };
}

function placementIdOf(item: Node): string | null {
  if (!isMap(item)) return null;
  for (const entry of item.items) {
    if (isScalar(entry.key) && entry.key.value === "instanceId" && isScalar(entry.value) && typeof entry.value.value === "string") return entry.value.value;
  }
  return null;
}

/** One record as block lines, the first carrying the `- ` of the list bullet. */
function placementText(record: ScenePlacedPack, indent: string, newline: string): string {
  return PLACEMENT_KEYS.map((key, index) =>
    `${index === 0 ? `${indent}- ` : `${indent}  `}${key}: ${scalarText(record[key], null)}`).join(newline);
}

/** The line a new top-level `placedPacks` key goes before, or `null` when it goes after every existing key. */
function successorLine(text: string, root: YAMLMap): number | null {
  let best: { readonly order: number; readonly line: number } | null = null;
  for (const entry of root.items) {
    if (!isScalar(entry.key) || typeof entry.key.value !== "string") continue;
    const order = SUCCESSOR_KEYS.indexOf(entry.key.value as (typeof SUCCESSOR_KEYS)[number]);
    if (order < 0) continue;
    const line = lineStartOf(text, rangeOf(entry.key)[0]);
    if (best === null || order < best.order) best = { order, line };
  }
  return best?.line ?? null;
}

function insertPlacement(text: string, record: ScenePlacedPack, anchorId: string | null, newline: string): string | EditError {
  const located = locate(text);
  if ("error" in located) return located;
  const { root, pair, list } = located;
  if (pair === undefined || list === undefined) {
    const block = `placedPacks:${newline}${placementText(record, "  ", newline)}${newline}`;
    const successor = successorLine(text, root);
    if (successor === null) {
      const at = text.length;
      const leading = at === 0 || text[at - 1] === "\n" ? "" : newline;
      return applySplices(text, [{ start: at, end: at, text: `${leading}${block}` }]);
    }
    const at = beforeComments(text, successor);
    return applySplices(text, [{ start: at, end: at, text: block }]);
  }
  const first = list.items[0];
  if (first === undefined) {
    if (list.flow !== true) return { error: "`placedPacks` is empty without a list, so there is no place to write a record." };
    // `writeScene` and authors both emit the empty list as `[]`; replacing just that token with the
    // block records keeps the key, its leading comments and any comment after `[]` where they are.
    const [open, close] = rangeOf(list as unknown as Node);
    let start = open;
    while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) start -= 1;
    if (start === 0 || text[start - 1] !== ":") start = open;
    return applySplices(text, [{ start, end: close, text: `${newline}${placementText(record, "  ", newline)}` }]);
  }
  const own = bullet(text, first as Node);
  if (own === null) return { error: "Cannot find the bullet of the `placedPacks` list to write beside." };
  if (anchorId === null) {
    const at = beforeComments(text, own.lineStart);
    return applySplices(text, [{ start: at, end: at, text: `${placementText(record, own.indent, newline)}${newline}` }]);
  }
  const anchor = list.items.find((item) => placementIdOf(item as Node) === anchorId);
  if (anchor === undefined) return { error: `There is no pack placement \`${anchorId}\` to insert after.` };
  const at = rangeOf(anchor as Node)[2];
  const leading = at > 0 && text[at - 1] === "\n" ? "" : newline;
  return applySplices(text, [{ start: at, end: at, text: `${leading}${placementText(record, own.indent, newline)}${newline}` }]);
}

function removePlacement(text: string, instanceId: string): string | EditError {
  const located = locate(text);
  if ("error" in located) return located;
  const { pair, list } = located;
  if (pair === undefined || list === undefined) return { error: `There is no pack placement \`${instanceId}\` to remove.` };
  const index = list.items.findIndex((item) => placementIdOf(item as Node) === instanceId);
  if (index < 0) return { error: `There is no pack placement \`${instanceId}\` to remove.` };
  const item = list.items[index] as Node;
  const own = bullet(text, item);
  if (own === null) return { error: `Cannot find the lines of pack placement \`${instanceId}\` to remove.` };
  if (list.items.length === 1) {
    // A key with no entries is not a list; the last record takes the key and its comments with it.
    const key = pair.key;
    if (!isScalar(key)) return { error: "Cannot find the `placedPacks` key to remove." };
    return applySplices(text, [{ start: beforeComments(text, lineStartOf(text, rangeOf(key)[0])), end: rangeOf(item)[2], text: "" }]);
  }
  const next = list.items[index + 1];
  let end: number | undefined;
  if (next === undefined) end = rangeOf(item)[2];
  else {
    const nextBullet = bullet(text, next as Node);
    if (nextBullet !== null) end = beforeComments(text, nextBullet.lineStart);
  }
  if (end === undefined) return { error: `Cannot find where pack placement \`${instanceId}\` ends.` };
  return applySplices(text, [{ start: own.lineStart, end, text: "" }]);
}

function refusal(path: string, message: string): SceneEditResult {
  return { ok: false, problems: [{ kind: "edit", path, message, line: null }] };
}

/**
 * Set the scene's pack placements, preserving the rest of the document byte for byte.
 *
 * Records that keep their `instanceId` are updated where they stand, so a move changes only the
 * values it names and the identity stays stable. A record the new list leaves out takes its own
 * lines with it. A record the old list did not have is written beside the entry it follows in the
 * new order, so a copy keeps the source's other fields and gets its own identity from the caller.
 * Moving a record within the list is not an edit this writer makes, because the order is the draw
 * order and a reorder would reprint records it was not asked to change.
 */
export function setScenePackPlacements(text: string, placements: readonly ScenePlacedPack[]): SceneEditResult {
  const before = readScene(text);
  if (!before.ok) return before;
  const current = before.scene.placedPacks ?? [];
  if (samePlacements(current, placements)) return { ok: true, text };
  const ids = new Set(placements.map((record) => record.instanceId));
  if (ids.size !== placements.length) return refusal("placedPacks", "Pack placement instance IDs must be unique.");
  const currentIds = new Set(current.map((record) => record.instanceId));
  const currentOrder = new Map(current.map((record, index) => [record.instanceId, index]));
  let previous = -1;
  for (const record of placements) {
    if (!currentIds.has(record.instanceId)) continue;
    const index = currentOrder.get(record.instanceId)!;
    if (index < previous) return refusal("placedPacks", "Pack placement order cannot be changed by this edit; remove and place again instead.");
    previous = index;
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let edited = text;
  // Update records that keep their identity, in document order, one scalar at a time.
  for (const [index, record] of current.entries()) {
    const target = placements.find((candidate) => candidate.instanceId === record.instanceId);
    if (target === undefined) continue;
    for (const key of ["pack", "asset", "floor", "x", "y"] as const) {
      if (target[key] === record[key]) continue;
      const result = setSceneProperty(edited, ["placedPacks", index, key], target[key]);
      if (!result.ok) return result;
      edited = result.text;
    }
  }
  // Remove records the new list leaves out.
  for (const record of current) {
    if (ids.has(record.instanceId)) continue;
    const next = removePlacement(edited, record.instanceId);
    if (typeof next !== "string") return refusal("placedPacks", next.error);
    edited = next;
  }
  // Write new records beside the entry each follows in the new order.
  for (const [index, record] of placements.entries()) {
    if (currentIds.has(record.instanceId)) continue;
    const next = insertPlacement(edited, record, index === 0 ? null : placements[index - 1]!.instanceId, newline);
    if (typeof next !== "string") return refusal("placedPacks", next.error);
    edited = next;
  }
  const after = readScene(edited);
  if (!after.ok) return after;
  if (after.scene.pluginSource !== before.scene.pluginSource) return refusal("pluginData", "The edit would change a plugin block, which this writer never changes.");
  if (!samePlacements(after.scene.placedPacks ?? [], placements)) {
    return refusal("placedPacks", "The placement edit could not be applied without changing the document's order or text.");
  }
  return { ok: true, text: edited };
}
