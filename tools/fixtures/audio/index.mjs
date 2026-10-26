// The audio oracle's producer entry point (ticket 6.4).
//
//   audioFixtureFiles() -> [relative name, bytes][]   the committed fixture bytes (scenes, audio files, manifest)
//   checkAudioFiles()   -> string[]                   the authored files parse to their hand-worked lengths
//   checkAudioCorpus(root) -> string[]                corpus pins, when the corpus is fetched
//   checkAudioImports() -> string[]                   static import scan: no packages/core
//
// Every scene is authored from docs/spec/engine/audio-media.md (the anchors it names) and its expected per-tick
// facts (track states, cues, wait wake-ups and end events) are derived by this directory's own reference timeline
// (sim.mjs). Nothing here imports packages/core, so a later core implementation cannot pass by sharing code with
// its oracle. State and cue hashes are deliberately absent: the consuming entries (6.6 onwards) assert those.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceImports } from "../movement/index.mjs";
import { AUDIO_FILES } from "./files.mjs";
import { midiInfo, wavInfo } from "./length.mjs";
import { animationFrameSfx, boardMusicBoot, loopAndEndTicks, sameFileRules, trackTransport } from "./scenes-a.mjs";
import { fades, lateStartCatchUp, mediaWaitSuspend, syncedStart, voicesAndStealing } from "./scenes-b.mjs";
import { battleMusicHandoff, legacyParityLedger, settingsVersusSave, soundfontSetting, videoRestartsMusic } from "./scenes-c.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
export const AUDIO_OUT = join(repoRoot, "packages", "core", "test", "fixtures", "audio");
export const SPEC = "docs/spec/engine/audio-media.md";

/** Proposed rulings the specification leaves open; each is recorded in the plan for owner review. */
export const PROPOSED = {
  "P-1": "Row sampling: the row for tick t is the state at the end of the audio phase of tick t, before time advances; a voice started in tick t has position 0 in row t.",
  "P-2": "Cue tick: the tick at which the applier applied the transition. Effects drained when the applier registers carry the registration tick and follow the start soundfont.set; a one-shot's finish emits media.stop in the audio phase of its end tick.",
  "P-3": "Finish: at the audio phase of its end tick a one-shot is removed from the track (the track keeps file and flags), a finished fact is recorded once, and the track's primary view then reads position 0 and an unknown length.",
  "P-4": "A paused voice keeps its pre-pause startTick, endTick and fade start; resume shifts all three by the paused span, and a fade started while paused begins counting at resume.",
  "P-5": "Loop is per voice (the voice rows carry it); a track's flags are the loop bit of its voice 0 only (tkMD_WAIT and tkMD_RESTART are play-time instructions and are not retained); a track's file is the file most recently started on it.",
  "P-6": "Fades: the descriptor is cleared in the audio phase of the tick at which the elapsed ticks reach the duration and the volume becomes the target; a zero-duration fade is a media.fade cue with durationTicks 0 and an immediate set; mediaVolume cancels a running fade; a fade with no voice argument is a track (bus) fade, kept beside the track and not in a voice's fade field.",
  "P-7": "Cue fields: media.play carries loop, flags (the loop bit), the starting positionTicks (the synced position for a synced start) and the voice's script volume; stop, pause, resume, seek, flags and fade carry the track and voice index (a bus fade or volume has voice null, the master volume has track null).",
  "P-8": "Waits: a finite one-shot's wait reads the voice's current endTick (so a pause or a seek moves it); a pass wait wakes when the voice's pass index exceeds the index at creation; a wait whose voice is gone (stopped, finished, stolen, or replaced so the cue id differs) wakes at the next waits phase.",
  "P-9": "Load: the cue counter is the larger of the current and the saved one; the current configured tracks, voice counts and bank stay unchanged and unconfigured saved tracks/slots are ignored (MEDIA-4/audio-save-load, #481). Re-emit the current effective bank first; a resumed non-music voice's cue has tick = load tick minus its saved position and position 0, music's has the load tick and position 0; saving a voice with a running fade, loading a paused voice and loading with a thread parked in a wait are outside the oracle (a hard error).",
  "P-10": "A same-file play on a single-voice track while playing is a recorded no-cue outcome (carry-on on music, ignored elsewhere); with tkMD_RESTART it is stop then play; on a paused single-voice track it is unruled.",
  "P-11": "Legacy names resolve case-insensitively to media/<lower-case name>; each is evaluated as the standard call of 6.2's mapping table and records a legacy fact naming it.",
  "P-12": "Video: playavi stops the music at the call tick (a media.stop only when a voice exists) and parks the thread; video.ended is stamped at the held tick, the row of the next consumed tick, whose waits phase wakes the thread and then posts a restart music.play (source video, retained file and loop flag, restart set) when the music track retained a file.",
  "P-13": "Steal: the victim is the lowest priority, then the oldest startTick, then the lowest index (a paused voice counts as active with its stale start); the stolen index is stopped (media.stop) before the new play; a steal fact names the victim.",
  "P-14": "A file no decoder accepts plays with length null and endTick null and raises one media.asset-format diagnostic at the play; a seek or a wait on an unknown length raises media.asset-length; a sync on an unknown-length destination raises media.sync-source and starts the otherwise valid destination at position zero.",
  "P-15": "Scripts give seconds as whole milliseconds; ticks = floor((ms x 60 + 500) / 1000), the exact integer form of floor(seconds x 60 + 1/2).",
  "P-16": "Late runner: for a media.play the runner facts apply, in this order, the drop (finite, not looping, not music, lateness at least 15 ticks), then the loop modulo, then not starting a finite one-shot whose caught-up position reaches its length.",
  "P-17": "Diagnostic choice where 6.2 lists several: a voice index at or above the configured count, or a voice with no occupant for a seek, fade or volume, is media.unknown-voice.",
  "P-18": "A row lists the track (bus) volume or an active track fade only for tracks not at 100, the master volume only when not 100, and the script bank when set; none of them is read by a load.",
};

