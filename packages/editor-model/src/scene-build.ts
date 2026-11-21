import { writeBoard, type Board } from "@tk-reawakened/core";
import { checkScene, documentId, type AssetPack, type NativeTile, type Scene, type Tileset } from "@tk-reawakened/native-data";
import { traceSceneBoundaries } from "./scene-boundary-tracing.ts";
import { lowerSceneBoard } from "./scene-board-lowering.ts";
import { lowerScenePackImages } from "./scene-pack-images.ts";
import { lowerScenePackVectors } from "./scene-pack-vectors.ts";
import { buildSceneTerrain, type SceneTerrainBuildInputs } from "./scene-terrain-build.ts";
import { generateSceneTileCollision, type SceneTileCollisionFlag } from "./scene-tile-collision.ts";
import { lowerSceneTileset, type SceneTilesetBuildResult } from "./scene-tileset-build.ts";

/** One entry of a floor's boundary sources; the package does not export the name. */
type SceneTileReference = NonNullable<NonNullable<Scene["floors"][number]["boundarySources"]>["walkableTiles"]>[number];

function boundaryPaletteSlots(scene: Scene, floorIndex: number, builtTilesets: ReadonlyMap<string, SceneTilesetBuildResult>): readonly number[] {
  const sources = scene.floors[floorIndex]?.boundarySources?.walkableTiles ?? [];
  const matches = (entry: SceneTileReference): string => entry.tileset === undefined
    ? `legacy:${entry.legacy.toLowerCase()}`
    : `native:${fold(entry.tileset)}#${entry.tile}`;
  const wanted = new Set(sources.map(matches));
  return (scene.tilePalette ?? []).flatMap((entry, index) => {
    if (entry.tileset === undefined && entry.legacy === undefined) return [];
    if (!wanted.has(matches(entry as SceneTileReference))) return [];
    if (entry.tileset !== undefined) {
      const built = builtTilesets.get(fold(entry.tileset));
      if (built?.ok !== true || !built.tiles.some((tile) => tile.id === entry.tile)) return [];
    }
    return [index];
  });
}

export interface SceneBuildInputs {
  readonly scenePath: string;
  readonly scene: Scene;
  readonly resolveTileset: (path: string) => Promise<Tileset | null>;
  readonly resolvePack: (path: string) => Promise<AssetPack | null>;
  readonly terrain?: Omit<SceneTerrainBuildInputs, "scene">;
  readonly readSource: (path: string) => Promise<Uint8Array | null>;
}
export interface SceneBuildProblem { readonly path: string; readonly message: string }
export interface SceneBuildOutput { readonly path: string; readonly bytes: Uint8Array }
export type SceneBuildResult =
  | { readonly ok: true; readonly board: Board; readonly outputs: readonly SceneBuildOutput[]; readonly notes: readonly SceneBuildProblem[] }
  | { readonly ok: false; readonly problems: readonly SceneBuildProblem[] };

