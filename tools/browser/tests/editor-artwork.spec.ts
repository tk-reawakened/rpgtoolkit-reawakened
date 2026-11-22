import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { boardToScreen, clampViewport, type Viewport } from "@tk-reawakened/editor-model";
import { BinaryReader, createEmptyBoard, expandTileToRgba, readBoard, readTileset, tilesetDetail, writeBoard, writeTileset } from "@tk-reawakened/core";

type ProofWindow = Window & typeof globalThis & {
  __tkrCspViolations: string[];
  __tkrArtProjectReady: boolean;
  __tkrArtLock: FileSystemWritableFileStream | null;
};
type Rgba = readonly [number, number, number, number];
interface PixelChange { readonly x: number; readonly y: number; readonly rgba: Rgba }
const pink: Rgba = [209, 43, 115, 255];
const green: Rgba = [49, 192, 152, 255];
const blue: Rgba = [32, 176, 224, 255];
type InputFile = { readonly path: string; readonly bytes: readonly number[] };
type PickerSetup = { readonly files: readonly InputFile[]; readonly folderName: string };

const mainBytes = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const artBytes = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const otherBytes = Array.from(artBytes);
const ORIGINAL = readTileset(new Uint8Array(artBytes), "Tiles/art.tst");
if (!ORIGINAL.ok || ORIGINAL.value.version !== 20 || ORIGINAL.value.detail.code !== 1 || ORIGINAL.value.detail.size !== 32) {
  throw new Error("The authored browser fixture must be a real detail-1 32x32 TST.");
}

async function installProject(page: Page, files: readonly InputFile[]): Promise<string> {
  const folderName = `TkrArt-${randomUUID()}`;
  await page.addInitScript(async ({ files: inputs, folderName: name }: PickerSetup) => {
    const proof = window as ProofWindow;
    proof.__tkrCspViolations = [];
    proof.__tkrArtProjectReady = false;
    proof.__tkrArtLock = null;
    window.addEventListener("securitypolicyviolation", (event) => {
      proof.__tkrCspViolations.push(event.effectiveDirective);
    });
    const storage = await navigator.storage.getDirectory();
    let root: FileSystemDirectoryHandle;
    let fresh = false;
    try {
      root = await storage.getDirectoryHandle(name);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
      root = await storage.getDirectoryHandle(name, { create: true });
      fresh = true;
    }
    if (fresh) {
      for (const input of inputs) {
        const parts = input.path.split("/");
        let parent = root;
        for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
        const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
        const writable = await file.createWritable();
        await writable.write(new Uint8Array(input.bytes));
        await writable.close();
      }
    }
    // Only the picker is substituted. Reads, exclusive locks, writes, permissions and handles remain the browser's own.
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    proof.__tkrArtProjectReady = true;
  }, { files, folderName });
  return folderName;
}

async function storedBytes(page: Page, folderName: string, path: string): Promise<number[]> {
  return page.evaluate(async ({ folderName: name, path: filePath }) => {
    const storage = await navigator.storage.getDirectory();
    let dir = await storage.getDirectoryHandle(name);
    const parts = filePath.split("/");
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const file = await dir.getFileHandle(parts.at(-1)!);
    return Array.from(new Uint8Array(await (await file.getFile()).arrayBuffer()));
  }, { folderName, path });
}

function decoded(bytes: readonly number[], path: string): readonly number[] {
  const result = readTileset(new Uint8Array(bytes), path);
  expect(result.ok, `core reader must decode ${path}`).toBe(true);
  if (!result.ok) throw result.error;
  const rgba = expandTileToRgba(result.value, 0);
  expect(rgba.ok).toBe(true);
  if (!rgba.ok) throw rgba.error;
  return Array.from(rgba.value);
}

function rgbaAt(pixels: readonly number[], x: number, y: number, width = 32): readonly number[] {
  const i = (x * width + y) * 4;
  return pixels.slice(i, i + 4);
}

