import { BinaryReader, readBoard } from "@tk-reawakened/core";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
export const NATIVE_SCENE_PROOF_PATH = "Boards/terrain-proof.tkrscn";
const boardPath = "Boards/terrain-proof.brd";
export async function runVscodeNativeSceneProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>, original: Uint8Array): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const editor = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) if (await frame.getByRole("main", { name: "Native scene" }).isVisible().catch(() => false)) { found = frame; return true; }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The native scene terrain editor did not open");
    return found;
  };
  const command = async (title: string): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    const widget = page.locator(".quick-input-widget");
    const input = widget.locator("input:visible");
    await expect(input).toHaveCount(1);
    await input.fill(`>${title}`);
    await page.getByRole("option", { name: new RegExp(`^${title}(?:,|$)`) }).first().click();
    await expect(widget).toBeHidden();
  };
  const assertBuiltBoard = async (expectedTile: number): Promise<void> => {
    await expect.poll(async () => {
      const bytes = await readBacking(boardPath).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
        throw error;
      });
      if (bytes === null) return null;
      const board = readBoard(new BinaryReader(bytes));
      return board.ok ? { first: board.value.tileMatrix[0], count: board.value.tileMatrix.length, start: board.value.properties.start } : null;
    }).toMatchObject({ first: expectedTile, count: 4, start: { x: 16, y: 31, layer: 1 } });
  };
  await openNativeQuickOpenFile(page, expect, NATIVE_SCENE_PROOF_PATH);
  const sceneTab = page.getByRole("tab").filter({ hasText: "terrain-proof.tkrscn" }).first();
  await expect(sceneTab).toBeVisible();
  let view: Frame;
  try { view = await editor(); }
  catch (cause) {
    const frames = await Promise.all(page.frames().map(async (frame) => ({
      url: new URL(frame.url()).pathname,
      status: await frame.locator("#root").innerText({ timeout: 500 }).catch(() => null),
    })));
    throw new Error(`Native terrain editor did not open: ${JSON.stringify(frames)}`, { cause });
  }
  await expect(view.getByRole("grid", { name: "Scene cells" })).toBeVisible();
  await view.getByRole("radio", { name: "Manual empty" }).check();
  await view.getByRole("gridcell").first().getByRole("button").click();
  await expect(sceneTab).toHaveClass(/dirty/);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(sceneTab).not.toHaveClass(/dirty/);
  await expect.poll(async () => new TextDecoder().decode(await readBacking(NATIVE_SCENE_PROOF_PATH))).not.toBe(new TextDecoder().decode(original));
  await assertBuiltBoard(0);

  await view.getByRole("radio", { name: "Clear override" }).check();
  await view.getByRole("gridcell").first().getByRole("button").click();
  await expect(view.getByRole("gridcell").first().getByRole("button")).toHaveAccessibleName("Cell 0, 0: base");
  await expect(sceneTab).toHaveClass(/dirty/);
  await command("Test: Save All Workbench Editors");
  await expect(sceneTab).not.toHaveClass(/dirty/);
  await assertBuiltBoard(1);
  const savedScene = new TextDecoder().decode(await readBacking(NATIVE_SCENE_PROOF_PATH));
  expect(savedScene).toContain("tileOverrides");

  await view.getByRole("radio", { name: "Manual empty" }).check();
  await view.getByRole("gridcell").first().getByRole("button").click();
  await expect(sceneTab).toHaveClass(/dirty/);
  await view.getByRole("button", { name: "Play", exact: true }).click();
  const mainOption = page.getByRole("option", { name: /Main\/example\.gam/ });
  const rootOption = page.getByRole("option", { name: /Workspace root \(package layout\)/ });
  await expect.poll(async () => await mainOption.isVisible().catch(() => false) || await rootOption.isVisible().catch(() => false)).toBe(true);
  if (await mainOption.isVisible().catch(() => false)) await mainOption.click();
  await expect(rootOption).toBeVisible();
  await rootOption.click();
  await assertBuiltBoard(0);
  let player: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) if (await frame.locator("#screen").count() > 0) { player = frame; return true; }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (player === undefined) throw new Error("The scene-play workbench frame did not open");
  await expect.poll(async () => await player!.evaluate(() => Reflect.get(window, "__live") as { board: string | null } | undefined)).toMatchObject({ board: expect.stringContaining("terrain-proof.brd") });
}
