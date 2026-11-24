// The bitmap font document (story 13.20, T-65): commands over the real reader and writer, with the expected bytes built by
// hand from the stored layout (`docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text`), never by the document
// under test, and the sample preview checked against the pixels the spec's bitmap rule gives.
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createDocumentIdentity,
  createFontFile,
  FONT_PREVIEW_BACKGROUND,
  FONT_PREVIEW_MAX_SIZE,
  fontCharacterOf,
  fontCodec,
  fontDestinationProblem,
  fontGlyphRows,
  fontLinePixels,
  fontRowsAfter,
  fontPixelOf,
  fontRowsWithPixel,
  fontSlotName,
  inkedGlyphCount,
  kindForPath,
  newFontBytes,
  openFontDocument,
  previewFontText,
  suggestFontPath,
  type FontCommand,
  type FontDocument,
} from "../src/index.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PATH = "Font/retro.fnt";
const identity = createDocumentIdentity("memory-project", PATH);
const encoder = new TextEncoder();

/** The file's text, written from the spec's sentences: three header lines, then 2048 values each as ` n `, CRLF-separated. */
function fontText(rows: (glyph: number, row: number) => number, header: readonly string[] = ["RPGTLKIT FONT", "2", "0"]): string {
  const lines = [...header];
  for (let glyph = 0; glyph < 256; glyph += 1) for (let row = 0; row < 8; row += 1) lines.push(` ${rows(glyph, row)} `);
  return `${lines.join("\r\n")}\r\n`;
}

/** Each glyph's rows are a recognisable function of its code, so a row that moved or was lost shows. */
const original = (glyph: number, row: number): number => (glyph * 7 + row * 31) % 256;
const ORIGINAL = encoder.encode(fontText(original));

async function open(bytes: Uint8Array = ORIGINAL): Promise<{ readonly host: MemoryPlatformServices; readonly doc: FontDocument }> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openFontDocument(host.fs, identity);
  ok(opened.ok, "the font opens");
  return { host, doc: opened.document };
}

/** The pixels that turn `rows` into the glyph: every set bit of the row list, as one stroke. */
const pixelsFor = (glyph: number, rows: readonly number[]): FontCommand => ({
  type: "set-font-pixels",
  glyph,
  pixels: rows.flatMap((row, y) => Array.from({ length: 8 }, (_, x) => x).filter((x) => ((row >> (7 - x)) & 1) === 1).map((x) => ({ x, y, ink: true }))),
});
/** The pixels that clear every set bit of `rows`. */
const eraseFor = (glyph: number, rows: readonly number[]): FontCommand => ({
  type: "set-font-pixels",
  glyph,
  pixels: rows.flatMap((row, y) => Array.from({ length: 8 }, (_, x) => x).filter((x) => ((row >> (7 - x)) & 1) === 1).map((x) => ({ x, y, ink: false }))),
});
const clear = (glyph: number): FontCommand => ({ type: "clear-font-glyph", glyph });
const draw = pixelsFor;

test("the font kind claims .fnt, and an unedited font round-trips byte for byte, including the file the spec cites and the bundled default", async () => {
  equal(kindForPath("Font/retro.FNT")?.id, "font");
  for (const bytes of [
    ORIGINAL,
    new Uint8Array(readFileSync(join(repo, "docs", "spec", "examples", "versions", "font", "base.fnt"))),
    new Uint8Array(readFileSync(join(repo, "media", "fonts", "tkr-8x8.fnt"))),
  ]) {
    const { host, doc } = await open(bytes);
    equal(doc.kind, "font");
    equal(doc.getSnapshot().readOnly, null, "the writer reproduces the file, so it opens read-write");
    deepEqual(doc.serialize(), bytes);
    ok((await doc.save()).ok);
    deepEqual(host.bytesOf(PATH), bytes);
  }
});

test("the snapshot is plain JSON of the 2048 stored rows, shared while the font is unchanged", async () => {
  const { doc } = await open();
  const snapshot = doc.getSnapshot();
  equal(snapshot.values.length, 2048);
  equal(snapshot.version, 2);
  equal(snapshot.subversion, 0);
  deepEqual(fontGlyphRows(snapshot.values, 65), [0, 1, 2, 3, 4, 5, 6, 7].map((row) => original(65, row)));
  deepEqual(JSON.parse(JSON.stringify(snapshot.values)), [...snapshot.values]);
  ok(doc.apply(draw(65, [0x81, 0, 0, 0, 0, 0, 0, 0x81])).ok);
  const edited = doc.getSnapshot();
  notEqual(edited.values, snapshot.values);
  ok(doc.undo().ok);
  deepEqual([...doc.getSnapshot().values], [...snapshot.values]);
});

