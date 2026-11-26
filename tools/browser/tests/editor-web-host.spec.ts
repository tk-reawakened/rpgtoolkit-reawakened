import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { BinaryReader, createEmptyMainFile, decodeBoard, readPreVectorBoard, writeMainFile } from "@tk-reawakened/core";
interface ProofWindow extends Window {
  __tkrCspViolations?: string[];
  __tkrTestFolder?: FileSystemDirectoryHandle;
  __tkrSlowReadStarted?: boolean;
  __tkrReleaseSlowRead?: () => void;
  __tkrDeleteTestFile?: (path: string) => Promise<void>;
  __tkrDenyFileRead?: (name: string, successfulReadsAllowed?: number) => void;
  __tkrWriteTestFile?: (path: string, bytes: readonly number[]) => Promise<void>;
  __tkrDenyFileWrite?: (name: string) => void;
  __tkrAllowFileWrite?: (name: string) => void;
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
  await page.getByRole("button", { name: "Apply changes" }).click();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
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
  // #2609: the character editor cannot open linked .prg or .spc files, so it discloses that limitation rather than offering actions that fail.
  await expect(authoring.getByLabel("Linked authoring availability")).toContainText("cannot open linked");
  await expect(authoring.getByRole("button", { name: /^Open (level-up program|special-move file)$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Save All Open Documents/i }).click();
  await expect(page.locator("#host-status")).toContainText(`Saved ${characterPath}.`);
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Close Active Tab/i }).click();
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
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Save All Open Documents/i }).click();
  await expect(page.locator("#host-status")).toContainText(`Saved ${itemPath}.`);
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Close Active Tab/i }).click();
  await item.dblclick();
  await expect(page.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue("Misc/chest_walk_s.anm");
});
test("a newer browser open wins over a slow folder document read", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], true, false, true);
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.waitForFunction(() => (window as ProofWindow).__tkrSlowReadStarted === true);
  try {
    await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/versions/main/main_minor4.gam");
    await expect(page.getByLabel("Game title")).toBeVisible();
    await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
    await expect(page.getByRole("region", { name: "Editor workbench" })).toHaveCount(1);
  } finally {
    await page.evaluate(() => (window as ProofWindow).__tkrReleaseSlowRead?.());
  }
  await expect(page.locator("#settings > section")).toHaveCount(1);
  await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
});

test("selected game opening reports pending work, blocks competing opens, and recovers after a native read failure", async ({ page }) => {
  await installFolderPicker(page, [
    { path: "First.gam", bytes: validMain },
    { path: "Other.gam", bytes: validMain },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  const game = page.locator("#project-game");
  const open = page.getByRole("button", { name: "Open selected game", exact: true });
  await expect(open).toBeVisible();
  await game.selectOption("First.gam");

  // Hold the real native read, then remove the owned fixture entry so that the
  // eventual read fails natively rather than returning an invented error.
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.getFile;
    let held = false;
    const gate = new Promise<void>((release) => { (window as ProofWindow).__tkrReleaseSlowRead = release; });
    FileSystemFileHandle.prototype.getFile = async function () {
      if (!held && this.name === "First.gam") {
        held = true;
        (window as ProofWindow).__tkrSlowReadStarted = true;
        await gate;
        FileSystemFileHandle.prototype.getFile = original;
      }
      return original.call(this);
    };
  });
  await open.click();
  await page.waitForFunction(() => (window as ProofWindow).__tkrSlowReadStarted === true);
  try {
    await expect(page.locator("#host-status")).toContainText("Opening First.gam");
    for (const selector of ["#open-project", "#new-project", "#open-session", "#recent-project", "#reopen-project", "#project-game", "#open-selected-game"]) {
      await expect(page.locator(selector)).toBeDisabled();
    }
    await expect(game).toHaveValue("First.gam");
    await page.evaluate(async () => {
      const root = (window as ProofWindow).__tkrTestFolder;
      if (!root) throw new Error("The owned browser folder is missing.");
      await root.removeEntry("First.gam");
    });
  } finally {
    await page.evaluate(() => (window as ProofWindow).__tkrReleaseSlowRead?.());
  }
  await expect(open).toBeEnabled();
  await expect(game).toHaveValue("First.gam");
  await expect(page.locator("#host-status")).not.toContainText("Opening");
  await expect(page.locator("#host-status")).toContainText(/First\.gam|not found|could not be found/i);
  await expect(page.getByLabel("Game title")).toHaveCount(0);

  await page.evaluate(async (bytes) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const writable = await (await root.getFileHandle("First.gam", { create: true })).createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  }, validMain);
  await open.click();
  await expect(page.getByLabel("Game title")).toHaveValue("Example Game");
  await expect(page.locator("#host-status")).toContainText("First.gam");
  await expect(page.getByRole("button", { name: "Open project folder" })).toBeEnabled();
  const disk = await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const file = await (await root.getFileHandle("First.gam")).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  });
  expect(disk).toEqual(validMain);
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
  const packagePanel = page.getByRole("group", { name: "Package game" });
  await page.getByLabel("Release version").fill("1.0.0");
  await packagePanel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Package game…", exact: true }).click();
  await expect(page.getByLabel("Release version")).toHaveValue("1.0.0");
  await page.getByRole("button", { name: "Prepare package", exact: true }).click();
  const packageStatus = page.locator(".tkr-files-package-status");
  await expect(packageStatus).toContainText("Preflight passed");
  await page.getByText("Included and excluded file inventory", { exact: true }).click();
  const inventory = page.locator(".tkr-files-package-result");
  await expect(inventory).toContainText("Main/example.gam");
  await expect(inventory).toContainText("Chrs/ada.tem");
  await expect(page.getByRole("button", { name: "Save package and descriptor…" })).toHaveCount(0);
  const packageName = "Example-Game.tpk";
  await expect(page.getByRole("button", { name: `Download ${packageName}`, exact: true })).toBeDisabled();
  await page.getByLabel("I reviewed the included and excluded files.").check();
  const archiveDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${packageName}`, exact: true }).click();
  const archiveDownload = await archiveDownloadPromise;
  const archiveBytes = readFileSync(await archiveDownload.path());
  const descriptorDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${packageName}.json`, exact: true }).click();
  const descriptorDownload = await descriptorDownloadPromise;
  const descriptor = JSON.parse(readFileSync(await descriptorDownload.path(), "utf8")) as {
    file: string; size: number; sha256: string; title: string; version: string;
  };
  expect(archiveDownload.suggestedFilename()).toBe(packageName);
  expect(descriptorDownload.suggestedFilename()).toBe(`${packageName}.json`);
  expect(descriptor).toMatchObject({
    file: packageName,
    size: archiveBytes.byteLength,
    sha256: createHash("sha256").update(archiveBytes).digest("hex"),
    title: "Example Game",
    version: "1.0.0",
  });
  // Export is a normal download: the page never writes the package or descriptor into the project folder.
  const outputWasCreated = await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The browser folder test handle is missing.");
    for (const name of ["Example-Game.tpk", "Example-Game.tpk.json"]) {
      try {
        await root.getFileHandle(name);
        return true;
      } catch {
        // A missing file is the required result: nothing is written into the project.
      }
    }
    return false;
  });
  expect(outputWasCreated).toBe(false);
});

test("browser folder handle and identity survive reload and re-selection", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Games/Only.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Games/Only.gam");
  const identity = await page.locator("#recent-project").inputValue();
  expect(identity.length).toBeGreaterThan(0);
  await title.fill("Stable browser project");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await page.reload();
  await waitForFolderPicker(page);
  await expect(page.getByLabel("Recent project")).toBeVisible();
  await page.getByRole("button", { name: "Reopen project" }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Stable browser project");
  await expect(page.locator("#host-status")).toContainText("Games/Only.gam");
  await expect(page.locator("#recent-project")).toHaveValue(identity);
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Open Project Folder/i }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Stable browser project");
  await expect(page.locator("#recent-project")).toHaveValue(identity);
});

