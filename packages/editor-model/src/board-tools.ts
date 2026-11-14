import { BinaryReader, readTileBitmap, type Result } from "@tk-reawakened/core";
import type { BoardDocumentFields, TileAssignment } from "./board-document.ts";
import { boardTileAt } from "./board-document.ts";
import { cellNeighbours, cellOnBoard, layoutOf, pixelToCell, TILE_PIXELS, type Cell, type Pixel } from "./board-geometry.ts";

/**
 * The tile tools of the board canvas as pure functions of a board snapshot (`docs/editor-features.md`, "Reawakened rules
 * for the P0 board canvas and tile tools"). Each returns the cells a gesture would change, as the assignments of one
 * `set-tiles` command, or says why the gesture cannot be done. None of them touches a document.
 */

/** The tools of T-23 the tile mode uses, plus the two navigation tools. */
export type BoardTool = "draw" | "select" | "flood" | "erase" | "rectangle" | "dropper" | "scroll" | "zoom";

export const BOARD_TOOLS: readonly BoardTool[] = ["draw", "select", "flood", "erase", "rectangle", "dropper", "scroll", "zoom"];

/** The part of a board snapshot the tools read. */
export type ToolBoard = Pick<BoardDocumentFields, "sizeX" | "sizeY" | "coordType" | "grid" | "layers" | "lut" | "tileMatrix">;

export type ToolOutcome =
  | { readonly ok: true; readonly cells: readonly TileAssignment[] }
  | { readonly ok: false; readonly message: string };

/** An inclusive rectangle of stored cells. */
export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The rectangle with these two opposite corners, in either order. */
export function cellRect(a: Cell, b: Cell): CellRect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

export function rectContains(rect: CellRect, cell: Cell): boolean {
  return cell.x >= rect.x0 && cell.x <= rect.x1 && cell.y >= rect.y0 && cell.y <= rect.y1;
}

/** The on-board cells of a rectangle, row by row. */
export function rectCells(board: ToolBoard, rect: CellRect): Cell[] {
  const cells: Cell[] = [];
  for (let y = rect.y0; y <= rect.y1; y += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) if (cellOnBoard(board, x, y)) cells.push({ x, y });
  }
  return cells;
}

const ok = (cells: TileAssignment[]): ToolOutcome => ({ ok: true, cells });
const fail = (message: string): ToolOutcome => ({ ok: false, message });

/** Put `tile` on each of `cells` that is on the board and does not already show it. A cell named twice is named once. */
export function paintCells(board: ToolBoard, layer: number, cells: Iterable<Cell>, tile: string): TileAssignment[] {
  const seen = new Set<number>();
  const changes: TileAssignment[] = [];
  const columns = board.grid.width;
  for (const { x, y } of cells) {
    if (!cellOnBoard(board, x, y)) continue;
    const key = y * columns + x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (boardTileAt(board, layer, x, y) !== tile) changes.push({ layer, x, y, tile });
  }
  return changes;
}

/**
 * The cells a drag crosses between two board pixels, found by walking the straight line in pixels (every 8 px) and
 * snapping each step with the layout's own conversion, so a fast drag leaves no gaps on any layout.
 */
export function cellsBetween(board: ToolBoard, from: Pixel, to: Pixel): Cell[] {
  const cells: Cell[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE_PIXELS / 4)));
  let last: Cell | null = null;
  for (let step = 0; step <= steps; step += 1) {
    const cell = pixelToCell(board, Math.floor(from.x + (dx * step) / steps), Math.floor(from.y + (dy * step) / steps));
    if (cell === null || (last !== null && last.x === cell.x && last.y === cell.y)) continue;
    cells.push(cell);
    last = cell;
  }
  return cells;
}

/**
 * Bounded flood fill (T-23). It replaces the cells connected to `start` that hold the same tile as `start`, on `layer`.
 * Cells are connected when they share an edge on the picture, which is the four neighbours of the stored grid on a
 * top-down or iso-rotated board and the four staggered neighbours on an iso-stacked one. With `acrossLayers` the fill
 * also continues to the same cell on every other layer that holds that tile (the preference "Flood fill across layers").
 */
export function floodFill(board: ToolBoard, layer: number, start: Cell, tile: string, acrossLayers: boolean): ToolOutcome {
  if (!cellOnBoard(board, start.x, start.y)) return fail("That place is not on the board.");
  const target = boardTileAt(board, layer, start.x, start.y);
  if (target === null) return fail("That place is not on the board.");
  if (target === tile) return ok([]);
  const columns = board.grid.width;
  const rows = board.grid.height;
  const layerCells = columns * rows;
  const reached = new Set<number>();
  const queue: number[] = [];
  const visit = (at: number): void => {
    if (reached.has(at)) return;
    const l = Math.floor(at / layerCells);
    const rest = at - l * layerCells;
    const x = rest % columns;
    const y = Math.floor(rest / columns);
    if (boardTileAt(board, l, x, y) !== target) return;
    reached.add(at);
    queue.push(at);
  };
  visit(layer * layerCells + start.y * columns + start.x);
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head]!;
    const l = Math.floor(at / layerCells);
    const rest = at - l * layerCells;
    const x = rest % columns;
    const y = Math.floor(rest / columns);
    for (const next of cellNeighbours(board, x, y)) visit(l * layerCells + next.y * columns + next.x);
    if (acrossLayers) for (let other = 0; other < board.layers; other += 1) if (other !== l) visit(other * layerCells + rest);
  }
  const changes: TileAssignment[] = [];
  for (const at of [...reached].sort((a, b) => a - b)) {
    const l = Math.floor(at / layerCells);
    const rest = at - l * layerCells;
    changes.push({ layer: l, x: rest % columns, y: Math.floor(rest / columns), tile });
  }
  return ok(changes);
}

