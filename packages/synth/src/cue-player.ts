/**
 * The cue player (docs/spec/engine/audio-media.md#cue-player): the one place that turns "what the game says should be
 * playing" into runner audio-protocol messages, so every runner starts the same sounds from the same cues.
 *
 * Two halves, on purpose:
 *
 * - `cueStart` is the start arithmetic as a pure function of one cue and the tick a voice became **ready**. It is the
 *   table's `media.play`, `media.seek` and `media.fade` rows, and it matches `tools/fixtures/audio/sim.mjs`'s
 *   `cuePlayer` on every committed audio vector — including the worked example (a 600-tick song played at tick 100
 *   starts at 90 when ready at 190 and at 60 when ready at 760).
 * - `CuePlayer` is the state machine over it: the `(track, voice)` → voice map, the prepared-voice map from
 *   `media.load`, the pre-ready message queue, the autoplay lock's mirror, and the focus hold.
 *
 * Three runner rules live here because the table is where they act, and each has a named test:
 *
 * - **Lateness is measured from ready, not from receipt** ([#audio-late-sounds]). A finite, non-looping voice on a
 *   track other than `music` is dropped at 15 ticks or more — dropped means `stop` and no `ended`, never a late sound.
 * - **The autoplay lock is a delayed late start** ([#audio-autoplay]). While locked the player mirrors every voice and
 *   sends no `load` or `play`; at unlock each voice the mirror shows as playing or paused is realised at its caught-up
 *   position, and only the missed finite sound effects are dropped.
 * - **The focus hold pauses without losing position** ([#audio-focus]). With `"pause"`, `focusLost` sends `pause` to
 *   every voice realised as playing and `focusGained` sends `resume` to exactly those voices.
 *
 * The player never blocks the simulation, never writes state, and never sends the runner's position back.
 */

import type { AudioCue } from "@tk-reawakened/core";
import type { AssetKey } from "@tk-reawakened/core";
import type { AudioMessage, BankRef, VolumeScope } from "./protocol.ts";
import { effectiveBank, type BankLayers } from "./bank.ts";

/** The late-sound threshold: 250 ms at 60 Hz (6.2 P7, [#audio-late-sounds]). */
export const LATE_TICKS = 15;

/** What the player knows about a voice when it is asked to start it. */
export type CueStartInfo = {
  /** The asset's length in ticks, or `null` when the format does not determine one. */
  readonly lengthTicks: number | null;
  /** Whether the voice loops: the cue's own `loop`, which the player already holds. */
  readonly loop: boolean;
  /** Whether the voice is currently playing; only `media.seek` reads it. */
  readonly playing: boolean;
};

/** The start arithmetic's outcome, one shape per action the table can decide. */
export type CueStart =
  | { readonly action: "play"; readonly positionTicks: number; readonly lateness: number }
  | { readonly action: "stop"; readonly reason: "late" | "finished"; readonly lateness: number }
  | { readonly action: "seek"; readonly positionTicks: number; readonly lateness: number }
  | { readonly action: "setVolume"; readonly volume: number; readonly lateness: number }
  | { readonly action: "fade"; readonly from: number; readonly target: number; readonly durationTicks: number; readonly lateness: number };

/**
 * The P7 integer fade: nearest integer, halves rounded **up**, elapsed clamped to `0..duration`. `duration <= 0`
 * returns the target. Identical to `sim.mjs`'s `fadeValue`, which the audio vectors are generated from.
 */
export function cueFadeValue(from: number, to: number, duration: number, elapsed: number): number {
  if (duration <= 0) return to;
  const d = Math.min(Math.max(elapsed, 0), duration);
  const numerator = from * duration + (to - from) * d;
  return Math.floor((2 * numerator + duration) / (2 * duration));
}

/** True when this cue's voice must be dropped rather than started late ([#audio-late-sounds]). */
function dropWhenLate(cue: AudioCue, info: CueStartInfo): boolean {
  return info.lengthTicks !== null && !info.loop && cue.track !== "music";
}

