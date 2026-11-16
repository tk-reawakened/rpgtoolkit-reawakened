import * as vscode from "vscode";
import { createBrowserSession } from "@tk-reawakened/editor-ui/browser-session";
import { vscodeCapabilities } from "./capabilities.ts";
import { createGameEditorProvider, type GameDocument, type GameEditEvent, type GameEditorPort } from "./custom-editor.ts";
import { createVscodeDialogs } from "./dialogs.ts";
import { createVscodeFileSystem } from "./filesystem.ts";
import { createVscodeServices } from "./services.ts";
import { registerVscodeGameRunner } from "./player.ts";
import { registerGameView } from "./game-view.ts";
import { runNewBoard, type NewBoardUi } from "./new-board.ts";
import { runNewProject, type NewProjectUi } from "./new-project.ts";
import { createDocumentIdentity, DEFAULT_EDITOR_PREFERENCES } from "@tk-reawakened/editor-model";

import { registerPackageGameCommand } from "./package-game-command.ts";
import { runHistoryCommand } from "./history-command.ts";
import { createProjectWizardHistory, historyPolicyFrom, previewBoard, previewTileBitmap, type BoardPreviewRequest } from "@tk-reawakened/editor-model";
import { handleHistoryPreviewRequest } from "./document-bridge.ts";
/** One custom editor per registered document kind (ADR 0026 decision 7): each view type is bound to its files by the manifest. */
const VIEW_TYPES = ["tkr.gameSettings", "tkr.board", "tkr.tileset", "tkr.tileBitmap"] as const;

/** A custom editor is active in the workbench without a TextEditor; its tab input still carries the project URI. */
function activeCustomEditorUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

const historyPreviewOrigins = new Map<vscode.WebviewPanel, vscode.Uri>();
let activeHistoryPreviewPanel: vscode.WebviewPanel | undefined;

function trackHistoryPreview(panel: vscode.WebviewPanel, origin: vscode.Uri): void {
  historyPreviewOrigins.set(panel, origin);
  activeHistoryPreviewPanel = panel;
  panel.onDidChangeViewState(({ webviewPanel }) => {
    if (webviewPanel.active) activeHistoryPreviewPanel = webviewPanel;
    else if (activeHistoryPreviewPanel === webviewPanel) activeHistoryPreviewPanel = undefined;
  });
  panel.onDidDispose(() => {
    historyPreviewOrigins.delete(panel);
    if (activeHistoryPreviewPanel === panel) activeHistoryPreviewPanel = undefined;
  });
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const bundle = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  const stylesheet = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "tileset-browser.css"));
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'self' ${webview.cspSource} 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${stylesheet}"><title>RPG Toolkit editor</title></head><body><div id="root"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}



