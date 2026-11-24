import { BinaryReader, readSpecialMove, writeSpecialMove, type SpecialMove } from "@tk-reawakened/core";
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
import { fitsInt, intRangeMessage, invalid, storableText, textFormReason } from "./battle-data-fields.ts";
import type { DocumentIdentity } from "./identity.ts";

/**
 * The special move document (`docs/spec/formats/battle-data.md#special-move-spc`, story 13.10, T-57): the `.spc` file as a
 * form of its stored fields. The model is the core reader's, so `minor`, `major` and any bytes after the last field are
 * kept and written back as read. The usability bytes are shown inverted as the format ruled: stored 0 is usable
 * (`docs/spec/formats/battle-data.md#battle-data-editor-rules`).
 */

export const SPECIAL_MOVE_TEXT_FIELDS = ["name", "program", "statusEffect", "animation", "description"] as const;
export const SPECIAL_MOVE_AMOUNT_FIELDS = ["damage", "smpCost", "targetSmpDrain"] as const;
export type SpecialMoveTextField = (typeof SPECIAL_MOVE_TEXT_FIELDS)[number];
export type SpecialMoveAmountField = (typeof SPECIAL_MOVE_AMOUNT_FIELDS)[number];
export type SpecialMoveUseContext = "battle" | "menu";

export type SpecialMoveCommand =
  | { readonly type: "set-special-move-text"; readonly field: SpecialMoveTextField; readonly value: string }
  | { readonly type: "set-special-move-amount"; readonly field: SpecialMoveAmountField; readonly value: number }
  | { readonly type: "set-special-move-usable"; readonly context: SpecialMoveUseContext; readonly usable: boolean };

export interface SpecialMoveDocumentFields {
  readonly major: number;
  readonly minor: number;
  readonly name: string;
  /** FP removed from the target's HP; negative heals. */
  readonly damage: number;
  /** SMP deducted from the user. */
  readonly smpCost: number;
  readonly program: string;
  /** SMP deducted from the target. */
  readonly targetSmpDrain: number;
  readonly statusEffect: string;
  readonly animation: string;
  readonly description: string;
  /** True exactly when the stored battle byte is 0. */
  readonly usableInBattle: boolean;
  /** True exactly when the stored menu byte is 0. */
  readonly usableFromMenu: boolean;
  /** The stored battle byte, as the file holds it. */
  readonly battleByte: number;
  /** The stored menu byte, as the file holds it. */
  readonly menuByte: number;
  /** Bytes after the last documented field, kept untouched. */
  readonly residueBytes: number;
}

export type SpecialMoveDocumentSnapshot = DocumentSnapshot<SpecialMoveCommand> & SpecialMoveDocumentFields;
export type SpecialMoveDocument = EditorDocument<SpecialMoveDocumentSnapshot, SpecialMoveCommand>;
export type SpecialMoveOpenResult = GenericOpenResult<SpecialMoveDocument>;

const TEXT_LABELS: Readonly<Record<SpecialMoveTextField, string>> = {
  name: "name", program: "program", statusEffect: "status effect", animation: "animation", description: "description",
};
const AMOUNT_LABELS: Readonly<Record<SpecialMoveAmountField, string>> = {
  damage: "damage (FP)", smpCost: "SMP cost", targetSmpDrain: "target SMP drain",
};

/** The byte a flag holds once the author chooses `usable`, or `null` when it already says so (an authored `-1` stays `-1`). */
function usabilityByte(current: number, usable: boolean): number | null {
  if (usable) return current === 0 ? null : 0;
  return current !== 0 ? null : 1;
}

function apply(model: SpecialMove, command: SpecialMoveCommand): SpecialMove {
  if (command.type === "set-special-move-text") return model[command.field] === command.value ? model : { ...model, [command.field]: command.value };
  if (command.type === "set-special-move-amount") return model[command.field] === command.value ? model : { ...model, [command.field]: command.value };
  const key = command.context === "battle" ? "usableInBattle" : "usableFromMenu";
  const next = usabilityByte(model[key], command.usable);
  return next === null ? model : { ...model, [key]: next };
}

