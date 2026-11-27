import * as vscode from "vscode";
import { createDocumentIdentity, DEFAULT_EDITOR_PREFERENCES, kindForPath, nativeGeometryCodecs, type NativeGeometryCodec, type NativeGeometryKind, type NativeGeometrySnapshot } from "@tk-reawakened/editor-model";
import { platformError, type Capability } from "@tk-reawakened/platform-services";
import { isEditorHostRequest, type BridgeMessage } from "./document-bridge.ts";
import { createVscodeFileSystem } from "./filesystem.ts";
import { relativeToWorkspace } from "./launch-prompts.ts";
import { applyNativeTextEdit } from "./native-text-edit.ts";

interface GeometryPanel {
  readonly panel: vscode.WebviewPanel;
  readonly disposables: vscode.Disposable[];
  initialized: boolean;
  showingInvalidSource: boolean;
}
type GeometryApplyResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly rejection: { readonly reason: "invalid" | "read-only"; readonly message: string } };

const INITIAL_BROWSER_STATE = { selection: null, path: null, scrollTop: 0, autotileMarks: [] } as const;
const encoder = new TextEncoder();

/**
 * The collision and walk-behind editor of a native tile (`.tkrtle`) or pack (`.tkrpack`). The TextDocument is the only
 * mutable source and VS Code owns its undo, save and backup (ADR 0022 D2). The webview is the shared editor view; an
 * edit is a command that the same codec the browser host drives turns into a source splice, applied as one
 * WorkspaceEdit so the unchanged text, comments and plugin data stay as written.
 */
