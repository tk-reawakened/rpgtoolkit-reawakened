/**
 * The audio track engine: the one owner of `GameState.audio` (AD-10, AD-16;
 * docs/spec/engine/audio-media.md#audio-core-pins).
 *
 * It turns effect records (`music.play`, `sfx.play`, `soundfont.set`) and
 * transport calls (play, stop, pause, resume, seek, loop, volume) into track
 * state and generic `AudioCue`s, in the order they are applied, on the fixed
 * 60 Hz tick. The core is the only clock: a file's end tick comes from its
 * length in ticks, never from a device, and `audio.ended` replies are advisory.
 * Nothing here reads a file, a timer or a device (G2, G3).
 *
 * A host supplies the state (`audio`, the tick counter and the engine section)
 * and a lookup of each file's length. When a file's bytes have not been fetched
 * yet the lookup answers "pending": the effect, and every later effect, waits
 * in post order in the engine section's pending queue for `audio` and is asked
 * for through `need` (the engine's blocking asset request) until `retry` is
 * called with the answer.
 */

import { assetKey } from "../formats/resolver/resolver.ts";
import { floorDiv } from "../formats/audio/model.ts";
import type { AudioCue, AudioCueKind } from "../ports/audio.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { EffectRecord } from "../script/effects.ts";
import type { GameState } from "../save/state.ts";
import type { AudioLifecycleEvent } from "./events.ts";
import { MEDIA_EMITTER } from "./events.ts";
import { findObject, readMember, writeMember } from "../script/objects.ts";
import { MEDIA_PLAY_VOICE_ARG } from "./pending.ts";
import { queueNativeEvent } from "../events/emitter.ts";
import {
  BUILTIN_TRACKS,
  MAX_TRACKS,
  MAX_VOICES,
  MEDIA_LOOP,
  MEDIA_TRACK_NAME,
  asciiFold,
  createTrack,
  fadeValue,
  findTrack,
  voicePass,
  voicePosition,
  type AudioFadeState,
  type AudioTrackState,
  type AudioVoiceHandle,
  type AudioVoiceState,
} from "./model.ts";
import { copyFade, copyVoice, type AudioSaveProjection } from "./save.ts";

/** What the host knows of one audio file. */
export type AudioLookup =
  | { readonly kind: "known"; readonly lengthTicks: number | null }
  | { readonly kind: "unsupported" }
  | { readonly kind: "pending" };

/** Free-form located detail of a diagnostic: plain scalars only. */
export type AudioNoteDetail = { readonly [key: string]: string | number | boolean | null };

/**
 * A fact the runtime observed. Diagnostics (`diag`) are what a host reports;
 * the rest say how a request was decided (a tracer, a test or the editor may
 * watch them; none changes state).
 */
export type AudioNote =
  | { readonly kind: "same-file"; readonly track: string; readonly file: AssetKey; readonly action: "carry-on" | "ignored" }
  | { readonly kind: "silence"; readonly track: string; readonly source: string }
  | { readonly kind: "finished"; readonly track: string; readonly voice: number; readonly cueId: number; readonly endTick: number }
  | { readonly kind: "steal"; readonly track: string; readonly voice: number; readonly cueId: number }
  | { readonly kind: "no-op"; readonly op: string; readonly track: string }
  | { readonly kind: "diag"; readonly code: string; readonly op: string; readonly detail: AudioNoteDetail };

/** The origin that is exposed in the shared `media.beforePlay` event. */
export type AudioSource = "script" | "board" | "animation" | "battle" | "menu" | "video";

/** The mutable, scalar detail exposed to `media.beforePlay` listeners. */
export type BeforePlayDetail = {
  source: AudioSource;
  track: string;
  slot: number;
  cueId: number;
  file: AssetKey;
  volume: number;
  loop: boolean;
};

export type BeforePlayOutcome = "allowed" | "canceled" | "failed";

/** The part of a game state the runtime owns or reads. */
export type AudioHost = Pick<GameState, "audio" | "time" | "engine" | "events" | "vm">;

export type AudioRuntimeOptions = {
  /** The length of `asset`; `pending` makes the runtime hold effects and call `need`. */
  readonly lookup: (asset: AssetKey) => AudioLookup;
  /** Ask the host for the bytes of an asset whose lookup is pending. */
  readonly need?: (asset: AssetKey) => void;
  /** The author's default SoundFont (rank 3 of the bank layers); `null` when there is none. */
  readonly defaultSoundFont?: AssetKey | null;
  readonly notify?: (note: AudioNote) => void;
  /**
   * Bind a script-held voice object to the start the applier decided
   * (MEDIA-1): `handle` is the plain object handle the object-form effect carried.
   */
  readonly bindVoice?: (handle: number, result: AudioPlayResult) => void;
  /** Resolve an engine-originated beforePlay event synchronously. */
  readonly engineBeforePlay?: (detail: BeforePlayDetail) => BeforePlayOutcome;
  /** Queue a deterministic applied playback transition (MEDIA-2). */
  readonly transition?: (event: AudioLifecycleEvent) => void;
  /** Whether the lazy event domain is active; omitted means transitions are observed. */
  readonly transitionsActive?: () => boolean;
};

/** A voice selector accepts the stable slot index or a cue-checked handle. */
export type AudioVoiceSelector = number | AudioVoiceHandle;
/** A parked thread's reason to wait on one voice (docs/spec/engine/audio-media.md#audio-track-wait). */
export type AudioWait = {
  readonly track: string;
  readonly voice: number;
  readonly cueId: number;
  readonly endTick: number | null;
  readonly pass: boolean;
  readonly passIndex: number | null;
};

/** Whether a wait is over, and why (`gone`: stopped or replaced; `pass`: its loop pass ended; `end`: it ended). */
export type AudioWaitState = { readonly wake: false } | { readonly wake: true; readonly why: "gone" | "pass" | "end" };

export type AudioPlayRequest = {
  readonly track: string;
  readonly asset: AssetKey;
  readonly loop: boolean;
  /** The event origin; omitted callers use the script origin for compatibility. */
  readonly source?: AudioSource;
  /** An explicit slot always replaces that slot, even on a single-voice track. */
  readonly voice?: number | undefined;
  /** Start at the current position of this track's primary voice. */
  readonly syncTrack?: string | undefined;
  /** The restart flag: stop and start from zero even when the same file is playing. */
  readonly restart?: boolean;
  /** The wait flag: also make the wait for this voice's end. */
  readonly wait?: boolean;
  readonly priority?: number;
  /** The voice's script volume at start, 0..100; omitted means 100 (MEDIA-1). */
  readonly volume?: number;
  /** Preserve the originating effect name in applied diagnostics. */
  readonly diagnosticOp?: string;
  /** Internal marker: a script beforePlay event has already completed. */
  readonly beforePlayHandled?: boolean;
};
export type AudioPlayResult =
  | { readonly kind: "started"; readonly voice: number; readonly cueId: number; readonly wait: AudioWait | null }
  | { readonly kind: "same-file"; readonly action: "carry-on" | "ignored"; readonly voice: number; readonly cueId: number }
  | { readonly kind: "before-play"; readonly event: number }
  | { readonly kind: "canceled" }
  | { readonly kind: "pending"; readonly beforePlayHandled?: boolean; readonly asset?: AssetKey; readonly volume?: number; readonly loop?: boolean }
  | { readonly kind: "rejected" };

