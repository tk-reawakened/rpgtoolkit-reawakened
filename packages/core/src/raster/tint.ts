/**
 * The R-15 tint rule for one channel of a tile-built pixel
 * (docs/spec/formats/tiles.md#shading, ADR 0002).
 *
 * With a non-zero tint, pure white becomes 245 and pure black 10 before the tint
 * is added, and the sum is clamped once to 0…255; with a zero tint the source
 * value is preserved exactly. The reference rasteriser applies this to every
 * blit that carries a tint, and the tile-bitmap compositor bakes it into each
 * cell, so a tile bitmap shows the same pixels as its cells do on a board.
 *
 * This module imports nothing: it is a leaf both `core/raster` and
 * `core/formats` can share, so the rule is written down once.
 */
export function tintChannel(value: number, tint: number, tinted: boolean): number {
  const source = tinted ? (value === 255 ? 245 : value === 0 ? 10 : value) : value;
  return Math.max(0, Math.min(255, source + tint));
}
