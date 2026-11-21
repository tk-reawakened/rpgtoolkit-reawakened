/** Closed standalone-tile palette, terrain recipes and output slots: docs/spec/formats/native-tileset.md. */
import { Document, isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { formatClipPath, formatClipProblems, type ClipJson, type ClipPath, type ClipProblem } from "./clip.ts";
import { readDocument } from "./document.ts";
import { foldId } from "./fold.ts";
import { validatePluginData } from "./plugin-data.ts";
import { parseVersion } from "./version.ts";

export const TILESET_CONTRACT = "tileset";
export const TILESET_VERSION = "1.0.0-pre.2";

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
  readonly file: string;
  readonly grid: TilesetGrid;
  readonly transparent: TilesetTransparent;
};

export type TilesetDiagonal = "north-west" | "north-east" | "south-east" | "south-west";

/** The only kitbash operation the contract defines. */
export type TilesetKitbashOp = { readonly op: "cutCorner"; readonly diagonal: TilesetDiagonal; readonly clearHalf: boolean };

export type TilesetIsoFace = {
  readonly source: string;
  readonly cell: TilesetCell;
  readonly tint?: TilesetRgb;
};

export type TilesetIsoBlock = {
  readonly id: string;
  readonly name: string;
  readonly heightPixels: number;
  readonly faces: { readonly top: TilesetIsoFace; readonly left: TilesetIsoFace; readonly right: TilesetIsoFace };
  readonly collision: TilesetCollision;
  readonly wallCapUnder?: boolean;
};

export type TilesetSourceCell = { readonly source: string; readonly cell: TilesetCell };

export type TilesetTileReference = { readonly tile: string };
export type TilesetSlot =
  | { readonly slot: number; readonly reserved: true }
  | { readonly slot: number; readonly tile: string; readonly cel?: string };
export type TilesetRule = {
  readonly id: string;
  readonly when: Readonly<Partial<Record<"n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw", "same" | "other">>>;
} & (
  | { readonly use: TilesetTileReference; readonly variants?: never }
  | { readonly use?: never; readonly variants: readonly { readonly tile: string; readonly weight: number }[] }
);
export type TilesetTerrain = {
  readonly id: string;
  readonly name: string;
  readonly resolver: { readonly provider: string; readonly id: string; readonly version: string };
  readonly neighbours: "cardinal-4" | "blob-8";
  readonly coverage: "complete" | "partial";
  readonly sync: "lockstep" | "independent";
  readonly outside?: "same" | "other";
  readonly seed?: number;
  readonly rules: readonly TilesetRule[];
};
export type TilesetJson = ClipJson;

export type Tileset = {
  readonly contract: typeof TILESET_CONTRACT;
  readonly version: string;
  readonly tags?: readonly string[];
  readonly metadata?: { readonly [key: string]: ClipJson };
  readonly name: string;
  readonly expects: { readonly projection: TilesetProjection; readonly cellSize: readonly [number, number] };
  readonly tiles: readonly TilesetTileReference[];
  readonly terrains?: readonly TilesetTerrain[];
  readonly sources?: readonly TilesetSource[];
  readonly isoBlocks?: readonly TilesetIsoBlock[];
  readonly outputBinding: { readonly target: string; readonly detail: number; readonly slots: readonly TilesetSlot[] };
  readonly pluginData?: { readonly [id: string]: { readonly version: string; readonly data: { readonly [key: string]: ClipJson } } };
  readonly pluginSource?: string;
};

export type TilesetProblem = ClipProblem;
export type TilesetReadResult =
  | { readonly ok: true; readonly tileset: Tileset; readonly source: string }
  | { readonly ok: false; readonly problems: readonly TilesetProblem[] };
export type TilesetWriteResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly problems: readonly TilesetProblem[] };

export const formatTilesetPath = formatClipPath;
export const formatTilesetProblems = formatClipProblems;

