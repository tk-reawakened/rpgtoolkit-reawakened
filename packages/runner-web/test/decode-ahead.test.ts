// The decode-ahead client (issue #934, OQ3) against an in-process stand-in for a Worker. The stand-in clones every posted
// message with real structured-clone semantics, so a transferred buffer really detaches: "the caller's bytes survive" is a
// fact about buffers here, not about a mock's bookkeeping. One group of tests drives the replies by hand to pin ordering,
// gaps, `settled` and `close`; the last group wires the real `prepareJob` behind the fake and compares with host decodes.

import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AssetKey } from "@tk-reawakened/core";
import { decodeAssetTexture } from "@tk-reawakened/runner-harness";
import { midiLengthTicks, preparePcm, sha256Hex } from "@tk-reawakened/synth";
import { createDecodeAhead, DecodeAheadError } from "../src/decode-ahead.ts";
import type { DecodeAhead, DecodeJob, DecodeReply } from "../src/decode-types.ts";
import { prepareJob } from "../src/decode-worker.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const audioFiles = join(root, "packages", "core", "test", "fixtures", "audio", "files");
const file = (...parts: string[]): Uint8Array => new Uint8Array(readFileSync(join(root, ...parts)));

type Posted = { readonly job: DecodeJob; readonly sent: ArrayBuffer; readonly transfer: readonly ArrayBuffer[] };

