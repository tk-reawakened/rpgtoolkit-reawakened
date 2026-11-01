// The cue player's start arithmetic against the committed audio vectors (docs/spec/engine/audio-media.md#cue-player,
// #audio-late-sounds). The oracle is `tools/fixtures/audio/sim.mjs`'s `cuePlayer`, which the vectors were generated
// from: every `runner` expectation in `packages/core/test/fixtures/audio/*.json` was computed by it, so recomputing each
// one here is the agreement check. `cue-player.ts` imports nothing from the fixture directory, and this file does not
// import the oracle: if the two disagree, the vector is the fact and the implementation is wrong.

import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AudioCue } from "@tk-reawakened/core";
import { CuePlayer, cueStart, cueFadeValue, LATE_TICKS } from "../src/cue-player.ts";
import type { AudioMessage } from "../src/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const audioFixtures = resolve(here, "..", "..", "core", "test", "fixtures", "audio");

type RunnerExpectation = {
  readonly at: number;
  readonly action: string;
  readonly positionTicks?: number;
  readonly reason?: string;
  readonly from?: number;
  readonly target?: number;
  readonly durationTicks?: number;
  readonly volume?: number;
  readonly lateness: number;
};

type RunnerCase = {
  /** The whole cue, as the fixture generator commits it (every field the arithmetic reads). */
  readonly cue: AudioCue;
  readonly lengthTicks: number | null;
  /** The voice's loop state where the cue does not carry one (a `media.seek`), committed by the generator. */
  readonly loop: boolean | null;
  /** Whether the voice was playing for a `media.seek`, committed by the generator. */
  readonly playing: boolean | null;
  readonly ready: readonly RunnerExpectation[];
};

type Case = { readonly name: string; readonly expect: readonly { readonly cues?: readonly AudioCue[] }[]; readonly runner?: readonly RunnerCase[] };

function cases(): { scene: string; name: string; runner: readonly RunnerCase[]; maybeCue(cueId: number): AudioCue | undefined }[] {
  const found: { scene: string; name: string; runner: readonly RunnerCase[]; maybeCue(cueId: number): AudioCue | undefined }[] = [];
  for (const file of readdirSync(audioFixtures).filter((name) => name.endsWith(".json")).sort()) {
    const scene = JSON.parse(readFileSync(join(audioFixtures, file), "utf8")) as { cases?: readonly Case[] };
    for (const one of scene.cases ?? []) {
      if (one.runner === undefined) continue;
      const all = one.expect.flatMap((row) => row.cues ?? []);
      found.push({
        scene: file.replace(/\.json$/, ""),
        name: one.name,
        runner: one.runner,
        maybeCue: (cueId: number): AudioCue | undefined => all.find((candidate) => candidate.cueId === cueId),
      });
    }
  }
  return found;
}

test("cueStart reproduces every committed cue-player expectation", () => {
  const entries = cases();
  // The fixture set carries runner expectations for the late-start, fade/seek, music and restored-voice cases.
  ok(entries.length > 0, "the audio kit has runner expectations to check");
  let checked = 0;
  for (const entry of entries) {
    for (const runnerCase of entry.runner) {
      // The vector carries the whole cue; a cue found in the case's stream must agree with it field for field.
      const cue = runnerCase.cue;
      const streamed = entry.maybeCue(runnerCase.cue.cueId);
      if (streamed !== undefined) deepEqual(streamed, cue, `${entry.name}: the committed cue is the streamed cue`);
      for (const expected of runnerCase.ready) {
        const info = {
          lengthTicks: runnerCase.lengthTicks,
          loop: runnerCase.loop ?? cue.loop === true,
          // A `media.seek` reads the voice's playing state; the vector commits it, and an absent one reads as playing.
          playing: runnerCase.playing ?? true,
        };
        const start = cueStart(cue, expected.at, info);
        const where = `${entry.scene}/${entry.name} cue ${cue.cueId} ready ${expected.at}`;
        equal(start.action, expected.action, `${where}: action`);
        equal(start.lateness, expected.lateness, `${where}: lateness`);
        if (start.action === "play" || start.action === "seek") equal(start.positionTicks, expected.positionTicks, `${where}: positionTicks`);
        if (start.action === "stop") equal(start.reason, expected.reason, `${where}: reason`);
        if (start.action === "fade") {
          equal(start.from, expected.from, `${where}: fade from`);
          equal(start.target, expected.target, `${where}: fade target`);
          equal(start.durationTicks, expected.durationTicks, `${where}: fade duration`);
        }
        if (start.action === "setVolume") equal(start.volume, expected.volume, `${where}: setVolume`);
        checked += 1;
      }
    }
  }
  ok(checked >= 15, `checked ${checked} committed expectations`);
});

