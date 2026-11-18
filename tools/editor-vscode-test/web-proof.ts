import { ANIMATION_PROOF_PATH, runAnimationAuthoringProof } from "./animation-proof.ts";
import { PROPERTIES_BOARD, runBoardPropertiesProof } from "./board-properties-proof.ts";
import { OBJECTS_BOARD, runBoardObjectsProof } from "./board-objects-proof.ts";
import { CONNECTED_BOARD, CONNECTED_ITEM, runConnectedAuthoringProof } from "./connected-authoring-proof.ts";
import { createHash } from "node:crypto";
import { BinaryReader, readBoard, readMainFile } from "@tk-reawakened/core";
import { boardExtent, boardToScreen, cellCentre, clampViewport, pixelToCell, screenToBoard, zoomTo, type BoardShape, type Cell, type Viewport } from "@tk-reawakened/editor-model";
import type { expect as playwrightExpect, ElementHandle, Frame, Locator, Page } from "@playwright/test";
import { autosaveSetting, combineProofErrors, decodePersistedBytes, openedDocumentUri } from "./lifecycle.ts";
import { runVscodeArtProof } from "./art-proof.ts";
import { openNativeQuickOpenFile } from "./native-quick-open.ts";
import { runVscodeContextualHelpProof } from "./contextual-help-proof.ts";
export { runVscodeCreatorTestsProof } from "./creator-tests-proof.ts";

const copyBytesCommand = "Test: Copy Main File Bytes";

type Expect = typeof playwrightExpect;
type ProofWindow = Window & { __tkrCspViolations?: string[]; __tkrCspPositiveControlRan?: boolean };
type CspConsoleViolation = { text: string; url: string; lineNumber: number; columnNumber: number };
type ProofRunSnapshot = { readonly stateHash: string | null };
type NewProjectHistoryProofHost = {
  pauseWrite(path: string): Promise<void>;
  resumeWrite(): void;
  pauseNativeRestoreRead(path: string): Promise<void>;
  resumeRead(): void;
  readEvents(): { kind: "readDirectory" | "readFile"; path: string }[];
  nativeRestoreReadEvents(): readonly { readonly kind: "readFile"; readonly path: string }[];
  writeEvents(): readonly { readonly kind: "write-request" | "write"; readonly path: string }[];
  writeOperationEvents(): readonly { readonly kind: "write-request" | "write" | "write-failed"; readonly path: string }[];
  failedWriteEvents(): readonly { readonly kind: "write-failed"; readonly path: string }[];
  failWritesUnder(pathPrefix: string): void;
  allowWrites(): void;
  writeBacking(path: string, bytes: Uint8Array): Promise<void>;
  readonly bitmapPath: string;
  bitmapPictureForBytes(bytes: Uint8Array): { width: number; height: number; data: number[] };
  previewTrace?(): readonly string[];
};

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
  readHostEvents(): { kind: "open" | "open-uri" | "resolve" | "edit" | "save" | "save-uri"; value: string }[];
  pauseWrite(path: string): Promise<void>;
  resumeWrite(): void;
  writeEvents(): readonly { readonly kind: "write-request" | "write"; readonly path: string }[];
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
  saveViaWorkbenchShortcut?: "Meta+S" | "Control+S";
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
  await runVscodeContextualHelpProof(page, expect, workbenchUrl);
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

/** The player frames on the page, by their `#screen` canvas. */
async function playerFrames(page: Page): Promise<Frame[]> {
  const found: Frame[] = [];
  for (const frame of page.frames()) {
    if (await frame.locator("#screen").count().catch(() => 0) > 0) found.push(frame);
  }
  return found;
}

/**
 * Run and Debug (ADR 0037): a `tkr` board configuration started like F5 opens the Running Game tab from a snapshot and
 * reports it to the Debug Console; Restart makes a new snapshot; Stop and closing the tab each end the debug session.
 */
export async function runVscodeRunAndDebugProof(page: Page, expect: Expect, workbenchUrl: string): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  const debug = (started: number, ended: number, restarts: number, snapshots: number) =>
    page.getByText(`tkr debug: started ${started}, ended ${ended}, restarts ${restarts}, snapshots ${snapshots}`);
  const onVillage = async (): Promise<void> => {
    await expect.poll(async () => {
      const frames = await playerFrames(page);
      if (frames.length !== 1) return `${frames.length} player frames`;
      return await frames[0]!.evaluate(() => (Reflect.get(window, "__live") as { board?: string | null } | undefined)?.board ?? "no board");
    }, { timeout: 30_000 }).toContain("village.brd");
  };
  await runCommand(page, expect, "Test: Debug Example Board");
  await expect(page.getByText("Debug launch accepted")).toBeVisible({ timeout: 30_000 });
  await onVillage();
  await expect(debug(1, 0, 0, 1)).toBeVisible({ timeout: 30_000 });
  const first = (await playerFrames(page))[0]!;
  const snapshot = JSON.parse(await first.locator("#run-snapshot pre").textContent() ?? "null") as { kind: string; seed: number; party: string[]; start: unknown };
  expect(snapshot).toMatchObject({ kind: "board", seed: 23, party: ["Game/Example/Chrs/ada.tem"], start: { board: "Game/Example/Boards/village.brd", x: 2, y: 2, layer: 1 } });

  await runCommand(page, expect, "Test: Restart Debug Session");
  await expect(debug(1, 0, 1, 2)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => first.isDetached(), { timeout: 30_000 }).toBe(true);
  await onVillage();

  await runCommand(page, expect, "Test: Stop Debug Session");
  await expect(debug(1, 1, 1, 2)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await playerFrames(page)).length, { timeout: 30_000 }).toBe(0);

  await runCommand(page, expect, "Test: Debug Example Board");
  await onVillage();
  await expect(debug(2, 1, 1, 3)).toBeVisible({ timeout: 30_000 });
  await runCommand(page, expect, "Test: Close Running Game Tab");
  await expect(debug(2, 2, 1, 3)).toBeVisible({ timeout: 30_000 });
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
  readonly id: string;
  readonly schema: number;
  readonly reason: string;
  readonly name: string | null;
  readonly restores: string | null;
  readonly files: readonly { readonly path: string; readonly before: string | null; readonly after: string | null; readonly status: string }[];
  readonly uncovered: readonly unknown[];
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
  const allPaths = await tree();
  const records = allPaths.filter((path) => path.startsWith(folder) && path.endsWith(".json"));
  const matching: { readonly path: string; readonly record: WizardGroupRecord }[] = [];
  for (const path of records) {
    const record = JSON.parse(new TextDecoder().decode(await readBacking(path))) as WizardGroupRecord;
    if (record.name === expectedName) matching.push({ path, record });
  }
  expect(matching, `${expectedName} wizard wrote one durable group record`).toHaveLength(1);
  const { path: groupPath, record: manifest } = matching[0]!;
  let group = manifest;
  const progressFolder = `${projectPath}/.tkr-history/progress/${group.id}/`;
  const progressPaths = allPaths.filter((path) => {
    if (!path.startsWith(progressFolder)) return false;
    return /^\d+\.json$/.test(path.slice(progressFolder.length));
  }).sort((a, b) => Number(b.slice(progressFolder.length, -5)) - Number(a.slice(progressFolder.length, -5)));
  for (const progressPath of progressPaths) {
    try {
      const update = JSON.parse(new TextDecoder().decode(await readBacking(progressPath))) as WizardGroupRecord;
      if (update.schema !== 1 || update.id !== group.id || !Array.isArray(update.files) || update.files.length !== group.files.length
        || !update.files.every((file, index) => file.path === group.files[index]!.path && file.before === group.files[index]!.before
          && (file.after === null || /^[a-f0-9]{64}$/.test(file.after))
          && ["pending", "writing", "written", "failed", "already-as-wanted", "kept-uncertain", "uncovered"].includes(file.status))) continue;
      group = { ...group, files: update.files };
      break;
    } catch { /* A torn progress record leaves the preceding durable record authoritative. */ }
  }
  expect(groupPath).toBe(`${folder}${group.id}.json`);
  expect(group.schema).toBe(1);
  expect(group.reason).toBe("before-wizard");
  expect(group.name).toBe(expectedName);
  expect(group.restores).toBeNull();
  expect(group.uncovered).toEqual([]);
  expect(group.files.map((item) => item.path).sort()).toEqual([...writtenPaths].sort());
  expect(group.files.every((item) => item.before === null), "new wizard destinations are recorded absent before writing").toBe(true);
  expect(group.files.every((item) => item.status === "written"), "all planned destinations were registered as written").toBe(true);
  for (const path of writtenPaths) {
    const bytes = await readBacking(`${projectPath}/${path}`);
    const written = group.files.find((item) => item.path === path);
    expect(written?.after, `${path} records an actual written-byte SHA-256`).toBe(createHash("sha256").update(bytes).digest("hex"));
  }
  expect(group.files.length).toBe(writtenPaths.length);
}


