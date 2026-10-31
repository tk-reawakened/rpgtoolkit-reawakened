/**
 * The script-facing media objects (MEDIA-1, MEDIA-2; entry 21.5): the global
 * `media` emitter, track objects and the data-only voice `mediaPlay` returns.
 *
 * A voice record holds exactly `{ track, slot, cueId }`; its readable fields
 * and methods are hydrated from the audio owner on every access (OOP-12), so a
 * save carries no callable. Every operation posts the ordinary audio effect
 * through the central applier; nothing here changes playback rules.
 *
 * Emitter registration is lazy (MEDIA-2): creating or reading an object does
 * not register it, only `on`/`once`/`off`/`emit`/`emitCancelable` access (the
 * VM asks the host type for its `emitterKey`) or a declared native listener.
 */

import { BUILTIN_TRACKS, fadeValue, findVoice, findTrack, voicePosition, voiceWaitPayload, type MediaVoiceRef } from "./model.ts";
import { MEDIA_EMITTER, mediaEventsActive, mediaTrackEmitterKey, mediaVoiceEmitterKey } from "./events.ts";
import type { AudioPlayResult } from "./runtime.ts";
import { adoptEmitter, registerEmitter } from "../events/emitter.ts";
import { createHostObject, findObject, writeMember } from "../script/objects.ts";
import type { HostObjectType } from "../script/host.ts";
import type { ObjectRecord } from "../script/state.ts";
import type { PlainData } from "../ports/plain-data.ts";
import type { Value } from "../ports/value.ts";
import type { NamedWait } from "../ports/wait.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { GameState } from "../save/state.ts";

/** The ruled named options of `mediaPlay(file[, options])` (MEDIA-1). */
export type MediaPlayOptions = {
  readonly track: string;
  readonly loop: boolean;
  readonly volume: number;
  readonly priority: number;
  readonly sync: string | null;
  readonly wait: boolean;
};

/** What the applier decided about one script start. */
export type MediaPlayOutcome = AudioPlayResult;

/** A live voice's script-visible state (ticks for `position`/`length`). */
export type MediaVoiceView = {
  readonly file: AssetKey;
  readonly state: "playing" | "paused";
  readonly positionTicks: number;
  readonly lengthTicks: number | null;
  readonly volume: number;
  readonly loop: boolean;
};

export type MediaStart = {
  readonly record: ObjectRecord;
  /** The applier's decision; `pending` while the effect waits for the asset. */
  readonly outcome: MediaPlayOutcome;
  /** The stamped effect sequence, used by a pending wait. */
  readonly seq: number;
};

export type MediaScriptService = {
  /** Create the voice object, post the start and bind it. */
  play(file: string, options: MediaPlayOptions): MediaStart;
  /** Start a resolved battle background on the built-in music track, without exposing a script source option. */
  playBattleMusic(file: string): void;
  /** Fill a voice object's slot and cue id from the applier's decision. */
  bind(handle: number, result: AudioPlayResult): void;
  /** A wait that parks until a pending start binds, then applies the terminal rule. */
  pendingWait(start: MediaStart): NamedWait;
  /** A wait that parks until a cancelable beforePlay dispatch has completed. */
  beforePlayWait(start: MediaStart, returnVoice: boolean, waitForEnd: boolean): NamedWait;
  /** The one `media` host object, reused for the session. */
  mediaObject(): ObjectRecord;
  /** The one host object for a configured track; `null` for an unknown name. */
  trackObject(name: string): ObjectRecord | null;
  activateDeclared(): void;
  voice(ref: MediaVoiceRef): MediaVoiceView | null;
  voiceWait(ref: MediaVoiceRef): NamedWait | null;
  stop(ref: MediaVoiceRef): void;
  pause(ref: MediaVoiceRef): void;
  resume(ref: MediaVoiceRef): void;
  seek(ref: MediaVoiceRef, ticks: number): void;
  fade(ref: MediaVoiceRef, percent: number, ticks: number): void;
  setVoiceVolume(ref: MediaVoiceRef, percent: number): void;
  setVoiceLoop(ref: MediaVoiceRef, loop: boolean): void;
  trackVolume(name: string): number;
  setTrackVolume(name: string, percent: number): void;
  trackFade(name: string, percent: number, ticks: number): void;
  diagnose(code: string, op: string, detail: Record<string, string | number | boolean | null>): void;
};

