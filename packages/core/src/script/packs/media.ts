/**
 * Standard media controls (AD-8/AD-10; docs/spec/engine/audio-media.md).
 *
 * Commands only validate arguments and report plain audio effects.  The audio
 * runtime is the sole owner of `GameState.audio`; this pack never mutates it.
 */

import { assetKey } from "../../formats/resolver/resolver.ts";
import { MEDIA_HOST_TYPES, type MediaPlayOptions } from "../../audio/script.ts";
import type { MediaVoiceRef } from "../../audio/model.ts";
import {
  MEDIA_TRACK_NAME,
  asciiFold,
  findTrack,
  voicePass,
  type AudioStateV2,
  type AudioTrackState,
  type AudioVoiceState,
} from "../../audio/model.ts";
import { secondsToTicks } from "../../time/time.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import { ScriptError } from "../errors.ts";
import type { CommandEffect, CommandView, PluginDefinition } from "../plugin.ts";

/** A read-only structural view reused by media query commands. */
export type AudioReadView = Readonly<AudioStateV2>;

/** Return the audio state without giving a command a writable section handle. */
export function readAudioView(view: CommandView): AudioReadView | undefined {
  return view.state?.audio;
}

function doc(summary: string, behaviour: string, waits?: BuiltinDoc["waits"]): BuiltinDoc {
  return {
    summary,
    behaviour,
    groups: ["audio-23"],
    ...(waits === undefined ? {} : { waits }),
    see: ["docs/spec/engine/audio-media.md#media-command-family"],
  };
}

function stringArg(args: readonly Arg[], index: number, name: string): string {
  const value = args[index]?.value;
  if (typeof value !== "string") throw new ScriptError("builtin.bad-arg", `${name}: argument ${index + 1} must be a string`);
  return value;
}

function numberArg(args: readonly Arg[], index: number, name: string): number {
  const value = args[index]?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ScriptError("builtin.bad-arg", `${name}: argument ${index + 1} must be a finite number`);
  return value;
}

function wholeArg(args: readonly Arg[], index: number, name: string): number {
  const value = numberArg(args, index, name);
  if (!Number.isInteger(value)) throw new ScriptError("builtin.bad-arg", `${name}: argument ${index + 1} must be a whole number`);
  return value;
}

function optionalVoice(args: readonly Arg[], index: number, name: string): number | undefined {
  if (args.length <= index) return undefined;
  const voice = wholeArg(args, index, name);
  if (voice < 0) throw new ScriptError("builtin.bad-arg", `${name}: voice must not be negative`);
  return voice;
}

function optionalTrack(args: readonly Arg[], index: number, fallback: string, name: string): string {
  return args.length > index ? stringArg(args, index, name) : fallback;
}

function mediaAsset(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const folded = asciiFold(normalized);
  return assetKey(folded.startsWith("media/") ? folded : `media/${folded}`);
}

function video(name: "playavi" | "playavismall", presentation: "full" | "small"): BuiltinSpec {
  const label = presentation === "full" ? "full screen" : "actual size, centred";
  return {
    name,
    aliases: [],
    params: [{ name: "file", optional: false, byRef: false, variadic: false }],
    doc: {
      summary: presentation === "full" ? "Play a movie full screen. Supported types are *.avi, *.mpg, and *.mov." : "Play a movie at actual size, centred.",
      behaviour: `Resolves the Media-folder video key, stops music while the video plays, posts one ${presentation} video request, and waits unskippably for its matching video.ended reply. Music restarts from tick 0 after the reply.`,
      groups: ["graphics-canvases-animation-video-31"],
      waits: { kind: "other", summary: "The calling thread waits for the matching video.ended reply; game time does not advance while the video is held." },
      see: ["docs/spec/engine/audio-media.md#video-wait-hold", "docs/spec/engine/audio-media.md#video-music"],
    },
    call: (view, args) => {
      if (view.state?.engine.video !== undefined) throw new ScriptError("media.video-busy", `${name}: another video is already playing`);
      const key = mediaAsset(stringArg(args, 0, name));
      return {
        value: null,
        effects: [effect("media.stop", ["music", null])],
        request: { kind: "playVideo", key, presentation },
      };
    },
  };
}