type Raw = { readonly path: ClipPath; readonly message: string };
const ROOT = ["contract", "version", "tags", "metadata", "name", "expects", "tiles", "terrains", "sources", "isoBlocks", "outputBinding", "pluginData"] as const;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const identity = (s: string): string => foldId(s.split("/").filter((part) => part !== "" && part !== ".").join("/"));

/** The reason `value` is not a project-relative `/` file path, or `null` when it is one. */
function pathOf(value: string): string | null {
  if (value === "") return "is empty text";
  if (value.trim() !== value) return "must have no space at either end";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "must be one line without control characters or `\\`";
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return "must be relative to the project root, not absolute";
  if (value.endsWith("/")) return "names a folder, not a file";
  if (value.split("/").includes("..")) return "must not contain a `..` part, which is not resolved";
  if (value.split("/").every((part) => part === "" || part === ".")) return "names no file";
  return null;
}

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
  const list = (v: unknown, p: ClipPath, each: (item: unknown, path: ClipPath) => void, min = 0): void => {
    if (!Array.isArray(v)) { fail(p, "must be a list"); return; }
    if (v.length < min) fail(p, `must contain at least ${min} entries`);
    v.forEach((entry: unknown, i: number) => each(entry, [...p, i]));
  };
  const path = (v: unknown, p: ClipPath, extension?: string): string | null => {
    if (typeof v !== "string") { fail(p, "must be a project-relative / file path"); return null; }
    const problem = pathOf(v);
    if (problem !== null) { fail(p, `must be a safe project-relative / file path; it ${problem}`); return null; }
    const key = identity(v);
    if (extension !== undefined && !key.endsWith(extension)) fail(p, `must name a ${extension} file`);
    return key;
  };
  const pair = (v: unknown, p: ClipPath, min: number, length = 2, max?: number): void => { if (!Array.isArray(v) || v.length !== length) fail(p, `must be a list of ${length} integers`); else v.forEach((n: unknown, i: number) => number(n, [...p, i], min, max)); };
  const unique = (v: unknown, p: ClipPath, seen: Set<string>): void => { id(v, p); if (typeof v === "string") { if (seen.has(v)) fail(p, "duplicate local ID"); seen.add(v); } };
  const json = (v: unknown, seen = new Set<object>()): boolean => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v !== "object" || seen.has(v) || (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)) return false;
    seen.add(v);
    const valid = Object.values(v).every((item) => json(item, seen));
    seen.delete(v);
    return valid;
  };

  if (!map(value, [], ROOT, ["contract", "version", "name", "expects", "tiles", "outputBinding"])) return out;
  choice(value.contract, ["contract"], [TILESET_CONTRACT]);
  const version = typeof value.version === "string" ? parseVersion(value.version) : null;
  if (version === null || !version.ok || version.major !== "1" || version.minor !== "0" || version.patch !== "0" || version.pre !== "2") {
    fail(["version"], `must be ${TILESET_VERSION} with an optional build suffix`);
  }
  if (Object.hasOwn(value, "tags")) list(value.tags, ["tags"], text);
  if (Object.hasOwn(value, "metadata") && (!object(value.metadata) || !json(value.metadata))) fail(["metadata"], "must be a JSON mapping");
  text(value.name, ["name"]);
  if (map(value.expects, ["expects"], ["projection", "cellSize"])) {
    choice(value.expects.projection, ["expects", "projection"], ["2d", "iso-stacked", "iso-rotated"]);
    pair(value.expects.cellSize, ["expects", "cellSize"], 1);
  }

  const members = new Set<string>();
  list(value.tiles, ["tiles"], (row, p) => {
    if (!map(row, p, ["tile"])) return;
    const key = path(row.tile, [...p, "tile"], ".tkrtle");
    if (key !== null) {
      if (members.has(key)) fail([...p, "tile"], "duplicate normalized tile identity");
      members.add(key);
    }
  }, 1);
  const member = (v: unknown, p: ClipPath): string | null => {
    const key = path(v, p, ".tkrtle");
    if (key !== null && !members.has(key)) fail(p, "tile is not a member of this palette");
    return key;
  };

  if (Object.hasOwn(value, "terrains")) {
    const ids = new Set<string>();
    list(value.terrains, ["terrains"], (terrain, p) => {
      if (!map(terrain, p, ["id", "name", "resolver", "neighbours", "coverage", "sync", "outside", "seed", "rules"], ["id", "name", "resolver", "neighbours", "coverage", "sync", "rules"])) return;
      unique(terrain.id, [...p, "id"], ids);
      text(terrain.name, [...p, "name"]);
      if (map(terrain.resolver, [...p, "resolver"], ["provider", "id", "version"])) {
        if (terrain.resolver.provider !== "builtin" || terrain.resolver.id !== "neighbour-match" || terrain.resolver.version !== "1.0.0") fail([...p, "resolver"], "must pin builtin/neighbour-match@1.0.0");
      }
      choice(terrain.neighbours, [...p, "neighbours"], ["cardinal-4", "blob-8"]);
      choice(terrain.coverage, [...p, "coverage"], ["complete", "partial"]);
      choice(terrain.sync, [...p, "sync"], ["lockstep", "independent"]);
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
        if (use) {
          if (map(rule.use, [...rp, "use"], ["tile"])) member(rule.use.tile, [...rp, "use", "tile"]);
        } else {
          let total = 0;
          list(rule.variants, [...rp, "variants"], (variant, vp) => {
            if (!map(variant, vp, ["tile", "weight"])) return;
            member(variant.tile, [...vp, "tile"]);
            number(variant.weight, [...vp, "weight"], 1, 4294967295);
            if (whole(variant.weight, 1, 4294967295)) total += variant.weight;
          }, 1);
          if (total > 4294967295) fail([...rp, "variants"], "total weight exceeds 4294967295");
        }
      });
    });
  }

  const sources = new Set<string>();
  if (Object.hasOwn(value, "sources")) list(value.sources, ["sources"], (source, p) => {
    if (!map(source, p, ["id", "file", "grid", "transparent"])) return;
    unique(source.id, [...p, "id"], sources);
    path(source.file, [...p, "file"]);
    if (map(source.grid, [...p, "grid"], ["width", "height", "marginX", "marginY", "gapX", "gapY"])) {
      for (const key of ["width", "height", "marginX", "marginY", "gapX", "gapY"]) number(source.grid[key], [...p, "grid", key], key === "width" || key === "height" ? 1 : 0);
    }
    if (object(source.transparent)) {
      const color = source.transparent.mode === "colorKey";
      if (map(source.transparent, [...p, "transparent"], color ? ["mode", "color"] : ["mode"])) {
        choice(source.transparent.mode, [...p, "transparent", "mode"], ["alpha", "colorKey"]);
        if (color) pair(source.transparent.color, [...p, "transparent", "color"], 0, 3, 255);
      }
    } else fail([...p, "transparent"], "must be a mapping");
  });

  if (Object.hasOwn(value, "isoBlocks")) {
    const ids = new Set<string>();
    list(value.isoBlocks, ["isoBlocks"], (block, p) => {
      if (!map(block, p, ["id", "name", "heightPixels", "faces", "collision", "wallCapUnder"], ["id", "name", "heightPixels", "faces", "collision"])) return;
      unique(block.id, [...p, "id"], ids);
      text(block.name, [...p, "name"]);
      number(block.heightPixels, [...p, "heightPixels"], 1);
      choice(block.collision, [...p, "collision"], ["walkable", "solid"]);
      if (Object.hasOwn(block, "wallCapUnder") && typeof block.wallCapUnder !== "boolean") fail([...p, "wallCapUnder"], "must be boolean");
      if (map(block.faces, [...p, "faces"], ["top", "left", "right"])) {
        for (const face of ["top", "left", "right"]) {
          const fp = [...p, "faces", face];
          const item = block.faces[face];
          if (map(item, fp, ["source", "cell", "tint"], ["source", "cell"])) {
            id(item.source, [...fp, "source"]);
            if (typeof item.source === "string" && !sources.has(item.source)) fail([...fp, "source"], "names no source in this document");
            pair(item.cell, [...fp, "cell"], 0);
            if (Object.hasOwn(item, "tint")) pair(item.tint, [...fp, "tint"], -255, 3, 255);
          }
        }
      }
    });
  }

  if (map(value.outputBinding, ["outputBinding"], ["target", "detail", "slots"])) {
    const target = path(value.outputBinding.target, ["outputBinding", "target"], ".tst");
    if (target !== null && !target.startsWith("tiles/")) fail(["outputBinding", "target"], "must be under Tiles/");
    number(value.outputBinding.detail, ["outputBinding", "detail"], 1);
    const slots = new Set<number>();
    const allocations = new Set<string>();
    let max = 0;
    list(value.outputBinding.slots, ["outputBinding", "slots"], (slot, p) => {
      if (!object(slot)) { fail(p, "must be a mapping"); return; }
      if (Object.hasOwn(slot, "reserved")) {
        map(slot, p, ["slot", "reserved"]);
        if (slot.reserved !== true) fail([...p, "reserved"], "must be true");
      } else {
        map(slot, p, ["slot", "tile", "cel"], ["slot", "tile"]);
        const key = member(slot.tile, [...p, "tile"]);
        if (Object.hasOwn(slot, "cel")) id(slot.cel, [...p, "cel"]);
        if (key !== null && (!Object.hasOwn(slot, "cel") || typeof slot.cel === "string")) {
          const allocation = `${key}\0${typeof slot.cel === "string" ? slot.cel : ""}`;
          if (allocations.has(allocation)) fail(p, "duplicate tile/cel allocation");
          allocations.add(allocation);
        }
      }
      number(slot.slot, [...p, "slot"], 1, 32767);
      if (whole(slot.slot, 1, 32767)) {
        if (slots.has(slot.slot)) fail([...p, "slot"], "duplicate slot");
        slots.add(slot.slot);
        max = Math.max(max, slot.slot);
      }
    });
    for (let i = 1; i <= max; i++) if (!slots.has(i)) fail(["outputBinding", "slots"], `missing slot ${i}`);
  }
  if (Object.hasOwn(value, "pluginData") && !object(value.pluginData)) fail(["pluginData"], "must be a mapping");
  return out;
}

