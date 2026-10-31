// The audio track engine's rules that the oracle scenes do not reach (ticket 6.6;
// docs/spec/engine/audio-media.md#audio-core-pins): track configuration limits, the steal order, pause and seek
// shifts, pass waits across a pause, the held FIFO for files whose length is not known yet, and the pre-registration
// queue. The scenes (`audio-scenes.test.ts`) prove the oracle's facts; these prove the rest of the contract.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { EffectBus } from "../src/engine/effects.ts";
import { engineEffect } from "../src/engine/boot.ts";
import { createAudioRuntime, audioSaveProjection, type AudioLookup, type AudioNote, type AudioRuntime, type AudioWait } from "../src/audio/index.ts";
import { createGameState, restoreGameState, snapshot, type GameState } from "../src/save/index.ts";
import type { AssetKey } from "../src/ports/keys.ts";

const key = (name: string): AssetKey => `media/${name}` as AssetKey;

type Rig = { readonly state: GameState; readonly runtime: AudioRuntime; readonly notes: AudioNote[]; readonly needed: AssetKey[]; lengths: Record<string, number | null | "pending" | "unsupported"> };

function rig(lengths: Rig["lengths"] = {}): Rig {
  const state = createGameState({ seed: 0 });
  const notes: AudioNote[] = [];
  const needed: AssetKey[] = [];
  const made: Rig = {
    state,
    notes,
    needed,
    lengths,
    runtime: createAudioRuntime(state, {
      lookup: (asset): AudioLookup => {
        const found = made.lengths[asset.slice("media/".length)];
        if (found === undefined) throw new Error(`no length for ${asset}`);
        if (found === "pending") return { kind: "pending" };
        if (found === "unsupported") return { kind: "unsupported" };
        return { kind: "known", lengthTicks: found };
      },
      need: (asset) => needed.push(asset),
      notify: (note) => notes.push(note),
    }),
  };
  return made;
}

const codes = (notes: readonly AudioNote[]): string[] => notes.flatMap((note) => (note.kind === "diag" ? [note.code] : []));

test("mediaTrack validates names, counts, the 16-track limit and the 32-voice cap, and changes nothing when it refuses", () => {
  const { state, runtime, notes } = rig({ "a.wav": 10, "b.wav": 10 });
  equal(runtime.configureTrack("Bad Name"), false);
  equal(runtime.configureTrack("x".repeat(33)), false);
  equal(runtime.configureTrack("fine", 0), false);
  equal(runtime.configureTrack("fine", 1.5), false);
  deepEqual(codes(notes), ["media.invalid-track-name", "media.invalid-track-name", "media.voice-count", "media.voice-count"]);
  equal(state.audio.tracks.length, 5);
  equal(runtime.configureTrack("Wide", 18), true);
  deepEqual(state.audio.tracks.map((track) => track.name).slice(5), ["wide"]);
  equal(runtime.configureTrack("one", 1), true);
  equal(runtime.configureTrack("two", 1), true);
  equal(runtime.configureTrack("three", 1), false, "12 built-in + 18 + 2 = 32 is the cap");
  equal(codes(notes).at(-1), "media.voice-cap");
  equal(runtime.configureTrack("wide", 20), false, "raising an existing track past the cap is refused too");
  equal(runtime.configureTrack("wide", 10), true);
  equal(state.audio.tracks.find((track) => track.name === "wide")?.voiceCount, 10);
  // Sixteen tracks at most, the five built-ins included.
  const many = rig();
  for (let index = 0; index < 11; index += 1) equal(many.runtime.configureTrack(`t${index}`, 1), true);
  equal(many.state.audio.tracks.length, 16);
  equal(many.runtime.configureTrack("extra", 1), false);
  equal(codes(many.notes).at(-1), "media.track-limit");
  // A count below a live voice index is refused and leaves the track unchanged.
  const live = rig({ "a.wav": 10, "b.wav": 10 });
  live.runtime.play({ track: "voice", asset: key("a.wav"), loop: false });
  live.runtime.play({ track: "voice", asset: key("b.wav"), loop: false });
  equal(live.runtime.configureTrack("VOICE", 1), false);
  const diagnostic = live.notes.at(-1);
  equal(diagnostic?.kind, "diag");
  if (diagnostic?.kind === "diag") deepEqual(diagnostic.detail, { name: "voice", voices: 1 });
  equal(live.state.audio.tracks.find((track) => track.name === "voice")?.voiceCount, 2);
});

