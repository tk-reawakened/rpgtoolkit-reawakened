// The History panel in a real browser (story 11.14, ADR 0022 D12.6/D12.10; #2849): every save is kept in the project's
// .tkr-history folder, and a creator browses, previews, restores and takes the restore back through the page's own controls
// and its real File System Access handles.
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

async function commitTitle(page: Page, text: string): Promise<void> {
  const title = page.getByLabel("Game title");
  await title.click();
  await title.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Apply changes" }).click();
}
async function saveAllThroughApplicationMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Save All Open Documents" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
}

/**
 * The History panel shares the bottom dock with Run, and a saved layout may leave it hidden. The dock names every hidden
 * panel with its own button, so the panel is asked for by name and the assertion waits for it to be on screen (#2849).
 */
async function showHistory(page: Page): Promise<void> {
  const region = page.getByRole("region", { name: "Document history" });
  const show = page.getByRole("button", { name: "Show History panel" });
  if (await show.isVisible()) await show.click();
  await expect(region).toBeVisible();
}
async function readStoredHistory(page: Page, folderName: string): Promise<readonly { path: string; reason: string; savedAt: number; sha256: string; bytes: number[] }[]> {
  return page.evaluate(async (name) => {
    const storage = await navigator.storage.getDirectory();
    const project = await storage.getDirectoryHandle(name);
    const history = await project.getDirectoryHandle(".tkr-history");
    const entries = await history.getDirectoryHandle("entries");
    const blobs = await history.getDirectoryHandle("blobs");
    const stored: { path: string; reason: string; savedAt: number; sha256: string; bytes: number[] }[] = [];
    for await (const handle of entries.values()) {
      if (handle.kind !== "file") throw new Error("The history entries directory unexpectedly contains a folder");
      const file = await handle.getFile();
      const entry = JSON.parse(await file.text()) as { path: string; reason: string; savedAt: number; sha256: string };
      const blob = await blobs.getFileHandle(entry.sha256);
      stored.push({
        ...entry,
        bytes: Array.from(new Uint8Array(await (await blob.getFile()).arrayBuffer())),
      });
    }
    return stored;
  }, folderName);
}

async function readProjectFile(page: Page, folderName: string, path: string): Promise<number[]> {
  return page.evaluate(async ({ name, filePath }) => {
    const storage = await navigator.storage.getDirectory();
    const project = await storage.getDirectoryHandle(name);
    const parts = filePath.split("/");
    let directory = project;
    for (const segment of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
    const file = await directory.getFileHandle(parts.at(-1)!);
    return Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
  }, { name: folderName, filePath: path });
}

test("history is kept in the project, previews a saved version read-only, restores it and takes the restore back", async ({ page }) => {
  const folder = `TkrHistory-${randomUUID()}`;
  await page.addInitScript(async ({ bytes, folderName }: { readonly bytes: readonly number[]; readonly folderName: string }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(folderName, { create: true });
    const main = await root.getDirectoryHandle("Main", { create: true });
    const file = await main.getFileHandle("one.gam", { create: true });
    const writable = await file.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { bytes: validMain, folderName: folder });

  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  const mainFolder = page.getByRole("treeitem", { name: /^Main,/ });
  await mainFolder.dblclick();
  const gameFile = page.getByRole("treeitem", { name: /^one\.gam/ });
  await expect(gameFile).toBeVisible();
  await gameFile.dblclick();
  const sourceEditor = page.locator(".tkr-editor-area > .tkr-editor");
  const title = sourceEditor.getByLabel("Game title");
  const sourceStatus = sourceEditor.locator(".tkr-settings-state");
  const original = await title.inputValue();

  await commitTitle(page, "First saved");
  await saveAllThroughApplicationMenu(page);
  await commitTitle(page, "Second saved");
  await saveAllThroughApplicationMenu(page);

  await showHistory(page);
  const panel = page.getByRole("region", { name: "Document history" });
  await expect(panel.locator("[data-history-location]")).toHaveText(/\.tkr-history folder/);
  const rows = panel.locator("ol[aria-label='History entries'] button");
  await expect(rows.filter({ hasText: "checkpoint" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "saved" })).toHaveCount(2);
  const stored = await readStoredHistory(page, folder);
  expect(stored).toHaveLength(3);
  expect(stored.map((entry) => entry.reason).sort()).toEqual(["checkpoint", "manual", "manual"]);
  for (const entry of stored) {
    expect(entry.path).toBe("Main/one.gam");
    expect(createHash("sha256").update(new Uint8Array(entry.bytes)).digest("hex")).toBe(entry.sha256);
  }
  const checkpoint = stored.find((entry) => entry.reason === "checkpoint");
  const latestSave = stored.filter((entry) => entry.reason === "manual").sort((a, b) => a.savedAt - b.savedAt).at(-1);
  expect(checkpoint).toBeDefined();
  expect(latestSave).toBeDefined();
  expect(createHash("sha256").update(new Uint8Array(await readProjectFile(page, folder, "Main/one.gam"))).digest("hex")).toBe(latestSave!.sha256);


  // A saved version opens in the same editor, read-only, and previewing writes nothing.
  await rows.filter({ hasText: "checkpoint" }).click();
  const preview = panel.locator(".tkr-history-preview-editor");
  await expect(preview.getByLabel("Game title")).toHaveValue(original);
  await expect(preview.getByLabel("Game title")).toBeDisabled();
  await expect(sourceStatus).toHaveText("All changes saved");
  expect(createHash("sha256").update(new Uint8Array(await readProjectFile(page, folder, "Main/one.gam"))).digest("hex")).toBe(latestSave!.sha256);

  // Restore asks first; confirming puts the original back, and the restore itself can be undone.
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await panel.getByRole("button", { name: "Confirm restore" }).click();
  await expect(page.locator(".tkr-history > p[role='status']")).toHaveText(/Restore finished/);
  await expect(title).toHaveValue(original);
  await expect.poll(async () => createHash("sha256").update(new Uint8Array(await readProjectFile(page, folder, "Main/one.gam"))).digest("hex"), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(checkpoint!.sha256);
  await panel.getByRole("button", { name: "Undo this restore" }).click();
  await expect(title).toHaveValue("Second saved");
  // The model title changes before the async restore reaches storage; only the real saved-byte hash proves completion.
  await expect.poll(async () => createHash("sha256").update(new Uint8Array(await readProjectFile(page, folder, "Main/one.gam"))).digest("hex"), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(latestSave!.sha256);
});