/** Registers the editors and the run commands; returns the count of document changes, which the other commands compare across a save. */
export function registerGameSettings(context: vscode.ExtensionContext): () => number {
  let generation = 0;
  registerVscodeGameRunner(context, () => generation, (root) => createVscodeServices(root, context, () => generation).run!);
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => { generation += 1; }));
  registerGameView(context);
  registerPackageGameCommand(context);
  const changes = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<GameDocument<vscode.Uri>>>();
  context.subscriptions.push(changes);
  const port: GameEditorPort<vscode.Uri> = {
    capabilities: vscodeCapabilities(vscode.env.uiKind === vscode.UIKind.Desktop),
    dialogs: (folder) => createVscodeDialogs(folder.uri),
    folderOf: (uri) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      return folder === undefined ? undefined : { uri: folder.uri, key: folder.uri.toString() };
    },
    fileSystem: (folder) => createVscodeFileSystem(folder.uri),
    readBackup: async (id) => await vscode.workspace.fs.readFile(vscode.Uri.parse(id)),
    writeBackup: async (destination, bytes) => {
      await vscode.workspace.fs.writeFile(destination, bytes);
      return destination.toString();
    },
    deleteBackup: async (destination) => { await vscode.workspace.fs.delete(destination); },
    saveEditor: async (uri) => await vscode.workspace.save(uri),
    autoSaveDelayMs: (uri) => {
      const files = vscode.workspace.getConfiguration("files", uri);
      return files.get<string>("autoSave") === "afterDelay" ? files.get<number>("autoSaveDelay", 1000) : null;
    },
    // History retention is user-only (ADR 0022 D6.3): the user's value, never a workspace's.
    historyPolicy: (folder) => historyPolicyFrom((id) => {
      const inspected = vscode.workspace.getConfiguration("rpgToolkit", folder.uri).inspect<number>(id);
      return inspected?.globalValue ?? inspected?.defaultValue;
    }),
    uriFor: (folder, path) => vscode.Uri.joinPath(folder.uri, ...path.split("/")),
    // `vscode.open` opens the file in the editor registered for it (a board opens in the board editor, by default).
    openEditor: async (uri) => { await vscode.commands.executeCommand("vscode.open", uri); },
    boardPreferences: (folder) => {
      const settings = vscode.workspace.getConfiguration("rpgToolkit", folder.uri);
      return {
        revertToDrawAfterFlood: settings.get<boolean>("board.revertToDrawAfterFlood", DEFAULT_EDITOR_PREFERENCES.revertToDrawAfterFlood),
        recursiveFlood: settings.get<boolean>("board.recursiveFlood", DEFAULT_EDITOR_PREFERENCES.recursiveFlood),
      };
    },
    watchBoardPreferences: (folder, listener) => vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("rpgToolkit.board", folder.uri)) listener();
    }),
    quickPick: async (items, placeholder) => (await vscode.window.showQuickPick(items.map((item) => ({ label: item.label, id: item.id, ...(item.description === undefined ? {} : { description: item.description }) })), { placeHolder: placeholder, ignoreFocusOut: true }))?.id,
  };
  const core = createGameEditorProvider(port, (event: GameEditEvent<vscode.Uri>) => {
    generation += 1;
    changes.fire(event);
  });
  // The History command (#2833): the shared workspace does the work; VS Code only picks and reports.
  context.subscriptions.push(vscode.commands.registerCommand("tkr.history", async () => {
    const activeTextEditorUri = vscode.window.activeTextEditor?.document.uri;
    const activeCustomUri = activeCustomEditorUri();
    const activeHistoryOrigin = activeHistoryPreviewPanel === undefined ? undefined : historyPreviewOrigins.get(activeHistoryPreviewPanel);
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const activeTabUri = activeTab?.input instanceof vscode.TabInputCustom ? activeTab.input.uri : undefined;
    console.error("[history-preview-trace] command-context", {
      textEditorUri: activeTextEditorUri?.toString() ?? null,
      customEditorUri: activeCustomUri?.toString() ?? null,
      activeTabLabel: activeTab?.label ?? null,
      activeTabUri: activeTabUri?.toString() ?? null,
      historyOrigin: activeHistoryOrigin?.toString() ?? null,
    });
    const candidate = activeTextEditorUri
      ?? activeCustomUri
      ?? activeHistoryOrigin;
    const folder = candidate === undefined ? (vscode.workspace.workspaceFolders ?? [])[0] : vscode.workspace.getWorkspaceFolder(candidate);
    if (folder === undefined) {
      await vscode.window.showErrorMessage("Open a project folder first: history is kept in the project's .tkr-history folder.");
      return;
    }
    const { workspace } = core.workspaceFor({ uri: folder.uri, key: folder.uri.toString() });
    const active = candidate === undefined ? null : candidate.path.slice(folder.uri.path.replace(/\/$/, "").length + 1);
    await runHistoryCommand(workspace, active, {
      pick: async (items, placeholder) => (await vscode.window.showQuickPick(items.map((item) => ({ label: item.label, description: item.description, id: item.id })), { placeHolder: placeholder, ignoreFocusOut: true }))?.id,
      tell: async (message) => { await vscode.window.showInformationMessage(message); },
      showPreview: async (path, bytes, description) => {
        const preview = workspace.openHistoryPreview(path, bytes, description);
        if (!preview.ok) {
          await vscode.window.showWarningMessage(preview.message);
          return false;
        }
        const panel = vscode.window.createWebviewPanel("tkr.historyPreview", `History preview: ${path}`, vscode.ViewColumn.Beside, {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
        });
        const origin = candidate ?? vscode.Uri.joinPath(folder.uri, ...path.split("/"));
        console.error("[history-preview-trace] source-identity", {
          workspaceRoot: folder.uri.toString(),
          origin: origin.toString(),
          path,
          projectId: preview.document.identity.projectId,
          documentPath: preview.document.identity.path,
        });
        trackHistoryPreview(panel, origin);
        const browserSession = createBrowserSession();
        const readOnlyFs = createVscodeFileSystem(folder.uri);
        const projectId = preview.document.identity.projectId;
        const readOnlyPreview = {
          model: preview.document,
          path,
          browserSession,
          browserList: (relativePath: string) => readOnlyFs.list(relativePath),
          browserRead: (relativePath: string) => readOnlyFs.read(relativePath),
          readProject: (relativePath: string) => readOnlyFs.readProject(projectId, relativePath),
          preview: async (request?: BoardPreviewRequest) => {
            if (preview.document.kind === "board") {
              const started = Date.now();
              console.error("[history-preview-trace] composer-enter", { path, projectId });
              const picture = await previewBoard(readOnlyFs, projectId, preview.document.serialize(), request);
              console.error("[history-preview-trace] composer-resolved", { path, projectId, ok: picture.ok, elapsedMs: Date.now() - started, ...(picture.ok ? { width: picture.width, height: picture.height } : {}) });
              return picture.ok ? { ok: true as const, width: picture.width, height: picture.height, rgba: picture.rgba, warnings: picture.warnings } : picture;
            }
            if (preview.document.kind === "tile-bitmap") return previewTileBitmap(readOnlyFs, projectId, preview.document.serialize());
            return { ok: false as const, message: `A ${preview.document.kind} history version has no picture.` };
          },
        };
        const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
          const request = typeof message === "object" && message !== null ? message as { readonly type?: unknown; readonly requestId?: unknown } : {};
          console.error("[history-preview-trace] host-receive", {
            type: typeof request.type === "string" ? request.type : "invalid",
            requestId: typeof request.requestId === "string" ? request.requestId : null,
          });
          void handleHistoryPreviewRequest(readOnlyPreview, message, (reply) => panel.webview.postMessage(reply));
        });
        panel.onDidDispose(() => listener.dispose());
        panel.webview.html = html(panel.webview, context);
        return true;
      },
    });
  }));
  const provider: vscode.CustomEditorProvider<GameDocument<vscode.Uri>> = {
    onDidChangeCustomDocument: changes.event,
    openCustomDocument: (uri, openContext) => core.openCustomDocument(uri, openContext.backupId),
    saveCustomDocument: (document) => core.saveCustomDocument(document),
    saveCustomDocumentAs: (document, destination) => core.saveCustomDocumentAs(document, destination),
    revertCustomDocument: (document) => core.revertCustomDocument(document),
    backupCustomDocument: (document, backupContext) => core.backupCustomDocument(document, backupContext.destination),
    resolveCustomEditor: async (document, panel) => {
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] };
      core.resolveCustomEditor(document, {
        postMessage: (message) => panel.webview.postMessage(message),
        onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage(listener),
        onDidDispose: (listener) => panel.onDidDispose(listener),
      });
      panel.webview.html = html(panel.webview, context);
    },
  };
  // Keep custom-editor pages alive while their tabs are hidden. Accepted view-side edits can still be queued behind
  // an acknowledgement; the extension host's Save All, backup and revert requests must reach that live queue.
  for (const viewType of VIEW_TYPES) {
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  }
  return () => generation;
}