function problems(raw: readonly Raw[], line: (path: ClipPath) => number | null): TilesetProblem[] {
  return raw.map((p) => ({ kind: "shape", path: formatClipPath(p.path), message: p.message, line: line(p.path) }));
}

/** Check a tileset model, for example one a project loaded, against every rule of the contract. */
export function checkTileset(tileset: unknown): readonly TilesetProblem[] {
  if (!object(tileset) || !Object.hasOwn(tileset, "pluginSource")) return problems(validate(tileset), () => null);
  const copy = { ...tileset };
  delete copy.pluginSource;
  return problems(validate(copy), () => null);
}

/** A path the document names, for a project checker to resolve: where it is written and what it says. */
export type TilesetAssetPath = { readonly path: ClipPath; readonly file: string };

/** The project paths of a tileset: each authored source image, then the generated target. */
export function tilesetAssetPaths(tileset: Tileset): readonly TilesetAssetPath[] {
  const found: TilesetAssetPath[] = (tileset.sources ?? []).map((source, index) => ({ path: ["sources", index, "file"], file: source.file }));
  found.push({ path: ["outputBinding", "target"], file: tileset.outputBinding.target });
  return found;
}

/** A source cell the document uses, for a project checker to test against the source image's size. */
export type TilesetCellReference = { readonly path: string; readonly source: string; readonly cell: TilesetCell };

