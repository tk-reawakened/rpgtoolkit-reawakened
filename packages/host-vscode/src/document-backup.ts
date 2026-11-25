import { kindById, markRecoveredDocumentDirty, type AnyDocument, type ApplyOptions, type ApplyResult, type HeldText, type ConflictChoice, type ConflictResult, type DocumentIdentity, type DocumentKind, type DocumentSnapshot, type DocumentStorage, type ExternalCheck, type ExternalChange, type HistoryReason, type HistoryResult, type OpenError, type RevertResult, type SaveFailure, type SaveOptions, type SaveResult } from "@tk-reawakened/editor-model";
import type { PlatformResult } from "@tk-reawakened/platform-services";

/**
 * A hot-exit backup is the document's own bytes. A document holding text a field cannot store yet (ADR 0022 D16.3) cannot
 * put it in those bytes, so its backup is an envelope: this line, the held text as one JSON line, then the bytes. A file
 * of any kind the editor opens starts with its own header, never with this line, and a backup without held text is the
 * bare bytes, exactly as before.
 */
const HELD_ENVELOPE = "TKR-HELD-TEXT-1\n";

/** The bytes VS Code keeps for `document`: its stored values, and the text its fields hold if any. */
export function encodeBackup(document: Pick<AnyDocument, "serialize" | "getSnapshot">): Uint8Array {
  const bytes = document.serialize();
  const held = (document.getSnapshot() as { readonly heldText?: Readonly<Record<string, HeldText>> }).heldText;
  if (held === undefined || Object.keys(held).length === 0) return bytes;
  const head = new TextEncoder().encode(`${HELD_ENVELOPE}${JSON.stringify(held)}\n`);
  const out = new Uint8Array(head.length + bytes.length);
  out.set(head);
  out.set(bytes, head.length);
  return out;
}

/** Split a backup into the document's bytes and the text its fields held. */
export function decodeBackup(backup: Uint8Array): { readonly bytes: Uint8Array; readonly held: Readonly<Record<string, HeldText>> } {
  const magic = new TextEncoder().encode(HELD_ENVELOPE);
  if (backup.length < magic.length || magic.some((byte, index) => backup[index] !== byte)) return { bytes: backup, held: {} };
  const end = backup.indexOf(0x0a, magic.length);
  if (end < 0) return { bytes: backup, held: {} };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(backup.subarray(magic.length, end))) as Record<string, HeldText>;
    const held: Record<string, HeldText> = {};
    for (const [field, value] of Object.entries(parsed)) {
      if (typeof value?.text === "string" && typeof value.message === "string") held[field] = { text: value.text, message: value.message };
    }
    return { bytes: backup.subarray(end + 1), held };
  } catch {
    return { bytes: backup, held: {} };
  }
}

export type BackupRecoveryResult =
  | { readonly ok: true; readonly document: AnyDocument }
  | { readonly ok: false; readonly error: OpenError };

/** A legacy hot-exit backup has no original disk baseline. Preserve it and require an explicit choice. */
export async function recoverDocument(kind: DocumentKind, storage: DocumentStorage, identity: DocumentIdentity, backup: Uint8Array): Promise<BackupRecoveryResult> {
  let lastRead: PlatformResult<Uint8Array> | undefined;
  let expected: Uint8Array | null | undefined;
  const recordingStorage: DocumentStorage = {
    async readProject(project, path) {
      lastRead = await storage.readProject(project, path);
      const actual = lastRead.ok ? lastRead.value : lastRead.error.code === "not-found" ? null : undefined;
      // A rejected choice must not pass different bytes into the model's check: it can reload a clean model.
      if (expected !== undefined && actual !== undefined && !sameContent(expected, actual)) {
        return { ok: false, error: { code: "io-error", message: "The disk version changed before the recovery choice was applied." } };
      }
      return lastRead;
    },
    writeProject: (project, path, bytes) => storage.writeProject(project, path, bytes),
    ...(storage.history === undefined ? {} : { history: storage.history }),
  };
  const decoded = decodeBackup(backup);
  const recovered = kind.create(recordingStorage, identity, decoded.bytes.slice());
  if (!recovered.ok) return recovered;
  // A kind with a harmless command recovers through it, so the recovered document has a history; one without is dirtied directly.
  const marker = kind.recoveryMarker(recovered.document.getSnapshot());
  if (marker === null) {
    markRecoveredDocumentDirty(recovered.document);
  } else {
    const edit = recovered.document.apply(marker as never);
    if (!edit.ok) throw new Error(`Could not restore backup for ${identity.path}: ${edit.rejection.message}`);
  }
  // Text a field held when the backup was taken is held again, as its own edit, so the recovered form shows it (D16.3).
  for (const [field, held] of Object.entries(decoded.held)) {
    const command = { type: "hold-field-text", field, text: held.text, message: held.message };
    if (kind.isCommand(command)) recovered.document.apply(command as never);
  }
  const guarded = new RecoveryDocument(kind, recovered.document, marker !== null, storage, () => lastRead, (bytes) => { expected = bytes; });
  await guarded.checkExternal();
  return { ok: true, document: guarded as unknown as AnyDocument };
}

/** Recover a main-file backup: `recoverDocument` for the `.gam` kind. */
export function recoverMainDocument(storage: DocumentStorage, identity: DocumentIdentity, backup: Uint8Array): Promise<BackupRecoveryResult> {
  return recoverDocument(kindById("main")!, storage, identity, backup);
}

/** Resolve a recovery conflict with a fresh disk check; ordinary documents use the shared model's resolution. */
export async function resolveRecoveryConflict(document: AnyDocument, choice: ConflictChoice): Promise<ConflictResult> {
  return document instanceof RecoveryDocument ? document.resolveRecovery(choice) : document.resolveConflict(choice);
}

