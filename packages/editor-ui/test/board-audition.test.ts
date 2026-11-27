// The background-music audition's source: the format a reference plays as, and the message each refusal shows the author.
import { test } from "node:test";
import { equal, ok, deepEqual } from "node:assert/strict";
import type { AudioOutputService, PlatformResult } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { applyMainSettings, createCommandRegistry } from "@tk-reawakened/editor-model";
import { decodeMidi, newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import { auditionFormatOf, createAuditionCommands, createBattleBackgroundAuditionCommands, createAuditionControls, loadAuditionInput, type AuditionControls, type AuditionOutcome, type AuditionPathResolution, type BattleBackgroundAuditionTarget, type BoardAudition } from "../src/board-audition.ts";

// The host must never be reached by these paths: the source is judged before any playback starts.
const unreachableAudio: AudioOutputService = {
  play: async () => { throw new Error("the audition must not reach the host"); },
  stop: async () => { throw new Error("the audition must not reach the host"); },
};

function auditionOf(files: Record<string, Uint8Array>, main: string | null, projectFolder = ""): BoardAudition {
  const host = createMemoryPlatformServices({ files });
  return { audioOutput: unreachableAudio, fs: host.fs, projectId: "memory-project", layout: { projectFolder }, main };
}

function refusalOf<T>(outcome: AuditionOutcome<T>): string {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome.message;
}

function valueOf<T>(outcome: AuditionOutcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

// A hand-authored Standard MIDI File, format 0: one track with middle C on at tick 0 and off at tick 96.
const MIDI = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0]);
const BANK = new Uint8Array([83, 70, 50]);
// The twelve header bytes a WAV needs to be recognised (RIFF, a size, WAVE), then a tail that tells two files apart.
const wav = (...tail: number[]): Uint8Array => new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, ...tail]);

// A main file whose audio block names the given SoundFont.
function mainWithSoundFont(soundFont: string): Uint8Array {
  const written = writeMainFile(applyMainSettings(newProjectMainFile(), { defaultSoundFont: soundFont }));
  if (!written.ok) throw new Error("the main file must serialize");
  return written.value;
}

// A host that records what each play was given and answers without audio.
function recordingOutput(plays: Array<{ format: string; soundFont: Uint8Array | null | undefined }>): AudioOutputService {
  return {
    play: async (_bytes, format, options) => {
      plays.push({ format, soundFont: options.soundFont });
      return { ok: true, value: undefined };
    },
    stop: async () => ({ ok: true, value: undefined }),
  };
}

test("auditionFormatOf judges the bytes: a RIFF/WAVE file is wav and an MThd file is midi, whatever the name", () => {
  deepEqual(auditionFormatOf("bgm.mp3", wav()), { ok: true, value: "wav" });
  deepEqual(auditionFormatOf("Theme.WAV", MIDI), { ok: true, value: "midi" });
  deepEqual(auditionFormatOf("theme", MIDI), { ok: true, value: "midi" });
});

test("auditionFormatOf refuses bytes that are neither, whatever the name says", () => {
  const message = 'Audition plays WAV and MIDI files, judged by their contents. "bgm.wav" is neither: its first bytes are not a WAV or MIDI header.';
  equal(refusalOf(auditionFormatOf("bgm.wav", new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0]))), message);
  equal(refusalOf(auditionFormatOf(" bgm.wav ", new Uint8Array([]))), message);
  // A RIFF container that is not a WAVE form is not a WAV.
  equal(refusalOf(auditionFormatOf("bgm.wav", new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 65, 86, 73, 32]))), message);
});

test("an empty reference asks for a file before anything else", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, "main.gam"), "   ")), "Set a background music file first.");
});

test("bytes that are neither WAV nor MIDI are refused without reading the main file", async () => {
  const files = { "Media/bgm.mp3": new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0]) };
  ok(refusalOf(await loadAuditionInput(auditionOf(files, "main.gam"), "bgm.mp3")).startsWith("Audition plays WAV and MIDI files, judged by their contents."));
});

test("a header-valid WAV at a .mp3 name plays as WAV, and a MIDI at a .wav name plays as MIDI with the project's bank", async () => {
  const mislabelled = valueOf(await loadAuditionInput(auditionOf({ "Media/bgm.mp3": wav(9) }, null), "bgm.mp3"));
  equal(mislabelled.format, "wav");
  deepEqual(mislabelled.bytes, wav(9));
  const files = { "Main/A.gam": mainWithSoundFont("bank.sf2"), "Game/A/Media/theme.wav": MIDI, "Game/A/Media/bank.sf2": BANK };
  const midi = valueOf(await loadAuditionInput(auditionOf(files, "Main/A.gam", "Game/A"), "theme.wav"));
  equal(midi.format, "midi");
  deepEqual(midi.soundFont, BANK);
});

