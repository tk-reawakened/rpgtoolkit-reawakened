import type { BoardLight, BoardPoint } from "@tk-reawakened/core";
import { decodeShade, type BoardDocumentFields, type ShadeCell } from "./board-document.ts";
import { cellNeighbours, cellOnBoard, type Cell } from "./board-geometry.ts";
import { rectangleRegion, type ToolBoard } from "./board-tools.ts";

/**
 * The Shading and Lighting canvas tools as pure functions of a board snapshot (docs/spec/formats/board.md#lights, "Shading
 * tools"). Each returns the cells a gesture would set, as the cells of one `set-shade-cells` command, or the light node a
 * pointer is on. None touches a document.
 */

/** The shading tools: Draw paints one cell per click or drag; Erase sets cells to zero; Rectangle draws an outline in cell numbers (filled with Shift); Flood replaces the connected area, channel by channel; Dropper copies a cell's shade. */
export type ShadeTool = "draw" | "erase" | "rectangle" | "flood" | "dropper";

export const SHADE_TOOLS: readonly ShadeTool[] = ["draw", "erase", "rectangle", "flood", "dropper"];

export type ShadeBoard = Pick<ToolBoard, "sizeX" | "sizeY" | "coordType" | "grid"> & Pick<BoardDocumentFields, "shadeLayers">;

export interface Shade {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export type ShadeOutcome = { readonly ok: true; readonly cells: readonly ShadeCell[] } | { readonly ok: false; readonly message: string };

const ZERO: Shade = { r: 0, g: 0, b: 0 };

/** The shade grid as the editor shows it: the board's one shading layer, row by row; `null` when it has none or more than one, or one that covers more than its grid. */
function gridOf(board: ShadeBoard): Int32Array | null {
  const layer = board.shadeLayers[0];
  if (board.shadeLayers.length > 1) return null;
  const cells = board.grid.width * board.grid.height;
  return layer === undefined ? new Int32Array(cells * 3) : decodeShade(layer, cells);
}

/** The shade of one cell (zero where the board has none, or where its shading is not the one-layer kind the editor paints). */
export function shadeAt(board: ShadeBoard, cell: Cell): Shade {
  const values = gridOf(board);
  if (values === null || !cellOnBoard(board, cell.x, cell.y)) return ZERO;
  const at = (cell.y * board.grid.width + cell.x) * 3;
  return { r: values[at] ?? 0, g: values[at + 1] ?? 0, b: values[at + 2] ?? 0 };
}

const refusal = (message: string): ShadeOutcome => ({ ok: false, message });
const unpaintable = "This board has more than one shading layer or shading that covers more cells than its grid, so it cannot be painted here.";

/** Set the named cells that are on the board to `shade` (Draw and Erase). A cell named twice is set once. */
export function paintShade(board: ShadeBoard, cells: readonly Cell[], shade: Shade): ShadeOutcome {
  if (gridOf(board) === null) return refusal(unpaintable);
  const seen = new Set<number>();
  const out: ShadeCell[] = [];
  for (const cell of cells) {
    if (!cellOnBoard(board, cell.x, cell.y)) continue;
    const key = cell.y * board.grid.width + cell.x;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: cell.x, y: cell.y, ...shade });
  }
  return { ok: true, cells: out };
}

/** The Rectangle tool: its outline between two corner cells (all its cells when `filled`), measured in cell numbers. */
export function rectangleShade(board: ShadeBoard & Pick<ToolBoard, "layers" | "lut" | "tileMatrix">, a: Cell, b: Cell, filled: boolean, shade: Shade): ShadeOutcome {
  return paintShade(board, rectangleRegion(board, a, b, filled), shade);
}

/**
 * The Flood tool. Each channel floods on its own: it replaces the connected area whose value in that channel equals the
 * clicked cell's, so where channels differ the areas differ per channel (the legacy behaviour). Connected cells share an
 * edge on the picture; cells off an isometric edge are skipped.
 */
export function floodShade(board: ShadeBoard, start: Cell, shade: Shade): ShadeOutcome {
  const values = gridOf(board);
  if (values === null) return refusal(unpaintable);
  if (!cellOnBoard(board, start.x, start.y)) return refusal("That place is not on the board.");
  const width = board.grid.width;
  const next = Int32Array.from(values);
  const wanted = [shade.r, shade.g, shade.b] as const;
  const touched = new Set<number>();
  for (let channel = 0; channel < 3; channel += 1) {
    const target = values[(start.y * width + start.x) * 3 + channel]!;
    if (target === wanted[channel]) continue;
    const reached = new Set<number>([start.y * width + start.x]);
    const queue: Cell[] = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head]!;
      for (const around of cellNeighbours(board, cell.x, cell.y)) {
        if (!cellOnBoard(board, around.x, around.y)) continue;
        const key = around.y * width + around.x;
        if (reached.has(key) || values[key * 3 + channel] !== target) continue;
        reached.add(key);
        queue.push(around);
      }
    }
    for (const key of reached) {
      next[key * 3 + channel] = wanted[channel]!;
      touched.add(key);
    }
  }
  const out: ShadeCell[] = [];
  for (const key of [...touched].sort((a, b) => a - b)) out.push({ x: key % width, y: Math.floor(key / width), r: next[key * 3]!, g: next[key * 3 + 1]!, b: next[key * 3 + 2]! });
  return { ok: true, cells: out };
}

/** A light's node the pointer is on: the nearest within `radius` board pixels. */
export interface LightNodeHit {
  readonly light: number;
  readonly node: number;
}

export function lightNodeAt(lights: readonly BoardLight[], pixel: BoardPoint, radius: number): LightNodeHit | null {
  let best: LightNodeHit | null = null;
  let bestDistance = radius * radius;
  lights.forEach((light, lightIndex) => {
    light.nodes.forEach((node, nodeIndex) => {
      const distance = (node.x - pixel.x) ** 2 + (node.y - pixel.y) ** 2;
      if (distance <= bestDistance) {
        best = { light: lightIndex, node: nodeIndex };
        bestDistance = distance;
      }
    });
  });
  return best;
}
