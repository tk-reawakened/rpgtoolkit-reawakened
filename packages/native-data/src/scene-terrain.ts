/** Structural terrain fields from docs/spec/formats/native-scene.md#resolving-painted-terrain. */
import { foldId } from "./fold.ts";
import { extensionOf } from "./registry.ts";

export type SceneTerrainReference = { readonly tileset: string; readonly terrain: string };
export type SceneTerrainCellTile =
  | { readonly tile: string; readonly legacy?: never }
  | { readonly legacy: string; readonly tile?: never }
  | { readonly tile?: never; readonly legacy?: never };
export type SceneTerrainRegion = {
  readonly id: string;
  readonly label?: string;
  readonly floor: string;
  readonly terrain: SceneTerrainReference;
  readonly coverage: { readonly shape: "tile-grid"; readonly spans: readonly (readonly [x: number, y: number, length: number])[] };
};
export type SceneTileOverride = {
  readonly id?: string;
  readonly floor: string;
  readonly cell: readonly [x: number, y: number];
  readonly tile: SceneTerrainCellTile;
};

type Path = readonly (string | number)[];
type Problem = { readonly path: Path; readonly message: string };
type Mapping = Record<string, unknown>;
const LOCAL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isMapping = (value: unknown): value is Mapping => typeof value === "object" && value !== null && !Array.isArray(value);
const whole = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;

