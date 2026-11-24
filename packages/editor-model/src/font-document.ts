import {
  FONT_GLYPH_COUNT,
  FONT_GLYPH_HEIGHT,
  FONT_GLYPH_WIDTH,
  FONT_MAGIC,
  FONT_SUBVERSION,
  FONT_TOTAL_VALUES,
  FONT_VERSION,
  ok,
  readLegacyFont,
  utf8Encode,
  writeLegacyFont,
  type LegacyFont,
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
 * The bitmap font document (`docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text`, T-65, ADR 0026): the
 * file's bytes plus a command stack over the `LegacyFont` the core reader returns. A Toolkit 2 font is text, but its
 * format has a same-version writer, so it follows the first row of ADR 0022 D2: `editor-model` owns the bytes and the
 * commands. The model keeps all 2048 stored rows and the version, so `writeLegacyFont` puts back every row a command
 * did not touch. A file the writer does not reproduce byte for byte opens read-only (ADR 0022 D2.1).
 */

/** The number of character slots, and the side of one glyph, re-stated for views that read only `editor-model`. */
export const FONT_SLOTS = FONT_GLYPH_COUNT;
export const FONT_GLYPH_SIDE = FONT_GLYPH_WIDTH;

/** One pixel of a glyph: column `x`, row `y` (0 to 7 each, top left first), set to ink or cleared. */
export interface FontPixelChange {
  readonly x: number;
  readonly y: number;
  readonly ink: boolean;
}

/**
 * Draw or erase pixels of one character's glyph. A stroke is one command with every cell it passed over, so one Undo
 * takes the whole stroke back; because the pixels are applied to the glyph as it is now, another view of the same font
 * editing other pixels of the same glyph keeps its work. A keyboard action is one command with one pixel.
 */
export interface SetFontPixelsCommand {
  readonly type: "set-font-pixels";
  /** The character code, 0 to 255. */
  readonly glyph: number;
  /** The pixels to set, each to ink or to empty; a repeated pixel keeps its last mark. */
  readonly pixels: readonly FontPixelChange[];
}

/** Empty one character's whole glyph. Clear glyph is its own intent, so it is its own command. */
export interface ClearFontGlyphCommand {
  readonly type: "clear-font-glyph";
  /** The character code, 0 to 255. */
  readonly glyph: number;
}

/** Every command a bitmap font document accepts. Plain data, so a stack of them can be stored and replayed. */
export type FontCommand = SetFontPixelsCommand | ClearFontGlyphCommand;

/**
 * What a bitmap font adds to the shared snapshot: plain JSON a view draws from and a host posts to a webview. `values`
 * are the 2048 stored rows, glyph `c` row `r` at `c * 8 + r`. The array is cached per model, so an unchanged font gives
 * the same reference.
 */
export interface FontDocumentFields {
  readonly version: number;
  readonly subversion: number;
  readonly values: readonly number[];
}

export type FontDocumentSnapshot = DocumentSnapshot<FontCommand> & FontDocumentFields;
export type FontDocument = EditorDocument<FontDocumentSnapshot, FontCommand>;
export type FontOpenResult = GenericOpenResult<FontDocument>;

const isGlyph = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < FONT_GLYPH_COUNT;

const isSide = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < FONT_GLYPH_WIDTH;
const isPixel = (value: unknown): boolean => typeof value === "object" && value !== null
  && "x" in value && isSide(value.x) && "y" in value && isSide(value.y)
  && "ink" in value && typeof value.ink === "boolean";
/**
 * Whether every entry of an array is a defined member. A sparse array's holes are skipped by `every`, so a
 * `new Array(8)` would otherwise pass as eight pixels and then clear the glyph when applied.
 */
const everyDefined = <T>(values: readonly T[], accept: (value: T) => boolean): boolean => {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || !accept(value)) return false;
  }
  return true;
};

/** The reason a command cannot be applied to any font, or `null` when it has the right shape. */
function shapeProblem(command: FontCommand): string | null {
  if (!isGlyph(command.glyph)) return `A character is a whole number from 0 to ${FONT_GLYPH_COUNT - 1}.`;
  if (command.type === "clear-font-glyph") return null;
  if (!Array.isArray(command.pixels) || command.pixels.length === 0) return "A stroke changes at least one pixel.";
  if (!everyDefined(command.pixels, (pixel: unknown) => isPixel(pixel))) return `A pixel is a column and a row from 0 to ${FONT_GLYPH_WIDTH - 1} and whether it is ink.`;
  return null;
}

