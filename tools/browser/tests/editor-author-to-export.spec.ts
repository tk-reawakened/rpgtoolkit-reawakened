import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BinaryReader, readBoard, readCharacter, readItem, readMainFile, writeBoard } from "@tk-reawakened/core";
import { provePackagePlayback } from "@tk-reawakened/editor-vscode-test/package-playback";

// The Epic 12 creator acceptance journey in the shipped browser host: the real new-project wizard makes a folder,
// the creator saves edits through the real editors, reloads, exports the reviewed bytes, and plays only those bytes.
// Fixtures supply source artwork and the documented non-graphical item behaviour; no authored result is seeded.

interface ProofWindow extends Window {
  __tkrTestFolder?: FileSystemDirectoryHandle;
  __tkrPickerReady?: boolean;
}

const EDITOR = "/tools/browser/editor-web/index.html";
const MAIN = "Main/AcceptanceQuest.gam";
const ANIMATION = "Misc/hero_walk_s.anm";
const ITEM = "Item/chest.itm";
const START_BOARD = "Boards/start.brd";
const FIELD_BOARD = "Boards/field.brd";
const FIELD_SCENE = "Boards/field.tkrscn";
const PROGRAM = "Prg/start.prg";
const START_MARKER = "Authored acceptance start";
const RESIDUE = [231, 19, 87];

const tileset = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));
const gif = Array.from(readFileSync(new URL("../../../packages/core/test/fixtures/authored/gif-anim89a.gif", import.meta.url)));
const item = Array.from(readFileSync(new URL("../../../docs/spec/examples/versions/item/item_minor7.itm", import.meta.url)));

async function installEmptyDestination(page: Page, folder: string): Promise<void> {
  await page.addInitScript(async (name: string) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async () => root });
    (window as ProofWindow).__tkrTestFolder = root;
    Reflect.set(window, "__tkrPickerReady", true);
  }, folder);
}

async function readProjectFile(page: Page, folder: string, path: string): Promise<number[] | null> {
  return page.evaluate(async ({ name, file }: { readonly name: string; readonly file: string }) => {
    try {
      let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      const parts = file.split("/");
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const found = await (await directory.getFileHandle(parts.at(-1)!)).getFile();
      return Array.from(new Uint8Array(await found.arrayBuffer()));
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw error;
    }
  }, { name: folder, file: path });
}