function refuse(next: SpecialMove, command: SpecialMoveCommand, previous: SpecialMove): Rejection | null {
  if (previous.minor === 0) return invalid(textFormReason("special move").message);
  if (command.type === "set-special-move-text") {
    if (!storableText(command.value)) return invalid(`The ${TEXT_LABELS[command.field]} cannot hold a NUL character.`);
  } else if (command.type === "set-special-move-amount") {
    if (!fitsInt(command.value, "i32")) return invalid(intRangeMessage(`The ${AMOUNT_LABELS[command.field]}`, "i32"));
  }
  if (next === previous) {
    if (command.type === "set-special-move-usable") {
      return invalid(`The special move is already ${command.usable ? "usable" : "not usable"} ${command.context === "battle" ? "in battle" : "from the menu"}.`);
    }
    return invalid("That special move already has the requested value.");
  }
  const encoded = writeSpecialMove(next);
  if (!encoded.ok) return invalid(encoded.error.message);
  const checked = readSpecialMove(new BinaryReader(encoded.value));
  if (!checked.ok || checked.value.minor !== next.minor) return invalid("That edit cannot be written and read back in this special move's format version.");
  if (command.type === "set-special-move-text" && checked.value[command.field] !== command.value) {
    return invalid(`The ${TEXT_LABELS[command.field]} cannot be stored exactly as entered.`);
  }
  return null;
}

function readOnlyReason(model: SpecialMove, bytes: Uint8Array): ReadOnlyReason | null {
  if (model.minor === 0) return textFormReason("special move");
  const encoded = writeSpecialMove(model);
  if (!encoded.ok) return { code: "no-same-version-writer", message: `This special move has no same-version writer: ${encoded.error.message}` };
  const first = firstDifference(encoded.value, bytes);
  if (first === null) return null;
  return { code: "no-same-version-writer", message: `The special move writer does not reproduce this file byte for byte; it is read-only (first difference at offset ${first}).` };
}

function isSpecialMoveCommand(value: unknown): value is SpecialMoveCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "set-special-move-text") return (SPECIAL_MOVE_TEXT_FIELDS as readonly unknown[]).includes(record.field) && typeof record.value === "string";
  if (record.type === "set-special-move-amount") return (SPECIAL_MOVE_AMOUNT_FIELDS as readonly unknown[]).includes(record.field) && typeof record.value === "number";
  return record.type === "set-special-move-usable" && (record.context === "battle" || record.context === "menu") && typeof record.usable === "boolean";
}

function label(command: SpecialMoveCommand): string {
  if (command.type === "set-special-move-text") return `Set special move ${TEXT_LABELS[command.field]}`;
  if (command.type === "set-special-move-amount") return `Set special move ${AMOUNT_LABELS[command.field]} to ${command.value}`;
  return `Make special move ${command.usable ? "usable" : "not usable"} ${command.context === "battle" ? "in battle" : "from the menu"}`;
}

export const specialMoveCodec: DocumentCodec<SpecialMove, SpecialMoveCommand, SpecialMoveDocumentFields> = {
  kind: "special-move",
  read: (bytes, path) => readSpecialMove(new BinaryReader(bytes, path)),
  write: writeSpecialMove,
  readOnlyReason,
  isCommand: isSpecialMoveCommand,
  apply,
  label,
  refuse,
  summary: (model) => `Special move: ${model.name}`,
  fields: (model) => ({
    major: model.major,
    minor: model.minor,
    name: model.name,
    damage: model.damage,
    smpCost: model.smpCost,
    program: model.program,
    targetSmpDrain: model.targetSmpDrain,
    statusEffect: model.statusEffect,
    animation: model.animation,
    description: model.description,
    usableInBattle: model.usableInBattle === 0,
    usableFromMenu: model.usableFromMenu === 0,
    battleByte: model.usableInBattle,
    menuByte: model.usableFromMenu,
    residueBytes: model.residue.length,
  }),
};

export function openSpecialMoveDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<SpecialMoveOpenResult> {
  return openBinaryDocument(specialMoveCodec, storage, identity);
}

export function createSpecialMoveDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): SpecialMoveOpenResult {
  return createBinaryDocument(specialMoveCodec, storage, identity, bytes);
}
