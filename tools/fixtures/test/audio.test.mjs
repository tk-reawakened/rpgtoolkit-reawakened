// Tests for the audio oracle (ticket 6.4): tools/fixtures/audio and its committed scenes and authored
// files under packages/core/test/fixtures/audio. The expected numbers asserted below are worked by hand
// from docs/spec/engine/audio-media.md (the time model P2, the voice rules P6, the fade rule P7, the length
// rule F4 ...), not read back from the reference timeline, so a regression in the oracle cannot confirm
// itself. This file imports nothing from packages/core.
import { test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "../author/generate.mjs";
import { AUDIO_OUT, CORPUS, PROPOSED, SCENE_NAMES, SPEC, audioFixtureFiles, checkAudioCorpus, checkAudioFiles, checkAudioImports } from "../audio/index.mjs";
import { AUDIO_FILES } from "../audio/files.mjs";
import { midiInfo, midiTicks, wavInfo, wavTicks } from "../audio/length.mjs";
import { fadeValue, ticksFromMs } from "../audio/sim.mjs";
import { workspaceImports } from "../movement/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

const NAMED = [
  "board-music-boot", "animation-frame-sfx", "track-transport", "loop-and-end-ticks", "same-file-rules", "voices-and-stealing",
  "fades", "synced-start", "late-start-catch-up", "media-wait-suspend", "settings-versus-save", "soundfont-setting",
  "battle-music-handoff", "legacy-parity-ledger", "video-restarts-music",
];

const load = (name) => JSON.parse(readFileSync(join(AUDIO_OUT, `${name}.json`), "utf8"));
const theCase = (scene, name) => {
  const found = load(scene).cases.find((c) => c.name === name);
  ok(found, `${scene}/${name} exists`);
  return found;
};
const rowAt = (c, t) => c.expect.find((r) => r.t === t);
const cuesAt = (c, t) => rowAt(c, t).cues ?? [];
const kinds = (c, t) => cuesAt(c, t).map((q) => `${q.kind}${q.track === null ? "" : `/${q.track}`}${q.voice === null ? "" : `#${q.voice}`}`);
const allCues = (c) => c.expect.flatMap((r) => r.cues ?? []);
const facts = (c, e) => c.expect.flatMap((r) => (r.ev ?? []).filter((x) => x.e === e).map((x) => ({ t: r.t, ...x })));
const diags = (c) => facts(c, "diag").map((d) => [d.t, d.code]);
const wakes = (c) => facts(c, "wake").map((w) => [w.t, w.thread]);
const trackAt = (c, t, name) => rowAt(c, t).tr.find((x) => x[0] === name);
const voiceAt = (c, t, name, index = 0) => trackAt(c, t, name)[6].find((v) => v[0] === index);
const posAt = (c, t, name, index = 0) => voiceAt(c, t, name, index)[6];
const volAt = (c, t, name, index = 0) => voiceAt(c, t, name, index)[4];
const finishes = (c) => facts(c, "finished").map((f) => [f.t, f.track, f.voice]);

test("every named scene resolves to a committed file, and the manifest lists them in order", () => {
  deepEqual(SCENE_NAMES, NAMED);
  const manifest = JSON.parse(readFileSync(join(AUDIO_OUT, "manifest.json"), "utf8"));
  deepEqual(manifest.scenes.map((s) => s.scene), NAMED);
  deepEqual(readdirSync(AUDIO_OUT).sort(), [...NAMED.map((n) => `${n}.json`), "files", "manifest.json"].sort());
  deepEqual(readdirSync(join(AUDIO_OUT, "files")).sort(), AUDIO_FILES.map((f) => f.name).sort());
  const spec = readFileSync(join(repoRoot, SPEC), "utf8");
  for (const entry of manifest.scenes) {
    const doc = load(entry.scene);
    equal(doc.scene, entry.scene);
    ok(doc.cases.length > 0, `${entry.scene} has cases`);
    deepEqual(doc.cases.map((c) => c.name), entry.cases);
    for (const id of doc.proposed) ok(PROPOSED[id], `${entry.scene} cites ${id}`);
    for (const ref of doc.spec) {
      const [page, anchor] = ref.split("#");
      equal(page, SPEC);
      ok(spec.includes(`<a id="${anchor}"></a>`), `${entry.scene} cites an existing anchor ${anchor}`);
    }
    const names = doc.cases.map((c) => c.name);
    equal(new Set(names).size, names.length, `${entry.scene} case names are unique`);
  }
});

test("every case carries one fact row per tick, in order, with every cue a full twelve-key record and no hashes", () => {
  const cueKeys = ["cueId", "tick", "kind", "track", "voice", "asset", "loop", "flags", "positionTicks", "volume", "targetVolume", "durationTicks"];
  for (const name of NAMED) {
    const doc = load(name);
    for (const c of doc.cases) {
      equal(c.expect.length, c.ticks, `${name}/${c.name} row count`);
      c.expect.forEach((row, index) => equal(row.t, index));
      let last = 0;
      for (const cue of allCues(c)) {
        deepEqual(Object.keys(cue), cueKeys, `${name}/${c.name} cue ${cue.cueId} keys`);
        ok(cue.cueId > last, `${name}/${c.name} cue ids rise`);
        last = cue.cueId;
        ok(Number.isInteger(cue.tick), `${name}/${c.name} integer cue tick`);
      }
      if (c.ticks > 0) {
        deepEqual(c.expect[0].cfg.map((x) => x[0]).slice(0, 5), ["music", "sfx", "ambience", "voice", "ui"]);
        equal(allCues(c)[0].kind, "soundfont.set", `${name}/${c.name} opens with the bank cue at engine start (or at registration)`);
      }
    }
    ok(!/hash/i.test(JSON.stringify(doc.cases)), `${name} asserts no state or cue hash`);
  }
});

test("--check mode reproduces the committed fixtures byte for byte, and the generator is deterministic", () => {
  deepEqual(check(), []);
  const again = audioFixtureFiles();
  for (const [name, bytes] of audioFixtureFiles()) ok(again.find(([n]) => n === name)[1].equals(bytes), `${name} is deterministic`);
  for (const [name, bytes] of again) ok(readFileSync(join(AUDIO_OUT, name)).equals(bytes), `${name} matches disk`);
  equal(again.length, NAMED.length + AUDIO_FILES.length + 1);
});

test("static import scan: the audio oracle and its test import nothing from packages/core", () => {
  deepEqual(checkAudioImports(), []);
  const importLines = readFileSync(join(here, "audio.test.mjs"), "utf8").split("\n").filter((line) => line.startsWith("import ")).join("\n");
  deepEqual(workspaceImports(importLines), []);
  deepEqual(workspaceImports('import a from "../../packages/core/src/x.ts"; import c from "./ok.mjs";'), ["../../packages/core/src/x.ts"]);
  ok(readdirSync(join(here, "..", "audio")).filter((f) => f.endsWith(".mjs")).length >= 8);
});

test("the integer rules, hand-worked", () => {
  equal(ticksFromMs(125), 8); // 7.5 ticks, half up
  equal(ticksFromMs(25), 2); // 1.5 ticks
  equal(ticksFromMs(8), 0);
  equal(ticksFromMs(66), 4);
  equal(ticksFromMs(1000), 60);
  deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => fadeValue(100, 0, 8, d)), [100, 88, 75, 63, 50, 38, 25, 13, 0, 0]);
  equal(fadeValue(63, 100, 4, 2), 82);
  equal(fadeValue(0, 100, 8, 1), 13); // 12.5 rounds up
});

