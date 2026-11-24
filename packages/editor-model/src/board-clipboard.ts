import { BOARD_MAX_CELLS } from "@tk-reawakened/core";
import { boardTileAt, decodeShade, isBoardObjectRecords, STORED_SHADE_MAX, STORED_SHADE_MIN, type BoardDocumentFields, type ShadeCell, type TileAssignment } from "./board-document.ts";
import { cellOnBoard, type Cell } from "./board-geometry.ts";
import type { BoardObjectKind } from "./board-objects.ts";
import type { BoardObject } from "./board-object-tools.ts";
import { rectCells, type CellRect, type ToolBoard } from "./board-tools.ts";

/**
 * The board clipboard (T-28, story 13.13): what copy and cut put on the system clipboard and what paste accepts, as pure
 * functions of a board snapshot. Two kinds of selection are supported: a **region** of cells (their tiles on one layer,
 * and their shading when the board has the one shading layer the editor paints) and **whole** vectors, programs, sprites
 * or images of one family. A partial set of a region's points and a light are not supported, and are refused before
 * anything is changed. The clipboard text is one JSON document, versioned, so a copy from one editor window pastes into
 * another and a newer or foreign text is refused with a reason instead of being guessed at.
 */

/** The `format` tag of the clipboard text. */
export const BOARD_CLIPBOARD_FORMAT = "tkr-board-clipboard";
/** The version this editor writes and reads; text of any other version is refused. */
export const BOARD_CLIPBOARD_VERSION = 1;

/** A shade as the clipboard stores it: red, green and blue, each a stored `i16` whole number (a painted shade is −255…255; baking a light can take one past that). */
export type ClipShade = readonly [number, number, number];

/** A rectangle of cells: row by row, `null` where the stored grid has no place on the picture (an isometric gap). */
export interface RegionClip {
  readonly kind: "region";
  /**
   * The stored cell the region's top-left cell was copied from, or `null` when the text does not say (a hand-made clip): a
   * paste falls back to it when the cursor placement does not fit, and without it the paste only ever uses the cursor.
   */
  readonly origin: { readonly x: number; readonly y: number } | null;
  readonly width: number;
  readonly height: number;
  /** Each cell's tile reference (`""` is the empty cell), `width × height` of them, or `null` for a cell that was off the board. */
  readonly tiles: readonly (string | null)[];
  /** Each cell's shade, parallel to `tiles`, or `null` when the board had no single shading layer to copy from. */
  readonly shades: readonly (ClipShade | null)[] | null;
}

/** Whole stored objects of one family, in slot order, as they were stored (every field, including ones the editor does not show). */
export interface ObjectsClip {
  readonly kind: "objects";
  readonly family: BoardObjectKind;
  readonly objects: readonly BoardObject[];
}

export type BoardClip = RegionClip | ObjectsClip;

export type ClipResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const fail = (message: string): { readonly ok: false; readonly message: string } => ({ ok: false, message });

/** The text to put on the clipboard. */
export function serializeClip(clip: BoardClip): string {
  return JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: BOARD_CLIPBOARD_VERSION, ...clip });
}

const FAMILIES: readonly string[] = ["vectors", "programs", "sprites", "images"];
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Read clipboard text: a clip this editor wrote, or the reason the text is not one. */
export function parseClip(text: string): ClipResult<BoardClip> {
  try {
    return parseClipText(text);
  } catch {
    // No clipboard text may throw at a caller: whatever a page or another program put there is refused with a reason.
    return fail("The clipboard does not hold board data. Copy a region of cells or whole vectors, programs, sprites or images from a board first.");
  }
}

/** The version in words, whatever the clipboard put there (`String()` of a JSON object with a null `toString` throws). */
function versionWords(version: unknown): string {
  if (typeof version === "number" || typeof version === "string") return String(version);
  return "an unknown version";
}