function effect(name: string, args: readonly (string | number | boolean | null)[]): CommandEffect {
  return { kind: "mixed", section: "audio", args };
}


/** The handle of an object value, or `null` for any other value. */
function objectHandle(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "object") return null;
  if (!("handle" in value)) return null;
  return typeof value.handle === "number" ? value.handle : null;
}

/** Read one `mediaPlay` option as a whole number, or throw the located argument error. */
function wholeOption(value: unknown, name: string, op: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ScriptError("builtin.bad-arg", `${op}: option "${name}" must be a whole number`);
  return value;
}

/** Read one `mediaPlay` option as `1`/`0`, or throw the located argument error. */
function flagOption(value: unknown, name: string, op: string): boolean {
  const flag = wholeOption(value, name, op);
  if (flag !== 0 && flag !== 1) throw new ScriptError("builtin.bad-arg", `${op}: option "${name}" must be 1 or 0`);
  return flag === 1;
}

/**
 * The ruled `options` dictionary of `mediaPlay(file[, options])` (MEDIA-1):
 * `track`, `loop`, `volume`, `priority`, `sync` and `wait`, each validated
 * before any playback change. A value the contract does not allow is a located
 * call error, so no partial start happens.
 */
function readPlayOptions(view: CommandView, value: unknown): MediaPlayOptions {
  const op = "mediaPlay";
  let track = "music";
  let loop = true;
  let volume = 100;
  let priority = 0;
  let sync: string | null = null;
  let wait = false;
  if (value !== null && value !== undefined) {
    const handle = objectHandle(value);
    if (handle === null) throw new ScriptError("builtin.bad-arg", `${op}: options must be a dictionary`);
    const members = view.objectMembers?.(handle);
    if (members === undefined) throw new ScriptError("builtin.bad-arg", `${op}: options must be a live dictionary`);
    for (const key of Object.keys(members)) {
      if (key !== "track" && key !== "loop" && key !== "volume" && key !== "priority" && key !== "sync" && key !== "wait") {
        throw new ScriptError("builtin.bad-arg", `${op}: unknown option "${key}"`);
      }
    }
    if (Object.hasOwn(members, "track")) {
      const name = members["track"];
      if (typeof name !== "string") throw new ScriptError("builtin.bad-arg", `${op}: option "track" must be a string`);
      track = asciiFold(name);
      if (!MEDIA_TRACK_NAME.test(track)) throw new ScriptError("media.invalid-track-name", `${op}: invalid track name "${name}"`);
    }
    if (Object.hasOwn(members, "loop")) loop = flagOption(members["loop"], "loop", op);
    else loop = track === "music";
    if (Object.hasOwn(members, "volume")) {
      volume = wholeOption(members["volume"], "volume", op);
      if (volume < 0 || volume > 100) throw new ScriptError("media.invalid-volume", `${op}: volume must be between 0 and 100`);
    }
    if (Object.hasOwn(members, "priority")) priority = wholeOption(members["priority"], "priority", op);
    if (Object.hasOwn(members, "sync")) {
      const source = members["sync"];
      if (typeof source !== "string") throw new ScriptError("builtin.bad-arg", `${op}: option "sync" must be a string`);
      sync = source === "" ? null : asciiFold(source);
    }
    if (Object.hasOwn(members, "wait")) wait = flagOption(members["wait"], "wait", op);
  }
  const audio = readAudioView(view);
  if (audio === undefined || findTrack(audio, track) === undefined) throw new ScriptError("media.unknown-track", `${op}: unknown track "${track}"`);
  if (loop && wait) throw new ScriptError("media.wait-loop", `${op}: a looping voice cannot be waited on`);
  return { track, loop, volume, priority, sync, wait };
}

/** The pack's one start route: a VM control action owns the object and the posted effect. */
function playEffect(file: string, options: MediaPlayOptions, returnVoice = true): CommandEffect {
  return { kind: "vm.control", args: ["mediaplay", mediaAsset(file), { ...options }, returnVoice] };
}