const fold = (path: string): string => documentId(path).replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Prepare outputs without writing them; the ownership coordinator must check before persistence. */
export async function buildScene(inputs: SceneBuildInputs): Promise<SceneBuildResult> {
  const { scene, scenePath } = inputs;
  const problems: SceneBuildProblem[] = [...checkScene(scene)];
  if (!scenePath.toLowerCase().endsWith(".tkrscn")) problems.push({ path: "scenePath", message: "The source must have a .tkrscn extension." });
  for (const [index, floor] of scene.floors.entries()) {
    if (floor.boundarySources?.autoWallCaps === true) problems.push({ path: `floors[${index}].boundarySources.autoWallCaps`, message: "Automatic wall caps are unsupported; omit autoWallCaps or set it to false." });
  }
  if (problems.length > 0) return { ok: false, problems };
  const notes: SceneBuildProblem[] = [];
  const note = (path: string, message: string): void => { notes.push({ path, message }); };
  for (const [key, records] of [
    ["shading", scene.shading], ["lights", scene.lights], ["vectors", scene.vectors],
    ["triggers", scene.triggers], ["items", scene.items], ["images", scene.images],
  ] as const) {
    records?.forEach((record, index) => {
      if (record.id !== undefined) note(`${key}[${index}].id`, "The board stores the slot index, not the native record ID.");
    });
  }
  scene.vectors?.forEach((vector, index) => {
    if (vector.label !== undefined) note(`vectors[${index}].label`, "The board does not store the vector label.");
  });
  if (scene.tilePalette?.some((entry) => entry.tileset !== undefined)) note("tilePalette", "Native tile links are compiled to legacy tile references and collision vectors.");
  if ((scene.placedPacks?.length ?? 0) > 0) note("placedPacks", "Pack placements are expanded; the board does not retain their provenance.");
  if (scene.name !== undefined) note("name", "The board does not store the scene name.");
  if (scene.tags !== undefined) note("tags", "The board does not store scene tags.");
  if (scene.metadata !== undefined) note("metadata", "The board does not store scene metadata.");
  for (const plugin of Object.keys(scene.pluginData ?? {})) note(`pluginData.${plugin}`, "The board does not store this plugin block.");

  const outputs: SceneBuildOutput[] = [];
  const sources = new Set<string>([fold(scenePath)]);
  const tilesets = new Map<string, SceneTilesetBuildResult>();
  const palette: string[] | null = scene.tilePalette === undefined ? null : [];
  const flags: SceneTileCollisionFlag[] = [];
  for (const [index, entry] of (scene.tilePalette ?? []).entries()) {
    if (entry.tileset === undefined) {
      palette!.push(entry.legacy ?? "");
      flags.push(null);
      continue;
    }
    const key = fold(entry.tileset);
    sources.add(key);
    let built = tilesets.get(key);
    if (built === undefined) {
      const tileset = await inputs.resolveTileset(entry.tileset);
      if (tileset === null) { problems.push({ path: `tilePalette[${index}].tileset`, message: `Cannot resolve ${entry.tileset}.` }); continue; }
      for (const source of tileset.sources) sources.add(fold(source.file));
      if (tileset.projection !== scene.projection) { problems.push({ path: `tilePalette[${index}].tileset`, message: "Tileset projection differs from the scene." }); continue; }
      built = await lowerSceneTileset(tileset, inputs.readSource);
      tilesets.set(key, built);
      if (built.ok) {
        if (!/^Tiles\//i.test(built.target)) problems.push({ path: `tilePalette[${index}].tileset`, message: "Generated tileset must be under Tiles/." });
        else outputs.push({ path: built.target, bytes: built.bytes });
        notes.push(...built.notes);
      }
    }
    if (!built.ok) { problems.push(...built.problems); continue; }
    const tile = built.tiles.find((candidate) => candidate.id === entry.tile);
    if (tile === undefined) { problems.push({ path: `tilePalette[${index}].tile`, message: `Cannot resolve tile ${entry.tile}.` }); continue; }
    palette!.push(`${built.target.replaceAll("/", "\\")}${tile.index}`);
    flags.push(tile.collision);
  }
  for (const [floorIndex, floor] of scene.floors.entries()) {
    for (const [sourceIndex, reference] of (floor.boundarySources?.walkableTiles ?? []).entries()) {
      if (reference.tileset === undefined) continue;
      const key = fold(reference.tileset);
      let built = tilesets.get(key);
      if (built === undefined) {
        const tileset = await inputs.resolveTileset(reference.tileset);
        const path = `floors[${floorIndex}].boundarySources.walkableTiles[${sourceIndex}].tileset`;
        if (tileset === null) { problems.push({ path, message: `Cannot resolve ${reference.tileset}.` }); continue; }
        sources.add(key);
        for (const source of tileset.sources) sources.add(fold(source.file));
        if (tileset.projection !== scene.projection) { problems.push({ path, message: "Tileset projection differs from the scene." }); continue; }
        built = await lowerSceneTileset(tileset, inputs.readSource);
        tilesets.set(key, built);
        if (built.ok) {
          if (!/^Tiles\//i.test(built.target)) problems.push({ path, message: "Generated tileset must be under Tiles/." });
          else outputs.push({ path: built.target, bytes: built.bytes });
          notes.push(...built.notes);
        }
      }
      if (built?.ok !== true) problems.push(...(built?.problems ?? []));
      else if (!built.tiles.some((tile) => tile.id === reference.tile)) problems.push({ path: `floors[${floorIndex}].boundarySources.walkableTiles[${sourceIndex}].tile`, message: `Cannot resolve tile ${reference.tile}.` });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  let resolvedScene = scene;
  let resolvedPalette: readonly string[] | null = palette;
  let nativeTiles: readonly (NativeTile | null)[] = [];
  if ((scene.terrainRegions?.length ?? 0) > 0 || (scene.tileOverrides?.length ?? 0) > 0) {
    const terrain = inputs.terrain;
    if (terrain === undefined) return { ok: false, problems: [{ path: scenePath, message: "Terrain source resolution is unavailable." }] };
    // Embedded palette slots are already lowered. Keep their positions but do not let a legacy
    // override reuse one and accidentally inherit collision from its embedded tile.
    const { tilePalette, terrainRegions, tileOverrides, ...base } = scene;
    const resolved = await buildSceneTerrain({
      ...terrain,
      scene: {
        ...base, ...(terrainRegions === undefined ? {} : { terrainRegions }), ...(tileOverrides === undefined ? {} : { tileOverrides }),
        ...(tilePalette === undefined ? {} : { tilePalette: tilePalette.map(({ legacy }) => legacy === undefined ? {} : { legacy }) }),
      },
      loadTile(path) {
        sources.add(fold(path));
        return terrain.loadTile(path);
      },
      resolveCrop(sample) {
        sources.add(fold("source" in sample ? sample.source : sample.file));
        return terrain.resolveCrop(sample);
      },
    });
    if (!resolved.ok) return resolved;
    resolvedPalette = resolved.palette === null ? null : resolved.palette.map((text, index) => tilePalette?.[index]?.tileset === undefined ? text : palette![index]!);
    resolvedScene = {
      ...base,
      floors: scene.floors.map((floor, index) => ({ ...floor, tiles: resolved.floors[index]!.tiles })),
      ...(resolvedPalette === null ? {} : { tilePalette: resolvedPalette.map((text, index) => {
        const original = tilePalette?.[index];
        if (original?.tileset !== undefined) return original;
        return text === "" ? {} : { legacy: text };
      }) }),
    };
    while (flags.length < (resolvedPalette?.length ?? 0)) flags.push(null);
    nativeTiles = resolved.tiles;
    outputs.push(...resolved.outputs);
    notes.push(...resolved.notes);
    if ((terrainRegions?.length ?? 0) > 0) note("terrainRegions", "Painted terrain becomes board tiles; the original regions stay in the scene.");
    if ((tileOverrides?.length ?? 0) > 0) note("tileOverrides", "Manual overrides become board tiles; the original override records stay in the scene.");
  }
  const lower = lowerSceneBoard(resolvedScene, resolvedPalette);
  if (!lower.ok) return lower;
  const packs = new Map<string, AssetPack>();
  for (const [index, placement] of (scene.placedPacks ?? []).entries()) {
    const key = fold(placement.pack);
    if (packs.has(key)) continue;
    try {
      const pack = await inputs.resolvePack(placement.pack);
      if (pack === null) {
        problems.push({ path: `placedPacks[${index}].pack`, message: `Cannot resolve ${placement.pack}.` });
        continue;
      }
      sources.add(key);
      for (const source of pack.sources) sources.add(fold(source.file));
      packs.set(key, pack);
    } catch (error) {
      problems.push({ path: `placedPacks[${index}].pack`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const images = await lowerScenePackImages(scene, scenePath, async (path) => packs.get(fold(path)) ?? null, inputs.readSource, outputs.map((output) => output.path));
  if (!images.ok) return images;
  let tileVectors;
  try { tileVectors = generateSceneTileCollision(resolvedScene, flags, nativeTiles); }
  catch (error) { return { ok: false, problems: [{ path: "tilePalette", message: error instanceof Error ? error.message : String(error) }] }; }
  const packVectors = lowerScenePackVectors(scene, (path, id) => packs.get(fold(path))?.assets.find((asset) => asset.id === id) ?? null, lower.board.vectors.length + tileVectors.length);
  if (!packVectors.ok) return packVectors;
  const boundaryVectors = resolvedScene.floors.flatMap((floor, floorIndex) => floor.boundarySources === undefined
    ? []
    : traceSceneBoundaries(resolvedScene, floorIndex, boundaryPaletteSlots(resolvedScene, floorIndex, tilesets)));
  const vectorCount = lower.board.vectors.length + tileVectors.length + packVectors.vectors.length + boundaryVectors.length;
  if (vectorCount > 32768) return { ok: false, problems: [{ path: "vectors", message: "vector table exceeds 32768 entries" }] };
  const board: Board = { ...lower.board, images: [...lower.board.images, ...images.images], vectors: [...lower.board.vectors, ...tileVectors, ...packVectors.vectors, ...boundaryVectors] };

  const encoded = writeBoard(board);
  if (!encoded.ok) return { ok: false, problems: [{ path: "board", message: encoded.error.message }] };
  outputs.push(...images.outputs, { path: `${scenePath.slice(0, -7)}.brd`, bytes: encoded.value });
  const identities = new Set<string>();
  for (const output of outputs) {
    const key = fold(output.path);
    if (sources.has(key)) return { ok: false, problems: [{ path: output.path, message: "A build output would overwrite a source document or image." }] };
    if (identities.has(key)) return { ok: false, problems: [{ path: output.path, message: "Two build outputs name the same path." }] };
    identities.add(key);
  }
  return { ok: true, board, outputs, notes };
}
