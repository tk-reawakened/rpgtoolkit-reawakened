import type { BoardVector } from "@tk-reawakened/core";
import type { NativeTile, Scene } from "@tk-reawakened/native-data";

/**
 * Generate tile-owned vectors in floor, row, column order, after scene-owned vectors.
 * A standalone tile carries explicit solid and under geometry; a legacy or empty slot carries none.
 * See docs/spec/formats/native-scene.md#the-tile-palette and docs/spec/formats/native-tile.md#geometry-and-program-activation.
 * Throws instead of truncating when the board's vector table would overflow.
 */
export function generateSceneTileCollision(scene: Scene, standalone: readonly (NativeTile | null)[]): BoardVector[] {
  const palette = scene.tilePalette ?? [];
  if (standalone.length !== palette.length) throw new Error("collision tiles must match the tile palette length");
  const available = 32768 - (scene.vectors?.length ?? 0);
  if (available < 0) throw new Error("vector table exceeds 32768 entries");
  const width = scene.projection === "iso-rotated" ? scene.size.width + scene.size.height : scene.size.width;
  const vectors: BoardVector[] = [];
  for (let floorIndex = 0; floorIndex < scene.floors.length; floorIndex += 1) {
    const floor = scene.floors[floorIndex];
    let cell = 0;
    for (const [count, index] of floor?.tiles ?? []) {
      const tile = standalone[index];
      const solid = tile?.solid;
      const under = tile?.under;
      const shapes = (solid?.length ?? 0) + (under?.length ?? 0);
      if (shapes > 0) {
        if (scene.projection !== "2d") throw new Error(`tilePalette[${index}]: Isometric tile geometry lowering is unproven.`);
        if (vectors.length + count * shapes > available) throw new Error("vector table exceeds 32768 entries");
        for (let offset = 0; offset < count; offset += 1) {
          const position = cell + offset;
          const x = (position % width) * 32;
          const y = Math.floor(position / width) * 32;
          if (solid !== undefined) for (const outline of solid) vectors.push({
            points: outline.points.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
            attributes: 0, closed: outline.closed ? -1 : 0, layer: floorIndex + 1, type: 1, handle: "",
          });
          if (under !== undefined) for (const outline of under) vectors.push({
            points: outline.points.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
            attributes: outline.attributes, closed: -1, layer: floorIndex + 1, type: 2, handle: "",
          });
        }
      }
      cell += count;
    }
  }
  return vectors;
}