function mediaPlay(): BuiltinSpec {
  return {
    name: "mediaplay",
    aliases: [],
    params: [
      { name: "file", optional: false, byRef: false, variadic: false },
      { name: "options", optional: true, byRef: false, variadic: false },
    ],
    doc: {
      ...doc("Play a media file on a named track.", "Resolves the Media-folder file, validates the named options, and starts one voice through the audio applier; the value is that voice object (MEDIA-1), or null when the request starts nothing. With `wait` the calling thread parks on the voice's audio.track wait."),
      returns: { summary: "The started voice object, or null when no voice started." },
      waits: { kind: "other", summary: "With the wait option, the calling thread waits on the audio.track wait for that finite voice." },
      see: ["docs/spec/engine/audio-media.md#media-1"],
    },
    call: (view, args) => {
      const file = stringArg(args, 0, "mediaPlay");
      const options = readPlayOptions(view, args[1]?.value);
      return { value: null, effects: [playEffect(file, options)] };
    },
  };
}

/** A hydrated voice method: read the receiver's `{track, slot, cueId}`, diagnose a stale one, or act. */
function voiceRef(view: CommandView, args: readonly Arg[], op: string): MediaVoiceRef | null {
  const handle = objectHandle(args[0]?.value);
  if (handle === null) throw new ScriptError("builtin.bad-arg", `${op}: the receiver is not a voice object`);
  const members = view.objectMembers?.(handle);
  if (members === undefined) throw new ScriptError("builtin.bad-arg", `${op}: the receiver is not a live voice object`);
  const track = members["track"];
  const slot = members["slot"];
  const cueId = members["cueId"];
  if (typeof track !== "string" || !Number.isInteger(slot) || !Number.isInteger(cueId)) {
    view.media?.diagnose("media.unknown-voice", op, { track: typeof track === "string" ? track : "", voice: Number.isInteger(slot) ? (slot as number) : -1 });
    return null;
  }
  return { track, slot: slot as number, cueId: cueId as number };
}

/** The hydrated voice methods (MEDIA-1): each acts on the voice identity the object names. */
function voiceMethod(name: string): BuiltinSpec {
  const number = name === "mediavoicefade" ? 2 : name === "mediavoiceseek" ? 1 : 0;
  const params = [{ name: "voice", optional: false, byRef: false, variadic: false }];
  if (name === "mediavoiceseek") params.push({ name: "seconds", optional: false, byRef: false, variadic: false });
  if (name === "mediavoicefade") {
    params.push({ name: "percent", optional: false, byRef: false, variadic: false });
    params.push({ name: "seconds", optional: false, byRef: false, variadic: false });
  }
  return {
    name,
    aliases: [],
    params,
    doc: {
      ...doc(
        name === "mediavoicestop" ? "Stop a voice object." : name === "mediavoicepause" ? "Pause a voice object." : name === "mediavoiceresume" ? "Resume a voice object." : name === "mediavoiceseek" ? "Move a voice object to a time position." : name === "mediavoicefade" ? "Fade a voice object to a volume." : "Wait for a voice object to finish.",
        "Hydrated voice method: reads the object's track, slot and cue id and applies the same deterministic audio operation as the procedural command; a stale voice diagnoses and changes nothing.",
      ),
      access: "internal",
      see: ["docs/spec/engine/audio-media.md#media-1"],
    },
    call: (view, args) => {
      const ref = voiceRef(view, args, name);
      if (ref === null) return { value: 0 };
      const media = view.media;
      if (media === undefined) throw new ScriptError("unknown.command", `${name}: the media owner is not installed`);
      if (name === "mediavoicestop") media.stop(ref);
      else if (name === "mediavoicepause") media.pause(ref);
      else if (name === "mediavoiceresume") media.resume(ref);
      else if (name === "mediavoiceseek") {
        const ticks = secondsToTicks(numberArg(args, 1, name));
        if (ticks === null) throw new ScriptError("media.invalid-time", `${name}: seconds must be finite and non-negative`);
        media.seek(ref, ticks);
      } else if (name === "mediavoicefade") {
        const percent = wholeArg(args, 1, name);
        if (percent < 0 || percent > 100) throw new ScriptError("media.invalid-volume", `${name}: percent must be between 0 and 100`);
        const ticks = secondsToTicks(numberArg(args, 2, name));
        if (ticks === null) throw new ScriptError("media.invalid-time", `${name}: seconds must be finite and non-negative`);
        media.fade(ref, percent, ticks);
      } else {
        const wait = media.voiceWait(ref);
        return wait === null ? { value: 0 } : { value: 0, wait };
      }
      return { value: 0 };
    },
  };
}