test("F4: authored WAV and MIDI files have their hand-worked lengths", () => {
  const worked = {
    "pcm8-mono-8000.wav": 30, "pcm16-mono-8000.wav": 15, "pcm16-stereo-8000.wav": 3, "pcm8-half-tick.wav": 2, "pcm8-min-one-tick.wav": 1,
    "msadpcm-mono-8000.wav": 15, "msadpcm-mono-8000-fact.wav": 14, "ima-adpcm-mono-8000.wav": 15, "ima-adpcm-stereo-8000.wav": 8,
    "midi0-480-default-tempo.mid": 120, "midi0-96-tempo-change.mid": 60, "midi1-240-tempo-map.mid": 129, "midi0-480-round-up.mid": 119,
    "midi1-480-tempo-only.mid": 45, "midi0-empty-minimum.mid": 1, "midi0-xg-bank-select.mid": 30, "midi0-gs-reset.mid": 30,
  };
  deepEqual(AUDIO_FILES.map((f) => f.name).sort(), Object.keys(worked).sort());
  deepEqual(checkAudioFiles(), []);
  for (const [name, ticks] of Object.entries(worked)) {
    const bytes = readFileSync(join(AUDIO_OUT, "files", name));
    const info = name.endsWith(".wav") ? wavInfo(bytes) : midiInfo(bytes);
    ok(info.ok, `${name} parses`);
    equal(info.lengthTicks, ticks, `${name} length`);
  }
  // The rule itself, with the arithmetic done here.
  equal(wavTicks(4000, 8000), 30); // 30.5 floors to 30
  equal(wavTicks(200, 8000), 2); // exactly 1.5 ticks rounds up
  equal(wavTicks(1, 8000), 1); // 0.0075 ticks, raised to the minimum
  equal(wavTicks(1900, 8000), 14); // 14.25 ticks + 0.5
  equal(midiTicks(960000000n, 480), 120); // the specification's own example: 2 s
  equal(midiTicks(96000000n, 96), 60);
  equal(midiTicks(516000000n, 240), 129);
  equal(midiTicks(950000000n, 480), 119); // 118.75 ticks rounds up
  equal(midiTicks(0n, 480), 1);
  // The bank facts by byte scan.
  deepEqual(midiInfo(readFileSync(join(AUDIO_OUT, "files", "midi0-xg-bank-select.mid"))).dialect, "xg");
  equal(midiInfo(readFileSync(join(AUDIO_OUT, "files", "midi0-xg-bank-select.mid"))).bankSelect, true);
  equal(midiInfo(readFileSync(join(AUDIO_OUT, "files", "midi0-gs-reset.mid"))).dialect, "gs");
  equal(midiInfo(readFileSync(join(AUDIO_OUT, "files", "midi0-96-tempo-change.mid"))).dialect, "gm");
  // Types and divisions cover the ticket's list: type 0 and 1, tempo changes.
  const types = AUDIO_FILES.filter((f) => f.kind === "midi").map((f) => f.type);
  ok(types.includes(0) && types.includes(1));
  const codecs = new Set(AUDIO_FILES.filter((f) => f.kind === "wav").map((f) => f.codec));
  deepEqual([...codecs].sort(), ["ima-adpcm", "ms-adpcm", "pcm16", "pcm8"]);
  // Malformed input is an error, not a throw.
  equal(wavInfo(new Uint8Array([1, 2, 3])).ok, false);
  equal(midiInfo(new Uint8Array([1, 2, 3])).ok, false);
  const truncated = readFileSync(join(AUDIO_OUT, "files", "midi1-240-tempo-map.mid")).subarray(0, 30);
  equal(midiInfo(truncated).ok, false);
});

test("the pinned corpus files match when the corpus has been fetched", () => {
  deepEqual(checkAudioCorpus(repoRoot), []);
  const manifest = JSON.parse(readFileSync(join(AUDIO_OUT, "manifest.json"), "utf8"));
  deepEqual(manifest.corpus, CORPUS);
  // Hand-worked: Basic/Media/die.wav is 7351 frames at 8000 Hz = 55.13 ticks; fight.wav 2497 frames = 18.73 ticks.
  equal(CORPUS.wav.find((p) => p.path === "Basic/Media/die.wav").lengthTicks, wavTicks(7351, 8000));
  equal(wavTicks(7351, 8000), 55);
  equal(wavTicks(2497, 8000), 19);
  equal(wavTicks(10908, 11025), 59);
  equal(CORPUS.midi.filter((p) => p.type === 1).length >= 2, true);
  equal(CORPUS.wav.filter((p) => p.codec.includes("adpcm")).length, 3); // the corpus's three ADPCM files
});