/**
 * The start arithmetic for one cue that is about to be realised at `readyTick` (R). Pure: the caller owns every fact
 * the table reads, so the function is the same for a browser, a desktop shell and the oracle.
 */
export function cueStart(cue: AudioCue, readyTick: number, info: CueStartInfo): CueStart {
  const lateness = Math.max(0, readyTick - cue.tick);
  if (cue.kind === "media.play") {
    const position = cue.positionTicks ?? 0;
    let positionTicks = position + lateness;
    if (dropWhenLate(cue, info) && lateness >= LATE_TICKS) return { action: "stop", reason: "late", lateness };
    if (info.loop && info.lengthTicks !== null) {
      positionTicks %= info.lengthTicks;
    }
    if (info.lengthTicks !== null && !info.loop && positionTicks >= info.lengthTicks) {
      return { action: "stop", reason: "finished", lateness };
    }
    return { action: "play", positionTicks, lateness };
  }
  if (cue.kind === "media.seek") {
    let positionTicks = (cue.positionTicks ?? 0) + (info.playing ? lateness : 0);
    if (info.loop && info.lengthTicks !== null) positionTicks %= info.lengthTicks;
    return { action: "seek", positionTicks, lateness };
  }
  if (cue.kind === "media.fade") {
    const durationTicks = cue.durationTicks ?? 0;
    const from = cue.volume ?? 0;
    const target = cue.targetVolume ?? from;
    if (lateness >= durationTicks) return { action: "setVolume", volume: target, lateness };
    return {
      action: "fade",
      from: cueFadeValue(from, target, durationTicks, lateness),
      target,
      durationTicks: durationTicks - lateness,
      lateness,
    };
  }
  throw new Error(`cueStart does not model ${cue.kind}`);
}

/** One realised voice: the runner voice id, what it is playing, and where it is. */
export type PlayerVoice = {
  /** The runner voice id: the cueId of the `load` or `play` that created the voice (the protocol's `voice`). */
  readonly id: number;
  /** The core's voice slot on the track, the table's `(track, voice index)` key. */
  readonly slot: number;
  readonly track: string;
  readonly asset: AssetKey;
  cue: number;
  loop: boolean;
  volume: number;
  state: "loading" | "ready" | "playing" | "paused" | "failed" | "stopped" | "ended";
  /** The position the last position-setting cue asked for, and that cue's tick (the late-start workbook). */
  positionTicks: number;
  positionTick: number;
  lengthTicks: number | null;
  /** Where the voice is now: `positionTicks` plus how long it has played since. */
  position: number;
  /** A `load` that has not been sent yet, because the voice was created by a `play` that still owes it. */
  pendingLoad: AudioMessage | null;
  /**
   * The cue whose realisation waits for `ready`. Lateness is measured **then**, not when the cue arrived, so the start
   * is computed in `ready()`, never here ([#audio-late-sounds]).
   */
  pendingPlay: AudioCue | null;
  /** Whether any message for this voice has reached the sources. The lock's mirror shows `playing` while `false`. */
  realised: boolean;
  /** Whether the source answered `ready`; until then every message but the `load` waits, in order. */
  loaded: boolean;
};

export type CuePlayerOptions = {
  /** Emit one protocol message to the runner's sources. */
  readonly send: (message: AudioMessage) => void;
  /** Fetch one asset's bytes for a `load`; `null` when the host cannot supply it (the voice fails). */
  readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  /** `RunConfig.audio.focus`; `"pause"` is the default ([#audio-focus]). */
  readonly focus?: "pause" | "continue";
  /** Report `audio.ended` back to the core as an AD-14 input, once per finished one-shot. */
  readonly onEnded?: (cueId: number) => void;
  /**
   * The player, runner and bundled bank layers ([#soundfont-layers]); the author layer arrives in the `soundfont.set`
   * cue. A layer is `null` when it has no opinion, and the four ranks are the whole list (MEDIA-5 retired the fifth).
   */
  readonly bankLayers?: { readonly player: BankRef | null; readonly runner: BankRef | null; readonly bundled: BankRef | null };
};

