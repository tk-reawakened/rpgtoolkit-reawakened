import { kindById, type AnyDocument, type ApplyResult, type BoardPicture, type ConflictChoice, type ConflictResult, type DocumentSnapshot, type SaveResult } from "@tk-reawakened/editor-model";
import type { Capability } from "@tk-reawakened/platform-services";

/** A snapshot as it crosses the bridge: plain data, whatever the kind (the kind says which fields it has). */
export type BridgedSnapshot = DocumentSnapshot<unknown>;

export type BridgeMessage =
  | { readonly type: "initialize"; readonly kind: string; readonly snapshot: BridgedSnapshot; readonly capabilities: readonly Capability[] }
  | { readonly type: "snapshot"; readonly snapshot: BridgedSnapshot }
  | { readonly type: "edit-result"; readonly requestId: string; readonly result: ApplyResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "save-result"; readonly requestId: string; readonly result: SaveResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "conflict-result"; readonly requestId: string; readonly result: ConflictResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "preview-result"; readonly requestId: string; readonly picture: BoardPicture };

export type EditorHostRequest =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly command: unknown; readonly requestId: string }
  | { readonly type: "save"; readonly requestId: string }
  | { readonly type: "resolve-conflict"; readonly choice: ConflictChoice; readonly requestId: string }
  | { readonly type: "preview"; readonly requestId: string };

export type VscodeApi = { postMessage(message: EditorHostRequest): void; getState(): unknown; setState(state: unknown): void };

/** What the bridge needs from the extension host's side of one custom document. */
export interface BridgedDocument {
  readonly model: AnyDocument;
  readonly capabilities: readonly Capability[];
  didEdit(editId: string): void;
  saveThroughWorkbench(): Promise<SaveResult>;
  resolveConflict(choice: ConflictChoice): Promise<ConflictResult>;
  /** The picture of the board as the one compositor draws it from the project's files; only a board has one. */
  preview(): Promise<BoardPicture>;
}

/** Extension-host document actions are authoritative; UI saves enter VS Code's custom-editor lifecycle. */
export async function handleEditorHostRequest(
  document: BridgedDocument,
  request: EditorHostRequest,
  postMessage: (message: BridgeMessage) => unknown,
): Promise<void> {
  if (request.type === "ready") {
    await postMessage({ type: "initialize", kind: document.model.kind, snapshot: document.model.getSnapshot(), capabilities: document.capabilities });
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
  } else {
    const result = await document.resolveConflict(request.choice);
    await postMessage({ type: "conflict-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  }
}

export function isEditorHostRequest(value: unknown): value is EditorHostRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "ready") return true;
  if (!("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.type === "save" || value.type === "preview") return true;
  if (value.type === "resolve-conflict") return "choice" in value && (value.choice === "keep-local" || value.choice === "reload");
  // The command's own shape is checked against the document's kind when it is applied.
  return value.type === "edit" && "command" in value && typeof value.command === "object" && value.command !== null;
}

/** Extension-host snapshots are read-only to the webview; edits/save are requests routed through this proxy. */
export class RemoteDocument {
  private snapshot: BridgedSnapshot;
  readonly kind: string;
  readonly identity: BridgedSnapshot["identity"];
  private readonly listeners = new Set<() => void>();
  private readonly pendingEdits = new Map<string, (result: ApplyResult) => void>();
  private readonly pendingSaves = new Map<string, (result: SaveResult) => void>();
  private readonly pendingResolutions = new Map<string, (result: ConflictResult) => void>();
  private readonly pendingPreviews = new Map<string, (picture: BoardPicture) => void>();
  private nextRequest = 0;
  private readonly vscode: VscodeApi;

  constructor(kind: string, snapshot: BridgedSnapshot, vscode: VscodeApi) {
    this.kind = kind;
    this.snapshot = snapshot;
    this.identity = snapshot.identity;
    this.vscode = vscode;
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

  resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    const requestId = `resolve-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingResolutions.set(requestId, resolve);
      this.vscode.postMessage({ type: "resolve-conflict", choice, requestId });
    });
  }

  receive(message: BridgeMessage): void {
    if (message.type === "preview-result") {
      this.settle(this.pendingPreviews, message.requestId, message.picture);
      return;
    }
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
