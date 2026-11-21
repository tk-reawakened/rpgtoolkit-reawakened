import { tileDimensions, tilesetDetail } from "@tk-reawakened/core";
import { documentId, type NativeTile, type NativeTileSample, type TerrainTileset } from "@tk-reawakened/native-data";
import { resolveSceneTerrain, type TerrainScene } from "./scene-terrain.ts";
import { lowerSceneTerrainPalette, type TerrainPaletteScene } from "./scene-terrain-palette.ts";
import { lowerSceneTileSlots, type SceneTileCrop } from "./scene-tile-slots.ts";

export type SceneTerrainBuildScene = TerrainPaletteScene & TerrainScene;
export type SceneTerrainBuildProblem = { readonly code: string; readonly path: string; readonly message: string };
export type SceneTerrainBuildInputs = {
  readonly scene: SceneTerrainBuildScene;
  readonly tilesets: ReadonlyMap<string, TerrainTileset>;
  readonly loadTile: (path: string) => Promise<NativeTile | null>;
  readonly resolveCrop: (sample: NativeTileSample) => Promise<SceneTileCrop | null>;
};
export type SceneTerrainBuildResult =
  | { readonly ok: false; readonly problems: readonly SceneTerrainBuildProblem[] }
  | {
      readonly ok: true;
      readonly floors: readonly { readonly id: string; readonly tiles: readonly (readonly [number, number])[] }[];
      readonly palette: readonly string[] | null;
      readonly tiles: readonly (NativeTile | null)[];
      readonly outputs: readonly { readonly path: string; readonly bytes: Uint8Array }[];
      readonly notes: readonly SceneTerrainBuildProblem[];
    };

const fold = (path: string): string => documentId(path).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
type InventoryEntry = { readonly path: string; readonly tileset: TerrainTileset };

