import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { boardToScreen, cellCentre, clampViewport, type BoardShape, type Cell } from "@tk-reawakened/editor-model";

// Story 13.12 in the shipped browser editor page: the real `host-web` workbench in Chromium paints shading on the real
// canvas with the real mouse and keyboard, adds and moves a light, converts it to shading, undoes the conversion, saves to
// the project folder and reads the bytes back. The folder is the browser's own origin-private file system.

const tileset = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const VIEW = { width: 640, height: 384 };
const EDITOR_URL = "/tools/browser/editor-web/index.html";
const SHAPE: BoardShape = { sizeX: 8, sizeY: 8, coordType: 0 };

async function installFolder(page: Page): Promise<string> {
  const folder = `TkrLight-${randomUUID()}`;
  const inputs = [{ path: "Game/example.gam", bytes: validMain }, { path: "Tiles/village.tst", bytes: tileset }];
  await page.addInitScript(async ({ files, name }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(name, { create: true });
    for (const input of files) {
      const parts = input.path.split("/");
      let parent = root;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await file.getFile()).size > 0) continue;
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
  }, { files: inputs, name: folder });
  return folder;
}

async function readBoardFile(page: Page, folder: string): Promise<ReturnType<typeof readBoard>> {
  const bytes = await page.evaluate(async ({ name }) => {
    const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).getDirectoryHandle("Boards");
    const found = await (await handle.getFileHandle("glow.brd")).getFile();
    return Array.from(new Uint8Array(await found.arrayBuffer()));
  }, { name: folder });
  return readBoard(new BinaryReader(Uint8Array.from(bytes)));
}

async function boardBytes(page: Page, folder: string): Promise<number[]> {
  return page.evaluate(async ({ name }) => {
    const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).getDirectoryHandle("Boards");
    const found = await (await handle.getFileHandle("glow.brd")).getFile();
    return Array.from(new Uint8Array(await found.arrayBuffer()));
  }, { name: folder });
}

/** Hold the board file's exclusive write lock, as another program would, so the next save fails in the browser's own file system. */
async function holdBoardLock(page: Page, folder: string): Promise<void> {
  await page.evaluate(async ({ name }) => {
    const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).getDirectoryHandle("Boards");
    const file = await handle.getFileHandle("glow.brd");
    (window as unknown as { __boardLock: FileSystemWritableFileStream }).__boardLock = await file.createWritable({ mode: "exclusive" } as FileSystemCreateWritableOptions);
  }, { name: folder });
}

async function releaseBoardLock(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const holder = window as unknown as { __boardLock?: FileSystemWritableFileStream };
    await holder.__boardLock?.abort();
    delete holder.__boardLock;
  });
}

const state = (page: Page): Locator => page.locator(".tkr-board-state");
const onPage = (box: { x: number; y: number; width: number; height: number }, cell: Cell): { x: number; y: number } => {
  const viewport = clampViewport(SHAPE, { x: 0, y: 0, zoomIndex: 2, width: VIEW.width, height: VIEW.height });
  const centre = cellCentre(SHAPE, cell.x, cell.y);
  const screen = boardToScreen(viewport, centre.x, centre.y);
  return { x: box.x + (screen.x * box.width) / VIEW.width, y: box.y + (screen.y * box.height) / VIEW.height };
};

