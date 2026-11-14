import { BinaryReader, readBoard } from "@tk-reawakened/core";
import { boardExtent, boardToScreen, cellCentre, clampViewport, pixelToCell, screenToBoard, zoomTo, type BoardShape, type Cell, type Viewport } from "@tk-reawakened/editor-model";
import { autosaveSetting, combineProofErrors } from "./lifecycle.ts";

const copyBytesCommand = "Test: Copy Main File Bytes";

type Page = import("@playwright/test").Page;
type Expect = typeof import("@playwright/test").expect;
type Frame = import("@playwright/test").Frame;
type ProofWindow = Window & { __tkrCspViolations?: string[]; __tkrCspPositiveControlRan?: boolean };
type CspConsoleViolation = { text: string; url: string; lineNumber: number; columnNumber: number };
type ProofHost = {
  restart(page: Page, offlineBytes?: Uint8Array): Promise<Page>;
  readBacking(path?: string): Promise<Uint8Array>;
  readHostEvents(): { kind: "command" | "save" | "revert"; value: string }[];
  externalBytes: Uint8Array;
  sentinelTitle: string;
  sentinelBytes: Uint8Array;
  choice: "cancel" | "keep";
  boardPath: string;
  otherBoardPath: string;
  /** Boards of each coordinate layout (`coordType` 0, 1, 2), each 8 × 8 with two layers, for the canvas scenario. */
  canvasBoards: { path: string; label: string; coordType: number }[];
};

