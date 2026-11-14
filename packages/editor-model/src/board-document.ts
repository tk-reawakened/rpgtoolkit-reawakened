import { BOARD_MAX_CELLS, BinaryReader, boardGrid, readBoard, writeBoard, type Board, type BoardGrid, type BoardShadeLayer, type BoardShadeRecord, type BoardTileRun } from "@tk-reawakened/core";
import {
  createBinaryDocument,
  firstDifference,
  openBinaryDocument,
  type DocumentCodec,
  type DocumentSnapshot,
  type DocumentStorage,
  type EditorDocument,
  type OpenResult as GenericOpenResult,
  type ReadOnlyReason,
  type Rejection,
} from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";

/**
 * The board document (`docs/spec/formats/board.md#vector-layout-minor-4-and-later`, ADR 0026): bytes plus a command
 * stack, over the model `readBoard` returns. The model keeps the stored tile runs, the vectors, programs, sprites,
 * images and the residue the editor does not model (AD-18), so `writeBoard` puts back every datum a command did not
 * touch. Only the vector layout (minor 4 and later) has a writer; an older board is refused with the reader's located
 * error and never upgraded on open (ADR 0022 D2.1).
 */

/** Put one tile on one cell. `tile` is the stored lookup-table reference (`""` is the empty cell); a reference the board has not used is added to its table. */
export interface SetTileCommand {
  readonly type: "set-tile";
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly tile: string;
}

/** One cell of a `set-tiles` command. */
export interface TileAssignment {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  /** The stored lookup-table reference; `""` is the empty cell. */
  readonly tile: string;
}

/**
 * Give one cell of one layer a tint: the signed RGB (−255…255) that is added to that layer's tile there, as a tile
 * bitmap cell's tint is. The board stores shading per **cast layer** (`docs/spec/formats/board.md#tile-shading`): a shade
 * cast onto layer `c` tints layers `1…c`, so the tint of one layer alone is two shade records, `+tint` on the shade cast
 * onto this layer and `−tint` on the shade cast onto the layer below it. Setting a tint is idempotent: it is the cell's
 * tint on this layer that becomes `r, g, b`, whatever shading the cell already had, and other layers keep theirs.
 */
