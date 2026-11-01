import { err } from "@tk-reawakened/core";
import type { Result } from "@tk-reawakened/core";
import { SilentVoice } from "./silent-voice.ts";
import { opened } from "./source.ts";
import type { AudioSource, SourceEnv, SourceError, SourceVoice } from "./source.ts";

const tag = (b: Uint8Array, o: number): string =>
  String.fromCharCode(b[o] ?? 0, b[o + 1] ?? 0, b[o + 2] ?? 0, b[o + 3] ?? 0);
const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const i16 = (b: Uint8Array, o: number): number => {
  const n = u16(b, o);
  return n < 0x8000 ? n : n - 0x10000;
};
const u32 = (b: Uint8Array, o: number): number =>
  (b[o] ?? 0) + (b[o + 1] ?? 0) * 0x100 + (b[o + 2] ?? 0) * 0x10000 + (b[o + 3] ?? 0) * 0x1000000;

function fail<T = SourceVoice>(code: SourceError["code"], detail: string): Result<T, SourceError> {
  return err<T, SourceError>({ code, detail });
}

/**
 * A WAV decoded once, off the playback path: interleaved float samples already resampled to `outputRateHz`, plus the
 * file's own rate and frame count (from which a voice's `lengthTicks` is computed). It is a pure function of the bytes
 * and the rate, so a worker may make it and the host may open a voice from it with no further decoding
 * (`preparePcm`, `openPrepared`). `samples` owns a tight buffer, so a worker can transfer it.
 */
export type PreparedPcm = {
  readonly kind: "pcm";
  readonly channels: 1 | 2;
  readonly outputRateHz: number;
  /** Interleaved samples at `outputRateHz`; the same samples `createPcmSource` makes. */
  readonly samples: Float32Array;
  readonly sourceRate: number;
  readonly sourceFrames: number;
};

interface WavData {
  readonly format: 1 | 2 | 17;
  readonly channels: 1 | 2;
  readonly rate: number;
  readonly blockAlign: number;
  readonly bits: number;
  readonly samplesPerBlock: number;
  readonly frames: number | null;
  readonly data: Uint8Array;
}

function parseWav(bytes: Uint8Array): WavData | SourceError {
  if (bytes.length < 12 || tag(bytes, 0) !== "RIFF" || tag(bytes, 8) !== "WAVE") {
    return { code: "format.unsupported", detail: "not a RIFF/WAVE file" };
  }
  let fmt: { format: number; channels: number; rate: number; blockAlign: number; bits: number; samplesPerBlock: number } | null = null;
  let data: Uint8Array | null = null;
  let factFrames: number | null = null;
  let pos = 12;
  while (pos < bytes.length) {
    if (pos + 8 > bytes.length) return { code: "format.malformed", detail: "truncated WAV chunk header" };
    const id = tag(bytes, pos);
    const size = u32(bytes, pos + 4);
    const body = pos + 8;
    if (body + size > bytes.length) return { code: "format.malformed", detail: `WAV ${id} chunk is truncated` };
    if (id === "fmt " && fmt === null) {
      if (size < 16) return { code: "format.malformed", detail: "fmt chunk is shorter than 16 bytes" };
      const format = u16(bytes, body);
      const channels = u16(bytes, body + 2);
      const rate = u32(bytes, body + 4);
      const blockAlign = u16(bytes, body + 12);
      const bits = u16(bytes, body + 14);
      let samplesPerBlock = 0;
      if ((format === 2 || format === 17) && size >= 20) samplesPerBlock = u16(bytes, body + 18);
      fmt = { format, channels, rate, blockAlign, bits, samplesPerBlock };
    } else if (id === "data" && data === null) {
      data = bytes.subarray(body, body + size);
    } else if (id === "fact" && size >= 4) {
      factFrames = u32(bytes, body);
    }
    pos = body + size + (size & 1);
  }
  if (fmt === null || data === null) return { code: "format.malformed", detail: "WAV has no fmt or data chunk" };
  if (fmt.channels !== 1 && fmt.channels !== 2) return { code: "format.unsupported", detail: "WAV must be mono or stereo" };
  if (fmt.rate === 0 || fmt.rate > 192000) return { code: "format.malformed", detail: "WAV sample rate is outside 1..192000 Hz" };
  if (fmt.blockAlign === 0) return { code: "format.malformed", detail: "WAV block alignment is zero" };
  if (fmt.format === 1) {
    if (fmt.bits !== 8 && fmt.bits !== 16 || fmt.blockAlign !== fmt.channels * (fmt.bits / 8)) {
      return { code: "format.unsupported", detail: "WAV PCM must be 8/16-bit with matching block alignment" };
    }
    return { ...fmt, format: 1, channels: fmt.channels as 1 | 2, rate: fmt.rate, data, frames: Math.floor(data.length / fmt.blockAlign), samplesPerBlock: 0 };
  }
  if (fmt.format !== 2 && fmt.format !== 17) return { code: "format.unsupported", detail: `WAV codec ${fmt.format} is unsupported` };
  if (fmt.bits !== 4) return { code: "format.unsupported", detail: "WAV ADPCM must use 4 bits per sample" };
  if (fmt.samplesPerBlock === 0) return { code: "format.malformed", detail: "ADPCM samples-per-block is zero" };
  if (fmt.blockAlign < (fmt.format === 17 ? fmt.channels * 4 : fmt.channels * 7)) {
    return { code: "format.malformed", detail: "ADPCM block alignment is too small" };
  }
  const blockFrames = factFrames ?? (fmt.format === 17
    ? 1 + Math.floor((fmt.blockAlign - fmt.channels * 4) * 2 / fmt.channels)
    : 2 + Math.floor((fmt.blockAlign - fmt.channels * 7) * 2 / fmt.channels));
  return { ...fmt, format: fmt.format as 2 | 17, channels: fmt.channels as 1 | 2, rate: fmt.rate, data, frames: blockFrames, samplesPerBlock: fmt.samplesPerBlock };
}

