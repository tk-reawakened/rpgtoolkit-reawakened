/**
 * The decode-ahead contract between the live session (host thread) and the decode worker (issue #934, OQ3).
 *
 * The worker only ever runs **pure** functions of bytes: image decoding, WAV/ADPCM decoding to PCM, MIDI inspection and
 * SoundFont validation. Stateful playback (`SourceVoice`), the single bank cache and the Web Audio graph stay on the host.
 * A format the worker cannot prepare is recorded as a named gap, never silently treated as prepared.
 */

import type { AssetKey } from "@tk-reawakened/core";
import type { TexturePixels } from "@tk-reawakened/render-webgl2";
import type { PreparedPcm } from "@tk-reawakened/synth";

/** What a decode-ahead job is asked to prepare. */
export type PrepareKind = "image" | "audio" | "midi" | "soundfont";

/**
 * WAV (PCM, IMA ADPCM or MS ADPCM) decoded to interleaved float samples already at the host's output rate. The type
 * lives in `synth` beside `preparePcm`, which both the worker and the host's own `createPcmSource` call.
 */
export type { PreparedPcm };

/** A MIDI file that parsed: its length in ticks. Playback state is the host's. */
export type PreparedMidi = { readonly kind: "midi"; readonly lengthTicks: number };

/** A RIFF `sfbk` bank that validated: the cache key and size. The bytes stay with the host's single bank cache. */
export type PreparedSoundFont = { readonly kind: "soundfont"; readonly sha256: string; readonly size: number };

export type PreparedAudio = PreparedPcm | PreparedMidi | PreparedSoundFont;

/**
 * An asset with no prepared form, named so a reader of `stats()` sees exactly what stays on the host thread. Every job
 * that ends without a prepared result is one gap: a format no pure preparer covers (`reason` starts `unsupported:`), or
 * bytes of a covered format that failed to decode or validate (`reason` starts `failed:`; these also count in `failed`).
 */
export type DecodeGap = { readonly key: AssetKey; readonly kind: PrepareKind; readonly reason: string };

export type DecodeStats = {
  readonly submitted: number;
  /** Jobs whose prepared result arrived. */
  readonly completed: number;
  /** Jobs the worker tried and could not finish: a decode or validation error, or a worker that died. Each is also a gap. */
  readonly failed: number;
  /** Every job with no prepared result, unpreparable or failed, with the reason. */
  readonly gaps: readonly DecodeGap[];
  /** Why the worker stopped (a script that would not load, a crash); `null` while it runs. Later jobs fail as gaps. */
  readonly workerError?: string | null;
};

/** Host → worker. `bytes` is the host's own copy, transferred, so the caller's bytes are never detached. */
export type DecodeJob = {
  readonly type: "job";
  readonly id: number;
  readonly key: AssetKey;
  readonly kind: PrepareKind;
  readonly outputRateHz: number;
  readonly bytes: ArrayBuffer;
};

/** Worker → host, one reply per job. Pixel and sample buffers are transferred, never copied. */
export type DecodeReply =
  | { readonly type: "image"; readonly id: number; readonly pixels: TexturePixels }
  | { readonly type: "audio"; readonly id: number; readonly audio: PreparedAudio }
  | { readonly type: "gap"; readonly id: number; readonly reason: string; readonly failed: boolean };

/** The host's handle on the worker. Every method is nonblocking and none can change simulation state. */
export interface DecodeAhead {
  /** Queue one asset. The bytes are copied to the worker; the caller keeps its own. A repeat of a key already prepared is a no-op. */
  prepare(key: AssetKey, bytes: Uint8Array, kind: PrepareKind): void;
  /** Pixels the worker decoded for `key`, or `null` when none are ready (the host then decodes on demand as before). */
  image(key: AssetKey): TexturePixels | null;
  /** The prepared form of an audio asset, or `null` when none is ready. */
  audio(key: AssetKey): PreparedAudio | null;
  /** Resolves when every job queued so far has settled (completed, failed or gapped). For tests and orderly close. */
  settled(): Promise<void>;
  stats(): DecodeStats;
  /** Terminate the worker and drop its results. */
  close(): void;
}
