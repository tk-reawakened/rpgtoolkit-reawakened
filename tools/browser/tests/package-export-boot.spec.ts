import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";

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
  const descriptor = JSON.parse(descriptorBytes.toString("utf8")) as { file: string; sha256: string; size: number };
  expect(descriptor).toMatchObject({
    file: packageName,
    size: archiveBytes.byteLength,
    sha256: await page.evaluate(async (bytes) => {
      const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }, [...archiveBytes]),
  });

  const archive = Buffer.from(archiveBytes);
  await page.route(`**/${packageName}`, (route) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()["range"] ?? "");
    if (range === null) {
      return route.fulfill({ status: 200, headers: { "accept-ranges": "bytes" }, contentType: "application/octet-stream", body: archive });
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= archive.length || end < start) {
      return route.fulfill({ status: 416, headers: { "content-range": `bytes */${archive.length}` } });
    }
    const last = Math.min(end, archive.length - 1);
    return route.fulfill({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${last}/${archive.length}`,
        "content-length": String(last - start + 1),
      },
      contentType: "application/octet-stream",
      body: archive.subarray(start, last + 1),
    });
  });
  await page.route(`**/${packageName}.json`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: descriptorBytes }));

  await page.goto(`/packages/runner-web/app/index.html?package=${packageName}&mode=whole`);
  await page.waitForFunction(() => (window as RunnerWindow).__live !== undefined, undefined, { timeout: 45_000 });
  for (let press = 0; press < 6; press += 1) {
    const board = await page.evaluate(() => (window as RunnerWindow).__live?.board);
    if (board === "boards/start.brd") break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  await expect.poll(() => page.evaluate(() => (window as RunnerWindow).__live?.board), { timeout: 20_000 }).toBe("boards/village.brd");
});