async function canvasPixel(_page: Page, canvas: Locator, x: number, y: number, size = 32): Promise<number[]> {
  return canvas.evaluate((surface, point) => {
    if (!(surface instanceof HTMLCanvasElement)) throw new Error("The actual pixel surface is not a canvas");
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("The actual editor canvas has no 2D context");
    const sx = Math.floor((point.x + 0.5) * surface.width / point.size);
    const sy = Math.floor((point.y + 0.5) * surface.height / point.size);
    return Array.from(ctx.getImageData(sx, sy, 1, 1).data);
  }, { x, y, size });
}

const primary = (page: Page): Locator => page.locator("#settings");
const surface = (root: Locator): Locator => root.getByRole("img", { name: "Pixel canvas" });

async function expectPixel(page: Page, canvas: Locator, x: number, y: number, rgba: readonly number[], size = 32): Promise<void> {
  const visible = rgba[3] === 0 ? [0, 0, 0, 0] : rgba;
  await expect.poll(() => canvasPixel(page, canvas, x, y, size)).toEqual(visible);
}

async function beginStroke(page: Page, canvas: Locator, x: number, y: number, endX = x, endY = y): Promise<{ x: number; y: number }> {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The actual pixel canvas has no bounds");
  await page.mouse.move(box.x + (x + 0.5) * box.width / 32, box.y + (y + 0.5) * box.height / 32);
  await page.mouse.down();
  const end = { x: box.x + (endX + 0.5) * box.width / 32, y: box.y + (endY + 0.5) * box.height / 32 };
  await page.mouse.move(end.x, end.y);
  return end;
}

async function openFile(page: Page, path: string): Promise<void> {
  const parts = path.split("/");
  for (const folder of parts.slice(0, -1)) {
    const row = page.getByRole("treeitem", { name: new RegExp(`^${folder}, folder, (?:closed|open)$`) });
    await expect(row).toBeVisible();
    if (await row.getAttribute("aria-expanded") === "false") await row.press("ArrowRight");
  }
  const item = page.getByRole("treeitem", { name: new RegExp(`^${parts.at(-1)}(?:,|$)`) });
  await item.dblclick();
  await expect(page.getByRole("tab", { name: path, exact: true }).or(
    page.getByRole("tab", { name: `${path}, unsaved changes`, exact: true }),
  )).toHaveAttribute("aria-selected", "true");
}

/** Read the artwork bytes only after the editor acknowledges the save, so a slow flush cannot read the old revision. */
async function savedArtwork(page: Page, folder: string): Promise<number[]> {
  const tab = page.getByRole("tab", { name: /^Tiles\/art\.tst(?:, unsaved changes)?$/ });
  await expect(tab).toHaveAttribute("aria-label", "Tiles/art.tst");
  return storedBytes(page, folder, "Tiles/art.tst");
}

/** Press the artwork editor's save only when its document has edits, so the acknowledgment proves that save wrote them. */
async function saveArtwork(page: Page): Promise<void> {
  await expect(page.getByRole("tab", { name: /^Tiles\/art\.tst(?:, unsaved changes)?$/ })).toHaveAttribute("aria-label", "Tiles/art.tst, unsaved changes");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
}

async function setup(page: Page): Promise<string> {
  const folder = await installProject(page, [
    { path: "Main/example.gam", bytes: mainBytes },
    { path: "Tiles/art.tst", bytes: artBytes },
    { path: "Tiles/other.tst", bytes: otherBytes },
    { path: "Notes/artist.txt", bytes: [97, 114, 116] },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrArtProjectReady)).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await openFile(page, "Tiles/art.tst");
  return folder;
}

function changed(bytes: readonly number[], changes: readonly PixelChange[], tileIndex = 0): number[] {
  const parsed = readTileset(new Uint8Array(bytes));
  if (!parsed.ok || parsed.value.detail.bytesPerPixel !== 3) throw new Error("The independent byte oracle requires an RGB TST");
  const tiles = parsed.value.tiles.map((tile) => ({ pixels: tile.pixels.slice() }));
  for (const change of changes) {
    const at = (change.x * parsed.value.detail.size + change.y) * 3;
    tiles[tileIndex]!.pixels.set(change.rgba[3] === 0 ? [0, 1, 2] : change.rgba.slice(0, 3), at);
  }
  const written = writeTileset({ ...parsed.value, tiles });
  if (!written.ok) throw written.error;
  return Array.from(written.value);
}

