import * as vscode from "vscode";
import { createRunHandle, prepareRun, prepareSceneLaunch, platformError, platformOk, type Launch, type PreparedRun, type PlatformResult, type ProgramLaunch, type RunHandle, type RunService, type RunStartGuard, type RunStatus } from "@tk-reawakened/platform-services";
import { createVscodeFileSystem } from "./filesystem.ts";


type RunGeneration = () => number;

function playerStatus(value: unknown): RunStatus | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as Record<string, unknown>;
  const stateHash = item.stateHash === undefined && (item.state === "ended" || item.state === "failed") ? null : item.stateHash;
  if (!(item.state === "starting" || item.state === "running" || item.state === "stalled" || item.state === "ended" || item.state === "failed")
    || typeof item.tick !== "number" || !(typeof item.board === "string" || item.board === null)
    || !(typeof stateHash === "string" || stateHash === null)
    || !(typeof item.stalledOn === "string" || item.stalledOn === null) || !Array.isArray(item.diagnostics)
    || !(typeof item.message === "string" || item.message === null)) return undefined;
  return {
    state: item.state,
    tick: item.tick,
    board: item.board,
    stateHash,
    stalledOn: item.stalledOn,
    diagnostics: item.diagnostics as RunStatus["diagnostics"],
    message: item.message,
  };
}

async function bundledFiles(extensionUri: vscode.Uri): Promise<Array<[string, Uint8Array]>> {
  const manifest = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, "dist", "player-assets.json"));
  const paths: unknown = JSON.parse(new TextDecoder().decode(manifest));
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string" || path.startsWith("/") || path.split("/").includes(".."))) {
    throw new Error("The bundled player asset manifest is invalid.");
  }
  return await Promise.all(paths.map(async (path: string): Promise<[string, Uint8Array]> =>
    [path, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, "dist", "player-assets", ...path.split("/")))]));
}

function relativeToWorkspace(root: vscode.Uri, uri: vscode.Uri): string | undefined {
  if (uri.scheme !== root.scheme || uri.authority !== root.authority) return undefined;
  const base = root.path === "/" ? "" : root.path.replace(/\/+$/, "");
  const relative = uri.path === root.path ? "" : uri.path.startsWith(`${base}/`) ? uri.path.slice(base.length + 1) : undefined;
  return relative === undefined || relative.split("/").some((part) => part === "." || part === "..") ? undefined : relative;
}

async function projectFolderChoices(root: vscode.Uri): Promise<Array<{ label: string; folder: string }>> {
  const choices = [{ label: "Workspace root (package layout)", folder: "" }];
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, "Game"))) {
      if ((type & vscode.FileType.Directory) !== 0) choices.push({ label: `Game/${name}`, folder: `Game/${name}` });
    }
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
  }
  return choices;
}

async function saveBeforeRun(generation: RunGeneration): Promise<PlatformResult<number>> {
  const before = generation();
  let saved: boolean;
  try {
    saved = await vscode.workspace.saveAll();
  } catch (error) {
    return platformError("io-error", `VS Code could not save open files: ${String(error)}`);
  }
  if (!saved) return platformError("io-error", "VS Code could not save all open files; nothing was run.");
  if (generation() !== before) return platformError("unavailable", "A document changed while VS Code was saving it; save again and retry the run.");
  const dirty = vscode.workspace.textDocuments.find((document) => document.isDirty);
  if (dirty !== undefined) return platformError("unavailable", "An open document is still unsaved; nothing was run.");
  return platformOk(generation());
}

