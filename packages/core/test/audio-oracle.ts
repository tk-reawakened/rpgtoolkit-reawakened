// Drives the committed audio oracle scenes (ticket 6.4, `fixtures/audio/*.json`) through the real core audio
// runtime (ticket 6.6). The scenes are recorded scripts of effects and media commands with the expected per-tick
// track states, cues and facts, derived by `tools/fixtures/audio`, which imports nothing from `packages/core`.
//
// The media built-ins belong to entries 6.8 and 6.9. Until they land this driver plays their part for the scenes
// it runs: it resolves a Media-folder name to its key, checks the file exists, converts milliseconds to ticks and
// names the legacy aliases, then calls the runtime's transport methods. Everything the scenes assert about tracks,
// voices, cues, end ticks and the facts the runtime reports comes from the runtime itself.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EffectBus } from "../src/engine/effects.ts";
import { engineEffect } from "../src/engine/boot.ts";
import {
  MEDIA_LOOP,
  MEDIA_RESTART,
  MEDIA_WAIT,
  audioSaveProjection,
  createAudioRuntime,
  findTrack,
  type AudioHost,
  type AudioLookup,
  type AudioNote,
  type AudioRuntime,
  type AudioSaveProjection,
  type AudioWait,
} from "../src/audio/index.ts";
import { createGameState, restoreGameState, snapshot, type GameState } from "../src/save/index.ts";
import type { AssetKey } from "../src/ports/keys.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const SCENE_DIR = join(here, "fixtures", "audio");

export type SceneAsset = { readonly format: string; readonly lengthTicks: number | null };
export type SceneOp = { readonly t: number; readonly op: string; readonly at?: string; readonly [key: string]: unknown };
export type SceneCase = {
  readonly name: string;
  readonly setup: { readonly defaultSoundFont: string | null; readonly registerAt?: number; readonly assets: Readonly<Record<string, SceneAsset>> };
  readonly script: readonly SceneOp[];
  readonly ticks: number;
  readonly expect: readonly Row[];
  readonly end: { readonly cueId: number; readonly soundFont: string | null; readonly master: number };
};
export type Scene = { readonly scene: string; readonly cases: readonly SceneCase[] };
export type Row = { readonly t: number; readonly [key: string]: unknown };

export function loadScene(name: string): Scene {
  return JSON.parse(readFileSync(join(SCENE_DIR, `${name}.json`), "utf8")) as Scene;
}

const lower = (text: string): string => text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
const resolve = (name: string): AssetKey => `media/${lower(name)}` as AssetKey;
/** The scenes give seconds as whole milliseconds; ticks are `floor(ms * 60 / 1000 + 1/2)`, exactly. */
const ticksFromMs = (ms: number): number => Math.floor((ms * 60 + 500) / 1000);

type Parked = { readonly thread: number; readonly wait: AudioWait };

export type SceneRun = {
  readonly rows: Row[];
  readonly state: GameState;
  readonly runtime: AudioRuntime;
};

/** A fixed tick at which a hook can look at, or change, the running scene. */
export type TickHook = (tick: number, run: { readonly state: GameState; readonly runtime: AudioRuntime; readonly saves: Record<string, AudioSaveProjection> }) => void;

export type RunOptions = {
  /** Called at the start of every tick, before the scene's own `pre` operations. */
  readonly beforeTick?: TickHook;
  /** Called after every tick's row is sampled, with that row. */
  readonly afterTick?: (tick: number, row: Row, run: { readonly state: GameState; readonly runtime: AudioRuntime }) => void;
  /**
   * Start a new runtime over the state at the start of tick `at`, as an engine does at start: `memory` keeps the live
   * state, `snapshot` takes it through `snapshot` and `restoreGameState` first. The registration emits `soundfont.set`.
   */
  readonly restart?: { readonly at: number; readonly via: "memory" | "snapshot" };
};

/**
 * Run one case through the real runtime, one tick at a time, in the scene's phase order (AD-26): the
 * between-tick operations (`register`, `load`, `reset`), the waits phase, the thread and animation operations in
 * listed order, the audio phase, then the row is sampled and `save` operations run.
 */