function mediaTrackGet(): BuiltinSpec {
  return {
    name: "mediatrackget",
    aliases: [],
    params: [
      { name: "media", optional: false, byRef: false, variadic: false },
      { name: "name", optional: false, byRef: false, variadic: false },
    ],
    doc: {
      ...doc("Reach a configured audio track object.", "Hydrated `media.track(name)` method: folds the name, requires a configured track, and returns that track's one host object; an unknown name diagnoses and returns null."),
      access: "internal",
      see: ["docs/spec/engine/audio-media.md#media-1"],
    },
    call: (view, args) => {
      const name = asciiFold(stringArg(args, 1, "media.track"));
      const audio = readAudioView(view);
      if (audio === undefined || findTrack(audio, name) === undefined) {
        view.media?.diagnose("media.unknown-track", "media.track", { track: name });
        return { value: null };
      }
      return { value: null, effects: [{ kind: "vm.control", args: ["mediaTrackObject", name] }] };
    },
  };
}

function mediaTrackFade(): BuiltinSpec {
  return {
    name: "mediatrackfade",
    aliases: [],
    params: [
      { name: "track", optional: false, byRef: false, variadic: false },
      { name: "percent", optional: false, byRef: false, variadic: false },
      { name: "seconds", optional: false, byRef: false, variadic: false },
    ],
    doc: {
      ...doc("Fade a track object to a volume percentage.", "Hydrated `track.fade(percent, seconds)` method: validates the percentage and duration and posts the track-wide fade effect; the track keeps playing when the fade reaches zero."),
      access: "internal",
      see: ["docs/spec/engine/audio-media.md#media-1"],
    },
    call: (view, args) => {
      const handle = objectHandle(args[0]?.value);
      const members = handle === null ? undefined : view.objectMembers?.(handle);
      const name = members?.["name"];
      if (typeof name !== "string") throw new ScriptError("builtin.bad-arg", "track.fade: the receiver is not a track object");
      const percent = wholeArg(args, 1, "track.fade");
      if (percent < 0 || percent > 100) throw new ScriptError("media.invalid-volume", "track.fade: percent must be between 0 and 100");
      const ticks = secondsToTicks(numberArg(args, 2, "track.fade"));
      if (ticks === null) throw new ScriptError("media.invalid-time", "track.fade: seconds must be finite and non-negative");
      if (view.media === undefined) throw new ScriptError("unknown.command", "track.fade: the media owner is not installed");
      view.media.trackFade(name, percent, ticks);
      return { value: 0 };
    },
  };
}

function mediaStop(): BuiltinSpec {
  return {
    name: "mediastop",
    aliases: [],
    params: [
      { name: "track", optional: true, byRef: false, variadic: false },
      { name: "voice", optional: true, byRef: false, variadic: false },
    ],
    doc: doc("Stop a track or voice.", "Posts the deterministic media.stop audio effect for the selected track and voice; the command is immediate and never waits."),
    call: (_view, args) => {
      const track = asciiFold(optionalTrack(args, 0, "music", "mediastop"));
      const voice = optionalVoice(args, 1, "mediastop");
      return { value: null, effects: [effect("media.stop", [track, voice ?? null])] };
    },
  };
}

function legacyDoc(summary: string, behaviour: string, waits?: BuiltinDoc["waits"]): BuiltinDoc {
  return {
    ...doc(summary, behaviour, waits),
    tags: ["deprecated"],
    replacedBy: { kind: "command", name: "mediaplay" },
    reason: "Retained so existing Toolkit 3.1 games continue to run; use the standard media command in new code.",
  };
}
const MEDIA_PLAY = mediaPlay();
const MEDIA_STOP = mediaStop();


