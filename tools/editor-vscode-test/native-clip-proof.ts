import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
export const NATIVE_CLIP_PROOF_PATH = "Misc/sword-swing.tkranm";

/** Exercise the native text document and visual editor against the same real workspace file. */
export async function runVscodeNativeClipProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>, original: Uint8Array): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const editor = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole("main", { name: "Native animation clip" }).isVisible().catch(() => false)) { found = frame; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The native clip editor did not open");
    return found;
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
  const reopenAs = async (editorName: RegExp): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    const widget = page.locator(".quick-input-widget");
    const input = widget.locator("input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(">reopen editor with");
    await page.getByRole("option", { name: /Reopen Editor With(?:\.\.\.|…)/i }).first().click({ timeout: 10_000 });
    await expect(widget).toBeVisible();
    const option = widget.getByRole("option", { name: editorName });
    await expect(option).toBeVisible();
    await option.click();
    await expect(widget).toBeHidden();
  };
  const textEditor = async () => {
    const result = page.locator(".monaco-workbench .monaco-editor:visible").last();
    await expect(result.locator(".view-lines")).toBeVisible();
    return result;
  };
  const replaceDelayLine = async (current: string, replacement: string): Promise<void> => {
    const source = await textEditor();
    await source.click();
    await page.keyboard.press("ControlOrMeta+f");
    const find = page.getByRole("textbox", { name: "Find", exact: true });
    await expect(find).toBeVisible();
    await find.fill(current);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.keyboard.type(replacement);
    await expect(source.locator(".view-lines")).toContainText(replacement);
  };

  await openNativeQuickOpenFile(page, expect, NATIVE_CLIP_PROOF_PATH);
  await expect((await editor()).getByLabel("Delay (seconds)")).toHaveValue("0.08");

  // Open the same URI in VS Code's built-in text editor and alter the YAML through Monaco input.
  await reopenAs(/^Text Editor(?:,|$)/);
  const before = new TextDecoder().decode(original);
  await expect((await textEditor()).locator(".view-lines")).toContainText("delay: 0.08");
  await replaceDelayLine("delay: 0.08", "delay: 0.25");
  await reopenAs(/^RPG Toolkit Native Animation Clip(?:,|$)/);
  await expect((await editor()).getByLabel("Delay (seconds)")).toHaveValue("0.25");

  // A visual edit is a VS Code text edit, so it must appear in the native text buffer.
  const clip = await editor();
  await clip.getByLabel("Delay (seconds)").fill("0.5");
  await clip.getByRole("button", { name: "Apply delay", exact: true }).click();
  await reopenAs(/^Text Editor(?:,|$)/);
  await expect((await textEditor()).locator(".view-lines")).toContainText("delay: 0.5");

  // The workbench's actual Undo/Redo commands must reverse and reapply that visual text edit.
  await command("Undo");
  await expect((await textEditor()).locator(".view-lines")).toContainText("delay: 0.25");
  await command("Redo");
  await expect((await textEditor()).locator(".view-lines")).toContainText("delay: 0.5");
  await reopenAs(/^RPG Toolkit Native Animation Clip(?:,|$)/);
  await expect((await editor()).getByLabel("Delay (seconds)")).toHaveValue("0.5");
  await command("File: Save");
  await expect.poll(() => readBacking(NATIVE_CLIP_PROOF_PATH)).toEqual(new TextEncoder().encode(before.replace("delay: 0.08", "delay: 0.5")));

  // An invalid in-memory YAML buffer is surfaced by the visual editor; it is repaired in the
  // native text editor before Save, then the visual editor must recover from that same document.
  await reopenAs(/^Text Editor(?:,|$)/);
  await replaceDelayLine("delay: 0.5", "delay: -1");
  await reopenAs(/^RPG Toolkit Native Animation Clip(?:,|$)/);
  const invalidClip = await editor();
  await expect(invalidClip.getByRole("status")).toContainText("The native clip source is invalid. The visual editor is read-only until the clip is valid.");
  await reopenAs(/^Text Editor(?:,|$)/);
  await replaceDelayLine("delay: -1", "delay: 0.25");
  await reopenAs(/^RPG Toolkit Native Animation Clip(?:,|$)/);
  const recoveredClip = await editor();
  await expect(recoveredClip.getByLabel("Delay (seconds)")).toHaveValue("0.25");

  const expected = new TextEncoder().encode(before.replace("delay: 0.08", "delay: 0.25"));
  await command("File: Save");
  await expect.poll(() => readBacking(NATIVE_CLIP_PROOF_PATH)).toEqual(expected);
  await command("View: Close Editor");
  await expect(page.getByRole("tab").filter({ hasText: "sword-swing.tkranm" })).toHaveCount(0);
  await openNativeQuickOpenFile(page, expect, NATIVE_CLIP_PROOF_PATH);
  const screenshot = process.env.TKR_VSCODE_NATIVE_CLIP_SCREENSHOT;
  if (screenshot !== undefined) await page.screenshot({ path: screenshot });
  await expect((await editor()).getByLabel("Delay (seconds)")).toHaveValue("0.25");
  await expect.poll(() => readBacking(NATIVE_CLIP_PROOF_PATH)).toEqual(expected);
  await command("View: Close Editor");
  await expect(page.getByRole("tab").filter({ hasText: "sword-swing.tkranm" })).toHaveCount(0);
  await openNativeQuickOpenFile(page, expect, "Misc/invalid-utf8.tkranm");
  await expect(page.getByRole("tab").filter({ hasText: "invalid-utf8.tkranm" })).toBeVisible();
  const invalidBytes = await editor();
  await expect(invalidBytes.getByText(/contains invalid UTF-8 bytes/)).toBeVisible();
  await expect(invalidBytes.getByLabel("Delay (seconds)")).toHaveCount(0);
  await expect.poll(() => readBacking("Misc/invalid-utf8.tkranm")).toEqual(new Uint8Array([...original, 10, 35, 32, 255, 10]));
  await command("View: Close Editor");
  await expect(page.getByRole("tab").filter({ hasText: "invalid-utf8.tkranm" })).toHaveCount(0);
}
