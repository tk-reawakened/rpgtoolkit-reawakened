import { expect, test, type Page } from "@playwright/test";
import type { DecodeStats } from "@tk-reawakened/runner-web";

/**
 * Entry 9's decode lane (issue #934, OQ3): a real Worker running the classic-script IIFE bundle `apps/decode-worker.js`,
 * with every prepared result compared with what the host thread makes on the same bytes.
 *
 * The acceptance criteria under test in headless Chromium:
 *
 * 1. An image the worker decoded has the host decoder's pixels, bit-for-bit (PNG, .tst tileset, BMP, GIF).
 * 2. A WAV the worker prepared has the same float samples, same rendered frames and same lengthTicks as the host's own
 *    `createPcmSource` voice, both at the file's rate and resampled to 44.1 kHz (PCM16 mono/stereo, PCM8, IMA ADPCM
 *    mono/stereo, MS ADPCM).
 * 3. The sink can open a voice from a worker-prepared WAV without reading the asset or receiving bytes in its `load`.
 * 4. A MIDI has the host's ticks; a SoundFont has the host's SHA-256 and size.
 * 5. Every unpreparable format and corrupt file surfaces as a named gap in `stats().gaps`.
 * 6. Caller buffers remain intact (the worker receives a transferred copy).
 * 7. `close()` drops results, and `createDecodeAhead` throws when a Worker cannot be created.
 */

type ImageResult = {
  readonly key: string;
  readonly ready: boolean;
  readonly w: number | null;
  readonly h: number | null;
  readonly samePixels: boolean;
};

type AudioResult = {
  readonly key: string;
  readonly rateHz: number;
  readonly ready: boolean;
  readonly channels: number | null;
  readonly sameSamples: boolean;
  readonly sameRender: boolean;
  readonly hostLengthTicks: number | null;
  readonly workerLengthTicks: number | null;
  readonly sinkReadyTicks: number | null;
};

type DecodeReport = {
  readonly images: readonly ImageResult[];
  readonly audio: readonly AudioResult[];
  readonly midi: readonly { readonly key: string; readonly workerTicks: number | null; readonly hostTicks: number | null }[];
  readonly soundfont: { readonly workerSha: string | null; readonly hostSha: string; readonly workerSize: number | null; readonly hostSize: number };
  readonly stats: DecodeStats;
  readonly callerBytesIntact: boolean;
  readonly afterClose: { readonly imageNull: boolean; readonly audioNull: boolean; readonly prepareThrows: boolean };
  readonly missingWorker: { readonly stats: DecodeStats };
  readonly spawnFailureThrows: boolean;
};

async function launch(page: Page): Promise<DecodeReport> {
  await page.goto("/packages/runner-web/app/decode.html");
  await page.waitForFunction(() => window.__decode !== undefined && document.title.startsWith("decode "), undefined, { timeout: 30_000 });
  const report = await page.evaluate(() => window.__decode);
  if (report === undefined || ("error" in report && typeof report.error === "string")) {
    throw new Error(`decode page failed: ${JSON.stringify(report)}`);
  }
  return report as unknown as DecodeReport;
}

test("a real decode worker prepares images, WAV, MIDI and SoundFonts identically to host decoders", async ({ page }) => {
  const report = await launch(page);

  // 1. Images: PNG, tileset .tst, BMP, GIF are ready and have the host decoder's pixels.
  expect(report.images.length).toBeGreaterThanOrEqual(4);
  for (const img of report.images) {
    expect(img.ready, `image ${img.key} was ready`).toBe(true);
    expect(img.samePixels, `image ${img.key} has the host decoder's pixels`).toBe(true);
    expect(img.w).toBeGreaterThan(0);
    expect(img.h).toBeGreaterThan(0);
  }

  // 2. Audio: all codecs at both rates have the host's samples, render frames and length ticks.
  expect(report.audio.length).toBeGreaterThanOrEqual(12);
  for (const sound of report.audio) {
    expect(sound.ready, `audio ${sound.key} at ${sound.rateHz} Hz was ready`).toBe(true);
    expect(sound.sameSamples, `audio ${sound.key} at ${sound.rateHz} Hz has the host's samples`).toBe(true);
    expect(sound.sameRender, `audio ${sound.key} at ${sound.rateHz} Hz renders identical frames`).toBe(true);
    expect(sound.workerLengthTicks, `audio ${sound.key} at ${sound.rateHz} Hz matches host length`).toBe(sound.hostLengthTicks);
    // 3. The sink opened the voice from prepared PCM without needing raw bytes.
    expect(sound.sinkReadyTicks, `sink opened ${sound.key} at ${sound.rateHz} Hz`).toBe(sound.hostLengthTicks);
  }

  // 4. MIDI and SoundFont: MIDI length and SoundFont SHA-256 / size match host validation.
  expect(report.midi.length).toBeGreaterThanOrEqual(2);
  for (const item of report.midi) {
    expect(item.workerTicks, `midi ${item.key} matches host ticks`).toBe(item.hostTicks);
  }
  expect(report.soundfont.workerSha).toBe(report.soundfont.hostSha);
  expect(report.soundfont.workerSize).toBe(report.soundfont.hostSize);

  // 5. Gaps: unpreparable formats (.tan, .tbm, .ogg, smpte .mid), corrupt files and over-ceiling SoundFonts are named gaps.
  const gapKeys = report.stats.gaps.map((gap) => gap.key);
  expect(gapKeys).toContain("gaps/animation.tan");
  expect(gapKeys).toContain("gaps/tiles.tbm");
  expect(gapKeys).toContain("gaps/broken.png");
  expect(gapKeys).toContain("gaps/song.ogg");
  expect(gapKeys).toContain("gaps/broken.wav");
  expect(gapKeys).toContain("gaps/smpte.mid");
  expect(gapKeys).toContain("gaps/not-a-bank.sf2");
  expect(gapKeys).toContain("gaps/too-big.sf2");
  for (const gap of report.stats.gaps) {
    expect(gap.reason.includes(gap.key), `gap for ${gap.key} names the asset`).toBe(true);
  }
  const tooBig = report.stats.gaps.find((gap) => gap.key === "gaps/too-big.sf2");
  expect(tooBig?.reason.startsWith("unsupported:")).toBe(true);
  const tbmGap = report.stats.gaps.find((gap) => gap.key === "gaps/tiles.tbm");
  expect(tbmGap?.reason.includes("tile bitmap") || tbmGap?.reason.includes("animated tiles")).toBe(true);

  // 6. Caller buffers were not detached.
  expect(report.callerBytesIntact).toBe(true);

  // 7. Close and error handling.
  expect(report.afterClose.imageNull).toBe(true);
  expect(report.afterClose.audioNull).toBe(true);
  expect(report.afterClose.prepareThrows).toBe(true);
  expect(report.spawnFailureThrows).toBe(true);
  expect(report.missingWorker.stats.failed).toBe(1);
});
