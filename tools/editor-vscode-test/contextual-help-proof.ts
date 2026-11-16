import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;
const END_OF_TEXT = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

/** Exercise contributed help and insertion commands against VS Code's active native TextDocument. */
export async function runVscodeContextualHelpProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();

  const runPaletteCommand = async (title: string): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+p");
    const input = page.locator(".quick-input-widget input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    const command = page.getByRole("option", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:,|$)`) });
    await expect(command, `the native palette lists ${title}`).toBeVisible();
    await input.press("Enter");
  };
  const openProofProjectFile = async (path: string): Promise<void> => {
    await runPaletteCommand("Test: Open Proof Project File");
    await expect(page.getByText("Workspace-relative proof file path", { exact: false })).toBeVisible();
    const pathInput = page.locator(".quick-input-widget input:visible");
    await expect(pathInput).toBeVisible();
    await pathInput.fill(path);
    await expect(pathInput).toHaveValue(path);
    await pathInput.press("Enter");
  };
  const waitForSettingsFrame = async (): Promise<Frame> => {
    const deadline = Date.now() + 30_000;
    let pause = 100;
    while (Date.now() < deadline) {
      const outer = await page.locator("iframe.webview:visible").first().elementHandle({ timeout: 250 }).catch(() => null);
      const outerFrame = await outer?.contentFrame().catch(() => null);
      const content = outerFrame?.childFrames().find((frame) => frame.name() === "pending-frame");
      if (content !== undefined && await content.locator(".tkr-settings").count().catch(() => 0) > 0) return content;
      await page.waitForTimeout(pause);
      pause = Math.min(pause * 2, 1_000);
    }
    throw new Error("Timed out waiting for the native game settings custom editor");
  };


  await openProofProjectFile("Game/Example/Prg/start.prg");

  const tab = page.getByRole("tab", { name: /start\.prg/ });
  await expect(tab).toBeVisible();
  const editor = page.locator(".monaco-workbench .monaco-editor:visible").last();
  await expect(editor).toBeVisible();
  const lines = editor.locator(".view-lines");
  const editorHasFocus = async () => await editor.evaluate((element) => element.contains(document.activeElement));
  await expect(lines).toContainText("VS CODE FIXTURE PROOF");
  await lines.click();
  await expect.poll(editorHasFocus).toBe(true);
  const openTabs = page.locator(".monaco-workbench .tabs-container .tab");
  const tabCount = await openTabs.count();
  const before = (await lines.innerText()).replace(/\u00a0/g, " ");
  expect(before).not.toContain("castint(val)");

  await page.keyboard.press(END_OF_TEXT);
  await runPaletteCommand("RPG Toolkit: Search and insert an RPGCode command from the quick reference");
  await expect(page.getByText("Insert an RPGCode command", { exact: true })).toBeVisible();
  const quickPick = page.getByRole("textbox", { name: /Type to find a command by name, syntax or description/ });
  await expect(quickPick).toBeVisible();
  await quickPick.fill("castint");
  await expect(quickPick).toHaveValue("castint");
  const entry = page.getByRole("option", { name: /castint\(val, \[&dest\]\)/ });
  await expect(entry, "the native quick reference offers the documented castint syntax").toBeVisible();
  await quickPick.press("Enter");

  await expect.poll(async () => (await lines.innerText()).replace(/\u00a0/g, " ")).toContain("castint(val)");
  await expect.poll(editorHasFocus).toBe(true);
  expect(await openTabs.count(), "insertion edits the existing native program tab").toBe(tabCount);
  await expect(tab).toBeVisible();

  const dirtyTab = page.locator(".monaco-workbench .tabs-container .tab.dirty");
  await expect(dirtyTab, "the reference insertion dirties the active program document").toHaveCount(1);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s");
  await expect(dirtyTab, "save completes before the existing program-run proof").toHaveCount(0);

  const openExternalHelp = async (command: string, path: string): Promise<void> => {
    const openedPage = page.context().waitForEvent("page");
    await runPaletteCommand(command);
    const external = await openedPage;
    await expect.poll(() => external.url()).toContain(path);
    await expect(external.locator("body")).not.toBeEmpty();
    await external.close();
    await expect.poll(editorHasFocus).toBe(true);
  };
  await openExternalHelp(
    "RPG Toolkit: Open RPGCode authoring guide",
    "/tk-reawakened/rpgtoolkit-reawakened/blob/main/docs/spec/engine/rpgcode-tooling.md#tool-10",
  );
  await openExternalHelp(
    "RPG Toolkit: What's New",
    "/tk-reawakened/rpgtoolkit-reawakened/blob/main/CHANGELOG.md",
  );

  await openProofProjectFile("Main/example.gam");
  const settingsFrame = await waitForSettingsFrame();
  const titleField = settingsFrame.getByRole("textbox", { name: "Game title", exact: true });
  await expect(titleField).toBeVisible();
  await titleField.focus();
  await page.keyboard.press("F1");
  const settingsHelp = settingsFrame.getByRole("dialog", { name: "Game title help" });
  await expect(settingsHelp).toBeVisible();
  await expect(settingsHelp).toContainText("Stored in row 7");
  await expect(settingsHelp).toContainText("Read game settings documentation");
  await page.keyboard.press("Escape");
  await expect(titleField).toBeFocused();

  await openProofProjectFile("Game/Example/Prg/start.prg");
  await expect(tab).toBeVisible();
}