export function runCase(sceneCase: SceneCase, options: RunOptions = {}): SceneRun {
  let state = createGameState({ seed: 0 });
  let bus = new EffectBus(state);
  const registerAt = sceneCase.setup.registerAt ?? 0;
  const defaultSoundFont = sceneCase.setup.defaultSoundFont as AssetKey | null;
  let facts: Record<string, unknown>[] = [];
  const notify = (note: AudioNote): void => {
    if (note.kind === "diag") facts.push({ e: "diag", code: note.code, op: note.op, ...note.detail });
    else if (note.kind === "same-file") facts.push({ e: "same-file", track: note.track, file: note.file, action: note.action });
    else if (note.kind === "silence") facts.push({ e: "silence", track: note.track, source: note.source });
    else if (note.kind === "finished") facts.push({ e: "finished", track: note.track, voice: note.voice, cueId: note.cueId, endTick: note.endTick });
    else if (note.kind === "steal") facts.push({ e: "steal", track: note.track, voice: note.voice, cueId: note.cueId });
    else facts.push({ e: "no-op", op: note.op, track: note.track });
  };
  const lookup = (asset: AssetKey): AudioLookup => {
    const found = sceneCase.setup.assets[asset];
    if (found === undefined) throw new Error(`the scene never declared ${asset}`);
    return found.format === "unsupported" ? { kind: "unsupported" } : { kind: "known", lengthTicks: found.lengthTicks };
  };
  const makeRuntime = (host: AudioHost): AudioRuntime => createAudioRuntime(host, { lookup, defaultSoundFont, notify });
  let runtime = makeRuntime(state);
  const saves: Record<string, AudioSaveProjection> = {};
  let parked: Parked[] = [];
  let configDirty = true;
  const rows: Row[] = [];

  const postEffect = (op: SceneOp): void => {
    const kind = String(op.kind);
    const args = kind === "soundfont.set" ? [(op.asset as string | null) ?? null] : [(op.asset as string | null) ?? null, (op.loop as boolean | undefined) ?? kind === "music.play", (op.restart as boolean | undefined) ?? null, String(op.source)];
    bus.postEffect("audio", engineEffect("audio", kind, args, "draw-audio-cue"));
  };

  const play = (op: SceneOp, trackName: string, flags: number, file: string): void => {
    const key = resolve(file);
    const track = findTrack(state.audio, trackName);
    if (track === undefined) {
      runtime.play({ track: trackName, asset: key, loop: false });
      return;
    }
    if (sceneCase.setup.assets[key] === undefined) {
      facts.push({ e: "diag", code: "media.asset-missing", op: "mediaPlay", file: key });
      return;
    }
    const result = runtime.play({ track: trackName, asset: key, loop: (flags & MEDIA_LOOP) !== 0, restart: (flags & MEDIA_RESTART) !== 0, wait: (flags & MEDIA_WAIT) !== 0, priority: (op.priority as number | undefined) ?? 0, voice: op.voice as number | undefined, syncTrack: op.sync as string | undefined });
    if (result.kind === "started" && result.wait !== null) park(op.thread as number, result.wait);
  };

  const park = (thread: number, wait: AudioWait): void => {
    parked.push({ thread, wait });
    facts.push({ e: "wait", thread, track: wait.track, voice: wait.voice, cueId: wait.cueId, endTick: wait.endTick, pass: wait.pass });
  };

  const legacy = (op: SceneOp): void => {
    const name = lower(String(op.name));
    if (name === "wav" || name === "mp3") {
      facts.push({ e: "legacy", name: op.name, as: 'mediaPlay(file, { track: "sfx", loop: false })' });
      play(op, "sfx", 0, String(op.file));
    } else if (name === "wavstop") {
      facts.push({ e: "legacy", name: op.name, as: 'mediaStop("sfx")' });
      runtime.stop("sfx");
    } else throw new Error(`the driver does not model the legacy name ${String(op.name)}`);
  };

  const command = (op: SceneOp): void => {
    switch (op.op) {
      case "legacy":
        return legacy(op);
      case "mediaTrack": {
        if (runtime.configureTrack(String(op.name), (op.voices as number | undefined) ?? 1)) {
          configDirty = true;
          facts.push({ e: "track", name: lower(String(op.name)), voices: (op.voices as number | undefined) ?? 1 });
        }
        return;
      }
      case "mediaPlay": {
        const trackName = (op.track as string | undefined) ?? "music";
        const track = findTrack(state.audio, trackName);
        const flags = (op.flags as number | undefined) ?? (track?.name === "music" ? MEDIA_LOOP : 0);
        return play(op, trackName, flags, String(op.file));
      }
      case "mediaStop":
        runtime.stop((op.track as string | undefined) ?? "music", op.voice as number | undefined);
        return;
      case "mediaPause":
        runtime.pause((op.track as string | undefined) ?? "music", op.voice as number | undefined);
        return;
      case "mediaResume":
        runtime.resume((op.track as string | undefined) ?? "music", op.voice as number | undefined);
        return;
      case "mediaSeek": {
        const ms = op.ms as number;
        if (!Number.isInteger(ms) || ms < 0) {
          facts.push({ e: "diag", code: "media.invalid-time", op: "mediaSeek", ms });
          return;
        }
        runtime.seek(String(op.track), ticksFromMs(ms), op.voice as number | undefined);
        return;
      }
      case "mediaLoop":
        runtime.setLoop(String(op.track), op.on === true, op.voice as number | undefined);
        return;
      case "mediaFade": {
        const ms = op.ms as number;
        if (!Number.isInteger(ms) || ms < 0) {
          facts.push({ e: "diag", code: "media.invalid-time", op: "mediaFade", ms });
          return;
        }
        runtime.fade(String(op.track), op.percent as number, ticksFromMs(ms), op.voice as number | undefined);
        return;
      }
      case "mediaVolume":
        if (op.voice === undefined) runtime.setTrackVolume(String(op.track), op.percent as number);
        else runtime.setVoiceVolume(String(op.track), op.voice as number, op.percent as number);
        return;
      case "setvolume":
        runtime.setMasterVolume(op.percent as number);
        return;
      case "voiceWait": {
        const wait = runtime.waitFor((op.track as string | undefined) ?? "sfx", op.voice as number | undefined);
        if (wait !== null) park(op.thread as number, wait);
        return;
      }
      case "soundFont": {
        const key = resolve(String(op.file));
        if (!/\.sf[23]$/.test(key)) {
          facts.push({ e: "diag", code: "media.soundfont-name", op: "soundFont", file: key });
          return;
        }
        if (sceneCase.setup.assets[key] === undefined) {
          facts.push({ e: "diag", code: "media.soundfont-missing", op: "soundFont", file: key });
          return;
        }
        postEffect({ t: op.t, op: "effect", kind: "soundfont.set", asset: key });
        return;
      }
      case "soundFontReset":
        postEffect({ t: op.t, op: "effect", kind: "soundfont.set", asset: null });
        return;
      default:
        throw new Error(`the driver does not model the operation ${String(op.op)}`);
    }
  };

  const sample = (tick: number, cues: readonly unknown[]): Row => {
    const row: Record<string, unknown> = { t: tick };
    if (configDirty) {
      row.cfg = state.audio.tracks.map((track) => [track.name, track.voiceCount]);
      configDirty = false;
    }
    row.tr = state.audio.tracks
      .filter((track) => track.file !== null || track.voices.length > 0)
      .map((track) => [
        track.name,
        track.state,
        track.flags,
        track.file,
        track.positionTicks,
        track.lengthTicks,
        track.voices.map((voice) => [voice.index, voice.state, voice.cueId, voice.priority, voice.volume, voice.startTick, voice.positionTicks, voice.endTick, voice.loop ? 1 : 0, voice.fade === null ? null : [voice.fade.fromVolume, voice.fade.targetVolume, voice.fade.startTick, voice.fade.durationTicks]]),
      ]);
    const bus = state.audio.tracks.flatMap((track) => {
      const entry = state.audio.settings.trackVolumes.find((item) => item.name === track.name);
      return entry === undefined ? [] : [[track.name, entry.volume, entry.fade === null ? null : [entry.fade.fromVolume, entry.fade.targetVolume, entry.fade.startTick, entry.fade.durationTicks]]];
    });
    if (bus.length > 0) row.bus = bus;
    if (state.audio.settings.masterVolume !== 100) row.master = state.audio.settings.masterVolume;
    if (state.audio.soundFont !== null) row.sf = state.audio.soundFont;
    if (cues.length > 0) row.cues = cues;
    if (facts.length > 0) row.ev = facts;
    return row as Row;
  };

  for (let tick = 0; tick < sceneCase.ticks; tick += 1) {
    state.time.tick = tick;
    facts = [];
    options.beforeTick?.(tick, { state, runtime, saves });
    if (options.restart !== undefined && tick === options.restart.at) {
      if (options.restart.via === "snapshot") state = restoreGameState(snapshot(state));
      bus = new EffectBus(state);
      runtime = makeRuntime(state);
      runtime.register(bus);
    } else if (tick === registerAt) runtime.register(bus);
    for (const op of sceneCase.script) {
      if (op.t !== tick || op.at !== "pre") continue;
      if (op.op === "load") {
        const saved = saves[String(op.save)];
        if (saved === undefined) throw new Error(`no save named ${String(op.save)}`);
        runtime.load(saved);
        configDirty = true;
        facts.push({ e: "load" });
      } else if (op.op === "reset") {
        facts.push({ e: "reset" });
      } else throw new Error(`the driver does not model the pre operation ${String(op.op)}`);
    }
    const stillParked: Parked[] = [];
    for (const item of [...parked].sort((a, b) => a.thread - b.thread)) {
      const result = runtime.pollWait(item.wait);
      if (result.wake) facts.push({ e: "wake", thread: item.thread, kind: "audio.track", track: item.wait.track, voice: item.wait.voice, cueId: item.wait.cueId, why: result.why });
      else stillParked.push(item);
    }
    parked = stillParked;
    for (const op of sceneCase.script) {
      if (op.t !== tick || op.at === "pre" || op.at === "post") continue;
      if (op.op === "effect") postEffect(op);
      else command(op);
    }
    runtime.phase();
    const cues = runtime.drain();
    const row = sample(tick, cues);
    rows.push(row);
    options.afterTick?.(tick, row, { state, runtime });
    for (const op of sceneCase.script) {
      if (op.t !== tick || op.at !== "post") continue;
      if (op.op !== "save") throw new Error(`the driver does not model the post operation ${String(op.op)}`);
      saves[String(op.name)] = audioSaveProjection(state.audio, tick);
    }
  }
  return { rows, state, runtime };
}
