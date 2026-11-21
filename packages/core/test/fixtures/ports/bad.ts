// Port-contract fixtures that must FAIL to typecheck: functions, `undefined`
// and `Map` are outside `PlainData`/`PortData`, and every port-contract field
// is required and never `undefined` (AD-1, AD-7, AD-5, AD-14).
//
// Each `export ` line below carries exactly one defect (`contracts.test.ts`
// compiles this file and requires one error per exported line), so each object
// literal stays on a single line.
import type {
  AssertPlainData,
  AssertPortData,
  AssetKey,
  AssetReply,
  AudioCue,
  BlobLoaded,
  KeyInput,
  TexRef,
} from "../../../src/index.ts";

export type FunctionFieldIsNotPortData = AssertPortData<{ readonly fn: () => void }>;
export type UndefinedFieldIsNotPortData = AssertPortData<{ readonly value: string | undefined }>;
export type MapIsNotPortData = AssertPortData<Map<string, number>>;
export type FunctionIsNotPlainData = AssertPlainData<() => number>;
export type UndefinedIsNotPlainData = AssertPlainData<undefined>;
export const badKeyInputMissingChar: KeyInput = { kind: "key", code: "KeyA", vk: null, down: true };
export const badKeyInputUndefinedChar: KeyInput = { kind: "key", code: "KeyA", char: undefined, vk: null, down: true };
export const badAudioCueUndefinedAsset: AudioCue = { cueId: 1, tick: 0, kind: "media.play", track: "music", voice: 0, asset: undefined, loop: null, flags: null, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null };
export const badAudioCueMissingVolume: AudioCue = { cueId: 1, tick: 0, kind: "media.play", track: "music", voice: 0, asset: "a.wav" as AssetKey, loop: null, flags: null, positionTicks: 0, targetVolume: null, durationTicks: null };
export const badTexRefUndefinedTile: TexRef = { asset: "hero.png" as AssetKey, tile: undefined };
export const badTexRefMissingTile: TexRef = { asset: "hero.png" as AssetKey };
export const badAssetReply: AssetReply = { kind: "asset", reqId: 1, bytes: new Uint8Array(), missing: true };
export const badBlobLoaded: BlobLoaded = { kind: "blob.loaded", reqId: 1, bytes: new Uint8Array(), missing: true };