test("browser Save As replaces its sole source tab, then reopening the source reads its original bytes", async ({ page }) => {
  await installFolderPicker(page, sampleProjectFiles());
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  const title = page.getByRole("textbox", { name: "Game title", exact: true });
  await expect(title).toBeVisible();
  await expect(title).toHaveValue("Example Game");
  await expect(page.getByRole("tab", { name: "Main/example.gam", exact: true })).toBeVisible();
  await title.fill("Saved as a copy");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Save Active Document As/i }).click();
  const saveDialog = page.getByRole("dialog", { name: "Save Main/example.gam as" });
  await saveDialog.getByLabel("Save Main/example.gam as").fill("Main/copy.gam");
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#host-status")).toContainText("Main/copy.gam (saved as a copy of Main/example.gam)");
  await expect(page.getByRole("tab", { name: "Main/copy.gam", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Main/example.gam", exact: true })).toHaveCount(0);
  await expect(title).toHaveValue("Saved as a copy");

  const main = page.getByRole("treeitem", { name: "Main, folder, closed", exact: true });
  await main.press("ArrowRight");
  await page.getByRole("treeitem").filter({ hasText: "example.gam" }).dblclick();
  await expect(page.getByRole("tab", { name: "Main/example.gam", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Main/copy.gam", exact: true })).toBeVisible();
  await expect(title).toHaveValue("Example Game");
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

test("overlapping slow folder and newer session opens keep only the latest project visible", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Only.gam", bytes: validMain }], true, false, true);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.waitForFunction(() => (window as ProofWindow).__tkrSlowReadStarted === true);
  await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/versions/main/main_minor4.gam");
  await expect(page.getByLabel("Game title")).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("main_minor4.gam");
  await expect(page.getByRole("tab", { name: "main_minor4.gam", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Only.gam", exact: true })).toHaveCount(0);
});

test("a cancelled close during project switch keeps the dirty project and cleans the hidden candidate", async ({ page }) => {
  await installFolderPicker(page, [{ path: "Main/Only.gam", bytes: validMain }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByLabel("Open .gam session copy").setInputFiles("docs/spec/examples/game/Main/example.gam");
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  await title.fill("Unsaved project that must remain open");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Open Project Folder/i }).click();
  const confirmation = page.getByRole("dialog");
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(title).toHaveValue("Unsaved project that must remain open");
  await expect(page.locator("#host-status")).toContainText("is still open; Main/Only.gam was not opened.");
  await expect(page.getByRole("tab", { name: "Main/Only.gam", exact: true })).toHaveCount(0);
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

  // The embedding page must allow cross-origin frames, so the editor's response policy is what refuses the load.
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
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Running game"]');
  await expect(frame.getByLabel("Game screen")).toBeVisible();
  // The workbench fills the viewport and clips its overflow, so the player must be shown on screen, not merely attached:
  // it opens in front, in its own "Running game" tab.
  await expect(page.getByRole("tab", { name: "Running game", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('iframe[title="Running game"]')).toBeInViewport({ ratio: 1 });
  // Run stays available while a game runs: pressing it again restarts from a new snapshot (ADR 0022 D8.4).
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  const live = async () => frame.locator("#screen").evaluate(() => Reflect.get(window, "__live") as { tick: number; board: string | null; player: unknown; stateHash: string } | undefined);
  await expect.poll(async () => (await live())?.tick ?? 0, { timeout: 30000 }).toBeGreaterThan(30);
  await frame.locator("#screen").press("Enter");
  await expect.poll(async () => (await live())?.board, { timeout: 30000 }).toContain("village.brd");
  const playing = await live();
  expect(playing?.player).not.toBeNull();
  expect(playing?.stateHash).toBeTruthy();
  await expect(page.getByLabel("Run snapshot").locator("dd").filter({ hasText: /^[0-9a-f]{16}$/ })).toHaveCount(1);
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
  await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
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
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(frame.getByLabel("Game screen")).toBeVisible();
  await expect.poll(async () => await saved(), { timeout: 30000 }).toEqual(firstSave);
  await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
});

test("a board-backed program runs its declared fixture in the real browser player", async ({ page }) => {
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
  files.push({ path: "Game/Example/Bitmap/window.png", bytes: Array.from(readFileSync(new URL("../../../media/cursors/tkr-arrow.png", import.meta.url))) });
  const startup = files.findIndex((file) => file.path === "Game/Example/Prg/start.prg");
  expect(startup).toBeGreaterThanOrEqual(0);
  files[startup] = { path: "Game/Example/Prg/start.prg", bytes: Array.from(new TextEncoder().encode('mwin("FIXTURE PROGRAM PROOF")\nwait()\n')) };
  await installFolderPicker(page, files);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByRole("button", { name: "New run setup" }).click();
  const form = page.getByRole("dialog", { name: "New run setup" });
  await form.getByRole("tab", { name: "Test program" }).click();
  await form.getByRole("combobox", { name: "Program", exact: true }).selectOption("Game/Example/Prg/start.prg");
  await page.getByRole("combobox", { name: "Start board" }).selectOption("Game/Example/Boards/village.brd");
  await page.getByRole("listbox", { name: "Party", exact: true }).selectOption("Game/Example/Chrs/ada.tem");
  await page.getByRole("textbox", { name: "Font", exact: true }).fill("Liberation Sans");
  await page.getByRole("spinbutton", { name: "Font size" }).fill("18");
  await page.getByRole("combobox", { name: "Message window picture" }).selectOption("Game/Example/Bitmap/window.png");
  await form.getByRole("button", { name: "Test program", exact: true }).click();
  await expect(form).toHaveCount(0);
  const frame = page.frameLocator('iframe[title="Running game"]');
  const scene = async () => frame.locator("#screen").evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string; font?: { size: number }; source?: { asset?: string } }> } } } | undefined;
    const live = Reflect.get(window, "__live") as { board: string | null; stateHash: string; player: unknown } | undefined;
    const all = session?.engine.drawList().commands ?? [];
    const commands = all.filter((command) => command.kind === "text");
    return { live, text: commands.map((command) => command.text), sizes: commands.map((command) => command.font?.size),
      assets: all.filter((command) => command.kind === "blit").map((command) => command.source?.asset) };
  });
  await expect.poll(async () => (await scene()).text?.join(" ") ?? "", { timeout: 30_000 }).toContain("FIXTURE PROGRAM PROOF");
  const result = await scene();
  expect(result.live?.board).toContain("village.brd");
  expect(result.live?.player).toEqual({ x: 16, y: 31 });
  expect(result.live?.stateHash).toBeTruthy();
  expect(result.sizes).toContain(18);
  expect(result.assets).toContain("game/example/bitmap/window.png");
  await expect(page.getByLabel("Run snapshot").locator("dd").filter({ hasText: /^[0-9a-f]{16}$/ })).toHaveCount(1);
  await expect(page.getByLabel("Run snapshot")).toContainText("Liberation Sans");
  await expect(page.getByLabel("Run snapshot")).toContainText("Game/Example/Bitmap/window.png");
  await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
});

test("a board test starts a fresh selected board, party and position in the real browser player", async ({ page }) => {
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
  const ada = files.find((file) => file.path === "Game/Example/Chrs/ada.tem");
  expect(ada).toBeDefined();
  files.push({ path: "Game/Example/Chrs/companion.tem", bytes: [...ada!.bytes] });
  const startup = files.findIndex((file) => file.path === "Game/Example/Prg/start.prg");
  expect(startup).toBeGreaterThanOrEqual(0);
  files[startup] = { path: "Game/Example/Prg/start.prg", bytes: Array.from(new TextEncoder().encode('mwin("SAVED STARTUP MUST NOT RUN")\n')) };
  await installFolderPicker(page, files);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  // A saved setup (ADR 0022 D8.7): made from "Add setup…", kept in .tkr/launch.json, and chosen for the Run button.
  await page.getByRole("combobox", { name: "Run setup" }).selectOption({ label: "Add setup…" });
  const form = page.getByRole("dialog", { name: "New run setup" });
  await form.getByRole("tab", { name: "Test board" }).click();
  await page.getByRole("spinbutton", { name: "Column" }).fill("2");
  await page.getByRole("spinbutton", { name: "Row" }).fill("2");
  const party = page.getByRole("listbox", { name: "Party", exact: true }).first();
  await party.selectOption("Game/Example/Chrs/companion.tem");
  await party.selectOption(["Game/Example/Chrs/ada.tem", "Game/Example/Chrs/companion.tem"]);
  await page.getByRole("spinbutton", { name: "Seed" }).fill("23");
  await form.getByRole("textbox", { name: "Setup name" }).fill("Village start");
  await form.getByRole("button", { name: "Save and run", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Run setup" })).toHaveValue("Village start");
  const savedSetups = await page.evaluate(async () => {
    const picker = Reflect.get(window, "showDirectoryPicker") as () => Promise<FileSystemDirectoryHandle>;
    const file = await (await (await picker()).getDirectoryHandle(".tkr")).getFileHandle("launch.json");
    return JSON.parse(await (await file.getFile()).text()) as unknown;
  });
  expect(savedSetups).toEqual({
    version: 1,
    configurations: [{
      name: "Village start",
      kind: "board",
      seed: 23,
      start: { board: "Game/Example/Boards/village.brd", x: 2, y: 2, layer: 1 },
      party: ["Game/Example/Chrs/companion.tem", "Game/Example/Chrs/ada.tem"],
    }],
  });

  const frame = page.frameLocator('iframe[title="Running game"]');
  await expect(frame.getByLabel("Game screen")).toBeVisible();
  const scene = async () => frame.locator("#screen").evaluate(() => {
    const live = Reflect.get(window, "__live") as { board: string | null; player: unknown; stateHash: string } | undefined;
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string }> } } } | undefined;
    return { live, text: (session?.engine.drawList().commands ?? []).filter((command) => command.kind === "text").map((command) => command.text) };
  });
  await expect.poll(async () => (await scene()).live?.board ?? "", { timeout: 30_000 }).toContain("village.brd");
  const result = await scene();
  expect(result.live?.player).toEqual({ x: 48, y: 63 });
  expect(result.live?.stateHash).toBeTruthy();
  expect(result.text.join(" ")).not.toContain("SAVED STARTUP MUST NOT RUN");
  await expect(page.getByLabel("Run snapshot").locator("dd").filter({ hasText: /^[0-9a-f]{16}$/ })).toHaveCount(1);
  await expect(page.getByLabel("Run snapshot")).toContainText("Game/Example/Chrs/companion.tem, Game/Example/Chrs/ada.tem");
  await expect(page.getByLabel("Run snapshot")).toContainText("23");
  await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
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
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await requested;
  // The player opens in its own tab; the game settings are one tab back.
  await page.getByRole("tab", { name: "Main/example.gam", exact: true }).click();
  await page.getByLabel("Game title").fill("Changed during player setup");
  await page.getByRole("button", { name: "Apply changes" }).click();
  release();
  await expect(page.getByLabel("Current run")).toContainText("changed while the run was being prepared");
  await expect(page.locator('iframe[title="Running game"]')).toHaveCount(0);
});

test("browser workbench creates a new project in the chosen folder, copies only the ticked starter contents, and opens its main file", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as ProofWindow;
      (target.__tkrCspViolations ??= []).push(event.effectiveDirective);
    });
  });
  const bystander = [4, 2, 4, 2];
  await installFolderPicker(page, [{ path: "notes.txt", bytes: bystander }]);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "New project…" }).click();
  const wizard = page.getByRole("dialog", { name: "New project" });
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("Game name").fill("Quest");
  await expect(wizard.getByLabel("Main file")).toHaveValue("Quest.gam");
  await expect(wizard.getByLabel("Start-up program")).not.toBeChecked();
  await expect(wizard.getByLabel("Music pack")).toBeDisabled();
  await wizard.getByLabel("Start-up program").check();
  await wizard.getByLabel("Empty start board").check();
  await wizard.getByRole("button", { name: "Choose folder…" }).click();
  await expect(wizard.getByRole("status").filter({ hasText: /^TkrTest-/ })).toBeVisible();
  await wizard.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Quest");
  await expect(wizard).toHaveCount(0);

  const disk = await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder!;
    const found: string[] = [];
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === "directory") {
          found.push(`${prefix}${name}/`);
          await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
        } else found.push(`${prefix}${name}`);
      }
    };
    const readProjectFile = async (path: string): Promise<number[]> => {
      const parts = path.split("/");
      let directory = root;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const file = await directory.getFileHandle(parts.at(-1)!);
      return [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
    };
    await walk(root, "");
    const historyDirectory = await root.getDirectoryHandle(".tkr-history");
    const groupsDirectory = await historyDirectory.getDirectoryHandle("groups");
    const groups: {
      readonly name: string;
      readonly record: {
        readonly id: string;
        readonly schema: number;
        readonly reason: string;
        readonly name: string | null;
        readonly restores: string | null;
        readonly files: readonly { readonly path: string; readonly before: string | null; readonly after: string | null; readonly status: string }[];
        readonly uncovered: readonly unknown[];
      };
      readonly progress: {
        readonly files: readonly { readonly path: string; readonly before: string | null; readonly after: string | null; readonly status: string }[];
      };
    }[] = [];
    for await (const [name, handle] of groupsDirectory.entries()) {
      if (handle.kind !== "file") continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      const record = JSON.parse(await file.text()) as (typeof groups)[number]["record"];
      const progressDirectory = await historyDirectory.getDirectoryHandle("progress");
      const groupProgress = await progressDirectory.getDirectoryHandle(record.id);
      const updates: { readonly number: number; readonly record: (typeof groups)[number]["progress"] }[] = [];
      for await (const [progressName, progressHandle] of groupProgress.entries()) {
        const match = /^(\d+)\.json$/.exec(progressName);
        if (progressHandle.kind !== "file" || match === null) continue;
        const progressFile = await (progressHandle as FileSystemFileHandle).getFile();
        updates.push({
          number: Number(match[1]),
          record: JSON.parse(await progressFile.text()) as (typeof groups)[number]["progress"],
        });
      }
      updates.sort((left, right) => right.number - left.number);
      const latest = updates[0];
      if (latest === undefined) throw new Error(`History group ${record.id} has no durable progress record.`);
      groups.push({ name, record, progress: latest.record });
    }
    const written: Record<string, number[]> = {};
    const contents: Record<string, number[]> = {};
    for (const { progress } of groups) {
      for (const item of progress.files) {
        written[item.path] = await readProjectFile(item.path);
        if (item.after !== null) {
          const file = await (await historyDirectory.getDirectoryHandle("contents")).getFileHandle(item.after);
          contents[item.after] = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
        }
      }
    }
    const notes = await (await root.getFileHandle("notes.txt")).getFile();
    return { found: found.sort(), notes: [...new Uint8Array(await notes.arrayBuffer())], groups, written, contents };
  });
  const authoredFiles = [
    "Bitmap/", "Bkrounds/", "Boards/", "Boards/start.brd", "Chrs/", "Enemy/", "Font/", "Item/", "Main/", "Main/Quest.gam", "Media/", "Misc/", "Plugin/",
    "Prg/", "Prg/start.prg", "SpcMove/", "StatusE/", "Tiles/", "notes.txt",
  ];
  expect(disk.groups).toHaveLength(1);
  const groupFile = disk.groups[0]!;
  expect(groupFile.name).toBe(`${groupFile.record.id}.json`);
  expect(disk.found.filter((path) => !path.startsWith(".tkr-history/"))).toEqual(authoredFiles.sort());
  expect(disk.found).toContain(".tkr-history/groups/");
  expect(disk.found).toContain(`.tkr-history/groups/${groupFile.name}`);
  expect(disk.found).toContain(".tkr-history/contents/");
  expect(disk.notes).toEqual(bystander);
  expect(groupFile.record.schema).toBe(1);
  expect(groupFile.record.reason).toBe("before-wizard");
  expect(groupFile.record.name).toBe("New project");
  expect(groupFile.record.restores).toBeNull();
  expect(groupFile.record.uncovered).toEqual([]);
  const plannedWrites = ["Boards/start.brd", "Main/Quest.gam", "Prg/start.prg"];
  expect(groupFile.record.files.map(({ path }) => path).sort()).toEqual(plannedWrites);
  expect(groupFile.record.files.every((file) => file.before === null && file.status === "pending")).toBe(true);
  expect(groupFile.progress.files.map(({ path }) => path).sort()).toEqual(plannedWrites);
  expect(groupFile.progress.files.every((file) => file.before === null && file.status === "written")).toBe(true);
  expect(Object.keys(disk.written).sort()).toEqual(plannedWrites);
  for (const item of groupFile.progress.files) {
    const bytes = new Uint8Array(disk.written[item.path] ?? []);
    const contents = new Uint8Array(disk.contents[item.after ?? ""] ?? []);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    expect(item.after).toBe(actualHash);
    expect(createHash("sha256").update(contents).digest("hex")).toBe(actualHash);
    expect([...contents]).toEqual([...bytes]);
  }
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? [])).toEqual([]);
});
test("browser board upgrade rechecks changed game ownership and refuses a sibling outside the new Boards root", async ({ page }) => {
  const source = "Game/A/Boards/Region/Old.brd";
  const destination = "Game/A/Boards/Future/Copy.brd";
  const sourceBytes = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Boards/Future" });
  expect(mainA.ok).toBe(true);
  expect(mainB.ok).toBe(true);
  if (!mainA.ok || !mainB.ok) throw new Error("Could not create owner fixtures.");
  await installFolderPicker(page, [
    { path: "Main/A.gam", bytes: Array.from(mainA.value) },
    { path: source, bytes: sourceBytes },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();

  for (const name of ["Game", "A", "Boards", "Region"]) {
    const folder = page.getByRole("treeitem", { name: `${name}, folder, closed`, exact: true });
    await folder.press("ArrowRight");
  }
  const board = page.getByRole("treeitem", { name: "Old.brd, board editor", exact: true });
  await board.dblclick();
  await expect(page.getByRole("tab", { name: source, exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+P");
  const search = page.getByRole("combobox", { name: "Search commands and files" });
  await search.fill("Convert active board from tile to pixel");
  await search.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Choose copy destination…" }).click();
  const saveDialog = page.getByRole("dialog", { name: `Save ${source} as` });
  await saveDialog.getByRole("textbox").fill(destination);
  await page.evaluate(async (bytes) => {
    const write = (window as ProofWindow).__tkrWriteTestFile;
    if (write === undefined) throw new Error("The browser test folder writer is missing.");
    await write("B.gam", bytes);
  }, Array.from(mainB.value));
  await page.evaluate(() => {
    const denyRead = (window as ProofWindow).__tkrDenyFileRead;
    if (denyRead === undefined) throw new Error("The browser test read-denial hook is missing.");
    denyRead("B.gam", 1);
  });
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  const refusal = page.getByRole("dialog").filter({ hasText: "Save the upgraded copy inside the source board's owning game." });
  await expect(refusal).toBeVisible();
  await refusal.getByRole("button", { name: "OK", exact: true }).click();
  const disk = await page.evaluate(async ({ sourcePath, destinationPath }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const sourceParts = sourcePath.split("/");
    let parent = root;
    for (const part of sourceParts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    const sourceHandle = await parent.getFileHandle(sourceParts.at(-1)!);
    const actualSource = [...new Uint8Array(await (await sourceHandle.getFile()).arrayBuffer())];
    let destinationExists = false;
    try {
      const destinationParts = destinationPath.split("/");
      let destinationParent = root;
      for (const part of destinationParts.slice(0, -1)) destinationParent = await destinationParent.getDirectoryHandle(part);
      await destinationParent.getFileHandle(destinationParts.at(-1)!);
      destinationExists = true;
    } catch { destinationExists = false; }
    return { actualSource, destinationExists };
  }, { sourcePath: source, destinationPath: destination });
  expect(disk.actualSource).toEqual(sourceBytes);
  expect(disk.destinationExists).toBe(false);
  await page.evaluate(() => {
    const denyRead = (window as ProofWindow).__tkrDenyFileRead;
    if (denyRead === undefined) throw new Error("The browser test read-denial hook is missing.");
    denyRead("B.gam");
  });
  await page.keyboard.press("Control+Shift+P");
  const upgradeSearch = page.getByRole("combobox", { name: "Search commands and files" });
  await upgradeSearch.fill("Upgrade a pre-vector board");
  await upgradeSearch.press("Enter");
  const readFailure = page.getByRole("dialog").filter({ hasText: "Could not refresh game ownership: Could not read B.gam:" });
  await expect(readFailure).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await readFailure.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await waitForFolderPicker(page);
  await page.evaluate(() => {
    const denyRead = (window as ProofWindow).__tkrDenyFileRead;
    if (denyRead === undefined) throw new Error("The browser test read-denial hook is missing.");
    denyRead("B.gam");
  });
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("combobox", { name: "Game in project" }).selectOption({ label: "Main/A.gam" });
  await page.getByRole("button", { name: "Open selected game" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  for (const name of ["Game", "A", "Boards", "Region"]) {
    await page.getByRole("treeitem", { name: `${name}, folder, closed`, exact: true }).press("ArrowRight");
  }
  await page.getByRole("treeitem", { name: "Old.brd, board editor", exact: true }).dblclick();
  await expect(page.getByRole("tab", { name: source, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("browser board upgrade preserves loose Boards ownership while a declared game folder is absent", async ({ page }) => {
  const source = "Boards/Old.brd";
  const destination = "Boards/Copy.brd";
  const sourceBytes = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  expect(main.ok).toBe(true);
  if (!main.ok) throw new Error("Could not create owner fixture.");
  await installFolderPicker(page, [
    { path: "Main/A.gam", bytes: Array.from(main.value) },
    { path: source, bytes: sourceBytes },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByRole("treeitem", { name: "Boards, folder, closed", exact: true }).press("ArrowRight");
  await page.getByRole("treeitem", { name: "Old.brd, board editor", exact: true }).dblclick();
  await expect(page.getByRole("tab", { name: source, exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+P");
  const search = page.getByRole("combobox", { name: "Search commands and files" });
  await search.fill("Convert active board from tile to pixel");
  await search.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Choose copy destination…" }).click();
  const saveDialog = page.getByRole("dialog", { name: `Save ${source} as` });
  await saveDialog.getByRole("textbox").fill(destination);
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: destination, exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(async ({ path, original }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) return false;
    try {
      const file = await root.getDirectoryHandle("Boards").then((folder) => folder.getFileHandle(path.split("/").at(-1)!));
      const bytes = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
      return bytes.length > 0 && (bytes.length !== original.length || bytes.some((value, index) => value !== original[index]));
    } catch { return false; }
  }, { path: destination, original: sourceBytes })).toBe(true);
  const actualSource = await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const folder = await root.getDirectoryHandle("Boards");
    const file = await folder.getFileHandle("Old.brd");
    return [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
  });
  expect(actualSource).toEqual(sourceBytes);
});
test("browser board upgrade uses live Main inventory after the originally selected Main is deleted", async ({ page }) => {
  const source = "Game/A/Region/Boards/Old.brd";
  const destination = "Game/A/Region/Boards/Copy.brd";
  const selectedSource = "Game/A/Boards/Initial/Before.brd";
  const selectedCopy = "Game/A/Boards/Initial/Copy.brd";
  const sourceBytes = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/board/board_minor4.brd", import.meta.url)));
  const mainA = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A" });
  const mainB = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, projectPath: "A/Region" });
  expect(mainA.ok).toBe(true);
  expect(mainB.ok).toBe(true);
  if (!mainA.ok || !mainB.ok) throw new Error("Could not create owner fixtures.");
  await installFolderPicker(page, [
    { path: "A.gam", bytes: Array.from(mainA.value) },
    { path: "Main/B.gam", bytes: Array.from(mainB.value) },
    { path: selectedSource, bytes: sourceBytes },
    { path: source, bytes: sourceBytes },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("combobox", { name: "Game in project" }).selectOption({ label: "A.gam" });
  await page.getByRole("button", { name: "Open selected game" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  for (const name of ["Game", "A", "Boards", "Initial"]) {
    await page.getByRole("treeitem", { name: `${name}, folder, closed`, exact: true }).press("ArrowRight");
  }
  await page.getByRole("treeitem", { name: "Before.brd, board editor", exact: true }).dblclick();
  await expect(page.getByRole("tab", { name: selectedSource, exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+P");
  const selectedSearch = page.getByRole("combobox", { name: "Search commands and files" });
  await selectedSearch.fill("Convert active board from tile to pixel");
  await selectedSearch.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Choose copy destination…" }).click();
  const selectedSave = page.getByRole("dialog", { name: `Save ${selectedSource} as` });
  await selectedSave.getByRole("textbox").fill(selectedCopy);
  await selectedSave.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: selectedCopy, exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(async ({ path, original }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) return false;
    try {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const file = await parent.getFileHandle(parts.at(-1)!);
      const bytes = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
      return bytes.length > 0 && (bytes.length !== original.length || bytes.some((value, index) => value !== original[index]));
    } catch { return false; }
  }, { path: selectedCopy, original: sourceBytes })).toBe(true);
  await page.evaluate(async () => {
    const remove = (window as ProofWindow).__tkrDeleteTestFile;
    if (remove === undefined) throw new Error("The browser test folder delete hook is missing.");
    await remove("A.gam");
  });
  for (const name of ["Region", "Boards"]) {
    await page.getByRole("treeitem", { name: `${name}, folder, closed`, exact: true }).press("ArrowRight");
  }
  await page.getByRole("treeitem", { name: "Old.brd, board editor", exact: true }).dblclick();
  await expect(page.getByRole("tab", { name: source, exact: true })).toBeVisible();
  await page.keyboard.press("Control+Shift+P");
  const search = page.getByRole("combobox", { name: "Search commands and files" });
  await search.fill("Convert active board from tile to pixel");
  await search.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Choose copy destination…" }).click();
  const saveDialog = page.getByRole("dialog", { name: `Save ${source} as` });
  await saveDialog.getByRole("textbox").fill(destination);
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: destination, exact: true })).toBeVisible();
  await expect.poll(async () => page.evaluate(async ({ path, original }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) return false;
    try {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const file = await parent.getFileHandle(parts.at(-1)!);
      const bytes = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
      return bytes.length > 0 && (bytes.length !== original.length || bytes.some((value, index) => value !== original[index]));
    } catch { return false; }
  }, { path: destination, original: sourceBytes })).toBe(true);
  const disk = await page.evaluate(async ({ sourcePath, destinationPath }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const read = async (path: string) => {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const handle = await parent.getFileHandle(parts.at(-1)!);
      return [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
    };
    return { source: await read(sourcePath), destination: await read(destinationPath) };
  }, { sourcePath: source, destinationPath: destination });
  expect(disk.source).toEqual(sourceBytes);
  expect(disk.destination).not.toEqual(sourceBytes);
});

type BrowserPickerSetup = { readonly files: readonly PickerInput[]; readonly indexedDbAvailable: boolean; readonly denyPermission: boolean; readonly delayMainRead: boolean };

async function installFolderPicker(
  page: Page,
  files: readonly PickerInput[],
  indexedDbAvailable = true,
  denyPermission = false,
  delayMainRead = false,
): Promise<void> {
  const folderName = `TkrTest-${randomUUID()}`;
  await page.addInitScript(async ({ files: inputs, indexedDbAvailable: canPersist, denyPermission: deny, delayMainRead: delay, folderName: name }: BrowserPickerSetup & { readonly folderName: string }) => {
    let delayed = false;
    let armed = false;
    if (delay) {
      const originalGetFile = FileSystemFileHandle.prototype.getFile;
      const gate = new Promise<void>((release) => { (window as ProofWindow).__tkrReleaseSlowRead = release; });
      FileSystemFileHandle.prototype.getFile = async function () {
        if (armed && !delayed && this.name.toLowerCase().endsWith(".gam")) {
          delayed = true;
          (window as ProofWindow).__tkrSlowReadStarted = true;
          await gate;
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
    (window as ProofWindow).__tkrWriteTestFile = async (path, bytes) => {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    };
    (window as ProofWindow).__tkrDeleteTestFile = async (path) => {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      await parent.removeEntry(parts.at(-1)!);
    };
    const originalGetFile = FileSystemFileHandle.prototype.getFile;
    (window as ProofWindow).__tkrDenyFileRead = (target, successfulReadsAllowed = 0) => {
      let remainingSuccessfulReads = successfulReadsAllowed;
      Object.defineProperty(FileSystemFileHandle.prototype, "getFile", {
        configurable: true,
        value: async function (this: FileSystemFileHandle): Promise<File> {
          if (this.name === target) {
            if (remainingSuccessfulReads === 0) throw new DOMException("Permission denied", "NotAllowedError");
            remainingSuccessfulReads -= 1;
          }
          return originalGetFile.call(this);
        },
      });
    };
    const originalCreateWritable = FileSystemFileHandle.prototype.createWritable;
    const deniedWrites = new Set<string>();
    Object.defineProperty(FileSystemFileHandle.prototype, "createWritable", {
      configurable: true,
      value: async function (this: FileSystemFileHandle, ...args: Parameters<typeof originalCreateWritable>) {
        if (deniedWrites.has(this.name)) throw new DOMException("Permission denied", "NotAllowedError");
        return originalCreateWritable.apply(this, args);
      },
    });
    (window as ProofWindow).__tkrDenyFileWrite = (target) => { deniedWrites.add(target); };
    (window as ProofWindow).__tkrAllowFileWrite = (target) => { deniedWrites.delete(target); };
    armed = true;

    if (!canPersist) {
      Object.defineProperty(indexedDB, "open", { configurable: true, value: () => { throw new DOMException("Storage blocked", "SecurityError"); } });
    }
    if (deny) {
      Object.defineProperty(FileSystemHandle.prototype, "requestPermission", { configurable: true, value: async () => "denied" });
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
    Reflect.set(window, "__tkrPickerReady", true);
  }, { files, indexedDbAvailable, denyPermission, delayMainRead, folderName });
}

async function waitForFolderPicker(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
}

test("browser host upgrades the pinned original minor-2 board and runs its reopened pixel-coordinate copy", async ({ page }) => {
  const fixturePath = fileURLToPath(new URL("../../../fixtures/legacy/Caoquest/Boards/red.brd", import.meta.url));
  test.skip(!existsSync(fixturePath), "Run pnpm fixtures:fetch to use the pinned original minor-2 board; no source game files are committed.");
  const sourcePath = "Game/Example/Boards/red.brd";
  const copyPath = "Game/Example/Boards/red.upgraded.brd";
  const original = new Uint8Array(readFileSync(fixturePath));
  expect(createHash("sha256").update(original).digest("hex")).toBe("ef946b9671bcc83091e9264d8e318e1be05ce27c8fd4adc61fefaec31f813d62");
  const raw = readPreVectorBoard(new BinaryReader(original, sourcePath));
  expect(raw.ok).toBe(true);
  if (!raw.ok) throw new Error(raw.error.message);
  expect([raw.value.major, raw.value.minor, raw.value.sizeX, raw.value.sizeY, raw.value.sizeL]).toEqual([2, 2, 19, 14, 8]);
  expect(Object.fromEntries([...new Set(raw.value.tileMatrix.map((cell) => cell.tileType))].sort((a, b) => a - b)
    .map((type) => [type, raw.value.tileMatrix.filter((cell) => cell.tileType === type).length]))).toEqual({ 0: 2007, 1: 85, 2: 36 });
  expect(raw.value.programs).toHaveLength(501);
  expect(raw.value.programs.filter(({ file }) => file.length > 0)).toHaveLength(24);
  expect(raw.value.programs.slice(0, 2)).toMatchObject([
    { file: "warp00000002.prg", x: 17, y: 5, layer: 1 },
    { file: "talktored.prg", x: 9, y: 5, layer: 1 },
  ]);
  expect(raw.value.sprites).toHaveLength(11);
  expect(raw.value.sprites.filter(({ file }) => file.length > 0)).toHaveLength(2);
  expect(raw.value.sprites.filter(({ file }) => file.length > 0).slice(0, 2)).toMatchObject([
    { file: "gem.itm", x: 17, y: 3, layer: 1 },
    { file: "red.itm", x: 3, y: 7, layer: 1 },
  ]);
  expect(raw.value.tileMatrix.filter((cell) => cell.r !== 0 || cell.g !== 0 || cell.b !== 0)).toEqual([
    { lutIndex: 26, r: -26, g: -26, b: -26, tileType: 2 },
    { lutIndex: 5, r: -26, g: -26, b: -26, tileType: 2 },
  ]);

  // Board tile 7 uses tileset entry 6, under the fetched board's explicit (2, 2) runner start.
  const tileCount = 218;
  const tilesetBytes = new Uint8Array(6 + tileCount * 1024);
  const tilesetHeader = new DataView(tilesetBytes.buffer);
  tilesetHeader.setUint16(0, 20, true);
  tilesetHeader.setUint16(2, tileCount, true);
  tilesetHeader.setUint16(4, 3, true);
  for (let tile = 0; tile < tileCount; tile += 1) {
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) tilesetBytes[6 + tile * 1024 + y * 32 + x] = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 42 : 213);
    }
  }

  const scriptPath = "Game/Example/Prg/warp00000002.prg";
  const scriptBytes = Array.from(new TextEncoder().encode("// Authored sentinel; board coordinate upgrade must not rewrite this external script.\n"));
  const programFiles = [...new Set(raw.value.programs.map(({ file }) => file).filter((file) => file.length > 0))]
    .map((file) => ({ path: `Game/Example/Prg/${file}`, bytes: file === "warp00000002.prg" ? scriptBytes : [] }));
  const midi = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0];
  await installFolderPicker(page, [
    { path: "Main/example.gam", bytes: validMain },
    { path: sourcePath, bytes: Array.from(original) },
    { path: "Game/Example/Tiles/forest_set.tst", bytes: Array.from(tilesetBytes) },
    { path: "Game/Example/Chrs/ada.tem", bytes: Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/Chrs/ada.tem", import.meta.url))) },
    { path: "Game/Example/Item/gem.itm", bytes: validItem },
    { path: "Game/Example/Item/red.itm", bytes: validItem },
    { path: "Game/Example/Music/Town.mid", bytes: midi },
    ...programFiles,
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await waitForFolderPicker(page);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  for (const name of ["Game", "Example", "Boards"]) {
    await page.getByRole("treeitem", { name: `${name}, folder, closed`, exact: true }).press("ArrowRight");
  }

  const openUpgrade = async () => {
    await page.keyboard.press("Control+Shift+P");
    const search = page.getByRole("combobox", { name: "Search commands and files" });
    await search.fill("Upgrade a pre-vector board");
    await search.press("Enter");
  };
  await openUpgrade();
  const boardPicker = page.getByRole("dialog").filter({ hasText: "Choose a board to upgrade" });
  await boardPicker.getByRole("button", { name: sourcePath, exact: true }).click();
  const cancelledPreview = page.getByRole("dialog").filter({ hasText: `Upgrade pre-vector board: ${sourcePath}?` });
  await expect(cancelledPreview).toContainText("19 × 14 tiles across 8 layer(s), 2128 stored tile cells, 32 vectors, 24 programs, 2 sprites, and 1 shading layer(s).");
  await cancelledPreview.getByRole("button", { name: "Cancel", exact: true }).click();
  const cancelledState = await page.evaluate(async ({ sourceName, destinationName }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const boards = await (await (await root.getDirectoryHandle("Game")).getDirectoryHandle("Example")).getDirectoryHandle("Boards");
    const sourceBytes = new Uint8Array(await (await (await boards.getFileHandle(sourceName)).getFile()).arrayBuffer());
    let destinationExists = false;
    try {
      await boards.getFileHandle(destinationName);
      destinationExists = true;
    } catch {
      // An absent destination is the expected cancellation result.
    }
    return { sourceBytes: [...sourceBytes], destinationExists };
  }, { sourceName: sourcePath.split("/").at(-1)!, destinationName: copyPath.split("/").at(-1)! });
  expect(cancelledState.sourceBytes).toEqual([...original]);
  expect(cancelledState.destinationExists).toBe(false);
  await openUpgrade();
  const acceptedPicker = page.getByRole("dialog").filter({ hasText: "Choose a board to upgrade" });
  await acceptedPicker.getByRole("button", { name: sourcePath, exact: true }).click();
  const preview = page.getByRole("dialog").filter({ hasText: `Upgrade pre-vector board: ${sourcePath}?` });
  await expect(preview).toContainText("19 × 14 tiles across 8 layer(s), 2128 stored tile cells, 32 vectors, 24 programs, 2 sprites, and 1 shading layer(s).");
  await expect(preview).toContainText("vector 1 points [32,0; 352,0; 352,32; 32,32]");
  await expect(preview).toContainText('program 1 "warp00000002.prg" points [512,128; 544,128; 544,160; 512,160]');
  await expect(preview).toContainText("sprite 1 gem.itm at 528,95, layer 1");
  await expect(preview).toContainText("shade records [16:0,0,0; 1:-26,-26,-26; 77:0,0,0; 1:-26,-26,-26]");
  await preview.getByRole("button", { name: "Choose copy destination…", exact: true }).click();
  const saveDialog = page.getByRole("dialog", { name: `Save ${sourcePath} as` });
  await saveDialog.getByRole("textbox").fill(copyPath);
  await saveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: copyPath, exact: true })).toBeVisible();

  const disk = await page.evaluate(async ({ source, destination }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const read = async (path: string) => {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      const file = await parent.getFileHandle(parts.at(-1)!);
      return [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
    };
    return { source: await read(source), destination: await read(destination) };
  }, { source: sourcePath, destination: copyPath });
  expect(disk.source).toEqual([...original]);
  const decoded = decodeBoard(new Uint8Array(disk.destination));
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) throw new Error(decoded.error.message);
  expect(decoded.value.layout).toBe("vector");
  expect(decoded.value.board).toMatchObject({
    coordType: 0,
    sizeX: 19,
    sizeY: 14,
    sizeL: 8,
    tileMatrix: expect.arrayContaining([1, 2, 6, 12]),
  });
  expect(decoded.value.board.tileMatrix.slice(0, 8)).toEqual([1, 2, 6, 6, 6, 12, 2, 6]);
  expect(decoded.value.board.vectors.length).toBe(32);
  expect(decoded.value.board.vectors[0]).toMatchObject({ type: 2, attributes: 1, closed: -1, points: [{ x: 32, y: 0 }, { x: 352, y: 0 }, { x: 352, y: 32 }, { x: 32, y: 32 }] });
  expect(decoded.value.board.programs).toHaveLength(24);
  expect(decoded.value.board.programs[0]).toMatchObject({ program: "warp00000002.prg", points: [{ x: 512, y: 128 }, { x: 544, y: 128 }, { x: 544, y: 160 }, { x: 512, y: 160 }] });
  expect(decoded.value.board.programs[1]).toMatchObject({ program: "talktored.prg", points: [{ x: 256, y: 128 }, { x: 288, y: 128 }, { x: 288, y: 160 }, { x: 256, y: 160 }] });
  expect(decoded.value.board.sprites).toMatchObject([
    { itemFile: "gem.itm", x: 528, y: 95, layer: 1 },
    { itemFile: "red.itm", x: 80, y: 223, layer: 1 },
  ]);
  expect(decoded.value.board.shadeLayers[0]?.records.slice(0, 5)).toEqual([
    { runCount: 16, r: 0, g: 0, b: 0 },
    { runCount: 1, r: -26, g: -26, b: -26 },
    { runCount: 77, r: 0, g: 0, b: 0 },
    { runCount: 1, r: -26, g: -26, b: -26 },
    { runCount: 171, r: 0, g: 0, b: 0 },
  ]);

  await page.getByRole("tab", { name: copyPath, exact: true }).click();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Close Active Tab/i }).click();
  await expect(page.getByRole("tab", { name: copyPath, exact: true })).toHaveCount(0);
  await page.getByRole("treeitem").filter({ hasText: "red.upgraded.brd" }).dblclick();
  await expect(page.getByRole("tab", { name: copyPath, exact: true })).toBeVisible();
  await page.getByRole("treeitem", { name: "Prg, folder, closed", exact: true }).press("ArrowRight");
  await page.getByRole("treeitem", { name: /^warp00000002\.prg, program editor/ }).dblclick();
  const scriptEditor = page.locator(".monaco-editor");
  const readPathBytes = async (path: string): Promise<number[]> => await page.evaluate(async (filePath) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const parts = filePath.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
  }, path);
  const pathExists = async (path: string): Promise<boolean> => await page.evaluate(async (filePath) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const parts = filePath.split("/");
    let parent = root;
    try {
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      await parent.getFileHandle(parts.at(-1)!);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return false;
      throw error;
    }
  }, path);
  const dismissScriptWriteFailure = async (): Promise<void> => {
    const failure = page.getByRole("dialog").filter({ hasText: "warp00000002.prg" });
    if (await failure.isVisible()) await failure.getByRole("button", { name: "OK", exact: true }).click();
  };
  const scriptBytesBeforeUpgrade = await readPathBytes(scriptPath);
  await page.evaluate((name) => (window as ProofWindow).__tkrDenyFileWrite?.(name), scriptPath.split("/").at(-1)!);
  const assertPendingScript = async (): Promise<void> => {
    await dismissScriptWriteFailure();
    await page.getByRole("tab", { name: scriptPath }).click();
    await dismissScriptWriteFailure();
    await expect(scriptEditor.locator(".view-lines")).toContainText("Pending authored edit");
    await expect(page.locator(".tkr-program-state")).toHaveText("Unsaved changes");
    expect(await readPathBytes(scriptPath)).toEqual(scriptBytesBeforeUpgrade);
    await page.getByRole("tab", { name: copyPath, exact: true }).click();
    await dismissScriptWriteFailure();
  };
  await page.getByRole("tab", { name: copyPath, exact: true }).click();

  const setupButton = page.getByRole("group", { name: "Run" }).getByRole("button", { name: "New run setup" });
  await setupButton.click();
  const setup = page.getByRole("dialog", { name: "New run setup" });
  await setup.getByRole("tab", { name: "Test board", exact: true }).click();
  await expect(setup.getByRole("combobox", { name: "Board", exact: true })).toHaveValue(copyPath);
  await setup.getByRole("spinbutton", { name: "Column", exact: true }).fill("2");
  await setup.getByRole("spinbutton", { name: "Row", exact: true }).fill("2");
  await setup.getByRole("listbox", { name: "Party", exact: true }).selectOption("Game/Example/Chrs/ada.tem");
  await setup.getByRole("button", { name: "Test board", exact: true }).click();
  const runner = page.frameLocator('iframe[title="Running game"]');
  await expect(runner.locator("#screen")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Running game"]');
    const live = (frame?.contentWindow as unknown as { __live?: { board: string | null } } | null)?.__live;
    return live?.board?.toLowerCase() ?? "";
  }), { timeout: 30_000 }).toContain("red.upgraded.brd");
  const run = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Running game"]');
    return (frame?.contentWindow as unknown as { __live?: { player: { x: number; y: number } | null; stateHash: string } } | null)?.__live ?? null;
  });
  expect(run?.player).toEqual({ x: 48, y: 63 });
  expect(run?.stateHash).toMatch(/^[a-f0-9]{16}$/);
  const assertAuthoredChecker = async (): Promise<void> => {
    const visible = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Running game"]');
      const screen = frame?.contentDocument?.querySelector<HTMLCanvasElement>("#screen");
      const gl = screen?.getContext("webgl2");
      if (!screen || !gl) return false;
      const pixels = new Uint8Array(screen.width * screen.height * 4);
      gl.readPixels(0, 0, screen.width, screen.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const color = (x: number, y: number) => {
        const offset = (y * screen.width + x) * 4;
        return `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`;
      };
      for (let scale = 1; scale <= 8; scale *= 2) {
        const side = 8 * scale;
        for (let y = 0; y + side <= screen.height; y += scale) {
          for (let x = 0; x + side <= screen.width; x += scale) {
            const first = color(x, y);
            const second = color(x + scale, y);
            if (first === second) continue;
            let matches = true;
            for (let row = 0; row < 8 && matches; row += 1) {
              for (let column = 0; column < 8; column += 1) {
                if (color(x + column * scale, y + row * scale) !== ((row + column) % 2 === 0 ? first : second)) {
                  matches = false;
                  break;
                }
              }
            }
            if (matches) return true;
          }
        }
      }
      return false;
    });
    expect(visible, "the authored alternating tile pattern must be drawn in the game framebuffer").toBe(true);
  };
  await assertAuthoredChecker();
  await page.getByRole("tab", { name: scriptPath }).click();
  await scriptEditor.locator(".view-line").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("// Pending authored edit; cancellation and copy-write failure must leave it open.\n");
  await expect(scriptEditor.locator(".view-lines")).toContainText("Pending authored edit");
  await expect(page.locator(".tkr-program-state")).toHaveText("Unsaved changes");
  await dismissScriptWriteFailure();
  expect(await readPathBytes(scriptPath)).toEqual(scriptBytesBeforeUpgrade);
  await page.getByRole("tab", { name: copyPath, exact: true }).click();
  await dismissScriptWriteFailure();
  await page.getByRole("button", { name: "Convert tile coordinates…", exact: true }).click();
  const coordinatePreview = page.getByRole("dialog").filter({ hasText: "Convert tile coordinates to pixels" });
  await expect(coordinatePreview).toBeVisible();
  await expect(coordinatePreview).toContainText("script coordinate unit to pixels");
  const cancelledPixelPath = "Game/Example/Boards/red.cancelled.brd";
  await coordinatePreview.getByRole("button", { name: "Choose copy destination…", exact: true }).click();
  const cancelledPixelDialog = page.getByRole("dialog", { name: `Save ${copyPath} as` });
  await expect(cancelledPixelDialog).toBeVisible();
  await cancelledPixelDialog.getByRole("textbox").fill(cancelledPixelPath);
  await cancelledPixelDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("tab", { name: cancelledPixelPath, exact: true })).toHaveCount(0);
  expect(await pathExists(cancelledPixelPath)).toBe(false);
  if (await coordinatePreview.isVisible()) await coordinatePreview.getByRole("button", { name: "Cancel", exact: true }).click();
  await assertPendingScript();
  const reopenCoordinatePreview = async () => {
    if (!await coordinatePreview.isVisible()) {
      await page.getByRole("button", { name: "Convert tile coordinates…", exact: true }).click();
    }
    await expect(coordinatePreview).toBeVisible();
  };
  await reopenCoordinatePreview();
  const failedPixelPath = "Game/Example/Boards/red.failed-write.brd";
  await page.evaluate((name) => (window as ProofWindow).__tkrDenyFileWrite?.(name), failedPixelPath.split("/").at(-1)!);
  await coordinatePreview.getByRole("button", { name: "Choose copy destination…", exact: true }).click();
  const failedPixelDialog = page.getByRole("dialog", { name: `Save ${copyPath} as` });
  await failedPixelDialog.getByRole("textbox").fill(failedPixelPath);
  await failedPixelDialog.getByRole("button", { name: "Save", exact: true }).click();
  const failedWriteNotice = page.getByRole("dialog").filter({ hasText: /Could not write .*red\.failed-write\.brd/ });
  await expect(failedWriteNotice).toBeVisible();
  await expect(failedWriteNotice).toContainText("A destination may remain");
  await expect(failedWriteNotice).toContainText("cannot prove that this write created it");
  await failedWriteNotice.getByRole("button", { name: "OK", exact: true }).click();
  expect(await pathExists(failedPixelPath)).toBe(true);
  expect(await readPathBytes(failedPixelPath)).toEqual([]);
  if (await coordinatePreview.isVisible()) await coordinatePreview.getByRole("button", { name: "Cancel", exact: true }).click();
  await assertPendingScript();
  expect(await readPathBytes(scriptPath)).toEqual(scriptBytesBeforeUpgrade);
  await page.evaluate((name) => (window as ProofWindow).__tkrAllowFileWrite?.(name), scriptPath.split("/").at(-1)!);
  await page.getByRole("tab", { name: scriptPath }).click();
  await page.keyboard.press("Control+S");
  await expect(page.locator(".tkr-program-state")).toHaveText("All changes saved");
  const savedScriptBytes = await readPathBytes(scriptPath);
  expect(new TextDecoder().decode(new Uint8Array(savedScriptBytes))).toContain("Pending authored edit");
  await page.getByRole("tab", { name: copyPath, exact: true }).click();
  await reopenCoordinatePreview();
  await coordinatePreview.getByRole("button", { name: "Choose copy destination…", exact: true }).click();
  const pixelCopyPath = "Game/Example/Boards/red.pixels.brd";
  const pixelSaveDialog = page.getByRole("dialog", { name: `Save ${copyPath} as` });
  await pixelSaveDialog.getByRole("textbox").fill(pixelCopyPath);
  await pixelSaveDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("tab", { name: pixelCopyPath, exact: true })).toBeVisible();

  await expect.poll(async () => {
    try {
      const savedBytes = await page.evaluate(async (path) => {
        const root = (window as ProofWindow).__tkrTestFolder;
        if (!root) throw new Error("The owned browser folder is missing.");
        const parts = path.split("/");
        let parent = root;
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
        return [...new Uint8Array(await (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
      }, pixelCopyPath);
      const saved = decodeBoard(new Uint8Array(savedBytes));
      return saved.ok ? saved.value.board.coordType & 4 : 0;
    } catch {
      return 0;
    }
  }, { timeout: 30_000 }).toBe(4);
  const pixelCopyBytes = await page.evaluate(async (path) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const parts = path.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
    return [...new Uint8Array(await (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
  }, pixelCopyPath);
  const pixels = decodeBoard(new Uint8Array(pixelCopyBytes));
  expect(pixels.ok).toBe(true);
  if (!pixels.ok) throw new Error(pixels.error.message);
  expect(pixels.value.layout).toBe("vector");
  expect(pixels.value.board.coordType & 4).toBe(4);
  expect(pixels.value.board.sizeX).toBe(decoded.value.board.sizeX);

  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: /Close Active Tab/i }).click();
  await expect(page.getByRole("tab", { name: pixelCopyPath, exact: true })).toHaveCount(0);
  await page.getByRole("treeitem").filter({ hasText: "red.pixels.brd" }).dblclick();
  await expect(page.getByRole("tab", { name: pixelCopyPath, exact: true })).toBeVisible();
  await setupButton.click();
  const pixelSetup = page.getByRole("dialog", { name: "New run setup" });
  await pixelSetup.getByRole("tab", { name: "Test board", exact: true }).click();
  await expect(pixelSetup.getByRole("combobox", { name: "Board", exact: true })).toHaveValue(pixelCopyPath);
  await pixelSetup.getByRole("spinbutton", { name: "Column", exact: true }).fill("2");
  await pixelSetup.getByRole("spinbutton", { name: "Row", exact: true }).fill("2");
  await pixelSetup.getByRole("listbox", { name: "Party", exact: true }).selectOption("Game/Example/Chrs/ada.tem");
  await pixelSetup.getByRole("button", { name: "Test board", exact: true }).click();
  await expect(runner.locator("#screen")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Running game"]');
    const live = (frame?.contentWindow as unknown as { __live?: { board: string | null } } | null)?.__live;
    return live?.board?.toLowerCase() ?? "";
  }), { timeout: 30_000 }).toContain("red.pixels.brd");
  const pixelRun = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Running game"]');
    return (frame?.contentWindow as unknown as { __live?: { player: { x: number; y: number } | null; stateHash: string } } | null)?.__live ?? null;
  });
  expect(pixelRun?.player).toEqual({ x: 2, y: 2 });
  expect(pixelRun?.stateHash).toMatch(/^[a-f0-9]{16}$/);
  await assertAuthoredChecker();
  const finalFiles = await page.evaluate(async ({ source, upgraded, pixelCopy, script }) => {
    const root = (window as ProofWindow).__tkrTestFolder;
    if (!root) throw new Error("The owned browser folder is missing.");
    const read = async (path: string) => {
      const parts = path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part);
      return [...new Uint8Array(await (await (await parent.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer())];
    };
    return {
      source: await read(source),
      upgraded: await read(upgraded),
      pixelCopy: await read(pixelCopy),
      script: await read(script),
    };
  }, { source: sourcePath, upgraded: copyPath, pixelCopy: pixelCopyPath, script: scriptPath });
  expect(finalFiles.source).toEqual(disk.source);
  expect(finalFiles.upgraded).toEqual(disk.destination);
  expect(finalFiles.pixelCopy).toEqual(pixelCopyBytes);
  expect(finalFiles.script).toEqual(savedScriptBytes);
  await page.getByRole("group", { name: "Run", exact: true }).getByRole("button", { name: "Stop", exact: true }).click();
});