test("pixels at opposite corners of two glyphs are saved as the rows the format stores, and every untouched glyph keeps its rows", async () => {
  const { host, doc } = await open();
  // Bit 7 is the leftmost pixel: the top-left and bottom-right corners of glyph 65, the top-right and bottom-left of glyph 200.
  ok(doc.apply(draw(65, [0x80, 0, 0, 0, 0, 0, 0, 0x01])).ok);
  ok(doc.apply(draw(200, [0x01, 0, 0, 0, 0, 0, 0, 0x80])).ok);
  equal(doc.getSnapshot().dirty, true);
  deepEqual(host.bytesOf(PATH), ORIGINAL, "nothing is written before Save");
  ok((await doc.save()).ok);
  // A stroke adds ink to the glyph as it is, so each corner pixel is OR-ed into the row the file already held.
  const expected = fontText((glyph, row) => {
    if (glyph === 65) return original(glyph, row) | (row === 0 ? 0x80 : row === 7 ? 0x01 : 0);
    if (glyph === 200) return original(glyph, row) | (row === 0 ? 0x01 : row === 7 ? 0x80 : 0);
    return original(glyph, row);
  });
  deepEqual(host.bytesOf(PATH), encoder.encode(expected), "exactly two glyphs changed, their other pixels kept");
  const reopened = await openFontDocument(host.fs, identity);
  ok(reopened.ok);
  equal(reopened.document.getSnapshot().dirty, false);
  deepEqual(fontGlyphRows(reopened.document.getSnapshot().values, 65), [0x80, 0, 0, 0, 0, 0, 0, 0x01].map((row, index) => row | original(65, index)));
  deepEqual(fontGlyphRows(reopened.document.getSnapshot().values, 66), [0, 1, 2, 3, 4, 5, 6, 7].map((row) => original(66, row)), "an untouched glyph is intact");
});

test("undo and redo take one glyph edit back and forward whole, and each edit is named by its character", async () => {
  const { doc } = await open();
  const before = [...doc.getSnapshot().values];
  const saved = fontGlyphRows(doc.getSnapshot().values, 65);
  const drawn = fontRowsAfter(saved, draw(65, [0xff, 0xff, 0, 0, 0, 0, 0, 0]));
  const first = doc.apply(draw(65, [0xff, 0xff, 0, 0, 0, 0, 0, 0]));
  ok(first.ok);
  equal(doc.getSnapshot().edits.at(-1)?.label, "Draw 16 pixels of character 65 (“A”)");
  const cleared = doc.apply(clear(65));
  ok(cleared.ok);
  equal(doc.getSnapshot().edits.at(-1)?.label, "Clear character 65 (“A”)");
  ok(doc.undo().ok);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), drawn);
  ok(doc.undo().ok);
  deepEqual([...doc.getSnapshot().values], before);
  equal(doc.getSnapshot().dirty, false, "back at the saved state");
  ok(doc.redo().ok);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), drawn, "redo puts the stroke back over the saved glyph");
  equal(doc.getSnapshot().dirty, true);
});

