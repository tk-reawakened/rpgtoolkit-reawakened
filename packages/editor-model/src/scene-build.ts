import { asciiLower, writeBoard, type Board } from "@tk-reawakened/core";
import { checkScene, documentId, type AssetPack, type Scene } from "@tk-reawakened/native-data";
import { traceSceneBoundaries } from "./scene-boundary-tracing.ts";
import { lowerSceneBoard } from "./scene-board-lowering.ts";
import { lowerScenePackImages } from "./scene-pack-images.ts";
import { lowerScenePackVectors } from "./scene-pack-vectors.ts";
import { buildSceneTerrain, type SceneTerrainBuildInputs } from "./scene-terrain-build.ts";
import { generateSceneTileCollision } from "./scene-tile-collision.ts";
import type { SceneBuildOutput } from "./scene-build-ownership.ts";

export interface SceneBuildInputs {
  readonly scenePath: string;
  readonly scene: Scene;
  /** The scene's project folder in the workspace (empty at the project root). */
  readonly projectFolder?: string;
  readonly resolvePack: (path: string) => Promise<AssetPack | null>;
  readonly readSource: (path: string) => Promise<Uint8Array | null>;
  /** The project's native tilesets, standalone tiles and pixel resolver; the only tile compiler path. */
  readonly terrain: Omit<SceneTerrainBuildInputs, "scene" | "projectFolder">;
}
export interface SceneBuildProblem { readonly path: string; readonly message: string }
export type SceneBuildResult =
  | { readonly ok: true; readonly board: Board; readonly outputs: readonly SceneBuildOutput[]; readonly notes: readonly SceneBuildProblem[] }
  | { readonly ok: false; readonly problems: readonly SceneBuildProblem[] };

const fold = (path: string): string => documentId(path).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const slotKey = (slot: NonNullable<Scene["tilePalette"]>[number]): string =>
  slot.tile !== undefined ? `native:${fold(slot.tile)}` : slot.legacy !== undefined ? `legacy:${asciiLower(slot.legacy)}` : "empty";

/** Palette slots a floor's `walkableTiles` selects, by document identity for native tiles and stored text for legacy ones. */
function boundaryPaletteSlots(scene: Scene, floorIndex: number): readonly number[] {
  const sources = scene.floors[floorIndex]?.boundarySources?.walkableTiles ?? [];
  const wanted = new Set(sources.map(slotKey));
  const found: number[] = [];
  scene.tilePalette?.forEach((slot, index) => { if (wanted.has(slotKey(slot))) found.push(index); });
  return found;
}

/** Prepare outputs without writing them; the ownership coordinator must check before persistence. */
export async function buildScene(inputs: SceneBuildInputs): Promise<SceneBuildResult> {
  const { scene, scenePath } = inputs;
  const projectFolder = inputs.projectFolder ?? "";
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
  if (scene.tilePalette?.some((entry) => entry.tile !== undefined)) note("tilePalette", "Native tile links are compiled to legacy tile references and tile geometry.");
  if ((scene.placedPacks?.length ?? 0) > 0) note("placedPacks", "Pack placements are expanded; the board does not retain their provenance.");
  if (scene.name !== undefined) note("name", "The board does not store the scene name.");
  if (scene.tags !== undefined) note("tags", "The board does not store scene tags.");
  if (scene.metadata !== undefined) note("metadata", "The board does not store scene metadata.");
  for (const plugin of Object.keys(scene.pluginData ?? {})) note(`pluginData.${plugin}`, "The board does not store this plugin block.");

  const terrain = await buildSceneTerrain({ ...inputs.terrain, scene, projectFolder });
  if (!terrain.ok) return { ok: false, problems: terrain.problems.map(({ path, message }) => ({ path, message })) };
  const sources = new Set<string>([fold(scenePath), ...terrain.sources]);
  const { tilePalette, terrainRegions, tileOverrides, ...boardFields } = scene;
  const resolvedScene: Scene = {
    ...boardFields,
    floors: scene.floors.map((floor, index) => ({ ...floor, tiles: terrain.floors[index]!.tiles })),
    ...(terrain.entries === null ? {} : { tilePalette: terrain.entries }),
  };
  const lower = lowerSceneBoard(resolvedScene, terrain.palette);
  if (!lower.ok) return lower;
  if ((terrainRegions?.length ?? 0) > 0) note("terrainRegions", "Painted terrain becomes board tiles; the original regions stay in the scene.");
  if ((tileOverrides?.length ?? 0) > 0) note("tileOverrides", "Manual overrides become board tiles; the original override records stay in the scene.");
  notes.push(...terrain.notes);

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
      for (const source of pack.sources) sources.add(fold(source.file));
      packs.set(key, pack);
    } catch (error) {
      problems.push({ path: `placedPacks[${index}].pack`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const outputs: SceneBuildOutput[] = [...terrain.outputs];
  const images = await lowerScenePackImages(scene, scenePath, async (path) => packs.get(fold(path)) ?? null, inputs.readSource, outputs.map((output) => output.path), projectFolder);
  if (!images.ok) return images;
  let tileVectors;
  try { tileVectors = generateSceneTileCollision(resolvedScene, terrain.tiles ?? []); }
  catch (error) { return { ok: false, problems: [{ path: "tilePalette", message: error instanceof Error ? error.message : String(error) }] }; }
  const packVectors = lowerScenePackVectors(scene, (path, id) => packs.get(fold(path))?.assets.find((asset) => asset.id === id) ?? null, lower.board.vectors.length + tileVectors.length);
  if (!packVectors.ok) return packVectors;
  const boundaryVectors = resolvedScene.floors.flatMap((floor, floorIndex) => floor.boundarySources === undefined
    ? []
    : traceSceneBoundaries(resolvedScene, floorIndex, boundaryPaletteSlots(resolvedScene, floorIndex)));
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
