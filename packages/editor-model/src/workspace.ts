import { foldPath, toSlashes } from "@tk-reawakened/core";
import { platformError, platformOk, type Disposable, type DocumentService, type FileSystemService, type PlatformError, type PlatformServices } from "@tk-reawakened/platform-services";
import { createDocumentIdentity } from "./identity.ts";
import type { DocumentHistorySink, DocumentSnapshot, DocumentStorage, HistoryResult, OpenError, RevertFailure, SaveFailure, SaveResult } from "./binary-document.ts";
import { kindById, kindForPath, type AnyDocument } from "./kinds.ts";
import { createPendingEdits, type PendingEdits } from "./pending-edits.ts";
import { createDocumentHistoryStore, createMemoryHistoryStorage, sha256Hex, type DocumentHistoryOptions, type DocumentHistoryStore, type GroupRestoreReport, type HistoryPolicy, type HistoryReason, type HistoryRestorer } from "./document-history.ts";
import { createCheckpointGroups, type CheckpointGroup, type CheckpointGroups, type CheckpointTarget, type CheckpointUncovered } from "./checkpoint-groups.ts";
import { DEFAULT_HISTORY_POLICY } from "./history-policy.ts";
import { openHistoryPreview, type HistoryPreviewOpen } from "./history-support.ts";

/**
 * The documents a host has open in one project, and the lifecycle around them that ADR 0022 D3 promises in every host:
 * one model per document identity (D1.2), undo and redo by `editId` (AD-19), save all with a result per document (D4.1),
 * close and revert that confirm a possible loss (D3.6), Save As to a new identity (D1.3, D3.4), and watching for changes
 * made by other programs where the host can (D3.5). It is DOM-free and framework-free, so the browser host and the
 * desktop host use it as their workbench; VS Code has its own workbench and uses only the parts its custom editor
 * provider needs (`open`, `release` and the watch).
 */

/**
 * Whether two snapshots of one document show the same revision: the same edits in force (an `editId` is never reused)
 * and the same waiting external change. Save progress (`saving`, `saveError`, `dirty`) is not part of a revision, so a
 * save of the same revision finishing in between does not count as a change.
 */
export function sameRevision(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return a.edits.length === b.edits.length && a.edits.at(-1)?.editId === b.edits.at(-1)?.editId && a.conflict === b.conflict;
}

/** Where a project-relative path leads, spelled as the project stores it (ADR 0022 D1.2). */
export type PathResolution =
  /** `path` is the stored spelling of every part that exists, and the requested spelling of the rest. */
  | { readonly ok: true; readonly path: string; readonly exists: boolean }
  /** Two entries in one folder differ only in case, so the path names neither: the caller opens nothing. */
  | { readonly ok: false; readonly kind: "case-conflict"; readonly paths: readonly string[]; readonly message: string }
  | { readonly ok: false; readonly kind: "read"; readonly error: PlatformError };

/**
 * Find the spelling the project stores for `path`, comparing each part ASCII-folded (ADR 0022 D1.1). Two entries of one
 * folder that differ only in case are a conflict that names both, and are never opened as two documents (D1.2).
 */
export async function resolveDocumentPath(fs: Pick<FileSystemService, "list">, path: string): Promise<PathResolution> {
  const parts = toSlashes(path).split("/");
  let folder = "";
  for (let index = 0; index < parts.length; index += 1) {
    const listed = await fs.list(folder);
    const rest = parts.slice(index).join("/");
    if (!listed.ok) {
      if (listed.error.code === "not-found") return { ok: true, path: joinPath(folder, rest), exists: false };
      return { ok: false, kind: "read", error: listed.error };
    }
    const wanted = foldPath(parts[index]!);
    const matches = listed.value.filter((entry) => foldPath(entry.name) === wanted);
    if (matches.length > 1) {
      const paths = matches.map((entry) => joinPath(folder, entry.name)).sort();
      return {
        ok: false,
        kind: "case-conflict",
        paths,
        message: `${paths.join(" and ")} differ only in case, so the editor cannot tell which one ${path} means. Rename one of them.`,
      };
    }
    const match = matches[0];
    if (match === undefined) return { ok: true, path: joinPath(folder, rest), exists: false };
    folder = joinPath(folder, match.name);
  }
  return { ok: true, path: folder, exists: true };
}

export type WorkspaceOpenError =
  | OpenError
  | { readonly kind: "case-conflict"; readonly document: string; readonly paths: readonly string[]; readonly message: string }
  /** No registered kind claims the extension (ADR 0026 decision 1); nothing is read. */
  | { readonly kind: "unsupported"; readonly document: string; readonly message: string };

export type WorkspaceOpenResult =
  | { readonly ok: true; readonly document: AnyDocument }
  | { readonly ok: false; readonly error: WorkspaceOpenError };