test("a stroke with no pixel, a pixel outside the cell, a sparse pixel list or a no-op is refused, and the snapshot is the very same", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot();
  const rows = fontGlyphRows(before.values, 10);
  const sparse = new Array(8);
  const bad: unknown[] = [
    { type: "set-font-pixels", glyph: 256, pixels: [{ x: 0, y: 0, ink: true }] },
    { type: "set-font-pixels", glyph: -1, pixels: [{ x: 0, y: 0, ink: true }] },
    { type: "set-font-pixels", glyph: 1.5, pixels: [{ x: 0, y: 0, ink: true }] },
    { type: "set-font-pixels", glyph: 10, pixels: [] },
    { type: "set-font-pixels", glyph: 10, pixels: [{ x: 8, y: 0, ink: true }] },
    { type: "set-font-pixels", glyph: 10, pixels: [{ x: 0, y: 8, ink: true }] },
    { type: "set-font-pixels", glyph: 10, pixels: [{ x: 0, y: 0, ink: "yes" }] },
    // A sparse list has holes where its pixels should be: `every` skips them, so a strict check must not.
    { type: "set-font-pixels", glyph: 10, pixels: sparse },
    { type: "clear-font-glyph", glyph: 256 },
  ];
  for (const command of bad) {
    const result = doc.apply(command as never);
    ok(!result.ok, JSON.stringify(command));
    equal(result.rejection.reason, "invalid");
    ok(result.rejection.message.length > 0);
  }
  // The pixels of glyph 10 as it already is: nothing to change.
  const ink = rows.flatMap((row, y) => Array.from({ length: 8 }, (_, x) => x).filter((x) => ((row >> (7 - x)) & 1) === 1).map((x) => ({ x, y, ink: true })));
  const same = doc.apply({ type: "set-font-pixels", glyph: 10, pixels: ink });
  ok(!same.ok);
  match(same.rejection.message, /already look like that/);
  // A glyph is cleared only once: the second clear is refused, not recorded.
  const emptied = doc.apply({ type: "clear-font-glyph", glyph: 10 });
  ok(emptied.ok);
  const again = doc.apply({ type: "clear-font-glyph", glyph: 10 });
  ok(!again.ok);
  match(again.rejection.message, /already empty/);
  ok(doc.undo().ok);
  equal(doc.getSnapshot().edits.length, 0);
  deepEqual([...doc.getSnapshot().values], [...before.values], "nothing changed by the refusals");
});

test("a stroke that marks then erases one cell leaves the glyph unchanged, so no edit is recorded", async () => {
  const { doc } = await open(newFontBytes());
  const before = doc.getSnapshot();
  // A drag that passes a cell and comes back: its pixels carry both directions, and the rows it ends on are the rows it began on.
  const result = doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 3, y: 3, ink: true }, { x: 3, y: 3, ink: false }] });
  ok(!result.ok);
  match(result.rejection.message, /already look like that/);
  equal(doc.getSnapshot().edits.length, 0, "no edit was recorded");
  deepEqual(doc.getSnapshot().values, before.values, "the rows are the rows it began on");
  equal(doc.getSnapshot().dirty, false);
});

test("two strokes from a stale copy of the glyph keep each other's pixels, and one stroke is one edit", async () => {
  const { doc } = await open(newFontBytes());
  const stale = fontGlyphRows(doc.getSnapshot().values, 65);
  equal(stale.every((row) => row === 0), true, "the empty glyph a second view read");
  // A second view read the glyph before the first stroke landed, so both would send whole rows from `stale`.
  ok(doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 1, y: 1, ink: true }] }).ok);
  ok(doc.apply({ type: "set-font-pixels", glyph: 65, pixels: [{ x: 6, y: 6, ink: true }] }).ok);
  const rows = fontGlyphRows(doc.getSnapshot().values, 65);
  equal(fontPixelOf(rows, 1, 1), true, "the first stroke's pixel survives the second");
  equal(fontPixelOf(rows, 6, 6), true, "and the second is applied to what the glyph is now");
  equal(fontPixelOf(stale, 1, 1), false, "the stale copy it started from never had it");
  ok(doc.undo().ok);
  equal(fontPixelOf(fontGlyphRows(doc.getSnapshot().values, 65), 1, 1), true, "one Undo takes back one stroke");
  equal(fontPixelOf(fontGlyphRows(doc.getSnapshot().values, 65), 6, 6), false);
});

test("isCommand accepts only the shape a webview may send", () => {
  ok(fontCodec.isCommand({ type: "set-font-pixels", glyph: 3, pixels: [{ x: 0, y: 0, ink: true }] }));
  ok(fontCodec.isCommand({ type: "clear-font-glyph", glyph: 3 }));
  ok(!fontCodec.isCommand({ type: "set-font-pixels", glyph: "3", pixels: [] }));
  ok(!fontCodec.isCommand({ type: "set-font-pixels", glyph: 3, pixels: [{ x: 0, y: 0, ink: 1 }] }));
  ok(!fontCodec.isCommand({ type: "set-font-pixels", glyph: 3, pixels: new Array(8) }));
  ok(!fontCodec.isCommand({ type: "set-font-glyph", glyph: 3, rows: [0, 0, 0, 0, 0, 0, 0, 0] }));
  ok(!fontCodec.isCommand({ type: "other", glyph: 3 }));
  ok(!fontCodec.isCommand(null));
});

