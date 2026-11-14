import { createAssetPicker, createDocumentIdentity, createDocumentWorkspace, createVisits, kindForPath, previewBoard, resolveDocumentPath, sameRevision, type AnyDocument, type BoardPicture, type ConflictChoice, type ConflictResult, type DocumentWorkspace, type PickOutcome, type SaveResult, type Visits } from "@tk-reawakened/editor-model";
import type { Capability, DialogService, FileSystemService } from "@tk-reawakened/platform-services";
import { createBrowserSession, type BrowserSession } from "@tk-reawakened/editor-ui/browser-session";
import { recoverDocument, resolveRecoveryConflict } from "./document-backup.ts";
import { handleEditorHostRequest, isEditorHostRequest, type AssetPickRequest, type BridgedDocument, type BridgeMessage, type ReturnOutcome, type VisitOutcome } from "./document-bridge.ts";

/**
 * The custom editor of every registered document kind (ADR 0026) without the `vscode` module: the provider methods VS Code's workbench calls, written
 * against a small port so the same code runs in the extension and in the host conformance suite. VS Code owns the
 * workbench (undo stack, dirty marker, Save As and close dialogs, hot exit); this provider keeps one `editor-model`
 * document per file in the extension host and answers the workbench's calls (ADR 0022 D2, AD-19).
 */

/** The most writes one VS Code save makes while edits keep arriving during them (see `GameDocument.save`). */
const SAVE_ROUNDS = 3;

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
  /** The URI of the project-relative `path` in `folder`. */
  uriFor(folder: WorkspaceFolderLike<Uri>, path: string): Uri;
  /**
   * Open the document at `uri` in an editor, as the workbench does for the file's own editor (a linked visit, a return,
   * the Game view). The workbench then asks the provider for the custom document, so the provider never opens a model for
   * a document the workbench is about to open (one model per identity, ADR 0022 D1.2).
   */
  openEditor(uri: Uri): Promise<void>;
  /** Show a pick list and resolve with the chosen item's id, or `undefined` when the user dismisses it. */
  quickPick(items: readonly { readonly id: string; readonly label: string; readonly description?: string }[], placeholder: string): Promise<string | undefined>;
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

/** VS Code's `CustomDocument` for one document of a registered kind (a `.gam`, a `.brd`): the extension host's model and the bridge to its webviews. */
export class GameDocument<Uri extends UriLike> implements BridgedDocument {
  readonly uri: Uri;
  readonly model: AnyDocument;
  readonly capabilities: readonly Capability[];
  readonly browserSession: BrowserSession;
  readonly #workspace: DocumentWorkspace;
  readonly #fs: FileSystemService;
  readonly #navigation: DocumentNavigation<Uri>;
  readonly #port: GameEditorPort<Uri>;
  readonly #fire: (event: GameEditEvent<Uri>) => void;
  /** How many `saveCustomDocument` calls have finished, and the last one's result. */
  #saves = 0;
  #lastSave: SaveResult = { ok: true };

  constructor(uri: Uri, model: AnyDocument, workspace: DocumentWorkspace, fs: FileSystemService, navigation: DocumentNavigation<Uri>, port: GameEditorPort<Uri>, fire: (event: GameEditEvent<Uri>) => void, browserSession: BrowserSession) {
    this.uri = uri;
    this.model = model;
    this.capabilities = port.capabilities;
    this.browserSession = browserSession;
    this.#workspace = workspace;
    this.#fs = fs;
    this.#navigation = navigation;
    this.#port = port;
    this.#fire = fire;
  }

  /** Hand an accepted edit to VS Code's undo stack; VS Code undoes it by its `editId` (AD-19). */
  didEdit(editId: string): void {
    const label = this.model.getSnapshot().edits.find((edit) => edit.editId === editId)?.label ?? "Edit";
    this.#fire({ document: this, label, undo: () => { this.model.undo(editId); }, redo: () => { this.model.redo(editId); } });
  }

  /** VS Code disposes a custom document when its last editor closes; the workbench has already asked about unsaved work. */
  dispose(): void {
    this.#workspace.release(this.model);
  }

  /** Follow a link from this document to the file at `path` in a new editor, remembering where it came from (story 11.4). */
  visit(path: string): Promise<VisitOutcome> {
    return this.#navigation.visit(this, path);
  }