function parseClipText(text: string): ClipResult<BoardClip> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("The clipboard does not hold board data. Copy a region of cells or whole vectors, programs, sprites or images from a board first.");
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as Record<string, unknown>).format !== BOARD_CLIPBOARD_FORMAT) {
    return fail("The clipboard does not hold board data. Copy a region of cells or whole vectors, programs, sprites or images from a board first.");
  }
  const clip = parsed as Record<string, unknown>;
  if (clip.version !== BOARD_CLIPBOARD_VERSION) {
    return fail(`The clipboard holds board data of version ${versionWords(clip.version)}, and this editor reads version ${BOARD_CLIPBOARD_VERSION}, so nothing was pasted.`);
  }
  if (clip.kind === "region") {
    const { width, height, tiles, shades } = clip;
    if (!isWhole(width, 1, BOARD_MAX_CELLS) || !isWhole(height, 1, BOARD_MAX_CELLS) || width * height > BOARD_MAX_CELLS) return fail("The clipboard's region does not have a valid size.");
    const cells = width * height;
    if (!Array.isArray(tiles) || tiles.length !== cells || !tiles.every((tile) => tile === null || typeof tile === "string")) return fail("The clipboard's region does not hold one tile for each of its cells.");
    if (shades !== null) {
      if (!Array.isArray(shades) || shades.length !== cells
        || !shades.every((shade) => shade === null || (Array.isArray(shade) && shade.length === 3 && shade.every((channel) => isWhole(channel, STORED_SHADE_MIN, STORED_SHADE_MAX))))) {
        return fail("The clipboard's region does not hold one shade for each of its cells.");
      }
    }
    const origin = clip.origin;
    if (origin !== undefined && origin !== null && !(typeof origin === "object" && isWhole((origin as Record<string, unknown>).x, 0, BOARD_MAX_CELLS) && isWhole((origin as Record<string, unknown>).y, 0, BOARD_MAX_CELLS))) {
      return fail("The clipboard's region does not say which cell it was copied from.");
    }
    return {
      ok: true,
      value: {
        kind: "region",
        origin: origin === undefined || origin === null ? null : { x: (origin as { x: number }).x, y: (origin as { y: number }).y },
        width,
        height,
        tiles: tiles as (string | null)[],
        shades: shades as RegionClip["shades"],
      },
    };
  }
  if (clip.kind === "objects") {
    const family = clip.family;
    if (typeof family !== "string" || !FAMILIES.includes(family)) return fail("The clipboard names a kind of board object this editor does not have.");
    const objects = clip.objects;
    if (!Array.isArray(objects) || objects.length === 0 || !isBoardObjectRecords(objects, family as BoardObjectKind)) return fail(`The clipboard's ${family} are not stored ${family} this editor can read.`);
    return { ok: true, value: { kind: "objects", family: family as BoardObjectKind, objects: objects as BoardObject[] } };
  }
  return fail("The clipboard holds something this editor does not paste on a board. Lights and partial sets of points are never copied; copy whole objects or a region of cells.");
}

/** What region copy and paste read of a board. */
export type ClipBoard = ToolBoard & Pick<BoardDocumentFields, "shadeLayers">;

/** The board's one shading layer decoded, `null` when it has none or more than one (or one that covers more than its grid). */
function singleShade(board: ClipBoard): Int32Array | null {
  const layer = board.shadeLayers[0];
  if (layer === undefined || board.shadeLayers.length !== 1) return null;
  return decodeShade(layer, board.grid.width * board.grid.height);
}

/** The cells of `rect` as a clip: tiles of `layer`, and shades when the board has one shading layer to read them from. */
export function copyRegion(board: ClipBoard, layer: number, rect: CellRect): ClipResult<RegionClip> {
  const width = rect.x1 - rect.x0 + 1;
  const height = rect.y1 - rect.y0 + 1;
  if (width < 1 || height < 1 || rectCells(board, rect).length === 0) return fail("None of the selected cells are on the board, so there is nothing to copy.");
  const shade = singleShade(board);
  const tiles: (string | null)[] = [];
  const shades: (ClipShade | null)[] = [];
  for (let y = rect.y0; y <= rect.y1; y += 1) {
    for (let x = rect.x0; x <= rect.x1; x += 1) {
      const on = cellOnBoard(board, x, y);
      tiles.push(on ? boardTileAt(board, layer, x, y) ?? "" : null);
      const at = (y * board.grid.width + x) * 3;
      shades.push(on && shade !== null ? [shade[at] ?? 0, shade[at + 1] ?? 0, shade[at + 2] ?? 0] : null);
    }
  }
  return { ok: true, value: { kind: "region", origin: { x: rect.x0, y: rect.y0 }, width, height, tiles, shades: shade === null ? null : shades } };
}

/** The cells a region clip changes, as one edit's tile and shade writes. */
export interface RegionEdit {
  readonly cells: readonly TileAssignment[];
  readonly shadeCells: readonly ShadeCell[];
}

/** Everything a paste or cut of a region would write, or why it is refused (nothing is changed when it is). */
export type RegionOutcome = { readonly ok: true; readonly edit: RegionEdit } | { readonly ok: false; readonly message: string };

/**
 * Whether the cells a region was copied from still hold exactly what the clip took. A cut removes only what it copied: when
 * the board changed under the selection (an undo, a reload, another view) while the cut waited, nothing is cleared.
 */