/** A display pixel (row-major) of one tile, from the stored column-major bytes. */
function tilePixel(bytes: readonly number[], tileIndex: number, x: number, y: number): number[] {
  const parsed = readTileset(new Uint8Array(bytes));
  if (!parsed.ok) throw parsed.error;
  const rgba = expandTileToRgba(parsed.value, tileIndex);
  if (!rgba.ok) throw rgba.error;
  const at = (x * parsed.value.detail.size + y) * 4;
  return Array.from(rgba.value.slice(at, at + 4));
}

/** A 2 × 2 top-down board whose first cell names tile 2 of `art.tst` and whose last cell is empty. */
function sourceBoard(): number[] {
  const written = writeBoard({
    ...createEmptyBoard(),
    sizeX: 2,
    sizeY: 2,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: ["", "art.tst2"],
    tileMatrix: [1, 0, 1, 1],
    tileRuns: [
      { lutIndex: 1, count: 1, marker: false },
      { lutIndex: 0, count: 1, marker: false },
      { lutIndex: 1, count: 2, marker: true },
    ],
  });
  if (!written.ok) throw written.error;
  return Array.from(written.value);
}

async function writeBacking(page: Page, folder: string, bytes: readonly number[]): Promise<void> {
  await page.evaluate(async ({ folder, bytes }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
    const tiles = await root.getDirectoryHandle("Tiles");
    const file = await tiles.getFileHandle("art.tst");
    const stream = await file.createWritable();
    await stream.write(new Uint8Array(bytes));
    await stream.close();
  }, { folder, bytes });
}

function observeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function assertCleanSurface(page: Page, errors: readonly string[], testInfo: TestInfo): Promise<void> {
  expect(await page.evaluate(() => (window as ProofWindow).__tkrCspViolations)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("editor-artwork.png"), fullPage: true });
}