  /** Go back to where the latest visit started. */
  returnFromVisit(): Promise<ReturnOutcome> {
    return this.#navigation.returnFromVisit(this);
  }

  /** Let the user choose an asset for a field of this document, through the host's own pick list and dialogs (T-05). */
  pickAsset(request: AssetPickRequest): Promise<PickOutcome> {
    return this.#navigation.pickAsset(this, request);
  }

  /** Project-relative reads for the shared tileset browser; the workspace-bound filesystem cannot cross projects. */
  browserList(path: string) {
    return this.#fs.list(path);
  }

  browserRead(path: string) {
    return this.#fs.read(path);
  }

  /** The picture of a board, composed here from the project's files by the one board compositor (AD-29); a webview reads no files. */
  async preview(): Promise<BoardPicture> {
    if (this.model.kind !== "board") return { ok: false, message: `A ${this.model.kind} document has no picture.` };
    const preview = await previewBoard(this.#fs, this.model.identity.projectId, this.model.serialize());
    return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
  }

  /**
   * Save through the model; the provider's `saveCustomDocument` is the only caller.
   *
   * The browser host and VS Code complete a save differently. The browser workspace marks clean only the revision it
   * wrote, so an edit made during the write stays dirty (ADR 0022 D3.3). VS Code moves its save point to the latest edit
   * it has heard of when `saveCustomDocument` resolves, and its close dialog closes the tab unless the working copy is
   * still dirty right after that. Resolving after writing only an earlier revision would therefore show the later edit as
   * saved and let close drop it. So an edit that reached this model during the write is written by another round before
   * the save resolves; after `SAVE_ROUNDS` writes that each found newer work, the save fails visibly and the edits stay
   * dirty in the model and in VS Code (#2200, #2220). An edit or undo the workbench applies after this resolves but
   * before it records the save is outside the provider's reach (ADR 0022 D14.6, #2225).
   */
  async save(): Promise<SaveResult> {
    let result = await this.model.save();
    for (let round = 1; result.ok && this.model.getSnapshot().dirty && round < SAVE_ROUNDS; round += 1) {
      result = await this.model.save();
    }
    if (result.ok && this.model.getSnapshot().dirty) {
      const path = this.model.identity.path;
      result = {
        ok: false,
        failure: { document: path, kind: "write", code: null, message: `Could not save ${path}: it was edited during each of ${SAVE_ROUNDS} writes. The latest edits are kept unsaved; save again.` },
      };
    }
    this.#saves += 1;
    this.#lastSave = result;
    return result;
  }

  /**
   * A Save from the view goes through VS Code's own save, so its working copy is marked clean only by
   * `saveCustomDocument` (#2092). The result is that call's, so an edit made during the write is written by the same
   * save (see `save`), and a workbench that never called it is reported as not saving.
   */
  async saveThroughWorkbench(): Promise<SaveResult> {
    const path = this.model.identity.path;
    const before = this.#saves;
    try {
      await this.#port.executeCommand("workbench.action.files.save");
    } catch (error) {
      // The provider's own failure when it ran (a refused write, or edits that kept outrunning it); otherwise VS Code's.
      if (this.#saves !== before && !this.#lastSave.ok) return this.#lastSave;
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
   * Settle a change made on disk (ADR 0022 D14.2). Revert File only targets the active editor and cannot safely
   * reload this document after a focus change. Reject even a forged reload request and keep both versions intact.
   */
  async resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    if (choice === "reload") {
      return {
        ok: false,
        reason: "cannot-reload",
        message: `Cannot safely reload ${this.model.identity.path}: VS Code's Revert File command only targets the active editor, which may change before command dispatch. Your changes and conflict were kept.`,
      };
    }
    return resolveRecoveryConflict(this.model, choice);
  }
}

/** What a document can ask of the provider for navigation: the project-wide parts of story 11.4. */
interface DocumentNavigation<Uri extends UriLike> {
  visit(origin: GameDocument<Uri>, path: string): Promise<VisitOutcome>;
  returnFromVisit(origin: GameDocument<Uri>): Promise<ReturnOutcome>;
  pickAsset(origin: GameDocument<Uri>, request: AssetPickRequest): Promise<PickOutcome>;
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
  const workspaces = new Map<string, { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace; readonly visits: Visits; readonly browserSession: BrowserSession }>();
  type Project = { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace; readonly visits: Visits; readonly browserSession: BrowserSession; readonly path: string };
  const projectIn = (folder: WorkspaceFolderLike<Uri>, uri: Uri): Project => {
    let project = workspaces.get(folder.key);
    if (project === undefined) {
      const fs = port.fileSystem(folder);
      const workspace = createDocumentWorkspace({ projectId: folder.key, services: { fs, dialogs: port.dialogs(folder), capabilities: new Set(port.capabilities) } });
      project = { fs, workspace, visits: createVisits(workspace), browserSession: createBrowserSession() };
      workspaces.set(folder.key, project);
    }
    return { ...project, path: uri.path.slice(folder.uri.path.replace(/\/$/, "").length + 1) };
  };
  const nameOf = (uri: Uri): string => uri.path.split("/").at(-1) ?? uri.path;
  const folderOfDocument = (document: GameDocument<Uri>): WorkspaceFolderLike<Uri> => {
    const folder = port.folderOf(document.uri);
    if (folder === undefined) throw new Error(`${document.model.identity.path} is outside the open workspace`);
    return folder;
  };

  const navigation: DocumentNavigation<Uri> = {
    async visit(origin, path) {
      const folder = folderOfDocument(origin);
      const project = projectIn(folder, origin.uri);
      const resolved = await resolveDocumentPath(project.fs, path);
      if (!resolved.ok) return { ok: false, message: resolved.kind === "case-conflict" ? resolved.message : `Could not check ${path}: ${resolved.error.message}` };
      if (!resolved.exists) return { ok: false, message: `${path} is not in the project, so there is nothing to visit.` };
      if (kindForPath(resolved.path) === null) return { ok: false, message: `${resolved.path} is not a file type the editor opens.` };
      project.visits.begin(origin.model.identity.path, resolved.path);
      try {
        await port.openEditor(port.uriFor(folder, resolved.path));
      } catch (error) {
        // The editor did not open: forget the visit, so a later return does not go back from a place never reached.
        project.visits.end();
        return { ok: false, message: `${resolved.path} could not be opened: ${error instanceof Error ? error.message : String(error)}` };
      }
      return { ok: true, path: resolved.path };
    },
    async returnFromVisit(origin) {
      const folder = folderOfDocument(origin);
      const project = projectIn(folder, origin.uri);
      const entry = project.visits.end();
      if (entry === null) return { ok: false, message: "There is no visit to return from." };
      const wasOpen = project.workspace.documents().some((document) => document.identity.path === entry.originPath);
      try {
        await port.openEditor(port.uriFor(folder, entry.originPath));
      } catch (error) {
        return { ok: false, message: `${entry.originPath} could not be opened again (${error instanceof Error ? error.message : String(error)}). Nothing was changed.` };
      }
      return {
        ok: true,
        path: entry.originPath,
        message: wasOpen ? null : `${entry.originPath} had been closed, so it was opened again from its file. Edits that were not saved before it closed are not in it.`,
      };
    },
    async pickAsset(origin, request) {
      const folder = folderOfDocument(origin);
      const project = projectIn(folder, origin.uri);
      const picker = createAssetPicker({
        services: { fs: project.fs, dialogs: port.dialogs(folder), capabilities: new Set(port.capabilities) },
        layout: { projectFolder: "" },
        kind: request.kind,
        extensions: request.extensions,
        field: request.field,
      });
      await picker.refresh();
      // The host's own pick list stands in for the picker view: the model decides, the list only shows and asks.
      for (;;) {
        const snapshot = picker.getSnapshot();
        const items = [
          ...snapshot.candidates.map((candidate) => ({ id: `file:${candidate.reference}`, label: candidate.reference })),
          { id: "outside", label: "Choose a file from outside the project…", ...(snapshot.outsideUnavailable === null ? {} : { description: "not available on this host" }) },
        ];
        const choice = await port.quickPick(items, snapshot.message ?? `Choose ${request.field} (files in ${snapshot.folder}, including its folders)`);
        if (choice === undefined) return picker.cancel();
        if (choice === "outside") {
          const outcome = await picker.pickOutside();
          if (outcome.chosen) return outcome;
          continue;
        }
        picker.select(choice.slice("file:".length));
        const outcome = await picker.confirm();
        if (outcome.chosen) return outcome;
      }
    },
  };

  return {
    async openCustomDocument(uri, backupId) {
      const folder = port.folderOf(uri);
      if (folder === undefined) throw new Error(`${nameOf(uri)} is outside the open workspace`);
      const { workspace, fs, path, browserSession } = projectIn(folder, uri);
      if (backupId !== undefined) {
        const resolved = await resolveDocumentPath(fs, path);
        if (!resolved.ok) throw new Error(resolved.kind === "case-conflict" ? resolved.message : `${nameOf(uri)}: ${resolved.error.message}`);
        const identity = createDocumentIdentity(folder.key, resolved.path);
        const kind = kindForPath(resolved.path);
        if (kind === null) throw new Error(`${nameOf(uri)} is not a file type the editor opens.`);
        const recovered = await recoverDocument(kind, fs, identity, await port.readBackup(backupId));
        if (!recovered.ok) throw new Error(`${nameOf(uri)}: ${recovered.error.error.message}`);
        if (!workspace.adopt(recovered.document)) throw new Error(`${path} is already open in another editor under another spelling.`);
        return new GameDocument(uri, recovered.document, workspace, fs, navigation, port, fire, browserSession);
      }
      const known = new Set(workspace.documents());
      const opened = await workspace.open(path);
      if (!opened.ok) {
        throw new Error(opened.error.kind === "case-conflict" || opened.error.kind === "unsupported" ? opened.error.message : `${nameOf(uri)}: ${opened.error.error.message}`);
      }
      // VS Code opens one custom document per URI. A second URI that folds to an open document (another spelling of its
      // path) would be a second working copy of one model, so it is refused rather than opened twice (D1.2).
      if (known.has(opened.document)) {
        throw new Error(`${path} is already open as ${opened.document.identity.path}; one file is opened once.`);
      }
      return new GameDocument(uri, opened.document, workspace, fs, navigation, port, fire, browserSession);
    },
    async saveCustomDocument(document) {
      const result = await document.save();
      if (!result.ok) throw new Error(result.failure.message);
    },
    async saveCustomDocumentAs(document, destination) {
      // VS Code's save dialog has already chosen the destination and confirmed replacing an existing file (D3.4).
      const folder = port.folderOf(destination);
      if (folder === undefined) throw new Error(`${nameOf(destination)} is outside the open workspace folders; Save As saves inside a project. Nothing was written.`);
      // The source's project is the project of its whole lifecycle (D1.1). A multi-root workspace has one project per
      // folder, and Save As never moves a document into another one; the refusal comes before any state is made for that
      // folder, so the other project gets no workspace, no read and no write (ADR 0022 D14.7, #2206).
      if (folder.key !== document.model.identity.projectId) {
        throw new Error(`${nameOf(destination)} is in another workspace folder (${nameOf(folder.uri) || folder.uri.path}); Save As saves inside the project of ${document.model.identity.path}. Nothing was written.`);
      }
      const project = projectIn(folder, destination);
      const resolved = await resolveDocumentPath(project.fs, project.path);
      if (!resolved.ok) throw new Error(resolved.kind === "case-conflict" ? resolved.message : `Could not check ${project.path}: ${resolved.error.message}`);
      const identity = createDocumentIdentity(folder.key, resolved.path);
      if (project.workspace.documents().some((open) => open.identity.key === identity.key && open !== document.model)) {
        throw new Error(`${resolved.path} is open in another editor; close it before saving another document over it. Nothing was written.`);
      }
      // VS Code replaces the source tab with the destination once this resolves, so a source edit made during the write
      // (which the copy does not hold) fails the Save As and keeps the source open with its work (#2201).
      const copied = document.model.getSnapshot();
      const result = await document.model.saveAs(project.fs, identity);
      if (!result.ok) throw new Error(result.failure.message);
      if (!sameRevision(document.model.getSnapshot(), copied)) {
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
      const browserSubscription = document.browserSession.subscribe(() => {
        void webview.postMessage({ type: "browser-state", state: document.browserSession.getSnapshot() });
      });
      const messages = webview.onDidReceiveMessage(async (message: unknown) => {
        if (!isEditorHostRequest(message)) return;
        await handleEditorHostRequest(document, message, (reply) => webview.postMessage(reply));
      });
      const disposal = webview.onDidDispose(() => {
        subscription();
        browserSubscription();
        messages.dispose();
        disposal.dispose();
      });
    },
  };
}
