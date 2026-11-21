/** Closed palette and terrain recipes: docs/spec/formats/native-tileset.md#terrain-cutover. */
import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { formatClipPath, type ClipJson, type ClipPath, type ClipProblem } from "./clip.ts";
import { readDocument } from "./document.ts";
import { foldId } from "./fold.ts";
import { validatePluginData } from "./plugin-data.ts";
import { parseVersion } from "./version.ts";
import type { TilesetIsoBlock, TilesetSource } from "./tileset.ts";

export type TerrainTileReference = { readonly tile: string };
export type TerrainSlot = { readonly slot: number; readonly reserved: true } | { readonly slot: number; readonly tile: string; readonly cel?: string };
export type TerrainRule = { readonly id: string; readonly when: Readonly<Partial<Record<"n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw", "same" | "other">>> } &
  ({ readonly use: TerrainTileReference; readonly variants?: never } | { readonly use?: never; readonly variants: readonly { readonly tile: string; readonly weight: number }[] });
export type TerrainTileset = {
  readonly contract: "tileset";
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: ClipJson };
  readonly name: string;
  readonly expects: { readonly projection: "2d" | "iso-stacked" | "iso-rotated"; readonly cellSize: readonly [number, number] };
  readonly tiles: readonly TerrainTileReference[];
  readonly terrains?: readonly { readonly id: string; readonly name: string; readonly resolver: { readonly provider: string; readonly id: string; readonly version: string }; readonly neighbours: "cardinal-4" | "blob-8"; readonly coverage: "complete" | "partial"; readonly sync: "lockstep" | "independent"; readonly outside?: "same" | "other"; readonly seed?: number; readonly rules: readonly TerrainRule[] }[];
  readonly sources?: readonly TilesetSource[];
  readonly isoBlocks?: readonly TilesetIsoBlock[];
  readonly outputBinding: { readonly target: string; readonly detail: number; readonly slots: readonly TerrainSlot[] };
  readonly pluginData?: { readonly [id: string]: { readonly version: string; readonly data: { readonly [key: string]: ClipJson } } };
  readonly pluginSource?: string;
};
export type TerrainTilesetReadResult = { readonly ok: true; readonly tileset: TerrainTileset; readonly source: string } | { readonly ok: false; readonly problems: readonly ClipProblem[] };
export type TerrainTilesetWriteResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly problems: readonly ClipProblem[] };
type Raw = { readonly path: ClipPath; readonly message: string };
const ROOT = ["contract", "version", "tags", "metadata", "name", "expects", "tiles", "terrains", "sources", "isoBlocks", "outputBinding", "pluginData"] as const;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const identity = (s: string): string => foldId(s.split("/").filter((part) => part !== "" && part !== ".").join("/"));

