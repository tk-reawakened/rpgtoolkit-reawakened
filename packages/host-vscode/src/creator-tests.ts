import * as vscode from "vscode";
import { createCreatorTestsController, type CreatorTestsController, type CreatorTestsFrame, type CreatorTestsState } from "@tk-reawakened/editor-ui";
import { platformError, type PlatformResult } from "@tk-reawakened/platform-services";
import { createVscodeFileSystem } from "./filesystem.ts";
import { saveBeforeRun, savedRunGuard, type RunGeneration } from "./saved-run.ts";

const COMMAND = "tkr.runSavedTests";
const TITLE = "RPG Toolkit: Run saved tests";
const MAX_NAME = 256;
const MAX_SOURCE_PATH = 1024;
type CreatorController = CreatorTestsController;
type BridgeRequest = { readonly id: string; readonly method: "run" | "openSource" | "invalid"; readonly args: readonly unknown[] };
type ProjectSurface = { readonly controller: CreatorController; readonly panel: vscode.WebviewPanel; readonly dispose: vscode.Disposable };

export function registerCreatorTests(context: vscode.ExtensionContext, generation: RunGeneration): void {
  const projects = new Map<string, ProjectSurface>();
  const disposeProject = (key: string): void => {
    const surface = projects.get(key);
    if (surface === undefined) return;
    projects.delete(key);
    surface.dispose.dispose();
    surface.panel.dispose();
  };
  const workspaceRemoval = vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    const removed = new Set(event.removed.map((folder) => folder.uri.toString()));
    for (const [key] of projects) if (removed.has(key)) disposeProject(key);
  });
  context.subscriptions.push(workspaceRemoval, { dispose: () => {
    for (const [key] of projects) disposeProject(key);
  } });
  context.subscriptions.push(vscode.commands.registerCommand(COMMAND, async () => {
    const root = await chooseWorkspace();
    if (root === undefined) return;
    if (!vscode.workspace.workspaceFolders?.some((folder) => folder.uri.toString() === root.toString())) {
      void vscode.window.showErrorMessage("The selected workspace folder is no longer open.");
      return;
    }
    const key = root.toString();
    const existing = projects.get(key);
    if (existing !== undefined) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    const host = {
      project: key,
      async prepare() {
        const saved = await saveBeforeRun(generation);
        return saved.ok ? { ok: true as const, value: savedRunGuard(root, generation, saved.value) } : saved;
      },
      async openSource(path: string, line: number, column: number): Promise<PlatformResult<void>> {
        if (!validSourceLocation(path, line, column)) return platformError("invalid-request", "The saved-test source location is invalid.");
        const uri = vscode.Uri.joinPath(root, ...path.split("/"));
        try {
          if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== key) {
            return platformError("invalid-request", "The saved-test source is outside its project.");
          }
          const document = await vscode.workspace.openTextDocument(uri);
          const position = new vscode.Position(line - 1, column - 1);
          await vscode.window.showTextDocument(document, { preview: false, selection: new vscode.Range(position, position) });
          return { ok: true, value: undefined };
        } catch (error) {
          return platformError("io-error", `Could not open the saved-test source: ${String(error)}`);
        }
      },
    };
    const controller = createCreatorTestsController({ fs: createVscodeFileSystem(root), host });
    const panel = vscode.window.createWebviewPanel("tkr.creatorTests", TITLE, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
    const source = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "creator-tests-webview.js")).toString();
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "tileset-browser.css")).toString();
    panel.webview.html = creatorTestsHtml(panel.webview, source, style, nonce);
    let disposed = false;
    let unsubscribe = (): void => {};
    let message: vscode.Disposable | undefined;
    let panelDispose: vscode.Disposable | undefined;
    const cleanup = (): void => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      message?.dispose();
      panelDispose?.dispose();
      projects.delete(key);
      controller.dispose();
    };
    const publish = (): void => {
      if (disposed) return;
      void panel.webview.postMessage({ type: "creator-tests:snapshot", nonce, state: serializeState(controller.getSnapshot()) });
    };
    unsubscribe = controller.subscribe(publish);
    message = panel.webview.onDidReceiveMessage((value: unknown) => {
      const request = parseBridgeRequest(value, nonce);
      if (request === undefined) return;
      void dispatchRequest(controller, request).then((result) => panel.webview.postMessage({ type: "creator-tests:response", nonce, id: request.id, result }), (error: unknown) =>
        panel.webview.postMessage({ type: "creator-tests:response", nonce, id: request.id, result: platformError("io-error", String(error)) }));
    });
    panelDispose = panel.onDidDispose(cleanup);
    // Keep the one project controller alive while the retained panel is hidden; only panel close or project removal ends it.
    const surface: ProjectSurface = { controller, panel, dispose: new vscode.Disposable(cleanup) };
    projects.set(key, surface);
    publish();
  }));
}

