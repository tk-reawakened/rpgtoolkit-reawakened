import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

type Expect = typeof playwrightExpect;
export const NATIVE_SCENE_PROOF_PATH = "Boards/terrain-proof.tkrscn";
/** The one line the proof rewrites: the same recipe with a single rule that covers every neighbourhood. */
export const NATIVE_SCENE_RULES_BEFORE = "rules: [{id: east, when: {e: same}, use: {tile: Tiles/roles-water.tkrtle}}]";
export const NATIVE_SCENE_RULES_AFTER = "rules: [{id: any, when: {}, use: {tile: Tiles/roles-water.tkrtle}}]";
/** A second scene, and the minimal recipe it reads, for the roles-refresh proof (#3533). */
export const NATIVE_ROLES_SCENE_PATH = "Boards/roles-proof.tkrscn";
export const NATIVE_SCENE_RECIPE = `contract: tileset
version: 1.0.0-pre.2
name: Roles
expects: {projection: 2d, cellSize: [32, 32]}
tiles: [{tile: Tiles/roles-water.tkrtle}, {tile: Tiles/roles-bank.tkrtle}]
terrains:
  - id: shore
    name: Shore
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: partial
    sync: independent
    ${NATIVE_SCENE_RULES_BEFORE}
outputBinding: {target: Tiles/roles.tst, detail: 1, slots: [{slot: 1, tile: Tiles/roles-water.tkrtle}, {slot: 2, tile: Tiles/roles-bank.tkrtle}]}
`;
export const NATIVE_ROLES_SCENE = `contract: scene
version: 1.0.0-pre.2
projection: 2d
size: {width: 4, height: 3}
floors: [{id: ground}]
terrainRegions:
  - id: water
    floor: ground
    terrain: {tileset: Tiles/roles.tkrtst, terrain: shore}
    coverage: {shape: tile-grid, spans: [[0, 0, 2]]}
start: {x: 16, y: 31, floor: ground}
`;
const boardPath = "Boards/terrain-proof.brd";
export async function runVscodeNativeSceneProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>, writeBacking: (path: string, bytes: Uint8Array) => Promise<void>, original: Uint8Array): Promise<void> {
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
  await view.getByRole("button", { name: "Preview build", exact: true }).click();
  await expect(view.getByRole("img", { name: "Compiled scene preview" })).toBeVisible();
  await expect(readBacking(boardPath)).rejects.toMatchObject({ code: "ENOENT" });
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
    for (const frame of page.frames()) if (await frame.locator("#screen").count().catch(() => 0) > 0) { player = frame; return true; }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (player === undefined) throw new Error("The scene-play workbench frame did not open");
  await expect.poll(async () => await player!.evaluate(() => Reflect.get(window, "__live") as { board: string | null } | undefined)).toMatchObject({ board: expect.stringContaining("terrain-proof.brd") });

  await sceneTab.click();
  view = await editor();
  const sourceBeforeRecovery = await readBacking(NATIVE_SCENE_PROOF_PATH);
  const prior = readBoard(new BinaryReader(await readBacking(boardPath)));
  if (!prior.ok) throw new Error(prior.error.message);
  const outside = writeBoard({ ...prior.value, properties: { ...prior.value.properties, start: { x: 48, y: 31, layer: 1 } } });
  if (!outside.ok) throw new Error(outside.error.message);
  await writeBacking(boardPath, outside.value);
  const recoveryPath = "Boards/terrain-proof.recovered.tkrscn";
  const review = page.locator(".monaco-dialog-box").filter({ hasText: "Outside changes were found" });
  const saveNative = view.getByRole("button", { name: "Save", exact: true });
  await saveNative.click();
  await expect(review).toContainText(recoveryPath);
  await review.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(readBacking(recoveryPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(new Uint8Array(await readBacking(boardPath))).toEqual(outside.value);
  expect(await readBacking(NATIVE_SCENE_PROOF_PATH)).toEqual(sourceBeforeRecovery);

  await saveNative.click();
  await expect(review).toContainText(recoveryPath);
  await review.getByRole("button", { name: "Write recovery scene", exact: true }).click();
  await expect.poll(async () => new TextDecoder().decode(await readBacking(recoveryPath).catch(() => new Uint8Array()))).toContain("version: 1.0.0-pre.2");
  expect(new Uint8Array(await readBacking(boardPath))).toEqual(outside.value);
  expect(await readBacking(NATIVE_SCENE_PROOF_PATH)).toEqual(sourceBeforeRecovery);
}

/**
 * The recipe an open scene reads is edited and **saved** in VS Code, and the scene's role panel and preview must follow it
 * (#3533): the saved bytes are what the host re-reads, so a panel left on the pre-save rules would be stale advice.
 */
export async function runVscodeTerrainRoleRefreshProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>): Promise<void> {
  await openNativeQuickOpenFile(page, expect, NATIVE_ROLES_SCENE_PATH);
  // Two native scenes are open by now; the roles scene is the one with a 4 x 3 grid (the first is 2 x 2).
  const rolesScene = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole("button", { name: /^Cell 3, 2:/ }).isVisible().catch(() => false)) { found = frame; return true; }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The roles-proof scene is not showing");
    return found;
  };
  let view = await rolesScene();
  await view.getByRole("combobox", { name: "Tileset", exact: true }).selectOption("Tiles/roles.tkrtst");
  await view.getByRole("combobox", { name: "Terrain", exact: true }).selectOption({ label: "Shore" });
  const roles = view.getByRole("region", { name: "Native terrain roles" });
  await expect(roles).toContainText("Native terrain rules: Shore");
  await expect(roles).toContainText("Four neighbours, partial coverage: 8 of 16 neighbourhoods have a tile");

  // A build of the partial recipe: the cell with only its west neighbour has no rule, and that failure is shown.
  await view.getByRole("button", { name: "Preview build", exact: true }).click();
  await expect(view.getByRole("status").filter({ hasText: "No tile rule matches ground at (1, 0)" })).toBeVisible();

  // The recipe is edited and saved through the workbench while the scene stays open.
  await openNativeQuickOpenFile(page, expect, "Tiles/roles.tkrtst");
  const recipeTab = page.getByRole("tab").filter({ hasText: "roles.tkrtst" }).first();
  await expect(recipeTab).toBeVisible();
  // Replace only the rules line, in one insertion, so auto-indent and bracket pairing cannot change the document: the cursor
  // goes to line 13 and the selection runs from its first character to its end.
  await page.locator(".monaco-editor:visible .view-lines").first().click();
  // "Go to line" is the one navigation that cannot land elsewhere: line 13 is the rules line of the recipe.
  await page.keyboard.press("ControlOrMeta+p");
  const goTo = page.locator(".quick-input-widget input:visible");
  await expect(goTo).toHaveCount(1);
  await goTo.fill(":13");
  await page.keyboard.press("Enter");
  await expect(page.locator(".quick-input-widget")).toBeHidden({ timeout: 10_000 });
  // End, then Shift+Home, selects from the line's first character to its end; the replacement has no break, so nothing is auto-indented.
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText(NATIVE_SCENE_RULES_AFTER);
  await expect(recipeTab).toHaveClass(/dirty/);
  // Wait out the typing pause (250 ms) so its read has already happened, on the bytes still on disk: only the save is left
  // that can bring the new recipe in, so removing the save hook makes this proof fail instead of passing on the pause.
  await page.waitForTimeout(1_000);
  expect(new TextDecoder().decode(await readBacking("Tiles/roles.tkrtst"))).toContain(NATIVE_SCENE_RULES_BEFORE);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(recipeTab).not.toHaveClass(/dirty/);
  await expect.poll(async () => new TextDecoder().decode(await readBacking("Tiles/roles.tkrtst"))).toContain(NATIVE_SCENE_RULES_AFTER);

  // Back on the scene: the saved recipe's roles are what the panel reports, and the old build is no longer shown as current.
  await page.getByRole("tab").filter({ hasText: "roles-proof.tkrscn" }).first().click();
  view = await rolesScene();
  const rolesAgain = view.getByRole("region", { name: "Native terrain roles" });
  await expect(rolesAgain).toContainText("Four neighbours, partial coverage: 16 of 16 neighbourhoods have a tile", { timeout: 15_000 });
  await expect(rolesAgain).toContainText("Every neighbourhood has a tile");
  await expect(rolesAgain).not.toContainText("Missing role assignments");
  await expect(view.getByRole("status").filter({ hasText: "No tile rule matches ground" })).toHaveCount(0);
}
