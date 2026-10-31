// Audio oracle scenes, part 1 (ticket 6.4): board-music-boot, animation-frame-sfx, track-transport,
// loop-and-end-ticks, same-file-rules. Authored from docs/spec/engine/audio-media.md; imports nothing
// from packages/core. Every case's expected facts are derived by ./sim.mjs.

import { LOOP, ONCE, RESTART, WAIT, cmd, makeCase, music, setup, sfx } from "./common.mjs";
import { authoredLength } from "./files.mjs";

export function boardMusicBoot() {
  const assets = { "town.mid": 40, "cave.mid": 30, "door.wav": 8 };
  return {
    spec: ["audio-lifecycle", "board-effect-mapping", "audio-cue-contract", "soundfont-commands", "audio-headless"],
    cases: [
      makeCase(
        "boot-board-music",
        "Engine start: the applier registers at tick 0 and its first cue is soundfont.set (6.3 A3); the board's music.play follows as a looping music cue.",
        setup({ assets }),
        [music(0, "town.mid")],
        6,
      ),
      makeCase(
        "queued-before-applier",
        "Effects posted before the applier registered wait in the bounded FIFO queue and apply, in post order, when it registers at tick 2; cue ids follow effect order and the cue tick is the registration tick. A later same-tick effect comes after the drained ones.",
        setup({ assets, registerAt: 2 }),
        [music(0, "town.mid"), sfx(0, "door.wav"), music(1, "cave.mid"), sfx(2, "door.wav")],
        6,
      ),
      makeCase(
        "next-board-different-music",
        "A board with different music replaces it: media.stop then media.play, in that order, in the same tick.",
        setup({ assets }),
        [music(0, "town.mid"), music(10, "cave.mid")],
        16,
      ),
      makeCase(
        "next-board-same-music-carries-on",
        "A board with the same music while it plays posts the effect, but the applier carries on: no cue, the position keeps counting (the applier, not engine.musicAsset, owns the decision).",
        setup({ assets }),
        [music(0, "town.mid"), music(10, "town.mid")],
        14,
      ),
      makeCase(
        "board-without-music-silences",
        "An empty or missing board request is a null asset: media.stop, the music file is cleared (so the music virtual would read empty) and no error is raised; a later board with music plays again.",
        setup({ assets }),
        [music(0, "town.mid"), music(10, null), music(14, "cave.mid")],
        18,
      ),
      makeCase(
        "stopped-music-restarts-on-board-entry",
        "mediaStop retains the file; board entry with the same file then plays it again from zero (Q5, Q10): the same-file rule only carries on while the track is playing.",
        setup({ assets }),
        [music(0, "town.mid"), cmd(5, "mediaStop", { track: "music" }), music(10, "town.mid")],
        14,
      ),
      makeCase(
        "unknown-length-music",
        "A music file no decoder accepts still plays in core: the cue stream is the same as for a known file, the length is null, the position is the elapsed ticks (never wrapping) and one media.asset-format diagnostic is raised.",
        setup({ assets: { "song.xm": "unsupported" } }),
        [music(0, "song.xm")],
        10,
      ),
    ],
  };
}