test("the worked example is the spec's own numbers", () => {
  const song: AudioCue = {
    cueId: 41, tick: 100, kind: "media.play", track: "music", voice: 0,
    asset: "media/song.mid" as AudioCue["asset"], loop: true, flags: 1, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null,
  };
  const positions = [100, 190, 760].map((at) => {
    const start = cueStart(song, at, { lengthTicks: 600, loop: true, playing: false });
    equal(start.action, "play");
    return start.action === "play" ? start.positionTicks : -1;
  });
  deepEqual(positions, [0, 90, 60]);
});

test("the 15-tick drop is measured from ready, not from the cue", () => {
  const sfx: AudioCue = {
    cueId: 7, tick: 10, kind: "media.play", track: "sfx", voice: 0,
    asset: "media/hit.wav" as AudioCue["asset"], loop: false, flags: 0, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null,
  };
  // Ready one tick early is a sound at its caught-up position…
  deepEqual(cueStart(sfx, 10 + LATE_TICKS - 1, { lengthTicks: 600, loop: false, playing: false }), {
    action: "play", positionTicks: LATE_TICKS - 1, lateness: LATE_TICKS - 1,
  });
  // …and at exactly the threshold it is dropped, with no sound and no `ended`.
  deepEqual(cueStart(sfx, 10 + LATE_TICKS, { lengthTicks: 600, loop: false, playing: false }), {
    action: "stop", reason: "late", lateness: LATE_TICKS,
  });
  // Music and loops are never dropped, however late: they catch up by position.
  const music: AudioCue = { ...sfx, cueId: 8, track: "music" };
  equal(cueStart(music, 10 + 500, { lengthTicks: 600, loop: false, playing: false }).action, "play");
  const loop: AudioCue = { ...sfx, cueId: 9, loop: true };
  deepEqual(cueStart(loop, 10 + 500, { lengthTicks: 40, loop: true, playing: false }), {
    action: "play", positionTicks: (500 % 40), lateness: 500,
  });
});

test("the P7 fade is integer, half-up, and clamps its elapsed ticks", () => {
  equal(cueFadeValue(100, 0, 10, 0), 100);
  equal(cueFadeValue(100, 0, 10, 10), 0);
  equal(cueFadeValue(100, 0, 10, 5), 50);
  // A half rounds up: 100 -> 0 over 3 ticks at 1 is 67.
  equal(cueFadeValue(100, 0, 3, 1), 67);
  equal(cueFadeValue(80, 40, 20, 0), 80);
  equal(cueFadeValue(80, 40, 0, 0), 40);
  // Out-of-range elapsed clamps instead of extrapolating.
  equal(cueFadeValue(100, 0, 10, 99), 0);
  equal(cueFadeValue(100, 0, 10, -3), 100);
});

// ---------------------------------------------------------------- the state machine's three named rules

const wav = (name: string): AudioCue["asset"] => `media/${name}` as AudioCue["asset"];

function playCue(cueId: number, tick: number, track: string, asset: string, extra: Partial<AudioCue> = {}): AudioCue {
  return {
    cueId, tick, kind: "media.play", track, voice: 0, asset: wav(asset),
    loop: false, flags: 0, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null, ...extra,
  };
}

function harness(options: { focus?: "pause" | "continue"; locked?: boolean } = {}): {
  player: CuePlayer;
  sent: AudioMessage[];
  ended: number[];
} {
  const sent: AudioMessage[] = [];
  const ended: number[] = [];
  const player = new CuePlayer({
    send: (message) => sent.push(message),
    readAsset: () => new Uint8Array([1, 2, 3]),
    onEnded: (cueId) => ended.push(cueId),
    ...(options.focus === undefined ? {} : { focus: options.focus }),
  });
  if (options.locked === true) player.lock();
  return { player, sent, ended };
}

