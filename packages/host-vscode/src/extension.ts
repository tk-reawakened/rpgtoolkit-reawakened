import * as vscode from "vscode";
import { vscodeCapabilities } from "./capabilities.ts";
import { createGameEditorProvider, type GameDocument, type GameEditEvent, type GameEditorPort } from "./custom-editor.ts";
import { createVscodeDialogs } from "./dialogs.ts";
import { createVscodeFileSystem } from "./filesystem.ts";
import { createVscodeServices } from "./services.ts";
import { registerVscodeGameRunner } from "./player.ts";
import { registerGameView } from "./game-view.ts";

/** One custom editor per registered document kind (ADR 0026 decision 7): each view type is bound to its files by the manifest. */
const VIEW_TYPES = ["tkr.gameSettings", "tkr.board"] as const;

function html(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const bundle = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'self' ${webview.cspSource} 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RPG Toolkit editor</title></head><body><div id="root"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}

export function registerGameSettings(context: vscode.ExtensionContext): void {
  let generation = 0;
  registerVscodeGameRunner(context, () => generation, (root) => createVscodeServices(root, context, () => generation).run!);
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(() => { generation += 1; }));
  registerGameView(context);
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
    executeCommand: async (command) => await vscode.commands.executeCommand(command),
    uriFor: (folder, path) => vscode.Uri.joinPath(folder.uri, ...path.split("/")),
    // `vscode.open` opens the file in the editor registered for it (a board opens in the board editor, by default).
    openEditor: async (uri) => { await vscode.commands.executeCommand("vscode.open", uri); },
    quickPick: async (items, placeholder) => (await vscode.window.showQuickPick(items.map((item) => ({ label: item.label, id: item.id, ...(item.description === undefined ? {} : { description: item.description }) })), { placeHolder: placeholder, ignoreFocusOut: true }))?.id,
  };
  const core = createGameEditorProvider(port, (event: GameEditEvent<vscode.Uri>) => {
    generation += 1;
    changes.fire(event);
  });
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
  // A hidden webview is destroyed (`retainContextWhenHidden: false`); the document lives here in the extension host, and
  // the re-created view asks for it again (ADR 0022 D3.7).
  for (const viewType of VIEW_TYPES) {
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(viewType, provider, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true }));
  }
}
