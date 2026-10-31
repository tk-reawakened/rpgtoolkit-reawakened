// Audio oracle scenes, part 2 (ticket 6.4): voices-and-stealing, fades, synced-start, late-start-catch-up,
// media-wait-suspend. Authored from docs/spec/engine/audio-media.md; imports nothing from packages/core.

import { LOOP, ONCE, WAIT, cmd, makeCase, music, post, pre, setup } from "./common.mjs";

const play = (t, file, track, o = {}) => cmd(t, "mediaPlay", { file, track, ...o });

export function voicesAndStealing() {
  const assets = { "a.wav": 100, "b.wav": 100, "c.wav": 100, "d.wav": 100, "e.wav": 100 };
  const fx3 = (t) => cmd(t, "mediaTrack", { name: "fx", voices: 3 });
  return {
    spec: ["media-command-family", "media-4", "audio-state", "audio-track-wait"],
    cases: [
      makeCase(
        "default-voice-counts",
        "The built-in tracks are created in the order music, sfx, ambience, voice, ui with 1, 1, 4, 2 and 4 voices (12 of the 32 slots); the cfg fact lists them.",
        setup({ assets }),
        [],
        2,
      ),
      makeCase(
        "lowest-free-then-steal-oldest",
        "On a 3-voice track plays take voices 0, 1, 2 (lowest free). With every priority equal, the 4th play steals the oldest start (voice 0, started tick 1) and the 5th steals voice 1 (started tick 2). Each steal is media.stop then media.play for that voice index.",
        setup({ assets }),
        [fx3(0), play(1, "a.wav", "fx", { priority: 1 }), play(2, "b.wav", "fx", { priority: 1 }), play(3, "c.wav", "fx", { priority: 1 }), play(4, "d.wav", "fx", { priority: 1 }), play(5, "e.wav", "fx", { priority: 1 })],
        8,
      ),
      makeCase(
        "steal-lowest-priority-first",
        "Priority is compared before age: the voice with the lowest priority is stolen even when it is the newest (tick 4 steals voice 1, priority 0). At tick 5 the lowest priority is 1, held by voices 1 and 2; the older start (voice 2) is stolen.",
        setup({ assets }),
        [fx3(0), play(1, "a.wav", "fx", { priority: 2 }), play(2, "b.wav", "fx", { priority: 0 }), play(3, "c.wav", "fx", { priority: 1 }), play(4, "d.wav", "fx", { priority: 1 }), play(5, "e.wav", "fx", { priority: 5 })],
        8,
      ),
      makeCase(
        "steal-ties-go-to-the-lowest-index",
        "Equal priority and equal start tick: the lowest voice index is stolen.",
        setup({ assets }),
        [fx3(0), play(1, "a.wav", "fx"), play(1, "b.wav", "fx"), play(1, "c.wav", "fx"), play(2, "d.wav", "fx")],
        5,
      ),
      makeCase(
        "paused-voices-stay-active-for-allocation",
        "A paused voice is not free: with voice 0 paused and voice 1 playing, a third play steals the oldest start, which is the paused voice 0 (it keeps its stale start tick).",
        setup({ assets }),
        [cmd(0, "mediaTrack", { name: "fx", voices: 2 }), play(1, "a.wav", "fx"), play(2, "b.wav", "fx"), cmd(3, "mediaPause", { track: "fx", voice: 0 }), play(4, "c.wav", "fx")],
        7,
      ),
      makeCase(
        "freed-slot-is-reused-lowest-first",
        "mediaStop on an explicit voice frees only that slot; the next play with no voice named takes the lowest free index (1), not a steal.",
        setup({ assets }),
        [fx3(0), play(1, "a.wav", "fx"), play(1, "b.wav", "fx"), play(1, "c.wav", "fx"), cmd(4, "mediaStop", { track: "fx", voice: 1 }), play(5, "d.wav", "fx")],
        8,
      ),
      makeCase(
        "steal-wakes-the-displaced-wait",
        "Thread 1 plays voice 0 with `wait: true` and parks; thread 2's play steals voice 0 at tick 3 (the voice's cue id changes), so thread 1 wakes at the next waits phase, tick 4, although its sound had 28 ticks left.",
        setup({ assets: { ...assets, "a.wav": 30 } }),
        [cmd(0, "mediaTrack", { name: "fx", voices: 2 }), play(1, "a.wav", "fx", { flags: WAIT, thread: 1 }), play(2, "b.wav", "fx"), play(3, "c.wav", "fx")],
        7,
      ),
      makeCase(
        "same-file-overlaps-on-multi-voice",
        "Three plays of one file on a 4-voice track take voices 0, 1 and 2 and all run: no same-file rule on a multi-voice track.",
        setup({ assets }),
        [play(1, "a.wav", "ambience"), play(2, "a.wav", "ambience"), play(3, "a.wav", "ambience")],
        6,
      ),
      makeCase(
        "track-creation-limits",
        "Names are ASCII letters, digits, underscore, dot and hyphen, 1 to 32 characters, folded to lower case (Effects becomes effects). The 5 built-ins plus 11 more make 16 tracks; a 17th is media.track-limit. A voice count below 1 is media.voice-count.",
        setup({ assets }),
        [
          cmd(0, "mediaTrack", { name: "Effects", voices: 3 }),
          cmd(0, "mediaTrack", { name: "bad name!", voices: 1 }),
          cmd(0, "mediaTrack", { name: "zero", voices: 0 }),
          ...Array.from({ length: 10 }, (_, i) => cmd(1, "mediaTrack", { name: `t${i + 1}`, voices: 1 })),
          cmd(1, "mediaTrack", { name: "seventeenth", voices: 1 }),
        ],
        3,
      ),
      makeCase(
        "voice-cap-and-shrink-below-live-voice",
        "The sum of configured voices is at most 32: bulk (20) brings it from 12 to 32, so one more voice elsewhere and growing bulk to 21 are media.voice-cap. Shrinking a track below a live voice index (live voices 0 to 2, shrink to 2) is media.voice-count and leaves it unchanged; shrinking to 3, which keeps every live voice, is allowed.",
        setup({ assets }),
        [
          cmd(0, "mediaTrack", { name: "bulk", voices: 20 }),
          cmd(0, "mediaTrack", { name: "extra", voices: 1 }),
          cmd(1, "mediaTrack", { name: "bulk", voices: 21 }),
          play(1, "a.wav", "bulk"),
          play(1, "b.wav", "bulk"),
          play(1, "c.wav", "bulk"),
          cmd(2, "mediaTrack", { name: "bulk", voices: 2 }),
          cmd(2, "mediaTrack", { name: "bulk", voices: 3 }),
        ],
        4,
      ),
    ],
  };
}