export function animationFrameSfx() {
  const assets = { "step.wav": 10, "hit.wav": 6, "blip.wav": 4 };
  return {
    spec: ["r-59-routing", "board-effect-mapping", "audio-lifecycle", "media-command-family"],
    cases: [
      makeCase(
        "frame-sounds-replace-on-the-one-voice-sfx-track",
        "Each visible frame sound is one sfx.play effect on the one-voice sfx track: a different file replaces (stop then play), the same file while it plays is ignored, and once it finished it plays again. Two frame sounds in one tick apply in post order.",
        setup({ assets }),
        [sfx(2, "step.wav"), sfx(5, "hit.wav"), sfx(7, "hit.wav"), sfx(14, "hit.wav"), sfx(20, "step.wav"), sfx(20, "hit.wav")],
        28,
      ),
      makeCase(
        "wavstop-stops-a-frame-sound",
        "A frame sound is an sfx voice, so wavstop (mediaStop sfx) stops it (6.3 A5 amends Q14).",
        setup({ assets }),
        [sfx(1, "step.wav"), cmd(3, "legacy", { name: "wavstop" })],
        8,
      ),
      makeCase(
        "script-wav-and-frame-sound-replace-each-other",
        "A script wav and a frame sound share the one sfx voice: the later one replaces the earlier.",
        setup({ assets }),
        [cmd(1, "legacy", { name: "wav", file: "hit.wav" }), sfx(3, "step.wav")],
        8,
        // the wav call needs the applier registered: it is, at tick 0
      ),
      makeCase(
        "menu-sounds-go-to-ui-and-overlap",
        "Menu and cursor sounds are sfx.play with source ui and land on the four-voice ui track, so wavstop does not stop them and the same file overlaps on the next free voice.",
        setup({ assets }),
        [sfx(1, "blip.wav", { source: "ui" }), sfx(1, "step.wav"), sfx(2, "blip.wav", { source: "ui" }), cmd(3, "legacy", { name: "wavstop" })],
        8,
      ),
      makeCase(
        "two-sfx-voices-when-the-author-raises-the-count",
        "mediaTrack(\"sfx\", 2) lets a frame sound and a script sound play at once: the lowest free voice is taken, then a third play steals the oldest.",
        setup({ assets }),
        [cmd(0, "mediaTrack", { name: "sfx", voices: 2 }), sfx(1, "step.wav"), cmd(2, "mediaPlay", { file: "hit.wav", track: "sfx" }), sfx(3, "blip.wav")],
        10,
      ),
      makeCase(
        "track-volume-scales-frame-sounds",
        "The sfx track volume (a script setting) is a bus volume the runner applies; a frame sound's own play cue still carries its voice volume 100.",
        setup({ assets }),
        [cmd(1, "mediaVolume", { track: "sfx", percent: 50 }), sfx(2, "step.wav")],
        6,
      ),
    ],
  };
}

export function trackTransport() {
  const assets = { "song.mid": 30, "sting.wav": 20 };
  return {
    spec: ["audio-state", "audio-lifecycle", "media-command-family", "audio-time-model"],
    cases: [
      makeCase(
        "play-pause-resume-stop",
        "Pause holds the integer position (4) and the pass clock; resume continues from it with a new startTick; pausing a paused voice and resuming a playing one are no-ops (no cue); stop rewinds, retains file and flags, and a later play starts from zero.",
        setup({ assets }),
        [
          cmd(2, "mediaPlay", { file: "song.mid" }),
          cmd(6, "mediaPause", { track: "music" }),
          cmd(7, "mediaPause", { track: "music" }),
          cmd(9, "mediaResume", { track: "music" }),
          cmd(10, "mediaResume", { track: "music" }),
          cmd(15, "mediaStop", { track: "music" }),
          cmd(20, "mediaPlay", { file: "song.mid" }),
        ],
        26,
      ),
      makeCase(
        "stop-retains-file-and-flags",
        "A stopped track keeps its last file and its loop flag (music reads looping, sfx once) and reports position 0 and an unknown length with no voice.",
        setup({ assets }),
        [cmd(1, "mediaPlay", { file: "song.mid" }), cmd(1, "mediaPlay", { file: "sting.wav", track: "sfx" }), cmd(4, "mediaStop", { track: "music" }), cmd(4, "mediaStop", { track: "sfx" })],
        8,
      ),
      makeCase(
        "seek-clamps-wraps-and-rounds",
        "mediaSeek converts milliseconds with half-up rounding (25 ms = 1.5 ticks = 2). A one-shot clamps to its length and finishes in the same tick; a loop wraps modulo its length; the end tick moves with the seek.",
        setup({ assets }),
        [
          cmd(0, "mediaPlay", { file: "song.mid" }),
          cmd(0, "mediaPlay", { file: "sting.wav", track: "sfx", flags: ONCE }),
          cmd(3, "mediaSeek", { track: "sfx", ms: 250 }),
          cmd(4, "mediaSeek", { track: "music", ms: 1000 }),
          cmd(6, "mediaSeek", { track: "music", ms: 750 }),
          cmd(9, "mediaSeek", { track: "music", ms: 25 }),
          cmd(11, "mediaPlay", { file: "sting.wav", track: "sfx" }),
          cmd(12, "mediaSeek", { track: "sfx", ms: 1000 }),
        ],
        16,
      ),
      makeCase(
        "diagnostics-leave-state-untouched",
        "A missing file, an unknown track and an unknown voice each raise one located diagnostic and change nothing (no cue, no state). A file no decoder accepts does play, with one media.asset-format diagnostic; a seek on it (unknown length) and a negative seek time are then diagnosed and leave the voice as it was.",
        setup({ assets: { ...assets, "song.xm": "unsupported" } }),
        [
          cmd(1, "mediaPlay", { file: "nofile.wav", track: "sfx" }),
          cmd(2, "mediaPlay", { file: "sting.wav", track: "nosuch" }),
          cmd(3, "mediaStop", { track: "music", voice: 3 }),
          cmd(4, "mediaPlay", { file: "song.xm" }),
          cmd(5, "mediaSeek", { track: "music", ms: 500 }),
          cmd(6, "mediaSeek", { track: "music", ms: -1 }),
        ],
        8,
      ),
    ],
  };
}