/** The structural slice of the effect bus the runtime registers with. */
export type AudioEffectBus = {
  register(section: "audio", applier: (effect: EffectRecord) => void): void;
};

/** The decoded game-file audio settings the runtime applies at start-up (docs/spec/formats/main-file.md#tkr-audio-settings-extension). */
export type AudioGameSettings = {
  readonly tracks: readonly { readonly name: string; readonly voiceCount: number }[];
  readonly voiceCap: number;
};

/** Whether the settings were applied, or the first track index whose cumulative voice count crosses the cap. */
export type AudioGameApply = { readonly ok: true } | { readonly ok: false; readonly overflowIndex: number };
/** Why a package track declaration was rejected during game configuration. */
export type AudioPackageTrackProblem = "invalid-name" | "voice-count" | "track-limit" | "voice-cap";


export type AudioRuntime = {
  /** Emit the start `soundfont.set`, then take the `audio` section's effects from `bus` (draining any already queued). */
  register(bus: AudioEffectBus): void;
  /**
   * Apply the game-file track configuration before playback starts
   * (docs/spec/formats/main-file.md#tkr-audio-settings-extension). An aggregate count above the cap leaves
   * the Epic 6 defaults and cap 32 in place and reports the first offending track.
   */
  applyGameAudio(settings: AudioGameSettings): AudioGameApply;
  /** Set the authored default bank without emitting; `register` emits it once (docs/spec/engine/audio-media.md#soundfont-layers). */
  setDefaultSoundFont(font: AssetKey | null): void;
  /** Apply one `audio` effect, or hold it behind an earlier one that is waiting for an asset. */
  apply(effect: EffectRecord): void;
  /** Apply held effects, in order, until one still waits for its asset. */
  retry(): void;
  /** Apply one package declaration without allowing a duplicate to reduce the configured count. */
  configurePackageTrack(name: string, voices: number): AudioPackageTrackProblem | null;
  /** The `audio` phase: end finished one-shots and refresh positions. */
  phase(): void;
  /** The cues emitted since the last call, in order. */
  drain(): AudioCue[];
  /** Number of effects held for an asset. */
  heldCount(): number;
  configureTrack(name: string, voices?: number): boolean;
  play(request: AudioPlayRequest): AudioPlayResult;
  stop(track: string, voice?: AudioVoiceSelector): boolean;
  pause(track: string, voice?: AudioVoiceSelector): boolean;
  resume(track: string, voice?: AudioVoiceSelector): boolean;
  seek(track: string, positionTicks: number, voice?: AudioVoiceSelector): boolean;
  setLoop(track: string, loop: boolean, voice?: AudioVoiceSelector): boolean;
  setMasterVolume(percent: number): boolean;
  setTrackVolume(track: string, percent: number): boolean;
  setVoiceVolume(track: string, voice: AudioVoiceSelector, percent: number): boolean;
  /** Start or replace one integer-tick fade; omitted voice means the track bus. */
  fade(track: string, percent: number, durationTicks: number, voice?: AudioVoiceSelector): boolean;
  /** A wait on one voice, or `null` when the voice is not waitable (a diagnostic says why when it should). */
  waitFor(track: string, voice?: AudioVoiceSelector): AudioWait | null;
  pollWait(wait: AudioWait): AudioWaitState;
  /** Game load: the saved playback replaces the live one, settings stay (docs/spec/engine/audio-media.md#audio-save-load). */
  load(saved: AudioSaveProjection): void;
};

type CueFields = Partial<Omit<AudioCue, "cueId" | "tick" | "kind">>;

type Located = { readonly track: AudioTrackState; readonly index: number; readonly voice: AudioVoiceState | undefined; readonly stale: boolean };

type StartOptions = {
  readonly loop: boolean;
  readonly restart: boolean;
  readonly priority: number;
  readonly volume?: number | undefined;
  readonly op: string;
  readonly voice?: number | undefined;
  readonly positionTicks?: number | undefined;
};

/** The 2^53 - 1 limit of an exact integer tick; a seek position above it is invalid. */
const MAX_POSITION = 9007199254740991;

/** Normalize an effect's voice argument: a slot number, a cue-checked `{track, slot, cueId}`, or `null` when malformed. */
function selectorValue(value: unknown): AudioVoiceSelector | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const track = record["track"];
    const slot = record["slot"];
    const cueId = record["cueId"];
    if (typeof track === "string" && Number.isInteger(slot) && Number.isInteger(cueId)) return { track, voice: slot as number, cueId: cueId as number };
  }
  return null;
}

/** Script effects retain their command name; args already use the owner's canonical layout. */
const SCRIPT_AUDIO_OPERATIONS: Readonly<Record<string, string>> = {
  mediaplay: "media.play",
  midiplay: "media.play", playmidi: "media.play", wav: "media.play", mp3: "media.play", mp3pause: "media.play",
  mediastop: "media.stop", mediarest: "media.stop", midirest: "media.stop", wavstop: "media.stop",
  setvolume: "media.volume",
};

function syncEffectArgs(host: AudioHost, effect: EffectRecord, args: EffectRecord["args"]): void {
  const recorded = host.vm.effects.find((candidate) => candidate.seq === effect.seq);
  if (recorded === undefined || recorded.args === args) return;
  recorded.args.length = args.length;
  for (let index = 0; index < args.length; index += 1) recorded.args[index] = args[index]!;
}

