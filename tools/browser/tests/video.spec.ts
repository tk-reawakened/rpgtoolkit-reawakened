import { expect, test } from "@playwright/test";

/**
 * Entry 9.6's video half (docs/spec/engine/audio-media.md#video-request): every `playVideo` gets exactly one reply,
 * including on failure, one video is outstanding at a time, and the runner holds the other voices for its duration.
 *
 * No VP9/WebM fixture ships yet, so the lane proves the paths that need none: a missing asset, an undecodable container
 * through a real `<video>` element, the busy request, and the hold/release through the cue player. The played path needs
 * a fixture and is recorded as 9.7's.
 */
type VideoReport = {
  readonly missing: { readonly replies: readonly number[]; readonly code: string | null };
  readonly undecodable: { readonly replies: readonly number[]; readonly code: string | null; readonly held: boolean; readonly released: boolean };
  readonly busy: { readonly replies: readonly number[]; readonly code: string | null };
  readonly hold: { readonly paused: number; readonly resumed: number };
  readonly presentation: { readonly full: string; readonly small: readonly [string, string] };
  readonly mediaErrors: readonly string[];
};

test("every playVideo gets one reply, a hold, and no hang", async ({ page }) => {
  await page.goto("/packages/runner-web/app/video.html");
  await page.waitForFunction(() => window.__video !== undefined, undefined, { timeout: 60_000 });
  const report = (await page.evaluate(() => window.__video)) as VideoReport;
  console.log("video:", JSON.stringify(report));

  // A missing asset is answered at once with media.video-missing and no hold.
  expect(report.missing).toEqual({ replies: [7], code: "media.video-missing" });

  // An undecodable container is answered once, by the browser's own decoder, with a diagnostic.
  expect(report.undecodable.replies).toEqual([1]);
  expect(report.undecodable.code).toBe("media.video-format");
  expect(report.mediaErrors.length).toBeGreaterThan(0);

  // The hold went in while it played and came out when it ended.
  expect(report.undecodable.held).toBe(true);
  expect(report.undecodable.released).toBe(true);
  expect(report.hold).toEqual({ paused: 1, resumed: 1 });

  // At most one video is outstanding: the second is busy and answered at once.
  expect(report.busy).toEqual({ replies: [2], code: "media.video-busy" });

  // Presentation is CSS: full fits with the aspect kept, small is the video's own size.
  expect(report.presentation.full).toBe("contain");
  expect(report.presentation.small).toEqual(["320px", "240px"]);
});