export function loopAndEndTicks() {
  const assets = { "shot.wav": 25, "loop.wav": 12, "half.wav": { ticks: authoredLength("pcm8-half-tick.wav"), authored: "pcm8-half-tick.wav" }, "one.wav": { ticks: authoredLength("pcm8-min-one-tick.wav"), authored: "pcm8-min-one-tick.wav" } };
  return {
    spec: ["audio-time-model", "audio-lifecycle", "audio-track-wait", "audio-wav-midi-length"],
    cases: [
      makeCase(
        "one-shot-end-tick",
        "A one-shot started at tick 10 with length 25 has endTick 35; its position is tick minus 10 until it finishes; the audio phase of tick 35 emits media.stop and records the finish once.",
        setup({ assets }),
        [cmd(10, "mediaPlay", { file: "shot.wav", track: "sfx" })],
        40,
      ),
      makeCase(
        "loop-pass-boundaries",
        "A looping voice has pass boundaries at start + n x length (15, 27, 39 for start 3 and length 12), its position wraps, and it never finishes. A voice wait on a loop waits for the next pass boundary only: thread 1 (asked at tick 5) wakes at 15, thread 2 (asked at tick 15 exactly on a boundary) wakes at 27.",
        setup({ assets }),
        [cmd(3, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }), cmd(5, "voiceWait", { thread: 1, track: "ambience" }), cmd(15, "voiceWait", { thread: 2, track: "ambience" })],
        42,
      ),
      makeCase(
        "loop-off-finishes-the-current-pass",
        "mediaLoop(false) changes the flag in place (a media.flags cue, no restart): the voice now ends at the end of its current pass, tick 12.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }), cmd(4, "mediaLoop", { track: "ambience", on: false })],
        16,
      ),
      makeCase(
        "loop-on-extends-a-one-shot",
        "mediaLoop(true) on a one-shot clears its end tick: pass boundaries continue at start + n x length, so it wraps at tick 25 instead of finishing.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "shot.wav", track: "sfx" }), cmd(10, "mediaLoop", { track: "sfx", on: true })],
        30,
      ),
      makeCase(
        "end-ticks-from-authored-files",
        "Lengths come from the authored files' hand-worked tick counts: a half-tick WAV rounds up to 2 and ends at 5, a one-frame WAV is raised to 1 and ends at 11. Four ambience voices end in ascending voice order when they share a tick.",
        setup({
          assets: {
            ...assets,
            "pcm.wav": { ticks: authoredLength("pcm8-mono-8000.wav"), authored: "pcm8-mono-8000.wav" },
            "ima.wav": { ticks: authoredLength("ima-adpcm-mono-8000.wav"), authored: "ima-adpcm-mono-8000.wav" },
            "ms-fact.wav": { ticks: authoredLength("msadpcm-mono-8000-fact.wav"), authored: "msadpcm-mono-8000-fact.wav" },
            "ms.wav": { ticks: authoredLength("msadpcm-mono-8000.wav"), authored: "msadpcm-mono-8000.wav" },
          },
        }),
        [
          cmd(0, "mediaPlay", { file: "pcm.wav", track: "ambience" }),
          cmd(0, "mediaPlay", { file: "ima.wav", track: "ambience" }),
          cmd(0, "mediaPlay", { file: "ms-fact.wav", track: "ambience" }),
          cmd(0, "mediaPlay", { file: "ms.wav", track: "ambience" }),
          cmd(3, "mediaPlay", { file: "half.wav", track: "sfx" }),
          cmd(10, "mediaPlay", { file: "one.wav", track: "sfx" }),
        ],
        32,
      ),
      makeCase(
        "unknown-length-never-ends",
        "A voice with an unknown length has no end tick: its position is the elapsed ticks and only an explicit stop ends it.",
        setup({ assets: { "song.xm": "unsupported" } }),
        [cmd(2, "mediaPlay", { file: "song.xm", track: "sfx" }), cmd(12, "mediaStop", { track: "sfx" })],
        14,
      ),
      makeCase(
        "loop-plus-wait-is-diagnosed",
        "mediaPlay with `loop` and `wait` together is a located diagnostic at the call: nothing plays and no thread parks (a loop cannot be waited to its end).",
        setup({ assets }),
        [cmd(1, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP | WAIT, thread: 1 })],
        4,
      ),
    ],
  };
}

