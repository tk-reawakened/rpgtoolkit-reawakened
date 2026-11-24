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

const draw = (glyph: number, rows: readonly number[]): FontCommand => ({ type: "set-font-glyph", glyph, rows });

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
  const expected = fontText((glyph, row) => {
    if (glyph === 65) return row === 0 ? 0x80 : row === 7 ? 0x01 : 0;
    if (glyph === 200) return row === 0 ? 0x01 : row === 7 ? 0x80 : 0;
    return original(glyph, row);
  });
  deepEqual(host.bytesOf(PATH), encoder.encode(expected), "exactly two glyphs changed");
  const reopened = await openFontDocument(host.fs, identity);
  ok(reopened.ok);
  equal(reopened.document.getSnapshot().dirty, false);
  deepEqual(fontGlyphRows(reopened.document.getSnapshot().values, 65), [0x80, 0, 0, 0, 0, 0, 0, 0x01]);
  deepEqual(fontGlyphRows(reopened.document.getSnapshot().values, 66), [0, 1, 2, 3, 4, 5, 6, 7].map((row) => original(66, row)), "an untouched glyph is intact");
});

test("undo and redo take one glyph edit back and forward whole, and each edit is named by its character", async () => {
  const { doc } = await open();
  const before = [...doc.getSnapshot().values];
  const first = doc.apply(draw(65, [0xff, 0xff, 0, 0, 0, 0, 0, 0]));
  ok(first.ok);
  equal(doc.getSnapshot().edits.at(-1)?.label, "Edit character 65 (“A”)");
  const cleared = doc.apply(draw(65, [0, 0, 0, 0, 0, 0, 0, 0]));
  ok(cleared.ok);
  equal(doc.getSnapshot().edits.at(-1)?.label, "Clear character 65 (“A”)");
  ok(doc.undo().ok);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), [0xff, 0xff, 0, 0, 0, 0, 0, 0]);
  ok(doc.undo().ok);
  deepEqual([...doc.getSnapshot().values], before);
  equal(doc.getSnapshot().dirty, false, "back at the saved state");
  ok(doc.redo().ok);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), [0xff, 0xff, 0, 0, 0, 0, 0, 0]);
  equal(doc.getSnapshot().dirty, true);
});

test("a command that is not a whole glyph, names no character or changes nothing is refused and the snapshot is the very same", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot();
  const rows = fontGlyphRows(before.values, 10);
  for (const bad of [
    draw(256, rows),
    draw(-1, rows),
    draw(1.5, rows),
    draw(10, rows.slice(0, 7)),
    draw(10, [...rows, 0]),
    draw(10, [...rows.slice(0, 7), 256]),
    draw(10, [...rows.slice(0, 7), -1]),
    draw(10, [...rows.slice(0, 7), 1.5]),
  ]) {
    const result = doc.apply(bad);
    ok(!result.ok, JSON.stringify(bad));
    equal(result.rejection.reason, "invalid");
    ok(result.rejection.message.length > 0);
  }
  const same = doc.apply(draw(10, rows));
  ok(!same.ok);
  match(same.rejection.message, /already looks like that/);
  equal(doc.getSnapshot(), before, "nothing changed");
});

test("isCommand accepts only the shape a webview may send", () => {
  ok(fontCodec.isCommand({ type: "set-font-glyph", glyph: 3, rows: [0, 0, 0, 0, 0, 0, 0, 0] }));
  ok(!fontCodec.isCommand({ type: "set-font-glyph", glyph: "3", rows: [] }));
  ok(!fontCodec.isCommand({ type: "set-font-glyph", glyph: 3, rows: "00000000" }));
  ok(!fontCodec.isCommand({ type: "other", glyph: 3, rows: [] }));
  ok(!fontCodec.isCommand(null));
});

test("a refused save keeps every glyph edit, still unsaved, and the next save writes them (ADR 0022 D3.3)", async () => {
  const { host, doc } = await open();
  ok(doc.apply(draw(65, [0xff, 0, 0, 0, 0, 0, 0, 0])).ok);
  host.failWrites({ code: "io-error", message: "the disk is full" });
  const refused = await doc.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "write");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(fontGlyphRows(doc.getSnapshot().values, 65), [0xff, 0, 0, 0, 0, 0, 0, 0], "the edit is still in the document");
  deepEqual(host.bytesOf(PATH), ORIGINAL);
  host.failWrites(null);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().dirty, false);
  deepEqual(fontGlyphRows((await openFontDocument(host.fs, identity) as { document: FontDocument }).document.getSnapshot().values, 65), [0xff, 0, 0, 0, 0, 0, 0, 0]);
});

test("a file the writer would not reproduce byte for byte opens read-only with the reason, and is never converted", async () => {
  // The same rows with no padding spaces and LF line ends: the reader accepts it, the writer would change it.
  const compact = encoder.encode(["RPGTLKIT FONT", "2", "0", ...Array.from({ length: 2048 }, (_, index) => String(index % 256))].join("\n"));
  const { host, doc } = await open(compact);
  const snapshot = doc.getSnapshot();
  equal(snapshot.readOnly?.code, "no-same-version-writer");
  match(snapshot.readOnly?.message ?? "", /first difference is at offset/);
  const refused = doc.apply(draw(65, [1, 1, 1, 1, 1, 1, 1, 1]));
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
