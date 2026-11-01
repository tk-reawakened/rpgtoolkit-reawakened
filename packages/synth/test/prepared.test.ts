// The pure PCM preparation seam (issue #934, OQ3): `preparePcm` is what a decode worker runs, `openPrepared` is what the
// host's sink opens a voice from, and `createPcmSource.open` is built from exactly the same two. These tests pin that a
// worker-prepared voice and a host-decoded voice are the same voice, on every WAV codec the runner plays.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createPcmSource, openPrepared, preparePcm } from "../src/pcm.ts";
import type { SourceVoice } from "../src/source.ts";

const files = join(dirname(fileURLToPath(import.meta.url)), "../../core/test/fixtures/audio/files");
const wav = (name: string): Uint8Array => new Uint8Array(readFileSync(join(files, name)));

/** One fixture per codec, mono and stereo where the kit has both; the files are 8 kHz. */
const CODECS = [
  ["PCM16 mono", "pcm16-mono-8000.wav"],
  ["PCM16 stereo", "pcm16-stereo-8000.wav"],
  ["PCM8 mono", "pcm8-mono-8000.wav"],
  ["IMA ADPCM mono", "ima-adpcm-mono-8000.wav"],
  ["IMA ADPCM stereo", "ima-adpcm-stereo-8000.wav"],
  ["MS ADPCM mono", "msadpcm-mono-8000.wav"],
  ["MS ADPCM mono with fact", "msadpcm-mono-8000-fact.wav"],
] as const;

/** 8 kHz is the files' own rate (no resample); 44.1 kHz and 22.05 kHz force the resampler. */
const RATES = [8_000, 22_050, 44_100] as const;

const FRAMES = 1_024;

function pull(voice: SourceVoice): { readonly left: Float32Array; readonly right: Float32Array } {
  const left = new Float32Array(FRAMES);
  const right = new Float32Array(FRAMES);
  voice.start(0, false);
  voice.render(left, right, FRAMES);
  return { left, right };
}

function sameBits(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

for (const [label, name] of CODECS) {
  for (const rate of RATES) {
    test(`${label} at ${rate} Hz: a prepared voice has the host-decoded voice's length and samples`, () => {
      const bytes = wav(name);
      const env = { outputRateHz: rate, bank: null };
      const host = createPcmSource().open(bytes, env);
      const prepared = preparePcm(bytes, rate);
      if (!host.ok || !prepared.ok) throw new Error(`${name} did not open: ${JSON.stringify([host, prepared])}`);

      // Preparing twice gives the same samples: it is a pure function of the bytes and the rate.
      const again = preparePcm(bytes, rate);
      ok(again.ok && sameBits(again.value.samples, prepared.value.samples));

      const opened = openPrepared(prepared.value, env);
      if (!opened.ok) throw new Error(`${name} did not open from its prepared form: ${opened.error.detail}`);
      equal(opened.value.lengthTicks, host.value.lengthTicks);

      const a = pull(host.value);
      const b = pull(opened.value);
      ok(sameBits(a.left, b.left), "left channel is bit-identical");
      ok(sameBits(a.right, b.right), "right channel is bit-identical");
      ok(a.left.some((value) => value !== 0), "the fixture is audible, so equality is not two silences");
    });
  }
}

test("the preparation is described by the file and the rate, and owns a tight buffer a worker can transfer", () => {
  for (const [, name] of CODECS) {
    const prepared = preparePcm(wav(name), 44_100);
    if (!prepared.ok) throw new Error(`${name}: ${prepared.error.detail}`);
    equal(prepared.value.kind, "pcm");
    equal(prepared.value.outputRateHz, 44_100);
    equal(prepared.value.sourceRate, 8_000);
    equal(prepared.value.samples.byteOffset, 0);
    equal(prepared.value.samples.buffer.byteLength, prepared.value.samples.byteLength);
    equal(prepared.value.samples.length % prepared.value.channels, 0);
  }
});

test("at the file's own rate the samples are the file's own, independently decoded: PCM16 is the int16 data over 32768", () => {
  const bytes = wav("pcm16-mono-8000.wav");
  const prepared = preparePcm(bytes, 8_000);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  // The authored file is a canonical 44-byte header followed by the data chunk.
  const data = new DataView(bytes.buffer, bytes.byteOffset + 44, bytes.byteLength - 44);
  equal(prepared.value.sourceFrames, 2_000);
  equal(prepared.value.samples.length, 2_000);
  const expected = new Float32Array(2_000);
  for (let index = 0; index < expected.length; index += 1) expected[index] = data.getInt16(index * 2, true) / 32768;
  ok(sameBits(prepared.value.samples, expected));
});

test("a failure is the same failure on both paths, and is never thrown", () => {
  const notWav = new Uint8Array(32);
  const truncated = wav("pcm16-mono-8000.wav").slice(0, 30);
  const env = { outputRateHz: 8_000, bank: null };
  for (const bytes of [notWav, truncated, new Uint8Array(0)]) {
    const host = createPcmSource().open(bytes, env);
    const prepared = preparePcm(bytes, 8_000);
    ok(!host.ok && !prepared.ok);
    if (!host.ok && !prepared.ok) deepEqual(host.error, prepared.error);
  }
  const notWavResult = preparePcm(notWav, 8_000);
  ok(!notWavResult.ok && notWavResult.error.code === "format.unsupported");
});

test("a prepared voice is never silently resampled to another output rate", () => {
  const prepared = preparePcm(wav("pcm16-mono-8000.wav"), 44_100);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const opened = openPrepared(prepared.value, { outputRateHz: 48_000, bank: null });
  ok(!opened.ok);
  if (!opened.ok) equal(opened.error.code, "source.failed");
});

test("voices opened from one prepared value share its samples without altering them", () => {
  const prepared = preparePcm(wav("pcm16-mono-8000.wav"), 8_000);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const before = prepared.value.samples.slice();
  const env = { outputRateHz: 8_000, bank: null };
  const first = openPrepared(prepared.value, env);
  const second = openPrepared(prepared.value, env);
  if (!first.ok || !second.ok) throw new Error("open failed");
  first.value.fade(100, 0, 10);
  pull(first.value);
  const untouched = pull(second.value);
  ok(sameBits(prepared.value.samples, before), "rendering a voice does not write its samples");
  ok(untouched.left.some((value) => value !== 0), "the second voice plays at full volume");
});
