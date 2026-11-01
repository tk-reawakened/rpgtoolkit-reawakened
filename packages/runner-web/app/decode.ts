/**
 * The decode lane's page: the real decode worker bundle (`apps/decode-worker.js`) spawned as a real `Worker`, and every
 * result compared with what the host thread makes from the same bytes (issue #934, OQ3). Driven by Playwright
 * (tools/browser/tests/decode.spec.ts); it plays no game.
 *
 * What is compared is the acceptance itself: an image the worker decoded has the host decoder's pixels, a WAV the worker
 * prepared has the samples (and renders the frames, and reports the length) of the host's own `createPcmSource` voice, a
 * MIDI has the host's length, a SoundFont the host's SHA-256, and every format the worker cannot prepare is a named gap.
 */

import type { AssetKey } from "@tk-reawakened/core";
import { decodeAssetTexture } from "@tk-reawakened/runner-harness";
import { createPcmSource, midiLengthTicks, openPrepared, preparePcm, sha256Hex, type SourceVoice } from "@tk-reawakened/synth";
import { PcmSink, type SinkEvent } from "../src/audio-sink.ts";
import { createDecodeAhead, DecodeAheadError } from "../src/decode-ahead.ts";
import type { DecodeAhead, DecodeStats, PreparedAudio } from "../src/decode-types.ts";

type ImageResult = {
  readonly key: string;
  readonly ready: boolean;
  readonly w: number | null;
  readonly h: number | null;
  readonly samePixels: boolean;
};

type AudioResult = {
  readonly key: string;
  readonly rateHz: number;
  readonly ready: boolean;
  readonly channels: number | null;
  readonly sameSamples: boolean;
  readonly sameRender: boolean;
  readonly hostLengthTicks: number | null;
  readonly workerLengthTicks: number | null;
  /** A sink with no way to read the asset and no bytes in its `load` still opened the voice, at this length. */
  readonly sinkReadyTicks: number | null;
};

type DecodeReport = {
  readonly images: readonly ImageResult[];
  readonly audio: readonly AudioResult[];
  readonly midi: readonly { readonly key: string; readonly workerTicks: number | null; readonly hostTicks: number | null }[];
  readonly soundfont: { readonly workerSha: string | null; readonly hostSha: string; readonly workerSize: number | null; readonly hostSize: number };
  readonly stats: DecodeStats;
  /** Every caller buffer was still intact (not detached by a transfer) after `prepare`. */
  readonly callerBytesIntact: boolean;
  readonly afterClose: { readonly imageNull: boolean; readonly audioNull: boolean; readonly prepareThrows: boolean };
  /** A worker script that cannot load: the job fails by name instead of hanging. */
  readonly missingWorker: { readonly stats: DecodeStats };
  readonly spawnFailureThrows: boolean;
};

declare global {
  interface Window {
    __decode?: DecodeReport | { readonly error: string };
  }
}

