/**
 * Standalone tile reader and writer (docs/spec/formats/native-tile.md).
 * Source existence, decoded dimensions, rectangle bounds and managed-source
 * resolution belong to project build validation, not this document contract.
 */
import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { formatClipPath, type ClipJson, type ClipPath, type ClipProblem } from "./clip.ts";
import { readDocument } from "./document.ts";
import { validatePluginData } from "./plugin-data.ts";

export const TILE_CONTRACT = "tile";
export const TILE_VERSION = "1.0.0-pre.1";

export type NativeTileSample =
  | { readonly file: string; readonly rect: readonly [number, number, number, number] }
  | { readonly source: string; readonly frame: string; readonly region: string };
type Point = readonly [number, number];
type Outline = { readonly label: string; readonly closed: boolean; readonly points: readonly Point[] };
type Transparency = { readonly mode: "alpha" } | { readonly mode: "colorKey"; readonly color: readonly [number, number, number] };
export type NativeTile = {
  readonly contract: typeof TILE_CONTRACT;
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: ClipJson };
  readonly name: string;
  readonly projection: "2d" | "iso-stacked" | "iso-rotated";
  readonly role: "floor" | "wall" | "wall-cap" | "decorative";
  readonly visual:
    | { readonly transparent: Transparency; readonly sample: NativeTileSample; readonly cels?: never; readonly timeline?: never }
    | { readonly transparent: Transparency; readonly sample?: never; readonly cels: readonly { readonly id: string; readonly sample: NativeTileSample }[]; readonly timeline: { readonly frames: readonly { readonly cel: string; readonly ms: number }[]; readonly phaseMs?: number } };
  readonly solid?: readonly Outline[];
  readonly under?: readonly (Outline & { readonly closed: true; readonly attributes: number })[];
  readonly activationAreas?: readonly (Outline & { readonly id: string })[];
  readonly kitbash?: readonly { readonly op: "cutCorner"; readonly diagonal: "north-west" | "north-east" | "south-east" | "south-west"; readonly clearHalf: boolean }[];
  readonly pluginData?: { readonly [id: string]: { readonly version: string; readonly data: { readonly [key: string]: ClipJson } } };
  readonly pluginSource?: string;
};
export type TileProblem = ClipProblem;
export type TileReadResult = { readonly ok: true; readonly tile: NativeTile; readonly source: string } | { readonly ok: false; readonly problems: readonly TileProblem[] };
export type TileWriteResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly problems: readonly TileProblem[] };

type Raw = { readonly path: ClipPath; readonly message: string };
const ROOT = ["contract", "version", "tags", "metadata", "name", "projection", "role", "visual", "solid", "under", "activationAreas", "kitbash", "pluginData"] as const;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;

