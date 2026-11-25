// The VS Code Web half of the fresh-creator acceptance journey (Epic 12 / ticket 14): one real window starts with an
// empty destination, the real New project wizard makes the project, every authoring step below goes through the shipped
// custom editors and workbench commands, and the reviewed export is captured as exact bytes for the portable playback
// oracle. No step copies another authored game, and the player never sees this workspace.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BinaryReader, readAnimation, readBoard, readCharacter, readItem, readMainFile } from "@tk-reawakened/core";
import { tileBasePoint } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, Frame, Page } from "@playwright/test";

type Expect = typeof playwrightExpect;

export const CREATOR_PROJECT = "__tkr_creator_acceptance";
const WIZARD_GAME_NAME = "Acceptance Quest";
const GAME_TITLE = "Creator Acceptance Quest";
const RELEASE_VERSION = "1.0.0";
const MAIN = "Main/Quest.gam";
const BOARD = "Boards/start.brd";
const START_PROGRAM = "Prg/start.prg";
const NORTH_PROGRAM = "Prg/north.prg";
const ANIMATION = "Misc/hero-walk.anm";
const CHARACTER = "Chrs/start.tem";
const ITEM = "Item/charm.itm";
const TILESET = "Tiles/village.tst";
const UNKNOWN_SAME_VERSION_BYTES = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

/** What the portable playback oracle receives: only the bytes the reviewed export wrote. */
export interface CreatorAcceptanceArtifact {
  readonly archiveName: string;
  readonly archive: Uint8Array;
  readonly descriptor: Uint8Array;
}

export interface CreatorAcceptanceHost {
  readBacking(path: string): Promise<Uint8Array>;
  writeBacking(path: string, bytes: Uint8Array): Promise<void>;
  backingExists(path: string): Promise<boolean>;
}

const projectPath = (relative: string): string => `${CREATOR_PROJECT}/${relative}`;