const AUDIO_ROOT = "packages/core/test/fixtures/audio/files";
const AUTHORED = "packages/core/test/fixtures/authored";
const IMAGES = ["media/icons/png/tkr-64.png", `${AUTHORED}/detail4.tst`, `${AUTHORED}/bmp-rgb24.bmp`, `${AUTHORED}/gif-still87a.gif`];
const WAVS = [
  "pcm16-mono-8000.wav",
  "pcm16-stereo-8000.wav",
  "pcm8-mono-8000.wav",
  "ima-adpcm-mono-8000.wav",
  "ima-adpcm-stereo-8000.wav",
  "msadpcm-mono-8000.wav",
];
const MIDIS = ["midi0-480-default-tempo.mid", "midi1-240-tempo-map.mid"];
const BANK = "media/soundfonts/TK-16.sf2";
const RENDER_FRAMES = 2_048;

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`decode: ${path} is not served (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Bit-for-bit equal, so a NaN or a signed zero that differed would show. */
function sameFloats(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (!Object.is(a[index], b[index])) return false;
  return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function render(voice: SourceVoice): { readonly left: Float32Array; readonly right: Float32Array } {
  const left = new Float32Array(RENDER_FRAMES);
  const right = new Float32Array(RENDER_FRAMES);
  voice.setVolume(100);
  voice.start(0, true);
  voice.render(left, right, RENDER_FRAMES);
  return { left, right };
}

function pcm(audio: PreparedAudio | null): Extract<PreparedAudio, { kind: "pcm" }> | null {
  return audio !== null && audio.kind === "pcm" ? audio : null;
}

async function audioAt(rateHz: number, files: ReadonlyMap<string, Uint8Array>, intact: boolean[]): Promise<AudioResult[]> {
  const ahead = createDecodeAhead({ outputRateHz: rateHz });
  for (const [key, bytes] of files) {
    const before = bytes.byteLength;
    ahead.prepare(key as AssetKey, bytes, "audio");
    intact.push(bytes.byteLength === before && before > 0);
  }
  await ahead.settled();
  const results: AudioResult[] = [];
  for (const [key, bytes] of files) {
    const prepared = pcm(ahead.audio(key as AssetKey));
    const host = createPcmSource().open(bytes, { outputRateHz: rateHz, bank: null });
    const hostPrepared = preparePcm(bytes, rateHz);
    let sameSamples = false;
    let sameRender = false;
    let workerLengthTicks: number | null = null;
    if (prepared !== null && host.ok && hostPrepared.ok) {
      sameSamples = prepared.channels === hostPrepared.value.channels && sameFloats(prepared.samples, hostPrepared.value.samples);
      const opened = openPrepared(prepared, { outputRateHz: rateHz, bank: null });
      if (opened.ok) {
        workerLengthTicks = opened.value.lengthTicks;
        const a = render(host.value);
        const b = render(opened.value);
        sameRender = sameFloats(a.left, b.left) && sameFloats(a.right, b.right);
      }
    }
    // A sink that cannot read the asset and is handed no bytes can only have opened this voice from the prepared PCM.
    let sinkReadyTicks: number | null = null;
    const sink = new PcmSink({
      readAsset: () => null,
      readPrepared: (asset) => ahead.audio(asset),
      outputRateHz: rateHz,
      onEvent: (event: SinkEvent) => { if (event.kind === "ready") sinkReadyTicks = event.lengthTicks; },
    });
    sink.handle({ kind: "load", voice: 1, track: "sfx", asset: key as AssetKey, data: new Uint8Array(0) });
    results.push({
      key,
      rateHz,
      ready: prepared !== null,
      channels: prepared?.channels ?? null,
      sameSamples,
      sameRender,
      hostLengthTicks: host.ok ? host.value.lengthTicks : null,
      workerLengthTicks,
      sinkReadyTicks,
    });
  }
  ahead.close();
  return results;
}

async function main(): Promise<DecodeReport> {
  const intact: boolean[] = [];
  const ahead: DecodeAhead = createDecodeAhead({ outputRateHz: 44_100 });

  const imageBytes = new Map<string, Uint8Array>();
  for (const key of IMAGES) imageBytes.set(key, await fetchBytes(key));
  const wavBytes = new Map<string, Uint8Array>();
  for (const name of WAVS) wavBytes.set(`media/${name}`, await fetchBytes(`${AUDIO_ROOT}/${name}`));
  const midiBytes = new Map<string, Uint8Array>();
  for (const name of MIDIS) midiBytes.set(`media/${name}`, await fetchBytes(`${AUDIO_ROOT}/${name}`));
  const bankBytes = await fetchBytes(BANK);

  // Formats the worker cannot prepare, and bytes it can but that do not decode: each must be a named gap.
  const smpte = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28]); // MThd, SMPTE division
  const unpreparable: readonly [string, Uint8Array, "image" | "audio" | "midi" | "soundfont"][] = [
    ["gaps/animation.tan", new Uint8Array(32), "image"],
    ["gaps/broken.png", new Uint8Array([1, 2, 3, 4]), "image"],
    ["gaps/song.ogg", new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]), "audio"],
    ["gaps/broken.wav", new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d]), "audio"],
    ["gaps/smpte.mid", smpte, "midi"],
    ["gaps/not-a-bank.sf2", wavBytes.get(`media/${WAVS[0]}`) ?? new Uint8Array(0), "soundfont"],
  ];

  for (const [key, bytes] of imageBytes) {
    const before = bytes.byteLength;
    ahead.prepare(key as AssetKey, bytes, "image");
    intact.push(bytes.byteLength === before && before > 0);
  }
  for (const [key, bytes] of midiBytes) ahead.prepare(key as AssetKey, bytes, "midi");
  ahead.prepare(BANK as AssetKey, bankBytes, "soundfont");
  intact.push(bankBytes.byteLength > 0);
  for (const [key, bytes, kind] of unpreparable) ahead.prepare(key as AssetKey, bytes, kind);
  // A repeat is a no-op: it must not queue a second job.
  ahead.prepare(IMAGES[0] as AssetKey, imageBytes.get(IMAGES[0] as string) ?? new Uint8Array(0), "image");
  await ahead.settled();

  const images: ImageResult[] = [];
  for (const [key, bytes] of imageBytes) {
    const worker = ahead.image(key as AssetKey);
    const host = decodeAssetTexture(key as AssetKey, bytes);
    images.push({
      key,
      ready: worker !== null,
      w: worker?.w ?? null,
      h: worker?.h ?? null,
      samePixels: worker !== null && host !== null && worker.w === host.w && worker.h === host.h && sameBytes(worker.rgba, host.rgba),
    });
  }

  const midi = [...midiBytes].map(([key, bytes]) => {
    const prepared = ahead.audio(key as AssetKey);
    const host = midiLengthTicks(bytes);
    return {
      key,
      workerTicks: prepared !== null && prepared.kind === "midi" ? prepared.lengthTicks : null,
      hostTicks: host.ok ? host.value : null,
    };
  });
  const bank = ahead.audio(BANK as AssetKey);

  const stats = ahead.stats();
  ahead.close();
  let prepareThrows = false;
  try {
    ahead.prepare("late.png" as AssetKey, new Uint8Array(4), "image");
  } catch {
    prepareThrows = true;
  }

  const audio = [...await audioAt(44_100, wavBytes, intact), ...await audioAt(8_000, wavBytes, intact)];

  const missing = createDecodeAhead({ outputRateHz: 44_100, workerUrl: "/apps/no-such-worker.js" });
  missing.prepare("a.png" as AssetKey, imageBytes.get(IMAGES[0] as string) ?? new Uint8Array(0), "image");
  await missing.settled();
  const missingStats = missing.stats();
  missing.close();

  let spawnFailureThrows = false;
  try {
    createDecodeAhead({ outputRateHz: 44_100, spawn: () => { throw new Error("no workers here"); } });
  } catch (error) {
    spawnFailureThrows = error instanceof DecodeAheadError;
  }

  return {
    images,
    audio,
    midi,
    soundfont: {
      workerSha: bank !== null && bank.kind === "soundfont" ? bank.sha256 : null,
      hostSha: sha256Hex(bankBytes),
      workerSize: bank !== null && bank.kind === "soundfont" ? bank.size : null,
      hostSize: bankBytes.length,
    },
    stats,
    callerBytesIntact: intact.every(Boolean),
    afterClose: { imageNull: ahead.image(IMAGES[0] as AssetKey) === null, audioNull: ahead.audio(BANK as AssetKey) === null, prepareThrows },
    missingWorker: { stats: missingStats },
    spawnFailureThrows,
  };
}

main().then(
  (report) => {
    window.__decode = report;
    document.title = "decode ready";
  },
  (cause: unknown) => {
    window.__decode = { error: cause instanceof Error ? cause.message : String(cause) };
    document.title = "decode failed";
  },
);
