import { DOS_PALETTE, err, expandTileToRgba, readTileset, writeTileset, type Tileset, type TilesetTile } from "@tk-reawakened/core";
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

export interface TilesetArtTile {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA bytes: (y * width + x) * 4. */
  readonly pixels: readonly number[];
}

export interface TilesetPixelChange {
  readonly x: number;
  readonly y: number;
  readonly rgba: readonly [number, number, number, number];
}

export interface PaintTilesetPixelsCommand {
  readonly type: "paint-tileset-pixels";
  /** Zero-based tile index. */
  readonly tile: number;
  readonly changes: readonly TilesetPixelChange[];
}

export type TilesetArtCommand = PaintTilesetPixelsCommand;

export interface TilesetArtFields {
  readonly tiles: readonly TilesetArtTile[];
}

export type TilesetArtSnapshot = DocumentSnapshot<TilesetArtCommand> & TilesetArtFields;
export type TilesetArtDocument = EditorDocument<TilesetArtSnapshot, TilesetArtCommand>;
export type TilesetArtOpenResult = GenericOpenResult<TilesetArtDocument>;

const derivedTiles = new WeakMap<TilesetTile, Map<number, TilesetArtTile>>();
const derivedFields = new WeakMap<Tileset, TilesetArtFields>();
const paletteIndices = new Map<number, ReadonlyMap<number, number>>();

function tileView(model: Tileset, tileIndex: number): TilesetArtTile | undefined {
  const stored = model.tiles[tileIndex];
  if (stored === undefined) return undefined;
  let bySize = derivedTiles.get(stored);
  if (bySize === undefined) {
    bySize = new Map();
    derivedTiles.set(stored, bySize);
  }
  const size = model.detail.size;
  const cached = bySize.get(size);
  if (cached !== undefined) return cached;
  const expanded = expandTileToRgba(model, tileIndex);
  if (!expanded.ok) return undefined;
  const pixels = new Array<number>(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const from = (x * size + y) * 4;
      const to = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) pixels[to + channel] = expanded.value[from + channel]!;
    }
  }
  const view = { width: size, height: size, pixels };
  bySize.set(size, view);
  return view;
}

function fields(model: Tileset): TilesetArtFields {
  const cached = derivedFields.get(model);
  if (cached !== undefined) return cached;
  const result: TilesetArtFields = {
    tiles: model.tiles.map((_, index) => {
      const view = tileView(model, index);
      if (view === undefined) throw new Error(`Could not expand tileset tile ${index}.`);
      return view;
    }),
  };
  derivedFields.set(model, result);
  return result;
}

function paletteIndexMap(limit: 16 | 255): ReadonlyMap<number, number> {
  const existing = paletteIndices.get(limit);
  if (existing !== undefined) return existing;
  const entries = new Map<number, number>();
  for (let index = 0; index < limit; index += 1) {
    const at = index * 3;
    const key = (DOS_PALETTE[at]! << 16) | (DOS_PALETTE[at + 1]! << 8) | DOS_PALETTE[at + 2]!;
    if (!entries.has(key)) entries.set(key, index);
  }
  paletteIndices.set(limit, entries);
  return entries;
}

function paint(model: Tileset, command: PaintTilesetPixelsCommand): Tileset {
  if (!Number.isInteger(command.tile) || command.tile < 0 || command.tile >= model.tiles.length) return model;
  const { size, bytesPerPixel } = model.detail;
  const palette = bytesPerPixel === 1 ? paletteIndexMap(model.detail.code >= 5 ? 16 : 255) : undefined;
  for (const change of command.changes) {
    const [r, g, b, a] = change.rgba;
    if (!Number.isInteger(change.x) || !Number.isInteger(change.y) || change.x < 0 || change.y < 0 || change.x >= size || change.y >= size
      || a !== 0 && a !== 255) return model;
    if (a === 255 && bytesPerPixel === 3 && r === 0 && g === 1 && b === 2) return model;
    if (a === 255 && bytesPerPixel === 1 && !palette!.has((r << 16) | (g << 8) | b)) return model;
  }
  const original = model.tiles[command.tile]!.pixels;
  const view = tileView(model, command.tile);
  if (view === undefined) return model;
  const latest = new Map<number, TilesetPixelChange>();
  for (const change of command.changes) latest.set(change.y * size + change.x, change);
  let pixels: Uint8Array | undefined;
  for (const [position, change] of latest) {
    const color = change.rgba;
    const displayAt = position * 4;
    if (view.pixels[displayAt + 3] === color[3]
      && (color[3] === 0 || (view.pixels[displayAt] === color[0] && view.pixels[displayAt + 1] === color[1] && view.pixels[displayAt + 2] === color[2]))) continue;
    const storedPosition = change.x * size + change.y;
    const offset = storedPosition * bytesPerPixel;
    if (bytesPerPixel === 3) {
      const transparent = color[3] === 0;
      if (pixels === undefined) pixels = original.slice();
      pixels[offset] = transparent ? 0 : color[0];
      pixels[offset + 1] = transparent ? 1 : color[1];
      pixels[offset + 2] = transparent ? 2 : color[2];
    } else {
      const value = color[3] === 0 ? 255 : palette!.get((color[0] << 16) | (color[1] << 8) | color[2]);
      if (value === undefined) continue;
      if (pixels === undefined) pixels = original.slice();
      pixels[offset] = value;
    }
  }
  if (pixels === undefined) return model;
  const tiles = model.tiles.slice();
  tiles[command.tile] = { pixels };
  return { ...model, tiles };
}