/** A Worker that records what it is sent and lets a test (or a handler) answer. */
class FakeWorker {
  onmessage: ((event: MessageEvent<DecodeReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: Posted[] = [];
  terminated = 0;
  private readonly handler: ((job: DecodeJob, worker: FakeWorker) => void) | null;

  constructor(handler: ((job: DecodeJob, worker: FakeWorker) => void) | null = null) {
    this.handler = handler;
  }

  postMessage(message: DecodeJob, transfer: ArrayBuffer[]): void {
    const sent = message.bytes;
    // Real structured clone: the transferred buffers detach in the sender, the receiver gets its own.
    const received = structuredClone(message, { transfer });
    this.posted.push({ job: received, sent, transfer });
    this.handler?.(received, this);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** Deliver a worker reply, cloned and (like a real worker) transferring its buffers. */
  reply(reply: DecodeReply, transfer: readonly ArrayBuffer[] = []): void {
    this.onmessage?.({ data: structuredClone(reply, { transfer: [...transfer] }) } as MessageEvent<DecodeReply>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

const spawnOf = (worker: FakeWorker) => (): Worker => worker as unknown as Worker;
const key = (name: string): AssetKey => name as AssetKey;
const RATE = 8_000;

function make(worker = new FakeWorker()): { readonly worker: FakeWorker; readonly ahead: DecodeAhead } {
  return { worker, ahead: createDecodeAhead({ outputRateHz: RATE, spawn: spawnOf(worker) }) };
}

const pixels = (w: number, h: number) => ({ w, h, rgba: new Uint8Array(w * h * 4).fill(7) });

test("no worker can be made: that is a clear error, never a no-op object", () => {
  throws(
    () => createDecodeAhead({ outputRateHz: RATE, spawn: () => { throw new Error("blocked by policy"); } }),
    (error: unknown) => error instanceof DecodeAheadError && /could not be created: blocked by policy/.test(error.message),
  );
  // Node has no global Worker, so the default spawn is a real failure to create one.
  throws(() => createDecodeAhead({ outputRateHz: RATE }), (error: unknown) => error instanceof DecodeAheadError);
  throws(() => createDecodeAhead({ outputRateHz: 0, spawn: spawnOf(new FakeWorker()) }), RangeError);
});

test("jobs reach the worker in the order they were queued, each with its key, kind, rate and a fresh id", () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("b.wav"), new Uint8Array([2]), "audio");
  ahead.prepare(key("c.mid"), new Uint8Array([3]), "midi");
  ahead.prepare(key("d.sf2"), new Uint8Array([4]), "soundfont");
  deepEqual(
    worker.posted.map(({ job }) => [job.type, job.id, job.key, job.kind, job.outputRateHz]),
    [["job", 1, "a.png", "image", RATE], ["job", 2, "b.wav", "audio", RATE], ["job", 3, "c.mid", "midi", RATE], ["job", 4, "d.sf2", "soundfont", RATE]],
  );
  equal(ahead.stats().submitted, 4);
});

test("the caller's bytes are copied, not transferred: still attached, still theirs, and not the buffer the worker got", () => {
  const { worker, ahead } = make();
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
  const view = backing.subarray(2, 5);
  ahead.prepare(key("a.png"), view, "image");

  const posted = worker.posted[0];
  if (posted === undefined) throw new Error("nothing was posted");
  equal(backing.byteLength, 7, "the caller's buffer was not detached");
  equal(view.byteLength, 3);
  deepEqual([...view], [1, 2, 3]);
  ok(posted.sent !== backing.buffer, "the worker got a different buffer");
  equal(posted.sent.byteLength, 0, "the copy was transferred (detached in the sender)");
  deepEqual([...new Uint8Array(posted.job.bytes)], [1, 2, 3], "only the view's bytes were copied");
  equal(posted.transfer.length, 1);
  equal(posted.transfer[0], posted.sent);

  // Changing the caller's bytes afterwards cannot reach what the worker already holds.
  view[0] = 200;
  deepEqual([...new Uint8Array(posted.job.bytes)], [1, 2, 3]);
});

test("a repeat of a key already queued, in flight or settled is a no-op", async () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  equal(worker.posted.length, 1);
  worker.reply({ type: "image", id: 1, pixels: pixels(1, 1) });
  await ahead.settled();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  equal(worker.posted.length, 1);
  equal(ahead.stats().submitted, 1);
});

test("results arrive per key whatever order the worker answers in, and nothing is ready before it", async () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("b.wav"), new Uint8Array([2]), "audio");
  ahead.prepare(key("c.mid"), new Uint8Array([3]), "midi");
  equal(ahead.image(key("a.png")), null);
  equal(ahead.audio(key("b.wav")), null);

  // Out of order on purpose: job 3, then 1, then 2.
  worker.reply({ type: "audio", id: 3, audio: { kind: "midi", lengthTicks: 42 } });
  deepEqual(ahead.audio(key("c.mid")), { kind: "midi", lengthTicks: 42 });
  equal(ahead.image(key("a.png")), null, "a different job's reply makes nothing else ready");

  const rgba = new Uint8Array(4 * 2).fill(5);
  worker.reply({ type: "image", id: 1, pixels: { w: 2, h: 1, rgba } }, [rgba.buffer as ArrayBuffer]);
  deepEqual(ahead.image(key("a.png")), { w: 2, h: 1, rgba: new Uint8Array(8).fill(5) });

  const samples = new Float32Array([0.5, -0.5]);
  worker.reply({ type: "audio", id: 2, audio: { kind: "pcm", channels: 1, outputRateHz: RATE, samples, sourceRate: RATE, sourceFrames: 2 } });
  await ahead.settled();
  const audio = ahead.audio(key("b.wav"));
  ok(audio !== null && audio.kind === "pcm");
  deepEqual(ahead.stats(), { submitted: 3, completed: 3, failed: 0, gaps: [], workerError: null });
  // The wrong accessor for a kind gives nothing: an image key has no audio and the reverse.
  equal(ahead.audio(key("a.png")), null);
  equal(ahead.image(key("b.wav")), null);
});

test("an unpreparable job is a named gap, a failed one is also counted as failed, and both settle", async () => {
  const { worker, ahead } = make();
  ahead.prepare(key("song.ogg"), new Uint8Array([1]), "audio");
  ahead.prepare(key("broken.wav"), new Uint8Array([2]), "audio");
  ahead.prepare(key("ok.png"), new Uint8Array([3]), "image");
  worker.reply({ type: "gap", id: 1, reason: "unsupported: song.ogg: not a RIFF/WAVE file", failed: false });
  worker.reply({ type: "gap", id: 2, reason: "failed: broken.wav: format.malformed: truncated", failed: true });
  worker.reply({ type: "image", id: 3, pixels: pixels(1, 1) });
  await ahead.settled();
  deepEqual(ahead.stats(), {
    submitted: 3,
    completed: 1,
    failed: 1,
    gaps: [
      { key: "song.ogg", kind: "audio", reason: "unsupported: song.ogg: not a RIFF/WAVE file" },
      { key: "broken.wav", kind: "audio", reason: "failed: broken.wav: format.malformed: truncated" },
    ],
    workerError: null,
  });
  equal(ahead.audio(key("song.ogg")), null);
  equal(ahead.audio(key("broken.wav")), null);
});

test("settled resolves at once when nothing is queued, and only once every job queued so far has settled", async () => {
  const { worker, ahead } = make();
  await ahead.settled();

  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("b.png"), new Uint8Array([2]), "image");
  let done = false;
  const waited = ahead.settled().then(() => { done = true; });
  // A job queued after the wait began is not waited for.
  ahead.prepare(key("late.png"), new Uint8Array([3]), "image");

  await Promise.resolve();
  equal(done, false);
  worker.reply({ type: "image", id: 1, pixels: pixels(1, 1) });
  await Promise.resolve();
  equal(done, false, "one of two is not enough");
  worker.reply({ type: "gap", id: 2, reason: "unsupported: x", failed: false });
  await waited;
  equal(done, true);
  equal(ahead.stats().completed, 1);
  equal(ahead.stats().gaps.length, 1);
});

