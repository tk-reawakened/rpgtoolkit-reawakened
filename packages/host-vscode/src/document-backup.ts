import { createMainDocument, type ApplyResult, type ConflictChoice, type ConflictResult, type DocumentIdentity, type DocumentStorage, type ExternalChange, type ExternalCheck, type HistoryResult, type MainCommand, type MainDocument, type MainDocumentSnapshot, type OpenError, type RevertResult, type SaveFailure, type SaveResult } from "@tk-reawakened/editor-model";

export type BackupRecoveryResult =
  | { readonly ok: true; readonly document: MainDocument }
  | { readonly ok: false; readonly error: OpenError };

/**
 * Backups contain the whole unsaved file, not the disk revision it was edited from. Never treat the file found on
 * restart as that missing baseline: even a change to the same field may have happened while VS Code was closed.
 * Preserve the backup byte-for-byte and require a choice before saving, including for older unversioned backups.
 */
export async function recoverMainDocument(storage: DocumentStorage, identity: DocumentIdentity, backup: Uint8Array): Promise<BackupRecoveryResult> {
  const recovered = createMainDocument(storage, identity, backup);
  if (!recovered.ok) return recovered;
  const document = recovered.document;
  const edit = document.apply({ type: "set-game-title", title: document.getSnapshot().gameTitle });
  if (!edit.ok) throw new Error(`Could not restore backup for ${identity.path}: ${edit.rejection.message}`);
  const guarded = new RecoveryDocument(document);
  await guarded.checkExternal();
  return { ok: true, document: guarded };
}

/** Keep the unknown-baseline decision in the document, not in a view that VS Code can dispose. */
class RecoveryDocument implements MainDocument {
  readonly identity: DocumentIdentity;
  readonly #document: MainDocument;
  readonly #backupTitle: string;
  readonly #listeners = new Set<() => void>();
  #pending = true;
  #checked: ExternalCheck = "unknown";
  #saveError: SaveFailure | null = null;
  #snapshot: MainDocumentSnapshot;

  constructor(document: MainDocument) {
    this.#document = document;
    this.identity = document.identity;
    this.#backupTitle = document.getSnapshot().gameTitle;
    this.#snapshot = this.#makeSnapshot();
    document.subscribe(() => this.#publish());
  }

  getSnapshot(): MainDocumentSnapshot { return this.#snapshot; }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  apply(command: MainCommand): ApplyResult { return this.#document.apply(command); }
  serialize(): Uint8Array { return this.#document.serialize(); }
  undo(editId?: string): HistoryResult {
    // Removing the recovery edit would let a watcher reload the clean underlying model and discard the backup.
    if (this.#pending && this.#document.getSnapshot().edits.length <= 1) return { ok: false, reason: "nothing-to-undo" };
    return this.#document.undo(editId);
  }
  redo(editId?: string): HistoryResult { return this.#document.redo(editId); }

  async save(): Promise<SaveResult> {
    if (!this.#pending) return this.#document.save();
    const conflict = this.#makeConflict();
    this.#saveError = { document: this.identity.path, kind: "conflict", code: null, message: `${conflict.message} Nothing was saved.` };
    this.#publish();
    return { ok: false, failure: this.#saveError };
  }

  async checkExternal(): Promise<ExternalCheck> {
    if (!this.#pending) return this.#document.checkExternal();
    this.#checked = await this.#document.checkExternal();
    this.#publish();
    return this.#checked === "unknown" ? "unknown" : "conflict";
  }

  resolveConflict(choice: ConflictChoice): ConflictResult {
    if (!this.#pending) return this.#document.resolveConflict(choice);
    if (this.#checked === "unknown") {
      return { ok: false, reason: "cannot-reload", message: `The version of ${this.identity.path} on disk could not be checked. Nothing was changed.` };
    }
    if (this.#document.getSnapshot().conflict !== null) {
      const result = this.#document.resolveConflict(choice);
      if (!result.ok) return result;
    } else if (choice === "reload") {
      // The checked disk bytes matched the backup. Discard edits made since recovery, too.
      while (this.#document.getSnapshot().canUndo) this.#document.undo();
    }
    this.#pending = false;
    this.#saveError = null;
    this.#publish();
    return { ok: true };
  }

  async revert(expectedHead?: string | null): Promise<RevertResult> {
    const result = await this.#document.revert(expectedHead);
    if (result.ok) {
      this.#pending = false;
      this.#saveError = null;
      this.#publish();
    }
    return result;
  }
  saveAs(storage: DocumentStorage, target: DocumentIdentity): Promise<SaveResult> { return this.#document.saveAs(storage, target); }

  #makeConflict(): ExternalChange {
    const external = this.#document.getSnapshot().conflict;
    return {
      document: this.identity.path,
      kind: external?.kind ?? "changed",
      externalTitle: external?.externalTitle ?? (this.#checked === "unchanged" ? this.#backupTitle : null),
      message: `${this.identity.path} was recovered from a backup without its original disk baseline. Your recovered version and the version on disk are kept until you choose.`,
    };
  }
  #makeSnapshot(): MainDocumentSnapshot {
    const snapshot = this.#document.getSnapshot();
    return this.#pending ? { ...snapshot, dirty: true, conflict: this.#makeConflict(), saveError: this.#saveError } : snapshot;
  }
  #publish(): void {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch { /* A view cannot stop the other subscribers. */ }
    }
  }
}
