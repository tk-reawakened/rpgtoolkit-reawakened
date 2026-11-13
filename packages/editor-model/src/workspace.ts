import { foldPath, toSlashes } from "@tk-reawakened/core";
import type { Disposable, DocumentService, FileSystemService, PlatformError, PlatformServices } from "@tk-reawakened/platform-services";
import { createDocumentIdentity } from "./identity.ts";
import { openMainDocument, type HistoryResult, type MainDocument, type OpenError, type RevertFailure, type SaveFailure, type SaveResult } from "./main-document.ts";

/**
 * The documents a host has open in one project, and the lifecycle around them that ADR 0022 D3 promises in every host:
 * one model per document identity (D1.2), undo and redo by `editId` (AD-19), save all with a result per document (D4.1),
 * close and revert that confirm a possible loss (D3.6), Save As to a new identity (D1.3, D3.4), and watching for changes
 * made by other programs where the host can (D3.5). It is DOM-free and framework-free, so the browser host and the
 * desktop host use it as their workbench; VS Code has its own workbench and uses only the parts its custom editor
 * provider needs (`open`, `release` and the watch).
 */

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
  | { readonly kind: "case-conflict"; readonly document: string; readonly paths: readonly string[]; readonly message: string };

export type WorkspaceOpenResult =
  | { readonly ok: true; readonly document: MainDocument }
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
  | { readonly ok: true; readonly document: MainDocument }
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
  adopt(document: MainDocument): boolean;
  /** The open documents, in the order they were opened. */
  documents(): readonly MainDocument[];
  /** Undo the latest edit this host heard of that is still in force, by its `editId`. */
  undo(document: MainDocument): HistoryResult;
  /** Redo the latest undone edit, by its `editId`. */
  redo(document: MainDocument): HistoryResult;
  /** Save every dirty document, one after another, and report each (D4.1: there is no all-or-nothing save). */
  saveAll(): Promise<readonly SaveAllEntry[]>;
  /** Close a document with no attached views, asking before losing work; attached views close through their leases. */
  close(document: MainDocument): Promise<CloseResult>;
  /** Track a mounted view; close its lease to close that view without releasing models used by other views. */
  attachView(document: MainDocument): DocumentViewLease;
  /** Forget a document without asking: the host has already asked (VS Code's workbench), or nothing can be lost. */
  release(document: MainDocument): void;
  /** Go back to the file on disk, asking first when that discards unsaved work (D3.6). */
  revert(document: MainDocument): Promise<RevertOutcome>;
  /** Save a copy under a new name chosen through `dialogs`, open it as a new identity, and close the source (D1.3, D3.4). */
  saveAs(document: MainDocument): Promise<SaveAsOutcome>;
  /** Stop watching and forget every document. */
  dispose(): void;
}

export interface WorkspaceOptions {
  /** The project handle every identity in this workspace is bound to (ADR 0022 D1.1). */
  readonly projectId: string;
  readonly services: Pick<PlatformServices, "fs" | "dialogs" | "capabilities">;
}

interface HostHistory {
  readonly undo: string[];
  readonly redo: string[];
}

/** Make the workspace of one project. */
export function createDocumentWorkspace(options: WorkspaceOptions): DocumentWorkspace {
  const { projectId, services } = options;
  const { fs, dialogs } = services;
  const documents = new Map<string, MainDocument>();
  const opening = new Map<string, Promise<WorkspaceOpenResult>>();
  const histories = new Map<string, HostHistory>();
  const views = new Map<MainDocument, Set<DocumentViewLease>>();
  let watch: Promise<Disposable | null> | null = null;
  let disposed = false;

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
    const existing = documents.get(identity.key);
    if (existing !== undefined) return { ok: true, document: existing };
    // Two opens of one document at once share one read and one model.
    const pending = opening.get(identity.key);
    if (pending !== undefined) return pending;
    const reading = openMainDocument(fs, identity).then((opened): WorkspaceOpenResult => {
      opening.delete(identity.key);
      if (!opened.ok || disposed) return opened;
      documents.set(identity.key, opened.document);
      startWatching();
      return opened;
    });
    opening.set(identity.key, reading);
    return reading;
  };

  const release = (document: MainDocument): void => {
    const key = document.identity.key;
    if (documents.get(key) !== document) return;
    documents.delete(key);
    histories.delete(key);
  };

  const closeDocument = async (document: MainDocument, view?: DocumentViewLease): Promise<CloseResult> => {
    const attached = views.get(document);
    if (view !== undefined && !attached?.has(view)) return { closed: true };
    if (view !== undefined && attached !== undefined && attached.size > 1) {
      attached.delete(view);
      return { closed: true };
    }
    // A document-level close cannot invalidate a model still owned by views.
    if (view === undefined && attached !== undefined && attached.size > 0) return { closed: false, reason: "cancelled" };
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

  return {
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
    async saveAll() {
      const results: SaveAllEntry[] = [];
      for (const document of [...documents.values()]) {
        if (!document.getSnapshot().dirty) continue;
        results.push({ document: document.identity.path, result: await document.save() });
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
      if (documents.has(identity.key)) {
        return failed(resolved.path, `${resolved.path} is open in the editor; close it before saving another document over it.`);
      }
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
      const written = await document.saveAs(fs, identity);
      if (!written.ok) return failed(resolved.path, written.failure.message);
      const reopened = await open(resolved.path);
      if (!reopened.ok) {
        const reason = reopened.error.kind === "case-conflict" ? reopened.error.message : `${reopened.error.document}: ${reopened.error.error.message}`;
        return failed(resolved.path, `${resolved.path} was written but could not be opened: ${reason}`);
      }
      const current = document.getSnapshot();
      if (current !== copied) {
        return failed(resolved.path, `${resolved.path} was written, but ${source} changed during Save As and remains open with its work.`);
      }
      // Other views still own the source. Otherwise this view replaces it with the newly opened copy (D1.3).
      if ((views.get(document)?.size ?? 0) <= 1) release(document);
      return { ok: true, document: reopened.document };
    },
    dispose() {
      disposed = true;
      void watch?.then((handle) => handle?.dispose());
      documents.clear();
      histories.clear();
      views.clear();
    },
  };
}

function joinPath(folder: string, rest: string): string {
  return folder === "" ? rest : `${folder}/${rest}`;
}
