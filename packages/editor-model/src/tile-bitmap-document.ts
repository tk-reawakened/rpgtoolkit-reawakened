import {
  BinaryReader,
  readTileBitmap,
  writeTileBitmap,
  type TileBitmap,
  type TileBitmapCell,
} from "@tk-reawakened/core";
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
 * The tile bitmap document (`docs/spec/formats/tiles.md#tile-bitmap-tbm`, T-62, ADR 0026): bytes plus a command stack
 * over the model `readTileBitmap` returns. The model keeps the stored bounds, the extra row and column the file stores
 * beyond the drawn grid, every tint and the residue after the last cell (AD-18), so `writeTileBitmap` puts back every
 * datum a command did not touch. A file the writer does not reproduce byte for byte opens read-only (ADR 0022 D2.1).
 */

/** The editor's size limit, in tiles (`docs/spec/formats/tiles.md#tile-bitmap-tbm`: the editor allows 1..40). The file has no such limit. */
export const TILE_BITMAP_MIN_TILES = 1;
export const TILE_BITMAP_MAX_TILES = 40;

/** The documented tint range of one cell channel. */
export const TILE_SHADE_MIN = -255;
export const TILE_SHADE_MAX = 255;

/** Put one tile reference on a drawn cell; `""` erases the cell. The cell's shade is left as it was. */
export interface SetBitmapCellCommand {
  readonly type: "set-bitmap-cell";
  readonly x: number;
  readonly y: number;
  readonly tile: string;
}

/** Set a drawn cell's tint: three whole numbers, each from −255 to +255. The cell's tile is left as it was. */
export interface SetBitmapShadeCommand {
  readonly type: "set-bitmap-shade";
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Make the drawn grid `width × height` tiles. Cells inside the new size are kept; new cells are empty. */
export interface SetBitmapSizeCommand {
  readonly type: "set-bitmap-size";
  readonly width: number;
  readonly height: number;
}

/** Every command a tile bitmap document accepts. Plain data, so a stack of them can be stored and replayed. */
export type TileBitmapCommand = SetBitmapCellCommand | SetBitmapShadeCommand | SetBitmapSizeCommand;

/**
 * What a tile bitmap adds to the shared snapshot: plain JSON a view draws from and a host posts to a webview. The
 * drawn cells only (the stored extra row and column stay in the model); the array is the model's own and is never
 * changed, so an unchanged bitmap gives the same references.
 */
export interface TileBitmapDocumentFields {
  /** The version the file was opened at and is saved at, as stored (informational: the engine ignores it). */
  readonly major: number;
  readonly minor: number;
  /** The drawn columns and rows, in tiles; `0` when the file stores no cells. */
  readonly width: number;
  readonly height: number;
  /** The drawn cells, row by row: the cell at column `x`, row `y` is `cells[y * width + x]`. */
  readonly cells: readonly TileBitmapCell[];
}

export type TileBitmapDocumentSnapshot = DocumentSnapshot<TileBitmapCommand> & TileBitmapDocumentFields;
export type TileBitmapDocument = EditorDocument<TileBitmapDocumentSnapshot, TileBitmapCommand>;
export type TileBitmapOpenResult = GenericOpenResult<TileBitmapDocument>;

const EMPTY_CELL: TileBitmapCell = { tile: "", r: 0, g: 0, b: 0 };

/** The stored column and row counts: the drawn size plus the stored extra column and row; `-1` stores none. */
function storedColumns(model: TileBitmap): number {
  return model.width < 0 ? 0 : model.width + 1;
}
function storedRows(model: TileBitmap): number {
  return model.height < 0 ? 0 : model.height + 1;
}

/** The index of drawn cell `(x, y)` in the model's file-order cell list (x outer, y inner), or `null` when it is not drawn. */
function modelCellIndex(model: TileBitmap, x: number, y: number): number | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null;
  if (x >= Math.max(0, model.width) || y >= Math.max(0, model.height)) return null;
  return x * storedRows(model) + y;
}

/** The drawn cell at column `x`, row `y` of a snapshot, or `null` when the bitmap does not draw one there. */
export function tileBitmapCellAt(
  bitmap: Pick<TileBitmapDocumentFields, "width" | "height" | "cells">,
  x: number,
  y: number,
): TileBitmapCell | null {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return null;
  return bitmap.cells[y * bitmap.width + x] ?? null;
}

function replaceCell(model: TileBitmap, index: number, cell: TileBitmapCell): TileBitmap {
  const cells = model.cells.slice();
  cells[index] = cell;
  return { ...model, cells };
}