test("a WAV at a .mid name chooses no bank, so an unreadable main file is not consulted", async () => {
  const input = valueOf(await loadAuditionInput(auditionOf({ "Media/theme.mid": wav() }, "missing.gam"), "theme.mid"));
  equal(input.format, "wav");
  equal(input.soundFont, null);
  equal(input.notice, null);
});

test("a WAV in the board owner's Media folder loads without a main file", async () => {
  const bytes = wav();
  const input = valueOf(await loadAuditionInput(auditionOf({ "Media/bgm.wav": bytes }, null), "bgm.wav"));
  deepEqual(input.bytes, bytes);
  equal(input.format, "wav");
  equal(input.soundFont, null);
  equal(input.notice, null);
});

test("an exact resolved audio reference is not trimmed before reading its path", async () => {
  const bytes = wav(1);
  const input = valueOf(await loadAuditionInput(auditionOf({ "Media/ ": bytes }, null), " ", "Media/ "));
  deepEqual(input.bytes, bytes);
  equal(input.format, "wav");
});

test("a missing WAV names the file and the Media folder", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, "main.gam"), "bgm.wav")), 'Could not read "bgm.wav" from the project\'s Media folder.');
});

test("a MIDI whose main file cannot be read says so instead of playing silently", async () => {
  const files = { "Media/theme.mid": new Uint8Array([77, 84, 104, 100]) };
  equal(refusalOf(await loadAuditionInput(auditionOf(files, "main.gam"), "theme.mid")), 'Could not read the project\'s main file "main.gam".');
});

test("the hand-authored MIDI fixture decodes as a Standard MIDI File", () => {
  ok(decodeMidi(MIDI).ok);
});

test("a MIDI plays with the SoundFont its project names", async () => {
  const files = { "Main/A.gam": mainWithSoundFont("bank.sf2"), "Game/A/Media/theme.mid": MIDI, "Game/A/Media/bank.sf2": BANK };
  const input = valueOf(await loadAuditionInput(auditionOf(files, "Main/A.gam", "Game/A"), "theme.mid"));
  equal(input.format, "midi");
  deepEqual(input.soundFont, BANK);
  equal(input.notice, null);
});
test("a loose MIDI uses the host's bundled bank when no Main is available", async () => {
  const input = valueOf(await loadAuditionInput(auditionOf({ "Media/theme.mid": MIDI }, null), "theme.mid"));
  equal(input.format, "midi");
  equal(input.soundFont, null);
  equal(input.notice, null);
});

test("a MIDI whose project SoundFont is missing plays the bundled bank and says so", async () => {
  const files = { "main.gam": mainWithSoundFont("missing.sf2"), "Media/theme.mid": MIDI };
  const input = valueOf(await loadAuditionInput(auditionOf(files, "main.gam"), "theme.mid"));
  equal(input.soundFont, null);
  equal(input.notice, 'The project\'s default SoundFont "missing.sf2" could not be read, so the bundled bank plays instead.');
});

// The palette's background-music commands: registered under their ids, disabled with no board, and playing the active board's reference.
test("the palette registers the three background-music commands", () => {
  const registry = createCommandRegistry(createAuditionCommands(() => null));
  deepEqual(registry.getCommands().map((command) => command.id), ["board.audition.play", "board.audition.stop", "board.audition.loop"]);
});

