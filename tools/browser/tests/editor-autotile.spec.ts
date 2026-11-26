import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { BinaryReader, createEmptyMainFile, readBoard, writeMainFile } from "@tk-reawakened/core";
import {
  boardExtent,
  boardToScreen,
  cellCentre,
  clampViewport,
  encodeScenePng,
  pixelToCell,
  type BoardShape,
  type Cell,
  type Viewport,
} from "@tk-reawakened/editor-model";

// Story 8 (T-25), neighbour aware autotiling, in the shipped browser editor page: the real host-web workbench in Chromium
// under its strict CSP, the real mouse and keyboard, and the project folder as the browser's own origin-private file
// system. The original set is the spec's own example (docs/spec/editor/examples/autotiling), so what is painted here is
// the 52-slot table of docs/spec/editor/autotiling.md read by hand, not anything this page computes.

const EXAMPLES = "../../../docs/spec/editor/examples/autotiling/";
const water = Array.from(readFileSync(new URL(`${EXAMPLES}Tiles/AUTOTILES_Water.tst`, import.meta.url)));
const grass = Array.from(readFileSync(new URL(`${EXAMPLES}Tiles/Grass.tst`, import.meta.url)));
const village = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const validMain = Array.from(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const EDITOR_URL = "/tools/browser/editor-web/index.html";
const VIEW = { width: 640, height: 384 };

interface ProofWindow extends Window { __tkrCspViolations?: string[]; __tkrPickerReady?: true; __tkrTestFolder?: FileSystemDirectoryHandle }
type PickerInput = { readonly path: string; readonly bytes: readonly number[] };

async function installFolder(page: Page, files: readonly PickerInput[]): Promise<string> {
  const folder = `TkrAutotile-${randomUUID()}`;
  await page.addInitScript(async ({ inputs, name }: { inputs: readonly PickerInput[]; name: string }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
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
    Reflect.set(window, "__tkrPickerReady", true);
    (window as ProofWindow).__tkrTestFolder = root;
  }, { inputs: files, name: folder });
  return folder;
}

async function readFolderFile(page: Page, path: string): Promise<Uint8Array> {
  return Uint8Array.from(await page.evaluate(async (file) => {
    let handle = (window as ProofWindow).__tkrTestFolder!;
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) handle = await handle.getDirectoryHandle(part);
    return Array.from(new Uint8Array(await (await (await handle.getFileHandle(parts.at(-1)!)).getFile()).arrayBuffer()));
  }, path));
}

const state = (page: Page): Locator => page.locator(".tkr-board-state");
const tiles = (page: Page, tile: string): Locator => page.locator(`.tkr-board-cell[aria-label$=": ${tile}"]`);
const notes = (page: Page): Locator => page.locator(".tkr-board-autotile-note");
const canvas = (page: Page): Locator => page.locator("canvas.tkr-board-canvas");

function onPage(box: { x: number; y: number; width: number; height: number }, viewport: Viewport, shape: BoardShape, cell: Cell): { x: number; y: number } {
  const centre = cellCentre(shape, cell.x, cell.y);
  const screen = boardToScreen(viewport, centre.x, centre.y);
  return { x: box.x + (screen.x * box.width) / VIEW.width, y: box.y + (screen.y * box.height) / VIEW.height };
}

test.use({ actionTimeout: 10_000 });