test("actual browser art gestures stay private until accepted, share history, and preserve stored files", async ({ page }, testInfo) => {
  // Actual input dispatch, independently mounted views, OPFS and reload require browser integration, not a subsecond unit.
  const errors = observeErrors(page);
  const folder = await setup(page);
  const main = primary(page);
  const canvas = surface(main);
  const initial = decoded(artBytes, "Tiles/art.tst");
  const toggleSecondView = async (): Promise<void> => {
    await page.getByRole("button", { name: "Application menu" }).click();
    await page.getByRole("menuitem", { name: "View", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Toggle Split Second View" }).click();
  };
  await toggleSecondView();
  const mirrorRoot = page.locator("#mirror");
  const mirror = surface(mirrorRoot);
  await expect(mirror).toBeVisible();
  await mirrorRoot.getByLabel("Brush color").fill("#2299cc");
  await main.getByLabel("Brush color").fill("#d12b73");

  await beginStroke(page, canvas, 3, 7, 8, 7);
  expect(await canvas.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true);
  await expectPixel(page, canvas, 5, 7, pink);
  await expectPixel(page, mirror, 5, 7, rgbaAt(initial, 5, 7));
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(artBytes);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectPixel(page, canvas, 5, 7, rgbaAt(initial, 5, 7));
  await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeDisabled();

  await beginStroke(page, canvas, 12, 13);
  await expectPixel(page, canvas, 12, 13, pink);
  await page.keyboard.press("Tab");
  expect(await canvas.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(false);
  await page.mouse.up();
  await expectPixel(page, canvas, 12, 13, rgbaAt(initial, 12, 13));
  await expectPixel(page, mirror, 12, 13, rgbaAt(initial, 12, 13));
  await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeDisabled();
  await canvas.scrollIntoViewIfNeeded();

  await beginStroke(page, canvas, 3, 7, 8, 7);
  await page.mouse.up();
  for (const view of [canvas, mirror]) await expectPixel(page, view, 5, 7, pink);
  await expect(mirrorRoot.getByLabel("Brush color")).toHaveValue("#2299cc");
  await page.keyboard.press("ControlOrMeta+z");
  for (const view of [canvas, mirror]) {
    await expectPixel(page, view, 3, 7, rgbaAt(initial, 3, 7));
    await expectPixel(page, view, 8, 7, rgbaAt(initial, 8, 7));
  }
  await page.keyboard.press("ControlOrMeta+Shift+z");
  for (const view of [canvas, mirror]) await expectPixel(page, view, 5, 7, pink);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.press("Shift+Space");
  await expectPixel(page, mirror, 9, 7, rgbaAt(initial, 9, 7));
  await page.keyboard.press("Space");
  await expectPixel(page, mirror, 9, 7, pink);

  // Hit the visible first cell just inside its right edge, including any CSS border in the geometry calculation.
  const edge = await canvas.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const left = parseFloat(style.borderLeftWidth);
    const top = parseFloat(style.borderTopWidth);
    const width = box.width - left - parseFloat(style.borderRightWidth);
    const height = box.height - top - parseFloat(style.borderBottomWidth);
    return { x: box.left + left + width / 32 - 0.1, y: box.top + top + height / 64 };
  });
  await page.mouse.click(edge.x, edge.y);
  await expectPixel(page, mirror, 0, 0, pink);
  await expectPixel(page, mirror, 1, 0, rgbaAt(initial, 1, 0));
  const line: PixelChange[] = Array.from({ length: 6 }, (_, index) => ({ x: index + 3, y: 7, rgba: pink }));
  const accepted = changed(artBytes, [...line, { x: 9, y: 7, rgba: pink }, { x: 0, y: 0, rgba: pink }]);

  await main.getByLabel("Brush color").fill("#31c098");
  await canvas.scrollIntoViewIfNeeded();
  const pointer = await beginStroke(page, canvas, 14, 15);
  // Scrolling under a stationary captured pointer must not paint another part of the tile.
  await page.evaluate(() => window.scrollBy(0, 16));
  await page.mouse.move(pointer.x, pointer.y);
  await expectPixel(page, canvas, 14, 15, green);
  await expect(page.getByRole("tab", { name: /^Tiles\/art\.tst(?:, unsaved changes)?$/ })).toHaveAttribute("aria-label", "Tiles/art.tst, unsaved changes");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => savedArtwork(page, folder)).toEqual(accepted);
  await expectPixel(page, canvas, 14, 15, green);
  await expectPixel(page, mirror, 14, 15, rgbaAt(initial, 14, 15));
  await page.mouse.up();
  await expectPixel(page, mirror, 14, 15, green);
  await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeEnabled();
  await saveArtwork(page);
  const saved = changed(accepted, [{ x: 14, y: 15, rgba: green }]);
  await expect.poll(() => savedArtwork(page, folder)).toEqual(saved);
  await toggleSecondView();
  await expect(mirrorRoot).toBeHidden();
  await toggleSecondView();
  await expect(mirror).toBeVisible();
  await expectPixel(page, mirror, 14, 15, green);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(page, mirror, 14, 15, rgbaAt(initial, 14, 15));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectPixel(page, mirror, 14, 15, green);
  await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeDisabled();

  await openFile(page, "Tiles/other.tst");
  await expectPixel(page, surface(main), 5, 7, rgbaAt(initial, 5, 7));
  expect(await storedBytes(page, folder, "Tiles/other.tst")).toEqual(otherBytes);
  await openFile(page, "Tiles/art.tst");
  await expectPixel(page, surface(main), 14, 15, green);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
  const notes = page.getByRole("treeitem", { name: "Notes, folder, closed", exact: true });
  await notes.press("ArrowRight");
  await page.getByRole("treeitem", { name: "artist.txt, cannot be opened here", exact: true }).dblclick();
  await expect(page.locator(".tkr-files-message")).toContainText("artist.txt");
  await expectPixel(page, surface(main), 14, 15, green);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
  expect(await storedBytes(page, folder, "Main/example.gam")).toEqual(mainBytes);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrArtProjectReady)).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await openFile(page, "Tiles/art.tst");
  await expectPixel(page, surface(main), 14, 15, green);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
  expect(await storedBytes(page, folder, "Main/example.gam")).toEqual(mainBytes);
  expect(await storedBytes(page, folder, "Tiles/other.tst")).toEqual(otherBytes);
  await assertCleanSurface(page, errors, testInfo);
});

