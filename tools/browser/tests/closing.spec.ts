import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Entry 9.14's browser limb: one page runs the whole closing suite — every game of `golden/closing/plan.json`, through
 * the same core build the headless runner uses, at all three tick batchings — and this test compares the browser's
 * records with the committed baseline the Node run produced. Equal records mean equal per-tick state, draw, pixel and
 * command hashes for every frame, which is the cross-host claim; the page also re-runs `demo` from its `.tpk` so the
 * packaged single-file load is proved in the browser.
 */

type GameRecord = {
  readonly dialect: string;
  readonly outcome: string;
  readonly ticks: number;
  readonly frames: readonly { readonly label: string; readonly stateHash: string; readonly drawHash: string; readonly pixelHash: string; readonly commands: number }[];
};

type PageReport = {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly games: readonly { readonly name: string; readonly record: GameRecord; readonly batchProblems: readonly string[] }[];
  readonly packaged?: { readonly ok: boolean; readonly frames: number; readonly error?: string };
  readonly error?: string;
};

declare global {
  interface Window {
    __closing?: PageReport;
  }
}

function baseline(): { readonly games: Readonly<Record<string, Record_>> } {
  return JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as { games: Record<string, GameRecord> };
}

test("every closing-plan game runs in Chromium and matches the Node baseline", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/packages/runner-web/app/closing.html");
  await page.waitForFunction(() => window.__closing !== undefined, undefined, { timeout: 280_000 });
  const report = await page.evaluate(() => window.__closing);
  if (report === undefined) throw new Error("the closing page published no report");
  for (const line of report.lines) console.log(line);

  expect(report.error ?? null).toBeNull();
  const committed = baseline();
  // The browser ran every game the baseline names, and nothing else: a skipped game is a gap, not a pass.
  expect(report.games.map((game) => game.name).sort()).toEqual(Object.keys(committed.games).sort());
  expect(report.games.length).toBeGreaterThan(1);

  for (const game of report.games) {
    // Three tick batchings must agree; a disagreement is reported per game by the harness itself.
    expect(game.batchProblems, `${game.name} batching`).toEqual([]);
    // The per-frame state, draw and pixel hashes must be the Node run's, frame for frame.
    expect(game.record, `${game.name} record`).toEqual(committed.games[game.name]);
  }
  expect(report.ok).toBe(true);

  // The packaged single-file game loads in the browser and produces the very same record as the folder load.
  expect(report.packaged, "fixtures/packages/demo.tpk must exist; the lane builds it").toBeDefined();
  expect(report.packaged?.error ?? null).toBeNull();
  expect(report.packaged?.frames ?? 0).toBeGreaterThan(0);
  expect(report.packaged?.ok).toBe(true);
});
