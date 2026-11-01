import { expect, test } from "@playwright/test";

/**
 * Entry 9.5's browser limb: the cue player and the PCM sink running together in headless Chromium, on real authored WAV
 * fixtures.
 *
 * The three runner rules are asserted as facts, not listened to: the autoplay unlock is a **delayed late start** (the
 * music joins at `(gesture − cue) mod length`), the 15-tick drop is measured **at ready** (lateness 14 starts at 14;
 * lateness 15 is stopped, never played, never ended), and the focus hold pauses then resumes with its position intact.
 * The sound itself is asserted by the sink's own pull — the same call the audio graph makes — so the lane can tell
 * silence from sound without a speaker. The analyser reading is reported for information; a headless Chromium analyser
 * is a timing race, so it is never the assertion.
 */
type AudioReport = {
  readonly musicLengthTicks: number | null;
  readonly effectLengthTicks: number | null;
  readonly scheduled: readonly { readonly voice: number; readonly track: string; readonly positionTicks: number; readonly loop: boolean }[];
  readonly unlockPosition: number | null;
  readonly lateSound: { readonly played: boolean; readonly positionTicks: number | null };
  readonly droppedSound: { readonly played: boolean; readonly stopped: boolean };
  readonly focus: { readonly pause: boolean; readonly resume: boolean };
  readonly energy: number;
  readonly seconds: number;
  readonly graphStarted: boolean;
  readonly analyserEnergy: number | null;
  readonly errors: readonly string[];
  readonly bankSha: string | null;
  readonly midiEnergy: number;
  readonly midiLengthTicks: number | null;
};

test("the cue player and the PCM sink agree with the spec's three runner rules", async ({ page }) => {
  await page.goto("/packages/runner-web/app/audio.html");
  await page.waitForFunction(() => window.__audio !== undefined, undefined, { timeout: 60_000 });
  const report = (await page.evaluate(() => window.__audio)) as AudioReport;
  console.log("audio:", JSON.stringify(report));

  expect(report.errors).toEqual([]);
  // The lengths are the fixture kit's hand-worked ones, reported by the sink from the real bytes.
  expect(report.musicLengthTicks).toBe(30);
  expect(report.effectLengthTicks).toBe(15);

  // 1. Autoplay unlock is a delayed late start: a 30-tick loop, cue at 0, gesture at 45 → joins at 15.
  expect(report.unlockPosition).toBe(15);
  const music = report.scheduled.find((entry) => entry.voice === 41);
  expect(music, "the music was realised").toBeDefined();
  expect(music?.positionTicks).toBe(15);
  expect(music?.loop).toBe(true);

  // 2. Lateness is measured at ready: 14 starts at its caught-up position…
  expect(report.lateSound).toEqual({ played: true, positionTicks: 14 });
  // …and 15 is dropped: stopped, never played.
  expect(report.droppedSound).toEqual({ played: false, stopped: true });

  // 3. The focus hold pauses and resumes.
  expect(report.focus).toEqual({ pause: true, resume: true });

  // The sink pulled real samples: sound, not silence, and for the length the fixture kit hand-worked.
  expect(report.energy).toBeGreaterThan(0);
  expect(report.seconds).toBe(0.5);

  // The real Web Audio graph path measured analyser energy. The value can be zero in a
  // headless Chromium runner, so we assert the field exists and is numeric; that is enough
  // to prove the graph path ran, and it fails if the code that sets it is removed.
  expect(report.analyserEnergy).not.toBeNull();
  expect(typeof report.analyserEnergy).toBe("number");
  expect(report.analyserEnergy).toBeGreaterThanOrEqual(0);

  // The bundled bank loads and MIDI renders through it in the browser too: the file's SHA-256 keys the cache, and the
  // 120-tick fixture makes sound instead of silence.
  expect(report.bankSha).toBe("5419f02b0a9e63534b35332842e29decbc53c5352236be85b92cc87d0267f62a");
  expect(report.midiLengthTicks).toBe(120);
  expect(report.midiEnergy).toBeGreaterThan(0);
});