/** Validates shape and local relationships only; document and terrain resolution is a project check. */
export function checkSceneTerrainFields(
  value: { readonly terrainRegions?: unknown; readonly tileOverrides?: unknown },
  floorIds: ReadonlySet<string> | null,
  width: number | null,
  height: number | null,
): readonly Problem[] {
  const out: Problem[] = [];
  const problem = (path: Path, message: string): void => { out.push({ path, message }); };
  const mapping = (item: unknown, path: Path, keys: readonly string[], required: readonly string[]): item is Mapping => {
    if (!isMapping(item)) { problem(path, "must be a mapping"); return false; }
    for (const key of Object.keys(item)) if (!keys.includes(key)) problem([...path, key], `\`${key}\` is not a key here; the contract is closed`);
    for (const key of required) if (!Object.hasOwn(item, key)) problem(path, `\`${key}\` is required`);
    return true;
  };
  const id = (item: unknown, path: Path): item is string => {
    if (typeof item !== "string" || !LOCAL_ID.test(item)) { problem(path, "must be a lowercase kebab-case id"); return false; }
    return true;
  };
  const uniqueId = (item: unknown, path: Path, seen: Map<string, number>, index: number): void => {
    if (!id(item, path)) return;
    const first = seen.get(item);
    if (first !== undefined) problem(path, `\`${item}\` is already the id of entry ${first}; ids are unique within their list`);
    else seen.set(item, index);
  };
  const floor = (item: unknown, path: Path): void => {
    if (id(item, path) && floorIds !== null && !floorIds.has(item)) problem(path, `\`${item}\` names no floor of this document`);
  };
  const documentPath = (item: unknown, path: Path, extension: string): void => {
    if (typeof item !== "string" || item === "" || /[\u0000-\u001f\u007f]/.test(item) || item.trim() !== item || item.includes("\\") || item.startsWith("/") || /^[A-Za-z]:/.test(item) || item.split("/").includes("..") || item.endsWith("/")) {
      problem(path, "must be a safe project-relative `/` path to a file");
      return;
    }
    const actual = extensionOf(item);
    if (actual === null || foldId(actual) !== extension) problem(path, `must name a document with the extension \`${extension}\``);
  };
  const tuple = (item: unknown, path: Path, length: number): number[] | null => {
    if (!Array.isArray(item) || item.length !== length) { problem(path, `must be a list of ${length} whole numbers`); return null; }
    let valid = true;
    for (let at = 0; at < length; at++) {
      if (!whole(item[at], at === 2 ? 1 : 0)) { problem([...path, at], at === 2 ? "must be a positive whole number" : "must be a nonnegative whole number"); valid = false; }
    }
    return valid ? item as number[] : null;
  };
  const inBounds = (x: number, y: number, path: Path): void => {
    if (width !== null && x >= width) problem([...path, 0], "is outside the effective grid width");
    if (height !== null && y >= height) problem([...path, 1], "is outside the effective grid height");
  };
  const regions = value.terrainRegions;
  if (Object.hasOwn(value, "terrainRegions")) {
    if (!Array.isArray(regions)) problem(["terrainRegions"], "must be a list");
    else {
      const ids = new Map<string, number>();
      regions.forEach((entry: unknown, index: number) => {
        const path: Path = ["terrainRegions", index];
        if (!mapping(entry, path, ["id", "label", "floor", "terrain", "coverage"], ["id", "floor", "terrain", "coverage"])) return;
        if (Object.hasOwn(entry, "id")) uniqueId(entry.id, [...path, "id"], ids, index);
        if (Object.hasOwn(entry, "label") && (typeof entry.label !== "string" || entry.label === "")) problem([...path, "label"], "must be non-empty text");
        if (Object.hasOwn(entry, "floor")) floor(entry.floor, [...path, "floor"]);
        const refPath = [...path, "terrain"];
        if (Object.hasOwn(entry, "terrain") && mapping(entry.terrain, refPath, ["tileset", "terrain"], ["tileset", "terrain"])) {
          if (Object.hasOwn(entry.terrain, "tileset")) documentPath(entry.terrain.tileset, [...refPath, "tileset"], ".tkrtst");
          if (Object.hasOwn(entry.terrain, "terrain")) id(entry.terrain.terrain, [...refPath, "terrain"]);
        }
        const coveragePath = [...path, "coverage"];
        if (Object.hasOwn(entry, "coverage") && mapping(entry.coverage, coveragePath, ["shape", "spans"], ["shape", "spans"])) {
          if (Object.hasOwn(entry.coverage, "shape") && entry.coverage.shape !== "tile-grid") problem([...coveragePath, "shape"], "must be `tile-grid`");
          if (Object.hasOwn(entry.coverage, "spans")) {
            const spans = entry.coverage.spans;
            const spansPath = [...coveragePath, "spans"];
            if (!Array.isArray(spans)) problem(spansPath, "must be a list of spans");
            else {
              let previous: { x: number; y: number; end: number } | null = null;
              spans.forEach((span: unknown, at: number) => {
                const spanPath = [...spansPath, at];
                const parts = tuple(span, spanPath, 3);
                if (parts === null) return;
                const [x, y, length] = parts as [number, number, number];
                inBounds(x, y, spanPath);
                if (width !== null && length > width - x) problem([...spanPath, 2], "span must stay within its row");
                if (previous !== null && (y < previous.y || (y === previous.y && x < previous.x))) problem(spanPath, "spans must be sorted by row then column");
                else if (previous !== null && y === previous.y && x < previous.end) problem(spanPath, "spans must not overlap");
                previous = { x, y, end: x + length };
              });
            }
          }
        }
      });
    }
  }
  const overrides = value.tileOverrides;
  if (Object.hasOwn(value, "tileOverrides")) {
    if (!Array.isArray(overrides)) problem(["tileOverrides"], "must be a list");
    else {
      const ids = new Map<string, number>();
      const cells = new Set<string>();
      overrides.forEach((entry: unknown, index: number) => {
        const path: Path = ["tileOverrides", index];
        if (!mapping(entry, path, ["id", "floor", "cell", "tile"], ["floor", "cell", "tile"])) return;
        if (Object.hasOwn(entry, "id")) uniqueId(entry.id, [...path, "id"], ids, index);
        if (Object.hasOwn(entry, "floor")) floor(entry.floor, [...path, "floor"]);
        if (Object.hasOwn(entry, "cell")) {
          const cellPath = [...path, "cell"];
          const cell = tuple(entry.cell, cellPath, 2);
          if (cell !== null) {
            const [x, y] = cell as [number, number];
            inBounds(x, y, cellPath);
            if (typeof entry.floor === "string") {
              const key = JSON.stringify([entry.floor, x, y]);
              if (cells.has(key)) problem(cellPath, "an override already names this floor and cell");
              else cells.add(key);
            }
          }
        }
        if (Object.hasOwn(entry, "tile")) {
          const tilePath = [...path, "tile"];
          if (mapping(entry.tile, tilePath, ["tile", "legacy"], [])) {
            if (Object.hasOwn(entry.tile, "tile") && Object.hasOwn(entry.tile, "legacy")) problem(tilePath, "a tile cannot be both native and legacy");
            if (Object.hasOwn(entry.tile, "tile")) documentPath(entry.tile.tile, [...tilePath, "tile"], ".tkrtle");
            if (Object.hasOwn(entry.tile, "legacy") && (typeof entry.tile.legacy !== "string" || entry.tile.legacy === "")) problem([...tilePath, "legacy"], "must be non-empty legacy tile reference text");
          }
        }
      });
    }
  }
  return out;
}
