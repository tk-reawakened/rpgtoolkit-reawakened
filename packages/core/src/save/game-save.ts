import { canon, reviveNonFinite, tagNonFinite } from "../canon/index.ts";
import { audioSaveProjection, type AudioSaveProjection } from "../audio/save.ts";
import { AUDIO_SCHEMA_VERSION, createAudioSection, createTrack, type AudioStateV2 } from "../audio/model.ts";
import { ScriptError } from "../script/errors.ts";
import { isRecord } from "../script/cells.ts";
import type { Diagnostic } from "../ports/engine.ts";
import { refuseOtherCompiler, refuseOtherProgramCompilers, restoreGameState } from "./snapshot.ts";
import type { GameState } from "./state.ts";

export type RestoredGameSave = {
  readonly state: GameState;
  readonly audio: AudioSaveProjection;
  readonly diagnostics: Diagnostic[];
};

export type RecoveryAssetFingerprint = {
  readonly key: string;
  readonly hash: string;
};

/** File identities required to rebuild a paused recovery board. */
export type RecoveryAssetManifest = {
  readonly version: 1;
  readonly board: RecoveryAssetFingerprint;
  readonly boardDependencies: RecoveryAssetFingerprint[];
  readonly entryProgram: RecoveryAssetFingerprint | null;
  readonly programs: RecoveryAssetFingerprint[];
};

export type RestoredRecoveryCandidate = RestoredGameSave & {
  readonly recoveryAssets: RecoveryAssetManifest;
};

function parseRecoveryAssetFingerprint(value: unknown, path: string): RecoveryAssetFingerprint {
  const fingerprint = record(value, path);
  exactKeys(fingerprint, ["key", "hash"], path);
  if (typeof fingerprint.key !== "string" || fingerprint.key === "") shape(`${path}.key must be a non-empty asset key`);
  if (typeof fingerprint.hash !== "string" || !/^[0-9a-f]{16}$/.test(fingerprint.hash)) shape(`${path}.hash must be a 16-character FNV-1a hash`);
  return { key: fingerprint.key, hash: fingerprint.hash };
}

function parseRecoveryAssetManifest(value: unknown): RecoveryAssetManifest {
  const manifest = record(value, "recoveryAssets");
  exactKeys(manifest, ["version", "board", "boardDependencies", "entryProgram", "programs"], "recoveryAssets");
  if (manifest.version !== 1) shape("recoveryAssets.version must be 1");
  if (!Array.isArray(manifest.boardDependencies)) shape("recoveryAssets.boardDependencies must be an array");
  if (!Array.isArray(manifest.programs)) shape("recoveryAssets.programs must be an array");
  return {
    version: 1,
    board: parseRecoveryAssetFingerprint(manifest.board, "recoveryAssets.board"),
    boardDependencies: manifest.boardDependencies.map((entry, index) => parseRecoveryAssetFingerprint(entry, `recoveryAssets.boardDependencies[${index}]`)),
    entryProgram: manifest.entryProgram === null ? null : parseRecoveryAssetFingerprint(manifest.entryProgram, "recoveryAssets.entryProgram"),
    programs: manifest.programs.map((entry, index) => parseRecoveryAssetFingerprint(entry, `recoveryAssets.programs[${index}]`)),
  };
}

/** Serialize an engine checkpoint with asset fingerprints for the later recovery launch. */
export function snapshotRecoveryCandidate(state: GameState, recoveryAssets: RecoveryAssetManifest): string {
  const manifest = parseRecoveryAssetManifest(recoveryAssets);
  const root = JSON.parse(snapshotGameSave(state)) as Record<string, unknown>;
  return canon({ ...root, recoveryAssets: manifest } as never);
}