function validate(value: unknown): Raw[] {
  const out: Raw[] = [];
  const fail = (path: ClipPath, message: string): void => { out.push({ path, message }); };
  const map = (v: unknown, p: ClipPath, keys: readonly string[], required: readonly string[] = keys): v is Record<string, unknown> => {
    if (!object(v)) { fail(p, "must be a mapping"); return false; }
    for (const key of Object.keys(v)) if (!keys.includes(key)) fail([...p, key], "is not allowed in this mapping");
    for (const key of required) if (!Object.hasOwn(v, key)) fail([...p, key], "is required");
    return true;
  };
  const text = (v: unknown, p: ClipPath): void => { if (typeof v !== "string" || v.trim().length === 0) fail(p, "must be non-empty text"); };
  const id = (v: unknown, p: ClipPath): void => { if (typeof v !== "string" || !ID.test(v)) fail(p, "must be a lowercase kebab-case local ID"); };
  const choice = (v: unknown, p: ClipPath, choices: readonly string[]): void => { if (typeof v !== "string" || !choices.includes(v)) fail(p, `must be one of ${choices.join(", ")}`); };
  const number = (v: unknown, p: ClipPath, min: number, max?: number): void => { if (!whole(v, min, max)) fail(p, "must be an exact integer in range"); };
  const list = (v: unknown, p: ClipPath, each: (item: unknown, path: ClipPath) => void, min = 0): void => { if (!Array.isArray(v)) { fail(p, "must be a list"); return; } if (v.length < min) fail(p, `must contain at least ${min} entries`); v.forEach((entry: unknown, i: number) => each(entry, [...p, i])); };
  const path = (v: unknown, p: ClipPath, extension?: string): string | null => {
    if (typeof v !== "string" || v === "" || v.trim() !== v || /[\u0000-\u001f\u007f\\]/.test(v) || v.startsWith("/") || /^[A-Za-z]:/.test(v) || v.endsWith("/") || v.split("/").includes("..") || v.split("/").every((part) => part === "" || part === ".")) { fail(p, "must be a safe project-relative / file path"); return null; }
    const key = identity(v);
    if (extension !== undefined && !key.endsWith(extension)) fail(p, `must name a ${extension} file`);
    return key;
  };
  const pair = (v: unknown, p: ClipPath, min: number, length = 2, max?: number): void => { if (!Array.isArray(v) || v.length !== length) fail(p, `must be a list of ${length} integers`); else v.forEach((n: unknown, i: number) => number(n, [...p, i], min, max)); };
  const unique = (v: unknown, p: ClipPath, seen: Set<string>): void => { id(v, p); if (typeof v === "string") { if (seen.has(v)) fail(p, "duplicate local ID"); seen.add(v); } };
  const json = (v: unknown, seen = new Set<object>()): boolean => { if (v === null || typeof v === "string" || typeof v === "boolean") return true; if (typeof v === "number") return Number.isFinite(v); if (typeof v !== "object" || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return false; seen.add(v); const valid = Object.values(v).every((item) => json(item, seen)); seen.delete(v); return valid; };
  if (!map(value, [], ROOT, ["contract", "version", "name", "expects", "tiles", "outputBinding"])) return out;
  choice(value.contract, ["contract"], ["tileset"]);
  const version = typeof value.version === "string" ? parseVersion(value.version) : null;
  if (version === null || !version.ok || version.major !== "1" || version.minor !== "0" || version.patch !== "0" || version.pre !== "1") fail(["version"], "must be 1.0.0-pre.1 with an optional build suffix");
  if (Object.hasOwn(value, "tags")) list(value.tags, ["tags"], text);
  if (Object.hasOwn(value, "metadata") && (!object(value.metadata) || !json(value.metadata))) fail(["metadata"], "must be a JSON mapping");
  text(value.name, ["name"]);
  if (map(value.expects, ["expects"], ["projection", "cellSize"])) { choice(value.expects.projection, ["expects", "projection"], ["2d", "iso-stacked", "iso-rotated"]); pair(value.expects.cellSize, ["expects", "cellSize"], 1); }
  const members = new Set<string>();
  list(value.tiles, ["tiles"], (row, p) => { if (!map(row, p, ["tile"])) return; const key = path(row.tile, [...p, "tile"], ".tkrtle"); if (key !== null) { if (members.has(key)) fail([...p, "tile"], "duplicate normalized tile identity"); members.add(key); } }, 1);
  const member = (v: unknown, p: ClipPath): string | null => { const key = path(v, p, ".tkrtle"); if (key !== null && !members.has(key)) fail(p, "tile is not a member of this palette"); return key; };
  if (Object.hasOwn(value, "terrains")) {
    const ids = new Set<string>();
    list(value.terrains, ["terrains"], (terrain, p) => {
      if (!map(terrain, p, ["id", "name", "resolver", "neighbours", "coverage", "sync", "outside", "seed", "rules"], ["id", "name", "resolver", "neighbours", "coverage", "sync", "rules"])) return;
      unique(terrain.id, [...p, "id"], ids); text(terrain.name, [...p, "name"]);
      if (map(terrain.resolver, [...p, "resolver"], ["provider", "id", "version"])) { if (terrain.resolver.provider !== "builtin" || terrain.resolver.id !== "neighbour-match" || terrain.resolver.version !== "1.0.0") fail([...p, "resolver"], "must pin builtin/neighbour-match@1.0.0"); }
      choice(terrain.neighbours, [...p, "neighbours"], ["cardinal-4", "blob-8"]); choice(terrain.coverage, [...p, "coverage"], ["complete", "partial"]); choice(terrain.sync, [...p, "sync"], ["lockstep", "independent"]);
      if (Object.hasOwn(terrain, "outside")) choice(terrain.outside, [...p, "outside"], ["same", "other"]);
      if (Object.hasOwn(terrain, "seed")) number(terrain.seed, [...p, "seed"], -2147483648, 2147483647);
      const rules = new Set<string>();
      list(terrain.rules, [...p, "rules"], (rule, rp) => {
        if (!object(rule)) { fail(rp, "must be a mapping"); return; }
        const use = Object.hasOwn(rule, "use");
        if (!map(rule, rp, ["id", "when", ...(use ? ["use"] : ["variants"])], ["id", "when", ...(use ? ["use"] : ["variants"])])) return;
        unique(rule.id, [...rp, "id"], rules);
        const dirs = ["n", "e", "s", "w", "nw", "ne", "se", "sw"];
        if (map(rule.when, [...rp, "when"], dirs, [])) for (const [key, val] of Object.entries(rule.when)) choice(val, [...rp, "when", key], ["same", "other"]);
        if (use) { if (map(rule.use, [...rp, "use"], ["tile"])) member(rule.use.tile, [...rp, "use", "tile"]); }
        else { let total = 0; list(rule.variants, [...rp, "variants"], (variant, vp) => { if (!map(variant, vp, ["tile", "weight"])) return; member(variant.tile, [...vp, "tile"]); number(variant.weight, [...vp, "weight"], 1, 4294967295); if (whole(variant.weight, 1, 4294967295)) total += variant.weight; }, 1); if (total > 4294967295) fail([...rp, "variants"], "total weight exceeds 4294967295"); }
      });
    });
  }
  const sources = new Set<string>();
  if (Object.hasOwn(value, "sources")) list(value.sources, ["sources"], (source, p) => {
    if (!map(source, p, ["id", "file", "grid", "transparent"])) return;
    unique(source.id, [...p, "id"], sources); path(source.file, [...p, "file"]);
    if (map(source.grid, [...p, "grid"], ["width", "height", "marginX", "marginY", "gapX", "gapY"])) for (const key of ["width", "height", "marginX", "marginY", "gapX", "gapY"]) number(source.grid[key], [...p, "grid", key], key === "width" || key === "height" ? 1 : 0);
    if (object(source.transparent)) { const color = source.transparent.mode === "colorKey"; if (map(source.transparent, [...p, "transparent"], color ? ["mode", "color"] : ["mode"])) { choice(source.transparent.mode, [...p, "transparent", "mode"], ["alpha", "colorKey"]); if (color) pair(source.transparent.color, [...p, "transparent", "color"], 0, 3, 255); } } else fail([...p, "transparent"], "must be a mapping");
  });
  if (Object.hasOwn(value, "isoBlocks")) { const ids = new Set<string>(); list(value.isoBlocks, ["isoBlocks"], (block, p) => {
    if (!map(block, p, ["id", "name", "heightPixels", "faces", "collision", "wallCapUnder"], ["id", "name", "heightPixels", "faces", "collision"])) return;
    unique(block.id, [...p, "id"], ids); text(block.name, [...p, "name"]); number(block.heightPixels, [...p, "heightPixels"], 1); choice(block.collision, [...p, "collision"], ["walkable", "solid"]); if (Object.hasOwn(block, "wallCapUnder") && typeof block.wallCapUnder !== "boolean") fail([...p, "wallCapUnder"], "must be boolean");
    if (map(block.faces, [...p, "faces"], ["top", "left", "right"])) for (const face of ["top", "left", "right"]) { const fp = [...p, "faces", face]; const item = block.faces[face]; if (map(item, fp, ["source", "cell", "tint"], ["source", "cell"])) { id(item.source, [...fp, "source"]); if (typeof item.source === "string" && (!Array.isArray(value.sources) || !value.sources.some((source: unknown) => object(source) && source.id === item.source))) fail([...fp, "source"], "names no source in this document"); pair(item.cell, [...fp, "cell"], 0); if (Object.hasOwn(item, "tint")) pair(item.tint, [...fp, "tint"], -255, 3, 255); } }
  }); }
  if (map(value.outputBinding, ["outputBinding"], ["target", "detail", "slots"])) {
    const target = path(value.outputBinding.target, ["outputBinding", "target"], ".tst"); if (target !== null && !target.startsWith("tiles/")) fail(["outputBinding", "target"], "must be under Tiles/"); number(value.outputBinding.detail, ["outputBinding", "detail"], 1);
    const slots = new Set<number>(); const allocations = new Set<string>(); let max = 0;
    list(value.outputBinding.slots, ["outputBinding", "slots"], (slot, p) => {
      if (!object(slot)) { fail(p, "must be a mapping"); return; }
      if (Object.hasOwn(slot, "reserved")) { map(slot, p, ["slot", "reserved"]); if (slot.reserved !== true) fail([...p, "reserved"], "must be true"); }
      else { map(slot, p, ["slot", "tile", "cel"], ["slot", "tile"]); const key = member(slot.tile, [...p, "tile"]); if (Object.hasOwn(slot, "cel")) id(slot.cel, [...p, "cel"]); if (key !== null && (!Object.hasOwn(slot, "cel") || typeof slot.cel === "string")) { const allocation = `${key}\0${typeof slot.cel === "string" ? slot.cel : ""}`; if (allocations.has(allocation)) fail(p, "duplicate tile/cel allocation"); allocations.add(allocation); } }
      number(slot.slot, [...p, "slot"], 1, 32767); if (whole(slot.slot, 1, 32767)) { if (slots.has(slot.slot)) fail([...p, "slot"], "duplicate slot"); slots.add(slot.slot); max = Math.max(max, slot.slot); }
    });
    for (let i = 1; i <= max; i++) if (!slots.has(i)) fail(["outputBinding", "slots"], `missing slot ${i}`);
  }
  if (Object.hasOwn(value, "pluginData") && !object(value.pluginData)) fail(["pluginData"], "must be a mapping");
  return out;
}
function problems(raw: readonly Raw[], line: (path: ClipPath) => number | null): ClipProblem[] { return raw.map((p) => ({ kind: "shape", path: formatClipPath(p.path), message: p.message, line: line(p.path) })); }
export function checkTerrainTileset(tileset: unknown): readonly ClipProblem[] { if (!object(tileset) || !Object.hasOwn(tileset, "pluginSource")) return problems(validate(tileset), () => null); const copy = { ...tileset }; delete copy.pluginSource; return problems(validate(copy), () => null); }
export function readTerrainTileset(text: string): TerrainTilesetReadResult {
  const stamp = readDocument({ path: "(tileset)", text }, []);
  if (stamp.stampReports.length > 0) return { ok: false, problems: stamp.stampReports.map((r) => ({ kind: "stamp", path: r.key ?? "(document)", message: `stamp ${r.problem}: ${r.reason}`, line: r.line })) };
  const lines = new LineCounter(); const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const plugin = validatePluginData(document, text, lines, ROOT);
  const yaml: ClipProblem[] = document.errors.map((error) => ({ kind: "shape", path: "(document)", message: `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`, line: error.linePos?.[0]?.line ?? null }));
  if (plugin.length || yaml.length) return { ok: false, problems: [...plugin.map((p): ClipProblem => ({ kind: "plugin-block", pluginKind: p.kind, path: p.pluginId === null ? "pluginData" : `pluginData.${p.pluginId}`, message: `${p.kind}: ${p.reason} (found ${JSON.stringify(p.found)})`, line: p.line })), ...yaml] };
  let value: unknown; try { value = document.toJS(); } catch (error) { return { ok: false, problems: [{ kind: "shape", path: "(document)", message: `cannot read YAML values: ${error instanceof Error ? error.message : String(error)}`, line: null }] }; }
  const raw = validate(value);
  if (raw.length) return { ok: false, problems: problems(raw, (path) => { let node: unknown = document.contents; let anchor: number | null = null; for (const part of path) { if (isMap(node)) { const entry = node.items.find((item) => isScalar(item.key) && item.key.value === part); if (entry === undefined) break; anchor = (entry.key as Node).range?.[0] ?? anchor; node = entry.value; } else if (isSeq(node) && typeof part === "number") { node = node.items[part]; anchor = (node as Node | undefined)?.range?.[0] ?? anchor; } else break; } return anchor === null ? null : lines.linePos(anchor).line; }) };
  const tileset = value as TerrainTileset; const entries = isMap(document.contents) ? document.contents.items : []; const index = entries.findIndex((entry) => isScalar(entry.key) && entry.key.value === "pluginData"); const start = index < 0 ? undefined : (entries[index]!.key as Node).range?.[0]; const end = index < 0 ? undefined : (entries[index + 1]?.key as Node | undefined)?.range?.[0];
  return { ok: true, tileset: start === undefined ? tileset : { ...tileset, pluginSource: text.slice(start, end ?? text.length) }, source: text };
}
function sameValue(a: unknown, b: unknown): boolean { if (a === b) return true; if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i])); if (!object(a) || !object(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key])); }
export function writeTerrainTileset(tileset: TerrainTileset, source?: string): TerrainTilesetWriteResult {
  const errors = checkTerrainTileset(tileset); if (errors.length) return { ok: false, problems: errors };
  if ((tileset.pluginData !== undefined || tileset.pluginSource !== undefined) && source === undefined) return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  if (source !== undefined) { const parsed = readTerrainTileset(source); if (!parsed.ok) return parsed; if (!sameValue(parsed.tileset, tileset)) return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested tileset", line: null }] }; return { ok: true, text: source }; }
  const { pluginSource: _pluginSource, ...rest } = tileset;
  const ordered = { contract: rest.contract, version: rest.version, ...Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "contract" && key !== "version")) };
  return { ok: true, text: new Document(ordered, { version: "1.2", schema: "core" }).toString({ lineWidth: 0, flowCollectionPadding: false }) };
}