const SCENES = [
  ["board-music-boot", boardMusicBoot, ["P-1", "P-2", "P-10", "P-14"]],
  ["animation-frame-sfx", animationFrameSfx, ["P-2", "P-10", "P-13", "P-18"]],
  ["track-transport", trackTransport, ["P-1", "P-3", "P-4", "P-5", "P-15", "P-17"]],
  ["loop-and-end-ticks", loopAndEndTicks, ["P-2", "P-3", "P-8", "P-14"]],
  ["same-file-rules", sameFileRules, ["P-5", "P-10", "P-13"]],
  ["voices-and-stealing", voicesAndStealing, ["P-8", "P-13", "P-17"]],
  ["fades", fades, ["P-4", "P-6", "P-7", "P-15", "P-18"]],
  ["synced-start", syncedStart, ["P-7", "P-14", "P-17"]],
  ["late-start-catch-up", lateStartCatchUp, ["P-9", "P-16"]],
  ["media-wait-suspend", mediaWaitSuspend, ["P-3", "P-4", "P-8", "P-17"]],
  ["settings-versus-save", settingsVersusSave, ["P-9", "P-18"]],
  ["soundfont-setting", soundfontSetting, ["P-2", "P-9"]],
  ["battle-music-handoff", battleMusicHandoff, ["P-10"]],
  ["legacy-parity-ledger", legacyParityLedger, ["P-8", "P-11", "P-15"]],
  ["video-restarts-music", videoRestartsMusic, ["P-12"]],
];
export const SCENE_NAMES = SCENES.map(([name]) => name);

/**
 * The reachable corpus the length pins model. The files are fetched at test time (`pnpm fixtures:fetch`) and are
 * never committed; only their digests and the lengths the oracle's independent reader measures are pinned here.
 * (die.wav is checked by hand in the tests: 7351 frames at 8000 Hz is 55.13 ticks, 55.)
 */