/** Run against vscode-test-web's actual browser workbench, not an extension-host mock. */
export async function runVscodeWebProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  gamePath: string,
  title: string,
  expectedBytes: Uint8Array,
  recoveredTitle: string,
  recoveredBytes: Uint8Array,
  autosaveTitle: string,
  autosaveBytes: Uint8Array,
  host: ProofHost,
): Promise<void> {
  const consoleViolations: CspConsoleViolation[] = [];
  const backupTrackerLogs: string[] = [];
  const observePage = (observed: Page) => {
    observed.on("console", (message) => {
      const text = message.text();
      if (/backup tracker|CommandService#executeCommand|No editors found for resource|Backup requires a valid storage path|Cannot backup in this state/i.test(text)) {
        backupTrackerLogs.push(`[console:${message.type()}] ${text}`);
      }
      if (message.type() !== "error" || !/Content Security Policy|security policy|script-src/i.test(text)) return;
      consoleViolations.push({ text, ...message.location() });
    });
    observed.on("pageerror", (error) => {
      if (/backup|working copy|hot exit|storage path/i.test(error.message)) backupTrackerLogs.push(`[pageerror] ${error.message}`);
    });
  };
  observePage(page);
  await page.context().addInitScript(() => {
    const target = window as ProofWindow;
    target.__tkrCspViolations = [];
    const seen = new WeakSet<Event>();
    const recordViolation = (event: Event) => {
      if (seen.has(event)) return;
      seen.add(event);
      target.__tkrCspViolations!.push((event as SecurityPolicyViolationEvent).effectiveDirective);
    };
    document.addEventListener("securitypolicyviolation", recordViolation, true);
    window.addEventListener("securitypolicyviolation", recordViolation, true);
  });
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await readCspViolations(page.mainFrame(), "browser workbench");
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await enableWorkbenchTraceLogging(page, expect);
  await openGame(page, gamePath, expect);

  const editor = await waitForEditorFrame(page, "initial Game settings editor");
  const titleField = editor.getByLabel("Game title");
  await expectVisibleWithFrameDiagnostics(page, titleField, expect, "initial Game title field");
  assertNoCspConsoleViolations(consoleViolations, "before installing the actual settings-document CSP listener");
  await instrumentCspFrame(editor);
  await assertCspListenerCountsBlockedAction(editor, expect, consoleViolations);
  const before = await readWorkspaceBytes(page, expect);
  await titleField.fill(title);
  await editor.getByRole("button", { name: "Save" }).click();
  const saved = await readWorkspaceBytes(page, expect);
  expect(saved).not.toEqual(before);
  expect(saved).toEqual(expectedBytes);
  expect(host.readHostEvents()).toContainEqual({ kind: "save", value: `/${gamePath}` });
  expect(host.readHostEvents()).toContainEqual({ kind: "command", value: "workbench.action.files.save" });
  await expect.poll(() => frameCspViolations(page, editor, consoleViolations)).toEqual([]);
  expect(await host.readBacking()).toEqual(saved);
  page = await host.restart(page);
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  expect(await host.readBacking()).toEqual(saved);

  await openGame(page, gamePath, expect);
  let reopenedEditor = await waitForEditorFrame(page, "reopened Game settings editor");
  assertNoCspConsoleViolations(consoleViolations, "before installing the reopened settings-document CSP listener");
  await instrumentCspFrame(reopenedEditor);
  await expectValueWithFrameDiagnostics(page, reopenedEditor.getByLabel("Game title"), title, expect);
  await enableWorkbenchTraceLogging(page, expect);
  const reopened = await readWorkspaceBytes(page, expect);
  expect(reopened).toEqual(saved);
  await expect.poll(() => frameCspViolations(page, reopenedEditor, consoleViolations)).toEqual([]);
  const sentinelPath = "__tkr_sentinel.gam";
  const sentinelBacking = await host.readBacking(sentinelPath);
  await openGame(page, sentinelPath, expect);
  await expect.poll(async () => {
    const active = await waitForEditorFrame(page, "sentinel editor activation");
    return await active.getByLabel("Game title").inputValue();
  }).not.toBe(title);
  let sentinelEditor = await waitForEditorFrame(page, "unrelated sentinel editor");
  const sentinelField = sentinelEditor.getByLabel("Game title");
  await sentinelField.click();
  await sentinelField.fill(host.sentinelTitle);
  await sentinelField.press("Enter");
  await expect(sentinelEditor.getByRole("status")).toHaveText("Unsaved changes");
  const sentinelTab = page.getByRole("tab").filter({ hasText: sentinelPath }).first();
  await expect(sentinelTab).toHaveClass(/dirty/);
  await expect.poll(() => backupIsStored(page, host.sentinelBytes), { timeout: 15_000 }).toBe(true);
  await page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first().click();
  reopenedEditor = await waitForTitledEditor(page, title, expect);
  const backupTraceStart = backupTrackerLogs.length;
  const recoveredTitleField = reopenedEditor.getByLabel("Game title");
  await recoveredTitleField.click();
  await recoveredTitleField.fill(recoveredTitle);
  await recoveredTitleField.press("Enter");
  await expectValueWithFrameDiagnostics(page, recoveredTitleField, recoveredTitle, expect);
  await expect(reopenedEditor.getByRole("status")).toHaveText("Unsaved changes");
  const dirtyEditorTab = page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first();
  await expect(dirtyEditorTab).toHaveClass(/dirty/);
  // The CI workspace sets files.autoSave=off so autosave cannot mask this hot-exit test.
  // The built-in backup tracker should create a backup after its 1s default / 2s short-auto-save delay.
  try {
    await expect.poll(
      () => backupTrackerLogs.slice(backupTraceStart).some((entry) => entry.includes("[backup tracker] creating backup")),
      { timeout: 15_000, message: "VS Code backup tracker did not start creating a backup after the final edit" },
    ).toBe(true);
  } catch (error) {
    const status = await reopenedEditor.getByRole("status").innerText().catch((readError) => `<unavailable: ${String(readError)}>`);
    const tabClass = await dirtyEditorTab.getAttribute("class").catch((readError) => `<unavailable: ${String(readError)}>`);
    const details = await backupDiagnostics(page, expect, backupTrackerLogs);
    await logFrameDiagnostics(page, "backup tracker did not begin creating the final dirty document's backup");
    throw new Error(`VS Code did not attempt a custom-document backup. Final editor status: ${status}; editor tab class: ${tabClass}\n${details}`, { cause: error });
  }
  await expect.poll(() => backupIsStored(page, recoveredBytes), {
    timeout: 15_000,
    message: "The exact recovered document was not committed to VS Code's independent IndexedDB backup store",
  }).toBe(true);


  page = await host.restart(page, host.externalBytes);
  expect(await host.readBacking()).toEqual(host.externalBytes);
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });

  let recoveredEditor: Frame;
  try {
    recoveredEditor = await waitForEditorFrame(page, "hot-exit recovered Game settings editor");
  } catch (error) {
    const details = await backupDiagnostics(page, expect, backupTrackerLogs);
    await logFrameDiagnostics(page, "hot-exit did not restore a custom editor");
    throw new Error(`VS Code did not restore a custom editor through hot exit. Backup-tracker diagnostics:\n${details}`, { cause: error });
  }
  const recoveredField = recoveredEditor.getByLabel("Game title");
  assertNoCspConsoleViolations(consoleViolations, "before installing the recovered settings-document CSP listener");
  await instrumentCspFrame(recoveredEditor);
  try {
    await expectValueWithFrameDiagnostics(page, recoveredField, recoveredTitle, expect);
  } catch (error) {
    const details = await backupDiagnostics(page, expect, backupTrackerLogs);
    await logFrameDiagnostics(page, "hot-exit recovery did not restore the dirty custom document");
    throw new Error(`VS Code did not restore the dirty custom document through hot exit. Backup-tracker diagnostics:\n${details}`, { cause: error });
  }
  await enableWorkbenchTraceLogging(page, expect);


  await expect(recoveredEditor.getByRole("status")).toHaveText("Unsaved changes");
  await expect.poll(() => frameCspViolations(page, recoveredEditor, consoleViolations)).toEqual([]);
  await expect(recoveredEditor.getByRole("group", { name: "Changed on disk" })).toBeVisible();
  await expect(recoveredEditor.getByRole("button", { name: "Use the version on disk" })).toHaveCount(0);
  await expect(recoveredEditor.getByText(/cannot safely reload/i)).toBeVisible();
  await expect(recoveredEditor.getByRole("button", { name: "Keep my version" })).toBeVisible();
  const externalAfterRestart = await readWorkspaceBytes(page, expect);
  expect(externalAfterRestart).toEqual(host.externalBytes);
  expect(await host.readBacking()).toEqual(host.externalBytes);
  const verifySentinel = async () => {
    await expect(sentinelTab).toHaveClass(/dirty/);
    await sentinelTab.click();
    sentinelEditor = await waitForTitledEditor(page, host.sentinelTitle, expect);
    await expect(sentinelEditor.getByRole("status")).toHaveText("Unsaved changes");
    expect(await host.readBacking(sentinelPath)).toEqual(sentinelBacking);
    await page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first().click();
    recoveredEditor = await waitForTitledEditor(page, recoveredTitle, expect);
  };
  await verifySentinel();
  expect(backupTrackerLogs.some((entry) => entry.includes("CommandService#executeCommand workbench.action.files.save"))).toBe(true);
  const choiceTraceStart = backupTrackerLogs.length;
  const hostEventsStart = host.readHostEvents().length;
  if (host.choice === "cancel") {
    await recoveredEditor.getByRole("button", { name: "Cancel" }).click();
    await expect(recoveredEditor.getByRole("button", { name: "Review conflict" })).toBeVisible();
    await expect(recoveredEditor.getByRole("status")).toHaveText("Unsaved changes");
    expect(await readWorkspaceBytes(page, expect)).toEqual(externalAfterRestart);
    expect(await host.readBacking()).toEqual(externalAfterRestart);
    await verifySentinel();
    const review = recoveredEditor.getByRole("button", { name: "Review conflict" });
    if (await review.isVisible()) await review.click();
  }
  await expect(recoveredEditor.getByRole("button", { name: "Keep my version" })).toBeVisible();
  await recoveredEditor.getByRole("button", { name: "Keep my version" }).click();
  await expect(recoveredEditor.getByRole("status")).toHaveText("Unsaved changes");
  expect(await readWorkspaceBytes(page, expect)).toEqual(externalAfterRestart);
  expect(await host.readBacking()).toEqual(externalAfterRestart);
  await verifySentinel();
  const forbiddenCommands = backupTrackerLogs.slice(choiceTraceStart).filter((entry) =>
    /CommandService#executeCommand workbench\.action\.files\.(?:save|revert)/i.test(entry));
  expect(forbiddenCommands).toEqual([]);
  expect(host.readHostEvents().slice(hostEventsStart).filter((event) =>
    event.kind === "save" || event.kind === "revert"
      || (event.kind === "command" && /^workbench\.action\.files\.(?:save|revert)/i.test(event.value)))).toEqual([]);
  await recoveredEditor.getByRole("button", { name: "Save" }).click();
  await expect(recoveredEditor.getByRole("status")).toHaveText("All changes saved");
  const recovered = await readWorkspaceBytes(page, expect);
  expect(recovered).toEqual(recoveredBytes);
  expect(await host.readBacking()).toEqual(recoveredBytes);
  await verifySentinel();
  await closeActiveEditor(page, expect);
  await openGame(page, gamePath, expect);
  const finalEditor = await waitForEditorFrame(page, "hot-exit recovered save reopened Game settings editor");
  assertNoCspConsoleViolations(consoleViolations, "before installing the final settings-document CSP listener");
  await instrumentCspFrame(finalEditor);
  await expectValueWithFrameDiagnostics(page, finalEditor.getByLabel("Game title"), recoveredTitle, expect);
  expect(await readWorkspaceBytes(page, expect)).toEqual(recovered);
  await expect.poll(() => frameCspViolations(page, finalEditor, consoleViolations)).toEqual([]);

  await runLifecycleScenarios(page, expect, autosaveTitle, autosaveBytes, host);
  // The packaged custom editor runs in the actual VS Code webview and persists boards through its working-copy provider.
  await runBoardBrowserScenario(page, expect, host);
  // Story 12.10: the real canvas, mouse, wheel, keyboard and the workbench's own undo, on all three coordinate layouts.
  await runBoardCanvasScenario(page, expect, host);
}

