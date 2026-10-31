// Audio oracle scenes, part 3 (ticket 6.4): settings-versus-save, soundfont-setting, battle-music-handoff,
// legacy-parity-ledger, video-restarts-music. Authored from docs/spec/engine/audio-media.md; imports nothing
// from packages/core.

import { LOOP, ONCE, WAIT, cmd, makeCase, music, post, pre, setup, sfx } from "./common.mjs";

const play = (t, file, track, o = {}) => cmd(t, "mediaPlay", { file, track, ...o });
const legacy = (t, name, o = {}) => cmd(t, "legacy", { name, ...o });

export function settingsVersusSave() {
  const assets = { "song.mid": 40, "loop.wav": 12, "hit.wav": 40, "short.wav": 5, "other.mid": 40, "boss.sf2": "soundfont", "town.sf2": "soundfont" };
  return {
    spec: ["audio-state", "audio-save-load", "soundfont-commands", "audio-cue-contract"],
    cases: [
      makeCase(
        "save-and-load-restore-playback-not-settings",
        "Saved at tick 10 and loaded at tick 20. The load re-emits soundfont.set first using the current bank (town.sf2 after the reset), then music (restarted from zero at the load tick, loop kept), then non-music voices in track order at their saved positions (ambience 8 of 12, sfx 6 of 40: cue tick = load tick minus position, position 0). The master volume and music bus volume keep their newer values: configuration and settings are neither saved nor loaded (MEDIA-4/audio-save-load, #481). Cue ids go on from the counter.",
        setup({ assets, defaultSoundFont: "town.sf2" }),
        [
          music(0, "song.mid"),
          cmd(1, "soundFont", { file: "boss.sf2" }),
          cmd(2, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }),
          cmd(3, "setvolume", { percent: 80 }),
          cmd(3, "mediaVolume", { track: "music", percent: 60 }),
          cmd(4, "mediaPlay", { file: "hit.wav", track: "sfx" }),
          post(10, "save", { name: "s" }),
          cmd(12, "setvolume", { percent: 30 }),
          cmd(12, "mediaVolume", { track: "music", percent: 90 }),
          cmd(13, "soundFontReset"),
          cmd(15, "mediaStop", { track: "music" }),
          pre(20, "load", { save: "s" }),
        ],
        24,
      ),
      makeCase(
        "stopped-tracks-stay-stopped-after-load",
        "A stopped music track (file retained) and a one-shot that had already finished are not re-emitted by a load; only the playing ambience voice is, at its saved position.",
        setup({ assets }),
        [
          music(0, "song.mid"),
          cmd(1, "mediaPlay", { file: "short.wav", track: "sfx" }),
          cmd(2, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }),
          cmd(4, "mediaStop", { track: "music" }),
          post(7, "save", { name: "s" }),
          pre(10, "load", { save: "s" }),
        ],
        13,
      ),
      makeCase(
        "reset-leaves-audio-untouched",
        "reset() changes nothing in the audio section (playing music, the script bank and the volume settings stay); the board entry that follows is a same-file request and carries on without restarting. Another board's music replaces it normally.",
        setup({ assets, defaultSoundFont: "town.sf2" }),
        [
          music(0, "song.mid"),
          cmd(2, "setvolume", { percent: 70 }),
          cmd(2, "mediaVolume", { track: "sfx", percent: 40 }),
          cmd(3, "soundFont", { file: "boss.sf2" }),
          pre(10, "reset"),
          music(10, "song.mid"),
          music(12, "other.mid"),
        ],
        15,
      ),
    ],
  };
}

