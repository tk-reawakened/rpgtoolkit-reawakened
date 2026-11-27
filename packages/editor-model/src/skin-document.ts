import { err, ok, utf8Decode, utf8Encode, type Result } from "@tk-reawakened/core";
import { readSkin, setSkinImage, type Skin, type SkinImageField } from "@tk-reawakened/native-data";
import {
  createBinaryDocument,
  openBinaryDocument,
  type DocumentCodec,
  type DocumentSnapshot,
  type DocumentStorage,
  type EditorDocument,
  type OpenResult as GenericOpenResult,
  type Rejection,
} from "./binary-document.ts";
import type { DocumentIdentity } from "./identity.ts";

export type NativeSkinCommand = { readonly type: "set-native-skin-image"; readonly field: SkinImageField; readonly reference: string };
export interface NativeSkinModel { readonly text: string; readonly skin: Skin }
export type NativeSkinSnapshot = DocumentSnapshot<NativeSkinCommand> & { readonly skin: Skin };
export type NativeSkinDocument = EditorDocument<NativeSkinSnapshot, NativeSkinCommand>;
export type NativeSkinOpenResult = GenericOpenResult<NativeSkinDocument>;

function decode(bytes: Uint8Array): string | null {
  try { return utf8Decode(bytes); } catch { return null; }
}

function read(bytes: Uint8Array, path: string): Result<NativeSkinModel> {
  const text = decode(bytes);
  if (text === null) return err({ offset: 0, section: "docs/spec/formats/native-skin.md", message: `Invalid UTF-8 in native skin ${path}; the file was not opened.` });
  const result = readSkin(text);
  return result.ok
    ? ok({ text, skin: result.skin })
    : err({ offset: 0, section: "docs/spec/formats/native-skin.md", message: result.problems.map((entry) => `${entry.path}: ${entry.message}`).join("\n") });
}

const write = (model: NativeSkinModel): Result<Uint8Array> => ok(utf8Encode(model.text));

function isCommand(value: unknown): value is NativeSkinCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  return command.type === "set-native-skin-image"
    && (command.field === "windowImage" || command.field === "buttonImage")
    && typeof command.reference === "string";
}

function edit(model: NativeSkinModel, command: NativeSkinCommand): NativeSkinModel | null {
  const result = setSkinImage(model.text, command.field, command.reference);
  if (!result.ok) return null;
  const parsed = readSkin(result.text);
  return parsed.ok ? { text: result.text, skin: parsed.skin } : null;
}

const codec: DocumentCodec<NativeSkinModel, NativeSkinCommand, { readonly skin: Skin }> = {
  kind: "skin",
  read,
  write,
  readOnlyReason: () => null,
  isCommand,
  apply: (model, command) => edit(model, command) ?? model,
  label: (command) => command.field === "windowImage" ? "Set window graphic" : "Set button graphic",
  refuse: (next, command, previous): Rejection | null => {
    if (!isCommand(command)) return { reason: "invalid", message: "Invalid native skin image command." };
    return next.text === previous.text
      ? { reason: "invalid", message: "The skin image change is invalid, unsupported, or changes nothing." }
      : null;
  },
  summary: (model) => model.skin.label === undefined ? "Native skin" : `Native skin: ${model.skin.label}`,
  fields: (model) => ({ skin: model.skin }),
};

export const nativeSkinCodec = codec;
export function openNativeSkinDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<NativeSkinOpenResult> {
  return openBinaryDocument(codec, storage, identity);
}
export function createNativeSkinDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): NativeSkinOpenResult {
  return createBinaryDocument(codec, storage, identity, bytes);
}