test("actual browser art survives exclusive-lock failure, offline saving and reviewed external-file choices", async ({ page }, testInfo) => {
  // These are real browser file-system and input transitions, including a smaller third-party TST; no file port is mocked.
  const errors = observeErrors(page);
  const folder = await setup(page);
  const main = primary(page);
  const canvas = surface(main);
  await main.getByLabel("Brush color").fill("#31c098");
  await beginStroke(page, canvas, 5, 7);
  await page.mouse.up();
  await expectPixel(page, canvas, 5, 7, green);
  await page.evaluate(async (folder) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder);
    const file = await (await root.getDirectoryHandle("Tiles")).getFileHandle("art.tst");
    const options: FileSystemCreateWritableOptions & { mode: "exclusive" } = { keepExistingData: true, mode: "exclusive" };
    (window as ProofWindow).__tkrArtLock = await file.createWritable(options);
  }, folder);
  try {
    await page.getByRole("button", { name: "Save active editor", exact: true }).click();
    await expect(main.locator(".tkr-tileset-art-error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeEnabled();
    await expectPixel(page, canvas, 5, 7, green);
    expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(artBytes);
  } finally {
    await page.evaluate(async () => {
      const proof = window as ProofWindow;
      if (proof.__tkrArtLock === null) throw new Error("The actual exclusive lock was lost");
      await proof.__tkrArtLock.close();
      proof.__tkrArtLock = null;
    });
  }
  await saveArtwork(page);
  let saved = changed(artBytes, [{ x: 5, y: 7, rgba: green }]);
  await expect.poll(() => savedArtwork(page, folder)).toEqual(saved);
  await expect(main.locator(".tkr-tileset-art-error")).toHaveCount(0);

  await page.context().setOffline(true);
  try {
    await main.getByLabel("Brush color").fill("#d12b73");
    await beginStroke(page, canvas, 11, 12);
    await page.mouse.up();
    await expectPixel(page, canvas, 11, 12, pink);
    await saveArtwork(page);
    saved = changed(saved, [{ x: 11, y: 12, rgba: pink }]);
    await expect.poll(() => savedArtwork(page, folder)).toEqual(saved);
    await expect(page.getByRole("button", { name: "Save active editor", exact: true })).toBeDisabled();
  } finally {
    await page.context().setOffline(false);
  }

  await main.getByLabel("Brush color").fill("#20b0e0");
  await beginStroke(page, canvas, 25, 26);
  await page.mouse.up();
  const mine = changed(saved, [{ x: 25, y: 26, rgba: blue }]);
  const external = changed(saved, [{ x: 27, y: 28, rgba: pink }]);
  await writeBacking(page, folder, external);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  const conflict = main.getByRole("group", { name: "Changed on disk" });
  await expect(conflict).toBeVisible();
  await expectPixel(page, canvas, 25, 26, blue);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(external);
  await conflict.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(external);
  await conflict.getByRole("button", { name: "Review conflict" }).click();
  await conflict.getByRole("button", { name: "Save my version", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expect.poll(() => savedArtwork(page, folder)).toEqual(mine);
  await expect(main.locator(".tkr-tileset-art-error")).toHaveCount(0);

  await main.getByLabel("Brush color").fill("#d12b73");
  await beginStroke(page, canvas, 29, 30);
  await page.mouse.up();
  const detail = tilesetDetail(2);
  if (detail === undefined) throw new Error("The authored smaller TST detail is unavailable");
  const smaller = writeTileset({ version: 20, detail, tiles: [{ pixels: new Uint8Array(16 * 16 * 3).fill(16) }], residue: new Uint8Array([0x71]) });
  if (!smaller.ok) throw smaller.error;
  const smallerBytes = Array.from(smaller.value);
  await writeBacking(page, folder, smallerBytes);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Use the version on disk", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expectPixel(page, canvas, 15, 15, [16, 16, 16, 255], 16);
  await canvas.focus();
  await page.keyboard.press("Space");
  await expectPixel(page, canvas, 15, 15, pink, 16);
  await saveArtwork(page);
  const final = changed(smallerBytes, [{ x: 15, y: 15, rgba: pink }]);
  await expect.poll(() => savedArtwork(page, folder)).toEqual(final);
  expect(await storedBytes(page, folder, "Main/example.gam")).toEqual(mainBytes);
  expect(await storedBytes(page, folder, "Tiles/other.tst")).toEqual(otherBytes);
  await assertCleanSurface(page, errors, testInfo);
});

const BOARD_VIEW = { width: 640, height: 384 };
const SOURCE_SHAPE = { sizeX: 2, sizeY: 2, coordType: 0 };
const sourceViewport: Viewport = clampViewport(SOURCE_SHAPE, { x: 0, y: 0, zoomIndex: 2, ...BOARD_VIEW });

/** A pixel of the board's own engine picture, read from the real canvas at the board coordinate. */
async function boardPixel(canvas: Locator, x: number, y: number): Promise<number[]> {
  const screen = boardToScreen(sourceViewport, x, y);
  return canvas.evaluate((element, point) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("The board preview is not a canvas");
    const context = element.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("The board canvas has no 2D context");
    return Array.from(context.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data);
  }, screen);
}

async function toggleSecondView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Application menu" }).click();
  await page.getByRole("menuitem", { name: "View", exact: true }).hover();
  await page.getByRole("menuitem", { name: "Toggle Split Second View" }).click();
}

