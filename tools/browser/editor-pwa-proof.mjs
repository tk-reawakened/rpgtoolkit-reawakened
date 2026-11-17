// Actual Chromium PWA installation and authoring proof. The OS picker is replaced with an OPFS directory;
// the separate reader below reopens that storage independently rather than reusing the editor's handle.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const origin = process.env.TKR_PWA_ORIGIN ?? "http://127.0.0.1:4173";
const url = `${origin}/tools/browser/editor-web/index.html`;
const profile = await mkdtemp(join(tmpdir(), "tkr-editor-pwa-"));
const initial = await readFile(new URL("../../docs/spec/examples/game/Main/example.gam", import.meta.url));
const sentinel = Buffer.from("untouched sibling\n");
const title = "Installed editor proof";
let context;
let browserVersion;
let cdp;
let installed = false;
let failure;
try {
  context = await chromium.launchPersistentContext(profile, { headless: false });
  browserVersion = context.browser()?.version() ?? "persistent";
  const browserPage = context.pages()[0] ?? await context.newPage();
  await browserPage.goto(`${origin}/health`);
  await browserPage.evaluate(() => navigator.serviceWorker.register("/apps/service-worker.js", { scope: "/packages/runner-web/app/index.html" }));
  await browserPage.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const player = await navigator.serviceWorker.getRegistration("/packages/runner-web/app/index.html");
      if (player?.active?.state === "activated") return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Player worker did not activate within 15 seconds.");
  });
  await browserPage.evaluate(async () => {
    const player = await caches.open("tkr-descriptors");
    await player.put("/player-sentinel", new Response("player remains"));
    await caches.open("tkr-editor-shell-obsolete");
  });
  await browserPage.goto(url);
  await browserPage.evaluate(async ({ game, sibling }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle("pwa-proof", { create: true });
    const main = await root.getDirectoryHandle("Main", { create: true });
    for (const [directory, name, bytes] of [[main, "example.gam", game], [root, "sentinel.txt", sibling]]) {
      const file = await directory.getFileHandle(name, { create: true });
      const stream = await file.createWritable();
      await stream.write(new Uint8Array(bytes));
      await stream.close();
    }
  }, { game: [...initial], sibling: [...sentinel] });
  await browserPage.evaluate(async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const registration = await navigator.serviceWorker.getRegistration(location.href);
      if (registration?.active?.state === "activated" && !(await caches.keys()).includes("tkr-editor-shell-obsolete")) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Editor worker did not activate and clean its old cache within 15 seconds.");
  });
  const scope = await browserPage.evaluate(async () => (await navigator.serviceWorker.getRegistration(location.href)).scope);
  assert.equal(scope, `${origin}/tools/browser/editor-web/`);
  const cacheState = await browserPage.evaluate(async () => {
    const names = await caches.keys();
    const player = await caches.open("tkr-descriptors");
    const editorName = names.find((name) => name.startsWith("tkr-editor-shell-") && name !== "tkr-editor-shell-obsolete");
    const editor = editorName ? await caches.open(editorName) : null;
    return { names, sentinel: await (await player.match("/player-sentinel")).text(), urls: editor ? (await editor.keys()).map((request) => request.url) : [] };
  });
  assert.equal(cacheState.sentinel, "player remains");
  assert.ok(cacheState.names.includes("tkr-descriptors"));
  assert.ok(!cacheState.names.includes("tkr-editor-shell-obsolete"));
  assert.equal(cacheState.names.filter((name) => name.startsWith("tkr-editor-shell-")).length, 1);
  assert.ok(cacheState.urls.length > 0 && cacheState.urls.every((entry) => entry.startsWith(`${origin}/tools/browser/editor-web/`)));
  cdp = await context.newCDPSession(browserPage);
  const manifest = await cdp.send("Page.getAppManifest");
  assert.equal(manifest.manifest.id, url);
  assert.equal(manifest.manifest.startUrl, url);
  assert.deepEqual(manifest.errors, []);
  await cdp.send("PWA.install", { manifestId: url });
  installed = true;
  if (process.env.TKR_PWA_PROOF_FAIL_AFTER_INSTALL === "1") throw new Error("deliberate post-install proof failure");
  await cdp.send("PWA.changeAppUserSettings", { manifestId: url, displayMode: "standalone" });
  await context.addInitScript(async () => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle("pwa-proof");
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    window.__tkrPickerReady = true;
  });
  const launched = context.waitForEvent("page");
  await cdp.send("PWA.launch", { manifestId: url });
  const app = await launched;
  await app.waitForFunction(() => matchMedia("(display-mode: standalone)").matches);
  await app.waitForFunction(() => window.__tkrPickerReady === true);
  await app.getByRole("button", { name: "Open project folder" }).click();
  const gameTitle = app.getByLabel("Game title");
  await gameTitle.waitFor();
  await gameTitle.fill(title);
  await app.getByRole("button", { name: "Apply changes" }).click();
  await app.getByRole("button", { name: "Save active editor", exact: true }).click();
  await app.getByRole("status").filter({ hasText: "All changes saved" }).waitFor();
  const stored = await browserPage.evaluate(async () => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle("pwa-proof");
    const main = await root.getDirectoryHandle("Main");
    const read = async (directory, name) => [...new Uint8Array(await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer())];
    return { game: await read(main, "example.gam"), sibling: await read(root, "sentinel.txt") };
  });
  const saved = Buffer.from(stored.game);
  assert.notDeepEqual(saved, initial);
  assert.ok(saved.includes(Buffer.from(title)), "saved game contains the edited title");
  assert.deepEqual(Buffer.from(stored.sibling), sentinel);
  await context.setOffline(true);
  await app.reload();
  await app.waitForFunction(() => window.__tkrPickerReady === true);
  await app.getByRole("button", { name: "Open project folder" }).click();
  await app.getByLabel("Game title").waitFor();
  assert.equal(await app.getByLabel("Game title").inputValue(), title);
  await cdp.send("PWA.uninstall", { manifestId: url });
  installed = false;
  const playerSurvived = await browserPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/packages/runner-web/app/index.html");
    const player = await caches.open("tkr-descriptors");
    return { active: registration?.active?.state, sentinel: await (await player.match("/player-sentinel")).text() };
  });
  assert.deepEqual(playerSurvived, { active: "activated", sentinel: "player remains" });
} catch (error) {
  failure = error;
  throw error;
} finally {
  const cleanupErrors = [];
  if (installed) {
    try {
      await cdp.send("PWA.uninstall", { manifestId: url });
      console.error("Removed installed editor after proof failure.");
    } catch (error) { cleanupErrors.push(error); }
  }
  try { await context?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await rm(profile, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length > 0) {
    if (failure) console.error("PWA cleanup failed:", cleanupErrors);
    else throw new AggregateError(cleanupErrors, "PWA cleanup failed");
  }
}
console.log(`PASS: installed standalone editor saved and reopened project bytes offline in Chromium ${browserVersion}; picker used OPFS`);
