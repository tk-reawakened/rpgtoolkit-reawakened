import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import {
  TILE_BITMAP_MAGIC,
  compositeTileBitmap,
  expandTileToRgba,
  readTileset,
  tileDimensions,
  writeTileBitmap,
  type TileBitmap,
  type TileBitmapCell,
} from "@tk-reawakened/core";

// Story 12.8 in the real browser host, through the shipped editor page: its workbench (files panel, tabs, tile bitmap
// editor and the shared tileset browser) over an origin-private project folder. What the editor's canvas shows is read back from the canvas itself and
// compared with the picture the core compositor makes of the same cells; the layout is read from rendered boxes.

const tileset = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

const cellOf = (tile: string, r = 0, g = 0, b = 0): TileBitmapCell => ({ tile, r, g, b });

/** A bitmap whose drawn cells come from `drawn`; the stored extra column and row hold their own tile, which no edit may disturb. */
function bitmap(width: number, height: number, drawn: (x: number, y: number) => TileBitmapCell): TileBitmap {
  const cells: TileBitmapCell[] = [];
  for (let x = 0; x <= width; x += 1) for (let y = 0; y <= height; y += 1) cells.push(x < width && y < height ? drawn(x, y) : cellOf("pad.gph", 1, 2, 3));
  return { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width, height, cells, residue: Uint8Array.from([7, 7, 7]) };
}

function bytesOf(model: TileBitmap): Uint8Array {
  const written = writeTileBitmap(model);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

/** The picture the core compositor makes of `model` over the committed tileset: the oracle for the canvas. */
function expectedPicture(model: TileBitmap): { readonly width: number; readonly height: number; readonly rgba: Uint8Array } {
  const read = readTileset(tileset, "village.tst");
  if (!read.ok) throw new Error(read.error.message);
  const { width, height } = tileDimensions(read.value.detail);
  const tiles = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
  read.value.tiles.forEach((_, index) => {
    const column = expandTileToRgba(read.value, index);
    if (!column.ok) throw new Error(column.error.message);
    const rgba = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) rgba.set(column.value.subarray((x * height + y) * 4, (x * height + y) * 4 + 4), (y * width + x) * 4);
    tiles.set(`village.tst${index + 1}`, { w: width, h: height, rgba });
  });
  const composed = compositeTileBitmap(model, tiles);
  if (!composed.ok) throw new Error(composed.error.message);
  return { width: composed.value.w, height: composed.value.h, rgba: composed.value.rgba };
}

const HOUSE = bitmap(2, 2, (x, y) => (x === 1 && y === 0 ? cellOf("village.tst2", 10, -20, 30) : cellOf("village.tst1")));
const OTHER = bitmap(3, 1, () => cellOf("village.tst2", 1, 2, 3));

const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

interface ProofWindow extends Window { __tkrTestFolder?: FileSystemDirectoryHandle }

/**
 * The shipped editor page (`tools/browser/editor-web/index.html`) over a seeded origin-private project folder, opened the
 * way a person does it: "Open project folder". Returns once the project's workbench is showing.
 */