test("the autoplay lock is a delayed late start, not a dropped sound", () => {
  const { player, sent } = harness({ locked: true });
  player.reach(100);
  player.advance([playCue(41, 100, "music", "song.mid", { loop: true })]);
  // Locked: the mirror remembers the music, and nothing is loaded or played.
  deepEqual(sent, []);
  equal(player.realised.length, 1, "the mirror holds the voice");
  equal(player.realised[0]?.state, "playing");

  // The player clicks at tick 190: the song joins at the caught-up position, as an ordinary late start.
  player.ready(41, 600);
  player.unlock(190);
  const play = sent.find((message) => message.kind === "play");
  ok(play !== undefined, "unlock sends a play");
  equal(play.kind === "play" ? play.positionTicks : -1, 90);
  equal(sent.some((message) => message.kind === "load"), false, "the voice was already ready, so unlock plays it");
});

test("unlock drops only the missed finite effects", () => {
  const { player, sent } = harness({ locked: true });
  player.reach(10);
  player.advance([playCue(1, 10, "music", "song.mid", { loop: true }), playCue(2, 10, "sfx", "hit.wav")]);
  player.ready(1, 600);
  player.ready(2, 30);
  // The gesture arrives 40 ticks later: the music joins at 40, the 30-tick sound effect is past the 15-tick drop.
  player.unlock(50);
  const plays = sent.filter((message) => message.kind === "play");
  deepEqual(plays.map((message) => (message.kind === "play" ? [message.voice, message.positionTicks] : [0, 0])), [[1, 40]]);
  deepEqual(sent.filter((message) => message.kind === "stop").map((message) => (message.kind === "stop" ? message.voice : 0)), [2]);
});

test("the focus hold pauses without losing position, and resumes exactly those voices", () => {
  const { player, sent } = harness({ focus: "pause" });
  player.reach(10);
  player.advance([playCue(5, 10, "music", "song.mid", { loop: true })]);
  player.ready(5, 600);
  player.reach(30);
  sent.length = 0;
  player.focusLost();
  deepEqual(sent, [{ kind: "pause", voice: 5 }]);
  equal(player.realised[0]?.state, "paused");
  equal(player.realised[0]?.position, 20, "the voice held its position at the pause");
  sent.length = 0;
  player.focusGained();
  deepEqual(sent, [{ kind: "resume", voice: 5 }]);
  equal(player.realised[0]?.state, "playing");
});

test("focus continue leaves the sources alone", () => {
  const { player, sent } = harness({ focus: "continue" });
  player.reach(10);
  player.advance([playCue(6, 10, "music", "song.mid", { loop: true })]);
  player.ready(6, 600);
  sent.length = 0;
  player.focusLost();
  player.focusGained();
  deepEqual(sent, []);
});

test("a message for a loading voice waits for ready, then goes out in order", () => {
  const { player, sent } = harness();
  player.reach(10);
  player.advance([playCue(3, 10, "sfx", "hit.wav")]);
  // Nothing yet: the voice is loading.
  deepEqual(sent.map((message) => message.kind), ["load"]);
  player.advance([{ kind: "media.volume", cueId: 4, tick: 11, track: "sfx", voice: 0, asset: null, loop: null, flags: null, positionTicks: null, volume: 40, targetVolume: null, durationTicks: null }]);
  deepEqual(sent.map((message) => message.kind), ["load"], "the volume change waits for ready");
  player.ready(3, 30);
  deepEqual(sent.map((message) => message.kind), ["load", "play", "setVolume"]);
});

test("a report's cues reach the sink in their original order", () => {
  const { player, sent } = harness();
  player.reach(10);
  player.advance([playCue(9, 10, "sfx", "first.wav"), playCue(3, 10, "music", "second.wav")]);
  deepEqual(sent.map((message) => message.kind === "load" ? message.asset : message.kind), ["media/first.wav", "media/second.wav"]);
});

test("a failed voice drops its held messages and never plays", () => {
  const { player, sent } = harness();
  player.reach(10);
  player.advance([playCue(4, 10, "sfx", "hit.wav")]);
  player.failed(4);
  deepEqual(sent.map((message) => message.kind), ["load"]);
  equal(player.realised[0]?.state, "failed");
});

test("ended reports the cue to the core once", () => {
  const { player, ended } = harness();
  player.reach(10);
  player.advance([playCue(9, 10, "sfx", "hit.wav")]);
  player.ready(9, 30);
  player.ended(9);
  deepEqual(ended, [9]);
});