export const CORPUS = {
  source: "chrisbmatthews/rpgtoolkit @ 9191b9191c9bda0998c6faae16929b3331ed2ead and tk-reawakened/ludotheque @ 0489f5da225438f8fcd62d958711dc7bad7e8207 (fixtures/legacy/.fetched.json)",
  note: "Lengths are measured by tools/fixtures/audio/length.mjs, not by the core decoders; entry 6.5 must agree with them. The files are read only when fetched and are never committed.",
  wav: [
    { path: "Basic/Media/die.wav", sha256: "8fa7f2a9b20ffa905224347f1bd6e733c68a5bbc2b45d34ab0b8262dadf681f2", codec: "pcm8", channels: 1, rate: 8000, frames: 7351, lengthTicks: 55 },
    { path: "Basic/Media/fight.wav", sha256: "81aacc3e1b1855f2d06dbed26d42f8048ef3adf55250c264d07393b1aae5799d", codec: "pcm8", channels: 1, rate: 8000, frames: 2497, lengthTicks: 19 },
    { path: "Basic/Media/hit.wav", sha256: "000c431ee48b31e06490dad5f650d84605c6432b89193ad5b76a3f2492b50844", codec: "pcm8", channels: 1, rate: 8000, frames: 3797, lengthTicks: 28 },
    { path: "Basic/Media/item.wav", sha256: "bd1c21086fb9a8699f790920c0f92856eb08a5a90106d98461835d22b8e2d692", codec: "pcm8", channels: 1, rate: 8000, frames: 12938, lengthTicks: 97 },
    { path: "Caoquest/Media/Knifewish.wav", sha256: "5f18c64ecbddda20e12152fe838663e27d278113275e85c1a5cbf9c4156eff3e", codec: "ima-adpcm", channels: 1, rate: 22050, frames: 3206, lengthTicks: 9 },
    { path: "Caoquest/Media/boom.WAV", sha256: "0b0c1788829f7105b46747a2f36238fe4679a9f6ccf274f535e35d4ab3f83386", codec: "ms-adpcm", channels: 1, rate: 11025, frames: 10908, lengthTicks: 59 },
    { path: "Caoquest/Media/slash.wav", sha256: "84856d1c8c78f7c16741094f7d1a8cdad8681f5331285bfa9dd7a9c1085b1d6f", codec: "ms-adpcm", channels: 1, rate: 11025, frames: 1812, lengthTicks: 10 },
  ],
  midi: [
    { path: "Basic/Media/VIP - Boss1.mid", sha256: "a0b43da36a074e28f1bfecdc7ed5263c2c8ac77bb470d4e9753dc1505b52e05c", type: 1, division: 120, dialect: "gm", bankSelect: false, lengthTicks: 13507 },
    { path: "Basic/Media/VIP - Action.mid", sha256: "b83e2a9414f253dfd21cfb35ad68ebc17b259e56c8633c57260b73abb3b08df5", type: 0, division: 480, dialect: "xg", bankSelect: true, lengthTicks: 23369 },
    { path: "Basic/Media/VIP - Battle1.mid", sha256: "09543041427b87c8d2225b6e6a619eb0d4078cdb43ce8a2ed27e7312cd0b2a6a", type: 0, division: 120, dialect: "gm", bankSelect: false, lengthTicks: 25869 },
    { path: "Basic/Media/VIP -  Battle or Boss.mid", sha256: "af015ea22897823d61a1bd294d15efaf25d98e236460a8a053abf3f6eb79ad4b", type: 0, division: 120, dialect: "gm", bankSelect: true, lengthTicks: 19190 },
    { path: "School2Demo/Media/school.mid", sha256: "79b039015210de13c710f3662c0a11a1fd5c531f4a3e578d1dcae4daf53f1244", type: 1, division: 120, dialect: "gs", bankSelect: true, lengthTicks: 15805 },
  ],
};

const INLINE = 118;
const ONE_PER_LINE = new Set(["expect", "script", "ledger"]);

/** Stable pretty-printer: short values inline, long ones indented, rows of facts one per line. */
function format(value, indent = "", key = "") {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value) && ONE_PER_LINE.has(key)) {
    if (value.length === 0) return "[]";
    const pad = `${indent}  `;
    return `[\n${value.map((v) => pad + JSON.stringify(v)).join(",\n")}\n${indent}]`;
  }
  const flat = JSON.stringify(value);
  if (flat.length <= INLINE) return flat;
  const pad = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => pad + format(v, pad)).join(",\n")}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${format(v, pad, k)}`).join(",\n")}\n${indent}}`;
}

function sceneDocument(name, build, proposed) {
  const scene = build();
  return {
    scene: name,
    schema: 1,
    note: "Authored from docs/spec; expected facts are derived by tools/fixtures/audio, not by packages/core. No state or cue hashes: later entries assert those.",
    tick: "60 Hz fixed; phases input, waits, threads, events, movement, edges, triggers, animation, audio, time (AD-26). Random encounters hand off from triggers. A row is the state at the end of the audio phase of its tick.",
    units: "ticks (1/60 s); volumes are integer percentages; seconds in scripts are whole milliseconds",
    row: "t tick; cfg [track, configured voices] (first tick and on change); tr [track, state, flags, file, positionTicks, lengthTicks, voices] for each track with a file or a voice; voice [index, state, cueId, priority, volume, startTick, positionTicks, endTick, loop, fade [from, to, start, duration] or null]; bus [track, volume, fade]; master; sf (script bank); cues (the 12-key AudioCue records emitted this tick); ev (facts: wait, wake, finished, steal, same-file, diag, legacy, video ...)",
    spec: scene.spec.map((anchor) => `${SPEC}#${anchor}`),
    proposed,
    ...(scene.ledger !== undefined ? { ledger: scene.ledger } : {}),
    cases: scene.cases,
  };
}

