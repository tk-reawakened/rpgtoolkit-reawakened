import { createHash } from "node:crypto";
import { BinaryReader, readBoard, readMainFile } from "@tk-reawakened/core";
import { boardExtent, boardToScreen, cellCentre, clampViewport, pixelToCell, screenToBoard, zoomTo, type BoardShape, type Cell, type Viewport } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, ElementHandle, Frame, Locator, Page } from "@playwright/test";
import { autosaveSetting, combineProofErrors, decodePersistedBytes } from "./lifecycle.ts";
import { runVscodeArtProof } from "./art-proof.ts";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";

const copyBytesCommand = "Test: Copy Main File Bytes";

type Expect = typeof playwrightExpect;
type ProofWindow = Window & { __tkrCspViolations?: string[]; __tkrCspPositiveControlRan?: boolean };
type CspConsoleViolation = { text: string; url: string; lineNumber: number; columnNumber: number };
type ProofRunSnapshot = { readonly stateHash: string | null };

async function verifyHostRunHash(page: Page, frame: Frame, expect: Expect): Promise<void> {
  let handleFrame: Frame | undefined;
  await expect.poll(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator("#tkr-run-handle-snapshot").count() > 0) { handleFrame = candidate; return true; }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (handleFrame === undefined) throw new Error("Run-handle proof panel was not found");
  let lastObserved: { liveHash: string | undefined; liveTick: number | undefined; snapshotHash: string | null; status: unknown } =
    { liveHash: undefined, liveTick: undefined, snapshotHash: null, status: null };
  await expect.poll(async () => {
    const player = await frame.evaluate(() => {
      const live = Reflect.get(window, "__live") as { stateHash?: string; tick?: number } | undefined;
      const history = Reflect.get(window, "__liveHistory") as { tick: number; stateHash: string }[] | undefined;
      return { live, history };
    });
    const snapshot = JSON.parse(await handleFrame!.locator("#tkr-run-handle-snapshot").textContent() ?? "null") as ProofRunSnapshot;
    const status = JSON.parse(await handleFrame!.locator("#tkr-run-handle-status").textContent() ?? "null") as { stateHash?: string; tick?: number };
    lastObserved = { liveHash: player.live?.stateHash, liveTick: player.live?.tick, snapshotHash: snapshot.stateHash, status };
    return typeof snapshot.stateHash === "string" && /^[a-f0-9]{16}$/.test(snapshot.stateHash)
      && player.history?.some((entry) => entry.stateHash === snapshot.stateHash) === true;
  }, { timeout: 30_000 }).toBe(true).catch((error: unknown) => {
    throw new Error(`RunHandle hash never matched a player live hash: ${JSON.stringify(lastObserved)}`, { cause: error });
  });
  await handleFrame.locator("#tkr-stop-run-handle").click();
  await expect.poll(async () => {
    const snapshot = JSON.parse(await handleFrame!.locator("#tkr-run-handle-snapshot").textContent() ?? "null") as ProofRunSnapshot;
    const status = JSON.parse(await handleFrame!.locator("#tkr-run-handle-status").textContent() ?? "null") as { state?: string };
    return { state: status.state, stateHash: snapshot.stateHash };
  }, { timeout: 30_000 }).toMatchObject({ state: "ended" });
  const retained = JSON.parse(await handleFrame.locator("#tkr-run-handle-snapshot").textContent() ?? "null") as ProofRunSnapshot;
  const stoppedHash = JSON.parse(await handleFrame.locator("#tkr-run-handle-stopped-hash").textContent() ?? "null") as string | null;
  expect(stoppedHash).toMatch(/^[a-f0-9]{16}$/);
  expect(retained.stateHash).toBe(stoppedHash);
}
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
  artPath: string;
  otherArtPath: string;
  writeBacking(path: string, bytes: Uint8Array): Promise<void>;
  withBackingWriteRefused(path: string, check: () => Promise<void>): Promise<void>;
  /** A fully drawn 2 × 2 tile bitmap over `Tiles/village.tst`: tile 1 everywhere except a shaded (10, -20, 30) tile 2 at column 2, row 1. */
  bitmapPath: string;
  /** A 3 × 1 tile bitmap of shaded tile 2, which the browser's Edit tile bitmap action must open. */
  otherBitmapPath: string;
  /** The pixels the core compositor makes of the proof bitmap, before (`false`) and after (`true`) the proof's edits. */
  bitmapPicture(edited: boolean): { width: number; height: number; data: number[] };
  /** What the file must hold after the proof's two edits and Save, written by hand from the stored layout. */
  bitmapSaved: Uint8Array;
  /** Boards of each coordinate layout (`coordType` 0, 1, 2), each 8 × 8 with two layers, for the canvas scenario. */
  canvasBoards: { path: string; label: string; coordType: number }[];
};

/** Launch the real saved example through the VS Code web extension, not a mocked adapter. */
export async function runVscodeLaunchProof(
  page: Page, expect: Expect, workbenchUrl: string, gamePath: string,
  readBacking: () => Promise<Uint8Array>, expectedBytes: Uint8Array,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await page.getByRole("treeitem", { name: "Main", exact: true }).click();
  await openGame(page, gamePath, expect);
  const editor = await waitForEditorFrame(page, "VS Code launch editor");
  const title = editor.getByLabel("Game title");
  await expect(title).toBeVisible();
  await title.fill("VS Code launch proof");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");
  await runCommand(page, expect, "Test: Run Example Game");
  await expect.poll(readBacking, { timeout: 30_000 }).toEqual(expectedBytes);
  let player: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator("#screen").count() > 0) { player = frame; return true; }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  const playerFrame = player as Frame | undefined;
  if (playerFrame === undefined) throw new Error("Player frame was not found");
  const live = async () => await playerFrame.evaluate(() => Reflect.get(window, "__live") as {
    tick: number; board: string | null; player: unknown; stateHash: string;
  } | undefined);
  await expect.poll(async () => (await live())?.tick ?? 0, { timeout: 30_000 }).toBeGreaterThan(30);
  await playerFrame.locator("#screen").press("Enter");
  await expect.poll(async () => (await live())?.board, { timeout: 30_000 }).toContain("village.brd");
  const playing = await live();
  expect(playing?.player).not.toBeNull();
  expect(playing?.stateHash).toBeTruthy();
}