/** A script-visible object value for a host record. */
export function objectValue(record: ObjectRecord): Value {
  return { kind: "object", handle: record.handle, className: record.className };
}

/** The voice identity a record's members name, or `null` while it is unbound. */
export function mediaVoiceRef(record: ObjectRecord): MediaVoiceRef | null {
  const track = record.members["track"];
  const slot = record.members["slot"];
  const cueId = record.members["cueId"];
  if (typeof track !== "string" || !Number.isInteger(slot) || !Number.isInteger(cueId)) return null;
  return { track, slot: slot as number, cueId: cueId as number };
}

/** The track name a `media.track` record names. */
function mediaTrackName(record: ObjectRecord): string | null {
  const name = record.members["name"];
  return typeof name === "string" ? name : null;
}

export function createMediaScriptService(
  state: GameState,
  post: (name: string, args: readonly PlainData[]) => { readonly seq: number },
  resolveMusicAsset: (file: string) => AssetKey | null,
  diagnose: (code: string, op: string, detail: Record<string, string | number | boolean | null>) => void,
): MediaScriptService {
  let mediaRecord: ObjectRecord | null = null;
  const trackRecords = new Map<string, ObjectRecord>();
  const waiting = new Set<number>();
  const results = new Map<number, AudioPlayResult>();

  const service: MediaScriptService = {
    playBattleMusic(file) {
      if (file === "") return;
      const asset = resolveMusicAsset(file);
      if (asset !== null) post("music.play", [asset, true, false, "battle"]);
    },
    play(file, options) {
      const record = createHostObject(state.vm, "media.voice");
      writeMember(record, "track", options.track);
      waiting.add(record.handle);
      const posted = post("media.play", [file, options.track, options.loop, false, options.priority, options.sync, null, options.volume, record.handle]);
      const outcome = results.get(record.handle) ?? { kind: "pending" };
      results.delete(record.handle);
      waiting.delete(record.handle);
      return { record, outcome, seq: posted.seq };
    },
    pendingWait(start) {
      return {
        kind: "audio.track",
        global: false,
        id: "mediaWait",
        payload: [{ track: String(start.record.members["track"]), voice: null, cueId: 0, endTick: null, pass: false, passIndex: null, handle: start.record.handle, seq: start.seq }, null, objectValue(start.record)],
        resumeRefs: [],
      };
    },
    beforePlayWait(start, returnVoice, waitForEnd) {
      return {
        kind: "event.dispatch",
        global: false,
        id: "media.beforePlay",
        payload: [start.outcome.kind === "before-play" ? start.outcome.event : 0, objectValue(start.record), start.seq, returnVoice, waitForEnd],
        resumeRefs: [],
      };
    },
    bind(handle, result) {
      const record = findObject(state.vm, handle);
      // A restored save may hold a `media.play` whose voice handle was freed and its
      // number reallocated, so the handle names no live voice or one this play did not
      // build (issue #825). Tolerate that: write nothing, skip the diagnosis and the
      // emitter adoption, and keep the play's own result.
      const voice = record !== undefined && record.hostType === "media.voice" && typeof record.members["track"] === "string" ? record : undefined;
      if (voice !== undefined && (result.kind === "started" || (result.kind === "same-file" && result.action === "carry-on"))) {
        writeMember(voice, "slot", result.voice);
        writeMember(voice, "cueId", result.cueId);
        const ref = mediaVoiceRef(voice);
        if (ref !== null && !waiting.has(handle)) {
          const live = findVoice(state.audio, ref);
          if (live?.lengthTicks === null && state.vm.threads.some((thread) => {
            const wait = thread.wait;
            if (wait?.kind !== "audio.track") return false;
            const payload = wait.payload[0];
            return payload !== null && typeof payload === "object" && !Array.isArray(payload) && payload.handle === handle;
          })) diagnose("media.asset-length", "voice.wait", { track: ref.track, voice: ref.slot });
        }
        if (ref !== null && mediaEventsActive(state)) {
          const track = service.trackObject(ref.track);
          if (track !== null) adoptEmitter(state.vm, state.events, mediaTrackEmitterKey(ref.track), track);
          adoptEmitter(state.vm, state.events, mediaVoiceEmitterKey({ track: ref.track, slot: result.voice, cueId: result.cueId }), voice);
          adoptEmitter(state.vm, state.events, MEDIA_EMITTER, service.mediaObject());
        }
      }
      if (waiting.has(handle)) results.set(handle, result);
    },
    mediaObject() {
      if (mediaRecord === null || findObject(state.vm, mediaRecord.handle) !== mediaRecord) {
        const registered = state.events.emitters?.[MEDIA_EMITTER];
        const live = registered === undefined ? undefined : findObject(state.vm, registered);
        mediaRecord = live?.hostType === "media" ? live : createHostObject(state.vm, "media");
      }
      return mediaRecord;
    },
    trackObject(name) {
      const folded = name.toLowerCase();
      if (findTrack(state.audio, folded) === undefined) return null;
      const existing = trackRecords.get(folded);
      if (existing !== undefined && findObject(state.vm, existing.handle) === existing) return existing;
      const registered = state.events.emitters?.[mediaTrackEmitterKey(folded)];
      const live = registered === undefined ? undefined : findObject(state.vm, registered);
      const record = live?.hostType === "media.track" ? live : createHostObject(state.vm, "media.track");
      writeMember(record, "name", folded);
      trackRecords.set(folded, record);
      return record;
    },
    activateDeclared() {
      const keys = new Set<string>([...state.events.listeners.map((listener) => listener.emitter), ...Object.keys(state.events.emitters ?? {})]);
      for (const key of keys) {
        if (key === MEDIA_EMITTER) {
          registerEmitter(state.vm, state.events, MEDIA_EMITTER, service.mediaObject());
          continue;
        }
        if (!key.startsWith("media.track:")) continue;
        const track = service.trackObject(key.slice("media.track:".length));
        if (track !== null) registerEmitter(state.vm, state.events, key, track);
      }
    },
    voice(ref) {
      const voice = findVoice(state.audio, ref);
      if (voice === undefined) return null;
      const volume = voice.fade === null ? voice.volume : fadeValue(voice.fade, state.time.tick, voice.state === "paused" ? voice.pausedTick ?? state.time.tick : undefined);
      return { file: voice.file, state: voice.state, positionTicks: voicePosition(voice, state.time.tick), lengthTicks: voice.lengthTicks, volume, loop: voice.loop };
    },
    voiceWait(ref) {
      const track = findTrack(state.audio, ref.track);
      if (track === undefined || findVoice(state.audio, ref) === undefined) {
        diagnose("media.unknown-voice", "mediaWait", { track: ref.track, voice: ref.slot });
        return null;
      }
      const voice = findVoice(state.audio, ref)!;
      if (voice.loop) {
        diagnose("media.wait-loop", "voice.wait", { track: track.name, voice: ref.slot });
        return null;
      }
      const payload = voiceWaitPayload(state.audio, ref, state.time.tick);
      if (payload === null) {
        diagnose("media.asset-length", "voice.wait", { track: track.name, voice: ref.slot });
        return null;
      }
      return { kind: "audio.track", global: false, id: "mediaWait", payload: [payload], resumeRefs: [] };
    },
    stop(ref) {
      post("media.stop", [ref.track, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    pause(ref) {
      post("media.pause", [ref.track, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    resume(ref) {
      post("media.resume", [ref.track, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    seek(ref, ticks) {
      post("media.seek", [ref.track, ticks, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    fade(ref, percent, ticks) {
      post("media.fade", [ref.track, percent, ticks, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    setVoiceVolume(ref, percent) {
      post("media.volume", [ref.track, percent, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    setVoiceLoop(ref, loop) {
      post("media.loop", [ref.track, loop, { track: ref.track, slot: ref.slot, cueId: ref.cueId }]);
    },
    trackVolume(name) {
      const entry = state.audio.settings.trackVolumes.find((item) => item.name === name);
      return entry === undefined ? 100 : entry.fade === null ? entry.volume : fadeValue(entry.fade, state.time.tick);
    },
    setTrackVolume(name, percent) {
      post("media.volume", [name, percent, null]);
    },
    trackFade(name, percent, ticks) {
      post("media.fade", [name, percent, ticks, null]);
    },
    diagnose,
  };
  return service;
}

/** The media host declarations (OOP-12): data-only records with hydrated members and methods. */
export const MEDIA_HOST_TYPES: readonly HostObjectType[] = [
  {
    name: "media",
    methods: { track: "mediatrackget" },
    emitterKey: () => MEDIA_EMITTER,
    read(context, name): Value | undefined {
      const folded = name.toLowerCase();
      if (!BUILTIN_TRACKS.some(([track]) => track === folded)) return undefined;
      const record = context.media?.trackObject(folded);
      return record === null || record === undefined ? undefined : objectValue(record);
    },
    write() {
      return "read-only";
    },
    remove() {
      return "system-owned";
    },
  },
  {
    name: "media.track",
    methods: { fade: "mediatrackfade" },
    emitterKey(record) {
      const name = mediaTrackName(record);
      return name === null ? null : mediaTrackEmitterKey(name);
    },
    read(context, name): Value | undefined {
      if (name.toLowerCase() === "volume") return context.media?.trackVolume(mediaTrackName(context.record) ?? "") ?? 100;
      return undefined;
    },
    write(context, name, value) {
      const track = mediaTrackName(context.record);
      if (track === null || context.media === undefined) return "not-host";
      if (name.toLowerCase() !== "volume") return "read-only";
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
        context.media.diagnose("media.invalid-volume", "track.volume", { track, percent: typeof value === "number" ? value : null });
        return "written";
      }
      context.media.setTrackVolume(track, value);
      return "written";
    },
    remove() {
      return "system-owned";
    },
  },
  {
    name: "media.voice",
    readOnlyMembers: ["track", "slot", "cueId"],
    methods: {
      stop: "mediavoicestop",
      pause: "mediavoicepause",
      resume: "mediavoiceresume",
      seek: "mediavoiceseek",
      fade: "mediavoicefade",
      wait: "mediavoicewait",
    },
    emitterKey(record) {
      const ref = mediaVoiceRef(record);
      return ref === null ? null : mediaVoiceEmitterKey({ track: ref.track, slot: ref.slot, cueId: ref.cueId });
    },
    read(context, name): Value | undefined {
      const ref = mediaVoiceRef(context.record);
      const view = ref === null ? null : context.media?.voice(ref) ?? null;
      switch (name.toLowerCase()) {
        case "file":
          return view?.file ?? "";
        case "state":
          return view?.state ?? "stopped";
        case "position":
          return view === null ? 0 : view.positionTicks / 60;
        case "length":
          return view === null || view.lengthTicks === null ? 0 : view.lengthTicks / 60;
        case "volume":
          return view?.volume ?? 0;
        case "loop":
          return view?.loop === true ? 1 : 0;
        default:
          return undefined;
      }
    },
    write(context, name, value) {
      const ref = mediaVoiceRef(context.record);
      if (ref === null || context.media === undefined) return "not-host";
      const field = name.toLowerCase();
      if (field === "volume") {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
          context.media.diagnose("media.invalid-volume", "voice.volume", { track: ref.track, slot: ref.slot, percent: typeof value === "number" ? value : null });
          return "written";
        }
        context.media.setVoiceVolume(ref, value);
        return "written";
      }
      if (field === "loop") {
        if (value !== 0 && value !== 1) {
          context.media.diagnose("builtin.bad-arg", "voice.loop", { track: ref.track, slot: ref.slot });
          return "written";
        }
        context.media.setVoiceLoop(ref, value === 1);
        return "written";
      }
      return "read-only";
    },
    remove() {
      return "system-owned";
    },
  },
];