function validate(value: unknown): Raw[] {
  const out: Raw[] = [];
  const fail = (path: ClipPath, message: string): void => { out.push({ path, message }); };
  const mapping = (v: unknown, path: ClipPath, keys: readonly string[], required: readonly string[]): v is Record<string, unknown> => {
    if (!object(v)) { fail(path, "must be a mapping"); return false; }
    for (const key of Object.keys(v)) if (!keys.includes(key)) fail([...path, key], "is not allowed in this mapping");
    for (const key of required) if (!Object.hasOwn(v, key)) fail([...path, key], "is required");
    return true;
  };
  const text = (v: unknown, p: ClipPath): void => { if (typeof v !== "string" || v.length === 0) fail(p, "must be non-empty text"); };
  const id = (v: unknown, p: ClipPath): void => { if (typeof v !== "string" || !ID.test(v)) fail(p, "must be a lowercase kebab-case local ID"); };
  const choice = (v: unknown, p: ClipPath, choices: readonly unknown[]): void => { if (!choices.includes(v)) fail(p, `must be one of ${choices.join(", ")}`); };
  const whole = (v: unknown, p: ClipPath, min: number, max?: number): void => { if (!integer(v, min, max)) fail(p, `must be an exact integer from ${min} to ${max ?? Number.MAX_SAFE_INTEGER}`); };
  const list = (v: unknown, p: ClipPath, min: number, each: (item: unknown, path: ClipPath, index: number) => void): void => {
    if (!Array.isArray(v)) { fail(p, "must be a list"); return; }
    if (v.length < min) fail(p, `must contain at least ${min} entries`);
    v.forEach((item: unknown, index: number) => each(item, [...p, index], index));
  };
  const path = (v: unknown, p: ClipPath): void => {
    if (typeof v !== "string" || v === "" || v.trim() !== v || /[\u0000-\u001f\u007f\\]/.test(v) || v.startsWith("/") || /^[A-Za-z]:/.test(v) || v.endsWith("/") || v.split("/").includes("..") || v.split("/").every((part) => part === "" || part === ".")) fail(p, "must be a safe project-relative / file path");
  };
  const sample = (v: unknown, p: ClipPath): void => {
    if (!object(v)) { fail(p, "must be a sample mapping"); return; }
    if (Object.hasOwn(v, "file")) {
      mapping(v, p, ["file", "rect"], ["file", "rect"]); path(v.file, [...p, "file"]);
      if (!Array.isArray(v.rect) || v.rect.length !== 4) fail([...p, "rect"], "must be [x, y, width, height]");
      else v.rect.forEach((n: unknown, i: number) => whole(n, [...p, "rect", i], i < 2 ? 0 : 1));
    } else {
      mapping(v, p, ["source", "frame", "region"], ["source", "frame", "region"]);
      path(v.source, [...p, "source"]); id(v.frame, [...p, "frame"]); id(v.region, [...p, "region"]);
    }
  };
  const json = (v: unknown, seen = new Set<object>()): boolean => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "object" || seen.has(v)) return false;
    if (!Array.isArray(v) && (!object(v) || (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null))) return false;
    seen.add(v); const valid = Object.values(v).every((item) => json(item, seen)); seen.delete(v); return valid;
  };
  if (!mapping(value, [], ROOT, ["contract", "version", "name", "projection", "role", "visual"])) return out;
  choice(value.contract, ["contract"], [TILE_CONTRACT]);
  if (typeof value.version !== "string" || !/^1\.0\.0-pre\.1(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value.version)) fail(["version"], `must be ${TILE_VERSION} with an optional build suffix`);
  if (Object.hasOwn(value, "tags")) list(value.tags, ["tags"], 0, text);
  if (Object.hasOwn(value, "metadata") && (!object(value.metadata) || !json(value.metadata))) fail(["metadata"], "must be a JSON mapping");
  text(value.name, ["name"]); choice(value.projection, ["projection"], ["2d", "iso-stacked", "iso-rotated"]); choice(value.role, ["role"], ["floor", "wall", "wall-cap", "decorative"]);
  const visual = value.visual;
  if (object(visual)) {
    const still = Object.hasOwn(visual, "sample");
    mapping(visual, ["visual"], still ? ["transparent", "sample"] : ["transparent", "cels", "timeline"], still ? ["transparent", "sample"] : ["transparent", "cels", "timeline"]);
    const t = visual.transparent;
    if (object(t)) {
      const color = t.mode === "colorKey";
      mapping(t, ["visual", "transparent"], color ? ["mode", "color"] : ["mode"], color ? ["mode", "color"] : ["mode"]);
      choice(t.mode, ["visual", "transparent", "mode"], ["alpha", "colorKey"]);
      if (color) {
        if (!Array.isArray(t.color) || t.color.length !== 3) fail(["visual", "transparent", "color"], "must be three RGB channels");
        else t.color.forEach((n: unknown, i: number) => whole(n, ["visual", "transparent", "color", i], 0, 255));
      }
    } else fail(["visual", "transparent"], "must be a transparency mapping");
    if (still) sample(visual.sample, ["visual", "sample"]);
    else {
      const ids = new Set<string>();
      list(visual.cels, ["visual", "cels"], 1, (cel, p) => {
        if (!mapping(cel, p, ["id", "sample"], ["id", "sample"])) return;
        id(cel.id, [...p, "id"]);
        if (typeof cel.id === "string") { if (ids.has(cel.id)) fail([...p, "id"], "duplicate cel ID"); ids.add(cel.id); }
        sample(cel.sample, [...p, "sample"]);
      });
      const timeline = visual.timeline;
      if (mapping(timeline, ["visual", "timeline"], ["frames", "phaseMs"], ["frames"])) {
        let cycle = 0; let validCycle = true;
        list(timeline.frames, ["visual", "timeline", "frames"], 1, (frame, p) => {
          if (!mapping(frame, p, ["cel", "ms"], ["cel", "ms"])) { validCycle = false; return; }
          id(frame.cel, [...p, "cel"]);
          if (typeof frame.cel === "string" && !ids.has(frame.cel)) fail([...p, "cel"], "names no cel in this tile");
          whole(frame.ms, [...p, "ms"], 1);
          if (!integer(frame.ms, 1) || !Number.isSafeInteger(cycle + frame.ms)) validCycle = false; else cycle += frame.ms;
        });
        if (!validCycle) fail(["visual", "timeline", "frames"], "cycle duration must be an exact safe integer");
        if (Object.hasOwn(timeline, "phaseMs")) {
          whole(timeline.phaseMs, ["visual", "timeline", "phaseMs"], 0);
          if (integer(timeline.phaseMs, 0) && validCycle && timeline.phaseMs >= cycle) fail(["visual", "timeline", "phaseMs"], "must be less than the cycle duration");
        }
      }
    }
  } else fail(["visual"], "must be a visual mapping");
  for (const kind of ["solid", "under", "activationAreas"] as const) if (Object.hasOwn(value, kind)) {
    const ids = new Set<string>();
    list(value[kind], [kind], 0, (entry, p) => {
      const keys = ["label", "closed", "points", ...(kind === "under" ? ["attributes"] : []), ...(kind === "activationAreas" ? ["id"] : [])];
      if (!mapping(entry, p, keys, keys)) return;
      text(entry.label, [...p, "label"]);
      if (typeof entry.closed !== "boolean" || (kind === "under" && entry.closed !== true)) fail([...p, "closed"], kind === "under" ? "must be true" : "must be a boolean");
      if (kind === "under") whole(entry.attributes, [...p, "attributes"], 0, 7);
      if (kind === "activationAreas") { id(entry.id, [...p, "id"]); if (typeof entry.id === "string") { if (ids.has(entry.id)) fail([...p, "id"], "duplicate activation area ID"); ids.add(entry.id); } }
      list(entry.points, [...p, "points"], entry.closed === true || kind === "under" ? 3 : 2, (point, pp) => {
        if (!Array.isArray(point) || point.length !== 2) fail(pp, "must be a two-coordinate point");
        else point.forEach((n: unknown, i: number) => whole(n, [...pp, i], -2147483648, 2147483647));
      });
    });
  }
  if (Object.hasOwn(value, "kitbash")) list(value.kitbash, ["kitbash"], 0, (op, p) => {
    if (!mapping(op, p, ["op", "diagonal", "clearHalf"], ["op", "diagonal", "clearHalf"])) return;
    choice(op.op, [...p, "op"], ["cutCorner"]); choice(op.diagonal, [...p, "diagonal"], ["north-west", "north-east", "south-east", "south-west"]);
    if (typeof op.clearHalf !== "boolean") fail([...p, "clearHalf"], "must be a boolean");
  });
  if (Object.hasOwn(value, "pluginData") && !object(value.pluginData)) fail(["pluginData"], "must be a mapping");
  return out;
}

