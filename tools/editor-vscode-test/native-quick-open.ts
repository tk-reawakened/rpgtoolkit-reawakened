import type { expect as playwrightExpect, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;

/** Open and pin the exact workspace URI through the probe's native vscode.open command, without requiring a file-search provider. */
export async function openNativeQuickOpenFile(page: Page, expect: Expect, path: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const widget = page.locator(".quick-input-widget");
  const input = widget.locator("input:visible");
  await expect(input).toHaveCount(1);
  await input.fill(">Test: Open Proof Project File");
  const command = page.getByRole("option", { name: /^Test: Open Proof Project File(?:,|$)/ });
  await expect(command).toHaveCount(1);
  await command.click();
  await expect(widget).toContainText("Workspace-relative proof file path");
  await input.fill(path);
  await input.press("Enter");
  await expect(widget).toBeHidden();
}