type StealNote = Extract<AudioNote, { kind: "steal" }>;

const steals = (notes: readonly AudioNote[]): StealNote[] => notes.filter((note): note is StealNote => note.kind === "steal");

test("a full multi-voice track steals the lowest priority, then the oldest start, then the lowest index", () => {
  const { state, runtime, notes } = rig({ "a.wav": 100 });
  const play = (tick: number, priority: number): void => {
    state.time.tick = tick;
    runtime.play({ track: "ambience", asset: key("a.wav"), loop: false, priority });
  };
  play(0, 2);
  play(1, 0);
  play(2, 1);
  play(3, 0);
  deepEqual(state.audio.tracks[2]?.voices.map((voice) => [voice.index, voice.priority, voice.startTick]), [[0, 2, 0], [1, 0, 1], [2, 1, 2], [3, 0, 3]]);
  play(4, 5);
  deepEqual(steals(notes).map((note) => [note.track, note.voice]), [["ambience", 1]]);
  deepEqual(state.audio.tracks[2]?.voices.map((voice) => [voice.index, voice.priority]), [[0, 2], [1, 5], [2, 1], [3, 0]]);
  // Equal priority and age fall to the lowest index; a paused voice counts as active.
  const tie = rig({ "a.wav": 100 });
  tie.runtime.play({ track: "voice", asset: key("a.wav"), loop: false });
  tie.runtime.play({ track: "voice", asset: key("a.wav"), loop: false });
  tie.runtime.pause("voice", 0);
  tie.runtime.play({ track: "voice", asset: key("a.wav"), loop: false });
  deepEqual(steals(tie.notes).map((note) => note.voice), [0]);
});

test("explicit slots replace, and cue-checked handles never control a later occupant", () => {
  const { state, runtime } = rig({ "a.wav": 100, "b.wav": 100 });
  state.time.tick = 1;
  const first = runtime.play({ track: "voice", asset: key("a.wav"), loop: false, voice: 0 });
  equal(first.kind, "started");
  if (first.kind !== "started") return;
  runtime.drain();
  state.time.tick = 2;
  const oldHandle = { track: "voice", voice: first.voice, cueId: first.cueId };
  const second = runtime.play({ track: "voice", asset: key("b.wav"), loop: false, voice: 0 });
  equal(second.kind, "started");
  deepEqual(runtime.drain().map((cue) => [cue.kind, cue.voice]), [["media.stop", 0], ["media.play", 0]]);
  equal(runtime.stop("voice", oldHandle), false);
  equal(state.audio.tracks.find((track) => track.name === "voice")?.voices[0]?.file, key("b.wav"));
  const current = state.audio.tracks.find((track) => track.name === "voice")?.voices[0];
  ok(current !== undefined);
  equal(runtime.stop("voice", { track: "voice", voice: 0, cueId: current?.cueId ?? 0 }), true);
});

test("snapshot restore preserves later fade and steal behavior", () => {
  const fadeRig = rig({ "song.wav": 30 });
  fadeRig.runtime.play({ track: "sfx", asset: key("song.wav"), loop: false });
  fadeRig.state.time.tick = 2;
  fadeRig.runtime.fade("sfx", 20, 8, 0);
  fadeRig.state.time.tick = 4;
  fadeRig.runtime.phase();
  fadeRig.runtime.drain();
  const restoredFade = restoreGameState(snapshot(fadeRig.state));
  const restoredFadeRuntime = createAudioRuntime(restoredFade, { lookup: () => ({ kind: "known", lengthTicks: 30 }) });
  restoredFadeRuntime.drain();
  for (let tick = 5; tick < 14; tick += 1) {
    fadeRig.state.time.tick = tick;
    restoredFade.time.tick = tick;
    fadeRig.runtime.phase();
    restoredFadeRuntime.phase();
    deepEqual(restoredFade.audio, fadeRig.state.audio, `fade snapshot tick ${tick}`);
  }

  const stealRig = rig({ "a.wav": 100, "b.wav": 100, "c.wav": 100 });
  stealRig.runtime.configureTrack("voice", 2);
  stealRig.state.time.tick = 0;
  stealRig.runtime.play({ track: "voice", asset: key("a.wav"), loop: false });
  stealRig.state.time.tick = 1;
  stealRig.runtime.play({ track: "voice", asset: key("b.wav"), loop: false });
  stealRig.runtime.drain();
  const restoredSteal = restoreGameState(snapshot(stealRig.state));
  const restoredStealRuntime = createAudioRuntime(restoredSteal, { lookup: (asset) => ({ kind: "known", lengthTicks: asset === key("c.wav") ? 100 : 100 }) });
  restoredStealRuntime.drain();
  stealRig.state.time.tick = 2;
  restoredSteal.time.tick = 2;
  stealRig.runtime.play({ track: "voice", asset: key("c.wav"), loop: false });
  restoredStealRuntime.play({ track: "voice", asset: key("c.wav"), loop: false });
  deepEqual(restoredSteal.audio, stealRig.state.audio);
  deepEqual(restoredStealRuntime.drain(), stealRig.runtime.drain());
});