const VOICE_KEY = (track: string, voice: number): string => `${track}:${voice}`;

/**
 * The cue player. Feed it one `TickReport`'s cues with `advance`, tell it when a voice becomes `ready` or `ended`, and
 * it keeps the protocol messages flowing in the spec's order. It sends nothing while locked, and nothing for a voice
 * whose messages are still waiting on a `ready`.
 */
export class CuePlayer {
  private readonly send: (message: AudioMessage) => void;
  private readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  private readonly onEnded: ((cueId: number) => void) | undefined;
  private readonly focusMode: "pause" | "continue";
  private readonly playerBank: BankRef | null;
  private readonly runnerBank: BankRef | null;
  private readonly bundledBank: BankRef | null;
  private readonly voices: PlayerVoice[] = [];
  private readonly prepared = new Map<string, { readonly voice: number; readonly asset: AssetKey }>();
  private readonly slots = new Map<string, PlayerVoice>();
  private readonly held = new Map<number, AudioMessage[]>();
  private lastBank: string | null = null;
  private reached = 0;
  private locked = false;
  private focusHold = false;
  private videoHold = false;

  constructor(options: CuePlayerOptions) {
    this.send = options.send;
    this.readAsset = options.readAsset;
    this.onEnded = options.onEnded;
    this.focusMode = options.focus ?? "pause";
    this.playerBank = options.bankLayers?.player ?? null;
    this.runnerBank = options.bankLayers?.runner ?? null;
    this.bundledBank = options.bankLayers?.bundled ?? null;
  }

  /** The simulation tick the player has most recently reached: R in the table. */
  get position(): number {
    return this.reached;
  }

  /** Every realised voice, in the order it was created (the order the lock realises them). */
  get realised(): readonly PlayerVoice[] {
    return [...this.voices];
  }

  /** Whether the browser autoplay lock is still in force. */
  get isLocked(): boolean {
    return this.locked;
  }

  /** Advance R. The player never asks the runner for its position, so the host states it. */
  reach(tick: number): void {
    this.reached = Math.max(this.reached, tick);
  }

  /** Start locked (a browser before its first gesture). A native or headless runner never calls this. */
  lock(): void {
    this.locked = true;
  }

  /**
   * The first user gesture: realise every voice the mirror shows as playing or paused, in track order then voice
   * index, as an ordinary late start measured to this tick ([#audio-autoplay]). Drop the missed finite effects.
   */
  unlock(tick: number): void {
    if (!this.locked) return;
    this.locked = false;
    this.reach(tick);
    const order = [...this.voices].sort((left, right) => (left.track < right.track ? -1 : left.track > right.track ? 1 : left.id - right.id));
    for (const voice of order) {
      if (voice.realised) continue;
      if (voice.state !== "playing" && voice.state !== "paused") continue;
      const wasPaused = voice.state === "paused";
      const cue = this.syntheticPlay(voice);
      if (!voice.loaded) {
        // The lock suppressed this voice's `load`; send it now, and let `ready` realise the cue at the gesture's tick.
        const bytes = this.readAsset(voice.asset);
        if (bytes === null) {
          this.forget(voice);
          continue;
        }
        voice.pendingPlay = cue;
        if (wasPaused) voice.state = "paused";
        this.sendOrHold(voice, { kind: "load", voice: voice.id, track: voice.track, asset: voice.asset, data: bytes });
        continue;
      }
      const start = cueStart(cue, tick, { lengthTicks: voice.lengthTicks, loop: voice.loop, playing: !wasPaused });
      if (start.action === "stop") {
        // Dropped by the late rule: not realised, `stop` sent, no `ended` ([#audio-late-sounds]).
        this.forget(voice);
        this.send({ kind: "stop", voice: voice.id });
        continue;
      }
      if (start.action !== "play") continue;
      voice.state = "playing";
      voice.realised = true;
      voice.positionTicks = start.positionTicks;
      voice.positionTick = tick;
      voice.position = start.positionTicks;
      this.sendOrHold(voice, {
        kind: "play",
        voice: voice.id,
        cue: voice.cue,
        loop: voice.loop,
        volume: voice.volume,
        positionTicks: start.positionTicks,
      });
      if (wasPaused) {
        voice.state = "paused";
        this.sendOrHold(voice, { kind: "pause", voice: voice.id });
      }
    }
  }

