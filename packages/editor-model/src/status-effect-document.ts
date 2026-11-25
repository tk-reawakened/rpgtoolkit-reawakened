import { BinaryReader, readStatusEffect, writeStatusEffect, type StatusEffect } from "@tk-reawakened/core";
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
import { withHeldText, type HeldFields, type HoldFieldTextCommand } from "./held-text.ts";

/**
 * The status effect document (`docs/spec/formats/battle-data.md#status-effect`, story 13.10, T-58): the `.ste` file as a
 * form of its stored fields. The model is the core reader's, so `minor`, `major` and any bytes after the program are kept
 * and written back as read. A flag is on exactly when its stored value is non-zero, and an authored `-1` or `7` survives
 * until the author turns the flag off (`docs/spec/formats/battle-data.md#battle-data-editor-rules`).
 */

export const STATUS_EFFECT_TEXT_FIELDS = ["name", "program"] as const;
export const STATUS_EFFECT_NUMBER_FIELDS = ["rounds", "hpPerRound", "smpPerRound"] as const;
export const STATUS_EFFECT_FLAG_FIELDS = ["speedUp", "slowDown", "disable", "hpEnabled", "smpEnabled", "runProgram"] as const;
export type StatusEffectTextField = (typeof STATUS_EFFECT_TEXT_FIELDS)[number];
export type StatusEffectNumberField = (typeof STATUS_EFFECT_NUMBER_FIELDS)[number];
export type StatusEffectFlagField = (typeof STATUS_EFFECT_FLAG_FIELDS)[number];

export type StatusEffectFieldCommand =
  | { readonly type: "set-status-effect-text"; readonly field: StatusEffectTextField; readonly value: string }
  | { readonly type: "set-status-effect-number"; readonly field: StatusEffectNumberField; readonly value: number }
  | { readonly type: "set-status-effect-flag"; readonly field: StatusEffectFlagField; readonly enabled: boolean };

/** A field command, or text held in a field that is not a value yet (#3385). */
export type StatusEffectCommand = StatusEffectFieldCommand | HoldFieldTextCommand;

export interface StatusEffectDocumentFields {
  readonly major: number;
  readonly minor: number;
  readonly name: string;
  /** How many rounds it lasts, as stored. */
  readonly rounds: number;
  /** HP changed each round while the HP flag is on; negative heals. */
  readonly hpPerRound: number;
  /** SMP changed each round while the SMP flag is on; negative restores. */
  readonly smpPerRound: number;
  readonly program: string;
  /** Each flag is on exactly when its stored value is non-zero. */
  readonly speedUp: boolean;
  readonly slowDown: boolean;
  readonly disable: boolean;
  readonly hpEnabled: boolean;
  readonly smpEnabled: boolean;
  readonly runProgram: boolean;
  /** The stored values behind the flags, as the file holds them. */
  readonly rawFlags: Readonly<Record<StatusEffectFlagField, number>>;
  /** Bytes after the program, kept untouched. */
  readonly residueBytes: number;
}

export type StatusEffectDocumentSnapshot = DocumentSnapshot<StatusEffectCommand> & StatusEffectDocumentFields & HeldFields;
export type StatusEffectDocument = EditorDocument<StatusEffectDocumentSnapshot, StatusEffectCommand>;
export type StatusEffectOpenResult = GenericOpenResult<StatusEffectDocument>;

const TEXT_LABELS: Readonly<Record<StatusEffectTextField, string>> = { name: "name", program: "program" };
const NUMBER_LABELS: Readonly<Record<StatusEffectNumberField, string>> = {
  rounds: "rounds", hpPerRound: "HP per round", smpPerRound: "SMP per round",
};
const FLAG_LABELS: Readonly<Record<StatusEffectFlagField, string>> = {
  speedUp: "speed up", slowDown: "slow down", disable: "disable", hpEnabled: "HP change", smpEnabled: "SMP change", runProgram: "program",
};

function apply(model: StatusEffect, command: StatusEffectFieldCommand): StatusEffect {
  if (command.type === "set-status-effect-text" || command.type === "set-status-effect-number") {
    return model[command.field] === command.value ? model : { ...model, [command.field]: command.value };
  }
  const current = model[command.field];
  // Turning on a flag that is already non-zero keeps the authored value; turning one off writes 0.
  if (command.enabled ? current !== 0 : current === 0) return model;
  return { ...model, [command.field]: command.enabled ? 1 : 0 };
}

