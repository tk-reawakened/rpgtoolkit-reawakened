import { BinaryReader, MAIN_MAGIC, readMainFile, writeMainFile, type MainFile } from "@tk-reawakened/core";
import {
  BinaryDocument,
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

export { firstDifference, markRecoveredDocumentDirty } from "./binary-document.ts";
export type {
  ApplyResult,
  ConflictChoice,
  ConflictResult,
  DocumentStorage,
  EditRecord,
  ExternalChange,
  ExternalCheck,
  HistoryResult,
  OpenError,
  ReadOnlyReason,
  Rejection,
  RevertFailure,
  RevertResult,
  SaveFailure,
  SaveResult,
} from "./binary-document.ts";

/** The one edit the tracer offers: set the game title (`docs/spec/formats/main-file.md#layout`, row 7, `gameTitle`). */
export interface SetGameTitleCommand {
  readonly type: "set-game-title";
  readonly title: string;
}

/** Every command a main-file document accepts. Plain data, so a stack of them can be stored and replayed. */
export type MainCommand = SetGameTitleCommand;

/** What a main file adds to the shared snapshot. */
export interface MainDocumentFields {
  /** The minor version the file was opened at and is saved at (AD-18). */
  readonly minor: number;
  /** The game title as the model holds it now, saved or not. */
  readonly gameTitle: string;
}

/** An immutable view of a main-file document at one moment. A new object is made for every change; an unchanged document returns the same object. */
export type MainDocumentSnapshot = DocumentSnapshot<MainCommand> & MainDocumentFields;

/** The document a view binds to: `getSnapshot()` and `subscribe()` (ADR 0025 decision 4), and the commands. */
export type MainDocument = EditorDocument<MainDocumentSnapshot, MainCommand>;

export type OpenResult = GenericOpenResult<MainDocument>;

/**
 * `null` when the writer reproduces `bytes` exactly, which is what a same-version writer means for this file. A
 * Toolkit 2 text main file is named as such first: `readMainFile` tells it from a binary one by the byte after the magic
 * (`formats/README.md#header-and-version`), and the binary writer has no text form, so what it would say about the
 * model (its reserved runs are empty, because a text file has none) is not the reason.
 */
function readOnlyReason(model: MainFile, bytes: Uint8Array): ReadOnlyReason | null {
  const probe = new BinaryReader(bytes).isBinaryAt(MAIN_MAGIC.length);
  if (probe.ok && !probe.value) {
    return {
      code: "no-same-version-writer",
      message: `This is a Toolkit 2 text main file, and the editor has no writer for the text form, so it is shown read-only and never converted on open.`,
    };
  }
  const written = writeMainFile(model);
  if (!written.ok) {
    return {
      code: "no-same-version-writer",
      message: `This main file (minor ${model.minor}) has no writer that keeps its version: ${written.error.message}`,
    };
  }
  const first = firstDifference(written.value, bytes);
  if (first === null) return null;
  return {
    code: "no-same-version-writer",
    message: `The writer does not reproduce this main file (minor ${model.minor}) byte for byte; the first difference is at offset ${first}.`,
  };
}

/**
 * Refuse a command whose result the writer could not store or the reader would not give back: the model is encoded and
 * read again, and the title must come back as it went in (a character with no Windows-1252 byte, or a NUL that would end
 * the stored string early, fails here, whole, before the document changes).
 */
function refusalOf(next: MainFile, command: MainCommand): Rejection | null {
  const written = writeMainFile(next);
  if (!written.ok) return { reason: "invalid", message: written.error.message };
  const reread = readMainFile(new BinaryReader(written.value));
  if (!reread.ok || reread.value.gameTitle !== command.title) {
    return { reason: "invalid", message: "The game title cannot be stored in the file exactly as typed." };
  }
  return null;
}

/** The main file's codec (`docs/spec/formats/main-file.md`). */
export const mainCodec: DocumentCodec<MainFile, MainCommand, MainDocumentFields> = {
  kind: "main",
  read: (bytes, path) => readMainFile(new BinaryReader(bytes, path)),
  write: writeMainFile,
  readOnlyReason,
  apply: (model, command) => ({ ...model, gameTitle: command.title }),
  label: (command) => `Set game title to "${command.title}"`,
  refuse: refusalOf,
  summary: (model) => model.gameTitle,
  fields: (model) => ({ minor: model.minor, gameTitle: model.gameTitle }),
};

/** Read the file at `identity.path` through `storage` and open it. */
export function openMainDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<OpenResult> {
  return openBinaryDocument(mainCodec, storage, identity);
}

/** Open a main-file document over bytes already in hand (see `createBinaryDocument`). */
export function createMainDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): OpenResult {
  return createBinaryDocument(mainCodec, storage, identity, bytes);
}

export type { BinaryDocument };