/** Exercise a saved program and fixture through the real VS Code web extension and packaged player. */
export async function runVscodeProgramProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await runCommand(page, expect, "Test: Run Example Program");
  let player: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator("#screen").count() > 0) { player = frame; return true; }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  const frame = player as Frame | undefined;
  if (frame === undefined) throw new Error("Program player frame was not found");
  const scene = async () => await frame.evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string; font?: { size: number }; source?: { asset?: string } }> } } } | undefined;
    const live = Reflect.get(window, "__live") as { board: string | null; stateHash: string; player: unknown } | undefined;
    const all = session?.engine.drawList().commands ?? [];
    const commands = all.filter((command) => command.kind === "text");
    return { live, text: commands.map((command) => command.text), sizes: commands.map((command) => command.font?.size),
      assets: all.filter((command) => command.kind === "blit").map((command) => command.source?.asset) };
  });
  await expect.poll(async () => (await scene()).text?.join(" ") ?? "", { timeout: 30_000 }).toContain("VS CODE FIXTURE PROOF");
  const result = await scene();
  expect(result.live?.board).toContain("village.brd");
  expect(result.live?.player).toEqual({ x: 48, y: 63 });
  expect(result.live?.stateHash).toBeTruthy();
  expect(result.sizes).toContain(18);
  expect(result.assets).toContain("game/example/bitmap/window.png");
  const snapshot = JSON.parse(await frame.locator("#run-snapshot pre").textContent() ?? "null") as {
    kind: string; fixtureSettings: { font: string; fontSize: number; windowGraphic: string; party: string[] };
    targets: Array<{ path: string; sha256: string }>;
  };
  expect(snapshot.kind).toBe("program");
  expect(snapshot.fixtureSettings).toMatchObject({
    font: "Liberation Sans", fontSize: 18, windowGraphic: "Game/Example/Bitmap/window.png",
    party: ["Game/Example/Chrs/ada.tem"],
  });
  expect(snapshot.targets.find((target) => target.path === "Game/Example/Prg/start.prg")?.sha256).toMatch(/^[a-f0-9]{64}$/);
  await verifyHostRunHash(page, frame, expect);
}

/** Exercise a fresh board launch through the real VS Code web extension and packaged player. */
export async function runVscodeBoardProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await runCommand(page, expect, "Test: Run Example Board");
  let player: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator("#screen").count() > 0) { player = frame; return true; }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  const frame = player as Frame | undefined;
  if (frame === undefined) throw new Error("Board player frame was not found");
  const scene = async () => await frame.evaluate(() => {
    const session = Reflect.get(window, "__session") as { engine: { drawList(): { commands: Array<{ kind: string; text?: string }> } } } | undefined;
    const live = Reflect.get(window, "__live") as { board: string | null; stateHash: string; player: unknown } | undefined;
    return { live, text: (session?.engine.drawList().commands ?? []).filter((command) => command.kind === "text").map((command) => command.text) };
  });
  await expect.poll(async () => (await scene()).live?.board ?? "", { timeout: 30_000 }).toContain("village.brd");
  const snapshotDetails = frame.locator("#run-snapshot");
  await snapshotDetails.locator("summary").click();
  await expect(snapshotDetails).toHaveAttribute("open", "");
  await expect(snapshotDetails.locator("pre")).toContainText(/"stateHash":\s*"[^"]+"/);
  const result = await frame.evaluate(() => {
    const live = Reflect.get(window, "__live") as { stateHash: string } | undefined;
    const snapshotText = document.querySelector("#run-snapshot pre")?.textContent ?? "null";
    const snapshot = JSON.parse(snapshotText) as {
      kind: string; stateHash: string | null;
      start: { board: string; x: number; y: number; layer: number };
      party: string[]; seed: number;
    };
    return {
      liveStateHash: live?.stateHash,
      snapshot,
      stateHashMatches: snapshot.stateHash === live?.stateHash,
    };
  });
  const sceneResult = await scene();
  expect(sceneResult.live?.player).toEqual({ x: 48, y: 63 });
  expect(result.liveStateHash).toBeTruthy();
  expect(result.stateHashMatches).toBe(true);
  expect(sceneResult.text.join(" ")).not.toContain("VS CODE FIXTURE PROOF");
  expect(result.snapshot.kind).toBe("board");
  expect(result.snapshot.start).toEqual({ board: "Game/Example/Boards/village.brd", x: 2, y: 2, layer: 1 });
  expect(result.snapshot.party).toEqual(["Game/Example/Chrs/ada.tem"]);
  expect(result.snapshot.seed).toBe(23);
  await verifyHostRunHash(page, frame, expect);
}

/** Refused saves and edits during snapshot preparation must prevent launching a player. */
export async function runVscodeGuardProof(
  page: Page, expect: Expect, workbenchUrl: string, gamePath: string,
  readBacking: () => Promise<Uint8Array>, original: Uint8Array, raced: Uint8Array,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await page.getByRole("treeitem", { name: "Main", exact: true }).click();
  await openGame(page, gamePath, expect);
  const editor = await waitForEditorFrame(page, "VS Code guard editor");
  const title = editor.getByLabel("Game title");
  await title.fill("Save must fail");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await runCommand(page, expect, "Test: Fail Saves");
  await runCommand(page, expect, "Test: Run Example Program");
  await expect(page.getByText(/Program launch refused:.*save/i)).toBeVisible({ timeout: 30_000 });
  expect(await readBacking()).toEqual(original);
  expect(await Promise.all(page.frames().map((frame) => frame.locator("#screen").count()))).not.toContain(1);
  await runCommand(page, expect, "Test: Allow Saves");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await runCommand(page, expect, "Test: Pause Program Read");
  await runCommand(page, expect, "Test: Run Example Program");
  await expect(page.getByText("Fixture read paused")).toBeVisible({ timeout: 30_000 });
  await title.fill("Race saved");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(readBacking, { timeout: 30_000 }).toEqual(raced);
  await runCommand(page, expect, "Test: Resume Program Read");
  await expect(page.getByText(/Program launch refused:.*changed/i)).toBeVisible({ timeout: 30_000 });
  expect(await Promise.all(page.frames().map((frame) => frame.locator("#screen").count()))).not.toContain(1);
}

type WizardGroupRecord = {
  readonly kind: string;
  readonly name: string;
  readonly before: readonly { readonly path: string; readonly sha256: string | null }[];
  readonly written: readonly { readonly path: string; readonly sha256: string }[];
};

