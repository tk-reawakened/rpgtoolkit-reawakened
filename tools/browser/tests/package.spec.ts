import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Report = Record<string, unknown>;

function demoBoardBaseline() {
  const baseline = JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: ReadonlyArray<{ label: string; tick: number; stateHash: string; drawHash: string; commands: number }> }>;
  };
  const frame = baseline.games.demo.frames.find((f) => f.label === "board" && f.tick === 120);
  if (frame === undefined) throw new Error("demo board frame at tick 120 not found in golden/regression/closing.json");
  return frame;
}

test("demo boots from one package, with no folder access, to the committed tick-120 hashes", async ({ page }) => {
  const folderRequests: string[] = [];
  await page.route("**/api/game*", async (route) => {
    folderRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/packages/runner-web/app/index.html?game=demo&package=fixtures/packages/demo.tpk&tracer=1");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = (await page.evaluate(() => window.__report)) as Report;
  console.log("package boot:", JSON.stringify(report));

  const baseline = demoBoardBaseline();
  expect(report["error"]).toBeUndefined();
  expect(report["package"]).toBe("fixtures/packages/demo.tpk");
  expect(report["tick"]).toBe(baseline.tick);
  expect(report["stateHash"]).toBe(baseline.stateHash);
  expect(report["drawHash"]).toBe(baseline.drawHash);
  expect(report["commands"]).toBe(baseline.commands);
  const render = report["render"] as { drawn: number; deferred: number };
  expect(render.deferred).toBe(0);
  expect(render.drawn).toBe(baseline.commands);

  // The folder source was never touched: the package is the whole game.
  expect(folderRequests).toEqual([]);
});
