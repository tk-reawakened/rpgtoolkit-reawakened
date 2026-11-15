import { decodeCp1252, encodeCp1252, ok, err, type Result } from "@tk-reawakened/core";
import {
  BinaryDocument,
  createBinaryDocument,
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
 * The RPGCode program document (story 11.7, docs/spec/engine/rpgcode-tooling.md#tool-10-text; ADR 0022 D2 row "RPGCode
 * text in standalone/browser/desktop"). The text is the one editable copy: a code view is a view of it and never a second
 * model. In VS Code the `TextDocument` is the authority and this document is not used.
 *
 * A program is single-byte Windows-1252 text with CRLF, LF or CR line endings ([PRG-2], `formats/rpgcode-program.md`).
 * The model holds the text with `LF` only, and the ending of every line break beside it, so a file that mixes endings, or
 * has none at its end, is written back exactly as it was read. Every byte value decodes and encodes to itself, so an
 * unknown or unusual byte is never lost.
 */

/** One replacement in text offsets (UTF-16 code units of the LF-only text). */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  /** The new text, with `LF` line breaks only. */
  readonly text: string;
}

/**
 * Replace text. The edits apply in order, each in the coordinates the previous one left, so one command can carry
 * everything a code view reports for a burst of typing and be undone as one edit.
 */
export interface EditTextCommand {
  readonly type: "edit-text";
  readonly edits: readonly TextEdit[];
  /** What an undo menu says for this edit; "Edit text" when absent. */
  readonly label?: string;
}

export type ProgramCommand = EditTextCommand;

/** The model: what a program holds. */
export interface ProgramModel {
  /** The source with `LF` line breaks only; empty for a compiled program, which has no text to edit. */
  readonly text: string;
  /** The line ending of the Nth `LF` of `text` as the file had it: `\r\n`, `\n` or `\r`. */
  readonly breaks: readonly string[];
  /** The file's bytes, kept only for a compiled program, which is shown read-only and copied unchanged. */
  readonly compiled: Uint8Array | null;
}

export type LineEnding = "crlf" | "lf" | "cr" | "mixed" | "none";

/** What a program adds to the shared snapshot. Plain data. */
export interface ProgramDocumentFields {
  /** The source as the view shows it: `LF` line breaks, saved or not. */
  readonly text: string;
  /** The ending the file uses for its line breaks. */
  readonly lineEnding: LineEnding;
  /** True for a compiled program (first byte `0x00`), which has no source text and opens read-only. */
  readonly compiled: boolean;
}

export type ProgramDocumentSnapshot = DocumentSnapshot<ProgramCommand> & ProgramDocumentFields;
export type ProgramDocument = EditorDocument<ProgramDocumentSnapshot, ProgramCommand>;
export type ProgramOpenResult = GenericOpenResult<ProgramDocument>;

const CRLF = "\r\n";

/** Split `bytes` into LF-only text and the ending of each break. */
function readProgram(bytes: Uint8Array): ProgramModel {
  if (bytes.length > 0 && bytes[0] === 0) return { text: "", breaks: [], compiled: bytes.slice() };
  const decoded = decodeCp1252(bytes, 0, bytes.length);
  const breaks: string[] = [];
  let text = "";
  let from = 0;
  for (let index = 0; index < decoded.length; index += 1) {
    const ch = decoded.charCodeAt(index);
    if (ch !== 0x0a && ch !== 0x0d) continue;
    text += decoded.slice(from, index);
    text += "\n";
    if (ch === 0x0d && decoded.charCodeAt(index + 1) === 0x0a) {
      breaks.push(CRLF);
      index += 1;
    } else {
      breaks.push(ch === 0x0d ? "\r" : "\n");
    }
    from = index + 1;
  }
  return { text: text + decoded.slice(from), breaks, compiled: null };
}

/** The ending most of the breaks use, for a break the author adds where none exists to copy. */
function dominantBreak(breaks: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of breaks) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = CRLF;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** The text and its line endings as the bytes the file holds. */
function programText(model: ProgramModel): string {
  let out = "";
  let from = 0;
  let nth = 0;
  for (let index = model.text.indexOf("\n"); index !== -1; index = model.text.indexOf("\n", from)) {
    out += model.text.slice(from, index) + (model.breaks[nth] ?? CRLF);
    nth += 1;
    from = index + 1;
  }
  return out + model.text.slice(from);
}

function writeProgram(model: ProgramModel): Result<Uint8Array> {
  if (model.compiled !== null) return ok(model.compiled.slice());
  const encoded = encodeCp1252(programText(model));
  if (encoded.ok) return encoded;
  return err({ ...encoded.error, message: `${encoded.error.message}${lineNote(model, encoded.error.offset)}` });
}

/** ` (line N)` for the character at `offset` of the written text, as a person counts lines. */
function lineNote(model: ProgramModel, offset: number | undefined): string {
  if (offset === undefined) return "";
  // The written text and `model.text` differ only by line-ending width, so count the breaks before the character.
  const written = programText(model);
  const line = written.slice(0, offset).split(/\r\n|\r|\n/).length;
  return ` (line ${line})`;
}

/** Apply one edit; `null` when its range is outside the text. */
function replaceRange(model: ProgramModel, edit: TextEdit): ProgramModel | null {
  const { from, to } = edit;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > model.text.length) return null;
  const countBreaks = (value: string, start: number, end: number): number => {
    let count = 0;
    for (let index = value.indexOf("\n", start); index !== -1 && index < end; index = value.indexOf("\n", index + 1)) count += 1;
    return count;
  };
  const before = countBreaks(model.text, 0, from);
  const removed = countBreaks(model.text, from, to);
  const added = countBreaks(edit.text, 0, edit.text.length);
  const removedBreaks = model.breaks.slice(before, before + removed);
  // Keep the endings of the lines that stay. A break the edit adds takes the ending of the one it replaces, or of the
  // break before it, or the file's usual one.
  const fallback = removedBreaks.at(-1) ?? model.breaks[before - 1] ?? dominantBreak(model.breaks);
  const inserted = Array.from({ length: added }, (_, nth) => removedBreaks[nth] ?? fallback);
  return {
    text: model.text.slice(0, from) + edit.text + model.text.slice(to),
    breaks: [...model.breaks.slice(0, before), ...inserted, ...model.breaks.slice(before + removed)],
    compiled: null,
  };
}

