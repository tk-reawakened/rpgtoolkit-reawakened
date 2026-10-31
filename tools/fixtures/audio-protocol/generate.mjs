import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isEntryPoint } from "../fetch.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "vectors.json");
const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
function wavBytes() {
  const samples = Array.from({ length: 180 }, (_, index) => 128 + Math.round(Math.sin(index * 0.23) * 96));
  return Buffer.from([
    ...ascii("RIFF"), ...u32(36 + samples.length), ...ascii("WAVE"),
    ...ascii("fmt "), ...u32(16), ...u16(1), ...u16(1), ...u32(6000), ...u32(6000), ...u16(1), ...u16(8),
    ...ascii("data"), ...u32(samples.length), ...samples,
  ]);
}
const expectedReady = (voice, lengthTicks) => ({ kind: "ready", voice, lengthTicks });
const expectedError = (voice, code, detail) => ({ kind: "error", voice, cue: null, code, detail });
const bytes = wavBytes();
const bank = { source: "bundled", id: "test", sha256: null };
const vectors = {
  schema: 1,
  protocol: "audio-protocol-v1",
  outputRateHz: 6000,
  note: "Messages use base64 for load.data in JSON. Expected events are fixed-key protocol records; PCM peak is checked only for the PCM binding.",
  vectors: [
    {
      id: "pcm-full-protocol",
      assets: { "short.wav": bytes.toString("base64") },
      script: [
        { op: "message", message: { kind: "setBank", bankKind: "soundfont", bank }, events: [] },
        { op: "message", message: { kind: "load", voice: 1, track: "music", asset: "short.wav", data: bytes.toString("base64") }, events: [expectedReady(1, 2)] },
        { op: "message", message: { kind: "setVolume", scope: "master", voice: null, bus: null, volume: 80 }, events: [] },
        { op: "message", message: { kind: "setVolume", scope: "bus", voice: null, bus: "music", volume: 90 }, events: [] },
        { op: "message", message: { kind: "setVolume", scope: "voice", voice: 1, bus: null, volume: 75 }, events: [] },
        { op: "message", message: { kind: "fade", scope: "bus", voice: null, bus: "music", fromVolume: 90, targetVolume: 60, durationTicks: 10 }, events: [] },
        { op: "message", message: { kind: "fade", scope: "voice", voice: 1, bus: null, fromVolume: 75, targetVolume: 25, durationTicks: 5 }, events: [] },
        { op: "message", message: { kind: "play", voice: 1, cue: 101, loop: false, volume: 75, positionTicks: 0 }, events: [] },
        { op: "message", message: { kind: "pause", voice: 1 }, events: [] },
        { op: "message", message: { kind: "resume", voice: 1 }, events: [] },
        { op: "message", message: { kind: "seek", voice: 1, positionTicks: 1 }, events: [] },
        { op: "message", message: { kind: "setLoop", voice: 1, loop: true }, events: [] },
        { op: "message", message: { kind: "setLoop", voice: 1, loop: false }, events: [] },
        { op: "render", frames: 100, events: [{ kind: "ended", voice: 1, cue: 101 }] },
        { op: "message", message: { kind: "stop", voice: 1 }, events: [] },
        { op: "message", message: { kind: "load", voice: 2, track: "sfx", asset: "short.wav", data: bytes.toString("base64") }, events: [expectedReady(2, 2)] },
        { op: "message", message: { kind: "play", voice: 2, cue: 202, loop: true, volume: 100, positionTicks: 0 }, events: [] },
        { op: "render", frames: 300, events: [], peakAtLeast: 0.001 },
        { op: "message", message: { kind: "stop", voice: 2 }, events: [] },
      ],
    },
    {
      id: "invalid-asset-error",
      assets: { "broken.wav": Buffer.from([1, 2, 3]).toString("base64") },
      script: [
        { op: "message", message: { kind: "load", voice: 3, track: "sfx", asset: "broken.wav", data: Buffer.from([1, 2, 3]).toString("base64") }, events: [expectedError(3, "format.unsupported", "broken.wav: no registered audio source recognises these bytes")] },
        { op: "message", message: { kind: "stop", voice: 3 }, events: [] },
      ],
    },
  ],
};
const document = `${JSON.stringify(vectors, null, 2)}\n`;
export function audioProtocolFixtureFiles() { return [["vectors.json", Buffer.from(document)]]; }
export function check() {
  if (!existsSync(output)) return [`missing ${output}`];
  return readFileSync(output).equals(Buffer.from(document)) ? [] : [`${output} differs; run node tools/fixtures/audio-protocol/generate.mjs`];
}
// Import must not write: tools/fixtures/test/audio-protocol.test.mjs calls `check()`, and a write on
// import would let it compare the file against itself and always pass.
if (isEntryPoint(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const problems = check();
    if (problems.length > 0) { console.error(problems.join("\n")); process.exitCode = 1; }
  } else {
    mkdirSync(resolve(here), { recursive: true });
    writeFileSync(output, document);
  }
}
