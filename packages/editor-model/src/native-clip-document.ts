import { err, ok, utf8Decode, utf8Encode, type Result } from "@tk-reawakened/core";
import { formatClipProblems, readClip, removeClipProperty, setClipProperty, type Clip, type ClipPath, type ClipEditValue } from "@tk-reawakened/native-data";
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

export type NativeClipCommand =
  | { readonly type: "set-native-clip-property"; readonly path: ClipPath; readonly value: ClipEditValue }
  | { readonly type: "remove-native-clip-property"; readonly path: ClipPath };

export interface NativeClipModel {
  readonly text: string;
  readonly clip: Clip;
}

export type NativeClipSnapshot = DocumentSnapshot<NativeClipCommand> & { readonly clip: Clip };
export type NativeClipDocument = EditorDocument<NativeClipSnapshot, NativeClipCommand>;
export type NativeClipOpenResult = GenericOpenResult<NativeClipDocument>;

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return utf8Decode(bytes);
  } catch {
    return null;
  }
}

function read(bytes: Uint8Array, path: string): Result<NativeClipModel> {
  const text = decodeUtf8(bytes);
  if (text === null) return err({ offset: 0, section: "docs/spec/formats/native-animation-clip.md#reference-reader-writer-and-importer", message: `Invalid UTF-8 in native clip ${path}; the file was not opened.` });
  const result = readClip(text);
  return result.ok
    ? ok({ text, clip: result.clip })
    : err({ offset: 0, section: "docs/spec/formats/native-animation-clip.md#reference-reader-writer-and-importer", message: formatClipProblems(result.problems) });
}
const write = (model: NativeClipModel): Result<Uint8Array> => ok(utf8Encode(model.text));

function isColour(value: unknown): value is { readonly r: number; readonly g: number; readonly b: number } {
  if (typeof value !== "object" || value === null) return false;
  const colour = value as Record<string, unknown>;
  return Number.isInteger(colour.r) && Number.isInteger(colour.g) && Number.isInteger(colour.b);
}

function isCommand(value: unknown): value is NativeClipCommand {
  if (typeof value !== "object" || value === null) return false;
  const command = value as Record<string, unknown>;
  if (!Array.isArray(command.path) || !command.path.every((part) => typeof part === "string" || typeof part === "number")) return false;
  if (command.type === "remove-native-clip-property") return true;
  return command.type === "set-native-clip-property"
    && (typeof command.value === "string" || typeof command.value === "number" || isColour(command.value));
}

function edit(model: NativeClipModel, command: NativeClipCommand): NativeClipModel | null {
  const result = command.type === "set-native-clip-property"
    ? setClipProperty(model.text, command.path, command.value)
    : removeClipProperty(model.text, command.path);
  if (!result.ok) return null;
  const parsed = readClip(result.text);
  return parsed.ok ? { text: result.text, clip: parsed.clip } : null;
}

const codec: DocumentCodec<NativeClipModel, NativeClipCommand, { readonly clip: Clip }> = {
  kind: "native-clip",
  read,
  write,
  readOnlyReason: () => null,
  isCommand,
  apply: (model, command) => edit(model, command) ?? model,
  label: (command) => command.type === "set-native-clip-property" ? "Set clip property" : "Remove clip property",
  refuse: (next, command, previous): Rejection | null => {
    if (!isCommand(command)) return { reason: "invalid", message: "Invalid native clip command." };
    return next.text === previous.text
      ? { reason: "invalid", message: "The native clip property change is invalid, unsupported, or changes nothing." }
      : null;
  },
  summary: (model) => `Native animation clip: ${model.clip.frames.length} frames`,
  fields: (model) => ({ clip: model.clip }),
};

export const nativeClipCodec = codec;
export function openNativeClipDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<NativeClipOpenResult> {
  return openBinaryDocument(codec, storage, identity);
}
export function createNativeClipDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): NativeClipOpenResult {
  return createBinaryDocument(codec, storage, identity, bytes);
}
