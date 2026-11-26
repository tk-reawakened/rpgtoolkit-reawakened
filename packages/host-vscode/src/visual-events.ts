import * as vscode from "vscode";
import {
  applyVisualEventAction,
  ASSET_FOLDERS,
  projectVisualProgram,
  type AssetKind,
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
  if (message.action.type === "open") {
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
  const result = applyVisualEventAction(projection, message.action);
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
  const styles = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "visual-events.css"));
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${styles}"><title>Visual events</title></head><body><main id="root" aria-label="Visual events"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
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
        await vscode.commands.executeCommand(commandForAction(message.action), state.uri, message);
      } else if (message.type === "pick-asset" && isPickAssetMessage(message)) {
        let reference: string | null = null;
        try {
          reference = await pickAsset(message.request, state.uri);
        } catch (error) {
          report(state, `The project's files could not be read for this field: ${error instanceof Error ? error.message : String(error)}`);
        }
        // The webview waits for this reply, so it is sent for a refusal and a failure alike.
        void state.panel.webview.postMessage({ type: "asset-picked", id: message.id, reference });
      }
    }));
    state.disposables.push(panel.onDidDispose(() => {
      for (const disposable of state.disposables) disposable.dispose();
      panels.delete(documentKey);
    }));
  }));
  for (const command of new Set(Object.values(VISUAL_EVENT_COMMANDS))) {
    context.subscriptions.push(vscode.commands.registerCommand(command, async (uri: unknown, message: unknown) => {
      if (!(uri instanceof vscode.Uri) || !isPaneActionMessage(message) || commandForAction(message.action) !== command) return;
      const state = panels.get(key(uri));
      if (state === undefined) return;
      await applyActionSerially(state, message);
      if (panels.get(key(uri)) !== state) return;
      const document = vscode.workspace.textDocuments.find((item) => key(item.uri) === key(state.uri));
      if (document !== undefined) snapshot(state, document);
    }));
  }
}

/** The one registered action an action runs: a nudge names its direction, every other action its own command. */
function commandForAction(action: VisualEventAction): string {
  if (action.type !== "nudge") return VISUAL_EVENT_COMMANDS[action.type];
  if (action.dx < 0) return VISUAL_EVENT_COMMANDS.nudgeLeft;
  if (action.dx > 0) return VISUAL_EVENT_COMMANDS.nudgeRight;
  return action.dy < 0 ? VISUAL_EVENT_COMMANDS.nudgeUp : VISUAL_EVENT_COMMANDS.nudgeDown;
}

function isPaneActionMessage(value: unknown): value is PaneActionMessage {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "action"
    || !("source" in value) || typeof value.source !== "string" || !("version" in value) || !Number.isInteger(value.version)
    || !("action" in value) || !isVisualAction(value.action)) return false;
  return true;
}

interface PickAssetMessage {
  readonly type: "pick-asset";
  readonly id: number;
  readonly request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string };
}

function isPickAssetMessage(value: unknown): value is PickAssetMessage {
  if (typeof value !== "object" || value === null || !("id" in value) || !Number.isInteger(value.id) || !("request" in value)) return false;
  const request = value.request as { readonly kind?: unknown; readonly extensions?: unknown; readonly field?: unknown } | null;
  return typeof request === "object" && request !== null && typeof request.kind === "string" && Object.hasOwn(ASSET_FOLDERS, request.kind)
    && Array.isArray(request.extensions) && request.extensions.every((item) => typeof item === "string") && typeof request.field === "string";
}

/**
 * Choose a project file for a typed asset field. The reference is the path inside the type folder, written with the
 * legacy `\` separator (T-05), so the saved program links the way every other editor writes it. Files are read with
 * `workspace.fs`, which every host provides; a host without a file search still offers its own project's files.
 */
async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.readDirectory(uri);
    return true;
  } catch {
    return false;
  }
}

/** The document's owning game folder: its nearest ancestor that holds this asset type's folder. */
async function owningFolder(uri: vscode.Uri, folder: string): Promise<vscode.Uri | null> {
  const segments = uri.path.split("/").filter((segment) => segment !== "");
  for (let up = segments.length - 1; up >= 0; up -= 1) {
    const ancestor = uri.with({ path: `/${segments.slice(0, up).join("/")}` });
    const candidate = vscode.Uri.joinPath(ancestor, folder);
    if (await isDirectory(candidate)) return candidate;
  }
  return null;
}

async function pickAsset(request: PickAssetMessage["request"], document: vscode.Uri): Promise<string | null> {
  const folder = ASSET_FOLDERS[request.kind].toLowerCase();
  const wanted = new Set(request.extensions.map((extension) => extension.toLowerCase()));
  const choices: { readonly label: string; readonly reference: string }[] = [];
  const visit = async (uri: vscode.Uri, depth: number): Promise<void> => {
    if (depth > 8 || choices.length >= 4000) return;
    let entries: readonly [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(uri);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      if (choices.length >= 4000) return;
      const child = vscode.Uri.joinPath(uri, name);
      if (type === vscode.FileType.Directory) {
        if (name !== "node_modules" && !name.startsWith(".")) await visit(child, depth + 1);
        continue;
      }
      const leaf = name.toLowerCase();
      const dot = leaf.lastIndexOf(".");
      if (wanted.size > 0 && !wanted.has(dot === -1 ? "" : leaf.slice(dot))) continue;
      const at = child.path.toLowerCase().lastIndexOf(`/${folder}/`);
      if (at === -1) continue;
      const reference = child.path.slice(at + folder.length + 2).split("/").join("\\");
      if (!choices.some((choice) => choice.reference === reference)) choices.push({ label: reference, reference });
    }
  };
  // Only the owning game's folder: another game in the same workspace keeps its own assets.
  const owner = await owningFolder(document, ASSET_FOLDERS[request.kind]);
  if (owner !== null) await visit(owner, 0);
  else for (const folderUri of vscode.workspace.workspaceFolders ?? []) await visit(folderUri.uri, 0);
  choices.sort((left, right) => left.label.localeCompare(right.label));
  if (choices.length === 0) {
    void vscode.window.showWarningMessage(`No matching files were found in the project's ${folder} folder. Add one there first.`);
    return null;
  }
  const chosen = await vscode.window.showQuickPick(choices, { placeHolder: `Choose ${request.field}` });
  return chosen?.reference ?? null;
}

function isVisualAction(value: unknown): value is VisualEventAction {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const action = value as Record<string, unknown>;
  const integer = (name: string): boolean => Number.isInteger(action[name]);
  const finite = (name: string): boolean => typeof action[name] === "number" && Number.isFinite(action[name]);
  const optionalAt = action.at === undefined || Number.isInteger(action.at);
  switch (action.type) {
    case "add": return typeof action.message === "string" && optionalAt;
    case "add-template": return typeof action.templateId === "string" && optionalAt;
    case "message": return integer("from") && typeof action.message === "string";
    case "edit": return integer("from") && Array.isArray(action.values)
      && action.values.every((item) => typeof item === "string" || typeof item === "number");
    case "condition": return integer("from") && typeof action.condition === "string";
    case "delete":
    case "open": return integer("from");
    case "move": return integer("from") && typeof action.x === "number" && typeof action.y === "number";
    case "nudge": return integer("from") && finite("dx") && finite("dy");
    case "reorder": return integer("from") && (action.direction === "up" || action.direction === "down");
    default: return false;
  }
}
