import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface ProofWindow extends Window { __tkrCspViolations?: string[] }
type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

test("browser host mounts the shared settings view and keeps CSP quiet while editing a session copy", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as ProofWindow;
      (target.__tkrCspViolations ??= []).push(event.effectiveDirective);
    });
  });
  await page.goto("/tools/browser/editor-web/index.html");
  await expect(page.getByRole("heading", { name: "RPG Toolkit game settings" })).toBeVisible();
  await page.locator("#open-session").setInputFiles("docs/spec/examples/game/Main/example.gam");
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await expect(page.getByText(/session copy; changes stay in memory/)).toBeVisible();
  const nextTitle = `Browser host proof ${Date.now()}`;
  await title.fill(nextTitle);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(title).toHaveValue(nextTitle);
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? [])).toEqual([]);
});

test("browser folder handle and identity survive reload and re-selection", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Games/Only.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Games/Only.gam");
  await expect(page.getByLabel("Recent project")).toBeVisible();
  const identity = await page.locator("#recent-project").inputValue();
  await title.fill("Stable browser project");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Recent project")).toBeVisible();
  await page.getByRole("button", { name: "Reopen project" }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Stable browser project");
  await expect(page.locator("#host-status")).toContainText("Games/Only.gam");
  await expect(page.locator("#recent-project")).toHaveValue(identity);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Stable browser project");
  await expect(page.locator("#recent-project")).toHaveValue(identity);
});

test("browser folder open requires explicit selection when multiple nested games are found", async ({ page }) => {
  await installFolderPicker(page, [
    { path: "Games/First.gam", bytes: validMain },
    { path: "Nested/Second.gam", bytes: validMain },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  const selector = page.getByLabel("Game in project");
  await expect(selector).toBeVisible();
  await expect(selector.locator("option")).toHaveCount(2);
  await selector.selectOption("Nested/Second.gam");
  await page.getByRole("button", { name: "Open selected game" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Nested/Second.gam");
});

test("opening another session replaces only the old view and a failed open preserves the current view", async ({ page }) => {
  await page.goto("/tools/browser/editor-web/index.html");
  const fileInput = page.locator("#open-session");
  await fileInput.setInputFiles("docs/spec/examples/game/Main/example.gam");
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await title.fill("Unsaved title from prior view");

  await fileInput.setInputFiles("docs/spec/examples/versions/main/main_minor4.gam");
  await expect(title).toBeVisible();
  await expect(title).not.toHaveValue("Unsaved title from prior view");
  await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
  const currentTitle = await title.inputValue();

  await fileInput.setInputFiles({ name: "broken.gam", mimeType: "application/octet-stream", buffer: Buffer.from([1, 2, 3]) });
  await expect(page.locator("#host-status")).toContainText("broken.gam");
  await expect(title).toBeVisible();
  await expect(title).toHaveValue(currentTitle);
});

test("browser storage failure never exposes the picked folder as writable", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], false);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.locator("#host-status")).toContainText("could not be registered");
  await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/game/Main/example.gam");
  await expect(page.getByText(/session copy\. Changes stay in this browser session/)).toBeVisible();
});

test("browser recent projects do not open after the user denies restored-folder permission", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], true, true);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Recent project")).toBeVisible();
  await page.getByRole("button", { name: "Reopen project" }).click();
  await expect(page.locator("#host-status")).toContainText("could not be reopened");
  await expect(page.getByLabel("Game title")).toHaveCount(0);
});