export function soundfontSetting() {
  const assets = { "town.mid": 40, "boss.mid": 40, "door.wav": 8, "boss.sf2": "soundfont", "alt.sf3": "soundfont", "town.sf2": "soundfont" };
  return {
    spec: ["soundfont-commands", "soundfont-cue", "soundfont-layers", "audio-save-load"],
    cases: [
      makeCase(
        "spec-worked-example-scaled",
        "The worked example of 6.3 B2 with the clock scaled by 10 (tick 60 stands for 600 and 90 for 900) so the cue counter, order and values are the spec's: the counter stands at 7 after six cues (start bank, music play, music stop, sfx play, sfx finish stop, a track volume), then soundFont(\"boss.sf2\") and mediaPlay(\"boss.mid\") in one thread step give cue 7 soundfont.set boss.sf2, cue 8 media.play music; soundFontReset() at tick 90 is cue 9 and names the author default town.sf2. The script bank is null again after tick 90.",
        setup({ assets, defaultSoundFont: "town.sf2" }),
        [
          music(0, "town.mid"),
          cmd(10, "mediaStop", { track: "music" }),
          sfx(12, "door.wav"),
          cmd(30, "mediaVolume", { track: "music", percent: 100 }),
          cmd(60, "soundFont", { file: "boss.sf2" }),
          cmd(60, "mediaPlay", { file: "boss.mid" }),
          cmd(90, "soundFontReset"),
        ],
        95,
      ),
      makeCase(
        "no-default-bank-is-null",
        "With no author default the start cue and a reset cue carry asset null (the runner and bundled layers decide); a script bank names its key.",
        setup({ assets }),
        [cmd(2, "soundFont", { file: "boss.sf2" }), cmd(5, "soundFontReset")],
        8,
      ),
      makeCase(
        "unchanged-bank-still-emits",
        "The cue is emitted on every accepted command even when the value is unchanged (the runner treats an unchanged bank as a no-op): two soundFont calls with the same file and two resets give four cues.",
        setup({ assets, defaultSoundFont: "town.sf2" }),
        [cmd(2, "soundFont", { file: "boss.sf2" }), cmd(4, "soundFont", { file: "boss.sf2" }), cmd(6, "soundFontReset"), cmd(8, "soundFontReset")],
        10,
      ),
      makeCase(
        "invalid-names-change-nothing",
        "A name that is not .sf2 or .sf3 is media.soundfont-name, a name that does not resolve is media.soundfont-missing; both leave state and cues alone. The ASCII fold applies: ALT.SF3 resolves to media/alt.sf3.",
        setup({ assets }),
        [cmd(1, "soundFont", { file: "boss.mid" }), cmd(2, "soundFont", { file: "nofile.sf2" }), cmd(3, "soundFont", { file: "ALT.SF3" })],
        5,
      ),
      makeCase(
        "load-reemits-the-current-bank-first",
        "MEDIA-4/audio-save-load (#481): a playback save contains no bank configuration. Saved while boss.sf2 is set, then reset to the game's town.sf2 default, a load keeps that current bank and re-emits one soundfont.set before the music restart.",
        setup({ assets, defaultSoundFont: "town.sf2" }),
        [music(0, "town.mid"), cmd(2, "soundFont", { file: "boss.sf2" }), post(4, "save", { name: "s" }), cmd(6, "soundFontReset"), pre(8, "load", { save: "s" })],
        11,
      ),
    ],
  };
}