export function regionStillHolds(board: ClipBoard, clip: RegionClip, layer: number, rect: CellRect): boolean {
  const now = copyRegion(board, layer, rect);
  if (!now.ok) return false;
  const current = now.value;
  const carriedShade = clip.shades !== null;
  if (current.width !== clip.width || current.height !== clip.height || (current.shades !== null) !== carriedShade) return false;
  if (current.tiles.length !== clip.tiles.length || current.tiles.some((tile, at) => tile !== clip.tiles[at])) return false;
  if (!carriedShade || current.shades === null || clip.shades === null) return true;
  return current.shades.every((shade, at) => {
    const was = clip.shades![at] ?? null;
    if (shade === null || was === null) return shade === was;
    return shade[0] === was[0] && shade[1] === was[1] && shade[2] === was[2];
  });
}

/** Put a region clip with its top-left cell on `at`. Refused whole when any of its cells would land off the board or its shade cannot be placed. */
export function pasteRegion(board: ClipBoard, layer: number, clip: RegionClip, at: Cell): RegionOutcome {
  const carried = clip.shades !== null;
  if (carried && board.shadeLayers.length > 1) {
    return fail("This board has more than one shading layer, so the shading that was copied cannot be pasted here. Nothing was changed.");
  }
  const current = carried ? singleShade(board) ?? (board.shadeLayers.length === 0 ? new Int32Array(board.grid.width * board.grid.height * 3) : null) : null;
  if (carried && current === null) return fail("This board's shading covers more cells than its grid, so shading cannot be pasted onto it. Nothing was changed.");
  const cells: TileAssignment[] = [];
  const shadeCells: ShadeCell[] = [];
  for (let row = 0; row < clip.height; row += 1) {
    for (let column = 0; column < clip.width; column += 1) {
      const tile = clip.tiles[row * clip.width + column];
      if (tile === null || tile === undefined) continue;
      const x = at.x + column;
      const y = at.y + row;
      if (!cellOnBoard(board, x, y)) {
        return fail(`The copied region is ${clip.width} × ${clip.height} cells and does not fit with its corner at column ${at.x + 1}, row ${at.y + 1}. Nothing was changed.`);
      }
      if (boardTileAt(board, layer, x, y) !== tile) cells.push({ layer, x, y, tile });
      const shade = clip.shades?.[row * clip.width + column];
      if (shade !== null && shade !== undefined && current !== null) {
        const index = (y * board.grid.width + x) * 3;
        if (current[index] !== shade[0] || current[index + 1] !== shade[1] || current[index + 2] !== shade[2]) shadeCells.push({ x, y, r: shade[0], g: shade[1], b: shade[2] });
      }
    }
  }
  return { ok: true, edit: { cells, shadeCells } };
}

/** What cutting `rect` writes: every non-empty tile becomes empty and every non-zero shade zero (shade only on a board with one shading layer). */
export function clearRegion(board: ClipBoard, layer: number, rect: CellRect): RegionEdit {
  const shade = singleShade(board);
  const cells: TileAssignment[] = [];
  const shadeCells: ShadeCell[] = [];
  for (const { x, y } of rectCells(board, rect)) {
    if (boardTileAt(board, layer, x, y) !== "") cells.push({ layer, x, y, tile: "" });
    const at = (y * board.grid.width + x) * 3;
    if (shade !== null && (shade[at] !== 0 || shade[at + 1] !== 0 || shade[at + 2] !== 0)) shadeCells.push({ x, y, r: 0, g: 0, b: 0 });
  }
  return { cells, shadeCells };
}

const cloneRecord = <T>(record: T): T => JSON.parse(JSON.stringify(record)) as T;

/** The objects at `indices` of one family as a clip (copies, so a later edit of the board cannot change the clip). */
export function copyObjects(board: Pick<BoardDocumentFields, BoardObjectKind>, family: BoardObjectKind, indices: readonly number[]): ClipResult<ObjectsClip> {
  const records = board[family];
  const chosen = [...new Set(indices)].sort((a, b) => a - b).map((index) => records[index]);
  if (chosen.length === 0 || chosen.some((record) => record === undefined)) return fail(`Select a whole ${family.slice(0, -1)} on the board first.`);
  return { ok: true, value: { kind: "objects", family, objects: chosen.map((record) => cloneRecord(record!)) as BoardObject[] } };
}

/** The family's records after appending the clip's objects, or why they cannot be (each must belong to a layer the board has). */
export function pasteObjects(board: Pick<BoardDocumentFields, BoardObjectKind | "layers">, clip: ObjectsClip): ClipResult<readonly BoardObject[]> {
  const stray = clip.objects.find((object) => !Number.isInteger(object.layer) || object.layer < 1 || object.layer > board.layers);
  if (stray !== undefined) {
    return fail(`A copied ${clip.family.slice(0, -1)} belongs to layer ${stray.layer}, and this board has ${board.layers} ${board.layers === 1 ? "layer" : "layers"}, so nothing was pasted.`);
  }
  return { ok: true, value: [...board[clip.family], ...clip.objects.map((object) => cloneRecord(object))] };
}