const WAV_INFO_KEYS = ["codec", "channels", "rate", "frames", "lengthTicks", "workings"];
const MIDI_INFO_KEYS = ["type", "division", "lengthTicks", "bank", "workings"];

/** Every committed audio fixture: `[file name, bytes]`, the authored files under `files/`, plus the manifest. */
export function audioFixtureFiles() {
  const docs = SCENES.map(([name, build, proposed]) => sceneDocument(name, build, proposed));
  const files = docs.map((doc) => [`${doc.scene}.json`, Buffer.from(`${format(doc)}\n`)]);
  for (const entry of AUDIO_FILES) files.push([`files/${entry.name}`, Buffer.from(entry.bytes)]);
  const manifest = {
    schema: 1,
    scenes: docs.map((doc) => ({ scene: doc.scene, file: `${doc.scene}.json`, cases: doc.cases.map((c) => c.name), proposed: doc.proposed })),
    files: AUDIO_FILES.map((entry) => {
      const keys = entry.kind === "wav" ? WAV_INFO_KEYS : MIDI_INFO_KEYS;
      return { file: `files/${entry.name}`, kind: entry.kind, bytes: entry.bytes.length, ...Object.fromEntries(keys.map((k) => [k, entry[k]])) };
    }),
    proposed: PROPOSED,
    corpus: CORPUS,
  };
  files.push(["manifest.json", Buffer.from(`${format(manifest)}\n`)]);
  return files;
}

/** The authored files parse (with the independent reader) to exactly their hand-worked facts. */
export function checkAudioFiles() {
  const problems = [];
  for (const entry of AUDIO_FILES) {
    const info = entry.kind === "wav" ? wavInfo(entry.bytes) : midiInfo(entry.bytes);
    if (!info.ok) {
      problems.push(`${entry.name}: ${info.error}`);
      continue;
    }
    if (info.lengthTicks !== entry.lengthTicks) problems.push(`${entry.name}: parses to ${info.lengthTicks} ticks, hand-worked ${entry.lengthTicks}`);
    if (entry.kind === "wav") {
      for (const key of ["codec", "channels", "rate", "frames"]) if (info[key] !== entry[key]) problems.push(`${entry.name}: ${key} ${info[key]}, hand-worked ${entry[key]}`);
    } else {
      if (info.type !== entry.type || info.division !== entry.division) problems.push(`${entry.name}: header ${info.type}/${info.division}, hand-worked ${entry.type}/${entry.division}`);
      if (info.dialect !== entry.bank.dialect || info.bankSelect !== entry.bank.bankSelect) problems.push(`${entry.name}: bank ${info.dialect}/${info.bankSelect}, hand-worked ${entry.bank.dialect}/${entry.bank.bankSelect}`);
    }
  }
  return problems;
}

/** When the legacy corpus has been fetched, prove the pinned files are the ones the length pins describe. */
export function checkAudioCorpus(root = repoRoot) {
  const base = join(root, "fixtures", "legacy");
  if (!existsSync(base)) return [];
  const problems = [];
  const pins = [...CORPUS.wav.map((p) => ({ ...p, kind: "wav" })), ...CORPUS.midi.map((p) => ({ ...p, kind: "midi" }))];
  for (const pin of pins) {
    const path = join(base, pin.path);
    if (!existsSync(path)) {
      problems.push(`corpus: ${pin.path} is missing from ${base}`);
      continue;
    }
    const bytes = readFileSync(path);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== pin.sha256) {
      problems.push(`corpus: ${pin.path} digest ${digest} is not the pinned ${pin.sha256}`);
      continue;
    }
    const info = pin.kind === "wav" ? wavInfo(bytes) : midiInfo(bytes);
    if (!info.ok) {
      problems.push(`corpus: ${pin.path} no longer parses: ${info.error}`);
      continue;
    }
    for (const key of Object.keys(pin)) {
      if (key === "path" || key === "sha256" || key === "kind") continue;
      if (info[key] !== pin[key]) problems.push(`corpus: ${pin.path} ${key} is ${info[key]}, pinned ${pin[key]}`);
    }
  }
  return problems;
}

/** Static import scan (ticket 6.4 verification): no audio oracle module or its test may reach packages/core. */
export function checkAudioImports() {
  const files = [...readdirSync(here).filter((f) => f.endsWith(".mjs")).map((f) => join(here, f))];
  return files.flatMap((file) => workspaceImports(readFileSync(file, "utf8")).map((spec) => `${file}: imports ${spec}`));
}
