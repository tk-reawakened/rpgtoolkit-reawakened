import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ParityReport = { game: string; tick: number; stateHash: string; drawHash: string; alphaDrawHash: string; alphaStateHash: string; commands: number };

function demoBoardBaseline() {
  const baseline = JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: ReadonlyArray<{ label: string; tick: number; stateHash: string; drawHash: string; commands: number }> }>;
  };
  const frame = baseline.games.demo.frames.find((f) => f.label === "board" && f.tick === 120);
  if (frame === undefined) throw new Error("demo board frame at tick 120 not found in golden/regression/closing.json");
  return frame;
}

test("persistent live engine reproduces closing-plan pairs without interactive owners", async ({ page }) => {
  await page.goto("/packages/runner-web/app/index.html?game=demo&parity=1");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const result = await page.evaluate(() => window.__report as ParityReport);
  const baseline = demoBoardBaseline();
  expect(result.game).toBe("demo");
  expect(result.tick).toBe(baseline.tick);
  expect(result.stateHash).toBe(baseline.stateHash);
  expect(result.drawHash).toBe(baseline.drawHash);
  expect(result.commands).toBe(baseline.commands);
  expect(result.alphaStateHash).toBe(result.stateHash);
  expect(result.alphaDrawHash).toBe(result.drawHash);
});