/**
 * A new drawn size. A cell inside the new drawn grid keeps what it held. The extra stored column and row keep what the
 * file held at the same place when it was extra there too, and are empty otherwise, so a resize never turns hidden
 * artwork into padding and never turns padding into artwork.
 */
function resize(model: TileBitmap, width: number, height: number): TileBitmap {
  if (model.width === width && model.height === height) return model;
  const drawnColumns = Math.max(0, model.width);
  const drawnRows = Math.max(0, model.height);
  const oldRows = storedRows(model);
  const oldColumns = storedColumns(model);
  const cells: TileBitmapCell[] = [];
  for (let x = 0; x <= width; x += 1) {
    for (let y = 0; y <= height; y += 1) {
      const drawnNow = x < width && y < height;
      const drawnBefore = x < drawnColumns && y < drawnRows;
      const stored = x < oldColumns && y < oldRows ? model.cells[x * oldRows + y] : undefined;
      cells.push(drawnNow === drawnBefore && stored !== undefined ? stored : EMPTY_CELL);
    }
  }
  return { ...model, width, height, cells };
}

function apply(model: TileBitmap, command: TileBitmapCommand): TileBitmap {
  if (command.type === "set-bitmap-size") {
    // `apply` runs before `refuse`, so a size outside the editor's limit must not allocate a grid for the refusal to discard.
    return isTiles(command.width) && isTiles(command.height) ? resize(model, command.width, command.height) : model;
  }
  const index = modelCellIndex(model, command.x, command.y);
  const cell = index === null ? undefined : model.cells[index];
  if (index === null || cell === undefined) return model;
  if (command.type === "set-bitmap-cell") {
    return cell.tile === command.tile ? model : replaceCell(model, index, { ...cell, tile: command.tile });
  }
  return cell.r === command.r && cell.g === command.g && cell.b === command.b ? model : replaceCell(model, index, { ...cell, r: command.r, g: command.g, b: command.b });
}

const isShade = (value: number): boolean => Number.isInteger(value) && value >= TILE_SHADE_MIN && value <= TILE_SHADE_MAX;
const isTiles = (value: number): boolean => Number.isInteger(value) && value >= TILE_BITMAP_MIN_TILES && value <= TILE_BITMAP_MAX_TILES;

/** Refuse a command that names a cell the bitmap does not draw, a value the editor or the file cannot hold, or that changes nothing. */
function refuse(next: TileBitmap, command: TileBitmapCommand, previous: TileBitmap): Rejection | null {
  const invalid = (message: string): Rejection => ({ reason: "invalid", message });
  if (command.type === "set-bitmap-size") {
    if (!isTiles(command.width) || !isTiles(command.height)) {
      return invalid(`A tile bitmap is ${TILE_BITMAP_MIN_TILES} to ${TILE_BITMAP_MAX_TILES} tiles wide and high, in whole tiles.`);
    }
    return next === previous ? invalid(`The tile bitmap is already ${command.width} × ${command.height} tiles.`) : null;
  }
  if (modelCellIndex(previous, command.x, command.y) === null) {
    return invalid(`Column ${command.x + 1}, row ${command.y + 1} is outside the tile bitmap.`);
  }
  if (command.type === "set-bitmap-shade") {
    if (!isShade(command.r) || !isShade(command.g) || !isShade(command.b)) {
      return invalid(`Each shade is a whole number from ${TILE_SHADE_MIN} to ${TILE_SHADE_MAX}.`);
    }
    return next === previous ? invalid("That cell already has that shade.") : null;
  }
  if (typeof command.tile !== "string") return invalid("A tile is named by a text reference.");
  if (next === previous) return invalid(command.tile === "" ? "That cell is already empty." : "That cell already shows that tile.");
  const written = writeTileBitmap(next);
  if (!written.ok) return invalid(written.error.message);
  const reread = readTileBitmap(new BinaryReader(written.value));
  const index = modelCellIndex(next, command.x, command.y)!;
  if (!reread.ok || reread.value.cells[index]?.tile !== command.tile) {
    return invalid("That tile reference cannot be stored in the file exactly as typed.");
  }
  return null;
}

