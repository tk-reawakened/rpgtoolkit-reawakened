// Actual VS Code custom-editor conformance for the owned art experiment (#1726), not library admission.
// File oracle: docs/spec/formats/tiles.md#tile-data. Lifecycle: ADR0022 D1–D3 and ADR0026.
import { expandTileToRgba, readTileset, writeTileset } from "@tk-reawakened/core";
import type { expect as playwrightExpect, Frame, Locator, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;
type Rgba = readonly [number, number, number, number];
interface PointColor { readonly x: number; readonly y: number; readonly rgba: Rgba }
interface NativeArtHost {
  readonly artPath: string;
  readonly otherArtPath: string;
  readBacking(path: string): Promise<Uint8Array>;
  writeBacking(path: string, bytes: Uint8Array): Promise<void>;
  withBackingWriteRefused(path: string, check: () => Promise<void>): Promise<void>;
  restart(page: Page): Promise<Page>;
}
interface NativeArtActions {
  focusWorkbench(): Promise<void>;
  command(title: string): Promise<void>;
  closeEditor(): Promise<void>;
  backupStored(bytes: Uint8Array): Promise<boolean>;
  instrument(frame: Frame): Promise<void>;
}

const pink: Rgba = [210, 52, 165, 255];
const green: Rgba = [49, 192, 152, 255];
const blue: Rgba = [32, 176, 224, 255];

async function activateArtTab(page: Page, expect: Expect, path: string): Promise<void> {
  const filename = path.slice(path.lastIndexOf("/") + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tab = page.getByRole("tab", { name: new RegExp(`^${filename}(?:,|$)`) });
  await expect(tab).toHaveCount(1);
  await tab.click();
}

/** Needs a real workbench/working-copy provider: a unit model cannot prove native undo, view destruction or hot exit. */
export async function runVscodeArtProof(page: Page, expect: Expect, host: NativeArtHost, actions: NativeArtActions): Promise<Frame> {
  const original = await host.readBacking(host.artPath);
  const otherOriginal = await host.readBacking(host.otherArtPath);
  expect(pixel(original, 5, 7)).not.toEqual(pink);
  let first = await openArt(page, expect, host.artPath, actions);
  const initialBox = await canvas(first).boundingBox();
  expect(initialBox?.width).toBeGreaterThan(32);
  await actions.command("View: Split Editor Right");
  let views = await artFrames(page, expect, 2);
  for (const view of views) await actions.instrument(view);
  first = views[0]!;
  const second = views[1]!;
  await setBrush(second, "#507080");
  await setBrush(first, "#d234a5");

  await beginStroke(page, canvas(first), 4, 7, 8, 7);
  expect(await canvas(first).evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true);
  await expectPixel(canvas(first), expect, 5, 7, pink);
  await expectPixel(canvas(second), expect, 5, 7, displayPixel(original, 5, 7));
  expect(await host.readBacking(host.artPath)).toEqual(original);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expectPixel(canvas(first), expect, 5, 7, displayPixel(original, 5, 7));
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");

  await beginStroke(page, canvas(first), 4, 7, 8, 7);
  await page.mouse.up();
  await expectPixel(canvas(second), expect, 5, 7, pink);
  await expect(second.getByLabel("Brush color")).toHaveValue("#507080");
  await page.keyboard.press("ControlOrMeta+z");
  for (const view of views) await expectPixel(canvas(view), expect, 5, 7, displayPixel(original, 5, 7));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  for (const view of views) await expectPixel(canvas(view), expect, 5, 7, pink);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expectPixel(canvas(second), expect, 9, 7, displayPixel(original, 9, 7));
  await page.keyboard.press("Space");
  await expectPixel(canvas(second), expect, 9, 7, pink);
  await first.getByRole("button", { name: "Transparent eraser" }).click();
  await beginStroke(page, canvas(first), 5, 7, 5, 7);
  await page.mouse.up();
  await expectPixel(canvas(second), expect, 5, 7, [0, 0, 0, 0]);
  await page.keyboard.press("ControlOrMeta+z");
  await expectPixel(canvas(second), expect, 5, 7, pink);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expectPixel(canvas(second), expect, 5, 7, [0, 0, 0, 0]);

  // Dispose a native view, not its still-owned working copy; a newly split view must retain that history.
  await actions.closeEditor();
  await expect.poll(() => first.isDetached()).toBe(true);
  await artFrames(page, expect, 1);
  await activateArtTab(page, expect, host.artPath);
  await actions.command("View: Split Editor Right");
  views = await artFrames(page, expect, 2);
  for (const view of views) await actions.instrument(view);
  first = views[0]!;
  await canvas(first).focus();
  await page.keyboard.press("ControlOrMeta+z");
  for (const view of views) await expectPixel(canvas(view), expect, 5, 7, pink);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  for (const view of views) await expectPixel(canvas(view), expect, 5, 7, [0, 0, 0, 0]);
  const line: PointColor[] = Array.from({ length: 5 }, (_, index) => ({ x: index + 4, y: 7, rgba: index === 1 ? [0, 0, 0, 0] : pink }));
  let saved = changed(original, [...line, { x: 9, y: 7, rgba: pink }]);
  await setBrush(first, "#31c098");
  await beginStroke(page, canvas(first), 14, 15, 14, 15);
  await page.keyboard.press("ControlOrMeta+s");
  for (const view of views) await expect(view.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  expect(await host.readBacking(host.artPath)).toEqual(saved);
  await expectPixel(canvas(first), expect, 14, 15, green);
  const mirror = views.find((view) => view !== first)!;
  await expectPixel(canvas(mirror), expect, 14, 15, displayPixel(original, 14, 15));
  await page.mouse.up();
  await expectPixel(canvas(mirror), expect, 14, 15, green);
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("Unsaved changes");
  saved = changed(saved, [{ x: 14, y: 15, rgba: green }]);
  await first.getByRole("button", { name: "Save", exact: true }).click();
  for (const view of views) await expect(view.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  expect(await host.readBacking(host.artPath)).toEqual(saved);
  expect(await host.readBacking(host.otherArtPath)).toEqual(otherOriginal);
  await actions.closeEditor();
  await artFrames(page, expect, 1);
  await activateArtTab(page, expect, host.artPath);

  let other = await openArt(page, expect, host.otherArtPath, actions);
  await expectPixel(canvas(other), expect, 5, 7, displayPixel(otherOriginal, 5, 7));
  await setBrush(other, "#20b0e0");
  await beginStroke(page, canvas(other), 2, 3, 3, 3);
  await page.mouse.up();
  await other.getByRole("button", { name: "Save", exact: true }).click();
  await expect(other.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  const otherSaved = changed(otherOriginal, [{ x: 2, y: 3, rgba: blue }, { x: 3, y: 3, rgba: blue }]);
  expect(await host.readBacking(host.otherArtPath)).toEqual(otherSaved);
  expect(await host.readBacking(host.artPath)).toEqual(saved);
  await actions.closeEditor();
  first = (await artFrames(page, expect, 1))[0]!;
  await activateArtTab(page, expect, host.artPath);
  await actions.instrument(first);
  await expectPixel(canvas(first), expect, 9, 7, pink);

  // This loaded workbench retains an available workspace transport when its page is offline. Test that observed
  // topology honestly; physical write refusal below is independent, and neither case proves cold offline bootstrap.
  await page.context().setOffline(true);
  try {
    await setBrush(first, "#31c098");
    await beginStroke(page, canvas(first), 21, 22, 21, 22);
    await page.mouse.up();
    await expectPixel(canvas(first), expect, 21, 22, green);
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
    saved = changed(saved, [{ x: 21, y: 22, rgba: green }]);
    expect(await host.readBacking(host.artPath)).toEqual(saved);
  } finally {
    await page.context().setOffline(false);
  }
  await setBrush(first, "#20b0e0");
  await beginStroke(page, canvas(first), 22, 23, 22, 23);
  await page.mouse.up();
  const afterRefusal = changed(saved, [{ x: 22, y: 23, rgba: blue }]);
  await host.withBackingWriteRefused(host.artPath, async () => {
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.locator(".tkr-tileset-art-error")).toBeVisible();
    await expect(first.locator(".tkr-tileset-art-state")).toHaveText("Unsaved changes");
    await expectPixel(canvas(first), expect, 22, 23, blue);
    expect(await host.readBacking(host.artPath)).toEqual(saved);
  });
  await actions.command("Notifications: Clear All Notifications");
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  saved = afterRefusal;
  expect(await host.readBacking(host.artPath)).toEqual(saved);

  await setBrush(first, "#20b0e0");
  await beginStroke(page, canvas(first), 25, 26, 25, 26);
  await page.mouse.up();
  const mine = changed(saved, [{ x: 25, y: 26, rgba: blue }]);
  const external = changed(saved, [{ x: 27, y: 28, rgba: pink }]);
  await host.writeBacking(host.artPath, external);
  await first.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = first.getByRole("group", { name: "Changed on disk" });
  await expect(conflict).toBeVisible();
  await expectPixel(canvas(first), expect, 25, 26, blue);
  expect(await host.readBacking(host.artPath)).toEqual(external);
  await conflict.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await host.readBacking(host.artPath)).toEqual(external);
  await conflict.getByRole("button", { name: "Review conflict" }).click();
  await conflict.getByRole("button", { name: "Keep my version", exact: true }).click();
  await expect(conflict).toBeHidden();
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("Unsaved changes");
  expect(await host.readBacking(host.artPath)).toEqual(external);
  await actions.command("Notifications: Clear All Notifications");
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  expect(await host.readBacking(host.artPath)).toEqual(mine);

  const recoveryColor: Rgba = [200, 90, 41, 255];
  await setBrush(first, "#c85a29");
  await beginStroke(page, canvas(first), 24, 25, 24, 25);
  await page.mouse.up();
  const recovered = changed(mine, [{ x: 24, y: 25, rgba: recoveryColor }]);
  await expect.poll(() => actions.backupStored(recovered), { timeout: 30_000 }).toBe(true);
  const oldFrame = first;
  page = await host.restart(page);
  await expect.poll(() => oldFrame.isDetached()).toBe(true);
  first = (await artFrames(page, expect, 1))[0]!;
  await actions.instrument(first);
  await expectPixel(canvas(first), expect, 24, 25, recoveryColor);
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("Unsaved changes");
  expect(await host.readBacking(host.artPath)).toEqual(mine);
  // The existing legacy hot-exit format has no original disk baseline: recovery deliberately requires a choice.
  const recoveryConflict = first.getByRole("group", { name: "Changed on disk" });
  await expect(recoveryConflict).toBeVisible();
  await expect(first.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await recoveryConflict.getByRole("button", { name: "Keep my version", exact: true }).click();
  await expect(recoveryConflict).toBeHidden();
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("Unsaved changes");
  expect(await host.readBacking(host.artPath)).toEqual(mine);
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.locator(".tkr-tileset-art-state")).toHaveText("All changes saved");
  expect(await host.readBacking(host.artPath)).toEqual(recovered);
  expect(await host.readBacking(host.otherArtPath)).toEqual(otherSaved);
  await actions.closeEditor();
  first = await openArt(page, expect, host.artPath, actions);
  await expectPixel(canvas(first), expect, 24, 25, recoveryColor);
  await page.screenshot({ path: "/tmp/tkr-1726-native-art.png" });
  console.log("vscode.dev actual art document: native history, views, stored pixels, loaded-offline editing, physical write refusal, conflict and orderly reload passed");
  return first;
}

function canvas(frame: Frame): Locator { return frame.getByRole("img", { name: "Pixel canvas", exact: true }); }

async function setBrush(frame: Frame, color: string): Promise<void> {
  const erase = frame.getByRole("button", { name: "Transparent eraser" });
  if (await erase.getAttribute("aria-pressed") === "true") await erase.click();
  await frame.getByLabel("Brush color", { exact: true }).fill(color);
}

async function beginStroke(page: Page, target: Locator, x: number, y: number, toX: number, toY: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  if (bounds === null) throw new Error("The actual art canvas has no visible bounds");
  const point = (px: number, py: number) => ({ x: bounds.x + (px + 0.5) * bounds.width / 32, y: bounds.y + (py + 0.5) * bounds.height / 32 });
  const start = point(x, y);
  const end = point(toX, toY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
}

async function expectPixel(target: Locator, expect: Expect, x: number, y: number, rgba: readonly number[]): Promise<void> {
  await expect.poll(() => target.evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The actual art canvas has no2D context");
    return Array.from(context.getImageData(Math.floor((point.x + 0.5) * canvas.width / 32), Math.floor((point.y + 0.5) * canvas.height / 32), 1, 1).data);
  }, { x, y })).toEqual(rgba);
}

async function artFrames(page: Page, expect: Expect, count: number): Promise<Frame[]> {
  let found: Frame[] = [];
  await expect.poll(async () => {
    found = [];
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      try {
        if (await frame.locator(".tkr-tileset-art").count() === 1) found.push(frame);
      } catch (error) {
        if (!frame.isDetached()) throw error;
      }
    }
    return found.length;
  }, { timeout: 30_000 }).toBe(count).catch(async (error: unknown) => {
    try {
      console.error("Actual VS Code layout at artwork-frame failure:\n", await page.locator("body").ariaSnapshot());
      await page.screenshot({ path: "/tmp/tkr-1726-native-art-failure.png" });
    } catch (diagnosticError) {
      console.error("Could not capture the native failure surface:", diagnosticError);
    }
    throw error;
  });
  return found;
}

async function openArt(page: Page, expect: Expect, path: string, actions: NativeArtActions): Promise<Frame> {
  await actions.focusWorkbench();
  const folder = page.getByRole("treeitem", { name: "Tiles", exact: true });
  await expect(folder).toBeVisible();
  if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
  const item = page.getByRole("treeitem", { name: path.split("/").at(-1)!, exact: true });
  await expect(item).toBeVisible();
  await item.dblclick();
  const frame = (await artFrames(page, expect, 1))[0]!;
  await actions.instrument(frame);
  return frame;
}

function changed(bytes: Uint8Array, changes: readonly PointColor[]): Uint8Array {
  const read = readTileset(bytes, "authored-art.tst");
  if (!read.ok) throw new Error(read.error.message);
  if (read.value.detail.code !== 1) throw new Error("The authored actual-host control must be a32x32 RGB TST");
  const pixels = read.value.tiles[0]!.pixels.slice();
  for (const change of changes) {
    // Normative column-major storage, independent of the view's row-major transport.
    const at = (change.x * 32 + change.y) * 3;
    pixels[at] = change.rgba[3] === 0 ? 0 : change.rgba[0];
    pixels[at + 1] = change.rgba[3] === 0 ? 1 : change.rgba[1];
    pixels[at + 2] = change.rgba[3] === 0 ? 2 : change.rgba[2];
  }
  const tiles = read.value.tiles.slice();
  tiles[0] = { pixels };
  const written = writeTileset({ ...read.value, tiles });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function pixel(bytes: Uint8Array, x: number, y: number): number[] {
  const read = readTileset(bytes, "authored-art.tst");
  if (!read.ok) throw new Error(read.error.message);
  const expanded = expandTileToRgba(read.value, 0);
  if (!expanded.ok) throw new Error(expanded.error.message);
  const at = (x * 32 + y) * 4;
  return Array.from(expanded.value.subarray(at, at + 4));
}
function displayPixel(bytes: Uint8Array, x: number, y: number): number[] {
  const rgba = pixel(bytes, x, y);
  return rgba[3] === 0 ? [0, 0, 0, 0] : rgba;
}