/** Prepare terrain and its generated tile assets without performing persistence. */
export async function buildSceneTerrain(inputs: SceneTerrainBuildInputs): Promise<SceneTerrainBuildResult> {
  // docs/spec/formats/native-scene.md#resolving-painted-terrain
  // docs/spec/formats/native-tileset.md#terrain-cutover
  const { scene } = inputs;
  const problems: SceneTerrainBuildProblem[] = [];
  const fail = (code: string, path: string, message: string): void => { problems.push({ code, path, message }); };
  const inventory = new Map<string, InventoryEntry>();
  const owners = new Map<string, InventoryEntry[]>();
  for (const [path, tileset] of [...inputs.tilesets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const entry = { path, tileset };
    const key = fold(path);
    if (inventory.has(key)) fail("terrain-tileset-duplicate", path, "Multiple tileset documents have the same identity.");
    else inventory.set(key, entry);
    for (const member of tileset.tiles) {
      const id = fold(member.tile);
      const list = owners.get(id) ?? [];
      if (!list.includes(entry)) list.push(entry);
      owners.set(id, list);
    }
  }
  const used = new Map<string, InventoryEntry>();
  const recipes = new Map<string, NonNullable<TerrainTileset["terrains"]>[number]>();
  for (const [index, region] of (scene.terrainRegions ?? []).entries()) {
    const path = `terrainRegions[${index}].terrain`;
    const key = fold(region.terrain.tileset);
    const entry = inventory.get(key);
    if (entry === undefined) { fail("terrain-reference-unavailable", path, `Cannot resolve tileset ${region.terrain.tileset}.`); continue; }
    const recipe = entry.tileset.terrains?.find((terrain) => terrain.id === region.terrain.terrain);
    if (recipe === undefined) { fail("terrain-reference-unavailable", path, `Cannot resolve terrain ${region.terrain.terrain}.`); continue; }
    if (recipe.resolver.provider !== "builtin" || recipe.resolver.id !== "neighbour-match" || recipe.resolver.version !== "1.0.0") {
      fail("terrain-resolver-unavailable", path, "The pinned terrain resolver is unavailable.");
      continue;
    }
    used.set(key, entry);
    recipes.set(`${key}\0${recipe.id}`, recipe);
  }
  if (problems.length) return { ok: false, problems };
  const resolved = resolveSceneTerrain(scene, (reference) => recipes.get(`${fold(reference.tileset)}\0${reference.terrain}`) ?? null);
  if (!resolved.ok) return resolved;
  const lowered = lowerSceneTerrainPalette(scene, resolved.floors);
  if (!lowered.ok) return lowered;

  const tiles = new Map<string, NativeTile>();
  const load = async (path: string, location: string): Promise<NativeTile | null> => {
    const key = fold(path);
    const cached = tiles.get(key);
    if (cached !== undefined) return cached;
    try {
      const tile = await inputs.loadTile(path);
      if (tile === null) { fail("terrain-tile-unavailable", location, `Cannot resolve tile ${path}.`); return null; }
      tiles.set(key, tile);
      return tile;
    } catch (error) { fail("terrain-tile-unavailable", location, `Cannot resolve tile ${path}: ${String(error)}`); return null; }
  };
  for (const [index, entry] of (lowered.palette ?? []).entries()) {
    if (entry.tile === undefined) continue;
    const id = fold(entry.tile);
    const matches = owners.get(id) ?? [];
    const path = `tilePalette[${index}].tile`;
    if (matches.length !== 1) { fail("terrain-tile-owner", path, matches.length === 0 ? `No tileset owns ${entry.tile}.` : `More than one tileset owns ${entry.tile}.`); continue; }
    used.set(fold(matches[0]!.path), matches[0]!);
  }
  for (const [key, entry] of [...used].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const { tileset, path } = entry;
    if (tileset.expects.projection !== scene.projection) fail("terrain-projection-mismatch", `${path}.expects.projection`, "Tileset projection differs from the scene.");
    const detail = tilesetDetail(tileset.outputBinding.detail);
    if (detail === undefined || detail.isometric || tileDimensions(detail).width !== tileset.expects.cellSize[0] || tileDimensions(detail).height !== tileset.expects.cellSize[1]) {
      fail("terrain-cell-size-mismatch", `${path}.expects.cellSize`, "Tileset cell size does not match its generated output detail.");
    }
    const members = new Set(tileset.tiles.map(({ tile }) => fold(tile)));
    for (const [index, member] of tileset.tiles.entries()) {
      const location = `${path}.tiles[${index}].tile`;
      const matches = owners.get(fold(member.tile)) ?? [];
      if (matches.length !== 1) fail("terrain-tile-owner", location, `Tile ${member.tile} must have exactly one owning tileset.`);
      const tile = await load(member.tile, location);
      if (tile !== null && tile.projection !== tileset.expects.projection) fail("terrain-projection-mismatch", location, "Tile projection differs from its tileset.");
    }
    for (const [index, recipe] of (tileset.terrains ?? []).entries()) {
      if (!recipes.has(`${key}\0${recipe.id}`)) continue;
      let timing: string | undefined;
      for (const [ruleIndex, rule] of recipe.rules.entries()) {
        const selected = rule.use !== undefined ? [rule.use] : rule.variants;
        for (const reference of selected) {
          const location = `${path}.terrains[${index}].rules[${ruleIndex}]`;
          if (!members.has(fold(reference.tile))) { fail("terrain-tile-not-member", location, `Tile ${reference.tile} is not a member of this tileset.`); continue; }
          const tile = tiles.get(fold(reference.tile));
          if (tile === undefined || recipe.sync !== "lockstep") continue;
          const timeline = tile.visual.timeline;
          const value = timeline === undefined ? "still" : JSON.stringify([timeline.phaseMs ?? 0, timeline.frames.map((frame) => frame.ms)]);
          if (timing === undefined) timing = value;
          else if (timing !== value) fail("terrain-lockstep-mismatch", location, "Lockstep tiles must all be still or have identical frame durations and phase.");
        }
      }
    }
  }
  if (problems.length) return { ok: false, problems };
  const references = new Map<string, string>();
  const outputs: { path: string; bytes: Uint8Array }[] = [];
  for (const [, { path, tileset }] of [...used].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const members = tileset.tiles.map(({ tile }) => ({ path: tile, tile: tiles.get(fold(tile))! }));
    try {
      const result = await lowerSceneTileSlots(tileset.outputBinding, members, async (sample) => {
        const crop = await inputs.resolveCrop(sample);
        if (crop !== null && (crop.rect[2] !== tileset.expects.cellSize[0] || crop.rect[3] !== tileset.expects.cellSize[1])) throw new Error("Tile crop dimensions differ from the tileset cell size.");
        return crop;
      });
      if (!result.ok) { for (const problem of result.problems) fail("terrain-tile-lowering", `${path}:${problem.path}`, problem.message); continue; }
      outputs.push(...result.outputs);
      for (const [id, reference] of result.references) references.set(id, reference);
    } catch (error) { fail("terrain-crop-unavailable", path, String(error)); }
  }
  if (problems.length) return { ok: false, problems };
  const palette: string[] | null = lowered.palette === null ? null : [];
  const paletteTiles: (NativeTile | null)[] = [];
  for (const entry of lowered.palette ?? []) {
    if (entry.tile === undefined) { palette!.push(entry.legacy ?? ""); paletteTiles.push(null); }
    else { palette!.push(references.get(fold(entry.tile))!); paletteTiles.push(tiles.get(fold(entry.tile))!); }
  }
  return { ok: true, floors: lowered.floors, palette, tiles: paletteTiles, outputs, notes: resolved.notes };
}
