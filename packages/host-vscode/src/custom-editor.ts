import { boardPreviewRootForPath, createAnimationAuthoring, asAnimationDocument, asMainDocument, linkFor, projectLayoutOfMain, referencePath, type AnimationCommand, type AnimationBitmap, type CheckpointEntry, type CheckpointGroup, type CheckpointEnvironment, DEFAULT_EDITOR_PREFERENCES, createAssetPicker, createDocumentIdentity, createDocumentWorkspace, createVisits, kindForPath, previewBoard, previewTileBitmap, resolveDocumentPath, sameRevision, type AnyDocument, type BoardPicture, type BoardPreviewRequest, type ConflictChoice, type ConflictResult, type DocumentWorkspace, type EditorPreferences, type PickOutcome, type SaveResult, type Visits } from "@tk-reawakened/editor-model";
import { platformOk, platformError, type Capability, type DialogService, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";
import { createBrowserSession, type BrowserSession } from "@tk-reawakened/editor-ui/browser-session";
import { recoverDocument, resolveRecoveryConflict } from "./document-backup.ts";
import { handleEditorHostRequest, isEditorHostRequest, type AssetPickRequest, type BridgedDocument, type BridgeMessage, type ReturnOutcome, type VisitOutcome } from "./document-bridge.ts";
import type { HistoryPolicy, HistoryReason } from "@tk-reawakened/editor-model";

/**
 * The custom editor of every registered document kind (ADR 0026) without the `vscode` module: the provider methods VS Code's workbench calls, written
 * against a small port so the same code runs in the extension and in the host conformance suite. VS Code owns the
 * workbench (undo stack, dirty marker, Save As and close dialogs, hot exit); this provider keeps one `editor-model`
 * document per file in the extension host and answers the workbench's calls (ADR 0022 D2, AD-19).
 */

/** The most writes one VS Code save makes while edits keep arriving during them (see `GameDocument.save`). */
const SAVE_ROUNDS = 3;

/** How long a save waits for a webview to hand over edits it has accepted before it refuses to save (see `GameDocument.settleViews`). */
const DEFAULT_SETTLE_TIMEOUT_MS = 10_000;

function defaultSettleTimer(onExpire: () => void): { cancel(): void } {
  const timer = setTimeout(onExpire, DEFAULT_SETTLE_TIMEOUT_MS);
  return { cancel: () => clearTimeout(timer) };
}

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
  /** Native text documents live outside the shared model workspace; replacement/removal must refuse while one is open. */
  isTextDocumentOpen?(uri: Uri): boolean;
  /** Snapshot and restore a normal VS Code text editor through its native buffer and undo stack. */
  nativeTextDocument?(uri: Uri): Promise<{ readonly bytes: Uint8Array; readonly dirty: boolean } | null>;
  restoreNativeTextDocument?(uri: Uri, bytes: Uint8Array | null, expected: Uint8Array | null, groupId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string } | null>;
  /** Ask VS Code to save the editor for this URI, regardless of which editor has focus. */
  saveEditor(uri: Uri): Promise<Uri | undefined>;
  /** The URI of the project-relative `path` in `folder`. */
  uriFor(folder: WorkspaceFolderLike<Uri>, path: string): Uri;
  /**
   * Open the document at `uri` in an editor, as the workbench does for the file's own editor (a linked visit, a return,
   * the Game view). The workbench then asks the provider for the custom document, so the provider never opens a model for
   * a document the workbench is about to open (one model per identity, ADR 0022 D1.2).
   */
  openEditor(uri: Uri): Promise<void>;
  /** The board-editor preferences (T-33) in force in `folder`, from the host's own settings; the catalogue's defaults when the port gives none. */
  boardPreferences?(folder: WorkspaceFolderLike<Uri>): EditorPreferences;
  /** Call `listener` when the settings that make `boardPreferences` change; the returned handle stops it. */
  watchBoardPreferences?(folder: WorkspaceFolderLike<Uri>, listener: () => void): { dispose(): void };
  /**
   * Start the bound on a save's wait for a webview to hand over the edits it has accepted (#2613): `onExpire` is called
   * when the wait has lasted too long, and `cancel` stops it. A ten-second timer when the port gives none; a test
   * supplies a timer it expires by hand, so no proof depends on elapsed time.
   */
  startSettleTimer?(onExpire: () => void): { cancel(): void };
  /**
   * VS Code does not tell a custom editor why it is saving (ADR 0022 D12.10 item 3). When `files.autoSave` is
   * `afterDelay` for `uri`, this is its delay in milliseconds; otherwise `null`. A save is recorded as `auto` only when
   * this is not `null` and it arrives within that delay plus one second of the document's last accepted edit.
   */
  autoSaveDelayMs?(uri: Uri): number | null;
  /** The retention settings in force for `folder` (D12.8); the user's values only, never a workspace's (D6.3). */
  historyPolicy?(folder: WorkspaceFolderLike<Uri>): HistoryPolicy;
  /** The current time in milliseconds; `Date.now` when the port gives none. A test supplies its own so no proof depends on elapsed time. */
  now?(): number;
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
type DocumentChangeEvent = { readonly document: { readonly model: { readonly kind: string } } };

/** Give one registered custom-editor view type only the edits for its document kinds. */
export function eventsForDocumentKind<Event extends DocumentChangeEvent>(
  source: (listener: (event: Event) => unknown) => { dispose(): void },
  kinds: readonly string[],
): (listener: (event: Event) => unknown) => { dispose(): void } {
  return (listener) => source((event) => {
    if (kinds.includes(event.document.model.kind)) listener(event);
  });
}

/** The document kinds each custom-editor manifest view type is permitted to dirty. */
export const DOCUMENT_KINDS_BY_VIEW_TYPE = {
  "tkr.gameSettings": ["main", "character", "item"],
  "tkr.board": ["board"],
  "tkr.tileset": ["tileset"],
  "tkr.tileBitmap": ["tile-bitmap"],
  "tkr.animation": ["animation"],
} as const;

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
  readonly #previewRoot: ReturnType<typeof boardPreviewRootForPath>;
  readonly #navigation: DocumentNavigation<Uri>;
  readonly #port: GameEditorPort<Uri>;
  readonly #fire: (event: GameEditEvent<Uri>) => void;
  /** The webviews showing this document: each can be asked to hand over the edits it has accepted (#2613). */
  readonly #views = new Set<SettleTarget>();
  #nextSettle = 0;
  /** How many `saveCustomDocument` calls have finished, and the last one's result. */
  #saves = 0;
  #lastSave: SaveResult = { ok: true };
  /** When the document's latest accepted edit arrived and which edit that was, to tell an autosave from an explicit Save. */
  #lastEditAt = 0;
  #lastHead: string | null = null;
  /** Explicit Save commands from this editor's own Save button that have not finished; their saves are never `auto`. */
  #restoreGroupId: string | null = null;
  #explicitSaves = 0;

  #now(): number {
    return this.#port.now?.() ?? Date.now();
  }

  #saveReason(): HistoryReason {
    if (this.#explicitSaves > 0) return "manual";
    const delay = this.#port.autoSaveDelayMs?.(this.uri) ?? null;
    return delay !== null && this.#now() - this.#lastEditAt <= delay + 1000 ? "auto" : "manual";
  }

  constructor(uri: Uri, model: AnyDocument, workspace: DocumentWorkspace, fs: FileSystemService, navigation: DocumentNavigation<Uri>, port: GameEditorPort<Uri>, fire: (event: GameEditEvent<Uri>) => void, browserSession: BrowserSession) {
    this.uri = uri;
    this.model = model;
    this.capabilities = port.capabilities;
    this.browserSession = browserSession;
    this.#workspace = workspace;
    this.#fs = fs;
    this.#previewRoot = boardPreviewRootForPath(model.identity.path);
    this.#navigation = navigation;
    this.#port = port;
    this.#fire = fire;
    this.#lastEditAt = this.#now();
    this.#lastHead = model.getSnapshot().edits.at(-1)?.editId ?? null;
    model.subscribe(() => {
      const head = model.getSnapshot().edits.at(-1)?.editId ?? null;
      if (head !== this.#lastHead) {
        this.#lastHead = head;
        this.#lastEditAt = this.#now();
      }
    });
  }

  /** Hand an accepted edit to VS Code's undo stack; VS Code undoes it by its `editId` (AD-19). */
  didEdit(editId: string): void {
    const label = this.model.getSnapshot().edits.find((edit: { readonly editId: string; readonly label: string }) => edit.editId === editId)?.label ?? "Edit";
    this.#fire({ document: this, label, undo: () => { this.model.undo(editId); }, redo: () => { this.model.redo(editId); } });
  }

  /** VS Code disposes a custom document when its last editor closes; the workbench has already asked about unsaved work. */
  dispose(): void {
    this.#workspace.release(this.model);
  }

  /** Track a webview of this document; the returned function forgets it (its panel was disposed). */
  attachWebview(post: (requestId: string) => PromiseLike<boolean>): () => void {
    const target: SettleTarget = { post, waiting: new Map() };
    this.#views.add(target);
    return () => {
      this.#views.delete(target);
      // The view may have accepted edits before it disappeared. Without its answer we cannot claim they reached the
      // model, so a concurrent save/revert/backup must fail rather than proceed on a partial snapshot.
      for (const answer of [...target.waiting.values()]) answer(false);
    };
  }

  /** A webview answered a `settle` request: every edit it had accepted has reached this model. */
  viewSettled(requestId: string): void {
    for (const view of this.#views) view.waiting.get(requestId)?.(true);
  }

  /**
   * Ask every live webview of this document to hand over the edits it has accepted but not yet sent (a character edit
   * queued behind an unacknowledged one), and wait until each confirms. A successful answer means its earlier edit
   * messages reached this model. A timed-out, failed or disposed view is not proof of delivery, so save, backup, revert
   * and Save As refuse to proceed. `null` means every live view answered successfully.
   *
   * What this cannot reach: an edit still in transit from a webview that VS Code has not delivered when the workbench
   * asks this document to save, back up or close. VS Code gives no ordering between its own commands and a webview's
   * messages, and a view destroyed before it can be asked is no longer tracked. Those windows remain known gaps in
   * ADR 0022, #2613 and #2652.
   */
  async settleViews(): Promise<string | null> {
    const startTimer = this.#port.startSettleTimer ?? defaultSettleTimer;
    const answers = [...this.#views].map((view) => new Promise<boolean>((resolve) => {
      const requestId = `settle-${++this.#nextSettle}`;
      const timer = startTimer(() => answer(false));
      const answer = (settled: boolean): void => {
        timer.cancel();
        view.waiting.delete(requestId);
        resolve(settled);
      };
      view.waiting.set(requestId, answer);
      void view.post(requestId).then((delivered) => { if (!delivered) answer(false); }, () => answer(false));
    }));
    if ((await Promise.all(answers)).every((settled) => settled)) return null;
    return "the editor could not confirm that it handed over its accepted edits";
  }

  /** The board-editor preferences the webview reads (T-33). */
  boardPreferences(): EditorPreferences {
    const folder = this.#port.folderOf(this.uri);
    return folder === undefined ? DEFAULT_EDITOR_PREFERENCES : this.#port.boardPreferences?.(folder) ?? DEFAULT_EDITOR_PREFERENCES;
  }
  async initialBoardPath(): Promise<string | undefined> {
    const mains = this.#workspace.documents().filter((document) => document.kind === "main");
    const main = mains.length === 1 ? mains[0] : undefined;
    const folder = this.#port.folderOf(this.uri);
    if (main === undefined || folder === undefined) return undefined;
    const reference = asMainDocument(main).getSnapshot().settings.initBoard;
    if (reference === "") return undefined;
    const layout = await projectLayoutOfMain(this.#fs, folder.key, main.identity.path);
    return referencePath(layout, "boards", reference);
  }

  /** Follow a link from this document to the file at `path` in a new editor, remembering where it came from (story 11.4). */
  visit(path: string, reference = false): Promise<VisitOutcome> {
    return this.#navigation.visit(this, path, reference);
  }

  /** Go back to where the latest visit started. */
  returnFromVisit(): Promise<ReturnOutcome> {
    return this.#navigation.returnFromVisit(this);
  }
  setInitialBoard(path: string): Promise<ReturnOutcome> {
    return this.#navigation.setInitialBoard(this, path);
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

  /** The picture of a board or a tile bitmap, composed here from the project's files by the one compositor of its kind (AD-29); a webview reads no files. A board's request narrows it to the layers and background shown. */
  async preview(request?: BoardPreviewRequest): Promise<BoardPicture> {
    if (this.model.kind === "tile-bitmap") return previewTileBitmap(this.#fs, this.model.identity.projectId, this.model.serialize());
    if (this.model.kind !== "board") return { ok: false, message: `A ${this.model.kind} document has no picture.` };
    const preview = await previewBoard(this.#fs, this.model.identity.projectId, this.model.serialize(), { ...request, root: this.#previewRoot });
    return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings, objectBounds: preview.objectBounds } : preview;
  }
  /** Read a project-relative preview asset through this document's project-bound host filesystem. */
  readProject(path: string): Promise<PlatformResult<Uint8Array>> {
    return this.#fs.readProject(this.model.identity.projectId, path);
  }
  async animationAction(action: "commit" | "list" | "retry" | "restore" | "delete" | "ignore", id?: string, command?: AnimationCommand, bitmaps?: readonly AnimationBitmap[]): Promise<PlatformResult<CheckpointGroup | readonly CheckpointEntry[] | void>> {
    if (this.model.kind !== "animation") return platformError("invalid-request", "Open an animation to use this wizard.");
    const folder = this.#port.folderOf(this.uri);
    if (folder === undefined) return platformError("unavailable", "The animation's project is unavailable.");
    const env: CheckpointEnvironment = {
      fs: this.#fs, projectId: this.model.identity.projectId,
      hash: async (bytes) => [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      newId: () => globalThis.crypto.randomUUID(), time: () => new Date().toISOString(),
      guard: async (path, removing) => {
        if (this.#port.isTextDocumentOpen?.(this.#port.uriFor(folder, path)) === true) return `Save or resolve your work and close ${path} in its native text editor before replacing or removing it.`;
        const key = createDocumentIdentity(this.model.identity.projectId, path).key;
        const open = this.#workspace.documents().find((doc) => doc.identity.key === key);
        if (open === undefined) return null;
        const state = open.getSnapshot();
        return open === this.model && !removing && !state.dirty && !state.saving && state.conflict === null ? null : `Save or resolve your work and close ${path} before replacing or removing it.`;
      },
      consent: async (paths) => await this.#port.dialogs(folder).ask({ message: "Replace these files?", detail: `${paths.join(", ")}. Original contents remain in project recovery history.`, choices: [{ id: "replace", label: "Replace" }, { id: "cancel", label: "Cancel" }], cancel: "cancel" }) === "replace",
    };
    const authoring = createAnimationAuthoring(env, asAnimationDocument(this.model), async () => {
      const saved = await this.saveThroughWorkbench();
      return saved.ok ? platformOk(undefined) : platformError("io-error", saved.failure.message);
    }, (editId) => this.didEdit(editId));
    if (action === "list") return authoring.list();
    if (action === "ignore") return authoring.ignoreHistory();
    if (action === "commit") return command === undefined ? platformError("invalid-request", "Missing animation edit.") : authoring.commitAnimation(command, bitmaps ?? []);
    if (id === undefined) return platformError("invalid-request", "Missing recovery group.");
    return action === "delete" ? authoring.deleteGroup(id) : authoring[action](id);
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
    const unsettled = await this.settleViews();
    if (unsettled !== null) {
      const path = this.model.identity.path;
      const failed: SaveResult = { ok: false, failure: { document: path, kind: "write", code: null, message: `Could not save ${path}: ${unsettled}. Nothing was written and the edits it holds stay unsaved; save again.` } };
      this.#saves += 1;
      this.#lastSave = failed;
      return failed;
    }
    const reason = this.#saveReason();
    let result = await this.model.save(reason, { groupId: this.#restoreGroupId });
    for (let round = 1; result.ok && this.model.getSnapshot().dirty && round < SAVE_ROUNDS; round += 1) {
      result = await this.model.save(reason, { groupId: this.#restoreGroupId });
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
  async saveThroughWorkbench(groupId: string | null = null): Promise<SaveResult> {
    const path = this.model.identity.path;
    const before = this.#saves;
    const previousRestoreGroupId = this.#restoreGroupId;
    let accepted = false;
    try {
      this.#restoreGroupId = groupId;
      this.#explicitSaves += 1;
      accepted = (await this.#port.saveEditor(this.uri)) !== undefined;
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
    } finally {
      this.#explicitSaves -= 1;
      this.#restoreGroupId = previousRestoreGroupId;
    }
    if (!accepted && this.#saves !== before && !this.#lastSave.ok) return this.#lastSave;
    if (!accepted || this.#saves === before) {
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

/** One webview of a document, and the `settle` requests it has not yet answered. */
interface SettleTarget {
  post(requestId: string): PromiseLike<boolean>;
  readonly waiting: Map<string, (settled: boolean) => void>;
}

/** What a document can ask of the provider for navigation: the project-wide parts of story 11.4. */
interface DocumentNavigation<Uri extends UriLike> {
  visit(origin: GameDocument<Uri>, path: string, reference: boolean): Promise<VisitOutcome>;
  returnFromVisit(origin: GameDocument<Uri>): Promise<ReturnOutcome>;
  setInitialBoard(origin: GameDocument<Uri>, path: string): Promise<ReturnOutcome>;
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
  /** The project workspace and files of a folder, for a host view outside a custom editor (the History command, #2833). */
  returnFromLinkedVisit(uri: Uri): Promise<ReturnOutcome>;
  /** The project workspace and files of a folder, for a host view outside a custom editor. */
  workspaceFor(folder: WorkspaceFolderLike<Uri>): { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace };
}

/** Make the provider. `fire` is `onDidChangeCustomDocument`'s emitter. */
export function createGameEditorProvider<Uri extends UriLike>(port: GameEditorPort<Uri>, fire: (event: GameEditEvent<Uri>) => void): GameEditorProvider<Uri> {
  const workspaces = new Map<string, { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace; readonly visits: Visits; readonly browserSession: BrowserSession }>();
  const hostDocuments = new WeakMap<AnyDocument, GameDocument<Uri>>();
  const createWorkspace = (folder: WorkspaceFolderLike<Uri>, fs: FileSystemService): DocumentWorkspace => {
    const policy = port.historyPolicy;
    return createDocumentWorkspace({
      projectId: folder.key,
      services: { fs, dialogs: port.dialogs(folder), capabilities: new Set(port.capabilities) },
      ...(policy === undefined ? {} : { historyPolicy: () => policy.call(port, folder) }),
      externalHistory: {
        current: async (path) => await port.nativeTextDocument?.(port.uriFor(folder, path)) ?? null,
        apply: async (path, bytes, expected, groupId) => await port.restoreNativeTextDocument?.(port.uriFor(folder, path), bytes, expected, groupId) ?? null,
      },
      settleOpenDocument: async (model) => {
        const document = hostDocuments.get(model);
        return document === undefined || await document.settleViews() === null;
      },
      restoreOpenDocument: async (model, editId, groupId) => {
        const document = hostDocuments.get(model);
        if (document === undefined) return model.save("manual", { groupId });
        document.didEdit(editId);
        return document.saveThroughWorkbench(groupId);
      },
    });
  };
  type Project = { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace; readonly visits: Visits; readonly browserSession: BrowserSession; readonly path: string };
  const projectIn = (folder: WorkspaceFolderLike<Uri>, uri: Uri): Project => {
    let project = workspaces.get(folder.key);
    if (project === undefined) {
      const fs = port.fileSystem(folder);
      const workspace = createWorkspace(folder, fs);
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

  const workspaceFor = (folder: WorkspaceFolderLike<Uri>): { readonly fs: FileSystemService; readonly workspace: DocumentWorkspace } => {
    const existing = workspaces.get(folder.key);
    if (existing !== undefined) return existing;
    const fs = port.fileSystem(folder);
    const workspace = createWorkspace(folder, fs);
    const project = { fs, workspace, visits: createVisits(workspace), browserSession: createBrowserSession() };
    workspaces.set(folder.key, project);
    return project;
  };

  const navigation: DocumentNavigation<Uri> = {
    async visit(origin, path, reference) {
      const folder = folderOfDocument(origin);
      const project = projectIn(folder, origin.uri);
      const kind = kindForPath(path);
      if (kind === null) return { ok: false, message: `${path} has no registered editor, so there is nothing to visit.` };
      let target = path;
      if (reference) {
        if (kind.id !== "board" && kind.id !== "program" && kind.id !== "item" && kind.id !== "character" && kind.id !== "tile-bitmap") {
          return { ok: false, message: "This value is inline code or has no linked asset editor. Its text has not been changed." };
        }
        const assetKind = kind.id === "board" ? "boards" : kind.id === "program" ? "programs" : kind.id === "item" ? "items" : kind.id === "character" ? "characters" : "bitmaps";
        const openMain = project.workspace.documents().filter((document) => document.kind === "main");
        const mainPaths = openMain.map((document) => document.identity.path);
        if (mainPaths.length === 0) {
          const search = [""];
          const seen = new Set<string>();
          while (search.length > 0) {
            const directory = search.pop()!;
            if (seen.has(directory)) continue;
            seen.add(directory);
            const listing = await project.fs.list(directory);
            if (!listing.ok) return { ok: false, message: `Could not find the owning game file: ${listing.error.message}` };
            for (const entry of listing.value) {
              const candidate = directory === "" ? entry.name : `${directory}/${entry.name}`;
              if (entry.kind === "directory") search.push(candidate);
              else if (entry.kind === "file" && candidate.toLowerCase().endsWith(".gam")) mainPaths.push(candidate);
            }
          }
        }
        if (mainPaths.length === 0) return { ok: false, message: "This project has no main game file, so the link cannot be resolved." };
        const mainPath = mainPaths.length === 1 ? mainPaths[0] : await port.quickPick(mainPaths.map((candidate) => ({ id: candidate, label: candidate })), "Choose the owning main game file");
        if (mainPath === undefined) return { ok: false, message: "Linked-file navigation cancelled." };
        const layout = await projectLayoutOfMain(project.fs, folder.key, mainPath);
        target = referencePath(layout, assetKind, path);
      }
      const resolved = await resolveDocumentPath(project.fs, target);
      if (!resolved.ok) return { ok: false, message: resolved.kind === "case-conflict" ? resolved.message : `Could not check ${path}: ${resolved.error.message}` };
      if (!resolved.exists) return { ok: false, message: `${path} is not in the project, so there is nothing to visit.` };
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
    async setInitialBoard(origin, boardPath) {
      const folder = folderOfDocument(origin);
      const project = projectIn(folder, origin.uri);
      const openMain = project.workspace.documents().filter((document) => document.kind === "main");
      const mainPaths: string[] = [];
      if (openMain.length === 0) {
        const search = [""];
        const seen = new Set<string>();
        while (search.length > 0) {
          const directory = search.pop()!;
          if (seen.has(directory)) continue;
          seen.add(directory);
          const listing = await project.fs.list(directory);
          if (!listing.ok) return { ok: false, message: `Could not find the owning game file: ${listing.error.message}` };
          for (const entry of listing.value) {
            const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
            if (entry.kind === "directory") search.push(path);
            else if (entry.kind === "file" && path.toLowerCase().endsWith(".gam")) mainPaths.push(path);
          }
        }
      }
      const choices = openMain.length > 0 ? openMain.map((document) => document.identity.path) : mainPaths;
      if (choices.length === 0) return { ok: false, message: "This project has no main game file, so the initial board cannot be changed." };
      const selected = choices.length === 1 ? choices[0] : await port.quickPick(choices.map((path) => ({ id: path, label: path })), "Choose the owning main game file");
      if (selected === undefined) return { ok: false, message: "Initial-board change cancelled; no file was changed." };
      const layout = await projectLayoutOfMain(project.fs, folder.key, selected);
      const boardLink = linkFor(layout, "boards", boardPath);
      if (!boardLink.inside) return { ok: false, message: `${boardPath} is not inside this game's Boards folder, so it cannot be set as the initial board.` };
      try {
        await port.openEditor(port.uriFor(folder, selected));
      } catch (error) {
        return { ok: false, message: `${selected} could not be opened: ${error instanceof Error ? error.message : String(error)}` };
      }
      const opened = await project.workspace.open(selected);
      if (!opened.ok) return { ok: false, message: `${selected}: ${opened.error.kind === "read" || opened.error.kind === "format" ? opened.error.error.message : opened.error.message}` };
      if (opened.document.kind !== "main") return { ok: false, message: `${selected} is not a supported main game file.` };
      const owner = hostDocuments.get(opened.document);
      if (owner === undefined) return { ok: false, message: `${selected} is not open in its game editor, so its undo history cannot be updated safely.` };
      const result = await opened.document.apply({ type: "apply-settings", changes: { initBoard: boardLink.reference } });
      if (!result.ok) return { ok: false, message: result.rejection.message };
      owner.didEdit(result.editId);
      return { ok: true, path: selected, message: `Changed ${selected}'s initial board. Save the main game file separately.` };
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
        // The recovered document keeps its history sink, so a recovered save still keeps the version it replaces (D12.10 items 4 and 5).
        const recovered = await recoverDocument(kind, workspace.storage, identity, await port.readBackup(backupId));
        if (!recovered.ok) throw new Error(`${nameOf(uri)}: ${recovered.error.error.message}`);
        if (!workspace.adopt(recovered.document)) throw new Error(`${path} is already open in another editor under another spelling.`);
        const document = new GameDocument(uri, recovered.document, workspace, fs, navigation, port, fire, browserSession);
        hostDocuments.set(document.model, document);
        return document;
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
      const document = new GameDocument(uri, opened.document, workspace, fs, navigation, port, fire, browserSession);
      hostDocuments.set(document.model, document);
      return document;
    },
    async saveCustomDocument(document) {
      const result = await document.save();
      if (!result.ok) throw new Error(result.failure.message);
    },
    async saveCustomDocumentAs(document, destination) {
      // VS Code's save dialog has already chosen the destination and confirmed replacing an existing file (D3.4).
      // Edits the webview accepted but has not sent are part of the copy (#2613).
      const unsettled = await document.settleViews();
      if (unsettled !== null) throw new Error(`Could not save ${nameOf(destination)}: ${unsettled}. Nothing was written.`);
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
      // Save As through the workspace's storage, so an existing destination keeps its prior bytes in history (D12.10 items 4 and 6).
      const result = await document.model.saveAs(project.workspace.storage, identity);
      if (!result.ok) throw new Error(result.failure.message);
      if (!sameRevision(document.model.getSnapshot(), copied)) {
        throw new Error(`${resolved.path} was written, but ${document.model.identity.path} changed during Save As and remains open with its work.`);
      }
    },
    async revertCustomDocument(document) {
      // VS Code's Revert File is itself the user's choice to discard; the workbench asks nothing more and drops its own
      // edits after the save point, which `revert` mirrors (D3.6). First require every live webview to hand over its
      // accepted edits; if that cannot be confirmed, leave the model untouched.
      const unsettled = await document.settleViews();
      if (unsettled !== null) throw new Error(`Could not revert ${document.model.identity.path}: ${unsettled}. Nothing was reverted.`);
      const result = await document.model.revert();
      if (!result.ok) throw new Error(result.failure.message);
    },
    async backupCustomDocument(document, destination) {
      const unsettled = await document.settleViews();
      if (unsettled !== null) throw new Error(`Could not back up ${document.model.identity.path}: ${unsettled}. No backup was written.`);
      const id = await port.writeBackup(destination, document.model.serialize());
      return { id, delete: () => port.deleteBackup(destination) };
    },
    async returnFromLinkedVisit(uri) {
      const folder = port.folderOf(uri);
      if (folder === undefined) return { ok: false, message: "The active file is outside an open project." };
      const project = projectIn(folder, uri);
      const returned = project.visits.end();
      if (returned === null) return { ok: false, message: "There is no visit to return from." };
      const wasOpen = project.workspace.documents().some((document) => document.identity.path === returned.originPath);
      try {
        await port.openEditor(port.uriFor(folder, returned.originPath));
      } catch (error) {
        return { ok: false, message: `${returned.originPath} could not be opened: ${error instanceof Error ? error.message : String(error)}` };
      }
      return { ok: true, path: returned.originPath, message: wasOpen ? null : `${returned.originPath} was reopened.` };
    },
    workspaceFor,
    resolveCustomEditor(document, webview) {
      const publish = () => { void webview.postMessage({ type: "snapshot", snapshot: document.model.getSnapshot() }); };
      const subscription = document.model.subscribe(publish);
      const browserSubscription = document.browserSession.subscribe((changes) => {
        void webview.postMessage({ type: "browser-state", changes });
      });
      const folder = port.folderOf(document.uri);
      const preferenceWatch = folder === undefined ? undefined : port.watchBoardPreferences?.(folder, () => {
        void webview.postMessage({ type: "board-preferences", preferences: document.boardPreferences() });
      });
      const detach = document.attachWebview((requestId) => webview.postMessage({ type: "settle", requestId }));
      const messages = webview.onDidReceiveMessage(async (message: unknown) => {
        if (!isEditorHostRequest(message)) return;
        await handleEditorHostRequest(document, message, (reply) => webview.postMessage(reply));
      });
      const disposal = webview.onDidDispose(() => {
        subscription();
        detach();
        browserSubscription();
        preferenceWatch?.dispose();
        messages.dispose();
        disposal.dispose();
      });
    },
  };
}