function playerHtml(webview: vscode.Webview, playerUri: vscode.Uri): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; media-src ${webview.cspSource} blob:; worker-src blob: ${webview.cspSource}; connect-src ${webview.cspSource}; font-src ${webview.cspSource} data:;"><title>Running game</title><style>:root{color-scheme:dark}body{box-sizing:border-box;margin:0;height:100dvh;overflow:hidden;background:#111;color:#ddd;font:13px/1.4 ui-monospace,monospace;display:grid;grid-template-rows:minmax(0,1fr) auto}#stage{position:relative;display:grid;place-items:center;min-height:0;overflow:hidden}canvas{image-rendering:pixelated;display:block;width:100%;height:100%;background:#000;touch-action:none}#spinner[hidden]{display:none}#spinner{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}#spinner:before{content:"";width:36px;height:36px;border:4px solid #ffffff40;border-top-color:white;border-radius:50%;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}pre{margin:8px 12px 12px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body data-tkr-host="vscode"><div id="stage"><canvas id="screen" width="640" height="480" tabindex="0" aria-label="Game screen"></canvas><div id="spinner" role="status" aria-label="Loading" hidden></div></div><pre id="report">Starting game…</pre><script nonce="${nonce}" src="${webview.asWebviewUri(playerUri)}"></script></body></html>`;
}