export function sameFileRules() {
  const assets = { "song.mid": 40, "other.mid": 40, "hit.wav": 10, "step.wav": 10, "blip.wav": 6, "short.wav": 5 };
  return {
    spec: ["audio-lifecycle", "media-command-family", "board-effect-mapping"],
    cases: [
      makeCase(
        "music-same-file-carries-on",
        "A same-file mediaPlay on a playing single-voice music track carries on with no cue, whatever the letter case of the name; the position is not disturbed.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid" }), cmd(8, "mediaPlay", { file: "song.mid" }), cmd(12, "mediaPlay", { file: "SONG.MID" })],
        16,
      ),
      makeCase(
        "music-restart-flag-restarts",
        "a restart request turns the carry-on into stop then play at position zero.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid" }), cmd(8, "mediaPlay", { file: "song.mid", flags: LOOP | RESTART })],
        12,
      ),
      makeCase(
        "music-different-file-replaces",
        "A different file on a playing single-voice track is stop then play: two cues, in that order, one tick.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid" }), cmd(8, "mediaPlay", { file: "other.mid" })],
        12,
      ),
      makeCase(
        "stopped-music-plays-again",
        "After mediaStop the same file is not carried on: it plays again from zero (the track retained its name).",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "song.mid" }), cmd(5, "mediaStop", { track: "music" }), cmd(8, "mediaPlay", { file: "song.mid" })],
        12,
      ),
      makeCase(
        "sfx-same-file-ignored-and-replaced",
        "On the one-voice sfx track a same-file play while playing is ignored, a different file replaces, and a restart request restarts the same file.",
        setup({ assets }),
        [
          cmd(0, "mediaPlay", { file: "hit.wav", track: "sfx" }),
          cmd(3, "mediaPlay", { file: "hit.wav", track: "sfx" }),
          cmd(5, "mediaPlay", { file: "step.wav", track: "sfx" }),
          cmd(6, "mediaPlay", { file: "step.wav", track: "sfx", flags: ONCE | RESTART }),
        ],
        18,
      ),
      makeCase(
        "multi-voice-overlaps-the-same-file",
        "A multi-voice track has no same-file rule: the same file takes the next free voice and overlaps.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "blip.wav", track: "ui" }), cmd(2, "mediaPlay", { file: "blip.wav", track: "ui" })],
        10,
      ),
      makeCase(
        "finished-one-shot-plays-again",
        "A one-shot that has finished leaves the track stopped, so the same file plays again.",
        setup({ assets }),
        [cmd(0, "mediaPlay", { file: "short.wav", track: "sfx" }), cmd(7, "mediaPlay", { file: "short.wav", track: "sfx" })],
        14,
      ),
    ],
  };
}