test("fontRowsAfter previews a command on the rows a view holds, without mutating them, and fontLinePixels interpolates a drag", () => {
  const rows = [0x80, 0, 0, 0, 0, 0, 0, 0];
  const after = fontRowsAfter(rows, { type: "set-font-pixels", glyph: 65, pixels: [{ x: 3, y: 2, ink: true }, { x: 0, y: 0, ink: false }] });
  deepEqual(after, [0x00, 0, 0x10, 0, 0, 0, 0, 0]);
  deepEqual(rows, [0x80, 0, 0, 0, 0, 0, 0, 0], "the rows a view holds are untouched");
  deepEqual(fontRowsAfter(rows, { type: "clear-font-glyph", glyph: 65 }), [0, 0, 0, 0, 0, 0, 0, 0]);
  deepEqual(fontLinePixels(0, 0, 3, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
  const diagonal = fontLinePixels(0, 0, 7, 7);
  deepEqual([diagonal[0], diagonal.at(-1)], [{ x: 0, y: 0 }, { x: 7, y: 7 }]);
  equal(diagonal.length, 8, "a diagonal passes one cell per row, none skipped");
  deepEqual(fontLinePixels(4, 4, 4, 4), [{ x: 4, y: 4 }], "a press with no move is one cell");
  const steep = fontLinePixels(0, 0, 1, 7);
  equal(steep.length, 8);
  for (let index = 1; index < steep.length; index += 1) {
    const previous = steep[index - 1]!;
    const cell = steep[index]!;
    equal(Math.abs(cell.x - previous.x) <= 1 && Math.abs(cell.y - previous.y) <= 1, true, "no gap between consecutive cells");
  }
});

test("a refused save keeps every glyph edit, still unsaved, and the next save writes them (ADR 0022 D3.3)", async () => {
  const { host, doc } = await open();
  const savedRows65 = fontGlyphRows(doc.getSnapshot().values, 65);
  ok(doc.apply(draw(65, [0xff, 0, 0, 0, 0, 0, 0, 0])).ok);
  host.failWrites({ code: "io-error", message: "the disk is full" });
  const refused = await doc.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "write");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), fontRowsAfter(savedRows65, draw(65, [0xff, 0, 0, 0, 0, 0, 0, 0])), "the edit is still in the document");
  deepEqual(host.bytesOf(PATH), ORIGINAL);
  host.failWrites(null);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().dirty, false);
  deepEqual(fontGlyphRows((await openFontDocument(host.fs, identity) as { document: FontDocument }).document.getSnapshot().values, 65), fontRowsAfter(savedRows65, draw(65, [0xff, 0, 0, 0, 0, 0, 0, 0])));
});

test("a file the writer would not reproduce byte for byte opens read-only with the reason, and is never converted", async () => {
  // The same rows with no padding spaces and LF line ends: the reader accepts it, the writer would change it.
  const compact = encoder.encode(["RPGTLKIT FONT", "2", "0", ...Array.from({ length: 2048 }, (_, index) => String(index % 256))].join("\n"));
  const { host, doc } = await open(compact);
  const snapshot = doc.getSnapshot();
  equal(snapshot.readOnly?.code, "no-same-version-writer");
  match(snapshot.readOnly?.message ?? "", /first difference is at offset/);
  const refused = doc.apply(clear(65));
  ok(!refused.ok);
  equal(refused.rejection.reason, "read-only");
  const saved = await doc.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "read-only");
  deepEqual(host.bytesOf(PATH), compact, "the file is untouched");
});

test("a file that is not a bitmap font is not opened", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: encoder.encode("RPGTLKIT TILE\r\n2\r\n0\r\n") } });
  const opened = await openFontDocument(host.fs, identity);
  ok(!opened.ok);
  equal(opened.error.kind, "format");
});