async function openWorkbench(page: Page): Promise<void> {
  const files = [
    { path: "Main/example.gam", bytes: validMain },
    { path: "Bitmap/house.tbm", bytes: [...bytesOf(HOUSE)] },
    { path: "Bitmap/other.tbm", bytes: [...bytesOf(OTHER)] },
    { path: "Tiles/village.tst", bytes: [...tileset] },
  ];
  const folderName = `TkrBitmap-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    for (const input of inputs) {
      let parent = root;
      const parts = input.path.split("/");
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
      if ((await file.getFile()).size > 0) continue;
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(input.bytes));
      await writable.close();
    }
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: folderName });
  await page.goto("/tools/browser/editor-web/index.html");
  await page.waitForFunction(() => (window as ProofWindow).__tkrTestFolder !== undefined);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
}

async function openFile(page: Page, folderName: string, fileName: string): Promise<void> {
  const folder = page.getByRole("treeitem", { name: new RegExp(`^${folderName}, folder`) });
  await expect(folder).toBeVisible();
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.dblclick();
  await page.getByRole("treeitem", { name: new RegExp(`^${fileName.replace(".", "\\.")},`) }).dblclick();
}

async function canvasPixels(canvas: Locator): Promise<{ readonly width: number; readonly height: number; readonly data: number[] }> {
  return await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const image = target.getContext("2d")!.getImageData(0, 0, target.width, target.height);
    return { width: target.width, height: target.height, data: Array.from(image.data) };
  });
}

async function expectCanvas(canvas: Locator, expected: { readonly width: number; readonly height: number; readonly rgba: Uint8Array }): Promise<void> {
  await expect.poll(async () => {
    const seen = await canvasPixels(canvas);
    return seen.width === expected.width && seen.height === expected.height && seen.data.join(",") === [...expected.rgba].join(",");
  }, { message: "the canvas shows exactly the pixels the compositor makes of the cells" }).toBe(true);
}

async function readProjectFile(page: Page, path: string): Promise<number[]> {
  return await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path);
}

test("the tile bitmap editor lays its grid out as a grid and paints the compositor's pixels, before and after an edit", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "Bitmap", "house.tbm");
  const editor = page.locator(".tkr-bitmap");
  await expect(editor.locator(".tkr-bitmap-summary")).toContainText("2 × 2 tiles, 64 × 64 pixels");
  const canvas = editor.locator("canvas.tkr-bitmap-canvas");
  await expect(canvas).toBeVisible();
  await expectCanvas(canvas, expectedPicture(HOUSE));

  // The cells are laid out as the grid they are: the second column is to the right on the same line, the second row below.
  const box = async (name: RegExp) => (await editor.getByRole("button", { name }).boundingBox())!;
  const topLeft = await box(/^Column 1, row 1:/);
  const topRight = await box(/^Column 2, row 1:/);
  const bottomLeft = await box(/^Column 1, row 2:/);
  expect(Math.abs(topRight.y - topLeft.y)).toBeLessThan(2);
  expect(topRight.x).toBeGreaterThanOrEqual(topLeft.x + topLeft.width);
  expect(Math.abs(bottomLeft.x - topLeft.x)).toBeLessThan(2);
  expect(bottomLeft.y).toBeGreaterThanOrEqual(topLeft.y + topLeft.height);

  // The grid switch draws lines over the picture and is never an edit.
  const plain = await canvasPixels(canvas);
  await editor.getByLabel("Show grid").check();
  await expect.poll(async () => (await canvasPixels(canvas)).data.join(",") !== plain.data.join(",")).toBe(true);
  const lined = await canvasPixels(canvas);
  expect(lined.data.slice(0, 4).join(",")).not.toBe(plain.data.slice(0, 4).join(","));
  const inside = (5 * 64 + 5) * 4;
  expect(lined.data.slice(inside, inside + 4)).toEqual(plain.data.slice(inside, inside + 4));
  await editor.getByLabel("Show grid").uncheck();
  await expectCanvas(canvas, expectedPicture(HOUSE));
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");

  // Choose tile 2 in the shared browser and draw it on the first cell; the canvas follows, and Save writes the cells.
  await editor.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
  await editor.getByRole("button", { name: "Draw", exact: true }).click();
  await editor.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  const edited = bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? cellOf("village.tst2") : x === 1 && y === 0 ? cellOf("village.tst2", 10, -20, 30) : cellOf("village.tst1")));
  await expectCanvas(canvas, expectedPicture(edited));
  expect(await readProjectFile(page, "Bitmap/house.tbm")).toEqual([...bytesOf(HOUSE)]);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  await expect.poll(() => readProjectFile(page, "Bitmap/house.tbm")).toEqual([...bytesOf(edited)]);
});

test("Edit tile bitmap in the browser opens that very file in its own tab", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "Bitmap", "house.tbm");
  const editor = page.locator(".tkr-bitmap");
  await expect(editor.locator(".tkr-bitmap-summary")).toContainText("2 × 2 tiles");
  await editor.locator(".tkr-tileset-browser select").selectOption("Bitmap/other.tbm");
  const item = editor.locator('[data-browser-reference="other.tbm"]');
  await expect(item).toBeVisible();
  await expect(editor.getByRole("button", { name: "Select stamp brush" })).toBeEnabled();
  await item.getByRole("button", { name: "More actions" }).click();
  await item.getByRole("button", { name: "Edit tile bitmap" }).click();

  // The new tab is the file that was chosen, and it shows that file's cells, not the one that was open.
  await expect(page.getByRole("tab", { name: "Bitmap/other.tbm" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Bitmap/house.tbm" })).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".tkr-bitmap-summary")).toContainText("3 × 1 tiles, 96 × 32 pixels");
  await expect(page.getByRole("button", { name: "Column 3, row 1: village.tst2, shade 1, 2, 3" })).toBeVisible();
  await expectCanvas(page.locator("canvas.tkr-bitmap-canvas"), expectedPicture(OTHER));
});

test("typing a shade into a field and pressing Enter shades that cell, and the canvas and saved file follow", async ({ page }) => {
  await openWorkbench(page);
  await openFile(page, "Bitmap", "house.tbm");
  const editor = page.locator(".tkr-bitmap");
  await expect(editor.locator("canvas.tkr-bitmap-canvas")).toBeVisible();
  await editor.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  await editor.getByLabel("Red", { exact: true }).fill("-255");
  await editor.getByLabel("Red", { exact: true }).press("Enter");
  await expect(editor.getByRole("button", { name: "Column 1, row 1: village.tst1, shade -255, 0, 0" })).toBeVisible();
  const shaded = bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? cellOf("village.tst1", -255, 0, 0) : x === 1 && y === 0 ? cellOf("village.tst2", 10, -20, 30) : cellOf("village.tst1")));
  await expectCanvas(editor.locator("canvas.tkr-bitmap-canvas"), expectedPicture(shaded));
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => readProjectFile(page, "Bitmap/house.tbm")).toEqual([...bytesOf(shaded)]);
});