test("original autotile sets: recognised by name, previewed, painted, reshaped, erased and undone in the production browser editor", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      ((window as ProofWindow).__tkrCspViolations ??= []).push(event.effectiveDirective);
    });
  });
  await installFolder(page, [
    { path: "Game/example.gam", bytes: validMain },
    { path: "Tiles/AUTOTILES_Water.tst", bytes: water },
    { path: "Tiles/Grass.tst", bytes: grass },
    { path: "Tiles/nested/autotiles_Marsh.tst", bytes: water },
    { path: "Tiles/village.tst", bytes: village },
  ]);
  await page.goto(EDITOR_URL);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await page.getByRole("button", { name: "New board…" }).click();
  const dialog = page.getByRole("dialog", { name: "New board" });
  await dialog.getByLabel("Name", { exact: true }).fill("meadow");
  await dialog.getByLabel("Layout").selectOption("2d");
  await dialog.getByLabel("Width in tiles").fill("8");
  await dialog.getByLabel("Height in tiles").fill("8");
  await dialog.getByLabel("Layers").fill("2");
  await dialog.getByRole("button", { name: "Create board" }).click();
  await expect(state(page)).toHaveText("All changes saved");

  const shape: BoardShape = { sizeX: 8, sizeY: 8, coordType: 0 };
  const extent = boardExtent(shape);
  const centre = pixelToCell(shape, extent.width / 2, extent.height / 2)!;
  const near = (dx: number, dy: number): Cell => ({ x: centre.x + dx, y: centre.y + dy });
  const viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: VIEW.width, height: VIEW.height });
  const where = async (cell: Cell): Promise<{ x: number; y: number }> => {
    await canvas(page).scrollIntoViewIfNeeded();
    return onPage((await canvas(page).boundingBox())!, viewport, shape, cell);
  };
  const click = async (cell: Cell, modifier?: "Shift"): Promise<void> => {
    const at = await where(cell);
    if (modifier !== undefined) await page.keyboard.down(modifier);
    await page.mouse.click(at.x, at.y);
    if (modifier !== undefined) await page.keyboard.up(modifier);
  };
  /** A hash of the middle 26 by 26 pixels the board canvas draws for a cell (inside the keyboard cursor's border), so the picture itself is shown to change. */
  const picture = async (cell: Cell): Promise<string> => {
    // The pointer over a cell draws a hover mark, so it is taken off the board before the picture is sampled.
    await page.mouse.move(1, 1);
    const at = boardToScreen(viewport, cellCentre(shape, cell.x, cell.y).x, cellCentre(shape, cell.x, cell.y).y);
    const pixels = await canvas(page).evaluate((element, point) =>
      Array.from((element as HTMLCanvasElement).getContext("2d")!.getImageData(Math.round(point.x) - 13, Math.round(point.y) - 13, 26, 26).data), at);
    return createHash("sha256").update(Uint8Array.from(pixels)).digest("hex");
  };
  const undo = (): Promise<void> => page.getByRole("toolbar", { name: "Board view" }).getByRole("button", { name: "Undo", exact: true }).click();
  const toggle = page.getByRole("button", { name: /^Autotile \(A\):/ });

  // The set is recognised by its file name, and every one of its 47 shapes is drawn from its own tiles.
  await page.locator(".tkr-tileset-browser select").selectOption("Tiles/AUTOTILES_Water.tst");
  const set = page.getByRole("region", { name: "Legacy autotile set" });
  await expect(set).toContainText("Original autotile set, recognised by its AUTOTILES_ file name");
  await expect(set.locator("[data-autotile-slot-item]")).toHaveCount(47);
  await expect(set.locator("canvas[data-autotile-slot]")).toHaveCount(47);
  await expect(set.locator(".tkr-tileset-browser-autotile-gap")).toHaveCount(0);
  await expect(set).not.toContainText("fewer than 52");
  const drawn = (slot: number): Promise<boolean> => set.locator(`canvas[data-autotile-slot="${slot}"]`).evaluate((element: HTMLCanvasElement) =>
    element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data.some((value, index) => index % 4 === 3 && value > 0));
  await expect.poll(() => drawn(52)).toBe(true);
  await expect.poll(() => drawn(51)).toBe(true);

  // Autotiling starts off, is switched on with the button or A, and the page says so.
  await page.locator('[data-browser-reference="AUTOTILES_Water.tst14"] .tkr-tileset-browser-source').click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(notes(page)).toHaveCount(0);
  await canvas(page).focus();
  await page.keyboard.press("a");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(notes(page).first()).toContainText("Autotiling is on for Draw and Erase, Fill and Rectangle on this board only");
  await expect(notes(page).first()).toContainText("Hold Shift to reshape only the set you are painting");
  await page.keyboard.down("Shift");
  await expect(notes(page).first()).toContainText("Shift is held: only cells of the set you are painting reshape");
  await page.keyboard.up("Shift");

  // A click seeds the isolated tile whichever tile of the set was picked (14), then its neighbour closes onto it.
  const empty = await picture(near(0, 0));
  await click(near(0, 0));
  await expect(tiles(page, "AUTOTILES_Water.tst51")).toHaveCount(1);
  await expect.poll(() => picture(near(0, 0)), { message: "the canvas draws the isolated tile" }).not.toBe(empty);
  const isolated = await picture(near(0, 0));
  await click(near(1, 0));
  await expect(tiles(page, "AUTOTILES_Water.tst48")).toHaveCount(1);
  await expect(tiles(page, "AUTOTILES_Water.tst50")).toHaveCount(1);
  await expect.poll(() => picture(near(0, 0)), { message: "the canvas shows the reshaped neighbour" }).not.toBe(isolated);
  await undo();
  await expect(tiles(page, "AUTOTILES_Water.tst51")).toHaveCount(1);
  await expect(tiles(page, "AUTOTILES_Water.tst48")).toHaveCount(0);
  await expect(tiles(page, "AUTOTILES_Water.tst50")).toHaveCount(0);
  await expect.poll(() => picture(near(0, 0)), { message: "one Undo takes the neighbour's reshape back with the click" }).toBe(isolated);
  await undo();
  await expect(tiles(page, "AUTOTILES_Water.tst51")).toHaveCount(0);

  // A filled 3 by 3 rectangle gives the hand-read shapes of the table, as one edit.
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const from = await where(near(-1, -1));
  const to = await where(near(1, 1));
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down("Control");
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  for (const [slot, count] of [[52, 1], [38, 1], [22, 1], [40, 1], [17, 1], [26, 1], [44, 1], [31, 1], [42, 1]] as const) {
    await expect(tiles(page, `AUTOTILES_Water.tst${slot}`), `tile ${slot}`).toHaveCount(count);
  }

  // Erasing the middle closes the ring around the hole; Undo opens it again.
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await click(near(0, 0));
  await expect(tiles(page, "AUTOTILES_Water.tst52")).toHaveCount(0);
  await expect(tiles(page, "AUTOTILES_Water.tst35")).toHaveCount(2);
  await expect(tiles(page, "AUTOTILES_Water.tst37")).toHaveCount(2);
  await undo();
  await expect(tiles(page, "AUTOTILES_Water.tst52")).toHaveCount(1);
  await expect(tiles(page, "AUTOTILES_Water.tst35")).toHaveCount(0);

  // An ordinary set is warned about and painted as it is, and its neighbour in the water loses its link.
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.locator(".tkr-tileset-browser select").selectOption("Tiles/Grass.tst");
  await page.locator('[data-browser-reference="Grass.tst1"] .tkr-tileset-browser-source').click();
  await expect(notes(page).filter({ hasText: "not an autotile set" })).toHaveCount(1);
  await click(near(0, 0));
  await expect(tiles(page, "Grass.tst1")).toHaveCount(1);
  await expect(tiles(page, "AUTOTILES_Water.tst52")).toHaveCount(0);
  await expect(tiles(page, "AUTOTILES_Water.tst35")).toHaveCount(2);

  // A set in a sub-folder, in lower case, counts too.
  await page.locator(".tkr-tileset-browser select").selectOption("Tiles/nested/autotiles_Marsh.tst");
  await expect(page.getByRole("region", { name: "Legacy autotile set" })).toContainText("recognised by its AUTOTILES_ file name");
  await page.locator('[data-browser-reference$="autotiles_Marsh.tst3"] .tkr-tileset-browser-source').click();
  await expect(notes(page).filter({ hasText: "not an autotile set" })).toHaveCount(0);
  await click(near(-3, 2));
  await expect(page.getByRole("button", { name: /: nested\\autotiles_Marsh\.tst51$/ })).toHaveCount(1);

  // Any other set can be marked without renaming it; a short set names the shapes it is missing, as gaps, and warns.
  await page.locator(".tkr-tileset-browser select").selectOption("Tiles/village.tst");
  const ordinary = page.getByRole("region", { name: "Legacy autotile set" });
  await expect(ordinary).toContainText("Ordinary tileset");
  await expect(ordinary.locator("[data-autotile-slot-item]")).toHaveCount(0);
  await ordinary.getByRole("checkbox").check();
  await expect(ordinary).toContainText("Marked as a legacy 52-slot autotile set");
  await expect(ordinary).toContainText("This set has 2 tiles, fewer than 52");
  await expect(ordinary.locator(".tkr-tileset-browser-autotile-gap")).toHaveCount(45);
  await expect(ordinary.locator("canvas[data-autotile-slot]")).toHaveCount(2);
  await expect(notes(page).filter({ hasText: "fewer than 52, so shapes 3, 4, 5" })).toHaveCount(1);
  await click(near(3, -2));
  await expect(tiles(page, "village.tst51")).toHaveCount(1);
  await ordinary.getByRole("checkbox").uncheck();
  await expect(ordinary).toContainText("Ordinary tileset");

  // The board stores ordinary tile references; nothing marks them as autotiles.
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(state(page)).toHaveText("All changes saved");
  const read = readBoard(new BinaryReader(await readFolderFile(page, "Boards/meadow.brd")));
  expect(read.ok).toBe(true);
  if (read.ok) {
    const at = (cell: Cell): string => read.value.lut[read.value.tileMatrix[cell.y * 8 + cell.x]!]!;
    expect(at(near(-1, -1))).toBe("AUTOTILES_Water.tst39"); // S E, its SE corner replaced by grass
    expect(at(near(1, 0))).toBe("AUTOTILES_Water.tst35");
    expect(at(near(-3, 2))).toBe("nested\\autotiles_Marsh.tst51");
    expect(at(near(3, -2))).toBe("village.tst51");
  }
  expect(await page.evaluate(() => (window as ProofWindow).__tkrCspViolations ?? [])).toEqual([]);
});

