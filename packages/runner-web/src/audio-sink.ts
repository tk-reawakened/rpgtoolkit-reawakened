/**
 * The runner's audio output: PCM from `synth` into the host's audio graph (`docs/spec/engine/runners.md#audio`).
 *
 * The sink is the other half of the cue player. The player decides *what* to send; the sink holds one `AudioSource`
 * voice per protocol voice id and **pulls** frames from them, which is what an audio graph does — a `ScriptProcessor`
 * in the browser, a buffer fill in a test. Pulling is also why the lane can assert on it without a speaker: the same
 * `render` call the graph makes is the one the test reads.
 *
 * The sink speaks protocol v1 (`packages/synth/src/protocol.ts`): `load`, `play`, `pause`, `resume`, `stop`, `seek`,
 * `setLoop`, `setVolume`, `fade` and `setBank`. `setBank` is recorded and does nothing yet: MIDI needs a SoundFont and the
 * bank picker is entry 9.6's, so a voice whose source needs a bank fails with `bank.missing` instead of playing silence.
 */

import type { AssetKey } from "@tk-reawakened/core";
import {
  createAudioSourceRegistry,
  createPcmSource,
  type AudioMessage,
  type AudioSourceRegistry,
  type SourceVoice,
} from "@tk-reawakened/synth";

/** What the sink tells the cue player, in the protocol's event vocabulary. */
export type SinkEvent =
  | { readonly kind: "ready"; readonly voice: number; readonly lengthTicks: number | null }
  | { readonly kind: "ended"; readonly voice: number }
  | { readonly kind: "error"; readonly voice: number; readonly code: string; readonly detail: string };

export type PcmSinkOptions = {
  /** The bytes of one asset; `null` when the host cannot supply it. */
  readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  /** The formats this runner can play; defaults to the PCM source (WAV, PCM and IMA/MS ADPCM). */
  readonly registry?: AudioSourceRegistry;
  /** The graph's sample rate. */
  readonly outputRateHz?: number;
  /** Where events go; the host turns `ended` into an `audio.ended` input. */
  readonly onEvent?: (event: SinkEvent) => void;
};

type SinkVoice = {
  readonly id: number;
  readonly track: string;
  readonly asset: AssetKey;
  readonly source: SourceVoice;
  cue: number;
  volume: number;
  bus: string | null;
  ended: boolean;
};

const TICKS_PER_SECOND = 60;

/** One `AudioBuffer`-shaped block per pull, and the deterministic record of what the sink has played. */
export type ScheduledPlay = {
  readonly voice: number;
  readonly track: string;
  readonly positionTicks: number;
  readonly loop: boolean;
  readonly lengthTicks: number | null;
};

export class PcmSink {
  private readonly readAsset: (asset: AssetKey) => Uint8Array | null;
  private readonly registry: AudioSourceRegistry;
  private readonly outputRateHz: number;
  private readonly onEvent: ((event: SinkEvent) => void) | undefined;
  private readonly voices = new Map<number, SinkVoice>();
  private readonly busVolumes = new Map<string, number>();
  private masterVolume = 100;
  private bank: string | null = null;
  private readonly played: ScheduledPlay[] = [];
  private readonly errors: SinkEvent[] = [];

  constructor(options: PcmSinkOptions) {
    this.readAsset = options.readAsset;
    this.registry = options.registry ?? createAudioSourceRegistry([createPcmSource()]);
    this.outputRateHz = options.outputRateHz ?? 44_100;
    this.onEvent = options.onEvent;
  }

  /** Every `play` the sink scheduled, in order: the record a lane compares instead of listening. */
  get scheduled(): readonly ScheduledPlay[] {
    return this.played;
  }

  /** The bank the player last set (`setBank`), or `null`. */
  get currentBank(): string | null {
    return this.bank;
  }

  /** The voices the sink holds, open or ended. */
  get open(): readonly { readonly id: number; readonly track: string; readonly asset: AssetKey }[] {
    return [...this.voices.values()].map((voice) => ({ id: voice.id, track: voice.track, asset: voice.asset }));
  }