test("board-music-boot: start bank, queued effects, same-file carry-on, silence and unknown length", () => {
  const boot = theCase("board-music-boot", "boot-board-music");
  deepEqual(kinds(boot, 0), ["soundfont.set", "media.play/music#0"]);
  deepEqual(cuesAt(boot, 0).map((q) => q.cueId), [1, 2]);
  deepEqual(cuesAt(boot, 0)[0], { cueId: 1, tick: 0, kind: "soundfont.set", track: null, voice: null, asset: null, loop: null, flags: null, positionTicks: null, volume: null, targetVolume: null, durationTicks: null });
  deepEqual(cuesAt(boot, 0)[1], { cueId: 2, tick: 0, kind: "media.play", track: "music", voice: 0, asset: "media/town.mid", loop: true, flags: 1, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null });
  deepEqual(trackAt(boot, 5, "music").slice(0, 6), ["music", "playing", 1, "media/town.mid", 5, 40]);
  equal(boot.end.cueId, 3);

  const queued = theCase("board-music-boot", "queued-before-applier");
  deepEqual(rowAt(queued, 0).tr, []);
  deepEqual(rowAt(queued, 1).tr, []);
  deepEqual(kinds(queued, 2), ["soundfont.set", "media.play/music#0", "media.play/sfx#0", "media.stop/music#0", "media.play/music#0"]);
  deepEqual(cuesAt(queued, 2).map((q) => [q.cueId, q.tick]), [[1, 2], [2, 2], [3, 2], [4, 2], [5, 2]]);
  equal(facts(queued, "same-file")[0].action, "ignored"); // the post-registration door.wav finds the drained one playing

  const different = theCase("board-music-boot", "next-board-different-music");
  deepEqual(kinds(different, 10), ["media.stop/music#0", "media.play/music#0"]);
  equal(posAt(different, 10, "music"), 0);

  const same = theCase("board-music-boot", "next-board-same-music-carries-on");
  deepEqual(kinds(same, 10), []);
  equal(facts(same, "same-file")[0].action, "carry-on");
  equal(posAt(same, 13, "music"), 13);

  const silence = theCase("board-music-boot", "board-without-music-silences");
  deepEqual(kinds(silence, 10), ["media.stop/music#0"]);
  deepEqual(rowAt(silence, 11).tr, []); // the file is cleared: nothing for the music virtual to show
  deepEqual(kinds(silence, 14), ["media.play/music#0"]);

  const stopped = theCase("board-music-boot", "stopped-music-restarts-on-board-entry");
  deepEqual(allCues(stopped).map((q) => q.kind), ["soundfont.set", "media.play", "media.stop", "media.play"]);
  equal(allCues(stopped)[3].tick, 10);
  equal(posAt(stopped, 11, "music"), 1);

  const unknown = theCase("board-music-boot", "unknown-length-music");
  deepEqual(diags(unknown), [[0, "media.asset-format"]]);
  deepEqual(trackAt(unknown, 9, "music").slice(4, 6), [9, null]);
});

test("animation-frame-sfx: frame sounds are one-shot voices on the sfx track", () => {
  const frames = theCase("animation-frame-sfx", "frame-sounds-replace-on-the-one-voice-sfx-track");
  deepEqual(kinds(frames, 2), ["media.play/sfx#0"]);
  deepEqual(kinds(frames, 5), ["media.stop/sfx#0", "media.play/sfx#0"]); // different file replaces
  equal(facts(frames, "same-file")[0].t, 7); // hit.wav again while hit.wav plays is ignored
  deepEqual(finishes(frames), [[11, "sfx", 0], [26, "sfx", 0]]); // the sounds at 2, 14 and 20 are each replaced before their end ticks (12, 20, 30)
  deepEqual(kinds(frames, 14), ["media.play/sfx#0"]); // 14 > 11: it had finished
  deepEqual(kinds(frames, 20), ["media.stop/sfx#0", "media.play/sfx#0", "media.stop/sfx#0", "media.play/sfx#0"]); // post order within a tick
  const stop = theCase("animation-frame-sfx", "wavstop-stops-a-frame-sound");
  deepEqual(kinds(stop, 3), ["media.stop/sfx#0"]);
  deepEqual(rowAt(stop, 3).ev.map((e) => e.e), ["legacy"]);
  const ui = theCase("animation-frame-sfx", "menu-sounds-go-to-ui-and-overlap");
  deepEqual(kinds(ui, 2), ["media.play/ui#1"]); // same blip overlaps on the next free ui voice
  deepEqual(kinds(ui, 3), ["media.stop/sfx#0"]);
  equal(trackAt(ui, 3, "ui")[1], "playing");
  const two = theCase("animation-frame-sfx", "two-sfx-voices-when-the-author-raises-the-count");
  deepEqual(kinds(two, 2), ["media.play/sfx#1"]);
  deepEqual(kinds(two, 3), ["media.stop/sfx#0", "media.play/sfx#0"]); // oldest start (tick 1) is stolen
  const vol = theCase("animation-frame-sfx", "track-volume-scales-frame-sounds");
  deepEqual(rowAt(vol, 3).bus, [["sfx", 50, null]]);
  equal(cuesAt(vol, 2)[0].volume, 100);
});

test("track-transport: pause holds the position, resume continues it, stop retains file and flags", () => {
  const c = theCase("track-transport", "play-pause-resume-stop");
  deepEqual(allCues(c).map((q) => [q.tick, q.kind]).slice(1), [[2, "media.play"], [6, "media.pause"], [9, "media.resume"], [15, "media.stop"], [20, "media.play"]]);
  for (const t of [6, 7, 8]) equal(trackAt(c, t, "music")[1] === "paused" && posAt(c, t, "music"), 4);
  equal(posAt(c, 9, "music"), 4);
  equal(posAt(c, 10, "music"), 5);
  equal(voiceAt(c, 9, "music")[5], 5); // a new startTick keeps the position continuous
  deepEqual(trackAt(c, 15, "music"), ["music", "stopped", 1, "media/song.mid", 0, null, []]);
  equal(posAt(c, 20, "music"), 0);
  const kept = theCase("track-transport", "stop-retains-file-and-flags");
  deepEqual(trackAt(kept, 5, "music"), ["music", "stopped", 1, "media/song.mid", 0, null, []]);
  deepEqual(trackAt(kept, 5, "sfx"), ["sfx", "stopped", 0, "media/sting.wav", 0, null, []]);
  const seek = theCase("track-transport", "seek-clamps-wraps-and-rounds");
  deepEqual(allCues(seek).filter((q) => q.kind === "media.seek").map((q) => [q.tick, q.positionTicks]), [[3, 15], [4, 0], [6, 15], [9, 2], [12, 20]]);
  deepEqual(finishes(seek), [[8, "sfx", 0], [12, "sfx", 0]]); // 3 - 15 + 20 = 8, and a clamped seek finishes at once
  equal(posAt(seek, 6, "music"), 15);
  const bad = theCase("track-transport", "diagnostics-leave-state-untouched");
  deepEqual(diags(bad), [[1, "media.asset-missing"], [2, "media.unknown-track"], [3, "media.unknown-voice"], [4, "media.asset-format"], [5, "media.asset-length"], [6, "media.invalid-time"]]);
  equal(bad.end.cueId, 3); // the start bank and the one play that was allowed
});