export function battleMusicHandoff() {
  const assets = { "field.mid": 50, "fight.mid": 30, "other.mid": 20 };
  const battle = (t, file, o = {}) => music(t, file, { source: "battle", ...o });
  return {
    spec: ["battle-music-synthetic", "audio-lifecycle", "board-effect-mapping", "audio-save-load"],
    cases: [
      makeCase(
        "battle-music-then-return",
        "An engine-mediated battle start with non-empty .bkg music replaces board music. After battleEnded and boardReturned, the board/audio producer posts the active board's music with source board; a different file replaces battle music from zero (Q8, Q9).",
        setup({ assets }),
        [music(0, "field.mid"), battle(6, "fight.mid"), music(14, "field.mid")],
        18,
      ),
      makeCase(
        "battle-without-music-is-silent",
        "A fight with no background music posts no effect, so board music keeps playing. On return, the board/audio producer posts the active board's same music; the ordinary same-file rule carries it on.",
        setup({ assets }),
        [music(0, "field.mid"), music(12, "field.mid")],
        16,
      ),
      makeCase(
        "in-fight-music-change-is-lost",
        "A script music change during battle replaces fight music; on boardReturned, the active board's music is posted with source board and replaces that change.",
        setup({ assets }),
        [music(0, "field.mid"), battle(6, "fight.mid"), cmd(10, "mediaPlay", { file: "other.mid" }), music(14, "field.mid")],
        18,
      ),
      makeCase(
        "same-file-battle-carries-on-and-restart-restarts",
        "When the fight's music is the board's, both engine requests use the same-file carry-on rule: battle entry and board return emit no transition cue.",
        setup({ assets }),
        [music(0, "field.mid"), battle(6, "field.mid"), music(14, "field.mid")],
        18,
      ),
      makeCase(
        "music-virtual-follows-the-music-track-file",
        "The music virtual variable reads the music track's file: it shows fight music during battle and, after a stop, still shows it (Q19), until the board/audio producer restores the active board's music.",
        setup({ assets }),
        [music(0, "field.mid"), battle(6, "fight.mid"), cmd(10, "mediaStop", { track: "music" }), music(14, "field.mid")],
        17,
      ),
    ],
  };
}

export function legacyParityLedger() {
  const assets = { "town.mid": 40, "hit.wav": 10, "step.wav": 10, "a.mid": 30 };
  return {
    spec: ["legacy-audio-command-mapping", "audio-lifecycle", "r-59-routing", "audio-time-model"],
    ledger: LEDGER,
    cases: [
      makeCase(
        "mp3pause-waits-while-music-keeps-playing",
        "Q1, 3.1.0: mp3pause(file) is a wav on the sfx track with `loop: false` and `wait: true`, so the thread parks until the 10-tick file ends (tick 12) while the music keeps playing.",
        setup({ assets }),
        [legacy(0, "midiplay", { file: "Town.mid" }), legacy(2, "mp3pause", { file: "Hit.wav", thread: 1 })],
        15,
      ),
      makeCase(
        "wav-and-mp3-never-wait-and-play-once",
        "Q2, M4: wav and its alias mp3 never wait and never loop: no wait event, one-shot voices that finish on their own.",
        setup({ assets }),
        [legacy(1, "wav", { file: "Hit.wav" }), legacy(3, "mp3", { file: "step.wav" })],
        16,
      ),
      makeCase(
        "one-sfx-slot-replaces-or-ignores",
        "Q3: one sfx slot replaces a different file and ignores the same playing name (whatever its letter case).",
        setup({ assets }),
        [legacy(1, "wav", { file: "hit.wav" }), legacy(3, "wav", { file: "HIT.WAV" }), legacy(5, "wav", { file: "step.wav" })],
        10,
      ),
      makeCase(
        "wavstop-leaves-music-alone",
        "Q4: wavstop stops the sfx slot only; the music is not touched.",
        setup({ assets }),
        [legacy(0, "midiplay", { file: "town.mid" }), legacy(1, "wav", { file: "hit.wav" }), legacy(3, "wavstop")],
        6,
      ),
      makeCase(
        "midiplay-carries-on-and-stop-retains",
        "Q5, Q10, Q19, M1, M2: midiplay of the same name (any letter case) while playing carries on; mediastop retains the name and the loop flag; the same name then plays again from zero. Music loops by default.",
        setup({ assets }),
        [legacy(0, "midiplay", { file: "TOWN.MID" }), legacy(5, "midiplay", { file: "town.mid" }), legacy(8, "mediastop"), legacy(10, "midiplay", { file: "Town.Mid" })],
        13,
      ),
      makeCase(
        "aliases-map-to-the-standard-calls",
        "Every legacy name is the standard call of 6.2's table (the legacy fact on each tick names it): midiplay, playmidi and mediaplay are looping music plays; mediastop, mediarest and midirest stop the music (a stop of a stopped track is a no-op); wav and mp3 are one-shot sfx; wavstop stops sfx; mp3pause waits; setvolume sets the master script volume.",
        setup({ assets }),
        [
          legacy(0, "midiplay", { file: "town.mid" }),
          legacy(1, "playmidi", { file: "town.mid" }),
          legacy(2, "mediaplay", { file: "a.mid" }),
          legacy(3, "mediarest"),
          legacy(4, "midirest"),
          legacy(5, "mediastop"),
          legacy(6, "wav", { file: "hit.wav" }),
          legacy(7, "wavstop"),
          legacy(8, "mp3", { file: "step.wav" }),
          legacy(9, "mp3pause", { file: "hit.wav", thread: 1 }),
          legacy(10, "setvolume", { percent: 50 }),
        ],
        22,
      ),
      makeCase(
        "setvolume-is-a-script-setting",
        "Q12, Q13: the master script volume starts at 100, setvolume(0) is a media.volume cue with no track (quiet but still playing: the music state is unchanged), and reset() leaves it alone.",
        setup({ assets }),
        [legacy(0, "midiplay", { file: "town.mid" }), legacy(2, "setvolume", { percent: 0 }), pre(5, "reset")],
        8,
      ),
      makeCase(
        "board-entry-silence-and-replay",
        "Q6, Q7 under the 3.1.0 rule: a board with no music stops the old music and clears the name without an error; a later board entry with the same file plays it again (the final version's replay block is not adopted).",
        setup({ assets }),
        [music(0, "town.mid"), music(5, null), music(8, "town.mid")],
        12,
      ),
    ],
  };
}