function restoreGameSaveEnvelope(json: string, currentAudio: AudioStateV2, recovery = false): {
  readonly save: RestoredGameSave;
  readonly recoveryAssets: RecoveryAssetManifest | null;
} {
  let parsed: unknown;
  try {
    parsed = reviveNonFinite(JSON.parse(json));
  } catch {
    throw new ScriptError("restore.shape", "a saved game must be valid UTF-8 JSON");
  }
  const root = record(parsed, "root");
  const recoveryAssets = recovery && Object.hasOwn(root, "recoveryAssets") ? parseRecoveryAssetManifest(root.recoveryAssets) : null;
  if (recovery) delete root.recoveryAssets;
  // The compiler check comes first (owner ruling 2026-10-27): a save from another
  // compiler is refused as such before any audio or section shape is examined.
  if (isRecord(root.schema)) refuseOtherCompiler(root.schema.compiler);
  refuseOtherProgramCompilers(root);
  let projection: Record<string, unknown>;
  let tick: number;
  let cueId: number;
  let tracks: unknown[];
  if (root.audio !== undefined && root.audio !== null && typeof root.audio === "object" && Object.hasOwn(root.audio, "tracks")) {
    projection = record(root.audio, "audio projection");
    exactKeys(projection, ["tick", "cueId", "tracks"], "audio projection");
    tick = number(projection.tick, "audio.tick", 0);
    cueId = number(projection.cueId, "audio.cueId", 1);
    if (!Array.isArray(projection.tracks)) shape("audio.tracks must be an array");
    tracks = projection.tracks as unknown[];
  } else {
    const defaultSection = createAudioSection();
    projection = { tick: number(record(root.time, "time").tick, "time.tick", 0), cueId: defaultSection.cueId, tracks: [] };
    tick = projection.tick as number;
    cueId = defaultSection.cueId;
    tracks = [];
  }
  const currentByName = new Map(currentAudio.tracks.map((track) => [asciiFold(track.name), track]));
  const seen = new Set<string>();
  const migratedTracks = tracks.map((value, index) => {
    const track = record(value, `audio.tracks[${index}]`);
    exactKeys(track, ["name", "state", "flags", "file", "voices", "positionTicks", "lengthTicks", "fade"], `audio.tracks[${index}]`);
    if (typeof track.name !== "string" || track.name === "") shape(`audio.tracks[${index}].name must be a non-empty string`);
    const name = asciiFold(track.name);
    if (seen.has(name)) shape(`audio.tracks[${index}].name duplicates an earlier track`);
    seen.add(name);
    if (!Array.isArray(track.voices)) shape(`audio.tracks[${index}].voices must be an array`);
    for (const [voiceIndex, voiceValue] of (track.voices as unknown[]).entries()) {
      const voice = record(voiceValue, `audio.tracks[${index}].voices[${voiceIndex}]`);
      exactKeys(voice, ["index", "state", "file", "cueId", "priority", "volume", "loop", "startTick", "positionTicks", "lengthTicks", "endTick", "pausedTick", "fade"], `audio.tracks[${index}].voices[${voiceIndex}]`);
    }
    const configured = currentByName.get(name);
    return { ...track, voiceCount: configured?.voiceCount ?? 1 };
  });
  const schema = record(root.schema, "schema");
  const audioVersion = number(schema.audio, "schema.audio", 1);
  if (audioVersion > AUDIO_SCHEMA_VERSION) shape(`schema.audio must be no greater than ${AUDIO_SCHEMA_VERSION}`);
  root.audio = {
    schema: AUDIO_SCHEMA_VERSION,
    cueId,
    soundFont: currentAudio.soundFont,
    tracks: migratedTracks,
    settings: currentAudio.settings,
  };
  const diagnostics: Diagnostic[] = [];
  const state = restoreGameState(canon(tagNonFinite(root) as never), diagnostics);
  if (state.time.tick !== tick) shape("audio.tick must match time.tick");
  state.audio = resetPlayback(currentAudio);
  return { save: { state, audio: projection as unknown as AudioSaveProjection, diagnostics }, recoveryAssets };
}

/** Validate and migrate an untrusted canonical game save against the live game's audio configuration. */
export function restoreGameSave(json: string, currentAudio: AudioStateV2): RestoredGameSave {
  return restoreGameSaveEnvelope(json, currentAudio).save;
}

/** Validate a checkpoint candidate and its recovery-only asset fingerprints. */
export function restoreRecoveryCandidate(json: string, currentAudio: AudioStateV2): RestoredRecoveryCandidate {
  const restored = restoreGameSaveEnvelope(json, currentAudio, true);
  if (restored.recoveryAssets === null) throw new ScriptError("recovery.assets-missing", "the recovery candidate has no asset fingerprint manifest");
  return { ...restored.save, recoveryAssets: restored.recoveryAssets };
}

/** Serialize the complete canonical game state while keeping only audio playback in a game save. */
export function snapshotGameSave(state: GameState): string {
  const root = tagNonFinite(state) as Record<string, unknown>;
  return canon({ ...root, audio: audioSaveProjection(state.audio, state.time.tick) } as never);
}

function shape(path: string): never {
  throw new ScriptError("restore.shape", `the saved game ${path} is invalid`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) return shape(`${path} must be an object`);
  return value;
}

function number(value: unknown, path: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) return shape(`${path} must be a safe integer no less than ${min}`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    shape(`${path} must contain only ${sortedExpected.join(", ")}`);
  }
}

function asciiFold(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    result += String.fromCharCode(code >= 65 && code <= 90 ? code + 32 : code);
  }
  return result;
}

function resetPlayback(current: AudioStateV2): AudioStateV2 {
  return {
    schema: current.schema,
    cueId: current.cueId,
    soundFont: current.soundFont,
    tracks: current.tracks.map((track) => createTrack(track.name, track.voiceCount)),
    settings: { masterVolume: current.settings.masterVolume, trackVolumes: current.settings.trackVolumes.map((volume) => ({ ...volume, fade: volume.fade === null ? null : { ...volume.fade } })) },
  };
}


