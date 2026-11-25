import { assetKey } from "@tk-reawakened/core";
import { BUNDLED_BANK, type BankRef, connectSinkToGraph, type GraphConnection, PcmSink, type SinkEvent } from "@tk-reawakened/runner-web";
import type { AudioOutputApi, AudioPlayOutcome, AuditionFormat, AuditionOptions } from "@tk-reawakened/platform-services";

/** Where the browser audition gets its audio graph and its default SoundFont. */
type WebAudioOptions = {
  /** The AudioWorklet module; absence means this host has no audition. */
  readonly audioWorkletUrl?: string;
  /** The bundled default SoundFont (`TK-16.sf2`), used when a MIDI audition has no configured bank. */
  readonly bundledSoundFontUrl?: string;
};

const SOUNDFONT_KIND = "soundfont";
const AUTHOR_BANK_ID = "audition";
const AUTHOR_BANK: BankRef = { source: "user", id: AUTHOR_BANK_ID, sha256: null };
const VOLUME = 100;
const RESUME_TIMEOUT_MS = 1000;
const START_TIMEOUT_MS = 5000;
const REPLACED: AudioPlayOutcome = { ok: false, reason: "output-unavailable", detail: "A newer sound replaced this one." };

type Pending = {
  readonly voice: number;
  readonly loop: boolean;
  readonly connection: GraphConnection;
  readonly resolve: (outcome: AudioPlayOutcome) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

type Playing = { readonly voice: number; readonly connection: GraphConnection };

/**
 * The browser's audition output: one PCM sink in the page, forwarding to the AudioWorklet. Two voices alternate so a
 * stale `ready` from the previous sound cannot start the current one. Every `play` and `stop` bumps a generation, so an
 * older call that is still awaiting resolves as replaced.
 */
class WebAudition implements AudioOutputApi {
  private readonly workletUrl: string;
  private readonly bundledUrl: string | undefined;
  private context: AudioContext | null = null;
  private graph: Promise<GraphConnection> | null = null;
  private bundledData: Uint8Array | null = null;
  private authorData: Uint8Array | null = null;
  private pending: Pending | null = null;
  private playing: Playing | null = null;
  private nextVoice = 0;
  private generation = 0;

  constructor(workletUrl: string, bundledUrl: string | undefined) {
    this.workletUrl = workletUrl;
    this.bundledUrl = bundledUrl;
  }

  async play(bytes: Uint8Array, format: AuditionFormat, options: AuditionOptions): Promise<AudioPlayOutcome> {
    this.halt("Playback was replaced by a newer sound.");
    const generation = this.generation;
    const context = (this.context ??= new AudioContext());
    return this.start(context, generation, bytes, format, options);
  }

  stop(): void {
    this.halt("Playback was stopped before it started.");
  }

  private async start(
    context: AudioContext,
    generation: number,
    bytes: Uint8Array,
    format: AuditionFormat,
    options: AuditionOptions,
  ): Promise<AudioPlayOutcome> {
    const running = await this.resume(context);
    if (generation !== this.generation) return REPLACED;
    if (!running) {
      return { ok: false, reason: "autoplay-locked", detail: "Sound is locked until you click the page." };
    }

    let connection: GraphConnection;
    try {
      connection = await this.ensureGraph(context);
    } catch (error) {
      return { ok: false, reason: "output-unavailable", detail: `Audio output could not start: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (generation !== this.generation) return REPLACED;

    let bank: BankRef | null = null;
    if (format === "midi") {
      bank = await this.selectBank(options.soundFont);
      if (generation !== this.generation) return REPLACED;
      if (bank === null) {
        return {
          ok: false,
          reason: "missing-soundfont",
          detail: "The bundled TK-16 SoundFont could not be loaded, so MIDI has no instrument bank.",
        };
      }
    }

    const asset = assetKey(format === "midi" ? "audition.mid" : "audition.wav");
    // The ES2022 lib floor has no Promise.withResolvers, so the executor captures resolve.
    let resolve: (outcome: AudioPlayOutcome) => void = () => {};
    const promise = new Promise<AudioPlayOutcome>((done) => {
      resolve = done;
    });
    const voice = this.nextVoice;
    this.nextVoice = 1 - voice;
    this.pending = {
      voice,
      loop: options.loop,
      connection,
      resolve,
      timer: setTimeout(
        () => this.finish({ ok: false, reason: "output-unavailable", detail: "The sound did not start within 5 seconds." }),
        START_TIMEOUT_MS,
      ),
    };
    if (bank !== null) connection.send({ kind: "setBank", bankKind: SOUNDFONT_KIND, bank });
    connection.send({ kind: "load", voice, track: "audition", asset, data: bytes });
    return promise;
  }

  private async resume(context: AudioContext): Promise<boolean> {
    if (context.state === "running") return true;
    const resumed = context.resume().then(
      () => context.state === "running",
      () => false,
    );
    const timeout = new Promise<boolean>((done) => {
      setTimeout(() => done(false), RESUME_TIMEOUT_MS);
    });
    return Promise.race([resumed, timeout]);
  }

  private ensureGraph(context: AudioContext): Promise<GraphConnection> {
    this.graph ??= this.connect(context).catch((error: unknown) => {
      this.graph = null;
      throw error;
    });
    return this.graph;
  }

  private connect(context: AudioContext): Promise<GraphConnection> {
    const sink = new PcmSink({
      // Loads carry their bytes inline, so the sink never reads assets by key.
      readAsset: () => null,
      readBank: (bank) => this.readBank(bank),
      outputRateHz: context.sampleRate,
      onEvent: (event) => this.onEvent(event),
    });
    return connectSinkToGraph(context, sink, { workletUrl: this.workletUrl });
  }

  private readBank(bank: BankRef): Uint8Array | null {
    if (bank.source === "bundled" && bank.id === BUNDLED_BANK.id) return this.bundledData;
    if (bank.source === "user" && bank.id === AUTHOR_BANK_ID) return this.authorData;
    return null;
  }

  /** MIDI with no configured SoundFont uses the bundled bank, as the game does (audio-media.md#soundfont-layers). */
  private async selectBank(soundFont: Uint8Array | null): Promise<BankRef | null> {
    if (soundFont !== null) {
      this.authorData = soundFont;
      return AUTHOR_BANK;
    }
    return (await this.loadBundled()) ? BUNDLED_BANK : null;
  }

  private async loadBundled(): Promise<boolean> {
    if (this.bundledData !== null) return true;
    if (this.bundledUrl === undefined) return false;
    try {
      const response = await fetch(this.bundledUrl);
      if (!response.ok) return false;
      this.bundledData = new Uint8Array(await response.arrayBuffer());
      return true;
    } catch {
      return false;
    }
  }

  private onEvent(event: SinkEvent): void {
    switch (event.kind) {
      case "ready": {
        const pending = this.pending;
        if (pending === null || pending.voice !== event.voice) return;
        pending.connection.send({ kind: "play", voice: event.voice, cue: 0, loop: pending.loop, volume: VOLUME, positionTicks: 0 });
        this.playing = { voice: event.voice, connection: pending.connection };
        this.finish({ ok: true });
        return;
      }
      case "ended":
        if (this.playing?.voice === event.voice) this.playing = null;
        return;
      case "error": {
        const pending = this.pending;
        if (pending === null || (event.voice !== null && event.voice !== pending.voice)) return;
        this.finish(refusal(event.code, event.detail));
        return;
      }
      default:
        // Bank substitution reports the sink's own choice; it never stops playback or answers a start.
        return;
    }
  }

  private halt(detail: string): void {
    this.generation += 1;
    if (this.playing !== null) {
      this.playing.connection.send({ kind: "stop", voice: this.playing.voice });
      this.playing = null;
    }
    if (this.pending !== null) {
      this.pending.connection.send({ kind: "stop", voice: this.pending.voice });
    }
    this.finish({ ok: false, reason: "output-unavailable", detail });
  }

  private finish(outcome: AudioPlayOutcome): void {
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }
}

/** Returns the browser audition output, or null when the host has no worklet or no `AudioContext`. */
export function createWebAudioOutput(options: WebAudioOptions): AudioOutputApi | null {
  if (options.audioWorkletUrl === undefined || typeof AudioContext === "undefined") return null;
  return new WebAudition(options.audioWorkletUrl, options.bundledSoundFontUrl);
}

function refusal(code: string, detail: string): AudioPlayOutcome {
  switch (code) {
    case "format.unsupported":
    case "format.malformed":
    case "source.failed":
      return { ok: false, reason: "unsupported-format", detail };
    case "bank.missing":
    case "bank.invalid":
    case "bank.unavailable":
      return { ok: false, reason: "missing-soundfont", detail };
    default:
      return { ok: false, reason: "output-unavailable", detail };
  }
}
