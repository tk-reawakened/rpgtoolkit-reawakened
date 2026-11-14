// Shared by the editor-model and editor-ui tests: the committed `.gam` examples of every minor, and an independent
// oracle for what editing only the game title must do to the bytes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const examples = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "main");

/** The committed example file for `main_minor<minor>.gam`; minor 0 has none, so it is minor 1 with only its header minor changed. */
export function exampleMain(minor: number): Uint8Array {
  if (minor === 0) {
    // Minors 0 and 1 share one layout (docs/spec/formats/main-file.md#layout rows 11 and 23′ apply below minor 3); the
    // minor is the little-endian i16 at offset 0x10 (the annotated listing in docs/spec/examples/listings/main.gam.txt).
    const bytes = exampleMain(1);
    bytes[0x10] = 0;
    bytes[0x11] = 0;
    return bytes;
  }
  return new Uint8Array(readFileSync(join(examples, `main_minor${minor}.gam`)));
}

/** The committed Toolkit 2 text main file: a main file the binary writer cannot reproduce. */
export function exampleTextMain(): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, "main_tk2_text.gam")));
}

/** The committed Toolkit 1 main file, which the reader refuses. */
export function exampleTk1Main(): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, "main_tk1.gam")));
}

/** Where the title starts and ends in a binary main file: two NUL-terminated strings (`registrationCode`, `projectPath`) then `gameTitle` (rows 5–7). */
export function titleSpan(bytes: Uint8Array): { readonly start: number; readonly end: number } {
  const stringEnd = (from: number): number => {
    let at = from;
    while (bytes[at] !== 0) at += 1;
    return at;
  };
  // 14 bytes of magic and NUL, then major, minor and the registration flag (three i16), then the registration code.
  const afterCode = stringEnd(14 + 6) + 1;
  const start = stringEnd(afterCode) + 1;
  return { start, end: stringEnd(start) };
}

/** The Windows-1252 bytes of an ASCII or Latin-1 title. */
export function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** `bytes` with only the title replaced: everything before it and after it is copied as it was. */
export function withTitle(bytes: Uint8Array, title: string): Uint8Array {
  const { start, end } = titleSpan(bytes);
  return Uint8Array.from([...bytes.subarray(0, start), ...latin1(title), ...bytes.subarray(end)]);
}

export function titleOf(bytes: Uint8Array): string {
  const { start, end } = titleSpan(bytes);
  return String.fromCharCode(...bytes.subarray(start, end));
}

const ascii = (text: string): number[] => [...latin1(text)];

/** A package-list block, an audio block, then bytes no reader knows (docs/spec/formats/main-file.md#tkr-package-list-extension, `#tkr-audio-settings-extension`), written byte by byte. */
export function trailingBlocks(): Uint8Array {
  const u16 = (n: number): number[] => [n & 0xff, n >> 8];
  const track = (name: string, voices: number): number[] => [...ascii(name), 0, ...u16(voices)];
  return Uint8Array.from([
    ...ascii("TKRPLUG"), 0, ...u16(2), ...ascii("stock_battle"), 0, ...ascii("stock_menu"), 0,
    ...ascii("TRKAUD"), 0, ...u16(5),
    ...track("music", 1), ...track("sfx", 1), ...track("ambience", 4), ...track("voice", 2), ...track("ui", 4),
    ...u16(32), 0,
    // Residue: after the last block the reader knows.
    0xde, 0xad, 0xbe, 0xef,
  ]);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

/** The Windows-1252 bytes of `text`, from a hand-written table of the 0x80-0x9F block (not `core`'s decoder), for the characters the tests use. */
const HIGH_BLOCK: Readonly<Record<string, number>> = {
  "\u20ac": 0x80,
  "\u201a": 0x82,
  "\u2026": 0x85,
  "\u2018": 0x91,
  "\u2019": 0x92,
  "\u201c": 0x93,
  "\u201d": 0x94,
  "\u2013": 0x96,
  "\u2014": 0x97,
  "\u2122": 0x99,
};

export function cp1252Bytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => {
    const high = HIGH_BLOCK[char];
    if (high !== undefined) return high;
    const code = char.charCodeAt(0);
    if (code > 0xff || (code >= 0x80 && code < 0xa0)) throw new Error(`the oracle has no byte for U+${code.toString(16)}`);
    return code;
  });
}

/** `bytes` with only the title's bytes replaced by `title`. */
export function withTitleBytes(bytes: Uint8Array, title: Uint8Array): Uint8Array {
  const { start, end } = titleSpan(bytes);
  return Uint8Array.from([...bytes.subarray(0, start), ...title, ...bytes.subarray(end)]);
}

const boards = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "board");

/** The committed example board for `board_minor<minor>.brd` (minor 4 is a 4×3 board of two layers; 2 and 3 are the pre-vector layouts the editor refuses). */
export function exampleBoard(minor: 2 | 3 | 4): Uint8Array {
  return new Uint8Array(readFileSync(join(boards, `board_minor${minor}.brd`)));
}