export function createAudioRuntime(host: AudioHost, options: AudioRuntimeOptions): AudioRuntime {
  const cues: AudioCue[] = [];
  let defaultSoundFont = options.defaultSoundFont ?? null;
  let voiceCap = MAX_VOICES;
  const notify = options.notify ?? ((): void => undefined);
  const transition = options.transition;
  let lifecycleEnabled = true;
  /** Snapshot-owned cursors; never hide semantic event history in a session Map. */
  const observedPass = {
    get(voice: AudioVoiceState): number | undefined {
      return host.events.audioPasses?.[String(voice.cueId)];
    },
    set(voice: AudioVoiceState, pass: number): void {
      if (transition === undefined || options.transitionsActive?.() === false) return;
      (host.events.audioPasses ??= {})[String(voice.cueId)] = pass;
    },
    delete(voice: AudioVoiceState): void {
      const passes = host.events.audioPasses;
      if (passes === undefined) return;
      delete passes[String(voice.cueId)];
      if (Object.keys(passes).length === 0) delete host.events.audioPasses;
    },
    clear(): void {
      delete host.events.audioPasses;
    },
  };

  function emitTransition(type: AudioLifecycleEvent["type"], track: AudioTrackState, voice: AudioVoiceState, tick: number): void {
    if (!lifecycleEnabled || transition === undefined || options.transitionsActive?.() === false) return;
    transition({
      type,
      detail: { track: track.name, slot: voice.index, cueId: voice.cueId, file: voice.file, tick },
    });
  }

  function emit(kind: AudioCueKind, fields: CueFields = {}, tick: number = host.time.tick): number {
    const cueId = host.audio.cueId;
    host.audio.cueId = cueId + 1;
    cues.push({
      cueId,
      tick,
      kind,
      track: fields.track ?? null,
      voice: fields.voice ?? null,
      asset: fields.asset ?? null,
      loop: fields.loop ?? null,
      flags: fields.flags ?? null,
      positionTicks: fields.positionTicks ?? null,
      volume: fields.volume ?? null,
      targetVolume: fields.targetVolume ?? null,
      durationTicks: fields.durationTicks ?? null,
    });
    return cueId;
  }

  function diag(code: string, op: string, detail: AudioNoteDetail = {}): void {
    notify({ kind: "diag", code, op, detail });
  }

  /** Recompute fade values, voice positions and the primary track view at `tick`. */
  function refresh(track: AudioTrackState, tick: number = host.time.tick): void {
    for (const voice of track.voices) {
      voice.positionTicks = voicePosition(voice, tick);
      if (voice.fade !== null) {
        voice.volume = fadeValue(voice.fade, tick, voice.state === "paused" ? voice.pausedTick ?? tick : undefined);
        if (voice.state === "playing" && tick - voice.fade.startTick >= voice.fade.durationTicks) {
          voice.volume = voice.fade.targetVolume;
          voice.fade = null;
          emitTransition("faded", track, voice, tick);
        }
      }
    }
    const bus = host.audio.settings.trackVolumes.find((entry) => entry.name === track.name);
    if (bus !== undefined && bus.fade !== null) {
      bus.volume = fadeValue(bus.fade, tick);
      if (tick - bus.fade.startTick >= bus.fade.durationTicks) {
        bus.volume = bus.fade.targetVolume;
        bus.fade = null;
        trackVolumeEntry(track.name, bus.volume, null);
        for (const voice of track.voices) emitTransition("faded", track, voice, tick);
      }
    }
    const primary = track.voices.find((voice) => voice.index === 0);
    track.state = track.voices.length === 0 ? "stopped" : track.voices.some((voice) => voice.state === "playing") ? "playing" : "paused";
    track.positionTicks = primary?.positionTicks ?? 0;
    track.lengthTicks = primary?.lengthTicks ?? null;
    track.fade = copyFade(primary?.fade ?? null);
  }
  function stopVoice(track: AudioTrackState, voice: AudioVoiceState, event: "stopped" | "ended" | null = "stopped"): void {
    emit("media.stop", { track: track.name, voice: voice.index });
    track.voices = track.voices.filter((item) => item !== voice);
    observedPass.delete(voice);
    if (event !== null) emitTransition(event, track, voice, host.time.tick);
  }

  function locate(op: string, name: string, selector: AudioVoiceSelector | undefined): Located | null {
    const track = findTrack(host.audio, name);
    if (track === undefined) {
      diag("media.unknown-track", op, { track: name });
      return null;
    }
    const index = typeof selector === "object" ? selector.voice : selector ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= track.voiceCount) {
      diag("media.unknown-voice", op, { track: track.name, voice: index });
      return null;
    }
    const current = track.voices.find((item) => item.index === index);
    const stale = typeof selector === "object" && (asciiFold(selector.track) !== track.name || current?.cueId !== selector.cueId);
    if (stale) diag("media.unknown-voice", op, { track: track.name, voice: index });
    return { track, index, voice: current, stale };
  }

  /** The voice slot a new play takes: the lowest free index, else the steal victim's (priority, then age, then index). */
  function allocate(track: AudioTrackState): number {
    const taken = new Set(track.voices.map((voice) => voice.index));
    for (let index = 0; index < track.voiceCount; index += 1) if (!taken.has(index)) return index;
    const victim = [...track.voices].sort((a, b) => a.priority - b.priority || a.startTick - b.startTick || a.index - b.index)[0];
    return victim?.index ?? 0;
  }

  function hasBeforePlayListeners(): boolean {
    return host.events.listeners.some((listener) => listener.emitter === MEDIA_EMITTER && listener.type.toLowerCase() === "beforeplay");
  }

  function detailAfterDispatch(event: number, original: BeforePlayDetail): BeforePlayDetail {
    const eventRecord = findObject(host.vm, event);
    const detailValue = eventRecord === undefined ? undefined : readMember(eventRecord, "detail");
    const detailRecord = typeof detailValue === "object" && detailValue !== null && "kind" in detailValue && detailValue.kind === "object"
      ? findObject(host.vm, detailValue.handle)
      : undefined;
    if (detailRecord === undefined) return original;
    const restore = (field: string, value: number | string | boolean, reason: string): void => {
      writeMember(detailRecord, field, typeof value === "boolean" ? (value ? 1 : 0) : value);
      diag("media.beforePlay-invalid", "media.beforePlay", { field, reason });
    };
    const source = readMember(detailRecord, "source");
    if (source !== original.source) restore("source", original.source, "source is read-only");
    const track = readMember(detailRecord, "track");
    if (track !== original.track) restore("track", original.track, "track is read-only");
    const slot = readMember(detailRecord, "slot");
    if (slot !== original.slot) restore("slot", original.slot, "slot is read-only");
    const cueId = readMember(detailRecord, "cueId");
    if (cueId !== original.cueId) restore("cueId", original.cueId, "cueId is read-only");
    let file = readMember(detailRecord, "file");
    if (typeof file !== "string") {
      restore("file", original.file, "file must be a string");
      file = original.file;
    }
    let volume = readMember(detailRecord, "volume");
    if (typeof volume !== "number" || !Number.isInteger(volume) || volume < 0 || volume > 100) {
      restore("volume", original.volume, "volume must be an integer from 0 to 100");
      volume = original.volume;
    }
    let loop = readMember(detailRecord, "loop");
    if (loop !== 0 && loop !== 1) {
      restore("loop", original.loop, "loop must be boolean");
      loop = original.loop ? 1 : 0;
    }
    return { ...original, file: assetKey(file), volume: volume as number, loop: loop === 1 };
  }
  function validateEngineDetail(detail: BeforePlayDetail, original: BeforePlayDetail): BeforePlayDetail {
    const candidate = detail as unknown as Record<string, unknown>;
    let file = candidate["file"];
    if (typeof file !== "string") {
      diag("media.beforePlay-invalid", "media.beforePlay", { field: "file", reason: "file must be a string" });
      file = original.file;
    }
    let volume = candidate["volume"];
    if (typeof volume !== "number" || !Number.isInteger(volume) || volume < 0 || volume > 100) {
      diag("media.beforePlay-invalid", "media.beforePlay", { field: "volume", reason: "volume must be an integer from 0 to 100" });
      volume = original.volume;
    }
    let loop = candidate["loop"];
    if (typeof loop !== "boolean") {
      diag("media.beforePlay-invalid", "media.beforePlay", { field: "loop", reason: "loop must be boolean" });
      loop = original.loop;
    }
    for (const field of ["source", "track", "slot", "cueId"] as const) {
      if (candidate[field] !== original[field]) {
        diag("media.beforePlay-invalid", "media.beforePlay", { field, reason: `${field} is read-only` });
      }
    }
    return { ...original, file: assetKey(file as string), volume: volume as number, loop: loop as boolean };
  }

  /**
   * Start one voice on `track`, or carry on / ignore a same-file request. A
   * single-voice track replaces its occupant (stop, then play); a track with
   * more than one voice has no same-file rule (6.6 pin 3).
   */
  function startVoice(track: AudioTrackState, asset: AssetKey, info: AudioLookup, o: StartOptions): AudioVoiceState | { action: "carry-on" | "ignored"; voice: AudioVoiceState } {
    const lengthTicks = info.kind === "known" ? info.lengthTicks : null;
    let index: number;
    if (o.voice !== undefined) {
      index = o.voice;
      const current = track.voices.find((voice) => voice.index === index);
      if (current !== undefined) stopVoice(track, current);
    } else if (track.voiceCount === 1) {
      const current = track.voices[0];
      if (current !== undefined && current.state === "playing" && current.file === asset && !o.restart) {
        const action = track.name === "music" ? "carry-on" : "ignored";
        notify({ kind: "same-file", track: track.name, file: asset, action });
        return { action, voice: current };
      }
      if (current !== undefined) stopVoice(track, current);
      index = 0;
    } else {
      index = allocate(track);
      const victim = track.voices.find((voice) => voice.index === index);
      if (victim !== undefined) {
        notify({ kind: "steal", track: track.name, voice: victim.index, cueId: victim.cueId });
        stopVoice(track, victim);
      }
    }
    const positionTicks = o.positionTicks ?? 0;
    const startTick = host.time.tick - positionTicks;
    const voice: AudioVoiceState = {
      index,
      state: "playing",
      file: asset,
      cueId: 0,
      priority: o.priority,
      volume: o.volume ?? 100,
      loop: o.loop,
      startTick,
      positionTicks,
      lengthTicks,
      endTick: lengthTicks !== null && !o.loop ? startTick + lengthTicks : null,
      pausedTick: null,
      fade: null,
    };
    voice.cueId = emit("media.play", { track: track.name, voice: index, asset, loop: o.loop, flags: o.loop ? MEDIA_LOOP : 0, positionTicks, volume: voice.volume });
    track.voices.push(voice);
    track.voices.sort((a, b) => a.index - b.index);
    track.file = asset;
    if (index === 0) track.flags = o.loop ? MEDIA_LOOP : 0;
    if (voice.loop) {
      const pass = voicePass(voice, host.time.tick);
      if (pass !== null) observedPass.set(voice, pass);
    }
    emitTransition("started", track, voice, host.time.tick);
    if (info.kind === "unsupported") diag("media.asset-format", o.op, { file: asset });
    refresh(track);
    return voice;
  }

  function trackVolumeEntry(name: string, volume: number, fade: AudioFadeState | null): void {
    const list = host.audio.settings.trackVolumes;
    const at = list.findIndex((entry) => entry.name === name);
    if (volume === 100 && fade === null) {
      if (at >= 0) list.splice(at, 1);
      return;
    }
    if (at >= 0) {
      list[at] = { name, volume, fade };
      return;
    }
    list.push({ name, volume, fade });
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  function validPercent(op: string, percent: number): boolean {
    if (Number.isInteger(percent) && percent >= 0 && percent <= 100) return true;
    diag("media.invalid-volume", op, { percent });
    return false;
  }

  function makeWait(track: AudioTrackState, voice: AudioVoiceState, pass: boolean): AudioWait {
    return { track: track.name, voice: voice.index, cueId: voice.cueId, endTick: voice.endTick, pass, passIndex: pass ? voicePass(voice, host.time.tick) : null };
  }
  let runtime: AudioRuntime;

  /** Decide one effect: `pending` when its file's length is not known yet and nothing was changed. */
  function applyEffect(effect: EffectRecord): "applied" | "pending" {
    const args = effect.args;
    const operation = Object.hasOwn(SCRIPT_AUDIO_OPERATIONS, effect.name) ? SCRIPT_AUDIO_OPERATIONS[effect.name]! : effect.name;
    if (operation === "media.track") {
      if (typeof args[0] !== "string" || typeof args[1] !== "number") {
        diag("audio.effect", effect.name, { reason: "malformed arguments" });
        return "applied";
      }
      runtime.configureTrack(args[0], args[1]);
      return "applied";
    }
    if (operation === "media.load") {
      const trackName = args[0];
      const asset = args[1];
      if (typeof trackName !== "string" || typeof asset !== "string") {
        diag("audio.effect", effect.name, { reason: "malformed arguments" });
        return "applied";
      }
      const track = findTrack(host.audio, trackName);
      if (track === undefined) {
        diag("media.unknown-track", effect.name, { track: trackName });
        return "applied";
      }
      const info = options.lookup(asset as AssetKey);
      if (info.kind === "pending") {
        options.need?.(asset as AssetKey);
        return "pending";
      }
      for (const voice of [...track.voices]) stopVoice(track, voice);
      track.file = asset as AssetKey;
      refresh(track);
      emit("media.load", { track: track.name, asset: track.file });
      return "applied";
    }
    if (operation === "media.play") {
      const beforeEvent = args[10];
      let beforeHandled = args[11] === true;
      const handle = args[MEDIA_PLAY_VOICE_ARG];
      if (typeof beforeEvent === "number" && !beforeHandled) {
        if (host.events.dispatch?.event === beforeEvent || host.events.queue.some((queued) => queued.event === beforeEvent)) return "pending";
        const eventRecord = findObject(host.vm, beforeEvent);
        const canceled = eventRecord !== undefined && readMember(eventRecord, "canceled") === 1;
        if (canceled) {
          args[10] = null;
          args[11] = true;
          syncEffectArgs(host, effect, args);
          if (typeof handle === "number") options.bindVoice?.(handle, { kind: "canceled" });
          return "applied";
        }
        const originalFile = args[0];
        const originalTrack = args[1];
        const originalLoop = args[2];
        const originalVolume = args[7];
        if (typeof originalFile !== "string" || typeof originalTrack !== "string" || typeof originalLoop !== "boolean" || (originalVolume !== null && originalVolume !== undefined && typeof originalVolume !== "number")) {
          diag("audio.effect", effect.name, { reason: "malformed arguments" });
          return "applied";
        }
        const originalTrackState = findTrack(host.audio, originalTrack);
        const originalSlot = typeof args[6] === "number"
          ? args[6]
          : originalTrackState === undefined || originalTrackState.voiceCount === 1
            ? 0
            : allocate(originalTrackState);
        const detail = detailAfterDispatch(beforeEvent, {
          source: typeof args[9] === "string" ? args[9] as AudioSource : "script",
          track: originalTrack,
          slot: originalSlot,
          cueId: host.audio.cueId,
          file: originalFile as AssetKey,
          volume: typeof originalVolume === "number" ? originalVolume : 100,
          loop: originalLoop,
        });
        args[0] = detail.file;
        args[2] = detail.loop;
        args[7] = detail.volume;
        args[10] = null;
        args[11] = true;
        beforeHandled = true;
        syncEffectArgs(host, effect, args);
      }
      const asset = args[0];
      const track = args[1];
      const loop = args[2];
      const restart = args[3];
      const priority = args[4];
      const syncTrack = args[5];
      const voice = args[6];
      const volume = args[7];
      const source = args[9];
      if (typeof asset !== "string" || typeof track !== "string" || typeof loop !== "boolean" || typeof restart !== "boolean" || typeof priority !== "number" || (syncTrack !== null && typeof syncTrack !== "string") || (voice !== null && !Number.isInteger(voice)) || (volume !== null && volume !== undefined && (typeof volume !== "number" || !Number.isInteger(volume) || volume < 0 || volume > 100)) || (handle !== null && handle !== undefined && !Number.isInteger(handle)) || (source !== undefined && typeof source !== "string")) {
        diag("audio.effect", effect.name, { reason: "malformed arguments" });
        return "applied";
      }
      const result = runtime.play({
        asset: asset as AssetKey,
        track,
        loop,
        restart,
        priority,
        source: (source ?? "script") as AudioSource,
        ...(syncTrack === null || syncTrack === "" ? {} : { syncTrack }),
        ...(voice === null ? {} : { voice: voice as number }),
        ...(typeof volume === "number" ? { volume } : {}),
        ...(beforeHandled ? { beforePlayHandled: true } : {}),
        diagnosticOp: effect.name,
      });
      if (result.kind === "before-play") {
        args[9] = typeof source === "string" ? source : "script";
        args[10] = result.event;
        args[11] = false;
        syncEffectArgs(host, effect, args);
      }
      if (typeof handle === "number") options.bindVoice?.(handle, result);
      return result.kind === "pending" || result.kind === "before-play" ? "pending" : "applied";
    }
    if (operation === "media.stop" || operation === "media.pause" || operation === "media.resume") {
      const track = args[0];
      const voice = selectorValue(args[1]);
      if (typeof track !== "string" || voice === null) {
        diag("audio.effect", effect.name, { reason: "malformed arguments" });
        return "applied";
      }
      if (operation === "media.stop") runtime.stop(track, voice);
      else if (operation === "media.pause") runtime.pause(track, voice);
      else runtime.resume(track, voice);
      return "applied";
    }
    if (operation === "media.seek" || operation === "media.loop" || operation === "media.fade" || operation === "media.volume") {
      const track = args[0];
      const second = args[1];
      if (operation === "media.volume" && track === null && typeof second === "number" && args[2] === null) {
        runtime.setMasterVolume(second);
        return "applied";
      }
      if (typeof track !== "string") {
        diag("audio.effect", effect.name, { reason: "malformed arguments" });
        return "applied";
      }
      if (operation === "media.seek") {
        const voice = selectorValue(args[2]);
        if (typeof second !== "number" || voice === null) diag("audio.effect", effect.name, { reason: "malformed arguments" });
        else runtime.seek(track, second, voice);
        return "applied";
      }
      if (operation === "media.loop") {
        const voice = selectorValue(args[2]);
        if (typeof second !== "boolean" || voice === null) diag("audio.effect", effect.name, { reason: "malformed arguments" });
        else runtime.setLoop(track, second, voice);
        return "applied";
      }
      if (operation === "media.fade") {
        const voice = selectorValue(args[3]);
        if (typeof second !== "number" || typeof args[2] !== "number" || voice === null) diag("audio.effect", effect.name, { reason: "malformed arguments" });
        else runtime.fade(track, second, args[2], voice);
        return "applied";
      }
      const voice = selectorValue(args[2]);
      if (typeof second !== "number" || voice === null) diag("audio.effect", effect.name, { reason: "malformed arguments" });
      else if (voice === undefined) runtime.setTrackVolume(track, second);
      else runtime.setVoiceVolume(track, voice, second);
      return "applied";
    }
    if (operation === "soundfont.set") {
      const asset = args[0] ?? null;
      if (asset !== null && typeof asset !== "string") {
        diag("audio.effect", effect.name, { reason: "asset is not a key or null" });
        return "applied";
      }
      host.audio.soundFont = asset as AssetKey | null;
      emit("soundfont.set", { asset: host.audio.soundFont ?? defaultSoundFont });
      return "applied";
    }
    if (operation !== "music.play" && operation !== "sfx.play") {
      diag("audio.effect", effect.name, { reason: "unknown audio effect" });
      return "applied";
    }
    const asset = args[0] ?? null;
    const loop = args[1];
    const restart = args[2] ?? null;
    const source = args[3];
    if ((asset !== null && typeof asset !== "string") || typeof loop !== "boolean" || (restart !== null && typeof restart !== "boolean") || typeof source !== "string" || (operation === "sfx.play" && asset === null)) {
      diag("audio.effect", effect.name, { reason: "malformed arguments" });
      return "applied";
    }
    const isMusic = operation === "music.play";
    const track = findTrack(host.audio, isMusic ? "music" : source === "ui" ? "ui" : "sfx");
    if (track === undefined) {
      diag("media.unknown-track", effect.name, { track: isMusic ? "music" : source === "ui" ? "ui" : "sfx" });
      return "applied";
    }
    if (asset === null) {
      const current = track.voices[0];
      if (current !== undefined) stopVoice(track, current);
      track.file = null;
      refresh(track);
      notify({ kind: "silence", track: track.name, source });
      return "applied";
    }
    const sourceKind: AudioSource = source === "script"
      ? "script"
      : source === "video"
        ? "video"
        : source === "battle"
          ? "battle"
          : source === "ui" || source === "menu"
            ? "menu"
            : source === "frame" || source === "animation"
              ? "animation"
              : operation === "sfx.play"
                ? "animation"
                : "board";
    const beforePlayHandled = args[4] === true;
    const pendingVolume = typeof args[5] === "number" ? args[5] : undefined;
    const result = runtime.play({
      asset: asset as AssetKey,
      track: track.name,
      loop: isMusic ? loop : false,
      restart: restart === true,
      priority: 0,
      source: sourceKind,
      ...(pendingVolume === undefined ? {} : { volume: pendingVolume }),
      diagnosticOp: effect.name,
      ...(beforePlayHandled ? { beforePlayHandled: true } : {}),
    });
    if (result.kind === "pending" && result.beforePlayHandled === true) {
      args[4] = true;
      if (result.asset !== undefined) args[0] = result.asset;
      if (result.loop !== undefined) args[1] = result.loop;
      if (result.volume !== undefined) args[5] = result.volume;
    }
    return result.kind === "pending" || result.kind === "before-play" ? "pending" : "applied";
  }

  /** The effects waiting for an asset: the engine section's own pending queue for `audio`, so a snapshot keeps them. */
  function queued(): EffectRecord[] {
    return host.engine.pendingEffects?.audio ?? [];
  }

  function hold(effect: EffectRecord): void {
    const queues = (host.engine.pendingEffects ??= {});
    (queues.audio ??= []).push(effect);
  }

  function retry(): void {
    const queue = queued();
    while (queue.length > 0) {
      const head = queue[0];
      if (head === undefined || applyEffect(head) === "pending") return;
      queue.shift();
    }
    const queues = host.engine.pendingEffects;
    if (queues === undefined || queues.audio === undefined) return;
    delete queues.audio;
    if (Object.keys(queues).length === 0) delete host.engine.pendingEffects;
  }

  function apply(effect: EffectRecord): void {
    if (queued().length > 0) {
      hold(effect);
      return;
    }
    if (applyEffect(effect) === "pending") hold(effect);
  }

  function applyTrackConfiguration(name: string, voices: number): AudioPackageTrackProblem | null {
    if (typeof name !== "string" || !MEDIA_TRACK_NAME.test(name)) return "invalid-name";
    if (!Number.isInteger(voices) || voices < 1) return "voice-count";
    const existing = findTrack(host.audio, name);
    const sum = host.audio.tracks.reduce((total, track) => total + track.voiceCount, 0) - (existing?.voiceCount ?? 0) + voices;
    if (existing !== undefined) {
      if (existing.voices.some((voice) => voice.index >= voices)) return "voice-count";
      if (sum > voiceCap) return "voice-cap";
      existing.voiceCount = voices;
      return null;
    }
    if (host.audio.tracks.length >= MAX_TRACKS) return "track-limit";
    if (sum > voiceCap) return "voice-cap";
    host.audio.tracks.push(createTrack(asciiFold(name), voices));
    return null;
  }

  function reportTrackConfiguration(name: string, voices: number, problem: AudioPackageTrackProblem): void {
    const code = problem === "invalid-name"
      ? "media.invalid-track-name"
      : problem === "voice-count"
        ? "media.voice-count"
        : problem === "track-limit"
          ? "media.track-limit"
          : "media.voice-cap";
    if (problem === "invalid-name" || problem === "track-limit") {
      diag(code, "mediaTrack", { name });
      return;
    }
    diag(code, "mediaTrack", { name, voices });
  }
  function resetGameAudio(): void {
    voiceCap = MAX_VOICES;
    host.audio.tracks = BUILTIN_TRACKS.map(([name, voiceCount]) => createTrack(name, voiceCount));
  }

  const runtimeApi: AudioRuntime = {
    register(bus) {
      emit("soundfont.set", { asset: host.audio.soundFont ?? defaultSoundFont });
      bus.register("audio", apply);
    },
    applyGameAudio(settings) {
      let sum = 0;
      for (let index = 0; index < settings.tracks.length; index += 1) {
        sum += settings.tracks[index]!.voiceCount;
        if (sum > settings.voiceCap) {
          resetGameAudio();
          return { ok: false, overflowIndex: index };
        }
      }
      voiceCap = settings.voiceCap;
      host.audio.tracks = settings.tracks.map((track) => createTrack(asciiFold(track.name), track.voiceCount));
      return { ok: true };
    },
    setDefaultSoundFont(font) {
      defaultSoundFont = font;
    },
    apply,
    retry,
    phase() {
      const tick = host.time.tick;
      for (const track of host.audio.tracks) {
        for (const voice of [...track.voices]) {
          if (voice.state === "playing" && !voice.loop && voice.endTick !== null && tick >= voice.endTick) {
            notify({ kind: "finished", track: track.name, voice: voice.index, cueId: voice.cueId, endTick: voice.endTick });
            stopVoice(track, voice, "ended");
          }
        }
        for (const voice of [...track.voices]) {
          if (voice.state !== "playing" || !voice.loop) continue;
          const pass = voicePass(voice, tick);
          if (pass === null) continue;
          const previous = observedPass.get(voice);
          if (previous === undefined) {
            const baseline = voicePass(voice, tick - 1);
            if (baseline !== null) {
              for (let crossed = baseline + 1; crossed <= pass; crossed += 1) emitTransition("looped", track, voice, tick);
            }
            observedPass.set(voice, pass);
          } else {
            for (let crossed = previous + 1; crossed <= pass; crossed += 1) emitTransition("looped", track, voice, tick);
            observedPass.set(voice, pass);
          }
        }
        refresh(track, tick);
      }
    },
    drain() {
      return cues.splice(0);
    },
    heldCount() {
      return queued().length;
    },
    configurePackageTrack(name, voices) {
      if (typeof name === "string" && MEDIA_TRACK_NAME.test(name) && Number.isInteger(voices) && voices >= 1) {
        const existing = findTrack(host.audio, name);
        if (existing !== undefined && voices <= existing.voiceCount) return null;
      }
      return applyTrackConfiguration(name, voices);
    },
    configureTrack(name, voices = 1) {
      const existing = typeof name === "string" && MEDIA_TRACK_NAME.test(name) ? findTrack(host.audio, name) : undefined;
      const problem = applyTrackConfiguration(name, voices);
      if (problem === null) return true;
      const existingFailure = existing !== undefined &&
        (problem === "voice-cap" || (problem === "voice-count" && Number.isInteger(voices) && voices >= 1));
      reportTrackConfiguration(existingFailure ? existing.name : name, voices, problem);
      return false;
    },
    play(request) {
      const found = findTrack(host.audio, request.track);
      if (found === undefined) {
        diag("media.unknown-track", "mediaPlay", { track: request.track });
        return { kind: "rejected" };
      }
      if (request.voice !== undefined && (!Number.isInteger(request.voice) || request.voice < 0 || request.voice >= found.voiceCount)) {
        diag("media.unknown-voice", "mediaPlay", { track: found.name, voice: request.voice });
        return { kind: "rejected" };
      }
      if (request.loop && request.wait === true) {
        diag("media.wait-loop", "mediaPlay", { track: found.name });
        return { kind: "rejected" };
      }
      let info = options.lookup(request.asset);
      if (info.kind === "pending") {
        options.need?.(request.asset);
        return { kind: "pending" };
      }
      const current = found.voices[0];
      if (request.voice === undefined && found.voiceCount === 1 && current !== undefined && current.state === "playing" && current.file === request.asset && request.restart !== true) {
        const action = found.name === "music" ? "carry-on" : "ignored";
        notify({ kind: "same-file", track: found.name, file: request.asset, action });
        return { kind: "same-file", action, voice: current.index, cueId: current.cueId };
      }
      let asset = request.asset;
      let loop = request.loop;
      let volume = request.volume ?? 100;
      let beforePlayHandled = request.beforePlayHandled === true;
      const source = request.source ?? "script";
      const slot = request.voice ?? (found.voiceCount === 1 ? 0 : allocate(found));
      const original: BeforePlayDetail = {
        source,
        track: found.name,
        slot,
        cueId: host.audio.cueId,
        file: asset,
        volume,
        loop,
      };
      if (!beforePlayHandled && hasBeforePlayListeners()) {
        if (source === "script") {
          const event = queueNativeEvent(host.vm, host.events, MEDIA_EMITTER, "beforePlay", original, true);
          return { kind: "before-play", event };
        }
        const detail = { ...original };
        const outcome = options.engineBeforePlay?.(detail) ?? "failed";
        if (outcome === "canceled") return { kind: "canceled" };
        if (outcome === "failed") return { kind: "rejected" };
        const validated = validateEngineDetail(detail, original);
        asset = validated.file;
        volume = validated.volume;
        loop = validated.loop;
        beforePlayHandled = true;
      }
      if (asset !== request.asset) {
        info = options.lookup(asset);
        if (info.kind === "pending") {
          options.need?.(asset);
          return beforePlayHandled
            ? { kind: "pending", beforePlayHandled: true, asset, volume, loop }
            : { kind: "pending" };
        }
      }
      let positionTicks: number | undefined;
      if (request.syncTrack !== undefined) {
        const sourceTrack = findTrack(host.audio, request.syncTrack);
        const syncVoice = sourceTrack?.voices.find((voice) => voice.index === 0);
        if (sourceTrack === undefined || syncVoice === undefined || syncVoice.lengthTicks === null || syncVoice.lengthTicks <= 0 || info.kind !== "known" || info.lengthTicks === null || info.lengthTicks <= 0) {
          diag("media.sync-source", request.diagnosticOp ?? "mediaPlay", { sync: request.syncTrack });
          positionTicks = 0;
        } else {
          positionTicks = voicePosition(syncVoice, host.time.tick) % info.lengthTicks;
        }
      }
      const started = startVoice(found, asset, info, {
        loop,
        restart: request.restart === true,
        priority: request.priority ?? 0,
        volume,
        op: request.diagnosticOp ?? "mediaPlay",
        voice: request.voice,
        positionTicks,
      });
      if (!("index" in started)) return { kind: "same-file", action: started.action, voice: started.voice.index, cueId: started.voice.cueId };
      let wait: AudioWait | null = null;
      if (request.wait === true) {
        if (started.lengthTicks === null) diag("media.asset-length", request.diagnosticOp ?? "mediaPlay", { track: found.name, voice: started.index });
        else wait = makeWait(found, started, false);
      }
      return { kind: "started", voice: started.index, cueId: started.cueId, wait };
    },
    stop(track, voice) {
      const at = locate("mediaStop", track, voice);
      if (at === null || at.stale) return false;
      if (at.voice === undefined) {
        notify({ kind: "no-op", op: "mediaStop", track: at.track.name });
        return true;
      }
      stopVoice(at.track, at.voice);
      refresh(at.track);
      return true;
    },
    pause(track, voice) {
      const at = locate("mediaPause", track, voice);
      if (at === null || at.stale) return false;
      const target = at.voice;
      if (target === undefined || target.state !== "playing") {
        notify({ kind: "no-op", op: "mediaPause", track: at.track.name });
        return true;
      }
      const tick = host.time.tick;
      refresh(at.track, tick);
      target.positionTicks = voicePosition(target, tick);
      if (target.loop) {
        const pass = voicePass(target, tick);
        if (pass !== null) observedPass.set(target, pass);
      }
      target.pausedTick = tick;
      target.state = "paused";
      emit("media.pause", { track: at.track.name, voice: at.index });
      emitTransition("paused", at.track, target, tick);
      refresh(at.track);
      return true;
    },
    resume(track, voice) {
      const at = locate("mediaResume", track, voice);
      if (at === null || at.stale) return false;
      const target = at.voice;
      if (target === undefined || target.state !== "paused" || target.pausedTick === null) {
        notify({ kind: "no-op", op: "mediaResume", track: at.track.name });
        return true;
      }
      const tick = host.time.tick;
      const span = tick - target.pausedTick;
      target.startTick += span;
      if (target.endTick !== null) target.endTick += span;
      if (target.fade !== null) target.fade.startTick += tick - Math.max(target.pausedTick, target.fade.startTick);
      target.state = "playing";
      target.pausedTick = null;
      if (target.loop) {
        const pass = voicePass(target, tick);
        if (pass !== null) observedPass.set(target, pass);
      }
      emit("media.resume", { track: at.track.name, voice: at.index });
      emitTransition("resumed", at.track, target, tick);
      refresh(at.track);
      return true;
    },
    seek(track, positionTicks, voice) {
      const at = locate("mediaSeek", track, voice);
      if (at === null || at.stale) return false;
      if (!Number.isInteger(positionTicks) || positionTicks < 0 || positionTicks > MAX_POSITION) {
        diag("media.invalid-time", "mediaSeek", { positionTicks });
        return false;
      }
      const target = at.voice;
      if (target === undefined) {
        diag("media.unknown-voice", "mediaSeek", { track: at.track.name, voice: at.index });
        return false;
      }
      const length = target.lengthTicks;
      if (length === null) {
        diag("media.asset-length", "mediaSeek", { track: at.track.name, voice: at.index });
        return false;
      }
      const position = target.loop ? positionTicks % length : Math.min(positionTicks, length);
      const base = target.state === "paused" && target.pausedTick !== null ? target.pausedTick : host.time.tick;
      target.startTick = base - position;
      if (target.state === "paused") target.positionTicks = position;
      target.endTick = target.loop ? null : target.startTick + length;
      if (target.loop) {
        const pass = target.state === "paused" ? floorDiv(target.positionTicks, length) : voicePass(target, host.time.tick);
        if (pass !== null) observedPass.set(target, pass);
      }
      emit("media.seek", { track: at.track.name, voice: at.index, positionTicks: position });
      refresh(at.track);
      return true;
    },
    setLoop(track, loop, voice) {
      const at = locate("mediaLoop", track, voice);
      if (at === null || at.stale) return false;
      const target = at.voice;
      if (target === undefined) {
        diag("media.unknown-voice", "mediaLoop", { track: at.track.name, voice: at.index });
        return false;
      }
      target.loop = loop;
      const length = target.lengthTicks;
      if (length !== null) {
        if (loop) target.endTick = null;
        else {
          const base = target.state === "paused" && target.pausedTick !== null ? target.pausedTick : host.time.tick;
          target.endTick = target.startTick + (floorDiv(base - target.startTick, length) + 1) * length;
        }
      }
      if (loop) {
        const pass = target.state === "paused" && length !== null ? floorDiv(target.positionTicks, length) : voicePass(target, host.time.tick);
        if (pass !== null) observedPass.set(target, pass);
      } else {
        observedPass.delete(target);
      }
      if (at.index === 0) at.track.flags = loop ? MEDIA_LOOP : 0;
      emit("media.flags", { track: at.track.name, voice: at.index, loop, flags: loop ? MEDIA_LOOP : 0 });
      refresh(at.track);
      return true;
    },
    setMasterVolume(percent) {
      if (!validPercent("setvolume", percent)) return false;
      host.audio.settings.masterVolume = percent;
      emit("media.volume", { volume: percent });
      return true;
    },
    setTrackVolume(track, percent) {
      const found = findTrack(host.audio, track);
      if (found === undefined) {
        diag("media.unknown-track", "mediaVolume", { track });
        return false;
      }
      if (!validPercent("mediaVolume", percent)) return false;
      refresh(found);
      trackVolumeEntry(found.name, percent, null);
      emit("media.volume", { track: found.name, volume: percent });
      return true;
    },
    setVoiceVolume(track, voice, percent) {
      const found = findTrack(host.audio, track);
      if (found === undefined) {
        diag("media.unknown-track", "mediaVolume", { track });
        return false;
      }
      if (!validPercent("mediaVolume", percent)) return false;
      const at = locate("mediaVolume", track, voice);
      if (at === null || at.stale) return false;
      if (at.voice === undefined) {
        diag("media.unknown-voice", "mediaVolume", { track: at.track.name, voice: at.index });
        return false;
      }
      refresh(at.track);
      at.voice.volume = percent;
      at.voice.fade = null;
      emit("media.volume", { track: at.track.name, voice: at.index, volume: percent });
      refresh(at.track);
      return true;
    },
    fade(track, percent, durationTicks, voice) {
      const found = findTrack(host.audio, track);
      if (found === undefined) {
        diag("media.unknown-track", "mediaFade", { track });
        return false;
      }
      if (!validPercent("mediaFade", percent)) return false;
      if (!Number.isInteger(durationTicks) || durationTicks < 0 || durationTicks > MAX_POSITION) {
        diag("media.invalid-time", "mediaFade", { durationTicks });
        return false;
      }
      const tick = host.time.tick;
      if (voice === undefined) {
        refresh(found, tick);
        const entry = host.audio.settings.trackVolumes.find((item) => item.name === found.name);
        const from = entry?.volume ?? 100;
        const fade = durationTicks === 0 ? null : { fromVolume: from, targetVolume: percent, startTick: tick, durationTicks };
        trackVolumeEntry(found.name, durationTicks === 0 ? percent : from, fade);
        emit("media.fade", { track: found.name, volume: from, targetVolume: percent, durationTicks });
        if (durationTicks === 0) for (const active of found.voices) emitTransition("faded", found, active, tick);
        return true;
      }
      const at = locate("mediaFade", track, voice);
      if (at === null || at.stale || at.voice === undefined) return false;
      refresh(at.track, tick);
      const from = at.voice.volume;
      at.voice.fade = durationTicks === 0 ? null : { fromVolume: from, targetVolume: percent, startTick: tick, durationTicks };
      at.voice.volume = durationTicks === 0 ? percent : from;
      emit("media.fade", { track: at.track.name, voice: at.index, volume: from, targetVolume: percent, durationTicks });
      if (durationTicks === 0) emitTransition("faded", at.track, at.voice, tick);
      refresh(at.track, tick);
      return true;
    },
    waitFor(track, voice) {
      const at = locate("mediaWait", track, voice);
      if (at === null || at.stale || at.voice === undefined) return null;
      if (at.voice.lengthTicks === null) {
        diag("media.asset-length", "mediaWait", { track: at.track.name, voice: at.index });
        return null;
      }
      return makeWait(at.track, at.voice, at.voice.loop);
    },
    pollWait(wait) {
      const track = findTrack(host.audio, wait.track);
      const voice = track?.voices.find((item) => item.index === wait.voice && item.cueId === wait.cueId);
      if (voice === undefined) return { wake: true, why: "gone" };
      if (voice.state === "paused") return { wake: false };
      const tick = host.time.tick;
      if (wait.pass && voice.loop) {
        const pass = voicePass(voice, tick);
        return pass !== null && wait.passIndex !== null && pass > wait.passIndex ? { wake: true, why: "pass" } : { wake: false };
      }
      return voice.endTick !== null && tick >= voice.endTick ? { wake: true, why: "end" } : { wake: false };
    },
    load(saved) {
      const wasEnabled = lifecycleEnabled;
      lifecycleEnabled = false;
      observedPass.clear();
      try {
        const tick = host.time.tick;
        const shift = tick - saved.tick;
        host.audio.cueId = Math.max(host.audio.cueId, saved.cueId);
        emit("soundfont.set", { asset: host.audio.soundFont ?? defaultSoundFont });
        const savedByName = new Map(saved.tracks.map((track) => [asciiFold(track.name), track]));
        const tracks: AudioTrackState[] = [];
        for (const configured of host.audio.tracks) {
          const track = createTrack(configured.name, configured.voiceCount);
          const savedTrack = savedByName.get(asciiFold(configured.name));
          if (savedTrack === undefined) {
            tracks.push(track);
            continue;
          }
          track.flags = savedTrack.flags;
          track.file = savedTrack.file;
          const isMusic = configured.name === "music";
          for (const source of [...savedTrack.voices].sort((a, b) => a.index - b.index)) {
            if (source.index >= configured.voiceCount) continue;
            const voice = copyVoice(source, saved.tick);
            if (voice.state === "paused") {
              voice.startTick += shift;
              if (voice.endTick !== null) voice.endTick += shift;
              voice.pausedTick = (voice.pausedTick ?? saved.tick) + shift;
              voice.fade = copyFade(source.fade, shift);
              voice.cueId = emit("media.play", { track: track.name, voice: voice.index, asset: voice.file, loop: voice.loop, flags: voice.loop ? MEDIA_LOOP : 0, positionTicks: voice.positionTicks, volume: voice.volume });
              emit("media.pause", { track: track.name, voice: voice.index });
            } else {
              const length = voice.lengthTicks;
              if (length !== null && !voice.loop && voice.positionTicks >= length) continue;
              const position = isMusic ? 0 : voice.positionTicks;
              voice.startTick = tick - position;
              voice.positionTicks = position;
              voice.endTick = length !== null && !voice.loop ? voice.startTick + length : null;
              voice.pausedTick = null;
              voice.fade = copyFade(source.fade, shift);
              voice.cueId = emit("media.play", { track: track.name, voice: voice.index, asset: voice.file, loop: voice.loop, flags: voice.loop ? MEDIA_LOOP : 0, positionTicks: 0, volume: voice.volume }, voice.startTick);
            }
            track.voices.push(voice);
            if (voice.loop && voice.lengthTicks !== null) {
              const pass = voice.state === "paused" ? floorDiv(voice.positionTicks, voice.lengthTicks) : voicePass(voice, tick);
              if (pass !== null) observedPass.set(voice, pass);
            }
          }
          refresh(track);
          tracks.push(track);
        }
        host.audio.tracks = tracks;
      } finally {
        lifecycleEnabled = wasEnabled;
      }
    },
  };
  runtime = runtimeApi;
  return runtimeApi;
}