/** Make the project-bound VS Code run surface. All launches use saved project bytes; no player reads the workspace again. */
export function createVscodeRunService(context: vscode.ExtensionContext, root: vscode.Uri, generation: RunGeneration): RunService {
  const projectId = root.toString();
  const fs = createVscodeFileSystem(root);
  return {
    unavailable: { board: "The owner's fresh-state ruling requires its accepted ADR/spec update before board-test implementation." },
    startGame: async (launch, guard = () => platformOk(undefined)) => {
      if (launch.kind === "board") return platformError("unavailable", "The owner's fresh-state ruling requires its accepted ADR/spec update before board-test implementation.");
      return await start(launch, guard);
    },
    startProgram: async (launch, guard = () => platformOk(undefined)) => await start(launch, guard),
  };

  async function start(launch: Exclude<Launch, { kind: "board" }>, callerGuard: RunStartGuard): Promise<PlatformResult<RunHandle>> {
    const savedResult = await saveBeforeRun(generation);
    if (!savedResult.ok) return savedResult;
    const savedGeneration = savedResult.value;
    const prepared = await prepareRun(fs, launch, { projectId, runner: "runner-web" });
    if (!prepared.ok) return prepared;
    let scene: { readonly board: string; readonly program: string } | undefined;
    if (launch.kind === "program") {
      const staged = prepareSceneLaunch(launch, prepared.value.files);
      if (!staged.ok) return staged;
      scene = staged.value;
    }
    const beforePlayer = currentGuard();
    if (!beforePlayer.ok) return beforePlayer;
    return await openPlayer(launch, prepared.value, scene, currentGuard);

    function currentGuard(): PlatformResult<void> {
      if (generation() !== savedGeneration) return platformError("unavailable", "A saved file changed while the run was being prepared; run it again.");
      return callerGuard();
    }
  }


  async function openPlayer(
    launch: Exclude<Launch, { kind: "board" }>,
    prepared: PreparedRun,
    scene: { readonly board: string; readonly program: string } | undefined,
    guard: RunStartGuard,
  ): Promise<PlatformResult<RunHandle>> {
    const playerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "player.js");
    const decodeWorkerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "decode-worker.js");
    const workletUri = vscode.Uri.joinPath(context.extensionUri, "dist", "audio-worklet.js");
    let bundled: Array<[string, Uint8Array]>;
    try {
      bundled = await bundledFiles(context.extensionUri);
    } catch (error) {
      return platformError("io-error", `The bundled player assets could not be loaded: ${String(error)}`);
    }
    const launchLabel = launch.kind === "program" ? "Program test" : "Game";
    const panel = vscode.window.createWebviewPanel("tkr.player", launch.kind === "game" ? "Running Game" : `Testing ${launchLabel}`, vscode.ViewColumn.Beside, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    status.text = `$(play) Starting ${launchLabel.toLowerCase()}`;
    status.show();
    const snapshotText = JSON.stringify(prepared.snapshot, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    panel.webview.html = playerHtml(panel.webview, playerUri).replace("</body>", `<details id="run-snapshot" style="max-height:30vh;overflow:auto"><summary>Run snapshot</summary><pre>${snapshotText}</pre></details></body>`);
    let disposed = false;
    let ready = false;
    let resolved = false;
    let report: ((update: Partial<RunStatus>) => void) | undefined;
    let handle: RunHandle | undefined;
    let resolve!: (result: PlatformResult<RunHandle>) => void;
    const promise = new Promise<PlatformResult<RunHandle>>((done) => { resolve = done; });
    const finish = (result: PlatformResult<RunHandle>): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };
    panel.onDidDispose(() => {
      disposed = true;
      handle?.stop();
      status.dispose();
      finish(platformError("unavailable", "The player closed before the run started."));
    }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (disposed || typeof message !== "object" || message === null) return;
      const value = message as Record<string, unknown>;
      if (value.type === "ready" && !ready) {
        ready = true;
        const lastCheck = guard();
        if (!lastCheck.ok) {
          finish(lastCheck);
          panel.dispose();
          return;
        }
        const made = createRunHandle(prepared.snapshot, () => { if (!disposed) panel.dispose(); });
        handle = made.handle;
        report = made.report;
        const messageToPlayer = {
          type: "launch",
          main: launch.main,
          project: projectId,
          projectFolder: launch.projectFolder,
          seed: prepared.snapshot.seed,
          files: [...prepared.files],
          bundled,
          workletUrl: panel.webview.asWebviewUri(workletUri).toString(),
          decodeWorkerUrl: panel.webview.asWebviewUri(decodeWorkerUri).toString(),
          ...(scene === undefined ? {} : { scene }),
        };
        // This is the last synchronous guard before the frozen bytes are handed to the player.
        const handoffGuard = guard();
        if (!handoffGuard.ok) {
          finish(handoffGuard);
          panel.dispose();
          return;
        }
        try {
          const posted = await panel.webview.postMessage(messageToPlayer);
          if (!posted) {
            report({ state: "failed", message: "The player webview was disposed before launch." });
            panel.dispose();
            finish(platformError("unavailable", "The player webview was disposed before launch."));
            return;
          }
          finish(platformOk(made.handle));
        } catch (error) {
          report({ state: "failed", message: `The player webview rejected the launch: ${String(error)}` });
          panel.dispose();
          finish(platformError("io-error", `The player webview rejected the launch: ${String(error)}`));
        }
      } else if (value.type === "status") {
        const statusValue = playerStatus(value.status);
        if (statusValue === undefined) return;
        report?.(statusValue);
        status.text = statusValue.state === "running" ? `$(play) ${launch.kind === "program" ? "Program" : "Game"} tick ${statusValue.tick}`
          : statusValue.state === "stalled" ? `$(loading~spin) Waiting for ${statusValue.stalledOn ?? "an asset"}`
            : statusValue.state === "ended" ? "$(check) Run ended"
              : statusValue.state === "failed" ? "$(error) Run failed"
                : "$(play) Starting run";
        if (statusValue.state === "failed") void vscode.window.showErrorMessage(statusValue.message ?? "The run could not be started.");
      }
    }, undefined, context.subscriptions);
    return await promise;
  }
}

function isProgramLaunch(value: unknown): value is ProgramLaunch {
  if (typeof value !== "object" || value === null) return false;
  const launch = value as Record<string, unknown>;
  if (launch.kind !== "program" || typeof launch.main !== "string" || typeof launch.projectFolder !== "string"
    || typeof launch.program !== "string" || (launch.seed !== undefined && typeof launch.seed !== "number")) return false;
  const fixture = launch.fixture;
  if (typeof fixture !== "object" || fixture === null || Array.isArray(fixture)) return false;
  const data = fixture as Record<string, unknown>;
  if (typeof data.id !== "string" || !Array.isArray(data.party) || !data.party.every((path) => typeof path === "string")) return false;
  if (data.font !== undefined && typeof data.font !== "string") return false;
  if (data.fontSize !== undefined && typeof data.fontSize !== "number") return false;
  if (data.windowGraphic !== undefined && typeof data.windowGraphic !== "string") return false;
  if (data.start !== undefined) {
    if (typeof data.start !== "object" || data.start === null || Array.isArray(data.start)) return false;
    const start = data.start as Record<string, unknown>;
    if (typeof start.board !== "string" || typeof start.x !== "number" || typeof start.y !== "number" || typeof start.layer !== "number") return false;
  }
  return true;
}