test("loop-and-end-ticks: endTick = startTick + length, pass boundaries, loop flag in place", () => {
  const one = theCase("loop-and-end-ticks", "one-shot-end-tick");
  deepEqual(voiceAt(one, 10, "sfx"), [0, "playing", 2, 0, 100, 10, 0, 35, 0, null]);
  equal(posAt(one, 34, "sfx"), 24);
  deepEqual(rowAt(one, 35).tr[0].slice(0, 2), ["sfx", "stopped"]);
  deepEqual(cuesAt(one, 35).map((q) => [q.kind, q.tick, q.track, q.voice]), [["media.stop", 35, "sfx", 0]]);
  deepEqual(finishes(one), [[35, "sfx", 0]]);

  const loop = theCase("loop-and-end-ticks", "loop-pass-boundaries");
  equal(voiceAt(loop, 14, "ambience")[6], 11);
  equal(voiceAt(loop, 15, "ambience")[6], 0);
  equal(voiceAt(loop, 26, "ambience")[6], 11);
  equal(voiceAt(loop, 27, "ambience")[6], 0);
  deepEqual(wakes(loop), [[15, 1], [27, 2]]);
  deepEqual(finishes(loop), []);

  const off = theCase("loop-and-end-ticks", "loop-off-finishes-the-current-pass");
  deepEqual(cuesAt(off, 4).map((q) => [q.kind, q.loop, q.flags]), [["media.flags", false, 0]]);
  deepEqual(finishes(off), [[12, "ambience", 0]]);
  equal(voiceAt(off, 11, "ambience")[7], 12);

  const on = theCase("loop-and-end-ticks", "loop-on-extends-a-one-shot");
  equal(voiceAt(on, 24, "sfx")[6], 24);
  equal(voiceAt(on, 25, "sfx")[6], 0);
  equal(voiceAt(on, 25, "sfx")[7], null);
  deepEqual(finishes(on), []);

  const authored = theCase("loop-and-end-ticks", "end-ticks-from-authored-files");
  deepEqual(finishes(authored), [[5, "sfx", 0], [11, "sfx", 0], [14, "ambience", 2], [15, "ambience", 1], [15, "ambience", 3], [30, "ambience", 0]]);
  deepEqual([0, 1, 2, 3].map((i) => voiceAt(authored, 4, "ambience", i)[7]), [30, 15, 14, 15]);
  ok(Object.values(authored.setup.assets).some((a) => a.authored === "files/pcm8-half-tick.wav"));

  const unknown = theCase("loop-and-end-ticks", "unknown-length-never-ends");
  deepEqual(voiceAt(unknown, 8, "sfx").slice(6, 9), [6, null, 0]);
  deepEqual(finishes(unknown), []);
  deepEqual(kinds(unknown, 12), ["media.stop/sfx#0"]);

  const bad = theCase("loop-and-end-ticks", "loop-plus-wait-is-diagnosed");
  deepEqual(diags(bad), [[1, "media.wait-loop"]]);
  equal(allCues(bad).length, 1);
  equal(facts(bad, "wait").length, 0);
});

test("same-file-rules: carry-on, restart, replace and the one-voice versus multi-voice split", () => {
  const carry = theCase("same-file-rules", "music-same-file-carries-on");
  equal(carry.end.cueId, 3); // the start bank and the one play
  deepEqual(facts(carry, "same-file").map((f) => [f.t, f.action]), [[8, "carry-on"], [12, "carry-on"]]);
  equal(posAt(carry, 14, "music"), 14);
  const restart = theCase("same-file-rules", "music-restart-flag-restarts");
  deepEqual(kinds(restart, 8), ["media.stop/music#0", "media.play/music#0"]);
  deepEqual([posAt(restart, 8, "music"), posAt(restart, 9, "music")], [0, 1]);
  const other = theCase("same-file-rules", "music-different-file-replaces");
  deepEqual(cuesAt(other, 8).map((q) => [q.kind, q.asset]), [["media.stop", null], ["media.play", "media/other.mid"]]);
  const again = theCase("same-file-rules", "stopped-music-plays-again");
  deepEqual(allCues(again).map((q) => q.kind), ["soundfont.set", "media.play", "media.stop", "media.play"]);
  const sfx = theCase("same-file-rules", "sfx-same-file-ignored-and-replaced");
  deepEqual(facts(sfx, "same-file").map((f) => [f.t, f.action]), [[3, "ignored"]]);
  deepEqual(kinds(sfx, 5), ["media.stop/sfx#0", "media.play/sfx#0"]);
  deepEqual(kinds(sfx, 6), ["media.stop/sfx#0", "media.play/sfx#0"]); // tkMD_RESTART of the same file
  deepEqual(finishes(sfx), [[16, "sfx", 0]]); // restarted at 6, 10 ticks long
  const multi = theCase("same-file-rules", "multi-voice-overlaps-the-same-file");
  deepEqual(kinds(multi, 2), ["media.play/ui#1"]);
  deepEqual(trackAt(multi, 2, "ui")[6].map((v) => [v[0], v[1]]), [[0, "playing"], [1, "playing"]]);
  const fin = theCase("same-file-rules", "finished-one-shot-plays-again");
  deepEqual(finishes(fin), [[5, "sfx", 0], [12, "sfx", 0]]);
  deepEqual(kinds(fin, 7), ["media.play/sfx#0"]);
});

