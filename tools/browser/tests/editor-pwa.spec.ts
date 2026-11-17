import { expect, test } from "@playwright/test";

test("without a folder picker the editor explains the session-copy limitation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: undefined });
  });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.locator("#host-status")).toContainText("Open a .gam session copy instead; folder changes will not be saved.");
});