test("a worker that dies fails what it still owed, by name, and later jobs fail the same way; settled still resolves", async () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("b.wav"), new Uint8Array([2]), "audio");
  const waited = ahead.settled();
  worker.fail("Script error: 404");
  await waited;

  const stats = ahead.stats();
  equal(stats.failed, 2);
  equal(stats.completed, 0);
  equal(stats.workerError, "the decode worker failed: Script error: 404");
  deepEqual(stats.gaps.map((gap) => [gap.key, gap.kind, gap.reason.startsWith("failed: ")]), [["a.png", "image", true], ["b.wav", "audio", true]]);

  ahead.prepare(key("c.png"), new Uint8Array([3]), "image");
  equal(worker.posted.length, 2, "nothing more is sent to a dead worker");
  equal(ahead.stats().failed, 3);
  equal(ahead.stats().gaps[2]?.key, "c.png");
  await ahead.settled();
});

test("a reply for a job nobody is waiting on is a worker fault, not a silent success", () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  worker.reply({ type: "image", id: 99, pixels: pixels(1, 1) });
  equal(ahead.image(key("a.png")), null);
  ok(ahead.stats().workerError?.includes("job 99"));
  equal(ahead.stats().failed, 1);
});

test("close terminates the worker, drops results, frees waiters, ignores late replies, and refuses new work", async () => {
  const { worker, ahead } = make();
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  ahead.prepare(key("b.png"), new Uint8Array([2]), "image");
  worker.reply({ type: "image", id: 1, pixels: pixels(1, 1) });
  ok(ahead.image(key("a.png")) !== null);
  const waited = ahead.settled();

  ahead.close();
  await waited;
  equal(worker.terminated, 1);
  equal(ahead.image(key("a.png")), null, "results are dropped");

  worker.reply({ type: "image", id: 2, pixels: pixels(1, 1) });
  equal(ahead.image(key("b.png")), null, "a reply after close is ignored");
  worker.fail("late");
  equal(ahead.stats().workerError, null);

  throws(() => ahead.prepare(key("c.png"), new Uint8Array([3]), "image"), DecodeAheadError);
  ahead.close();
  equal(worker.terminated, 1, "close is idempotent");
  await ahead.settled();
});

test("a worker that refuses a job fails it by name", () => {
  const worker = new FakeWorker();
  worker.postMessage = (): void => { throw new Error("DataCloneError"); };
  const { ahead } = make(worker);
  ahead.prepare(key("a.png"), new Uint8Array([1]), "image");
  equal(ahead.stats().failed, 1);
  ok(ahead.stats().gaps[0]?.reason.includes("DataCloneError"));
});

// With the real preparation behind the fake, the client hands back exactly what the host's own functions make.
function realWorker(): FakeWorker {
  return new FakeWorker((job, worker) => {
    const { reply, transfer } = prepareJob(job);
    queueMicrotask(() => worker.reply(reply, transfer));
  });
}

