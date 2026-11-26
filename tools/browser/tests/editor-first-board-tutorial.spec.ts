import { expect, test } from "@playwright/test";

test("editor-web exposes shared first-board help on welcome and workbench and preserves user preferences", async ({ page }) => {
  await page.goto("/tools/browser/editor-web/index.html");

  const helpPanel = page.locator("#first-board-tutorial");
  const tutorial = helpPanel.locator(".tkr-first-board-help");
  const tip = tutorial;
  await expect(tip).toBeVisible();
  await expect(tip.getByLabel("Show a tip when the editor opens")).toBeChecked();
  const shellBounds = await page.locator(".tkr-web-shell").boundingBox();
  const helpBounds = await helpPanel.boundingBox();
  expect(shellBounds).not.toBeNull();
  expect(helpBounds).not.toBeNull();
  expect(shellBounds!.x + shellBounds!.width).toBeLessThanOrEqual(helpBounds!.x + 1);
  await expect(tip.locator("h2")).not.toBeFocused();
  const tipsToggle = tip.getByLabel("Show a tip when the editor opens");
  await tipsToggle.click();
  await expect(tipsToggle).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tkr.setting.editor.showTips"))).toBe("false");
  const newProject = page.getByRole("button", { name: "New project…", exact: true });
  await page.getByRole("button", { name: "Open project folder", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(newProject).toBeFocused();
  await tip.getByRole("button", { name: "Close help" }).click();
  await expect(helpPanel).toBeHidden();
  await expect(newProject, "Closing the automatic tip returns focus to the last used project control").toBeFocused();

  await page.getByRole("button", { name: "First board tutorial", exact: true }).click();
  await expect(tutorial.getByRole("heading", { name: "Step 1 of 9: Create a project" })).toBeVisible();
  await expect(tutorial.locator("h2")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(tutorial.getByRole("button", { name: "Next step" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tutorial.getByRole("heading", { name: "Step 2 of 9: Find Game and Files" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tkr.setting.onboarding.firstBoard.step"))).toBe("2");
  await tutorial.getByRole("button", { name: "Close help" }).click();
  await expect(page.getByRole("button", { name: "First board tutorial", exact: true })).toBeFocused();
  await page.reload();
  await expect(helpPanel).toBeHidden();

  await page.getByRole("button", { name: "Tip of the day", exact: true }).click();
  await expect(tip).toBeVisible();
  await expect(tip.getByLabel("Show a tip when the editor opens")).not.toBeChecked();
  await tip.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "First board tutorial", exact: true }).click();
  await expect(tutorial.getByRole("heading", { name: "Step 2 of 9: Find Game and Files" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Restart tutorial" }).click();
  await expect(tutorial.getByRole("heading", { name: "Step 1 of 9: Create a project" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Close help" }).click();

  await page.locator("#open-session").setInputFiles("docs/spec/examples/game/Main/example.gam");
  await expect(page.getByLabel("Game title")).toBeVisible();
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "First board tutorial" }).click();
  await expect(tutorial.getByRole("heading", { name: "Step 1 of 9: Create a project" })).toBeVisible();
  await expect(tutorial.getByText(/needs a writable project folder/i)).toBeVisible();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const command = async (label: string) => {
    await page.getByRole("button", { name: "Command palette" }).click();
    await palette.getByRole("combobox", { name: "Search commands and files" }).fill(`>${label}`);
    return palette.getByRole("button", { name: `Help ${label}`, exact: true });
  };
  const disabledBack = await command("Previous step");
  await expect(disabledBack).toBeDisabled();
  await palette.getByRole("combobox").press("Escape");
  await (await command("Next step")).click();
  await expect(tutorial.getByRole("heading", { name: "Step 2 of 9: Find Game and Files" })).toBeFocused();
  await (await command("Previous step")).click();
  await expect(tutorial.getByRole("heading", { name: "Step 1 of 9: Create a project" })).toBeVisible();
  await (await command("Next step")).click();
  await expect(tutorial.getByRole("heading", { name: /^Step 2 of 9/ })).toBeVisible();
  await (await command("Restart tutorial")).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tkr.setting.onboarding.firstBoard.step"))).toBe("1");
  await (await command("Close help")).click();
  await expect(helpPanel).toBeHidden();
  await expect(await command("Next step")).toHaveCount(0);
  await palette.getByRole("combobox").press("Escape");

  await (await command("Tip of the day")).click();
  await expect(tip).toBeVisible();
  await expect(tipsToggle).not.toBeChecked();
  await (await command("Show a tip when the editor opens")).click();
  await expect(tipsToggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("tkr.setting.editor.showTips"))).toBe("true");
});

test("editor-web exposes a first-board progress write refusal without advancing", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tkr.setting.onboarding.firstBoard.step") throw new DOMException("Test storage quota", "QuotaExceededError");
      set.call(this, key, value);
    };
  });
  await page.goto("/tools/browser/editor-web/index.html");
  const tutorial = page.locator(".tkr-first-board-help");
  await tutorial.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "First board tutorial" }).click();
  await tutorial.getByRole("button", { name: "Next step" }).click();
  await expect(tutorial.getByRole("alert")).toHaveText(/Could not save your preference/);
  await expect(tutorial.getByRole("heading", { name: /^Step 1 of 9/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tkr.setting.onboarding.firstBoard.step"))).toBeNull();
});

test("editor-web discloses when its first-board preferences are available only until reload", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Test blocked origin storage", "SecurityError"); },
    });
  });
  await page.goto("/tools/browser/editor-web/index.html");
  const panel = page.getByRole("complementary", { name: "First board help" });
  await expect(panel.getByRole("status").filter({ hasText: "last until you close or reload this page" })).toBeVisible();
  await panel.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "First board tutorial" }).click();
  await panel.getByRole("button", { name: "Next step" }).click();
  await expect(panel.getByRole("heading", { name: /^Step 2 of 9/ })).toBeVisible();
  await panel.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "First board tutorial" }).click();
  await expect(panel.getByRole("heading", { name: /^Step 2 of 9/ })).toBeVisible();
  await page.reload();
  await panel.getByRole("button", { name: "Close help" }).click();
  await page.getByRole("button", { name: "First board tutorial" }).click();
  await expect(panel.getByRole("heading", { name: /^Step 1 of 9/ })).toBeVisible();
});
