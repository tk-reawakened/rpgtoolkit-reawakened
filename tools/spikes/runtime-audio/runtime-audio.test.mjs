import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createAudioRuntime, createGameState } from "@tk-reawakened/core";
import { inspectOggOpus } from "./fixtures.mjs";
import { wavInfo, wavTicks } from "../../fixtures/audio/length.mjs";

// Use runner-web's existing dependency; this spike adds no root dependency.
const resolveSynth = createRequire(import.meta.resolve("@tk-reawakened/runner-web")).resolve;
const { CuePlayer, openPrepared } = await import(pathToFileURL(resolveSynth("@tk-reawakened/synth")).href);

const here = dirname(fileURLToPath(import.meta.url));
const files = join(here, "../../../packages/core/test/fixtures/audio/files");
function checkedRawPage(flags, granule, seq, laces, body) {
  const header = Buffer.alloc(27 + laces.length);
  header.write("OggS", 0); header[4] = 0; header[5] = flags; header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(7, 14); header.writeUInt32LE(seq, 18); header[26] = laces.length;
  laces.forEach((length, index) => { header[27 + index] = length; });
  const bytes = Buffer.concat([header, body]);
  bytes.writeUInt32LE(crc(bytes), 22);
  return bytes;
}
function crc(bytes) {
  let value = 0;
  for (const byte of bytes) {
    value ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) value = (value & 0x80000000) ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0;
  }
  return value >>> 0;
}
const checkedPage = (flags, gp, seq, packets) => checkedRawPage(
  flags, gp, seq, packets.flatMap((packet) => [...Array(Math.floor(packet.length / 255)).fill(255), packet.length % 255]), Buffer.concat(packets),
);
function headerPackets({ mapping = 0, channels = 2, preSkip = 312 } = {}) {
  const head = Buffer.alloc(19);
  head.write("OpusHead"); head[8] = 1; head[9] = channels; head.writeUInt16LE(preSkip, 10); head.writeUInt32LE(48000, 12); head[18] = mapping;
  const tags = Buffer.concat([Buffer.from("OpusTags"), Buffer.alloc(8)]);
  return { head, tags };
}
function stream({ mapping = 0, channels = 2, preSkip = 312, audio = [{ bytes: [0x98], samples: 960 }], trim = 0 } = {}) {
  const { head, tags } = headerPackets({ mapping, channels, preSkip });
  const pages = [checkedPage(2, 0, 0, [head]), checkedPage(0, 0, 1, [tags])];
  let samples = 0;
  audio.forEach((packet, index) => {
    samples += packet.samples;
    const eos = index === audio.length - 1;
    pages.push(checkedPage(eos ? 4 : 0, eos ? samples - trim : samples, index + 2, [Buffer.from(packet.bytes)]));
  });
  return Buffer.concat(pages);
}
const valid = stream();
const packetStream = (bytes, samples) => stream({ audio: [{ bytes, samples }] });

test("Ogg Opus oracle applies pre-skip, enforces header placement and accepts partial and full final-packet trims at 48 kHz", () => {
  const info = inspectOggOpus(valid);
  assert.equal(info.playable48kFrames, 648);
  assert.equal(info.audioPackets, 1);
  assert.equal(info.packetSamples48k, 960);
  assert.equal(info.pages, 3);
  assert.deepEqual(info.pageGranules, [0, 0, 960]);
  assert.equal(info.playable48kFrames / 48000, 648 / 48000);
  assert.equal(info.playable48kFrames * 44100 / 48000, 595.35);

  const twoPackets = [{ bytes: [0x98], samples: 960 }, { bytes: [0x98], samples: 960 }];
  const partial = inspectOggOpus(stream({ audio: twoPackets, trim: 100 }));
  assert.equal(partial.packetSamples48k, 1920);
  assert.equal(partial.eosGranule, 1820);
  assert.equal(partial.playable48kFrames, 1508);

  const full = inspectOggOpus(stream({ audio: twoPackets, trim: 960 }));
  assert.equal(full.eosGranule, 960);
  assert.equal(full.playable48kFrames, 648);
  assert.throws(() => inspectOggOpus(stream({ audio: twoPackets, trim: 961 })), /granule|trim/);
});

