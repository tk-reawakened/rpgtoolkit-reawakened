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
  const program = await runStructuredAuthoring(page, expect, command, reopenedPane, readBacking);
  await command("Test: Run Example Program");
  const player = await playerFrame(page, expect);
  const drawn = async () => await player.evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string; x?: number; y?: number }> } } } | undefined;
    return session?.engine.drawList().commands.filter((item) => item.kind === "text").map((item) => ({ text: item.text ?? "", x: item.x, y: item.y })) ?? [];
  });
  const output = async () => (await drawn()).map((item) => item.text).join(" ");
  await expect.poll(output, { timeout: 30_000 }).toContain("Native tracer event");
  // The saved program draws where its cards say: font size 16 makes cell (2, 2) the pixel origin (16, 16).
  expect(await drawn()).toEqual(expect.arrayContaining([expect.objectContaining({ text: "Native canvas", x: 16, y: 16 })]));
  const saved = new TextDecoder().decode(await readBacking(VISUAL_EVENTS_PROOF_PATH));
  expect(saved.replaceAll("\r\n", "\n").trimEnd()).toBe(program);
  expect(/(^|[^\r])\n/.test(saved)).toBe(false);
  await player.locator("#screen").press("Enter");
  await expect.poll(output, { timeout: 30_000 }).not.toContain("Native tracer event");
}

