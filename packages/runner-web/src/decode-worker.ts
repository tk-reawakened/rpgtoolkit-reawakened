/**
 * The decode-ahead worker (issue #934, OQ3): a classic-script IIFE bundle (`apps/decode-worker.js`, no runtime `import()`)
 * that turns bytes into prepared assets and posts them back.
 *
 * It runs only **pure** functions of bytes, the same ones the host thread uses: `decodeAssetTexture` for images,
 * `preparePcm` for WAV/ADPCM, `midiLengthTicks` for MIDI, `validateBankBytes` + `sha256Hex` for SoundFonts. It touches no
 * DOM, no timers, no storage and no bank cache; a job's result is a function of its bytes alone, so the host's own
 * decode and this one are identical. A format it cannot prepare is a named gap in the reply, never a silent drop.
 *
 * `prepareJob` is the whole behaviour and is exported for tests; the module only listens for messages when it is
 * actually running as a worker.
 */

import type { AssetKey, DecodedTexture } from "@tk-reawakened/core";
import { decodeAssetTexture } from "@tk-reawakened/runner-harness";
import { BankError, midiLengthTicks, preparePcm, sha256Hex, validateBankBytes } from "@tk-reawakened/synth";
import type { DecodeJob, DecodeReply, PrepareKind } from "./decode-types.ts";

/** One reply and the buffers it carries, which the caller transfers rather than copies. */
export type PreparedJob = { readonly reply: DecodeReply; readonly transfer: readonly ArrayBuffer[] };

/** The image decoder a job runs; the host's own `decodeAssetTexture` unless a test swaps it. */
export type ImageDecoder = (key: AssetKey, bytes: Uint8Array) => DecodedTexture | null;

const unsupported = (id: number, what: string): PreparedJob => ({
  reply: { type: "gap", id, reason: `unsupported: ${what}`, failed: false },
  transfer: [],
});

const failed = (id: number, what: string): PreparedJob => ({
  reply: { type: "gap", id, reason: `failed: ${what}`, failed: true },
  transfer: [],
});

/** A buffer holding exactly these bytes and nothing else, so transferring it moves no neighbouring data. */
function tight(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.byteLength ? bytes : bytes.slice();
}

function prepareImage(job: DecodeJob, bytes: Uint8Array, decode: ImageDecoder): PreparedJob {
  const decoded = decode(job.key, bytes);
  if (decoded === null) {
    if (job.key.endsWith(".tan") || job.key.endsWith(".tbm")) {
      return unsupported(job.id, `${job.key} is composed on the host from other assets (animated tiles and tile bitmaps)`);
    }
    return unsupported(job.id, `no pure image decoder covers ${job.key}, or its bytes did not decode`);
  }
  const rgba = tight(decoded.rgba);
  return {
    reply: { type: "image", id: job.id, pixels: { w: decoded.w, h: decoded.h, rgba } },
    transfer: [rgba.buffer as ArrayBuffer],
  };
}

function prepareAudio(job: DecodeJob, bytes: Uint8Array): PreparedJob {
  const prepared = preparePcm(bytes, job.outputRateHz);
  if (prepared.ok) {
    return { reply: { type: "audio", id: job.id, audio: prepared.value }, transfer: [prepared.value.samples.buffer as ArrayBuffer] };
  }
  const { code, detail } = prepared.error;
  return code === "format.unsupported" ? unsupported(job.id, `${job.key}: ${detail}`) : failed(job.id, `${job.key}: ${code}: ${detail}`);
}

function prepareMidi(job: DecodeJob, bytes: Uint8Array): PreparedJob {
  const length = midiLengthTicks(bytes);
  if (length.ok) return { reply: { type: "audio", id: job.id, audio: { kind: "midi", lengthTicks: length.value } }, transfer: [] };
  const { code, detail } = length.error;
  return code === "format.unsupported" ? unsupported(job.id, `${job.key}: ${detail}`) : failed(job.id, `${job.key}: ${code}: ${detail}`);
}

function prepareSoundFont(job: DecodeJob, bytes: Uint8Array): PreparedJob {
  try {
    validateBankBytes(bytes);
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    // Over the runner's size ceiling is a limit of this runner; anything else is a bank that does not validate.
    return error.code === "bank.unavailable"
      ? unsupported(job.id, `${job.key}: ${error.message}`)
      : failed(job.id, `${job.key}: ${error.code}: ${error.message}`);
  }
  return { reply: { type: "audio", id: job.id, audio: { kind: "soundfont", sha256: sha256Hex(bytes), size: bytes.length } }, transfer: [] };
}

/** Prepare one job. Never throws: a decoder that does becomes a `failed:` gap in the reply. */
export function prepareJob(job: DecodeJob, decodeImage: ImageDecoder = decodeAssetTexture): PreparedJob {
  const bytes = new Uint8Array(job.bytes);
  const kind: PrepareKind = job.kind;
  try {
    switch (kind) {
      case "image": return prepareImage(job, bytes, decodeImage);
      case "audio": return prepareAudio(job, bytes);
      case "midi": return prepareMidi(job, bytes);
      case "soundfont": return prepareSoundFont(job, bytes);
      default: return unsupported(job.id, `${job.key}: there is no preparer for kind ${String(kind)}`);
    }
  } catch (error) {
    return failed(job.id, `${job.key}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The part of a dedicated worker's global scope this file uses; the page's DOM typings do not describe it. */
type WorkerScope = {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

function isJob(data: unknown): data is DecodeJob {
  if (typeof data !== "object" || data === null) return false;
  return "type" in data && data.type === "job"
    && "id" in data && typeof data.id === "number"
    && "key" in data && typeof data.key === "string"
    && "kind" in data && typeof data.kind === "string"
    && "outputRateHz" in data && typeof data.outputRateHz === "number"
    && "bytes" in data && data.bytes instanceof ArrayBuffer;
}

// Listen only inside a real worker, so a test (or a page bundle) can import `prepareJob` without side effects.
if ("WorkerGlobalScope" in globalThis) {
  const scope = globalThis as unknown as WorkerScope;
  scope.onmessage = (event): void => {
    if (!isJob(event.data)) return;
    const { reply, transfer } = prepareJob(event.data);
    scope.postMessage(reply, [...transfer]);
  };
}