// This browser integration crosses a real WebGL/audio player boundary; a unit test cannot prove a live game reaches its board.
test("a saved folder game launches in the live player from the editor", async ({ page }) => {
  const root = fileURLToPath(new URL("../../../docs/spec/examples/game", import.meta.url));
  const files: PickerInput[] = [];
  const collect = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) collect(path);
      else files.push({ path: relative(root, path).replaceAll("\\", "/"), bytes: Array.from(readFileSync(path)) });
    }
  };
  collect(root);
  const startup = files.findIndex((file) => file.path === "Game/Example/Prg/start.prg");
  expect(startup).toBeGreaterThanOrEqual(0);
  files[startup] = { path: "Game/Example/Prg/start.prg", bytes: Array.from(new TextEncoder().encode('mwin("Ready")\nwait()\nmwincls()\nsend("village.brd",2,2,1)\nSave("editor-proof")\nwait()\n')) };
  // Observe the exact ArrayBuffer handed to IndexedDB before its transaction, independently of the later host read.
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "blobs" && typeof key === "string" && key.includes("editor-proof") && value instanceof ArrayBuffer) {
        const size = value.byteLength;
        const digest = crypto.subtle.digest("SHA-256", value).then((result) => ({
          size,
          sha256: [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        }));
        Reflect.set(window, "__tkrPreSaveDigest", digest);
      }
      return original.call(this, value, key);
    };
  });
  await installFolderPicker(page, files);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByLabel("Game title").fill("Saved launch proof");
  await page.getByRole("button", { name: "Run game", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Running game"]');
  await expect(frame.getByLabel("Game screen")).toBeVisible();
  const live = async () => frame.locator("#screen").evaluate(() => Reflect.get(window, "__live") as { tick: number; board: string | null; player: unknown; stateHash: string } | undefined);
  await expect.poll(async () => (await live())?.tick ?? 0, { timeout: 30000 }).toBeGreaterThan(30);
  await frame.locator("#screen").press("Enter");
  await expect.poll(async () => (await live())?.board, { timeout: 30000 }).toContain("village.brd");
  const playing = await live();
  expect(playing?.player).not.toBeNull();
  expect(playing?.stateHash).toBeTruthy();
  await expect(page.getByLabel("Current run")).toContainText("village.brd");
  await expect(page.getByLabel("Run snapshot")).toContainText("Main/example.gam");
  const saved = async () => frame.locator("#screen").evaluate(async () => {
    const host = Reflect.get(window, "__blobHost") as { list(area: string, id: string): Promise<readonly string[]>; read(area: string, id: string, path: string): Promise<Uint8Array | null> } | undefined;
    const session = Reflect.get(window, "__session") as { gameId: string } | undefined;
    if (host === undefined || session === undefined) return null;
    const path = (await host.list("saves", session.gameId)).find((name) => name.includes("editor-proof"));
    if (path === undefined) return null;
    const bytes = await host.read("saves", session.gameId, path);
    if (bytes === null) return null;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
    return { gameId: session.gameId, path, size: bytes.length, sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  });
  await expect.poll(async () => (await saved())?.size ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
  const firstSave = await saved();
  const preSave = await frame.locator("#screen").evaluate(async () => await Reflect.get(window, "__tkrPreSaveDigest") as { size: number; sha256: string } | undefined);
  expect(preSave).toBeDefined();
  expect(firstSave).toMatchObject(preSave!);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
  // Do not execute Save in the next run: reading the same bytes proves they survived closing the first player.
  await page.evaluate(async () => {
    const picker = Reflect.get(window, "showDirectoryPicker") as () => Promise<FileSystemDirectoryHandle>;
    const root = await picker();
    const game = await (await root.getDirectoryHandle("Game")).getDirectoryHandle("Example");
    const programs = await game.getDirectoryHandle("Prg");
    const file = await programs.getFileHandle("start.prg");
    const writer = await file.createWritable();
    await writer.write(new TextEncoder().encode("wait()\n"));
    await writer.close();
  });
  await page.getByRole("button", { name: "Run game", exact: true }).click();
  await expect(frame.getByLabel("Game screen")).toBeVisible();
  await expect.poll(async () => await saved(), { timeout: 30000 }).toEqual(firstSave);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
});

// The real browser page is held at the player load boundary to prove an edit during the handoff cannot start stale bytes.
test("an edit before the player handshake prevents a stale game from starting", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Main/example.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  let observed!: () => void;
  let release!: () => void;
  const requested = new Promise<void>((resolve) => { observed = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/packages/runner-web/app/index.html?editor=1", async (route) => {
    observed();
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Run game", exact: true }).click();
  await requested;
  await page.getByLabel("Game title").fill("Changed during player setup");
  await page.getByLabel("Game title").press("Enter");
  release();
  await expect(page.getByLabel("Current run")).toContainText("changed while the run was being prepared");
  await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
});

type BrowserPickerSetup = { readonly files: readonly PickerInput[]; readonly indexedDbAvailable: boolean; readonly denyPermission: boolean };

async function installFolderPicker(page: Page, files: readonly PickerInput[], indexedDbAvailable = true, denyPermission = false): Promise<void> {
  const folderName = `TkrTest-${randomUUID()}`;
  await page.addInitScript(async ({ files: inputs, indexedDbAvailable: canPersist, denyPermission: deny, folderName: name }: BrowserPickerSetup & { readonly folderName: string }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      const parts = input.path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await file.getFile()).size > 0) continue;
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    if (!canPersist) {
      Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new DOMException("Storage blocked", "SecurityError"); } });
    }
    if (deny) {
      Object.defineProperty(FileSystemHandle.prototype, "requestPermission", { configurable: true, value: async () => "denied" });
    }
    Reflect.set(window, "__tkrPickerReady", true);
  }, { files, indexedDbAvailable, denyPermission, folderName });
}

