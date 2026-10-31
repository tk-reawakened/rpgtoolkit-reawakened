import { expect, test } from "@playwright/test";

/** D-7 on the commit-time vectors: exact on key, tint and blend choice; at most one unit per channel on blend arithmetic. */
test("render-webgl2 replays the committed raster vectors within the D-7 bound", async ({ page }) => {
  await page.goto("/packages/runner-web/app/vectors.html");
  await page.waitForFunction(() => window.__vectors !== undefined, undefined, { timeout: 30_000 });
  const results = await page.evaluate(() => window.__vectors as { id: string; actual: string; expected: string }[]);
  console.log("vectors:", JSON.stringify(results));
  expect(results.length).toBe(7);

  for (const result of results) {
    const actual = bytes(result.actual);
    const expected = bytes(result.expected);
    const worst = worstChannel(actual, expected);
    // Every discrete decision — the key, the R-15 tint remap, alpha-0 skipping, row order — must be exact; only the two
    // blend arithmetic cases may differ by one (D-7).
    const arithmetic = result.id.includes("translucent") || result.id.includes("additive");
    if (arithmetic) expect(worst, `${result.id} within one unit per channel`).toBeLessThanOrEqual(1);
    else expect(worst, `${result.id} must be exact`).toBe(0);
  }
});

function bytes(hex: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < hex.length; index += 2) out.push(Number.parseInt(hex.slice(index, index + 2), 16));
  return out;
}

function worstChannel(actual: number[], expected: number[]): number {
  let worst = 0;
  for (let index = 0; index < expected.length; index += 1) worst = Math.max(worst, Math.abs((actual[index] ?? 0) - (expected[index] ?? 0)));
  return worst;
}
