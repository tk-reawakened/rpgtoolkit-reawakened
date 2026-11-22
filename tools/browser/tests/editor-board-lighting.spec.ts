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
  await panel.getByLabel("Light 1 Centre X (pixels)").fill("96");
  await panel.getByLabel("Light 1 Centre X (pixels)").blur();
  await expect(panel.getByLabel("Light 1 Centre X (pixels)")).toHaveValue("96");
  await panel.getByRole("button", { name: "Convert Light 1 to shading" }).click();
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
    const unnamed = await panel.locator("button, input, select").evaluateAll((elements) => elements.filter((element) => {
      const label = element.getAttribute("aria-label") ?? (element as HTMLInputElement).labels?.[0]?.textContent ?? element.textContent ?? "";
      return label.trim() === "";
    }).length);
    expect(unnamed, `${name}: every control is named`).toBe(0);
    await panel.screenshot({ path: test.info().outputPath(`lighting-panel-${name}.png`) });
  }
});