  /** `focus.lost` with `RunConfig.audio.focus === "pause"`: pause every voice realised as playing ([#audio-focus]). */
  focusLost(): void {
    if (this.focusMode === "continue" || this.focusHold) return;
    this.focusHold = true;
    for (const voice of this.voices) {
      if (voice.state !== "playing") continue;
      // Take the position while the voice still counts as playing, then freeze it: a hold never loses the position.
      voice.position = this.voicePosition(voice);
      voice.state = "paused";
      voice.positionTicks = voice.position;
      voice.positionTick = this.reached;
      this.sendOrHold(voice, { kind: "pause", voice: voice.id });
    }
  }

  /** `focus.gained`: resume exactly the voices the hold paused. */
  focusGained(): void {
    if (!this.focusHold) return;
    this.focusHold = false;
    this.releaseHold();
  }

  /**
   * A video started ([#video-music]): the core already posted `media.stop("music")` in the same tick, so the runner holds
   * every other realised voice for the video's duration instead of silencing it. The music's restart arrives as the
   * core's own `music.play` cue; nothing here restarts it.
   */
  videoStarted(): void {
    if (this.videoHold) return;
    this.videoHold = true;
    for (const voice of this.voices) {
      if (voice.state !== "playing") continue;
      voice.position = this.voicePosition(voice);
      voice.state = "paused";
      voice.positionTicks = voice.position;
      voice.positionTick = this.reached;
      this.sendOrHold(voice, { kind: "pause", voice: voice.id });
    }
  }

  /** The video ended: release the hold before the core's restart cue is processed. */
  videoEnded(): void {
    if (!this.videoHold) return;
    this.videoHold = false;
    this.releaseHold();
  }

  /** Whether a video's hold is in force. */
  get isVideoHeld(): boolean {
    return this.videoHold;
  }

  /** Process one `TickReport`'s cues, then its requests, in array order (the table's order). */
  advance(cues: readonly AudioCue[]): void {
    for (const cue of cues) this.process(cue);
  }

  /** A voice's asset bytes arrived and it can now start (the protocol's `ready`). */
  ready(voiceId: number, lengthTicks: number | null): void {
    const voice = this.byId(voiceId);
    if (voice === undefined) return;
    voice.lengthTicks = lengthTicks;
    voice.loaded = true;
    if (this.locked) return; // the mirror keeps showing what should be playing; unlock realises it
    const pending = voice.pendingPlay;
    voice.pendingPlay = null;
    if (pending !== null) {
      this.realiseNow(voice, pending);
      if (!this.voices.includes(voice)) return; // the late rule dropped it
    } else if (!voice.realised) {
      voice.state = "ready";
    }
    const held = this.held.get(voiceId) ?? [];
    this.held.delete(voiceId);
    for (const message of held) this.send(message);
  }

  /** The source reported `ended`; the core hears it as an `audio.ended` input, once. */
  ended(voiceId: number): void {
    const voice = this.byId(voiceId);
    if (voice === undefined) return;
    voice.state = "ended";
    this.onEnded?.(voice.cue);
  }

  /** A voice failed to load: its held messages are dropped, never sent ([cue-player]). */
  failed(voiceId: number): void {
    const voice = this.byId(voiceId);
    if (voice === undefined) return;
    voice.state = "failed";
    this.held.delete(voiceId);
  }

