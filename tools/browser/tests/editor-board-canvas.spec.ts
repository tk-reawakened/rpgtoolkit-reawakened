import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { BinaryReader, readBoard, writeTileBitmap } from "@tk-reawakened/core";
import {
  boardExtent,
  boardToScreen,
  cellCentre,
  clampViewport,
  pixelToCell,
  screenToBoard,
  zoomTo,
  type BoardShape,
  type Cell,
  type Viewport,
} from "@tk-reawakened/editor-model";

// Story 12.10 in the production browser host: the real `host-web` workbench in Chromium, under the page's strict CSP,
// creates a board in each coordinate layout through its own "New board…" dialog, then draws on the real canvas with the
// real mouse, navigates it with the real wheel, hides a layer, undoes and redoes, saves to the project folder, and
// reads the bytes back from the folder. Nothing here is a host shim: the folder is the browser's own origin-private
// file system and the pointer events are the browser's own.

const tileset = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const VIEW = { width: 640, height: 384 };
/**
 * The page that hosts the workbench. This is the proof page `workbench.html`, not yet the shipped `index.html`, which shows
 * settings only (#2355). When the shipped page hosts the shared workbench, point this at its URL.
 */
const WORKBENCH_URL = "/tools/browser/editor-web/workbench.html";

/** A one-cell tile bitmap of the second tile with a red-and-blue-shifting tint: stamping it over that tile changes only the shading. */
const tintStamp = (() => {
  const written = writeTileBitmap({
    magic: "TK3 TILEBITMAP",
    major: 3,
    minor: 0,
    width: 1,
    height: 1,
    cells: [
      { tile: "village.tst2", r: 90, g: 0, b: -60 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(0),
  });
  if (!written.ok) throw new Error(written.error.message);
  return Array.from(written.value);
})();

interface ProofWindow extends Window { __tkrCspViolations?: string[] }

const SYSTEMS = [
  { label: "top-down", value: "2d", coordType: 0 },
  { label: "iso-stacked", value: "iso-stacked", coordType: 1 },
  { label: "iso-rotated", value: "iso-rotated", coordType: 2 },
] as const;

/** A project folder in the browser's origin-private file system, handed to the page as what the folder picker returns. */
async function installFolder(page: Page, files: readonly { readonly path: string; readonly bytes: readonly number[] }[]): Promise<string> {
  const folder = `TkrBoard-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
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
  }, { inputs: files, name: folder });
  return folder;
}

async function readFolderFile(page: Page, folder: string, path: string): Promise<Uint8Array> {
  const bytes = await page.evaluate(async ({ name, file }) => {
    let handle = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    const found = await (await handle.getFileHandle(parts.at(-1)!)).getFile();
    return Array.from(new Uint8Array(await found.arrayBuffer()));
  }, { name: folder, file: path });
  return Uint8Array.from(bytes);
}

const cellButton = (page: Page, cell: Cell, text: string): Locator =>
  page.getByRole("button", { name: `Column ${cell.x + 1}, row ${cell.y + 1}: ${text}`, exact: true });
const tileButtons = (page: Page, tile: string): Locator => page.locator(`.tkr-board-cell[aria-label$=": ${tile}"]`);
const state = (page: Page): Locator => page.locator(".tkr-board-state");

/** Where a board pixel is on the page, given the canvas's box on the page and the editor's viewport. */
function onPage(box: { x: number; y: number; width: number; height: number }, viewport: Viewport, shape: BoardShape, cell: Cell): { x: number; y: number } {
  const centre = cellCentre(shape, cell.x, cell.y);
  const screen = boardToScreen(viewport, centre.x, centre.y);
  return { x: box.x + (screen.x * box.width) / VIEW.width, y: box.y + (screen.y * box.height) / VIEW.height };
}

for (const system of SYSTEMS) {
  test(`production browser workbench, ${system.label} board: real canvas drawing, navigation, layer visibility, undo and redo, saved to the folder`, async ({ page }) => {
    await page.addInitScript(() => {
      window.addEventListener("securitypolicyviolation", (event) => {
        const target = window as ProofWindow;
        (target.__tkrCspViolations ??= []).push(event.effectiveDirective);
      });
    });
    const folder = await installFolder(page, [{ path: "Tiles/village.tst", bytes: tileset }, { path: "Bitmap/tint.tbm", bytes: tintStamp }]);
    await page.goto(WORKBENCH_URL);
    await page.getByRole("button", { name: "Open project folder" }).click();

    // The board is made through the workbench's own dialog.
    await page.getByRole("button", { name: "New board…" }).click();
    const dialog = page.getByRole("dialog", { name: "New board" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill("meadow");
    await dialog.getByLabel("Layout").selectOption(system.value);
    await dialog.getByLabel("Width in tiles").fill("8");
    await dialog.getByLabel("Height in tiles").fill("8");
    await dialog.getByLabel("Layers").fill("2");
    await dialog.getByRole("button", { name: "Create board" }).click();
    await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible();
    await expect(state(page)).toHaveText("All changes saved");

    const shape: BoardShape = { sizeX: 8, sizeY: 8, coordType: system.coordType };
    const extent = boardExtent(shape);
    const centre = pixelToCell(shape, extent.width / 2, extent.height / 2)!;
    const near = (dx: number, dy: number): Cell => ({ x: centre.x + dx, y: centre.y + dy });

    // Choose the second tile as the brush: a selection, not an edit.
    await page.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
    await expect(page.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source')).toHaveAttribute("aria-pressed", "true");
    await expect(state(page)).toHaveText("All changes saved");

    const canvas = page.locator("canvas.tkr-board-canvas");
    await canvas.scrollIntoViewIfNeeded();
    let box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(100);
    let viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: VIEW.width, height: VIEW.height });

    // Navigation first, with the real wheel: Ctrl+wheel zooms a fixed step around the pointer, the wheel scrolls up and
    // down, Shift+wheel across. None of it is an edit.
    const focus = onPage(box, viewport, shape, centre);
    await page.mouse.move(focus.x, focus.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(page.locator(".tkr-board-zoom")).toHaveText("200%");
    viewport = zoomTo(shape, viewport, 3, { x: ((focus.x - box.x) * VIEW.width) / box.width, y: ((focus.y - box.y) * VIEW.height) / box.height });
    await page.mouse.wheel(0, 60);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 40);
    await page.keyboard.up("Shift");
    viewport = clampViewport(shape, { ...viewport, y: viewport.y + 60 / 2 });
    viewport = clampViewport(shape, { ...viewport, x: viewport.x + 40 / 2 });
    await expect(state(page)).toHaveText("All changes saved");
    await expect(page.locator(".tkr-board-save")).toBeDisabled();

    // One click with the real mouse, at the zoomed and scrolled view: the cell painted is the one the layout snaps to.
    const here = screenToBoard(viewport, 0, 0);
    const target = pixelToCell(shape, here.x + VIEW.width / 4 / 1, here.y + VIEW.height / 4 / 1);
    expect(target, "a cell lies a quarter of the way into the zoomed view").not.toBeNull();
    const at = onPage(box, viewport, shape, target!);
    await page.mouse.click(at.x, at.y);
    await expect(state(page)).toHaveText("Unsaved changes");
    await expect(tileButtons(page, "village.tst2")).toHaveCount(1);
    await expect(cellButton(page, target!, "village.tst2")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(tileButtons(page, "village.tst2")).toHaveCount(0);
    await expect(state(page)).toHaveText("All changes saved");

    // Back to 100% (the zoom steps are fixed and the view re-centres the small board), then one drag across the board.
    await page.mouse.move(focus.x, focus.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect(page.locator(".tkr-board-zoom")).toHaveText("100%");
    viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: VIEW.width, height: VIEW.height });
    const probe = boardToScreen(viewport, cellCentre(shape, near(0, 0).x, near(0, 0).y).x, cellCentre(shape, near(0, 0).x, near(0, 0).y).y);
    const pixel = (): Promise<string> => canvas.evaluate((element, point) => {
      const context = (element as HTMLCanvasElement).getContext("2d")!;
      return Array.from(context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).join(",");
    }, probe);
    // The engine's picture is on the canvas: an empty cell is the board's own black, not the editor's grey surround.
    await expect.poll(pixel).toBe("0,0,0,255");
    const emptyPixel = await pixel();
    const from = onPage(box, viewport, shape, near(-2, -1));
    const to = onPage(box, viewport, shape, near(2, 1));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(state(page)).toHaveText("Unsaved changes");
    await expect(cellButton(page, near(-2, -1), "village.tst2")).toBeVisible();
    await expect(cellButton(page, near(2, 1), "village.tst2")).toBeVisible();
    const drawn = await tileButtons(page, "village.tst2").count();
    expect(drawn).toBeGreaterThanOrEqual(5);
    // The pointer left the focus on the canvas, so the real keyboard reaches the board from here.
    await expect(canvas).toBeFocused();
    // The rendered canvas shows it: the drawn cell's pixel is the tile's, not the board's own colour.
    await expect.poll(pixel).not.toBe(emptyPixel);
    const drawnPixel = await pixel();

    // One Undo takes the whole drag back, one Redo puts it back; Ctrl+Z and Ctrl+Shift+Z do the same.
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(tileButtons(page, "village.tst2")).toHaveCount(0);
    await expect.poll(pixel, { message: "the canvas shows the undo" }).toBe(emptyPixel);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(tileButtons(page, "village.tst2")).toHaveCount(drawn);
    await expect.poll(pixel, { message: "the canvas shows the redo" }).toBe(drawnPixel);
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await expect(tileButtons(page, "village.tst2")).toHaveCount(0);
    await expect.poll(pixel).toBe(emptyPixel);
    await page.keyboard.press("Control+Shift+z");
    await expect(tileButtons(page, "village.tst2")).toHaveCount(drawn);
    await expect.poll(pixel).toBe(drawnPixel);

    // Hiding a layer changes the picture and nothing else: the drawn cell's pixel is the board's own, then the tile's.
    const withTile = drawnPixel;
    await page.getByLabel("Layer", { exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Layer 1", { exact: false }).first().uncheck();
    await expect.poll(pixel).not.toBe(withTile);
    await expect(state(page)).toHaveText("Unsaved changes", { timeout: 1_000 });
    await page.getByRole("button", { name: "Show all", exact: true }).click();
    await expect.poll(pixel).toBe(withTile);

    // Save, and read the saved board back from the project folder.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(state(page)).toHaveText("All changes saved");
    const saved = await readFolderFile(page, folder, "Boards/meadow.brd");
    const read = readBoard(new BinaryReader(saved));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.coordType).toBe(system.coordType);
      const painted = read.value.tileMatrix.filter((index) => index !== 0);
      expect(painted.length).toBe(drawn);
      expect(painted.every((index) => read.value.lut[index] === "village.tst2")).toBe(true);
      const layerCells = (read.value.sizeX + (system.coordType === 2 ? read.value.sizeY : 0)) * (read.value.sizeY + (system.coordType === 2 ? read.value.sizeX : 0));
      expect(read.value.tileMatrix.slice(layerCells).every((index) => index === 0), "only layer 1 holds tiles").toBe(true);
    }

    // The Rectangle tool on this layout, with the real mouse: the edge, then Ctrl fills it; Ctrl+Z takes the last one back.
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(page.getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Clicking the buttons above may have scrolled the page: measure the canvas again before pointing at it.
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const cornerA = onPage(box, viewport, shape, near(-3, -2));
    const cornerB = onPage(box, viewport, shape, near(3, 2));
    // The grid shows the current layer (the second, changed above), which holds no tiles yet.
    const base = await tileButtons(page, "village.tst2").count();
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await expect(state(page)).toHaveText("Unsaved changes");
    const edge = await tileButtons(page, "village.tst2").count();
    expect(edge).toBeGreaterThan(base);
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => tileButtons(page, "village.tst2").count()).toBeGreaterThan(edge);
    await page.keyboard.press("Control+z");
    await expect.poll(() => tileButtons(page, "village.tst2").count()).toBe(edge);
    await page.keyboard.press("Control+z");
    await expect.poll(() => tileButtons(page, "village.tst2").count()).toBe(base);
    await expect(state(page)).toHaveText("All changes saved");

    // A stamp that changes only the shading (the tile under it is the stamp's own tile) still redraws the rendered canvas,
    // and so do its Undo and Redo. The picture depends on the shading as well as the tiles.
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const middleOfCell = onPage(box, viewport, shape, centre);
    await page.mouse.click(middleOfCell.x, middleOfCell.y);
    await expect(tileButtons(page, "village.tst2")).toHaveCount(base + 1);
    // Only the second layer is shown, so the pixel under test is that layer's own (the first layer's tile is drawn there too).
    await page.getByLabel("Layer 1", { exact: false }).first().uncheck();
    await expect.poll(pixel).not.toBe(emptyPixel);
    const plainPixel = await pixel();
    await page.locator(".tkr-tileset-browser select").selectOption("Bitmap/tint.tbm");
    await page.locator('[data-browser-reference="tint.tbm"] .tkr-tileset-browser-source').click();
    await expect(page.locator(".tkr-board-brush-state")).toHaveText("Stamp: tint.tbm, 1 × 1 cells");
    // Choosing the source scrolled the page: measure the canvas again before pointing at it.
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const stampAt = onPage(box, viewport, shape, centre);
    await page.mouse.click(stampAt.x, stampAt.y);
    await expect(tileButtons(page, "village.tst2")).toHaveCount(base + 1);
    await expect.poll(pixel, { message: "the canvas shows the tint although no tile changed" }).not.toBe(plainPixel);
    const tintedPixel = await pixel();
    await page.keyboard.press("Control+z");
    await expect.poll(pixel, { message: "the canvas shows the undo of the tint" }).toBe(plainPixel);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(pixel, { message: "the canvas shows the redo of the tint" }).toBe(tintedPixel);
    expect(await page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? [])).toEqual([]);
  });
}
