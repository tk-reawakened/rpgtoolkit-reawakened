// Toolkit 2 bitmap font (.fnt) format of
// `docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text` (docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text):
// 2051 lines, 2048 values for 256 8x8 glyphs.

import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readLegacyFont,
  writeLegacyFont,
  glyphToRgba,
  FONT_MAGIC,
  FONT_SECTION,
  FONT_TOTAL_LINES,
  FONT_TOTAL_VALUES,
  type LegacyFont,
  type Result,
} from "../src/index.ts";

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
function findLegacyBaseFonts(directory: string): string[] {
  return readdirSync(directory, { recursive: true })
    .filter((path) => path.toLowerCase().endsWith("base.fnt"))
    .map((path) => join(directory, path));
}


test("reads a valid 2051-line font file and round-trips exactly", () => {
  const values = new Uint8Array(FONT_TOTAL_VALUES);
  for (let i = 0; i < FONT_TOTAL_VALUES; i += 1) {
    values[i] = (i * 17) & 0xff;
  }
  const font: LegacyFont = {
    magic: FONT_MAGIC,
    version: 2,
    subversion: 0,
    values,
  };

  const text = writeLegacyFont(font);
  const lines = text.trimEnd().split(/\r\n|\r|\n/);
  equal(lines.length, FONT_TOTAL_LINES);

  const res = readLegacyFont(text);
  equal(res.ok, true);
  if (res.ok) {
    equal(res.value.magic, FONT_MAGIC);
    equal(res.value.version, 2);
    equal(res.value.subversion, 0);
    deepEqual(res.value.values, values);
  }
});
test("reads committed base.fnt version example and round-trips exactly", () => {
  const path = join(repoRoot, "docs", "spec", "examples", "versions", "font", "base.fnt");
  const text = readFileSync(path, "utf8");
  const res = readLegacyFont(text, path);
  equal(res.ok, true);
  if (res.ok) {
    equal(res.value.magic, FONT_MAGIC);
    equal(res.value.version, 2);
    equal(res.value.subversion, 0);
    equal(res.value.values.length, FONT_TOTAL_VALUES);

    const written = writeLegacyFont(res.value);
    equal(written, text);
  }
});

test("reads committed base.fnt as Uint8Array bytes and round-trips", () => {
  const path = join(repoRoot, "docs", "spec", "examples", "versions", "font", "base.fnt");
  const bytes = new Uint8Array(readFileSync(path));
  const res = readLegacyFont(bytes, path);
  equal(res.ok, true);
  if (res.ok) {
    equal(res.value.magic, FONT_MAGIC);
    equal(res.value.version, 2);
    equal(res.value.subversion, 0);
    equal(res.value.values.length, FONT_TOTAL_VALUES);
  }
});


test("renders glyphToRgba with correct bitplane ordering", () => {
  const values = new Uint8Array(FONT_TOTAL_VALUES);
  // Glyph 'A' (ASCII 65): set top row (row 0) to 0b10000001 (0x81): bits 7 and 0 set
  values[65 * 8] = 0x81;
  // Row 1 to 0b01000010 (0x42): bits 6 and 1 set
  values[65 * 8 + 1] = 0x42;

  const font: LegacyFont = {
    magic: FONT_MAGIC,
    version: 2,
    subversion: 0,
    values,
  };

  const rgba = glyphToRgba(font, 65, [255, 0, 0, 255], [0, 0, 0, 0]);
  equal(rgba.length, 8 * 8 * 4);

  // Row 0: pixel 0 (x=0, bit 7) is ink (red)
  deepEqual([rgba[0], rgba[1], rgba[2], rgba[3]], [255, 0, 0, 255]);
  // Row 0: pixel 1 (x=1, bit 6) is bg (transparent)
  deepEqual([rgba[4], rgba[5], rgba[6], rgba[7]], [0, 0, 0, 0]);
  // Row 0: pixel 7 (x=7, bit 0) is ink (red)
  const p7 = 7 * 4;
  deepEqual([rgba[p7], rgba[p7 + 1], rgba[p7 + 2], rgba[p7 + 3]], [255, 0, 0, 255]);

  // Row 1: pixel 0 (x=0) is bg
  const r1p0 = (8 + 0) * 4;
  deepEqual([rgba[r1p0], rgba[r1p0 + 1], rgba[r1p0 + 2], rgba[r1p0 + 3]], [0, 0, 0, 0]);
  // Row 1: pixel 1 (x=1, bit 6) is ink
  const r1p1 = (8 + 1) * 4;
  deepEqual([rgba[r1p1], rgba[r1p1 + 1], rgba[r1p1 + 2], rgba[r1p1 + 3]], [255, 0, 0, 255]);
});

