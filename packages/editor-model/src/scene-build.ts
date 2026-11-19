import { writeBoard, type Board } from "@tk-reawakened/core";
import { checkScene, documentId, type AssetPack, type Scene, type Tileset } from "@tk-reawakened/native-data";
import { lowerSceneBoard } from "./scene-board-lowering.ts";
import { lowerScenePackImages } from "./scene-pack-images.ts";
import { lowerScenePackVectors } from "./scene-pack-vectors.ts";
import { generateSceneTileCollision, type SceneTileCollisionFlag } from "./scene-tile-collision.ts";
import { lowerSceneTileset } from "./scene-tileset-build.ts";

export interface SceneBuildInputs {
  readonly scenePath: string;
  readonly scene: Scene;
  readonly resolveTileset: (path: string) => Promise<Tileset | null>;
  readonly resolvePack: (path: string) => Promise<AssetPack | null>;
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
    if (floor.boundarySources !== undefined) problems.push({ path: `floors[${index}].boundarySources`, message: "Boundary-source tracing is not specified by the scene contract." });
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
  const tilesets = new Map<string, Awaited<ReturnType<typeof lowerSceneTileset>>>();
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
  if (problems.length > 0) return { ok: false, problems };

  const lower = lowerSceneBoard(scene, palette);
  if (!lower.ok) return lower;
  const packs = new Map<string, AssetPack>();
  for (const [index, placement] of (scene.placedPacks ?? []).entries()) {
    const key = fold(placement.pack);
    if (packs.has(key)) continue;
    const pack = await inputs.resolvePack(placement.pack);
    if (pack === null) problems.push({ path: `placedPacks[${index}].pack`, message: `Cannot resolve ${placement.pack}.` });
    else {
      sources.add(key);
      for (const source of pack.sources) sources.add(fold(source.file));
      packs.set(key, pack);
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  const images = await lowerScenePackImages(scene, scenePath, async (path) => packs.get(fold(path)) ?? null, inputs.readSource, outputs.map((output) => output.path));
  if (!images.ok) return images;
  let tileVectors;
  try { tileVectors = generateSceneTileCollision(scene, flags); }
  catch (error) { return { ok: false, problems: [{ path: "tilePalette", message: String(error) }] }; }
  const packVectors = lowerScenePackVectors(scene, (path, id) => packs.get(fold(path))?.assets.find((asset) => asset.id === id) ?? null, lower.board.vectors.length + tileVectors.length);
  if (!packVectors.ok) return packVectors;
  const board: Board = { ...lower.board, images: [...lower.board.images, ...images.images], vectors: [...lower.board.vectors, ...tileVectors, ...packVectors.vectors] };
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
