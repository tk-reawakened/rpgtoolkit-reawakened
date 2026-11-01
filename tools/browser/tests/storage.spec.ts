import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The storage tiers in a real Chromium: the load controller over real OPFS staging and a real OPFS package store, the
// real IndexedDB blob host, and the real `tools/browser/serve.mjs` answering byte ranges. The package is the demo
// package the lane builds from the fetched sample game.

const PACKAGE = "fixtures/packages/demo.tpk";
const ENTRY = "Boards/start.brd";

type Stored = {
  readonly state: {
    readonly phase: string;
    readonly mode: "whole" | "streaming" | null;
    readonly storage: { readonly persisted: string; readonly quota: string; readonly kept: boolean; readonly error: string | null };
  };
  readonly gameId: string;
  readonly main: string;
  readonly mainBytes: number;
  readonly entries: number;
  readonly read: { readonly path: string; readonly bytes: number; readonly sum: number } | null;
  readonly stats: {
    readonly validatedFrom: string;
    readonly phase: string;
    readonly stagingHits: number;
    readonly durableHits: number;
    readonly networkReads: number;
  };
};

function expectedEntry(): { readonly bytes: number; readonly sum: number } {
  const bytes = readFileSync(resolve("fixtures/legacy/demo", ENTRY));
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) % 1_000_000_007;
  return { bytes: bytes.length, sum };
}

const descriptor = JSON.parse(readFileSync(resolve(`${PACKAGE}.json`), "utf8")) as { gameId: string; sha256: string; size: number };

async function launch(page: Page, query: string): Promise<Stored> {
  await page.goto(`/packages/runner-web/app/storage.html?package=${PACKAGE}&${query}`);
  await page.waitForFunction(() => window.__storage !== undefined && document.title.startsWith("storage "), undefined, { timeout: 30_000 });
  const report = await page.evaluate(() => window.__storage);
  if (report === undefined || "error" in report && typeof report.error === "string") throw new Error(`storage page failed: ${JSON.stringify(report)}`);
  return report as unknown as Stored;
}

async function opfsFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for (const directory of ["tkr-packages", "tkr-staging"]) {
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await root.getDirectoryHandle(directory);
      } catch {
        continue;
      }
      for await (const name of (handle as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(`${directory}/${name}`);
    }
    return names.sort();
  });
}

async function clearOpfs(page: Page): Promise<void> {
  await page.goto("/packages/runner-web/app/storage.html");
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for (const directory of ["tkr-packages", "tkr-staging"]) await root.removeEntry(directory, { recursive: true }).catch(() => undefined);
    await new Promise<void>((resolveDelete) => {
      const request = indexedDB.deleteDatabase("tkr-storage-lane");
      request.onsuccess = () => resolveDelete();
      request.onerror = () => resolveDelete();
      request.onblocked = () => resolveDelete();
    });
  });
}

test.beforeEach(async ({ page }) => {
  await clearOpfs(page);
});

test("whole mode keeps the validated package in OPFS, validates from OPFS staging, and a second launch makes no package request at all", async ({ page }) => {
  const first = await launch(page, "mode=auto");
  expect(first.state.phase).toBe("ready");
  expect(first.state.mode).toBe("whole");
  expect(first.state.storage.kept).toBe(true);
  expect(first.state.storage.quota).toBe("ok");
  expect(["granted", "denied"]).toContain(first.state.storage.persisted); // the browser's real answer, reported either way
  expect(first.stats.validatedFrom).toBe("staging");
  expect(first.gameId).toBe(descriptor.gameId);
  expect(first.main).toBe("Main/demo.gam");
  expect(await opfsFiles(page)).toEqual([`tkr-packages/${descriptor.sha256}.size`, `tkr-packages/${descriptor.sha256}.tpk`]);

  // Second launch: the package URL is refused by the network and must not even be asked.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === `/`) asked.push(request.url());
  });
  await page.route("**/fixtures/packages/demo.tpk", (route) => route.abort());
  const second = await launch(page, "mode=auto&read=" + encodeURIComponent(ENTRY));
  expect(asked).toEqual([]);
  expect(second.state.phase).toBe("ready");
  expect(second.state.mode).toBe("whole");
  expect(second.gameId).toBe(descriptor.gameId);
  expect(second.stats.validatedFrom).toBe("durable");
  expect(second.stats.networkReads).toBe(0);
  expect(second.read).toEqual({ path: ENTRY, ...expectedEntry() });
});