const CANVAS_VIEW = { width: 640, height: 384 };

/**
 * Story 12.10 in the packaged custom editor inside VS Code for the Web: for each coordinate layout a board is drawn on with
 * the real mouse, navigated with the real wheel (zoom around the pointer, scroll across and down), a layer is hidden, and
 * the workbench's own Undo and Redo (VS Code owns the stack) take the gesture back and forth; the saved file in the
 * workspace holds exactly the drawn cells. Selection, zoom and scroll leave the file and the dirty state alone.
 */
async function runBoardCanvasScenario(page: Page, expect: Expect, host: ProofHost): Promise<void> {
  for (const entry of host.canvasBoards) {
    const shape: BoardShape = { sizeX: 8, sizeY: 8, coordType: entry.coordType };
    const extent = boardExtent(shape);
    const centre = pixelToCell(shape, extent.width / 2, extent.height / 2)!;
    const near = (dx: number, dy: number): Cell => ({ x: centre.x + dx, y: centre.y + dy });
    const before = await host.readBacking(entry.path);
    const frame = await openProjectBoard(page, entry.path, expect);
    const state = frame.locator(".tkr-board-state");
    const tile2 = frame.locator('.tkr-board-cell[aria-label$=": village.tst2"]');
    await expect(state).toHaveText("All changes saved");
    const rock = frame.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source');
    await rock.click();
    await expect(rock).toHaveAttribute("aria-pressed", "true");

    const canvas = frame.locator("canvas.tkr-board-canvas");
    await canvas.scrollIntoViewIfNeeded();
    let box = (await canvas.boundingBox())!;
    expect(box.width, `${entry.label}: the canvas is on the page`).toBeGreaterThan(100);
    let viewport: Viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: CANVAS_VIEW.width, height: CANVAS_VIEW.height });
    const onPage = (view: Viewport, cell: Cell): { x: number; y: number } => {
      const middle = cellCentre(shape, cell.x, cell.y);
      const screen = boardToScreen(view, middle.x, middle.y);
      return { x: box.x + (screen.x * box.width) / CANVAS_VIEW.width, y: box.y + (screen.y * box.height) / CANVAS_VIEW.height };
    };
    const toCanvas = (point: { x: number; y: number }): { x: number; y: number } => ({ x: ((point.x - box.x) * CANVAS_VIEW.width) / box.width, y: ((point.y - box.y) * CANVAS_VIEW.height) / box.height });

    // What the rendered canvas shows at the middle cell: the engine's picture is on it (the board's own black, not the editor's grey).
    const middle = boardToScreen(viewport, cellCentre(shape, centre.x, centre.y).x, cellCentre(shape, centre.x, centre.y).y);
    const pixel = (): Promise<string> => canvas.evaluate((element, point) => {
      const context = (element as HTMLCanvasElement).getContext("2d")!;
      return Array.from(context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).join(",");
    }, middle);
    await expect.poll(pixel).toBe("0,0,0,255");
    const emptyPixel = await pixel();

    // Navigation first: the real wheel zooms and scrolls; none of it is an edit, so the file and the state stay as they were.
    const focus = onPage(viewport, centre);
    await page.mouse.move(focus.x, focus.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(frame.locator(".tkr-board-zoom")).toHaveText("200%");
    viewport = zoomTo(shape, viewport, 3, toCanvas(focus));
    await page.mouse.wheel(0, 60);
    viewport = clampViewport(shape, { ...viewport, y: viewport.y + 30 });
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 40);
    await page.keyboard.up("Shift");
    viewport = clampViewport(shape, { ...viewport, x: viewport.x + 20 });
    await expect(state).toHaveText("All changes saved");
    expect(await host.readBacking(entry.path), `${entry.label}: navigation does not touch the file`).toEqual(before);

    // One real click at the zoomed and scrolled view paints the cell the layout snaps that pixel to.
    const topLeft = screenToBoard(viewport, 0, 0);
    const target = pixelToCell(shape, topLeft.x + CANVAS_VIEW.width / 8, topLeft.y + CANVAS_VIEW.height / 8);
    expect(target, `${entry.label}: a cell lies inside the zoomed view`).not.toBeNull();
    const click = onPage(viewport, target!);
    await page.mouse.click(click.x, click.y);
    await expect(state).toHaveText("Unsaved changes");
    await expect(tile2).toHaveCount(1);
    await expect(frame.getByRole("button", { name: `Column ${target!.x + 1}, row ${target!.y + 1}: village.tst2`, exact: true })).toBeVisible();

    // VS Code owns the undo stack: its own Undo takes the click back (this editor has no Undo button of its own).
    await expect(frame.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(tile2).toHaveCount(0);
    await expect(state).toHaveText("All changes saved");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(tile2).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(tile2).toHaveCount(0);

    // Back to 100%, then one drag across the board.
    await page.mouse.move(focus.x, focus.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect(frame.locator(".tkr-board-zoom")).toHaveText("100%");
    viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: CANVAS_VIEW.width, height: CANVAS_VIEW.height });
    const from = onPage(viewport, near(-2, -1));
    const to = onPage(viewport, near(2, 1));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(state).toHaveText("Unsaved changes");
    const drawn = await tile2.count();
    expect(drawn, `${entry.label}: the drag drew a line of cells`).toBeGreaterThanOrEqual(5);
    // The pointer left the focus on the canvas, so the keys below are pressed on the board, not on the page body.
    await expect(canvas).toBeFocused();
    await expect.poll(pixel, { message: `${entry.label}: the rendered canvas shows the drawn tile` }).not.toBe(emptyPixel);
    const drawnPixel = await pixel();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(tile2, `${entry.label}: one Undo takes the whole drag back`).toHaveCount(0);
    await expect.poll(pixel, { message: `${entry.label}: the canvas shows the undo` }).toBe(emptyPixel);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(tile2).toHaveCount(drawn);
    await expect.poll(pixel, { message: `${entry.label}: the canvas shows the redo` }).toBe(drawnPixel);

    // Hiding a layer changes the picture only.
    const withTile = drawnPixel;
    await frame.getByLabel("Layer", { exact: true }).selectOption({ index: 1 });
    await frame.getByLabel("Layer 1", { exact: false }).first().uncheck();
    await expect.poll(pixel).not.toBe(withTile);
    await frame.getByRole("button", { name: "Show all", exact: true }).click();
    await expect.poll(pixel).toBe(withTile);

    // Save through VS Code's own save, and read the saved board from the workspace.
    await frame.getByRole("button", { name: "Save", exact: true }).click();
    await expect(state).toHaveText("All changes saved");
    const saved = await host.readBacking(entry.path);
    const read = readBoard(new BinaryReader(saved));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.coordType).toBe(entry.coordType);
      const painted = read.value.tileMatrix.filter((index) => index !== 0);
      expect(painted.length).toBe(drawn);
      expect(painted.every((index) => read.value.lut[index] === "village.tst2")).toBe(true);
    }

    // The Rectangle tool on this layout with the real mouse: the edge, then Ctrl fills it; VS Code's Undo takes the fill back.
    await frame.getByRole("button", { name: "Rectangle", exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const cornerA = onPage(viewport, near(-3, -2));
    const cornerB = onPage(viewport, near(3, 2));
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await expect(state).toHaveText("Unsaved changes");
    const edge = await tile2.count();
    expect(edge, `${entry.label}: the rectangle added cells`).toBeGreaterThan(drawn);
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => tile2.count()).toBeGreaterThan(edge);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => tile2.count()).toBe(edge);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => tile2.count()).toBe(drawn);
    await expect(state).toHaveText("All changes saved");
    await closeActiveEditor(page, expect);
    const reopened = await openProjectBoard(page, entry.path, expect);
    await expect(reopened.locator('.tkr-board-cell[aria-label$=": village.tst2"]')).toHaveCount(drawn);
    await closeActiveEditor(page, expect);
  }
}

