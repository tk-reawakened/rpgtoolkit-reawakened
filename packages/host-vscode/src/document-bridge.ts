import { ASSET_FOLDERS, kindById, type AnyDocument, type AssetKind, type ApplyResult, type BoardPicture, type ConflictChoice, type ConflictResult, type DocumentSnapshot, type PickOutcome, type SaveResult } from "@tk-reawakened/editor-model";
import type { Capability, DirectoryEntry, PlatformResult } from "@tk-reawakened/platform-services";
import { createBrowserSession, type BrowserSession, type BrowserState, type BrowserStatePatch } from "@tk-reawakened/editor-ui/browser-session";

/** What a view asks to choose: an asset of `kind` for a field, accepting `extensions` (lower-case with the dot; empty accepts any). */
export interface AssetPickRequest {
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
  /** What the field is called, in words for the confirmation. */
  readonly field: string;
}

/** The result of following a link to another document. */
export type VisitOutcome = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };
/** The result of going back from a visit; `message` says when the origin had to be opened again. */
export type ReturnOutcome = { readonly ok: true; readonly path: string; readonly message: string | null } | { readonly ok: false; readonly message: string };

/** A snapshot as it crosses the bridge: plain data, whatever the kind (the kind says which fields it has). */
export type BridgedSnapshot = DocumentSnapshot<unknown>;

export type BridgeMessage =
  | { readonly type: "initialize"; readonly kind: string; readonly snapshot: BridgedSnapshot; readonly capabilities: readonly Capability[]; readonly browserState: BrowserState }
  | { readonly type: "snapshot"; readonly snapshot: BridgedSnapshot }
  | { readonly type: "browser-state"; readonly changes: BrowserStatePatch }
  | { readonly type: "edit-result"; readonly requestId: string; readonly result: ApplyResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "save-result"; readonly requestId: string; readonly result: SaveResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "conflict-result"; readonly requestId: string; readonly result: ConflictResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "preview-result"; readonly requestId: string; readonly picture: BoardPicture }
  | { readonly type: "visit-result"; readonly requestId: string; readonly outcome: VisitOutcome }
  | { readonly type: "return-result"; readonly requestId: string; readonly outcome: ReturnOutcome }
  | { readonly type: "pick-result"; readonly requestId: string; readonly outcome: PickOutcome }
  | { readonly type: "browser-list-result"; readonly requestId: string; readonly result: PlatformResult<readonly DirectoryEntry[]> }
  | { readonly type: "browser-read-result"; readonly requestId: string; readonly result: PlatformResult<Uint8Array> };

export type EditorHostRequest =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly command: unknown; readonly requestId: string }
  | { readonly type: "save"; readonly requestId: string }
  | { readonly type: "resolve-conflict"; readonly choice: ConflictChoice; readonly requestId: string }
  | { readonly type: "preview"; readonly requestId: string }
  | { readonly type: "visit"; readonly requestId: string; readonly path: string }
  | { readonly type: "return-visit"; readonly requestId: string }
  | { readonly type: "pick-asset"; readonly requestId: string; readonly request: AssetPickRequest }
  | { readonly type: "browser-context"; readonly changes: BrowserStatePatch }
  | { readonly type: "browser-list"; readonly requestId: string; readonly path: string }
  | { readonly type: "browser-read"; readonly requestId: string; readonly path: string };

export type VscodeApi = { postMessage(message: EditorHostRequest): void; getState(): unknown; setState(state: unknown): void };

/** What the bridge needs from the extension host's side of one custom document. */
export interface BridgedDocument {
  readonly model: AnyDocument;
  readonly capabilities: readonly Capability[];
  readonly browserSession: BrowserSession;
  browserList(path: string): Promise<PlatformResult<readonly DirectoryEntry[]>>;
  browserRead(path: string): Promise<PlatformResult<Uint8Array>>;
  didEdit(editId: string): void;
  saveThroughWorkbench(): Promise<SaveResult>;
  resolveConflict(choice: ConflictChoice): Promise<ConflictResult>;
  /** The picture of the board or tile bitmap as the one compositor draws it from the project's files; only those two have one. */
  preview(): Promise<BoardPicture>;
  visit(path: string): Promise<VisitOutcome>;
  returnFromVisit(): Promise<ReturnOutcome>;
  pickAsset(request: AssetPickRequest): Promise<PickOutcome>;
}