test("native terrain: the scene editor lists each terrain's rules, names the neighbourhoods with no tile, and the build reports one that is painted", async ({ page }) => {
  test.setTimeout(90_000);
  const input = (path: string, value: string | Uint8Array): PickerInput => ({ path, bytes: [...(typeof value === "string" ? new TextEncoder().encode(value) : value)] });
  const tile = (name: string, x: number): string => `contract: tile\nversion: 1.0.0-pre.1\nname: ${name}\nprojection: 2d\nrole: floor\nvisual:\n  transparent: {mode: alpha}\n  sample: {file: Tiles/sheet.png, rect: [${x},0,32,32]}\n`;
  const rgba = new Uint8Array(64 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) rgba.set(x < 32 ? [20, 80, 160, 255] : [140, 90, 30, 255], (64 * y + x) * 4);
  const recipe = (id: string, coverage: string, rules: string) => `  - id: ${id}\n    name: ${id[0]!.toUpperCase()}${id.slice(1)}\n    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}\n    neighbours: cardinal-4\n    coverage: ${coverage}\n    sync: independent\n    rules: ${rules}\n`;
  const main = writeMainFile({ ...createEmptyMainFile(), major: 2, minor: 9, initBoard: "configured-start.brd", initChar: "", startupPrg: "" });
  expect(main.ok).toBe(true);
  await installFolder(page, [
    input("Main/test.gam", main.ok ? main.value : new Uint8Array()),
    input("Boards/pond.tkrscn", "contract: scene\nversion: 1.0.0-pre.2\nprojection: 2d\nsize: {width: 4, height: 3}\nfloors:\n  - id: ground\nstart: {x: 16, y: 31, floor: ground}\n"),
    input("Tiles/water.tkrtle", tile("Water", 0)),
    input("Tiles/bank.tkrtle", tile("Bank", 32)),
    input("Tiles/sheet.png", encodeScenePng({ w: 64, h: 32, rgba })),
    input("Tiles/pond.tkrtst", `contract: tileset\nversion: 1.0.0-pre.2\nname: Pond\nexpects: {projection: 2d, cellSize: [32,32]}\ntiles: [{tile: Tiles/water.tkrtle}, {tile: Tiles/bank.tkrtle}]\nterrains:\n${
      recipe("shore", "partial", "[{id: east, when: {e: same}, use: {tile: Tiles/water.tkrtle}}]")}${
      recipe("lake", "complete", "[{id: any, when: {}, use: {tile: Tiles/water.tkrtle}}]")}outputBinding:\n  target: Tiles/pond.tst\n  detail: 1\n  slots: [{slot: 1, tile: Tiles/water.tkrtle}, {slot: 2, tile: Tiles/bank.tkrtle}]\n`),
  ]);
  await page.goto(EDITOR_URL);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toBeVisible();
  const row = page.getByRole("treeitem", { name: /^Boards, folder/ });
  if (await row.getAttribute("aria-expanded") !== "true") await row.dblclick();
  await page.getByRole("treeitem", { name: /^pond\.tkrscn,/ }).dblclick();
  const editor = page.getByRole("region", { name: "Scene terrain editor" });
  await editor.getByRole("combobox", { name: "Tileset", exact: true }).selectOption("Tiles/pond.tkrtst");

  const roles = editor.getByRole("region", { name: "Native terrain roles" });
  await expect(roles).toContainText("Native terrain rules: Shore");
  await expect(roles).toContainText("Four neighbours, partial coverage: 8 of 16 neighbourhoods have a tile");
  await expect(roles).toContainText("east: e same uses Tiles/water.tkrtle (8 neighbourhoods)");
  await expect(roles).toContainText("Missing role assignments: isolated; n; s; n+s; w; n+w; s+w; n+s+w");
  await expect(roles).toContainText("not the legacy 52-slot order");
  await editor.getByRole("combobox", { name: "Terrain", exact: true }).selectOption({ label: "Lake" });
  await expect(roles).toContainText("Native terrain rules: Lake");
  await expect(roles).toContainText("16 of 16 neighbourhoods have a tile");
  await expect(roles).toContainText("Every neighbourhood has a tile");

  // Painting the partial terrain over two cells puts a cell with only a west neighbour where no rule has a tile.
  await editor.getByRole("combobox", { name: "Terrain", exact: true }).selectOption({ label: "Shore" });
  await editor.getByRole("radio", { name: "Paint rectangle" }).check();
  await editor.getByRole("button", { name: /^Cell 0, 0:/ }).click();
  await editor.getByRole("button", { name: /^Cell 1, 0:/ }).click();
  await editor.getByRole("button", { name: "Preview build", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "No tile rule matches ground at (1, 0)" })).toBeVisible();
  // The edit while the panel was open did not reset it: the same terrain and its rules are still shown.
  await expect(roles).toContainText("Native terrain rules: Shore");

  // A recipe edited behind the open scene is read again on refresh, and the panel shows the recipe as it is now.
  await page.evaluate(async () => {
    const root = (window as ProofWindow).__tkrTestFolder!;
    const handle = await (await root.getDirectoryHandle("Tiles")).getFileHandle("pond.tkrtst");
    const text = await (await handle.getFile()).text();
    const next = text
      .replace("coverage: partial", "coverage: complete")
      .replace("{id: east, when: {e: same}, use: {tile: Tiles/water.tkrtle}}", "{id: any, when: {}, use: {tile: Tiles/water.tkrtle}}");
    const writable = await handle.createWritable();
    await writable.write(next);
    await writable.close();
  });
  await editor.getByRole("button", { name: "Refresh terrain rules", exact: true }).click();
  await expect(roles).toContainText("Four neighbours, complete coverage: 16 of 16 neighbourhoods have a tile");
  await expect(roles).toContainText("Every neighbourhood has a tile");
  await expect(roles).not.toContainText("Missing role assignments");
  // The refresh is a no-op for the view itself: the same terrain stays chosen, and the diagnostic still changes nothing.
  await editor.getByRole("button", { name: "Refresh terrain rules", exact: true }).click();
  await expect(roles).toContainText("Native terrain rules: Shore");
  await expect(page.getByRole("tab", { name: /pond\.tkrscn, unsaved changes/ })).toBeVisible();
});