async function runBoardBrowserScenario(page: Page, expect: Expect, host: ProofHost): Promise<void> {
  const firstPath = host.boardPath;
  const secondPath = host.otherBoardPath;
  const firstBefore = await host.readBacking(firstPath);
  const secondBefore = await host.readBacking(secondPath);
  const first = await openProjectBoard(page, firstPath, expect);
  await expect(first.getByRole("grid")).toBeVisible();
  await expect(first.getByRole("button", { name: "Column 1, row 1: village.tst1" })).toBeVisible();
  const tile = first.locator('[data-browser-reference="village.tst2"]');
  await expect(tile).toBeVisible();
  const source = tile.locator(".tkr-tileset-browser-source");
  await source.click();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await source.press("Shift+F10");
  const menuAction = first.getByRole("button", { name: "Select as board brush" });
  await expect(menuAction).toBeFocused();
  await menuAction.press("Escape");
  await expect(menuAction).toBeHidden();
  await expect(source).toBeFocused();
  await expect(first.getByRole("button", { name: "Column 1, row 1: village.tst1" })).toBeVisible();
  expect(await host.readBacking(firstPath)).toEqual(firstBefore);
  const paintFirst = first.getByRole("button", { name: "Paint village.tst tile 2 here" });
  await expect(paintFirst).toBeEnabled();
  await paintFirst.click();
  await expect(first.getByRole("button", { name: "Column 1, row 1: village.tst2" })).toBeVisible();
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.getByRole("status")).toHaveText("All changes saved");
  const firstSaved = await host.readBacking(firstPath);
  expect(firstSaved).not.toEqual(firstBefore);
  await closeActiveEditor(page, expect);

  const second = await openProjectBoard(page, secondPath, expect);
  await expect(second.getByRole("button", { name: "Column 1, row 1: village.tst1" })).toBeVisible();
  expect(await host.readBacking(secondPath)).toEqual(secondBefore);
  const retained = second.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source');
  await expect(retained).toHaveAttribute("aria-pressed", "true");
  const paintSecond = second.getByRole("button", { name: "Paint village.tst tile 2 here" });
  await expect(paintSecond).toBeEnabled();
  await paintSecond.click();
  await expect(second.getByRole("button", { name: "Column 1, row 1: village.tst2" })).toBeVisible();
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await expect(second.getByRole("status")).toHaveText("All changes saved");
  const secondSaved = await host.readBacking(secondPath);
  expect(secondSaved).not.toEqual(secondBefore);
  expect(await host.readBacking(firstPath)).toEqual(firstSaved);
  await closeActiveEditor(page, expect);

  const reopened = await openProjectBoard(page, secondPath, expect);
  await expect(reopened.getByRole("button", { name: "Column 1, row 1: village.tst2" })).toBeVisible();
  expect(await host.readBacking(secondPath)).toEqual(secondSaved);
  await closeActiveEditor(page, expect);
}

