import type { expect as playwrightExpect, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;

/** Open and pin the exact workspace URI through the probe's native vscode.open command, without requiring a file-search provider. */
export async function openNativeQuickOpenFile(page: Page, expect: Expect, path: string): Promise<void> {
  const widget = page.locator(".quick-input-widget");
  const input = widget.locator("input:visible");
  // The workbench can swallow the chord for a moment while it is still settling after a click or an editor switch; press
  // again rather than guessing a delay, and fail only when it never opens.
  for (let attempt = 1; ; attempt += 1) {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    try {
      await expect(input).toHaveCount(1, { timeout: 2000 });
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
    }
  }
  await input.fill(">Test: Open Proof Project File");
  const command = page.getByRole("option", { name: /^Test: Open Proof Project File(?:,|$)/ });
  await expect(command).toHaveCount(1);
  await command.click();
  await expect(widget).toContainText("Workspace-relative proof file path");
  await input.fill(path);
  await input.press("Enter");
  await expect(widget).toBeHidden();
}
