import { boardTileAt, type TileAssignment } from "./board-document.ts";
import { cellOnBoard, layoutOf, type Cell } from "./board-geometry.ts";
import { paintCells, type ToolBoard } from "./board-tools.ts";

/** Tile number for each reduced neighbour mask in docs/spec/editor/autotiling.md#1-2. */
const SLOT_BY_MASK: ReadonlyMap<number, number> = new Map([
  [239,1],[223,2],[207,3],[191,4],[175,5],[159,6],[143,7],[127,8],
  [111,10],[95,11],[79,12],[63,13],[47,14],[31,15],[15,16],
  [103,17],[71,19],[39,20],[7,21],[206,22],[142,23],[78,24],[14,25],
  [157,26],[29,28],[141,29],[13,30],[59,31],[43,32],[27,33],[11,34],
  [5,35],[10,37],[70,38],[6,39],[140,40],[12,41],[25,42],[9,43],[35,44],[3,46],
  [4,47],[2,48],[1,49],[8,50],[0,51],[255,52],
]);
const DIRS = ["N","E","S","W","NW","NE","SE","SW"] as const;
type Direction = typeof DIRS[number];

/** The prefix is tested against the filename, so sub-folder sets remain compatible. */
export function autotileSource(reference: string): string | null {
  const path = reference.replaceAll("/", "\\");
  const file = path.slice(path.lastIndexOf("\\") + 1);
  return /^AUTOTILES_/i.test(file) && /\.(?:tst|iso)\d+$/i.test(file) ? path.replace(/\d+$/, "") : null;
}


/** Resolve a named or explicitly marked source for one tile reference. */
export function autotileSourceForTile(reference: string, markedSources?: ReadonlySet<string>): string | null {
  const named = autotileSource(reference);
  if (named !== null) return named;
  for (const source of markedSources ?? []) if (slotOf(reference, source) !== null) return source.replaceAll("/", "\\");
  return null;
}

function sameSource(reference: string | null, source: string): boolean {
  if (reference === null || reference === "") return false;
  const normalized = reference.replaceAll("/", "\\");
  const normalizedSource = source.replaceAll("/", "\\");
  return normalized.startsWith(normalizedSource) && /^\d+$/.test(normalized.slice(normalizedSource.length));
}

function neighbors(board: ToolBoard, { x, y }: Cell): Record<Direction, Cell> {
  if (layoutOf(board) === "iso-stacked") {
    const even = y % 2 !== 0;
    return {
      N: { x: x + (even ? 0 : 1), y: y - 1 }, E: { x: x + (even ? 0 : 1), y: y + 1 },
      S: { x: x - (even ? 1 : 0), y: y + 1 }, W: { x: x - (even ? 1 : 0), y: y - 1 },
      NW: { x, y: y - 2 }, NE: { x: x + 1, y }, SE: { x, y: y + 2 }, SW: { x: x - 1, y },
    };
  }
  return {
    N: { x, y: y - 1 }, E: { x: x + 1, y }, S: { x, y: y + 1 }, W: { x: x - 1, y },
    NW: { x: x - 1, y: y - 1 }, NE: { x: x + 1, y: y - 1 }, SE: { x: x + 1, y: y + 1 }, SW: { x: x - 1, y: y + 1 },
  };
}

function slotOf(reference: string | null, source: string): number | null {
  if (!sameSource(reference, source)) return null;
  const match = /\.(?:tst|iso)(\d+)$/i.exec(reference!);
  return match === null ? null : Number(match[1]);
}

/**
 * The slot a cell needs, counted only from cells that hold a tile of `source`: a marked set decides which cells take
 * part in reshaping, never which neighbours link, so two different sets never connect even when one is marked.
 */
function shapeAt(board: ToolBoard, layer: number, cell: Cell, source: string, current: ReadonlyMap<number, string>): number {
  const adjacent = neighbors(board, cell);
  const refAt = (at: Cell): string | null => current.get(at.y * board.grid.width + at.x) ?? boardTileAt(board, layer, at.x, at.y);
  const connected = (direction: Direction): boolean => {
    const at = adjacent[direction];
    if (!cellOnBoard(board, at.x, at.y)) return false;
    const reference = refAt(at);
    return slotOf(reference, source) !== null;
  };
  let mask = 0;
  for (let bit = 0; bit < 4; bit += 1) if (connected(DIRS[bit]!)) mask |= 1 << bit;
  const corners: readonly (readonly [Direction, Direction, Direction])[] = [["NW","N","W"],["NE","N","E"],["SE","S","E"],["SW","S","W"]];
  for (let i = 0; i < corners.length; i += 1) {
    const [diagonal, a, b] = corners[i]!;
    if ((mask & (1 << DIRS.indexOf(a))) !== 0 && (mask & (1 << DIRS.indexOf(b))) !== 0 && connected(diagonal)) mask |= 1 << (i + 4);
  }
  return SLOT_BY_MASK.get(mask) ?? 51;
}