async function chooseWorkspace(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("Open a workspace folder before running saved tests.");
    return undefined;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = active === undefined ? undefined : vscode.workspace.getWorkspaceFolder(active);
  if (activeFolder !== undefined) return activeFolder.uri;
  if (folders.length === 1) return folders[0]!.uri;
  const selected = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, uri: folder.uri })), {
    title: "Choose the project for saved RPGCode tests", placeHolder: "Select a workspace folder", ignoreFocusOut: true,
  });
  return selected?.uri;
}

function validSourceLocation(path: string, line: number, column: number): boolean {
  return typeof path === "string" && path.length > 0 && path.length <= MAX_SOURCE_PATH && !path.startsWith("/")
    && !path.includes("\\") && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
    && /\.(?:prg|rnc)$/i.test(path) && Number.isSafeInteger(line) && line >= 1 && line <= 1_000_000
    && Number.isSafeInteger(column) && column >= 1 && column <= 100_000;
}

function parseBridgeRequest(value: unknown, nonce: string): BridgeRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.type !== "creator-tests:request" || item.nonce !== nonce || typeof item.id !== "string" || !/^[a-f0-9]{24}$/.test(item.id)) return undefined;
  const invalid = (): BridgeRequest => ({ id: item.id as string, method: "invalid", args: [] });
  if (!Array.isArray(item.args) || item.args.length > 1) return invalid();
  if (item.method === "run" && item.args.length === 1) {
    const args = item.args[0];
    if (typeof args !== "object" || args === null || Array.isArray(args)) return invalid();
    const request = args as Record<string, unknown>;
    if (Object.keys(request).some((key) => key !== "seed" && key !== "name") || !Number.isSafeInteger(request.seed)
      || (request.seed as number) < 0 || (request.seed as number) > 0xffffffff || typeof request.name !== "string" || request.name.length > MAX_NAME) return invalid();
    return { id: item.id, method: "run", args: [request] };
  }
  if (item.method === "openSource" && item.args.length === 1) {
    const args = item.args[0];
    if (!Array.isArray(args) || args.length !== 3 || typeof args[0] !== "string" || !validSourceLocation(args[0], args[1] as number, args[2] as number)) return invalid();
    return { id: item.id, method: "openSource", args };
  }
  return invalid();
}

async function dispatchRequest(controller: CreatorController, request: BridgeRequest): Promise<PlatformResult<void>> {
  if (request.method === "invalid") return platformError("invalid-request", "The saved-tests request was invalid.");
  if (request.method === "run") return await controller.run(request.args[0] as { seed: number; name: string });
  return await controller.openSource(request.args[0] as string, request.args[1] as number, request.args[2] as number);
}


function serializeState(state: CreatorTestsState): CreatorTestsState | { readonly phase: CreatorTestsState["phase"]; readonly report: CreatorTestsState["report"]; readonly message: CreatorTestsState["message"]; readonly frame: null | { readonly tick: number; readonly width: number; readonly height: number; readonly rgba: number[] } } {
  const frame: CreatorTestsFrame | null = state.frame;
  return { ...state, frame: frame === null ? null : { ...frame, rgba: Array.from(frame.rgba) } };
}

function creatorTestsHtml(webview: vscode.Webview, bundle: string, style: string, nonce: string): string {
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${style}"><title>${TITLE}</title></head><body><div id="root" data-bridge-nonce="${nonce}"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}