test("pause holds the position, the end tick and a running fade, and resume adds the paused span to each", () => {
  const { state, runtime } = rig({ "song.wav": 30 });
  state.time.tick = 2;
  runtime.play({ track: "sfx", asset: key("song.wav"), loop: false });
  const voice = state.audio.tracks[1]!.voices[0]!;
  voice.fade = { fromVolume: 100, targetVolume: 0, startTick: 5, durationTicks: 20 };
  state.time.tick = 10;
  runtime.pause("sfx");
  deepEqual([voice.state, voice.positionTicks, voice.pausedTick, voice.startTick, voice.endTick, voice.fade.startTick], ["paused", 8, 10, 2, 32, 5]);
  state.time.tick = 17;
  runtime.phase();
  deepEqual([voice.positionTicks, voice.endTick], [8, 32], "a paused voice neither moves nor ends");
  runtime.resume("sfx");
  deepEqual([voice.state, voice.pausedTick, voice.startTick, voice.endTick, voice.fade?.startTick], ["playing", null, 9, 39, 12]);
  state.time.tick = 20;
  runtime.phase();
  equal(voice.positionTicks, 11);
  equal(state.audio.tracks[1]?.positionTicks, 11);
});

test("a seek on a paused voice moves its start against the pause tick and holds the new position", () => {
  const { state, runtime } = rig({ "song.wav": 30 });
  runtime.play({ track: "sfx", asset: key("song.wav"), loop: false });
  state.time.tick = 10;
  runtime.pause("sfx");
  equal(runtime.seek("sfx", 4), true);
  const voice = state.audio.tracks[1]!.voices[0]!;
  deepEqual([voice.positionTicks, voice.startTick, voice.endTick, voice.pausedTick], [4, 6, 36, 10]);
  state.time.tick = 20;
  runtime.resume("sfx");
  state.time.tick = 21;
  runtime.phase();
  equal(voice.positionTicks, 5);
});

test("transport calls refuse a negative or fractional seek and a volume outside 0 to 100 without touching state or cues", () => {
  const { state, runtime, notes } = rig({ "a.wav": 10 });
  runtime.play({ track: "sfx", asset: key("a.wav"), loop: false });
  const before = JSON.stringify(state.audio);
  runtime.drain();
  equal(runtime.seek("sfx", -1), false);
  equal(runtime.seek("sfx", 2.5), false);
  equal(runtime.setMasterVolume(101), false);
  equal(runtime.setTrackVolume("sfx", -5), false);
  equal(runtime.setVoiceVolume("sfx", 0, 100.5), false);
  equal(runtime.setVoiceVolume("sfx", 0, 50) && runtime.setVoiceVolume("sfx", 1, 50), false, "voice 1 of a one-voice track does not exist");
  deepEqual(codes(notes).slice(-6), ["media.invalid-time", "media.invalid-time", "media.invalid-volume", "media.invalid-volume", "media.invalid-volume", "media.unknown-voice"]);
  deepEqual(runtime.drain().map((cue) => [cue.kind, cue.voice, cue.volume]), [["media.volume", 0, 50]]);
  const after = JSON.parse(before) as typeof state.audio;
  const voice = state.audio.tracks[1]!.voices[0]!;
  equal(voice.volume, 50);
  after.tracks[1]!.voices[0]!.volume = 50;
  after.cueId += 1;
  deepEqual(state.audio, after);
});