function refuse(next: Tileset, command: PaintTilesetPixelsCommand, previous: Tileset): Rejection | null {
  const tile = previous.tiles[command.tile];
  const size = previous.detail.size;
  // Bounds are checked for the complete gesture before any colour representability refusal.
  for (const change of command.changes) {
    if (!Number.isInteger(change.x) || !Number.isInteger(change.y) || change.x < 0 || change.y < 0 || change.x >= size || change.y >= size) {
      return { reason: "invalid", message: `Pixel column ${change.x}, row ${change.y} is outside the ${size}×${size} tile.` };
    }
  }
  if (!Number.isInteger(command.tile) || command.tile < 0 || tile === undefined) {
    return { reason: "invalid", message: `Tile index ${command.tile} is outside the tileset.` };
  }
  if (command.changes.length === 0) return { reason: "invalid", message: "A paint gesture must contain at least one pixel." };
  for (const change of command.changes) {
    const [r, g, b, a] = change.rgba;
    for (let index = 0; index < 4; index += 1) {
      const channel = change.rgba[index]!;
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        return { reason: "invalid", message: "Pixel RGBA channels must be integer bytes." };
      }
    }
    if (a !== 0 && a !== 255) return { reason: "invalid", message: "TST pixels cannot represent partial alpha." };
    if (a === 255 && previous.detail.bytesPerPixel === 3 && r === 0 && g === 1 && b === 2) {
      return { reason: "invalid", message: "Opaque RGB(0, 1, 2) is the TST transparency key." };
    }
    if (a === 255 && previous.detail.bytesPerPixel === 1) {
      const limit = previous.detail.code >= 5 ? 16 : 255;
      if (!paletteIndexMap(limit).has((r << 16) | (g << 8) | b)) {
        return { reason: "invalid", message: `RGB(${r}, ${g}, ${b}) is not an opaque color in detail ${previous.detail.code}'s palette.` };
      }
    }
  }
  if (next === previous || tile === undefined) return { reason: "invalid", message: "The gesture does not change any tile pixels." };
  return null;
}

function readOnlyReason(model: Tileset, bytes: Uint8Array): ReadOnlyReason | null {
  const written = writeTileset(model);
  if (!written.ok) return { code: "no-same-version-writer", message: `This tileset has no same-version writer: ${written.error.message}` };
  const first = firstDifference(written.value, bytes);
  return first === null ? null : {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this tileset byte for byte; the first difference is at offset ${first}.`,
  };
}

function isCommand(value: unknown): value is TilesetArtCommand {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "paint-tileset-pixels"
    || !("tile" in value) || typeof value.tile !== "number" || !Number.isInteger(value.tile)
    || !("changes" in value) || !Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 1024) return false;
  for (let i = 0; i < value.changes.length; i += 1) {
    if (!(i in value.changes)) return false;
    const change = value.changes[i];
    if (typeof change !== "object" || change === null || !("x" in change) || typeof change.x !== "number" || !Number.isInteger(change.x)
      || !("y" in change) || typeof change.y !== "number" || !Number.isInteger(change.y)
      || !("rgba" in change) || !Array.isArray(change.rgba) || change.rgba.length !== 4) return false;
    for (let channel = 0; channel < 4; channel += 1) {
      const component: unknown = change.rgba[channel];
      if (!(channel in change.rgba) || typeof component !== "number" || !Number.isInteger(component) || component < 0 || component > 255) return false;
    }
  }
  return true;
}

export const tilesetArtCodec: DocumentCodec<Tileset, TilesetArtCommand, TilesetArtFields> = {
  kind: "tileset",
  read: (bytes, path) => {
    const read = readTileset(bytes, path);
    if (!read.ok) return read;
    if (read.value.version !== 20 || read.value.detail.isometric) {
      return err({
        ...(path === "" ? {} : { path }),
        offset: read.value.version !== 20 ? 0 : 4,
        section: "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso",
        message: "Tileset art documents accept only regular version-20 .tst files with details 1–6.",
      });
    }
    return read;
  },
  write: writeTileset,
  readOnlyReason,
  isCommand,
  apply: paint,
  label: (command) => `Paint ${command.changes.length} pixel${command.changes.length === 1 ? "" : "s"} on tile ${command.tile + 1}`,
  refuse,
  summary: (model) => `${model.tiles.length} ${model.tiles.length === 1 ? "tile" : "tiles"}, detail ${model.detail.code}`,
  fields,
};

export function openTilesetArtDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<TilesetArtOpenResult> {
  return openBinaryDocument(tilesetArtCodec, storage, identity);
}

export function createTilesetArtDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): TilesetArtOpenResult {
  return createBinaryDocument(tilesetArtCodec, storage, identity, bytes);
}
