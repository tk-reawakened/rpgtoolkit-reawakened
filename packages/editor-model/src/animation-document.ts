import {
  ANIMATION_MAGIC,
  ANIMATION_MINOR,
  BinaryReader,
  readAnimation,
  writeAnimation,
  type Animation,
  type AnimationFrame,
  type Colorref,
} from "@tk-reawakened/core";
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
import type { DocumentIdentity } from "./identity.ts";

export const ANIMATION_FRAME_LIMIT = 51;

export type AnimationCommand =
  | { readonly type: "insert-animation-frame"; readonly index: number; readonly frame: AnimationFrame }
  | { readonly type: "delete-animation-frame"; readonly index: number }
  | { readonly type: "move-animation-frame"; readonly from: number; readonly to: number }
  | { readonly type: "set-animation-frame"; readonly index: number; readonly frame: AnimationFrame }
  | { readonly type: "set-animation-frames"; readonly frames: readonly AnimationFrame[] }
  | { readonly type: "set-animation-canvas"; readonly width: number; readonly height: number }
  | { readonly type: "set-animation-delay"; readonly delay: number }
  | { readonly type: "replace-animation"; readonly width: number; readonly height: number; readonly delay: number; readonly frames: readonly AnimationFrame[] };

export interface AnimationDocumentFields {
  readonly major: number;
  readonly minor: number;
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AnimationFrame[];
  readonly delay: number;
}

export type AnimationDocumentSnapshot = DocumentSnapshot<AnimationCommand> & AnimationDocumentFields;
export type AnimationDocument = EditorDocument<AnimationDocumentSnapshot, AnimationCommand>;
export type AnimationOpenResult = GenericOpenResult<AnimationDocument>;

const copyFrame = (frame: AnimationFrame): AnimationFrame => ({ image: frame.image, transparent: { ...frame.transparent }, sound: frame.sound });
const validColour = (value: unknown): value is Colorref => {
  if (typeof value !== "object" || value === null) return false;
  const colour = value as Record<string, unknown>;
  return typeof colour.r === "number" && Number.isInteger(colour.r) && colour.r >= 0 && colour.r <= 255
    && typeof colour.g === "number" && Number.isInteger(colour.g) && colour.g >= 0 && colour.g <= 255
    && typeof colour.b === "number" && Number.isInteger(colour.b) && colour.b >= 0 && colour.b <= 255;
};
const validFrame = (value: unknown): value is AnimationFrame => typeof value === "object" && value !== null
  && "image" in value && typeof value.image === "string" && !/[\u0000\r\n]/.test(value.image)
  && "sound" in value && typeof value.sound === "string" && !/[\u0000\r\n]/.test(value.sound)
  && "transparent" in value && validColour(value.transparent);
const validSize = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 0x7fffffff;

function apply(model: Animation, command: AnimationCommand): Animation {
  if (command.type === "set-animation-canvas") return { ...model, width: command.width, height: command.height };
  if (command.type === "set-animation-delay") return { ...model, delay: command.delay };
  if (command.type === "set-animation-frames") return { ...model, frames: command.frames.map(copyFrame) };
  if (command.type === "replace-animation") return { ...model, width: command.width, height: command.height, delay: command.delay, frames: command.frames.map(copyFrame) };
  const frames = model.frames.map(copyFrame);
  if (command.type === "insert-animation-frame") frames.splice(command.index, 0, copyFrame(command.frame));
  else if (command.type === "delete-animation-frame") frames.splice(command.index, 1);
  else if (command.type === "move-animation-frame") {
    const [frame] = frames.splice(command.from, 1);
    if (frame !== undefined) frames.splice(command.to, 0, frame);
  } else frames[command.index] = copyFrame(command.frame);
  return { ...model, frames };
}

function refuse(next: Animation, command: AnimationCommand, previous: Animation): Rejection | null {
  const invalid = (message: string): Rejection => ({ reason: "invalid", message });
  if (command.type === "set-animation-canvas") {
    if (!validSize(command.width) || !validSize(command.height)) return invalid("Animation width and height must be positive whole pixels that fit the file.");
  } else if (command.type === "set-animation-delay") {
    if (!Number.isFinite(command.delay) || command.delay < 0) return invalid("Animation delay must be a finite number of zero or more seconds.");
  } else if (command.type === "set-animation-frames") {
    if (command.frames.length > ANIMATION_FRAME_LIMIT || !command.frames.every(validFrame)) return invalid(`An animation has at most ${ANIMATION_FRAME_LIMIT} valid frame slots.`);
  } else if (command.type === "replace-animation") {
    if (!validSize(command.width) || !validSize(command.height) || !Number.isFinite(command.delay) || command.delay < 0
      || command.frames.length > ANIMATION_FRAME_LIMIT || !command.frames.every(validFrame)) return invalid("The replacement animation needs a valid canvas, delay and at most 51 valid frames.");
  } else if (command.type === "insert-animation-frame") {
    if (!Number.isInteger(command.index) || command.index < 0 || command.index > previous.frames.length || !validFrame(command.frame)) return invalid("Choose a valid frame and an insertion point in the frame list.");
    if (previous.frames.length >= ANIMATION_FRAME_LIMIT) return invalid(`An animation has at most ${ANIMATION_FRAME_LIMIT} frame slots.`);
  } else if (command.type === "delete-animation-frame") {
    if (!Number.isInteger(command.index) || command.index < 0 || command.index >= previous.frames.length) return invalid("Choose a frame that exists.");
  } else if (command.type === "move-animation-frame") {
    if (!Number.isInteger(command.from) || !Number.isInteger(command.to) || command.from < 0 || command.from >= previous.frames.length || command.to < 0 || command.to >= previous.frames.length) return invalid("Choose source and destination frames that exist.");
  } else if (!Number.isInteger(command.index) || command.index < 0 || command.index >= previous.frames.length || !validFrame(command.frame)) return invalid("Choose a valid frame and frame number.");
  if (next === previous || (command.type === "move-animation-frame" && command.from === command.to)) return invalid("That animation already has the requested value.");
  const encoded = writeAnimation(next);
  if (!encoded.ok) return invalid(encoded.error.message);
  const checked = readAnimation(new BinaryReader(encoded.value));
  if (!checked.ok || checked.value.minor !== next.minor) return invalid("That edit cannot be written and read back in this animation's format version.");
  return null;
}