/** The new-board command (T-20): the questions are VS Code's own input boxes and pick lists, one after another. */
export function registerNewBoard(context: vscode.ExtensionContext, generation: () => number): void {
  const ui: NewBoardUi = {
    input: (question) => Promise.resolve(vscode.window.showInputBox({
      title: question.title,
      prompt: question.prompt,
      value: question.value,
      ignoreFocusOut: true,
      validateInput: (value) => question.validate(value) ?? undefined,
    })),
    pick: async (question) => (await vscode.window.showQuickPick(
      question.items.map((item) => ({ label: item.label, id: item.id, ...(item.description === undefined ? {} : { description: item.description }) })),
      { title: question.title, ignoreFocusOut: true },
    ))?.id,
  };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.newBoard", async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await vscode.window.showErrorMessage("Open a project folder first: a new board is made in the project's Boards folder.");
      return;
    }
    // One workspace folder is one project (ADR 0022 D1.1); a multi-root workspace asks which.
    const folder = folders.length === 1 ? folders[0]! : await pickFolder(folders);
    if (folder === undefined) return;
    const services = createVscodeServices(folder.uri, context, generation);
    const outcome = await runNewBoard({ fs: services.fs, layout: { projectFolder: "" }, settings: services.settings, ui, history: createProjectWizardHistory(services.fs) });
    if (!outcome.ok) {
      if (outcome.reason === "refused") await vscode.window.showErrorMessage(outcome.message);
      return;
    }
    if (outcome.warning !== null) void vscode.window.showWarningMessage(outcome.warning);
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.joinPath(folder.uri, ...outcome.path.split("/")));
  }));
}

