import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// AC1: the offline relaunch proof that matters most. First launch caches the shell, bundled assets and `demo.tpk`, and
// installs the service worker (which does NOT take over mid-session). Reload while still online so the worker controls
// the page and caches `demo.tpk.json`; then block the entire network (`context.setOffline(true)`) and relaunch. Under
// service-worker control, reach tick 120 with the `golden/closing/plan.json` recipe and compare state hash, draw hash
// and command count to the `board` frame in `golden/regression/closing.json` — with **no `/api/` request at all**,
// failed ones included. Then prove an offline miss (a package never cached) is reported as a load error.

const PLAYER = "/packages/runner-web/app/index.html";
const PACKAGE = "fixtures/packages/demo.tpk";

type BaselineFrame = { readonly label: string; readonly tick: number; readonly stateHash: string; readonly drawHash: string; readonly commands: number };

function demoBoardBaseline(): BaselineFrame {
  const baseline = JSON.parse(readFileSync(resolve("golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: readonly BaselineFrame[] }>;
  };
  const frame = baseline.games.demo?.frames.find((candidate) => candidate.label === "board" && candidate.tick === 120);
  if (frame === undefined) throw new Error("demo board frame at tick 120 not found in golden/regression/closing.json");
  return frame;
}

async function clearOrigin(page: Page): Promise<void> {
  await page.goto("/packages/runner-web/app/storage.html");
  await page.evaluate(async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const name of await caches.keys()) await caches.delete(name);
    const root = await navigator.storage.getDirectory();
    for (const directory of ["tkr-packages", "tkr-staging"]) await root.removeEntry(directory, { recursive: true }).catch(() => undefined);
    await new Promise<void>((done) => {
      const deleting = indexedDB.deleteDatabase("tkr-saves");
      deleting.onsuccess = () => done();
      deleting.onerror = () => done();
      deleting.onblocked = () => done();
    });
  });
}

async function waitForActiveWorker(page: Page): Promise<void> {
  await page.evaluate(async (scope) => {
    const wrapped = await window.__worker;
    if (wrapped === undefined || !wrapped.registered) throw new Error(`worker was not registered: ${JSON.stringify(wrapped)}`);
    const reg = await navigator.serviceWorker.getRegistration(scope);
    if (reg === undefined) throw new Error(`no registration at ${scope}`);
    if (reg.active?.state === "activated") return;
    const target = reg.installing ?? reg.waiting ?? reg.active;
    if (target === null) throw new Error("registration carries no worker");
    await new Promise<void>((done, fail) => {
      if (target.state === "activated") { done(); return; }
      target.addEventListener("statechange", () => {
        if (target.state === "activated") done();
        else if (target.state === "redundant") fail(new Error("worker became redundant"));
      });
    });
  }, PLAYER);
}

test.beforeEach(async ({ page, context }) => {
  await context.setOffline(false);
  await clearOrigin(page);
});

test("AC1: with the network blocked and the service worker in control, a relaunch boots demo.tpk to the committed tick-120 closing baseline with zero /api/ requests, and an uncached package reports an offline error", async ({ page, context }) => {
  const apiRequests: string[] = [];
  const registerApiWatch = (target: Page): void => {
    target.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    target.on("requestfailed", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(`failed:${request.url()}`);
    });
  };
  registerApiWatch(page);

  // 1. First launch (online): keeps `demo.tpk` in OPFS and installs the service worker. No `clients.claim`, so this
  //    first session is deliberately not controlled yet.
  await page.goto(`${PLAYER}?game=demo&package=${PACKAGE}&parity=1`);
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  await waitForActiveWorker(page);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
  expect(await page.evaluate(() => (window.__report as { load?: { storage?: { kept?: boolean } } }).load?.storage?.kept)).toBe(true);

  // 2. Second launch (still online): the activated worker now controls the player and caches `demo.tpk.json` on the way
  //    through its network-first descriptor route.
  await page.reload();
  await page.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  expect(apiRequests).toEqual([]);

  // 3. Block the network completely and open a fresh page — a true relaunch, not a kept-alive document.
  await context.setOffline(true);
  const offline = await context.newPage();
  const offlineFailed: string[] = [];
  registerApiWatch(offline);
  offline.on("requestfailed", (request) => offlineFailed.push(`${request.url()} (${request.failure()?.errorText ?? "failed"})`));

  await offline.goto(`${PLAYER}?game=demo&package=${PACKAGE}&parity=1`);
  await offline.waitForFunction(() => window.__report !== undefined, undefined, { timeout: 45_000 });
  const controlled = await offline.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  const report = await offline.evaluate(() => window.__report as {
    game: string;
    package: string;
    tick: number;
    stateHash: string;
    drawHash: string;
    commands: number;
    error?: string;
    render: { drawn: number; deferred: number };
    load: { mode: string; storage: { kept: boolean } };
  });

  const baseline = demoBoardBaseline();
  expect(controlled).toContain("/apps/service-worker.js");
  expect(report.error).toBeUndefined();
  expect(report.load.mode).toBe("whole");
  expect(report.tick).toBe(baseline.tick);
  expect(report.stateHash).toBe(baseline.stateHash);
  expect(report.drawHash).toBe(baseline.drawHash);
  expect(report.commands).toBe(baseline.commands);
  expect(report.render.deferred).toBe(0);
  expect(report.render.drawn).toBe(baseline.commands);
  expect(apiRequests).toEqual([]);
  // Nothing failed on the wire either — except the browser's automatic worker-update check, if it made one, which is
  // outside the page's fetches; no page document, script, bundled file, descriptor or package request failed.
  expect(offlineFailed.filter((entry) => !entry.includes("service-worker.js"))).toEqual([]);

  // 4. Still offline, ask for a package that was never cached: the miss is reported as a load error, never hung or faked.
  //    Note: the service-worker-controlled miss surfaces as `TypeError: Failed to fetch` (requestfailed `net::ERR_FAILED`),
  //    not `ERR_INTERNET_DISCONNECTED`, because the fetch is issued by the controlled worker rather than the browser's
  //    direct navigation path.
  await offline.goto(`${PLAYER}?package=fixtures/packages/never-cached.tpk`);
  await offline.waitForFunction(() => (window.__report as { error?: string } | undefined)?.error !== undefined, undefined, { timeout: 15_000 });
  const miss = await offline.evaluate(() => ({ report: window.__report as { error: string }, text: document.querySelector("#report")?.textContent ?? "" }));
  expect(miss.report.error.length).toBeGreaterThan(0);
  expect(miss.report.error).toContain("Failed to fetch");
  expect(miss.text).toContain("player:");
  // The descriptor fetch for the never-cached package is the one that fails under service-worker control.
  expect(offlineFailed.some((entry) => entry.includes("never-cached.tpk.json"))).toBe(true);
  expect(apiRequests).toEqual([]);

  await offline.close();
  await context.setOffline(false);
});