export function fades() {
  const assets = { "song.mid": 60, "sting.wav": 20, "stinger.mid": 12 };
  const start = cmd(0, "mediaPlay", { file: "song.mid" });
  return {
    spec: ["media-command-family", "audio-cue-contract", "audio-lifecycle"],
    cases: [
      makeCase(
        "linear-half-up",
        "mediaFade(music, 0, 125 ms, voice 0) is 7.5 ticks, rounded half-up to 8. The volume is the nearest integer to 100 - 100 d / 8 with halves up: 88, 75, 63, 50, 38, 25, 13, 0 for d = 1..8. One media.fade cue carries the start volume, the target and 8 ticks; at d = 8 the descriptor is cleared and the voice is alive at volume 0.",
        setup({ assets }),
        [start, cmd(2, "mediaFade", { track: "music", percent: 0, ms: 125, voice: 0 })],
        14,
      ),
      makeCase(
        "new-fade-replaces-from-the-current-integer",
        "A second fade first evaluates the first at the current tick (63 at tick 5) and ramps from that integer: 66 ms is 3.96 ticks, 4 ticks, to 100; the fade cue's volume is 63.",
        setup({ assets }),
        [start, cmd(2, "mediaFade", { track: "music", percent: 0, ms: 125, voice: 0 }), cmd(5, "mediaFade", { track: "music", percent: 100, ms: 66, voice: 0 })],
        12,
      ),
      makeCase(
        "pause-freezes-the-fade-clock",
        "Pausing at tick 5 (3 ticks into an 8-tick fade, volume 63) freezes the volume and the fade clock; resuming at tick 10 shifts the fade start by the 5 paused ticks, so the ramp continues 63, 50, 38 ... and completes at tick 15.",
        setup({ assets }),
        [start, cmd(2, "mediaFade", { track: "music", percent: 0, ms: 125, voice: 0 }), cmd(5, "mediaPause", { track: "music" }), cmd(10, "mediaResume", { track: "music" })],
        18,
      ),
      makeCase(
        "fade-to-zero-keeps-the-voice-alive",
        "A voice faded to 0 stays playing and silent; only an explicit mediaStop ends it.",
        setup({ assets }),
        [start, cmd(1, "mediaFade", { track: "music", percent: 0, ms: 50, voice: 0 }), cmd(8, "mediaStop", { track: "music" })],
        10,
      ),
      makeCase(
        "zero-duration-fade-is-an-immediate-set",
        "A zero-duration fade sets the volume at once and leaves no descriptor; its cue is still a media.fade with durationTicks 0.",
        setup({ assets }),
        [start, cmd(3, "mediaFade", { track: "music", percent: 40, ms: 0, voice: 0 })],
        6,
      ),
      makeCase(
        "track-volume-fade-and-set",
        "mediaFade without a voice ramps the track's bus volume (100 to 30 over 8 ticks: 91, 81, 70, ...); mediaVolume sets a track or a voice volume at once and cancels a running fade; percent outside 0..100 and a negative time are diagnostics that change nothing.",
        setup({ assets }),
        [
          start,
          cmd(2, "mediaFade", { track: "music", percent: 30, ms: 125 }),
          cmd(6, "mediaVolume", { track: "music", percent: 80 }),
          cmd(7, "mediaVolume", { track: "music", percent: 55, voice: 0 }),
          cmd(8, "mediaFade", { track: "music", percent: 101, ms: 100 }),
          cmd(8, "mediaFade", { track: "music", percent: 10, ms: -5 }),
        ],
        11,
      ),
      makeCase(
        "stinger-and-manual-duck-apply-in-source-order",
        "Layering a stinger and ducking the music is two commands that apply in source order in one tick (the ui play cue, then the music fade cue); there is no automatic duck.",
        setup({ assets }),
        [start, cmd(3, "mediaPlay", { file: "stinger.mid", track: "ui", flags: ONCE }), cmd(3, "mediaFade", { track: "music", percent: 25, ms: 250 })],
        20,
      ),
    ],
  };
}

