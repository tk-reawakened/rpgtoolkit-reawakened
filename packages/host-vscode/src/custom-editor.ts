import { createDocumentIdentity, createDocumentWorkspace, resolveDocumentPath, type ConflictChoice, type ConflictResult, type DocumentWorkspace, type MainDocument, type SaveResult } from "@tk-reawakened/editor-model";
import type { Capability, DialogService, FileSystemService } from "@tk-reawakened/platform-services";
import { recoverMainDocument } from "./document-backup.ts";
import { handleEditorHostRequest, isEditorHostRequest, type BridgedDocument, type BridgeMessage } from "./document-bridge.ts";

/**
 * The game-settings custom editor without the `vscode` module: the provider methods VS Code's workbench calls, written
 * against a small port so the same code runs in the extension and in the host conformance suite. VS Code owns the
 * workbench (undo stack, dirty marker, Save As and close dialogs, hot exit); this provider keeps one `editor-model`
 * document per file in the extension host and answers the workbench's calls (ADR 0022 D2, AD-19).
 */

export interface UriLike {
  readonly path: string;
}

/** A workspace folder: the project of every document below it (ADR 0022 D1.1). */
export interface WorkspaceFolderLike<Uri extends UriLike> {
  readonly uri: Uri;
  /** The folder's URI as a string: the project handle. */
  readonly key: string;
}

/** What the provider needs from VS Code. `extension.ts` binds it to the `vscode` API. */
export interface GameEditorPort<Uri extends UriLike> {
  readonly capabilities: readonly Capability[];
  folderOf(uri: Uri): WorkspaceFolderLike<Uri> | undefined;
  fileSystem(folder: WorkspaceFolderLike<Uri>): FileSystemService;
  /** The folder's `dialogs`. The workbench asks its own questions on close and Save As, so the provider never shows one. */
  dialogs(folder: WorkspaceFolderLike<Uri>): DialogService;
  /** Hot-exit backups live outside the workspace, at a location VS Code gives. */
  readBackup(id: string): Promise<Uint8Array>;
  writeBackup(destination: Uri, bytes: Uint8Array): Promise<string>;
  deleteBackup(destination: Uri): Promise<void>;
  /** Run a workbench command on the active editor: `workbench.action.files.save` or `workbench.action.files.revert`. */
  executeCommand(command: "workbench.action.files.save" | "workbench.action.files.revert"): Promise<unknown>;
}

/** One undoable edit, as VS Code's `CustomDocumentEditEvent` carries it. */
export interface GameEditEvent<Uri extends UriLike> {
  readonly document: GameDocument<Uri>;
  readonly label: string;
  undo(): void;
  redo(): void;
}

/** What a webview panel gives the provider. */
export interface WebviewPort {
  postMessage(message: BridgeMessage): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): void };
  onDidDispose(listener: () => void): { dispose(): void };
}

/** VS Code's `CustomDocument` for one `.gam` file: the extension host's model and the bridge to its webviews. */
export class GameDocument<Uri extends UriLike> implements BridgedDocument {
  readonly uri: Uri;
  readonly model: MainDocument;
  readonly capabilities: readonly Capability[];
  readonly #workspace: DocumentWorkspace;
  readonly #port: GameEditorPort<Uri>;
  readonly #fire: (event: GameEditEvent<Uri>) => void;
  #pendingRecoveryEditId: string | null;
  /** How many `saveCustomDocument` calls have finished, and the last one's result. */
  #saves = 0;
  #lastSave: SaveResult = { ok: true };

  constructor(uri: Uri, model: MainDocument, workspace: DocumentWorkspace, port: GameEditorPort<Uri>, fire: (event: GameEditEvent<Uri>) => void, recoveryEditId: string | null) {
    this.uri = uri;
    this.model = model;
    this.capabilities = port.capabilities;
    this.#workspace = workspace;
    this.#port = port;
    this.#fire = fire;
    this.#pendingRecoveryEditId = recoveryEditId;
  }

  /** Hand an accepted edit to VS Code's undo stack; VS Code undoes it by its `editId` (AD-19). */
  didEdit(editId: string): void {
    this.#fire({ document: this, label: "Edit game title", undo: () => { this.model.undo(editId); }, redo: () => { this.model.redo(editId); } });
  }