export interface ShadeAssignment {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** What the gesture that made a `set-tiles` command was, for the words an undo menu shows. */
export type TileGesture = "draw" | "erase" | "flood" | "rectangle" | "stamp" | "move" | "copy";

/**
 * Put many tiles in one edit: one gesture of the canvas (a drag, a flood fill, a rectangle, a stamp, a move or copy) is
 * one command, so one undo takes it all back. A cell named twice takes the later tile; a cell that already shows its tile
 * is left alone; the command is refused when it changes nothing.
 */
export interface SetTilesCommand {
  readonly type: "set-tiles";
  readonly gesture: TileGesture;
  readonly cells: readonly TileAssignment[];
  /** Tints set in the same edit (a tile bitmap stamp places its cells' tints with its tiles). Absent when there are none. */
  readonly shades?: readonly ShadeAssignment[];
}

/** Every command a board document accepts. Plain data, so a stack of them can be stored and replayed. */
export type BoardCommand = SetTileCommand | SetTilesCommand;

/**
 * What a board adds to the shared snapshot: plain JSON a view can draw a grid from and a host can post to a webview
 * (no byte arrays, no vectors or programs: a view that needs more asks for it by name in a later story). The arrays are
 * the model's own and are never changed, so an unchanged board gives the same references.
 */
export interface BoardDocumentFields {
  /** The minor version the file was opened at and is saved at (AD-18). */
  readonly minor: number;
  /** The stored grid of every layer (`sizeX × sizeY`, or the rotated square of an iso-rotated board). */
  readonly grid: BoardGrid;
  /** The logical width in tiles (the stored grid of an iso-rotated board is larger). */
  readonly sizeX: number;
  /** The logical height in tiles. */
  readonly sizeY: number;
  /** The board's background image reference, or `""` when it has none. */
  readonly backgroundImage: string;
  /** How many tile layers the board has. */
  readonly layers: number;
  /** The board's `coordType`: 0 is top-down; other values are the isometric systems. */
  readonly coordType: number;
  /** The layer titles, as stored. */
  readonly layerTitles: readonly string[];
  /** The tile lookup table: `tileMatrix` holds indices into it, and `""` is the empty cell. */
  readonly lut: readonly string[];
  /** One lookup-table index per cell, layer-major then row-major (`docs/spec/formats/board.md#vector-layout-minor-4-and-later`). */
  readonly tileMatrix: readonly number[];
}

export type BoardDocumentSnapshot = DocumentSnapshot<BoardCommand> & BoardDocumentFields;
export type BoardDocument = EditorDocument<BoardDocumentSnapshot, BoardCommand>;
export type BoardOpenResult = GenericOpenResult<BoardDocument>;

/** The most lookup-table entries a board can index: the stored index is a non-negative `i16`. */
const MAX_LUT_ENTRIES = 32768;

/** The tile reference on one cell of a board snapshot or model, or `null` when the cell is outside the board. */
export function boardTileAt(
  board: { readonly grid: BoardGrid; readonly layers: number; readonly lut: readonly string[]; readonly tileMatrix: readonly number[] },
  layer: number,
  x: number,
  y: number,
): string | null {
  const cell = cellOf(board.grid, board.layers, layer, x, y);
  if (cell === null) return null;
  const index = board.tileMatrix[cell];
  return index === undefined ? null : (board.lut[index] ?? null);
}

function cellOf(grid: BoardGrid, layers: number, layer: number, x: number, y: number): number | null {
  if (![layer, x, y].every(Number.isInteger)) return null;
  if (layer < 0 || layer >= layers || x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  return layer * grid.width * grid.height + y * grid.width + x;
}

function cellIndex(board: Board, layer: number, x: number, y: number): number | null {
  return cellOf(boardGrid(board.sizeX, board.sizeY, board.coordType), board.sizeL, layer, x, y);
}

/** One cell's final tile once every assignment of a command is in. */
function finalTiles(board: Board, assignments: readonly TileAssignment[]): Map<number, string> {
  const final = new Map<number, string>();
  for (const assignment of assignments) {
    const cell = cellIndex(board, assignment.layer, assignment.x, assignment.y);
    if (cell !== null) final.set(cell, assignment.tile);
  }
  return final;
}

/**
 * Replace cells. Only the runs that hold a changed cell are split (the runs before and after, and every other run, are
 * kept verbatim), so a save after an edit changes the bytes of those runs and nothing else. Adjacent changed cells that
 * take the same tile become one run.
 */
function assignTiles(board: Board, assignments: readonly TileAssignment[]): Board {
  const final = finalTiles(board, assignments);
  let lut = board.lut;
  const indexOf = new Map<string, number>();
  const lookup = (tile: string): number => {
    const known = indexOf.get(tile);
    if (known !== undefined) return known;
    let index = board.lut.indexOf(tile);
    if (index === -1) {
      if (lut === board.lut) lut = [...board.lut];
      index = (lut as string[]).push(tile) - 1;
    }
    indexOf.set(tile, index);
    return index;
  };
  const changes: [number, number][] = [];
  for (const [cell, tile] of final) {
    const index = lookup(tile);
    if (board.tileMatrix[cell] !== index) changes.push([cell, index]);
  }
  if (changes.length === 0) return board;
  changes.sort((a, b) => a[0] - b[0]);
  const runs: BoardTileRun[] = [];
  let next = 0;
  let start = 0;
  for (const run of board.tileRuns) {
    const end = start + run.count;
    const first = changes[next];
    if (first === undefined || first[0] >= end) {
      runs.push(run);
      start = end;
      continue;
    }
    const pieces: { lutIndex: number; count: number; kept: boolean }[] = [];
    const add = (lutIndex: number, count: number, kept: boolean): void => {
      const last = pieces[pieces.length - 1];
      if (last !== undefined && !kept && !last.kept && last.lutIndex === lutIndex) last.count += count;
      else pieces.push({ lutIndex, count, kept });
    };
    let at = start;
    for (let change = changes[next]; change !== undefined && change[0] < end; change = changes[++next]) {
      if (change[0] > at) add(run.lutIndex, change[0] - at, true);
      add(change[1], 1, false);
      at = change[0] + 1;
    }
    if (at < end) add(run.lutIndex, end - at, true);
    for (const piece of pieces) runs.push({ lutIndex: piece.lutIndex, count: piece.count, marker: piece.kept || piece.count > 1 });
    start = end;
  }
  const tileMatrix = board.tileMatrix.slice();
  for (const [cell, index] of changes) tileMatrix[cell] = index;
  return { ...board, lut, tileMatrix, tileRuns: runs };
}

const SHADE_MIN = -255;
const SHADE_MAX = 255;

/** One shade layer's cells, three channels each, row by row; `null` when its records cover more cells than the grid (a file the editor will not rewrite). */
function decodeShade(layer: BoardShadeLayer, cells: number): Int16Array | null {
  const values = new Int16Array(cells * 3);
  let at = 0;
  for (const record of layer.records) {
    const count = record.runCount > 1 ? record.runCount : 1;
    if (at + count > cells) return null;
    for (let run = 0; run < count; run += 1, at += 1) {
      values[at * 3] = record.r;
      values[at * 3 + 1] = record.g;
      values[at * 3 + 2] = record.b;
    }
  }
  return values;
}

/** Run-length encode shade cells: equal neighbours become one record (the stored count is at most an `i16`). */
function encodeShade(values: Int16Array, cells: number): BoardShadeRecord[] {
  const records: BoardShadeRecord[] = [];
  for (let at = 0; at < cells;) {
    const r = values[at * 3]!;
    const g = values[at * 3 + 1]!;
    const b = values[at * 3 + 2]!;
    let end = at + 1;
    while (end < cells && end - at < 32_767 && values[end * 3] === r && values[end * 3 + 1] === g && values[end * 3 + 2] === b) end += 1;
    records.push({ runCount: end - at > 1 ? end - at : 1, r, g, b });
    at = end;
  }
  return records;
}

/**
 * Work out the shade layers after setting `shades`, or why they cannot be set. For each assignment the cell's tint on that
 * layer alone (every shade cast onto that layer or a higher one, and the all-layer shade) becomes the wanted tint: the
 * difference is added to the shade cast onto the layer and taken from the shade cast onto the layer below it.
 */
function planShades(board: Board, shades: readonly ShadeAssignment[]): { readonly ok: true; readonly layers: readonly BoardShadeLayer[] } | { readonly ok: false; readonly message: string } {
  if (shades.length === 0) return { ok: true, layers: board.shadeLayers };
  const grid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  const cells = grid.width * grid.height;
  const decoded: (Int16Array | null)[] = [];
  const layers = [...board.shadeLayers];
  const values = (index: number): Int16Array | null => {
    if (decoded[index] === undefined) decoded[index] = decodeShade(layers[index]!, cells);
    return decoded[index]!;
  };
  /** The shade layer cast onto `castLayer`, made when the board has none. */
  const castOnto = (castLayer: number): number => {
    const found = layers.findIndex((layer) => layer.castLayer === castLayer);
    if (found !== -1) return found;
    layers.push({ castLayer, records: encodeShade(new Int16Array(cells * 3), cells) });
    return layers.length - 1;
  };
  const changed = new Set<number>();
  const final = new Map<number, ShadeAssignment>();
  for (const shade of shades) {
    // The shading has no layers of its own: a cell is its place in the grid.
    if (cellOf(grid, board.sizeL, shade.layer, shade.x, shade.y) !== null) final.set(shade.y * grid.width + shade.x, shade);
  }
  const edits: { cell: number; layerNumber: number; delta: readonly [number, number, number] }[] = [];
  for (const [cell, shade] of final) {
    const layerNumber = shade.layer + 1;
    const wanted = [shade.r, shade.g, shade.b] as const;
    if (!wanted.every((channel) => Number.isInteger(channel) && channel >= SHADE_MIN && channel <= SHADE_MAX)) {
      return { ok: false, message: `A tint is three whole numbers from ${SHADE_MIN} to ${SHADE_MAX}.` };
    }
    const effective = [0, 0, 0];
    for (let index = 0; index < layers.length; index += 1) {
      const castLayer = layers[index]!.castLayer;
      if (castLayer !== 0 && castLayer < layerNumber) continue;
      const decodedLayer = values(index);
      if (decodedLayer === null) return { ok: false, message: "This board's shading covers more cells than its grid, which the editor does not rewrite." };
      for (let channel = 0; channel < 3; channel += 1) effective[channel]! += decodedLayer[cell * 3 + channel]!;
    }
    edits.push({ cell, layerNumber, delta: [wanted[0] - effective[0]!, wanted[1] - effective[1]!, wanted[2] - effective[2]!] });
  }
  for (const edit of edits) {
    if (edit.delta.every((channel) => channel === 0)) continue;
    // A shade cast onto layer `n` tints layers 1…n, so the tint of layer `n` alone is +delta there and −delta cast onto `n − 1`.
    const casts: readonly [number, number][] = edit.layerNumber === 1 ? [[1, 1]] : [[edit.layerNumber, 1], [edit.layerNumber - 1, -1]];
    for (const [castLayer, sign] of casts) {
      const index = castOnto(castLayer);
      const decodedLayer = values(index);
      if (decodedLayer === null) return { ok: false, message: "This board's shading covers more cells than its grid, which the editor does not rewrite." };
      for (let channel = 0; channel < 3; channel += 1) {
        const next = decodedLayer[edit.cell * 3 + channel]! + sign * edit.delta[channel]!;
        if (next < SHADE_MIN || next > SHADE_MAX) return { ok: false, message: `The shading at column ${(edit.cell % grid.width) + 1}, row ${Math.floor(edit.cell / grid.width) + 1} cannot hold that tint: a shade is at most ${SHADE_MAX} either way.` };
        decodedLayer[edit.cell * 3 + channel] = next;
      }
      changed.add(index);
    }
  }
  if (changed.size === 0) return { ok: true, layers: board.shadeLayers };
  for (const index of changed) layers[index] = { castLayer: layers[index]!.castLayer, records: encodeShade(decoded[index]!, cells) };
  return { ok: true, layers };
}

function applyCommand(board: Board, command: BoardCommand): Board {
  if (command.type === "set-tile") return assignTiles(board, [command]);
  const tiled = assignTiles(board, command.cells);
  if (command.shades === undefined || command.shades.length === 0) return tiled;
  const planned = planShades(tiled, command.shades);
  return planned.ok && planned.layers !== tiled.shadeLayers ? { ...tiled, shadeLayers: planned.layers } : tiled;
}

function readOnlyReason(model: Board, bytes: Uint8Array): ReadOnlyReason | null {
  const written = writeBoard(model);
  if (!written.ok) {
    return {
      code: "no-same-version-writer",
      message: `This board (minor ${model.minor}) has no writer that keeps its version: ${written.error.message}`,
    };
  }
  const first = firstDifference(written.value, bytes);
  if (first === null) return null;
  return {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this board (minor ${model.minor}) byte for byte; the first difference is at offset ${first}.`,
  };
}

/** The cells a command names. */
function assignmentsOf(command: BoardCommand): readonly TileAssignment[] {
  return command.type === "set-tile" ? [command] : command.cells;
}

/** Refuse a command that names a cell outside the board, a tile the table cannot index, or one the file cannot store as typed. */
function refuse(next: Board, command: BoardCommand, previous: Board): Rejection | null {
  const assignments = assignmentsOf(command);
  for (const assignment of assignments) {
    if (cellIndex(next, assignment.layer, assignment.x, assignment.y) === null) {
      return { reason: "invalid", message: `Layer ${assignment.layer}, column ${assignment.x}, row ${assignment.y} is outside the board.` };
    }
    if (typeof assignment.tile !== "string") return { reason: "invalid", message: "A tile is named by a text reference." };
  }
  if (command.type === "set-tiles" && command.shades !== undefined) {
    const planned = planShades(previous, command.shades);
    if (!planned.ok) return { reason: "invalid", message: planned.message };
  }
  if (next === previous) {
    return { reason: "invalid", message: assignments.length === 1 ? "That cell already shows that tile." : "Those cells already show those tiles." };
  }
  if (next.lut.length > MAX_LUT_ENTRIES) {
    return { reason: "invalid", message: `The board already names ${MAX_LUT_ENTRIES} different tiles; it cannot name another.` };
  }
  const written = writeBoard(next);
  if (!written.ok) return { reason: "invalid", message: written.error.message };
  const reread = readBoard(new BinaryReader(written.value));
  if (!reread.ok) return { reason: "invalid", message: reread.error.message };
  for (const [cell, tile] of finalTiles(next, assignments)) {
    const index = reread.value.tileMatrix[cell];
    if (index === undefined || reread.value.lut[index] !== tile) {
      return { reason: "invalid", message: "That tile reference cannot be stored in the file exactly as typed." };
    }
  }
  return null;
}

function isShade(value: unknown): value is ShadeAssignment {
  return typeof value === "object" && value !== null
    && "layer" in value && typeof value.layer === "number" && "x" in value && typeof value.x === "number" && "y" in value && typeof value.y === "number"
    && "r" in value && typeof value.r === "number" && "g" in value && typeof value.g === "number" && "b" in value && typeof value.b === "number";
}

function isAssignment(value: unknown): value is TileAssignment {
  return typeof value === "object" && value !== null
    && "layer" in value && typeof value.layer === "number" && "x" in value && typeof value.x === "number"
    && "y" in value && typeof value.y === "number" && "tile" in value && typeof value.tile === "string";
}

const GESTURES: readonly string[] = ["draw", "erase", "flood", "rectangle", "stamp", "move", "copy"];

const GESTURE_WORDS: Readonly<Record<TileGesture, string>> = {
  draw: "Draw",
  erase: "Erase",
  flood: "Flood fill",
  rectangle: "Rectangle",
  stamp: "Stamp",
  move: "Move",
  copy: "Copy",
};

/** The board's codec. */
export const boardCodec: DocumentCodec<Board, BoardCommand, BoardDocumentFields> = {
  kind: "board",
  read: (bytes, path) => readBoard(new BinaryReader(bytes, path)),
  write: writeBoard,
  readOnlyReason,
  isCommand: (value): value is BoardCommand => {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;
    if (value.type === "set-tile") return isAssignment(value);
    return value.type === "set-tiles" && "gesture" in value && typeof value.gesture === "string" && GESTURES.includes(value.gesture)
      && "cells" in value && Array.isArray(value.cells) && value.cells.length <= BOARD_MAX_CELLS && value.cells.every(isAssignment)
      && (!("shades" in value) || value.shades === undefined || (Array.isArray(value.shades) && value.shades.length <= BOARD_MAX_CELLS && value.shades.every(isShade)));
  },
  apply: applyCommand,
  label: (command) => {
    if (command.type === "set-tiles") {
      return `${GESTURE_WORDS[command.gesture]} ${command.cells.length} ${command.cells.length === 1 ? "cell" : "cells"} on layer ${command.cells[0] === undefined ? 0 : command.cells[0].layer + 1}`;
    }
    return `Put ${command.tile === "" ? "an empty cell" : `"${command.tile}"`} at layer ${command.layer}, column ${command.x}, row ${command.y}`;
  },
  refuse,
  summary: (model) => `${model.sizeX}×${model.sizeY} board, ${model.sizeL} layers`,
  fields: (model) => ({
    minor: model.minor,
    grid: boardGrid(model.sizeX, model.sizeY, model.coordType),
    sizeX: model.sizeX,
    sizeY: model.sizeY,
    backgroundImage: model.properties.backgroundImage,
    layers: model.sizeL,
    coordType: model.coordType,
    layerTitles: model.layerTitles,
    lut: model.lut,
    tileMatrix: model.tileMatrix,
  }),
};

/** Read the board at `identity.path` through `storage` and open it. */
export function openBoardDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<BoardOpenResult> {
  return openBinaryDocument(boardCodec, storage, identity);
}

/** Open a board document over bytes already in hand. */
export function createBoardDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): BoardOpenResult {
  return createBinaryDocument(boardCodec, storage, identity, bytes);
}
