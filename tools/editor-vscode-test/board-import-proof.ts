import { BinaryReader, readBoard } from "@tk-reawakened/core";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;

/** The current board the live editor imports; `run.mjs` writes both fixtures before this proof begins. */
const BOARD = "Boards/village.brd";
const BOARD_FILE = "village.brd";
const SCENE = "Boards/village.tkrscn";
/** A supported older (minor 3, pre-vector) board the legacy board editor cannot open for editing. */
const OLDER_BOARD = "Boards/older-board.brd";
const OLDER_SCENE = "Boards/older-board.tkrscn";

interface ImportProofHost {
  /** The `.tkrscn` files directly in the project's `Boards` folder, so one import can be shown to create exactly one. */
  listScenes(): Promise<readonly string[]>;
  /** Whether the project's recovery history holds exactly these bytes (the replaced board's prior version). */
  historyContains(bytes: Uint8Array): Promise<boolean>;
}

/**
 * Import as Scene in the real VS Code Web workbench (story 12.16): the board editor's action and the palette
 * route both show the same review over the saved board. Cancelling writes nothing; confirming creates one same-stem
 * scene and opens it. The imported scene is then painted, and its first build over the original board is a separate
 * authorization that keeps the board it replaces in history.
 */
export async function runVscodeBoardImportProof(
  page: Page,
  expect: Expect,
  readBacking: (path: string) => Promise<Uint8Array>,
  host: ImportProofHost,
): Promise<void> {
  // The preceding terrain proof leaves another native scene visible in a split group. Close its editors before
  // locating the imported scene's webview; a workbench reload would just restore those groups and the wrong frame.
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const widget = page.locator(".quick-input-widget");
  const input = widget.locator("input:visible");
  await expect(input).toHaveCount(1);
  await input.fill(">View: Close All Editors");
  await page.getByRole("option", { name: /^View: Close All Editors(?:,|$)/ }).first().click();
  await expect(page.getByRole("tab", { name: /^terrain-proof\.tkrscn/ })).toHaveCount(0);
  await expect(widget).toBeHidden();
  const original = new Uint8Array(await readBacking(BOARD));
  const olderOriginal = new Uint8Array(await readBacking(OLDER_BOARD));
  const scenes = async (): Promise<readonly string[]> => [...await host.listScenes()].sort();
  // The run's other scene fixture (the terrain proof) is staged before this proof: only scenes this import adds are new.
  const baseline = await scenes();
  const withScenes = (...added: string[]): readonly string[] => [...baseline, ...added].sort();

  const review = (text: string) => page.locator(".monaco-dialog-box").filter({ hasText: text });
  const missing = async (path: string): Promise<void> => {
    await expect(readBacking(path)).rejects.toMatchObject({ code: "ENOENT" });
  };

  // Choose the pre-vector board before opening any editor that can take keyboard focus back from the palette.
  const selectOlderBoard = async () => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(input).toHaveCount(1);
    await input.fill(">RPG Toolkit: Import board as scene");
    await page.getByRole("option", { name: /^RPG Toolkit: Import board as scene/ }).click();
    const pick = page.getByRole("option", { name: OLDER_BOARD, exact: true });
    await expect(pick).toBeVisible({ timeout: 20_000 });
    await pick.click();
    const modal = review(`Import ${OLDER_BOARD} as a scene?`);
    await expect(modal).toBeVisible({ timeout: 20_000 });
    return modal;
  };
  const olderReview = await selectOlderBoard();
  await olderReview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(olderReview).toBeHidden();
  await missing(OLDER_SCENE);
  expect(await scenes()).toEqual(baseline);
  expect(await readBacking(OLDER_BOARD)).toEqual(olderOriginal);

  const confirmedReview = await selectOlderBoard();
  await confirmedReview.getByRole("button", { name: "Import as Scene", exact: true }).click();
  await expect(confirmedReview).toBeHidden();
  const olderTab = page.getByRole("tab", { name: /^older-board\.tkrscn/ });
  await expect(olderTab).toBeVisible({ timeout: 30_000 });
  expect(await scenes()).toEqual(withScenes("older-board.tkrscn"));
  expect(await readBacking(OLDER_BOARD)).toEqual(olderOriginal);
  expect(new TextDecoder().decode(await readBacking(OLDER_SCENE))).toContain("contract: scene");
  await olderTab.getByRole("button", { name: /^Close/ }).click();
  await expect(olderTab).toHaveCount(0);

  const boardView = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator(".tkr-board").count().catch(() => 0) > 0) { found = frame; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The board editor did not open for the import proof");
    return found;
  };
  const sceneView = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole("main", { name: "Native scene" }).isVisible().catch(() => false)) { found = frame; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The imported scene did not open in the native scene editor");
    return found;
  };

  // ---- the board editor's one action: review, cancel, then one reviewed import
  await openNativeQuickOpenFile(page, expect, BOARD);
  const boardTab = page.getByRole("tab").filter({ hasText: BOARD_FILE }).first();
  await expect(boardTab).toBeVisible({ timeout: 30_000 });
  const view = await boardView();
  const importButton = view.getByRole("button", { name: /^Import as Scene/ });
  await expect(importButton).toBeVisible();
  await expect(view.getByText(/linked pack placements are edited in native scenes, not legacy boards/)).toBeVisible();
  await expect(view.getByRole("button", { name: "Place asset", exact: true })).toHaveCount(0);

  await importButton.click();
  const firstReview = review(`Import ${BOARD} as a scene?`);
  await expect(firstReview).toBeVisible({ timeout: 20_000 });
  await expect(firstReview).toContainText(`Creates ${SCENE} only`);
  await firstReview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstReview).toBeHidden();
  await missing(SCENE);
  expect(await scenes()).toEqual(withScenes("older-board.tkrscn"));
  expect(new Uint8Array(await readBacking(BOARD))).toEqual(original);
  await expect(view.locator(".tkr-board-error")).toHaveCount(0);

  await importButton.click();
  const importReview = review(`Import ${BOARD} as a scene?`);
  await expect(importReview).toBeVisible({ timeout: 20_000 });
  await importReview.getByRole("button", { name: "Import as Scene", exact: true }).click();
  await expect(importReview).toBeHidden();
  const sceneTab = page.getByRole("tab").filter({ hasText: "village.tkrscn" }).first();
  await expect(sceneTab).toBeVisible({ timeout: 30_000 });
  expect(await scenes()).toEqual(withScenes("older-board.tkrscn", "village.tkrscn"));
  expect(new Uint8Array(await readBacking(BOARD))).toEqual(original);
  const sceneText = new TextDecoder().decode(await readBacking(SCENE));
  expect(sceneText).toContain("contract: scene");
  expect(sceneText).toContain(`source: ${BOARD}`);

  // ---- native paint, then the first build over the original board is its own reviewed authorization
  let imported = await sceneView();
  await expect(imported.getByRole("grid", { name: "Scene cells" })).toBeVisible();
  await imported.getByRole("radio", { name: "Manual empty" }).check();
  await imported.getByRole("gridcell").first().getByRole("button").click();
  await expect(sceneTab).toHaveClass(/dirty/);
  await imported.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sceneTab).not.toHaveClass(/dirty/);
  const buildReview = page.locator(".monaco-dialog-box").filter({ hasText: "Generated outputs conflict" });
  await expect(buildReview).toBeVisible({ timeout: 30_000 });
  await expect(buildReview).toContainText(BOARD);
  await buildReview.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(buildReview).toBeHidden();
  expect(new Uint8Array(await readBacking(BOARD))).toEqual(original);
  expect(await host.historyContains(original)).toBe(false);
  expect(new TextDecoder().decode(await readBacking(SCENE))).toContain("tileOverrides");

  imported = await sceneView();
  await imported.getByRole("gridcell").nth(1).getByRole("button").click();
  await expect(sceneTab).toHaveClass(/dirty/);
  await imported.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sceneTab).not.toHaveClass(/dirty/);
  await expect(buildReview).toBeVisible({ timeout: 30_000 });
  await expect(buildReview).toContainText(BOARD);
  await buildReview.getByRole("button", { name: "Authorize listed outputs", exact: true }).click();
  await expect(buildReview).toBeHidden();
  await expect.poll(async () => {
    const bytes = await readBacking(BOARD).catch(() => null);
    if (bytes === null) return null;
    const board = readBoard(new BinaryReader(bytes));
    return board.ok ? { first: board.value.tileMatrix[0], count: board.value.tileMatrix.length } : null;
  }, { timeout: 30_000 }).toMatchObject({ first: 0, count: 4 });
  expect(new Uint8Array(await readBacking(BOARD))).not.toEqual(original);
  await expect.poll(() => host.historyContains(original), { timeout: 30_000 }).toBe(true);
  expect(await scenes()).toEqual(withScenes("older-board.tkrscn", "village.tkrscn"));
  expect(new TextDecoder().decode(await readBacking(SCENE))).toContain("tileOverrides");
}
