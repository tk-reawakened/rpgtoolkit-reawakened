// The browser host's document lifecycle in a real browser (story 11.3, ADR 0022 D3): undo and redo by editId, save all,
// a cancelled close, revert, and a change another program made on disk. The shared conformance suite
// (tools/editor-vscode-test/test/host-conformance.test.ts) runs every case against this host's code; this lane proves the
// same behaviours through the page's own controls and its real File System Access handles.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

/** Type and apply a title as one document edit. */
async function commitTitle(page: Page, title: ReturnType<Page["getByLabel"]>, text: string): Promise<void> {
  await title.click();
  await title.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await page.getByRole("button", { name: "Apply changes" }).click();
}

test("the browser host undoes by editId, saves all, cancels a close, reverts, and never saves over a change on disk", async ({ page }) => {
  const folder = `TkrLifecycle-${randomUUID()}`;
  await page.addInitScript(async ({ bytes, folderName }: { readonly bytes: readonly number[]; readonly folderName: string }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(folderName, { create: true });
    for (const name of ["Main/one.gam", "Main/two.gam"]) {
      const parts = name.split("/");
      const main = await root.getDirectoryHandle(parts[0]!, { create: true });
      const file = await main.getFileHandle(parts[1]!, { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { bytes: validMain, folderName: folder });

  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  // Two games: the page asks which one.
  await page.getByLabel("Game in project").selectOption("Main/one.gam");
  await page.getByRole("button", { name: "Open selected game" }).click();
  const title = page.getByLabel("Game title");
  await expect(title).toBeVisible();
  const opened = await title.inputValue();

  // Apply commits the staged title as one command.
  // Undo and redo by editId through the host's toolbar.
  await commitTitle(page, title, "First");
  await commitTitle(page, title, "Second");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(title).toHaveValue("First");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(title).toHaveValue(opened);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(title).toHaveValue("First");

  // Save all writes what is dirty, and each document reports on its own.
  await page.getByRole("button", { name: "Save all" }).click();
  await expect(page.locator("#host-status")).toContainText("Saved Main/one.gam.");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  // Revert returns to the file on disk; backing out of it first keeps the work.
  await commitTitle(page, title, "Not yet");
  await page.getByRole("button", { name: "Revert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(title).toHaveValue("Not yet");
  await page.getByRole("button", { name: "Revert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revert", exact: true }).click();
  await expect(title).toHaveValue("First");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await expect(page.locator("#host-status")).toContainText("Reverted Main/one.gam to the version on disk.");

  // A cancelled close keeps the view and its work; Don't save closes it.
  await commitTitle(page, title, "Close me");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(title).toHaveValue("Close me");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Don't save" }).click();
  await expect(page.getByRole("toolbar", { name: "Document" })).toBeHidden();

  // Another program changes the file; the editor finds it when saving and never writes over it.
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByLabel("Game in project").selectOption("Main/two.gam");
  await page.getByRole("button", { name: "Open selected game" }).click();
  await expect(page.locator("#host-status")).toContainText("Main/two.gam");
  await expect(title).toBeVisible();
  await expect(page.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await commitTitle(page, title, "Mine");
  await expect(page.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  const outside = await page.evaluate(async ({ bytes, folderName }: { readonly bytes: readonly number[]; readonly folderName: string }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folderName);
    const main = await root.getDirectoryHandle("Main");
    const file = await main.getFileHandle("two.gam");
    const current = new Uint8Array(await (await file.getFile()).arrayBuffer());
    // Change the title through the same layout the editor reads: two NUL-terminated strings follow the 20-byte header run.
    const end = (from: number) => { let at = from; while (current[at] !== 0) at += 1; return at; };
    const start = end(end(20) + 1) + 1;
    const title = new TextEncoder().encode("Theirs");
    const next = new Uint8Array([...current.subarray(0, start), ...title, ...current.subarray(end(start))]);
    const writable = await file.createWritable();
    await writable.write(next);
    await writable.close();
    const written = new Uint8Array(await (await file.getFile()).arrayBuffer());
    return written.length !== 0 && (written.length !== current.length || written.some((byte, index) => byte !== current[index]));
  }, { bytes: validMain, folderName: folder });
  expect(outside).toBe(true);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = page.getByRole("group", { name: "Changed on disk" });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Mine");
  await expect(conflict).toContainText("Theirs");
  await expect(page.getByLabel("Game title")).toHaveValue("Mine");
  await conflict.getByRole("button", { name: "Use the version on disk" }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Theirs");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
});
