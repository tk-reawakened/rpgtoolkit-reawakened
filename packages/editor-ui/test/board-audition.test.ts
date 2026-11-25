// The background-music audition's source: the format a reference plays as, and the message each refusal shows the author.
import { test } from "node:test";
import { equal, ok, deepEqual } from "node:assert/strict";
import type { AudioOutputService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { applyMainSettings, createCommandRegistry } from "@tk-reawakened/editor-model";
import { newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import { auditionFormatOf, createAuditionCommands, createAuditionControls, loadAuditionInput, type AuditionOutcome, type BoardAudition } from "../src/board-audition.ts";

// The host must never be reached by these paths: the source is judged before any playback starts.
const unreachableAudio: AudioOutputService = {
  play: async () => { throw new Error("the audition must not reach the host"); },
  stop: async () => { throw new Error("the audition must not reach the host"); },
};

function auditionOf(files: Record<string, Uint8Array>, main: string | null): BoardAudition {
  const host = createMemoryPlatformServices({ files });
  return { audioOutput: unreachableAudio, fs: host.fs, projectId: "memory-project", main };
}

function refusalOf<T>(outcome: AuditionOutcome<T>): string {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome.message;
}

function valueOf<T>(outcome: AuditionOutcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.value;
}

const MIDI = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 4, 0, 255, 47, 0]);
const BANK = new Uint8Array([83, 70, 50]);

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

test("auditionFormatOf judges wav, mid and midi by extension, ignoring case", () => {
  deepEqual(auditionFormatOf("bgm.wav"), { ok: true, value: "wav" });
  deepEqual(auditionFormatOf("Theme.MIDI"), { ok: true, value: "midi" });
  deepEqual(auditionFormatOf("theme.mid"), { ok: true, value: "midi" });
});

test("auditionFormatOf refuses other formats with the list it plays", () => {
  equal(refusalOf(auditionFormatOf("bgm.mp3")), 'Audition plays .wav, .mid and .midi files. "bgm.mp3" is none of these.');
});

test("an empty reference asks for a file before anything else", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, "main.gam"), "   ")), "Set a background music file first.");
});

test("an unsupported format is refused before the main file is read", async () => {
  ok(refusalOf(await loadAuditionInput(auditionOf({}, null), "bgm.mp3")).startsWith("Audition plays .wav, .mid and .midi files."));
});

test("no main file open tells the author what to set", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, null), "bgm.wav")), "Set the project's main file to audition sound.");
});

test("a WAV in the Media folder loads with no SoundFont", async () => {
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const input = valueOf(await loadAuditionInput(auditionOf({ "Media/bgm.wav": bytes }, "main.gam"), "bgm.wav"));
  deepEqual(input.bytes, bytes);
  equal(input.format, "wav");
  equal(input.soundFont, null);
  equal(input.notice, null);
});

test("a missing WAV names the file and the Media folder", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, "main.gam"), "bgm.wav")), 'Could not read "bgm.wav" from the project\'s Media folder.');
});

test("a MIDI whose main file cannot be read says so instead of playing silently", async () => {
  const files = { "Media/theme.mid": new Uint8Array([77, 84, 104, 100]) };
  equal(refusalOf(await loadAuditionInput(auditionOf(files, "main.gam"), "theme.mid")), 'Could not read the project\'s main file "main.gam".');
});

test("a MIDI plays with the SoundFont its project names", async () => {
  const files = { "main.gam": mainWithSoundFont("bank.sf2"), "Media/theme.mid": MIDI, "Media/bank.sf2": BANK };
  const input = valueOf(await loadAuditionInput(auditionOf(files, "main.gam"), "theme.mid"));
  equal(input.format, "midi");
  deepEqual(input.soundFont, BANK);
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

test("play from the palette starts the active board's reference through the output", async () => {
  const played: Array<{ bytes: Uint8Array; format: string }> = [];
  const output: AudioOutputService = {
    play: async (bytes, format) => {
      played.push({ bytes, format });
      return { ok: true, value: undefined };
    },
    stop: async () => ({ ok: true, value: undefined }),
  };
  const bytes = new Uint8Array([82, 73, 70, 70]);
  const host = createMemoryPlatformServices({ files: { "Media/bgm.wav": bytes } });
  const controls = createAuditionControls({ audioOutput: output, fs: host.fs, projectId: "memory-project", main: "main.gam" });
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
  const controls = createAuditionControls({ audioOutput: recordingOutput(plays), fs: host.fs, projectId: "memory-project", main: "main.gam" });
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
  const controls = createAuditionControls({ audioOutput: recordingOutput(plays), fs: host.fs, projectId: "memory-project", main: "main.gam" });
  controls.setReference("theme.mid");
  await controls.play();
  equal(plays.length, 1);
  equal(plays[0]?.soundFont, null);
  equal(controls.getSnapshot().note, 'The project\'s default SoundFont "missing.sf2" could not be read, so the bundled bank plays instead.');
});
