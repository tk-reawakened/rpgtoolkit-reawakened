import type { expect as playwrightExpect, Frame, Locator, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";
import { runSkinAuthoringProof, SKIN_PROOF_PATH } from "./skin-proof.ts";

type Expect = typeof playwrightExpect;

/** The native skin scenario in the real VS Code workbench: the custom editor, the workbench's own Undo, Redo, Save and quick pick. */
export async function runVscodeSkinProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  host: { readBacking(path: string): Promise<Uint8Array>; withBackingWriteRefused(path: string, check: () => Promise<void>): Promise<void> },
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const skinName = SKIN_PROOF_PATH.split("/").at(-1)!;
  const tab = page.getByRole("tab").filter({ hasText: skinName });
  const frameLocator = async (): Promise<Locator> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole("main", { name: "Native skin authoring" }).isVisible().catch(() => false)) { found = frame; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The native skin editor did not open");
    return found.getByRole("main", { name: "Native skin authoring" });
  };
  const command = async (title: string): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    const widget = page.locator(".quick-input-widget");
    const input = widget.locator("input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    await page.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) }).click();
    await expect(widget).toBeHidden();
  };
  const screenshots = process.env.TKR_VSCODE_SKIN_SCREENSHOT_DIR;

  await runSkinAuthoringProof({
    expect,
    open: async () => {
      await openNativeQuickOpenFile(page, expect, SKIN_PROOF_PATH);
      return await frameLocator();
    },
    close: async () => {
      await command("View: Close Editor");
      await expect(tab).toHaveCount(0);
    },
    choose: async (view, role, file, decline = false) => {
      await view.getByRole("button", { name: `Choose ${role} graphic image…`, exact: true }).click();
      const widget = page.locator(".quick-input-widget");
      await expect(widget).toBeVisible();
      await widget.getByRole("option", { name: new RegExp(`^${file.replace(".", "\\.")}(?:,|$)`) }).click();
      // The workbench asks "Use it?" in its own modal dialog; Cancel brings the file list back, and Escape leaves it.
      const dialog = page.locator(".monaco-dialog-box");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(`Use ${file} for the skin's ${role} graphic?`);
      if (decline) {
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toBeHidden();
        // The same pick list comes back, open and taking input (not the closing copy of the one just answered).
        const reopened = page.locator(".quick-input-widget:not(.quick-input-widget-closing):not([inert])");
        await expect(reopened.getByRole("option", { name: new RegExp(`^${file.replace(".", "\\.")}(?:,|$)`) })).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await dialog.getByRole("button", { name: "Use it", exact: true }).click();
        await expect(dialog).toBeHidden();
      }
      await expect(widget).toBeHidden();
    },
    undo: () => command("Undo"),
    redo: () => command("Redo"),
    save: () => command("File: Save"),
    expectRefusalShown: async () => {
      await expect(page.locator(".notifications-toasts, .notification-toast, .monaco-dialog-box").getByText(/permission|denied|EACCES|could not|failed/i).first()).toBeVisible({ timeout: 15_000 });
    },
    expectDirty: async (dirty) => {
      if (dirty) await expect(tab.first()).toHaveClass(/dirty/);
      else await expect(tab.first()).not.toHaveClass(/dirty/);
    },
    read: (path) => host.readBacking(path),
    refuseSkinWrites: (check) => host.withBackingWriteRefused(SKIN_PROOF_PATH, check),
    screenshot: async (name) => { if (screenshots !== undefined) await page.screenshot({ path: `${screenshots}/${name}.png` }); },
  });
}
