import { BinaryReader, boardGrid, readBoard, writeBoard, type Board, type BoardGrid, type BoardTileRun } from "@tk-reawakened/core";
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

/** Every command a board document accepts. Plain data, so a stack of them can be stored and replayed. */
export type BoardCommand = SetTileCommand;

/** What a board adds to the shared snapshot. */
export interface BoardDocumentFields {
  /** The board as the model holds it now, saved or not. Immutable: a command makes a new object. */
  readonly board: Board;
  /** The minor version the file was opened at and is saved at (AD-18). */
  readonly minor: number;
  /** The stored grid of every layer (`sizeX × sizeY`, or the rotated square of an iso-rotated board). */
  readonly grid: BoardGrid;
}

export type BoardDocumentSnapshot = DocumentSnapshot<BoardCommand> & BoardDocumentFields;
export type BoardDocument = EditorDocument<BoardDocumentSnapshot, BoardCommand>;
export type BoardOpenResult = GenericOpenResult<BoardDocument>;

/** The most lookup-table entries a board can index: the stored index is a non-negative `i16`. */
const MAX_LUT_ENTRIES = 32768;

/** The tile reference on one cell: `lut[tileMatrix[cell]]`, or `null` when the cell is outside the board. */
export function boardTileAt(board: Board, layer: number, x: number, y: number): string | null {
  const cell = cellIndex(board, layer, x, y);
  if (cell === null) return null;
  const index = board.tileMatrix[cell];
  return index === undefined ? null : (board.lut[index] ?? null);
}

function cellIndex(board: Board, layer: number, x: number, y: number): number | null {
  const grid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  if (![layer, x, y].every(Number.isInteger)) return null;
  if (layer < 0 || layer >= board.sizeL || x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  return layer * grid.width * grid.height + y * grid.width + x;
}

/**
 * Replace one cell. Only the run that holds it is split (the runs before and after, and every other run, are kept
 * verbatim), so a save after one edit changes the bytes of that run and nothing else.
 */
function setTile(board: Board, command: SetTileCommand): Board {
  const cell = cellIndex(board, command.layer, command.x, command.y);
  if (cell === null) return board;
  let index = board.lut.indexOf(command.tile);
  const lut = index === -1 ? [...board.lut, command.tile] : board.lut;
  if (index === -1) index = lut.length - 1;
  if (board.tileMatrix[cell] === index) return board;
  const runs: BoardTileRun[] = [];
  let start = 0;
  for (const run of board.tileRuns) {
    const end = start + run.count;
    if (cell < start || cell >= end) {
      runs.push(run);
    } else {
      const before = cell - start;
      const after = end - cell - 1;
      if (before > 0) runs.push({ lutIndex: run.lutIndex, count: before, marker: true });
      runs.push({ lutIndex: index, count: 1, marker: false });
      if (after > 0) runs.push({ lutIndex: run.lutIndex, count: after, marker: true });
    }
    start = end;
  }
  const tileMatrix = board.tileMatrix.slice();
  tileMatrix[cell] = index;
  return { ...board, lut, tileMatrix, tileRuns: runs };
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

/** Refuse a command that names a cell outside the board, a tile the table cannot index, or one the file cannot store as typed. */
function refuse(next: Board, command: SetTileCommand, previous: Board): Rejection | null {
  if (cellIndex(next, command.layer, command.x, command.y) === null) {
    return { reason: "invalid", message: `Layer ${command.layer}, column ${command.x}, row ${command.y} is outside the board.` };
  }
  if (next === previous) return { reason: "invalid", message: "That cell already shows that tile." };
  if (typeof command.tile !== "string") return { reason: "invalid", message: "A tile is named by a text reference." };
  if (next.lut.length > MAX_LUT_ENTRIES) {
    return { reason: "invalid", message: `The board already names ${MAX_LUT_ENTRIES} different tiles; it cannot name another.` };
  }
  const written = writeBoard(next);
  if (!written.ok) return { reason: "invalid", message: written.error.message };
  const reread = readBoard(new BinaryReader(written.value));
  const cell = cellIndex(next, command.layer, command.x, command.y)!;
  const index = reread.ok ? reread.value.tileMatrix[cell] : undefined;
  if (!reread.ok || index === undefined || reread.value.lut[index] !== command.tile) {
    return { reason: "invalid", message: "That tile reference cannot be stored in the file exactly as typed." };
  }
  return null;
}

/** The board's codec. */
export const boardCodec: DocumentCodec<Board, BoardCommand, BoardDocumentFields> = {
  kind: "board",
  read: (bytes, path) => readBoard(new BinaryReader(bytes, path)),
  write: writeBoard,
  readOnlyReason,
  apply: setTile,
  label: (command) => `Put ${command.tile === "" ? "an empty cell" : `"${command.tile}"`} at layer ${command.layer}, column ${command.x}, row ${command.y}`,
  refuse,
  summary: (model) => `${model.sizeX}×${model.sizeY} board, ${model.sizeL} layers`,
  fields: (model) => ({ board: model, minor: model.minor, grid: boardGrid(model.sizeX, model.sizeY, model.coordType) }),
};

/** Read the board at `identity.path` through `storage` and open it. */
export function openBoardDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<BoardOpenResult> {
  return openBinaryDocument(boardCodec, storage, identity);
}

/** Open a board document over bytes already in hand. */
export function createBoardDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): BoardOpenResult {
  return createBinaryDocument(boardCodec, storage, identity, bytes);
}