test("a track volume of 100 with no fade leaves no settings entry, and entries stay in ascending name order", () => {
  const { state, runtime } = rig();
  runtime.setTrackVolume("ui", 50);
  runtime.setTrackVolume("music", 20);
  runtime.setTrackVolume("ambience", 70);
  deepEqual(state.audio.settings.trackVolumes.map((entry) => [entry.name, entry.volume]), [["ambience", 70], ["music", 20], ["ui", 50]]);
  runtime.setTrackVolume("music", 100);
  deepEqual(state.audio.settings.trackVolumes.map((entry) => entry.name), ["ambience", "ui"]);
  runtime.setMasterVolume(100);
  equal(state.audio.settings.masterVolume, 100);
});

test("a pass wait wakes at the next boundary of the voice, which a pause and resume move", () => {
  const { state, runtime } = rig({ "loop.wav": 12 });
  state.time.tick = 3;
  runtime.play({ track: "ambience", asset: key("loop.wav"), loop: true });
  state.time.tick = 5;
  const wait = runtime.waitFor("ambience") as AudioWait;
  deepEqual(wait, { track: "ambience", voice: 0, cueId: 1, endTick: null, pass: true, passIndex: 0 });
  state.time.tick = 8;
  runtime.pause("ambience");
  for (const tick of [14, 15, 19]) {
    state.time.tick = tick;
    deepEqual(runtime.pollWait(wait), { wake: false }, `parked while paused at ${tick}`);
  }
  state.time.tick = 20;
  runtime.resume("ambience");
  for (const tick of [20, 26]) {
    state.time.tick = tick;
    deepEqual(runtime.pollWait(wait), { wake: false }, `the boundary moved by the paused span: still parked at ${tick}`);
  }
  state.time.tick = 27;
  deepEqual(runtime.pollWait(wait), { wake: true, why: "pass" });
});

test("a wait wakes when its voice is stopped or replaced, and a terminal wait at the voice's end tick", () => {
  const { state, runtime } = rig({ "a.wav": 10, "b.wav": 10 });
  runtime.play({ track: "sfx", asset: key("a.wav"), loop: false });
  const wait = runtime.waitFor("sfx") as AudioWait;
  deepEqual([wait.endTick, wait.pass, wait.passIndex], [10, false, null]);
  state.time.tick = 9;
  deepEqual(runtime.pollWait(wait), { wake: false });
  state.time.tick = 10;
  deepEqual(runtime.pollWait(wait), { wake: true, why: "end" });
  runtime.phase();
  deepEqual(runtime.pollWait(wait), { wake: true, why: "gone" }, "the finished voice is gone");
  state.time.tick = 11;
  runtime.play({ track: "sfx", asset: key("a.wav"), loop: false });
  const second = runtime.waitFor("sfx") as AudioWait;
  runtime.play({ track: "sfx", asset: key("b.wav"), loop: false });
  deepEqual(runtime.pollWait(second), { wake: true, why: "gone" }, "a replacement wakes the wait of the voice it displaced");
  equal(runtime.waitFor("music"), null, "a stopped track is the normal stopped result, not a wait");
});

test("an unknown-length voice is not waitable and a play that waits for it parks nothing", () => {
  const { runtime, notes } = rig({ "odd.xm": "unsupported" });
  deepEqual(runtime.play({ track: "sfx", asset: key("odd.xm"), loop: false, wait: true }), { kind: "started", voice: 0, cueId: 1, wait: null });
  deepEqual(codes(notes), ["media.asset-format", "media.asset-length"]);
  equal(runtime.waitFor("sfx"), null);
  equal(codes(notes).at(-1), "media.asset-length");
});