/** Every source cell an iso block uses: faces only; standalone tiles carry their own artwork. */
export function tilesetCellReferences(tileset: Tileset): readonly TilesetCellReference[] {
  const found: TilesetCellReference[] = [];
  tileset.isoBlocks?.forEach((block, blockIndex) => {
    for (const face of ["top", "left", "right"] as const) {
      const item = block.faces[face];
      found.push({ path: formatClipPath(["isoBlocks", blockIndex, "faces", face, "cell"]), source: item.source, cell: item.cell });
    }
  });
  return found;
}

/** How many whole cells a grid addresses in an image of `width` by `height` pixels. */
export function tilesetCellBounds(grid: TilesetGrid, width: number, height: number): { readonly columns: number; readonly rows: number } {
  const columns = grid.width + grid.gapX === 0 ? 0 : Math.max(0, Math.floor((width - grid.marginX + grid.gapX) / (grid.width + grid.gapX)));
  const rows = grid.height + grid.gapY === 0 ? 0 : Math.max(0, Math.floor((height - grid.marginY + grid.gapY) / (grid.height + grid.gapY)));
  return { columns, rows };
}

/** Read a tileset document and retain its original source. */
export function readTileset(text: string): TilesetReadResult {
  const stamp = readDocument({ path: "(tileset)", text }, []);
  if (stamp.stampReports.length > 0) {
    return { ok: false, problems: stamp.stampReports.map((report) => ({ kind: "stamp", path: report.key ?? "(document)", message: `stamp ${report.problem}: ${report.reason}`, line: report.line })) };
  }
  const lines = new LineCounter();
  const document = parseDocument(text, { version: "1.2", schema: "core", lineCounter: lines });
  const plugin = validatePluginData(document, text, lines, ROOT);
  const yaml: TilesetProblem[] = document.errors.map((error) => ({ kind: "shape", path: "(document)", message: `YAML error: ${error.message.split("\n")[0]!.replace(/:$/, "")}`, line: error.linePos?.[0]?.line ?? null }));
  if (plugin.length || yaml.length) {
    return {
      ok: false,
      problems: [
        ...plugin.map((item): TilesetProblem => ({ kind: "plugin-block", pluginKind: item.kind, path: item.pluginId === null ? "pluginData" : `pluginData.${item.pluginId}`, message: `${item.kind}: ${item.reason} (found ${JSON.stringify(item.found)})`, line: item.line })),
        ...yaml,
      ],
    };
  }
  let value: unknown;
  try { value = document.toJS(); } catch (error) {
    return { ok: false, problems: [{ kind: "shape", path: "(document)", message: `cannot read YAML values: ${error instanceof Error ? error.message : String(error)}`, line: null }] };
  }
  const raw = validate(value);
  if (raw.length) {
    return {
      ok: false,
      problems: problems(raw, (path) => {
        let node: unknown = document.contents;
        let anchor: number | null = null;
        for (const part of path) {
          if (isMap(node)) {
            const entry = node.items.find((item) => isScalar(item.key) && item.key.value === part);
            if (entry === undefined) break;
            anchor = (entry.key as Node).range?.[0] ?? anchor;
            node = entry.value;
          } else if (isSeq(node) && typeof part === "number") {
            node = node.items[part];
            anchor = (node as Node | undefined)?.range?.[0] ?? anchor;
          } else break;
        }
        return anchor === null ? null : lines.linePos(anchor).line;
      }),
    };
  }
  const tileset = value as Tileset;
  const entries = isMap(document.contents) ? document.contents.items : [];
  const index = entries.findIndex((entry) => isScalar(entry.key) && entry.key.value === "pluginData");
  const start = index < 0 ? undefined : (entries[index]!.key as Node).range?.[0];
  const end = index < 0 ? undefined : (entries[index + 1]?.key as Node | undefined)?.range?.[0];
  return { ok: true, tileset: start === undefined ? tileset : { ...tileset, pluginSource: text.slice(start, end ?? text.length) }, source: text };
}