async function openProjectBoard(page: Page, path: string, expect: Expect): Promise<Frame> {
  await focusWorkbench(page);
  const folder = page.getByRole("treeitem", { name: "Boards", exact: true });
  await expect(folder).toBeVisible();
  if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
  const item = page.getByRole("treeitem", { name: path.split("/").at(-1)!, exact: true });
  await expect(item).toBeVisible();
  await item.dblclick();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
  return await waitForBoardFrame(page, path);
}

async function waitForBoardFrame(page: Page, label: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  while (Date.now() < deadline) {
    const outer = await page.locator("iframe.webview:visible").first().elementHandle({ timeout: 250 }).catch(() => null);
    if (outer) {
      const outerFrame = await outer.contentFrame().catch(() => null);
      const content = outerFrame?.childFrames().find((frame) => frame.name() === "pending-frame");
      if (content && await content.locator(".tkr-board").count().catch(() => 0) > 0) return content;
    }
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  await logFrameDiagnostics(page, `packaged board custom editor not found for ${label}`);
  throw new Error(`Timed out waiting for actual VS Code board custom editor for ${label}`);
}

/**
 * The lifecycle cases that only the real workbench can prove (story 11.3; ADR 0022 D3.7, D3.6, D11.6):
 *
 * * a hidden webview loses nothing — VS Code destroys it (`retainContextWhenHidden: false`), the model stays in the
 *   extension host, and the page loaded again shows the unsaved title, the dirty state and the same document;
 * * a cancelled close keeps the editor and its work — the workbench asks, and Cancel is an answer;
 * * `files.autoSave: afterDelay` drives `saveCustomDocument`: the file reaches the edited bytes with no Save pressed,
 *   which is the proof the ADR left unverified. Whatever the outcome, autosave is turned off again.
 */
async function runLifecycleScenarios(page: Page, expect: Expect, autosaveTitle: string, autosaveBytes: Uint8Array, host: ProofHost): Promise<void> {
  const hiddenTitle = "Still here after hiding";
  let editor = await waitForEditorFrame(page, "lifecycle settings editor");
  const field = editor.getByLabel("Game title");
  await field.fill(hiddenTitle);
  await field.press("Enter");
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");

  // An untitled editor takes the tab's place, which hides the custom editor (retainContextWhenHidden: false).
  await editor.evaluate(() => { (window as ProofWindow & { __tkrAliveMarker?: string }).__tkrAliveMarker = "before-hiding"; });
  await runCommandMatching(page, expect, "New Untitled", "a new untitled editor");
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: /Untitled/ })).toBeVisible();
  await closeActiveEditor(page, expect);
  editor = await waitForEditorFrame(page, "settings editor shown again");
  const alive = await editor.evaluate(() => (window as ProofWindow & { __tkrAliveMarker?: string }).__tkrAliveMarker);
  if (alive !== undefined) throw new Error("VS Code kept the hidden webview's page alive, so this proof cannot show a re-created view");
  await expectValueWithFrameDiagnostics(page, editor.getByLabel("Game title"), hiddenTitle, expect);
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");

  await runCommand(page, expect, "View: Close Editor");
  const dialog = page.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  editor = await waitForEditorFrame(page, "settings editor after a cancelled close");
  await expectValueWithFrameDiagnostics(page, editor.getByLabel("Game title"), hiddenTitle, expect);
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");

  const autosaveField = editor.getByLabel("Game title");
  await autosaveField.fill(autosaveTitle);
  await autosaveField.press("Enter");
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");
  const expectAutosave = async (value: string): Promise<void> => {
    await expect.poll(async () => {
      return autosaveSetting(await host.readBacking(".vscode/settings.json"));
    }, { message: `VS Code persists files.autoSave=${value}` }).toBe(value);
  };
  let failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await runCommand(page, expect, "Test: Turn Autosave On");
    await expectAutosave("afterDelay");
    await expect.poll(async () => bytesEqual(await readWorkspaceBytes(page, expect), autosaveBytes), {
      timeout: 30_000,
      intervals: [3_000],
      message: "VS Code's files.autoSave did not save this custom document (ADR 0022 D11.6)",
    }).toBe(true);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await runCommand(page, expect, "Test: Turn Autosave Off");
      await expectAutosave("off");
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const combined = combineProofErrors(failure, cleanupErrors);
  if (combined !== undefined) throw combined;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** Run a command from the palette and wait for its quick-pick row. */