function readOnlyReason(model: TileBitmap, bytes: Uint8Array): ReadOnlyReason | null {
  const written = writeTileBitmap(model);
  if (!written.ok) {
    return { code: "no-same-version-writer", message: `This tile bitmap has no writer that keeps its version: ${written.error.message}` };
  }
  const first = firstDifference(written.value, bytes);
  if (first === null) return null;
  return {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this tile bitmap byte for byte; the first difference is at offset ${first}.`,
  };
}

const place = (x: number, y: number): string => `column ${x + 1}, row ${y + 1}`;

/** The tile bitmap's codec. */
export const tileBitmapCodec: DocumentCodec<TileBitmap, TileBitmapCommand, TileBitmapDocumentFields> = {
  kind: "tile-bitmap",
  read: (bytes, path) => readTileBitmap(new BinaryReader(bytes, path)),
  write: writeTileBitmap,
  readOnlyReason,
  isCommand: (value): value is TileBitmapCommand => {
    if (typeof value !== "object" || value === null || !("type" in value)) return false;
    const numeric = (name: string): boolean => name in value && typeof (value as Record<string, unknown>)[name] === "number";
    if (value.type === "set-bitmap-size") return numeric("width") && numeric("height");
    if (value.type === "set-bitmap-cell") return numeric("x") && numeric("y") && "tile" in value && typeof value.tile === "string";
    return value.type === "set-bitmap-shade" && numeric("x") && numeric("y") && numeric("r") && numeric("g") && numeric("b");
  },
  apply,
  label: (command) => {
    if (command.type === "set-bitmap-size") return `Resize the tile bitmap to ${command.width} × ${command.height} tiles`;
    if (command.type === "set-bitmap-shade") return `Shade ${place(command.x, command.y)} (${command.r}, ${command.g}, ${command.b})`;
    return command.tile === "" ? `Erase ${place(command.x, command.y)}` : `Draw "${command.tile}" at ${place(command.x, command.y)}`;
  },
  refuse,
  summary: (model) => `${Math.max(0, model.width)}×${Math.max(0, model.height)} tile bitmap`,
  fields: (model) => {
    const width = Math.max(0, model.width);
    const height = Math.max(0, model.height);
    const rows = storedRows(model);
    const cells: TileBitmapCell[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) cells.push(model.cells[x * rows + y] ?? EMPTY_CELL);
    }
    return { major: model.major, minor: model.minor, width, height, cells };
  },
};

/** Read the tile bitmap at `identity.path` through `storage` and open it. */
export function openTileBitmapDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<TileBitmapOpenResult> {
  return openBinaryDocument(tileBitmapCodec, storage, identity);
}

/** Open a tile bitmap document over bytes already in hand. */
export function createTileBitmapDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): TileBitmapOpenResult {
  return createBinaryDocument(tileBitmapCodec, storage, identity, bytes);
}

/** A cell's tint, one whole number per channel. */
export interface TileShade {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const clampShade = (value: number): number => Math.max(TILE_SHADE_MIN, Math.min(TILE_SHADE_MAX, value));
const hex = (value: number): string => value.toString(16).padStart(2, "0");

/**
 * The hue picker's colour for a shade (T-62): mid-grey `#808080` is no shade, a lighter channel adds and a darker one
 * subtracts. The picker is a shortcut for the three numbers, so the colour is the nearest whole channel value.
 */
export function colourOfShade(shade: TileShade): string {
  const channel = (value: number): string => hex(Math.max(0, Math.min(255, 128 + Math.round(value / 2))));
  return `#${channel(shade.r)}${channel(shade.g)}${channel(shade.b)}`;
}

/** The shade a hue-picker colour `#rrggbb` stands for: channel value *c* gives 2 × (*c* − 128), limited to −255…+255; `null` when the text is not `#rrggbb`. */
export function shadeOfColour(colour: string): TileShade | null {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(colour);
  if (match === null) return null;
  const channel = (text: string | undefined): number => clampShade(2 * (Number.parseInt(text ?? "", 16) - 128));
  return { r: channel(match[1]), g: channel(match[2]), b: channel(match[3]) };
}

/** The lightness slider's position for a shade: the average of the three channels, to a whole number. */
export function lightnessOfShade(shade: TileShade): number {
  return Math.round((shade.r + shade.g + shade.b) / 3);
}

/** The shade after the lightness slider moves to `lightness`: all three channels move by the change, each limited to −255…+255. */
export function shadeWithLightness(shade: TileShade, lightness: number): TileShade {
  const change = clampShade(Math.round(lightness)) - lightnessOfShade(shade);
  return { r: clampShade(shade.r + change), g: clampShade(shade.g + change), b: clampShade(shade.b + change) };
}