/** One document's outcome in Save All: each document saves or fails on its own (D4.1). */
export interface SaveAllEntry {
  readonly document: string;
  readonly result: SaveResult;
}

export type CloseResult =
  | { readonly closed: true }
  | { readonly closed: false; readonly reason: "cancelled" }
  /** The user chose to save and the save failed: the document stays open with its work (D3.3). */
  | { readonly closed: false; readonly reason: "save-failed"; readonly failure: SaveFailure };

/** A view's ownership of a workspace document. Disposing a view alone never closes its document. */
export interface DocumentViewLease {
  close(): Promise<CloseResult>;
  dispose(): void;
}

export type RevertOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "failed"; readonly failure: RevertFailure };

/** Why Save As did not finish; the source document is unchanged and nothing is reported as saved (D3.4). */
export interface SaveAsFailure {
  /** The destination, or the source when the destination was never chosen. */
  readonly document: string;
  readonly message: string;
}

export type SaveAsOutcome =
  | { readonly ok: true; readonly document: AnyDocument }
  | { readonly ok: false; readonly reason: "cancelled" }
  | { readonly ok: false; readonly reason: "failed"; readonly failure: SaveAsFailure };

export interface DocumentWorkspace {
  /** The `document` service to give this host's views: every accepted edit it hears of is undone by its `editId` (AD-19). */
  readonly document: DocumentService;
  /** Open the document at `path`, or return the open one whose identity it folds to (D1.2). */
  open(path: string): Promise<WorkspaceOpenResult>;
  /**
   * Make a document created outside `open` (a recovered backup) the one model of its identity. `false`, and nothing
   * registered, when another model already holds that identity (D1.2).
   */
  adopt(document: AnyDocument): boolean;
  /** The open documents, in the order they were opened. */
  documents(): readonly AnyDocument[];
  /**
   * What the views of `document` have submitted but not yet received results for (#2613). Views register their in-flight
   * work here; Save All, close, revert and Save As wait for those requests before acting on the whole document.
   */
  pendingEdits(document: AnyDocument): PendingEdits;
  /** Undo the latest edit this host heard of that is still in force, by its `editId`. */
  undo(document: AnyDocument): HistoryResult;
  /** Redo the latest undone edit, by its `editId`. */
  redo(document: AnyDocument): HistoryResult;
  /** Per-document history entries; checkpoint groups use the shared canonical checkpoint service below. */
  readonly history: DocumentHistoryStore;
  /** The single canonical per-project group store used by wizards, recovery views, and named checkpoints. */
  readonly checkpoints: CheckpointGroups;
  /** The storage every document of this workspace is opened with; it carries the history sink, so a host that makes a document itself (a recovered backup) must use it. */
  readonly storage: DocumentStorage;
  /** Restore one saved timeline entry as an accepted edit and a canonical before-restore group. */
  restoreHistoryEntry(entryId: string): Promise<GroupRestoreReport>;
  /** Restore one canonical checkpoint group, reporting every member independently. */
  restoreHistoryGroup(groupId: string, options?: { readonly only?: readonly string[]; readonly deleteUncertain?: readonly string[] }): Promise<GroupRestoreReport>;
  /** Create one named snapshot of covered project files; uncovered files are listed on that same group. */
  createNamedCheckpoint(name: string): Promise<CheckpointGroup>;
  /** A read-only document over saved bytes, for a view of the same editor to show (D12.10 item 13). It never edits, saves or reads the project. */
  openHistoryPreview(path: string, bytes: Uint8Array, description: string): HistoryPreviewOpen;
  /** Save every dirty document, one after another, and report each (D4.1: there is no all-or-nothing save). */
  saveAll(reason?: HistoryReason): Promise<readonly SaveAllEntry[]>;
  /** Close a document with no attached views, asking before losing work; attached views close through their leases. */
  close(document: AnyDocument): Promise<CloseResult>;
  /** Track a mounted view; close its lease to close that view without releasing models used by other views. */
  attachView(document: AnyDocument): DocumentViewLease;
  /** Forget a document without asking: the host has already asked (VS Code's workbench), or nothing can be lost. */
  release(document: AnyDocument): void;
  /** Go back to the file on disk, asking first when that discards unsaved work (D3.6). */
  revert(document: AnyDocument): Promise<RevertOutcome>;
  /** Save a copy under a new name chosen through `dialogs`, open it as a new identity, and close the source (D1.3, D3.4). */
  saveAs(document: AnyDocument): Promise<SaveAsOutcome>;
  /** Stop watching and forget every document. */
  dispose(): void;
}

export interface ExternalHistoryDocument {
  readonly bytes: Uint8Array;
  readonly dirty: boolean;
}

