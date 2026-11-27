/**
 * Pack placements as the editor manipulates them: one record names a pack asset and its spot on a
 * floor (docs/spec/formats/native-scene.md#pack-placements). These helpers change only the scene
 * model; the owning document turns the model into an in-place text edit, so the rest of the file is
 * preserved. An instance ID is the placement's identity: a move keeps it, a copy gets a fresh one.
 */

import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH } from "@tk-reawakened/core";
import { documentId, foldId } from "@tk-reawakened/native-data";
import type { Scene, ScenePlacedPack, SceneProjection } from "@tk-reawakened/native-data";
import { coordTypeOf } from "./board-creation.ts";
import { cellCentre, cellOnBoard, TILE_PIXELS, type BoardShape, type Pixel } from "./board-geometry.ts";

/** A pack asset the scene editor can place: the pack's own name, projection and local assets. */
export type TerrainScenePackAsset = {
  readonly id: string;
  readonly name: string;
  readonly kind: "stamp" | "prop" | "backdrop";
  readonly anchor: { readonly x: number; readonly y: number; readonly snap: string };
};

export type TerrainScenePack = {
  /** The pack document's project-relative path, the only spelling a placement may name. */
  readonly path: string;
  readonly name: string;
  readonly projection: SceneProjection;
  readonly assets: readonly TerrainScenePackAsset[];
  /** Hash of the pack document and its referenced artwork, used to expire scene previews. */
  readonly revision: string;
  /** True when the pack is outside this game and only listed because the scene already names it. */
  readonly external?: boolean;
};

/** The document identity a stored pack path resolves by, exactly as the compiler folds it. */
const packIdentity = (path: string): string => foldId(documentId(path));

/**
 * The inventory entry a stored `pack` path resolves to, compared by document identity so spelling
 * case and `/`-path form never decide whether a placement is missing. Its `path` is the canonical
 * spelling the owner opener must receive; `null` means the pack is absent from the project.
 */
export function findTerrainScenePack(packs: readonly TerrainScenePack[], packPath: string): TerrainScenePack | null {
  const key = packIdentity(packPath);
  return packs.find((candidate) => packIdentity(candidate.path) === key) ?? null;
}

/** What a placement cannot resolve, so the editor can show a reference that stays visible and removable. */
export function scenePackPlacementMissing(packs: readonly TerrainScenePack[], placement: ScenePlacedPack): "pack" | "asset" | null {
  const pack = findTerrainScenePack(packs, placement.pack);
  if (pack === null) return "pack";
  return pack.assets.some((candidate) => candidate.id === placement.asset) ? null : "asset";
}

/**
 * A fresh instance ID beside `base`: `<stem>-1`, `<stem>-2`, and so on, skipping every ID in use.
 * A copy of `lantern-1` therefore becomes `lantern-2`, and a copy of `arch` becomes `arch-1`.
 */
export function nextScenePackPlacementId(placements: readonly ScenePlacedPack[], base: string): string {
  const used = new Set(placements.map((placement) => placement.instanceId));
  const stem = base.replace(/-copy(?:-\d+)?$/, "").replace(/-\d+$/, "") || "placement";
  let suffix = 1;
  while (used.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

/** A pack asset snaps in projected board pixels, not in the rectangular storage grid. */
export function placementPointForCell(scene: Pick<Scene, "size" | "projection">, snap: string, cellX: number, cellY: number): Pixel | null {
  const shape: BoardShape = { sizeX: scene.size.width, sizeY: scene.size.height, coordType: coordTypeOf({ coordSystem: scene.projection, pixelCoordinates: false }) };
  if (!cellOnBoard(shape, cellX, cellY)) return null;
  const { x, y } = cellCentre(shape, cellX, cellY);
  const halfWidth = (scene.projection === "2d" ? TILE_PIXELS : ISO_TILE_WIDTH) / 2;
  const halfHeight = (scene.projection === "2d" ? TILE_PIXELS : ISO_TILE_HEIGHT) / 2;
  if (snap === "bottom-center") return { x, y: y + halfHeight };
  if (snap === "iso-diamond-center") return { x, y };
  return { x: x - halfWidth, y: y - halfHeight };
}

/** Add one placement for a pack asset and return the scene with its fresh instance ID. */
export function placeScenePackAsset(
  scene: Scene,
  choice: { readonly pack: string; readonly asset: string; readonly floor: string },
  x: number,
  y: number,
): { readonly scene: Scene; readonly instanceId: string } {
  const placements = scene.placedPacks ?? [];
  const instanceId = nextScenePackPlacementId(placements, choice.asset);
  const placement: ScenePlacedPack = { instanceId, pack: choice.pack, asset: choice.asset, floor: choice.floor, x, y };
  return { scene: { ...scene, placedPacks: [...placements, placement] }, instanceId };
}

/** Move a placement to another floor or anchor without changing its identity; `null` when it is gone. */
export function moveScenePackPlacement(
  scene: Scene,
  instanceId: string,
  change: { readonly floor?: string; readonly x?: number; readonly y?: number },
): Scene | null {
  const placements = scene.placedPacks ?? [];
  const index = placements.findIndex((placement) => placement.instanceId === instanceId);
  if (index < 0) return null;
  return { ...scene, placedPacks: placements.map((placement, at) => (at === index ? { ...placement, ...change } : placement)) };
}

/** Copy a placement in place, keeping its pack asset, floor and anchor, under a fresh identity. */
export function copyScenePackPlacement(scene: Scene, instanceId: string): { readonly scene: Scene; readonly instanceId: string } | null {
  const placements = scene.placedPacks ?? [];
  const index = placements.findIndex((placement) => placement.instanceId === instanceId);
  if (index < 0) return null;
  const source = placements[index]!;
  const copyId = nextScenePackPlacementId(placements, source.instanceId);
  const copy: ScenePlacedPack = { ...source, instanceId: copyId };
  return {
    scene: { ...scene, placedPacks: [...placements.slice(0, index + 1), copy, ...placements.slice(index + 1)] },
    instanceId: copyId,
  };
}

/** Remove a placement; an ID that is not there leaves the scene unchanged. */
export function removeScenePackPlacement(scene: Scene, instanceId: string): Scene {
  const placements = scene.placedPacks ?? [];
  if (!placements.some((placement) => placement.instanceId === instanceId)) return scene;
  return { ...scene, placedPacks: placements.filter((placement) => placement.instanceId !== instanceId) };
}
