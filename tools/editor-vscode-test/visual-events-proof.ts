import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
export const VISUAL_EVENTS_PROOF_PATH = "Game/Example/Prg/start.prg";

/** Prove the native pane edits and opens the existing TextDocument without changing opaque source. */
export async function runVscodeVisualEventsProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  readBacking: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const widget = page.locator(".quick-input-widget");
  const palette = widget.locator("input:visible");
  const command = async (title: string): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(palette).toHaveCount(1);
    await palette.fill(`>${title}`);
    await widget.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) }).click();
    await expect(widget).toBeHidden();
  };
  await openNativeQuickOpenFile(page, expect, VISUAL_EVENTS_PROOF_PATH);
  const sourceTab = page.getByRole("tab").filter({ hasText: "start.prg" });
  await expect(sourceTab).toBeVisible();
  const programEditor = page.locator(".monaco-workbench .monaco-editor:visible").last();
  const text = programEditor.locator(".view-lines");
  await expect(text).toContainText("handwritten opaque line");
  await command("RPG Toolkit: Show Visual events");
  const pane = await paneFrame(page, expect);
  await expect(pane.getByRole("heading", { name: "Visual events", exact: true })).toBeVisible();
  await expect(pane.getByText("handwritten opaque line", { exact: false })).toBeVisible();
  await pane.getByRole("button", { name: "Add Show message", exact: true }).click();
  const message = pane.getByRole("textbox", { name: "Message" });
  await expect(message).toHaveValue("Welcome to the village.");
  await message.fill("Native tracer event");
  await message.press("Enter");
  await expect(pane.getByRole("textbox", { name: "Message" })).toHaveValue("Native tracer event");

  // The opaque block's command must focus the native text editor for this exact URI, not a copy or new document.
  await pane.getByRole("button", { name: "Open in editor", exact: true }).click();
  await expect(sourceTab).toHaveAttribute("aria-selected", "true");
  await expect(text).toContainText("handwritten opaque line");
  await expect(text).toContainText("Native tracer event");
  await expect.poll(() => programEditor.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
  await command("Undo");
  await expect(message).toHaveValue("Welcome to the village.");
  await command("Undo");
  await expect(message).toHaveCount(0);
  await command("Redo");
  await expect(message).toHaveValue("Welcome to the village.");
  await command("Redo");
  await expect(message).toHaveValue("Native tracer event");
  await expect(page.getByRole("tab").filter({ hasText: "start.prg" })).toHaveCount(1);

  const problems = programEditor.locator(".squiggly-error, .squiggly-warning");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type("@");
  await expect(problems.first()).toBeVisible();
  await command("Undo");
  await expect(problems).toHaveCount(0);
  await expect(message).toHaveValue("Native tracer event");

  // A valid edit made in the native text editor must reach the live card, not only a reopened pane.
  const top = process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home";
  const bottom = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
  await page.keyboard.press(top);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.insertText(" via text");
  await expect(text).toContainText('mwin("Native tracer event via text")');
  await expect(pane.getByRole("textbox", { name: "Message" })).toHaveValue("Native tracer event via text");
  await expect(pane.getByRole("textbox", { name: "Message" })).toHaveCount(1);
  await page.keyboard.press(bottom);
  await page.keyboard.insertText("// tail opaque block\n");
  await expect(text).toContainText("tail opaque block");
  await expect(pane.getByText("tail opaque block", { exact: false })).toBeVisible();
  await expect(problems).toHaveCount(0);

  // Open in editor must place the native selection at the exact start of the chosen opaque block (not merely focus the tab).
  const openButtons = pane.getByRole("button", { name: "Open in editor", exact: true });
  await expect(openButtons).toHaveCount(2);
  const cursorAt = (line: number, column: number) => page.locator(".statusbar-item").filter({ hasText: new RegExp(`Ln ${line},\\s*Col ${column}(?!\\d)`) });
  await expect(cursorAt(7, 1)).toBeVisible();
  await openButtons.first().click();
  await expect(cursorAt(1, 1)).toBeVisible();
  await expect.poll(() => programEditor.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
  await openButtons.last().click();
  await expect(cursorAt(6, 1)).toBeVisible();
  await expect.poll(() => programEditor.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
  await expect(text).toContainText('mwin("Native tracer event via text")');
  await expect(page.getByRole("tab").filter({ hasText: "start.prg" })).toHaveCount(1);

  await command("File: Save");
  const expected = "// native visual event proof\r\n// handwritten opaque line\r\nmwin(\"Native tracer event via text\")\r\nwait()\r\nmwincls()\r\n// tail opaque block\r\n";
  await expect.poll(() => readBacking(VISUAL_EVENTS_PROOF_PATH)).toEqual(new TextEncoder().encode(expected));
  const visualTab = page.getByRole("tab", { name: /^Visual events/ });
  await visualTab.hover();
  await visualTab.getByRole("button", { name: /^Close/ }).click();
  await expect(visualTab).toHaveCount(0);
  await expect.poll(() => pane.isDetached()).toBe(true);
  await sourceTab.hover();
  await sourceTab.getByRole("button", { name: /^Close/ }).click();
  await expect(sourceTab).toHaveCount(0);
  await openNativeQuickOpenFile(page, expect, VISUAL_EVENTS_PROOF_PATH);
  const reopenedSourceTab = page.getByRole("tab").filter({ hasText: "start.prg" });
  await expect(reopenedSourceTab).toHaveCount(1);
  await expect(reopenedSourceTab).toBeVisible();
  const reopenedProgramEditor = page.locator(".monaco-workbench .monaco-editor:visible").last();
  await expect(reopenedProgramEditor.locator(".view-lines")).toContainText("handwritten opaque line");
  await expect(reopenedProgramEditor.locator(".view-lines")).toContainText('mwin("Native tracer event via text")');
  await command("RPG Toolkit: Show Visual events");
  const reopenedPane = await paneFrame(page, expect);
  await expect(reopenedPane.getByRole("textbox", { name: "Message" })).toHaveValue("Native tracer event via text");
  await expect(reopenedPane.getByText("handwritten opaque line", { exact: false })).toBeVisible();
  await expect.poll(() => readBacking(VISUAL_EVENTS_PROOF_PATH)).toEqual(new TextEncoder().encode(expected));
  await command("Test: Run Example Program");
  const player = await playerFrame(page, expect);
  const output = async () => await player.evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string }> } } } | undefined;
    return session?.engine.drawList().commands.filter((item) => item.kind === "text").map((item) => item.text ?? "").join(" ") ?? "";
  });
  await expect.poll(output, { timeout: 30_000 }).toContain("Native tracer event");
  await player.locator("#screen").press("Enter");
  await expect.poll(output, { timeout: 30_000 }).not.toContain("Native tracer event");
}

async function paneFrame(page: Page, expect: Expect): Promise<Frame> {
  let result: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.getByRole("region", { name: "Visual events", exact: true }).isVisible().catch(() => false)) {
        result = frame;
        return true;
      }
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  if (result === undefined) throw new Error("VS Code did not render the Visual events pane");
  return result;
}

async function playerFrame(page: Page, expect: Expect): Promise<Frame> {
  let result: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator("#screen").count().catch(() => 0) > 0) {
        result = frame;
        return true;
      }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (result === undefined) throw new Error("The native Test Program command did not open its player frame");
  return result;
}