export interface ExternalHistoryAdapter {
  current(path: string): Promise<ExternalHistoryDocument | null>;
  /** Return null when the path has no open host-owned document. */
  apply(path: string, bytes: Uint8Array | null, expected: Uint8Array | null, groupId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string } | null>;
}

export interface WorkspaceOptions {
  /** The project handle every identity in this workspace is bound to (ADR 0022 D1.1). */
  readonly projectId: string;
  readonly services: Pick<PlatformServices, "fs" | "dialogs" | "capabilities">;
  /** The retention settings in force (D12.8), read at each save and merge. Defaults to the recorded defaults. */
  readonly historyPolicy?: () => HistoryPolicy;
  /** A host's own durable storage for history when the project folder cannot hold it (D12.10 item 8). */
  readonly historyStorage?: { readonly fs: DocumentHistoryOptions["storage"]; readonly description: string };
  /** Settle host-owned views before a shared History restore reads or changes an open document. */
  readonly settleOpenDocument?: (document: AnyDocument) => Promise<boolean>;
  /** Route an accepted History restore through the host's undo and save lifecycle. */
  readonly restoreOpenDocument?: (document: AnyDocument, editId: string, groupId: string) => Promise<SaveResult>;
  /** Keep ordinary host-owned text editors authoritative during History and wizard restores. */
  readonly externalHistory?: ExternalHistoryAdapter;
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/** A Save As of a document whose kind is no longer registered cannot be reopened. */
type ReopenFailure = { readonly ok: false; readonly error: { readonly document: string; readonly error: { readonly message: string } } };
const UNKNOWN_KIND: ReopenFailure = { ok: false, error: { document: "", error: { message: "its kind is not registered" } } };

interface HostHistory {
  readonly undo: string[];
  readonly redo: string[];
}

/** Where this workspace keeps history and under which rules (ADR 0022 D12.10 item 8). */
function historyOptions(options: WorkspaceOptions): DocumentHistoryOptions {
  const { fs, capabilities } = options.services;
  const base = { project: fs, policy: options.historyPolicy ?? (() => DEFAULT_HISTORY_POLICY), coveredType: (path: string) =>
    kindForPath(path) !== null || (path.toLowerCase().startsWith("bitmap/.tkr-generated/") && path.toLowerCase().endsWith(".png")) };
  if (options.historyStorage !== undefined) return { ...base, storage: options.historyStorage.fs, location: { kind: "host-storage", description: options.historyStorage.description } };
  if (capabilities.has("folderWrite")) return { ...base, storage: fs, location: { kind: "project-folder", description: "Kept in the project's .tkr-history folder, so it travels with the project." } };
  return { ...base, storage: createMemoryHistoryStorage(), location: { kind: "session-memory", description: "History for this session copy is kept only in this page and is lost when the page closes or the browser clears it." } };
}

/** Make the workspace of one project. */
export function createDocumentWorkspace(options: WorkspaceOptions): DocumentWorkspace {
  const { projectId, services } = options;
  const { fs, dialogs } = services;
  const historyConfiguration = historyOptions(options);
  const historyStore = createDocumentHistoryStore(historyConfiguration);
  const sink: DocumentHistorySink = {
    async keepBeforeWrite(path, previous, reason) {
      if (previous === null) return { ok: true };
      try { await historyStore.keep(path, previous, reason); return { ok: true }; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        historyStore.reportProblem(path, message);
        return { ok: false, message };
      }
    },
    async recorded(path, bytes, reason, groupId) {
      try { await historyStore.recordSave(path, bytes, reason, groupId); historyStore.clearProblems(path); return { ok: true }; }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        historyStore.reportProblem(path, `${path} was saved, but its history could not be recorded: ${message}`);
        return { ok: false, message };
      }
    },
  };
  const documentStorage: DocumentStorage = { readProject: fs.readProject.bind(fs), writeProject: fs.writeProject.bind(fs), history: sink };
  const documents = new Map<string, AnyDocument>();
  const opening = new Map<string, Promise<WorkspaceOpenResult>>();
  const savingAs = new Map<string, Promise<void>>();
  const histories = new Map<string, HostHistory>();
  const views = new Map<AnyDocument, Set<DocumentViewLease>>();
  const pendingByDocument = new Map<AnyDocument, PendingEdits>();
  let watch: Promise<Disposable | null> | null = null;
  let disposed = false;

  const pendingEditsOf = (document: AnyDocument): PendingEdits => {
    let edits = pendingByDocument.get(document);
    if (edits === undefined) {
      edits = createPendingEdits();
      pendingByDocument.set(document, edits);
    }
    return edits;
  };

  const historyOf = (key: string): HostHistory => {
    let history = histories.get(key);
    if (history === undefined) {
      history = { undo: [], redo: [] };
      histories.set(key, history);
    }
    return history;
  };

