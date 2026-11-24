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

/**
 * Replace the eight rows of one character's glyph. A stroke, a keyboard toggle and Clear glyph are all this one
 * command, so one Undo takes any of them back whole. `rows` are the glyph's rows top first; bit 7 of a row is the
 * leftmost pixel and 1 is ink (the file's own order).
 */
export interface SetFontGlyphCommand {
  readonly type: "set-font-glyph";
  /** The character code, 0 to 255. */
  readonly glyph: number;
  /** Eight whole numbers, each 0 to 255. */
  readonly rows: readonly number[];
}

/** Every command a bitmap font document accepts. Plain data, so a stack of them can be stored and replayed. */
export type FontCommand = SetFontGlyphCommand;

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

const isRow = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
const isGlyph = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < FONT_GLYPH_COUNT;

/** The reason a command cannot be applied to any font, or `null` when it has the right shape. */
function shapeProblem(command: FontCommand): string | null {
  if (!isGlyph(command.glyph)) return `A character is a whole number from 0 to ${FONT_GLYPH_COUNT - 1}.`;
  if (!Array.isArray(command.rows) || command.rows.length !== FONT_GLYPH_HEIGHT || !command.rows.every(isRow)) {
    return `A glyph is ${FONT_GLYPH_HEIGHT} rows, each a whole number from 0 to 255.`;
  }
  return null;
}

function sameRows(model: LegacyFont, glyph: number, rows: readonly number[]): boolean {
  for (let row = 0; row < FONT_GLYPH_HEIGHT; row += 1) if (model.values[glyph * FONT_GLYPH_HEIGHT + row] !== rows[row]) return false;
  return true;
}

function apply(model: LegacyFont, command: FontCommand): LegacyFont {
  if (shapeProblem(command) !== null || sameRows(model, command.glyph, command.rows)) return model;
  const values = model.values.slice();
  values.set(command.rows, command.glyph * FONT_GLYPH_HEIGHT);
  return { ...model, values };
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
  return next === previous ? { reason: "invalid", message: `The glyph of ${fontSlotName(command.glyph)} already looks like that.` } : null;
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
    if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "set-font-glyph") return false;
    return "glyph" in value && typeof value.glyph === "number" && "rows" in value && Array.isArray(value.rows) && value.rows.every((row) => typeof row === "number");
  },
  apply,
  label: (command) => `${command.rows.every((row) => row === 0) ? "Clear" : "Edit"} ${fontSlotName(command.glyph)}`,
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