export function syncedStart() {
  const assets = { "song.mid": 600, "stem.wav": 10, "long.wav": 600, "pad.wav": 20, "drum.wav": 20, "ten.wav": 10, "five.wav": 40, "half.mid": 50, "x.xm": "unsupported" };
  return {
    spec: ["audio-state", "audio-time-model", "media-command-family"],
    cases: [
      makeCase(
        "spec-example-position-17-of-10",
        "The worked example of 6.2 P7: the music track started at tick 120 is at position 17 at tick 137; a 10-tick loop synced to it starts at 17 mod 10 = 7 (its startTick is 130, so it wraps at 140, 150) and the cue carries positionTicks 7 at tick 137.",
        setup({ assets }),
        [cmd(120, "mediaPlay", { file: "song.mid" }), cmd(137, "mediaPlay", { file: "stem.wav", track: "ambience", flags: LOOP, sync: "music" })],
        152,
      ),
      makeCase(
        "equal-lengths-stay-aligned",
        "Two 20-tick loops synced at tick 5 stay aligned through the boundary at 20 and 40: both positions are equal on every tick after the sync.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "pad.wav", track: "ambience", flags: LOOP }), cmd(5, "mediaPlay", { file: "drum.wav", track: "ui", flags: LOOP, sync: "ambience" })],
        24,
      ),
      makeCase(
        "paused-source-supplies-its-held-position",
        "A paused source gives its held position (6) and the new voice starts playing from it; the source stays paused.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "pad.wav", track: "ambience", flags: LOOP }), cmd(6, "mediaPause", { track: "ambience" }), cmd(9, "mediaPlay", { file: "drum.wav", track: "ui", flags: LOOP, sync: "ambience" })],
        12,
      ),
      makeCase(
        "unequal-lengths-are-deterministic",
        "A 40-tick one-shot synced to a loop at position 37 of 50 starts at 37 mod 40 = 37 and ends 3 ticks later (endTick = startTick + 40).",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "half.mid" }), cmd(37, "mediaPlay", { file: "five.wav", track: "sfx", flags: ONCE, sync: "music" })],
        42,
      ),
      makeCase(
        "sync-diagnostics-fallback-starts-at-zero",
        "An unknown source track, an inactive source and an unknown-length destination each diagnose media.sync-source and start the destination at zero; an unsupported destination also diagnoses media.asset-format.",
        setup({ assets }),
        [
          cmd(0, "mediaPlay", { file: "pad.wav", track: "ambience", flags: LOOP }),
          cmd(2, "mediaPlay", { file: "drum.wav", track: "ui", flags: LOOP, sync: "nosuch" }),
          cmd(3, "mediaPlay", { file: "stem.wav", track: "ui", flags: LOOP, sync: "sfx" }),
          cmd(4, "mediaPlay", { file: "x.xm", track: "ui", flags: LOOP, sync: "ambience" }),
        ],
        6,
      ),
    ],
  };
}