function problems(raw: readonly Raw[], line: (path: ClipPath) => number | null): TileProblem[] {
  return raw.map((p) => ({ kind: "shape", path: formatClipPath(p.path), message: p.message, line: line(p.path) }));
}
export function checkTile(tile: unknown): readonly TileProblem[] {
  if (!object(tile) || !Object.hasOwn(tile, "pluginSource")) return problems(validate(tile), () => null);
  const model = { ...tile }; delete model.pluginSource; return problems(validate(model), () => null);
}

export function readTile(text: string): TileReadResult {
  const stamp = readDocument({ path: "(tile)", text }, []);
  if (stamp.stampReports.length > 0) return { ok: false, problems: stamp.stampReports.map((r) => ({ kind: "stamp", path: r.key ?? "(document)", message: `stamp ${r.problem}: ${r.reason}`, line: r.line })) };
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const pluginProblems = validatePluginData(document, text, lines, ROOT);
  const yamlProblems: TileProblem[] = document.errors.map((error) => ({ kind: "shape", path: "(document)", message: `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`, line: error.linePos?.[0]?.line ?? null }));
  if (pluginProblems.length > 0 || yamlProblems.length > 0) return { ok: false, problems: [...pluginProblems.map((p): TileProblem => ({ kind: "plugin-block", pluginKind: p.kind, path: p.pluginId === null ? "pluginData" : `pluginData.${p.pluginId}`, message: `${p.kind}: ${p.reason} (found ${JSON.stringify(p.found)})`, line: p.line })), ...yamlProblems] };
  let value: unknown;
  try {
    value = document.toJS();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, problems: [{ kind: "shape", path: "(document)", message: `cannot read YAML values: ${message}`, line: null }] };
  }
  const raw = validate(value);
  if (raw.length > 0) return { ok: false, problems: problems(raw, (path) => {
    let node: unknown = document.contents; let anchor: number | null = null;
    for (const segment of path) {
      if (isMap(node)) { const pair = node.items.find((candidate) => isScalar(candidate.key) && candidate.key.value === segment); if (pair === undefined) break; anchor = (pair.key as Node).range?.[0] ?? anchor; node = pair.value; }
      else if (isSeq(node) && typeof segment === "number") { node = node.items[segment]; anchor = (node as Node | undefined)?.range?.[0] ?? anchor; }
      else break;
    }
    return anchor === null ? null : lines.linePos(anchor).line;
  }) };
  const tile = value as NativeTile;
  const entries = isMap(document.contents) ? document.contents.items : [];
  const index = entries.findIndex((pair) => isScalar(pair.key) && pair.key.value === "pluginData");
  const start = index < 0 ? undefined : (entries[index]!.key as Node).range?.[0];
  const end = index < 0 ? undefined : (entries[index + 1]?.key as Node | undefined)?.range?.[0];
  return { ok: true, tile: start === undefined ? tile : { ...tile, pluginSource: text.slice(start, end ?? text.length) }, source: text };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}
export function writeTile(tile: NativeTile, source?: string): TileWriteResult {
  const errors = checkTile(tile); if (errors.length > 0) return { ok: false, problems: errors };
  if ((tile.pluginData !== undefined || tile.pluginSource !== undefined) && source === undefined) return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  if (source !== undefined) {
    const parsed = readTile(source); if (!parsed.ok) return parsed;
    if (!sameValue(parsed.tile, tile)) return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested tile", line: null }] };
    return { ok: true, text: source };
  }
  const ordered = { contract: tile.contract, version: tile.version, ...(tile.tags === undefined ? {} : { tags: tile.tags }), ...(tile.metadata === undefined ? {} : { metadata: tile.metadata }), name: tile.name, projection: tile.projection, role: tile.role, visual: tile.visual, ...(tile.solid === undefined ? {} : { solid: tile.solid }), ...(tile.under === undefined ? {} : { under: tile.under }), ...(tile.activationAreas === undefined ? {} : { activationAreas: tile.activationAreas }), ...(tile.kitbash === undefined ? {} : { kitbash: tile.kitbash }) };
  return { ok: true, text: new Document(ordered, { version: "1.2", schema: "core" }).toString({ lineWidth: 0, flowCollectionPadding: false }) };
}
