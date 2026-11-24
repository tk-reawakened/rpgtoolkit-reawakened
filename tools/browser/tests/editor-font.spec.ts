import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// Story 13.20 (T-65) in the real browser host, through the shipped editor page: its workbench (files panel, tabs and the
// bitmap font editor) over an origin-private project folder. A glyph is drawn with the real pointer and the real keyboard,
// undone and redone through the application menu, saved and reopened; what the preview canvas shows is read back from the
// canvas itself and compared with the pixels the spec's bitmap rule gives
// (docs/spec/engine/display-input-audio.md#reawakened-bitmap-font-ink), and the file on disk with bytes written by hand
// from the stored layout (docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text).

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

const PATH = "Font/retro.fnt";
const encoder = new TextEncoder();

/** The file's text from the spec's sentences: three header lines, then 2048 values each as ` n `. */
function fontText(rows: (glyph: number, row: number) => number): number[] {
  const lines = ["RPGTLKIT FONT", "2", "0"];
  for (let glyph = 0; glyph < 256; glyph += 1) for (let row = 0; row < 8; row += 1) lines.push(` ${rows(glyph, row)} `);
  return [...encoder.encode(`${lines.join("\r\n")}\r\n`)];
}
/** Glyph 65 has one pixel at the top left; every other glyph is empty. */
const original = (glyph: number, row: number): number => (glyph === 65 && row === 0 ? 0x80 : 0);
const ORIGINAL = fontText(original);

/** The pixels the spec's bitmap rule gives one glyph at `s`, with hard edges; a pixel shared by two source cells is one pixel. */
function specInk(rows: readonly number[], s: number, bold: boolean, italic: boolean): string[] {
  const ink = new Set<string>();
  for (let sy = 0; sy < 8; sy += 1) {
    for (let sx = 0; sx < 8; sx += 1) {
      if (((rows[sy] ?? 0) >> (7 - sx) & 1) === 0) continue;
      const shift = italic ? Math.floor((7 - sy) * s / 32) : 0;
      const left = Math.floor(sx * s / 8);
      const right = Math.max(left + 1, Math.floor((sx + 1) * s / 8));
      const top = Math.floor(sy * s / 8);
      const bottom = Math.max(top + 1, Math.floor((sy + 1) * s / 8));
      for (let y = top; y < bottom; y += 1) {
        for (let x = left + shift; x < right + shift; x += 1) {
          ink.add(`${x},${y}`);
          if (bold) ink.add(`${x + 1},${y}`);
        }
      }
    }
  }
  return [...ink].sort();
}

interface ProofWindow extends Window {
  __tkrTestFolder?: FileSystemDirectoryHandle;
  showDirectoryPicker?: unknown;
}

/** The shipped editor page over a seeded origin-private project folder, opened as a person opens it. */
async function openWorkbench(page: Page): Promise<string> {
  const folderName = `TkrFont-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: [{ path: "Main/example.gam", bytes: validMain }, { path: PATH, bytes: ORIGINAL }], name: folderName });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  return folderName;
}

async function openFont(page: Page): Promise<void> {
  const folder = page.getByRole("treeitem", { name: /^Font, folder/ });
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.dblclick();
  await page.getByRole("treeitem", { name: /^retro\.fnt,/ }).dblclick();
  await expect(page.locator(".tkr-font")).toBeVisible();
}

const editor = (page: Page) => page.locator(".tkr-font");
const state = (page: Page) => editor(page).locator(".tkr-font-state");
const ink = (page: Page): Promise<string> => editor(page).evaluate((element) =>
  [...element.querySelectorAll<HTMLElement>("[data-pixel]")]
    .filter((pixel) => pixel.classList.contains("tkr-font-pixel-on"))
    .map((pixel) => pixel.dataset.pixel)
    .join(" "));

async function readProjectFile(page: Page, path: string): Promise<number[]> {
  return await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path);
}

/** The lit pixels of the preview canvas as `x,y`, with the four-pixel padding taken off, read from the canvas itself. */
async function canvasInk(page: Page): Promise<string[]> {
  return await editor(page).locator("canvas.tkr-font-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const lit: string[] = [];
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const at = (y * canvas.width + x) * 4;
        if (data[at] === 255 && data[at + 1] === 255 && data[at + 2] === 255 && data[at + 3] === 255) lit.push(`${x - 4},${y - 4}`);
      }
    }
    return lit.sort();
  });
}

async function expectCanvas(page: Page, rows: readonly number[], size: number, style: { bold?: boolean; italic?: boolean; underline?: boolean } = {}): Promise<void> {
  const expected = new Set(specInk(rows, size, style.bold ?? false, style.italic ?? false));
  if (style.underline === true) for (let x = 0; x < size + (style.bold === true ? 1 : 0); x += 1) expected.add(`${x},${size - 1}`);
  await expect.poll(async () => (await canvasInk(page)).join(" "), { message: `the preview is the spec's pixels at ${size}px` }).toBe([...expected].sort().join(" "));
}

