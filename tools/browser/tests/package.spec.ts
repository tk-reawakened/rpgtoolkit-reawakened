import { expect, test } from "@playwright/test";

/**
 * Entry 9.7's browser limb: the web runner boots a game from a **single distribution package** with no folder access.
 *
 * The page is opened with `?package=fixtures/packages/demo.tpk`, so the only asset fetch is that one file; `/api/game` —
 * the folder source — is intercepted and recorded, and must never be requested. The hashes must be the closing suite's
 * own tick-120 values, which is the same core build reached through a different door.
 */
type Report = Record<string, unknown>;

test("demo boots from one package, with no folder access, to the committed tick-120 hashes", async ({ page }) => {
  const folderRequests: string[] = [];
  await page.route("**/api/game*", async (route) => {
    folderRequests.push(route.request().url());
    await route.abort();
  });

  await page.goto("/packages/runner-web/app/index.html?game=demo&package=fixtures/packages/demo.tpk");
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const report = (await page.evaluate(() => window.__report)) as Report;
  console.log("package boot:", JSON.stringify(report));

  expect(report["error"]).toBeUndefined();
  expect(report["package"]).toBe("fixtures/packages/demo.tpk");
  expect(report["tick"]).toBe(120);
  expect(report["stateHash"]).toBe("bff947dce3a11b4f");
  expect(report["drawHash"]).toBe("9a40be8a0b5ca816");
  expect(report["commands"]).toBe(128);
  const render = report["render"] as { drawn: number; deferred: number };
  expect(render.deferred).toBe(0);
  expect(render.drawn).toBe(128);

  // The folder source was never touched: the package is the whole game.
  expect(folderRequests).toEqual([]);
});