async function runCommand(page: Page, expect: Expect, title: string): Promise<void> {
  await runCommandMatching(page, expect, title, title);
}

/** Accept the focused command with Enter, without waiting for a moving quick-pick row to become mouse-stable. */
async function runCommandMatching(page: Page, expect: Expect, search: string, label: string): Promise<void> {
  const commandInput = await commandPalette(page, expect);
  await commandInput.fill(`>${search}`);
  const command = page.locator(".quick-input-list .monaco-list-row.focused").filter({ hasText: search }).first();
  await expect(command, `VS Code selects ${label}`).toBeVisible();
  await commandInput.press("Enter");
  await expect(page.locator(".quick-input-widget")).toBeHidden();
}
async function enableWorkbenchTraceLogging(page: Page, expect: Expect): Promise<void> {
  // Use VS Code's built-in logger controls so working-copy and backup-tracker trace events are captured.
  const commandInput = await commandPalette(page, expect);
  await commandInput.fill(">Developer: Set Log Level");
  const command = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "Developer: Set Log Level" }).first();
  await expect(command).toBeVisible();
  await command.click();

  const traceLevel = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "Trace" }).first();
  await expect(traceLevel).toBeVisible();
  await traceLevel.click();
}
async function backupDiagnostics(page: Page, expect: Expect, browserLogs: readonly string[]): Promise<string> {
  const browser = browserLogs.length === 0
    ? "Browser console: no matching backup-tracker errors."
    : `Browser console:\n${browserLogs.join("\n")}`;
  let windowLog: string;
  try {
    const commandInput = await commandPalette(page, expect);
    await commandInput.fill(">Developer: Show Window Log");
    const command = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "Developer: Show Window Log" }).first();
    await expect(command).toBeVisible({ timeout: 5_000 });
    await command.click();
    const output = page.locator(".output-view .monaco-editor .view-lines");
    await expect(output).toBeVisible({ timeout: 10_000 });
    windowLog = await output.innerText();
  } catch (error) {
    windowLog = `Window log unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const relevant = windowLog.split("\n").filter((line) => /backup|working copy|hot exit|vscode-test-web|ENOPRO|no editors|storage path/i.test(line));
  return `${browser}\nVS Code Window Log (matching working-copy/backup lines):\n${relevant.length === 0 ? "(no matching lines in visible log output)" : relevant.join("\n")}`;
}

type Locator = import("@playwright/test").Locator;

async function expectVisibleWithFrameDiagnostics(page: Page, locator: Locator, expect: Expect, label: string): Promise<void> {
  try {
    await expect(locator).toBeVisible();
  } catch (error) {
    await logFrameDiagnostics(page, label);
    throw error;
  }
}

async function expectValueWithFrameDiagnostics(page: Page, locator: Locator, value: string, expect: Expect): Promise<void> {
  try {
    await expect(locator).toHaveValue(value);
  } catch (error) {
    await logFrameDiagnostics(page, "reopened Game title field");
    throw error;
  }
}

async function logFrameDiagnostics(page: Page, reason: string): Promise<void> {
  const frames = await Promise.all(page.frames().map(async (frame) => {
    let body = "<unavailable>";
    try {
      body = (await frame.locator("body").innerText({ timeout: 1_000 })).slice(0, 2_000);
    } catch (error) {
      body = `<read failed: ${error instanceof Error ? error.message : String(error)}>`;
    }
    return { name: frame.name(), url: frame.url(), parentUrl: frame.parentFrame()?.url() ?? null, body };
  }));
  console.error(`[vscode-web:frame-diagnostic] ${reason}: ${JSON.stringify(frames, null, 2)}`);
}

async function waitForEditorFrame(page: Page, label: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  while (Date.now() < deadline) {
    const outer = await page.locator("iframe.webview:visible").first().elementHandle({ timeout: 250 }).catch(() => null);
    if (outer) {
      const outerFrame = await outer.contentFrame().catch(() => null);
      const content = outerFrame?.childFrames().find((frame) => frame.name() === "pending-frame");
      if (content) return content;
    }
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  await logFrameDiagnostics(page, `${label} content frame not found`);
  throw new Error(`Timed out waiting for the named pending-frame child of iframe.webview for ${label}`);
}

async function readCspViolations(frame: Frame, label: string): Promise<string[]> {
  return frame.evaluate((frameLabel) => {
    const values = (window as ProofWindow).__tkrCspViolations;
    if (!Array.isArray(values)) throw new Error(`CSP violation instrumentation is missing in ${frameLabel}`);
    return values.slice();
  }, label);
}

async function instrumentCspFrame(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const target = window as ProofWindow;
    target.__tkrCspViolations = [];
    const seen = new WeakSet<Event>();
    const recordViolation = (event: Event) => {
      if (seen.has(event)) return;
      seen.add(event);
      target.__tkrCspViolations!.push((event as SecurityPolicyViolationEvent).effectiveDirective);
    };
    document.addEventListener("securitypolicyviolation", recordViolation, true);
    window.addEventListener("securitypolicyviolation", recordViolation, true);
  });
}

function assertNoCspConsoleViolations(violations: CspConsoleViolation[], stage: string): void {
  if (violations.length > 0) {
    throw new Error(`CSP console violations before ${stage}: ${JSON.stringify(violations)}`);
  }
}

async function frameCspViolations(page: Page, frame: Frame, consoleViolations: CspConsoleViolation[]): Promise<string[]> {
  const main = await readCspViolations(page.mainFrame(), "browser workbench");
  const content = await readCspViolations(frame, "settings editor content");
  return [...main, ...content, ...consoleViolations.map(({ text, url, lineNumber, columnNumber }) => `${text} @ ${url}:${lineNumber}:${columnNumber}`)];
}

async function assertCspListenerCountsBlockedAction(frame: Frame, expect: Expect, consoleViolations: CspConsoleViolation[]): Promise<void> {
  const before = await readCspViolations(frame, "settings editor content");
  if (before.length > 0 || consoleViolations.length > 0) {
    throw new Error(`CSP violations occurred before positive control: frame=${JSON.stringify(before)}, console=${JSON.stringify(consoleViolations)}`);
  }
  const consoleStart = consoleViolations.length;
  await frame.evaluate(() => {
    const probe = document.createElement("script");
    probe.textContent = "window.__tkrCspPositiveControlRan = true";
    document.head.append(probe);
  });
  await expect.poll(async () => (await readCspViolations(frame, "settings editor content")).length, { timeout: 5_000 })
    .toBeGreaterThan(before.length);
  const after = await readCspViolations(frame, "settings editor content");
  const blockedDirectives = after.slice(before.length);
  if (blockedDirectives.length !== 1 || !blockedDirectives[0]!.startsWith("script-src")) {
    throw new Error(`CSP positive control observed unexpected inline-script directive evidence: ${JSON.stringify(blockedDirectives)}`);
  }
  const controlMessages = consoleViolations.slice(consoleStart);
  if (controlMessages.length !== 1 || !/inline script/i.test(controlMessages[0]?.text ?? "") || !/script-src/i.test(controlMessages[0]?.text ?? "")) {
    throw new Error(`CSP positive control console evidence was not exactly one blocked inline-script action: ${JSON.stringify(controlMessages)}`);
  }
  const ran = await frame.evaluate(() => (window as ProofWindow).__tkrCspPositiveControlRan === true);
  if (ran) throw new Error("The CSP positive-control inline script unexpectedly executed");
  consoleViolations.splice(consoleStart, 1);
  await frame.evaluate(() => {
    const values = (window as ProofWindow).__tkrCspViolations;
    if (!Array.isArray(values)) throw new Error("CSP violation instrumentation disappeared from settings editor content");
    values.length = 0;
  });
}




async function readWorkspaceBytes(page: Page, expect: Expect): Promise<Uint8Array> {
  const commandInput = await commandPalette(page, expect);
  const panelTabs = page.getByRole("tab").filter({ hasText: /Persisted Main File Bytes #[0-9a-f-]+/i });
  const existingCount = await panelTabs.count();
  await commandInput.fill(`>${copyBytesCommand}`);
  const commandResult = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: copyBytesCommand }).first();
  await expect(commandResult).toBeVisible();
  await commandResult.click();
  await expect(page.locator(".quick-input-widget")).toBeHidden();

  await expect.poll(() => panelTabs.count()).toBeGreaterThan(existingCount);
  const panelTab = panelTabs.nth(existingCount);
  await expect(panelTab).toBeVisible({ timeout: 15_000 });
  const panelId = /Persisted Main File Bytes #([0-9a-f-]+)/i.exec(await panelTab.innerText())?.[1];
  if (panelId === undefined) throw new Error("The byte probe did not publish a unique panel identifier");
  const panelFrame = await waitForBytesPanelFrame(page, panelId);
  const encoded = (await panelFrame.locator(`#tkr-proof-persisted-bytes-${panelId}`).innerText()).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error(`Probe panel ${panelId} did not contain a valid Base64 persisted-byte payload`);

  await panelTab.hover();
  const closeButton = panelTab.getByRole("button", { name: /^Close/ });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(panelTab).toBeHidden({ timeout: 15_000 });
  const settingsFrame = await waitForEditorFrame(page, "settings editor restored after byte probe");
  await expectVisibleWithFrameDiagnostics(page, settingsFrame.getByLabel("Game title"), expect, "settings editor after byte probe");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

async function waitForBytesPanelFrame(page: Page, panelId: string): Promise<Frame> {
  const selector = `#tkr-proof-persisted-bytes-${panelId}`;
  const deadline = Date.now() + 15_000;
  let pause = 100;
  while (Date.now() < deadline) {
    const frame = await findBytesPanelFrame(page, selector);
    if (frame) return frame;
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  await logFrameDiagnostics(page, `persisted-byte probe webview #${panelId} not found`);
  throw new Error(`Timed out waiting for persisted-byte probe panel #${panelId}`);
}

async function findBytesPanelFrame(page: Page, selector: string): Promise<Frame | null> {
  for (const frame of page.frames()) {
    if (await frame.locator(selector).count() > 0) return frame;
  }
  return null;
}


async function openGame(page: Page, gamePath: string, expect: Expect): Promise<void> {
  await focusWorkbench(page);
  const gameFile = page.getByRole("treeitem", { name: gamePath.split("/").at(-1)!, exact: true });
  await expect(gameFile).toBeVisible();
  await gameFile.dblclick();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: gamePath.split("/").at(-1)! }).first()).toBeVisible();
  await expect(page.locator("iframe.webview")).toBeVisible({ timeout: 30_000 });
}

