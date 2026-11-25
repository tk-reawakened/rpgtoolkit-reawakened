// The audio output of 14.5 as the factory presents it: a host with no synth has no audition service, the bytes are copied
// before the host sees them, and each refusal says why in a message the editor can show.
import { test } from "node:test";
import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import { audioOutputFromApi } from "../src/index.ts";

test("a host without an audio output has no audition service", () => {
  equal(audioOutputFromApi(undefined), null);
  equal(audioOutputFromApi(null), null);
  equal(audioOutputFromApi({} as never), null);
});

test("play hands the host a copy of the bytes, so the caller's buffer is never touched", async () => {
  let received: Uint8Array | undefined;
  let receivedFont: Uint8Array | null | undefined;
  const service = audioOutputFromApi({
    play: async (bytes, _format, options) => { received = bytes; receivedFont = options.soundFont; return { ok: true }; },
    stop: () => {},
  });
  ok(service);
  const source = new Uint8Array([1, 2, 3]);
  const font = new Uint8Array([7, 8]);
  ok((await service.play(source, "midi", { loop: true, soundFont: font })).ok);
  ok(received);
  notEqual(received, source, "the host gets its own copy");
  notEqual(receivedFont, font, "the host gets its own copy of the SoundFont too");
  source[0] = 9;
  font[0] = 9;
  deepEqual(Array.from(received), [1, 2, 3], "changing the caller's bytes afterwards does not reach the host");
  deepEqual(Array.from(receivedFont ?? []), [7, 8], "changing the SoundFont afterwards does not reach the host");
});

test("an autoplay refusal becomes permission-denied with a message that says to click the page", async () => {
  const service = audioOutputFromApi({
    play: async () => ({ ok: false, reason: "autoplay-locked", detail: "suspended" }),
    stop: () => {},
  });
  ok(service);
  const result = await service.play(new Uint8Array(), "midi", { loop: false, soundFont: null });
  if (result.ok) throw new Error("expected a refusal");
  equal(result.error.code, "permission-denied");
  ok(result.error.message.includes("click the page"));
});

test("an unsupported format becomes unavailable and keeps the host's own reason", async () => {
  const service = audioOutputFromApi({
    play: async () => ({ ok: false, reason: "unsupported-format", detail: "OGG audio is not supported in the browser yet." }),
    stop: () => {},
  });
  ok(service);
  const result = await service.play(new Uint8Array(), "wav", { loop: false, soundFont: null });
  if (result.ok) throw new Error("expected a refusal");
  equal(result.error.code, "unavailable");
  equal(result.error.message, "OGG audio is not supported in the browser yet.");
});

test("a MIDI audition with no configured SoundFont is not refused here: the host gets null and picks the bundled bank", async () => {
  let received: Uint8Array | null | undefined;
  const service = audioOutputFromApi({
    play: async (_bytes, _format, options) => { received = options.soundFont; return { ok: true }; },
    stop: () => {},
  });
  ok(service);
  ok((await service.play(new Uint8Array([1]), "midi", { loop: false, soundFont: null })).ok);
  equal(received, null, "the factory passes the absence through; the host chooses the bank (rank 4 of the spec)");
});

test("missing-soundfont surfaces as unavailable with the host's message, only when the host cannot supply any bank", async () => {
  const service = audioOutputFromApi({
    play: async () => ({ ok: false, reason: "missing-soundfont", detail: "The bundled SoundFont could not be loaded." }),
    stop: () => {},
  });
  ok(service);
  const result = await service.play(new Uint8Array([1]), "midi", { loop: false, soundFont: null });
  if (result.ok) throw new Error("expected a refusal");
  equal(result.error.code, "unavailable");
  equal(result.error.message, "The bundled SoundFont could not be loaded.");
});

test("a thrown error from the host becomes unavailable, never a thrown error here", async () => {
  const service = audioOutputFromApi({
    play: async () => { throw new Error("synth crashed"); },
    stop: () => { throw new Error("synth crashed"); },
  });
  ok(service);
  const played = await service.play(new Uint8Array(), "wav", { loop: false, soundFont: null });
  const stopped = await service.stop();
  if (played.ok || stopped.ok) throw new Error("expected both calls to be refused");
  equal(played.error.code, "unavailable");
  equal(stopped.error.code, "unavailable");
});

test("stop succeeds and reaches the host", async () => {
  let stopped = 0;
  const service = audioOutputFromApi({
    play: async () => ({ ok: true }),
    stop: () => { stopped += 1; },
  });
  ok(service);
  ok((await service.stop()).ok);
  equal(stopped, 1);
});

test("loop reaches the host on play, and false reaches it too", async () => {
  const seen: boolean[] = [];
  const service = audioOutputFromApi({
    play: async (_bytes, _format, options) => { seen.push(options.loop); return { ok: true }; },
    stop: () => {},
  });
  ok(service);
  ok((await service.play(new Uint8Array([1]), "wav", { loop: true, soundFont: null })).ok);
  ok((await service.play(new Uint8Array([1]), "wav", { loop: false, soundFont: null })).ok);
  deepEqual(seen, [true, false]);
});

test("output-unavailable surfaces as unavailable with the host's message", async () => {
  const service = audioOutputFromApi({
    play: async () => ({ ok: false, reason: "output-unavailable", detail: "No audio output device could be opened." }),
    stop: () => {},
  });
  ok(service);
  const result = await service.play(new Uint8Array([1]), "wav", { loop: false, soundFont: null });
  if (result.ok) throw new Error("expected a refusal");
  equal(result.error.code, "unavailable");
  equal(result.error.message, "No audio output device could be opened.");
});