/** Whether the glyph of `model` already looks exactly as these pixels would leave it. */
function samePixels(model: LegacyFont, command: SetFontPixelsCommand): boolean {
  // The rows as they end, not each pixel against the original: `[ink(x,y), erase(x,y)]` leaves the glyph as it was, and that
  // is not an edit (an intermediate comparison would record a no-op as a change).
  const rows = fontGlyphRows(model.values, command.glyph);
  const after = fontRowsAfter(rows, command);
  return after.every((row, index) => row === rows[index]);
}

function apply(model: LegacyFont, command: FontCommand): LegacyFont {
  if (shapeProblem(command) !== null) return model;
  // A command that changes nothing returns the very same model, so `refuse` can tell it apart and no edit is recorded.
  if (command.type === "clear-font-glyph") {
    if (fontGlyphRows(model.values, command.glyph).every((row) => row === 0)) return model;
  } else if (samePixels(model, command)) {
    return model;
  }
  const base = command.glyph * FONT_GLYPH_HEIGHT;
  const values = model.values.slice();
  if (command.type === "clear-font-glyph") {
    values.fill(0, base, base + FONT_GLYPH_HEIGHT);
  } else {
    for (let index = 0; index < command.pixels.length; index += 1) {
      const pixel = command.pixels[index]!;
      const bit = 1 << (FONT_GLYPH_WIDTH - 1 - pixel.x);
      const row = values[base + pixel.y] ?? 0;
      values[base + pixel.y] = pixel.ink ? (row | bit) & 0xff : row & ~bit & 0xff;
    }
  }
  return { ...model, values };
}

/** `rows` with `command` applied, for a view's own preview before the host has answered; it never mutates `rows`. */
export function fontRowsAfter(rows: readonly number[], command: FontCommand): number[] {
  const next = rows.slice();
  if (command.type === "clear-font-glyph") return next.map(() => 0);
  if (shapeProblem(command) !== null) return next;
  for (let index = 0; index < command.pixels.length; index += 1) {
    const pixel = command.pixels[index]!;
    next[pixel.y] = fontRowsWithPixel(next, pixel.x, pixel.y, pixel.ink)[pixel.y] ?? 0;
  }
  return next;
}

