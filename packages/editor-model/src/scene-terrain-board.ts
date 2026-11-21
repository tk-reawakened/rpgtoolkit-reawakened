import { writeBoard, type Board } from "@tk-reawakened/core";
import type { Scene } from "@tk-reawakened/native-data";
import { lowerSceneBoard } from "./scene-board-lowering.ts";
import { buildSceneTerrain, type SceneTerrainBuildInputs } from "./scene-terrain-build.ts";
import { lowerSceneTileGeometry } from "./scene-tile-geometry.ts";

type TileScene = Omit<Scene, "tilePalette"> & Pick<SceneTerrainBuildInputs["scene"], "tilePalette">;
type Problem = { readonly path: string; readonly message: string };
type Output = { readonly path: string; readonly bytes: Uint8Array };
type Result = { readonly ok: true; readonly board: Board; readonly outputs: readonly Output[]; readonly notes: readonly Problem[] }
  | { readonly ok: false; readonly problems: readonly Problem[] };

/** Serialize the resolved tile layer and explicit tile geometry through the ordinary board writer. */
export async function buildTerrainBoard(
  inputs: Omit<SceneTerrainBuildInputs, "scene"> & { readonly scene: TileScene; readonly scenePath: string },
): Promise<Result> {
  const { scene, scenePath } = inputs;
  const resolution = await buildSceneTerrain(inputs);
  if (!resolution.ok) return resolution;
  const { tilePalette: _palette, ...source } = scene;
  const floors = scene.floors.map((floor, index) => ({ ...floor, tiles: resolution.floors[index]!.tiles }));
  const projected: Scene = {
    ...source, floors,
    ...(resolution.palette === null ? {} : { tilePalette: resolution.palette.map((legacy) => legacy === "" ? {} : { legacy }) }),
  };
  const lowered = lowerSceneBoard(projected, resolution.palette);
  if (!lowered.ok) return lowered;
  const geometry = lowerSceneTileGeometry({ projection: scene.projection, size: scene.size, floors }, resolution.tiles, 32768 - lowered.board.vectors.length);
  if (!geometry.ok) return geometry;
  const board = { ...lowered.board, vectors: [...lowered.board.vectors, ...geometry.vectors] };
  const written = writeBoard(board);
  if (!written.ok) return { ok: false, problems: [{ path: "board", message: written.error.message }] };
  return { ok: true, board, outputs: [...resolution.outputs, { path: `${scenePath.slice(0, -7)}.brd`, bytes: written.value }], notes: resolution.notes };
}