test("Ogg Opus oracle rejects malformed pages, misplaced headers, bad CRC and invalid packet framing", () => {
  const audioStart = valid.lastIndexOf("OggS");
  assert.throws(() => inspectOggOpus(valid.subarray(0, valid.length - 1)), /Ogg|Truncated/);
  assert.throws(() => inspectOggOpus(valid.subarray(0, 54)), /Ogg|Truncated|Malformed/);
  assert.throws(() => inspectOggOpus(valid.subarray(0, audioStart)), /Incomplete|EOS/);
  const corrupt = Buffer.from(valid); corrupt[corrupt.length - 1] ^= 1; assert.throws(() => inspectOggOpus(corrupt), /CRC/);
  assert.throws(() => inspectOggOpus(Buffer.concat([valid, valid])), /EOS|Chained/);
  assert.throws(() => inspectOggOpus(stream({ mapping: 1 })), /layout/);
  assert.throws(() => inspectOggOpus(stream({ channels: 0 })), /layout/);
  const badGranulePage = Buffer.from(valid.subarray(audioStart));
  badGranulePage.writeBigUInt64LE(961n, 6); badGranulePage.writeUInt32LE(0, 22); badGranulePage.writeUInt32LE(crc(badGranulePage), 22);
  assert.throws(() => inspectOggOpus(Buffer.concat([valid.subarray(0, audioStart), badGranulePage])), /granule/);

  const { head, tags } = headerPackets();
  assert.throws(() => inspectOggOpus(Buffer.concat([checkedPage(2, 0, 0, [head, tags]), checkedPage(4, 960, 1, [Buffer.from([0x98])])])), /BOS|OpusHead/);
  assert.throws(() => inspectOggOpus(Buffer.concat([checkedPage(2, 0, 0, [head]), checkedPage(4, 960, 1, [tags, Buffer.from([0x98])])])), /header|audio|mix/);
  assert.throws(() => inspectOggOpus(Buffer.concat([
    checkedPage(2, 0, 0, [head]), checkedPage(0, -1, 1, []), checkedPage(0, 0, 2, [tags]), checkedPage(4, 960, 3, [Buffer.from([0x98])]),
  ])), /OpusTags|second/);
  for (const [headGranule, tagGranule] of [[-1, 0], [0, -1]]) {
    assert.throws(() => inspectOggOpus(Buffer.concat([
      checkedPage(2, headGranule, 0, [head]), checkedPage(0, tagGranule, 1, [tags]), checkedPage(4, 960, 2, [Buffer.from([0x98])]),
    ])), /header-completion.*granule zero/);
  }
  const continuedAudio = Buffer.alloc(255); continuedAudio[0] = 0x98;
  assert.throws(() => inspectOggOpus(Buffer.concat([
    checkedPage(2, 0, 0, [head]),
    checkedRawPage(0, 0, 1, [tags.length, 255], Buffer.concat([tags, continuedAudio])),
    checkedRawPage(5, 960, 2, [0], Buffer.alloc(0)),
  ])), /header-completion.*mixes/);

  assert.throws(() => inspectOggOpus(packetStream([0x9a], 960)), /code 2|length/);
  assert.throws(() => inspectOggOpus(packetStream([0x9a, 5, 1, 2, 3], 960)), /code 2|length/);
  assert.throws(() => inspectOggOpus(packetStream([0x99, 1], 960)), /code 1|odd/);
  assert.throws(() => inspectOggOpus(packetStream([0x9b], 960)), /code 3|frame-count/);
  assert.throws(() => inspectOggOpus(packetStream([0x9b, 0x00], 960)), /frame count/);
  assert.throws(() => inspectOggOpus(packetStream([0x9b, 0x41], 960)), /padding/);
  assert.throws(() => inspectOggOpus(packetStream([0x9b, 0x41, 5, 1, 2, 3], 960)), /padding/);
  assert.equal(inspectOggOpus(packetStream([0x9a, 2, 0, 1, 0, 2], 1920)).packetSamples48k, 1920);
  assert.equal(inspectOggOpus(packetStream([0x9b, 0x01], 960)).packetSamples48k, 960);
  assert.equal(inspectOggOpus(packetStream([0x9b, 0x02], 1920)).packetSamples48k, 1920);
  assert.equal(inspectOggOpus(packetStream([0x99], 1920)).packetSamples48k, 1920);
  assert.equal(inspectOggOpus(packetStream(Buffer.alloc(1276, 0x98), 960)).packetSamples48k, 960);
  for (const [prefix, bytes] of [[[0x98], 1276], [[0x99], 2552], [[0x9a, 0], 1276], [[0x9b, 1], 1276], [[0x9b, 0x81], 1276]]) {
    assert.throws(() => inspectOggOpus(packetStream(Buffer.concat([Buffer.from(prefix), Buffer.alloc(bytes)]), 1920)), /frame length exceeds 1275/);
  }
});