function readOnlyReason(model: Animation, bytes: Uint8Array): ReadOnlyReason | null {
  if (model.minor === 0) return {
    code: "no-same-version-writer",
    message: "This Toolkit 2 text animation has no same-version writer and is read-only. It will not be converted on open.",
  };
  const encoded = writeAnimation(model);
  if (!encoded.ok) return { code: "no-same-version-writer", message: `This animation has no same-version writer: ${encoded.error.message}` };
  const first = firstDifference(encoded.value, bytes);
  if (first === null) return null;
  return { code: "no-same-version-writer", message: `The animation writer does not reproduce this file byte for byte; it is read-only (first difference at offset ${first}).` };
}

function isAnimationCommand(value: unknown): value is AnimationCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "set-animation-canvas") return typeof record.width === "number" && typeof record.height === "number";
  if (record.type === "set-animation-delay") return typeof record.delay === "number";
  if (record.type === "set-animation-frames") return Array.isArray(record.frames) && record.frames.every(validFrame);
  if (record.type === "replace-animation") return typeof record.width === "number" && typeof record.height === "number" && typeof record.delay === "number" && Array.isArray(record.frames) && record.frames.every(validFrame);
  if (record.type === "insert-animation-frame") return typeof record.index === "number" && validFrame(record.frame);
  if (record.type === "delete-animation-frame") return typeof record.index === "number";
  if (record.type === "move-animation-frame") return typeof record.from === "number" && typeof record.to === "number";
  return record.type === "set-animation-frame" && typeof record.index === "number" && validFrame(record.frame);
}

export const animationCodec: DocumentCodec<Animation, AnimationCommand, AnimationDocumentFields> = {
  kind: "animation",
  read: (bytes, path) => readAnimation(new BinaryReader(bytes, path)),
  write: writeAnimation,
  readOnlyReason,
  isCommand: isAnimationCommand,
  apply,
  label: (command) => {
    if (command.type === "insert-animation-frame") return `Insert animation frame ${command.index + 1}`;
    if (command.type === "delete-animation-frame") return `Delete animation frame ${command.index + 1}`;
    if (command.type === "move-animation-frame") return `Move animation frame ${command.from + 1} to ${command.to + 1}`;
    if (command.type === "set-animation-frame") return `Edit animation frame ${command.index + 1}`;
    if (command.type === "set-animation-frames") return "Replace animation frames";
    if (command.type === "replace-animation") return "Create animation from staged frames";
    if (command.type === "set-animation-canvas") return `Set animation canvas to ${command.width} × ${command.height}`;
    return `Set animation delay to ${command.delay} seconds`;
  },
  refuse,
  summary: (model) => `Animation: ${model.frames.filter((frame) => frame.image !== "").length} populated frame(s)`,
  fields: (model) => ({ major: model.major, minor: model.minor, width: model.width, height: model.height, frames: model.frames.map(copyFrame), delay: model.delay }),
};

export function openAnimationDocument(storage: DocumentStorage, identity: DocumentIdentity): Promise<AnimationOpenResult> {
  return openBinaryDocument(animationCodec, storage, identity);
}

export function createAnimationDocument(storage: DocumentStorage, identity: DocumentIdentity, bytes: Uint8Array): AnimationOpenResult {
  return createBinaryDocument(animationCodec, storage, identity, bytes);
}

export function newAnimationBytes(width = 32, height = 32, delay = 0.167): Uint8Array {
  const model: Animation = { magic: ANIMATION_MAGIC, major: 2, minor: ANIMATION_MINOR, width, height, frames: [], delay, residue: new Uint8Array() };
  const written = writeAnimation(model);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

export function createNewAnimationDocument(storage: DocumentStorage, identity: DocumentIdentity): AnimationOpenResult {
  return createAnimationDocument(storage, identity, newAnimationBytes());
}

export type { AnimationFrame };