test("production browser workbench: paint shading and move a light on the real canvas, convert it, undo, save and reopen the bytes", async ({ page }) => {
  const folder = await installFolder(page);
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("button", { name: "New board…" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await dialog.getByLabel("Name", { exact: true }).fill("glow");
  await dialog.getByLabel("Layout").selectOption("2d");
  await dialog.getByLabel("Width in tiles").fill("8");
  await dialog.getByLabel("Height in tiles").fill("8");
  await dialog.getByLabel("Layers").fill("2");
  await dialog.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible();

  // Give the board some tiles to tint: draw one drag of the second tile.
  await page.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
  const canvas = page.locator("canvas.tkr-board-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const a = onPage(box, { x: 1, y: 1 });
  const b = onPage(box, { x: 6, y: 1 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(state(page)).toHaveText("Unsaved changes");

  const panel = page.locator(".tkr-board-lighting");
  await expect(panel.getByText("Lights and shading")).toBeVisible();

  // Shading on the canvas: one drag is one edit.
  await panel.getByRole("button", { name: "Paint shading on the board" }).click();
  await canvas.scrollIntoViewIfNeeded();
  const box2 = (await canvas.boundingBox())!;
  const shadeFrom = onPage(box2, { x: 1, y: 3 });
  const shadeTo = onPage(box2, { x: 4, y: 3 });
  await page.mouse.move(shadeFrom.x, shadeFrom.y);
  await page.mouse.down();
  await page.mouse.move(shadeTo.x, shadeTo.y, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const shaded = await readBoardFile(page, folder);
  expect(shaded.ok).toBe(true);
  if (shaded.ok) {
    expect(shaded.value.shadeLayers).toHaveLength(1);
    expect(shaded.value.lights).toHaveLength(0);
  }

  // A light by the numbers, then dragged on the canvas, then converted and the conversion undone.
  await panel.getByRole("button", { name: "Move lights on the board" }).click();
  await panel.getByRole("button", { name: "Add spotlight" }).click();
  await expect(panel.getByLabel("Light 1 type")).toBeVisible();
  // The panel is disabled while an edit is applied; a late re-render between fill and blur would reset the field, so wait for idle and retry the whole edit.
  const centreX = panel.getByLabel("Light 1 Centre X (pixels)");
  await expect(async () => {
    await expect(centreX).toBeEnabled();
    await centreX.fill("96");
    await centreX.blur();
    await expect(centreX).toHaveValue("96", { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await panel.getByRole("button", { name: "Convert Light 1 to shading…" }).click();
  await panel.getByRole("button", { name: "Apply conversion of Light 1 to shading" }).click();
  await expect(panel.getByLabel("Light 1 type")).toHaveCount(0);
  await page.getByRole("toolbar", { name: "Board view" }).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(panel.getByLabel("Light 1 type")).toBeVisible();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const lit = await readBoardFile(page, folder);
  expect(lit.ok).toBe(true);
  if (lit.ok) {
    expect(lit.value.lights).toHaveLength(1);
    expect(lit.value.lights[0]?.nodes[1]).toEqual({ x: 96, y: 128 });
    expect(lit.value.shadeLayers).toHaveLength(1);
  }
});

test("production browser workbench: Convert reviews before baking, Cancel changes no byte, Apply is one undo, and a failed save keeps the conversion", async ({ page }) => {
  const folder = await installFolder(page);
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("button", { name: "New board…" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await dialog.getByLabel("Name", { exact: true }).fill("glow");
  await dialog.getByLabel("Layout").selectOption("2d");
  await dialog.getByLabel("Width in tiles").fill("8");
  await dialog.getByLabel("Height in tiles").fill("8");
  await dialog.getByLabel("Layers").fill("2");
  await dialog.getByRole("button", { name: "Create board" }).click();
  const panel = page.locator(".tkr-board-lighting");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Add spotlight" }).click();
  const centreX = panel.getByLabel("Light 1 Centre X (pixels)");
  await expect(async () => {
    await expect(centreX).toBeEnabled();
    await centreX.fill("96");
    await centreX.blur();
    await expect(centreX).toHaveValue("96", { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const saved = await boardBytes(page, folder);
  const before = await readBoardFile(page, folder);
  expect(before.ok).toBe(true);
  const light = before.ok ? before.value.lights[0] : undefined;
  expect(light?.nodes[1]).toEqual({ x: 96, y: 128 });
  const undo = page.getByRole("toolbar", { name: "Board view" }).getByRole("button", { name: "Undo", exact: true });
  const convert = panel.getByRole("button", { name: "Convert Light 1 to shading…" });
  const review = panel.getByRole("group", { name: "Convert Light 1 to shading?" });

  // Choosing Convert only shows the review: the board is not dirty, the light's fields pause, focus is on Cancel.
  await convert.focus();
  await page.keyboard.press("Enter");
  await expect(review).toBeVisible();
  await expect(review).toContainText(/adds shade to \d+ of the 64 shade cells/);
  await expect(review.locator("canvas.tkr-board-light-preview")).toBeVisible();
  await expect(state(page)).toHaveText("All changes saved");
  await expect(centreX).toBeDisabled();
  await expect(review.getByRole("button", { name: "Cancel converting Light 1" })).toBeFocused();

  // Escape cancels, with focus back on Convert and the document untouched.
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(convert).toBeFocused();
  await expect(state(page)).toHaveText("All changes saved");
  await expect(centreX).toBeEnabled();
  await expect(centreX).toHaveValue("96");

  // Escape while the native disclosure is closed does not dismiss the hidden review. Cancel then keeps the saved bytes.
  await convert.click();
  await expect(review).toBeVisible();
  const disclosure = panel.locator(":scope > summary");
  await disclosure.click();
  await expect(review).toBeHidden();
  await page.keyboard.press("Escape");
  await disclosure.click();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Cancel converting Light 1" }).click();
  await expect(review).toHaveCount(0);
  await expect(state(page)).toHaveText("All changes saved");
  expect(await boardBytes(page, folder)).toEqual(saved);
  const afterCancel = await readBoardFile(page, folder);
  expect(afterCancel.ok && afterCancel.value.lights).toEqual(before.ok && before.value.lights);
  expect(afterCancel.ok && afterCancel.value.shadeLayers).toEqual(before.ok && before.value.shadeLayers);
  await expect(panel.getByLabel("Light 1 type")).toHaveValue("0");

  // Escape claims the review from wherever focus is: with focus off the review (on the page itself) it still closes it.
  await convert.click();
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: "Cancel converting Light 1" })).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await expect(state(page)).toHaveText("All changes saved");

  // A region path is pending on the canvas. Enter on the review's Cancel button belongs to the button, not to the board's
  // "finish the path" shortcut, so nothing is stored; the pending path is still the board's afterwards.
  await page.locator('[data-board-mode="vectors"]').click();
  const canvas = page.locator("canvas.tkr-board-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  for (const cellAt of [{ x: 1, y: 1 }, { x: 5, y: 1 }]) {
    const at = onPage(box, cellAt);
    await page.mouse.click(at.x, at.y);
  }
  await convert.click();
  await expect(review).toBeVisible();
  await expect(review.getByRole("button", { name: "Cancel converting Light 1" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(review).toHaveCount(0);
  await expect(state(page)).toHaveText("All changes saved");
  expect(await boardBytes(page, folder)).toEqual(saved);
  await expect(convert).toBeFocused();
  await page.locator('[data-board-mode="tiles"]').click();

  // Apply bakes: the light is gone and the board is unsaved. A save the file system refuses keeps all of it.
  await convert.click();
  await review.getByRole("button", { name: "Apply conversion of Light 1 to shading" }).click();
  await expect(review).toHaveCount(0);
  await expect(panel.getByLabel("Light 1 type")).toHaveCount(0);
  await expect(state(page)).toHaveText("Unsaved changes");
  await holdBoardLock(page, folder);
  try {
    await page.getByRole("button", { name: "Save active editor", exact: true }).click();
    await expect(page.locator(".tkr-board-error[role=alert]")).toBeVisible();
    await expect(state(page)).toHaveText("Unsaved changes");
    await expect(panel.getByLabel("Light 1 type")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeEnabled();
    expect(await boardBytes(page, folder)).toEqual(saved);
  } finally {
    await releaseBoardLock(page);
  }
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const baked = await readBoardFile(page, folder);
  expect(baked.ok).toBe(true);
  if (baked.ok) {
    expect(baked.value.lights).toHaveLength(0);
    expect(baked.value.shadeLayers).toHaveLength(1);
  }

  // One undo brings back exactly the light that was reviewed.
  await undo.click();
  await expect(panel.getByLabel("Light 1 type")).toBeVisible();
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const restored = await readBoardFile(page, folder);
  expect(restored.ok && restored.value.lights).toEqual(before.ok && before.value.lights);
});

test("production browser workbench: the lights and shading panel works by keyboard, narrow, in light and high-contrast themes", async ({ page }) => {
  await installFolder(page);
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("button", { name: "New board…" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await dialog.getByLabel("Name", { exact: true }).fill("glow");
  await dialog.getByLabel("Width in tiles").fill("8");
  await dialog.getByLabel("Height in tiles").fill("8");
  await dialog.getByLabel("Layers").fill("2");
  await dialog.getByRole("button", { name: "Create board" }).click();
  const panel = page.locator(".tkr-board-lighting");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Paint shading on the board" }).click();

  // The cell grid is the keyboard way in: arrow to a cell, Space shades it, one edit.
  const cell = page.getByRole("button", { name: /^Column 1, row 1:/ });
  await cell.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(state(page)).toHaveText("Unsaved changes");

  // The Convert review is part of the panel the layout checks below cover.
  await panel.getByRole("button", { name: "Add spotlight" }).click();
  await panel.getByRole("button", { name: "Convert Light 1 to shading…" }).click();
  await expect(panel.getByRole("group", { name: "Convert Light 1 to shading?" })).toBeVisible();

  for (const [name, setup] of [
    ["narrow-dark", async () => { await page.setViewportSize({ width: 420, height: 800 }); }],
    ["narrow-light", async () => { await page.emulateMedia({ colorScheme: "light" }); }],
    ["narrow-high-contrast", async () => { await page.emulateMedia({ forcedColors: "active" }); }],
  ] as const) {
    await setup();
    await panel.scrollIntoViewIfNeeded();
    // No sideways scrolling inside the panel, and every control keeps an accessible name.
    const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, `${name}: the panel has no horizontal overflow`).toBeLessThanOrEqual(1);
    await expect(panel.getByRole("button", { name: "Apply conversion of Light 1 to shading" })).toBeVisible();
    const unnamed = await panel.locator("button, input, select").evaluateAll((elements) => elements.filter((element) => {
      const label = element.getAttribute("aria-label") ?? (element as HTMLInputElement).labels?.[0]?.textContent ?? element.textContent ?? "";
      return label.trim() === "";
    }).length);
    expect(unnamed, `${name}: every control is named`).toBe(0);
    await panel.screenshot({ path: test.info().outputPath(`lighting-panel-${name}.png`) });
  }
});
