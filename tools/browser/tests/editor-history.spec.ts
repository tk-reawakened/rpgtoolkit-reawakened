// The History panel in a real browser (story 11.14, ADR 0022 D12.6/D12.10; #2849): every save is kept in the project's
// .tkr-history folder, and a creator browses, previews, restores and takes the restore back through the page's own controls
// and its real File System Access handles.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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

/**
 * The History panel shares the bottom dock with Run, and a saved layout may leave it hidden. The dock names every hidden
 * panel with its own button, so the panel is asked for by name and the assertion waits for it to be on screen (#2849).
 */
async function showHistory(page: Page): Promise<void> {
  const region = page.getByRole("region", { name: "Document history" });
  const show = page.getByRole("button", { name: "Show History panel" });
  await expect.poll(async () => {
    if (await region.isVisible()) return true;
    if (await show.isVisible()) await show.click();
    return region.isVisible();
  }, { timeout: 30_000 }).toBe(true);
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
  await page.getByLabel("Game in project").selectOption("Main/one.gam");
  await page.getByRole("button", { name: "Open selected game" }).click();
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  const original = await title.inputValue();

  await commitTitle(page, "First saved");
  await page.getByRole("button", { name: "Save all" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await commitTitle(page, "Second saved");
  await page.getByRole("button", { name: "Save all" }).click();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  await showHistory(page);
  const panel = page.getByRole("region", { name: "Document history" });
  await expect(panel.locator("[data-history-location]")).toHaveText(/\.tkr-history folder/);
  const rows = panel.locator("ol[aria-label='History entries'] button");
  await expect(rows.filter({ hasText: "checkpoint" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "saved" })).toHaveCount(2);

  // A saved version opens in the same editor, read-only, and previewing writes nothing.
  await rows.filter({ hasText: "checkpoint" }).click();
  const preview = panel.locator(".tkr-history-preview-editor");
  await expect(preview.getByLabel("Game title")).toHaveValue(original);
  await expect(preview.getByLabel("Game title")).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  // Restore asks first; confirming puts the original back, and the restore itself can be undone.
  await panel.getByRole("button", { name: "Restore this version" }).click();
  await panel.getByRole("button", { name: "Confirm restore" }).click();
  await expect(panel.getByRole("status")).toHaveText(/Restore finished/);
  await expect(title).toHaveValue(original);
  await expect(panel.getByRole("region", { name: "Restore report" })).toContainText("Main/one.gam: restored");
  await panel.getByRole("button", { name: "Undo this restore" }).click();
  await expect(title).toHaveValue("Second saved");
});