async function proveWizardGroupFromBacking(
  projectPath: string,
  expectedName: string,
  writtenPaths: readonly string[],
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  expect: Expect,
): Promise<void> {
  const folder = `${projectPath}/.tkr-history/groups/`;
  const records = (await tree()).filter((path) => path.startsWith(folder) && path.endsWith(".json"));
  const matching: string[] = [];
  for (const path of records) {
    const group = JSON.parse(new TextDecoder().decode(await readBacking(path))) as WizardGroupRecord;
    if (group.name === expectedName) matching.push(path);
  }
  expect(matching, `${expectedName} wizard wrote one durable group record`).toHaveLength(1);
  const group = JSON.parse(new TextDecoder().decode(await readBacking(matching[0]!))) as WizardGroupRecord;
  expect(group.kind).toBe("group");
  expect(group.name).toBe(expectedName);
  expect(group.before.map((item) => item.path).sort()).toEqual([...writtenPaths].sort());
  expect(group.before.every((item) => item.sha256 === null), "new wizard destinations are recorded absent before writing").toBe(true);
  expect(group.written.map((item) => item.path).sort()).toEqual([...writtenPaths].sort());
  for (const path of writtenPaths) {
    const bytes = await readBacking(`${projectPath}/${path}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(group.written.find((item) => item.path === path)?.sha256, `${path} has its actual written-byte SHA-256`).toBe(hash);
  }
}


export async function runVscodeNewProjectProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  const before = await tree();
  const widget = page.locator(".quick-input-widget");
  const commandInput = await commandPalette(page, expect);
  await commandInput.fill(">RPG Toolkit: New project");
  const row = page.getByRole("option", { name: /^RPG Toolkit: New project(?:,|$)/ });
  await expect(row, "the New project command is contributed exactly once").toHaveCount(1);
  await row.click();
  // The command's first question is an input box; Escape dismisses it and the command reports a cancel.
  await expect(widget, "the first question is shown").toBeVisible();
  const answer = widget.getByRole("textbox");
  await expect(answer).toBeVisible();
  await expect(widget).toContainText("Game name");
  await answer.press("Escape");
  await expect(widget).toBeHidden();
  expect(await tree(), "dismissing the wizard wrote nothing").toEqual(before);

  const repeatedCommand = await commandPalette(page, expect);
  await repeatedCommand.fill(">RPG Toolkit: New project");
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(widget).toContainText("Game name");
  await answer.fill("Native wizard quest");
  await answer.press("Enter");
  await expect(widget).toContainText("Main file name");
  await answer.fill("Quest.gam");
  await answer.press("Enter");
  await expect(widget).toContainText("starter contents");
  await widget.getByRole("checkbox", { name: "Start-up program", exact: true }).check();
  await widget.getByRole("checkbox", { name: "Empty start board", exact: true }).check();
  await widget.getByRole("button", { name: "OK", exact: true }).click();
  await expect(widget).toContainText("New project: choose the destination folder");
  // Earlier save dialogs can change VS Code's remembered directory; navigate through the real picker.
  await answer.fill("/");
  await expect(answer).toHaveValue("/");
  const destination = widget.getByRole("option", { name: "__tkr_new_project", exact: true });
  await expect.poll(() => destination.isVisible(), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  await destination.click({ timeout: 1_000 });
  await expect(answer).toHaveValue("/__tkr_new_project/");
  const previousExtensionHost = page.frames().find((frame) => frame.url().includes("webWorkerExtensionHostIframe.html"));
  if (previousExtensionHost === undefined) throw new Error("The new-project command did not have a running extension host");
  await widget.getByRole("button", { name: "Create project here", exact: true }).click();

  const folders = ["Bitmap", "Bkrounds", "Boards", "Chrs", "Enemy", "Font", "Item", "Main", "Media", "Misc", "Plugin", "Prg", "SpcMove", "StatusE", "Tiles"];
  const additions = [
    ...folders.map((folder) => `__tkr_new_project/${folder}/`),
    "__tkr_new_project/Main/Quest.gam",
    "__tkr_new_project/Prg/start.prg",
    "__tkr_new_project/Boards/start.brd",
  ];
  await expect.poll(async () => (await tree()).filter((path) => !path.startsWith("__tkr_new_project/.tkr-history/")), { timeout: 30_000 }).toEqual([...before, ...additions].sort());
  await proveWizardGroupFromBacking("__tkr_new_project", "New project", ["Main/Quest.gam", "Prg/start.prg", "Boards/start.brd"], tree, readBacking, expect);
  expect(new TextDecoder().decode(await readBacking("__tkr_new_project/keep.txt"))).toBe("Keep this file");
  const bytes = await readBacking("__tkr_new_project/Main/Quest.gam");
  const parsed = readMainFile(new BinaryReader(bytes, "Main/Quest.gam"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error.message);
  expect(parsed.value.gameTitle).toBe("Native wizard quest");
  expect(parsed.value.startupPrg).toBe("start.prg");
  expect(parsed.value.initBoard).toBe("start.brd");

  // Adding the new root converts the single-folder window and restarts its extension host.
  // No follow-up command is allowed to activate the extension or open the file on its behalf.
  await expect.poll(() => previousExtensionHost.isDetached(), { timeout: 60_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  await expect.poll(
    () => page.getByRole("tab", { name: /^Quest\.gam(?:,|$)/, selected: true }).isVisible(),
    { timeout: 60_000, intervals: [100, 250, 500, 1_000] },
  ).toBe(true);
  // Reacquire visible frames across the workspace conversion, rather than retaining an old editor frame.
  await expect(async () => {
    const titles: string[] = [];
    for (const frame of page.frames()) {
      const title = frame.getByRole("textbox", { name: "Game title", exact: true });
      if (await title.isVisible()) titles.push(await title.inputValue({ timeout: 1_000 }));
    }
    expect(titles).toContain("Native wizard quest");
  }).toPass({ timeout: 60_000, intervals: [100, 250, 500, 1_000] });
  await proveNativeHistoryUi(page, expect, tree, readBacking);
  await proveNativeNewBoard(page, expect, tree, readBacking);
}

async function proveNativeHistoryUi(page: Page, expect: Expect, tree: () => Promise<readonly string[]>, readBacking: (path: string) => Promise<Uint8Array>): Promise<void> {
  let editor = await waitForEditorFrame(page, "History proof editor");
  await editor.getByRole("textbox", { name: "Game title", exact: true }).fill("History first");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await expect.poll(async () => (await readBacking("__tkr_new_project/Main/Quest.gam")).byteLength, { timeout: 30_000 }).toBeGreaterThan(0);
  const firstSaved = await readBacking("__tkr_new_project/Main/Quest.gam");

  editor = await waitForEditorFrame(page, "History proof editor after first save");
  await editor.getByRole("textbox", { name: "Game title", exact: true }).fill("History second");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  const secondSaved = await readBacking("__tkr_new_project/Main/Quest.gam");
  expect(createHash("sha256").update(firstSaved).digest("hex")).not.toBe(createHash("sha256").update(secondSaved).digest("hex"));

  await runCommand(page, expect, "RPG Toolkit: Document history");
  const picker = page.locator(".quick-input-widget");
  let options = picker.getByRole("option").filter({ hasText: "saved" });
  const savedCount = await options.count();
  if (savedCount !== 2) {
    const persisted = (await tree()).filter((path) => path.startsWith("__tkr_new_project/.tkr-history/"));
    const pickerText = await picker.innerText().catch(() => "");
    const notifications = await page.locator(".notifications-toasts").innerText().catch(() => "");
    throw new Error(`Expected two saved versions in the real History picker; found ${savedCount}. Picker: ${pickerText}; notifications: ${notifications}; persisted history paths: ${persisted.join(", ")}`);
  }
  await expect(options).toHaveCount(2);
  await options.first().click();
  await verifyHistoryPreview(page, expect, "History first");
  await expect.poll(() => readBacking("__tkr_new_project/Main/Quest.gam"), { timeout: 30_000 }).toEqual(firstSaved);
  const report = page.getByText(/Each file is reported separately; the restore is itself in history, so it can be undone\./);
  await expect(report).toBeVisible({ timeout: 30_000 });
  editor = await waitForEditorFrame(page, "History editor after restoring the first save");
  await expect(editor.getByRole("textbox", { name: "Game title", exact: true })).toHaveValue("History first");

  await runCommand(page, expect, "RPG Toolkit: Document history");
  options = page.locator(".quick-input-widget").getByRole("option").filter({ hasText: "before a restore" });
  await expect(options).toHaveCount(1);
  await options.click();
  await verifyHistoryPreview(page, expect, "History second");
  await expect.poll(() => readBacking("__tkr_new_project/Main/Quest.gam"), { timeout: 30_000 }).toEqual(secondSaved);
  await expect(report).toBeVisible({ timeout: 30_000 });
  editor = await waitForEditorFrame(page, "History editor after restoring the restore");
  await expect(editor.getByRole("textbox", { name: "Game title", exact: true })).toHaveValue("History second");
}

async function verifyHistoryPreview(page: Page, expect: Expect, expectedTitle: string): Promise<void> {
  let preview: Frame | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.getByRole("heading", { name: "History preview", exact: true }).count() > 0) {
        preview = frame;
        return true;
      }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (preview === undefined) throw new Error("The History command did not open its actual read-only preview webview");
  await expect(preview.getByRole("region", { name: "Saved file contents" })).toContainText(expectedTitle);
}

async function proveNativeNewBoard(
  page: Page,
  expect: Expect,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  await runCommand(page, expect, "RPG Toolkit: New board");
  const widget = page.locator(".quick-input-widget");
  const answer = widget.getByRole("textbox");
  await expect(widget).toContainText("Name of the new board");
  await answer.fill("Native history board");
  await answer.press("Enter");

  const choose = async (label: string): Promise<void> => {
    const option = widget.getByRole("option", { name: label, exact: true });
    await expect(option).toBeVisible();
    await option.click();
  };
  await expect(widget).toContainText("New board: start from");
  await choose("A blank board");
  await expect(widget).toContainText("New board: layout");
  await choose("Top-down (2D)");
  await expect(widget).toContainText("New board: coordinates");
  await choose("Tile coordinates");

  for (const [prompt, value] of [["Width in tiles", "4"], ["Height in tiles", "3"], ["Number of layers", "1"], ["Background image (leave empty for none)", ""]] as const) {
    await expect(widget).toContainText(prompt);
    await answer.fill(value);
    await answer.press("Enter");
  }
  await expect(page.getByRole("tab", { name: /^Native history board\.brd(?:,|$)/, selected: true })).toBeVisible({ timeout: 30_000 });
  await proveWizardGroupFromBacking("__tkr_new_project", "New board", ["Boards/Native history board.brd"], tree, readBacking, expect);
}

/** Exercise the shipped VS Code custom editor with real sprite bytes through the workspace bridge. */
export async function runVscodeSpriteWebProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  spritePath: string,
  originalBytes: Uint8Array,
  host: Pick<ProofHost, "readBacking">,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const chrsFolder = page.getByRole("treeitem", { name: "Chrs", exact: true });
  await expect(chrsFolder).toBeVisible();
  await chrsFolder.click();
  await openGame(page, spritePath, expect);
  let editor = await waitForEditorFrame(page, "opened sprite graphics editor");
  const view = editor.getByRole("region", { name: "character sprite graphics" });
  await expect(view).toBeVisible();
  const south = view.getByRole("group", { name: "Directional walk animations" }).getByLabel("South animation file");
  await expect(south).toBeVisible();
  await south.fill("Misc/vscode-web-proof.anm");
  await south.press("Tab");
  await expect(view.getByText("Graphics change recorded. Save the document to keep it.", { exact: true })).toBeVisible();
  const north = view.getByRole("group", { name: "Directional walk animations" }).getByLabel("North animation file");
  await north.fill("Misc/vscode-web-proof.gif");
  await north.press("Tab");
  // #2609: the character editor cannot open linked files; keep the disclosure and omit Open actions.
  const authoring = editor.getByRole("region", { name: "Character authoring" });
  await expect(authoring.getByLabel("Linked authoring availability")).toContainText("cannot open linked");
  await expect(authoring.getByRole("button", { name: /^Open (level-up program|special-move file)$/ })).toHaveCount(0);
  // #2613: the last edit is submitted by leaving its field; the view's Save, like VS Code's, includes it.
  await authoring.getByLabel("Character name", { exact: true }).fill("Vscode proof");
  await authoring.getByLabel("Health (HP)", { exact: true }).fill("77");
  await authoring.getByLabel("Health (HP)", { exact: true }).press("Tab");
  // Switch away before the webview-side character queue has any reason to be drained, then save all while it is hidden.
  await editor.evaluate(() => { (window as ProofWindow & { __tkrCharacterAlive?: string }).__tkrCharacterAlive = "before-hiding"; });
  await runCommandMatching(page, expect, "New Untitled", "a new untitled editor", true);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: /Untitled/ })).toBeVisible();
  await runCommand(page, expect, "Test: Save All Workbench Editors");
  await expect.poll(() => host.readBacking(spritePath), { timeout: 30_000 }).not.toEqual(originalBytes);
  await closeActiveEditor(page, expect);
  editor = await waitForEditorFrame(page, "character editor shown again after Save All");
  const characterViewAlive = await editor.evaluate(() => (window as ProofWindow & { __tkrCharacterAlive?: string }).__tkrCharacterAlive);
  if (characterViewAlive !== "before-hiding") throw new Error("VS Code destroyed the retained character-editor page while its tab was hidden");
  const restoredAuthoring = editor.getByRole("region", { name: "Character authoring" });
  await expect(restoredAuthoring.getByLabel("Character name", { exact: true })).toHaveValue("Vscode proof");
  await expect(restoredAuthoring.getByLabel("Health (HP)", { exact: true })).toHaveValue("77");
  const savedBytes = await host.readBacking(spritePath);
  expect(savedBytes).not.toEqual(originalBytes);
  const previewStylesheet = editor.locator('link[rel="stylesheet"][href$="tileset-browser.css"]');
  await expect(previewStylesheet).toHaveCount(1);
  expect(await previewStylesheet.evaluate((link) => (link as HTMLLinkElement).sheet !== null)).toBe(true);
  const previewStage = view.locator(".tkr-sprite-preview-stage");
  await expect(previewStage).toBeVisible();
  const previewOverlay = previewStage.locator(".tkr-sprite-preview-overlay");
  await expect(previewOverlay).toBeVisible();
  const previewLayout = await previewStage.evaluate((stage) => {
    const overlay = stage.querySelector<SVGSVGElement>(".tkr-sprite-preview-overlay");
    if (overlay === null) throw new Error("the sprite origin overlay is missing");
    const stageStyle = getComputedStyle(stage);
    const overlayStyle = getComputedStyle(overlay);
    return {
      stagePosition: stageStyle.position,
      stageDisplay: stageStyle.display,
      stageWidth: stageStyle.width,
      stageHeight: stageStyle.height,
      overlayPosition: overlayStyle.position,
      overlayTop: overlayStyle.top,
      overlayRight: overlayStyle.right,
      overlayBottom: overlayStyle.bottom,
      overlayLeft: overlayStyle.left,
      overlayWidth: overlayStyle.width,
      overlayHeight: overlayStyle.height,
      overlayPointerEvents: overlayStyle.pointerEvents,
      hasInlineStyle: stage.hasAttribute("style") || overlay.hasAttribute("style"),
    };
  });
  expect(previewLayout).toMatchObject({
    stagePosition: "relative",
    stageDisplay: "inline-block",
    overlayPosition: "absolute",
    overlayTop: "0px",
    overlayRight: "0px",
    overlayBottom: "0px",
    overlayLeft: "0px",
    overlayPointerEvents: "none",
    hasInlineStyle: false,
  });
  expect(previewLayout.overlayWidth).toBe(previewLayout.stageWidth);
  expect(previewLayout.overlayHeight).toBe(previewLayout.stageHeight);
  await closeActiveEditor(page, expect);
  await openGame(page, spritePath, expect);
  editor = await waitForEditorFrame(page, "reopened sprite graphics editor");
  const reopened = editor.getByRole("region", { name: "character sprite graphics" });
  const reopenedWalk = reopened.getByRole("group", { name: "Directional walk animations" });
  await expect(reopenedWalk.getByLabel("South animation file")).toHaveValue("Misc/vscode-web-proof.anm");
  await expect(reopenedWalk.getByLabel("North animation file")).toHaveValue("Misc/vscode-web-proof.gif");
  const reopenedAuthoring = editor.getByRole("region", { name: "Character authoring" });
  await expect(reopenedAuthoring.getByLabel("Character name", { exact: true })).toHaveValue("Vscode proof");
  await expect(reopenedAuthoring.getByLabel("Health (HP)", { exact: true })).toHaveValue("77");
  await expect(reopened.getByText("All sprite changes saved.", { exact: true })).toBeVisible();
  expect(await host.readBacking(spritePath)).toEqual(savedBytes);
}

/** Focus the VS Code command-palette autosave proof on a fresh real custom editor. */
export async function runVscodeAutosaveCommandProof(
  page: Page, expect: Expect, workbenchUrl: string, gamePath: string, autosaveTitle: string,
  autosaveBytes: Uint8Array, host: ProofHost,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  await openGame(page, gamePath, expect);
  await waitForEditorFrame(page, "focused autosave command proof settings editor");
  await runAutosaveCommandScenario(page, expect, autosaveTitle, autosaveBytes, host);
}

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

  // The package command is contributed to both the command palette and .gam Explorer context menu.
  const packageCommand = await commandPalette(page, expect);
  await packageCommand.fill(">RPG Toolkit: Package game");
  const packageEntry = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "RPG Toolkit: Package game" }).first();
  await expect(packageEntry).toBeVisible();
  await packageCommand.press("Escape");
  await expect(page.locator(".quick-input-widget")).toBeHidden();

  const packageCommandInput = await commandPalette(page, expect);
  await packageCommandInput.fill(">Test: Execute Package Game");
  const packageCommandEntry = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "Test: Execute Package Game" }).first();
  await expect(packageCommandEntry).toBeVisible();
  await packageCommandEntry.click();
  await expect(page.getByText(/Preflight passed:/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Included \(\d+\):/)).toBeVisible();
  await page.keyboard.press("Escape");

  const editor = await waitForEditorFrame(page, "initial Game settings editor");
  const titleField = editor.getByLabel("Game title");
  await expectVisibleWithFrameDiagnostics(page, titleField, expect, "initial Game title field");
  assertNoCspConsoleViolations(consoleViolations, "before installing the actual settings-document CSP listener");
  await instrumentCspFrame(editor);
  await assertCspListenerCountsBlockedAction(editor, expect, consoleViolations);
  const before = await readWorkspaceBytes(page, expect);
  await titleField.fill(title);
  await editor.getByRole("button", { name: "Apply changes" }).click();
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


  // Save through the registered package command's Save As dialog in the real VS Code web workbench, then inspect its
  // persisted package and descriptor independently of the UI.
  const publishCommand = await commandPalette(page, expect);
  await publishCommand.fill(">Test: Execute Package Game");
  const publishEntry = page.locator(".quick-input-list .monaco-list-row").filter({ hasText: "Test: Execute Package Game" }).first();
  await expect(publishEntry).toBeVisible();
  await publishEntry.click();
  await expect(page.getByText(/Preflight passed:/)).toBeVisible({ timeout: 15_000 });
  const inventoryDialog = page.getByRole("dialog");
  await expect(inventoryDialog.getByText(/Included \(\d+\):/)).toBeVisible();
  await inventoryDialog.getByRole("button", { name: "Choose where to save…", exact: true }).click();
  const packageBase = title.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "game";
  const packageName = `${packageBase}.tpk`;
  const savePath = page.getByRole("textbox", { name: "Folder path" });
  await expect(savePath).toHaveValue(`/.tkr-exports/${packageName}`);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "The folder .tkr-exports does not exist. Would you like to create it?" })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByText(/Package saved to .* and install descriptor saved to/).first()).toBeVisible({ timeout: 15_000 });
  const packageBytes = await host.readBacking(`.tkr-exports/${packageName}`);
  const descriptorBytes = await host.readBacking(`.tkr-exports/${packageName}.json`);
  const descriptor = JSON.parse(new TextDecoder().decode(descriptorBytes)) as {
    file: string;
    sha256: string;
    size: number;
    title: string;
    version: string;
  };
  expect(descriptor.file).toBe(packageName);
  expect(descriptor.sha256).toBe(createHash("sha256").update(packageBytes).digest("hex"));
  expect(descriptor.size).toBe(packageBytes.byteLength);
  expect(descriptor.title).toBe(title);
  expect(descriptor.version).toBe("1.0.0");
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
  await sentinelEditor.getByRole("button", { name: "Apply changes" }).click();
  await expect(sentinelEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  const sentinelTab = page.getByRole("tab").filter({ hasText: sentinelPath }).first();
  await expect(sentinelTab).toHaveClass(/dirty/);
  await expect.poll(() => backupIsStored(page, host.sentinelBytes), { timeout: 15_000 }).toBe(true);
  await page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first().click();
  reopenedEditor = await waitForTitledEditor(page, title, expect);
  const backupTraceStart = backupTrackerLogs.length;
  const recoveredTitleField = reopenedEditor.getByLabel("Game title");
  await recoveredTitleField.click();
  await recoveredTitleField.fill(recoveredTitle);
  await reopenedEditor.getByRole("button", { name: "Apply changes" }).click();
  await expectValueWithFrameDiagnostics(page, recoveredTitleField, recoveredTitle, expect);
  await expect(reopenedEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
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
    const status = await reopenedEditor.locator(".tkr-settings-state").innerText().catch((readError) => `<unavailable: ${String(readError)}>`);
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


  await expect(recoveredEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
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
    await expect(sentinelEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
    expect(await host.readBacking(sentinelPath)).toEqual(sentinelBacking);
    await page.getByRole("tab").filter({ hasText: gamePath.split("/").at(-1)! }).first().click();
    recoveredEditor = await waitForTitledEditor(page, recoveredTitle, expect);
  };
  await verifySentinel();
  expect(host.readHostEvents()).toContainEqual({ kind: "save-request", value: `/${gamePath}` });
  const choiceTraceStart = backupTrackerLogs.length;
  const hostEventsStart = host.readHostEvents().length;
  if (host.choice === "cancel") {
    await recoveredEditor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(recoveredEditor.getByRole("button", { name: "Review conflict" })).toBeVisible();
    await expect(recoveredEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
    expect(await readWorkspaceBytes(page, expect)).toEqual(externalAfterRestart);
    expect(await host.readBacking()).toEqual(externalAfterRestart);
    await verifySentinel();
    const review = recoveredEditor.getByRole("button", { name: "Review conflict" });
    if (await review.isVisible()) await review.click();
  }
  await expect(recoveredEditor.getByRole("button", { name: "Keep my version" })).toBeVisible();
  await recoveredEditor.getByRole("button", { name: "Keep my version" }).click();
  await runCommand(page, expect, "Notifications: Clear All Notifications");
  await expect(recoveredEditor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
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
  await expect(recoveredEditor.locator(".tkr-settings-state")).toHaveText("All changes saved");
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

  await runLifecycleScenarios(page, expect, autosaveTitle, autosaveBytes, host, gamePath);
  // The packaged custom editor runs in the actual VS Code webview and persists boards through its working-copy provider.
  await runBoardBrowserScenario(page, expect, host);
  const artFrame = await runVscodeArtProof(page, expect, host, {
    focusWorkbench: () => focusWorkbench(page),
    command: (title) => runCommand(page, expect, title),
    closeEditor: () => closeActiveEditor(page, expect),
    backupStored: (bytes) => backupIsStored(page, bytes),
    instrument: (frame) => instrumentCspFrame(frame),
  });
  await expect.poll(() => frameCspViolations(page, artFrame, consoleViolations)).toEqual([]);
  await assertCspListenerCountsBlockedAction(artFrame, expect, consoleViolations);
  // The same packaged extension edits a tile bitmap through the shared browser and persists it through the same provider.
  await runBitmapBrowserScenario(page, expect, host);
  await runBitmapSelectionRetentionScenario(page, expect, host);
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
    await frame.getByLabel("Source", { exact: true }).selectOption({ label: "village.tst (tst)" });
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
    // The grid shows the current layer (the second, since the layer was changed above), which holds no tiles yet.
    const base = await tile2.count();
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await expect(state).toHaveText("Unsaved changes");
    const edge = await tile2.count();
    expect(edge, `${entry.label}: the rectangle added cells`).toBeGreaterThan(base);
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
    await expect.poll(() => tile2.count()).toBe(base);
    await expect(state).toHaveText("All changes saved");
    await closeActiveEditor(page, expect);
    const reopened = await openProjectBoard(page, entry.path, expect);
    await expect(reopened.locator('.tkr-board-cell[aria-label$=": village.tst2"]')).toHaveCount(drawn);
    await closeActiveEditor(page, expect);
  }
}

/**
 * #2501 in the packaged VS Code web UI: a brush chosen in the shared browser is retained when the tab that chose it is
 * closed straight after the choice (no waiting between the click and the close), and the next bitmap opened shows it.
 * The first cycle chooses a whole stamp, the second a single tile, so a stale or lost selection cannot pass for either.
 * This observes the real workbench at the speed of a scripted user. VS Code does not guarantee delivery of a webview
 * message still in flight when its panel is disposed, so no faster close is promised.
 */
async function runBitmapSelectionRetentionScenario(page: Page, expect: Expect, host: ProofHost): Promise<void> {
  // The previous scenario left the 2 × 2 `house.tbm` stamp chosen, so this one chooses the 3 × 1 `other.tbm` stamp: losing
  // the new choice leaves the old one showing, which fails the first check below.
  const otherName = host.otherBitmapPath.split("/").at(-1)!;
  const house = await openProjectFile(page, host.bitmapPath, expect, ".tkr-bitmap");
  await house.locator(".tkr-tileset-browser select").selectOption({ value: host.otherBitmapPath });
  await expect(house.locator(`[data-browser-reference="${otherName}"]`)).toBeVisible();
  await house.getByRole("button", { name: "Select stamp brush" }).click();
  await closeActiveEditor(page, expect);
  const other = await openProjectFile(page, host.otherBitmapPath, expect, ".tkr-bitmap");
  await expect(other.locator(".tkr-bitmap-brush")).toContainText("A whole stamp (3 × 1 tiles) is chosen");
  await other.locator(".tkr-tileset-browser select").selectOption({ value: "Tiles/village.tst" });
  await other.locator('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source').click();
  await closeActiveEditor(page, expect);
  const again = await openProjectFile(page, host.bitmapPath, expect, ".tkr-bitmap");
  await expect(again.locator(".tkr-bitmap-brush")).toContainText("Brush: village.tst tile 2");
  await closeActiveEditor(page, expect);
}

async function runBoardBrowserScenario(page: Page, expect: Expect, host: ProofHost): Promise<void> {
  const firstPath = host.boardPath;
  const secondPath = host.otherBoardPath;
  const firstBefore = await host.readBacking(firstPath);
  const secondBefore = await host.readBacking(secondPath);
  const first = await openProjectBoard(page, firstPath, expect);
  await expect(first.getByRole("grid")).toBeVisible();
  await expect(first.getByRole("button", { name: "Column 1, row 1: village.tst1" })).toBeVisible();
  await first.locator(".tkr-tileset-browser select").selectOption({ value: "Tiles/village.tst" });
  await first.getByRole("combobox", { name: "Source", exact: true }).selectOption({ label: "village.tst (tst)" });
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
  await expect(first.locator(".tkr-board-state")).toHaveText("All changes saved");
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
  await expect(second.locator(".tkr-board-state")).toHaveText("All changes saved");
  const secondSaved = await host.readBacking(secondPath);
  expect(secondSaved).not.toEqual(secondBefore);
  expect(await host.readBacking(firstPath)).toEqual(firstSaved);
  await closeActiveEditor(page, expect);

  const reopened = await openProjectBoard(page, secondPath, expect);
  await expect(reopened.getByRole("button", { name: "Column 1, row 1: village.tst2" })).toBeVisible();
  expect(await host.readBacking(secondPath)).toEqual(secondSaved);
  await closeActiveEditor(page, expect);
}

/** The story 12.8 proof in the real workbench: draw with a browser tile, shade a cell, save, reopen, and choose the whole bitmap as a stamp. */
async function runBitmapBrowserScenario(page: Page, expect: Expect, host: ProofHost): Promise<void> {
  const path = host.bitmapPath;
  const before = await host.readBacking(path);
  const otherBefore = await host.readBacking(host.otherBitmapPath);
  const first = await openProjectFile(page, path, expect, ".tkr-bitmap");
  await expect(first.getByRole("heading", { name: "Tile bitmap" })).toBeVisible();
  await expect(first.locator(".tkr-bitmap-summary")).toContainText("2 × 2 tiles, 64 × 64 pixels");
  await expect(first.locator("canvas.tkr-bitmap-canvas")).toBeVisible();
  // What the webview's canvas holds is read back and compared with the compositor's own picture of the file.
  await expectCanvasPixels(first, expect, host.bitmapPicture(false));
  await expect(first.getByRole("button", { name: "Column 2, row 1: village.tst2, shade 10, -20, 30" })).toBeVisible();
  // The grid is laid out as a grid: the second column is to the right on the same line, the second row below.
  const box = async (name: string | RegExp) => {
    const found = await first.getByRole("button", { name }).boundingBox();
    if (found === null) throw new Error(`${name} has no layout box`);
    return found;
  };
  const topLeft = await box(/^Column 1, row 1:/);
  const topRight = await box(/^Column 2, row 1:/);
  const bottomLeft = await box(/^Column 1, row 2:/);
  expect(Math.abs(topRight.y - topLeft.y)).toBeLessThan(2);
  expect(topRight.x).toBeGreaterThanOrEqual(topLeft.x + topLeft.width);
  expect(Math.abs(bottomLeft.x - topLeft.x)).toBeLessThan(2);
  expect(bottomLeft.y).toBeGreaterThanOrEqual(topLeft.y + topLeft.height);
  // Choosing a tile in the shared browser edits nothing; Draw puts it on the clicked cell.
  await first.getByRole("combobox", { name: "Source", exact: true }).selectOption({ label: "village.tst (tst)" });
  const tile = first.locator('[data-browser-reference="village.tst1"] .tkr-tileset-browser-source');
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  expect(await host.readBacking(path)).toEqual(before);
  await first.getByRole("button", { name: "Draw", exact: true }).click();
  await first.getByRole("button", { name: /^Column 2, row 1:/ }).click();
  await expect(first.getByRole("button", { name: "Column 2, row 1: village.tst1, shade 10, -20, 30" })).toBeVisible();
  await first.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  const red = first.getByLabel("Red", { exact: true });
  await red.fill("-255");
  await expect(red).toHaveValue("-255");
  await red.press("Enter");
  await expect(first.getByRole("button", { name: "Column 1, row 1: village.tst1, shade -255, 0, 0" })).toBeVisible();
  await expectCanvasPixels(first, expect, host.bitmapPicture(true));
  await expect(first.locator(".tkr-bitmap-state")).toHaveText("Unsaved changes");
  expect(await host.readBacking(path)).toEqual(before);
  await first.getByRole("button", { name: "Save", exact: true }).click();
  await expect(first.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  expect(await host.readBacking(path)).toEqual(host.bitmapSaved);
  await closeActiveEditor(page, expect);

  const reopened = await openProjectFile(page, path, expect, ".tkr-bitmap");
  await expect(reopened.locator(".tkr-bitmap-summary")).toContainText("2 × 2 tiles");
  await expect(reopened.getByRole("button", { name: "Column 1, row 1: village.tst1, shade -255, 0, 0" })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Column 2, row 1: village.tst1, shade 10, -20, 30" })).toBeVisible();
  // The whole bitmap is a stamp brush: choosing it carries its size and changes nothing.
  await reopened.locator(".tkr-tileset-browser select").selectOption({ value: path });
  await reopened.getByRole("button", { name: "Select stamp brush" }).click();
  await expect(reopened.locator(".tkr-bitmap-brush")).toContainText("A whole stamp (2 × 2 tiles) is chosen");
  await expect(reopened.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  expect(await host.readBacking(path)).toEqual(host.bitmapSaved);
  await expectCanvasPixels(reopened, expect, host.bitmapPicture(true));

  // Edit tile bitmap opens exactly the chosen file in its own editor, and shows that file, not this one.
  const otherName = host.otherBitmapPath.split("/").at(-1)!;
  await reopened.locator(".tkr-tileset-browser select").selectOption({ value: host.otherBitmapPath });
  const item = reopened.locator(`[data-browser-reference="${otherName}"]`);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "More actions" }).click();
  await item.getByRole("button", { name: "Edit tile bitmap" }).click();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: otherName }).first()).toBeVisible();
  const other = await waitForCustomEditorFrame(page, host.otherBitmapPath, ".tkr-bitmap-summary:has-text('3 × 1 tiles')");
  await expect(other.getByRole("button", { name: "Column 3, row 1: village.tst2, shade 1, 2, 3" })).toBeVisible();
  expect(await host.readBacking(host.otherBitmapPath)).toEqual(otherBefore);
  await closeActiveEditor(page, expect);
  await closeActiveEditor(page, expect);
}

/** Wait until the frame's tile bitmap canvas holds exactly `expected` (RGBA, row by row). */
async function expectCanvasPixels(frame: Frame, expect: Expect, expected: { width: number; height: number; data: number[] }): Promise<void> {
  await expect.poll(async () => await frame.locator("canvas.tkr-bitmap-canvas").evaluate((element, want) => {
    const canvas = element as HTMLCanvasElement;
    if (canvas.width !== want.width || canvas.height !== want.height) return false;
    const seen = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return seen.length === want.data.length && want.data.every((value, index) => seen[index] === value);
  }, expected), { message: "the webview's canvas shows the pixels the compositor makes of the file" }).toBe(true);
}

async function openProjectBoard(page: Page, path: string, expect: Expect): Promise<Frame> {
  return openProjectFile(page, path, expect, ".tkr-board");
}

/** Open the exact workspace-relative file through VS Code's native Quick Open. */
async function openProjectFile(page: Page, path: string, expect: Expect, selector: string): Promise<Frame> {
  await focusWorkbench(page);
  await openNativeQuickOpenFile(page, expect, path);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
  return await waitForCustomEditorFrame(page, path, selector);
}

async function waitForCustomEditorFrame(page: Page, label: string, selector: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  while (Date.now() < deadline) {
    const outer = await page.locator("iframe.webview:visible").first().elementHandle({ timeout: 250 }).catch(() => null);
    if (outer) {
      const outerFrame = await outer.contentFrame().catch(() => null);
      const content = outerFrame?.childFrames().find((frame) => frame.name() === "pending-frame");
      if (content && await content.locator(selector).count().catch(() => 0) > 0) return content;
    }
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  await logFrameDiagnostics(page, `packaged custom editor not found for ${label}`);
  throw new Error(`Timed out waiting for actual VS Code custom editor (${selector}) for ${label}`);
}

/**
 * The lifecycle cases that only the real workbench can prove (story 11.3; ADR 0022 D3.7, D3.6, D11.6):
 *
 * * a hidden webview keeps its page and accepted view state alive, and Save All can settle that hidden editor;
 * * a cancelled close keeps the editor and its work — the workbench asks, and Cancel is an answer;
 * * `files.autoSave: afterDelay` drives `saveCustomDocument`: the file reaches the edited bytes with no Save pressed,
 *   which is the proof the ADR left unverified. Whatever the outcome, autosave is turned off again.
 */
async function runLifecycleScenarios(page: Page, expect: Expect, autosaveTitle: string, autosaveBytes: Uint8Array, host: ProofHost, gamePath: string): Promise<void> {
  const hiddenTitle = "Still here after hiding";
  let editor = await waitForEditorFrame(page, "lifecycle settings editor");
  const field = editor.getByLabel("Game title");
  const beforeHiddenSave = await host.readBacking(gamePath);
  await field.fill(hiddenTitle);
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");

  // A retained custom-editor page keeps its accepted view state while another editor has focus.
  await editor.evaluate(() => { (window as ProofWindow & { __tkrAliveMarker?: string }).__tkrAliveMarker = "before-hiding"; });
  await runCommandMatching(page, expect, "New Untitled", "a new untitled editor", true);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: /Untitled/ })).toBeVisible();
  await runCommand(page, expect, "Test: Save All Workbench Editors");
  await expect.poll(() => host.readBacking(gamePath), { timeout: 30_000 }).not.toEqual(beforeHiddenSave);
  await closeActiveEditor(page, expect);
  editor = await waitForEditorFrame(page, "settings editor shown again");
  const alive = await editor.evaluate(() => (window as ProofWindow & { __tkrAliveMarker?: string }).__tkrAliveMarker);
  if (alive !== "before-hiding") throw new Error("VS Code destroyed the retained custom-editor page when its tab was hidden");
  await expectValueWithFrameDiagnostics(page, editor.getByLabel("Game title"), hiddenTitle, expect);
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  const cancelTitle = "Still here after cancelling close";
  await editor.getByLabel("Game title").fill(cancelTitle);
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await runCommand(page, expect, "View: Close Editor");
  const dialog = page.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  editor = await waitForEditorFrame(page, "settings editor after a cancelled close");
  await expectValueWithFrameDiagnostics(page, editor.getByLabel("Game title"), cancelTitle, expect);
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");


  await runAutosaveCommandScenario(page, expect, autosaveTitle, autosaveBytes, host);
}
async function runAutosaveCommandScenario(
  page: Page, expect: Expect, autosaveTitle: string, autosaveBytes: Uint8Array, host: ProofHost,
): Promise<void> {
  const editor = await waitForEditorFrame(page, "autosave proof settings editor");
  const autosaveField = editor.getByLabel("Game title");
  await autosaveField.fill(autosaveTitle);
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
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
    await expect.poll(async () => autosaveSetting(await host.readBacking(".vscode/settings.json")),
      { message: `VS Code persists files.autoSave=${value}` }).toBe(value);
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
      await runCommandMatching(page, expect, "Test: Pause Autosave Off", "Test: Pause Autosave Off", true);
      await expect.poll(() => readMarker("armed"), {
        message: "VS Code armed the autosave-off completion barrier before Off is dispatched",
      }).toBe("off");
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

/** Dispatch one verified palette row atomically; never retry an attempted dispatch (#2720, #2726). */
async function runCommandMatching(page: Page, expect: Expect, search: string, label: string, dismissFirstAttempt = false): Promise<void> {
  const widget = page.locator(".quick-input-widget");
  let dismissalInjected = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let dismissed = false;
    let row: ElementHandle<HTMLElement | SVGElement> | null = null;
    try {
      const commandInput = await commandPalette(page, expect);
      await commandInput.fill(`>${search}`);
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const command = search === label
        ? page.getByRole("option", { name: new RegExp(`^${escaped}(?:,|$)`) })
        : page.locator(".quick-input-list .monaco-list-row.focused").filter({ hasText: search }).first();
      if (search === label) await expect(command, `VS Code offers exactly one ${label}`).toHaveCount(1, { timeout: 1_000 });
      await expect(command, `VS Code selects ${label}`).toBeVisible({ timeout: 1_000 });
      row = await command.elementHandle({ timeout: 1_000 });
      if (row === null) throw new Error(`VS Code removed ${label} before selection`);
      if (dismissFirstAttempt && !dismissalInjected) {
        // Deliberately lose the palette after locating its row, exercising pre-dispatch recovery.
        await commandInput.press("Escape");
        await expect(widget).toBeHidden();
        dismissalInjected = true;
        dismissed = true;
      }
    } catch (error) {
      // No command event was attempted during preparation, so retrying is unambiguous.
      await row?.dispose();
      if (attempt === 2) throw error;
      if (await widget.isVisible()) {
        await page.keyboard.press("Escape");
        await expect(widget).toBeHidden({ timeout: 1_000 });
      }
      await page.waitForTimeout(100 * (attempt + 1));
      continue;
    }
    let dispatched: boolean;
    try {
      // Verification and the normal list click handler run in one browser task. This avoids
      // both a pointer stability wait during relayout and Enter choosing a different focused row.
      // An evaluation error/timeout has an unknown outcome: it must propagate, never retry.
      dispatched = await row.evaluate((element, target) => {
        const palette = element.closest<HTMLElement>(".quick-input-widget");
        const bounds = element.getBoundingClientRect();
        const name = element.getAttribute("aria-label") ?? "";
        const matches = target.exact ? name === target.search || name.startsWith(`${target.search},`) : (element.textContent ?? "").includes(target.search);
        if (!element.isConnected || palette === null || !matches || bounds.width <= 0 || bounds.height <= 0
          || palette.getBoundingClientRect().height <= 0 || getComputedStyle(element).visibility === "hidden") return false;
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0,
          detail: 1, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
        return true;
      }, { search, exact: search === label });
    } finally {
      await row.dispose();
    }
    if (dismissed && dispatched) throw new Error(`Dismissed palette row ${label} was dispatched by the negative control`);
    if (dispatched) {
      await expect(widget).toBeHidden();
      return;
    }
    // Only an explicit false proves no command was dispatched.
    if (await widget.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(widget).toBeHidden({ timeout: 1_000 });
    }
    await page.waitForTimeout(100 * (attempt + 1));
  }
  throw new Error(`VS Code did not keep ${label} available for dispatch`);
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
  try {
    // The command performs host filesystem reads before publishing; wait with bounded, paced observations, never redispatch.
    await expect.poll(() => panelTabs.count(), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBeGreaterThan(existingCount);
  } catch (cause) {
    const tabs = await page.getByRole("tab").allTextContents();
    throw new Error(`The byte probe did not open a new tab; current tabs: ${JSON.stringify(tabs)}`, { cause });
  }
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
  const segments = gamePath.split("/");
  for (const folder of segments.slice(0, -1)) {
    const folderItem = page.getByRole("treeitem", { name: folder, exact: true });
    await folderItem.click();
    await expect(folderItem).toBeVisible();
    await folderItem.press("ArrowRight");
    await expect(folderItem).toBeVisible();
    if (await folderItem.getAttribute("aria-expanded") !== "true") await folderItem.click();
  }
  const gameFile = page.getByRole("treeitem", { name: segments.at(-1)!, exact: true });
  await expect(gameFile).toBeVisible();
  await gameFile.dblclick();
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: segments.at(-1)! }).first()).toBeVisible();
  await expect(page.locator("iframe.webview:visible")).toBeVisible({ timeout: 30_000 });
}

async function closeActiveEditor(page: Page, expect: Expect): Promise<void> {
  await runCommand(page, expect, "View: Close Editor");
}

async function commandPalette(page: Page, expect: Expect): Promise<Locator> {
  await focusWorkbench(page);
  // Let the previous editor/webview focus transition settle before opening another host UI.
  await page.waitForTimeout(100);
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const input = page.locator(".quick-input-widget input:visible");
  await expect(input).toHaveCount(1);
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
