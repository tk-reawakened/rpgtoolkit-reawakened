import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface ProofWindow extends Window {
  __tkrCspViolations?: string[];
  __tkrTestFolder?: FileSystemDirectoryHandle;
  __tkrSlowReadStarted?: boolean;
}
type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const validCharacter = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/character/character_minor8.tem", import.meta.url)));
const validItem = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/item/item_minor7.itm", import.meta.url)));

// Keep the action timeline when this intermittently stalls in CI (#2550).
test.use({ trace: "retain-on-failure" });

test("browser host mounts the shared settings view and keeps CSP quiet while editing a session copy", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as ProofWindow;
      (target.__tkrCspViolations ??= []).push(event.effectiveDirective);
    });
  });
  await page.goto("/tools/browser/editor-web/index.html");
  await expect(page.getByRole("heading", { name: "RPG Toolkit editor" })).toBeVisible();
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
test("browser workbench opens, edits, saves, and reopens character and item sprite documents", async ({ page }) => {
  const characterPath = "Chrs/ada.tem";
  const itemPath = "Item/chest.itm";
  await installFolderPicker(page, [
    { path: "Main/example.gam", bytes: validMain },
    { path: characterPath, bytes: validCharacter },
    { path: itemPath, bytes: validItem },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  await page.getByRole("treeitem", { name: "Chrs, folder, closed", exact: true }).press("ArrowRight");
  const character = page.getByRole("treeitem", { name: /ada\.tem, character editor/ });
  await character.dblclick();
  await expect(page.getByRole("tab", { name: characterPath, exact: true })).toBeVisible();
  const characterAnimation = page.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file");
  await characterAnimation.fill("Misc/ada_walk_s.anm");
  const authoring = page.getByRole("region", { name: "Character authoring" });
  await expect(authoring).toBeVisible();
  await authoring.getByLabel("Character name", { exact: true }).fill("Ada");
  await authoring.getByLabel("Experience variable").fill("ada_exp!");
  await authoring.getByLabel("Health (HP)", { exact: true }).fill("123");
  await authoring.getByLabel("Maximum level (0 disables progression)").fill("42");
  await authoring.getByLabel("Maximum level (0 disables progression)").blur();
  await expect(authoring.getByLabel("Character edit status")).toHaveText("Character change recorded. Save the document to keep it.");
  // #2609: no .prg or .spc editor exists, so the view says so instead of offering links that fail.
  await expect(authoring.getByLabel("Linked authoring availability")).toContainText("not available");
  await expect(authoring.getByRole("button", { name: /^Open (level-up program|special-move file)$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Save all", exact: true }).click();
  await expect(page.locator("#host-status")).toContainText(`Saved ${characterPath}.`);
  await page.locator("#close").click();
  await character.dblclick();
  await expect(page.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue("Misc/ada_walk_s.anm");
  await expect(page.getByRole("region", { name: "Character authoring" }).getByLabel("Character name", { exact: true })).toHaveValue("Ada");
  await expect(page.getByRole("region", { name: "Character authoring" }).getByLabel("Experience variable")).toHaveValue("ada_exp!");
  await expect(page.getByRole("region", { name: "Character authoring" }).getByLabel("Health (HP)", { exact: true })).toHaveValue("123");
  await expect(page.getByRole("region", { name: "Character authoring" }).getByLabel("Maximum level (0 disables progression)")).toHaveValue("42");

  await page.getByRole("treeitem", { name: "Item, folder, closed", exact: true }).press("ArrowRight");
  const item = page.getByRole("treeitem", { name: /chest\.itm, item editor/ });
  await item.dblclick();
  await expect(page.getByRole("tab", { name: itemPath, exact: true })).toBeVisible();
  const itemAnimation = page.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file");
  await itemAnimation.fill("Misc/chest_walk_s.anm");
  await page.getByRole("button", { name: "Save all", exact: true }).click();
  await expect(page.locator("#host-status")).toContainText(`Saved ${itemPath}.`);
  await page.locator("#close").click();
  await item.dblclick();
  await expect(page.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue("Misc/chest_walk_s.anm");
});
test("a newer browser open wins over a slow folder document read", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], true, false, true);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.waitForFunction(() => (window as ProofWindow).__tkrSlowReadStarted === true);
  await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/versions/main/main_minor4.gam");
  await expect(page.getByLabel("Game title")).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
  await expect(page.locator("#settings > section")).toHaveCount(1);
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
test("browser editor response header refuses cross-origin framing", async ({ page }) => {
  const response = await page.goto("/tools/browser/editor-web/index.html");
  expect(response).not.toBeNull();
  expect(response!.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(response!.headers()["x-frame-options"]).toBe("DENY");
  // Case-insensitive filesystems may serve the same editor under differently cased path segments.
  const alias = await page.request.get("/tools/browser/EDITOR-WEB/index.html");
  if (alias.ok()) {
    expect(alias.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(alias.headers()["x-frame-options"]).toBe("DENY");
  } else {
    expect(alias.status()).toBe(404);
  }
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    "content",
    "default-src 'none'; base-uri 'none'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'",
  );

  // The embedding page must not itself forbid frames: the editor's meta CSP defaults to frame-src 'none'.
  const port = new URL(page.url()).port;
  await page.goto("/health");
  const target = `http://localhost:${port}`;
  await page.evaluate((url) => {
    const iframe = document.createElement("iframe");
    iframe.id = "control";
    iframe.src = `${url}/health`;
    document.body.append(iframe);
  }, target);
  await expect(page.frameLocator("#control").locator("body")).toHaveText("ok");
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.evaluate((url) => {
    const iframe = document.createElement("iframe");
    iframe.src = `${url}/tools/browser/editor-web/index.html`;
    document.body.append(iframe);
  }, target);
  await expect.poll(() => consoleErrors.some((message) => message.includes(`frame-ancestors 'none'`))).toBe(true);
});

type BrowserPickerSetup = { readonly files: readonly PickerInput[]; readonly indexedDbAvailable: boolean; readonly denyPermission: boolean; readonly delayMainRead: boolean };

async function installFolderPicker(page: Page, files: readonly PickerInput[], indexedDbAvailable = true, denyPermission = false, delayMainRead = false): Promise<void> {
  const folderName = `TkrTest-${randomUUID()}`;
  await page.addInitScript(async ({ files: inputs, indexedDbAvailable: canPersist, denyPermission: deny, delayMainRead: delay, folderName: name }: BrowserPickerSetup & { readonly folderName: string }) => {
    let armed = false;
    let delayed = false;
    if (delay) {
      const originalGetFile = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = async function () {
        if (armed && !delayed && this.name.toLowerCase().endsWith(".gam")) {
          delayed = true;
          (window as ProofWindow).__tkrSlowReadStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return originalGetFile.call(this);
      };
    }
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
    armed = true;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
    if (!canPersist) {
      Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new DOMException("Storage blocked", "SecurityError"); } });
    }
    if (deny) {
      Object.defineProperty(FileSystemHandle.prototype, "requestPermission", { configurable: true, value: async () => "denied" });
    }
  }, { files, indexedDbAvailable, denyPermission, delayMainRead, folderName });
}