test("a pixel is the bit of its row: bit 7 is the leftmost, and setting one leaves the other seven", () => {
  const rows = [0b10000001, 0, 0, 0, 0, 0, 0, 0b00000001];
  equal(fontPixelOf(rows, 0, 0), true);
  equal(fontPixelOf(rows, 7, 0), true);
  equal(fontPixelOf(rows, 3, 0), false);
  equal(fontPixelOf(rows, 7, 7), true);
  equal(fontPixelOf(rows, 0, 7), false);
  deepEqual(fontRowsWithPixel(rows, 3, 0, true), [0b10010001, 0, 0, 0, 0, 0, 0, 0b00000001]);
  deepEqual(fontRowsWithPixel(rows, 0, 0, false), [0b00000001, 0, 0, 0, 0, 0, 0, 0b00000001]);
  deepEqual(fontRowsWithPixel(rows, 7, 7, false), [0b10000001, 0, 0, 0, 0, 0, 0, 0]);
  equal(fontCharacterOf(65), "A");
  equal(fontCharacterOf(0), null);
  equal(fontCharacterOf(127), null);
  equal(fontCharacterOf(173), null);
  equal(fontCharacterOf(233), "é");
  equal(fontSlotName(7), "character 7");
  equal(inkedGlyphCount(new Uint8Array(2048)), 0);
});

/** The pixels of one glyph at `s`, from the spec's sentences and independently of the engine's `legacyInk`. */
function specInk(rows: readonly number[], s: number, bold: boolean, italic: boolean): Set<string> {
  const ink = new Set<string>();
  for (let sy = 0; sy < 8; sy += 1) {
    for (let sx = 0; sx < 8; sx += 1) {
      if (((rows[sy] ?? 0) >> (7 - sx) & 1) === 0) continue;
      const shift = italic ? Math.floor((7 - sy) * s / 32) : 0;
      const left = Math.floor(sx * s / 8);
      const right = Math.max(left + 1, Math.floor((sx + 1) * s / 8));
      const top = Math.floor(sy * s / 8);
      const bottom = Math.max(top + 1, Math.floor((sy + 1) * s / 8));
      for (let y = top; y < bottom; y += 1) {
        for (let x = left + shift; x < right + shift; x += 1) {
          ink.add(`${x},${y}`);
          if (bold) ink.add(`${x + 1},${y}`);
        }
      }
    }
  }
  return ink;
}

const A_ROWS = [0x80, 0x40, 0x20, 0x13, 0x08, 0x04, 0x02, 0x81];

test("the sample preview is hard-edged ink at 8 and 20 pixels in every style, equal to the spec's pixels, with the underline on the line's last row", () => {
  const values = new Uint8Array(2048);
  values.set(A_ROWS, 65 * 8);
  const background = [FONT_PREVIEW_BACKGROUND.r, FONT_PREVIEW_BACKGROUND.g, FONT_PREVIEW_BACKGROUND.b, 255];
  for (const size of [8, 20]) {
    for (const [bold, italic, underline] of [[false, false, false], [true, false, false], [false, true, false], [true, true, true], [false, false, true]] as const) {
      const picture = previewFontText(values, { text: "A", size, bold, italic, underline });
      ok(picture.ok);
      const lit = new Set<string>();
      for (let y = 0; y < picture.height; y += 1) {
        for (let x = 0; x < picture.width; x += 1) {
          const offset = (y * picture.width + x) * 4;
          const pixel: number[] = [...picture.rgba.slice(offset, offset + 4)];
          if (pixel.join() === background.join()) continue;
          deepEqual(pixel, [255, 255, 255, 255], "every drawn pixel is the full-strength ink: no smoothing");
          lit.add(`${x - 4},${y - 4}`);
        }
      }
      const expected = specInk(A_ROWS, size, bold, italic);
      if (underline) for (let x = 0; x < size + (bold ? 1 : 0); x += 1) expected.add(`${x},${size - 1}`);
      deepEqual([...lit].sort(), [...expected].sort(), `size ${size}${bold ? " bold" : ""}${italic ? " italics" : ""}${underline ? " underline" : ""}`);
    }
  }
});

test("the preview shows the glyphs as they are now, so an edited glyph changes it and the same font gives the same picture", async () => {
  const { doc } = await open();
  const options = { text: "Hi A", size: 12, bold: false, italic: false, underline: false } as const;
  const first = previewFontText(doc.getSnapshot().values, options);
  ok(first.ok);
  const again = previewFontText(doc.getSnapshot().values, options);
  ok(again.ok);
  deepEqual(again.rgba, first.rgba);
  ok(doc.apply(draw(65, [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])).ok);
  const edited = previewFontText(doc.getSnapshot().values, options);
  ok(edited.ok);
  notEqual(Buffer.from(edited.rgba).toString("hex"), Buffer.from(first.rgba).toString("hex"));
  equal(doc.getSnapshot().dirty, true, "only the edit dirtied the font; drawing a preview is a read");
});