class RecoveryDocument {
  readonly kind: string;
  readonly identity: DocumentIdentity;
  readonly #kind: DocumentKind;
  /** Whether recovery added a marker edit to the history (a kind with no marker recovers through the dirty flag alone). */
  readonly #marked: boolean;
  readonly #document: AnyDocument;
  readonly #storage: DocumentStorage;
  readonly #lastRead: () => PlatformResult<Uint8Array> | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #expectRead: (bytes: Uint8Array | null | undefined) => void;
  #pending = true;
  #observed: Uint8Array | null | undefined;
  #change: ExternalChange;
  #saveError: SaveFailure | null = null;
  #snapshot: DocumentSnapshot<unknown>;
  #resolution: Promise<unknown> = Promise.resolve();

  constructor(kind: DocumentKind, document: AnyDocument, marked: boolean, storage: DocumentStorage, lastRead: () => PlatformResult<Uint8Array> | undefined, expectRead: (bytes: Uint8Array | null | undefined) => void) {
    this.#kind = kind;
    this.#marked = marked;
    this.kind = document.kind;
    this.#document = document;
    this.#storage = storage;
    this.#lastRead = lastRead;
    this.#expectRead = expectRead;
    this.identity = document.identity;
    this.#change = this.#describe(undefined);
    this.#snapshot = this.#makeSnapshot();
    document.subscribe(() => this.#publish());
  }
  getSnapshot(): DocumentSnapshot<unknown> { return this.#snapshot; }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  apply(command: unknown, options?: ApplyOptions): ApplyResult {
    if (!this.#kind.isCommand(command)) return { ok: false, rejection: { reason: "invalid", message: "This recovery document does not accept that edit." } };
    return (this.#document.apply as (command: never, options?: ApplyOptions) => ApplyResult)(command as never, options);
  }
  serialize(): Uint8Array { return this.#document.serialize(); }
  undo(editId?: string): HistoryResult {
    // The recovery marker is not a VS Code edit; it cannot be undone while the recovery choice is pending.
    if (this.#pending && this.#document.getSnapshot().edits.length <= (this.#marked ? 1 : 0)) return { ok: false, reason: "nothing-to-undo" };
    return this.#document.undo(editId);
  }
  redo(editId?: string): HistoryResult { return this.#document.redo(editId); }
  async save(reason?: HistoryReason, options?: SaveOptions): Promise<SaveResult> {
    if (!this.#pending) return this.#document.save(reason, options);
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
  restoreVersion(bytes: Uint8Array, label?: string): ApplyResult { return this.#document.restoreVersion(bytes, label); }
  resolveConflict(choice: "keep-local"): ConflictResult;
  resolveConflict(choice: ConflictChoice): ConflictResult | Promise<ConflictResult>;
  resolveConflict(choice: ConflictChoice): ConflictResult | Promise<ConflictResult> {
    if (!this.#pending) return this.#document.resolveConflict(choice);
    return { ok: false, reason: "cannot-reload", message: "Recovery requires a fresh disk check; use the editor's conflict controls." };
  }
  resolveRecovery(choice: ConflictChoice): Promise<ConflictResult> {
    const result = this.#resolution.then(() => this.#resolveRecovery(choice));
    this.#resolution = result.catch(() => undefined);
    return result;
  }
  async #resolveRecovery(choice: ConflictChoice): Promise<ConflictResult> {
    if (!this.#pending) return this.#document.resolveConflict(choice);
    if (this.#observed === undefined) {
      await this.checkExternal();
      return { ok: false, reason: "cannot-reload", message: this.#observed === undefined ? "The file still cannot be read; nothing was changed." : "The disk version is available now. Review it and choose again." };
    }
    if (choice === "reload") {
      // The recovered work is about to be discarded: keep it in history first, and stop if that fails (D12.10 item 5).
      const kept = await this.#storage.history?.keepBeforeWrite(this.identity.path, this.#document.serialize(), "before-conflict-resolution");
      if (kept !== undefined && !kept.ok) return { ok: false, reason: "cannot-reload", message: `Your recovered version could not be kept in history, so the disk version was not loaded: ${kept.message}` };
      const result = await this.#document.revert(this.#document.getSnapshot().edits.at(-1)?.editId ?? null);
      if (!result.ok) return { ok: false, reason: "cannot-reload", message: result.failure.message };
    } else {
      // Compare the exact bytes the model read with the version the user saw before accepting its conflict.
      const observed = this.#observed;
      this.#expectRead(observed);
      let checked: ExternalCheck;
      try {
        checked = await this.#document.checkExternal();
      } finally {
        this.#expectRead(undefined);
      }
      const read = this.#lastRead();
      const actual = read?.ok ? read.value : read?.error.code === "not-found" ? null : undefined;
      if (checked === "unknown" || actual === undefined || !sameContent(observed, actual)) {
        await this.checkExternal();
        return { ok: false, reason: "cannot-reload", message: "The disk version changed or could not be checked. Review it and choose again." };
      }
      if (this.#document.getSnapshot().conflict !== null) {
        const result = await this.#document.resolveConflict("keep-local");
        if (!result.ok) return result;
      }
      markRecoveredDocumentDirty(this.#document);
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
    return {
      document: this.identity.path,
      kind: bytes === null ? "deleted" : "changed",
      externalTitle: bytes instanceof Uint8Array ? this.#kind.summarise(bytes, this.identity.path) : null,
      message: bytes === undefined ? `${this.identity.path} was recovered without its original disk baseline. The disk version could not be checked; choose again to retry.` : `${this.identity.path} was recovered without its original disk baseline. Your recovered version and the version on disk are kept until you choose.`,
    };
  }
  #makeSnapshot(): DocumentSnapshot<unknown> {
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