const clamp16 = (n: number): number => Math.max(-32768, Math.min(32767, n));
const IMA_INDEX = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8,
];
const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const MS_ADAPT = [
  256, 512, 512, 512, 512, 768, 768, 768,
  768, 1024, 1024, 1024, 1280, 1536, 1792, 2048,
];
const MS_COEFFICIENTS = [
  [256, 0], [512, -256], [0, 0], [192, 64], [240, 0], [460, -208], [392, -232],
];

function decodePcm(wav: WavData): Float32Array {
  const channels = wav.channels;
  const out = new Float32Array(Math.floor(wav.data.length / wav.blockAlign) * channels);
  if (wav.bits === 8) {
    for (let i = 0; i < out.length; i++) out[i] = ((wav.data[i] ?? 128) - 128) / 128;
  } else {
    for (let i = 0; i < out.length; i++) out[i] = (i16(wav.data, i * 2) / 32768);
  }
  return out;
}

function decodeIma(wav: WavData): Float32Array {
  const channels = wav.channels;
  const blockFrames = wav.samplesPerBlock;
  const blockCount = Math.ceil(wav.data.length / wav.blockAlign);
  const out = new Float32Array(blockCount * blockFrames * channels);
  let outFrames = 0;
  let blockOffset = 0;
  for (let block = 0; block < blockCount; block++) {
    const end = Math.min(blockOffset + wav.blockAlign, wav.data.length);
    const predictors = new Int32Array(channels);
    const indexes = new Int32Array(channels);
    const samples = Array.from({ length: channels }, () => [] as number[]);
    for (let c = 0; c < channels; c++) {
      predictors[c] = i16(wav.data, blockOffset + c * 4);
      indexes[c] = Math.min(88, wav.data[blockOffset + c * 4 + 2] ?? 0);
      samples[c]?.push(predictors[c] ?? 0);
    }
    let p = blockOffset + channels * 4;
    const payload = Math.max(0, end - p);
    if (channels === 1) {
      for (let i = 0; i < payload * 2 && (samples[0]?.length ?? 0) < blockFrames; i++) {
        const nibble = ((wav.data[p + (i >> 1)] ?? 0) >> ((i & 1) * 4)) & 15;
        const step = IMA_STEP[indexes[0] ?? 0] ?? 7;
        let diff = step >> 3;
        if (nibble & 1) diff += step >> 2;
        if (nibble & 2) diff += step >> 1;
        if (nibble & 4) diff += step;
        predictors[0] = clamp16((predictors[0] ?? 0) + (nibble & 8 ? -diff : diff));
        indexes[0] = Math.max(0, Math.min(88, (indexes[0] ?? 0) + (IMA_INDEX[nibble] ?? -1)));
        samples[0]?.push(predictors[0] ?? 0);
      }
    } else {
      // IMA stereo stores a four-byte group for each channel, repeatedly.
      let group = p;
      while (group < end && (samples[0]?.length ?? 0) < blockFrames) {
        for (let c = 0; c < channels; c++) {
          for (let j = 0; j < 4 && group + j < end && (samples[c]?.length ?? 0) < blockFrames; j++) {
            const value = wav.data[group + j] ?? 0;
            for (let half = 0; half < 2 && (samples[c]?.length ?? 0) < blockFrames; half++) {
              const nibble = (value >> (half * 4)) & 15;
              const step = IMA_STEP[indexes[c] ?? 0] ?? 7;
              let diff = step >> 3;
              if (nibble & 1) diff += step >> 2;
              if (nibble & 2) diff += step >> 1;
              if (nibble & 4) diff += step;
              predictors[c] = clamp16((predictors[c] ?? 0) + (nibble & 8 ? -diff : diff));
              indexes[c] = Math.max(0, Math.min(88, (indexes[c] ?? 0) + (IMA_INDEX[nibble] ?? -1)));
              samples[c]?.push(predictors[c] ?? 0);
            }
          }
          group += 4;
        }
      }
    }
    const frames = Math.min(blockFrames, samples[0]?.length ?? 0);
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) out[(outFrames + f) * channels + c] = (samples[c]?.[f] ?? 0) / 32768;
    }
    outFrames += frames;
    blockOffset += wav.blockAlign;
  }
  return out.subarray(0, outFrames * channels);
}