function applyEdits(model: ProgramModel, command: ProgramCommand): ProgramModel {
  let current = model;
  for (const edit of command.edits) current = replaceRange(current, edit) ?? current;
  return current;
}

function isEdit(value: unknown): value is TextEdit {
  if (typeof value !== "object" || value === null) return false;
  const edit = value as Readonly<Record<string, unknown>>;
  return Number.isInteger(edit.from) && Number.isInteger(edit.to) && typeof edit.text === "string";
}

function isProgramCommand(value: unknown): value is ProgramCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Readonly<Record<string, unknown>>;
  return command.type === "edit-text" && Array.isArray(command.edits) && command.edits.every(isEdit)
    && (command.label === undefined || typeof command.label === "string");
}

function refuse(next: ProgramModel, command: ProgramCommand, previous: ProgramModel): Rejection | null {
  let current = previous;
  for (const edit of command.edits) {
    if (edit.text.includes("\r")) return { reason: "invalid", message: "Inserted text must use LF line breaks only." };
    const replaced = replaceRange(current, edit);
    if (replaced === null) return { reason: "invalid", message: `The text range ${edit.from}-${edit.to} is outside the program.` };
    current = replaced;
  }
  if (current.text === previous.text) return { reason: "invalid", message: "This edit does not change the program." };
  const written = writeProgram(next);
  if (!written.ok) return { reason: "invalid", message: `The program cannot be saved as written: ${written.error.message}.` };
  return null;
}

function readOnlyReason(model: ProgramModel): ReadOnlyReason | null {
  if (model.compiled === null) return null;
  return {
    code: "no-same-version-writer",
    message: "This is a compiled program (its first byte is 0), not source text, so it is shown read-only and never converted; re-save the source to edit it.",
  };
}

function lineEndingOf(model: ProgramModel): LineEnding {
  if (model.breaks.length === 0) return "none";
  const first = model.breaks[0]!;
  if (model.breaks.some((value) => value !== first)) return "mixed";
  return first === CRLF ? "crlf" : first === "\n" ? "lf" : "cr";
}

/** The program kind's codec (`docs/spec/formats/rpgcode-program.md`). */
export const programCodec: DocumentCodec<ProgramModel, ProgramCommand, ProgramDocumentFields> = {
  kind: "program",
  read: (bytes) => ok(readProgram(bytes)),
  write: writeProgram,
  readOnlyReason: (model) => readOnlyReason(model),
  isCommand: isProgramCommand,
  apply: applyEdits,
  label: (command) => command.label ?? "Edit text",
  refuse,
  summary: (model) => (model.compiled !== null ? "Compiled program" : `${model.text === "" ? 0 : model.text.split("\n").length} lines`),
  fields: (model) => ({ text: model.text, lineEnding: lineEndingOf(model), compiled: model.compiled !== null }),
};

/** Read the program at `identity.path` through `storage` and open it. */
export function openProgramDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<ProgramOpenResult> {
  return openBinaryDocument(programCodec, storage, identity);
}

/** Open a program over bytes already in hand (a recovered backup, a copy). */
export function createProgramDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): ProgramOpenResult {
  return createBinaryDocument(programCodec, storage, identity, bytes);
}

export type { BinaryDocument };
