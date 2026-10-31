/**
 * The pixel sets a line and an ellipse cover, as the reference rasteriser draws them
 * (AD-3, `docs/spec/engine/display-input-audio.md#reawakened-light-and-raster-arithmetic`, E-17).
 *
 * These are leaves rather than an implementation detail because a replayer must produce the *same pixels* as
 * `core/raster` — a Bresenham line and the all-integer midpoint ellipse are a decision, not arithmetic a GPU may round
 * differently — and the honest way to share a decision is to share the code. `raster.ts` plots the returned points and
 * `render-webgl2` draws a one-pixel quad for each, so the two cannot drift.
 *
 * Coordinates are inclusive and in logical pixels, exactly as the draw list carries them. A point outside the target is
 * returned anyway; the caller clips, as a plot does.
 */

import type { Rect } from "../ports/draw.ts";

/** A single pixel, `[x, y]`. */
export type PixelPoint = readonly [number, number];

/** The inclusive endpoints of a one-pixel line (`x1, y1` → `x2, y2`), Bresenham, both ends inclusive. */
export function linePixels(x1: number, y1: number, x2: number, y2: number): PixelPoint[] {
  const points: PixelPoint[] = [];
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    points.push([x, y]);
    if (x === x2 && y === y2) return points;
    const twice = error * 2;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** The points of an unfilled rectangle's outline, plotted as four lines with the reference's corner overlap. */
export function rectOutlinePixels(rect: Rect): PixelPoint[] {
  if (rect.w <= 0 || rect.h <= 0) return [];
  const points: PixelPoint[] = [];
  points.push(...linePixels(rect.x, rect.y, rect.x + rect.w - 1, rect.y));
  points.push(...linePixels(rect.x, rect.y + rect.h - 1, rect.x + rect.w - 1, rect.y + rect.h - 1));
  if (rect.h > 2) {
    points.push(...linePixels(rect.x, rect.y + 1, rect.x, rect.y + rect.h - 2));
    points.push(...linePixels(rect.x + rect.w - 1, rect.y + 1, rect.x + rect.w - 1, rect.y + rect.h - 2));
  }
  return points;
}

/**
 * The boundary points of the midpoint ellipse over `rect`'s inclusive box, and — when `filled` — every point inside
 * it. The filled variant reuses the generated boundary's row extrema, which is what makes it agree with the outline.
 */
export function ellipsePixels(rect: Rect, filled: boolean): PixelPoint[] {
  if (rect.w <= 0 || rect.h <= 0) return [];
  if (rect.w === 1) return linePixels(rect.x, rect.y, rect.x, rect.y + rect.h - 1);
  if (rect.h === 1) return linePixels(rect.x, rect.y, rect.x + rect.w - 1, rect.y);

  const points: PixelPoint[] = [];
  const xMin = rect.x;
  const xMax = rect.x + rect.w - 1;
  const yMin = rect.y;
  const yMax = rect.y + rect.h - 1;
  let x0 = xMin;
  let y0 = yMin;
  let x1 = xMax;
  let y1 = yMax;
  let a = Math.abs(x1 - x0);
  let b = Math.abs(y1 - y0);
  const b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  if (x0 > x1) {
    const swap = x0;
    x0 = x1;
    x1 = swap;
  }
  if (y0 > y1) y0 = y1;
  y0 += Math.floor((b + 1) / 2);
  y1 = y0 - b1;
  a *= 8 * a;
  const bb = 8 * b * b;
  do {
    points.push([x1, y0], [x0, y0], [x0, y1], [x1, y1]);
    const e2 = 2 * err;
    if (e2 <= dy) {
      y0 += 1;
      y1 -= 1;
      err += dy += a;
    }
    if (e2 >= dx || 2 * err > dy) {
      x0 += 1;
      x1 -= 1;
      err += dx += bb;
    }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    points.push([x0 - 1, y0], [x1 + 1, y0], [x0 - 1, y1], [x1 + 1, y1]);
    y0 += 1;
    y1 -= 1;
  }
  if (!filled) return points;

  const rows = new Map<number, [number, number]>();
  for (const [x, y] of points) {
    const row = rows.get(y);
    if (!row) rows.set(y, [x, x]);
    else {
      row[0] = Math.min(row[0], x);
      row[1] = Math.max(row[1], x);
    }
  }
  const filledPoints: PixelPoint[] = [];
  for (const [y, [left, right]] of rows) {
    for (let x = left; x <= right; x += 1) filledPoints.push([x, y]);
  }
  return filledPoints;
}

/**
 * The `.iso` projection: the 32×32 → 64×32 affine map's inverse, with the reference's integer half-up rounding
 * (`round_half_up(n, 2) = floor((n + 1) / 2)`, including for negative `n`). `null` means the destination pixel lies
 * outside the diamond and the reference skips it.
 */
export function isoSourceOffset(x: number, y: number): PixelPoint | null {
  const k = y <= 15 ? y : 31 - y;
  if (x < 31 - 2 * k || x > 32 + 2 * k) return null;
  const sx = Math.floor((x - 32 + 2 * y + 1) / 2);
  const sy = Math.floor((32 - x + 2 * y + 1) / 2);
  return [Math.max(0, Math.min(31, sx)), Math.max(0, Math.min(31, sy))];
}

/** The destination pixels of an `iso2d` blit and the source offset each samples, in the reference's order. */
export function isoDestinationPixels(): { readonly x: number; readonly y: number; readonly sourceX: number; readonly sourceY: number }[] {
  const pixels: { x: number; y: number; sourceX: number; sourceY: number }[] = [];
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const source = isoSourceOffset(x, y);
      if (source === null) continue;
      pixels.push({ x, y, sourceX: source[0], sourceY: source[1] });
    }
  }
  return pixels;
}