async function menuCommand(page: Page, name: "Undo" | "Redo"): Promise<void> {
  await page.getByRole("button", { name: "Application menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${name}(?:\\b|$)`) }).click();
}

const pixelBox = async (page: Page, x: number, y: number) => {
  const box = await editor(page).locator(`[data-pixel="${x},${y}"]`).boundingBox();
  if (box === null) throw new Error(`no pixel ${x},${y}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("the bitmap font editor draws a glyph with the pointer and the keyboard, previews it at 8 and 20 pixels, undoes, redoes, saves and reopens", async ({ page }) => {
  await openWorkbench(page);
  await openFont(page);

  // The strip, the selected glyph and the preview of the font as saved.
  await expect(editor(page).locator(".tkr-font-slot")).toHaveCount(256);
  await expect(editor(page).locator(".tkr-font-summary")).toContainText("256 characters, 8 × 8 pixels each; 1 drawn");
  await expect(editor(page).locator(".tkr-font-slot-selected .tkr-font-slot-code")).toHaveText("65");
  expect(await ink(page)).toBe("0,0");
  // One glyph in the sample, so every lit pixel of the canvas is this glyph and can be compared.
  await editor(page).locator(".tkr-font-sample").fill("A");
  await expectCanvas(page, [0x80, 0, 0, 0, 0, 0, 0, 0], 8);

  // Drag across three pixels of the second row with the real pointer: one stroke, previewed as it goes.
  const start = await pixelBox(page, 0, 1);
  const middle = await pixelBox(page, 1, 1);
  const end = await pixelBox(page, 2, 1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(middle.x, middle.y, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  await expect(state(page)).toHaveText("Unsaved changes");
  const rows = [0x80, 0xe0, 0, 0, 0, 0, 0, 0];
  await expectCanvas(page, rows, 8);
  expect(await readProjectFile(page, PATH)).toEqual(ORIGINAL);

  // 20 pixels with bold, then italics and underline: still the same 8 × 8 cells, hard-edged, never antialiased.
  await editor(page).locator(".tkr-font-size").fill("20");
  await expectCanvas(page, rows, 20);
  const styleBox = (label: string) => editor(page).locator(".tkr-font-style", { hasText: label }).locator("input");
  await styleBox("Bold").check();
  await expectCanvas(page, rows, 20, { bold: true });
  await styleBox("Bold").uncheck();
  await styleBox("Italics").check();
  await expectCanvas(page, rows, 20, { italic: true });
  await styleBox("Italics").uncheck();
  await styleBox("Underline").check();
  await expectCanvas(page, rows, 20, { underline: true });
  await styleBox("Underline").uncheck();
  await editor(page).locator(".tkr-font-size").fill("8");
  await expectCanvas(page, rows, 8);
  // The preview is view state: nothing it changed reached the file or the font.
  await expect(state(page)).toHaveText("Unsaved changes", { timeout: 5_000 });

  // The keyboard: the grid's cursor is still on the stroke's last pixel, so go to the first pixel of the first row by key,
  // then walk to the first row's last pixel and press Space.
  await editor(page).locator('[data-pixel="0,0"]').focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await expect.poll(() => editor(page).locator('[data-pixel][tabindex="0"]').getAttribute("data-pixel")).toBe("0,0");
  // Each arrow press re-renders the grid and moves the one tab stop, so wait for the move to be drawn before the next press.
  for (let column = 1; column <= 7; column += 1) {
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => editor(page).locator('[data-pixel][tabindex="0"]').getAttribute("data-pixel")).toBe(`${column},0`);
  }
  await page.keyboard.press("Space");
  await expect.poll(() => ink(page)).toBe("0,0 7,0 0,1 1,1 2,1");
  await expect.poll(() => editor(page).locator('[data-pixel][tabindex="0"]').getAttribute("data-pixel")).toBe("7,0");

  // Undo takes the keyboard edit back, then the stroke, and Redo puts the stroke back.
  await menuCommand(page, "Undo");
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  await menuCommand(page, "Undo");
  await expect.poll(() => ink(page)).toBe("0,0");
  await menuCommand(page, "Redo");
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  // The keyboard's own undo and redo do the same, from the grid.
  await editor(page).locator('[data-pixel="7,0"]').focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => ink(page)).toBe("0,0");
  await page.keyboard.press("Control+y");
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  // The editor's own Undo and Redo buttons are the host's history too.
  await editor(page).locator(".tkr-font-undo").click();
  await expect.poll(() => ink(page)).toBe("0,0");
  await editor(page).locator(".tkr-font-redo").click();
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  // One stack for the panel and the menu: a panel Undo is taken forward by the menu's Redo, and back by the panel's own.
  await editor(page).locator(".tkr-font-undo").click();
  await expect.poll(() => ink(page)).toBe("0,0");
  await menuCommand(page, "Redo");
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  await expect(state(page)).toHaveText("Unsaved changes");

  // Save, and the file holds exactly the edited glyph; every other glyph is the file's own.
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const saved = fontText((glyph, row) => (glyph === 65 ? (row === 0 ? 0x80 : row === 1 ? 0xe0 : 0) : original(glyph, row)));
  await expect.poll(() => readProjectFile(page, PATH)).toEqual(saved);

  // Close and reopen: the saved glyph is shown, an untouched glyph is intact and nothing is dirty.
  await page.getByRole("button", { name: `Close ${PATH}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: PATH, exact: true })).toHaveCount(0);
  await openFont(page);
  await expect.poll(() => ink(page)).toBe("0,0 0,1 1,1 2,1");
  await expect(state(page)).toHaveText("All changes saved");
  await editor(page).locator(".tkr-font-slot").nth(66).click();
  await expect.poll(() => ink(page)).toBe("");
  expect(await readProjectFile(page, PATH)).toEqual(saved);
});

test("New font… makes an empty version 2.0 font in the Font folder, and a cancelled dialog writes nothing", async ({ page }) => {
  await openWorkbench(page);
  const created = "Font/created.fnt";
  await page.getByRole("button", { name: "New font…", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(created);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readProjectFile(page, created).catch(() => null)).toBeNull();
  const unrelated = "Misc/Font/unrelated.fnt";
  await page.getByRole("button", { name: "New font…", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(unrelated);
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("A font for this game goes in Font.");
  expect(await readProjectFile(page, unrelated).catch(() => null)).toBeNull();
  await page.getByRole("dialog").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "New font…", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(created);
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).locator(".tkr-font-summary")).toContainText("0 drawn");
  await expect.poll(() => readProjectFile(page, created)).toEqual(fontText(() => 0));
  expect(await ink(page)).toBe("");
  // The strip still browses all 256 slots of the new font, and a slot with no glyph is named as empty.
  await expect(editor(page).locator(".tkr-font-slot")).toHaveCount(256);
  await expect(editor(page).locator(".tkr-font-slot").nth(7)).toHaveAttribute("aria-label", "Character 7, empty");
  await expect(state(page)).toHaveText("All changes saved");
});
