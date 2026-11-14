import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface ProofWindow extends Window {
  __tkrCspViolations?: string[];
  __tkrTestFolder?: FileSystemDirectoryHandle;
}
type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
function sampleProjectFiles(): PickerInput[] {
  const files: PickerInput[] = [{ path: "Main/example.gam", bytes: validMain }];
  const walk = (directory: URL, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(child, `${path}/`);
      else if (entry.isFile()) files.push({ path, bytes: Array.from(readFileSync(child)) });
    }
  };
  walk(new URL("../../../docs/spec/examples/game/Game/Example/", import.meta.url), "");
  return files;
}

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

test("browser workbench opens registered assets and packages a project through the reviewed UI", async ({ page }) => {
  await installFolderPicker(page, sampleProjectFiles());
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  const boards = page.getByRole("treeitem", { name: "Boards, folder, closed", exact: true });
  await boards.press("ArrowRight");
  const board = page.getByRole("treeitem", { name: "village.brd, board editor", exact: true });
  await board.dblclick();
  await expect(page.getByRole("tab", { name: "Boards/village.brd", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Package game…", exact: true }).click();
  await page.getByLabel("Release version").fill("1.0.0");
  await page.getByRole("button", { name: "Prepare package", exact: true }).click();
  const packageStatus = page.locator(".tkr-files-package-status");
  await expect(packageStatus).toContainText("Preflight passed");
  await page.getByText("Included and excluded file inventory", { exact: true }).click();
  const inventory = page.locator(".tkr-files-package-result");
  await expect(inventory).toContainText("Main/example.gam");
  await expect(inventory).toContainText("Chrs/ada.tem");
  await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The browser folder test handle is missing.");
    const prg = await root.getDirectoryHandle("Prg");
    const file = await prg.getFileHandle("open_chest.prg");
    const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const writable = await file.createWritable();
    await writable.write(bytes);
    await writable.close();
  });
  await page.getByLabel("I reviewed the included and excluded files.").check();
  await page.getByRole("button", { name: "Save package and descriptor…", exact: true }).click();
  await expect(packageStatus).toContainText("Project files or release version changed since preflight.");
  await page.getByRole("button", { name: "Prepare package", exact: true }).click();
  await expect(packageStatus).toContainText("Preflight passed");
  await expect(page.getByText("Included and excluded file inventory", { exact: true })).toBeVisible();
  await page.getByLabel("I reviewed the included and excluded files.").check();
  await page.getByRole("button", { name: "Save package and descriptor…", exact: true }).click();
  const saveDialog = page.getByRole("dialog");
  await saveDialog.getByRole("textbox").fill("Build/browser-game.tpk");
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(packageStatus).toContainText("Package and install descriptor saved to Build/browser-game.tpk.");

  const output = await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The browser folder test handle is missing.");
    const build = await root.getDirectoryHandle("Build");
    const archive = await (await build.getFileHandle("browser-game.tpk")).getFile();
    const descriptorFile = await (await build.getFileHandle("browser-game.tpk.json")).getFile();
    return {
      archiveSize: archive.size,
      descriptor: JSON.parse(await descriptorFile.text()) as { file: string; size: number; sha256: string; title: string; version: string },
    };
  });
  expect(output.archiveSize).toBeGreaterThan(0);
  expect(output.descriptor).toMatchObject({
    file: "browser-game.tpk",
    size: output.archiveSize,
    title: "Example Game",
    version: "1.0.0",
  });
  expect(output.descriptor.sha256).toMatch(/^[0-9a-f]{64}$/);
});

test("browser folder handle and identity survive reload and re-selection", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Games/Only.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
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
  await waitForFolderPicker(page);
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
  await waitForFolderPicker(page);
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
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.locator("#host-status")).toContainText("could not be registered");
  await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/game/Main/example.gam");
  await expect(page.getByText(/session copy\. Changes stay in this browser session/)).toBeVisible();
});

test("browser recent projects do not open after the user denies restored-folder permission", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], true, true);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
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
    if (!canPersist) {
      Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new DOMException("Storage blocked", "SecurityError"); } });
    }
    if (deny) {
      Object.defineProperty(FileSystemHandle.prototype, "requestPermission", { configurable: true, value: async () => "denied" });
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { files, indexedDbAvailable, denyPermission, folderName });
}

async function waitForFolderPicker(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
}

