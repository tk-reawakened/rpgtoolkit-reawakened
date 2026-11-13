import { createMainDocument, type ApplyResult, type ConflictChoice, type ConflictResult, type DocumentIdentity, type DocumentStorage, type ExternalChange, type ExternalCheck, type HistoryResult, type MainCommand, type MainDocument, type MainDocumentSnapshot, type OpenError, type RevertResult, type SaveFailure, type SaveResult } from "@tk-reawakened/editor-model";
import type { PlatformResult } from "@tk-reawakened/platform-services";

export type BackupRecoveryResult =
  | { readonly ok: true; readonly document: MainDocument }
  | { readonly ok: false; readonly error: OpenError };

/** A legacy hot-exit backup has no original disk baseline. Preserve it and require an explicit choice. */
export async function recoverMainDocument(storage: DocumentStorage, identity: DocumentIdentity, backup: Uint8Array): Promise<BackupRecoveryResult> {
  let lastRead: PlatformResult<Uint8Array> | undefined;
  const recordingStorage: DocumentStorage = {
    async readProject(project, path) {
      lastRead = await storage.readProject(project, path);
      return lastRead;
    },
    writeProject: (project, path, bytes) => storage.writeProject(project, path, bytes),
  };
  const recovered = createMainDocument(recordingStorage, identity, backup);
  if (!recovered.ok) return recovered;
  const edit = recovered.document.apply({ type: "set-game-title", title: recovered.document.getSnapshot().gameTitle });
  if (!edit.ok) throw new Error(`Could not restore backup for ${identity.path}: ${edit.rejection.message}`);
  const guarded = new RecoveryDocument(recovered.document, storage, () => lastRead);
  await guarded.checkExternal();
  return { ok: true, document: guarded };
}

/** Resolve a recovery conflict with a fresh disk check; ordinary documents use the shared model's resolution. */
export async function resolveRecoveryConflict(document: MainDocument, choice: ConflictChoice): Promise<ConflictResult> {
  return document instanceof RecoveryDocument ? document.resolveRecovery(choice) : document.resolveConflict(choice);
}

class RecoveryDocument implements MainDocument {
  readonly identity: DocumentIdentity;
  readonly #document: MainDocument;
  readonly #storage: DocumentStorage;
  readonly #lastRead: () => PlatformResult<Uint8Array> | undefined;
  readonly #listeners = new Set<() => void>();
  #pending = true;
  #observed: Uint8Array | null | undefined;
  #change: ExternalChange;
  #saveError: SaveFailure | null = null;
  #snapshot: MainDocumentSnapshot;

