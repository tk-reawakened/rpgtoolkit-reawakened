import type { DocumentCodec, Rejection } from "./binary-document.ts";

/**
 * Text typed into a form field that is not a value the file can store yet (`-`, `1.5`, a number out of range, a character
 * the code page cannot hold) — #3385. It is part of the document, not of the view: the command that holds it is an edit
 * like any other, so the document is unsaved, every host's Save All and close prompt see it, Undo takes it back, and a
 * save refuses with its sentence and writes nothing (`DocumentCodec.unsaved`). Typing a value the file can store in the
 * same field replaces it. Backups and `serialize` keep the stored values only.
 */
export interface HeldText {
  readonly text: string;
  /** Why the text is not a value yet, in the field's own words. */
  readonly message: string;
}

export interface HoldFieldTextCommand {
  readonly type: "hold-field-text";
  readonly field: string;
  /** `null` discards the text the field holds, so it shows its stored value again. */
  readonly text: string | null;
  readonly message: string;
}

export interface HeldModel<Model> {
  readonly value: Model;
  /** Field id → the text it holds. Absent fields show the stored value. */
  readonly held: Readonly<Record<string, HeldText>>;
}

export interface HeldFields {
  /** Field id → text typed there that is not a value yet. */
  readonly heldText: Readonly<Record<string, HeldText>>;
}

const NO_HELD: Readonly<Record<string, HeldText>> = Object.freeze({});

function without(held: Readonly<Record<string, HeldText>>, field: string): Readonly<Record<string, HeldText>> {
  if (!(field in held)) return held;
  const next = { ...held };
  delete next[field];
  return Object.keys(next).length === 0 ? NO_HELD : next;
}

function isHold(value: unknown, fields: readonly string[]): value is HoldFieldTextCommand {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "hold-field-text" && fields.includes(record.field as string) && (typeof record.text === "string" || record.text === null) && typeof record.message === "string";
}

/**
 * Give `codec` held field text. `fieldOf` names the form field an inner command sets (`null` for one that sets no typed
 * field, such as a check box); `fields` is every field that may hold text and `labels` how its undo entry names it.
 */
export function withHeldText<Model, Command, Fields extends object>(
  codec: DocumentCodec<Model, Command, Fields>,
  fieldOf: (command: Command) => string | null,
  labels: Readonly<Record<string, string>>,
): DocumentCodec<HeldModel<Model>, Command | HoldFieldTextCommand, Fields & HeldFields> {
  const fields = Object.keys(labels);
  const wrap = (value: Model, held: Readonly<Record<string, HeldText>>): HeldModel<Model> => ({ value, held });
  return {
    kind: codec.kind,
    read: (bytes, path) => {
      const read = codec.read(bytes, path);
      return read.ok ? { ...read, value: wrap(read.value, NO_HELD) } : read;
    },
    write: (model) => codec.write(model.value),
    readOnlyReason: (model, bytes) => codec.readOnlyReason(model.value, bytes),
    isCommand: (value): value is Command | HoldFieldTextCommand => isHold(value, fields) || codec.isCommand(value),
    apply: (model, command) => {
      if (isHold(command, fields)) {
        if (command.text === null) {
          const held = without(model.held, command.field);
          return held === model.held ? model : wrap(model.value, held);
        }
        const current = model.held[command.field];
        if (current?.text === command.text && current.message === command.message) return model;
        return wrap(model.value, { ...model.held, [command.field]: { text: command.text, message: command.message } });
      }
      const inner = command as Command;
      const value = codec.apply(model.value, inner);
      const field = fieldOf(inner);
      const held = field === null ? model.held : without(model.held, field);
      return value === model.value && held === model.held ? model : wrap(value, held);
    },
    label: (command) => isHold(command, fields)
      ? `${command.text === null ? "Discard the text typed in" : "Type in"} ${labels[command.field] ?? command.field}`
      : codec.label(command as Command),
    refuse: (next, command, previous): Rejection | null => {
      if (isHold(command, fields)) {
        return next === previous ? { reason: "invalid", message: "That field already holds this text.", unchanged: true } : null;
      }
      // A stored value typed back into a field that held text clears the text: that is a change even though the value is the same.
      if (next.value === previous.value && next.held !== previous.held) return null;
      return codec.refuse(next.value, command as Command, previous.value);
    },
    summary: (model) => codec.summary(model.value),
    fields: (model) => ({ ...codec.fields(model.value), heldText: model.held }),
    unsaved: (model) => {
      const first = fields.find((field) => model.held[field] !== undefined);
      if (first === undefined) return codec.unsaved?.(model.value) ?? null;
      return `the ${labels[first]} holds "${model.held[first]!.text}", which is not a value yet (${model.held[first]!.message}). Correct it or undo the typing.`;
    },
  };
}