  // Only a host that declares `fileWatch` is asked to watch; the others detect a change when they save (D3.5, D11.3).
  const startWatching = (): void => {
    if (watch !== null || !services.capabilities.has("fileWatch")) return;
    watch = fs.watch("", (change) => {
      const changed = foldPath(change.path);
      for (const document of documents.values()) {
        if (foldPath(document.identity.path) === changed) void document.checkExternal();
      }
    }).then((result) => {
      if (!result.ok) return null;
      if (disposed) {
        result.value.dispose();
        return null;
      }
      return result.value;
    });
  };

  const open = async (path: string): Promise<WorkspaceOpenResult> => {
    const resolved = await resolveDocumentPath(fs, path);
    if (!resolved.ok) {
      if (resolved.kind === "case-conflict") {
        return { ok: false, error: { kind: "case-conflict", document: path, paths: resolved.paths, message: resolved.message } };
      }
      return { ok: false, error: { kind: "read", document: path, error: resolved.error } };
    }
    const identity = createDocumentIdentity(projectId, resolved.path);
    const copyInProgress = savingAs.get(identity.key);
    if (copyInProgress !== undefined) {
      await copyInProgress;
      return open(path);
    }
    const existing = documents.get(identity.key);
    if (existing !== undefined) return { ok: true, document: existing };
    // Two opens of one document at once share one read and one model.
    const pending = opening.get(identity.key);
    if (pending !== undefined) return pending;
    const kind = kindForPath(identity.path);
    if (kind === null) {
      return { ok: false, error: { kind: "unsupported", document: identity.path, message: `${identity.path} is not a file type the editor opens.` } };
    }
    const reading = kind.open(documentStorage, identity).then((opened): WorkspaceOpenResult => {
      opening.delete(identity.key);
      if (!opened.ok || disposed) return opened;
      documents.set(identity.key, opened.document);
      startWatching();
      return opened;
    });
    opening.set(identity.key, reading);
    return reading;
  };

  const release = (document: AnyDocument): void => {
    const key = document.identity.key;
    if (documents.get(key) !== document) return;
    documents.delete(key);
    histories.delete(key);
    pendingByDocument.delete(document);
  };

  const closeDocument = async (document: AnyDocument, view?: DocumentViewLease): Promise<CloseResult> => {
    const attached = views.get(document);
    if (view !== undefined && !attached?.has(view)) return { closed: true };
    if (view !== undefined && attached !== undefined && attached.size > 1) {
      attached.delete(view);
      return { closed: true };
    }
    // A document-level close cannot invalidate a model still owned by views.
    if (view === undefined && attached !== undefined && attached.size > 0) return { closed: false, reason: "cancelled" };
    // Complete every submitted request before deciding whether this document is dirty and what to ask about.
    await pendingEditsOf(document).settle();
    const snapshot = document.getSnapshot();
    if (documents.get(document.identity.key) === document && (snapshot.dirty || snapshot.conflict !== null)) {
      const path = document.identity.path;
      const answer = await dialogs.ask({
        message: `Save the changes to ${path} before closing it?`,
        detail: "If you close it without saving, the changes are lost.",
        choices: [
          { id: "save", label: "Save" },
          { id: "discard", label: "Don't save" },
          { id: "cancel", label: "Cancel" },
        ],
        cancel: "cancel",
      });
      if (answer === "cancel") return { closed: false, reason: "cancelled" };
      if (answer === "save") {
        // An edit accepted while the question was open is saved with the rest.
        await pendingEditsOf(document).settle();
        const saved = await document.save();
        if (!saved.ok) return { closed: false, reason: "save-failed", failure: saved.failure };
        const current = document.getSnapshot();
        if (current.dirty || current.conflict !== null) return { closed: false, reason: "cancelled" };
      }
    }
    // Another view may have opened while a dialog or save was pending.
    const currentViews = views.get(document);
    if (view !== undefined) currentViews?.delete(view);
    if (currentViews !== undefined && currentViews.size > 0) {
      return view === undefined ? { closed: false, reason: "cancelled" } : { closed: true };
    }
    release(document);
    return { closed: true };
  };

