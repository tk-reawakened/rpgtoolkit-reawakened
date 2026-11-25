import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BinaryReader, readBoard, type Board } from "@tk-reawakened/core";
import { boardToScreen, cellCentre, clampViewport, type BoardShape, type Cell } from "@tk-reawakened/editor-model";

// Story 13.13 in the shipped browser editor page: the real `host-web` workbench in Chromium copies, cuts and pastes a
// region of tiles and whole vectors through the browser's real clipboard with the real keyboard, and the saved board file
// read back shows the result. The folder is the browser's own origin-private file system.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const tileset = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const VIEW = { width: 640, height: 384 };
const EDITOR_URL = "/tools/browser/editor-web/index.html";
const SHAPE: BoardShape = { sizeX: 8, sizeY: 8, coordType: 0 };

async function installFolder(page: Page): Promise<string> {
  const folder = `TkrClip-${randomUUID()}`;
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

async function readSaved(page: Page, folder: string): Promise<Board> {
  const bytes = await page.evaluate(async ({ name }) => {
    const handle = await (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).getDirectoryHandle("Boards");
    const found = await (await handle.getFileHandle("clip.brd")).getFile();
    return Array.from(new Uint8Array(await found.arrayBuffer()));
  }, { name: folder });
  const board = readBoard(new BinaryReader(Uint8Array.from(bytes)));
  if (!board.ok) throw new Error(board.error.message);
  return board.value;
}

const state = (page: Page) => page.locator(".tkr-board-state");
const save = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
};
const tilesOf = (board: Board, layer: number): string[] => {
  const cells = board.sizeX * board.sizeY;
  return board.tileMatrix.slice(layer * cells, (layer + 1) * cells).map((index) => board.lut[index] ?? "");
};
const onPage = (box: { x: number; y: number; width: number; height: number }, cell: Cell): { x: number; y: number } => {
  const viewport = clampViewport(SHAPE, { x: 0, y: 0, zoomIndex: 2, width: VIEW.width, height: VIEW.height });
  const centre = cellCentre(SHAPE, cell.x, cell.y);
  const screen = boardToScreen(viewport, centre.x, centre.y);
  return { x: box.x + (screen.x * box.width) / VIEW.width, y: box.y + (screen.y * box.height) / VIEW.height };
};

async function newBoard(page: Page): Promise<string> {
  const folder = await installFolder(page);
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("button", { name: "New board…" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await dialog.getByLabel("Name", { exact: true }).fill("clip");
  await dialog.getByLabel("Layout").selectOption("2d");
  await dialog.getByLabel("Width in tiles").fill("8");
  await dialog.getByLabel("Height in tiles").fill("8");
  await dialog.getByLabel("Layers").fill("2");
  await dialog.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByRole("heading", { name: "Board", exact: true })).toBeVisible();
  return folder;
}

test("production browser workbench: copy a region with the keyboard, paste it on another layer, undo, redo, save and read the bytes back", async ({ page }) => {
  const folder = await newBoard(page);
  await page.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
  const canvas = page.locator("canvas.tkr-board-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const a = onPage(box, { x: 1, y: 1 });
  const b = onPage(box, { x: 5, y: 1 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(state(page)).toHaveText("Unsaved changes");

  // Select all and copy from the keyboard, on the cell grid.
  await page.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await expect(page.locator(".tkr-board-message")).toContainText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const clip = JSON.parse(text) as { format: string; version: number; kind: string; tiles: (string | null)[] };
  expect(clip.format).toBe("tkr-board-clipboard");
  expect(clip.version).toBe(1);
  expect(clip.kind).toBe("region");
  expect(clip.tiles.filter((tile) => tile !== null && tile !== "")).toHaveLength(5);

  // Paste onto layer 2 with the corner on the first cell.
  await page.locator(".tkr-board-layer-row select").selectOption({ index: 1 });
  await page.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  await page.keyboard.press("Control+V");
  await expect(page.locator(".tkr-board-message")).toContainText("Pasted");
  await save(page);
  const pasted = await readSaved(page, folder);
  expect(tilesOf(pasted, 1)).toEqual(tilesOf(pasted, 0));
  expect(tilesOf(pasted, 1).filter((tile) => tile !== "")).toHaveLength(5);

  // One Undo takes the whole paste back and one Redo puts it back; each saved file reads back to match.
  const history = page.getByRole("toolbar", { name: "Board view" });
  await history.getByRole("button", { name: "Undo", exact: true }).click();
  await save(page);
  expect(tilesOf(await readSaved(page, folder), 1).filter((tile) => tile !== "")).toHaveLength(0);
  await history.getByRole("button", { name: "Redo", exact: true }).click();
  await save(page);
  expect(tilesOf(await readSaved(page, folder), 1)).toEqual(tilesOf(pasted, 0));
});

test("production browser workbench: copy, cut and paste whole vectors, with the question before a cut, and refuse a partial set of points", async ({ page }) => {
  const folder = await newBoard(page);
  await page.locator('[data-board-mode="vectors"]').click();
  await page.getByRole("button", { name: "Add vector" }).click();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.locator(".tkr-board-message")).toContainText("Copied 1 vector");
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(page.locator(".tkr-board-message")).toContainText("Pasted 1 vector");
  await save(page);
  const pasted = await readSaved(page, folder);
  expect(pasted.vectors).toHaveLength(2);
  expect(pasted.vectors[1]).toEqual(pasted.vectors[0]);

  // Cutting asks first: Cancel changes nothing, Cut and renumber removes both and Undo brings them back.
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  const question = page.getByRole("dialog", { name: /Cut 2 vectors\?/ });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(state(page)).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Cut", exact: true }).click();
  await page.getByRole("dialog", { name: /Cut 2 vectors\?/ }).getByRole("button", { name: "Cut and renumber" }).click();
  await save(page);
  expect((await readSaved(page, folder)).vectors).toHaveLength(0);
  await page.getByRole("toolbar", { name: "Board view" }).getByRole("button", { name: "Undo", exact: true }).click();
  await save(page);
  expect((await readSaved(page, folder)).vectors).toHaveLength(2);

  // A partial set of points is refused, and the board stays as saved.
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByLabel("Select point 1").check();
  await page.getByRole("button", { name: "Select all points" }).click();
  await page.getByLabel("Select point 1").uncheck();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.locator(".tkr-board-message")).toContainText("partial set of points");
  await expect(state(page)).toHaveText("All changes saved");
});
