import {
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  boardGrid,
  boardPixelSize,
  coordLayout,
  pixelToTile,
  tileToPixel,
  type CoordLayout,
} from "@tk-reawakened/core";

/**
 * Board coordinates for the canvas and the tile tools (`docs/editor-features.md`, "Reawakened rules for the P0 board
 * canvas"). A cell is a column `x` and a row `y` of the board's stored grid, counted from 0 (`docs/spec/formats/board.md#coordinates`);
 * a pixel is a board pixel from the board's top-left. Every function here is a pure integer function of its arguments,
 * and every layout (top-down, iso-stacked, iso-rotated) goes through `core`'s own conversions, so what the canvas calls
 * a cell is what the engine calls the same tile.
 */

/** The facts of a board these functions need. A board snapshot has them all. */
export interface BoardShape {
  /** The logical width in tiles. */
  readonly sizeX: number;
  /** The logical height in tiles. */
  readonly sizeY: number;
  /** The `coordType` bit flags; flag 4 (pixel coordinates) changes no tile geometry. */
  readonly coordType: number;
}

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Pixel {
  readonly x: number;
  readonly y: number;
}

/** A tile is 32×32 pixels on a top-down board (`docs/spec/formats/tiles.md`). */
export const TILE_PIXELS = 32;

export function layoutOf(shape: BoardShape): CoordLayout {
  return coordLayout(shape.coordType);
}

/** The board's size in pixels (`docs/spec/formats/board.md#board-pixel-dimensions`). */
export function boardExtent(shape: BoardShape): { readonly width: number; readonly height: number } {
  return boardPixelSize(layoutOf(shape), shape.sizeX, shape.sizeY);
}

/** The pixel at the middle of the cell's square or diamond. */
export function cellCentre(shape: BoardShape, x: number, y: number): Pixel {
  const layout = layoutOf(shape);
  if (layout === "2d") return { x: x * TILE_PIXELS + TILE_PIXELS / 2, y: y * TILE_PIXELS + TILE_PIXELS / 2 };
  return tileToPixel(layout, shape.sizeX, x + 1, y + 1);
}

/** The corners of the cell's square (top-down) or diamond (isometric), in drawing order. */
export function cellOutline(shape: BoardShape, x: number, y: number): readonly Pixel[] {
  const layout = layoutOf(shape);
  if (layout === "2d") {
    const left = x * TILE_PIXELS;
    const top = y * TILE_PIXELS;
    return [
      { x: left, y: top },
      { x: left + TILE_PIXELS, y: top },
      { x: left + TILE_PIXELS, y: top + TILE_PIXELS },
      { x: left, y: top + TILE_PIXELS },
    ];
  }
  const centre = cellCentre(shape, x, y);
  const halfWidth = ISO_TILE_WIDTH / 2;
  const halfHeight = ISO_TILE_HEIGHT / 2;
  return [
    { x: centre.x, y: centre.y - halfHeight },
    { x: centre.x + halfWidth, y: centre.y },
    { x: centre.x, y: centre.y + halfHeight },
    { x: centre.x - halfWidth, y: centre.y },
  ];
}

/** Whether the stored cell exists in the board's grid at all. */
export function cellInGrid(shape: BoardShape, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  const grid = boardGrid(shape.sizeX, shape.sizeY, shape.coordType);
  return x >= 0 && x < grid.width && y >= 0 && y < grid.height;
}

/**
 * Whether the cell has a place on the board's picture. Every cell of a top-down or iso-stacked board does; of the
 * square stored grid of an iso-rotated board only those whose diamond centre is inside the board's pixel size do.
 */
export function cellOnBoard(shape: BoardShape, x: number, y: number): boolean {
  if (!cellInGrid(shape, x, y)) return false;
  const layout = layoutOf(shape);
  if (layout !== "iso-rotated") return layout === "2d" ? x < shape.sizeX && y < shape.sizeY : true;
  const extent = boardExtent(shape);
  const centre = cellCentre(shape, x, y);
  return centre.x >= 0 && centre.x <= extent.width && centre.y >= 0 && centre.y <= extent.height;
}

/** Snap a board pixel to the cell it falls in; `null` when it is not on a cell of the board. */
export function pixelToCell(shape: BoardShape, px: number, py: number): Cell | null {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const layout = layoutOf(shape);
  if (layout === "2d") {
    if (px < 0 || py < 0) return null;
    const x = Math.floor(px / TILE_PIXELS);
    const y = Math.floor(py / TILE_PIXELS);
    return cellOnBoard(shape, x, y) ? { x, y } : null;
  }
  const tile = pixelToTile(layout, shape.sizeX, px, py);
  const x = tile.x - 1;
  const y = tile.y - 1;
  return cellOnBoard(shape, x, y) ? { x, y } : null;
}

/** The cells that share an edge with this one and are on the board: the four neighbours, staggered on an iso-stacked board. */
export function cellNeighbours(shape: BoardShape, x: number, y: number): readonly Cell[] {
  const layout = layoutOf(shape);
  let candidates: Cell[];
  if (layout === "iso-stacked") {
    // Rows alternate: an even stored row sits half a tile to the right of the odd row above and below it.
    const shift = y % 2 === 0 ? [0, 1] : [-1, 0];
    candidates = [
      { x: x + shift[0]!, y: y - 1 },
      { x: x + shift[1]!, y: y - 1 },
      { x: x + shift[0]!, y: y + 1 },
      { x: x + shift[1]!, y: y + 1 },
    ];
  } else {
    candidates = [{ x: x - 1, y }, { x: x + 1, y }, { x, y: y - 1 }, { x, y: y + 1 }];
  }
  return candidates.filter((cell) => cellOnBoard(shape, cell.x, cell.y));
}