/** Structured authoring in the native document: every category, pointer/keyboard/numeric placement, ordering, undo and save. */
async function runStructuredAuthoring(
  page: Page,
  expect: Expect,
  command: (title: string) => Promise<void>,
  pane: Frame,
  readBacking: (path: string) => Promise<Uint8Array>,
): Promise<string> {
  const sourceEditor = page.locator(".monaco-workbench .monaco-editor:visible").last();
  const lines = sourceEditor.locator(".view-lines");
  const card = (name: string) => pane.getByRole("group", { name, exact: true });
  let cardsBeforeMessage = 0;
  const add = async (category: string, template: string): Promise<void> => {
    await pane.getByLabel("Category", { exact: true }).selectOption(category);
    await pane.getByLabel("Command", { exact: true }).selectOption(template);
    await pane.getByLabel("Insert", { exact: true }).selectOption({ index: cardsBeforeMessage + 1 });
    await pane.getByRole("button", { name: "Add command", exact: true }).click();
    cardsBeforeMessage += 1;
  };
  const bodyText = async (): Promise<string> => (await sourceEditor.evaluate((node) => [...node.querySelectorAll<HTMLElement>(".view-lines .view-line")]
    .sort((left, right) => parseFloat(left.style.top) - parseFloat(right.style.top)).map((line) => line.innerText.replace(/\u00a0/g, " ")).join("\n"))).trimEnd();
  const text = bodyText;

  await add("Text", "font-size");
  await add("Text", "text");
  await card("Draw text").getByRole("textbox", { name: "Text", exact: true }).fill("Native canvas");
  await card("Draw text").getByRole("button", { name: "Apply Draw text" }).click();
  await expect(lines).toContainText('text(1, 1, "Native canvas")');

  // Pointer placement over the webview: whole cells, one card edit.
  const canvas = pane.getByRole("group", { name: /^Layout canvas/ });
  const item = canvas.getByRole("button", { name: /^Draw text "Native canvas"/ });
  await item.scrollIntoViewIfNeeded();
  const surface = (await canvas.boundingBox())!;
  const start = (await item.boundingBox())!;
  const cell = (16 / 640) * surface.width;
  await page.mouse.move(start.x + 2, start.y + 2);
  await page.mouse.down();
  await page.mouse.move(start.x + 2 + cell * 1.5, start.y + 2 + cell, { steps: 4 });
  await page.mouse.move(start.x + 2 + cell * 3, start.y + 2 + cell * 2, { steps: 4 });
  await page.mouse.up();
  await expect(lines).toContainText('text(4, 3, "Native canvas")');
  await item.focus();
  await page.keyboard.press("ArrowRight");
  await expect(lines).toContainText('text(5, 3, "Native canvas")');
  await page.keyboard.press("Shift+ArrowDown");
  await expect(lines).toContainText('text(5, 13, "Native canvas")');
  await pane.getByLabel("Placed X").fill("0");
  await pane.getByRole("button", { name: "Apply placement" }).click();
  await expect(pane.getByRole("alert")).toContainText(/X must be at least 1/);
  await expect(lines).toContainText('text(5, 13, "Native canvas")');
  await pane.getByLabel("Placed X").fill("2");
  await pane.getByLabel("Placed Y").fill("2");
  await pane.getByRole("button", { name: "Apply placement" }).click();
  await expect(lines).toContainText('text(2, 2, "Native canvas")');

  // One native undo step per card edit, from the same text document.
  const handwrittenRegion = pane.locator("fieldset").filter({ hasText: "handwritten opaque line" });
  await expect(handwrittenRegion).toHaveCount(1);
  await handwrittenRegion.getByRole("button", { name: "Open in editor", exact: true }).click();
  await expect.poll(() => sourceEditor.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
  await command("Undo");
  await expect(lines).toContainText('text(5, 13, "Native canvas")');
  await command("Redo");
  await expect(lines).toContainText('text(2, 2, "Native canvas")');

  for (const [category, template, legend] of [
    ["Display", "bitmap", "Draw bitmap"], ["Player", "player-stance", "Play player stance"], ["Fight", "fight", "Start a skill fight"],
    ["Control", "condition", "If condition"], ["Items", "give-item", "Give item"], ["Variables", "set-variable", "Set variable"],
    ["Input", "delay", "Delay"], ["Info", "get-gold", "Read gold"],
  ] as const) {
    await add(category, template);
    await expect(card(legend)).toBeVisible();
    await expect(card(legend).getByLabel("Generated code")).not.toBeEmpty();
  }
  // The typed asset input asks the extension host for the project's matching files and stores the folder-relative link.
  await card("Draw bitmap").getByRole("button", { name: "Choose bitmap file" }).click();
  const widget = page.locator(".quick-input-widget");
  await widget.getByRole("option", { name: /window\.png/ }).first().click();
  await expect(widget).toBeHidden();
  await card("Draw bitmap").getByRole("button", { name: "Apply Draw bitmap" }).click();
  await expect(lines).toContainText('bitmap("window.png")');
  for (const legend of ["Draw bitmap", "Play player stance", "Start a skill fight", "Give item"]) {
    await card(legend).getByRole("button", { name: `Remove ${legend}` }).click();
    await expect(card(legend)).toHaveCount(0);
  }
  await card("Set variable").getByRole("spinbutton", { name: "Number" }).fill("25");
  await card("Set variable").getByRole("button", { name: "Apply Set variable" }).click();
  await card("Delay").getByRole("spinbutton", { name: "Seconds" }).fill("0");
  await card("Delay").getByRole("button", { name: "Apply Delay" }).click();
  await pane.getByRole("button", { name: "Move Read gold up" }).click();
  const program = '// native visual event proof\n// handwritten opaque line\nfontsize(16)\ntext(2, 2, "Native canvas")\nif (gold > 10) {\n}\ngold = 25\ngetgp(gold)\ndelay(0)\nmwin("Native tracer event via text")\nwait()\nmwincls()\n// tail opaque block';
  await expect.poll(text).toBe(program);
  // Save from the focused text editor itself, as a person does; the palette command would act on the webview.
  await handwrittenRegion.getByRole("button", { name: "Open in editor", exact: true }).click();
  await expect.poll(() => sourceEditor.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true);
  await page.keyboard.press("ControlOrMeta+S");
  await expect.poll(async () => new TextDecoder().decode(await readBacking(VISUAL_EVENTS_PROOF_PATH)), { timeout: 20_000 }).toBe(`${program.replaceAll("\n", "\r\n")}\r\n`);
  await expect(handwrittenRegion).toContainText("handwritten opaque line");
  return program;
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