test("an offline miss with nothing kept is a visible offline error, not a hang", async ({ page }) => {
  await page.route("**/fixtures/packages/demo.tpk", (route) => route.abort());
  await page.goto(`/packages/runner-web/app/storage.html?package=${PACKAGE}&mode=auto`);
  await page.waitForFunction(() => window.__storage !== undefined, undefined, { timeout: 30_000 });
  const report = await page.evaluate(() => window.__storage);
  expect(report).toMatchObject({ kind: "offline" });
});

test("streaming fetches an entry by a real single byte range answered 206 by the server, after one whole transfer", async ({ page }) => {
  const seen: { range: string | null; status: number }[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/demo.tpk")) seen.push({ range: response.request().headers()["range"] ?? null, status: response.status() });
  });
  const report = await launch(page, `mode=streaming&read=${encodeURIComponent(ENTRY)}`);
  expect(report.state.mode).toBe("streaming");
  expect(report.state.storage).toMatchObject({ kept: false, quota: "not-needed", persisted: "not-requested" });
  expect(report.read).toEqual({ path: ENTRY, ...expectedEntry() });
  expect(await opfsFiles(page)).toEqual([]); // nothing kept, staging released
  expect(seen.filter((item) => item.range === null)).toHaveLength(1); // the first launch transfers the whole archive once
  const ranged = seen.filter((item) => item.range !== null);
  expect(ranged.length).toBeGreaterThan(0);
  for (const item of ranged) {
    expect(item.status).toBe(206);
    expect(item.range).toMatch(/^bytes=\d+-\d+$/);
  }
  expect(report.stats.networkReads).toBeGreaterThan(0);
});

test("a server that ignores Range is refused in the browser; nothing pretends to stream", async ({ page }) => {
  await page.route("**/fixtures/packages/demo.tpk", async (route) => {
    const { range: _range, ...headers } = route.request().headers();
    const response = await route.fetch({ headers });
    await route.fulfill({ response });
  });
  await page.goto(`/packages/runner-web/app/storage.html?package=${PACKAGE}&mode=streaming`);
  await page.waitForFunction(() => window.__storage !== undefined, undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__storage)).toMatchObject({ kind: "range-unsupported" });
  expect(await opfsFiles(page)).toEqual([]);
});

test("quota on the durable put streams the same single-file package, reports quota-limited and an unpersisted answer, and keeps nothing", async ({ page }) => {
  const report = await launch(page, `mode=whole&quota=1&persist=deny&read=${encodeURIComponent(ENTRY)}`);
  expect(report.state.phase).toBe("ready");
  expect(report.state.mode).toBe("streaming");
  expect(report.state.storage).toMatchObject({ quota: "limited", persisted: "denied", kept: false });
  expect(report.read).toEqual({ path: ENTRY, ...expectedEntry() });
  expect(report.stats.networkReads).toBeGreaterThan(0);
  expect(await opfsFiles(page)).toEqual([]);
});

test("saves live in IndexedDB, survive a reload, stay apart per GameId, and never enter Cache Storage", async ({ page }) => {
  await page.goto("/packages/runner-web/app/storage.html");
  await page.waitForFunction(() => window.__blobs !== undefined);
  expect(await page.evaluate(() => window.__blobs?.write("gameA", "slot1", [1, 2, 3]))).toBe(true);
  expect(await page.evaluate(() => window.__blobs?.write("gameA", "dir/slot2", [4]))).toBe(true);
  expect(await page.evaluate(() => window.__blobs?.write("gameB", "slot1", [9]))).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.__blobs !== undefined);
  expect(await page.evaluate(() => window.__blobs?.read("gameA", "slot1"))).toEqual([1, 2, 3]);
  expect(await page.evaluate(() => window.__blobs?.read("gameB", "slot1"))).toEqual([9]);
  expect(await page.evaluate(() => window.__blobs?.read("gameC", "slot1"))).toBeNull();
  expect(await page.evaluate(() => window.__blobs?.list("gameA"))).toEqual(["dir/slot2", "slot1"]);
  expect(await page.evaluate(() => window.__blobs?.list("gameB"))).toEqual(["slot1"]);
  const state = await page.evaluate(() => window.__blobs?.state());
  expect(state).toMatchObject({ quota: "ok", lastError: null });
  expect(await page.evaluate(() => window.__blobs?.cacheNames())).toEqual([]);
});