/** The zoom steps of the canvas (T-21: fixed steps). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];
export const DEFAULT_ZOOM_INDEX = 2;

/** What part of the board the canvas shows: the board pixel at the view's top-left corner, and the zoom step. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoomIndex: number;
  /** The view's size in screen pixels. */
  readonly width: number;
  readonly height: number;
}

export function zoomOf(viewport: Viewport): number {
  return ZOOM_STEPS[viewport.zoomIndex] ?? 1;
}

/** Keep the board reachable: a board smaller than the view is centred, a larger one cannot be scrolled past its edges. */
export function clampViewport(shape: BoardShape, viewport: Viewport): Viewport {
  const extent = boardExtent(shape);
  const zoom = zoomOf(viewport);
  const across = viewport.width / zoom;
  const down = viewport.height / zoom;
  const place = (origin: number, board: number, view: number): number =>
    board <= view ? -Math.floor((view - board) / 2) : Math.max(0, Math.min(board - view, origin));
  return { ...viewport, x: place(Math.round(viewport.x), extent.width, across), y: place(Math.round(viewport.y), extent.height, down) };
}

/** The board pixel under a screen position inside the view. */
export function screenToBoard(viewport: Viewport, sx: number, sy: number): Pixel {
  const zoom = zoomOf(viewport);
  return { x: Math.floor(viewport.x + sx / zoom), y: Math.floor(viewport.y + sy / zoom) };
}

/** The screen position of a board pixel. */
export function boardToScreen(viewport: Viewport, px: number, py: number): Pixel {
  const zoom = zoomOf(viewport);
  return { x: (px - viewport.x) * zoom, y: (py - viewport.y) * zoom };
}

/** Change the zoom step and keep the board pixel under `focus` (a screen position) where it is. */
export function zoomTo(shape: BoardShape, viewport: Viewport, zoomIndex: number, focus: Pixel = { x: viewport.width / 2, y: viewport.height / 2 }): Viewport {
  const index = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIndex));
  if (index === viewport.zoomIndex) return viewport;
  const before = { x: viewport.x + focus.x / zoomOf(viewport), y: viewport.y + focus.y / zoomOf(viewport) };
  const zoom = ZOOM_STEPS[index] ?? 1;
  return clampViewport(shape, { ...viewport, zoomIndex: index, x: before.x - focus.x / zoom, y: before.y - focus.y / zoom });
}

/** Scroll so the cell's centre is inside the view; a cell already inside leaves the view where it is. */
export function revealCell(shape: BoardShape, viewport: Viewport, x: number, y: number): Viewport {
  const centre = cellCentre(shape, x, y);
  const zoom = zoomOf(viewport);
  const margin = TILE_PIXELS;
  const across = viewport.width / zoom;
  const down = viewport.height / zoom;
  const place = (origin: number, point: number, view: number): number =>
    point < origin + margin ? point - margin : point > origin + view - margin ? point - view + margin : origin;
  return clampViewport(shape, { ...viewport, x: place(viewport.x, centre.x, across), y: place(viewport.y, centre.y, down) });
}

/**
 * The on-board cells whose square or diamond may touch the board rectangle `[left, right) × [top, bottom)`: every cell
 * that does, and possibly a few at the rim that do not. A canvas draws its grid from this instead of walking a board of
 * a million cells for every frame.
 */
export function cellsInRect(shape: BoardShape, left: number, top: number, right: number, bottom: number): Cell[] {
  const layout = layoutOf(shape);
  const cells: Cell[] = [];
  if (layout === "2d") {
    const x0 = Math.max(0, Math.floor(left / TILE_PIXELS));
    const x1 = Math.min(shape.sizeX - 1, Math.floor((right - 1) / TILE_PIXELS));
    const y0 = Math.max(0, Math.floor(top / TILE_PIXELS));
    const y1 = Math.min(shape.sizeY - 1, Math.floor((bottom - 1) / TILE_PIXELS));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) cells.push({ x, y });
    return cells;
  }
  const halfWidth = ISO_TILE_WIDTH / 2;
  const halfHeight = ISO_TILE_HEIGHT / 2;
  if (layout === "iso-stacked") {
    const y0 = Math.max(0, Math.floor((top - halfHeight) / 16));
    const y1 = Math.min(shape.sizeY - 1, Math.ceil((bottom + halfHeight) / 16));
    for (let y = y0; y <= y1; y += 1) {
      const offset = y % 2 === 0 ? 32 : 0;
      const x0 = Math.max(0, Math.ceil((left - halfWidth - offset) / 64));
      const x1 = Math.min(shape.sizeX - 1, Math.floor((right + halfWidth - offset) / 64));
      for (let x = x0; x <= x1; x += 1) cells.push({ x, y });
    }
    return cells;
  }
  // Rotated: with u = tx − ty and v = tx + ty (one-based), a cell's centre is ((u + sizeX) · 32, (v − sizeX) · 16 − 16).
  const u0 = Math.ceil((left - halfWidth) / 32) - shape.sizeX;
  const u1 = Math.floor((right + halfWidth) / 32) - shape.sizeX;
  const v0 = Math.ceil((top - halfHeight + 16) / 16) + shape.sizeX;
  const v1 = Math.floor((bottom + halfHeight + 16) / 16) + shape.sizeX;
  for (let v = v0; v <= v1; v += 1) {
    for (let u = u0; u <= u1; u += 1) {
      if ((u + v) % 2 !== 0) continue;
      const x = (u + v) / 2 - 1;
      const y = (v - u) / 2 - 1;
      if (cellOnBoard(shape, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}