async function writeProjectFile(page: Page, folder: string, path: string, bytes: readonly number[]): Promise<void> {
  await page.evaluate(async ({ name, file, data }: { readonly name: string; readonly file: string; readonly data: readonly number[] }) => {
    let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const parts = file.split("/");
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
    const writable = await (await directory.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }, { name: folder, file: path, data: bytes });
}

async function listFolder(page: Page, folder: string, path: string): Promise<readonly string[]> {
  return page.evaluate(async ({ name, folder: directoryPath }: { readonly name: string; readonly folder: string }) => {
    let directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    for (const part of directoryPath.split("/").filter(Boolean)) directory = await directory.getDirectoryHandle(part);
    const names: string[] = [];
    for await (const handle of directory.values()) names.push(handle.name);
    return names.sort();
  }, { name: folder, folder: path });
}

async function openFile(page: Page, path: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
  if (await tab.count()) {
    await tab.click();
  } else {
    for (const name of path.split("/").slice(0, -1)) {
      const folderRow = page.getByRole("treeitem", { name: new RegExp(`^${name}, folder`) });
      if (await folderRow.getAttribute("aria-expanded") !== "true") await folderRow.dblclick();
    }
    const name = path.split("/").at(-1)!;
    await page.getByRole("treeitem", { name: new RegExp(`^${name.replaceAll(".", "\\.")},`) }).dblclick();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Save the active editor and wait for its own acknowledgment, so the save completed its write, not just its click. */
async function saveActive(page: Page, path: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
  await expect(tab).toHaveAttribute("aria-label", `${path}, unsaved changes`);
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  await expect(tab).toHaveAttribute("aria-label", path);
}

/** Close a document after its save acknowledges, so Close does not ask to save it again (#3337). */
async function closeSaved(page: Page, path: string): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${path.replaceAll(".", "\\.")}(?:, unsaved changes)?$`) });
  await expect(tab).toHaveAttribute("aria-label", path);
  await page.getByRole("button", { name: `Close ${path}`, exact: true }).click();
}

function bytesOf(read: readonly number[] | null, path: string): Uint8Array {
  if (read === null) throw new Error(`${path} was not written`);
  return Uint8Array.from(read);
}

function decodeBoard(read: readonly number[] | null, path: string) {
  const parsed = readBoard(new BinaryReader(bytesOf(read, path)));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.error.message}`);
  return parsed.value;
}

function mainOf(read: readonly number[] | null): { readonly gameTitle: string; readonly startupPrg: string; readonly initBoard: string; readonly initChar: string } {
  const parsed = readMainFile(new BinaryReader(bytesOf(read, MAIN), MAIN));
  if (!parsed.ok) throw new Error(`${MAIN}: ${parsed.error.message}`);
  return parsed.value;
}

test.use({ actionTimeout: 15_000, screenshot: "only-on-failure" });

test("a fresh browser project is authored, reopened, reviewed, exported and played from its exact package bytes", async ({ page, browser }) => {
  // One creator journey crosses the wizard, six real editors, a page reload, packaging and an isolated player.
  test.setTimeout(480_000);
  page.setDefaultTimeout(15_000);
  const folder = `TkrAcceptance-${randomUUID()}`;
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await installEmptyDestination(page, folder);
  await page.goto(EDITOR);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);

  // The real wizard, from an empty destination, with only the starter contents this small game needs.
  await page.getByRole("button", { name: "New project…" }).click();
  const wizard = page.getByRole("dialog", { name: "New project" });
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("Game name").fill("Acceptance Quest");
  await expect(wizard.getByLabel("Main file")).toHaveValue("AcceptanceQuest.gam");
  for (const label of ["Start-up program", "Empty start board", "Empty first character", "Built-in menu and battle"]) {
    await wizard.getByLabel(label, { exact: true }).check();
  }
  await wizard.getByRole("button", { name: "Choose folder…" }).click();
  await expect(wizard.getByRole("status").filter({ hasText: /^TkrAcceptance-/ })).toBeVisible();
  await wizard.getByRole("button", { name: "Create project" }).click();
  await expect(wizard).toHaveCount(0);
  await expect(page.getByLabel("Game title")).toHaveValue("Acceptance Quest");

  // Game settings: a saved title, checked against the bytes rather than the form.
  await page.getByLabel("Game title").fill("Authored Acceptance");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await saveActive(page, MAIN);
  await expect.poll(async () => mainOf(asm(await readProjectFile(page, folder, MAIN))).gameTitle).toBe("Authored Acceptance");

  // Fixtures supply only source artwork and the documented item behaviour; every authored value below is UI work.
  await writeProjectFile(page, folder, "Tiles/village.tst", tileset);
  await writeProjectFile(page, folder, "Bitmap/hero.gif", gif);
  await writeProjectFile(page, folder, ITEM, item);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("treeitem", { name: /^Tiles, folder/ }).dblclick();
  await expect(page.getByRole("treeitem", { name: /^village\.tst,/ })).toBeVisible();

  // Animation: a cancelled creation writes nothing; the accepted one builds frames from a sorted image.
  await page.getByRole("button", { name: "New animation…", exact: true }).click();
  const animationDialog = page.getByRole("dialog");
  await animationDialog.getByRole("textbox").fill(ANIMATION);
  await animationDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await readProjectFile(page, folder, ANIMATION)).toBeNull();
  await page.getByRole("button", { name: "New animation…", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(ANIMATION);
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const animationEditor = page.getByRole("main", { name: "Animation editor" });
  await expect(animationEditor).toBeVisible();
  await animationEditor.getByText("Build from sorted Bitmap images", { exact: true }).click();
  await animationEditor.getByRole("checkbox", { name: /hero\.gif/ }).check();
  await animationEditor.getByRole("button", { name: "Insert selected sorted images", exact: true }).click();
  const replaceAnimation = page.getByRole("dialog").filter({ hasText: "Replace these files?" });
  await expect(replaceAnimation).toBeVisible();
  await replaceAnimation.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(replaceAnimation).toHaveCount(0);
  await expect(animationEditor.getByText("Animation created and saved.", { exact: true })).toBeVisible();
  expect(bytesOf(await readProjectFile(page, folder, ANIMATION), ANIMATION).byteLength).toBeGreaterThan(0);

  // Character graphics and authoring values, saved, closed and reopened.
  await openFile(page, "Chrs/start.tem");
  const characterGraphics = page.getByRole("region", { name: "character sprite graphics" });
  await characterGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file").fill(ANIMATION);
  await characterGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file").blur();
  const characterAuthoring = page.getByRole("region", { name: "Character authoring" });
  await characterAuthoring.getByLabel("Character name", { exact: true }).fill("Ada");
  await characterAuthoring.getByLabel("Character name", { exact: true }).blur();
  await characterAuthoring.getByLabel("Health (HP)", { exact: true }).fill("24");
  await characterAuthoring.getByLabel("Health (HP)", { exact: true }).blur();
  await expect(characterAuthoring.getByLabel("Character edit status")).toHaveText("Character change recorded. Save the document to keep it.");
  await saveActive(page, "Chrs/start.tem");
  await closeSaved(page, "Chrs/start.tem");
  await openFile(page, "Chrs/start.tem");
  await expect(characterGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue(ANIMATION);
  await expect(characterAuthoring.getByLabel("Character name", { exact: true })).toHaveValue("Ada");
  await expect(characterAuthoring.getByLabel("Health (HP)", { exact: true })).toHaveValue("24");
  const character = readCharacter(new BinaryReader(bytesOf(await readProjectFile(page, folder, "Chrs/start.tem"), "Chrs/start.tem")));
  if (!character.ok) throw new Error(character.error.message);
  expect(character.value.name).toBe("Ada");
  expect(character.value.movementAnimations?.[0]).toBe(ANIMATION);

  // Item graphics: the documented item document is supplied; its sprite assignment is authored here.
  await openFile(page, ITEM);
  const itemGraphics = page.getByRole("region", { name: "item sprite graphics" });
  await itemGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file").fill(ANIMATION);
  await itemGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file").blur();
  await expect(itemGraphics.getByText(/Graphics change recorded\. Save the document to keep it\./)).toBeVisible();
  await saveActive(page, ITEM);
  await closeSaved(page, ITEM);
  await openFile(page, ITEM);
  await expect(itemGraphics.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue(ANIMATION);
  const savedItem = readItem(new BinaryReader(bytesOf(await readProjectFile(page, folder, ITEM), ITEM)));
  if (!savedItem.ok) throw new Error(savedItem.error.message);
  expect(savedItem.value.movementAnimations?.[0]).toBe(ANIMATION);

  // A saved board with same-version bytes this editor does not know must keep them through a targeted tile edit.
  const generatedBoard = decodeBoard(await readProjectFile(page, folder, START_BOARD), START_BOARD);
  const withResidue = writeBoard({ ...generatedBoard, residue: Uint8Array.from(RESIDUE) });
  if (!withResidue.ok) throw new Error(withResidue.error.message);
  await writeProjectFile(page, folder, START_BOARD, [...withResidue.value]);

  // Tiles and stamp brush on the start board: one cell typed from the keyboard, one painted from a chosen brush.
  await openFile(page, START_BOARD);
  const board = page.locator(".tkr-editor-pane:not([hidden]) .tkr-board");
  await expect(board).toBeVisible();
  await board.locator('[data-board-mode="tiles"]').click();
  const firstCell = board.getByRole("button", { name: /^Column 1, row 1: / });
  await firstCell.click();
  await firstCell.press("Enter");
  const tileField = board.locator(".tkr-board-cell-row input");
  await expect(tileField).toBeFocused();
  await page.keyboard.type("village.tst1");
  await page.keyboard.press("Enter");
  await expect(board.getByRole("button", { name: "Column 1, row 1: village.tst1", exact: true })).toBeVisible();
  await board.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
  await board.getByRole("button", { name: /^Column 2, row 1: / }).click();
  await board.getByRole("button", { name: /^Paint village\.tst tile 2 here$/ }).click();
  await expect(board.getByRole("button", { name: "Column 2, row 1: village.tst2", exact: true })).toBeVisible();

  // Board objects: a sprite placed from the canvas and pointed at the supplied item definition.
  await board.locator('[data-board-mode="sprites"]').click();
  await board.locator('[data-tool="draw"]').click();
  const canvas = board.locator("canvas.tkr-board-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error("the board canvas is not visible");
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  const inspector = board.locator(".tkr-board-objects:visible");
  await expect(inspector.getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await inspector.getByLabel("Item definition", { exact: true }).fill("");
  await inspector.getByRole("button", { name: "Choose item", exact: true }).click();
  const picker = page.getByRole("dialog", { name: /Choose item/i });
  await picker.getByRole("option", { name: /chest\.itm/ }).click();
  await picker.getByRole("button", { name: /^Use .*chest\.itm/ }).click();
  await page.getByRole("button", { name: "Use it", exact: true }).click();
  await inspector.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(inspector.getByLabel("Item definition", { exact: true })).toHaveValue(/chest\.itm/);
  await saveActive(page, START_BOARD);
  await expect.poll(async () => {
    const savedBoard = decodeBoard(asm(await readProjectFile(page, folder, START_BOARD)), START_BOARD);
    return {
      residue: [...savedBoard.residue],
      tiles: savedBoard.lut.filter((reference) => reference === "village.tst1" || reference === "village.tst2"),
      sprite: savedBoard.sprites.some((sprite) => /chest\.itm/.test(sprite.itemFile)),
    };
  }).toEqual({ residue: RESIDUE, tiles: ["village.tst1", "village.tst2"], sprite: true });
  await closeSaved(page, START_BOARD);
  await expect(page.getByRole("tab", { name: START_BOARD, exact: true })).toHaveCount(0);

  // Cancelling the new-board dialog writes no board.
  const boardsBefore = await listFolder(page, folder, "Boards");
  await page.getByRole("button", { name: "New board…" }).click();
  const newBoard = page.getByRole("dialog", { name: "New board" });
  await newBoard.getByLabel("Name", { exact: true }).fill("discarded");
  await newBoard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(newBoard).toHaveCount(0);
  expect(await listFolder(page, folder, "Boards")).toEqual(boardsBefore);

  // A second board is made, imported once as a native scene, and edited natively; its first save replaces the board.
  await page.getByRole("button", { name: "New board…" }).click();
  const boardDialog = page.getByRole("dialog", { name: "New board" });
  await boardDialog.getByLabel("Name", { exact: true }).fill("field");
  await boardDialog.getByLabel("Width in tiles").fill("8");
  await boardDialog.getByLabel("Height in tiles").fill("8");
  await boardDialog.getByLabel("Layers").fill("2");
  await boardDialog.getByRole("button", { name: "Create board" }).click();
  const fieldBoard = page.locator(".tkr-editor-pane:not([hidden]) .tkr-board");
  await expect(fieldBoard).toBeVisible();
  await expect(fieldBoard.locator(".tkr-board-state")).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Import as Scene…", exact: true }).dispatchEvent("click");
  const importReview = page.getByRole("dialog").filter({ hasText: `Import ${FIELD_BOARD} as a scene?` });
  await importReview.getByRole("button", { name: "Import as Scene", exact: true }).click();
  await expect(page.getByRole("tab", { name: FIELD_SCENE, exact: true })).toHaveAttribute("aria-selected", "true");
  const scene = page.getByRole("region", { name: "Scene terrain editor" });
  await scene.getByRole("radio", { name: "Manual empty" }).check();
  const sceneCell = scene.getByRole("button", { name: /^Cell 0, 0:/ }).first();
  await sceneCell.click();
  await expect(sceneCell).toHaveAccessibleName(/empty override/);
  // The scene save holds a conflict dialog open until it is authorized, so its completion is the reported build.
  await page.getByRole("button", { name: "Save active editor", exact: true }).click();
  const authorize = page.getByRole("dialog").filter({ hasText: "Generated outputs conflict with existing project files." });
  await authorize.getByRole("button", { name: "Authorize listed outputs", exact: true }).click();
  await expect(page.getByText("Scene saved and board built.", { exact: true })).toBeVisible();
  expect(await readProjectFile(page, folder, FIELD_SCENE)).not.toBeNull();

  // Links and start: the scene-built board becomes the game's first board, and the main file is saved.
  await openFile(page, FIELD_BOARD);
  await expect(fieldBoard).toBeVisible();
  await expect(fieldBoard.locator(".tkr-board-state")).toHaveText("All changes saved");
  await fieldBoard.locator("summary", { hasText: "Board properties" }).click();
  await fieldBoard.getByRole("button", { name: "Set as initial board", exact: true }).click();
  const setInitial = page.getByRole("dialog").filter({ hasText: FIELD_BOARD });
  await setInitial.getByRole("button", { name: "Set initial board", exact: true }).click();
  await openFile(page, MAIN);
  await saveActive(page, MAIN);

  // RPGCode: replace the starter program with authored text through the real text editor.
  await openFile(page, PROGRAM);
  const editor = page.locator(".tkr-editor-pane:not([hidden]) .monaco-editor");
  await expect(editor).toBeVisible();
  await editor.locator(".view-line").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("// Authored in the browser host acceptance lane.");
  await page.keyboard.press("Enter");
  await page.keyboard.type(`mwin("${START_MARKER}")`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("wait()");
  await page.keyboard.press("Enter");
  await page.keyboard.type("mwincls()");
  await expect(page.getByRole("region", { name: `Program ${PROGRAM}` }).getByRole("status")).toHaveText("Unsaved changes");
  await expect.poll(() => editorText(page)).toContain(START_MARKER);
  await saveActive(page, PROGRAM);
  await expect.poll(async () => new TextDecoder("latin1").decode(bytesOf(await readProjectFile(page, folder, PROGRAM), PROGRAM))).toContain(START_MARKER);

  // Reopen the whole project after a page reload; the saved values and the main file's links must still resolve.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__tkrPickerReady"))).toBe(true);
  await page.getByRole("button", { name: "Open project folder", exact: true }).click();
  await expect(page.getByLabel("Game title")).toHaveValue("Authored Acceptance");
  const main = mainOf(await readProjectFile(page, folder, MAIN));
  expect(main.gameTitle).toBe("Authored Acceptance");
  expect(main.initBoard).toBe("field.brd");
  expect(main.startupPrg).toBe("start.prg");
  expect(main.initChar).toBe("start.tem");
  for (const [linked, name] of [["Boards", main.initBoard], ["Prg", main.startupPrg], ["Chrs", main.initChar]] as const) {
    expect(bytesOf(await readProjectFile(page, folder, `${linked}/${name}`), `${linked}/${name}`).byteLength).toBeGreaterThan(0);
  }
  await openFile(page, FIELD_BOARD);
  await openFile(page, PROGRAM);
  await expect.poll(() => editorText(page)).toContain(START_MARKER);
  await openFile(page, "Chrs/start.tem");
  await expect(page.getByRole("region", { name: "character sprite graphics" }).getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue(ANIMATION);

  // Export review: closing the reviewed panel releases nothing; accepting yields the archive and its descriptor.
  await page.getByRole("button", { name: "Package game…", exact: true }).click();
  const packagePanel = page.getByRole("group", { name: "Package game" });
  await packagePanel.getByLabel("Release version").fill("1.0.0");
  await packagePanel.getByRole("button", { name: "Prepare package", exact: true }).click();
  await expect(page.locator(".tkr-files-package-status")).toContainText("Preflight passed");
  await packagePanel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(packagePanel).toHaveCount(0);
  expect(downloads, "closing the review released no archive").toBe(0);

  await page.getByRole("button", { name: "Package game…", exact: true }).click();
  const acceptedPanel = page.getByRole("group", { name: "Package game" });
  await acceptedPanel.getByLabel("Release version").fill("1.0.0");
  await acceptedPanel.getByRole("button", { name: "Prepare package", exact: true }).click();
  await expect(page.locator(".tkr-files-package-status")).toContainText("Preflight passed");
  await acceptedPanel.getByLabel("I reviewed the included and excluded files.").check();
  const archiveWaiting = page.waitForEvent("download");
  await acceptedPanel.getByRole("button", { name: /^Download .+\.tpk$/ }).click();
  const archiveDownload = await archiveWaiting;
  const archiveName = archiveDownload.suggestedFilename();
  const archive = readFileSync(await archiveDownload.path());
  const descriptorWaiting = page.waitForEvent("download");
  await acceptedPanel.getByRole("button", { name: `Download ${archiveName}.json`, exact: true }).click();
  const descriptorDownload = await descriptorWaiting;
  const descriptor = readFileSync(await descriptorDownload.path());
  const descriptorRecord = JSON.parse(descriptor.toString("utf8")) as { readonly file?: string; readonly size?: number; readonly sha256?: string };
  expect(descriptorRecord.file).toBe(archiveName);
  expect(descriptorRecord.size).toBe(archive.byteLength);
  expect(descriptorRecord.sha256).toBe(await page.evaluate(async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }, [...archive]));

  // The player may not read the editor's source folder: remove it before the isolated run.
  await page.evaluate(async (name: string) => {
    await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true });
  }, folder);
  expect(await page.evaluate(async (name: string) => {
    try {
      await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }, folder)).toBe(false);

  // A fresh context with no OPFS source boots only the served archive, enters the authored board, and walks.
  const isolated = await browser.newContext();
  try {
    const playback = await isolated.newPage();
    await provePackagePlayback(playback, expect, {
      archiveName,
      archive: Uint8Array.from(archive),
      descriptor: Uint8Array.from(descriptor),
    }, {
      board: "boards/field.brd",
      startupKey: "Enter",
      beforeStartupKey: async (playback, check) => {
        await check.poll(() => playback.evaluate(() => {
          const session = Reflect.get(window, "__session") as {
            readonly engine?: { drawList(): { readonly commands: readonly { readonly kind: string; readonly text?: string }[] } };
          } | undefined;
          const commands = session?.engine?.drawList().commands ?? [];
          return commands.filter((command) => command.kind === "text").map((command) => command.text ?? "").join(" ");
        }), { timeout: 15_000 }).toContain(START_MARKER);
      },
      movement: { key: "ArrowRight", axis: "x", direction: 1 },
    });
  } finally {
    await isolated.close();
  }
});

/** The Monaco text in line order, because Monaco recycles its line elements. */
function editorText(page: Page): Promise<string> {
  return page.locator(".tkr-editor-pane:not([hidden]) .monaco-editor .view-lines").evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>(".view-line")]
      .sort((left, right) => parseFloat(left.style.top) - parseFloat(right.style.top))
      .map((line) => line.innerText.replace(/\u00a0/g, " "))
      .join("\n"));
}

/** Narrow a possibly absent read for assertions that only run after an explicit write. */
function asm(read: readonly number[] | null): readonly number[] {
  if (read === null) throw new Error("the project file is missing");
  return read;
}
