import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { bootPublishedPackage } from "@tk-reawakened/editor-vscode-test/package-playback";

type RunnerWindow = Window & { __live?: { readonly board: string | null }; __tkrTestFolder?: FileSystemDirectoryHandle };
type ProjectInput = { readonly path: string; readonly bytes: readonly number[] };

function editorProjectFiles(): ProjectInput[] {
  const files: ProjectInput[] = [{
    path: "Main/example.gam",
    bytes: Array.from(readFileSync(resolve("docs/spec/examples/game/Main/example.gam"))),
  }];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = join(directory, entry.name);
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(sourcePath, path);
      else if (entry.isFile()) files.push({ path, bytes: Array.from(readFileSync(sourcePath)) });
    }
  };
  walk(resolve("docs/spec/examples/game/Game/Example"), "");
  return files;
}

test("the reviewed editor download boots in the real web runner without its source folder", async ({ page }) => {
  const files = editorProjectFiles();
  const folderName = `TkrPackageBoot-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }: { readonly inputs: readonly ProjectInput[]; readonly name: string }) => {
    if (!window.location.pathname.endsWith("/tools/browser/editor-web/index.html")) return;
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      const parts = input.path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    (window as RunnerWindow).__tkrTestFolder = root;
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { inputs: files, name: folderName });

  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as RunnerWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByRole("button", { name: "Package game…", exact: true }).click();
  await page.getByLabel("Release version").fill("1.0.0");
  await page.getByRole("button", { name: "Prepare package", exact: true }).click();
  await expect(page.locator(".tkr-files-package-status")).toContainText("Preflight passed");
  await page.getByLabel("I reviewed the included and excluded files.").check();

  const archiveDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download .+\.tpk$/ }).click();
  const archiveDownload = await archiveDownloadPromise;
  const archiveBytes = readFileSync(await archiveDownload.path());
  const packageName = archiveDownload.suggestedFilename();
  const descriptorDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: `Download ${packageName}.json`, exact: true }).click();
  const descriptorDownload = await descriptorDownloadPromise;
  const descriptorBytes = readFileSync(await descriptorDownload.path());
  await page.evaluate(async (name) => {
    const storage = await navigator.storage.getDirectory();
    await storage.removeEntry(name, { recursive: true });
  }, folderName);
  await expect.poll(() => page.evaluate(async (name) => {
    const storage = await navigator.storage.getDirectory();
    try {
      await storage.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }, folderName)).toBe(false);

  await bootPublishedPackage(page, expect, { archiveName: packageName, archive: archiveBytes, descriptor: descriptorBytes });
  expect(await page.evaluate(() => (window as RunnerWindow).__tkrTestFolder)).toBeUndefined();
  await page.waitForFunction(() => (window as RunnerWindow).__live !== undefined, undefined, { timeout: 45_000 });
  for (let press = 0; press < 6; press += 1) {
    const board = await page.evaluate(() => (window as RunnerWindow).__live?.board);
    if (board === "boards/start.brd") break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  await expect.poll(() => page.evaluate(() => (window as RunnerWindow).__live?.board), { timeout: 20_000 }).toBe("boards/village.brd");
});