  private process(cue: AudioCue): void {
    switch (cue.kind) {
      case "soundfont.set":
        this.setBank(cue);
        return;
      case "media.load":
        this.load(cue);
        return;
      case "media.play":
        this.play(cue);
        return;
      case "media.stop":
        this.stop(cue);
        return;
      case "media.pause":
      case "media.resume":
        this.pauseResume(cue);
        return;
      case "media.seek":
        this.seek(cue);
        return;
      case "media.flags":
        this.flags(cue);
        return;
      case "media.volume":
        this.volume(cue);
        return;
      case "media.fade":
        this.fade(cue);
        return;
      default: {
        const unreachable: never = cue.kind;
        throw new Error(`CuePlayer: unknown cue kind ${String(unreachable)}`);
      }
    }
  }

  /**
   * Resolve the four ranks and send the result ([#soundfont-layers]). The author layer is the cue's asset — the game's
   * `defaultSoundFont`, the only game-authored bank setting (MEDIA-5) — and the player, runner and bundled layers come
   * from the host. A player choice therefore wins, and no cue can override it.
   */
  private setBank(cue: AudioCue): void {
    const layers: BankLayers = {
      player: this.playerBank,
      author: cue.asset === null ? null : { source: "game", id: cue.asset, sha256: null },
      runner: this.runnerBank,
      bundled: this.bundledBank,
    };
    const chosen = effectiveBank(layers);
    const bank = chosen.bank;
    const key = bank === null ? "none" : `${chosen.rank}:${bank.source}:${bank.id}`;
    if (key === this.lastBank) return;
    this.lastBank = key;
    this.send({ kind: "setBank", bankKind: "soundfont", bank });
  }

  private load(cue: AudioCue): void {
    const track = cue.track;
    const asset = cue.asset;
    if (track === null || asset === null) return;
    this.releasePrepared(track, asset);
    const bytes = this.readAsset(asset);
    if (bytes === null) {
      this.releasePrepared(track, asset);
      return;
    }
    const voice = this.createVoice(cue, track, asset, cue.cueId, cue.loop === true, cue.volume ?? 100);
    this.prepared.set(track, { voice: voice.id, asset });
    if (!this.locked) this.sendOrHold(voice, { kind: "load", voice: voice.id, track, asset, data: bytes });
  }

  private play(cue: AudioCue): void {
    const track = cue.track;
    const asset = cue.asset;
    if (track === null || asset === null) return;
    const prepared = this.prepared.get(track);
    const reusable = prepared !== undefined && prepared.asset === asset ? this.byId(prepared.voice) : undefined;
    let voice: PlayerVoice;
    if (reusable !== undefined && (reusable.state === "ready" || reusable.state === "loading")) {
      voice = reusable;
    } else {
      this.releasePrepared(track, asset);
      const bytes = this.readAsset(asset);
      if (bytes === null) return;
      voice = this.createVoice(cue, track, asset, cue.cueId, cue.loop === true, cue.volume ?? 100);
      this.prepared.set(track, { voice: voice.id, asset });
      // A `play` with no prepared voice sends `load` now — that is what starts the source loading — and the `play`
      // message itself waits for `ready` ([cue-player]).
      if (!this.locked) this.sendOrHold(voice, { kind: "load", voice: voice.id, track, asset, data: bytes });
    }

    voice.loop = cue.loop === true;
    voice.volume = cue.volume ?? voice.volume;
    voice.positionTicks = cue.positionTicks ?? 0;
    voice.positionTick = cue.tick;
    voice.cue = cue.cueId;

    if (this.locked) {
      // The mirror records what should be playing, and nothing reaches the sources ([#audio-autoplay]).
      voice.state = "playing";
      voice.position = voice.positionTicks;
      return;
    }
    this.realise(voice, cue);
  }

  private realise(voice: PlayerVoice, cue: AudioCue): void {
    if (!voice.loaded) {
      // The cue waits for `ready`; its start is computed there, so its lateness is measured from ready.
      voice.pendingPlay = cue;
      voice.state = "playing";
      voice.positionTicks = cue.positionTicks ?? 0;
      voice.positionTick = cue.tick;
      return;
    }
    this.realiseNow(voice, cue);
  }