test("a file whose length is not known yet holds its effect and every later one, then applies them in post order", () => {
  const harness = rig({ "town.mid": "pending", "door.wav": 8, "cave.mid": 30 });
  const { state, runtime, needed } = harness;
  const post = (name: string, args: (string | boolean | null)[]): void => {
    runtime.apply({ ...engineEffect("audio", name, args, "draw-audio-cue"), seq: 1, tick: state.time.tick });
  };
  post("music.play", [key("town.mid"), true, null, "board"]);
  post("sfx.play", [key("door.wav"), false, null, "frame"]);
  post("music.play", [key("cave.mid"), true, null, "board"]);
  equal(runtime.heldCount(), 3);
  deepEqual(needed, [key("town.mid")]);
  equal(runtime.drain().length, 0, "nothing applied while the head waits");
  state.time.tick = 4;
  runtime.retry();
  equal(runtime.heldCount(), 3, "still pending after a retry with no answer");
  deepEqual(needed, [key("town.mid"), key("town.mid")]);
  harness.lengths["town.mid"] = 40;
  runtime.retry();
  equal(runtime.heldCount(), 0);
  deepEqual(
    runtime.drain().map((cue) => [cue.cueId, cue.tick, cue.kind, cue.track, cue.asset]),
    [[1, 4, "media.play", "music", key("town.mid")], [2, 4, "media.play", "sfx", key("door.wav")], [3, 4, "media.stop", "music", null], [4, 4, "media.play", "music", key("cave.mid")]],
  );
  equal(state.audio.tracks[0]?.voices[0]?.lengthTicks, 30);
});

test("effects posted before the applier registered apply in post order when it registers, after the start soundfont.set", () => {
  const state = createGameState({ seed: 0 });
  const bus = new EffectBus(state);
  const runtime = createAudioRuntime(state, { lookup: () => ({ kind: "known", lengthTicks: 20 }) });
  const post = (name: string, args: (string | boolean | null)[]): void => void bus.postEffect("audio", engineEffect("audio", name, args, "draw-audio-cue"));
  post("music.play", [key("town.mid"), true, null, "board"]);
  post("sfx.play", [key("door.wav"), false, null, "frame"]);
  post("music.play", [key("cave.mid"), true, null, "board"]);
  equal(bus.pendingCount("audio"), 3);
  state.time.tick = 6;
  runtime.register(bus);
  equal(bus.pendingCount("audio"), 0);
  deepEqual(
    runtime.drain().map((cue) => [cue.cueId, cue.tick, cue.kind, cue.track, cue.asset]),
    [[1, 6, "soundfont.set", null, null], [2, 6, "media.play", "music", key("town.mid")], [3, 6, "media.play", "sfx", key("door.wav")], [4, 6, "media.stop", "music", null], [5, 6, "media.play", "music", key("cave.mid")]],
  );
  post("music.play", [key("cave.mid"), true, null, "board"]);
  equal(runtime.drain().length, 0, "after registration an effect applies at once; the same file carries on");
});

test("an effect the runtime does not know, or with malformed arguments, is a diagnostic and changes nothing", () => {
  const { state, runtime, notes } = rig();
  const before = JSON.stringify(state.audio);
  const send = (name: string, args: (string | number | boolean | null)[]): void => runtime.apply({ ...engineEffect("audio", name, args, "draw-audio-cue"), seq: 1, tick: 0 });
  send("music.rewind", []);
  send("music.play", [7, true, null, "board"]);
  send("sfx.play", [null, false, null, "frame"]);
  send("soundfont.set", [3]);
  deepEqual(codes(notes), ["audio.effect", "audio.effect", "audio.effect", "audio.effect"]);
  equal(JSON.stringify(state.audio), before);
  equal(runtime.drain().length, 0);
});

test("a game load of a paused voice restores it paused, shifts its clocks by the elapsed ticks and re-emits play then pause", () => {
  const { state, runtime } = rig({ "loop.wav": 12, "sting.wav": 40 });
  state.time.tick = 3;
  runtime.play({ track: "ambience", asset: key("loop.wav"), loop: true });
  runtime.play({ track: "sfx", asset: key("sting.wav"), loop: false });
  state.time.tick = 8;
  runtime.pause("ambience");
  state.time.tick = 10;
  runtime.phase();
  const saved = audioSaveProjection(state.audio, 10);
  equal(JSON.stringify(saved).includes("settings"), false, "a game save never carries the script volume settings");
  deepEqual(Object.keys(saved), ["tick", "cueId", "tracks"]);
  runtime.drain();
  state.time.tick = 25;
  runtime.load(saved);
  const ambience = state.audio.tracks[2]!.voices[0]!;
  deepEqual([ambience.state, ambience.positionTicks, ambience.startTick, ambience.pausedTick], ["paused", 5, 18, 23]);
  deepEqual(
    runtime.drain().map((cue) => [cue.kind, cue.track, cue.tick, cue.positionTicks]),
    [["soundfont.set", null, 25, null], ["media.play", "sfx", 18, 0], ["media.play", "ambience", 25, 5], ["media.pause", "ambience", 25, null]],
  );
  state.time.tick = 30;
  runtime.resume("ambience");
  state.time.tick = 31;
  runtime.phase();
  equal(ambience.positionTicks, 6, "the held position continues from the resume");
  const sfx = state.audio.tracks[1]!.voices[0]!;
  deepEqual([sfx.startTick, sfx.endTick, sfx.positionTicks], [18, 58, 13], "started at 3 and saved at 10 (position 7), loaded at 25 (start 18), read at 31 (position 13)");
});

