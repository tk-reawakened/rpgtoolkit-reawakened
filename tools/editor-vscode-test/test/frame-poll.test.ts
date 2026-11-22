// #3257: a preview webview can be replaced between frame enumeration and a locator query. The poll must re-enumerate
// inside its deadline, record what detached, and still fail at the deadline when nothing matching ever mounts.
import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import { isFrameDetachment, pollPageFrames, type FramePollOptions } from "../frame-poll.ts";

interface FakeFrame {
  readonly label: string;
}

const preview: FakeFrame = { label: "preview-22" };
const other: FakeFrame = { label: "extension host" };

/** A clock the injected sleep advances, so a 30 s deadline is proven instantly and deterministically. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      slept.push(ms);
      time += ms;
    },
    slept,
  };
}

function options(
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
  overrides: Partial<FramePollOptions<FakeFrame, { readonly tile: string }>>,
): FramePollOptions<FakeFrame, { readonly tile: string }> {
  return {
    label: "Native read-only History frame",
    frames: () => [other, preview],
    describe: (frame) => `frame ${frame.label}`,
    probe: async (frame) => frame === preview ? { tile: "village.tst1" } : null,
    accept: (reports) => reports.length === 1,
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  };
}

test("a frame that detaches once re-enumerates and the next attempt finds the mounted preview", async () => {
  const clock = fakeClock();
  let enumerations = 0;
  const outcome = await pollPageFrames(options(clock, {
    // First enumeration offers a preview whose locator query finds it gone; the replacement appears next time.
    frames: () => {
      enumerations += 1;
      return enumerations === 1 ? [other, { label: "preview-stale" }] : [other, preview];
    },
    probe: async (frame) => {
      if (frame.label === "preview-stale") throw new Error("locator.count: Frame was detached");
      return frame === preview ? { tile: "village.tst1" } : null;
    },
  }));
  equal(enumerations, 2, "the poll must re-enumerate after the detachment, not fail");
  equal(outcome.reports[0]?.frame, preview);
  deepEqual(outcome.detached, ["frame preview-stale detached during its probe: locator.count: Frame was detached"]);
  // 100 ms first interval: the re-enumeration stays inside the existing 30 s deadline and is paced, not a tight loop.
  deepEqual(clock.slept, [100]);
});

test("a page whose frame list cannot be taken re-enumerates instead of aborting", async () => {
  const clock = fakeClock();
  let enumerations = 0;
  const outcome = await pollPageFrames(options(clock, {
    frames: () => {
      enumerations += 1;
      if (enumerations === 1) throw new Error("Target page, context or browser has been closed");
      return [preview];
    },
  }));
  equal(enumerations, 2);
  deepEqual(outcome.detached, ["the page's frames could not be listed: Target page, context or browser has been closed"]);
  equal(outcome.reports[0]?.value.tile, "village.tst1");
});

test("a frame that never mounts fails at the deadline naming what detached, not silently", async () => {
  const clock = fakeClock();
  await rejects(pollPageFrames(options(clock, {
    frames: () => [{ label: "preview-stale" }],
    probe: async () => { throw new Error("locator.count: Frame was detached"); },
    timeoutMs: 30_000,
  })), /Native read-only History frame was not found within 30000 ms \(detached while polling: frame preview-stale detached during its probe: locator\.count: Frame was detached(?: \(x\d+\))?\)\. Last attempt: no frame matched\./);
  // The deadline stays at the existing 30 s; retries are paced with the existing backoff and never spin.
  equal(clock.slept[0], 100);
  equal(clock.slept[3], 1_000);
  equal(clock.slept.every((ms) => ms >= 100), true);
  equal(clock.slept.reduce((total, ms) => total + ms, 0) >= 30_000, true);
});

test("a probe error that is not a detachment fails at once instead of being retried as churn", async () => {
  const clock = fakeClock();
  await rejects(pollPageFrames(options(clock, {
    probe: async () => { throw new Error("locator.inputValue: element is not an input"); },
  })), /element is not an input/);
  deepEqual(clock.slept, [], "a real fault must not consume retry slices");
});

test("the detachment rule recognises Playwright's frame and page losses only", () => {
  equal(isFrameDetachment(new Error("locator.count: Frame was detached")), true);
  equal(isFrameDetachment(new Error("Target page, context or browser has been closed")), true);
  equal(isFrameDetachment(new Error("Execution context was destroyed, most likely because of a navigation")), true);
  equal(isFrameDetachment(new Error("locator.count: strict mode violation")), false);
  equal(isFrameDetachment("plain string"), false);
});