  /** Start (or drop) a cue whose voice is ready: the one place lateness is measured ([#audio-late-sounds]). */
  private realiseNow(voice: PlayerVoice, cue: AudioCue): void {
    const start = cueStart(cue, this.reached, { lengthTicks: voice.lengthTicks, loop: voice.loop, playing: voice.state === "playing" });
    if (start.action === "stop") {
      this.forget(voice);
      this.send({ kind: "stop", voice: voice.id });
      return;
    }
    if (start.action !== "play") return; // `media.play` is the only kind that starts a voice.
    voice.state = "playing";
    voice.positionTicks = start.positionTicks;
    voice.positionTick = this.reached;
    voice.position = start.positionTicks;
    voice.pendingLoad = null;
    voice.realised = true;
    this.send({ kind: "play", voice: voice.id, cue: cue.cueId, loop: voice.loop, volume: voice.volume, positionTicks: start.positionTicks });
  }

  private stop(cue: AudioCue): void {
    const voice = this.bySlot(cue.track, cue.voice);
    if (voice === undefined) return;
    this.forget(voice);
    this.send({ kind: "stop", voice: voice.id });
  }

  private pauseResume(cue: AudioCue): void {
    const voice = this.bySlot(cue.track, cue.voice);
    if (voice === undefined) return;
    if (cue.kind === "media.pause") {
      if (voice.state === "playing") {
        voice.position = this.voicePosition(voice);
        voice.positionTicks = voice.position;
        voice.positionTick = this.reached;
      }
      voice.state = "paused";
      this.sendOrHold(voice, { kind: "pause", voice: voice.id });
      return;
    }
    voice.state = "playing";
    voice.positionTick = this.reached;
    this.sendOrHold(voice, { kind: "resume", voice: voice.id });
  }

  private seek(cue: AudioCue): void {
    const voice = this.bySlot(cue.track, cue.voice);
    if (voice === undefined) return;
    const start = cueStart(cue, this.reached, { lengthTicks: voice.lengthTicks, loop: voice.loop, playing: voice.state === "playing" });
    if (start.action !== "seek") return;
    voice.positionTicks = start.positionTicks;
    voice.positionTick = this.reached;
    voice.position = start.positionTicks;
    this.sendOrHold(voice, { kind: "seek", voice: voice.id, positionTicks: start.positionTicks });
  }

  private flags(cue: AudioCue): void {
    const voice = this.bySlot(cue.track, cue.voice);
    if (voice === undefined) return;
    voice.loop = cue.loop === true;
    this.sendOrHold(voice, { kind: "setLoop", voice: voice.id, loop: voice.loop });
  }

  private volume(cue: AudioCue): void {
    const scope: VolumeScope = cue.track === null ? "master" : cue.voice === null ? "bus" : "voice";
    const voice = scope === "voice" ? this.bySlot(cue.track, cue.voice) : undefined;
    if (voice !== undefined) voice.volume = cue.volume ?? voice.volume;
    const message: AudioMessage = {
      kind: "setVolume",
      scope,
      voice: voice?.id ?? null,
      bus: scope === "master" ? null : cue.track,
      volume: cue.volume ?? 100,
    };
    if (voice === undefined) this.send(message);
    else this.sendOrHold(voice, message);
  }

  private fade(cue: AudioCue): void {
    const scope: VolumeScope = cue.voice === null ? "bus" : "voice";
    const voice = scope === "voice" ? this.bySlot(cue.track, cue.voice) : undefined;
    if (voice === undefined) {
      // A bus fade needs no voice; a voice fade for an unmapped slot is ignored (the table's `media.stop` rule).
      if (scope === "voice") return;
    }
    const start = cueStart(cue, this.reached, { lengthTicks: null, loop: false, playing: true });
    const emit = (message: AudioMessage): void => {
      if (voice === undefined) this.send(message);
      else this.sendOrHold(voice, message);
    };
    if (start.action === "setVolume") {
      emit({ kind: "setVolume", scope, voice: voice?.id ?? null, bus: cue.track, volume: start.volume });
      return;
    }
    if (start.action !== "fade") return;
    emit({
      kind: "fade",
      scope,
      voice: voice?.id ?? null,
      bus: cue.track,
      fromVolume: start.from,
      targetVolume: start.target,
      durationTicks: start.durationTicks,
    });
  }