  /** The restorer the history store drives: open documents take a restore as an accepted edit, other files are written. */
  const restorer = (): HistoryRestorer => ({
    async current(path) {
      const open = documents.get(createDocumentIdentity(projectId, path).key);
      if (open !== undefined && open.getSnapshot().readOnly === null) {
        if (options.settleOpenDocument !== undefined && !await options.settleOpenDocument(open)) return { ok: false, message: "The host could not settle the open editor's accepted edits; nothing was restored." };
        await pendingEditsOf(open).settle();
        return { ok: true, bytes: open.serialize(), unsaved: open.getSnapshot().dirty };
      }
      const external = await options.externalHistory?.current(path);
      if (external !== null && external !== undefined) return { ok: true, bytes: external.bytes.slice(), unsaved: external.dirty };
      const read = await fs.readProject(projectId, path);
      if (read.ok) return { ok: true, bytes: read.value, unsaved: false };
      return read.error.code === "not-found" ? { ok: true, bytes: null, unsaved: false } : { ok: false, message: read.error.message };
    },
    async apply(path, bytes, context) {
      const open = documents.get(createDocumentIdentity(projectId, path).key);
      // Whatever the restore captured must still be the current content: a document opened or edited while the restore
      // recorded its history is never overwritten (D12.10 item 9).
      const changed = (): { readonly ok: false; readonly message: string } => ({ ok: false, message: `${path} changed after the restore started, so it was not restored. Choose the version again.` });
      if (open !== undefined) {
        if (bytes === null) return { ok: false, message: `${path} is open. Close it, then retry the restore to remove it.` };
        if (options.settleOpenDocument !== undefined && !await options.settleOpenDocument(open)) return { ok: false, message: "The host could not settle the open editor's accepted edits; nothing was restored." };
        await pendingEditsOf(open).settle();
        if (!sameBytes(open.serialize(), context.expected)) return changed();
        const applied = open.restoreVersion(bytes);
        if (!applied.ok) return { ok: false, message: applied.rejection.message };
        const edits = historyOf(open.identity.key);
        edits.undo.push(applied.editId);
        edits.redo.length = 0;
        const saved = options.restoreOpenDocument === undefined
          ? await open.save("manual", { groupId: context.groupId })
          : await options.restoreOpenDocument(open, applied.editId, context.groupId);
        return saved.ok ? { ok: true } : { ok: false, message: `The restored version of ${path} is applied in the editor but could not be saved: ${saved.failure.message}` };
      }
      const external = await options.externalHistory?.apply(path, bytes, context.expected, context.groupId);
      if (external !== null && external !== undefined) return external;
      const onDisk = await fs.readProject(projectId, path);
      const actual = onDisk.ok ? onDisk.value : onDisk.error.code === "not-found" ? null : undefined;
      if (actual === undefined) return { ok: false, message: `Could not check ${path} before restoring it: ${onDisk.ok ? "" : onDisk.error.message}` };
      // A document opened while this read was in flight is the editor's to change: writing the file now would bypass its
      // dirty state and its own accepted edits, so the restore refuses and asks for it again (D12.10 item 9).
      const externalOpened = await options.externalHistory?.current(path);
      if (documents.get(createDocumentIdentity(projectId, path).key) !== undefined || externalOpened !== null && externalOpened !== undefined) {
        return { ok: false, message: `${path} was opened while the restore was checking it, so it was not restored. Choose the version again.` };
      }
      if (!sameBytes(actual, context.expected)) return changed();
      if (bytes === null) {
        const removed = await fs.deleteProject(projectId, path);
        return removed.ok ? { ok: true } : { ok: false, message: removed.error.message };
      }
      const written = await fs.writeProject(projectId, path, bytes);
      if (!written.ok) return { ok: false, message: written.error.message };
      try {
        await historyStore.recordSave(path, bytes, "manual", context.groupId);
        // The checkpoint manifest already contains the restore's exact after hash and serves as ownership proof.
      }
      catch (error) { return { ok: false, message: `${path} was restored, but its history could not be recorded: ${error instanceof Error ? error.message : String(error)}` }; }
      return { ok: true };
    },
  });
  /** Ask once before a restore replaces unsaved work and capture the exact bytes that confirmation covered. */
  const confirmUnsaved = async (paths: readonly string[]): Promise<ReadonlyMap<string, Uint8Array | null> | null> => {
    for (const path of paths) {
      const open = documents.get(createDocumentIdentity(projectId, path).key);
      if (open !== undefined) await pendingEditsOf(open).settle();
    }
    const expected = new Map<string, Uint8Array | null>();
    const dirty: string[] = [];
    for (const path of paths) {
      const current = await restorer().current(path);
      if (!current.ok) throw new Error(current.message);
      expected.set(path, current.bytes?.slice() ?? null);
      if (current.unsaved) dirty.push(path);
    }
    if (dirty.length === 0) return expected;
    const answer = await dialogs.ask({
      message: `${dirty.join(", ")} ${dirty.length === 1 ? "has" : "have"} unsaved changes.`,
      detail: "Restore keeps your unsaved version in history first, then replaces it with the restored version. Cancel changes nothing.",
      choices: [{ id: "restore", label: "Restore" }, { id: "cancel", label: "Cancel" }],
      cancel: "cancel",
    });
    return answer === "restore" ? expected : null;
  };
  const declined = (groupId: string, paths: readonly string[]): GroupRestoreReport => ({ groupId, restoreGroupId: null, files: paths.map((path) => ({ path, result: "failed" as const, message: "Cancelled: nothing was changed." })) });
  let checkpointSequence = 0;
  const checkpoints = createCheckpointGroups({
    fs,
    storage: historyConfiguration.storage,
    projectId,
    hash: sha256Hex,
    newId: () => `history-${Date.now().toString(36)}-${(++checkpointSequence).toString(36)}`,
    time: () => new Date().toISOString(),
    async guard(path, removing) {
      const open = documents.get(createDocumentIdentity(projectId, path).key);
      if (open === undefined) {
        const external = await options.externalHistory?.current(path);
        if (external !== null && external !== undefined && removing) return `${path} is open. Close it, then retry the restore to remove it.`;
        return null;
      }
      await pendingEditsOf(open).settle();
      const snapshot = open.getSnapshot();
      if (snapshot.readOnly !== null) return `${path} is read-only and cannot be restored.`;
      if (snapshot.conflict !== null) return `${path} has an external change; resolve it before restoring.`;
      if (removing) return `${path} is open. Close it, then retry the restore to remove it.`;
      return null;
    },
    async consent(paths) {
      const answer = await dialogs.ask({
        message: `${paths.join(", ")} ${paths.length === 1 ? "already exists" : "already exist"}.`,
        detail: "The checkpoint will record the current files before the wizard writes. Continue?",
        choices: [{ id: "continue", label: "Continue" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      });
      return answer === "continue";
    },
    async current(path) {
      const result = await restorer().current(path);
      if (!result.ok) throw new Error(result.message);
      return result.bytes;
    },
    async write(path, bytes, context) {
      const result = await restorer().apply(path, bytes, context);
      return result.ok ? platformOk(undefined) : platformError("io-error", result.message);
    },
  });
  const checkpointReport = (sourceId: string, group: CheckpointGroup): GroupRestoreReport => ({
    groupId: sourceId,
    restoreGroupId: group.id,
    files: [
      ...group.files.map((file) => ({
        path: file.path,
        result: file.status === "written" ? "restored" as const
          : file.status === "already-as-wanted" ? "already-as-wanted" as const
            : file.status === "kept-uncertain" ? "kept-uncertain" as const
              : file.status === "uncovered" ? "uncovered" as const : "failed" as const,
        ...(file.message === null ? {} : { message: file.message }),
      })),
      ...group.uncovered.map((file) => ({
        path: file.path,
        result: "uncovered" as const,
        message: file.reason === "size" ? `${file.path} exceeds the history size limit (${file.size} bytes).` : `${file.path} is not a supported history file type.`,
      })),
    ],
  });

  return {
    history: historyStore,
    checkpoints,
    storage: documentStorage,
    openHistoryPreview: (path, bytes, description) => openHistoryPreview(projectId, path, bytes, description),
    async restoreHistoryEntry(entryId) {
      const preview = await historyStore.preview(entryId);
      if (preview === null) return { groupId: entryId, restoreGroupId: null, files: [{ path: "", result: "failed", message: `History entry ${entryId} does not exist.` }] };
      const path = preview.entry.path;
      const expectedBefore = await confirmUnsaved([path]);
      if (expectedBefore === null) return declined(entryId, [path]);
      const open = documents.get(createDocumentIdentity(projectId, path).key);
      if (open !== undefined && open.getSnapshot().dirty) {
        const unsaved = expectedBefore.get(path);
        if (unsaved === undefined || unsaved === null) return { groupId: entryId, restoreGroupId: null, files: [{ path, result: "failed", message: `${path} changed after the restore was requested, so the newer work was not replaced.` }] };
        try {
          const kept = await historyStore.keep(path, unsaved, "before-restore");
          if (kept.outcome === "uncovered") {
            return { groupId: entryId, restoreGroupId: null, files: [{ path, result: "failed", message: `${path} is not covered by history; the restore was not performed.` }] };
          }
        } catch (error) {
          return { groupId: entryId, restoreGroupId: null, files: [{ path, result: "failed", message: `Could not keep your unsaved version of ${path}; the restore was not performed: ${error instanceof Error ? error.message : String(error)}` }] };
        }
        if (documents.get(open.identity.key) !== open || !sameBytes(open.serialize(), unsaved)) {
          return { groupId: entryId, restoreGroupId: null, files: [{ path, result: "failed", message: `${path} changed after the restore was requested, so the newer work was not replaced.` }] };
        }
      }
      const result = await checkpoints.restoreTargets([{ path, bytes: preview.bytes, expectedBefore: expectedBefore.get(path) ?? null }], entryId);
      return result.ok ? checkpointReport(entryId, result.value) : { groupId: entryId, restoreGroupId: null, files: [{ path, result: "failed", message: result.error.message }] };
    },
    async restoreHistoryGroup(groupId, restoreOptions) {
      const listed = await checkpoints.list();
      if (!listed.ok) return { groupId, restoreGroupId: null, files: [{ path: "", result: "failed", message: listed.error.message }] };
      const source = listed.value.find((entry) => entry.id === groupId);
      if (source === undefined || !("files" in source)) return { groupId, restoreGroupId: null, files: [{ path: "", result: "failed", message: "Checkpoint group does not exist or is unreadable." }] };
      const selected = source.files.map((file) => file.path).filter((path) => restoreOptions?.only === undefined || restoreOptions.only.includes(path));
      const expectedBefore = await confirmUnsaved(selected);
      if (expectedBefore === null) return declined(groupId, selected);
      const result = await checkpoints.restore(groupId, { ...restoreOptions, expectedBefore });
      return result.ok ? checkpointReport(groupId, result.value) : { groupId, restoreGroupId: null, files: selected.map((path) => ({ path, result: "failed" as const, message: result.error.message })) };
    },
    async createNamedCheckpoint(name) {
      const targets: CheckpointTarget[] = [];
      const uncovered: CheckpointUncovered[] = [];
      const pending = [""];
      while (pending.length > 0) {
        const folder = pending.pop()!;
        const listed = await fs.listProject(projectId, folder);
        if (!listed.ok) throw new Error(`Could not list ${folder === "" ? "the project" : folder}: ${listed.error.message}`);
        for (const item of listed.value) {
          const path = folder === "" ? item.name : `${folder}/${item.name}`;
          const folded = foldPath(path);
          if (item.kind === "directory") {
            if ([".tkr-history", ".tkr-exports", "saved", ".git", "node_modules"].includes(folded)) continue;
            pending.push(path);
          } else if (item.kind === "file") {
            const current = await restorer().current(path);
            if (!current.ok) throw new Error(current.message);
            if (current.bytes === null) continue;
            const coverage = historyStore.coverage(path, current.bytes.byteLength);
            if (coverage.covered) targets.push({ path, bytes: null });
            else uncovered.push({ path, reason: coverage.reason, size: current.bytes.byteLength });
          }
        }
      }
      targets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      uncovered.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const result = await checkpoints.createNamedCheckpoint(name, targets, uncovered);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    document: {
      edited(event) {
        const history = historyOf(event.document);
        history.undo.push(event.editId);
        history.redo.length = 0;
      },
    },
    open,
    adopt(document) {
      const key = document.identity.key;
      if (document.identity.projectId !== projectId || documents.has(key) || opening.has(key)) return false;
      documents.set(key, document);
      startWatching();
      return true;
    },
    documents: () => [...documents.values()],
    pendingEdits: pendingEditsOf,
    undo(document) {
      const history = historyOf(document.identity.key);
      // An id that is no longer in force (a revert dropped it, a reload started a new history) is skipped, never undone.
      for (let editId = history.undo.pop(); editId !== undefined; editId = history.undo.pop()) {
        const undone = document.undo(editId);
        if (undone.ok) {
          history.redo.push(editId);
          return undone;
        }
        if (undone.reason === "read-only") return undone;
      }
      return { ok: false, reason: "nothing-to-undo" };
    },
    redo(document) {
      const history = historyOf(document.identity.key);
      for (let editId = history.redo.pop(); editId !== undefined; editId = history.redo.pop()) {
        const redone = document.redo(editId);
        if (redone.ok) {
          history.undo.push(editId);
          return redone;
        }
        if (redone.reason === "read-only") return redone;
      }
      return { ok: false, reason: "nothing-to-redo" };
    },
    async saveAll(reason: HistoryReason = "manual") {
      const results: SaveAllEntry[] = [];
      // Every view's accepted requests must complete before any dirty flag is read.
      await Promise.all([...documents.values()].map((document) => pendingEditsOf(document).settle()));
      for (const document of [...documents.values()]) {
        await pendingEditsOf(document).settle();
        if (!document.getSnapshot().dirty) continue;
        results.push({ document: document.identity.path, result: await document.save(reason) });
      }
      return results;
    },
    close: closeDocument,
    attachView(document) {
      if (documents.get(document.identity.key) !== document) throw new Error("Cannot attach a view to a document outside this workspace.");
      let attached = views.get(document);
      if (attached === undefined) {
        attached = new Set();
        views.set(document, attached);
      }
      const leases = attached;
      let closing: Promise<CloseResult> | undefined;
      const lease: DocumentViewLease = {
        close: () => closing ??= closeDocument(document, lease).then((result) => {
          if (!result.closed) closing = undefined;
          return result;
        }),
        dispose: () => {
          leases.delete(lease);
          if (leases.size === 0 && views.get(document) === leases) views.delete(document);
        },
      };
      leases.add(lease);
      return lease;
    },
    release,
    async revert(document) {
      await pendingEditsOf(document).settle();
      const snapshot = document.getSnapshot();
      // The edit in force when the user answers: an edit accepted while the question was open is not silently dropped.
      let head = snapshot.edits.at(-1)?.editId ?? null;
      if (snapshot.dirty || snapshot.conflict !== null) {
        const answer = await dialogs.ask({
          message: `Revert ${document.identity.path} to the version on disk?`,
          detail: "Your unsaved changes are discarded.",
          choices: [
            { id: "revert", label: "Revert" },
            { id: "cancel", label: "Cancel" },
          ],
          cancel: "cancel",
        });
        if (answer === "cancel") return { ok: false, reason: "cancelled" };
        head = document.getSnapshot().edits.at(-1)?.editId ?? null;
      }
      const reverted = await document.revert(head);
      return reverted.ok ? reverted : { ok: false, reason: "failed", failure: reverted.failure };
    },
    async saveAs(document) {
      await pendingEditsOf(document).settle();
      const source = document.identity.path;
      const requested = await dialogs.pickSavePath({ document: source, suggested: source });
      if (requested === null) return { ok: false, reason: "cancelled" };
      const failed = (path: string, message: string): SaveAsOutcome => ({ ok: false, reason: "failed", failure: { document: path, message } });
      const target = toSlashes(requested);
      if (target === "" || target.startsWith("/") || target.split("/").some((part) => part === "" || part === "." || part === "..")) {
        return failed(requested, `${requested} is not a path inside the project.`);
      }
      const resolved = await resolveDocumentPath(fs, target);
      if (!resolved.ok) return failed(target, resolved.kind === "case-conflict" ? resolved.message : `Could not check ${target}: ${resolved.error.message}`);
      const identity = createDocumentIdentity(projectId, resolved.path);
      if (identity.key === document.identity.key) {
        const saved = await document.save();
        return saved.ok ? { ok: true, document } : failed(source, saved.failure.message);
      }
      if (documents.has(identity.key) || opening.has(identity.key) || savingAs.has(identity.key)) {
        return failed(resolved.path, `${resolved.path} is open, opening, or being saved; choose another destination.`);
      }
      let finishCopy!: () => void;
      const copying = new Promise<void>((resolve) => { finishCopy = resolve; });
      savingAs.set(identity.key, copying);
      try {
        // The destination and any collision are settled before anything is written (D3.4). A main file is not named by
        // any other document, so Save As has no references to update.
        if (resolved.exists) {
          const stat = await fs.stat(resolved.path);
          if (stat.ok && stat.value.kind === "directory") return failed(resolved.path, `${resolved.path} is a folder.`);
          const answer = await dialogs.ask({
            message: `${resolved.path} already exists. Replace it?`,
            detail: `Its content is replaced by ${source}'s.`,
            choices: [
              { id: "replace", label: "Replace" },
              { id: "cancel", label: "Cancel" },
            ],
            cancel: "cancel",
          });
          if (answer === "cancel") return { ok: false, reason: "cancelled" };
        }
        const copied = document.getSnapshot();
        const written = await document.saveAs(documentStorage, identity);
        if (!written.ok) return failed(resolved.path, written.failure.message);
        // Read the copy without registering it. A failed Save As must not strand an invisible open destination.
        const reopened = await (kindById(document.kind)?.open(documentStorage, identity) ?? Promise.resolve<ReopenFailure>(UNKNOWN_KIND));
        if (!reopened.ok) {
          return failed(resolved.path, `${resolved.path} was written but could not be opened: ${reopened.error.document}: ${reopened.error.error.message}`);
        }
        // A source edit made during the write or the read is not in the copy: keep the source open with its work.
        if (!sameRevision(document.getSnapshot(), copied)) {
          return failed(resolved.path, `${resolved.path} was written, but ${source} changed during Save As and remains open with its work.`);
        }
        if (disposed || documents.has(identity.key) || opening.has(identity.key)) {
          return failed(resolved.path, `${resolved.path} was written but is already open or opening; ${source} remains open.`);
        }
        documents.set(identity.key, reopened.document);
        startWatching();
        // Other views still own the source. Otherwise this view replaces it with the newly opened copy (D1.3).
        if ((views.get(document)?.size ?? 0) <= 1) release(document);
        return { ok: true, document: reopened.document };
      } finally {
        savingAs.delete(identity.key);
        finishCopy();
      }
    },
    dispose() {
      disposed = true;
      void watch?.then((handle) => handle?.dispose());
      documents.clear();
      histories.clear();
      views.clear();
      pendingByDocument.clear();
    },
  };
}

function joinPath(folder: string, rest: string): string {
  return folder === "" ? rest : `${folder}/${rest}`;
}
