import * as vscode from "vscode";
import { resolveVisualFixtureBoardCoordinates } from "@tk-reawakened/editor-ui";
import { createVscodeFileSystem } from "./filesystem.ts";

const SHOW_COMMAND = "tkr.visualFixtures.show";
const RUN_COMMAND = "tkr.visualFixtures.runSavedTests";
const TITLE = "RPG Toolkit: Visual fixtures";

function fixtureDocument(editor: vscode.TextEditor | undefined): vscode.TextDocument | null {
  const document = editor?.document;
  return document !== undefined && /\.spec\.prg$/i.test(document.uri.path) ? document : null;
}

function snapshot(document: vscode.TextDocument): Record<string, unknown> {
  return { type: "visual-fixtures:snapshot", text: document.getText(), version: document.version, readOnly: document.isClosed };
}

function html(webview: vscode.Webview, script: vscode.Uri, style: vscode.Uri, nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"><title>${TITLE}</title></head><body><main id="root"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

/** A native text-document projection for *.spec.prg; the TextDocument remains the only saved source. */
export function registerVisualFixtures(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | null = null;
  let document: vscode.TextDocument | null = null;
  const postSnapshot = (): void => {
    if (panel !== null && document !== null && !document.isClosed) void panel.webview.postMessage(snapshot(document));
  };
  const changed = vscode.workspace.onDidChangeTextDocument((event) => {
    if (document !== null && event.document.uri.toString() === document.uri.toString()) postSnapshot();
  });
  context.subscriptions.push(changed);

  context.subscriptions.push(vscode.commands.registerCommand(SHOW_COMMAND, () => {
    const active = fixtureDocument(vscode.window.activeTextEditor);
    if (active === null) {
      void vscode.window.showWarningMessage("Open a *.spec.prg file before opening Visual fixtures.");
      return;
    }
    if (panel !== null && document?.uri.toString() === active.uri.toString()) {
      document = active;
      panel.reveal(vscode.ViewColumn.Beside);
      postSnapshot();
      return;
    }
    panel?.dispose();
    document = active;
    panel = vscode.window.createWebviewPanel("tkr.visualFixtures", TITLE, vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      retainContextWhenHidden: true,
    });
    const created = panel;
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const script = created.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "visual-fixtures-webview.js"));
    const style = created.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "tileset-browser.css"));
    created.webview.onDidReceiveMessage(async (value: unknown) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const message = value as Record<string, unknown>;
      if (message.type === "visual-fixtures:ready") {
        postSnapshot();
        return;
      }
      if (message.type === "visual-fixtures:run") {
        if (typeof message.seed !== "number" || !Number.isSafeInteger(message.seed) || message.seed < 0 || message.seed > 4_294_967_295) return;
        await vscode.commands.executeCommand(RUN_COMMAND, { uri: active.uri.toString(), seed: message.seed });
        return;
      }
      if (message.type === "visual-fixtures:board-mode") {
        if (typeof message.id !== "string" || !/^board-\d+$/.test(message.id) || typeof message.path !== "string") return;
        const folder = vscode.workspace.getWorkspaceFolder(active.uri);
        const coordinates = folder === undefined ? null : await resolveVisualFixtureBoardCoordinates(createVscodeFileSystem(folder.uri), message.path);
        // A closed panel has no webview to answer; the in-flight read is dropped with it.
        if (panel === created) void created.webview.postMessage({ type: "visual-fixtures:board-mode-result", id: message.id, coordinates });
        return;
      }
      if (message.type !== "visual-fixtures:edit" || typeof message.id !== "string" || !/^fixture-\d+$/.test(message.id)
        || typeof message.version !== "number" || !Number.isInteger(message.version)
        || typeof message.from !== "number" || !Number.isInteger(message.from)
        || typeof message.to !== "number" || !Number.isInteger(message.to)
        || typeof message.text !== "string" || message.from < 0 || message.to < message.from) return;
      const reply = (ok: boolean, reason?: string): void => {
        if (panel !== created) return;
        void created.webview.postMessage({ type: "visual-fixtures:edit-result", id: message.id, ok, ...(reason === undefined ? {} : { message: reason }) });
      };
      const target = document;
      if (target === null || target.isClosed || target.uri.toString() !== active.uri.toString()) {
        reply(false, "The source document is no longer open.");
        return;
      }
      if (target.version !== message.version) {
        reply(false, "The source changed in the text editor. The fixture view has been refreshed; retry the edit.");
        postSnapshot();
        return;
      }
      if (message.to > target.getText().length) {
        reply(false, "The source range is outside the current document.");
        postSnapshot();
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(target.uri, new vscode.Range(target.positionAt(message.from), target.positionAt(message.to)), message.text);
      const applied = await vscode.workspace.applyEdit(edit);
      reply(applied, applied ? undefined : "VS Code refused the source edit.");
      postSnapshot();
    });
    // Only this panel's own disposal clears shared state: a replacement panel already owns it.
    created.onDidDispose(() => {
      if (panel !== created) return;
      panel = null;
      document = null;
    });
    created.webview.html = html(created.webview, script, style, nonce);
  }));

  context.subscriptions.push(vscode.commands.registerCommand(RUN_COMMAND, async (value?: unknown) => {
    const request = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const targetUri = typeof request.uri === "string" ? vscode.Uri.parse(request.uri) : vscode.window.activeTextEditor?.document.uri;
    const target = targetUri === undefined ? null : vscode.workspace.textDocuments.find((item) => item.uri.toString() === targetUri.toString()) ?? null;
    if (target === null || !/\.spec\.prg$/i.test(target.uri.path)) {
      void vscode.window.showWarningMessage("Open a *.spec.prg file before saving and running its tests.");
      return;
    }
    if (typeof request.seed !== "number" || !Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 4_294_967_295) {
      void vscode.window.showWarningMessage("The fixture seed must be a whole number from 0 to 4,294,967,295.");
      return;
    }
    if (!await target.save()) {
      void vscode.window.showErrorMessage("The test source was not saved; no test run was started.");
      return;
    }
    await vscode.commands.executeCommand("tkr.runSavedTests", { run: true, seed: request.seed, uri: target.uri.toString() });
  }));
}