function decodeMsAdpcm(wav: WavData): Float32Array {
  const channels = wav.channels;
  const blockFrames = wav.samplesPerBlock;
  const blockCount = Math.ceil(wav.data.length / wav.blockAlign);
  const out = new Float32Array(blockCount * blockFrames * channels);
  let outFrames = 0;
  let blockOffset = 0;
  for (let block = 0; block < blockCount; block++) {
    const end = Math.min(blockOffset + wav.blockAlign, wav.data.length);
    const predictor = new Int32Array(channels);
    const delta = new Int32Array(channels);
    const s1 = new Int32Array(channels);
    const s2 = new Int32Array(channels);
    const samples = Array.from({ length: channels }, () => [] as number[]);
    let p = blockOffset;
    for (let c = 0; c < channels; c++) predictor[c] = wav.data[p++] ?? 0;
    for (let c = 0; c < channels; c++) delta[c] = Math.max(16, i16(wav.data, p + c * 2));
    p += channels * 2;
    for (let c = 0; c < channels; c++) s1[c] = i16(wav.data, p + c * 2);
    p += channels * 2;
    for (let c = 0; c < channels; c++) s2[c] = i16(wav.data, p + c * 2);
    p += channels * 2;
    for (let c = 0; c < channels; c++) samples[c]?.push(s2[c] ?? 0, s1[c] ?? 0);
    while (p < end && (samples[0]?.length ?? 0) < blockFrames) {
      const value = wav.data[p++] ?? 0;
      const nibbles = channels === 1 ? [value & 15, (value >> 4) & 15] : [(value >> 4) & 15, value & 15];
      for (let c = 0; c < channels; c++) {
        const nibble = nibbles[c] ?? 0;
        const signed = nibble < 8 ? nibble : nibble - 16;
        const coeff = MS_COEFFICIENTS[Math.min(6, predictor[c] ?? 0)] ?? MS_COEFFICIENTS[0];
        const sample = clamp16(Math.trunc(((s1[c] ?? 0) * (coeff?.[0] ?? 256) + (s2[c] ?? 0) * (coeff?.[1] ?? 0)) / 256) + signed * (delta[c] ?? 16));
        s2[c] = s1[c] ?? 0;
        s1[c] = sample;
        delta[c] = Math.max(16, Math.trunc(((MS_ADAPT[nibble] ?? 256) * (delta[c] ?? 16)) / 256));
        samples[c]?.push(sample);
      }
    }
    const frames = Math.min(blockFrames, samples[0]?.length ?? 0);
    for (let f = 0; f < frames; f++) {
      for (let c = 0; c < channels; c++) out[(outFrames + f) * channels + c] = (samples[c]?.[f] ?? 0) / 32768;
    }
    outFrames += frames;
    blockOffset += wav.blockAlign;
  }
  return out.subarray(0, outFrames * channels);
}