test("a game load drops a finished one-shot, restarts music from zero and keeps configured author tracks", () => {
  const { state, runtime } = rig({ "song.mid": 50, "short.wav": 5, "x.wav": 9 });
  runtime.configureTrack("extra", 3);
  state.time.tick = 1;
  runtime.play({ track: "music", asset: key("song.mid"), loop: true });
  runtime.play({ track: "extra", asset: key("x.wav"), loop: false });
  state.time.tick = 6;
  runtime.phase();
  const saved = audioSaveProjection(state.audio, 6);
  const fresh = rig({ "song.mid": 50, "short.wav": 5, "x.wav": 9 });
  fresh.runtime.configureTrack("extra", 3);
  fresh.state.time.tick = 40;
  fresh.runtime.load(saved);
  deepEqual(fresh.state.audio.tracks.map((track) => [track.name, track.voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4], ["extra", 3]]);
  const music = fresh.state.audio.tracks[0]!.voices[0]!;
  deepEqual([music.startTick, music.positionTicks], [40, 0]);
  const extra = fresh.state.audio.tracks[5]!.voices[0]!;
  deepEqual([extra.startTick, extra.positionTicks, extra.endTick], [35, 5, 44]);
  ok(fresh.state.audio.cueId >= saved.cueId, "the counter never goes back");
});

test("engine-originated starts use beforePlay and can be canceled or mutated without side effects", () => {
  const state = createGameState({ seed: 0 });
  const initialCueId = state.audio.cueId;
  state.events.listeners.push({ id: state.events.nextListener++, emitter: "media", type: "beforePlay", once: false, callable: { type: "callable", def: "unused", captures: [], receiver: null } });
  let cancel = false;
  const runtime = createAudioRuntime(state, {
    lookup: () => ({ kind: "known", lengthTicks: 60 }),
    engineBeforePlay: (detail) => {
      if (cancel) return "canceled";
      equal(detail.source, "animation");
      detail.file = "MEDIA/B.WAV" as typeof detail.file;
      detail.volume = 30;
      detail.loop = true;
      return "allowed";
    },
  });
  const first = runtime.play({ track: "sfx", asset: key("a.wav"), loop: false, source: "animation" });
  equal(first.kind, "started");
  deepEqual(runtime.drain().map((cue) => [cue.asset, cue.volume, cue.loop]), [[key("b.wav"), 30, true]]);
  cancel = true;
  const second = runtime.play({ track: "sfx", asset: key("a.wav"), loop: false, source: "animation" });
  equal(second.kind, "canceled");
  equal(state.audio.cueId, initialCueId + 1);
  equal(state.audio.tracks.find((track) => track.name === "sfx")?.voices.length, 1);
});

test("a failed engine beforePlay dispatch rejects the start", () => {
  const state = createGameState({ seed: 0 });
  const initialCueId = state.audio.cueId;
  state.events.listeners.push({ id: state.events.nextListener++, emitter: "media", type: "beforePlay", once: false, callable: { type: "callable", def: "unused", captures: [], receiver: null } });
  const runtime = createAudioRuntime(state, {
    lookup: () => ({ kind: "known", lengthTicks: 60 }),
    engineBeforePlay: () => "failed",
  });
  equal(runtime.play({ track: "sfx", asset: key("a.wav"), loop: false, source: "animation" }).kind, "rejected");
  equal(state.audio.cueId, initialCueId);
  equal(state.audio.tracks.find((track) => track.name === "sfx")?.voices.length, 0);
  deepEqual(runtime.drain(), []);
});