async function closeActiveEditor(page: Page, expect: Expect): Promise<void> {
  const commandInput = await commandPalette(page, expect);
  await commandInput.fill(">View: Close Editor");
  const closeCommand = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "View: Close Editor" }).first();
  await expect(closeCommand).toBeVisible();
  await closeCommand.click();
  await expect(page.locator(".quick-input-widget")).toBeHidden();
}

async function commandPalette(page: Page, expect: Expect): Promise<import("@playwright/test").Locator> {
  await focusWorkbench(page);
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const input = page.locator(".quick-input-widget input").last();
  await expect(input).toBeVisible();
  return input;
}

async function focusWorkbench(page: Page): Promise<void> {
  await page.bringToFront();
  await page.locator(".monaco-workbench").click({ position: { x: 5, y: 5 } });
}

/** Inspect VS Code's browser storage independently of the workspace provider. */
async function backupIsStored(page: Page, expected: Uint8Array): Promise<boolean> {
  return await page.evaluate(async (bytes) => {
    const deferred = Promise as PromiseConstructor & {
      withResolvers<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void };
    };
    const opened = deferred.withResolvers<IDBDatabase>();
    const request = indexedDB.open("vscode-web-db");
    request.onsuccess = () => opened.resolve(request.result);
    request.onerror = () => opened.reject(request.error);
    const db = await opened.promise;
    try {
      const read = deferred.withResolvers<unknown[]>();
      const values = db.transaction("vscode-userdata-store", "readonly").objectStore("vscode-userdata-store").getAll();
      values.onsuccess = () => read.resolve(values.result as unknown[]);
      values.onerror = () => read.reject(values.error);
      return (await read.promise).some((value) =>
        value instanceof Uint8Array && value.length === bytes.length && value.every((byte, index) => byte === bytes[index]));
    } finally {
      db.close();
    }
  }, Array.from(expected));
}

async function waitForTitledEditor(page: Page, title: string, expect: Expect): Promise<Frame> {
  let found: Frame | undefined;
  await expect.poll(async () => {
    found = await waitForEditorFrame(page, "selected editor");
    return await found.getByLabel("Game title").inputValue();
  }, { timeout: 30_000 }).toBe(title);
  if (!found) throw new Error("Selected editor did not become available");
  return found;
}