  private createVoice(
    cue: AudioCue,
    track: string,
    asset: AssetKey,
    id: number,
    loop: boolean,
    volume: number,
  ): PlayerVoice {
    const voice: PlayerVoice = {
      id,
      slot: cue.voice ?? 0,
      track,
      asset,
      cue: cue.cueId,
      loop,
      volume,
      state: "loading",
      positionTicks: cue.positionTicks ?? 0,
      positionTick: cue.tick,
      lengthTicks: null,
      position: cue.positionTicks ?? 0,
      pendingLoad: null,
      pendingPlay: null,
      realised: false,
      loaded: false,
    };
    this.voices.push(voice);
    this.slots.set(VOICE_KEY(track, voice.slot), voice);
    return voice;
  }

  private byId(id: number): PlayerVoice | undefined {
    for (const voice of this.slots.values()) if (voice.id === id) return voice;
    return undefined;
  }

  private bySlot(track: string | null, slot: number | null): PlayerVoice | undefined {
    if (track === null || slot === null) return undefined;
    return this.slots.get(VOICE_KEY(track, slot));
  }

  private releasePrepared(track: string, asset: AssetKey): void {
    const prepared = this.prepared.get(track);
    if (prepared === undefined) return;
    this.prepared.delete(track);
    if (prepared.asset === asset) return;
    const voice = this.byId(prepared.voice);
    if (voice === undefined) return;
    this.forget(voice);
    this.send({ kind: "stop", voice: voice.id });
  }

  /** Drop a voice from the state and the slot map, keeping the protocol's one `stop` as the caller's. */
  private forget(voice: PlayerVoice): void {
    voice.state = "stopped";
    this.held.delete(voice.id);
    const at = this.voices.indexOf(voice);
    if (at >= 0) this.voices.splice(at, 1);
    const key = VOICE_KEY(voice.track, voice.slot);
    if (this.slots.get(key) === voice) this.slots.delete(key);
  }

  /** The late-start workbook: where a voice is now, from its last position cue and how long it has played. */
  private voicePosition(voice: PlayerVoice): number {
    if (voice.state !== "playing") return voice.position;
    const elapsed = Math.max(0, this.reached - voice.positionTick);
    const position = voice.positionTicks + elapsed;
    return voice.lengthTicks !== null && voice.loop ? position % voice.lengthTicks : position;
  }

  /** Send now, or hold in order until `ready` — a loading voice's messages wait and then go out lateness-adjusted. */
  private sendOrHold(voice: PlayerVoice, message: AudioMessage): void {
    if (this.locked) return;
    voice.realised = true;
    if (!voice.loaded && message.kind !== "load") {
      const queue = this.held.get(voice.id) ?? [];
      queue.push(message);
      this.held.set(voice.id, queue);
      return;
    }
    this.send(message);
  }

  /** Resume every voice a hold paused: the focus hold and the video hold share one mechanism ([#audio-focus]). */
  private releaseHold(): void {
    for (const voice of this.voices) {
      if (voice.state !== "paused") continue;
      voice.state = "playing";
      voice.positionTick = this.reached;
      this.send({ kind: "resume", voice: voice.id });
    }
  }

  /** Build the cue a locked voice is realised with at unlock: its own last position, its own loop and volume. */
  private syntheticPlay(voice: PlayerVoice): AudioCue {
    return {
      cueId: voice.cue,
      tick: voice.positionTick,
      kind: "media.play",
      track: voice.track,
      voice: voice.id,
      asset: voice.asset,
      loop: voice.loop,
      flags: voice.loop ? 1 : 0,
      positionTicks: voice.positionTicks,
      volume: voice.volume,
      targetVolume: null,
      durationTicks: null,
    };
  }
}