async function pickFolder(folders: readonly vscode.WorkspaceFolder[]): Promise<vscode.WorkspaceFolder | undefined> {
  const chosen = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, folder })), { title: "New board: project", ignoreFocusOut: true });
  return chosen?.folder;
}

/** The main file a new project asked to open before VS Code restarted its extension host into the new folder. */
const PENDING_OPEN = "tkr.pendingOpenAfterNewProject";
interface PendingOpen {
  readonly folder: string;
  readonly main: string;
}

/**
 * The new-project command (T-04): the questions are VS Code's own input boxes and pick lists, then the folder dialog. The
 * created folder is opened as a workspace folder (the custom editors work on files inside one) and its main file in the
 * editor. Opening a folder into an empty window, or converting a single-folder window into a workspace, restarts the
 * extension host; those cases leave the main file to be opened by the next activation.
 */
export function registerNewProject(context: vscode.ExtensionContext): void {
  const ui: NewProjectUi = {
    input: (question) => Promise.resolve(vscode.window.showInputBox({
      title: question.title,
      prompt: question.prompt,
      value: question.value,
      ignoreFocusOut: true,
      validateInput: (value) => question.validate(value) ?? undefined,
    })),
    pickMany: async (question) => {
      const rows = question.items.map((item) => ({ label: item.label, description: item.description, detail: item.detail, id: item.id, picked: false }));
      return (await vscode.window.showQuickPick(rows, { title: question.title, canPickMany: true, ignoreFocusOut: true }))?.map((row) => row.id);
    },
  };
  context.subscriptions.push(vscode.commands.registerCommand("tkr.newProject", async () => {
    const outcome = await runNewProject<vscode.Uri>({
      ui,
      chooseDestination: async () => {
        const chosen = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: "New project: choose the destination folder",
          openLabel: "Create project here",
        });
        const selected = chosen?.[0];
        const uri = selected === undefined ? undefined : vscode.Uri.joinPath(selected, ".");
        if (uri === undefined) return undefined;
        const storage = createVscodeFileSystem(uri);
        return { handle: uri, storage, history: createProjectWizardHistory(storage) };
      },
    });
    if (!outcome.ok) {
      if (outcome.reason === "refused") await vscode.window.showErrorMessage(outcome.message);
      return;
    }
    await openCreatedProject(context, outcome.handle, outcome.mainPath);
  }));
  resumePendingOpen(context);
}

async function openCreatedProject(context: vscode.ExtensionContext, destination: vscode.Uri, mainPath: string): Promise<void> {
  const main = vscode.Uri.joinPath(destination, ...mainPath.split("/"));
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.some((folder) => folder.uri.toString() === destination.toString())) {
    await vscode.commands.executeCommand("vscode.open", main);
    return;
  }
  const pending: PendingOpen = { folder: destination.toString(), main: main.toString() };
  await context.globalState.update(PENDING_OPEN, pending);
  if (folders.length === 0) {
    try {
      await vscode.commands.executeCommand("vscode.openFolder", destination);
    } catch (error) {
      await context.globalState.update(PENDING_OPEN, undefined);
      throw error;
    }
    return;
  }
  // A folder-window conversion can emit a folder event before it restarts: only the next host may consume the request.
  const restarting = folders.length === 1 && vscode.workspace.workspaceFile === undefined;
  let listener: vscode.Disposable | undefined;
  const added = restarting ? undefined : new Promise<void>((resolve) => {
    listener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!(vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.toString() === pending.folder)) return;
      listener?.dispose();
      resolve();
    });
    context.subscriptions.push(listener);
  });
  if (!vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: destination })) {
    listener?.dispose();
    await context.globalState.update(PENDING_OPEN, undefined);
    await vscode.window.showErrorMessage(`The project was created in ${destination.fsPath}, but VS Code could not add it to the workspace. Open the folder to edit it.`);
    return;
  }
  if (added === undefined) return;
  await added;
  await context.globalState.update(PENDING_OPEN, undefined);
  await vscode.commands.executeCommand("vscode.open", main);
}

/** Open the main file a new project asked for before the extension host restarted, once, and only if its folder is what opened. */
function resumePendingOpen(context: vscode.ExtensionContext): void {
  const pending = context.globalState.get<PendingOpen>(PENDING_OPEN);
  if (pending === undefined) return;
  if (!(vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.toString() === pending.folder)) return;
  void context.globalState.update(PENDING_OPEN, undefined);
  void vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(pending.main));
}
