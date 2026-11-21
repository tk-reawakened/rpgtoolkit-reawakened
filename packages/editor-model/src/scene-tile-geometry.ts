import type { BoardVector } from "@tk-reawakened/core";
import type { NativeTile } from "@tk-reawakened/native-data";
import type { TerrainPaletteScene } from "./scene-terrain-palette.ts";

type GeometryResult = { readonly ok: true; readonly vectors: readonly BoardVector[] }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

/** Translate explicit geometry at each resolved cell, never a whole-cell substitute. */
export function lowerSceneTileGeometry(scene: TerrainPaletteScene, tiles: readonly (NativeTile | null)[], available: number): GeometryResult {
  // docs/spec/formats/native-tile.md#geometry-and-program-activation
  const vectors: BoardVector[] = [];
  const geometry = tiles.map((tile) => ({ solid: tile?.solid ?? [], under: tile?.under ?? [] }));
  for (const [floorIndex, floor] of scene.floors.entries()) {
    let cell = 0;
    for (const [count, index] of floor.tiles ?? []) {
      const pieces = geometry[index];
      if (pieces === undefined || pieces.solid.length + pieces.under.length === 0) { cell += count; continue; }
      const path = `tilePalette[${index}]`;
      if (scene.projection !== "2d") return { ok: false, problems: [{ path, message: "Isometric tile geometry lowering is unproven." }] };
      if (vectors.length + count * (pieces.solid.length + pieces.under.length) > available) {
        return { ok: false, problems: [{ path, message: "Generated tile geometry exceeds the board's vector limit." }] };
      }
      for (let end = cell + count; cell < end; cell += 1) {
        const x = (cell % scene.size.width) * 32;
        const y = Math.floor(cell / scene.size.width) * 32;
        for (const outline of pieces.solid) vectors.push({
          points: outline.points.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
          attributes: 0, closed: outline.closed ? -1 : 0, layer: floorIndex + 1, type: 1, handle: "",
        });
        for (const outline of pieces.under) vectors.push({
          points: outline.points.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
          attributes: outline.attributes, closed: -1, layer: floorIndex + 1, type: 2, handle: "",
        });
      }
    }
  }
  return { ok: true, vectors };
}
