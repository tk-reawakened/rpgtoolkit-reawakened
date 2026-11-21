import { tileDimensions, tilesetDetail } from "@tk-reawakened/core";
import { documentId, foldId, type NativeTile, type NativeTileSample, type SceneTerrainCellTile, type Tileset } from "@tk-reawakened/native-data";
import { resolveSceneTerrain, type TerrainScene } from "./scene-terrain.ts";
import { lowerSceneTerrainPalette, type TerrainPaletteScene } from "./scene-terrain-palette.ts";
import { lowerSceneTileSlots, type SceneTileCrop } from "./scene-tile-slots.ts";

type TerrainBuildFloor = TerrainPaletteScene["floors"][number] & TerrainScene["floors"][number];
export type SceneTerrainBuildScene = Omit<TerrainPaletteScene, "floors"> & Omit<TerrainScene, "floors"> & {
  readonly floors: readonly TerrainBuildFloor[];
};
export type SceneTerrainBuildProblem = { readonly code: string; readonly path: string; readonly message: string };
export type SceneTerrainBuildInputs = {
  readonly scene: SceneTerrainBuildScene;
  /** The project's native tilesets, keyed by their workspace path. */
  readonly tilesets: ReadonlyMap<string, Tileset>;
  /** Reads a tile document at its workspace path (native document references are workspace-relative). */
  readonly loadTile: (path: string) => Promise<NativeTile | null>;
  /** Resolves a sample by the `file` or `source` path the tile document names. */
  readonly resolveCrop: (sample: NativeTileSample) => Promise<SceneTileCrop | null>;
  /** The scene's project folder (empty at the project root); generated `Tiles/` targets are placed under it. */
  readonly projectFolder?: string;
};
export type SceneTerrainBuildOutput = { readonly path: string; readonly bytes: Uint8Array; readonly producer: string };
export type SceneTerrainBuildResult =
  | { readonly ok: false; readonly problems: readonly SceneTerrainBuildProblem[] }
  | {
      readonly ok: true;
      readonly floors: readonly { readonly id: string; readonly tiles: readonly (readonly [number, number])[] }[];
      /** Board LUT text per slot, or `null` when the scene has no palette. */
      readonly palette: readonly string[] | null;
      /** The final palette entries, aligned with `palette`. */
      readonly entries: readonly SceneTerrainCellTile[] | null;
      /** The standalone tile behind each palette slot; `null` for legacy and empty slots. */
      readonly tiles: readonly (NativeTile | null)[] | null;
      readonly outputs: readonly SceneTerrainBuildOutput[];
      /** Every project file the build read or generated, for the overwrite guard. */
      readonly sources: readonly string[];
      readonly notes: readonly SceneTerrainBuildProblem[];
    };

const fold = (path: string): string => foldId(documentId(path));
type InventoryEntry = { readonly path: string; readonly tileset: Tileset };
type Output = { readonly path: string; readonly bytes: Uint8Array; readonly producer: string };

/**
 * Prepare the final palette, terrain and generated tile assets without persisting anything
 * (docs/spec/formats/native-tileset.md#terrain-cutover, docs/spec/formats/native-scene.md#the-tile-palette).
 *
 * This is the only tileset compiler: every native palette, override, terrain or boundary reference is
 * lowered through the standalone tileset that owns the tile. A reference that no tileset owns, that two
 * tilesets own, or that its tileset does not allocate is an error; nothing is substituted.
 */
