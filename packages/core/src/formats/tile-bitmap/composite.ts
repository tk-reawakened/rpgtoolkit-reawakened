/**
 * Compositing a tile bitmap into one picture
 * (`docs/spec/formats/tiles.md#tile-bitmap-tbm`, `docs/spec/formats/battle-data.md#fight-background-bkg`).
 *
 * A `.tbm` is a grid of tiles, each cell with its own additive tint, and it
 * "can be used wherever an image file is accepted" (docs/spec/formats/tiles.md#tile-bitmap-tbm). The board path
 * draws its cells as separate blits because it has a draw list; a picture named
 * by a script or a battle background (`bitmap(file, cnv)`) needs one image, so
 * this is where the cells become the file's own pixels.
 *
 * The layout is the picture's pixel size: a cell is `TILE_BITMAP_CELL_SIZE`
 * (32) pixels square, so a `width × height` tile bitmap is
 * `width · 32 × height · 32` pixels — the size the legacy conversion writes for
 * the same tile grid (docs/spec/formats/legacy/conversion.md). Only the drawn
 * cells `x < width`, `y < height` are placed, x outer and y inner
 * (`docs/spec/formats/tiles.md#tile-bitmap-tbm`); a cell's tile sits at its
 * cell's top-left corner at the tile's own size, exactly as a board draws the
 * same cell (`core/render/compose.ts`), and a later cell paints over an earlier
 * one where they meet.
 *
 * Tint follows the render-time rule of `docs/spec/formats/tiles.md#shading`
 * (R-15) through the shared `tintChannel`, and only non-transparent pixels are
 * tinted, so a tile bitmap shows the same pixels as its cells do on a board.
 *
 * Pure (G2) and deterministic (G3): no I/O, integer maths, and a cell's
 * reference must already be resolved — a reference the caller does not supply is
 * a located error, never a silently missing tile.
 */

import type { DecodedTexture } from "../image/model.ts";
import { tintChannel } from "../../raster/tint.ts";
import { err, ok, type Result } from "../result.ts";
import { TILE_BITMAP_SECTION, tileBitmapCell, type TileBitmap } from "./model.ts";

/** The drawn size of one cell, in pixels: the picture is `width · 32 × height · 32` (`docs/spec/formats/legacy/conversion.md`). */
export const TILE_BITMAP_CELL_SIZE = 32;

/**
 * The shared decode contract's pixel ceiling (docs/spec/formats/images.md#the-shared-decode-contract): the composed
 * picture is untrusted input, so past this size the allocation is not attempted.
 */
const MAX_PIXELS = 100_000_000;

/**
 * One resolved cell tile: its pixels, **row-major** RGBA (`core/formats/image/model.ts`'s
 * `DecodedTexture` order), which is what this module paints from.
 */
export interface TileBitmapTile {
  /** The tile's width in pixels. */
  readonly w: number;
  /** The tile's height in pixels. */
  readonly h: number;
  /** `w * h * 4` straight RGBA bytes, row-major. */
  readonly rgba: Uint8Array;
}

/**
 * Paint `bitmap`'s drawn cells into one row-major RGBA picture
 * (`docs/spec/formats/tiles.md#tile-bitmap-tbm`).
 *
 * `tiles` holds every cell reference the bitmap names, already resolved and
 * decoded by the caller. Never throws: a bitmap with no drawn cells, and a
 * drawn cell whose reference `tiles` does not hold, come back as `ok: false`
 * with a located error.
 */
export function compositeTileBitmap(
  bitmap: TileBitmap,
  tiles: ReadonlyMap<string, TileBitmapTile>,
): Result<DecodedTexture> {
  const columns = Math.max(0, bitmap.width);
  const rows = Math.max(0, bitmap.height);
  if (columns === 0 || rows === 0) {
    return err({
      offset: 0,
      section: TILE_BITMAP_SECTION,
      message: `tile bitmap has no drawn cells (width ${bitmap.width}, height ${bitmap.height})`,
    });
  }
  const w = columns * TILE_BITMAP_CELL_SIZE;
  const h = rows * TILE_BITMAP_CELL_SIZE;
  if (w * h > MAX_PIXELS) {
    return err({
      offset: 0,
      section: TILE_BITMAP_SECTION,
      message: `tile bitmap picture ${w} × ${h} is over the ${MAX_PIXELS}-pixel limit (docs/spec/formats/images.md#the-shared-decode-contract)`,
    });
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const cell = tileBitmapCell(bitmap, x, y);
      if (cell === undefined || cell.tile === "") continue;
      const tile = tiles.get(cell.tile);
      if (tile === undefined) {
        return err({
          offset: 0,
          section: TILE_BITMAP_SECTION,
          message: `cell (${x}, ${y}) names tile "${cell.tile}", which was not resolved`,
        });
      }
      paintCell(rgba, w, h, x, y, tile, cell.r, cell.g, cell.b);
    }
  }
  return ok({ w, h, rgba });
}

/** Paint one cell's tile at its cell's corner, tinted, clipped to the picture (docs/spec/formats/tiles.md#shading). */
function paintCell(
  out: Uint8Array,
  width: number,
  height: number,
  cellX: number,
  cellY: number,
  tile: TileBitmapTile,
  r: number,
  g: number,
  b: number,
): void {
  const tinted = r !== 0 || g !== 0 || b !== 0;
  const left = cellX * TILE_BITMAP_CELL_SIZE;
  const top = cellY * TILE_BITMAP_CELL_SIZE;
  for (let y = 0; y < tile.h; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= height) continue;
    for (let x = 0; x < tile.w; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= width) continue;
      const from = (y * tile.w + x) * 4;
      const alpha = tile.rgba[from + 3] ?? 0;
      if (alpha === 0) continue;
      const at = (targetY * width + targetX) * 4;
      out[at] = tintChannel(tile.rgba[from] ?? 0, r, tinted);
      out[at + 1] = tintChannel(tile.rgba[from + 1] ?? 0, g, tinted);
      out[at + 2] = tintChannel(tile.rgba[from + 2] ?? 0, b, tinted);
      out[at + 3] = alpha;
    }
  }
}