/** The stored bytes differ in exactly one tile's one pixel; every other stored byte, tile and residue is untouched. */
function expectOneStoredPixelChanged(before: readonly number[], after: readonly number[], tileIndex: number, x: number, y: number, rgba: readonly number[]): void {
  const left = readTileset(new Uint8Array(before));
  const right = readTileset(new Uint8Array(after));
  expect(left.ok && right.ok, "both versions decode as TST").toBe(true);
  if (!left.ok || !right.ok) return;
  expect(right.value.version).toBe(left.value.version);
  expect(right.value.detail.code).toBe(left.value.detail.code);
  expect(right.value.tiles.length).toBe(left.value.tiles.length);
  const { size, bytesPerPixel } = left.value.detail;
  for (let index = 0; index < left.value.tiles.length; index += 1) {
    const beforeTile = left.value.tiles[index]!.pixels;
    const afterTile = right.value.tiles[index]!.pixels;
    expect(afterTile.length, `tile ${index + 1} keeps its size`).toBe(beforeTile.length);
    for (let at = 0; at < beforeTile.length; at += bytesPerPixel) {
      const pixel = at / bytesPerPixel;
      // Stored TST pixels are column-major: index = x * size + y.
      const changedPixel = index === tileIndex && Math.floor(pixel / size) === x && pixel % size === y;
      const wanted = changedPixel ? (rgba[3] === 0 ? [0, 1, 2] : rgba.slice(0, 3)) : Array.from(beforeTile.slice(at, at + bytesPerPixel));
      expect(Array.from(afterTile.slice(at, at + bytesPerPixel)), `tile ${index + 1} pixel ${pixel}`).toEqual(wanted);
    }
  }
  expect(Array.from(right.value.residue)).toEqual(Array.from(left.value.residue));
}

