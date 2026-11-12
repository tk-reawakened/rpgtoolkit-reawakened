import type { ApplyResult, MainCommand, MainDocument, MainDocumentSnapshot, SaveResult } from "@tk-reawakened/editor-model";
import type { ViewDocument } from "@tk-reawakened/editor-ui";

export type BridgeMessage =
  | { readonly type: "initialize"; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "snapshot"; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "edit-result"; readonly requestId: string; readonly result: ApplyResult; readonly snapshot: MainDocumentSnapshot }
  | { readonly type: "save-result"; readonly requestId: string; readonly result: SaveResult; readonly snapshot: MainDocumentSnapshot };

export type EditorHostRequest =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly command: MainCommand; readonly requestId: string }
  | { readonly type: "save"; readonly requestId: string };

export type VscodeApi = { postMessage(message: EditorHostRequest): void; getState(): unknown; setState(state: unknown): void };

/** Extension-host document actions are authoritative; UI saves enter VS Code's custom-editor lifecycle. */
export async function handleEditorHostRequest(
  document: { readonly model: MainDocument; didEdit(editId: string): void; saveThroughWorkbench(): Promise<SaveResult> },
  request: EditorHostRequest,
  postMessage: (message: BridgeMessage) => unknown,
): Promise<void> {
  if (request.type === "ready") {
    await postMessage({ type: "initialize", snapshot: document.model.getSnapshot() });
  } else if (request.type === "edit") {
    const result = document.model.apply(request.command);
    if (result.ok) document.didEdit(result.editId);
    await postMessage({ type: "edit-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else {
    const result = await document.saveThroughWorkbench();
    await postMessage({ type: "save-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  }
}

export function isEditorHostRequest(value: unknown): value is EditorHostRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "ready") return true;
  if ((value.type !== "edit" && value.type !== "save") || !("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.type === "save") return true;
  return "command" in value && typeof value.command === "object" && value.command !== null
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

  receive(message: BridgeMessage): void {
    this.snapshot = message.type === "save-result" && !message.result.ok && message.snapshot.saveError === null
      ? { ...message.snapshot, saving: false, saveError: message.result.failure }
      : message.snapshot;
    if (message.type === "edit-result") {
      const resolve = this.pendingEdits.get(message.requestId);
      if (resolve) {
        this.pendingEdits.delete(message.requestId);
        resolve(message.result);
      }
    } else if (message.type === "save-result") {
      const resolve = this.pendingSaves.get(message.requestId);
      if (resolve) {
        this.pendingSaves.delete(message.requestId);
        resolve(message.result);
      }
    }
    this.notify();
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