  /** A recovered backup's edit is announced once a view exists, so VS Code can undo it like any other. */
  publishRecoveryEdit(): void {
    const editId = this.#pendingRecoveryEditId;
    if (editId === null) return;
    this.#pendingRecoveryEditId = null;
    this.didEdit(editId);
  }

  /** VS Code disposes a custom document when its last editor closes; the workbench has already asked about unsaved work. */
  dispose(): void {
    this.#workspace.release(this.model);
  }

  /** Save through the model; the provider's `saveCustomDocument` is the only caller. */
  async save(): Promise<SaveResult> {
    const result = await this.model.save();
    this.#saves += 1;
    this.#lastSave = result;
    return result;
  }

  /**
   * A Save from the view goes through VS Code's own save, so its working copy is marked clean only by
   * `saveCustomDocument` (#2092). If newer work remains dirty, the provider refuses completion so VS Code cannot close
   * the working copy as saved; a workbench that never called the provider is also reported as not saving.
   */
  async saveThroughWorkbench(): Promise<SaveResult> {
    const path = this.model.identity.path;
    const before = this.#saves;
    try {
      await this.#port.executeCommand("workbench.action.files.save");
    } catch (error) {
      const saveError = this.model.getSnapshot().saveError;
      return { ok: false, failure: saveError ?? {
        document: path,
        kind: "write",
        code: null,
        message: `Could not save ${path}: ${error instanceof Error ? error.message : String(error)}`,
      } };
    }
    if (this.#saves === before) {
      return { ok: false, failure: { document: path, kind: "write", code: null, message: `Could not save ${path}: VS Code did not save this custom document.` } };
    }
    return this.#lastSave;
  }

  /**
   * Settle a change made on disk (ADR 0022 D3.5). Loading the disk's version starts a new history; VS Code is then told
   * to revert, which drops its own edits after the save point so its dirty marker agrees (the model's revert finds the
   * file it just loaded and changes nothing).
   */
  async resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    const resolved = this.model.resolveConflict(choice);
    if (resolved.ok && choice === "reload") await this.#port.executeCommand("workbench.action.files.revert");
    return resolved;
  }
}

export interface GameEditorProvider<Uri extends UriLike> {
  openCustomDocument(uri: Uri, backupId: string | undefined): Promise<GameDocument<Uri>>;
  saveCustomDocument(document: GameDocument<Uri>): Promise<void>;
  saveCustomDocumentAs(document: GameDocument<Uri>, destination: Uri): Promise<void>;
  revertCustomDocument(document: GameDocument<Uri>): Promise<void>;
  backupCustomDocument(document: GameDocument<Uri>, destination: Uri): Promise<{ readonly id: string; delete(): Promise<void> }>;
  /** Connect a webview panel (a new one, or one VS Code re-created after hiding it) to the document's model. */
  resolveCustomEditor(document: GameDocument<Uri>, webview: WebviewPort): void;
}