/**
 * The rectangle tool (T-23): the cells between two corners of the stored grid, hollow or filled. On an iso-rotated board
 * that is a rotated rectangle on the picture. It is not offered on an iso-stacked board, whose stored rows are staggered.
 */
export function rectangleCells(board: ToolBoard, layer: number, a: Cell, b: Cell, filled: boolean, tile: string): ToolOutcome {
  if (layoutOf(board) === "iso-stacked") return fail("The rectangle tool is not available on an iso-stacked board; draw or flood fill instead.");
  const rect = cellRect(a, b);
  const cells = rectCells(board, rect).filter((cell) => filled || cell.x === rect.x0 || cell.x === rect.x1 || cell.y === rect.y0 || cell.y === rect.y1);
  return ok(paintCells(board, layer, cells, tile));
}

/**
 * Move or copy the tiles of a selected rectangle by `dx` columns and `dy` rows. A move leaves empty cells behind; a copy
 * leaves the source as it is. The whole gesture is refused when a selected tile would land off the board.
 */
export function moveCells(board: ToolBoard, layer: number, rect: CellRect, dx: number, dy: number, copy: boolean): ToolOutcome {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return fail("A move is a whole number of columns and rows.");
  if (dx === 0 && dy === 0) return ok([]);
  const source = rectCells(board, rect);
  const writes = new Map<string, TileAssignment>();
  const key = (x: number, y: number): string => `${x},${y}`;
  if (!copy) for (const { x, y } of source) writes.set(key(x, y), { layer, x, y, tile: "" });
  for (const { x, y } of source) {
    const tile = boardTileAt(board, layer, x, y);
    if (tile === null) continue;
    const to = { x: x + dx, y: y + dy };
    if (!cellOnBoard(board, to.x, to.y)) return fail(`${copy ? "Copying" : "Moving"} the selection ${dx} columns and ${dy} rows would put part of it off the board.`);
    writes.set(key(to.x, to.y), { layer, x: to.x, y: to.y, tile });
  }
  return ok([...writes.values()].filter((write) => boardTileAt(board, layer, write.x, write.y) !== write.tile));
}

/** A whole tile bitmap placed as one brush: its drawn cells, row by row. An empty cell is `""` and leaves the board as it is. */
export interface Stamp {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly string[];
}

/** Read the drawn cells of a `.tbm` (`docs/spec/formats/tiles.md#tile-bitmap-tbm`; the padding row and column are not drawn). */
export function stampFromBitmap(bytes: Uint8Array, path: string, name: string): Result<Stamp> {
  const read = readTileBitmap(new BinaryReader(bytes, path));
  if (!read.ok) return read;
  const { width, height, cells } = read.value;
  const rows = Math.max(0, height);
  const columns = Math.max(0, width);
  const drawn: string[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) drawn.push(cells[x * (rows + 1) + y]?.tile ?? "");
  }
  return { ok: true, value: { name, width: columns, height: rows, cells: drawn }, warnings: read.warnings };
}

/** Place a stamp with its top-left drawn cell on `at`, in the stored grid. Refused whole when any of it would be off the board. */
export function stampCells(board: ToolBoard, layer: number, stamp: Stamp, at: Cell): ToolOutcome {
  if (stamp.width === 0 || stamp.height === 0) return fail(`${stamp.name} has no drawn cells.`);
  const changes: TileAssignment[] = [];
  for (let y = 0; y < stamp.height; y += 1) {
    for (let x = 0; x < stamp.width; x += 1) {
      const cell = { x: at.x + x, y: at.y + y };
      if (!cellOnBoard(board, cell.x, cell.y)) return fail(`${stamp.name} is ${stamp.width} × ${stamp.height} cells and does not fit with its corner here.`);
      const tile = stamp.cells[y * stamp.width + x] ?? "";
      if (tile !== "" && boardTileAt(board, layer, cell.x, cell.y) !== tile) changes.push({ layer, x: cell.x, y: cell.y, tile });
    }
  }
  return ok(changes);
}

/** Where the file of a tile reference lives and what to call it, so the dropper can make it the brush; `null` for a reference it cannot place. */
export function tileSourceOf(reference: string): { readonly file: string; readonly label: string; readonly index: number | null } | null {
  const indexed = /^(.*\.(?:tst|iso))(\d+)$/i.exec(reference);
  if (indexed !== null) {
    const file = indexed[1]!.replaceAll("\\", "/");
    return { file, label: `${file.slice(file.lastIndexOf("/") + 1)} tile ${Number(indexed[2])}`, index: Number(indexed[2]) };
  }
  if (/\.(?:tan|gph)$/i.test(reference)) {
    const file = reference.replaceAll("\\", "/");
    return { file, label: file.slice(file.lastIndexOf("/") + 1), index: null };
  }
  return null;
}
