import * as vscode from "vscode";
import {
  addShowMessage,
  deleteShowMessage,
  editShowMessage,
  projectVisualProgram,
} from "@tk-reawakened/editor-model";
import { VISUAL_EVENT_COMMANDS, type VisualEventAction } from "@tk-reawakened/editor-ui";

interface PaneState {
  readonly panel: vscode.WebviewPanel;
  readonly uri: vscode.Uri;
  readonly sourceColumn: vscode.ViewColumn | undefined;
  readonly disposables: vscode.Disposable[];
  ready: boolean;
  error: string | null;
}

interface PaneActionMessage {
  readonly type: "action";
  readonly source: string;
  readonly version: number;
  readonly action: VisualEventAction;
}

const panels = new Map<string, PaneState>();
// The queue belongs to the source URI, not its pane: closing a pane must not release an in-flight edit.
const pendingActions = new Map<string, Promise<void>>();

async function applyActionSerially(state: PaneState, message: PaneActionMessage): Promise<void> {
  const documentKey = key(state.uri);
  const document = vscode.workspace.textDocuments.find((candidate) => key(candidate.uri) === documentKey);
  if (document === undefined) {
    report(state, "The source document is no longer open. Reopen it before editing visual events.");
    return;
  }
  const previous = pendingActions.get(documentKey);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pendingActions.set(documentKey, current);
  if (previous !== undefined) await previous;
  try {
    if (panels.get(documentKey) !== state) return;
    // VS Code may reuse the same URI, version number and text for a reopened TextDocument.
    if (!vscode.workspace.textDocuments.includes(document)) {
      report(state, "The source document was reopened. The queued visual action was not applied.");
      return;
    }
    await applyAction(state, document, message);
  } finally {
    release();
    if (pendingActions.get(documentKey) === current) pendingActions.delete(documentKey);
  }
}

function key(uri: vscode.Uri): string {
  return uri.toString();
}

function isProgramDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
  return document !== undefined && !document.isUntitled && /\.prg$/i.test(document.uri.path);
}

function programDocument(editor: vscode.TextEditor | undefined): vscode.TextDocument | undefined {
  return isProgramDocument(editor?.document) ? editor.document : undefined;
}

function normalizedSource(document: vscode.TextDocument): string {
  return document.getText().replace(/\r\n?/g, "\n");
}

/** Resolve shared LF-only UTF-16 offsets to VS Code's line/column coordinates. */
function positionAtSourceOffset(source: string, offset: number): vscode.Position {
  let line = 0;
  let character = 0;
  for (let index = 0; index < offset && index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      character = 0;
    } else {
      character += 1;
    }
  }
  return new vscode.Position(line, character);
}

function snapshot(state: PaneState, document: vscode.TextDocument): void {
  if (!state.ready) return;
  const source = normalizedSource(document);
  const compiled = source.includes("\0");
  void state.panel.webview.postMessage({
    type: "snapshot",
    source,
    version: document.version,
    readOnly: compiled,
    error: state.error,
  });
}

function report(state: PaneState, message: string): void {
  state.error = message;
  void state.panel.webview.postMessage({ type: "error", message });
}

