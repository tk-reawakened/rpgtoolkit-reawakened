import type { expect as playwrightExpect, Frame, Locator, Page } from "@playwright/test";
import { autosaveSetting, combineProofErrors, decodePersistedBytes } from "./lifecycle.ts";

const copyBytesCommand = "Test: Copy Main File Bytes";

type Expect = typeof playwrightExpect;
type ProofWindow = Window & { __tkrCspViolations?: string[]; __tkrCspPositiveControlRan?: boolean };
type CspConsoleViolation = { text: string; url: string; lineNumber: number; columnNumber: number };
type ProofHost = {
  restart(page: Page, offlineBytes?: Uint8Array): Promise<Page>;
  readBacking(path?: string): Promise<Uint8Array>;
  readHostEvents(): { kind: "save-request" | "save" | "revert"; value: string }[];
  pauseSave(): void;
  resumeSave(): void;
  externalBytes: Uint8Array;
  sentinelTitle: string;
  sentinelBytes: Uint8Array;
  choice: "cancel" | "keep";
  boardPath: string;
  otherBoardPath: string;
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
  await titleField.press("Enter");
  const savedTab = page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first();
  await expect(savedTab).toHaveClass(/dirty/);
  await editor.getByRole("button", { name: "Save" }).click();
  const saved = await readWorkspaceBytes(page, expect);
  expect(saved).not.toEqual(before);
  expect(saved).toEqual(expectedBytes);
  expect(host.readHostEvents()).toContainEqual({ kind: "save", value: `/${gamePath}` });
  expect(host.readHostEvents()).toContainEqual({ kind: "save-request", value: `/${gamePath}` });
  await expect.poll(() => frameCspViolations(page, editor, consoleViolations)).toEqual([]);
  expect(await host.readBacking()).toEqual(saved);
  await expect(savedTab).not.toHaveClass(/dirty/);
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
  expect(host.readHostEvents()).toContainEqual({ kind: "save-request", value: `/${gamePath}` });
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
  expect(host.readHostEvents().slice(hostEventsStart)).toEqual([]);
  // Hold the real extension at its save API boundary, change focus to another dirty editor,
  // then let the save proceed. Only the originating document may be written.
  host.pauseSave();
  const saveStart = host.readHostEvents().length;
  try {
    await recoveredEditor.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => host.readHostEvents().slice(saveStart)).toContainEqual({ kind: "save-request", value: `/${gamePath}` });
    await sentinelTab.click();
    await expect(sentinelTab).toHaveClass(/dirty/);
  } finally {
    host.resumeSave();
  }
  // Keep the other editor active until the original document's bytes really reach disk.
  await expect.poll(async () => Array.from(await host.readBacking()), { timeout: 30_000 }).toEqual(Array.from(recoveredBytes));
  await verifySentinel();
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
  // Exercise recovery from a real palette dismissal before dispatch.
  await runCommandMatching(page, expect, "New Untitled", "a new untitled editor", true);
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
  const readMarker = async (name: string): Promise<string | undefined> => {
    try {
      return new TextDecoder().decode(await host.readBacking(`.vscode/tkr-autosave-command-${name}`));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  };
  let observedOffWhileCommandPending = false;
  const expectAutosave = async (value: string): Promise<void> => {
    await expect.poll(async () => {
      const marker = await readMarker("complete");
      if (value === "off" && marker !== "off" && autosaveSetting(await host.readBacking(".vscode/settings.json")) === "off") {
        observedOffWhileCommandPending = true;
      }
      return marker;
    }, { message: `VS Code completed the autosave ${value} command`, timeout: 30_000 }).toBe(value);
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
    let acknowledgement: Promise<void> | undefined;
    let acknowledgementError: unknown;
    let acknowledgementFailed = false;
    try {
      await runCommand(page, expect, "Test: Pause Autosave Off");
      await runCommand(page, expect, "Test: Turn Autosave Off");
      let autosaveAcknowledged = false;
      acknowledgement = expectAutosave("off").then(
        () => { autosaveAcknowledged = true; },
        (error: unknown) => { acknowledgementFailed = true; acknowledgementError = error; },
      );
      await expect.poll(() => readMarker("paused")).toBe("off");
      await expect.poll(async () => autosaveSetting(await host.readBacking(".vscode/settings.json"))).toBe("off");
      await expect.poll(() => observedOffWhileCommandPending, {
        message: "the completion observer saw persisted off while the command was paused",
      }).toBe(true);
      await expect.poll(() => readMarker("complete")).toBe("afterDelay");
      if (autosaveAcknowledged) throw new Error("The autosave proof acknowledged a command before its completion barrier");
      console.info("vscode.dev autosave guard negative control passed: files.autoSave=off while command completion remained pending");
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      try {
        await runCommand(page, expect, "Test: Release Autosave Off");
        await expect.poll(() => readMarker("released"),
          { message: "VS Code released the autosave completion barrier" }).toBe("off");
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (acknowledgement !== undefined) {
        await acknowledgement;
        if (acknowledgementFailed) cleanupErrors.push(acknowledgementError);
        else console.info("vscode.dev autosave completion acknowledged and persisted: off");
      }
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
async function runCommandMatching(page: Page, expect: Expect, search: string, label: string, dismissFirstAttempt = false): Promise<void> {
  const widget = page.locator(".quick-input-widget");
  let commandInput: Locator | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      commandInput = await commandPalette(page, expect);
      await commandInput.fill(`>${search}`);
      if (dismissFirstAttempt && attempt === 0) {
        await commandInput.press("Escape");
        await expect(widget).toBeHidden();
      }
      const command = page.locator(".quick-input-list .monaco-list-row.focused").filter({ hasText: search }).first();
      await expect(command, `VS Code selects ${label}`).toBeVisible();
      break;
    } catch (error) {
      if (attempt === 2 || await widget.isVisible()) throw error;
      commandInput = undefined;
    }
  }
  if (commandInput === undefined) throw new Error(`VS Code did not select ${label}`);
  // Retry only before dispatch; once Enter is pressed, never execute the command again.
  await commandInput.press("Enter");
  await expect(widget).toBeHidden();
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




async function openPersistedBytesPanel(page: Page, expect: Expect): Promise<{ tab: Locator; frame: Frame; id: string }> {
  const panelTabs = page.getByRole("tab").filter({ hasText: /Persisted Main File Bytes #[0-9a-f-]+/i });
  const existingCount = await panelTabs.count();
  await runCommand(page, expect, copyBytesCommand);
  await expect.poll(() => panelTabs.count()).toBeGreaterThan(existingCount);
  const panelTab = panelTabs.nth(existingCount);
  await expect(panelTab).toBeVisible({ timeout: 15_000 });
  const panelId = /Persisted Main File Bytes #([0-9a-f-]+)/i.exec(await panelTab.innerText())?.[1];
  if (panelId === undefined) throw new Error("The byte probe did not publish a unique panel identifier");
  const panelFrame = await waitForBytesPanelFrame(page, panelId);
  return { tab: panelTab, frame: panelFrame, id: panelId };
}

/** Invoke VS Code's real orderly reload through one allowlisted, script-free probe control. */
export async function requestNativeReload(page: Page, expect: Expect): Promise<void> {
  const { frame } = await openPersistedBytesPanel(page, expect);
  await frame.getByRole("link", { name: "Reload workbench", exact: true }).click({ noWaitAfter: true });
}

async function readWorkspaceBytes(page: Page, expect: Expect): Promise<Uint8Array> {
  const { tab: panelTab, frame: panelFrame, id: panelId } = await openPersistedBytesPanel(page, expect);
  const encoded = (await panelFrame.locator(`#tkr-proof-persisted-bytes-${panelId}`).innerText()).trim();
  const bytes = decodePersistedBytes(encoded, panelId);

  await panelTab.hover();
  const closeButton = panelTab.getByRole("button", { name: /^Close/ });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(panelTab).toBeHidden({ timeout: 15_000 });
  const settingsFrame = await waitForEditorFrame(page, "settings editor restored after byte probe");
  await expectVisibleWithFrameDiagnostics(page, settingsFrame.getByLabel("Game title"), expect, "settings editor after byte probe");
  return bytes;
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