export function lateStartCatchUp() {
  const assets = { "song.mid": 40, "hit.wav": 40, "short.wav": 12, "loop.wav": 12 };
  const musicCue = { cueId: 41, tick: 100, kind: "media.play", track: "music", voice: 0, asset: "media/song.mid", loop: true, flags: 1, positionTicks: 0, volume: 100, targetVolume: null, durationTicks: null };
  return {
    spec: ["audio-time-model", "audio-late-sounds", "cue-player", "audio-save-load"],
    cases: [
      makeCase(
        "worked-example-600-tick-song",
        "The cue-player example of 6.3: a media.play cue at tick 100 for a looping 600-tick song, position 0. A runner ready at tick 190 starts at 90; at 760 at (660 mod 600) = 60. Pure arithmetic: no timeline is run.",
        setup({ assets: { "song.mid": 600 } }),
        [],
        0,
        { runner: [{ cue: musicCue, length: 600, ready: [100, 190, 760] }] },
      ),
      makeCase(
        "looping-music-catches-up",
        "Music started by a board at tick 5 (40-tick loop): a runner ready at 15 starts at 10, at 45 at 40 mod 40 = 0, at 57 at 52 mod 40 = 12; ready before the cue tick is not late (position 0).",
        setup({ assets }),
        [music(5, "song.mid")],
        8,
        { runner: [{ find: { kind: "media.play", track: "music" }, ready: [3, 5, 15, 45, 57] }] },
      ),
      makeCase(
        "one-shot-sfx-is-dropped-when-late",
        "A finite one-shot off the music track is dropped (stop, nothing realised, no ended) when its lateness is 15 ticks or more, and not started when the caught-up position reaches its length. The 40-tick hit started at tick 10: ready at 24 (lateness 14) plays at 14, at 25 (lateness 15) is dropped. The 12-tick short on the voice track: ready at 21 plays at 11, at 22 the position 12 is at its end, so it is not started.",
        setup({ assets }),
        [cmd(10, "mediaPlay", { file: "hit.wav", track: "sfx" }), cmd(10, "mediaPlay", { file: "short.wav", track: "voice" })],
        14,
        {
          runner: [
            { find: { kind: "media.play", track: "sfx" }, ready: [10, 12, 24, 25, 49] },
            { find: { kind: "media.play", track: "voice" }, ready: [21, 22, 25] },
          ],
        },
      ),
      makeCase(
        "music-and-loops-are-never-dropped",
        "A finite one-shot on the music track is not dropped however late (position 30 at lateness 30), only not started once past its end (ready 40). A looping ambience voice catches up modulo its length: ready at 100 starts at 100 mod 12 = 4.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid", flags: ONCE }), cmd(0, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP })],
        4,
        {
          runner: [
            { find: { kind: "media.play", track: "music" }, ready: [30, 39, 40, 80] },
            { find: { kind: "media.play", track: "ambience" }, ready: [100] },
          ],
        },
      ),
      makeCase(
        "seek-and-fade-cues-late",
        "A late media.seek adds the lateness to its position and wraps for a loop (position 30 at tick 3, ready at 13: 40 mod 40 = 0). A late media.fade (100 to 40 over 30 ticks from tick 5) starts from the ramp's value at the lateness: ready at 15 is 80 over the remaining 20 ticks; at 35 or later the target is set at once.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid" }), cmd(3, "mediaSeek", { track: "music", ms: 500 }), cmd(5, "mediaFade", { track: "music", percent: 40, ms: 500, voice: 0 })],
        8,
        {
          runner: [
            { find: { kind: "media.seek" }, length: 40, loop: true, ready: [3, 13, 20] },
            { find: { kind: "media.fade" }, ready: [5, 15, 20, 35, 36] },
          ],
        },
      ),
      makeCase(
        "restored-voice-cue-is-past-due",
        "After a load, a resumed non-music voice's cue carries the past due tick (load tick minus the saved position) and position 0, and music's cue carries the load tick: a runner ready at the load tick catches up to the saved position (ambience 8 of 12, sfx 6) and music starts at 0.",
        setup({ assets }),
        [music(0, "song.mid"), cmd(2, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }), cmd(4, "mediaPlay", { file: "hit.wav", track: "sfx" }), post(10, "save", { name: "s" }), pre(20, "load", { save: "s" })],
        22,
        {
          runner: [
            { find: { kind: "media.play", track: "music", tick: 20 }, ready: [20] },
            { find: { kind: "media.play", track: "ambience", tick: 12 }, ready: [20] },
            { find: { kind: "media.play", track: "sfx", tick: 14 }, ready: [20] },
          ],
        },
      ),
    ],
  };
}