export function videoRestartsMusic() {
  const assets = { "song.mid": 40, "loop.wav": 12 };
  const videos = ["intro.avi", "outro.avi"];
  const s = () => setup({ assets, videos });
  return {
    spec: ["video-request", "video-wait-hold", "video-music", "video-headless", "audio-lifecycle"],
    cases: [
      makeCase(
        "video-stops-then-restarts-from-zero",
        "playavi at tick 6 stops the music (media.stop, file and flags retained) and parks thread 1. Time is held: video.ended is stamped at the held tick 7, the next consumed tick, whose waits phase wakes the thread and posts the restart effect (source video): a looping media.play from zero. Other audio is held, so the ambience position continues without a jump across the hold.",
        s(),
        [music(0, "song.mid"), cmd(2, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }), cmd(6, "playavi", { thread: 1, file: "Intro.avi" }), pre(7, "video.ended", { reqId: 1 })],
        12,
      ),
      makeCase(
        "stopped-music-restarts-anyway",
        "Q16: music stopped by the script before the video still restarts from zero afterwards (the track retained its file); the video's own stop has nothing to stop and emits no cue.",
        s(),
        [music(0, "song.mid"), cmd(3, "mediaStop", { track: "music" }), cmd(6, "playavi", { thread: 1, file: "intro.avi" }), pre(7, "video.ended", { reqId: 1 })],
        10,
      ),
      makeCase(
        "paused-music-restarts",
        "Paused music is stopped by the video and restarted from zero at the end (not resumed from its held position).",
        s(),
        [music(0, "song.mid"), cmd(3, "mediaPause", { track: "music" }), cmd(6, "playavi", { thread: 1, file: "intro.avi" }), pre(7, "video.ended", { reqId: 1 })],
        10,
      ),
      makeCase(
        "no-retained-file-plays-nothing",
        "A music track that never had a file restarts nothing; the other audio carries on.",
        s(),
        [cmd(1, "mediaPlay", { file: "loop.wav", track: "ambience", flags: LOOP }), cmd(3, "playavi", { thread: 1, file: "outro.avi", presentation: "small" }), pre(4, "video.ended", { reqId: 1 })],
        8,
      ),
      makeCase(
        "a-stop-on-the-resumed-tick-wins",
        "The restart effect is posted in the waits phase, before any thread runs; a mediaStop() the resumed thread runs in the same tick comes after it in post order, so the stop wins (a play cue then a stop cue at tick 7).",
        s(),
        [music(0, "song.mid"), cmd(6, "playavi", { thread: 1, file: "intro.avi" }), pre(7, "video.ended", { reqId: 1 }), cmd(7, "mediaStop", { track: "music" })],
        10,
      ),
      makeCase(
        "missing-video-changes-nothing",
        "A video name that does not resolve is media.video-missing: no request, no hold, no wait and the music is not touched.",
        s(),
        [music(0, "song.mid"), cmd(4, "playavi", { thread: 1, file: "nofile.avi" })],
        8,
      ),
      makeCase(
        "second-video-while-pending-is-busy",
        "At most one video is outstanding: a second call in the same tick is media.video-busy and returns at once; the first thread alone wakes.",
        s(),
        [music(0, "song.mid"), cmd(4, "playavi", { thread: 1, file: "intro.avi" }), cmd(4, "playavi", { thread: 2, file: "outro.avi" }), pre(5, "video.ended", { reqId: 1 })],
        9,
      ),
      makeCase(
        "stale-reply-is-ignored",
        "A video.ended for an unknown reqId is ignored; the real reply (reqId 1) in the same held tick wakes the thread.",
        s(),
        [music(0, "song.mid"), cmd(4, "playavi", { thread: 1, file: "intro.avi" }), pre(5, "video.ended", { reqId: 99 }), pre(5, "video.ended", { reqId: 1 })],
        9,
      ),
    ],
  };
}

