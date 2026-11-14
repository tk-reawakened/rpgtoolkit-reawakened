import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareClosingBatchTickHashes, parseClosingPlan, runClosingGame, type ClosingBatchTrace } from "@tk-reawakened/runner-harness";
import { loadGameFiles } from "../../../packages/runner-headless/src/closing.ts";

/**
 * Entry 9.14's browser limb: every planned game runs through the real engine in Chromium at all three tick batchings.
 * This test independently replays the same game files in Node and compares every per-tick state and draw hash for each
 * batch. The committed record remains the checkpoint/frame baseline; the browser report carries separate tick traces.
 * The page also re-runs `demo` from its `.tpk` so the packaged single-file load is proved in the browser.
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
  readonly games: readonly { readonly name: string; readonly record: GameRecord; readonly batchProblems: readonly string[]; readonly batchTickHashes: readonly ClosingBatchTrace[] }[];
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
function nodeBatchTickHashes(): ReadonlyMap<string, readonly ClosingBatchTrace[]> {
  const plan = parseClosingPlan(readFileSync(resolve("golden/closing/plan.json"), "utf8"));
  const bundled = new Map<string, Uint8Array>();
  for (const folder of plan.bundled) {
    for (const [path, bytes] of loadGameFiles(resolve(folder))) bundled.set(`${folder}/${path}`, bytes);
  }
  const traces = new Map<string, readonly ClosingBatchTrace[]>();
  for (const game of plan.games) {
    const files = loadGameFiles(resolve("fixtures/legacy", game.name));
    const run = runClosingGame(plan, game, files, bundled);
    if (run.batchProblems.length > 0) throw new Error(`${game.name}: Node closing replay disagreed across batches: ${run.batchProblems.join("; ")}`);
    traces.set(game.name, run.batchTickHashes);
  }
  return traces;
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
  const nodeTraces = nodeBatchTickHashes();
  // The browser ran every game the baseline names, and nothing else: a skipped game is a gap, not a pass.
  expect(report.games.map((game) => game.name).sort()).toEqual(Object.keys(committed.games).sort());
  expect(report.games.length).toBeGreaterThan(1);

  for (const game of report.games) {
    // Three tick batchings must agree; a disagreement is reported per game by the harness itself.
    expect(game.batchProblems, `${game.name} batching`).toEqual([]);
    const nodeGameTraces = nodeTraces.get(game.name);
    if (nodeGameTraces === undefined) throw new Error(`${game.name}: Node closing replay produced no per-tick trace`);
    const nodeReference = nodeGameTraces[0];
    const chromiumReference = game.batchTickHashes[0];
    if (nodeReference === undefined || chromiumReference === undefined) throw new Error(`${game.name}: missing reference batch trace`);
    expect(
      compareClosingBatchTickHashes(nodeGameTraces.map(({ batch }) => ({ batch, ticks: nodeReference.ticks })), nodeGameTraces),
      `${game.name} Node per-batch hashes against its reference batch`,
    ).toEqual([]);
    expect(
      compareClosingBatchTickHashes(game.batchTickHashes.map(({ batch }) => ({ batch, ticks: chromiumReference.ticks })), game.batchTickHashes),
      `${game.name} Chromium per-batch hashes against its reference batch`,
    ).toEqual([]);
    expect(compareClosingBatchTickHashes(nodeGameTraces, game.batchTickHashes), `${game.name} cross-host per-tick state/draw hashes for every batch`).toEqual([]);
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