  /** Handle one protocol message from the cue player. */
  handle(message: AudioMessage): void {
    switch (message.kind) {
      case "setBank": {
        this.bank = message.bank === null ? null : `${message.bank.source}:${message.bank.id}`;
        return;
      }
      case "load": {
        const bytes = message.data.byteLength > 0 ? message.data : this.readAsset(message.asset);
        if (bytes === null) {
          this.fail(message.voice, "source.failed", `${message.asset} is not readable`);
          return;
        }
        const env = { outputRateHz: this.outputRateHz, bank: null };
        const source = this.registry.open(bytes, () => env, extensionOf(message.asset));
        if (!source.ok) {
          const code = source.error.code === "format.unsupported" || source.error.code === "format.malformed"
            ? source.error.code
            : "source.failed";
          this.fail(message.voice, code, source.error.detail);
          return;
        }
        this.voices.set(message.voice, {
          id: message.voice,
          track: message.track,
          asset: message.asset,
          source: source.value,
          cue: 0,
          volume: 100,
          bus: message.track,
          ended: false,
        });
        this.event({ kind: "ready", voice: message.voice, lengthTicks: source.value.lengthTicks });
        return;
      }
      case "play": {
        const voice = this.voices.get(message.voice);
        if (voice === undefined) {
          this.fail(message.voice, "protocol.state", "play for a voice that was never loaded");
          return;
        }
        voice.cue = message.cue;
        voice.volume = message.volume;
        voice.ended = false;
        voice.source.setVolume(message.volume);
        voice.source.setLoop(message.loop);
        voice.source.start(message.positionTicks, message.loop);
        this.played.push({
          voice: message.voice,
          track: voice.track,
          positionTicks: message.positionTicks,
          loop: message.loop,
          lengthTicks: voice.source.lengthTicks,
        });
        return;
      }
      case "pause":
        this.voices.get(message.voice)?.source.pause();
        return;
      case "resume":
        this.voices.get(message.voice)?.source.resume();
        return;
      case "stop": {
        const voice = this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.source.stop();
        this.voices.delete(message.voice);
        return;
      }
      case "seek":
        this.voices.get(message.voice)?.source.seek(message.positionTicks);
        return;
      case "setLoop":
        this.voices.get(message.voice)?.source.setLoop(message.loop);
        return;
      case "setVolume": {
        const volume = clampVolume(message.volume);
        if (message.scope === "master") {
          this.masterVolume = volume;
          return;
        }
        if (message.scope === "bus") {
          if (message.bus !== null) this.busVolumes.set(message.bus, volume);
          return;
        }
        const voice = message.voice === null ? undefined : this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.volume = volume;
        voice.source.setVolume(volume);
        return;
      }
      case "fade": {
        const voice = message.voice === null ? undefined : this.voices.get(message.voice);
        if (voice === undefined) return;
        voice.source.fade(message.fromVolume, message.targetVolume, message.durationTicks);
        return;
      }
      default: {
        const unreachable: never = message;
        throw new Error(`PcmSink: unknown message ${JSON.stringify(unreachable)}`);
      }
    }
  }

  /**
   * Pull `frames` into `left`/`right`, exactly as an audio graph's callback does. Silent voices write zeros; a finite
   * voice that reaches its end reports `ended` once. Bus and master volumes are applied here, not by the source.
   */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);
    const scratchLeft = new Float32Array(frames);
    const scratchRight = new Float32Array(frames);
    for (const voice of this.voices.values()) {
      scratchLeft.fill(0, 0, frames);
      scratchRight.fill(0, 0, frames);
      voice.source.render(scratchLeft, scratchRight, frames);
      const bus = voice.bus === null ? 100 : (this.busVolumes.get(voice.bus) ?? 100);
      const gain = (clampVolume(voice.volume) / 100) * (bus / 100) * (this.masterVolume / 100);
      for (let index = 0; index < frames; index += 1) {
        left[index] = (left[index] ?? 0) + (scratchLeft[index] ?? 0) * gain;
        right[index] = (right[index] ?? 0) + (scratchRight[index] ?? 0) * gain;
      }
      if (voice.source.ended && !voice.ended) {
        voice.ended = true;
        this.event({ kind: "ended", voice: voice.id });
        this.voices.delete(voice.id);
      }
    }
  }

  /** The non-silent sample count of one pull: the deterministic "did it make sound" the lane asserts. */
  static energy(left: Float32Array, frames: number): number {
    let energy = 0;
    for (let index = 0; index < frames; index += 1) energy += Math.abs(left[index] ?? 0);
    return energy;
  }

  private event(event: SinkEvent): void {
    if (event.kind === "error") this.errors.push(event);
    this.onEvent?.(event);
  }

  private fail(voice: number, code: string, detail: string): void {
    this.event({ kind: "error", voice, code, detail });
  }
}

/** The extension an asset key ends with, so the registry can prefer the source that declares it. */
function extensionOf(asset: AssetKey): string | null {
  const dot = asset.lastIndexOf(".");
  return dot < 0 ? null : asset.slice(dot + 1);
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(100, Math.round(volume)));
}

/**
 * Attach a sink to a browser `AudioContext`: a `ScriptProcessorNode` pulls it, a master `GainNode` feeds the graph. The
 * sink is the only thing that knows about voices, so the graph node is three lines and no policy.
 */
export function connectSinkToGraph(context: AudioContext, sink: PcmSink, frames = 1024): { readonly node: ScriptProcessorNode; readonly disconnect: () => void } {
  const node = context.createScriptProcessor(frames, 2, 2);
  node.onaudioprocess = (event: AudioProcessingEvent): void => {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    sink.render(left, right, event.outputBuffer.length);
  };
  node.connect(context.destination);
  return {
    node,
    disconnect: (): void => {
      node.onaudioprocess = null;
      node.disconnect();
    },
  };
}

/** Ticks as seconds at 60 Hz, for a length the lane reports next to the core's `AudioInfo.lengthTicks`. */
export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}
