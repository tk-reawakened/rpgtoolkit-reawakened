import { BinaryReader, readBattleBackground, writeBattleBackground, type BattleBackground } from "@tk-reawakened/core";
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
import { invalid, storableText, textFormReason } from "./battle-data-fields.ts";
import type { DocumentIdentity } from "./identity.ts";
import { withHeldText, type HeldFields, type HoldFieldTextCommand } from "./held-text.ts";

/** The six references stored by a fight background (`docs/spec/formats/battle-data.md#battle-background-editor-rules`). */
export const BATTLE_BACKGROUND_TEXT_FIELDS = ["image", "music", "selectSound", "chooseSound", "readySound", "cantDoSound"] as const;
export type BattleBackgroundTextField = (typeof BATTLE_BACKGROUND_TEXT_FIELDS)[number];

export type BattleBackgroundFieldCommand = {
  readonly type: "set-battle-background-text";
  readonly field: BattleBackgroundTextField;
  readonly value: string;
};
export type BattleBackgroundCommand = BattleBackgroundFieldCommand | HoldFieldTextCommand;

export interface BattleBackgroundDocumentFields {
  readonly major: number;
  readonly minor: number;
  readonly image: string;
  readonly music: string;
  readonly selectSound: string;
  readonly chooseSound: string;
  readonly readySound: string;
  readonly cantDoSound: string;
  readonly residueBytes: number;
}
export type BattleBackgroundDocumentSnapshot = DocumentSnapshot<BattleBackgroundCommand> & BattleBackgroundDocumentFields & HeldFields;
export type BattleBackgroundDocument = EditorDocument<BattleBackgroundDocumentSnapshot, BattleBackgroundCommand>;
export type BattleBackgroundOpenResult = GenericOpenResult<BattleBackgroundDocument>;

const LABELS: Readonly<Record<BattleBackgroundTextField, string>> = {
  image: "background image", music: "battle music", selectSound: "menu cursor sound", chooseSound: "menu choice sound",
  readySound: "fighter ready sound", cantDoSound: "action unavailable sound",
};

function modelField(field: BattleBackgroundTextField): keyof BattleBackground {
  return field === "selectSound" ? "menuMoveSound" : field === "chooseSound" ? "menuChooseSound" : field;
}

function apply(model: BattleBackground, command: BattleBackgroundFieldCommand): BattleBackground {
  const field = modelField(command.field);
  return model[field] === command.value ? model : { ...model, [field]: command.value };
}

function refuse(next: BattleBackground, command: BattleBackgroundFieldCommand, previous: BattleBackground): Rejection | null {
  if (previous.minor === 0) return invalid(textFormReason("fight background").message);
  if (!storableText(command.value)) return invalid(`The ${LABELS[command.field]} cannot hold a NUL character.`);
  if (next === previous) return invalid(`The ${LABELS[command.field]} already has that value.`);
  const encoded = writeBattleBackground(next);
  if (!encoded.ok) return invalid(encoded.error.message);
  const checked = readBattleBackground(new BinaryReader(encoded.value));
  if (!checked.ok || checked.value.major !== next.major || checked.value.minor !== next.minor) return invalid("That edit cannot be written and read back in this fight background's format version.");
  if (checked.value[modelField(command.field)] !== command.value) return invalid(`The ${LABELS[command.field]} cannot be stored exactly as entered.`);
  return null;
}

function readOnlyReason(model: BattleBackground, bytes: Uint8Array): ReadOnlyReason | null {
  if (model.minor === 0) return textFormReason("fight background");
  const encoded = writeBattleBackground(model);
  if (!encoded.ok) return { code: "no-same-version-writer", message: `This fight background has no same-version writer: ${encoded.error.message}` };
  const first = firstDifference(encoded.value, bytes);
  return first === null ? null : { code: "no-same-version-writer", message: `The fight background writer does not reproduce this file byte for byte; it is read-only (first difference at offset ${first}).` };
}

function isCommand(value: unknown): value is BattleBackgroundFieldCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === "set-battle-background-text"
    && (BATTLE_BACKGROUND_TEXT_FIELDS as readonly unknown[]).includes(record.field)
    && typeof record.value === "string";
}

const fieldCodec: DocumentCodec<BattleBackground, BattleBackgroundFieldCommand, BattleBackgroundDocumentFields> = {
  kind: "battle-background",
  read: (bytes, path) => readBattleBackground(new BinaryReader(bytes, path)),
  write: writeBattleBackground,
  readOnlyReason,
  isCommand,
  apply,
  refuse,
  label: (command) => `Set fight background ${LABELS[command.field]}`,
  summary: (model) => `Fight background: ${model.image || "no picture"}`,
  fields: (model) => ({
    major: model.major,
    minor: model.minor,
    image: model.image,
    music: model.music,
    selectSound: model.menuMoveSound,
    chooseSound: model.menuChooseSound,
    readySound: model.readySound,
    cantDoSound: model.cantDoSound,
    residueBytes: model.residue.length,
  }),
};

export const battleBackgroundCodec = withHeldText(fieldCodec, (command) => command.field, LABELS);

export function openBattleBackgroundDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<BattleBackgroundOpenResult> {
  return openBinaryDocument(battleBackgroundCodec, storage, identity);
}

export function createBattleBackgroundDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): BattleBackgroundOpenResult {
  return createBinaryDocument(battleBackgroundCodec, storage, identity, bytes);
}