test("the authored Save/Load fixture writes and restores a real full-engine save across a reload to the headless baseline, with zero bytes in Cache Storage or OPFS", async ({ page }) => {
  const expectation = JSON.parse(readFileSync(resolve("packages/core/test/fixtures/saveload/saveload.expect.json"), "utf8")) as {
    fixture: { gameId: string };
    baseline: {
      saveRequest: { area: string; path: string; key: string; byteLength: number };
      loadRequest: { area: string; path: string; key: string; found: boolean };
      stateHashes: Record<"fresh" | "preSave" | "postLoad" | "final", { tick: number; stateHash: string }>;
      tick: number;
    };
  };
  await page.goto("/packages/runner-web/app/storage.html");
  await page.waitForFunction(() => window.__blobs !== undefined);
  expect(await opfsFiles(page)).toEqual([]);
  const first = await page.evaluate(() => window.__blobs!.runSaveLoadLaunch());
  expect(first.gameId).toBe(expectation.fixture.gameId);
  expect(first.launch.saveRequests).toEqual([expectation.baseline.saveRequest]);
  expect(first.launch.loadRequests).toEqual([{ ...expectation.baseline.loadRequest, found: false }]);
  expect(first.launch.fresh).toMatchObject(expectation.baseline.stateHashes.fresh);
  expect(first.launch.preSave).toMatchObject({ ...expectation.baseline.stateHashes.preSave, marker: 4242 });
  expect(first.launch.saveOk).toBe(true);

  // Reload: any in-memory copy is gone; launch two can only restore what IndexedDB kept.
  await page.reload();
  await page.waitForFunction(() => window.__blobs !== undefined);
  expect(await opfsFiles(page)).toEqual([]);
  const second = await page.evaluate(() => window.__blobs!.runSaveLoadLaunch());
  expect(second.launch.saveRequests).toEqual([]); // the restored thread resumed past Save("slot")
  expect(second.launch.loadRequests).toEqual([expectation.baseline.loadRequest]);
  expect(second.launch.loadRequests[0]?.path).toBe(first.launch.saveRequests[0]?.path);
  expect(second.launch.postLoad).toMatchObject({ ...expectation.baseline.stateHashes.postLoad, marker: 4242 });
  expect(second.launch.final).toMatchObject({ ...expectation.baseline.stateHashes.final, marker: 17 });
  expect(second.launch.final.tick).toBe(expectation.baseline.tick);

  // Isolation per GameId string: another GameId cannot read the save, and no cache or OPFS directory holds it.
  expect(await page.evaluate((id) => window.__blobs!.list(id), expectation.fixture.gameId)).toEqual(["saved/slot.sav"]);
  expect(await page.evaluate(() => window.__blobs!.list("other-game"))).toEqual([]);
  expect(await page.evaluate(() => window.__blobs!.read("other-game", "saved/slot.sav"))).toBeNull();
  expect(await page.evaluate(() => window.__blobs!.cacheNames())).toEqual([]);
  expect(await page.evaluate(() => window.__blobs!.cacheUrls())).toEqual([]);
  expect(await opfsFiles(page)).toEqual([]);
});

test("a full save store returns ok=false to the engine script and leaves no save behind", async ({ page }) => {
  await page.goto("/packages/runner-web/app/storage.html?saveCapacity=0");
  await page.waitForFunction(() => window.__blobs !== undefined);
  const first = await page.evaluate(() => window.__blobs!.runSaveLoadLaunch());
  expect(first.launch.saveRequests.length).toBe(1);
  expect(first.launch.saveOk).toBe(false);

  // Reload proves nothing persisted: the engine script sees the same failed save again.
  await page.reload();
  await page.waitForFunction(() => window.__blobs !== undefined);
  const second = await page.evaluate(() => window.__blobs!.runSaveLoadLaunch());
  expect(second.launch.saveRequests.length).toBe(1);
  expect(second.launch.saveOk).toBe(false);
  expect(second.launch.loadRequests[0]?.found).toBe(false);
});