export function mediaWaitSuspend() {
  const assets = { "shot.wav": 10, "other.wav": 10, "loop.wav": 12, "song.xm": "unsupported" };
  const wait = (t, thread, file = "shot.wav") => play(t, file, "sfx", { flags: WAIT, thread });
  return {
    spec: ["audio-track-wait", "audio-time-model", "media-command-family", "audio-lifecycle"],
    cases: [
      makeCase(
        "wait-wakes-on-the-end-tick",
        "Thread 1 plays a 10-tick sound at tick 2 with `wait: true`: the voice ends at tick 12 and the wait wakes in the waits phase of tick 12 (before the audio phase finishes the voice and emits media.stop).",
        setup({ assets }),
        [wait(2, 1)],
        15,
      ),
      makeCase(
        "pause-suspends-the-wait-and-resume-continues-it",
        "Paused at tick 5 (position 3) and resumed at tick 9, the voice's end tick moves from 12 to 16 and the same wait wakes at tick 16; nothing wakes while it is paused.",
        setup({ assets }),
        [wait(2, 1), cmd(5, "mediaPause", { track: "sfx" }), cmd(9, "mediaResume", { track: "sfx" })],
        19,
      ),
      makeCase(
        "stop-wakes-at-the-next-waits-phase",
        "A stop posted in the threads phase of tick 5 changes the track at once; the waiter is observed in the waits phase of tick 6 (waits precedes threads).",
        setup({ assets }),
        [wait(2, 1), cmd(5, "mediaStop", { track: "sfx", thread: 2 })],
        9,
      ),
      makeCase(
        "replacing-the-voice-wakes-the-old-wait",
        "A different sound replaces the voice at tick 4 (stop then play); the new voice has a new cue id, so the old wait wakes at tick 5 and does not wait for the new sound.",
        setup({ assets }),
        [wait(2, 1), play(4, "other.wav", "sfx")],
        8,
      ),
      makeCase(
        "voice-wait-on-a-playing-one-shot",
        "voice.wait() on a voice started without `wait: true` parks until its end tick (20 here): thread 1 asks at tick 3 and wakes at 20.",
        setup({ assets: { ...assets, "shot.wav": 20 } }),
        [play(0, "shot.wav", "sfx"), cmd(3, "voiceWait", { thread: 1, track: "sfx" })],
        22,
      ),
      makeCase(
        "two-threads-wake-in-ascending-thread-id",
        "Threads 3 and 1 both wait on the same voice (thread 3 first); at its end tick both wake in the same waits phase, listed in ascending thread id (1 then 3).",
        setup({ assets }),
        [wait(1, 3), cmd(2, "voiceWait", { thread: 1, track: "sfx" })],
        14,
      ),
      makeCase(
        "stop-while-paused-wakes-the-wait",
        "A wait parked on a paused voice stays parked; a stop of the paused voice (tick 8) wakes it at the next waits phase (tick 9).",
        setup({ assets }),
        [wait(2, 1), cmd(4, "mediaPause", { track: "sfx" }), cmd(8, "mediaStop", { track: "sfx" })],
        12,
      ),
      makeCase(
        "wait-diagnostics-do-not-park",
        "A voice wait on an unknown track and on a voice of unknown length are located diagnostics: no wait is registered and the thread carries on.",
        setup({ assets }),
        [play(1, "song.xm", "sfx"), cmd(2, "voiceWait", { thread: 1, track: "sfx" }), cmd(2, "voiceWait", { thread: 2, track: "nosuch" })],
        4,
      ),
    ],
  };
}