test("a board's browser opens the chosen .tst tile, its asymmetric pixel saves, and painting after the old artwork was previewed shows it", async ({ page }, testInfo) => {
  // The board is the document that owns the working context: its own browser opens the source, the artwork saves through
  // the shared document, and the composed board shows the saved pixel only after the author paints.
  const errors = observeErrors(page);
  const boardBytes = sourceBoard();
  const folder = await installProject(page, [
    { path: "Main/example.gam", bytes: mainBytes },
    { path: "Tiles/art.tst", bytes: artBytes },
    { path: "Tiles/other.tst", bytes: otherBytes },
    { path: "Boards/source.brd", bytes: boardBytes },
    { path: "Boards/other.brd", bytes: boardBytes },
  ]);
  await page.goto("/tools/browser/editor-web/index.html");
  await expect.poll(() => page.evaluate(() => (window as ProofWindow).__tkrArtProjectReady)).toBe(true);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await openFile(page, "Boards/source.brd");

  const boardCanvas = page.locator("canvas.tkr-board-canvas");
  await expect(boardCanvas).toBeVisible();
  await expect(page.locator(".tkr-board-state")).toHaveText("All changes saved");
  const original = tilePixel(artBytes, 1, 3, 7);
  // The composed picture must have replaced the editor's empty background (#1e1e1e) before reference pixels are read.
  await expect.poll(() => boardPixel(boardCanvas, 5, 7)).not.toEqual([30, 30, 30, 255]);
  expect(await boardPixel(boardCanvas, 3, 7)).not.toEqual(blue);
  // A pixel of the same tile that is never painted: its composed colour must not move.
  const unaffected = await boardPixel(boardCanvas, 5, 7);

  // The board's own browser: a non-first row, opened from More actions with the keyboard.
  const browser = page.locator(".tkr-board-browser");
  await browser.locator(".tkr-tileset-browser select").selectOption("Tiles/art.tst");
  const row = browser.locator('[data-browser-reference="art.tst2"]');
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "More actions", exact: true }).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("button", { name: "Edit tile artwork", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Tiles/art.tst", exact: true })).toHaveAttribute("aria-selected", "true");
  const main = primary(page);
  await expect(main.getByLabel("Tile", { exact: true })).toHaveValue("1");
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(artBytes);

  await toggleSecondView(page);
  const mirrorRoot = page.locator("#mirror");
  const mirror = surface(mirrorRoot);
  await expect(mirror).toBeVisible();
  await mirrorRoot.getByLabel("Tile", { exact: true }).selectOption({ label: "2" });
  const canvas = surface(main);
  await main.getByLabel("Brush color").fill("#20b0e0");

  // One asymmetric pixel, undone and redone through the shared document history both views read.
  const tile2Before = tilePixel(artBytes, 1, 2, 7);
  expect(tile2Before).not.toEqual(blue);
  expect(original).not.toEqual(blue);
  await beginStroke(page, canvas, 3, 7);
  await page.mouse.up();
  for (const view of [canvas, mirror]) {
    await expectPixel(page, view, 3, 7, blue);
    await expectPixel(page, view, 2, 7, tile2Before);
  }
  await page.keyboard.press("ControlOrMeta+z");
  for (const view of [canvas, mirror]) await expectPixel(page, view, 3, 7, original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  for (const view of [canvas, mirror]) await expectPixel(page, view, 3, 7, blue);
  await saveArtwork(page);
  const savedArt = changed(artBytes, [{ x: 3, y: 7, rgba: blue }], 1);
  await expect.poll(() => savedArtwork(page, folder)).toEqual(savedArt);
  expectOneStoredPixelChanged(artBytes, savedArt, 1, 3, 7, blue);
  await toggleSecondView(page);
  await expect(mirrorRoot.getByRole("img", { name: "Pixel canvas" })).toHaveCount(0);

  // Back to the same board: its bytes are untouched by the visit and its picture already shows the saved pixel because
  // that artwork had been previewed before the edit.
  await page.getByRole("button", { name: "Return to board", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Boards/source.brd", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(await storedBytes(page, folder, "Boards/source.brd")).toEqual(boardBytes);
  await expect.poll(() => boardPixel(boardCanvas, 3, 7)).toEqual(blue);

  // Choosing the editor brush is still not a board edit.
  await browser.locator('[data-browser-reference="art.tst2"] .tkr-tileset-browser-source').click();
  await expect(page.locator(".tkr-board-brush")).toHaveText("Paint art.tst tile 2 here");
  expect(await storedBytes(page, folder, "Boards/source.brd")).toEqual(boardBytes);

  // Paint the empty cell and save: the intended cell shows the new pixel in the composed picture, and nothing else moved.
  await page.getByRole("button", { name: "Column 2, row 1: empty", exact: true }).click();
  await page.locator(".tkr-board-brush").click();
  await expect(page.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(page.locator(".tkr-board-state")).toHaveText("All changes saved");
  const paintedBoard = await storedBytes(page, folder, "Boards/source.brd");
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(savedArt);
  expect(await storedBytes(page, folder, "Tiles/other.tst")).toEqual(otherBytes);
  expect(await storedBytes(page, folder, "Main/example.gam")).toEqual(mainBytes);
  expect(await storedBytes(page, folder, "Boards/other.brd")).toEqual(boardBytes);
  const boardAfter = readBoard(new BinaryReader(new Uint8Array(paintedBoard), "Boards/source.brd"));
  expect(boardAfter.ok).toBe(true);
  if (!boardAfter.ok) throw boardAfter.error;
  expect(boardAfter.value.tileMatrix).toEqual([1, 1, 1, 1]);
  expect(boardAfter.value.lut).toEqual(["", "art.tst2"]);
  expect(boardAfter.value.sizeX).toBe(SOURCE_SHAPE.sizeX);
  expect(boardAfter.value.sizeY).toBe(SOURCE_SHAPE.sizeY);
  expect(boardAfter.value.sizeL).toBe(1);
  await expect.poll(() => boardPixel(boardCanvas, 5, 7)).toEqual(unaffected);
  await expect.poll(() => boardPixel(boardCanvas, 32 + 3, 7)).toEqual(blue);
  await expect.poll(() => boardPixel(boardCanvas, 3, 7)).toEqual(blue);

  const visitTile2 = async (): Promise<void> => {
    await row.getByRole("button", { name: "More actions", exact: true }).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("button", { name: "Edit tile artwork", exact: true }).click();
    await expect(page.getByRole("tab", { name: /^Tiles\/art\.tst(?:, unsaved changes)?$/ })).toHaveAttribute("aria-selected", "true");
    await expect(main.getByLabel("Tile", { exact: true })).toHaveValue("1");
  };

  // Reopen: the clean artwork is closed, and the next visit loads the saved tile from disk at that tile.
  await page.getByRole("button", { name: "Close Tiles/art.tst", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Tiles/art.tst", exact: true })).toHaveCount(0);
  await visitTile2();
  await expectPixel(page, canvas, 3, 7, blue);

  // Already open with an unsaved draft on another tile: a visit selects tile 2 and leaves the draft and its history alone.
  const pink: Rgba = [224, 32, 160, 255];
  const tile1Saved = tilePixel(savedArt, 0, 5, 9);
  expect(tile1Saved).not.toEqual(pink);
  await main.getByLabel("Tile", { exact: true }).selectOption({ label: "1" });
  await main.getByLabel("Brush color").fill("#e020a0");
  await beginStroke(page, canvas, 5, 9);
  await page.mouse.up();
  await expectPixel(page, canvas, 5, 9, pink);
  await page.getByRole("tab", { name: "Boards/source.brd", exact: true }).click();
  await visitTile2();
  await expectPixel(page, canvas, 3, 7, blue);
  await main.getByLabel("Tile", { exact: true }).selectOption({ label: "1" });
  await expectPixel(page, canvas, 5, 9, pink);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(page, canvas, 5, 9, tile1Saved);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(savedArt);
  await assertCleanSurface(page, errors, testInfo);
});
