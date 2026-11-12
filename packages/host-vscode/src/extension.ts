import * as vscode from "vscode";
import { createDocumentIdentity, openMainDocument, type MainDocument, type SaveResult } from "@tk-reawakened/editor-model";
import { createVscodeFileSystem } from "./filesystem.ts";
import { handleEditorHostRequest, isEditorHostRequest } from "./document-bridge.js";
import { recoverMainDocument } from "./document-backup.ts";

const VIEW_TYPE = "tkr.gameSettings";

class GameDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  readonly model: MainDocument;
  private readonly events: vscode.EventEmitter<vscode.CustomDocumentEditEvent<GameDocument>>;
  private pendingRecoveryEditId: string | null;

  constructor(uri: vscode.Uri, model: MainDocument, events: vscode.EventEmitter<vscode.CustomDocumentEditEvent<GameDocument>>, recoveryEditId: string | null = null) {
    this.uri = uri;
    this.model = model;
    this.events = events;
    this.pendingRecoveryEditId = recoveryEditId;
  }

  didEdit(editId: string): void {
    this.events.fire({ document: this, label: "Edit game title", undo: () => { this.model.undo(editId); }, redo: () => { this.model.redo(editId); } });
  }

  publishRecoveryEdit(): void {
    const editId = this.pendingRecoveryEditId;
    if (editId === null) return;
    this.pendingRecoveryEditId = null;
    this.didEdit(editId);
  }

  dispose(): void {}
  save(): Promise<SaveResult> { return this.model.save(); }

  async saveThroughWorkbench(): Promise<SaveResult> {
    const path = this.model.identity.path;
    try {
      await vscode.commands.executeCommand("workbench.action.files.save");
    } catch (error) {
      const saveError = this.model.getSnapshot().saveError;
      return { ok: false, failure: saveError ?? {
        document: path,
        kind: "write",
        code: null,
        message: `Could not save ${path}: ${error instanceof Error ? error.message : String(error)}`,
      } };
    }

    const snapshot = this.model.getSnapshot();
    if (snapshot.saveError !== null) return { ok: false, failure: snapshot.saveError };
    if (snapshot.dirty || snapshot.saving) {
      return { ok: false, failure: {
        document: path,
        kind: "write",
        code: null,
        message: `Could not save ${path}: VS Code did not save this custom document.`,
      } };
    }
    return { ok: true };
  }
}


function html(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map((value) => value.toString(16).padStart(2, "0")).join("");
  const bundle = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"));
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; style-src 'self' ${webview.cspSource} 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Game settings</title></head><body><div id="root"></div><script nonce="${nonce}" src="${bundle}"></script></body></html>`;
}

export function registerGameSettings(context: vscode.ExtensionContext): void {
  const changes = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<GameDocument>>();
  context.subscriptions.push(changes);
  const provider: vscode.CustomEditorProvider<GameDocument> = {
    onDidChangeCustomDocument: changes.event,
    openCustomDocument: async (uri, openContext) => {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) throw new Error(`${uri.path.split("/").at(-1)} is outside the open workspace`);
      const path = uri.path.slice(folder.uri.path.replace(/\/$/, "").length + 1);
      const storage = createVscodeFileSystem(folder.uri);
      const identity = createDocumentIdentity(folder.uri.toString(), path);
      if (openContext.backupId !== undefined) {
        const recovered = recoverMainDocument(storage, identity, await vscode.workspace.fs.readFile(vscode.Uri.parse(openContext.backupId)));
        if (!recovered.ok) throw new Error(`${uri.path.split("/").at(-1)}: ${recovered.error.error.message}`);
        return new GameDocument(uri, recovered.document, changes, recovered.editId);
      }
      const opened = await openMainDocument(storage, identity);
      if (!opened.ok) throw new Error(`${uri.path.split("/").at(-1)}: ${opened.error.error.message}`);
      return new GameDocument(uri, opened.document, changes);
    },
    saveCustomDocument: async (document) => {
      const result = await document.save();
      if (!result.ok) throw new Error(result.failure.message);
    },
    saveCustomDocumentAs: async () => { throw new Error("Save As is not available for this settings tracer."); },
    revertCustomDocument: async () => { throw new Error("Revert is not available for this settings tracer."); },
    backupCustomDocument: async (document, backupContext) => {
      await vscode.workspace.fs.writeFile(backupContext.destination, document.model.serialize());
      return { id: backupContext.destination.toString(), delete: async () => { await vscode.workspace.fs.delete(backupContext.destination); } };
    },
    resolveCustomEditor: async (document, panel) => {
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] };
      const publish = () => { void panel.webview.postMessage({ type: "snapshot", snapshot: document.model.getSnapshot() }); };
      const subscription = document.model.subscribe(publish);
      const messageSubscription = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!isEditorHostRequest(message)) return;
        await handleEditorHostRequest(document, message, (reply) => panel.webview.postMessage(reply));
      });
      panel.webview.html = html(panel.webview, context);
      document.publishRecoveryEdit();
      panel.onDidDispose(() => { subscription(); messageSubscription.dispose(); });
    },
  };
  context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true }));
}


export function deactivate(): void {}
