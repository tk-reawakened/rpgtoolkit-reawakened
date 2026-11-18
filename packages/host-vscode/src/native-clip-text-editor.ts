import * as vscode from "vscode";
import { createDocumentIdentity, DEFAULT_EDITOR_PREFERENCES, nativeClipCodec, type NativeClipCommand, type NativeClipSnapshot } from "@tk-reawakened/editor-model";
import type { Capability } from "@tk-reawakened/platform-services";
import { isEditorHostRequest, type BridgedSnapshot, type BridgeMessage } from "./document-bridge.js";

interface NativeClipPanel {
  readonly panel: vscode.WebviewPanel;
  readonly disposables: vscode.Disposable[];
  initialized: boolean;
  showingInvalidSource: boolean;
}
type NativeClipApplyResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly rejection: { readonly reason: "invalid"; readonly message: string } };


const INITIAL_BROWSER_STATE = { selection: null, path: null, scrollTop: 0 } as const;

/** A native text editor adapter: the TextDocument remains the only mutable source and VS Code owns its undo history. */
export function createNativeClipTextEditorProvider(
  context: vscode.ExtensionContext,
  html: (webview: vscode.Webview, context: vscode.ExtensionContext) => string,
  capabilities: readonly Capability[],
): vscode.CustomTextEditorProvider {
  const panelsByDocument = new Map<string, Set<NativeClipPanel>>();
  const lastValidSnapshots = new Map<string, NativeClipSnapshot>();
  const queuedEdits = new Map<string, Promise<void>>();
  const unreadableBacking = new Map<string, string>();
  const encoder = new TextEncoder();

  const identityFor = (document: vscode.TextDocument) => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const rootPath = folder?.uri.path.replace(/\/+$/, "") ?? "";
    const folderPrefix = `${rootPath}/`;
    const relativePath = folder !== undefined && document.uri.path.startsWith(folderPrefix)
      ? document.uri.path.slice(folderPrefix.length)
      : folder !== undefined && document.uri.path === rootPath ? "" : document.uri.path.replace(/^\//, "");
    return createDocumentIdentity(folder?.uri.toString() ?? document.uri.scheme, relativePath);
  };
  const keyFor = (document: vscode.TextDocument) => document.uri.toString();
  const checkBacking = async (document: vscode.TextDocument): Promise<void> => {
    const key = keyFor(document);
    try {
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      unreadableBacking.delete(key);
    } catch (error) {
      unreadableBacking.set(key, error instanceof TypeError
        ? "The file contains invalid UTF-8 bytes. Open it as text and explicitly repair and save it before using the visual editor."
        : "The file could not be read to verify its UTF-8 bytes. The visual editor cannot safely edit it.");
    }
  };
  const parseSnapshot = (document: vscode.TextDocument): NativeClipSnapshot | null => {
    const identity = identityFor(document);
    const parsed = nativeClipCodec.read(encoder.encode(document.getText()), identity.path);
    if (!parsed.ok) return null;
    const clip = parsed.value.clip;
    return {
      identity,
      dirty: document.isDirty,
      readOnly: null,
      canUndo: false,
      canRedo: false,
      edits: [],
      saving: false,
      saveError: null,
      conflict: null,
      clip,
    };
  };
  const invalidReason = (document: vscode.TextDocument): string => {
    const backingProblem = unreadableBacking.get(keyFor(document));
    if (backingProblem !== undefined) return backingProblem;
    const parsed = nativeClipCodec.read(encoder.encode(document.getText()), identityFor(document).path);
    return parsed.ok ? "" : parsed.error.message;
  };
  const snapshotFor = (document: vscode.TextDocument): NativeClipSnapshot | null => {
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
      readOnly: {
        code: "no-same-version-writer",
        message: `The native clip source is invalid. The visual editor is read-only until the clip is valid. ${invalidReason(document)}`,
      },
      canUndo: false,
      canRedo: false,
      edits: [],
      saving: false,
      saveError: null,
      conflict: null,
    };
  };
  const bridgeSnapshot = (snapshot: NativeClipSnapshot): BridgedSnapshot => snapshot;
  const post = (target: NativeClipPanel, message: BridgeMessage): void => { void target.panel.webview.postMessage(message); };

  const invalidHtml = (reason: string): string => {
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invalid native clip</title></head><body><main aria-label="Native animation clip"><h1>Native animation clip</h1><p role="status">The native clip source is invalid. The visual editor is read-only until the clip is valid.</p><p>${escape(reason)}</p><p>Correct the source in the text editor. This view will recover automatically when the document becomes valid.</p></main></body></html>`;
  };

  const disposePanel = (documentKey: string, target: NativeClipPanel): void => {
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
    const key = keyFor(document);
    const snapshot = snapshotFor(document);
    const panels = panelsByDocument.get(key);
    if (panels === undefined) return;
    for (const target of panels) {
      if (snapshot === null) {
        if (!target.showingInvalidSource) {
          target.showingInvalidSource = true;
          target.panel.webview.html = invalidHtml(invalidReason(document));
        } else {
          target.panel.webview.html = invalidHtml(invalidReason(document));
        }
        target.initialized = false;
        continue;
      }
      if (target.showingInvalidSource) {
        target.showingInvalidSource = false;
        target.initialized = false;
        target.panel.webview.html = html(target.panel.webview, context);
        continue;
      }
      if (target.initialized) post(target, { type: "snapshot", snapshot: bridgeSnapshot(snapshot) });
    }
  };

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const key = keyFor(event.document);
    if (!panelsByDocument.has(key)) return;
    refreshDocument(event.document);
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (!panelsByDocument.has(keyFor(document))) return;
    void checkBacking(document).then(() => refreshDocument(document));
  }));


  const applyCommand = async (document: vscode.TextDocument, command: unknown): Promise<{ ok: true; editId: string } | { ok: false; rejection: { reason: "invalid"; message: string } }> => {
    if (!nativeClipCodec.isCommand(command)) return { ok: false, rejection: { reason: "invalid", message: "That is not an edit this native clip understands." } };
    const currentText = document.getText();
    const parsed = nativeClipCodec.read(encoder.encode(currentText), identityFor(document).path);
    if (!parsed.ok) return { ok: false, rejection: { reason: "invalid", message: "The native clip source is invalid. Correct the YAML before making a visual edit." } };
    const nextModel = nativeClipCodec.apply(parsed.value, command as NativeClipCommand);
    const nextText = nextModel.text;
    let prefix = 0;
    while (prefix < currentText.length && prefix < nextText.length && currentText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    while (suffix < currentText.length - prefix && suffix < nextText.length - prefix
      && currentText.charCodeAt(currentText.length - suffix - 1) === nextText.charCodeAt(nextText.length - suffix - 1)) suffix += 1;
    if (prefix === currentText.length && prefix === nextText.length) return { ok: false, rejection: { reason: "invalid", message: "The native clip edit made no change." } };

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(document.uri, new vscode.Range(document.positionAt(prefix), document.positionAt(currentText.length - suffix)), nextText.slice(prefix, nextText.length - suffix));
    const accepted = await vscode.workspace.applyEdit(workspaceEdit);
    if (!accepted) return { ok: false, rejection: { reason: "invalid", message: "VS Code could not apply the native clip edit." } };
    const snapshot = parseSnapshot(document);
    if (snapshot === null) return { ok: false, rejection: { reason: "invalid", message: "The edit was applied, but the native clip could not be read afterward." } };
    lastValidSnapshots.set(keyFor(document), snapshot);
    return { ok: true, editId: `native-text-${document.version}` };
  };

  const provider: vscode.CustomTextEditorProvider = {
    async resolveCustomTextEditor(document, panel, _token): Promise<void> {
      await checkBacking(document);
      const documentKey = keyFor(document);
      const firstSnapshot = snapshotFor(document);
      const target: NativeClipPanel = {
        panel,
        disposables: [],
        initialized: false,
        showingInvalidSource: firstSnapshot === null,
      };
      const panels = panelsByDocument.get(documentKey) ?? new Set<NativeClipPanel>();
      panels.add(target);
      panelsByDocument.set(documentKey, panels);

      target.disposables.push(panel.webview.onDidReceiveMessage(async (value: unknown) => {
        if (!isEditorHostRequest(value)) return;
        if (value.type === "ready") {
          target.initialized = true;
          const snapshot = snapshotFor(document);
          if (snapshot === null) {
            target.initialized = false;
            target.showingInvalidSource = true;
            panel.webview.html = invalidHtml(invalidReason(document));
            return;
          }
          post(target, {
            type: "initialize",
            kind: "native-clip",
            snapshot: bridgeSnapshot(snapshot),
            capabilities,
            browserState: INITIAL_BROWSER_STATE,
            boardPreferences: DEFAULT_EDITOR_PREFERENCES,
          });
          return;
        }
        if (value.type === "edit") {
          const existing = queuedEdits.get(documentKey) ?? Promise.resolve();
          let result: NativeClipApplyResult;
          const next = existing.then(async () => { result = await applyCommand(document, value.command); });
          queuedEdits.set(documentKey, next.catch(() => undefined));
          await next.catch(() => { result = { ok: false, rejection: { reason: "invalid", message: "The native clip edit could not be applied." } }; });
          const snapshot = snapshotFor(document);
          if (snapshot !== null) post(target, { type: "edit-result", requestId: value.requestId, result: result!, snapshot: bridgeSnapshot(snapshot) });
          return;
        }
        if (value.type === "save") {
          let saved: vscode.Uri | undefined;
          let saveError: string | null = null;
          try {
            saved = await vscode.workspace.save(document.uri);
          } catch (error) {
            saveError = error instanceof Error ? error.message : String(error);
          }
          const snapshot = snapshotFor(document);
          const result = saved === undefined
            ? { ok: false as const, failure: { document: identityFor(document).path, kind: "write" as const, code: null, message: saveError === null ? `VS Code could not save ${identityFor(document).path}.` : `VS Code could not save ${identityFor(document).path}: ${saveError}` } }
            : { ok: true as const };
          if (snapshot !== null) post(target, { type: "save-result", requestId: value.requestId, result, snapshot: bridgeSnapshot(snapshot) });
          return;
        }
      }));
      target.disposables.push(panel.onDidDispose(() => disposePanel(documentKey, target)));
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")] };
      panel.webview.html = firstSnapshot === null ? invalidHtml(invalidReason(document)) : html(panel.webview, context);
    },
  };
  return provider;
}
