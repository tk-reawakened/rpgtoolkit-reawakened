import type { expect as playwrightExpect, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;
const END_OF_TEXT = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

/** Exercise contributed help and insertion commands against VS Code's active native TextDocument. */
export async function runVscodeContextualHelpProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();

  const runPaletteCommand = async (title: string): Promise<void> => {
    await page.keyboard.press("F1");
    const input = page.locator(".quick-input-widget input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    const command = page.getByRole("option", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:,|$)`) });
    await expect(command, `the native palette lists ${title}`).toBeVisible();
    await input.press("Enter");
  };

  await runPaletteCommand("Test: Open Proof Project File");
  await expect(page.getByText("Workspace-relative proof file path", { exact: false })).toBeVisible();
  const pathInput = page.locator(".quick-input-widget input:visible");
  await expect(pathInput).toBeVisible();
  await pathInput.fill("Game/Example/Prg/start.prg");
  await expect(pathInput).toHaveValue("Game/Example/Prg/start.prg");
  await pathInput.press("Enter");

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
  const quickPick = page.locator(".quick-input-widget input:visible");
  await expect(quickPick).toBeVisible();
  await quickPick.fill("castint");
  const entry = page.getByRole("option", { name: /castint\(val, \[&dest\]\)/ });
  await expect(entry, "the native quick reference offers the documented castint syntax").toBeVisible();
  await quickPick.press("Enter");

  await expect.poll(async () => (await lines.innerText()).replace(/\u00a0/g, " ")).toContain("castint(val)");
  await expect.poll(editorHasFocus).toBe(true);
  expect(await openTabs.count(), "insertion edits the existing native program tab").toBe(tabCount);
  await expect(tab).toBeVisible();

  for (const title of ["RPG Toolkit: Open RPGCode authoring guide", "RPG Toolkit: What's New"]) {
    await page.keyboard.press("F1");
    const input = page.locator(".quick-input-widget input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    await expect(page.getByRole("option", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:,|$)`) }),
      `the native palette exposes ${title}`).toBeVisible();
    await input.press("Escape");
    await expect.poll(editorHasFocus).toBe(true);
  }
}