/** A Toolkit 3.1 alias keeps its void result and playback mapping. */
function legacyPlay(name: string, track: string, loop: boolean, summary: string, wait: boolean, waits?: BuiltinDoc["waits"]): BuiltinSpec {
  const behaviour = wait
    ? `Plays once on the ${track} track and parks the calling thread until the sound ends; it returns no value.`
    : `Maps to the ${track} track with the Toolkit 3.1 loop flag and never returns a value; it preserves the original command's behavior.`;
  return {
    name,
    aliases: [],
    params: [{ name: "file", optional: false, byRef: false, variadic: false }],
    doc: { ...legacyDoc(summary, behaviour, waits), replacedBy: { kind: "command", name: "mediaplay" } },
    call: (_view, args) => {
      const file = stringArg(args, 0, name);
      if (wait) {
        return {
          value: null,
          effects: [playEffect(file, { track, loop, volume: 100, priority: 0, sync: null, wait: true }, false)],
        };
      }
      return { value: null, effects: [effect("media.play", [mediaAsset(file), track, loop, false, 0, null, null])] };
    },
  };
}

function legacyStop(name: string, track: string, summary: string): BuiltinSpec {
  return {
    name,
    aliases: [],
    params: [],
    doc: {
      ...legacyDoc(summary, `Maps to mediastop for the ${track} track and never waits.`),
      replacedBy: { kind: "command", name: "mediastop" },
    },
    call: (view, _args, next) => MEDIA_STOP.call(view, [{ value: track, ref: null }], next),
  };
}

function setVolume(): BuiltinSpec {
  return {
    name: "setvolume",
    aliases: [],
    params: [{ name: "percent", optional: false, byRef: false, variadic: false }],
    doc: doc("Set the volume of all music and sound using a value between 0 and 100.", "Validates the master volume percentage and posts one master-volume effect; it is immediate and never waits."),
    call: (_view, args) => {
      const percent = wholeArg(args, 0, "setVolume");
      if (percent < 0 || percent > 100) throw new ScriptError("media.invalid-volume", "setVolume: percent must be between 0 and 100");
      return { value: null, effects: [effect("media.volume", [null, percent, null])] };
    },
  };
}

export const MEDIA_COMMANDS: readonly BuiltinSpec[] = [
  video("playavi", "full"),
  video("playavismall", "small"),
  MEDIA_PLAY,
  MEDIA_STOP,
  legacyPlay("midiplay", "music", true, "Play a media file on a named track.", false, { kind: "never", summary: "Never waits." }),
  legacyPlay("playmidi", "music", true, "Play a media file on a named track.", false, { kind: "never", summary: "Never waits." }),
  legacyPlay("wav", "sfx", false, "Play a wave file (e.g. a sound effect).", false, { kind: "never", summary: "Never waits." }),
  legacyPlay("mp3", "sfx", false, "Play a wave file (e.g. a sound effect).", false, { kind: "never", summary: "Never waits." }),
  legacyStop("mediarest", "music", "Stop a track or voice."),
  legacyStop("midirest", "music", "Stop a track or voice."),
  legacyStop("wavstop", "sfx", "Stop the current sound effect."),
  legacyPlay("mp3pause", "sfx", false, "Play a sound effect and pause the engine until it finishes.", true, { kind: "other", summary: "The calling thread waits on audio.track until the sound effect ends." }),
  setVolume(),
  mediaTrackGet(),
  mediaTrackFade(),
  voiceMethod("mediavoicestop"),
  voiceMethod("mediavoicepause"),
  voiceMethod("mediavoiceresume"),
  voiceMethod("mediavoiceseek"),
  voiceMethod("mediavoicefade"),
  voiceMethod("mediavoicewait"),
];

export const MEDIA_PLUGIN: PluginDefinition = {
  id: "media",
  version: "1.0.0",
  hostTypes: MEDIA_HOST_TYPES,
  doc: {
    summary: "Deterministic media tracks, voices and SoundFont controls.",
    groups: [{ id: "audio-23", name: "Audio", summary: "Track-based audio control at the fixed simulation tick." }],
  },
  commands: MEDIA_COMMANDS,
};