test("refuses invalid magic or short line count", () => {
  const badMagic = "NOT A FONT\r\n2\r\n0\r\n";
  const resBad = readLegacyFont(badMagic);
  equal(resBad.ok, false);
  if (!resBad.ok) {
    equal(resBad.error.section, FONT_SECTION);
  }

  const short = "RPGTLKIT FONT\r\n2\r\n0\r\n 1 \r\n 2 \r\n";
  const resShort = readLegacyFont(short);
  equal(resShort.ok, false);
  if (!resShort.ok) {
    equal(resShort.error.section, FONT_SECTION);
  }
});

test("refuses out-of-range value or non-numeric line", () => {
  const lines = ["RPGTLKIT FONT", "2", "0"];
  for (let i = 0; i < 2047; i += 1) {
    lines.push("0");
  }
  lines.push("999"); // value > 255
  const res = readLegacyFont(lines.join("\r\n"));
  equal(res.ok, false);
  if (!res.ok) {
    equal(res.error.section, FONT_SECTION);
  }
});

test("loads the project-owned authored font and covers ASCII plus replacement", () => {
  const path = join(repoRoot, "media", "fonts", "tkr-8x8.fnt");
  const res = readLegacyFont(readFileSync(path), path);
  equal(res.ok, true);
  if (!res.ok) return;
  equal(res.value.values.length, FONT_TOTAL_VALUES);
  for (let code = 32; code <= 126; code += 1) {
    const rows = res.value.values.slice(code * 8, code * 8 + 8);
    equal(rows.some((value) => value !== 0), code === 32 ? false : true, `glyph U+${code.toString(16)}`);
  }
  const replacement = res.value.values.slice(255 * 8, 256 * 8);
  equal(replacement[0], 0);
  equal(replacement[1], 0x3e);
  const rgba = glyphToRgba(res.value, 255);
  equal(rgba[1 * 8 * 4 + 2 * 4 + 3], 255);
});

test("authored glyph data is distinct from fetched legacy BASE.FNT when present", () => {
  const authoredBytes = new Uint8Array(readFileSync(join(repoRoot, "media", "fonts", "tkr-8x8.fnt")));
  const authored = unwrap(readLegacyFont(authoredBytes));
  const fixtureRoot = join(repoRoot, "fixtures", "legacy");
  let paths: string[] = [];
  try {
    paths = findLegacyBaseFonts(fixtureRoot);
  } catch {
    return;
  }
  for (const path of paths) {
    const legacyBytes = new Uint8Array(readFileSync(path));
    if (authoredBytes.length === legacyBytes.length && authoredBytes.every((value, index) => value === legacyBytes[index])) {
      throw new Error(`${path}: authored font is byte-identical to legacy BASE.FNT`);
    }
    const legacy = readLegacyFont(legacyBytes, path);
    equal(legacy.ok, true);
    if (legacy.ok && JSON.stringify([...authored.values]) === JSON.stringify([...legacy.value.values])) {
      throw new Error(`${path}: authored glyph data matches legacy BASE.FNT`);
    }
  }
});

test("a row value is the whole line: digits only, so a trailing word or sign is refused, not read as a number", () => {
  const lines = ["RPGTLKIT FONT", "2", "0"];
  for (let index = 0; index < FONT_TOTAL_VALUES; index += 1) lines.push(" 0 ");
  const base = [...lines];
  const cases: readonly [string, string][] = [
    ["128oops", "a value with trailing text"],
    ["0x80", "a hexadecimal value"],
    ["+5", "a signed value"],
    [" 5 5 ", "two numbers on one line"],
    ["-1", "a negative value"],
    ["256", "a value above 255"],
    ["1.5", "a fractional value"],
  ];
  for (const [value, why] of cases) {
    const broken = [...base];
    broken[3 + 65 * 8] = ` ${value} `;
    const result = readLegacyFont(`${broken.join("\r\n")}\r\n`);
    equal(result.ok, false, `${why} is refused`);
    if (!result.ok) {
      equal(result.error.section, FONT_SECTION);
      equal(result.error.offset, 4 + 65 * 8, `${why} is located at the row's line`);
      equal(/invalid font row value/.test(result.error.message), true, result.error.message);
    }
  }
});

test("the version and subversion are whole numbers, so a version with trailing text is a located error", () => {
  const lines = ["RPGTLKIT FONT", "2oops", "0"];
  for (let index = 0; index < FONT_TOTAL_VALUES; index += 1) lines.push(" 0 ");
  const result = readLegacyFont(`${lines.join("\r\n")}\r\n`, "Font/retro.fnt");
  equal(result.ok, false);
  if (!result.ok) {
    equal(result.error.section, FONT_SECTION);
    equal(result.error.offset, 2);
    equal(/invalid font version "2oops\.0"/.test(result.error.message), true, result.error.message);
  }
  // A version that is a number but not 2.0 is still read, with the warning the format page describes.
  const other = ["RPGTLKIT FONT", "3", "1", ...Array.from({ length: FONT_TOTAL_VALUES }, () => " 0 ")];
  const read = readLegacyFont(`${other.join("\r\n")}\r\n`);
  equal(read.ok, true);
  if (read.ok) {
    equal(read.value.version, 3);
    equal(read.warnings.length, 1);
  }
});
