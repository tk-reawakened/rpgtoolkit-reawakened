import * as vscode from "vscode";
import { createRunHandle, prepareRun, type RunHandle, type RunStatus } from "@tk-reawakened/platform-services";
import { createVscodeFileSystem } from "./filesystem.ts";


type RunGeneration = () => number;

function isStatus(value: unknown): value is RunStatus {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (item.state === "starting" || item.state === "running" || item.state === "stalled" || item.state === "ended" || item.state === "failed")
    && typeof item.tick === "number" && (typeof item.board === "string" || item.board === null)
    && (typeof item.stalledOn === "string" || item.stalledOn === null) && Array.isArray(item.diagnostics)
    && (typeof item.message === "string" || item.message === null);
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

function playerHtml(webview: vscode.Webview, playerUri: vscode.Uri): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; media-src ${webview.cspSource} blob:; worker-src blob: ${webview.cspSource}; connect-src ${webview.cspSource}; font-src ${webview.cspSource} data:;"><title>Running game</title><style>:root{color-scheme:dark}body{box-sizing:border-box;margin:0;height:100dvh;overflow:hidden;background:#111;color:#ddd;font:13px/1.4 ui-monospace,monospace;display:grid;grid-template-rows:minmax(0,1fr) auto}#stage{position:relative;display:grid;place-items:center;min-height:0;overflow:hidden}canvas{image-rendering:pixelated;display:block;width:100%;height:100%;background:#000;touch-action:none}#spinner[hidden]{display:none}#spinner{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}#spinner:before{content:"";width:36px;height:36px;border:4px solid #ffffff40;border-top-color:white;border-radius:50%;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}pre{margin:8px 12px 12px;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body data-tkr-host="vscode"><div id="stage"><canvas id="screen" width="640" height="480" tabindex="0" aria-label="Game screen"></canvas><div id="spinner" role="status" aria-label="Loading" hidden></div></div><pre id="report">Starting game…</pre><script nonce="${nonce}" src="${webview.asWebviewUri(playerUri)}"></script></body></html>`;
}

/** Register the native command which runs a normal game from a saved, project-bound snapshot. */
export function registerVscodeGameRunner(context: vscode.ExtensionContext, generation: RunGeneration): void {
  context.subscriptions.push(vscode.commands.registerCommand("tkr.runGame", async (explicitMain?: vscode.Uri, explicitFolder?: vscode.Uri) => {
    let saved: boolean;
    try {
      saved = await vscode.workspace.saveAll();
    } catch (error) {
      void vscode.window.showErrorMessage(`RPG Toolkit could not save all open files; the game was not started: ${String(error)}`);
      return;
    }
    if (!saved) {
      void vscode.window.showErrorMessage("RPG Toolkit could not save all open files; the game was not started.");
      return;
    }
    const savedGeneration = generation();
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
    const launch = { kind: "game" as const, main, projectFolder };
    const projectId = workspace.uri.toString();
    const fs = createVscodeFileSystem(workspace.uri);
    const prepared = await prepareRun(fs, launch, { projectId, runner: "runner-web" });
    if (!prepared.ok) {
      void vscode.window.showErrorMessage(`The game could not be prepared: ${prepared.error.message}`);
      return;
    }
    const playerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "player.js");
    const decodeWorkerUri = vscode.Uri.joinPath(context.extensionUri, "dist", "decode-worker.js");
    const workletUri = vscode.Uri.joinPath(context.extensionUri, "dist", "audio-worklet.js");
    const panel = vscode.window.createWebviewPanel("tkr.player", "Running Game", vscode.ViewColumn.Beside, {
      enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    status.text = "$(play) Starting game";
    status.show();
    let ready = false;
    let disposed = false;
    let terminalFailureShown = false;
    let handle: RunHandle | undefined;
    let report: ((update: Partial<RunStatus>) => void) | undefined;
    let bundled: Array<[string, Uint8Array]>;
    try {
      bundled = await bundledFiles(context.extensionUri);
    } catch (error) {
      panel.dispose();
      status.dispose();
      void vscode.window.showErrorMessage(`The bundled player assets could not be loaded: ${String(error)}`);
      return;
    }
    panel.webview.html = playerHtml(panel.webview, playerUri);
    panel.onDidDispose(() => {
      disposed = true;
      handle?.stop();
      status.dispose();
    }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (disposed || typeof message !== "object" || message === null) return;
      const value = message as Record<string, unknown>;
      if (value.type === "ready" && !ready) {
        ready = true;
        const finalPrepared = await prepareRun(fs, launch, { projectId, runner: "runner-web" });
        if (disposed) return;
        if (generation() !== savedGeneration || !finalPrepared.ok || JSON.stringify(finalPrepared.ok ? finalPrepared.value.snapshot : null) !== JSON.stringify(prepared.value.snapshot)) {
          const reason = finalPrepared.ok ? "The saved game changed while the player was opening; run it again." : finalPrepared.error.message;
          void vscode.window.showErrorMessage(`The game was not started: ${reason}`);
          panel.dispose();
          return;
        }
        if (disposed) return;
        const made = createRunHandle(finalPrepared.value.snapshot, () => undefined);
        handle = made.handle;
        report = made.report;
        if (disposed || generation() !== savedGeneration) {
          handle.stop();
          if (!disposed) {
            void vscode.window.showErrorMessage("The game changed before the player could receive its saved files.");
            panel.dispose();
          }
          return;
        }
        let posted: boolean;
        try {
          posted = await panel.webview.postMessage({
            type: "launch", main, project: projectId, projectFolder, seed: finalPrepared.value.snapshot.seed,
            files: [...finalPrepared.value.files], bundled, workletUrl: panel.webview.asWebviewUri(workletUri).toString(),
            decodeWorkerUrl: panel.webview.asWebviewUri(decodeWorkerUri).toString(),
          });
        } catch (error) {
          if (!disposed) {
            report({ state: "failed", message: `The player webview rejected the launch: ${String(error)}` });
            panel.dispose();
          }
          return;
        }
        if (!posted && !disposed) {
          report({ state: "failed", message: "The player webview was disposed before launch." });
          panel.dispose();
        }
      } else if (value.type === "status" && isStatus(value.status)) {
        report?.(value.status);
        status.text = value.status.state === "running" ? `$(play) Game tick ${value.status.tick}`
          : value.status.state === "stalled" ? `$(loading~spin) Waiting for ${value.status.stalledOn ?? "an asset"}`
            : value.status.state === "ended" ? "$(check) Game ended"
              : value.status.state === "failed" ? "$(error) Game failed"
                : "$(play) Starting game";
        if (value.status.state === "failed" && !terminalFailureShown) {
          terminalFailureShown = true;
          void vscode.window.showErrorMessage(value.status.message ?? "The game could not be started.");
        }
      }
    }, undefined, context.subscriptions);
  }));
}
