import type { expect as playwrightExpect, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;

/** Open a workspace file through native Quick Open, then pin it with VS Code's Keep Editor key chord. */
export async function openNativeQuickOpenFile(page: Page, expect: Expect, path: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+p");
  const widget = page.locator(".quick-input-widget");
  const input = widget.locator("input:visible");
  await expect(input).toHaveCount(1);
  await input.fill(path);
  const focused = widget.locator(".quick-input-list .monaco-list-row.focused");
  await expect(focused, `Quick Open selects the workspace path ${path}`).toBeVisible();
  await expect(focused).toContainText(path.split("/").at(-1)!);
  await input.press("Enter");
  await expect(widget).toBeHidden();

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.press("Enter");
}