test("voices-and-stealing: lowest free, then priority, then oldest start, then lowest index", () => {
  const counts = theCase("voices-and-stealing", "default-voice-counts");
  deepEqual(rowAt(counts, 0).cfg, [["music", 1], ["sfx", 1], ["ambience", 4], ["voice", 2], ["ui", 4]]);
  const oldest = theCase("voices-and-stealing", "lowest-free-then-steal-oldest");
  deepEqual([1, 2, 3].map((t) => cuesAt(oldest, t)[0].voice), [0, 1, 2]);
  deepEqual(kinds(oldest, 4), ["media.stop/fx#0", "media.play/fx#0"]);
  deepEqual(kinds(oldest, 5), ["media.stop/fx#1", "media.play/fx#1"]);
  const prio = theCase("voices-and-stealing", "steal-lowest-priority-first");
  deepEqual(facts(prio, "steal").map((s) => [s.t, s.voice]), [[4, 1], [5, 2]]);
  const ties = theCase("voices-and-stealing", "steal-ties-go-to-the-lowest-index");
  deepEqual(facts(ties, "steal").map((s) => [s.t, s.voice]), [[2, 0]]);
  const paused = theCase("voices-and-stealing", "paused-voices-stay-active-for-allocation");
  deepEqual(facts(paused, "steal").map((s) => [s.t, s.voice]), [[4, 0]]); // the paused voice 0 has the oldest start
  const freed = theCase("voices-and-stealing", "freed-slot-is-reused-lowest-first");
  deepEqual(kinds(freed, 5), ["media.play/fx#1"]);
  equal(facts(freed, "steal").length, 0);
  const wake = theCase("voices-and-stealing", "steal-wakes-the-displaced-wait");
  deepEqual(facts(wake, "wait").map((w) => [w.t, w.thread, w.endTick]), [[1, 1, 31]]);
  deepEqual(wakes(wake), [[4, 1]]); // stolen at 3, observed in the waits phase of 4
  const overlap = theCase("voices-and-stealing", "same-file-overlaps-on-multi-voice");
  deepEqual([1, 2, 3].map((t) => cuesAt(overlap, t)[0].voice), [0, 1, 2]);
  const limits = theCase("voices-and-stealing", "track-creation-limits");
  deepEqual(diags(limits), [[0, "media.invalid-track-name"], [0, "media.voice-count"], [1, "media.track-limit"]]);
  equal(rowAt(limits, 1).cfg.length, 16);
  ok(rowAt(limits, 0).cfg.some((x) => x[0] === "effects" && x[1] === 3)); // Effects folds to lower case
  const cap = theCase("voices-and-stealing", "voice-cap-and-shrink-below-live-voice");
  deepEqual(diags(cap), [[0, "media.voice-cap"], [1, "media.voice-cap"], [2, "media.voice-count"]]);
  ok(rowAt(cap, 2).cfg.some((x) => x[0] === "bulk" && x[1] === 3));
});

test("fades: nearest integer with halves up, clock frozen by pause, zero keeps the voice alive", () => {
  const lin = theCase("fades", "linear-half-up");
  deepEqual([2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => volAt(lin, t, "music")), [100, 88, 75, 63, 50, 38, 25, 13, 0]);
  deepEqual(cuesAt(lin, 2).map((q) => [q.kind, q.volume, q.targetVolume, q.durationTicks, q.voice]), [["media.fade", 100, 0, 8, 0]]);
  equal(voiceAt(lin, 9, "music")[9] !== null, true);
  equal(voiceAt(lin, 10, "music")[9], null); // the descriptor is cleared at d = D
  equal(trackAt(lin, 13, "music")[1], "playing");
  const again = theCase("fades", "new-fade-replaces-from-the-current-integer");
  deepEqual(cuesAt(again, 5).map((q) => [q.volume, q.targetVolume, q.durationTicks]), [[63, 100, 4]]);
  deepEqual([5, 6, 7, 8, 9].map((t) => volAt(again, t, "music")), [63, 72, 82, 91, 100]);
  const pause = theCase("fades", "pause-freezes-the-fade-clock");
  deepEqual([5, 6, 9, 10, 11, 12].map((t) => volAt(pause, t, "music")), [63, 63, 63, 63, 50, 38]);
  equal(volAt(pause, 15, "music"), 0);
  equal(voiceAt(pause, 15, "music")[9], null);
  equal(voiceAt(pause, 10, "music")[9][2], 7); // fade start 2 + 5 paused ticks
  const zero = theCase("fades", "fade-to-zero-keeps-the-voice-alive");
  deepEqual([1, 2, 3, 4].map((t) => volAt(zero, t, "music")), [100, 67, 33, 0]); // 50 ms = 3 ticks
  equal(trackAt(zero, 7, "music")[1], "playing");
  deepEqual(kinds(zero, 8), ["media.stop/music#0"]);
  const instant = theCase("fades", "zero-duration-fade-is-an-immediate-set");
  deepEqual(cuesAt(instant, 3).map((q) => [q.volume, q.targetVolume, q.durationTicks]), [[100, 40, 0]]);
  equal(volAt(instant, 3, "music"), 40);
  equal(voiceAt(instant, 3, "music")[9], null);
  const bus = theCase("fades", "track-volume-fade-and-set");
  deepEqual([3, 4, 5].map((t) => rowAt(bus, t).bus[0][1]), [91, 83, 74]);
  deepEqual(rowAt(bus, 6).bus, [["music", 80, null]]); // mediaVolume cancels the ramp
  deepEqual(cuesAt(bus, 7).map((q) => [q.kind, q.voice, q.volume]), [["media.volume", 0, 55]]);
  deepEqual(diags(bus), [[8, "media.invalid-volume"], [8, "media.invalid-time"]]);
  const duck = theCase("fades", "stinger-and-manual-duck-apply-in-source-order");
  deepEqual(kinds(duck, 3), ["media.play/ui#0", "media.fade/music"]);
  equal(cuesAt(duck, 3)[1].durationTicks, 15);
  equal(cuesAt(duck, 3)[1].voice, null);
});

test("synced-start: the position is the source position modulo the destination length", () => {
  const spec = theCase("synced-start", "spec-example-position-17-of-10");
  equal(posAt(spec, 137, "music"), 17);
  deepEqual(cuesAt(spec, 137).map((q) => [q.kind, q.track, q.positionTicks, q.tick]), [["media.play", "ambience", 7, 137]]);
  equal(voiceAt(spec, 137, "ambience")[5], 130);
  deepEqual([137, 139, 140, 141, 150].map((t) => posAt(spec, t, "ambience")), [7, 9, 0, 1, 0]);
  const aligned = theCase("synced-start", "equal-lengths-stay-aligned");
  for (let t = 5; t < 24; t += 1) equal(posAt(aligned, t, "ambience"), posAt(aligned, t, "ui"), `tick ${t}`);
  equal(posAt(aligned, 20, "ui"), 0);
  const held = theCase("synced-start", "paused-source-supplies-its-held-position");
  deepEqual([posAt(held, 9, "ambience"), posAt(held, 9, "ui")], [6, 6]);
  equal(trackAt(held, 9, "ambience")[1], "paused");
  equal(trackAt(held, 10, "ui")[1], "playing");
  const unequal = theCase("synced-start", "unequal-lengths-are-deterministic");
  equal(posAt(unequal, 37, "sfx"), 37);
  deepEqual(finishes(unequal), [[40, "sfx", 0]]);
  const bad = theCase("synced-start", "sync-diagnostics-fallback-starts-at-zero");
  deepEqual(diags(bad), [[2, "media.sync-source"], [3, "media.sync-source"], [4, "media.sync-source"], [4, "media.asset-format"]]);
  deepEqual(allCues(bad).filter((cue) => cue.kind === "media.play" && cue.track === "ui").map((cue) => [cue.tick, cue.track, cue.positionTicks]), [[2, "ui", 0], [3, "ui", 0], [4, "ui", 0]]);
  equal(bad.end.cueId, 6);
});

