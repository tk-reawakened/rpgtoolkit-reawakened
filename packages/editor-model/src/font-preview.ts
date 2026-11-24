import {
  assetKey,
  emitText,
  FONT_MAGIC,
  FONT_SUBVERSION,
  FONT_TOTAL_VALUES,
  FONT_VERSION,
  layoutText,
  rasterize,
  type DrawList,
  type FontRef,
  type LegacyFont,
  type Rgb,
} from "@tk-reawakened/core";

/**
 * The sample-text picture of a bitmap font (T-65, `docs/spec/engine/display-input-audio.md#reawakened-bitmap-font-ink`).
 * It is not a second renderer: the text is laid out and emitted as the engine's `text()` does (`emitText`, each line one
 * size tall) and the resulting draw list is replayed by the core's reference rasteriser, the same functions a runner's
 * pixels come from. The size, the style switches and the sample are view settings of the caller; nothing here reads or
 * changes a document.
 */

/** The size range of the preview, in pixels (the engine itself accepts 1 to 256). */
export const FONT_PREVIEW_MIN_SIZE = 1;
export const FONT_PREVIEW_MAX_SIZE = 128;
/** The most characters of sample text drawn, so a pasted page cannot ask for an enormous picture. */
export const FONT_PREVIEW_MAX_TEXT = 200;
/** A line wraps at words once it would be wider than this many pixels. */
export const FONT_PREVIEW_WRAP_WIDTH = 512;
/** The sample a preview starts with. */
export const FONT_PREVIEW_SAMPLE = "The quick brown fox jumps over the lazy dog 0123456789";

export const FONT_PREVIEW_INK: Rgb = { r: 255, g: 255, b: 255 };
export const FONT_PREVIEW_BACKGROUND: Rgb = { r: 24, g: 24, b: 32 };
/** Blank pixels around the text. */
const PADDING = 4;

export interface FontPreviewOptions {
  readonly text: string;
  /** Whole pixels from `FONT_PREVIEW_MIN_SIZE` to `FONT_PREVIEW_MAX_SIZE`. */
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

/** The picture, straight RGBA with an opaque background, or why none could be made. */
export type FontPicture =
  | { readonly ok: true; readonly width: number; readonly height: number; readonly rgba: Uint8Array }
  | { readonly ok: false; readonly message: string };

const PREVIEW_ASSET = assetKey("font/preview.fnt");
const fonts = new WeakMap<ArrayLike<number>, LegacyFont>();

function fontOf(values: ArrayLike<number>): LegacyFont {
  let font = fonts.get(values);
  if (font === undefined) {
    const stored = new Uint8Array(FONT_TOTAL_VALUES);
    for (let index = 0; index < FONT_TOTAL_VALUES; index += 1) stored[index] = (values[index] ?? 0) & 0xff;
    font = { magic: FONT_MAGIC, version: FONT_VERSION, subversion: FONT_SUBVERSION, values: stored };
    fonts.set(values, font);
  }
  return font;
}

/** Whether `options` are inside what the preview draws; the reason when they are not. */
export function fontPreviewProblem(options: FontPreviewOptions): string | null {
  if (!Number.isInteger(options.size) || options.size < FONT_PREVIEW_MIN_SIZE || options.size > FONT_PREVIEW_MAX_SIZE) {
    return `The preview size is a whole number from ${FONT_PREVIEW_MIN_SIZE} to ${FONT_PREVIEW_MAX_SIZE} pixels.`;
  }
  if (Array.from(options.text).length > FONT_PREVIEW_MAX_TEXT) return `The sample is at most ${FONT_PREVIEW_MAX_TEXT} characters.`;
  return null;
}

/**
 * Draw `options.text` with the font whose 2048 stored rows are `values`, white on a dark ground, at 1:1 scale. Each
 * glyph is the font's own 8 × 8 cell stretched to `size` with hard edges, so the picture can be enlarged without
 * smoothing and still be the pixels the game draws.
 */
export function previewFontText(values: ArrayLike<number>, options: FontPreviewOptions): FontPicture {
  const problem = fontPreviewProblem(options);
  if (problem !== null) return { ok: false, message: problem };
  const ref: FontRef = { asset: PREVIEW_ASSET, size: options.size, bold: options.bold, italic: options.italic };
  // `text()` lays a line out one size tall; the layout and the emitted commands must agree, so both are given the same options.
  const layout = { lineHeight: options.size, maxWidth: FONT_PREVIEW_WRAP_WIDTH };
  const measured = layoutText(options.text, ref, layout);
  // Italics lean the top row right of its advance by `floor(7 * size / 32)`.
  const lean = options.italic ? Math.floor((7 * options.size) / 32) : 0;
  const width = Math.max(1, measured.width + lean + 2 * PADDING);
  const height = Math.max(options.size, measured.height) + 2 * PADDING;
  const list: DrawList = {
    protocolVersion: 3,
    tick: 0,
    width,
    height,
    commands: [
      { kind: "fill", rgb: FONT_PREVIEW_BACKGROUND },
      ...emitText(options.text, PADDING, PADDING, FONT_PREVIEW_INK, ref, { ...layout, underline: options.underline }),
    ],
    marginCommands: [],
  };
  const drawn = rasterize(list, new Map([[PREVIEW_ASSET, fontOf(values)]]));
  return drawn.error === null ? { ok: true, width: drawn.width, height: drawn.height, rgba: drawn.rgba } : { ok: false, message: drawn.error };
}