test("with no board active, every audition command is disabled and does not run", () => {
  const registry = createCommandRegistry(createAuditionCommands(() => null));
  equal(registry.getCommands().every((command) => command.disabled === true), true);
  equal(registry.execute("board.audition.play"), false);
  equal(registry.execute("board.audition.stop"), false);
  equal(registry.execute("board.audition.loop"), false);
});
test("the fight-background palette registers per-cue Play plus owned Stop and Loop commands", async () => {
  const references = { music: "battle.wav", selectSound: "move.wav", chooseSound: "", readySound: "", cantDoSound: "" };
  const played: string[] = [];
  const paths: string[] = [];
  let loop = false;
  let note: string | null = null;
  let generation = 0;
  let stops = 0;
  const controls = {
    subscribe: () => () => {},
    getSnapshot: () => ({ loop, note }),
    beginPlay: () => { generation += 1; return generation; },
    isPlayCurrent: (token: number) => token === generation,
    setNote: (next: string | null, token?: number) => { if (token === undefined || token === generation) note = next; },
    setReference: (reference: string, path?: string) => { paths.push(`${reference}:${path}`); },
    setLoop: (next: boolean) => { loop = next; },
    play: async () => { played.push("play"); },
    stop: () => { generation += 1; stops++; },
    dispose: () => {},
  };
  const registry = createCommandRegistry(createBattleBackgroundAuditionCommands(() => ({
    controls,
    reference: (field) => references[field],
    resolvePath: async (reference) => ({ ok: true, path: `Media/${reference}` }),
  })));
  deepEqual(registry.getCommands().map((command) => command.id), [
    "battle-background.audition.play.music",
    "battle-background.audition.play.selectSound",
    "battle-background.audition.play.chooseSound",
    "battle-background.audition.play.readySound",
    "battle-background.audition.play.cantDoSound",
    "battle-background.audition.stop",
    "battle-background.audition.loop",
  ]);
  equal(registry.execute("battle-background.audition.play.selectSound"), true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  deepEqual(paths, ["move.wav:Media/move.wav"]);
  deepEqual(played, ["play"]);
  equal(registry.execute("battle-background.audition.loop"), true);
  equal(loop, true);
  equal(registry.execute("battle-background.audition.stop"), true);
  equal(stops, 1);
});
test("Stop cancels a BKG command while its path lookup is pending", async () => {
  const played: Uint8Array[] = [];
  let stops = 0;
  const host = createMemoryPlatformServices({ files: { "Media/old.wav": wav(6), "Media/battle.wav": wav(7) } });
  const controls = createAuditionControls({
    audioOutput: {
      play: async (bytes) => { played.push(bytes); return { ok: true, value: undefined }; },
      stop: async () => { stops += 1; return { ok: true, value: undefined }; },
    },
    fs: host.fs,
    projectId: "memory-project",
    layout: { projectFolder: "" },
    main: null,
  });
  controls.setReference("old.wav");
  await controls.play();
  let started!: () => void;
  const resolving = new Promise<void>((resolve) => { started = resolve; });
  let finish!: (result: { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string }) => void;
  const gate = new Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string }>((resolve) => { finish = resolve; });
  const commands = createBattleBackgroundAuditionCommands(() => ({
    controls,
    reference: () => "battle.wav",
    resolvePath: async () => { started(); return await gate; },
  }));
  const play = commands.find((command) => command.id === "battle-background.audition.play.music")!;
  const stop = commands.find((command) => command.id === "battle-background.audition.stop")!;
  const pending = play.run();
  await resolving;
  stop.run();
  finish({ ok: true, path: "Media/battle.wav" });
  await pending;
  equal(played.length, 1, "the stopped view's pending path resolution cannot start a second sound");
  equal(stops, 1, "Stop silences this view's existing playback while cancelling its pending lookup");
});
test("a fast play from a later view wins over an earlier slow BKG path lookup", async () => {
  const firstBytes = wav(11);
  const laterBytes = wav(12);
  const host = createMemoryPlatformServices({ files: { "Media/first.wav": firstBytes, "Media/later.wav": laterBytes } });
  const played: Uint8Array[] = [];
  const output: AudioOutputService = {
    play: async (bytes) => { played.push(bytes); return { ok: true, value: undefined }; },
    stop: async () => ({ ok: true, value: undefined }),
  };
  let started!: () => void;
  const lookupStarted = new Promise<void>((resolve) => { started = resolve; });
  let release!: (result: AuditionPathResolution) => void;
  const gate = new Promise<AuditionPathResolution>((resolve) => { release = resolve; });
  const controls = () => createAuditionControls({
    audioOutput: output,
    fs: host.fs,
    projectId: "memory-project",
    layout: { projectFolder: "" },
    main: null,
  });
  const firstControls = controls();
  const laterControls = controls();
  const playFor = (current: AuditionControls, reference: string, resolvePath: BattleBackgroundAuditionTarget["resolvePath"]) => {
    const command = createBattleBackgroundAuditionCommands(() => ({
      controls: current,
      reference: () => reference,
      resolvePath,
    })).find(({ id }) => id === "battle-background.audition.play.music")!;
    return command.run();
  };
  const slowFirst = playFor(firstControls, "first.wav", async () => {
    started();
    return await gate;
  });
  await lookupStarted;
  await playFor(laterControls, "later.wav", async () => ({ ok: true, path: "Media/later.wav" }));
  release({ ok: true, path: "Media/first.wav" });
  await slowFirst;
  deepEqual(played, [laterBytes], "the earlier lookup cannot supersede a newer view's playback");
});
test("BKG command lookup preserves exact text and reports unresolved links", async () => {
  const reference = " battle.wav ";
  const path = "Media/ battle.wav ";
  const bytes = wav(8);
  const readPaths: string[] = [];
  const played: Uint8Array[] = [];
  let failLookup = false;
  const controls = createAuditionControls({
    audioOutput: {
      play: async (input) => { played.push(input); return { ok: true, value: undefined }; },
      stop: async () => ({ ok: true, value: undefined }),
    },
    fs: {
      readProject: async (_projectId, requested) => {
        readPaths.push(requested);
        return requested === path ? { ok: true, value: bytes } : { ok: false, error: { code: "not-found", message: requested } };
      },
    },
    projectId: "memory-project",
    layout: { projectFolder: "" },
    main: null,
  });
  const commands = createBattleBackgroundAuditionCommands(() => ({
    controls,
    reference: () => failLookup ? "missing.wav" : reference,
    resolvePath: async (stored) => {
      equal(stored, failLookup ? "missing.wav" : reference, "resolution receives exactly the value stored in the form");
      return failLookup ? { ok: false, message: "Media/missing.wav is not in the project." } : { ok: true, path };
    },
  }));
  await commands.find((command) => command.id === "battle-background.audition.play.music")!.run();
  deepEqual(readPaths, [path]);
  deepEqual(played, [bytes]);
  failLookup = true;
  await commands.find((command) => command.id === "battle-background.audition.play.music")!.run();
  equal(controls.getSnapshot().note, "Media/missing.wav is not in the project.", "lookup failure is shown to the author instead of silently ignored");
  deepEqual(readPaths, [path], "a missing link is never read");
});