test("late-start-catch-up: cue-player arithmetic on the cues, hand-worked", () => {
  const worked = theCase("late-start-catch-up", "worked-example-600-tick-song");
  deepEqual(worked.runner[0].ready.map((r) => [r.at, r.positionTicks]), [[100, 0], [190, 90], [760, 60]]);
  const loop = theCase("late-start-catch-up", "looping-music-catches-up");
  deepEqual(loop.runner[0].ready.map((r) => r.positionTicks), [0, 0, 10, 0, 12]);
  const sfx = theCase("late-start-catch-up", "one-shot-sfx-is-dropped-when-late");
  deepEqual(sfx.runner[0].ready.map((r) => [r.at, r.action, r.reason ?? r.positionTicks]), [[10, "play", 0], [12, "play", 2], [24, "play", 14], [25, "stop", "late"], [49, "stop", "late"]]);
  deepEqual(sfx.runner[1].ready.map((r) => [r.at, r.action, r.reason ?? r.positionTicks]), [[21, "play", 11], [22, "stop", "finished"], [25, "stop", "late"]]);
  const music = theCase("late-start-catch-up", "music-and-loops-are-never-dropped");
  deepEqual(music.runner[0].ready.map((r) => [r.action, r.reason ?? r.positionTicks]), [["play", 30], ["play", 39], ["stop", "finished"], ["stop", "finished"]]);
  equal(music.runner[1].ready[0].positionTicks, 4); // 100 mod 12
  const seekFade = theCase("late-start-catch-up", "seek-and-fade-cues-late");
  deepEqual(seekFade.runner[0].ready.map((r) => r.positionTicks), [30, 0, 7]); // 30 + 10 = 40 mod 40; 30 + 17 = 47 mod 40
  deepEqual(seekFade.runner[1].ready.map((r) => (r.action === "fade" ? [r.from, r.durationTicks] : [r.action, r.volume])), [[100, 30], [80, 20], [70, 15], ["setVolume", 40], ["setVolume", 40]]);
  const restored = theCase("late-start-catch-up", "restored-voice-cue-is-past-due");
  const resumed = allCues(restored).filter((q) => q.kind === "media.play" && q.cueId > 5);
  deepEqual(resumed.map((q) => [q.track, q.tick, q.positionTicks]), [["music", 20, 0], ["sfx", 14, 0], ["ambience", 12, 0]]);
  deepEqual(restored.runner.map((r) => r.ready[0].positionTicks), [0, 8, 6]);
});

test("media-wait-suspend: waits wake on the end tick, are held by pause, and wake on stop or replacement", () => {
  const end = theCase("media-wait-suspend", "wait-wakes-on-the-end-tick");
  deepEqual(facts(end, "wait").map((w) => [w.t, w.endTick]), [[2, 12]]);
  deepEqual(wakes(end), [[12, 1]]);
  deepEqual(rowAt(end, 12).ev.map((e) => e.e), ["wake", "finished"]); // the waits phase precedes the audio phase
  const pause = theCase("media-wait-suspend", "pause-suspends-the-wait-and-resume-continues-it");
  deepEqual(wakes(pause), [[16, 1]]); // end tick 12, paused for 4 ticks
  equal(voiceAt(pause, 9, "sfx")[7], 16);
  const stop = theCase("media-wait-suspend", "stop-wakes-at-the-next-waits-phase");
  deepEqual(wakes(stop), [[6, 1]]);
  const replace = theCase("media-wait-suspend", "replacing-the-voice-wakes-the-old-wait");
  deepEqual(wakes(replace), [[5, 1]]);
  const plain = theCase("media-wait-suspend", "mediaWait-on-a-playing-one-shot");
  deepEqual(wakes(plain), [[20, 1]]);
  const two = theCase("media-wait-suspend", "two-threads-wake-in-ascending-thread-id");
  deepEqual(wakes(two), [[11, 1], [11, 3]]);
  const paused = theCase("media-wait-suspend", "stop-while-paused-wakes-the-wait");
  deepEqual(wakes(paused), [[9, 1]]);
  const bad = theCase("media-wait-suspend", "wait-diagnostics-do-not-park");
  deepEqual(diags(bad), [[1, "media.asset-format"], [2, "media.asset-length"], [2, "media.unknown-track"]]);
  equal(facts(bad, "wait").length, 0);
});

test("settings-versus-save: load restores playback in track order and leaves settings alone", () => {
  const c = theCase("settings-versus-save", "save-and-load-restore-playback-not-settings");
  deepEqual(cuesAt(c, 20).map((q) => [q.kind, q.track, q.asset, q.tick, q.positionTicks]), [
    ["soundfont.set", null, "media/town.sf2", 20, null],
    ["media.play", "music", "media/song.mid", 20, 0],
    ["media.play", "sfx", "media/hit.wav", 14, 0],
    ["media.play", "ambience", "media/loop.wav", 12, 0],
  ]);
  deepEqual([posAt(c, 20, "music"), posAt(c, 20, "sfx"), posAt(c, 20, "ambience")], [0, 6, 8]);
  deepEqual([rowAt(c, 20).master, rowAt(c, 20).bus], [30, [["music", 90, null]]]); // the newer values, not the saved 80 and 60
  deepEqual([rowAt(c, 10).master, rowAt(c, 10).bus], [80, [["music", 60, null]]]);
  equal(rowAt(c, 19).sf === undefined, true); // reset at tick 13, before the load
  equal(rowAt(c, 20).sf, undefined); // load retains the current bank reset, not the saved script bank
  equal(cuesAt(c, 20)[0].cueId, 12); // eleven cues were issued before the load; ids are never reused
  const stopped = theCase("settings-versus-save", "stopped-tracks-stay-stopped-after-load");
  deepEqual(cuesAt(stopped, 10).map((q) => [q.kind, q.track, q.tick]), [["soundfont.set", null, 10], ["media.play", "ambience", 5]]);
  deepEqual(trackAt(stopped, 10, "music"), ["music", "stopped", 1, "media/song.mid", 0, null, []]);
  equal(rowAt(stopped, 10).tr.some((t) => t[0] === "sfx"), true); // its file is kept, the finished voice is not
  equal(trackAt(stopped, 10, "sfx")[6].length, 0);
  const reset = theCase("settings-versus-save", "reset-leaves-audio-untouched");
  deepEqual(kinds(reset, 10), []);
  equal(rowAt(reset, 10).master, 70);
  deepEqual(rowAt(reset, 10).bus, [["sfx", 40, null]]);
  equal(rowAt(reset, 10).sf, "media/boss.sf2");
  equal(facts(reset, "same-file")[0].action, "carry-on");
  deepEqual(kinds(reset, 12), ["media.stop/music#0", "media.play/music#0"]);
});