/**
 * Which cells of a stroke were painted with Shift held: one answer for the whole stroke, one per cell (`y * grid.width +
 * x`, as the stroke's overlay uses), or one per visit, in the same order as `cells`, so a revisited cell keeps the
 * modifier of the visit that reshaped it.
 */
export type ShiftedCells = boolean | ReadonlySet<number> | readonly boolean[];

/**
 * Resolve each member of a Draw/Erase stroke in event order. The transient overlay means later cells in the same stroke
 * see prior paint and reshaping, while the caller still submits one ordinary set-tiles command for one undo step.
 */
export function paintAutotileStroke(
  board: ToolBoard,
  layer: number,
  cells: readonly Cell[],
  tile: string,
  enabled: boolean,
  shift: ShiftedCells = false,
  markedSources?: ReadonlySet<string>,
): TileAssignment[] {
  const overlay = new Map<number, string>();
  const writes = new Map<number, TileAssignment>();
  const stacked = layoutOf(board) === "iso-stacked";
  const paintSource = enabled && tile !== "" ? autotileSourceForTile(tile, markedSources) : null;
  // Shift is decided per cell: a drag can hold it over some cells and not others, and each cell reshapes by its own.
  const wasShifted = (cell: Cell, visit: number): boolean => Array.isArray(shift) ? shift[visit] === true
    : typeof shift === "boolean" ? shift
      : (shift as ReadonlySet<number>).has(cell.y * board.grid.width + cell.x);
  for (const [visit, cell] of cells.entries()) {
    if (!cellOnBoard(board, cell.x, cell.y)) continue;
    const seed = paintSource === null ? tile : `${paintSource}51`;
    const seedKey = cell.y * board.grid.width + cell.x;
    overlay.set(seedKey, seed);
    writes.set(seedKey, { layer, ...cell, tile: seed });
    const shifted = wasShifted(cell, visit);
    if (!enabled || (shifted && paintSource === null)) continue;
    const isolated = shifted ? paintSource : null;
    const edited: Cell[] = [];
    for (let dy = stacked ? -2 : -1; dy <= (stacked ? 2 : 1); dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const candidate = { x: cell.x + dx, y: cell.y + dy };
        if (cellOnBoard(board, candidate.x, candidate.y)) edited.push(candidate);
      }
    }
    edited.sort((a,b) => a.y - b.y || a.x - b.x);
    for (const candidate of edited) {
      const key = candidate.y * board.grid.width + candidate.x;
      const existing = overlay.get(key) ?? boardTileAt(board, layer, candidate.x, candidate.y);
      const source = autotileSourceForTile(existing ?? "", markedSources);
      if (source === null || (isolated !== null && source !== isolated)) continue;
      const slot = shapeAt(board, layer, candidate, source, overlay);
      if (slotOf(existing, source) === slot) continue;
      const reshaped = `${source}${slot}`;
      overlay.set(key, reshaped);
      writes.set(key, { layer, ...candidate, tile: reshaped });
    }
  }
  return [...writes.values()]
    .filter(({ x, y, tile: next }) => boardTileAt(board, layer, x, y) !== next)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Numeric order of the 47 used compatibility slots; the five reserved slots are not included. */
export const LEGACY_AUTOTILE_SLOTS: readonly number[] = [...SLOT_BY_MASK.values()].sort((a,b) => a - b);

/** The used shape slots a set of `tileCount` tiles does not reach, which the original drew as blanks without a word. */
export function legacyAutotileGaps(tileCount: number): number[] {
  return LEGACY_AUTOTILE_SLOTS.filter((slot) => slot > tileCount);
}

/**
 * Carry an ordinary tool's region (Fill, Rectangle) through the autotiler. The region is passed in as the cells the
 * gesture covers, not the cells it would change, so a click on a cell that already shows the tile still reshapes the
 * neighbourhood around it. Reshaping only touches `layer`: a fill that continues on another layer paints it as stored.
 */
export function autotileCells(
  board: ToolBoard,
  layer: number,
  cells: readonly Cell[],
  tile: string,
  enabled: boolean,
  shift: ShiftedCells = false,
  markedSources?: ReadonlySet<string>,
): TileAssignment[] {
  if (!enabled) return paintCells(board, layer, cells, tile);
  return paintAutotileStroke(board, layer, cells, tile, true, shift, markedSources);
}

const SHAPE_BY_SLOT: ReadonlyMap<number, string> = new Map([...SLOT_BY_MASK].map(([mask, slot]) => {
  const cardinal = DIRS.slice(0, 4).filter((_, bit) => (mask & (1 << bit)) !== 0);
  const corners = DIRS.slice(4).filter((_, bit) => (mask & (1 << (bit + 4))) !== 0);
  return [slot, cardinal.length === 0 ? "isolated" : `${cardinal.join(" ")}${corners.length === 0 ? "" : ` + corner ${corners.join(" ")}`}`];
}));

/** What a legacy slot must show, in words, so wrongly ordered art can be seen against the table. */
export function legacyAutotileShape(slot: number): string | null {
  return SHAPE_BY_SLOT.get(slot) ?? null;
}