function refuse(next: StatusEffect, command: StatusEffectFieldCommand, previous: StatusEffect): Rejection | null {
  if (previous.minor === 0) return invalid(textFormReason("status effect").message);
  if (command.type === "set-status-effect-text") {
    if (!storableText(command.value)) return invalid(`The ${TEXT_LABELS[command.field]} cannot hold a NUL character.`);
  } else if (command.type === "set-status-effect-number") {
    if (!fitsInt(command.value, "i16")) return invalid(intRangeMessage(`The ${NUMBER_LABELS[command.field]}`, "i16"));
  }
  if (next === previous) {
    if (command.type === "set-status-effect-flag") return invalid(`The status effect's ${FLAG_LABELS[command.field]} is already ${command.enabled ? "on" : "off"}.`);
    return invalid("That status effect already has the requested value.");
  }
  const encoded = writeStatusEffect(next);
  if (!encoded.ok) return invalid(encoded.error.message);
  const checked = readStatusEffect(new BinaryReader(encoded.value));
  if (!checked.ok || checked.value.minor !== next.minor) return invalid("That edit cannot be written and read back in this status effect's format version.");
  if (command.type === "set-status-effect-text" && checked.value[command.field] !== command.value) {
    return invalid(`The ${TEXT_LABELS[command.field]} cannot be stored exactly as entered.`);
  }
  return null;
}

function readOnlyReason(model: StatusEffect, bytes: Uint8Array): ReadOnlyReason | null {
  if (model.minor === 0) return textFormReason("status effect");
  const encoded = writeStatusEffect(model);
  if (!encoded.ok) return { code: "no-same-version-writer", message: `This status effect has no same-version writer: ${encoded.error.message}` };
  const first = firstDifference(encoded.value, bytes);
  if (first === null) return null;
  return { code: "no-same-version-writer", message: `The status effect writer does not reproduce this file byte for byte; it is read-only (first difference at offset ${first}).` };
}

function isStatusEffectCommand(value: unknown): value is StatusEffectFieldCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "set-status-effect-text") return (STATUS_EFFECT_TEXT_FIELDS as readonly unknown[]).includes(record.field) && typeof record.value === "string";
  if (record.type === "set-status-effect-number") return (STATUS_EFFECT_NUMBER_FIELDS as readonly unknown[]).includes(record.field) && typeof record.value === "number";
  return record.type === "set-status-effect-flag" && (STATUS_EFFECT_FLAG_FIELDS as readonly unknown[]).includes(record.field) && typeof record.enabled === "boolean";
}

function label(command: StatusEffectFieldCommand): string {
  if (command.type === "set-status-effect-text") return `Set status effect ${TEXT_LABELS[command.field]}`;
  if (command.type === "set-status-effect-number") return `Set status effect ${NUMBER_LABELS[command.field]} to ${command.value}`;
  return `Turn status effect ${FLAG_LABELS[command.field]} ${command.enabled ? "on" : "off"}`;
}

const statusEffectFieldCodec: DocumentCodec<StatusEffect, StatusEffectFieldCommand, StatusEffectDocumentFields> = {
  kind: "status-effect",
  read: (bytes, path) => readStatusEffect(new BinaryReader(bytes, path)),
  write: writeStatusEffect,
  readOnlyReason,
  isCommand: isStatusEffectCommand,
  apply,
  label,
  refuse,
  summary: (model) => `Status effect: ${model.name}`,
  fields: (model) => ({
    major: model.major,
    minor: model.minor,
    name: model.name,
    rounds: model.rounds,
    hpPerRound: model.hpPerRound,
    smpPerRound: model.smpPerRound,
    program: model.program,
    speedUp: model.speedUp !== 0,
    slowDown: model.slowDown !== 0,
    disable: model.disable !== 0,
    hpEnabled: model.hpEnabled !== 0,
    smpEnabled: model.smpEnabled !== 0,
    runProgram: model.runProgram !== 0,
    rawFlags: {
      speedUp: model.speedUp, slowDown: model.slowDown, disable: model.disable,
      hpEnabled: model.hpEnabled, smpEnabled: model.smpEnabled, runProgram: model.runProgram,
    },
    residueBytes: model.residue.length,
  }),
};

/** The codec the editor opens: the field codec with text held in a field that is not a value yet (#3385). */
export const statusEffectCodec = withHeldText(statusEffectFieldCodec, (command) => command.type === "set-status-effect-flag" ? null : command.field, { ...TEXT_LABELS, ...NUMBER_LABELS });

export function openStatusEffectDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<StatusEffectOpenResult> {
  return openBinaryDocument(statusEffectCodec, storage, identity);
}

export function createStatusEffectDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): StatusEffectOpenResult {
  return createBinaryDocument(statusEffectCodec, storage, identity, bytes);
}
