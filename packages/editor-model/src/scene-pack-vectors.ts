import type { BoardVector } from "@tk-reawakened/core";
import type { Scene } from "@tk-reawakened/native-data";

type PackVector = {
  readonly closed: boolean;
  readonly points: readonly (readonly [number, number])[];
};

type PackAsset = {
  readonly id: string;
  readonly solid?: readonly PackVector[];
  readonly under?: readonly (PackVector & { readonly attributes: number })[];
};

export type ScenePackVectorResult =
  | { readonly ok: true; readonly vectors: readonly BoardVector[] }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

/**
 * Expand validated placements in placement, solid, then under order. Points are already
 * relative to the anchor: the asset's visual-space anchor must not be subtracted again.
 * The caller appends these vectors after existing board vectors and supplies their count.
 */
export function lowerScenePackVectors(
  scene: Scene,
  resolveAsset: (pack: string, asset: string) => PackAsset | null,
  existingVectorCount = 0,
): ScenePackVectorResult {
  const vectors: BoardVector[] = [];
  const problems: { path: string; message: string }[] = [];
  const layers = new Map(scene.floors.map((floor, index) => [floor.id, index + 1]));
  if (!Number.isInteger(existingVectorCount) || existingVectorCount < 0 || existingVectorCount > 32768) {
    return { ok: false, problems: [{ path: "vectors", message: "Existing vector count exceeds the board's signed 16-bit upper bound." }] };
  }
  for (const [placementIndex, placement] of (scene.placedPacks ?? []).entries()) {
    const path = `placedPacks[${placementIndex}]`;
    const asset = resolveAsset(placement.pack, placement.asset);
    if (asset === null || asset.id !== placement.asset) {
      problems.push({ path: `${path}.asset`, message: `Unable to resolve pack asset ${placement.pack}#${placement.asset}.` });
      continue;
    }
    const layer = layers.get(placement.floor);
    if (layer === undefined || layer > 32767) {
      problems.push({ path: `${path}.floor`, message: "Placement floor cannot be represented as a board layer." });
      continue;
    }
    const add = (shape: PackVector, kind: "solid" | "under", index: number, attributes: number): void => {
      const shapePath = `${path}.${kind}[${index}]`;
      if (shape.points.length > 32768) {
        problems.push({ path: `${shapePath}.points`, message: "Point count exceeds the board's signed 16-bit upper bound." });
        return;
      }
      const points: { x: number; y: number }[] = [];
      for (const [pointIndex, [dx, dy]] of shape.points.entries()) {
        const x = placement.x + dx;
        const y = placement.y + dy;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < -2147483648 || x > 2147483647 || y < -2147483648 || y > 2147483647) {
          problems.push({ path: `${shapePath}.points[${pointIndex}]`, message: "Translated point exceeds the board's signed 32-bit coordinate range." });
          return;
        }
        points.push({ x, y });
      }
      if (existingVectorCount + vectors.length >= 32768) {
        problems.push({ path: shapePath, message: "Vector count exceeds the board's signed 16-bit upper bound." });
        return;
      }
      vectors.push({ points, attributes, closed: shape.closed ? -1 : 0, layer, type: kind === "solid" ? 1 : 2, handle: "" });
    };
    asset.solid?.forEach((shape, index) => add(shape, "solid", index, 0));
    asset.under?.forEach((shape, index) => add(shape, "under", index, shape.attributes));
  }
  return problems.length === 0 ? { ok: true, vectors } : { ok: false, problems };
}
