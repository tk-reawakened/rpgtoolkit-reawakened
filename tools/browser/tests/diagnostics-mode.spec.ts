import { createVscodePlayerHtml } from "@tk-reawakened/host-vscode/testing";
import { expect, test } from "@playwright/test";
import type { LiveSession } from "@tk-reawakened/runner-web/live-session";

type Probe = {
  __session: LiveSession;
  __tkrDiagnostics(on?: boolean): boolean;
  __live: { tick: number; stateHash: string };
  retained?: { tick: number; stateHash: string }[];
};

test("diagnostics preserve geometry, capture frame hashes, and invalidate pending session readers", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/packages/runner-web/app/index.html?package=fixtures/packages/demo.tpk");
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).__live?.tick ?? 0), {
    timeout: 60_000, intervals: [100, 250, 500],
  }).toBeGreaterThan(30);
  await expect(page.locator("#report")).toBeHidden();
  const geometry = await page.evaluate(() => (window as unknown as Probe).__session.engine.hostDisplayGeometry());
  const size = await page.locator("#stage").boundingBox();
  await page.keyboard.press("F3");
  await page.waitForTimeout(150); // Allow resize observation and the diagnostic frame to settle.
  await expect(page.locator("#report")).toBeVisible();
  expect(await page.locator("#stage").boundingBox()).toEqual(size);
  expect(await page.evaluate(() => (window as unknown as Probe).__session.engine.hostDisplayGeometry())).toEqual(geometry);

  // Capture a frame shortly after the text refresh, without reading its lazy hash until a later frame.
  await page.evaluate(async () => {
    const probe = window as unknown as Probe;
    probe.retained = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      probe.retained.push(probe.__live);
    }
  });
  await expect.poll(() => page.evaluate(() => {
    const probe = window as unknown as Probe;
    return probe.__live.tick > probe.retained!.at(-1)!.tick;
  }), { intervals: [100, 250, 500] }).toBe(true);
  const hashes = await page.evaluate(() => (window as unknown as Probe).retained!.map((report) => report.stateHash));
  for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{16}$/);

  await page.keyboard.press("F3");
  await page.waitForTimeout(150);
  await expect(page.locator("#report")).toBeHidden();
  expect(await page.locator("#stage").boundingBox()).toEqual(size);

  const readers = await page.evaluate(async () => {
    const session = (window as unknown as Probe).__session;
    await session.advance(0);
    const cached = session.stateHashReader();
    const hash = cached();
    const stale = session.stateHashReader();
    const first = session.advance(1);
    const during = session.stateHashReader();
    const second = session.advance(1);
    await first;
    const between = session.stateHashReader();
    await second;
    const current = session.stateHashReader();
    return { hash, cached: cached(), stale: stale(), during: during(), between: between(), current: current(), actual: session.engine.stateHash() };
  });
  expect(readers.hash).toMatch(/^[0-9a-f]{16}$/);
  expect(readers.cached).toBe(readers.hash);
  expect(readers.stale).toBe("");
  expect(readers.during).toBe("");
  expect(readers.between).toBe("");
  expect(readers.current).toBe(readers.actual);
});

// Exercise the generated template in Chromium; this is a layout proof, not a VS Code host launch.
test("VS Code's generated diagnostics report overlays the unchanged game viewport", async ({ page }) => {
  const html = createVscodePlayerHtml("https://example.invalid", "https://example.invalid/player.js", "test-nonce");
  await page.setContent(html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, ""));
  const before = await page.locator("#stage").boundingBox();
  await page.locator("#report").evaluate((report) => {
    report.textContent = "tick 123\nstate abcdef0123456789\ndraw 0123456789abcdef\nboard start";
    report.removeAttribute("hidden");
  });
  await page.waitForTimeout(100); // Settle layout before reading its box.
  await expect(page.locator("#report")).toBeVisible();
  expect(await page.locator("#stage").boundingBox()).toEqual(before);
});
