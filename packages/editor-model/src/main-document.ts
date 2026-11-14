import { BinaryReader, MAIN_MAGIC, readMainFile, writeMainFile, type MainFile } from "@tk-reawakened/core";
import {
  MAIN_SETTINGS,
  MAIN_SETTING_KEYS,
  applyMainSettings,
  changedSettings,
  mainSettingsNotes,
  mainSettingsOf,
  pluginSources,
  settingsErrors,
  type MainSettings,
  type MainSettingsChanges,
  type PluginSource,
  type SettingsNote,
} from "./game-settings.ts";
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

/** Set the game title (`docs/spec/formats/main-file.md#layout`, row 7, `gameTitle`): the tracer's one-field edit. */
export interface SetGameTitleCommand {
  readonly type: "set-game-title";
  readonly title: string;
}

/** Apply a staged set of game settings (editor-features T-10 to T-14) as one edit. */
export interface ApplySettingsCommand {
  readonly type: "apply-settings";
  readonly changes: MainSettingsChanges;
}

/** Every command a main-file document accepts. Plain data, so a stack of them can be stored and replayed. */
export type MainCommand = SetGameTitleCommand | ApplySettingsCommand;

/** What a main file adds to the shared snapshot. Plain data, so it crosses a webview bridge unchanged. */
export interface MainDocumentFields {
  /** The minor version the file was opened at and is saved at (AD-18). */
  readonly minor: number;
  /** The game title as the model holds it now, saved or not. */
  readonly gameTitle: string;
  /** Every editable game setting as the model holds it now; a row the minor does not store shows the engine's value. */
  readonly settings: MainSettings;
  /** What the editor discloses about the file: unsupported legacy values, rows this version does not store, data kept. */
  readonly notes: readonly SettingsNote[];
  /** The packages the game starts with beyond the engine's own, each with the row or block that names it. */
  readonly plugins: readonly PluginSource[];
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
 * read again, and what the command set must come back as it went in (a character with no Windows-1252 byte, or a NUL
 * that would end the stored string early, fails here, whole, before the document changes). Staged settings are checked
 * by `settingsErrors` first, so a refusal names the field.
 */
function refusalOf(next: MainFile, command: MainCommand, previous: MainFile): Rejection | null {
  if (command.type === "apply-settings") {
    const current = mainSettingsOf(previous);
    const errors = settingsErrors(command.changes, current, previous.minor);
    if (errors.length > 0) return { reason: "invalid", message: errors.map((issue) => issue.message).join(" ") };
    if (Object.keys(changedSettings(command.changes, current)).length === 0) return { reason: "invalid", message: "These settings are already in force." };
  }
  const written = writeMainFile(next);
  if (!written.ok) return { reason: "invalid", message: written.error.message };
  const reread = readMainFile(new BinaryReader(written.value));
  if (command.type === "set-game-title") {
    if (!reread.ok || reread.value.gameTitle !== command.title) {
      return { reason: "invalid", message: "The game title cannot be stored in the file exactly as typed." };
    }
    return null;
  }
  if (!reread.ok) return { reason: "invalid", message: reread.error.message };
  const stored = mainSettingsOf(reread.value);
  const wanted = mainSettingsOf(next);
  const lost = MAIN_SETTING_KEYS.filter((key) => command.changes[key] !== undefined && JSON.stringify(stored[key]) !== JSON.stringify(wanted[key]));
  if (lost.length > 0) {
    return { reason: "invalid", message: `The file cannot store ${lost.map((key) => MAIN_SETTINGS[key].label.toLowerCase()).join(", ")} exactly as entered.` };
  }
  return null;
}

/** Whether a value from a webview is an `apply-settings` command whose every value has its setting's shape. */
function isSettingsChanges(value: unknown): value is MainSettingsChanges {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const isText = (item: unknown): item is string => typeof item === "string";
  const isNumber = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item);
  // An object whose named fields each pass their check (a colour, a run-time key slot, an enemy slot).
  const hasFields = (item: unknown, checks: Readonly<Record<string, (field: unknown) => boolean>>): boolean =>
    typeof item === "object" && item !== null && !Array.isArray(item)
    && Object.entries(checks).every(([name, check]) => check((item as Readonly<Record<string, unknown>>)[name]));
  return Object.entries(value).every(([key, item]) => {
    if (!Object.prototype.hasOwnProperty.call(MAIN_SETTINGS, key)) return false;
    switch (MAIN_SETTINGS[key as keyof MainSettings].shape) {
      case "text": return isText(item);
      case "font": return item === null || isText(item);
      case "flag": return typeof item === "boolean";
      case "integer":
      case "choice": return isNumber(item);
      case "colour": return hasFields(item, { r: isNumber, g: isNumber, b: isNumber });
      case "scan-codes": return Array.isArray(item) && item.every(isNumber);
      case "ext-keys": return Array.isArray(item) && item.every((row) => hasFields(row, { asciiKey: isNumber, program: isText }));
      case "enemies": return Array.isArray(item) && item.every((row) => hasFields(row, { enemyFile: isText, skillLevel: isNumber }));
      case "names": return Array.isArray(item) && item.every(isText);
    }
  });
}

function isMainCommand(value: unknown): value is MainCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "set-game-title") return "title" in value && typeof value.title === "string";
  return value.type === "apply-settings" && "changes" in value && isSettingsChanges(value.changes);
}

function labelOf(command: MainCommand): string {
  if (command.type === "set-game-title") return `Set game title to "${command.title}"`;
  const names = MAIN_SETTING_KEYS.filter((key) => command.changes[key] !== undefined).map((key) => MAIN_SETTINGS[key].label.toLowerCase());
  return names.length === 1 ? `Change ${names[0]}` : `Change ${names.length} game settings`;
}

/** The main file's codec (`docs/spec/formats/main-file.md`). */
export const mainCodec: DocumentCodec<MainFile, MainCommand, MainDocumentFields> = {
  kind: "main",
  read: (bytes, path) => readMainFile(new BinaryReader(bytes, path)),
  write: writeMainFile,
  readOnlyReason,
  isCommand: isMainCommand,
  apply: (model, command) => (command.type === "set-game-title" ? { ...model, gameTitle: command.title } : applyMainSettings(model, command.changes)),
  label: labelOf,
  refuse: refusalOf,
  summary: (model) => model.gameTitle,
  fields: (model) => ({ minor: model.minor, gameTitle: model.gameTitle, settings: mainSettingsOf(model), notes: mainSettingsNotes(model), plugins: pluginSources(model) }),
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