test("44.1/48 kHz tick conversions remain distinct from compressed decoder evidence", () => {
  assert.equal(wavTicks(735, 44100), 1);
  assert.equal(wavTicks(1103, 44100), 2);
  assert.equal(wavTicks(800, 48000), 1);
  assert.equal(wavTicks(1200, 48000), 2);
  assert.equal(wavTicks(1544, 44100), 2);
  assert.equal(wavTicks(1680, 48000), 2);
});

test("existing PCM WAV and MIDI control fixtures remain separate baseline evidence", () => {
  const wav = wavInfo(new Uint8Array(readFileSync(join(files, "pcm16-stereo-8000.wav"))));
  assert.equal(wav.ok, true); assert.equal(wav.channels, 2); assert.ok(wav.frames > 0);
  assert.equal(readFileSync(join(files, "midi0-480-default-tempo.mid")).subarray(0, 4).toString("ascii"), "MThd");
});

test("the production CuePlayer sends package bytes, seek/loop commands and finite-end notifications", () => {
  const asset = "media/short.opus.ogg", bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]), messages = [], ended = [];
  const player = new CuePlayer({
    send: (message) => messages.push(message),
    readAsset: (path) => path === asset ? bytes : null,
    onEnded: (cueId) => ended.push(cueId),
  });
  const play = (cueId, track, tick, loop) => ({ kind: "media.play", cueId, track, voice: 0, asset, tick, positionTicks: 0, loop, volume: 100 });
  player.reach(0);
  player.advance([play(1, "music", 0, true)]);
  const musicLoad = messages.find((message) => message.kind === "load");
  assert.ok(musicLoad);
  assert.equal(musicLoad.asset, asset);
  assert.deepEqual([...musicLoad.data], [...bytes]);
  player.ready(musicLoad.voice, 120);
  assert.ok(messages.some((message) => message.kind === "play" && message.cue === 1 && message.loop));
  player.reach(30);
  player.advance([{ kind: "media.seek", cueId: 1, track: "music", voice: 0, asset: null, tick: 30, positionTicks: 45, loop: null, volume: null }]);
  assert.ok(messages.some((message) => message.kind === "seek" && message.positionTicks === 45));
  player.advance([{ kind: "media.flags", cueId: 1, track: "music", voice: 0, asset: null, tick: 31, positionTicks: null, loop: false, volume: null }]);
  assert.ok(messages.some((message) => message.kind === "setLoop" && !message.loop));
  player.advance([play(2, "effects", 31, false)]);
  const effectLoad = messages.filter((message) => message.kind === "load")[1];
  assert.ok(effectLoad);
  player.ready(effectLoad.voice, 120);
  assert.ok(messages.some((message) => message.kind === "play" && message.cue === 2 && !message.loop));
  player.ended(effectLoad.voice);
  assert.deepEqual(ended, [2]);
});

for (const [rate, framesPerTick] of [[44100, 735], [48000, 800]]) {
  test(`the real prepared source seeks, wraps and ends exactly on the final real frame at ${rate} Hz`, () => {
    const samples = new Float32Array(framesPerTick * 2);
    samples[0] = 0.25;
    samples[framesPerTick] = 0.5;
    samples[samples.length - 1] = -0.25;
    const source = openPrepared({ kind: "pcm", channels: 1, outputRateHz: rate, samples, sourceRate: rate, sourceFrames: samples.length }, { outputRateHz: rate, bank: null });
    assert.ok(source.ok);
    const voice = source.value, out = new Float32Array(framesPerTick + 1), right = new Float32Array(out.length);
    assert.equal(voice.lengthTicks, 2);
    voice.start(0, true);
    voice.seek(1);
    voice.render(out, right, out.length);
    assert.equal(out[0], 0.5);
    assert.equal(out[framesPerTick - 1], -0.25);
    assert.equal(out[framesPerTick], 0.25);
    assert.equal(voice.ended, false);
    voice.start(1, false);
    voice.render(out, right, framesPerTick - 1);
    assert.equal(voice.ended, false);
    voice.render(out, right, 1);
    assert.equal(out[0], -0.25);
    assert.equal(voice.ended, true);
    voice.render(out, right, 1);
    assert.equal(out[0], 0);
    assert.equal(voice.ended, true);
  });
}

