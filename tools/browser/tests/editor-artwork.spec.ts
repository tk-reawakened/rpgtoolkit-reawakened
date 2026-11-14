import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expandTileToRgba, readTileset, tilesetDetail, writeTileset } from "@tk-reawakened/core";

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

async function beginStroke(page: Page, canvas: Locator, x: number, y: number, endX = x, endY = y): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The actual pixel canvas has no bounds");
  await page.mouse.move(box.x + (x + 0.5) * box.width / 32, box.y + (y + 0.5) * box.height / 32);
  await page.mouse.down();
  await page.mouse.move(box.x + (endX + 0.5) * box.width / 32, box.y + (endY + 0.5) * box.height / 32);
}

async function openFile(page: Page, path: string): Promise<void> {
  const old = (await surface(primary(page)).elementHandles())[0];
  const parts = path.split("/");
  for (const folder of parts.slice(0, -1)) {
    const row = page.getByRole("treeitem", { name: new RegExp(`^${folder}, folder, (?:closed|open)$`) });
    await expect(row).toBeVisible();
    if (await row.getAttribute("aria-expanded") === "false") await row.press("ArrowRight");
  }
  const item = page.getByRole("treeitem", { name: new RegExp(`^${parts.at(-1)}(?:,|$)`) });
  await item.dblclick();
  if (old !== undefined) {
    await expect.poll(() => old.evaluate((element) => !element.isConnected)).toBe(true);
    await old.dispose();
  }
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

function changed(bytes: readonly number[], changes: readonly PixelChange[]): number[] {
  const parsed = readTileset(new Uint8Array(bytes));
  if (!parsed.ok || parsed.value.detail.bytesPerPixel !== 3) throw new Error("The independent byte oracle requires an RGB TST");
  const tiles = parsed.value.tiles.map((tile) => ({ pixels: tile.pixels.slice() }));
  for (const change of changes) {
    const at = (change.x * parsed.value.detail.size + change.y) * 3;
    tiles[0]!.pixels.set(change.rgba[3] === 0 ? [0, 1, 2] : change.rgba.slice(0, 3), at);
  }
  const written = writeTileset({ ...parsed.value, tiles });
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
  const mirrorButton = page.getByRole("button", { name: "Second view" });
  await mirrorButton.click();
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
  await expect(main.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  await beginStroke(page, canvas, 12, 13);
  await expectPixel(page, canvas, 12, 13, pink);
  await page.keyboard.press("Tab");
  expect(await canvas.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(false);
  await page.mouse.up();
  await expectPixel(page, canvas, 12, 13, rgbaAt(initial, 12, 13));
  await expectPixel(page, mirror, 12, 13, rgbaAt(initial, 12, 13));
  await expect(main.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
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
  await beginStroke(page, canvas, 14, 15);
  await expectPixel(page, canvas, 14, 15, green);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(accepted);
  await expectPixel(page, canvas, 14, 15, green);
  await expectPixel(page, mirror, 14, 15, rgbaAt(initial, 14, 15));
  await page.mouse.up();
  await expectPixel(page, mirror, 14, 15, green);
  await expect(main.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await main.getByRole("button", { name: "Save", exact: true }).click();
  const saved = changed(accepted, [{ x: 14, y: 15, rgba: green }]);
  await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
  await mirrorButton.click();
  await expect(mirrorRoot).toBeHidden();
  await mirrorButton.click();
  await expect(mirror).toBeVisible();
  await expectPixel(page, mirror, 14, 15, green);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(page, mirror, 14, 15, rgbaAt(initial, 14, 15));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectPixel(page, mirror, 14, 15, green);
  await expect(main.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

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
    await main.getByRole("button", { name: "Save", exact: true }).click();
    await expect(main.locator(".tkr-tileset-art-error")).toBeVisible();
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
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
  await main.getByRole("button", { name: "Save", exact: true }).click();
  let saved = changed(artBytes, [{ x: 5, y: 7, rgba: green }]);
  await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
  await expect(main.locator(".tkr-tileset-art-error")).toHaveCount(0);

  await page.context().setOffline(true);
  try {
    await main.getByLabel("Brush color").fill("#d12b73");
    await beginStroke(page, canvas, 11, 12);
    await page.mouse.up();
    await expectPixel(page, canvas, 11, 12, pink);
    await main.getByRole("button", { name: "Save", exact: true }).click();
    saved = changed(saved, [{ x: 11, y: 12, rgba: pink }]);
    await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(saved);
    await expect(main.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  } finally {
    await page.context().setOffline(false);
  }

  await main.getByLabel("Brush color").fill("#20b0e0");
  await beginStroke(page, canvas, 25, 26);
  await page.mouse.up();
  const mine = changed(saved, [{ x: 25, y: 26, rgba: blue }]);
  const external = changed(saved, [{ x: 27, y: 28, rgba: pink }]);
  await writeBacking(page, folder, external);
  await main.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = main.getByRole("group", { name: "Changed on disk" });
  await expect(conflict).toBeVisible();
  await expectPixel(page, canvas, 25, 26, blue);
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(external);
  await conflict.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await storedBytes(page, folder, "Tiles/art.tst")).toEqual(external);
  await conflict.getByRole("button", { name: "Review conflict" }).click();
  await conflict.getByRole("button", { name: "Save my version", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(mine);
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
  await main.getByRole("button", { name: "Save", exact: true }).click();
  await expect(conflict).toBeVisible();
  await conflict.getByRole("button", { name: "Use the version on disk", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expectPixel(page, canvas, 15, 15, [16, 16, 16, 255], 16);
  await canvas.focus();
  await page.keyboard.press("Space");
  await expectPixel(page, canvas, 15, 15, pink, 16);
  await main.getByRole("button", { name: "Save", exact: true }).click();
  const final = changed(smallerBytes, [{ x: 15, y: 15, rgba: pink }]);
  await expect.poll(() => storedBytes(page, folder, "Tiles/art.tst")).toEqual(final);
  expect(await storedBytes(page, folder, "Main/example.gam")).toEqual(mainBytes);
  expect(await storedBytes(page, folder, "Tiles/other.tst")).toEqual(otherBytes);
  await assertCleanSurface(page, errors, testInfo);
});