interface PromptedProgramLaunch {
  readonly workspace: vscode.WorkspaceFolder;
  readonly launch: ProgramLaunch;
}

async function promptProgramLaunch(): Promise<PromptedProgramLaunch | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    void vscode.window.showErrorMessage("Open a workspace folder before testing a program.");
    return undefined;
  }
  const selectedWorkspace = workspaceFolders.length === 1
    ? workspaceFolders[0]
    : await vscode.window.showQuickPick(workspaceFolders.map((workspace) => ({
      label: workspace.name,
      description: workspace.uri.toString(),
      workspace,
    })), { title: "Choose the program's project", ignoreFocusOut: true }).then((selection) => selection?.workspace);
  if (selectedWorkspace === undefined) return undefined;
  const mainSelection = await pickOne(selectedWorkspace.uri, "Choose the game's .gam main file", { "RPG Toolkit game": ["gam"] });
  if (mainSelection === undefined) return undefined;
  const main = relativeToWorkspace(selectedWorkspace.uri, mainSelection);
  if (main === undefined || !main.toLowerCase().endsWith(".gam")) {
    void vscode.window.showErrorMessage("Choose a .gam main file inside the selected workspace.");
    return undefined;
  }
  const pickedFolder = await vscode.window.showQuickPick(await projectFolderChoices(selectedWorkspace.uri), {
    title: "Choose the game's asset folder", placeHolder: "Workspace root or Game/<game>", ignoreFocusOut: true,
  });
  if (pickedFolder === undefined) return undefined;
  const projectRoot = pickedFolder.folder === "" ? selectedWorkspace.uri : vscode.Uri.joinPath(selectedWorkspace.uri, ...pickedFolder.folder.split("/"));
  const programSelection = await pickOne(projectRoot, "Choose the RPGCode program to test", { "RPGCode program": ["prg"] });
  if (programSelection === undefined) return undefined;
  const program = relativeToWorkspace(selectedWorkspace.uri, programSelection);
  if (program === undefined) {
    void vscode.window.showErrorMessage("Choose a program file inside the selected workspace.");
    return undefined;
  }
  const boardSelection = await pickOne(projectRoot, "Choose the fixture board", { "RPG Toolkit boards": ["brd"] });
  if (boardSelection === undefined) return undefined;
  const board = relativeToWorkspace(selectedWorkspace.uri, boardSelection);
  if (board === undefined) {
    void vscode.window.showErrorMessage("Choose a board file inside the selected workspace.");
    return undefined;
  }
  const x = await askPositiveInteger("Fixture start X (tile)", 1);
  if (x === undefined) return undefined;
  const y = await askPositiveInteger("Fixture start Y (tile)", 1);
  if (y === undefined) return undefined;
  const layer = await askPositiveInteger("Fixture start layer", 1);
  if (layer === undefined) return undefined;
  const partyAction = await vscode.window.showQuickPick([
    { label: "Choose fixture party members", id: "choose" },
    { label: "No party members", id: "none" },
  ], { title: "Fixture party", ignoreFocusOut: true });
  if (partyAction === undefined) return undefined;
  let party: string[] = [];
  if (partyAction.id === "choose") {
    const partySelections = await vscode.window.showOpenDialog({
      title: "Choose fixture party members",
      canSelectMany: true, canSelectFiles: true, canSelectFolders: false,
      defaultUri: vscode.Uri.joinPath(projectRoot, "Chrs"), filters: { "Character files": ["tem"] },
    });
    if (partySelections === undefined || partySelections.length === 0) return undefined;
    const selectedParty = partySelections.map((uri) => relativeToWorkspace(selectedWorkspace.uri, uri));
    if (selectedParty.some((path) => path === undefined)) {
      void vscode.window.showErrorMessage("Choose party member files inside the selected workspace.");
      return undefined;
    }
    party = selectedParty as string[];
  }
  const font = await vscode.window.showInputBox({ prompt: "Fixture font name (leave blank for the game's default)", ignoreFocusOut: true });
  if (font === undefined) return undefined;
  const fontSizeText = await vscode.window.showInputBox({
    prompt: "Fixture font size (leave blank for the game's default)",
    validateInput: (value) => value === "" || (Number.isFinite(Number(value)) && Number(value) > 0) ? undefined : "Enter a positive finite font size, or leave this blank.",
    ignoreFocusOut: true,
  });
  if (fontSizeText === undefined) return undefined;
  const graphicAction = await vscode.window.showQuickPick([
    { label: "Choose a message-window graphic", id: "choose" },
    { label: "No message-window graphic", id: "none" },
  ], { title: "Fixture message-window graphic", ignoreFocusOut: true });
  if (graphicAction === undefined) return undefined;
  let windowGraphic: string | undefined;
  if (graphicAction.id === "choose") {
    const graphicSelection = await pickOne(projectRoot, "Choose the message-window graphic", {});
    if (graphicSelection === undefined) return undefined;
    windowGraphic = relativeToWorkspace(selectedWorkspace.uri, graphicSelection);
    if (windowGraphic === undefined) {
      void vscode.window.showErrorMessage("Choose a message-window graphic inside the selected workspace.");
      return undefined;
    }
  }
  return {
    workspace: selectedWorkspace,
    launch: {
      kind: "program",
      main,
      projectFolder: pickedFolder.folder,
      program,
      fixture: {
        id: program,
        party: party as string[],
        ...(font === "" ? {} : { font }),
        ...(fontSizeText === "" ? {} : { fontSize: Number(fontSizeText) }),
        ...(windowGraphic === undefined ? {} : { windowGraphic }),
        start: { board, x, y, layer },
      },
    },
  };

  async function pickOne(root: vscode.Uri, title: string, filters: Record<string, string[]>): Promise<vscode.Uri | undefined> {
    const selected = await vscode.window.showOpenDialog({
      title, canSelectMany: false, canSelectFiles: true, canSelectFolders: false, defaultUri: root, filters,
    });
    return selected?.[0];
  }

  async function askPositiveInteger(prompt: string, initial: number): Promise<number | undefined> {
    const text = await vscode.window.showInputBox({
      prompt, value: String(initial), ignoreFocusOut: true,
      validateInput: (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? undefined : "Enter a positive whole number.",
    });
    return text === undefined ? undefined : Number(text);
  }
}