test("game-file audio configuration sets the live voice cap and overflow leaves the default budget", () => {
  const configured = rig();
  const configuredTracks = configured.state.audio.tracks.map((track) => ({ name: track.name, voiceCount: 1 }));
  deepEqual(configured.runtime.applyGameAudio({ tracks: configuredTracks, voiceCap: 6 }), { ok: true });
  equal(configured.runtime.configureTrack("weather", 1), true);
  equal(configured.runtime.configureTrack("extra", 1), false);
  equal(configured.runtime.configureTrack("music", 2), false);
  deepEqual(codes(configured.notes), ["media.voice-cap", "media.voice-cap"]);

  const overflow = rig();
  const tracks = [...overflow.state.audio.tracks.map((track) => ({ name: track.name, voiceCount: 1 })), { name: "previous-game-track", voiceCount: 6 }];
  deepEqual(overflow.runtime.applyGameAudio({ tracks: tracks.slice(0, -1), voiceCap: 6 }), { ok: true });
  overflow.runtime.configureTrack("previous-game-track", 3);
  deepEqual(overflow.runtime.applyGameAudio({ tracks, voiceCap: 4 }), { ok: false, overflowIndex: 4 });
  deepEqual(overflow.state.audio.tracks.map(({ name, voiceCount }) => [name, voiceCount]), [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  equal(overflow.runtime.configureTrack("extra", 20), true, "fallback keeps the default 32-voice cap");
});

test("playback load preserves the game's definitions, cap and bank and ignores unconfigured saved tracks", () => {
  const source = rig({ "x.wav": 100 });
  source.runtime.configureTrack("weather", 3);
  source.runtime.configureTrack("obsolete", 1);
  source.runtime.play({ track: "weather", asset: key("x.wav"), loop: false });
  source.runtime.play({ track: "obsolete", asset: key("x.wav"), loop: false });
  source.state.time.tick = 3;
  const saved = audioSaveProjection(source.state.audio, 3);
  equal(JSON.stringify(saved).includes("voiceCount"), false);

  const target = rig({ "x.wav": 100 });
  const tracks = [...target.state.audio.tracks.map((track) => ({ name: track.name, voiceCount: 1 })), { name: "weather", voiceCount: 1 }, { name: "new", voiceCount: 1 }];
  target.runtime.applyGameAudio({ tracks, voiceCap: 7 });
  target.runtime.setDefaultSoundFont(key("game.sf2"));
  target.state.audio.soundFont = key("current.sf2");
  target.state.time.tick = 10;
  target.runtime.load(saved);
  deepEqual(target.state.audio.tracks.map((track) => ({ name: track.name, voiceCount: track.voiceCount })), tracks);
  equal(target.state.audio.tracks[5]?.voices.length, 1);
  equal(target.state.audio.tracks[6]?.voices.length, 0);
  equal(target.state.audio.soundFont, key("current.sf2"));
  equal(target.runtime.drain()[0]?.asset, key("current.sf2"));
  equal(target.runtime.configureTrack("extra", 1), false, "load preserves the configured cap");
  target.state.audio.soundFont = null;
  target.runtime.load(saved);
  equal(target.runtime.drain()[0]?.asset, key("game.sf2"), "load preserves the authored default bank");
});

test("playback load matches saved tracks against differently cased current configuration", () => {
  const source = rig({ "x.wav": 100 });
  source.runtime.configureTrack("weather", 1);
  source.runtime.play({ track: "weather", asset: key("x.wav"), loop: false });
  const saved = audioSaveProjection(source.state.audio, 0);

  const target = rig({ "x.wav": 100 });
  target.runtime.configureTrack("weather", 1);
  target.state.audio.tracks[5]!.name = "WEATHER";
  target.runtime.load(saved);

  equal(target.state.audio.tracks[5]!.name, "WEATHER");
  equal(target.state.audio.tracks[5]!.voices.length, 1);
  const play = target.runtime.drain().find((cue) => cue.kind === "media.play" && cue.track === "WEATHER");
  ok(play);
  equal(play.asset, key("x.wav"));
});