function sameValue(left: unknown, right: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => sameValue(item, right[index], seen));
  }
  if (!object(left) || !object(right)) return false;
  const known = seen.get(left);
  if (known?.has(right) === true) return true;
  if (known === undefined) seen.set(left, new WeakSet([right]));
  else known.add(right);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key], seen));
}

function ordered(tileset: Tileset): Record<string, unknown> {
  const out: Record<string, unknown> = { contract: tileset.contract, version: tileset.version };
  if (tileset.tags !== undefined) out.tags = [...tileset.tags];
  if (tileset.metadata !== undefined) out.metadata = tileset.metadata;
  out.name = tileset.name;
  out.expects = { projection: tileset.expects.projection, cellSize: [...tileset.expects.cellSize] };
  out.tiles = tileset.tiles.map((member) => ({ tile: member.tile }));
  if (tileset.terrains !== undefined) {
    out.terrains = tileset.terrains.map((terrain) => ({
      id: terrain.id,
      name: terrain.name,
      resolver: { provider: terrain.resolver.provider, id: terrain.resolver.id, version: terrain.resolver.version },
      neighbours: terrain.neighbours,
      coverage: terrain.coverage,
      sync: terrain.sync,
      ...(terrain.outside === undefined ? {} : { outside: terrain.outside }),
      ...(terrain.seed === undefined ? {} : { seed: terrain.seed }),
      rules: terrain.rules.map((rule) => ({
        id: rule.id,
        when: { ...rule.when },
        ...(rule.use === undefined ? { variants: rule.variants.map((variant) => ({ tile: variant.tile, weight: variant.weight })) } : { use: { tile: rule.use.tile } }),
      })),
    }));
  }
  if (tileset.sources !== undefined) {
    out.sources = tileset.sources.map((source) => ({
      id: source.id,
      file: source.file,
      grid: { width: source.grid.width, height: source.grid.height, marginX: source.grid.marginX, marginY: source.grid.marginY, gapX: source.grid.gapX, gapY: source.grid.gapY },
      transparent: source.transparent.mode === "alpha" ? { mode: "alpha" } : { mode: "colorKey", color: [...source.transparent.color] },
    }));
  }
  if (tileset.isoBlocks !== undefined) {
    out.isoBlocks = tileset.isoBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      heightPixels: block.heightPixels,
      faces: {
        top: { source: block.faces.top.source, cell: [...block.faces.top.cell], ...(block.faces.top.tint === undefined ? {} : { tint: [...block.faces.top.tint] }) },
        left: { source: block.faces.left.source, cell: [...block.faces.left.cell], ...(block.faces.left.tint === undefined ? {} : { tint: [...block.faces.left.tint] }) },
        right: { source: block.faces.right.source, cell: [...block.faces.right.cell], ...(block.faces.right.tint === undefined ? {} : { tint: [...block.faces.right.tint] }) },
      },
      collision: block.collision,
      ...(block.wallCapUnder === undefined ? {} : { wallCapUnder: block.wallCapUnder }),
    }));
  }
  out.outputBinding = {
    target: tileset.outputBinding.target,
    detail: tileset.outputBinding.detail,
    slots: tileset.outputBinding.slots.map((slot) => "reserved" in slot ? { slot: slot.slot, reserved: true } : { slot: slot.slot, tile: slot.tile, ...(slot.cel === undefined ? {} : { cel: slot.cel }) }),
  };
  if (tileset.pluginData !== undefined) out.pluginData = tileset.pluginData;
  return out;
}

/** Write a tileset as YAML text. With the original `source` the bytes are returned unchanged. */
export function writeTileset(tileset: Tileset, source?: string): TilesetWriteResult {
  const errors = checkTileset(tileset);
  if (errors.length) return { ok: false, problems: errors };
  if ((tileset.pluginData !== undefined || tileset.pluginSource !== undefined) && source === undefined) {
    return { ok: false, problems: [{ kind: "edit", path: "pluginData", message: "cannot write plugin blocks without their original source document", line: null }] };
  }
  if (source !== undefined) {
    const parsed = readTileset(source);
    if (!parsed.ok) return parsed;
    if (!sameValue(parsed.tileset, tileset)) return { ok: false, problems: [{ kind: "edit", path: "(document)", message: "the original source document does not match the requested tileset", line: null }] };
    return { ok: true, text: source };
  }
  return { ok: true, text: new Document(ordered(tileset), { version: "1.2", schema: "core" }).toString({ lineWidth: 0, flowCollectionPadding: false }) };
}
