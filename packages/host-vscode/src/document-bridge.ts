import type { ApplyResult, ConflictChoice, ConflictResult, MainCommand, MainDocument, MainDocumentSnapshot, SaveResult } from "@tk-reawakened/editor-model";
import type { Capability } from "@tk-reawakened/platform-services";
import type { ViewDocument } from "@tk-reawakened/editor-ui";

export type BridgeMessage =
  | { readonly type: "initialize"; readonly snapshot: MainDocumentSnapshot; readonly capabilities: readonly Capability[] }
  | { readonly type: "snapshot"; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "edit-result"; readonly requestId: string; readonly result: ApplyResult; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "save-result"; readonly requestId: string; readonly result: SaveResult; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "conflict-result"; readonly requestId: string; readonly result: ConflictResult; readonly snapshot: MainDocumentSnapshot };

export type EditorHostRequest =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly command: MainCommand; readonly requestId: string }
  | { readonly type: "save"; readonly requestId: string }
  | { readonly type: "resolve-conflict"; readonly choice: ConflictChoice; readonly requestId: string };

export type VscodeApi = { postMessage(message: EditorHostRequest): void; getState(): unknown; setState(state: unknown): void };

/** What the bridge needs from the extension host's side of one custom document. */
export interface BridgedDocument {
  readonly model: MainDocument;
  readonly capabilities: readonly Capability[];
  didEdit(editId: string): void;
  saveThroughWorkbench(): Promise<SaveResult>;
  resolveConflict(choice: ConflictChoice): Promise<ConflictResult>;
}

/** Extension-host document actions are authoritative; UI saves enter VS Code's custom-editor lifecycle. */
export async function handleEditorHostRequest(
  document: BridgedDocument,
  request: EditorHostRequest,
  postMessage: (message: BridgeMessage) => unknown,
): Promise<void> {
  if (request.type === "ready") {
    await postMessage({ type: "initialize", snapshot: document.model.getSnapshot(), capabilities: document.capabilities });
  } else if (request.type === "edit") {
    const result = document.model.apply(request.command);
    if (result.ok) document.didEdit(result.editId);
    await postMessage({ type: "edit-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else if (request.type === "save") {
    const result = await document.saveThroughWorkbench();
    await postMessage({ type: "save-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else {
    const result = await document.resolveConflict(request.choice);
    await postMessage({ type: "conflict-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  }
}

export function isEditorHostRequest(value: unknown): value is EditorHostRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "ready") return true;
  if (!("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.type === "save") return true;
  if (value.type === "resolve-conflict") return "choice" in value && (value.choice === "keep-local" || value.choice === "reload");
  return value.type === "edit" && "command" in value && typeof value.command === "object" && value.command !== null
    && "type" in value.command && value.command.type === "set-game-title"
    && "title" in value.command && typeof value.command.title === "string";
}

/** Extension-host snapshots are read-only to the webview; edits/save are requests routed through this proxy. */
export class RemoteDocument implements ViewDocument {
  private snapshot: MainDocumentSnapshot;
  readonly identity: MainDocumentSnapshot["identity"];
  private readonly listeners = new Set<() => void>();
  private readonly pendingEdits = new Map<string, (result: ApplyResult) => void>();
  private readonly pendingSaves = new Map<string, (result: SaveResult) => void>();
  private readonly pendingResolutions = new Map<string, (result: ConflictResult) => void>();
  private nextRequest = 0;
  private readonly vscode: VscodeApi;

  constructor(snapshot: MainDocumentSnapshot, vscode: VscodeApi) {
    this.snapshot = snapshot;
    this.identity = snapshot.identity;
    this.vscode = vscode;
  }

  getSnapshot(): MainDocumentSnapshot { return this.snapshot; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  apply(command: MainCommand): Promise<ApplyResult> {
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

  resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    const requestId = `resolve-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingResolutions.set(requestId, resolve);
      this.vscode.postMessage({ type: "resolve-conflict", choice, requestId });
    });
  }

  receive(message: BridgeMessage): void {
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