/** Make the provider. `fire` is `onDidChangeCustomDocument`'s emitter. */
export function createGameEditorProvider<Uri extends UriLike>(port: GameEditorPort<Uri>, fire: (event: GameEditEvent<Uri>) => void): GameEditorProvider<Uri> {
  const workspaces = new Map<string, { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace }>();
  const projectOf = (uri: Uri): { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace; readonly folder: WorkspaceFolderLike<Uri>; readonly path: string } | undefined => {
    const folder = port.folderOf(uri);
    if (folder === undefined) return undefined;
    let project = workspaces.get(folder.key);
    if (project === undefined) {
      const fs = port.fileSystem(folder);
      project = { fs, workspace: createDocumentWorkspace({ projectId: folder.key, services: { fs, dialogs: port.dialogs(folder), capabilities: new Set(port.capabilities) } }) };
      workspaces.set(folder.key, project);
    }
    return { ...project, folder, path: uri.path.slice(folder.uri.path.replace(/\/$/, "").length + 1) };
  };
  const nameOf = (uri: Uri): string => uri.path.split("/").at(-1) ?? uri.path;

  return {
    async openCustomDocument(uri, backupId) {
      const project = projectOf(uri);
      if (project === undefined) throw new Error(`${nameOf(uri)} is outside the open workspace`);
      const { workspace, fs, folder, path } = project;
      if (backupId !== undefined) {
        const resolved = await resolveDocumentPath(fs, path);
        if (!resolved.ok) throw new Error(resolved.kind === "case-conflict" ? resolved.message : `${nameOf(uri)}: ${resolved.error.message}`);
        const identity = createDocumentIdentity(folder.key, resolved.path);
        const recovered = await recoverMainDocument(fs, identity, await port.readBackup(backupId));
        if (!recovered.ok) throw new Error(`${nameOf(uri)}: ${recovered.error.error.message}`);
        if (!workspace.adopt(recovered.document)) throw new Error(`${path} is already open in another editor under another spelling.`);
        return new GameDocument(uri, recovered.document, workspace, port, fire, recovered.editId);
      }
      const known = new Set(workspace.documents());
      const opened = await workspace.open(path);
      if (!opened.ok) {
        throw new Error(opened.error.kind === "case-conflict" ? opened.error.message : `${nameOf(uri)}: ${opened.error.error.message}`);
      }
      // VS Code opens one custom document per URI. A second URI that folds to an open document (another spelling of its
      // path) would be a second working copy of one model, so it is refused rather than opened twice (D1.2).
      if (known.has(opened.document)) {
        throw new Error(`${path} is already open as ${opened.document.identity.path}; one file is opened once.`);
      }
      return new GameDocument(uri, opened.document, workspace, port, fire, null);
    },
    async saveCustomDocument(document) {
      const result = await document.save();
      if (!result.ok) throw new Error(result.failure.message);
      if (document.model.getSnapshot().dirty || document.model.getSnapshot().conflict !== null) {
        throw new Error(`${document.model.identity.path} changed during save and remains open with unsaved work.`);
      }
    },
    async saveCustomDocumentAs(document, destination) {
      // VS Code's save dialog has already chosen the destination and confirmed replacing an existing file (D3.4).
      const project = projectOf(destination);
      if (project === undefined) throw new Error(`${nameOf(destination)} is outside the open workspace folders; Save As saves inside a project. Nothing was written.`);
      const resolved = await resolveDocumentPath(project.fs, project.path);
      if (!resolved.ok) throw new Error(resolved.kind === "case-conflict" ? resolved.message : `Could not check ${project.path}: ${resolved.error.message}`);
      const identity = createDocumentIdentity(project.folder.key, resolved.path);
      if (project.workspace.documents().some((open) => open.identity.key === identity.key && open !== document.model)) {
        throw new Error(`${resolved.path} is open in another editor; close it before saving another document over it. Nothing was written.`);
      }
      const copied = document.model.getSnapshot();
      const result = await document.model.saveAs(project.fs, identity);
      if (!result.ok) throw new Error(result.failure.message);
      if (document.model.getSnapshot() !== copied) {
        throw new Error(`${resolved.path} was written, but ${document.model.identity.path} changed during Save As and remains open with its work.`);
      }
    },
    async revertCustomDocument(document) {
      // VS Code's Revert File is itself the user's choice to discard; the workbench asks nothing more and drops its own
      // edits after the save point, which `revert` mirrors (D3.6).
      const result = await document.model.revert();
      if (!result.ok) throw new Error(result.failure.message);
    },
    async backupCustomDocument(document, destination) {
      const id = await port.writeBackup(destination, document.model.serialize());
      return { id, delete: () => port.deleteBackup(destination) };
    },
    resolveCustomEditor(document, webview) {
      const publish = () => { void webview.postMessage({ type: "snapshot", snapshot: document.model.getSnapshot() }); };
      const subscription = document.model.subscribe(publish);
      const messages = webview.onDidReceiveMessage(async (message: unknown) => {
        if (!isEditorHostRequest(message)) return;
        await handleEditorHostRequest(document, message, (reply) => webview.postMessage(reply));
      });
      const disposal = webview.onDidDispose(() => {
        subscription();
        messages.dispose();
        disposal.dispose();
      });
      document.publishRecoveryEdit();
    },
  };
}