test("the preview refuses a size or sample outside what it draws, and wraps a long sample at words", () => {
  const values = new Uint8Array(2048);
  for (const size of [0, -3, 2.5, FONT_PREVIEW_MAX_SIZE + 1, Number.NaN]) {
    const picture = previewFontText(values, { text: "A", size, bold: false, italic: false, underline: false });
    ok(!picture.ok, String(size));
  }
  ok(!previewFontText(values, { text: "x".repeat(201), size: 8, bold: false, italic: false, underline: false }).ok);
  const wide = previewFontText(values, { text: "word ".repeat(40), size: 20, bold: false, italic: false, underline: false });
  ok(wide.ok);
  ok(wide.width <= 512 + 2 * 4, "a long line wraps instead of making an unbounded picture");
  ok(wide.height > 20 + 2 * 4, "and takes more lines");
});

test("a sample taller than the largest picture keeps only the lines it draws, and no clipped line reaches the padding", () => {
  // Every glyph inked, so a line that drew past the retained ones would show in the padding rows.
  const values = new Uint8Array(2048).fill(0xff);
  // 198 characters at 128 px wrap into far more lines than a 2048-pixel side holds (the sample limit is 200).
  const text = "A ".repeat(99).trimEnd();
  const picture = previewFontText(values, { text, size: 128, bold: false, italic: false, underline: false });
  ok(picture.ok);
  equal(picture.truncated, true, "the sample says it was cut");
  const lines = Math.floor((2048 - 2 * 4) / 128);
  equal(picture.height, lines * 128 + 2 * 4, "the picture is the retained lines plus the padding, nothing more");
  ok(picture.height <= 2048);
  const background = [FONT_PREVIEW_BACKGROUND.r, FONT_PREVIEW_BACKGROUND.g, FONT_PREVIEW_BACKGROUND.b, 255];
  let inPadding = 0;
  for (let y = picture.height - 4; y < picture.height; y += 1) {
    for (let x = 0; x < picture.width; x += 1) {
      const offset = (y * picture.width + x) * 4;
      if ([...picture.rgba.slice(offset, offset + 4)].join() !== background.join()) inPadding += 1;
    }
  }
  equal(inPadding, 0, "a clipped line does not leak into the bottom padding");
});

test("a new font is version 2.0 with 2048 empty rows, in the exact layout of the format", () => {
  const bytes = newFontBytes();
  equal(bytes.length, 21 + 2048 * 5, "21 header bytes plus ' 0 ' and CRLF for every row");
  deepEqual(bytes, encoder.encode(fontText(() => 0)));
});

test("New font writes the file in the project's Font folder, refuses an existing path and a wrong place, and suggests a free name", async () => {
  const host = createMemoryPlatformServices({ files: {} });
  const layout = { projectFolder: "" };
  equal(await suggestFontPath(host.fs, layout), "Font/new-font.fnt");
  const created = await createFontFile(host.fs, "Font/new-font.fnt");
  ok(created.ok);
  deepEqual(host.bytesOf("Font/new-font.fnt"), newFontBytes());
  equal(await suggestFontPath(host.fs, layout), "Font/new-font 2.fnt");
  const again = await createFontFile(host.fs, "font/NEW-FONT.fnt");
  ok(!again.ok);
  equal(again.reason, "exists");
  deepEqual(host.bytesOf("Font/new-font.fnt"), newFontBytes(), "the existing file is untouched");
  for (const path of ["Prg/new-font.fnt", "Font/new-font.txt", "Font/sub/new-font.fnt", "Font/.fnt"]) {
    const refused = await createFontFile(host.fs, path);
    ok(!refused.ok, path);
    equal(refused.reason, "invalid");
  }
  equal(fontDestinationProblem("Game/Demo/Font/a.fnt"), null, "a font in a nested project layout");
  const opened = await openFontDocument(host.fs, createDocumentIdentity("memory-project", "Font/new-font.fnt"));
  ok(opened.ok, "the new font opens");
  equal(opened.document.getSnapshot().readOnly, null);
});