async function applyAction(state: PaneState, document: vscode.TextDocument, message: PaneActionMessage): Promise<void> {
  const source = normalizedSource(document);
  if (document.version !== message.version || source !== message.source) {
    report(state, "The source changed. The visual event was not applied; review the updated source and try again.");
    snapshot(state, document);
    return;
  }
  const compiled = source.includes("\0");
  const projection = projectVisualProgram(source, compiled);
  if (projection.compiled) {
    report(state, "Compiled programs are read-only.");
    return;
  }
  let result;
  switch (message.action.type) {
    case "add": result = addShowMessage(projection, message.action.message); break;
    case "message": result = editShowMessage(projection, message.action.from, message.action.message); break;
    case "delete": result = deleteShowMessage(projection, message.action.from); break;
    case "open": {
      const from = message.action.from;
      if (!projection.regions.some((region) => region.from === from && region.type === "opaque")) return;
      const sourceEditor = vscode.window.visibleTextEditors.find((candidate) => key(candidate.document.uri) === key(state.uri));
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
        viewColumn: sourceEditor?.viewColumn ?? state.sourceColumn ?? vscode.ViewColumn.One,
      });
      if (document.version === message.version) {
        const position = positionAtSourceOffset(source, from);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      return;
    }
  }
  if (!result.ok) {
    report(state, result.reason);
    return;
  }
  const { from, to, text } = result.edit;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(state.uri, new vscode.Range(positionAtSourceOffset(source, from), positionAtSourceOffset(source, to)), text);
  if (!await vscode.workspace.applyEdit(edit)) {
    report(state, "VS Code could not apply the visual event edit.");
    snapshot(state, document);
    return;
  }
  state.error = null;
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "visual-events-webview.js"));
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Visual events</title></head><body><main id="root" aria-label="Visual events"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

/** Register the source-backed native Visual events pane and its navigation/edit commands. */
export function registerVisualEvents(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const state = panels.get(key(event.document.uri));
    if (state !== undefined) snapshot(state, event.document);
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const state = panels.get(key(document.uri));
    if (state !== undefined) report(state, "The source document is closed. Reopen it to continue editing visual events.");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("tkr.visualEvents.show", async () => {
    const document = programDocument(vscode.window.activeTextEditor);
    if (document === undefined) {
      void vscode.window.showWarningMessage("Open a .prg program in the native text editor before showing Visual events.");
      return;
    }
    const documentKey = key(document.uri);
    const existing = panels.get(documentKey);
    if (existing !== undefined) {
      existing.panel.reveal(vscode.ViewColumn.Beside, false);
      snapshot(existing, document);
      return;
    }
    const panel = vscode.window.createWebviewPanel("tkr.visualEvents", "Visual events", vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      retainContextWhenHidden: true,
    });
    const state: PaneState = { panel, uri: document.uri, sourceColumn: vscode.window.activeTextEditor?.viewColumn, disposables: [], ready: false, error: null };
    panels.set(documentKey, state);
    panel.webview.html = html(panel.webview, context);
    state.disposables.push(panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) return;
      if (message.type === "ready") {
        state.ready = true;
        const current = vscode.workspace.textDocuments.find((item) => key(item.uri) === documentKey);
        if (current === undefined) report(state, "The source document is no longer open.");
        else snapshot(state, current);
      } else if (message.type === "action" && isPaneActionMessage(message)) {
        await vscode.commands.executeCommand(VISUAL_EVENT_COMMANDS[message.action.type], state.uri, message);
      }
    }));
    state.disposables.push(panel.onDidDispose(() => {
      for (const disposable of state.disposables) disposable.dispose();
      panels.delete(documentKey);
    }));
  }));
  for (const [type, command] of Object.entries(VISUAL_EVENT_COMMANDS)) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async (uri: unknown, message: unknown) => {
      if (!(uri instanceof vscode.Uri) || !isPaneActionMessage(message) || message.action.type !== type) return;
      const state = panels.get(key(uri));
      if (state === undefined) return;
      await applyActionSerially(state, message);
      if (panels.get(key(uri)) !== state) return;
      const document = vscode.workspace.textDocuments.find((item) => key(item.uri) === key(state.uri));
      if (document !== undefined) snapshot(state, document);
    }));
  }
}

function isPaneActionMessage(value: unknown): value is PaneActionMessage {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "action"
    || !("source" in value) || typeof value.source !== "string" || !("version" in value) || !Number.isInteger(value.version)
    || !("action" in value) || !isVisualAction(value.action)) return false;
  return true;
}

function isVisualAction(value: unknown): value is VisualEventAction {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const action = value as { readonly type?: unknown; readonly from?: unknown; readonly message?: unknown };
  if (action.type === "add") return typeof action.message === "string";
  if (action.type === "message") return Number.isInteger(action.from) && typeof action.message === "string";
  if (action.type === "delete" || action.type === "open") return Number.isInteger(action.from);
  return false;
}