/** Register native run commands; board tests remain unavailable until the fresh-state ruling's ADR/spec update is accepted. */
export function registerVscodeGameRunner(context: vscode.ExtensionContext, generation: RunGeneration, runForProject: (root: vscode.Uri) => RunService): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.runGame", async (explicitMain?: vscode.Uri, explicitFolder?: vscode.Uri) => {
    const savedResult = await saveBeforeRun(generation);
    if (!savedResult.ok) {
      void vscode.window.showErrorMessage(`RPG Toolkit could not save all open files; the game was not started: ${savedResult.error.message}`);
      return;
    }
    const savedGeneration = savedResult.value;
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      void vscode.window.showErrorMessage("Open a workspace folder before running a game.");
      return;
    }
    let mainUri = explicitMain;
    if (mainUri === undefined) {
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: false, canSelectFiles: true, canSelectFolders: false, openLabel: "Run Game",
        title: "Choose the game's .gam main file", filters: { "RPG Toolkit game": ["gam"] }, defaultUri: workspaceFolders[0]!.uri,
      });
      if (selected === undefined || selected.length === 0) return;
      mainUri = selected[0]!;
    }
    const workspace = vscode.workspace.getWorkspaceFolder(mainUri);
    if (workspace === undefined) {
      void vscode.window.showErrorMessage("Choose a .gam file inside an open workspace folder.");
      return;
    }
    const main = relativeToWorkspace(workspace.uri, mainUri);
    if (main === undefined || !main.toLowerCase().endsWith(".gam")) {
      void vscode.window.showErrorMessage("Choose a .gam game main file inside the workspace.");
      return;
    }
    let projectFolder: string | undefined;
    if (explicitFolder !== undefined) {
      projectFolder = relativeToWorkspace(workspace.uri, explicitFolder);
      if (projectFolder === undefined || (projectFolder !== "" && !/^Game\/[^/]+$/i.test(projectFolder))) {
        void vscode.window.showErrorMessage("The game folder must be the workspace root or one Game/<game> folder in the same workspace.");
        return;
      }
      try {
        if (((await vscode.workspace.fs.stat(explicitFolder)).type & vscode.FileType.Directory) === 0) throw new Error("not a directory");
      } catch {
        void vscode.window.showErrorMessage("The selected game folder does not exist or is not a directory.");
        return;
      }
    } else {
      const picked = await vscode.window.showQuickPick(await projectFolderChoices(workspace.uri), {
        title: "Choose the game asset folder", placeHolder: "Choose workspace root or a Game/<game> folder", ignoreFocusOut: true,
      });
      if (picked === undefined) return;
      projectFolder = picked.folder;
    }
    const result = await runForProject(workspace.uri).startGame({ kind: "game", main, projectFolder }, () => generation() === savedGeneration
      ? platformOk(undefined)
      : platformError("unavailable", "A saved file changed while you were choosing run options; run it again."));
    if (!result.ok) void vscode.window.showErrorMessage(`The game was not started: ${result.error.message}`);
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.startProgram", async (workspaceUri: unknown, launchValue: unknown) =>
    await startProgramRequest(workspaceUri, launchValue)));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.testProgram", async (workspaceUri?: unknown, launchValue?: unknown) => {
    if (workspaceUri !== undefined || launchValue !== undefined) {
      const result = await startProgramRequest(workspaceUri, launchValue);
      if (!result.ok) void vscode.window.showErrorMessage(`The program was not started: ${result.error.message}`);
      return result;
    }
    const saved = await saveBeforeRun(generation);
    if (!saved.ok) {
      void vscode.window.showErrorMessage(`The program was not started: ${saved.error.message}`);
      return saved;
    }
    const prompted = await promptProgramLaunch();
    if (prompted === undefined) return undefined;
    const result = await startProgramRequest(prompted.workspace.uri, prompted.launch, saved.value);
    if (!result.ok) void vscode.window.showErrorMessage(`The program was not started: ${result.error.message}`);
    return result;
  }));

  async function startProgramRequest(
    workspaceUri: unknown,
    launchValue: unknown,
    expectedGeneration?: number,
  ): Promise<PlatformResult<RunHandle>> {
    if (!(workspaceUri instanceof vscode.Uri) || !isProgramLaunch(launchValue)) {
      return platformError("invalid-request", "Start Program requires a workspace URI and a complete program launch.");
    }
    const workspace = vscode.workspace.getWorkspaceFolder(workspaceUri);
    if (workspace === undefined || workspace.uri.toString() !== workspaceUri.toString()) {
      return platformError("invalid-request", "Start Program requires the URI of an open workspace folder.");
    }
    const savedResult = await saveBeforeRun(generation);
    if (!savedResult.ok) return savedResult;
    const savedGeneration = expectedGeneration ?? savedResult.value;
    return await runForProject(workspace.uri).startProgram(launchValue, () => generation() === savedGeneration
      ? platformOk(undefined)
      : platformError("unavailable", "A saved file changed while the program run was being prepared; run it again."));
  }
}
