import { expect, test } from "@playwright/test";

type ParityReport = { game: string; tick: number; stateHash: string; drawHash: string; alphaDrawHash: string; alphaStateHash: string; commands: number };

test("persistent live engine reproduces closing-plan pairs without interactive owners", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?game=demo&parity=1");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const result = await page.evaluate(() => window.__report as ParityReport);
  expect(result.game).toBe("demo");
  expect(result.tick).toBe(120);
  expect(result.stateHash).toBe("8bb22341353ed818");
  expect(result.drawHash).toBe("9a40be8a0b5ca816");
  expect(result.commands).toBe(128);
  expect(result.alphaStateHash).toBe(result.stateHash);
  expect(result.alphaDrawHash).toBe(result.drawHash);
});