export async function runVscodeNewProjectProof(
  page: Page,
  expect: Expect,
  workbenchUrl: string,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  historyHost: NewProjectHistoryProofHost,
): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible();
  const before = await tree();
  const bitmapPath = historyHost.bitmapPath;
  const bitmapBefore = await readBacking(bitmapPath);
  const tilesetPath = "__tkr_new_project/Tiles/village.tst";
  const tilesetBefore = await readBacking(tilesetPath);
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
  // The native folder picker initializes its filesystem after accepting the checklist (#2958).
  // Observe readiness within the host-proof budget; never repeat the accepted wizard action.
  await expect(widget).toContainText("New project: choose the destination folder", { timeout: 30_000 });
  // Remembered-directory initialization can finish after the dialog title appears.
  await expect(widget.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
  // Retry only idempotent navigation; the Create action below is dispatched exactly once.
  await expect(async () => {
    await answer.fill("/__tkr_new_project/");
    await expect(answer).toHaveValue("/__tkr_new_project/", { timeout: 1_000 });
    await expect(widget.getByRole("button", { name: "Create project here", exact: true })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000, intervals: [100, 250, 500, 1_000] });
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
  await expect.poll(async () => (await tree()).filter((path) => !path.startsWith("__tkr_new_project/.tkr-history/")), { timeout: 30_000 }).toEqual([...new Set([...before, ...additions])].sort());
  expect(new TextDecoder().decode(await readBacking("__tkr_new_project/keep.txt"))).toBe("Keep this file");
  expect(await readBacking(bitmapPath)).toEqual(bitmapBefore);
  expect(await readBacking(tilesetPath)).toEqual(tilesetBefore);
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
  // Destination files appear before progress is durable; automatic open follows the completed wizard.
  await proveWizardGroupFromBacking("__tkr_new_project", "New project", ["Main/Quest.gam", "Prg/start.prg", "Boards/start.brd"], tree, readBacking, expect);
  await proveNativeHistoryUi(page, expect, tree, readBacking, historyHost);
  await proveNativeNewBoard(page, expect, tree, readBacking, historyHost);
  await proveNativeBitmapHistory(page, expect, tree, readBacking, historyHost);
  await proveNativeTextSaveFailure(page, expect, readBacking, historyHost);
}

async function proveNativeHistoryUi(
  page: Page,
  expect: Expect,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  historyHost: NewProjectHistoryProofHost,
): Promise<void> {
  const gamePath = "__tkr_new_project/Main/Quest.gam";
  const generatedBytes = await readBacking(gamePath);
  let editor = await waitForWritableEditorFrame(page, "History proof editor", "Game title");
  await editor.getByRole("textbox", { name: "Game title", exact: true }).fill("History first");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await expect.poll(async () => {
    const parsed = readMainFile(new BinaryReader(await readBacking(gamePath), gamePath));
    return parsed.ok ? parsed.value.gameTitle : null;
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe("History first");
  const firstSaved = await readBacking(gamePath);

  editor = await waitForWritableEditorFrame(page, "History proof editor after first save", "Game title");
  await editor.getByRole("textbox", { name: "Game title", exact: true }).fill("History second");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-settings-state")).toHaveText("All changes saved");
  await expect.poll(async () => {
    const parsed = readMainFile(new BinaryReader(await readBacking(gamePath), gamePath));
    return parsed.ok ? parsed.value.gameTitle : null;
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe("History second");
  const secondSaved = await readBacking(gamePath);
  const entryFolder = "__tkr_new_project/.tkr-history/entries/";
  const entryPaths = (await tree()).filter((path) => path.startsWith(entryFolder) && path.endsWith(".json"));
  const storedEntries = await Promise.all(entryPaths.map(async (path) => JSON.parse(new TextDecoder().decode(await readBacking(path))) as {
    readonly id: string; readonly path: string; readonly reason: string; readonly sha256: string; readonly size: number;
  }));
  const gameEntries = storedEntries.filter((entry) => entry.path === "Main/Quest.gam");
  expect(gameEntries).toHaveLength(3);
  expect(gameEntries.map((entry) => entry.reason).sort()).toEqual(["checkpoint", "manual", "manual"]);
  expect(gameEntries.map((entry) => entry.sha256).sort()).toEqual([
    createHash("sha256").update(generatedBytes).digest("hex"),
    createHash("sha256").update(firstSaved).digest("hex"),
    createHash("sha256").update(secondSaved).digest("hex"),
  ].sort());
  expect(gameEntries.map((entry) => entry.size).sort((a, b) => a - b)).toEqual([generatedBytes.length, firstSaved.length, secondSaved.length].sort((a, b) => a - b));

  await runCommand(page, expect, "RPG Toolkit: Document history", "Restore a saved version or recovery group");
  const picker = page.locator(".quick-input-widget");
  let options = picker.getByRole("option").filter({ hasText: "saved" });
  const savedCount = await options.count();
  if (savedCount !== 2) {
    const persisted = (await tree()).filter((path) => path.startsWith("__tkr_new_project/.tkr-history/"));
    const pickerText = await picker.innerText().catch(() => "");
    const notifications = await page.locator(".notifications-toasts").innerText().catch(() => "");
    throw new Error(`Expected two saved versions in the real History picker; found ${savedCount}. Picker: ${pickerText}; notifications: ${notifications}; persisted history entries: ${JSON.stringify(gameEntries)}; history paths: ${persisted.join(", ")}`);
  }
  await expect(options).toHaveCount(2);
  const restoreEventsStart = historyHost.writeEvents().length;
  const writeReached = historyHost.pauseWrite(`/${gamePath}`);
  try {
    await options.last().click();
    await verifyHistoryPreview(page, expect, "History first");
    await expectNativeHistoryRestorePaused(historyHost, restoreEventsStart, writeReached, gamePath, readBacking, secondSaved, expect);
  } finally {
    historyHost.resumeWrite();
  }
  await expectNativeHistoryRestorePersisted(historyHost, restoreEventsStart, gamePath, readBacking, firstSaved, expect);
  const reportText = /Each file is reported separately; the restore is itself in history, so it can be undone\./;
  const report = page.getByRole("dialog", { name: /Info: Restored/ }).getByText(reportText);
  await expect(report).toBeVisible({ timeout: 30_000 });
  editor = await waitForWritableEditorFrame(page, "History editor after restoring the first save", "Game title");
  await expect(editor.getByRole("textbox", { name: "Game title", exact: true })).toHaveValue("History first");

  await expectOpenRecoveryRefusal(page, expect, historyHost, "Main/Quest.gam", gamePath, firstSaved, readBacking);
  await closeRecoverySourceEditor(page, expect, /^Quest\.gam(?:,|$)/);
  const restoreAction = await selectRecoveryRestoreAction(page, expect, "__tkr_new_project", "Main/Quest.gam");
  const undoEventsStart = historyHost.writeEvents().length;
  const undoWriteReached = historyHost.pauseWrite(`/${gamePath}`);
  try {
    await restoreAction.click();
    await expectNativeHistoryRestorePaused(historyHost, undoEventsStart, undoWriteReached, gamePath, readBacking, firstSaved, expect);
  } finally {
    historyHost.resumeWrite();
  }
  await expectNativeHistoryRestorePersisted(historyHost, undoEventsStart, gamePath, readBacking, secondSaved, expect);
  await confirmRecoveryGroupReport(page, expect, "Main/Quest.gam");
  await openNativeQuickOpenFile(page, expect, gamePath);
  editor = await waitForWritableEditorFrame(page, "History editor after restoring the restore", "Game title");
  await expect(editor.getByRole("textbox", { name: "Game title", exact: true })).toHaveValue("History second");
  await proveNativeTextHistory(page, expect, tree, readBacking, historyHost);
}

async function proveNativeTextHistory(
  page: Page,
  expect: Expect,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  host: NewProjectHistoryProofHost,
): Promise<void> {
  const projectPath = "__tkr_new_project/Prg/start.prg";
  const historyPath = "Prg/start.prg";
  const before = await readBacking(projectPath);
  await closeRecoverySourceEditor(page, expect, /^History preview: Main\/Quest\.gam(?:,|$)/);
  await closeRecoverySourceEditor(page, expect, /^Quest\.gam(?:,|$)/);
  await openNativeQuickOpenFile(page, expect, projectPath);
  let editor = page.locator(".monaco-editor:visible").last();
  let lines = editor.locator(".view-lines");
  await expect(lines).toBeVisible();
  await lines.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("// Native history pre-save baseline proof");
  await page.keyboard.press("ControlOrMeta+S");
  await expect.poll(() => readBacking(projectPath), { timeout: 30_000, intervals: [100, 250, 500] }).not.toEqual(before);
  const saved = await readBacking(projectPath);
  const entryPrefix = "__tkr_new_project/.tkr-history/entries/";
  const readNativeEntries = async () => (await Promise.all((await tree()).filter((path) => path.startsWith(entryPrefix) && path.endsWith(".json"))
    .map(async (path) => JSON.parse(new TextDecoder().decode(await readBacking(path))) as {
      readonly path: string; readonly reason: string; readonly sha256: string; readonly size: number;
    }))).filter((entry) => entry.path === historyPath);
  // ADR 0022 D12.10 item 4: a native text save is recorded after VS Code has written the file
  // (onDidSaveTextDocument), so the `manual` entry can land after the file change seen above.
  await expect.poll(async () => (await readNativeEntries()).map((entry) => entry.reason).sort(), {
    timeout: 30_000, intervals: [100, 250, 500, 1_000],
  }).toEqual(["checkpoint", "manual"]);
  const nativeEntries = await readNativeEntries();
  expect(nativeEntries.map((entry) => entry.reason).sort()).toEqual(["checkpoint", "manual"]);
  expect(nativeEntries.map((entry) => entry.sha256).sort()).toEqual([
    createHash("sha256").update(before).digest("hex"),
    createHash("sha256").update(saved).digest("hex"),
  ].sort());

  await closeRecoverySourceEditor(page, expect, /^start\.prg(?:,|$)/);
  await openNativeQuickOpenFile(page, expect, projectPath);
  editor = page.locator(".monaco-editor:visible").last();
  lines = editor.locator(".view-lines");
  await expect(lines).toBeVisible();
  await runCommand(page, expect, "RPG Toolkit: Document history", "Restore a saved version or recovery group");
  const picker = page.locator(".quick-input-widget");
  const checkpoint = picker.getByRole("option").filter({ hasText: "checkpoint" });
  await expect(checkpoint).toHaveCount(1);
  const writeEventsStart = host.writeEvents().length;
  const readEventsStart = host.readEvents().length;
  const readReached = host.pauseNativeRestoreRead(`/${projectPath}`);
  try {
    await checkpoint.click();
    await readReached;
    expect(host.nativeRestoreReadEvents()).toEqual([{ kind: "readFile", path: `/${projectPath}` }]);
    await lines.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("// Concurrent native edit must survive history restore");
    await expect(lines).toContainText("Concurrent native edit must survive history restore");
  } finally {
    host.resumeRead();
  }
  await expect.poll(async () => page.locator("body").innerText()).toMatch(/start\.prg:\s+failed/i);
  expect(await readBacking(projectPath)).toEqual(saved);
  await expect(lines).toContainText("Concurrent native edit must survive history restore");
  expect(host.writeEvents().slice(writeEventsStart).filter((event) => event.path === `/${projectPath}`)).toEqual([]);
  await lines.click();
  await page.keyboard.press("ControlOrMeta+Z");
}

async function proveNativeTextSaveFailure(
  page: Page,
  expect: Expect,
  readBacking: (path: string) => Promise<Uint8Array>,
  host: NewProjectHistoryProofHost,
): Promise<void> {
  const projectPath = "__tkr_new_project/Prg/start.prg";
  const historyRoot = "/__tkr_new_project/.tkr-history";
  const marker = "// Native history failure still allows VS Code to save";
  await closeRecoverySourceEditor(page, expect, /^start\.prg(?:,|$)/);
  const externalMarker = "// Unrecorded external native baseline";
  const priorBytes = await readBacking(projectPath);
  const externalBaseline = new Uint8Array([...priorBytes, ...new TextEncoder().encode(`\n${externalMarker}\n`)]);
  await host.writeBacking(projectPath, externalBaseline);
  await openNativeQuickOpenFile(page, expect, projectPath);
  const editor = page.locator(".monaco-editor:visible").last();
  const lines = editor.locator(".view-lines");
  const nativeTab = page.getByRole("tab", { name: /^start\.prg(?:,|$)/ });
  await expect(lines).toBeVisible();
  await expect(lines).toContainText(externalMarker);
  await expect(nativeTab).toHaveCount(1);
  await expect(nativeTab).toHaveAttribute("aria-selected", "true");
  const before = await readBacking(projectPath);
  expect(before).toEqual(externalBaseline);
  const operationStart = host.writeOperationEvents().length;
  const failureStart = host.failedWriteEvents().length;
  host.failWritesUnder(historyRoot);
  try {
    await lines.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(marker);
    await expect(lines).toContainText(marker);
    await page.keyboard.press("ControlOrMeta+S");

    const notifications = page.locator(".notifications-toasts");
    await expect(notifications).toContainText(
      /Could not keep the previous version of Prg\/start\.prg in recovery history before saving:.*VS Code may still save this document\./s,
      { timeout: 30_000 },
    );
    await expect.poll(async () => new TextDecoder().decode(await readBacking(projectPath)), {
      timeout: 30_000, intervals: [100, 250, 500],
    }).toContain(marker);
    await expect(nativeTab).not.toHaveClass(/dirty/, { timeout: 30_000 });
    await expect(notifications).toContainText(
      /Prg\/start\.prg was saved, but its recovery history could not be recorded:/,
      { timeout: 30_000 },
    );
  } finally {
    host.allowWrites();
  }

  const failures = host.failedWriteEvents().slice(failureStart);
  expect(failures.length).toBeGreaterThan(0);
  expect(failures.every((event) => event.path.startsWith(`${historyRoot}/`))).toBe(true);
  const operations = host.writeOperationEvents().slice(operationStart);
  expect(operations).toContainEqual({ kind: "write", path: `/${projectPath}` });
  expect(operations.filter((event) => event.path.startsWith(historyRoot)).every((event) => event.kind !== "write")).toBe(true);
  expect(await readBacking(projectPath)).not.toEqual(before);
  expect(new TextDecoder().decode(await readBacking(projectPath))).toContain(marker);
  await expect(nativeTab).toHaveCount(1);
  await expect(nativeTab).not.toHaveClass(/dirty/);
  console.log("Native TextDocument Save preserved the actual .prg edit and clean state while visibly reporting failed history capture; only history writes were injected to fail");
}

async function verifyHistoryPreview(page: Page, expect: Expect, expectedTitle: string): Promise<void> {
  let preview: Frame | undefined;
  let previewTitle: Locator | undefined;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const title = frame.getByRole("textbox", { name: "Game title", exact: true });
      if (await frame.getByRole("heading", { name: "Game settings", exact: true }).count() > 0
        && await title.count() > 0 && await title.isDisabled() && await title.inputValue() === expectedTitle) {
        preview = frame;
        previewTitle = title;
        return true;
      }
    }
    return false;
  }, { timeout: 30_000 }).toBe(true);
  if (preview === undefined || previewTitle === undefined) throw new Error("The History command did not open the shared editor in read-only mode.");
  await expect(previewTitle).toHaveValue(expectedTitle);
  await expect(previewTitle).toBeDisabled();
  await expect(preview.getByRole("note")).toContainText("Read only");
}
async function expectNativeHistoryRestorePaused(
  host: NewProjectHistoryProofHost,
  eventsStart: number,
  writeReached: Promise<void>,
  path: string,
  readBacking: (path: string) => Promise<Uint8Array>,
  expectedBefore: Uint8Array,
  expect: Expect,
): Promise<void> {
  const request = { kind: "write-request" as const, path: `/${path}` };
  await expect.poll(() => host.writeEvents().slice(eventsStart).filter((event) => event.path === request.path)).toContainEqual(request);
  await writeReached;
  expect(host.writeEvents().slice(eventsStart).filter((event) => event.path === request.path)).toEqual([request]);
  expect(await readBacking(path)).toEqual(expectedBefore);
}

async function expectNativeHistoryRestorePersisted(
  host: NewProjectHistoryProofHost,
  eventsStart: number,
  path: string,
  readBacking: (path: string) => Promise<Uint8Array>,
  expectedAfter: Uint8Array,
  expect: Expect,
): Promise<void> {
  const request = { kind: "write-request" as const, path: `/${path}` };
  await expect.poll(() => host.writeEvents().slice(eventsStart).filter((event) => event.path === request.path)).toEqual([request, { kind: "write", path: request.path }]);
  await expect.poll(() => readBacking(path), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toEqual(expectedAfter);
}

async function selectRecoveryRestoreAction(page: Page, expect: Expect, projectRoot: string, historyPath: string): Promise<Locator> {
  await runCommand(page, expect, "TK Reawakened: Project recovery", "Select workspace folder");
  const roots = page.locator(".quick-input-widget").getByRole("option").filter({ hasText: projectRoot });
  await expect(roots).toHaveCount(1);
  await roots.click();
  await expect(page.getByRole("textbox", { name: "Choose a persistent recovery group" })).toBeVisible();
  const groups = page.locator(".quick-input-widget").getByRole("option")
    .filter({ hasText: "before-restore" })
    .filter({ hasText: `${historyPath}: written` });
  await expect(groups).toHaveCount(1);
  await groups.click();
  const restoreAction = page.locator(".quick-input-widget").getByRole("option").filter({ hasText: "Restore group" });
  await expect(restoreAction).toHaveCount(1);
  return restoreAction;
}

async function expectOpenRecoveryRefusal(
  page: Page,
  expect: Expect,
  historyHost: NewProjectHistoryProofHost,
  historyPath: string,
  backingPath: string,
  expectedBytes: Uint8Array,
  readBacking: (path: string) => Promise<Uint8Array>,
): Promise<void> {
  const eventsStart = historyHost.writeEvents().length;
  const action = await selectRecoveryRestoreAction(page, expect, "__tkr_new_project", historyPath);
  await action.click();
  await expect(page.getByText(`Save or resolve your work and close ${historyPath} before replacing or removing it.`, { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(historyHost.writeEvents().slice(eventsStart).filter((event) => event.path === `/${backingPath}`)).toEqual([]);
  expect(await readBacking(backingPath)).toEqual(expectedBytes);
}

async function closeRecoverySourceEditor(page: Page, expect: Expect, tabName: RegExp): Promise<void> {
  const sourceTab = page.getByRole("tab", { name: tabName });
  await expect(sourceTab).toHaveCount(1);
  await sourceTab.click();
  await closeActiveEditor(page, expect);
  await expect(sourceTab).toHaveCount(0);
}

async function confirmRecoveryGroupReport(page: Page, expect: Expect, historyPath: string): Promise<void> {
  const report = page.getByRole("dialog").filter({ hasText: `${historyPath}: written` }).last();
  await expect(report).toBeVisible({ timeout: 30_000 });
  await report.getByRole("button", { name: "OK", exact: true }).click();
}

function assertBoardPreviewRequestIdentity(historyHost: NewProjectHistoryProofHost, sourcePath: string, expect: Expect): void {
  const identity = historyHost.previewTrace?.().find((entry) => entry.includes("stage=request-send")
    && entry.includes(`path: ${sourcePath}`)
    && entry.includes("projectId: tkr-testfs://") && entry.includes("/__tkr_new_project"));
  expect(identity, `The History preview did not originate from ${sourcePath}.`).toBeDefined();
}

async function verifyBoardHistoryPreview(page: Page, expect: Expect, sourcePath: string, expectedTile: string, historyHost: NewProjectHistoryProofHost, beforeRender: () => Promise<void>): Promise<string> {
  assertBoardPreviewRequestIdentity(historyHost, sourcePath, expect);
  let preview: Frame | undefined;
  try {
    await expect.poll(async () => {
      const boardFrames: Frame[] = [];
      for (const frame of page.frames()) {
        const board = frame.getByRole("region", { name: "Board", exact: true });
        if (await board.count() > 0 && await board.isVisible().catch(() => false)) boardFrames.push(frame);
      }
      const readOnlyFrames: Frame[] = [];
      const writableFrames: Frame[] = [];
      for (const frame of boardFrames) {
        const note = frame.getByRole("note").filter({ hasText: "Read only:" });
        if (await note.count() > 0 && await note.isVisible().catch(() => false)) readOnlyFrames.push(frame);
        else writableFrames.push(frame);
      }
      const matchingPreviews: Frame[] = [];
      for (const frame of readOnlyFrames) {
        const tile = frame.getByRole("textbox", { name: "Tile for column 1, row 1", exact: true });
        if (await tile.count() > 0 && await tile.inputValue().catch(() => "") === expectedTile) matchingPreviews.push(frame);
      }
      preview = matchingPreviews[0];
      return writableFrames.length === 1 && matchingPreviews.length === 1;
    }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  } catch (error) {
    const frames = await Promise.all(page.frames().map(async (frame) => ({
      name: frame.name(),
      url: frame.url(),
      boards: await frame.locator(".tkr-board").count().catch(() => -1),
      bitmapCanvases: await frame.locator("canvas.tkr-bitmap-canvas").count().catch(() => -1),
      readOnlyNotes: await frame.locator(".tkr-board-readonly, .tkr-bitmap-readonly").count().catch(() => -1),
      body: (await frame.locator("body").textContent({ timeout: 1_000 }).catch(() => "") ?? "").slice(0, 240),
    })));
    const tabs = await page.getByRole("tab").allTextContents().catch(() => []);
    const trace = historyHost.previewTrace?.().join("\n") ?? "No preview RPC trace was captured.";
    throw new Error(`Native read-only History frame did not mount. Tabs: ${JSON.stringify(tabs)}. Frames: ${JSON.stringify(frames)}. Correlated preview stages:\n${trace}\n${String(error)}`);
  }
  if (preview === undefined) throw new Error(`The native History preview for ${expectedTile} did not mount beside its writable originating board editor.`);
  await expect(preview.locator(".tkr-board-readonly")).toContainText("Saved version");
  const previewTile = preview.getByRole("textbox", { name: "Tile for column 1, row 1", exact: true });
  await expect(previewTile).toHaveAttribute("readonly", "");
  await expect(preview.locator(".tkr-board-brush")).toBeDisabled();
  await expect(preview.locator(".tkr-board-readonly")).toContainText("Read only");
  await beforeRender();
  const previewState = preview.locator(".tkr-board-preview-state");
  try {
    await expect(previewState).toHaveCount(0, { timeout: 30_000 });
  } catch (error) {
    const trace = historyHost.previewTrace?.().join("\n") ?? "No preview RPC trace was captured.";
    const canvas = preview.locator("canvas");
    const canvasCount = await canvas.count();
    const canvasSize = canvasCount === 0 ? null : await canvas.first().evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return { width: target.width, height: target.height, clientWidth: target.clientWidth, clientHeight: target.clientHeight };
    }).catch(() => null);
    const renderState = {
      status: await previewState.textContent().catch(() => null),
      pictureText: await preview.locator(".tkr-board-picture").textContent().catch(() => null),
      canvasCount,
      canvasSize,
      readOnlyText: await preview.locator(".tkr-board-readonly").textContent().catch(() => null),
    };
    throw new Error(`Native board History preview remained pending. Render state: ${JSON.stringify(renderState)}. Filesystem reads: ${JSON.stringify(historyHost.readEvents().slice(-30))}. Correlated preview stages (last 128):\n${trace}\n${String(error)}`);
  }
  await expect.poll(() => historyHost.readEvents().some((event) =>
    event.kind === "readFile" && event.path.replaceAll("\\", "/").endsWith("/Tiles/village.tst"),
  )).toBe(true);
  await expect(preview.getByRole("status").filter({ hasText: "No picture:" })).toHaveCount(0);
  const canvas = preview.getByRole("img", { name: "The board as the engine draws it", exact: true });
  await expect(canvas).toBeVisible();
  const readPicture = () => canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (context === null || target.width === 0 || target.height === 0) return { width: 0, height: 0, hash: 0, colours: 0 };
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    const colours = new Set<string>();
    let hash = 2_166_136_261;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      const alpha = pixels[offset + 3] ?? 0;
      hash = Math.imul(hash ^ red, 16_777_619);
      hash = Math.imul(hash ^ green, 16_777_619);
      hash = Math.imul(hash ^ blue, 16_777_619);
      hash = Math.imul(hash ^ alpha, 16_777_619);
      if (colours.size < 3) colours.add(`${red},${green},${blue},${alpha}`);
    }
    return { width: target.width, height: target.height, hash: hash >>> 0, colours: colours.size };
  });
  await expect.poll(async () => (await readPicture()).colours, { timeout: 30_000 }).toBeGreaterThan(1);
  const picture = await readPicture();
  return `${picture.width}x${picture.height}:${picture.hash}`;
}

async function proveNativeNewBoard(
  page: Page,
  expect: Expect,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  historyHost: NewProjectHistoryProofHost,
): Promise<void> {
  const commandContexts: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[history-preview-trace] command-context")) commandContexts.push(text);
  });
  const openBoardHistoryPicker = async (): Promise<void> => {
    const commandContextStart = commandContexts.length;
    const boardTabName = /^Native history board\.brd(?:,|$)/;
    await page.getByRole("tab", { name: boardTabName }).click();
    await expect(page.getByRole("tab", { name: boardTabName, selected: true })).toBeVisible();
    await runCommand(page, expect, "RPG Toolkit: Document history", "Restore a saved version or recovery group");
    await expect.poll(() => commandContexts.length > commandContextStart, { timeout: 5_000 }).toBe(true);
    const context = commandContexts[commandContextStart];
    if (context === undefined) throw new Error("The Board history command context was not recorded.");
    expect(context).toContain("activeTabLabel: Native history board.brd");
    expect(context).toContain("customEditorUri: tkr-testfs://");
    const customEditorUri = /customEditorUri: (tkr-testfs:\/\/[^,}]+)/.exec(context)?.[1];
    if (customEditorUri === undefined) throw new Error("The active Board history command did not report its custom-editor URI.");
    expect(decodeURIComponent(customEditorUri)).toMatch(/\/Boards\/Native history board\.brd$/);
  };
  await runCommand(page, expect, "RPG Toolkit: New board", "New board: project");
  const widget = page.locator(".quick-input-widget");
  await expect(widget).toContainText("New board: project");
  await widget.getByRole("option", { name: "__tkr_new_project", exact: true }).click();
  const answer = widget.getByRole("textbox");
  await expect(widget).toContainText("Name of the new board");
  await answer.fill("Native history board");
  await answer.press("Enter");

  const choose = async (label: string): Promise<void> => {
    const option = widget.getByRole("option", { name: label, exact: true })
      .or(widget.getByRole("option", { name: `${label}, current`, exact: true }));
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
  const boardPath = "__tkr_new_project/Boards/Native history board.brd";
  const generatedBytes = await readBacking(boardPath);
  const boardEditor = await waitForWritableEditorFrame(page, "new board before saving history", "Tile for column 1, row 1");
  const tileField = boardEditor.getByRole("textbox", { name: "Tile for column 1, row 1", exact: true });
  const savedCellTile = (bytes: Uint8Array): string | null => {
    const parsed = readBoard(new BinaryReader(bytes, boardPath));
    if (!parsed.ok) return null;
    const index = parsed.value.tileMatrix[0];
    return index === undefined ? null : parsed.value.lut[index] ?? null;
  };
  await tileField.fill("village.tst1");
  await tileField.press("Enter");
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  await expect.poll(async () => savedCellTile(await readBacking(boardPath)), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe("village.tst1");
  const firstSaved = await readBacking(boardPath);
  expect(firstSaved).not.toEqual(generatedBytes);

  await tileField.fill("village.tst2");
  await tileField.press("Enter");
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("Unsaved changes");
  await boardEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(boardEditor.locator(".tkr-board-state")).toHaveText("All changes saved");
  await expect.poll(async () => savedCellTile(await readBacking(boardPath)), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe("village.tst2");
  const secondSaved = await readBacking(boardPath);
  expect(secondSaved).not.toEqual(firstSaved);
  const boardEntryPaths = (await tree()).filter((path) => path.startsWith("__tkr_new_project/.tkr-history/entries/") && path.endsWith(".json"));
  const boardEntries = await Promise.all(boardEntryPaths.map(async (path) => JSON.parse(new TextDecoder().decode(await readBacking(path))) as { readonly path: string; readonly reason: string; readonly sha256: string; readonly size: number }));
  const savedBoardEntries = boardEntries.filter((entry) => entry.path === "Boards/Native history board.brd");
  expect(savedBoardEntries).toHaveLength(3);
  expect(savedBoardEntries.map((entry) => entry.reason).sort()).toEqual(["checkpoint", "manual", "manual"]);
  expect(savedBoardEntries.map((entry) => entry.sha256).sort()).toEqual([
    createHash("sha256").update(generatedBytes).digest("hex"),
    createHash("sha256").update(firstSaved).digest("hex"),
    createHash("sha256").update(secondSaved).digest("hex"),
  ].sort());
  expect(savedBoardEntries.map((entry) => entry.size).sort((a, b) => a - b)).toEqual([generatedBytes.length, firstSaved.length, secondSaved.length].sort((a, b) => a - b));

  const reportText = /Each file is reported separately; the restore is itself in history, so it can be undone\./;
  await openBoardHistoryPicker();
  let saved = page.locator(".quick-input-widget").getByRole("option").filter({ hasText: "saved" });
  await expect(saved).toHaveCount(2);
  const restoreEventsStart = historyHost.writeEvents().length;
  const writeReached = historyHost.pauseWrite(`/${boardPath}`);
  let firstPreviewPicture: string | undefined;
  try {
    await saved.last().click();
    firstPreviewPicture = await verifyBoardHistoryPreview(page, expect, "Boards/Native history board.brd", "village.tst1", historyHost, async () => {
      await expectNativeHistoryRestorePaused(historyHost, restoreEventsStart, writeReached, boardPath, readBacking, secondSaved, expect);
      historyHost.resumeWrite();
    });
  } finally {
    historyHost.resumeWrite();
  }
  if (firstPreviewPicture === undefined) throw new Error("The first board History preview did not produce a picture fingerprint.");
  await expectNativeHistoryRestorePersisted(historyHost, restoreEventsStart, boardPath, readBacking, firstSaved, expect);
  await expect(page.getByRole("dialog", { name: /Info: Restored/ }).last().getByText(reportText)).toBeVisible({ timeout: 30_000 });

  await expectOpenRecoveryRefusal(page, expect, historyHost, "Boards/Native history board.brd", boardPath, firstSaved, readBacking);
  await closeRecoverySourceEditor(page, expect, /^Native history board\.brd(?:,|$)/);
  const undoAction = await selectRecoveryRestoreAction(page, expect, "__tkr_new_project", "Boards/Native history board.brd");
  const undoEventsStart = historyHost.writeEvents().length;
  const undoWriteReached = historyHost.pauseWrite(`/${boardPath}`);
  try {
    await undoAction.click();
    await expectNativeHistoryRestorePaused(historyHost, undoEventsStart, undoWriteReached, boardPath, readBacking, firstSaved, expect);
  } finally {
    historyHost.resumeWrite();
  }
  await expectNativeHistoryRestorePersisted(historyHost, undoEventsStart, boardPath, readBacking, secondSaved, expect);
  await confirmRecoveryGroupReport(page, expect, "Boards/Native history board.brd");
  const restoredBoard = await openProjectFile(page, boardPath, expect, ".tkr-board");
  await expect(restoredBoard.getByRole("textbox", { name: "Tile for column 1, row 1", exact: true })).toHaveValue("village.tst2");
}

async function proveNativeBitmapHistory(
  page: Page,
  expect: Expect,
  tree: () => Promise<readonly string[]>,
  readBacking: (path: string) => Promise<Uint8Array>,
  historyHost: NewProjectHistoryProofHost,
): Promise<void> {
  const bitmapPath = historyHost.bitmapPath;
  const projectPath = bitmapPath.replace(/^__tkr_new_project\//, "");
  const generatedBytes = await readBacking(bitmapPath);
  const editor = await openProjectFile(page, bitmapPath, expect, ".tkr-bitmap");
  await expect(editor.getByRole("heading", { name: "Tile bitmap" })).toBeVisible();
  await expect(editor.locator(".tkr-bitmap-summary")).toContainText("2 × 2 tiles, 64 × 64 pixels");
  await expectCanvasPixels(editor, expect, historyHost.bitmapPictureForBytes(generatedBytes));

  await editor.getByRole("combobox", { name: "Source", exact: true }).selectOption({ label: "village.tst (tst)" });
  const tile = editor.locator('[data-browser-reference="village.tst1"] .tkr-tileset-browser-source');
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  expect(await readBacking(bitmapPath)).toEqual(generatedBytes);
  await editor.getByRole("button", { name: "Draw", exact: true }).click();
  await editor.getByRole("button", { name: /^Column 2, row 1:/ }).click();
  await expect(editor.getByRole("button", { name: "Column 2, row 1: village.tst1, shade 10, -20, 30", exact: true })).toBeVisible();
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  const generatedHash = createHash("sha256").update(generatedBytes).digest("hex");
  await expect.poll(async () => createHash("sha256").update(await readBacking(bitmapPath)).digest("hex"), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).not.toBe(generatedHash);
  const firstSaved = await readBacking(bitmapPath);
  expect(firstSaved).not.toEqual(generatedBytes);
  await expectCanvasPixels(editor, expect, historyHost.bitmapPictureForBytes(firstSaved));

  await editor.getByRole("button", { name: /^Column 1, row 1:/ }).click();
  const red = editor.getByLabel("Red", { exact: true });
  await red.fill("-255");
  await red.press("Enter");
  await expect(editor.getByRole("button", { name: "Column 1, row 1: village.tst1, shade -255, 0, 0", exact: true })).toBeVisible();
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("Unsaved changes");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  const firstHash = createHash("sha256").update(firstSaved).digest("hex");
  await expect.poll(async () => createHash("sha256").update(await readBacking(bitmapPath)).digest("hex"), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).not.toBe(firstHash);
  const secondSaved = await readBacking(bitmapPath);
  expect(secondSaved).not.toEqual(firstSaved);
  await expectCanvasPixels(editor, expect, historyHost.bitmapPictureForBytes(secondSaved));

  const entryPaths = (await tree()).filter((path) => path.startsWith("__tkr_new_project/.tkr-history/entries/") && path.endsWith(".json"));
  const entries = await Promise.all(entryPaths.map(async (path) => JSON.parse(new TextDecoder().decode(await readBacking(path))) as {
    readonly path: string; readonly reason: string; readonly sha256: string; readonly size: number;
  }));
  const bitmapEntries = entries.filter((entry) => entry.path === projectPath);
  expect(bitmapEntries).toHaveLength(3);
  expect(bitmapEntries.map((entry) => entry.reason).sort()).toEqual(["checkpoint", "manual", "manual"]);
  expect(bitmapEntries.map((entry) => entry.sha256).sort()).toEqual([
    generatedHash,
    firstHash,
    createHash("sha256").update(secondSaved).digest("hex"),
  ].sort());
  expect(bitmapEntries.map((entry) => entry.size).sort((a, b) => a - b)).toEqual([generatedBytes.length, firstSaved.length, secondSaved.length].sort((a, b) => a - b));

  const reportText = /Each file is reported separately; the restore is itself in history, so it can be undone\./;
  await runCommand(page, expect, "RPG Toolkit: Document history", "Restore a saved version or recovery group");
  let saved = page.locator(".quick-input-widget").getByRole("option").filter({ hasText: "saved" });
  await expect(saved).toHaveCount(2);
  const restoreEventsStart = historyHost.writeEvents().length;
  const writeReached = historyHost.pauseWrite(`/${bitmapPath}`);
  try {
    await saved.last().click();
    await verifyBitmapHistoryPreview(page, expect, "Bitmap/history.tbm", historyHost.bitmapPictureForBytes(firstSaved), historyHost, async () => {
      await expectNativeHistoryRestorePaused(historyHost, restoreEventsStart, writeReached, bitmapPath, readBacking, secondSaved, expect);
      historyHost.resumeWrite();
    });
  } finally {
    historyHost.resumeWrite();
  }
  await expectNativeHistoryRestorePersisted(historyHost, restoreEventsStart, bitmapPath, readBacking, firstSaved, expect);
  await expectCanvasPixels(editor, expect, historyHost.bitmapPictureForBytes(firstSaved));
  await expect(editor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
  await expect(page.getByRole("dialog", { name: /Info: Restored/ }).last().getByText(reportText)).toBeVisible({ timeout: 30_000 });

  await expectOpenRecoveryRefusal(page, expect, historyHost, "Bitmap/history.tbm", bitmapPath, firstSaved, readBacking);
  await closeRecoverySourceEditor(page, expect, /^history\.tbm(?:,|$)/);
  const undoAction = await selectRecoveryRestoreAction(page, expect, "__tkr_new_project", "Bitmap/history.tbm");
  const undoEventsStart = historyHost.writeEvents().length;
  const undoWriteReached = historyHost.pauseWrite(`/${bitmapPath}`);
  try {
    await undoAction.click();
    await expectNativeHistoryRestorePaused(historyHost, undoEventsStart, undoWriteReached, bitmapPath, readBacking, firstSaved, expect);
  } finally {
    historyHost.resumeWrite();
  }
  await expectNativeHistoryRestorePersisted(historyHost, undoEventsStart, bitmapPath, readBacking, secondSaved, expect);
  await confirmRecoveryGroupReport(page, expect, "Bitmap/history.tbm");
  const restoredEditor = await openProjectFile(page, bitmapPath, expect, ".tkr-bitmap");
  await expectCanvasPixels(restoredEditor, expect, historyHost.bitmapPictureForBytes(secondSaved));
  await expect(restoredEditor.locator(".tkr-bitmap-state")).toHaveText("All changes saved");
}

async function verifyBitmapHistoryPreview(
  page: Page,
  expect: Expect,
  sourcePath: string,
  expectedPicture: { width: number; height: number; data: number[] },
  historyHost: NewProjectHistoryProofHost,
  beforeRender: () => Promise<void>,
): Promise<void> {
  assertBoardPreviewRequestIdentity(historyHost, sourcePath, expect);
  let preview: Frame | undefined;
  await expect.poll(async () => {
    const readOnlyFrames: Frame[] = [];
    let writableFrames = 0;
    for (const frame of page.frames()) {
      if (frame.isDetached()) continue;
      try {
        const canvas = frame.locator("canvas.tkr-bitmap-canvas");
        if (await canvas.count() === 0 || !await canvas.isVisible()) continue;
        const note = frame.getByRole("note").filter({ hasText: "Read only:" });
        if (await note.count() > 0 && await note.isVisible()) readOnlyFrames.push(frame);
        else writableFrames += 1;
      } catch {
        // Webview frames can be replaced while VS Code restores the just-opened custom editor.
      }
    }
    preview = readOnlyFrames.at(-1);
    return writableFrames === 1 && readOnlyFrames.length >= 1;
  }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  if (preview === undefined) throw new Error("The native History preview did not open a read-only bitmap editor.");
  await expect(preview.getByRole("heading", { name: "Tile bitmap" })).toBeVisible();
  await expect(preview.locator(".tkr-bitmap-readonly")).toContainText("Read only");
  await expect(preview.getByRole("textbox", { name: "Tile for column 1, row 1", exact: true })).toHaveAttribute("readonly", "");
  await expect(preview.getByLabel("Width in tiles")).toHaveAttribute("readonly", "");
  await expect(preview.getByLabel("Height in tiles")).toHaveAttribute("readonly", "");
  const shadingInputs = preview.locator(".tkr-bitmap-shading input");
  await expect(shadingInputs).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) await expect(shadingInputs.nth(index)).toBeDisabled();

  await beforeRender();

  try {
    await expect.poll(async () => {
      const matchingPreviews: Frame[] = [];
      let writableFrames = 0;
      for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        try {
          const canvas = frame.locator("canvas.tkr-bitmap-canvas");
          if (await canvas.count() === 0 || !await canvas.isVisible()) continue;
          const note = frame.getByRole("note").filter({ hasText: "Read only:" });
          if (await note.count() > 0 && await note.isVisible()) {
            const matches = await canvas.evaluate((element, want) => {
              const target = element as HTMLCanvasElement;
              if (target.width !== want.width || target.height !== want.height) return false;
              const context = target.getContext("2d");
              if (context === null) return false;
              const pixels = context.getImageData(0, 0, target.width, target.height).data;
              return pixels.length === want.data.length && want.data.every((value, index) => pixels[index] === value);
            }, expectedPicture);
            if (matches) matchingPreviews.push(frame);
          } else {
            writableFrames += 1;
          }
        } catch {
          // Ignore a webview replaced between enumerating and inspecting its frame.
        }
      }
      preview = matchingPreviews[0];
      return writableFrames === 1 && matchingPreviews.length === 1;
    }, { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
  } catch (error) {
    const trace = historyHost.previewTrace?.().join("\n") ?? "No preview RPC trace was captured.";
    throw new Error(`The native History bitmap preview did not settle to the expected read-only pixels. Correlated preview stages (last 128):\n${trace}\n${String(error)}`);
  }
  if (preview === undefined) throw new Error("The native History preview did not show the exact saved tile-bitmap pixels in read-only mode.");
  await expectCanvasPixels(preview, expect, expectedPicture);
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
  const lifecycleStart = host.readHostEvents().length;
  const lifecycleEvents = () => host.readHostEvents().slice(lifecycleStart);
  await openGame(page, gamePath, expect);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: gamePath.split("/").at(-1)! })).toHaveCount(1);
  expect(lifecycleEvents(), JSON.stringify(lifecycleEvents())).toContainEqual({ kind: "open", value: `/${gamePath}` });
  const openUriEvent = () => openedDocumentUri(lifecycleEvents(), gamePath);
  await expect.poll(openUriEvent).toBeDefined();
  const openedUri = openUriEvent()!;
  const resolvePayload = (event: { value: string }): { resource: string; viewType: string } | undefined => {
    const parsed: unknown = JSON.parse(event.value);
    if (parsed === null || typeof parsed !== "object" || !("resource" in parsed) || !("viewType" in parsed)
      || typeof parsed.resource !== "string" || typeof parsed.viewType !== "string") return undefined;
    return { resource: parsed.resource, viewType: parsed.viewType };
  };
  const resolveEvent = () => lifecycleEvents().find((event) => event.kind === "resolve"
    && resolvePayload(event)?.resource === openedUri);
  await expect.poll(resolveEvent).toBeDefined();
  const resolved = resolvePayload(resolveEvent()!);
  if (resolved === undefined) throw new Error("Matching custom-editor resolve event vanished before its payload could be read");
  expect(resolved.resource).toBe(openedUri);
  expect(resolved.viewType).toBe("tkr.gameSettings");

  // The package command is contributed to both the command palette and .gam Explorer context menu.
  const packageCommand = await commandPalette(page, expect);
  await packageCommand.fill(">RPG Toolkit: Package game");
  const packageEntry = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row").filter({ hasText: "RPG Toolkit: Package game" }).first();
  await expect(packageEntry).toBeVisible();
  await packageCommand.press("Escape");
  await expect(page.locator(".quick-input-widget")).toBeHidden();

  const packageCommandInput = await commandPalette(page, expect);
  await packageCommandInput.fill(">Test: Execute Package Game");
  const packageCommandEntry = page.locator(".quick-input-widget:visible .quick-input-list .monaco-list-row").filter({ hasText: "Test: Execute Package Game" }).first();
  await expect(packageCommandEntry).toBeVisible();
  await packageCommandEntry.click();
  await expect(page.getByText(/Preflight passed:/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Included \(\d+\):/)).toBeVisible();
  await page.keyboard.press("Escape");

  await openGame(page, gamePath, expect);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: gamePath.split("/").at(-1)! })).toHaveCount(1);
  const editor = await waitForWritableEditorFrame(page, "initial Game settings editor", "Game title", gamePath.split("/").at(-1)!);
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
  const editEvent = () => lifecycleEvents().find((event) => event.kind === "edit");
  await expect.poll(editEvent).toBeDefined();
  const edit = JSON.parse(editEvent()!.value) as { resource: string; label: string };
  expect(edit.resource).toBe(openedUri);
  if (host.saveViaWorkbenchShortcut !== undefined) {
    await page.keyboard.press(host.saveViaWorkbenchShortcut);
  } else {
    await editor.getByRole("button", { name: "Save" }).click();
  }
  await expect.poll(lifecycleEvents, { timeout: 5_000, intervals: [50, 100, 250] }).toContainEqual({ kind: "save", value: `/${gamePath}` });
  const savedUriEvent = () => lifecycleEvents().find((event) => event.kind === "save-uri");
  await expect.poll(savedUriEvent).toBeDefined();
  expect(savedUriEvent()!.value).toBe(openedUri);
  const expectedHash = createHash("sha256").update(expectedBytes).digest("hex");
  await expect.poll(async () => createHash("sha256").update(await host.readBacking(gamePath)).digest("hex"), { timeout: 30_000, intervals: [100, 250, 500, 1_000] }).toBe(expectedHash);
  const saved = await readWorkspaceBytes(page, expect);
  expect(saved).not.toEqual(before);
  expect(saved).toEqual(expectedBytes);
  expect(host.readHostEvents()).toContainEqual({ kind: "save", value: `/${gamePath}` });
  await expect.poll(() => frameCspViolations(page, editor, consoleViolations)).toEqual([]);
  expect(await host.readBacking()).toEqual(saved);
  await expect(savedTab).not.toHaveClass(/dirty/);
  page = await host.restart(page);
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  expect(await host.readBacking()).toEqual(saved);
  // The shell appears before the restored webview; its later activation can dismiss an early palette (#2960).
  await waitForTitledEditor(page, title, expect);


  // Save through the registered package command's Save As dialog in the real VS Code web workbench, then inspect its
  // persisted package and descriptor independently of the UI.
  await runCommand(page, expect, "Test: Execute Package Game");
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
  // Pause the actual backing write, change focus to another dirty editor, then let the save proceed.
  const saveStart = host.writeEvents().length;
  host.pauseWrite(`/${gamePath}`);
  try {
    await recoveredEditor.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => host.writeEvents().slice(saveStart)).toContainEqual({ kind: "write-request", path: `/${gamePath}` });
    await sentinelTab.click();
    await expect(sentinelTab).toHaveClass(/dirty/);
  } finally {
    host.resumeWrite();
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
    await expect(canvas).toHaveAttribute("aria-busy", "false");
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
    await frame.locator(".tkr-board-layers-disclosure > summary").click();
    await expect(frame.locator(".tkr-board-layers-disclosure")).toHaveAttribute("open", "");
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
    // Visible cells can precede the async edit acknowledgement; do not start the next gesture while busy.
    await expect(canvas).toHaveAttribute("aria-busy", "false");
    await page.mouse.move(cornerA.x, cornerA.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(cornerB.x, cornerB.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect.poll(() => tile2.count()).toBeGreaterThan(edge);
    await expect(canvas).toHaveAttribute("aria-busy", "false");
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
    for (const content of page.frames()) {
      if (content.name() !== "pending-frame" || await content.locator(selector).count().catch(() => 0) === 0) continue;
      const readOnly = await content.locator(".tkr-board-readonly, .tkr-bitmap-readonly").count().catch(() => 0);
      if (readOnly === 0) return content;
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
async function runCommand(page: Page, expect: Expect, title: string, quickInputName?: string): Promise<void> {
  await runCommandMatching(page, expect, title, title, false, quickInputName);
}

/** Dispatch one verified palette row atomically; never retry an attempted dispatch (#2720, #2726). */
async function runCommandMatching(page: Page, expect: Expect, search: string, label: string, dismissFirstAttempt = false, nextPrompt?: string): Promise<void> {
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
      if (nextPrompt !== undefined) await expect(page.getByRole("textbox", { name: nextPrompt })).toBeVisible();
      else await expect(widget).toBeHidden();
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

async function waitForWritableEditorFrame(page: Page, label: string, fieldName: string, selectedTabLabel?: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  let candidates: Frame[] = [];
  while (Date.now() < deadline) {
    candidates = [];
    for (const frame of page.frames()) {
      const field = frame.getByRole("textbox", { name: fieldName, exact: true });
      if (await field.count() > 0 && await field.isVisible().catch(() => false) && await field.isEditable().catch(() => false)) candidates.push(frame);
    }
    if (selectedTabLabel === undefined && candidates.length > 0) return candidates[0]!;
    if (selectedTabLabel !== undefined && candidates.length === 1) {
      const selectedTab = page.getByRole("tab", { selected: true }).filter({ hasText: selectedTabLabel });
      if (await selectedTab.count() === 1) return candidates[0]!;
    }
    await page.waitForTimeout(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  await logFrameDiagnostics(page, `${label} writable editor not uniquely correlated with the selected tab`);
  throw new Error(`Timed out waiting for ${label}; selectedTab=${selectedTabLabel ?? "any"}; writableFrames=${JSON.stringify(candidates.map((frame) => frame.url()))}`);
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
  // Explorer virtualizes off-screen rows. Earlier proofs may expand or scroll it, so
  // an existing root file need not have a treeitem (#2834). Open its exact URI through
  // VS Code's native command, retaining the real custom-editor activation assertions.
  await page.waitForTimeout(100);
  await openNativeQuickOpenFile(page, expect, gamePath);
  await expect(page.getByRole("tab", { selected: true }).filter({ hasText: gamePath.split("/").at(-1)! }).first()).toBeVisible();
  await expect(page.locator("iframe.webview:visible")).toBeVisible({ timeout: 30_000 });
}

async function closeActiveEditor(page: Page, expect: Expect): Promise<void> {
  await runCommand(page, expect, "View: Close Editor");
}

async function commandPalette(page: Page, expect: Expect): Promise<Locator> {
  const input = page.locator(".quick-input-widget input:visible");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await focusWorkbench(page);
    // Let the previous editor/webview focus transition settle before opening another host UI.
    await page.waitForTimeout(100);
    await page.keyboard.press("ControlOrMeta+Shift+P");
    if (await input.waitFor({ state: "visible", timeout: 1_000 }).then(() => true, () => false)) return input;
    await page.keyboard.press("Escape");
  }
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

/** Animation authoring through native commands, the actual webview bridge and disk-backed workspace provider. */
export async function runVscodeAnimationProof(page: Page, expect: Expect, workbenchUrl: string, host: Pick<ProofHost, "readBacking" | "withBackingWriteRefused">): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const read = async (path: string): Promise<Uint8Array | null> => {
    try { return await host.readBacking(path); }
    catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null; throw error; }
  };
  const open = async () => (await openProjectFile(page, ANIMATION_PROOF_PATH, expect, ".tkr-animation-editor")).locator(".tkr-animation-editor");
  const close = async () => {
    if (await page.getByRole("tab").filter({ hasText: "host-proof.anm" }).count()) {
      await runCommand(page, expect, "View: Close Editor");
      await expect(page.getByRole("tab").filter({ hasText: "host-proof.anm" })).toHaveCount(0);
      await page.waitForTimeout(150);
    }
  };
  await runAnimationAuthoringProof({
    save: async (editor) => { await editor.getByRole("button", { name: "Save", exact: true }).click(); },
    create: async () => {
      await runCommandMatching(page, expect, "TK Reawakened: New animation", "TK Reawakened: New animation", false, "New animation");
      const input = page.getByRole("textbox", { name: "New animation" });
      await expect(page.locator(".quick-input-widget")).toContainText("Project-relative .anm destination in Misc");
      await input.fill(ANIMATION_PROOF_PATH);
      await input.press("Escape");
      expect(await read(ANIMATION_PROOF_PATH)).toBeNull();
      await runCommandMatching(page, expect, "TK Reawakened: New animation", "TK Reawakened: New animation", false, "New animation");
      await expect(page.locator(".quick-input-widget")).toContainText("Project-relative .anm destination in Misc");
      await expect(input).toBeVisible(); await input.fill(ANIMATION_PROOF_PATH); await input.press("Enter");
      return (await waitForCustomEditorFrame(page, "new animation", ".tkr-animation-editor")).locator(".tkr-animation-editor");
    },
    reopen: async () => { await close(); return open(); },
    restart: async () => {
      await close(); await requestNativeReload(page, expect);
      await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(250);
    },
    restore: async (reason) => {
      await runCommandMatching(page, expect, "TK Reawakened: Project recovery", "TK Reawakened: Project recovery", false, "Project recovery");
      const widget = page.locator(".quick-input-widget");
      const row = widget.getByRole("option").filter({ hasText: reason + ":" }).filter({ hasText: "Bitmap/proof-first.tbm" }).last();
      await expect(row).toBeVisible(); await row.click();
      await expect(widget.getByRole("option", { name: /^Restore group(?:,|$)/ })).toBeVisible();
      await widget.getByRole("option", { name: /^Restore group(?:,|$)/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Bitmap/proof-first.tbm: written", { timeout: 20_000 });
      await dialog.getByRole("button", { name: "OK", exact: true }).click();
      await page.waitForTimeout(100);
    },
    consent: async () => { await page.getByRole("dialog").getByRole("button", { name: "Replace", exact: true }).click(); },
    read,
    refuseAnimationWrite: (check) => host.withBackingWriteRefused(ANIMATION_PROOF_PATH, check),
    settle: () => page.waitForTimeout(60),
  }, expect);
}

/** Story 12.3 through the packaged custom editor, native program tabs and real persistent filesystem. */
export async function runVscodeBoardPropertiesProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  await openProjectFile(page, "Main/example.gam", expect, ".tkr-settings");
  const board = async (): Promise<Locator> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        // A retained native webview can be visible inside its own iframe while another editor covers it.
        if (await frame.locator(".tkr-board:visible").count().catch(() => 0) > 0
          && await frame.evaluate(() => document.hasFocus()).catch(() => false)) {
          found = frame;
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The active board custom editor was not found");
    return found.locator(".tkr-board");
  };
  const open = async (path: string): Promise<Locator> => {
    await focusWorkbench(page);
    await openNativeQuickOpenFile(page, expect, path);
    await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
    await page.waitForTimeout(100);
    return board();
  };
  await runBoardPropertiesProof({
    main: "Main/example.gam",
    read: readBacking,
    openBoard: open,
    reopenBoard: async (path) => {
      await runCommand(page, expect, "View: Close Editor");
      await expect(page.getByRole("tab").filter({ hasText: path.split("/").at(-1)! })).toHaveCount(0);
      await page.waitForTimeout(150);
      return open(path);
    },
    closeBoard: async (path) => {
      await page.getByRole("tab").filter({ hasText: path.split("/").at(-1)! }).first().click({ button: "middle" });
      await expect(page.getByRole("tab").filter({ hasText: path.split("/").at(-1)! })).toHaveCount(0);
      await page.waitForTimeout(150);
    },
    save: async (editor) => { await editor.getByRole("button", { name: "Save", exact: true }).click(); },
    expectBoard: async (path) => {
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
      await board();
    },
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
      await expect(page.locator(".editor-instance .monaco-editor").last()).toContainText(text);
    },
    returnToBoard: async () => {
      await runCommand(page, expect, "TK Reawakened: Return to board");
      await page.waitForTimeout(150);
      return board();
    },
    setInitial: async (editor, accept) => {
      await editor.getByRole("button", { name: "Set as initial board", exact: true }).click();
      const dialog = editor.getByRole("dialog");
      await expect(dialog).toContainText("properties-origin.brd");
      await dialog.getByRole("button", { name: accept ? "Set initial board" : "Cancel", exact: true }).click();
      await page.waitForTimeout(100);
    },
    saveMain: async () => {
      const frame = await openProjectFile(page, "Main/example.gam", expect, ".tkr-settings");
      await frame.getByRole("button", { name: "Save", exact: true }).click();
      await open(PROPERTIES_BOARD);
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
}

/** Story 12.11 through the packaged custom editor, native definition visits and persisted bytes. */
export async function runVscodeBoardObjectsProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>): Promise<void> {
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  await openProjectFile(page, "Main/example.gam", expect, ".tkr-settings");
  const board = async (): Promise<Locator> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator(".tkr-board:visible").count().catch(() => 0) > 0
          && await frame.evaluate(() => document.hasFocus()).catch(() => false)) {
          found = frame; return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The active object-board custom editor was not found");
    return found.locator(".tkr-board");
  };
  const open = async (path: string): Promise<Locator> => {
    await focusWorkbench(page);
    await openNativeQuickOpenFile(page, expect, path);
    await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
    await page.waitForTimeout(100);
    return board();
  };
  await runBoardObjectsProof({
    page, read: readBacking, openBoard: open,
    chooseAsset: async (reference) => {
      const picker = page.locator(".quick-input-widget");
      await expect(picker).toBeVisible();
      const query = picker.locator("input:visible");
      await query.fill(reference);
      await expect(picker.getByRole("option", { name: reference, exact: true })).toBeVisible();
      await query.press("Enter");
      await expect(picker).toBeHidden();
      const confirm = page.getByRole("button", { name: "Use it", exact: true });
      await confirm.click();
      await expect(confirm).toBeHidden();
      await page.waitForTimeout(120);
    },
    reopenBoard: async (path) => {
      await runCommand(page, expect, "View: Close Editor");
      await expect(page.getByRole("tab").filter({ hasText: path.split("/").at(-1)! })).toHaveCount(0);
      await page.waitForTimeout(150); return open(path);
    },
    save: async (editor) => {
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor.locator(".tkr-board-state")).toHaveText("All changes saved");
      const nativeTab = page.getByRole("tab", { selected: true }).filter({ hasText: OBJECTS_BOARD.split("/").at(-1)! }).first();
      await expect(nativeTab).not.toHaveClass(/dirty/);
      await page.waitForTimeout(100);
    },
    undo: async (editor) => { await editor.locator("canvas").focus(); await page.keyboard.press("ControlOrMeta+z"); },
    redo: async (editor) => { await editor.locator("canvas").focus(); await page.keyboard.press("ControlOrMeta+Shift+z"); },
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
      await expect(page.locator(".editor-instance .monaco-editor").last()).toContainText(text);
    },
    expectItem: async (path, name) => {
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
      await expect.poll(async () => {
        for (const frame of page.frames()) {
          if (await frame.getByRole("region", { name: "item sprite graphics", exact: true }).evaluateAll((regions, name) => regions.some((region) => region.textContent?.includes(name) === true), name).catch(() => false)) return true;
        }
        return false;
      }, { timeout: 30_000 }).toBe(true);
    },
    returnToBoard: async () => {
      await runCommand(page, expect, "TK Reawakened: Return to board");
      await page.waitForTimeout(150); return board();
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
}

/** Story 12.12 through the real packaged VS Code workbench, source visits and live player snapshots. */
export async function runVscodeConnectedAuthoringProof(page: Page, expect: Expect, workbenchUrl: string, readBacking: (path: string) => Promise<Uint8Array>): Promise<void> {
  const wasmErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (/WebAssembly|Content Security Policy/i.test(error.message)) wasmErrors.push(error.message);
  });
  await page.addInitScript(() => {
    const usage = { instantiate: 0 };
    Reflect.set(window, "__tkrConnectedWasmUsage", usage);
    const instantiate = WebAssembly.instantiate.bind(WebAssembly);
    WebAssembly.instantiate = ((...args: Parameters<typeof WebAssembly.instantiate>) => {
      usage.instantiate += 1;
      return instantiate(...args);
    }) as typeof WebAssembly.instantiate;
  });
  await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 60_000 });
  const board = async (): Promise<Locator> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator(".tkr-board:visible").count().catch(() => 0) > 0
          && await frame.evaluate(() => document.hasFocus()).catch(() => false)) {
          found = frame;
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("The active connected-authoring board editor was not found");
    return found.locator(".tkr-board");
  };
  const sourceEditor = async (selector: string, label: string): Promise<Locator> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator(`${selector}:visible`).count().catch(() => 0) > 0
          && await frame.evaluate(() => document.hasFocus()).catch(() => false)) {
          found = frame;
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error(`The active ${label} source editor was not found`);
    return found.locator(selector);
  };
  const open = async (path: string): Promise<Locator> => {
    await focusWorkbench(page);
    await openNativeQuickOpenFile(page, expect, path);
    await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
    return board();
  };
  const settings = async (): Promise<Frame> => openProjectFile(page, "Main/example.gam", expect, ".tkr-settings");
  const player = async (): Promise<Frame> => {
    let found: Frame | undefined;
    await expect.poll(async () => {
      for (const frame of page.frames()) {
        if (await frame.locator("#screen").count().catch(() => 0) > 0
          && await frame.evaluate(() => Reflect.get(window, "__session") !== undefined).catch(() => false)) {
          found = frame;
          return true;
        }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
    if (found === undefined) throw new Error("Connected-authoring player frame was not found");
    return found;
  };
  const launchSaved = async (name: string): Promise<Frame> => {
    await runCommand(page, expect, "Debug: Select and Start Debugging", "Type the name of a launch configuration to run.");
    const picker = page.locator(".quick-input-widget");
    await expect(picker).toBeVisible();
    await picker.getByRole("option", { name: new RegExp(name) }).click();
    await page.waitForTimeout(150);
    const active = await player();
    expect(await active.evaluate(() => (Reflect.get(window, "__tkrConnectedWasmUsage") as { readonly instantiate: number } | undefined)?.instantiate)).toBe(0);
    return active;
  };
  // Establish this game's owning main before relative visits; the harness also keeps a separate sentinel main.
  await settings();
  await runConnectedAuthoringProof({
    page,
    launchSetupPath: ".vscode/launch.json",
    read: readBacking,
    openBoard: open,
    save: async () => {
      await runCommand(page, expect, "File: Save");
      await expect(page.getByRole("tab", { selected: true }).last()).not.toHaveClass(/dirty/);
    },
    cancelAssetPicker: async () => {
      const picker = page.locator(".quick-input-widget");
      await expect(picker).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
    },
    chooseAsset: async (reference) => {
      const picker = page.locator(".quick-input-widget");
      await expect(picker).toBeVisible();
      const query = picker.locator("input:visible");
      await query.fill(reference);
      await expect(picker.getByRole("option", { name: reference, exact: true })).toBeVisible();
      await query.press("Enter");
      await expect(picker).toBeHidden();
      const confirm = page.getByRole("button", { name: "Use it", exact: true });
      await confirm.click();
      await expect(confirm).toBeHidden();
    },
    spriteEditor: () => sourceEditor('.tkr-sprite-graphics[aria-label="item sprite graphics"]', "item"),
    animationEditor: () => sourceEditor(".tkr-animation-editor", "animation"),
    bitmapEditor: () => sourceEditor(".tkr-bitmap", "tile bitmap"),
    expectSingleSharedItemDocument: async () => {
      await expect(page.getByRole("tab").filter({ hasText: CONNECTED_ITEM.split("/").at(-1)! })).toHaveCount(1);
    },
    openDocument: async (path) => {
      await focusWorkbench(page);
      await openNativeQuickOpenFile(page, expect, path);
    },
    revealRun: async () => {
      await page.getByRole("tab").filter({ hasText: /Testing Board test|Running Game/ }).last().click();
      await page.waitForTimeout(150);
    },
    returnToAnimation: async () => {
      await runCommand(page, expect, "TK Reawakened: Return to board");
      return sourceEditor(".tkr-animation-editor", "animation");
    },
    returnToBoard: async () => {
      for (let hop = 0; hop < 3; hop += 1) {
        await runCommand(page, expect, "TK Reawakened: Return to board");
        await page.waitForTimeout(150);
        if (await page.getByRole("tab", { selected: true }).filter({ hasText: CONNECTED_BOARD.split("/").at(-1)! }).count() > 0) return board();
      }
      throw new Error("The three-source visit chain did not return to its original native board");
    },
    expectProgram: async (path, text) => {
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).toBeVisible();
      await expect(page.locator(".editor-instance .monaco-editor").last()).toContainText(text);
    },
    writeProgram: async (path, text, before) => {
      await focusWorkbench(page);
      await openNativeQuickOpenFile(page, expect, path);
      const editor = page.locator(".editor-instance .monaco-editor").last();
      await expect(editor.locator(".view-lines")).toBeVisible();
      await editor.click();
      await page.keyboard.press("ControlOrMeta+A");
      // Native Monaco needs a real paste transaction so VS Code, not raw CDP insertion, owns undo.
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(workbenchUrl).origin });
      await page.evaluate((value) => navigator.clipboard.writeText(value), text);
      await page.keyboard.press("ControlOrMeta+V");
      await expect(editor).toContainText(text.split("\n")[0]!);
      await runCommand(page, expect, "Undo");
      await expect(editor).toContainText(before.split("\n")[0]!);
      await runCommand(page, expect, "Redo");
      await expect(editor).toContainText(text.split("\n")[0]!);
      await runCommand(page, expect, "File: Save");
      await expect(page.getByRole("tab", { selected: true }).filter({ hasText: path.split("/").at(-1)! }).first()).not.toHaveClass(/dirty/);
    },
    runSavedBoardSetup: () => launchSaved("Connected board test"),
    runGame: () => launchSaved("Connected game start-up"),
    readRunSnapshot: async (frame) => {
      const text = await frame.locator("#run-snapshot pre").textContent();
      if (text === null) throw new Error("The native player did not expose its captured run snapshot");
      return JSON.parse(text) as { readonly kind: string; readonly manifest: string; readonly start: { readonly board: string } | null };
    },
    stopRun: async () => {
      await runCommand(page, expect, "Debug: Stop");
      await expect.poll(async () => {
        for (const candidate of page.frames()) if (await candidate.locator("#screen").count().catch(() => 0) > 0) return true;
        return false;
      }, { timeout: 30_000 }).not.toBe(true);
    },
    settle: () => page.waitForTimeout(80),
  }, expect);
  expect(wasmErrors, "Native player and extension browser bundles respect the existing strict CSP").toEqual([]);
  await open(CONNECTED_BOARD);
  const screenshot = process.env.TKR_VSCODE_PROOF_SCREENSHOT;
  if (screenshot !== undefined) await page.screenshot({ path: screenshot });
}