test("soundfont-setting: the 6.3 worked example's cue ids, order and values", () => {
  const c = theCase("soundfont-setting", "spec-worked-example-scaled");
  deepEqual(allCues(c).slice(0, 6).map((q) => [q.cueId, q.tick, q.kind]), [[1, 0, "soundfont.set"], [2, 0, "media.play"], [3, 10, "media.stop"], [4, 12, "media.play"], [5, 20, "media.stop"], [6, 30, "media.volume"]]);
  deepEqual(allCues(c).slice(6).map((q) => [q.cueId, q.tick, q.kind, q.track, q.asset]), [
    [7, 60, "soundfont.set", null, "media/boss.sf2"],
    [8, 60, "media.play", "music", "media/boss.mid"],
    [9, 90, "soundfont.set", null, "media/town.sf2"],
  ]);
  equal(rowAt(c, 89).sf, "media/boss.sf2");
  equal(rowAt(c, 91).sf, undefined);
  equal(allCues(c)[0].asset, "media/town.sf2");
  const none = theCase("soundfont-setting", "no-default-bank-is-null");
  deepEqual(allCues(none).map((q) => q.asset), [null, "media/boss.sf2", null]);
  const same = theCase("soundfont-setting", "unchanged-bank-still-emits");
  deepEqual(allCues(same).map((q) => q.asset), ["media/town.sf2", "media/boss.sf2", "media/boss.sf2", "media/town.sf2", "media/town.sf2"]);
  const bad = theCase("soundfont-setting", "invalid-names-change-nothing");
  deepEqual(diags(bad), [[1, "media.soundfont-name"], [2, "media.soundfont-missing"]]);
  deepEqual(allCues(bad).map((q) => q.asset), [null, "media/alt.sf3"]);
  const reload = theCase("soundfont-setting", "load-reemits-the-current-bank-first");
  deepEqual(kinds(reload, 8), ["soundfont.set", "media.play/music#0"]);
  equal(cuesAt(reload, 8)[0].asset, "media/town.sf2");
});

test("battle-music-handoff: battle music takes over and board return restores active music", () => {
  const c = theCase("battle-music-handoff", "battle-music-then-return");
  deepEqual(kinds(c, 6), ["media.stop/music#0", "media.play/music#0"]);
  equal(c.script[1].source, "battle");
  equal(cuesAt(c, 6)[1].asset, "media/fight.mid");
  deepEqual(kinds(c, 14), ["media.stop/music#0", "media.play/music#0"]);
  equal(c.script[2].source, "board");
  deepEqual([cuesAt(c, 14)[1].asset, cuesAt(c, 14)[1].positionTicks, cuesAt(c, 14)[1].loop], ["media/field.mid", 0, true]);
  const none = theCase("battle-music-handoff", "battle-without-music-is-silent");
  deepEqual(kinds(none, 6), []);
  deepEqual(trackAt(none, 7, "music").slice(0, 4), ["music", "playing", 1, "media/field.mid"]);
  deepEqual(allCues(none).map((q) => q.kind), ["soundfont.set", "media.play"]);
  equal(trackAt(none, 11, "music")[3], "media/field.mid");
  deepEqual(kinds(none, 12), []);
  const lost = theCase("battle-music-handoff", "in-fight-music-change-is-lost");
  equal(cuesAt(lost, 10)[1].asset, "media/other.mid");
  equal(cuesAt(lost, 14)[1].asset, "media/field.mid");
  equal(lost.script[3].source, "board");
  const same = theCase("battle-music-handoff", "same-file-battle-carries-on-and-restart-restarts");
  deepEqual(kinds(same, 6), []);
  deepEqual(kinds(same, 14), []);
  const virtual = theCase("battle-music-handoff", "music-virtual-follows-the-music-track-file");
  equal(trackAt(virtual, 8, "music")[3], "media/fight.mid");
  deepEqual(trackAt(virtual, 11, "music").slice(0, 4), ["music", "stopped", 1, "media/fight.mid"]);
  equal(trackAt(virtual, 15, "music")[3], "media/field.mid");
});

test("legacy-parity-ledger: legacy names behave as their standard calls", () => {
  const pause = theCase("legacy-parity-ledger", "mp3pause-waits-while-music-keeps-playing");
  deepEqual(wakes(pause), [[12, 1]]);
  equal(posAt(pause, 14, "music"), 14);
  const wav = theCase("legacy-parity-ledger", "wav-and-mp3-never-wait-and-play-once");
  equal(facts(wav, "wait").length, 0);
  deepEqual(kinds(wav, 3), ["media.stop/sfx#0", "media.play/sfx#0"]);
  deepEqual(finishes(wav), [[13, "sfx", 0]]);
  equal(voiceAt(wav, 4, "sfx")[8], 0); // never loops
  const slot = theCase("legacy-parity-ledger", "one-sfx-slot-replaces-or-ignores");
  deepEqual(facts(slot, "same-file").map((f) => [f.t, f.action]), [[3, "ignored"]]);
  deepEqual(kinds(slot, 5), ["media.stop/sfx#0", "media.play/sfx#0"]);
  const stop = theCase("legacy-parity-ledger", "wavstop-leaves-music-alone");
  deepEqual(kinds(stop, 3), ["media.stop/sfx#0"]);
  equal(trackAt(stop, 5, "music")[1], "playing");
  const carry = theCase("legacy-parity-ledger", "midiplay-carries-on-and-stop-retains");
  deepEqual(facts(carry, "same-file").map((f) => [f.t, f.action]), [[5, "carry-on"]]);
  deepEqual(trackAt(carry, 9, "music"), ["music", "stopped", 1, "media/town.mid", 0, null, []]);
  deepEqual(kinds(carry, 10), ["media.play/music#0"]);
  const alias = theCase("legacy-parity-ledger", "aliases-map-to-the-standard-calls");
  deepEqual(facts(alias, "legacy").map((f) => f.as), [
    'mediaPlay(file, "music", tkMD_LOOP)', 'mediaPlay(file, "music", tkMD_LOOP)', 'mediaPlay(file, "music", tkMD_LOOP)',
    'mediaStop("music")', 'mediaStop("music")', 'mediaStop("music")', 'mediaPlay(file, "sfx", tkMD_ONCE)', 'mediaStop("sfx")',
    'mediaPlay(file, "sfx", tkMD_ONCE)', 'mediaPlay(file, "sfx", tkMD_ONCE | tkMD_WAIT)', "master script volume",
  ]);
  deepEqual(facts(alias, "no-op").map((f) => f.t), [4, 5]); // stopping a stopped track
  deepEqual(wakes(alias), [[19, 1]]);
  const vol = theCase("legacy-parity-ledger", "setvolume-is-a-script-setting");
  deepEqual(cuesAt(vol, 2).map((q) => [q.kind, q.track, q.volume]), [["media.volume", null, 0]]);
  equal(rowAt(vol, 7).master, 0);
  equal(trackAt(vol, 7, "music")[1], "playing"); // quiet but audible
  equal(rowAt(vol, 1).master, undefined); // starts at 100
  const board = theCase("legacy-parity-ledger", "board-entry-silence-and-replay");
  deepEqual(allCues(board).map((q) => q.kind), ["soundfont.set", "media.play", "media.stop", "media.play"]);
});