test("a 44.1 kHz prepared output one frame short still ends on its exact final frame", () => {
  const framesPerTick = 735, ticks = 120, target = framesPerTick * ticks;
  const samples = new Float32Array(target - 1);
  samples[0] = 0.25;
  samples[target - 2] = -0.5;
  const source = openPrepared({ kind: "pcm", channels: 1, outputRateHz: 44100, samples, sourceRate: 44100, sourceFrames: target }, { outputRateHz: 44100, bank: null });
  assert.ok(source.ok);
  const voice = source.value, out = new Float32Array(1), right = new Float32Array(1);
  assert.equal(voice.lengthTicks, ticks);
  assert.equal(samples.length, voice.lengthTicks * framesPerTick - 1);
  voice.start(0, false);
  const prefix = new Float32Array(target - 2), prefixRight = new Float32Array(target - 2);
  voice.render(prefix, prefixRight, prefix.length);
  assert.equal(voice.ended, false);
  voice.render(out, right, 1);
  assert.equal(out[0], -0.5);
  assert.equal(voice.ended, true);
  voice.render(out, right, 1);
  assert.equal(out[0], 0);
  assert.equal(voice.ended, true);
});

test("the real core opens the oracle-derived trimmed length, seeks, wraps and finishes on the tick clock", () => {
  const trimmed = stream({ preSkip: 320, audio: [{ bytes: [0x98], samples: 960 }, { bytes: [0x98], samples: 960 }, { bytes: [0x98], samples: 960 }], trim: 960 });
  const info = inspectOggOpus(trimmed);
  assert.equal(info.eosGranule, 1920);
  assert.equal(info.playable48kFrames, 1600);
  const ticks = info.playable48kFrames / 800;
  assert.equal(ticks, 2);
  assert.ok(Number.isInteger(ticks) && ticks > 0);

  const state = createGameState({ seed: 0 });
  const notes = [], transitions = [];
  const runtime = createAudioRuntime(state, {
    lookup: () => ({ kind: "known", lengthTicks: ticks }),
    notify: (note) => notes.push(note),
    transition: (event) => transitions.push(event),
  });
  const asset = "media/probe.opus.ogg";
  const track = (name) => state.audio.tracks.find((candidate) => candidate.name === name);
  state.time.tick = 0;
  const music = runtime.play({ track: "music", asset, loop: true });
  assert.equal(music.kind, "started");
  assert.equal(track("music").lengthTicks, ticks);
  state.time.tick = 1; runtime.phase();
  assert.equal(track("music").positionTicks, 1);
  if (process.env.TKR_AUDIO_GUARD_PERTURB !== "ignored-core-seek") assert.equal(runtime.seek("music", 0), true);
  assert.equal(track("music").positionTicks, 0, "seek must change the playhead from its natural tick");
  state.time.tick = 2;
  runtime.phase();
  assert.equal(track("music").positionTicks, 1);
  assert.equal(transitions.some((event) => event.type === "looped"), false);
  state.time.tick = 3;
  runtime.phase();
  assert.equal(track("music").positionTicks, 0);
  assert.ok(transitions.some((event) => event.type === "looped"));
  state.time.tick = 4;
  runtime.phase();
  assert.equal(track("music").positionTicks, 1);

  const effect = runtime.play({ track: "sfx", asset, loop: false });
  assert.equal(effect.kind, "started");
  assert.equal(track("sfx").lengthTicks, ticks);
  state.time.tick = 5;
  runtime.phase();
  assert.equal(track("sfx").voices.length, 1);
  state.time.tick = 6;
  runtime.phase();
  assert.equal(track("sfx").voices.length, 0);
  assert.ok(notes.some((note) => note.kind === "finished" && note.track === "sfx" && note.endTick === 6));
  assert.equal(track("music").voices.length, 1);
  assert.equal(track("music").positionTicks, 1);
});