test("play from the palette starts the active board's reference through the output", async () => {
  const played: Array<{ bytes: Uint8Array; format: string }> = [];
  const output: AudioOutputService = {
    play: async (bytes, format) => {
      played.push({ bytes, format });
      return { ok: true, value: undefined };
    },
    stop: async () => ({ ok: true, value: undefined }),
  };
  const bytes = wav();
  const host = createMemoryPlatformServices({ files: { "Media/bgm.wav": bytes } });
  const controls = createAuditionControls({ audioOutput: output, fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: "main.gam" });
  controls.setReference("bgm.wav");
  const registry = createCommandRegistry(createAuditionCommands(() => controls));
  equal(registry.execute("board.audition.play"), true);
  for (let turn = 0; played.length === 0 && turn < 100; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  equal(played.length, 1);
  equal(played[0]?.format, "wav");
  deepEqual(played[0]?.bytes, bytes);
});

test("play starts a MIDI with its project SoundFont and publishes no note", async () => {
  const plays: Array<{ format: string; soundFont: Uint8Array | null | undefined }> = [];
  const host = createMemoryPlatformServices({ files: { "main.gam": mainWithSoundFont("bank.sf2"), "Media/theme.mid": MIDI, "Media/bank.sf2": BANK } });
  const controls = createAuditionControls({ audioOutput: recordingOutput(plays), fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: "main.gam" });
  controls.setReference("theme.mid");
  await controls.play();
  equal(plays.length, 1);
  equal(plays[0]?.format, "midi");
  deepEqual(plays[0]?.soundFont, BANK);
  equal(controls.getSnapshot().note, null);
});

test("play with a missing project SoundFont plays the bundled bank and shows why", async () => {
  const plays: Array<{ format: string; soundFont: Uint8Array | null | undefined }> = [];
  const host = createMemoryPlatformServices({ files: { "main.gam": mainWithSoundFont("missing.sf2"), "Media/theme.mid": MIDI } });
  const controls = createAuditionControls({ audioOutput: recordingOutput(plays), fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: "main.gam" });
  controls.setReference("theme.mid");
  await controls.play();
  equal(plays.length, 1);
  equal(plays[0]?.soundFont, null);
  equal(controls.getSnapshot().note, 'The project\'s default SoundFont "missing.sf2" could not be read, so the bundled bank plays instead.');
});
test("disposing the current audition does not cancel a newer view's pending play", async () => {
  const oldBytes = wav(1);
  const newBytes = wav(2);
  const base = createMemoryPlatformServices({ files: { "Media/old.wav": oldBytes, "Media/new.wav": newBytes } });
  const played: Uint8Array[] = [];
  let stops = 0;
  const output: AudioOutputService = {
    play: async (bytes) => { played.push(bytes); return { ok: true, value: undefined }; },
    stop: async () => { stops++; return { ok: true, value: undefined }; },
  };
  let startedRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { startedRead = resolve; });
  const readGate = (() => {
    let release!: (result: PlatformResult<Uint8Array>) => void;
    const promise = new Promise<PlatformResult<Uint8Array>>((resolve) => { release = resolve; });
    return { promise, release: (result: PlatformResult<Uint8Array>) => release(result) };
  })();
  const fs = {
    readProject: async (_projectId: string, path: string): Promise<PlatformResult<Uint8Array>> => {
      if (path === "Media/new.wav") {
        startedRead();
        return await readGate.promise;
      }
      return base.fs.readProject("memory-project", path);
    },
  };
  const makeControls = (reference: string, files: typeof base.fs) => {
    const controls = createAuditionControls({ audioOutput: output, fs: files, projectId: "memory-project", layout: { projectFolder: "" }, main: null });
    controls.setReference(reference);
    return controls;
  };
  const first = makeControls("old.wav", base.fs);
  const second = createAuditionControls({ audioOutput: output, fs, projectId: "memory-project", layout: { projectFolder: "" }, main: null });
  second.setReference("new.wav");
  await first.play();
  equal(played.length, 1);
  const pendingPlay = second.play();
  await readStarted;
  first.dispose();
  equal(stops, 1, "disposing the old owner stops its playback without advancing the shared cancellation generation");
  readGate.release({ ok: true, value: newBytes });
  await pendingPlay;
  equal(played.length, 2, "the newer pending play reaches the shared output");
  deepEqual(played[1], newBytes);
});
void test("stopping one view never stops another view's playback or cancels its pending play", async () => {
  const oldBytes = wav(3);
  const newBytes = wav(4);
  const host = createMemoryPlatformServices({ files: { "Media/old.wav": oldBytes, "Media/new.wav": newBytes } });
  const played: Uint8Array[] = [];
  let stops = 0;
  const output: AudioOutputService = {
    play: async (bytes) => { played.push(bytes); return { ok: true, value: undefined }; },
    stop: async () => { stops += 1; return { ok: true, value: undefined }; },
  };
  const unrelated = createAuditionControls({ audioOutput: output, fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: null });
  const owner = createAuditionControls({ audioOutput: output, fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: null });
  owner.setReference("old.wav");
  await owner.play();
  unrelated.stop();
  equal(stops, 0, "an unrelated view cannot stop playback it does not own");

  let startedRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { startedRead = resolve; });
  const readGate = (() => {
    let release!: (result: PlatformResult<Uint8Array>) => void;
    const promise = new Promise<PlatformResult<Uint8Array>>((resolve) => { release = resolve; });
    return { promise, release: (result: PlatformResult<Uint8Array>) => release(result) };
  })();
  const delayedFs = {
    readProject: async (_projectId: string, path: string): Promise<PlatformResult<Uint8Array>> => {
      if (path === "Media/new.wav") {
        startedRead();
        return await readGate.promise;
      }
      return host.fs.readProject("memory-project", path);
    },
  };
  const pending = createAuditionControls({ audioOutput: output, fs: delayedFs, projectId: "memory-project", layout: { projectFolder: "" }, main: null });
  pending.setReference("new.wav");
  const play = pending.play();
  await readStarted;
  owner.stop();
  equal(stops, 1, "the existing owner stops its current output without canceling the newer pending play");
  readGate.release({ ok: true, value: newBytes });
  await play;
  deepEqual(played, [oldBytes, newBytes]);
  unrelated.stop();
  equal(stops, 1, "an unrelated view still cannot stop the newer view's playback");
});

test("a refused file reports why, never reaches the host, and leaves the reference as it was", async () => {
  const host = createMemoryPlatformServices({ files: { "Media/bgm.mp3": new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 0, 0]), "Media/ok.mp3": wav(5) } });
  const played: Array<{ bytes: Uint8Array; format: string }> = [];
  const controls = createAuditionControls({
    audioOutput: { play: async (bytes, format) => { played.push({ bytes, format }); return { ok: true, value: undefined }; }, stop: async () => ({ ok: true, value: undefined }) },
    fs: host.fs, projectId: "memory-project", layout: { projectFolder: "" }, main: null,
  });
  controls.setReference("bgm.mp3");
  await controls.play();
  deepEqual(played, [], "unsupported bytes never reach the host");
  ok(controls.getSnapshot().note?.includes('"bgm.mp3" is neither'));
  controls.setReference("ok.mp3");
  await controls.play();
  deepEqual(played, [{ bytes: wav(5), format: "wav" }], "a header-valid WAV under a .mp3 name plays as WAV");
  equal(controls.getSnapshot().note, null);
});