test("legacy-parity-ledger: every round-8 and round-9 fact appears once and resolves to a case", () => {
  const doc = load("legacy-parity-ledger");
  const ids = [...Array.from({ length: 19 }, (_, i) => `Q${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `M${i + 1}`)];
  deepEqual(doc.ledger.map((r) => r.id), ids);
  for (const entry of doc.ledger) {
    ok(entry.fact.length > 20 && entry.disposition.length >= 5, `${entry.id} has text`);
    if (entry.where === null) {
      ok(["runner", "platform"].includes(entry.kind), `${entry.id} has no timeline only when it is a runner or platform rule`);
    } else {
      const found = load(entry.where.scene).cases.find((x) => x.name === entry.where.case);
      ok(found, `${entry.id} resolves to ${entry.where.scene}/${entry.where.case}`);
    }
  }
  deepEqual(doc.ledger.filter((r) => r.kind === "unresolved").map((r) => r.id), ["Q14"]);
  deepEqual(doc.ledger.filter((r) => r.kind === "departure").map((r) => r.id), ["Q11"]);
});

test("video-restarts-music: stop at the call, hold, restart from zero at the next consumed tick", () => {
  const c = theCase("video-restarts-music", "video-stops-then-restarts-from-zero");
  deepEqual(kinds(c, 6), ["media.stop/music#0"]);
  deepEqual(facts(c, "video-request").map((f) => [f.t, f.reqId, f.presentation]), [[6, 1, "full"]]);
  deepEqual(rowAt(c, 7).ev.map((e) => e.e), ["video-ended", "wake"]);
  deepEqual(cuesAt(c, 7).map((q) => [q.kind, q.positionTicks, q.loop, q.tick]), [["media.play", 0, true, 7]]);
  equal(posAt(c, 6, "ambience") + 1, posAt(c, 7, "ambience")); // time was held: no jump
  deepEqual(wakes(c), [[7, 1]]);
  const stopped = theCase("video-restarts-music", "stopped-music-restarts-anyway");
  deepEqual(kinds(stopped, 6), []);
  deepEqual(kinds(stopped, 7), ["media.play/music#0"]);
  const paused = theCase("video-restarts-music", "paused-music-restarts");
  deepEqual(kinds(paused, 6), ["media.stop/music#0"]);
  equal(posAt(paused, 7, "music"), 0);
  const none = theCase("video-restarts-music", "no-retained-file-plays-nothing");
  equal(allCues(none).some((q) => q.kind === "media.play" && q.track === "music"), false);
  deepEqual(wakes(none), [[4, 1]]);
  const wins = theCase("video-restarts-music", "a-stop-on-the-resumed-tick-wins");
  deepEqual(kinds(wins, 7), ["media.play/music#0", "media.stop/music#0"]);
  equal(trackAt(wins, 7, "music")[1], "stopped");
  const missing = theCase("video-restarts-music", "missing-video-changes-nothing");
  deepEqual(diags(missing), [[4, "media.video-missing"]]);
  equal(facts(missing, "video-request").length, 0);
  equal(posAt(missing, 7, "music"), 7);
  const busy = theCase("video-restarts-music", "second-video-while-pending-is-busy");
  deepEqual(diags(busy), [[4, "media.video-busy"]]);
  deepEqual(wakes(busy), [[5, 1]]);
  const stale = theCase("video-restarts-music", "stale-reply-is-ignored");
  deepEqual(facts(stale, "video-ended-ignored").map((f) => [f.t, f.reqId]), [[5, 99]]);
  deepEqual(wakes(stale), [[5, 1]]);
  equal(facts(stale, "video-request")[0].presentation, "full");
  const small = theCase("video-restarts-music", "no-retained-file-plays-nothing");
  equal(facts(small, "video-request")[0].presentation, "small");
});

test("audio-corpus table (ticket 6.5): every MIDI and WAV row matches the independent reader and its pinned bytes", () => {
  const tablePath = join(AUDIO_OUT, "..", "audio-corpus.json");
  const corpusTable = JSON.parse(readFileSync(tablePath, "utf8"));
  equal(corpusTable.schema, 1);
  const paths = corpusTable.files.map((row) => row.path);
  deepEqual(paths, [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  equal(new Set(paths).size, paths.length);
  // The oracle's own pins are rows of the table.
  for (const pin of [...CORPUS.wav, ...CORPUS.midi]) {
    const row = corpusTable.files.find((candidate) => candidate.path === pin.path);
    ok(row, `${pin.path} is in the table`);
    equal(row.sha256, pin.sha256);
    equal(row.lengthTicks, pin.lengthTicks);
  }
  const base = join(repoRoot, "fixtures", "legacy");
  if (!existsSync(base)) return; // fetched at test time; the rows are only checkable when present
  for (const row of corpusTable.files) {
    const bytes = readFileSync(join(base, row.path));
    equal(createHash("sha256").update(bytes).digest("hex"), row.sha256, `${row.path} digest`);
    const info = row.kind === "wav" ? wavInfo(bytes) : midiInfo(bytes);
    ok(info.ok, `${row.path} parses`);
    for (const key of Object.keys(row)) {
      if (key === "path" || key === "kind" || key === "sha256") continue;
      equal(info[key], row[key], `${row.path} ${key}`);
    }
  }
});
