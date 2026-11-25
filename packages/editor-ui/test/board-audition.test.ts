// The background-music audition's source: the format a reference plays as, and the message each refusal shows the author.
import { test } from "node:test";
import { equal, ok, deepEqual } from "node:assert/strict";
import type { AudioOutputService } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { auditionFormatOf, loadAuditionInput, type AuditionOutcome, type BoardAudition } from "../src/board-audition.ts";

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
});

test("a missing WAV names the file and the Media folder", async () => {
  equal(refusalOf(await loadAuditionInput(auditionOf({}, "main.gam"), "bgm.wav")), 'Could not read "bgm.wav" from the project\'s Media folder.');
});

test("a MIDI whose main file cannot be read says so instead of playing silently", async () => {
  const files = { "Media/theme.mid": new Uint8Array([77, 84, 104, 100]) };
  equal(refusalOf(await loadAuditionInput(auditionOf(files, "main.gam"), "theme.mid")), 'Could not read the project\'s main file "main.gam".');
});