test("with the real preparation behind it, images, WAV, MIDI and SoundFonts come back identical to the host's own decode", async () => {
  const worker = realWorker();
  const ahead = createDecodeAhead({ outputRateHz: 44_100, spawn: spawnOf(worker) });

  const png = file("media", "icons", "png", "tkr-64.png");
  const tileset = file("packages", "core", "test", "fixtures", "authored", "detail4.tst");
  const wavNames = ["pcm16-mono-8000.wav", "ima-adpcm-stereo-8000.wav", "msadpcm-mono-8000.wav"];
  const midiBytes = new Uint8Array(readFileSync(join(audioFiles, "midi1-240-tempo-map.mid")));
  const bank = file("media", "soundfonts", "TK-16.sf2");
  ahead.prepare(key("icon.png"), png, "image");
  ahead.prepare(key("ground.tst"), tileset, "image");
  for (const name of wavNames) ahead.prepare(key(name), new Uint8Array(readFileSync(join(audioFiles, name))), "audio");
  ahead.prepare(key("song.mid"), midiBytes, "midi");
  ahead.prepare(key("TK-16.sf2"), bank, "soundfont");
  await ahead.settled();

  for (const [name, bytes] of [["icon.png", png], ["ground.tst", tileset]] as const) {
    const host = decodeAssetTexture(key(name), bytes);
    const got = ahead.image(key(name));
    ok(host !== null && got !== null, `${name} decoded`);
    equal(got.w, host.w);
    equal(got.h, host.h);
    deepEqual(got.rgba, host.rgba);
  }
  for (const name of wavNames) {
    const host = preparePcm(new Uint8Array(readFileSync(join(audioFiles, name))), 44_100);
    const got = ahead.audio(key(name));
    ok(host.ok && got !== null && got.kind === "pcm", `${name} prepared`);
    equal(got.sourceFrames, host.value.sourceFrames);
    equal(got.sourceRate, host.value.sourceRate);
    equal(got.channels, host.value.channels);
    deepEqual(got.samples, host.value.samples);
  }
  const host = midiLengthTicks(midiBytes);
  ok(host.ok);
  deepEqual(ahead.audio(key("song.mid")), { kind: "midi", lengthTicks: host.value });
  deepEqual(ahead.audio(key("TK-16.sf2")), { kind: "soundfont", sha256: sha256Hex(bank), size: bank.length });
  deepEqual(ahead.stats(), { submitted: 7, completed: 7, failed: 0, gaps: [], workerError: null });
  equal(png.byteLength > 0 && bank.byteLength > 0, true, "the caller's buffers are still attached");
  ahead.close();
});

test("with the real preparation behind it, every format it cannot prepare is a named gap and nothing hangs", async () => {
  const worker = realWorker();
  const ahead = createDecodeAhead({ outputRateHz: 44_100, spawn: spawnOf(worker) });
  const wav = new Uint8Array(readFileSync(join(audioFiles, "pcm16-mono-8000.wav")));
  const smpte = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28]);
  ahead.prepare(key("anim.tan"), new Uint8Array(16), "image");
  ahead.prepare(key("tiles.tbm"), new Uint8Array(16), "image");
  ahead.prepare(key("junk.png"), new Uint8Array([1, 2, 3, 4]), "image");
  ahead.prepare(key("song.ogg"), new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]), "audio");
  ahead.prepare(key("short.wav"), wav.slice(0, 30), "audio");
  ahead.prepare(key("smpte.mid"), smpte, "midi");
  ahead.prepare(key("broken.mid"), new Uint8Array([1, 2, 3]), "midi");
  ahead.prepare(key("not.sf2"), wav, "soundfont");
  const hugeBank = new Uint8Array(8 * 1024 * 1024 + 1);
  hugeBank.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x73, 0x66, 0x62, 0x6b]);
  ahead.prepare(key("too-big.sf2"), hugeBank, "soundfont");
  await ahead.settled();

  const stats = ahead.stats();
  equal(stats.submitted, 9);
  equal(stats.completed, 0);
  deepEqual(
    stats.gaps.map((gap) => [gap.key, gap.kind, gap.reason.split(":")[0]]),
    [
      ["anim.tan", "image", "unsupported"],
      ["tiles.tbm", "image", "unsupported"],
      ["junk.png", "image", "unsupported"],
      ["song.ogg", "audio", "unsupported"],
      ["short.wav", "audio", "failed"],
      ["smpte.mid", "midi", "unsupported"],
      ["broken.mid", "midi", "failed"],
      ["not.sf2", "soundfont", "failed"],
      ["too-big.sf2", "soundfont", "unsupported"],
    ],
  );
  equal(stats.failed, 3, "only bytes of a covered format that failed to decode count as failed");
  ok(stats.gaps.every((gap) => gap.reason.includes(gap.key)), "every gap names its asset");
  ok(/animated tiles/.test(stats.gaps[0]?.reason ?? ""));
  const tbmGap = stats.gaps.find((gap) => gap.key === key("tiles.tbm"));
  ok(tbmGap !== undefined && (/tile bitmap/.test(tbmGap.reason) || /animated tiles/.test(tbmGap.reason)), ".tbm names the tile bitmap/animated-tiles branch");
  ahead.close();
  let settledThrew = false;
  try {
    await ahead.settled().then(() => { throw new Error("settled-probe"); });
  } catch (error) {
    settledThrew = error instanceof Error && error.message === "settled-probe";
  }
  ok(settledThrew);
});