function resample(input: Float32Array, channels: number, inputRate: number, outputRate: number): Float32Array {
  const inputFrames = Math.floor(input.length / channels);
  const outputFrames = Math.max(1, Math.floor((inputFrames * outputRate + inputRate / 2) / inputRate));
  if (inputRate === outputRate) return input;
  const output = new Float32Array(outputFrames * channels);
  for (let frame = 0; frame < outputFrames; frame++) {
    const source = frame * inputRate / outputRate;
    const low = Math.floor(source);
    const high = Math.min(inputFrames - 1, low + 1);
    const fraction = source - low;
    for (let c = 0; c < channels; c++) {
      const a = input[Math.min(inputFrames - 1, low) * channels + c] ?? 0;
      const b = input[high * channels + c] ?? a;
      output[frame * channels + c] = a + (b - a) * fraction;
    }
  }
  return output;
}

class PcmVoice implements SourceVoice {
  readonly lengthTicks: number;
  private readonly samples: Float32Array;
  private readonly channels: number;
  private readonly rateHz: number;
  private readonly lengthFrames: number;
  private position = 0;
  private playing = false;
  private loop = false;
  private volumeValue = 100;
  private fadeFrom = 100;
  private fadeTarget = 100;
  private fadeFrames = 0;
  private fadeElapsed = 0;

  constructor(prepared: PreparedPcm) {
    this.channels = prepared.channels;
    this.rateHz = prepared.outputRateHz;
    this.samples = prepared.samples;
    this.lengthFrames = Math.floor(this.samples.length / prepared.channels);
    this.lengthTicks = Math.max(1, Math.floor((120 * prepared.sourceFrames + prepared.sourceRate) / (2 * prepared.sourceRate)));
  }

  get ended(): boolean { return !this.loop && this.lengthFrames > 0 && this.position >= this.lengthFrames; }
  start(positionTicks: number, loop: boolean): void {
    this.loop = loop;
    this.position = Math.max(0, Math.floor(positionTicks * this.rateHz / 60));
    if (this.lengthFrames > 0 && this.loop) this.position %= this.lengthFrames;
    this.playing = !this.ended;
  }
  stop(): void { this.playing = false; }
  pause(): void { this.playing = false; }
  resume(): void { this.playing = !this.ended; }
  seek(positionTicks: number): void {
    this.position = Math.max(0, Math.floor(positionTicks * this.rateHz / 60));
    if (this.loop && this.lengthFrames > 0) this.position %= this.lengthFrames;
    this.playing = !this.ended;
  }
  setLoop(loop: boolean): void { this.loop = loop; }
  setVolume(volume: number): void { this.volumeValue = Math.max(0, Math.min(100, Math.round(volume))); this.fadeFrames = 0; }
  fade(fromVolume: number, targetVolume: number, durationTicks: number): void {
    this.fadeFrom = Math.max(0, Math.min(100, Math.round(fromVolume)));
    this.fadeTarget = Math.max(0, Math.min(100, Math.round(targetVolume)));
    this.fadeElapsed = 0;
    this.fadeFrames = Math.max(0, Math.round(durationTicks * this.rateHz / 60));
    if (this.fadeFrames === 0) this.volumeValue = this.fadeTarget;
    else this.volumeValue = this.fadeFrom;
  }
  render(left: Float32Array, right: Float32Array, frames: number): void {
    left.fill(0, 0, frames);
    right.fill(0, 0, frames);
    for (let i = 0; i < frames; i++) {
      if (!this.playing || this.lengthFrames === 0 || this.ended) break;
      const sourceFrame = this.position;
      const l = this.samples[sourceFrame * this.channels] ?? 0;
      const r = this.channels === 2 ? (this.samples[sourceFrame * 2 + 1] ?? l) : l;
      const gain = this.fadeFrames > 0
        ? (this.fadeFrom + (this.fadeTarget - this.fadeFrom) * Math.min(1, this.fadeElapsed / this.fadeFrames)) / 100
        : this.volumeValue / 100;
      left[i] = l * gain;
      right[i] = r * gain;
      this.position += 1;
      if (this.fadeFrames > 0) {
        this.fadeElapsed += 1;
        if (this.fadeElapsed >= this.fadeFrames) { this.fadeFrames = 0; this.volumeValue = this.fadeTarget; }
      }
      if (this.position >= this.lengthFrames) {
        if (this.loop && this.lengthFrames > 0) this.position %= this.lengthFrames;
        else { this.position = this.lengthFrames; this.playing = false; }
      }
    }
  }
}