/** Extension-host document actions are authoritative; UI saves enter VS Code's custom-editor lifecycle. */
export async function handleEditorHostRequest(
  document: BridgedDocument,
  request: EditorHostRequest,
  postMessage: (message: BridgeMessage) => unknown,
): Promise<void> {
  if (request.type === "ready") {
    await postMessage({
      type: "initialize",
      kind: document.model.kind,
      snapshot: document.model.getSnapshot(),
      capabilities: document.capabilities,
      browserState: document.browserSession.getSnapshot(),
    });
  } else if (request.type === "browser-context") {
    applyBrowserStatePatch(document.browserSession, request.changes);
  } else if (request.type === "browser-list") {
    await postMessage({ type: "browser-list-result", requestId: request.requestId, result: await document.browserList(request.path) });
  } else if (request.type === "browser-read") {
    await postMessage({ type: "browser-read-result", requestId: request.requestId, result: await document.browserRead(request.path) });
  } else if (request.type === "edit") {
    // A command is data from a webview: it is applied only if it has the shape of this document's kind (never trust a webview).
    const result: ApplyResult = kindById(document.model.kind)?.isCommand(request.command) === true
      ? document.model.apply(request.command)
      : { ok: false, rejection: { reason: "invalid", message: `That is not an edit this ${document.model.kind} document understands.` } };
    if (result.ok) document.didEdit(result.editId);
    await postMessage({ type: "edit-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else if (request.type === "save") {
    const result = await document.saveThroughWorkbench();
    await postMessage({ type: "save-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else if (request.type === "preview") {
    await postMessage({ type: "preview-result", requestId: request.requestId, picture: await document.preview() });
  } else if (request.type === "visit") {
    await postMessage({ type: "visit-result", requestId: request.requestId, outcome: await document.visit(request.path) });
  } else if (request.type === "return-visit") {
    await postMessage({ type: "return-result", requestId: request.requestId, outcome: await document.returnFromVisit() });
  } else if (request.type === "pick-asset") {
    await postMessage({ type: "pick-result", requestId: request.requestId, outcome: await document.pickAsset(request.request) });
  } else {
    const result = await document.resolveConflict(request.choice);
    await postMessage({ type: "conflict-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  }
}

/** Whether a value from a webview is an asset request: a known asset kind, text extensions and a field name. Never trust a webview. */
function isAssetPickRequest(value: unknown): value is AssetPickRequest {
  return typeof value === "object" && value !== null
    && "kind" in value && typeof value.kind === "string" && Object.prototype.hasOwnProperty.call(ASSET_FOLDERS, value.kind)
    && "extensions" in value && Array.isArray(value.extensions) && value.extensions.every((extension) => typeof extension === "string")
    && "field" in value && typeof value.field === "string" && value.field !== "";
}

function isProjectPath(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (
    !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  ));
}

function isBrowserSelection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const selection = value;
  return "kind" in selection && (selection.kind === "tiles" || selection.kind === "bitmaps")
    && "path" in selection && isProjectPath(selection.path)
    && "reference" in selection && typeof selection.reference === "string" && selection.reference !== ""
    && "label" in selection && typeof selection.label === "string"
    && "boardTile" in selection && (selection.boardTile === null || typeof selection.boardTile === "string")
    && "stamp" in selection && (selection.stamp === null || isStamp(selection.stamp));
}

/** A stamp is a tile bitmap's size in whole tiles; a webview's value is never trusted past this. */
function isStamp(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "width" in value && typeof value.width === "number" && Number.isInteger(value.width) && value.width > 0
    && "height" in value && typeof value.height === "number" && Number.isInteger(value.height) && value.height > 0;
}


function isBrowserStatePatch(value: unknown): value is BrowserStatePatch {
  if (!Array.isArray(value)) return false;
  return value.every((change) => {
    if (typeof change !== "object" || change === null || !("field" in change) || !("value" in change)) return false;
    if (change.field === "selection") return change.value === null || isBrowserSelection(change.value);
    if (change.field === "path") return change.value === null || isProjectPath(change.value);
    return change.field === "scrollTop" && typeof change.value === "number" && Number.isFinite(change.value) && change.value >= 0;
  });
}

function applyBrowserStatePatch(session: BrowserSession, changes: BrowserStatePatch): void {
  const update: { -readonly [Key in keyof BrowserState]?: BrowserState[Key] } = {};
  for (const change of changes) {
    if (change.field === "selection") update.selection = change.value;
    else if (change.field === "path") update.path = change.value;
    else update.scrollTop = change.value;
  }
  session.update(update);
}

export function isEditorHostRequest(value: unknown): value is EditorHostRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "ready") return true;
  if (value.type === "browser-context") return "changes" in value && isBrowserStatePatch(value.changes);
  if (!("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.type === "browser-list" || value.type === "browser-read") return "path" in value && isProjectPath(value.path);
  if (value.type === "save" || value.type === "preview" || value.type === "return-visit") return true;
  if (value.type === "visit") return "path" in value && typeof value.path === "string" && value.path !== "";
  if (value.type === "pick-asset") return "request" in value && isAssetPickRequest(value.request);
  if (value.type === "resolve-conflict") return "choice" in value && (value.choice === "keep-local" || value.choice === "reload");
  // The command's own shape is checked against the document's kind when it is applied.
  return value.type === "edit" && "command" in value && typeof value.command === "object" && value.command !== null;
}

/** Extension-host snapshots are read-only to the webview; edits/save are requests routed through this proxy. */
export class RemoteDocument {
  private snapshot: BridgedSnapshot;
  readonly kind: string;
  readonly identity: BridgedSnapshot["identity"];
  readonly browserSession: BrowserSession;
  private readonly listeners = new Set<() => void>();
  private readonly pendingEdits = new Map<string, (result: ApplyResult) => void>();
  private readonly pendingSaves = new Map<string, (result: SaveResult) => void>();
  private readonly pendingResolutions = new Map<string, (result: ConflictResult) => void>();
  private readonly pendingPreviews = new Map<string, (picture: BoardPicture) => void>();
  private readonly pendingVisits = new Map<string, (outcome: VisitOutcome) => void>();
  private readonly pendingReturns = new Map<string, (outcome: ReturnOutcome) => void>();
  private readonly pendingPicks = new Map<string, (result: PickOutcome) => void>();
  private readonly pendingBrowserLists = new Map<string, (result: PlatformResult<readonly DirectoryEntry[]>) => void>();
  private readonly pendingBrowserReads = new Map<string, (result: PlatformResult<Uint8Array>) => void>();
  private nextRequest = 0;
  private readonly vscode: VscodeApi;
  private applyingBrowserState = false;

  constructor(kind: string, snapshot: BridgedSnapshot, browserState: BrowserState, vscode: VscodeApi) {
    this.kind = kind;
    this.snapshot = snapshot;
    this.identity = snapshot.identity;
    this.vscode = vscode;
    this.browserSession = createBrowserSession(browserState);
    this.browserSession.subscribe((changes) => {
      if (!this.applyingBrowserState) this.vscode.postMessage({ type: "browser-context", changes });
    });
  }

  getSnapshot(): BridgedSnapshot { return this.snapshot; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  apply(command: unknown): Promise<ApplyResult> {
    const requestId = `edit-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingEdits.set(requestId, resolve);
      this.vscode.postMessage({ type: "edit", command, requestId });
    });
  }

  save(): Promise<SaveResult> {
    const requestId = `save-${++this.nextRequest}`;
    this.snapshot = { ...this.snapshot, saving: true };
    this.notify();
    return new Promise((resolve) => {
      this.pendingSaves.set(requestId, resolve);
      this.vscode.postMessage({ type: "save", requestId });
    });
  }

  /** The board's picture, composed by the extension host from the project's files (the webview reads no files). */
  preview(): Promise<BoardPicture> {
    const requestId = `preview-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingPreviews.set(requestId, resolve);
      this.vscode.postMessage({ type: "preview", requestId });
    });
  }

  browserList(path: string): Promise<PlatformResult<readonly DirectoryEntry[]>> {
    const requestId = `browser-list-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingBrowserLists.set(requestId, resolve);
      this.vscode.postMessage({ type: "browser-list", requestId, path });
    });
  }

  browserRead(path: string): Promise<PlatformResult<Uint8Array>> {
    const requestId = `browser-read-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingBrowserReads.set(requestId, resolve);
      this.vscode.postMessage({ type: "browser-read", requestId, path });
    });
  }

  /** Follow a link to the document at `path`; the extension host opens it in its own editor and remembers the way back. */
  visit(path: string): Promise<VisitOutcome> {
    const requestId = `visit-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingVisits.set(requestId, resolve);
      this.vscode.postMessage({ type: "visit", requestId, path });
    });
  }

  returnFromVisit(): Promise<ReturnOutcome> {
    const requestId = `return-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingReturns.set(requestId, resolve);
      this.vscode.postMessage({ type: "return-visit", requestId });
    });
  }

  /** Let the user choose an asset for a field, through the extension host's own pick list. */
  pickAsset(request: AssetPickRequest): Promise<PickOutcome> {
    const requestId = `pick-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingPicks.set(requestId, resolve);
      this.vscode.postMessage({ type: "pick-asset", requestId, request });
    });
  }

  resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    const requestId = `resolve-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingResolutions.set(requestId, resolve);
      this.vscode.postMessage({ type: "resolve-conflict", choice, requestId });
    });
  }

  receive(message: BridgeMessage): void {
    if (message.type === "browser-state") {
      this.applyingBrowserState = true;
      try {
        applyBrowserStatePatch(this.browserSession, message.changes);
      } finally {
        this.applyingBrowserState = false;
      }
      return;
    }
    if (message.type === "browser-list-result") {
      this.settle(this.pendingBrowserLists, message.requestId, message.result);
      return;
    }
    if (message.type === "browser-read-result") {
      this.settle(this.pendingBrowserReads, message.requestId, message.result);
      return;
    }
    if (message.type === "preview-result") {
      this.settle(this.pendingPreviews, message.requestId, message.picture);
      return;
    }
    if (message.type === "visit-result") return void this.settle(this.pendingVisits, message.requestId, message.outcome);
    if (message.type === "return-result") return void this.settle(this.pendingReturns, message.requestId, message.outcome);
    if (message.type === "pick-result") return void this.settle(this.pendingPicks, message.requestId, message.outcome);
    if (message.type === "initialize") return;
    this.snapshot = message.type === "save-result" && !message.result.ok && message.snapshot.saveError === null
      ? { ...message.snapshot, saving: false, saveError: message.result.failure }
      : message.snapshot;
    if (message.type === "edit-result") this.settle(this.pendingEdits, message.requestId, message.result);
    else if (message.type === "save-result") this.settle(this.pendingSaves, message.requestId, message.result);
    else if (message.type === "conflict-result") this.settle(this.pendingResolutions, message.requestId, message.result);
    this.notify();
  }

  private settle<T>(pending: Map<string, (result: T) => void>, requestId: string, result: T): void {
    const resolve = pending.get(requestId);
    if (resolve === undefined) return;
    pending.delete(requestId);
    resolve(result);
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