export function createNativeGeometryTextEditorProvider(
  context: vscode.ExtensionContext,
  html: (webview: vscode.Webview, context: vscode.ExtensionContext) => string,
  capabilities: readonly Capability[],
): vscode.CustomTextEditorProvider {
  const panelsByDocument = new Map<string, Set<GeometryPanel>>();
  const lastValidSnapshots = new Map<string, NativeGeometrySnapshot>();
  const queuedEdits = new Map<string, Promise<void>>();
  const unreadableBacking = new Map<string, string>();

  const keyFor = (document: vscode.TextDocument): string => document.uri.toString();
  const kindFor = (document: vscode.TextDocument): NativeGeometryKind | null => {
    const id = kindForPath(document.uri.path)?.id;
    return id === "native-tile" || id === "native-asset-pack" ? id : null;
  };
  const identityFor = (document: vscode.TextDocument) => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relative = folder === undefined ? undefined : relativeToWorkspace(folder.uri, document.uri);
    return createDocumentIdentity(folder?.uri.toString() ?? document.uri.scheme, relative ?? document.uri.path.replace(/^\//, ""));
  };
  const codecFor = (document: vscode.TextDocument): NativeGeometryCodec | null => {
    const kind = kindFor(document);
    return kind === null ? null : nativeGeometryCodecs[kind];
  };
  const checkBacking = async (document: vscode.TextDocument): Promise<void> => {
    const key = keyFor(document);
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(await vscode.workspace.fs.readFile(document.uri));
      unreadableBacking.delete(key);
    } catch (error) {
      unreadableBacking.set(key, error instanceof TypeError
        ? "The file contains invalid UTF-8 bytes. Open it as text and explicitly repair and save it before using the visual editor."
        : "The file could not be read to verify its UTF-8 bytes. The visual editor cannot safely edit it.");
    }
  };
  const parseSnapshot = (document: vscode.TextDocument): NativeGeometrySnapshot | null => {
    const codec = codecFor(document);
    if (codec === null) return null;
    const identity = identityFor(document);
    const parsed = codec.read(encoder.encode(document.getText()), identity.path);
    if (!parsed.ok) return null;
    return {
      identity, dirty: document.isDirty, readOnly: null, canUndo: false, canRedo: false, edits: [], saving: false, saveError: null, conflict: null,
      ...codec.fields(parsed.value),
    };
  };
  const invalidReason = (document: vscode.TextDocument): string => {
    const backingProblem = unreadableBacking.get(keyFor(document));
    if (backingProblem !== undefined) return backingProblem;
    const codec = codecFor(document);
    if (codec === null) return "This file is not a native tile or asset pack.";
    const parsed = codec.read(encoder.encode(document.getText()), identityFor(document).path);
    return parsed.ok ? "" : parsed.error.message;
  };
  const snapshotFor = (document: vscode.TextDocument): NativeGeometrySnapshot | null => {
    const key = keyFor(document);
    if (unreadableBacking.has(key)) return null;
    const current = parseSnapshot(document);
    if (current !== null) {
      lastValidSnapshots.set(key, current);
      return current;
    }
    const lastValid = lastValidSnapshots.get(key);
    if (lastValid === undefined) return null;
    return {
      ...lastValid,
      dirty: document.isDirty,
      readOnly: { code: "no-same-version-writer", message: `The source is invalid. The visual editor is read-only until it is valid. ${invalidReason(document)}` },
    };
  };
  const post = (target: GeometryPanel, message: BridgeMessage): void => { void target.panel.webview.postMessage(message); };
  const invalidHtml = (reason: string): string => {
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invalid native document</title></head><body><main aria-label="Collision and walk-behind"><h1>Collision and walk-behind</h1><p role="status">The source is invalid. The visual editor is read-only until it is valid.</p><p>${escape(reason)}</p><p>Correct the source in the text editor. This view recovers automatically when the document becomes valid.</p></main></body></html>`;
  };
  const disposePanel = (documentKey: string, target: GeometryPanel): void => {
    for (const disposable of target.disposables) disposable.dispose();
    const panels = panelsByDocument.get(documentKey);
    panels?.delete(target);
    if (panels?.size === 0) {
      panelsByDocument.delete(documentKey);
      lastValidSnapshots.delete(documentKey);
      unreadableBacking.delete(documentKey);
    }
  };
  const refreshDocument = (document: vscode.TextDocument): void => {
    const panels = panelsByDocument.get(keyFor(document));
    if (panels === undefined) return;
    const snapshot = snapshotFor(document);
    for (const target of panels) {
      if (snapshot === null) {
        target.showingInvalidSource = true;
        target.initialized = false;
        target.panel.webview.html = invalidHtml(invalidReason(document));
      } else if (target.showingInvalidSource) {
        target.showingInvalidSource = false;
        target.initialized = false;
        target.panel.webview.html = html(target.panel.webview, context);
      } else if (target.initialized) post(target, { type: "snapshot", snapshot });
    }
  };
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => { if (panelsByDocument.has(keyFor(event.document))) refreshDocument(event.document); }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (panelsByDocument.has(keyFor(document))) void checkBacking(document).then(() => refreshDocument(document));
  }));

  const applyCommand = async (document: vscode.TextDocument, command: unknown): Promise<GeometryApplyResult> => {
    const codec = codecFor(document);
    const invalid = (message: string): GeometryApplyResult => ({ ok: false, rejection: { reason: "invalid", message } });
    if (codec === null || !codec.isCommand(command)) return invalid("That is not an edit this native document understands.");
    const currentText = document.getText();
    const parsed = codec.read(encoder.encode(currentText), identityFor(document).path);
    if (!parsed.ok) return invalid("The source is invalid. Correct the YAML before making a visual edit.");
    const next = codec.apply(parsed.value, command);
    const rejection = codec.refuse(next, command, parsed.value);
    if (rejection !== null) return { ok: false, rejection };
    if (await applyNativeTextEdit(document, currentText, next.text) === "refused") return invalid("VS Code could not apply the edit.");
    if (parseSnapshot(document) === null) return invalid("The edit was applied, but the document could not be read afterward.");
    return { ok: true, editId: `native-text-${document.version}` };
  };

  return {
    async resolveCustomTextEditor(document, panel): Promise<void> {
      await checkBacking(document);
      const documentKey = keyFor(document);
      const firstSnapshot = snapshotFor(document);
      const target: GeometryPanel = { panel, disposables: [], initialized: false, showingInvalidSource: firstSnapshot === null };
      const panels = panelsByDocument.get(documentKey) ?? new Set<GeometryPanel>();
      panels.add(target);
      panelsByDocument.set(documentKey, panels);
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);

      target.disposables.push(panel.webview.onDidReceiveMessage(async (value: unknown) => {
        if (!isEditorHostRequest(value)) return;
        if (value.type === "ready") {
          const snapshot = snapshotFor(document);
          if (snapshot === null) {
            target.initialized = false;
            target.showingInvalidSource = true;
            panel.webview.html = invalidHtml(invalidReason(document));
            return;
          }
          target.initialized = true;
          post(target, { type: "initialize", kind: snapshot.geometry.kind === "tile" ? "native-tile" : "native-asset-pack", snapshot, capabilities, browserState: INITIAL_BROWSER_STATE, boardPreferences: DEFAULT_EDITOR_PREFERENCES });
        } else if (value.type === "edit") {
          const previous = queuedEdits.get(documentKey) ?? Promise.resolve();
          let result: GeometryApplyResult = { ok: false, rejection: { reason: "invalid", message: "The edit could not be applied." } };
          const next = previous.then(async () => { result = await applyCommand(document, value.command); });
          queuedEdits.set(documentKey, next.catch(() => undefined));
          await next.catch(() => undefined);
          const snapshot = snapshotFor(document);
          if (snapshot !== null) post(target, { type: "edit-result", requestId: value.requestId, result, snapshot });
        } else if (value.type === "save") {
          let saved: vscode.Uri | undefined;
          let saveError: string | null = null;
          try { saved = await vscode.workspace.save(document.uri); }
          catch (error) { saveError = error instanceof Error ? error.message : String(error); }
          const snapshot = snapshotFor(document);
          const path = identityFor(document).path;
          const result = saved === undefined
            ? { ok: false as const, failure: { document: path, kind: "write" as const, code: null, message: saveError === null ? `VS Code could not save ${path}.` : `VS Code could not save ${path}: ${saveError}` } }
            : { ok: true as const };
          if (snapshot !== null) post(target, { type: "save-result", requestId: value.requestId, result, snapshot });
        } else if (value.type === "browser-read") {
          // The picture behind the grid: a read-only look at one project file, never a path outside the workspace folder.
          const result = folder === undefined
            ? platformError("unavailable", "Open this file inside a workspace folder to see its picture.")
            : await createVscodeFileSystem(folder.uri).read(value.path);
          post(target, { type: "browser-read-result", requestId: value.requestId, result });
        }
      }));
      target.disposables.push(panel.onDidDispose(() => disposePanel(documentKey, target)));
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] };
      panel.webview.html = firstSnapshot === null ? invalidHtml(invalidReason(document)) : html(panel.webview, context);
    },
  };
}