function repositoryFixture(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../${relative}`, import.meta.url)));
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Seed only what a creator would already have on disk: source artwork (a format-example tileset and two authored GIF
 * frames) and a non-graphical item definition. The character is the wizard's own blank starter; append unknown
 * same-version bytes to it so the targeted edit can prove they survive. Every value the proof asserts is written by the
 * editors below, never by this seed.
 */
async function seedSourceArtwork(host: CreatorAcceptanceHost): Promise<void> {
  await host.writeBacking(projectPath(TILESET), repositoryFixture("docs/spec/examples/versions/tileset/tileset_detail1.tst"));
  const gif = repositoryFixture("packages/core/test/fixtures/authored/gif-anim89a.gif");
  await host.writeBacking(projectPath("Bitmap/a.gif"), gif);
  await host.writeBacking(projectPath("Bitmap/z.gif"), gif);
  await host.writeBacking(projectPath(ITEM), concat(repositoryFixture("docs/spec/examples/versions/item/item_minor7.itm"), UNKNOWN_SAME_VERSION_BYTES));
}

export async function runVscodeCreatorAcceptanceProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  host: CreatorAcceptanceHost,
): Promise<CreatorAcceptanceArtifact> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const consoleTail: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[editor-preview-trace]") || text.includes("[history-preview-trace]")) return;
    consoleTail.push(`[${message.type()}] ${text.slice(0, 400)}`);
    if (consoleTail.length > 200) consoleTail.shift();
  });

  const widget = page.locator(".quick-input-widget");
  const palette = async () => {
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(widget).toBeVisible();
    const input = widget.locator("input:visible");
    await expect(input).toHaveCount(1);
    return input;
  };
  const runCommand = async (title: string): Promise<void> => {
    const input = await palette();
    await input.fill(`>${title}`);
    const row = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(title)}(?:,|$)`) });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(widget).toBeHidden();
  };
  /** Open one project file through the probe's native vscode.open command, by absolute in-workspace path. */
  const openPath = async (relative: string): Promise<void> => {
    const input = await palette();
    await input.fill(">Test: Open Proof Project File");
    const command = page.getByRole("option", { name: /^Test: Open Proof Project File(?:,|$)/ });
    await expect(command).toHaveCount(1);
    await command.click();
    await expect(widget).toContainText("Workspace-relative proof file path");
    await input.fill(`/${projectPath(relative)}`);
    await input.press("Enter");
    await expect(widget).toBeHidden();
    await expect(page.getByRole("tab", { selected: true }).filter({ hasText: relative.slice(relative.lastIndexOf("/") + 1) })).toBeVisible({ timeout: 30_000 });
  };
  /** The one visible custom-editor frame carrying `selector`; the journey keeps one document editor open at a time. */
  const activeFrame = async (selector: string): Promise<Frame> => {
    let found: Frame | undefined;
    let visible = false;
    try {
      await expect.poll(async () => {
        for (const frame of page.frames()) {
          if (await frame.locator(`${selector}:visible`).count().catch(() => 0) === 0) continue;
          found = frame;
          return true;
        }
        return false;
      }, { timeout: 30_000 }).toBe(true);
      visible = true;
    } finally {
      if (!visible) {
        const tabs = await page.getByRole("tab").allInnerTexts().catch(() => []);
        const notifications = await page.locator(".notification-list-item").allInnerTexts().catch(() => []);
        const frames = await Promise.all(page.frames().map(async (frame) => {
          const counts = await Promise.all([".tkr-settings", ".tkr-sprite-graphics", ".tkr-animation-editor", selector]
            .map(async (candidate) => `${candidate}=${await frame.locator(candidate).count().catch(() => -1)}`));
          const text = (await frame.locator("body").innerText().catch(() => "")).replaceAll(/\s+/g, " ").slice(0, 240);
          const html = (await frame.locator("body").innerHTML().catch(() => "")).replaceAll(/\s+/g, " ").slice(0, 400);
          return `${frame.url().slice(0, 120)} ${counts.join(" ")} text=${text} html=${html}`;
        }));
        console.error(`[creator-acceptance] missing ${selector}\ntabs: ${JSON.stringify(tabs)}\nnotifications: ${JSON.stringify(notifications)}\nframes:\n${frames.join("\n")}\nconsole tail:\n${consoleTail.slice(-40).join("\n")}`);
        console.error(`[creator-acceptance] monaco visible: ${await page.locator(".monaco-workbench .monaco-editor:visible").count().catch(() => -1)}`);
      }
    }
    if (found === undefined) throw new Error(`The active VS Code custom editor (${selector}) was not found`);
    return found;
  };
  const closeActiveEditor = async (): Promise<void> => {
    // Close every group's editor so the next document's webview is the only candidate frame, never a retained stale one.
    await runCommand("View: Close All Editors");
    await expect(widget).toBeHidden();
    await expect.poll(async () => page.locator(".editor-group-container .tabs-container .tab").count(), { timeout: 15_000 }).toBe(0);
  };
  const decodeMain = async () => {
    const bytes = await host.readBacking(projectPath(MAIN));
    const read = readMainFile(new BinaryReader(bytes, MAIN));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const decodeBoard = async () => {
    const bytes = await host.readBacking(projectPath(BOARD));
    const read = readBoard(new BinaryReader(bytes, BOARD));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const decodeAnimation = async () => {
    const bytes = await host.readBacking(projectPath(ANIMATION));
    const read = readAnimation(new BinaryReader(bytes, ANIMATION));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const decodeCharacter = async () => {
    const bytes = await host.readBacking(projectPath(CHARACTER));
    const read = readCharacter(new BinaryReader(bytes, CHARACTER));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };
  const decodeItem = async () => {
    const bytes = await host.readBacking(projectPath(ITEM));
    const read = readItem(new BinaryReader(bytes, ITEM));
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };

  // The creator's real New project wizard, from an empty destination.
  const commandInput = await palette();
  await commandInput.fill(">RPG Toolkit: New project");
  const newProject = page.getByRole("option", { name: /^RPG Toolkit: New project(?:,|$)/ });
  await expect(newProject).toHaveCount(1);
  await newProject.click();
  await expect(widget).toContainText("Game name");
  const answer = widget.getByRole("textbox");
  await expect(answer).toBeVisible();
  await answer.fill(WIZARD_GAME_NAME);
  await expect(answer).toHaveValue(WIZARD_GAME_NAME);
  await answer.press("Enter");
  await expect(widget).toContainText("Main file name");
  await answer.fill("Quest.gam");
  await expect(answer).toHaveValue("Quest.gam");
  await answer.press("Enter");
  await expect(widget).toContainText("starter contents");
  await widget.getByRole("checkbox", { name: "Start-up program", exact: true }).check();
  await widget.getByRole("checkbox", { name: "Empty start board", exact: true }).check();
  await widget.getByRole("checkbox", { name: "Empty first character", exact: true }).check();
  await widget.getByRole("button", { name: "OK", exact: true }).click();
  await expect(widget).toContainText("New project: choose the destination folder", { timeout: 30_000 });
  // The picker can finish listing the root after its input appears, overwriting a path typed too soon.
  // Enter the seeded directory through its native row and wait for the child listing, not just the editable text.
  const destination = widget.getByRole("option", { name: CREATOR_PROJECT, exact: true });
  await expect(destination).toBeVisible({ timeout: 30_000 });
  await destination.click();
  await expect(answer).toHaveValue(`/${CREATOR_PROJECT}/`, { timeout: 30_000 });
  await expect(widget.getByRole("option", { name: "..", exact: true })).toBeVisible({ timeout: 30_000 });
  await widget.getByRole("button", { name: "Create project here", exact: true }).click();
  await expect(widget).toBeHidden();
  // Destination files appear before progress is durable; the automatic open follows the completed wizard.
  await expect(page.getByRole("tab", { name: /^Quest\.gam(?:,|$)/, selected: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await decodeMain()).gameTitle, { timeout: 30_000 }).toBe(WIZARD_GAME_NAME);
  const generated = await decodeMain();
  expect(generated.startupPrg).toBe("start.prg");
  expect(generated.initBoard).toBe("start.brd");
  expect(generated.initChar).toBe("start.tem");
  // Destination files can appear before progress is durable; the wizard's own starter files must land before authoring.
  await expect.poll(async () => (await host.backingExists(projectPath(BOARD)))
    && (await host.backingExists(projectPath(START_PROGRAM)))
    && (await host.backingExists(projectPath(CHARACTER))), { timeout: 30_000 }).toBe(true);

  await seedSourceArtwork(host);

  // Game settings: a cancelled staging leaves the file untouched, then the authored values are applied by keyboard and saved.
  const settings = await activeFrame(".tkr-settings");
  const titleField = settings.getByLabel("Game title", { exact: true });
  await expect(titleField).toHaveValue(WIZARD_GAME_NAME);
  const mainBefore = await host.readBacking(projectPath(MAIN));
  await titleField.fill("Cancelled acceptance title");
  const cancelChanges = settings.getByRole("button", { name: "Cancel changes", exact: true });
  await expect(cancelChanges).toBeEnabled();
  await cancelChanges.click();
  await expect(titleField).toHaveValue(WIZARD_GAME_NAME);
  await expect(settings.locator(".tkr-settings-state")).toHaveText("All changes saved");
  expect(await host.readBacking(projectPath(MAIN)), "cancelling the staged settings left the bytes untouched").toEqual(mainBefore);
  // The wizard authored the startup references; assert them before changing the one setting this lane authors (the title).
  await expect(settings.getByLabel("Initial board", { exact: true })).toHaveValue("start.brd");
  await expect(settings.getByLabel("Initial character", { exact: true })).toHaveValue("start.tem");
  await expect(settings.getByLabel("Start program", { exact: true })).toHaveValue("start.prg");
  await titleField.fill(GAME_TITLE);
  await expect(settings.locator(".tkr-settings-staged")).toContainText("1 staged setting is not applied yet");
  const applySettings = settings.getByRole("button", { name: "Apply changes", exact: true });
  await applySettings.click();
  await expect(settings.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await expect.poll(async () => (await decodeMain()).gameTitle).toBe(GAME_TITLE);
  await expect.poll(async () => (await decodeMain()).initChar).toBe("start.tem");
  expect(await host.readBacking(projectPath(MAIN))).not.toEqual(mainBefore);

  // Board tiles and stamp: the shared brush paints a cell through the editor's own stamp action, and a second cell is
  // typed into the board's accessible tile field. Both are the controls the shipped browser host uses, so no canvas
  // geometry has to be inferred from a layout that the tileset browser can resize.
  await openPath(BOARD);
  let boardEditor = await activeFrame(".tkr-board");
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  const boardBefore = await decodeBoard();
  const shape = { sizeX: boardBefore.sizeX, sizeY: boardBefore.sizeY, coordType: boardBefore.coordType };
  const canvas = boardEditor.locator("canvas.tkr-board-canvas");
  await boardEditor.getByLabel("Source", { exact: true }).selectOption({ label: "village.tst (tst)" });
  const stamp = boardEditor.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source');
  await stamp.click();
  await expect(stamp).toHaveAttribute("aria-pressed", "true");
  const stampCell = boardEditor.getByRole("button", { name: /^Column 4, row 4: / });
  await stampCell.click();
  // The editor acknowledges the selected cell before any follow-up action is dispatched.
  await expect(stampCell).toHaveClass(/tkr-board-cell-selected/);
  const paint = boardEditor.getByRole("button", { name: /^Paint village\.tst tile 2 here$/ });
  await expect(paint).toBeVisible();
  await paint.click();
  await expect(boardEditor.getByRole("button", { name: "Column 4, row 4: village.tst2", exact: true })).toBeVisible();
  const typedCell = boardEditor.getByRole("button", { name: /^Column 5, row 4: / });
  await typedCell.click();
  await expect(typedCell).toHaveClass(/tkr-board-cell-selected/);
  const tileField = boardEditor.locator(".tkr-board-cell-row input");
  await expect(tileField).toHaveValue("");
  await typedCell.press("Enter");
  await expect(tileField).toBeVisible();
  await expect(tileField).toBeFocused();
  await page.keyboard.type("village.tst1");
  await expect(tileField).toHaveValue("village.tst1");
  await page.keyboard.press("Enter");
  await expect(boardEditor.getByRole("button", { name: "Column 5, row 4: village.tst1", exact: true })).toBeVisible();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  await expect.poll(async () => (await decodeBoard()).tileMatrix.filter((index) => index !== 0).length).toBeGreaterThanOrEqual(2);
  const stamped = await decodeBoard();
  expect(stamped.tileMatrix.filter((index) => index !== 0).map((index) => stamped.lut[index]).sort()).toEqual(["village.tst1", "village.tst2"]);

  // Board links and the authored player start. The start is applied and confirmed first: the general Apply writes the
  // document's current start, so dispatching both back-to-back lets that older value race over the new one.
  const properties = boardEditor.locator(".tkr-board-properties");
  await properties.locator("summary").click();
  await expect(properties).toHaveAttribute("open", "");
  await properties.getByLabel("Start column", { exact: true }).fill("2");
  await properties.getByLabel("Start row", { exact: true }).fill("2");
  await properties.getByLabel("Start layer", { exact: true }).fill("1");
  await expect(properties.getByLabel("Start column", { exact: true })).toHaveValue("2");
  await expect(properties.getByLabel("Start row", { exact: true })).toHaveValue("2");
  await expect(properties.getByLabel("Start layer", { exact: true })).toHaveValue("1");
  const applyStart = properties.getByRole("button", { name: "Apply player start", exact: true });
  await applyStart.click();
  const startMarker = properties.getByRole("status").filter({ hasText: "Player start marker: column 2, row 2, layer 1" });
  await expect(startMarker).toBeVisible();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await properties.getByLabel("North link", { exact: true }).fill("north.prg");
  await expect(properties.getByLabel("North link", { exact: true })).toHaveValue("north.prg");
  const applyProperties = properties.getByRole("button", { name: "Apply", exact: true });
  await applyProperties.click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  const startPoint = tileBasePoint(shape, { x: 1, y: 1 });
  await expect.poll(async () => (await decodeBoard()).properties.start).toEqual({ ...startPoint, layer: 1 });
  expect((await decodeBoard()).links.north).toBe("north.prg");

  // Board objects: an item-backed sprite (character/item placement) and an image object, placed on the canvas centre.
  const inspector = boardEditor.locator(".tkr-board-objects:visible");
  const clickCanvasCentre = async (): Promise<void> => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (box === null) throw new Error("The board canvas is not on the page");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  await boardEditor.locator('[data-board-mode="sprites"]').click();
  await boardEditor.locator('[data-tool="draw"]').click();
  await clickCanvasCentre();
  await expect(inspector.getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await inspector.getByLabel("Item definition", { exact: true }).fill("charm.itm");
  await inspector.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await decodeBoard()).sprites.some((sprite) => sprite.itemFile === "charm.itm")).toBe(true);
  await boardEditor.locator('[data-board-mode="images"]').click();
  await boardEditor.locator('[data-tool="draw"]').click();
  await clickCanvasCentre();
  await expect(inspector.getByLabel("Stored slot", { exact: true })).toHaveValue("0");
  await inspector.getByLabel("Image file", { exact: true }).fill("a.gif");
  await inspector.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await expect(canvas).toHaveAttribute("aria-busy", "false");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await decodeBoard()).images.some((image) => image.file === "a.gif")).toBe(true);
  await closeActiveEditor();

  // Animation: the real New animation command, two sorted source images, then the editor's Save.
  const animationCommand = await palette();
  await animationCommand.fill(">TK Reawakened: New animation");
  const animationRow = page.getByRole("option", { name: /^TK Reawakened: New animation(?:,|$)/ });
  await expect(animationRow).toHaveCount(1);
  await animationRow.click();
  const animationInput = page.getByRole("textbox", { name: "New animation" });
  // A multi-root window asks which project first; a single-folder window goes straight to the destination input.
  const folderOption = widget.getByRole("option").filter({ hasText: CREATOR_PROJECT }).first();
  let animationMode: "input" | "folder" | "none" = "none";
  const animationDeadline = Date.now() + 30_000;
  while (Date.now() < animationDeadline) {
    if (await animationInput.isVisible().catch(() => false)) { animationMode = "input"; break; }
    if (await folderOption.isVisible().catch(() => false)) { animationMode = "folder"; break; }
    await page.waitForTimeout(100);
  }
  if (animationMode === "none") {
    console.error("[creator-acceptance] animation command widget:", await widget.innerText().catch(() => "<no widget>"));
    console.error("[creator-acceptance] notifications:", await page.locator(".notification-list-item").allInnerTexts().catch(() => []));
    throw new Error("The New animation command showed neither a workspace folder picker nor its destination input");
  }
  if (animationMode === "folder") await folderOption.click();
  await expect(animationInput).toBeVisible();
  await animationInput.fill(ANIMATION);
  await expect(animationInput).toHaveValue(ANIMATION);
  await animationInput.press("Enter");
  const animationEditor = await activeFrame(".tkr-animation-editor");
  await animationEditor.locator("summary").filter({ hasText: "Build from sorted Bitmap images" }).click();
  await animationEditor.getByRole("checkbox", { name: "a.gif", exact: true }).check();
  await animationEditor.getByRole("checkbox", { name: "z.gif", exact: true }).check();
  await animationEditor.getByRole("button", { name: "Insert selected sorted images", exact: true }).click();
  const consent = page.getByRole("dialog");
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Replace", exact: true }).click();
  await expect.poll(async () => (await decodeAnimation()).frames.map((frame) => frame.image)).toEqual(["a.gif", "z.gif"]);
  await animationEditor.getByRole("button", { name: "Save", exact: true }).click();
  await closeActiveEditor();

  // Character: authored name, health and walk animation in the real settings editor.
  const characterBefore = await decodeCharacter();
  expect(characterBefore.minor).toBe(8);
  await openPath(CHARACTER);
  const characterEditor = await activeFrame(".tkr-sprite-graphics");
  const walk = characterEditor.getByRole("group", { name: "Directional walk animations" });
  const southWalk = walk.getByLabel("South animation file");
  await southWalk.fill(ANIMATION);
  await southWalk.press("Tab");
  const characterAuthoring = characterEditor.getByRole("region", { name: "Character authoring" });
  await characterAuthoring.getByLabel("Character name", { exact: true }).fill("Acceptance Hero");
  await characterAuthoring.getByLabel("Character name", { exact: true }).press("Tab");
  await characterAuthoring.getByLabel("Health (HP)", { exact: true }).fill("77");
  await characterAuthoring.getByLabel("Health (HP)", { exact: true }).press("Tab");
  await expect(characterEditor.getByText(/Character change recorded\. Save the document to keep it\./)).toBeVisible();
  await runCommand("Test: Save All Workbench Editors");
  await expect.poll(async () => (await decodeCharacter()).name).toBe("Acceptance Hero");
  const savedCharacter = await decodeCharacter();
  expect(savedCharacter.stats.hp).toBe(77);
  expect(savedCharacter.movementAnimations?.[0]).toBe(ANIMATION);
  expect(savedCharacter.minor).toBe(characterBefore.minor);
  await closeActiveEditor();

  // Item: authored walk animation (the board sprite's direction group) and its placement above; the unknown bytes must survive.
  await openPath(ITEM);
  const itemEditor = await activeFrame(".tkr-sprite-graphics");
  const itemWalk = itemEditor.getByRole("group", { name: "Directional walk animations" });
  const southItemWalk = itemWalk.getByLabel("South animation file");
  await southItemWalk.fill(ANIMATION);
  await southItemWalk.press("Tab");
  await expect(itemEditor.getByText(/Graphics change recorded\. Save the document to keep it\./)).toBeVisible();
  await runCommand("Test: Save All Workbench Editors");
  await expect.poll(async () => (await decodeItem()).movementAnimations?.[0]).toBe(ANIMATION);
  const savedItem = await decodeItem();
  expect(savedItem.residue, "the targeted edit kept the unknown same-version bytes").toEqual(UNKNOWN_SAME_VERSION_BYTES);
  await closeActiveEditor();

  // RPGCode: a keyboard edit of the start-up program and a new linked program created by the real command.
  await openPath(START_PROGRAM);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: "start.prg" })).toBeVisible();
  const monaco = page.locator(".monaco-workbench .monaco-editor:visible").last();
  await expect(monaco.locator(".view-lines")).toBeVisible({ timeout: 30_000 });
  await monaco.click();
  await page.keyboard.press("ControlOrMeta+a");
  // The startup program runs before the first board and ends; the engine then boots initBoard at the board's authored
  // player start. No key press or send() is needed, so playback observes the authored board start directly. The linked
  // north program below carries the authored executable RPGCode.
  await page.keyboard.type("// Creator acceptance start-up: the authored board is the first board.\n");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(async () => new TextDecoder().decode(await host.readBacking(projectPath(START_PROGRAM)))).toContain("Creator acceptance start-up");
  await closeActiveEditor();

  const newProgramCommand = await palette();
  await newProgramCommand.fill(">RPG Toolkit: New program");
  const newProgram = page.getByRole("option", { name: /^RPG Toolkit: New program(?:,|$)/ });
  await expect(newProgram).toHaveCount(1);
  await newProgram.click();
  await expect(widget).toContainText("New program: project");
  await widget.getByRole("option", { name: CREATOR_PROJECT, exact: true }).click();
  await expect(widget).toContainText("An external application could create this path");
  const newProgramInput = widget.getByRole("textbox");
  await newProgramInput.fill(NORTH_PROGRAM);
  await expect(newProgramInput).toHaveValue(NORTH_PROGRAM);
  await newProgramInput.press("Enter");
  await expect(widget).toBeHidden();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: "north.prg" })).toBeVisible({ timeout: 30_000 });
  const northEditor = page.locator(".monaco-workbench .monaco-editor:visible").last();
  await expect(northEditor.locator(".view-lines")).toBeVisible();
  await northEditor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type('message = "NORTH GATE"\nend()\n');
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(async () => new TextDecoder().decode(await host.readBacking(projectPath(NORTH_PROGRAM)))).toContain("NORTH GATE");
  await closeActiveEditor();

  // Reopen each saved document and assert the authored values survive the round trip before any export is reviewed.
  await openPath(MAIN);
  const reopenedSettings = await activeFrame(".tkr-settings");
  await expect(reopenedSettings.getByLabel("Game title", { exact: true })).toHaveValue(GAME_TITLE);
  await expect(reopenedSettings.getByLabel("Initial board", { exact: true })).toHaveValue("start.brd");
  await expect(reopenedSettings.getByLabel("Initial character", { exact: true })).toHaveValue("start.tem");
  await expect(reopenedSettings.getByLabel("Start program", { exact: true })).toHaveValue("start.prg");
  await closeActiveEditor();

  await openPath(CHARACTER);
  const reopenedCharacter = await activeFrame(".tkr-sprite-graphics");
  const reopenedAuthoring = reopenedCharacter.getByRole("region", { name: "Character authoring" });
  await expect(reopenedAuthoring.getByLabel("Character name", { exact: true })).toHaveValue("Acceptance Hero");
  await expect(reopenedAuthoring.getByLabel("Health (HP)", { exact: true })).toHaveValue("77");
  await expect(reopenedCharacter.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue(ANIMATION);
  await closeActiveEditor();

  await openPath(ITEM);
  const reopenedItem = await activeFrame(".tkr-sprite-graphics");
  await expect(reopenedItem.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file")).toHaveValue(ANIMATION);
  await closeActiveEditor();

  await openPath(ANIMATION);
  const reopenedAnimation = await activeFrame(".tkr-animation-editor");
  await expect(reopenedAnimation.getByRole("button", { name: "Frame 1: a.gif", exact: true })).toBeVisible();
  await expect(reopenedAnimation.getByRole("button", { name: "Frame 2: z.gif", exact: true })).toBeVisible();
  await closeActiveEditor();

  // Reopen the board, assert the saved authored values, and follow the saved link to its program and back.
  await openPath(BOARD);
  boardEditor = await activeFrame(".tkr-board");
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  const reopenedProperties = boardEditor.locator(".tkr-board-properties");
  await reopenedProperties.locator("summary").click();
  await expect(reopenedProperties.getByLabel("North link", { exact: true })).toHaveValue("north.prg");
  await expect(reopenedProperties.getByRole("status").filter({ hasText: "Player start marker: column 2, row 2, layer 1" })).toBeVisible();
  await expect.poll(async () => (await decodeBoard()).properties.start).toEqual({ ...startPoint, layer: 1 });
  await reopenedProperties.getByRole("button", { name: "Open North link", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: "north.prg" })).toBeVisible();
  await expect(page.locator(".monaco-workbench .monaco-editor:visible").last()).toContainText("NORTH GATE");
  await runCommand("TK Reawakened: Return to board");
  await activeFrame(".tkr-board");
  await closeActiveEditor();

  // The real reviewed export: the contributed command, its file dialog, its version question and its review modal.
  const openPackageCommand = async (): Promise<void> => {
    const packagePalette = await palette();
    await packagePalette.fill(">RPG Toolkit: Package game");
    const packageRow = page.getByRole("option", { name: /^RPG Toolkit: Package game(?:,|$)/ });
    await expect(packageRow).toHaveCount(1);
    await packageRow.click();
    const filePath = page.getByRole("textbox", { name: "Folder path" });
    await expect(filePath).toBeVisible({ timeout: 20_000 });
    await expect(async () => {
      await filePath.fill(`/${projectPath(MAIN)}`);
      await expect(filePath).toHaveValue(`/${projectPath(MAIN)}`, { timeout: 1_000 });
      await expect(page.getByRole("button", { name: "Choose game to package", exact: true })).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 30_000, intervals: [100, 250, 500, 1_000] });
    await page.getByRole("button", { name: "Choose game to package", exact: true }).click();
    await expect(widget).toBeVisible({ timeout: 15_000 });
    await expect(widget).toContainText("Enter the release version", { timeout: 15_000 });
    const version = widget.getByRole("textbox");
    await expect(version).toHaveCount(1);
    await version.fill(RELEASE_VERSION);
    await expect(version).toHaveValue(RELEASE_VERSION);
    await version.press("Enter");
    await expect(page.getByText(/Preflight passed:/)).toBeVisible({ timeout: 20_000 });
  };

  await openPackageCommand();
  // Cancelling the review produces no release.
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Preflight passed:/)).toBeHidden();
  expect(await host.backingExists(projectPath(".tkr-exports")), "a cancelled review wrote no release").toBe(false);

  await openPackageCommand();
  const review = page.locator(".monaco-dialog-box").filter({ hasText: "Preflight passed:" });
  await expect(review.getByText(/Included \(\d+\):/)).toBeVisible();
  await review.getByRole("button", { name: "Choose where to save…", exact: true }).click();
  const savePath = page.getByRole("textbox", { name: "Folder path" });
  await expect(savePath).toBeVisible({ timeout: 15_000 });
  const packageBase = GAME_TITLE.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const expectedPackageName = `${packageBase}.tpk`;
  // The dialog usually prefills the package's own name under the project's output folder; when the field is still empty
  // (observed in a converted multi-root window), enter the same value exactly once.
  if ((await savePath.inputValue()).trim() === "") await savePath.fill(`/.tkr-exports/${expectedPackageName}`);
  await expect(savePath).toHaveValue(new RegExp(`${escapeRegExp(expectedPackageName)}$`));
  const shownPath = await savePath.inputValue();
  const archiveName = shownPath.slice(shownPath.lastIndexOf("/") + 1);
  expect(archiveName).toBe(expectedPackageName);
  // VS Code shows the Save As path from the opened folder's root; the export lands in the project's own output folder.
  expect(shownPath.endsWith(`/.tkr-exports/${expectedPackageName}`)).toBe(true);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  const createFolder = page.getByRole("textbox", { name: "The folder .tkr-exports does not exist. Would you like to create it?" });
  await expect(createFolder).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText(/Package saved to .* and install descriptor saved to/).first()).toBeVisible({ timeout: 30_000 });

  const archive = new Uint8Array(await host.readBacking(projectPath(`.tkr-exports/${archiveName}`)));
  const descriptor = new Uint8Array(await host.readBacking(projectPath(`.tkr-exports/${archiveName}.json`)));
  const decodedDescriptor = JSON.parse(new TextDecoder().decode(descriptor)) as {
    file: string;
    sha256: string;
    size: number;
    title: string;
    version: string;
  };
  expect(decodedDescriptor.file).toBe(archiveName);
  expect(decodedDescriptor.size).toBe(archive.length);
  expect(decodedDescriptor.sha256).toBe(createHash("sha256").update(archive).digest("hex"));
  expect(decodedDescriptor.title).toBe(GAME_TITLE);
  expect(decodedDescriptor.version).toBe(RELEASE_VERSION);

  return { archiveName, archive, descriptor };
}