/**
 * Decode a WAV (PCM, IMA ADPCM or MS ADPCM) once and resample it to `outputRateHz`. Pure: the same bytes and rate always
 * give the same samples, which is what lets a worker prepare audio the host later opens (`openPrepared`) and what
 * `createPcmSource` itself uses, so the two paths cannot drift. Never throws.
 */
export function preparePcm(bytes: Uint8Array, outputRateHz: number): Result<PreparedPcm, SourceError> {
  try {
    const wav = parseWav(bytes);
    if ("code" in wav) return fail<PreparedPcm>(wav.code, wav.detail);
    const decoded = wav.format === 1 ? decodePcm(wav) : wav.format === 17 ? decodeIma(wav) : decodeMsAdpcm(wav);
    const frames = wav.frames ?? Math.floor(decoded.length / wav.channels);
    if (frames <= 0 || decoded.length === 0) return fail<PreparedPcm>("format.malformed", "WAV contains no sample frames");
    const resampled = resample(decoded, wav.channels, wav.rate, outputRateHz);
    // A tight buffer of its own: a decoder may hand back a view, and a worker transfers the whole buffer.
    const samples = resampled.byteOffset === 0 && resampled.buffer.byteLength === resampled.byteLength
      ? resampled
      : resampled.slice();
    return opened<PreparedPcm>({ kind: "pcm", channels: wav.channels, outputRateHz, samples, sourceRate: wav.rate, sourceFrames: frames });
  } catch (error) {
    return fail<PreparedPcm>("format.malformed", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Open a voice from audio `preparePcm` already made, with no decoding. The prepared rate must be the host's output rate:
 * a mismatch is an error and never a silent resample, so the caller decodes on the host instead.
 */
export function openPrepared(prepared: PreparedPcm, env: SourceEnv): Result<SourceVoice, SourceError> {
  if (prepared.outputRateHz !== env.outputRateHz) {
    return fail("source.failed", `audio was prepared at ${prepared.outputRateHz} Hz but the output runs at ${env.outputRateHz} Hz`);
  }
  return opened<SourceVoice>(new PcmVoice(prepared));
}

/** Decode WAV PCM/ADPCM into deterministic stereo/mono PCM at the requested output rate. */
export function createPcmSource(id = "pcm"): AudioSource {
  return {
    id,
    extensions: ["wav"],
    detect: (header) => header.length >= 12 && tag(header, 0) === "RIFF" && tag(header, 8) === "WAVE",
    bank: null,
    open(bytes, env) {
      const prepared = preparePcm(bytes, env.outputRateHz);
      return prepared.ok ? openPrepared(prepared.value, env) : prepared;
    },
  };
}

/** Legacy headless source retained for the null runner: exact length, intentional silence. */
export function createNullPcmSource(): AudioSource {
  return {
    id: "audio.wav",
    extensions: ["wav"],
    detect: (header) => header.length >= 12 && tag(header, 0) === "RIFF" && tag(header, 8) === "WAVE",
    bank: null,
    open(bytes, env) {
      const wav = parseWav(bytes);
      if ("code" in wav) return fail(wav.code, wav.detail);
      if (wav.format !== 1) return fail("format.unsupported", "null PCM source does not render ADPCM");
      const frames = wav.frames ?? 0;
      if (frames <= 0) return fail("format.malformed", "WAV contains no sample frames");
      return opened<SourceVoice>(new SilentVoice(Math.max(1, Math.floor((120 * frames + wav.rate) / (2 * wav.rate))), env.outputRateHz));
    },
  };
}
