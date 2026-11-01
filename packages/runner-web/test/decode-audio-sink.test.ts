// The PCM sink's prepared-audio integration (issue #934, OQ3): when `readPrepared` returns a PCM prepared at the sink's
// output rate, the sink opens its voice directly with no decoding and without needing bytes from `readAsset`. When none
// is ready, or when a prepared PCM is at another rate, the sink falls back to host-side decode.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AssetKey } from "@tk-reawakened/core";
import { preparePcm } from "@tk-reawakened/synth";
import { PcmSink, type SinkEvent } from "../src/audio-sink.ts";
import type { PreparedAudio, PreparedPcm } from "../src/decode-types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const files = resolve(here, "..", "..", "core", "test", "fixtures", "audio", "files");
const wav = (name: string): Uint8Array => new Uint8Array(readFileSync(join(files, name)));

const MONO = "pcm16-mono-8000.wav";
const STEREO = "pcm16-stereo-8000.wav";
const RATE = 8_000;

test("a prepared PCM at the sink's output rate opens the voice without reading the asset", () => {
  const bytes = wav(MONO);
  const prepared = preparePcm(bytes, RATE);
  if (!prepared.ok) throw new Error(prepared.error.detail);

  let assetReads = 0;
  const events: SinkEvent[] = [];
  const sink = new PcmSink({
    readAsset: () => { assetReads += 1; return null; },
    readPrepared: (asset) => (asset === "media/sound.wav" ? prepared.value : null),
    outputRateHz: RATE,
    onEvent: (event) => events.push(event),
  });

  sink.handle({ kind: "load", voice: 1, track: "sfx", asset: "media/sound.wav" as AssetKey, data: new Uint8Array(0) });
  equal(assetReads, 0, "readAsset was not called");
  deepEqual(events, [{ kind: "ready", voice: 1, lengthTicks: 15 }]);

  sink.handle({ kind: "play", voice: 1, cue: 1, loop: false, volume: 100, positionTicks: 0 });
  const frames = 1_000;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  sink.render(left, right, frames);
  ok(PcmSink.energy(left, frames) > 0, "the prepared voice makes sound");
});

test("a prepared PCM at a different rate falls back to host decode via readAsset", () => {
  const bytes = wav(STEREO);
  // Prepared at 44.1 kHz, but the sink runs at 8 kHz.
  const prepared = preparePcm(bytes, 44_100);
  if (!prepared.ok) throw new Error(prepared.error.detail);

  let assetReads = 0;
  const events: SinkEvent[] = [];
  const sink = new PcmSink({
    readAsset: () => { assetReads += 1; return bytes; },
    readPrepared: () => prepared.value,
    outputRateHz: RATE,
    onEvent: (event) => events.push(event),
  });

  sink.handle({ kind: "load", voice: 2, track: "bgm", asset: "media/stereo.wav" as AssetKey, data: new Uint8Array(0) });
  equal(assetReads, 1, "the sink decoded on the host instead of using mismatched prepared rate");
  equal(events.length, 1);
  equal(events[0]?.kind, "ready");
  if (events[0]?.kind === "ready") equal(events[0].voice, 2);
});

test("when readPrepared returns null, host decode proceeds as before", () => {
  const bytes = wav(MONO);
  let assetReads = 0;
  const events: SinkEvent[] = [];
  const sink = new PcmSink({
    readAsset: () => { assetReads += 1; return bytes; },
    readPrepared: () => null,
    outputRateHz: RATE,
    onEvent: (event) => events.push(event),
  });

  sink.handle({ kind: "load", voice: 3, track: "sfx", asset: "media/mono.wav" as AssetKey, data: new Uint8Array(0) });
  equal(assetReads, 1);
  deepEqual(events, [{ kind: "ready", voice: 3, lengthTicks: 15 }]);
});

test("advisory prepared MIDI does not replace host MIDI loading", () => {
  const advisoryMidi: PreparedAudio = { kind: "midi", lengthTicks: 120 };
  let assetReads = 0;
  const sink = new PcmSink({
    readAsset: () => { assetReads += 1; return null; },
    readPrepared: () => advisoryMidi,
    outputRateHz: RATE,
  });

  // Since readAsset returns null and data is empty, it fails with source.failed as normal.
  const events: SinkEvent[] = [];
  sink.handle({ kind: "load", voice: 4, track: "music", asset: "media/song.mid" as AssetKey, data: new Uint8Array(0) });
  equal(assetReads, 1, "MIDI is not opened from prepared PCM; host reads bytes");
});
