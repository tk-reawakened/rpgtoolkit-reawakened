import type { expect as playwrightExpect, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;

/** Open and pin a workspace file through VS Code's native Quick Open and command palette UI. */
export async function openNativeQuickOpenFile(page: Page, expect: Expect, path: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+p");
  const widget = page.locator(".quick-input-widget");
  const input = widget.locator("input:visible");
  await expect(input).toHaveCount(1);
  await input.fill(path);
  const focused = widget.locator(".quick-input-list .monaco-list-row.focused");
  await expect(focused, `Quick Open selects the workspace path ${path}`).toBeVisible();
  await input.press("Enter");
  await expect(widget).toBeHidden();

  await page.keyboard.press("ControlOrMeta+Shift+P");
  const palette = page.locator(".quick-input-widget input:visible");
  await expect(palette).toHaveCount(1);
  await palette.fill(">Keep Editor");
  const keepEditor = page.getByRole("option", { name: /^Keep Editor(?:,|$)/ });
  await expect(keepEditor, "VS Code offers its native Keep Editor command").toHaveCount(1);
  await palette.press("Enter");
  await expect(widget).toBeHidden();
}