  constructor(document: MainDocument, storage: DocumentStorage, lastRead: () => PlatformResult<Uint8Array> | undefined) {
    this.#document = document;
    this.#storage = storage;
    this.#lastRead = lastRead;
    this.identity = document.identity;
    this.#change = this.#describe(undefined);
    this.#snapshot = this.#makeSnapshot();
    document.subscribe(() => this.#publish());
  }
  getSnapshot(): MainDocumentSnapshot { return this.#snapshot; }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  apply(command: MainCommand): ApplyResult { return this.#document.apply(command); }
  serialize(): Uint8Array { return this.#document.serialize(); }
  undo(editId?: string): HistoryResult {
    // The recovery marker is not a VS Code edit; it cannot be undone while the recovery choice is pending.
    if (this.#pending && this.#document.getSnapshot().edits.length <= 1) return { ok: false, reason: "nothing-to-undo" };
    return this.#document.undo(editId);
  }
  redo(editId?: string): HistoryResult { return this.#document.redo(editId); }
  async save(): Promise<SaveResult> {
    if (!this.#pending) return this.#document.save();
    this.#saveError = this.#failure();
    this.#publish();
    return { ok: false, failure: this.#saveError };
  }
  async checkExternal(): Promise<ExternalCheck> {
    if (!this.#pending) return this.#document.checkExternal();
    try {
      const read = await this.#storage.readProject(this.identity.projectId, this.identity.path);
      this.#observed = read.ok ? read.value.slice() : read.error.code === "not-found" ? null : undefined;
    } catch {
      this.#observed = undefined;
    }
    this.#change = this.#describe(this.#observed);
    this.#publish();
    return this.#observed === undefined ? "unknown" : "conflict";
  }
  resolveConflict(choice: ConflictChoice): ConflictResult {
    if (!this.#pending) return this.#document.resolveConflict(choice);
    return { ok: false, reason: "cannot-reload", message: "Recovery requires a fresh disk check; use the editor's conflict controls." };
  }
  async resolveRecovery(choice: ConflictChoice): Promise<ConflictResult> {
    if (!this.#pending) return this.#document.resolveConflict(choice);
    if (this.#observed === undefined) {
      await this.checkExternal();
      return { ok: false, reason: "cannot-reload", message: this.#observed === undefined ? "The file still cannot be read; nothing was changed." : "The disk version is available now. Review it and choose again." };
    }
    if (choice === "reload") {
      const result = await this.#document.revert(this.#document.getSnapshot().edits.at(-1)?.editId ?? null);
      if (!result.ok) return { ok: false, reason: "cannot-reload", message: result.failure.message };
    } else {
      // Compare the exact bytes the model read with the version the user saw before accepting its conflict.
      const observed = this.#observed;
      const checked = await this.#document.checkExternal();
      const read = this.#lastRead();
      const actual = read?.ok ? read.value : read?.error.code === "not-found" ? null : undefined;
      if (checked === "unknown" || actual === undefined || !sameContent(observed, actual)) {
        await this.checkExternal();
        return { ok: false, reason: "cannot-reload", message: "The disk version changed or could not be checked. Review it and choose again." };
      }
      if (this.#document.getSnapshot().conflict !== null) {
        const result = this.#document.resolveConflict("keep-local");
        if (!result.ok) return result;
      }
    }
    this.#pending = false;
    this.#saveError = null;
    this.#publish();
    return { ok: true };
  }
  async revert(expectedHead?: string | null): Promise<RevertResult> {
    const result = await this.#document.revert(expectedHead);
    if (result.ok) { this.#pending = false; this.#saveError = null; this.#publish(); }
    return result;
  }
  saveAs(storage: DocumentStorage, target: DocumentIdentity): Promise<SaveResult> {
    if (this.#pending && target.projectId === this.identity.projectId && target.key === this.identity.key) {
      this.#saveError = this.#failure();
      this.#publish();
      return Promise.resolve({ ok: false, failure: this.#saveError });
    }
    return this.#document.saveAs(storage, target);
  }
  #failure(): SaveFailure { return { document: this.identity.path, kind: "conflict", code: null, message: `${this.#change.message} Nothing was saved.` }; }
  #describe(bytes: Uint8Array | null | undefined): ExternalChange {
    const read = bytes instanceof Uint8Array ? createMainDocument(this.#storage, this.identity, bytes) : null;
    return {
      document: this.identity.path,
      kind: bytes === null ? "deleted" : "changed",
      externalTitle: read?.ok === true ? read.document.getSnapshot().gameTitle : null,
      message: bytes === undefined ? `${this.identity.path} was recovered without its original disk baseline. The disk version could not be checked; choose again to retry.` : `${this.identity.path} was recovered without its original disk baseline. Your recovered version and the version on disk are kept until you choose.`,
    };
  }
  #makeSnapshot(): MainDocumentSnapshot {
    const snapshot = this.#document.getSnapshot();
    return this.#pending ? { ...snapshot, dirty: true, conflict: this.#change, saveError: this.#saveError } : snapshot;
  }
  #publish(): void {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of [...this.#listeners]) { try { listener(); } catch { /* Other views still receive updates. */ } }
  }
}

function sameContent(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a === null || b === null ? a === b : a.length === b.length && a.every((byte, index) => byte === b[index]);
}