/** The round-8 and round-9 legacy facts, once each, with where the oracle shows the Reawakened disposition. */
const row = (id, kind, fact, disposition, where) => ({ id, kind, fact, disposition, where });
const at = (scene, caseName) => ({ scene, case: caseName });
const LEDGER = [
  row("Q1", "timeline", "mp3pause takes a file and, in 3.1.0, waits while the music keeps playing; no command pauses music.", "Follow 3.1.0: mp3pause(file) is a sfx once|wait play.", at("legacy-parity-ledger", "mp3pause-waits-while-music-keeps-playing")),
  row("Q2", "timeline", "wav never waits; mp3 aliases it.", "Keep.", at("legacy-parity-ledger", "wav-and-mp3-never-wait-and-play-once")),
  row("Q3", "timeline", "One sfx slot replaces a different file and ignores the same playing name.", "Keep on the one-voice sfx track.", at("legacy-parity-ledger", "one-sfx-slot-replaces-or-ignores")),
  row("Q4", "timeline", "wavStop stops the script, default-menu and default-battle sfx slot, not music or animation-frame sounds.", "Keep the sfx mapping; frame sounds join sfx (6.3 A5); menu sounds move to ui.", at("legacy-parity-ledger", "wavstop-leaves-music-alone")),
  row("Q5", "timeline", "The same music name (case-insensitive) carries on while playing and restarts when stopped.", "Keep in the music applier; a restart request is the new override.", at("legacy-parity-ledger", "midiplay-carries-on-and-stop-retains")),
  row("Q6", "timeline", "Missing music stops the old music first, then is silent with no error.", "Keep: a null or missing board request stops and clears music, no error.", at("legacy-parity-ledger", "board-entry-silence-and-replay")),
  row("Q7", "timeline", "Board entry compares with the music loaded now; empty means silence; the final version blocks replay after an empty or failed name.", "Follow 3.1.0: compare the current track, empty is silence, no replay block.", at("legacy-parity-ledger", "board-entry-silence-and-replay")),
  row("Q8", "timeline", "A battle takes over board music; a fight without music has no fallback.", "Owner rule (BAT-10): non-empty battle .bkg music takes over; absent music posts no effect and board music continues.", at("battle-music-handoff", "battle-without-music-is-silent")),
  row("Q9", "timeline", "Pre-fight music restarts from the beginning; in-fight changes are lost; game over restores it.", "Owner rule (BAT-10): after boardReturned, the board/audio producer reads the active board's music; battle code stores no pre-fight filename.", at("battle-music-handoff", "battle-music-then-return")),
  row("Q10", "timeline", "mediaStop retains the name; a board, battle or video later restarts it.", "Keep: stop rewinds but retains file.", at("legacy-parity-ledger", "midiplay-carries-on-and-stop-retains")),
  row("Q11", "departure", "Legacy saves stored no audio; load plays the board music; reset does not stop music.", "Deliberate departure: the save carries playback and re-emits it, music restarts from zero; reset keeps legacy behaviour.", at("settings-versus-save", "save-and-load-restore-playback-not-settings")),
  row("Q12", "timeline", "Volume clamps 0..100, starts at 100 and is not remembered; in 3.1.0 zero is quiet-but-audible; the final version has no audible effect.", "Follow 3.1.0: integer script settings, initial 100, not a save or reset field.", at("legacy-parity-ledger", "setvolume-is-a-script-setting")),
  row("Q13", "timeline", "Volume is not saved and reset does not change it.", "Keep in the settings split.", at("settings-versus-save", "reset-leaves-audio-untouched")),
  row("Q14", "unresolved", "Frame sounds have a separate player apart from setVolume and wavStop; the frame-0 trigger depends on a missing owner breakdown.", "Amended by 6.3: frame sounds are one-shot sfx voices; frame-0 per-case timing is unruled until the owner supplies the fact.", at("animation-frame-sfx", "wavstop-stops-a-frame-sound")),
  row("Q15", "runner", "Focus loss pauses the game; the engine does not touch audio; the platform decides audibility.", "Keep: core stops advancing; the runner focus policy (pause by default) cannot change cue meaning. Not a core timeline fact.", null),
  row("Q16", "timeline", "A video stops the music and freezes everything, cannot be skipped, and afterwards the music restarts from zero even if stopped.", "Keep: core hold, music stop and a restart effect with source video.", at("video-restarts-music", "stopped-music-restarts-anyway")),
  row("Q17", "platform", "3.1.0 played all listed formats and looped music; the final version played only MIDI.", "Follow 3.1.0 through import-time transcoding; trackers are a documented departure. Format policy is not a core timeline fact; the authored files carry the lengths.", null),
  row("Q18", "timeline", "Files are under Media, subfolders allowed, no extension added, case-insensitive; packages did not unpack frame sounds or check videos.", "Keep the path rule and the ASCII fold (name folding is on every case); the package gaps are not reproduced.", at("same-file-rules", "music-same-file-carries-on")),
  row("Q19", "timeline", "The music virtual shows the battle music and is non-empty after mediaStop.", "Keep: it reads the music track's retained file.", at("battle-music-handoff", "music-virtual-follows-the-music-track-file")),
  row("M1", "timeline", "Music always loops in both versions and has no once argument.", "Keep looping as the music default; a non-looping one-shot is a Reawakened addition.", at("legacy-parity-ledger", "midiplay-carries-on-and-stop-retains")),
  row("M2", "timeline", "Replaying an already-playing track carries on.", "Keep as the same-file rule unless the caller requests a restart.", at("same-file-rules", "music-same-file-carries-on")),
  row("M3", "timeline", "Board and battle music use the same repeat setting.", "Keep: both are looping music.", at("battle-music-handoff", "battle-music-then-return")),
  row("M4", "timeline", "wav, mp3 and mp3pause never loop.", "Keep: every legacy sfx mapping plays once and never waits.", at("legacy-parity-ledger", "wav-and-mp3-never-wait-and-play-once")),
];
