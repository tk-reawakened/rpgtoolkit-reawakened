import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadPackage } from "@tk-reawakened/core";
import { findProbeMedia } from "./probe-media.mjs";
import { matchesNegativeLanes, negativeCaptureSeconds } from "./negative-oracle.mjs";
import { loopLandmarks, matchesLoop, matchesOverlap, mixContribution } from "./waveform-oracles.mjs";

// Opt-in destructive-input runs use the same positive assertions; by design, each exits nonzero.
const perturb = process.env.TKR_AUDIO_GUARD_PERTURB;
const rate = 1000;
const stereo = (samples) => Float32Array.from({ length: samples.length * 2 }, (_, i) => samples[Math.floor(i / 2)]).buffer;

function reference() {
  return Float32Array.from({ length: 2 * rate }, (_, frame) => {
    if (frame < 250 || frame >= 1750) return 0;
    if (frame === 500) return 0.7;
    return Math.sin(frame * 0.31) * 0.2;
  });
}

test("loop guard requires the repeated PCM landmark and its correct period", () => {
  const authored = reference(), rendered = new Float32Array(3400);
  rendered.set(authored);
  if (perturb !== "removed-loop") rendered.set(authored.subarray(0, 1400), 2000);
  const capture = { data: stereo(rendered), frames: rendered.length, startFrame: 0 };
  const evidence = loopLandmarks(capture, capture, 0, 0, authored.length, rate);
  assert.ok(matchesLoop(evidence, 1), "repeat landmark/period and the authored silence are required even if correlation is green");

  const delayed = new Float32Array(rendered.length);
  delayed.set(authored);
  delayed.set(authored.subarray(0, 1375), 2025);
  const delayedCapture = { ...capture, data: stereo(delayed) };
  assert.equal(loopLandmarks(delayedCapture, delayedCapture, 0, 0, authored.length, rate).frameError, 25);
  assert.equal(matchesLoop(loopLandmarks(delayedCapture, delayedCapture, 0, 0, authored.length, rate), 1), false);
});

test("overlap guard requires both PCM voices even if both play markers remain", () => {
  const authored = reference(), frames = 1450;
  const solo = { data: stereo(authored), frames: authored.length, startFrame: 0 };
  const capture = {
    frames, startFrame: 3400, starts: [{ cue: 1, voice: 1, frame: 0 }, { cue: 2, voice: 2, frame: 3400 }],
    seeks: [{ voice: 1, frame: 3400, positionTicks: 45 }],
  };
  const simulate = (legs) => stereo(Float32Array.from({ length: frames }, (_, i) => (
    (legs.includes("music") ? authored[(750 + i) % authored.length] : 0)
    + (legs.includes("effect") ? authored[i] : 0)
  )));
  const output = simulate(perturb === "muted-voice" ? ["music"] : ["music", "effect"]);
  assert.ok(matchesOverlap(mixContribution({ ...capture, data: output }, solo, rate)), "captured output must include both distinct voices");
  for (const only of [["music"], ["effect"], []]) {
    assert.equal(matchesOverlap(mixContribution({ ...capture, data: simulate(only) }, solo, rate)), false);
  }
});

test("negative oracle cannot pass if its page omits or duplicates a negative lane", () => {
  const evidence = {
    nativeRejectsMalformed: true, missingAssetNotInMediaIndex: true,
    diagnostics: ["source.failed", "format.malformed", "format.unsupported", "source.failed"].map((code, i) => ({
      voice: 102 + i, codes: [code, "protocol.state"], framesAfterPlay: rate * negativeCaptureSeconds, peak: 0,
    })),
  };
  const positive = perturb === "missing-negative-lane" ? { ...evidence, diagnostics: evidence.diagnostics.slice(1) } : evidence;
  assert.ok(matchesNegativeLanes(positive, rate), "all four designated negative playback lanes must run");
  assert.equal(matchesNegativeLanes({ ...evidence, diagnostics: [] }, rate), false);
  assert.equal(matchesNegativeLanes({ ...evidence, diagnostics: [evidence.diagnostics[0], ...evidence.diagnostics.slice(0, 3)] }, rate), false);
});

test("negative silence guard rejects the former short window and delayed waveform leakage", () => {
  const source = reference(), frames = Math.round(rate * negativeCaptureSeconds);
  const peak = (length) => source.subarray(0, length).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const evidence = {
    nativeRejectsMalformed: true, missingAssetNotInMediaIndex: true,
    diagnostics: ["source.failed", "format.malformed", "format.unsupported", "source.failed"].map((code, i) => ({
      voice: 102 + i, codes: [code, "protocol.state"], framesAfterPlay: frames, peak: 0,
    })),
  };
  const withLeak = (lane) => ({ ...evidence, diagnostics: [...evidence.diagnostics.slice(0, 3), { ...evidence.diagnostics[3], ...lane }] });
  const oldWindow = withLeak({ framesAfterPlay: rate / 5, peak: peak(rate / 5) });
  const leaked = withLeak({ peak: peak(frames) });
  assert.equal(oldWindow.diagnostics[3].peak, 0);
  assert.ok(leaked.diagnostics[3].peak > 0.5);
  const positive = perturb === "early-silence" ? oldWindow : perturb === "leaked-negative-audio" ? leaked : evidence;
  assert.ok(matchesNegativeLanes(positive, rate), "every silent window must reach the authored impulse and reject audible leakage");
  assert.equal(matchesNegativeLanes(oldWindow, rate), false);
  assert.equal(matchesNegativeLanes(leaked, rate), false);
});

test("media lookup guard requires the canonical TPK asset key and exact returned bytes", () => {
  const url = new URL("../../../artifacts/runtime-audio/runtime-audio.tpk", import.meta.url);
  const bytes = new Uint8Array(readFileSync(url));
  const loaded = loadPackage({ kind: "tpk", name: "runtime-audio.tpk", bytes });
  assert.ok(loaded.ok);
  const found = findProbeMedia(loaded.value, perturb === "invalid-lookup" ? "absent.opus.ogg" : "SHORT.opus.ogg");
  assert.ok(found, "the expected authored media reference must resolve through the game's index");
  assert.equal(found.key, "media/short.opus.ogg");
  assert.equal(found.path, "Media/short.opus.ogg");
  assert.deepEqual(Buffer.from(found.bytes), readFileSync(new URL("./fixtures/short.opus.ogg", url)));
  assert.equal(findProbeMedia(loaded.value, "absent.opus.ogg"), null);
});