/** Every cell of the 8 × 8 grid a straight stroke from `(fromX, fromY)` to `(toX, toY)` passes through, in order. */
export function fontLinePixels(fromX: number, fromY: number, toX: number, toY: number): { readonly x: number; readonly y: number }[] {
  const cells: { x: number; y: number }[] = [];
  let x = fromX;
  let y = fromY;
  const dx = Math.abs(toX - fromX);
  const dy = -Math.abs(toY - fromY);
  const sx = fromX < toX ? 1 : -1;
  const sy = fromY < toY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    if (x >= 0 && y >= 0 && x < FONT_GLYPH_WIDTH && y < FONT_GLYPH_HEIGHT) cells.push({ x, y });
    if (x === toX && y === toY) return cells;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

/** The character a slot shows in a label, or `null` for one with no printable shape (controls, the soft hyphen, the C1 block). */
export function fontCharacterOf(code: number): string | null {
  if ((code >= 32 && code <= 126) || (code >= 161 && code <= 255 && code !== 173)) return String.fromCodePoint(code);
  return null;
}

/** How a slot is named in words: its code and, when it has one, its character. */
export function fontSlotName(code: number): string {
  const character = fontCharacterOf(code);
  return character === null ? `character ${code}` : `character ${code} (“${character}”)`;
}

function refuse(next: LegacyFont, command: FontCommand, previous: LegacyFont): Rejection | null {
  const problem = shapeProblem(command);
  if (problem !== null) return { reason: "invalid", message: problem };
  if (next !== previous) return null;
  if (command.type === "clear-font-glyph") return { reason: "invalid", message: `The glyph of ${fontSlotName(command.glyph)} is already empty.` };
  return { reason: "invalid", message: `Those pixels of ${fontSlotName(command.glyph)} already look like that.` };
}

function readOnlyReason(model: LegacyFont, bytes: Uint8Array): ReadOnlyReason | null {
  const first = firstDifference(utf8Encode(writeLegacyFont(model)), bytes);
  if (first === null) return null;
  return {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this font byte for byte; the first difference is at offset ${first}. It is shown, never converted.`,
  };
}

const valueCache = new WeakMap<Uint8Array, readonly number[]>();

/** The rows of `glyph` in a snapshot's `values`, top row first. */
export function fontGlyphRows(values: ArrayLike<number>, glyph: number): number[] {
  const rows: number[] = [];
  for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) rows.push(values[glyph * FONT_GLYPH_HEIGHT + row] ?? 0);
  return rows;
}

/** Whether the pixel at column `x`, row `y` (0 to 7 each, top left first) of a glyph's rows is ink. */
export function fontPixelOf(rows: readonly number[], x: number, y: number): boolean {
  return (((rows[y] ?? 0) >> (FONT_GLYPH_WIDTH - 1 - x)) & 1) === 1;
}

/** The rows with the pixel at `(x, y)` set to ink or cleared, leaving every other pixel as it was. */
export function fontRowsWithPixel(rows: readonly number[], x: number, y: number, ink: boolean): number[] {
  const bit = 1 << (FONT_GLYPH_WIDTH - 1 - x);
  return rows.map((row, index) => (index === y ? (ink ? row | bit : row & ~bit & 0xff) : row));
}

/** How many of a font's 256 glyphs have any ink. */
export function inkedGlyphCount(values: ArrayLike<number>): number {
  let count = 0;
  for (let glyph = 0; glyph < FONT_GLYPH_COUNT; glyph += 1) {
    for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) {
      if ((values[glyph * FONT_GLYPH_HEIGHT + row] ?? 0) !== 0) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/** The bitmap font codec. */
export const fontCodec: DocumentCodec<LegacyFont, FontCommand, FontDocumentFields> = {
  kind: "font",
  read: (bytes, path) => readLegacyFont(bytes, path),
  write: (model) => ok(utf8Encode(writeLegacyFont(model))),
  readOnlyReason,
  isCommand: (value): value is FontCommand => {
    if (typeof value !== "object" || value === null || !("type" in value) || !("glyph" in value) || typeof value.glyph !== "number") return false;
    if (value.type === "clear-font-glyph") return true;
    if (value.type !== "set-font-pixels" || !("pixels" in value) || !Array.isArray(value.pixels)) return false;
    return everyDefined(value.pixels, (pixel: unknown) => typeof pixel === "object" && pixel !== null
      && "x" in pixel && typeof pixel.x === "number" && "y" in pixel && typeof pixel.y === "number"
      && "ink" in pixel && typeof pixel.ink === "boolean");
  },
  apply,
  label: (command) => {
    if (command.type === "clear-font-glyph") return `Clear ${fontSlotName(command.glyph)}`;
    const ink = command.pixels.some((pixel) => pixel.ink);
    const count = command.pixels.length;
    return `${ink ? "Draw" : "Erase"} ${count} pixel${count === 1 ? "" : "s"} of ${fontSlotName(command.glyph)}`;
  },
  refuse,
  summary: (model) => `Bitmap font, ${inkedGlyphCount(model.values)} of ${FONT_GLYPH_COUNT} characters drawn`,
  fields: (model) => {
    let values = valueCache.get(model.values);
    if (values === undefined) {
      values = Array.from(model.values);
      valueCache.set(model.values, values);
    }
    return { version: model.version, subversion: model.subversion, values };
  },
};

/** Read the bitmap font at `identity.path` through `storage` and open it. */
export function openFontDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<FontOpenResult> {
  return openBinaryDocument(fontCodec, storage, identity);
}

/** Open a bitmap font document over bytes already in hand. */
export function createFontDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): FontOpenResult {
  return createBinaryDocument(fontCodec, storage, identity, bytes);
}

/** The bytes of a new font: version 2.0 with all 256 glyphs empty. */
export function newFontBytes(): Uint8Array {
  return utf8Encode(writeLegacyFont({ magic: FONT_MAGIC, version: FONT_VERSION, subversion: FONT_SUBVERSION, values: new Uint8Array(FONT_TOTAL_VALUES) }));
}