export async function buildSceneTerrain(inputs: SceneTerrainBuildInputs): Promise<SceneTerrainBuildResult> {
  const { scene } = inputs;
  const projectFolder = inputs.projectFolder ?? "";
  const problems: SceneTerrainBuildProblem[] = [];
  const fail = (code: string, path: string, message: string): void => { problems.push({ code, path, message }); };
  const sources = new Set<string>();

  const inventory = new Map<string, InventoryEntry>();
  const owners = new Map<string, InventoryEntry[]>();
  const entries = [...inputs.tilesets].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  for (const [path, tileset] of entries) {
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
    sources.add(fold(path));
    for (const source of tileset.sources ?? []) sources.add(fold(source.file));
  }

  // A generated target belongs to one document, whether or not this scene uses it.
  const targets = new Map<string, string>();
  for (const [path, tileset] of entries) {
    const target = documentId(tileset.outputBinding.target);
    const key = fold(target);
    const previous = targets.get(key);
    if (previous !== undefined) fail("terrain-target-duplicate", `${path}.outputBinding.target`, `${target} is also declared by ${previous}; one generated target needs one producer.`);
    else targets.set(key, path);
  }

  const used = new Map<string, InventoryEntry>();
  const recipes = new Map<string, NonNullable<Tileset["terrains"]>[number]>();
  const own = (tile: string, location: string): InventoryEntry | null => {
    const matches = owners.get(fold(tile)) ?? [];
    if (matches.length === 1) { used.set(fold(matches[0]!.path), matches[0]!); return matches[0]!; }
    fail("terrain-tile-owner", location, matches.length === 0 ? `No tileset owns ${tile}.` : `More than one tileset owns ${tile}.`);
    return null;
  };
  for (const [index, entry] of (scene.tilePalette ?? []).entries()) {
    if (entry.tile !== undefined) own(entry.tile, `tilePalette[${index}].tile`);
  }
  for (const [floorIndex, floor] of scene.floors.entries()) {
    for (const [sourceIndex, reference] of (floor.boundarySources?.walkableTiles ?? []).entries()) {
      if (reference.tile !== undefined) own(reference.tile, `floors[${floorIndex}].boundarySources.walkableTiles[${sourceIndex}].tile`);
    }
  }
  for (const [index, override] of (scene.tileOverrides ?? []).entries()) {
    if (override.tile.tile !== undefined) own(override.tile.tile, `tileOverrides[${index}].tile.tile`);
  }
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
  // The palette's slots decide which tilesets this build emits, even when no cell paints them.
  for (const [index, entry] of (lowered.palette ?? []).entries()) {
    if (entry.tile === undefined) continue;
    const matches = owners.get(fold(entry.tile)) ?? [];
    if (matches.length !== 1) { fail("terrain-tile-owner", `tilePalette[${index}].tile`, matches.length === 0 ? `No tileset owns ${entry.tile}.` : `More than one tileset owns ${entry.tile}.`); continue; }
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
      if (tile === null) continue;
      sources.add(fold(member.tile));
      if (tile.projection !== tileset.expects.projection) fail("terrain-projection-mismatch", location, "Tile projection differs from its tileset.");
      const samples = tile.visual.sample !== undefined ? [tile.visual.sample] : tile.visual.cels.map((cel) => cel.sample);
      for (const sample of samples) {
        if ("file" in sample && (sample.rect[2] !== tileset.expects.cellSize[0] || sample.rect[3] !== tileset.expects.cellSize[1])) {
          fail("terrain-cell-size-mismatch", location, `Tile sample is ${sample.rect[2]}×${sample.rect[3]}; the tileset expects ${tileset.expects.cellSize[0]}×${tileset.expects.cellSize[1]}.`);
          break;
        }
        sources.add(fold("file" in sample ? sample.file : sample.source));
      }
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
  const outputs: Output[] = [];
  for (const [, { path, tileset }] of [...used].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const members = tileset.tiles.map(({ tile }) => ({ path: tile, tile: tiles.get(fold(tile))! }));
    try {
      const result = await lowerSceneTileSlots(tileset.outputBinding, members, async (sample) => {
        const crop = await inputs.resolveCrop(sample);
        if (crop !== null && (crop.rect[2] !== tileset.expects.cellSize[0] || crop.rect[3] !== tileset.expects.cellSize[1])) throw new Error("Tile crop dimensions differ from the tileset cell size.");
        return crop;
      }, projectFolder);
      if (!result.ok) { for (const problem of result.problems) fail("terrain-tile-lowering", `${path}:${problem.path}`, problem.message); continue; }
      outputs.push(...result.outputs.map((output) => ({ ...output, producer: path })));
      for (const [id, reference] of result.references) references.set(id, reference);
    } catch (error) { fail("terrain-crop-unavailable", path, String(error)); }
  }
  if (problems.length) return { ok: false, problems };

  const paletteEntries = lowered.palette;
  const palette: string[] | null = paletteEntries === null ? null : [];
  const standalone: (NativeTile | null)[] | null = paletteEntries === null ? null : [];
  for (const [index, entry] of (paletteEntries ?? []).entries()) {
    if (entry.legacy !== undefined) {
      palette!.push(entry.legacy);
      standalone!.push(null);
      continue;
    }
    if (entry.tile === undefined) {
      palette!.push("");
      standalone!.push(null);
      continue;
    }
    const reference = references.get(fold(entry.tile));
    if (reference === undefined) { fail("terrain-tile-unallocated", `tilePalette[${index}].tile`, `${entry.tile} has no allocated output slot in its owning tileset.`); continue; }
    palette!.push(reference);
    standalone!.push(tiles.get(fold(entry.tile))!);
  }
  // Every native boundary reference resolves through its tileset, even when no palette slot or cell uses it.
  for (const [floorIndex, floor] of scene.floors.entries()) {
    for (const [sourceIndex, reference] of (floor.boundarySources?.walkableTiles ?? []).entries()) {
      if (reference.tile === undefined) continue;
      if (references.get(fold(reference.tile)) === undefined) {
        fail("terrain-boundary-unresolved", `floors[${floorIndex}].boundarySources.walkableTiles[${sourceIndex}].tile`, `${reference.tile} is not allocated by its owning tileset's output binding.`);
      }
    }
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    floors: lowered.floors,
    palette,
    entries: paletteEntries,
    tiles: standalone,
    outputs,
    sources: [...sources].sort(),
    notes: resolved.notes,
  };
}
