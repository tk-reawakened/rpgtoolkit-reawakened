import type { FormatError, Result } from "@tk-reawakened/core";
import type { FileSystemService, PlatformError, PlatformResult } from "@tk-reawakened/platform-services";
import type { DocumentIdentity } from "./identity.ts";

/**
 * The binary document of ADR 0022 D2 and ADR 0026 decision 3: a binary document is **bytes plus a serialisable command
 * stack**. The bytes are what the file held when it was opened; the commands are plain data, so the current model is
 * always the opened model with the applied commands replayed over it. One class holds every lifecycle rule (save,
 * conflict, revert, undo by `editId`); a kind supplies only a `DocumentCodec`: how its bytes are read and written, what
 * a command does, and which fields its snapshot adds. The model a codec reads keeps the minor version and the unknown
 * residue (AD-18), so a writer puts every datum the commands did not touch back byte for byte.
 */

/** An accepted command with the id the host undoes it by (AD-19) and the words an undo menu shows. */
export interface EditRecord<Command = unknown> {
  readonly editId: string;
  readonly label: string;
  readonly command: Command;
}

/** Why a document can be viewed but never edited (ADR 0022 D2.1). */
export interface ReadOnlyReason {
  readonly code: "no-same-version-writer";
  readonly message: string;
}

/** What a failed save reports: it names the document and says why (ADR 0022 D3.3). */
export interface SaveFailure {
  /** The document's project-relative path. */
  readonly document: string;
  /**
   * `write`: the host refused the bytes, or the file could not be checked before writing; `format`: the model could not
   * be encoded; `read-only`: no writer exists; `conflict`: another program changed the file since the editor last read or
   * wrote it, so nothing was written (ADR 0022 D3.5, D11.3).
   */
  readonly kind: "write" | "format" | "read-only" | "conflict";
  /** The host's error code when `kind` is `write`; `null` when the host gave none (it threw or rejected instead of answering). */
  readonly code: PlatformError["code"] | null;
  /** One sentence naming the document and the cause, safe to show. */
  readonly message: string;
}

/**
 * A change on disk the editor did not make (ADR 0022 D3.5). The local version and the version on disk are both kept,
 * and nothing is written, until the user chooses between them.
 */
export interface ExternalChange {
  /** The document's project-relative path. */
  readonly document: string;
  /** `changed`: the file now holds other bytes; `deleted`: the file is gone. */
  readonly kind: "changed" | "deleted";
  /**
   * The codec's short name for the version on disk (a main file's game title), to compare with the local one; `null` when
   * the file is gone or is not a file this kind reads, in which case it cannot be loaded either.
   */
  readonly externalTitle: string | null;
  /** One sentence naming the document and what happened, safe to show. */
  readonly message: string;
}

/** How the user settles an external change: keep the local version (the next save replaces the file) or load the file's. */
export type ConflictChoice = "keep-local" | "reload";

export type ConflictResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "no-conflict" | "cannot-reload"; readonly message: string };

/**
 * What `checkExternal` found: the file is as the document last read or wrote it; it changed and the clean document now
 * shows the new version; it changed under unsaved work (or cannot be loaded) and is now a conflict; or its state cannot
 * be established, including when it matches a write the host did not report durable.
 */
export type ExternalCheck = "unchanged" | "reloaded" | "conflict" | "unknown";

/** Why a revert did not happen. The document is left as it was. */
export interface RevertFailure {
  readonly document: string;
  /**
   * `read`: the file could not be read (or is gone); `format`: it is not a main file this editor reads; `changed`: an
   * edit was accepted after the revert was asked for, so reverting would discard work the user had not been told about.
   */
  readonly kind: "read" | "format" | "changed";
  readonly code: PlatformError["code"] | null;
  readonly message: string;
}

export type RevertResult = { readonly ok: true } | { readonly ok: false; readonly failure: RevertFailure };

/** An immutable view of the document at one moment. A new object is made for every change; an unchanged document returns the same object. */
export interface DocumentSnapshot<Command = unknown> {
  readonly identity: DocumentIdentity;
  /** True when the applied commands differ from what was last saved (ADR 0022 D3.2). */
  readonly dirty: boolean;
  /** Non-null when the document can only be viewed (D2.1). */
  readonly readOnly: ReadOnlyReason | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The applied commands, oldest first. The last one's `editId` is the one the host undoes (AD-19). */
  readonly edits: readonly EditRecord<Command>[];
  readonly saving: boolean;
  /** The last save's failure, kept until a later save starts; the edits it could not write stay in the model (D3.3). */
  readonly saveError: SaveFailure | null;
  /** A change on disk that waits for the user's choice (D3.5); while it waits, no save writes the file. */
  readonly conflict: ExternalChange | null;
}

/** Why a command was refused. A refused command changes nothing (ADR 0022 D3.1). */
export interface Rejection {
  readonly reason: "read-only" | "invalid";
  readonly message: string;
}

export type ApplyResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly rejection: Rejection };

export type HistoryResult =
  | { readonly ok: true; readonly editId: string }
  | { readonly ok: false; readonly reason: "nothing-to-undo" | "nothing-to-redo" | "stale-edit" | "read-only" };

export type SaveResult = { readonly ok: true } | { readonly ok: false; readonly failure: SaveFailure };

/** The document a view binds to: `getSnapshot()` and `subscribe()` (ADR 0025 decision 4), and the commands. */
export interface EditorDocument<Snapshot extends DocumentSnapshot<Command>, Command> {
  /** The registered kind of this document (ADR 0026 decision 1). */
  readonly kind: string;
  readonly identity: DocumentIdentity;
  getSnapshot(): Snapshot;
  /** Call `listener` after every change to the snapshot; the returned function removes it. */
  subscribe(listener: () => void): () => void;
  /** Apply an edit command and return either its edit identity or a rejection. */
  apply(command: Command): ApplyResult;
  /** Return the current model encoded as a fresh byte array, including edits not yet written to storage. */
  serialize(): Uint8Array;
  /** Undo the latest applied edit. With `editId`, only that edit, and only while it is still the latest (AD-19). */
  undo(editId?: string): HistoryResult;
  /** Redo the latest undone edit. With `editId`, only that edit. */
  redo(editId?: string): HistoryResult;
  /**
   * Write the current model through the host and mark the document clean only when the host reports the bytes written
   * (ADR 0022 D3.3). Edits made while the write is in flight stay dirty. Saves run one after another. The promise never
   * rejects: a refused, thrown or rejected write is a `SaveFailure` value, and one failed save does not stop the next.
   *
   * Before writing, the file is read and compared with the bytes the document last read or wrote. If another program
   * changed it, nothing is written: the save fails with `conflict` and the change waits in `conflict` (D3.5, D11.3).
   */
  save(): Promise<SaveResult>;
  /**
   * Read the file and compare it with what the document last read or wrote, after any save in flight. A clean document
   * follows the file (nothing local can be lost); a dirty one keeps its work and the change waits for `resolveConflict`.
   * Hosts that watch files call this on every change they see (D3.5).
   */
  checkExternal(): Promise<ExternalCheck>;
  /** Settle a waiting external change. `keep-local` makes the next save replace the file; `reload` shows the file's version. */
  resolveConflict(choice: ConflictChoice): ConflictResult;
  /**
   * Go back to the file on disk. If it still holds the last saved revision, the edits after that revision are dropped and
   * the history before it is kept; otherwise the document is reloaded from the file with an empty history. Confirming
   * the loss is the caller's job (D3.6), which is why a caller that asked the user first passes the `editId` in force
   * when it asked: an edit accepted since then makes the revert refuse (`changed`) instead of discarding it.
   */
  revert(expectedHead?: string | null): Promise<RevertResult>;
  /**
   * Write the current content to `target` (Save As, D3.4). This document is not changed: it keeps its identity, its
   * history and its dirty state (D1.3). The caller checks the destination for collisions first.
   */
  saveAs(storage: DocumentStorage, target: DocumentIdentity): Promise<SaveResult>;
}

/** Project-identified filesystem operations used by a document (ADR 0022 D1.1). */
export type DocumentStorage = Pick<FileSystemService, "readProject" | "writeProject">;

export type OpenError =
  /** The host could not read the file. */
  | { readonly kind: "read"; readonly document: string; readonly error: PlatformError }
  /** The bytes are not a main file this reader accepts (the reader's located error, AD-18); the document is not opened at all. */
  | { readonly kind: "format"; readonly document: string; readonly error: FormatError };

/**
 * What a kind supplies (ADR 0026 decision 3). Every function is pure: the same inputs give the same result, and none
 * touches the host.
 */
export interface DocumentCodec<Model, Command, Fields extends object = Record<never, never>> {
  /** The registered kind identifier (ADR 0026 decision 1). */
  readonly kind: string;
  /** Read `bytes`; a file the reader refuses is not opened. `path` locates its errors. */
  read(bytes: Uint8Array, path: string): Result<Model>;
  /** Encode a model; the writer emits the version the model was read at (AD-18). */
  write(model: Model): Result<Uint8Array>;
  /** `null` when the writer reproduces `bytes` exactly, which is what a same-version writer means (ADR 0022 D2.1). */
  readOnlyReason(model: Model, bytes: Uint8Array): ReadOnlyReason | null;
  /** Apply one command. Pure, and total: a command `refuse` does not reject always produces a model. */
  apply(model: Model, command: Command): Model;
  /** The words an undo menu shows for `command` (AD-19). */
  label(command: Command): string;
  /** Refuse a command whose result the writer cannot store or the reader would not give back, or that changes nothing; `null` accepts it. */
  refuse(next: Model, command: Command, previous: Model): Rejection | null;
  /** A short name for a model, shown beside a conflict so the user can tell the versions apart; `null` when it has none. */
  summary(model: Model): string | null;
  /** The snapshot fields this kind adds to the shared ones. */
  fields(model: Model): Fields;
}

export type OpenResult<Document> =
  | { readonly ok: true; readonly document: Document }
  | { readonly ok: false; readonly error: OpenError };

/** Read the file at `identity.path` through `storage` and open it with `codec`. */
export async function openBinaryDocument<Model, Command, Fields extends object>(
  codec: DocumentCodec<Model, Command, Fields>,
  storage: DocumentStorage,
  identity: DocumentIdentity,
): Promise<OpenResult<BinaryDocument<Model, Command, Fields>>> {
  const captured = Object.freeze({ ...identity });
  const read = await storage.readProject(captured.projectId, captured.path);
  if (!read.ok) return { ok: false, error: { kind: "read", document: captured.path, error: read.error } };
  return createBinaryDocument(codec, storage, captured, read.value);
}

/**
 * Open a document over bytes already in hand. A file the codec's reader refuses is not opened. A file it reads is then
 * written back once, in memory: if the writer does not give the same bytes the document opens **read-only** with the
 * reason, because a read-write open needs a same-version writer and the editor never converts on open (ADR 0022 D2.1).
 */
export function createBinaryDocument<Model, Command, Fields extends object>(
  codec: DocumentCodec<Model, Command, Fields>,
  storage: DocumentStorage,
  identity: DocumentIdentity,
  bytes: Uint8Array,
): OpenResult<BinaryDocument<Model, Command, Fields>> {
  const opened = bytes.slice();
  const read = codec.read(opened, identity.path);
  if (!read.ok) return { ok: false, error: { kind: "format", document: identity.path, error: read.error } };
  return { ok: true, document: new BinaryDocument(codec, storage, identity, read.value, opened) };
}

/** @internal Keep a recovered revision unsaved until this document actually writes it or explicitly reloads it. */
export function markRecoveredDocumentDirty(document: EditorDocument<never, never>): void {
  if (!(document instanceof BinaryDocument)) throw new Error("Recovery requires a document created by the editor model.");
  document.markRecoveredDirty();
}

export function firstDifference(a: Uint8Array, b: Uint8Array): number | null {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? null : shared;
}

/** The one class every binary kind uses (ADR 0026 decision 3); a kind is its `DocumentCodec`. */
export class BinaryDocument<Model, Command, Fields extends object = Record<never, never>>
  implements EditorDocument<DocumentSnapshot<Command> & Fields, Command>
{
  readonly kind: string;
  readonly identity: DocumentIdentity;
  readonly #codec: DocumentCodec<Model, Command, Fields>;
  readonly #storage: DocumentStorage;
  /** The model the file held when it was opened or last reloaded; the applied commands are replayed over it. */
  #base: Model;
  /** The bytes `#base` was read from: a read-only document's content, which Save As copies unchanged. */
  #opened: Uint8Array;
  #readOnly: ReadOnlyReason | null;
  readonly #listeners = new Set<() => void>();
  /** Every command ever accepted and not discarded: `#applied` of them are in force, the rest can be redone. */
  #stack: EditRecord<Command>[] = [];
  #applied = 0;
  /** How many commands were in force when the file was last written, or `null` when that state can no longer be reached. */
  #savedAt: number | null = 0;
  /** A recovered revision needs a successful write, not another writer's coincidentally equal bytes. */
  #recoveryRequiresWrite = false;
  /** Changes to the model or history, including edits that are subsequently undone. */
  #generation = 0;
  /** Never reset, so an edit id is never reused, even after a reload: a host still holding an old id gets `stale-edit`. */
  #nextId = 1;
  #model: Model;
  /** The comparison baseline: the bytes last read or successfully written, or `null` when known absent. */
  #disk: Uint8Array | null;
  /** Bytes of the most recent write the host did not report durable, until a write succeeds. */
  #failedWrite: Uint8Array | null = null;
  /** Failed bytes are attributable to our write only until a newer disk baseline is accepted. */
  #failedWriteMatchesBaseline = false;
  /** A change on disk waiting for the user's choice, with the bytes found (`null`: the file is gone). */
  #external: { readonly bytes: Uint8Array | null; readonly change: ExternalChange } | null = null;
  /** Saves asked for and not yet finished. */
  #pending = 0;
  #saveError: SaveFailure | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #snapshot: DocumentSnapshot<Command> & Fields;

  constructor(codec: DocumentCodec<Model, Command, Fields>, storage: DocumentStorage, identity: DocumentIdentity, model: Model, bytes: Uint8Array) {
    this.#codec = codec;
    this.kind = codec.kind;
    this.identity = Object.freeze({ ...identity });
    this.#storage = storage;
    this.#base = model;
    this.#model = model;
    this.#opened = bytes;
    this.#disk = bytes;
    this.#readOnly = codec.readOnlyReason(model, bytes);
    this.#snapshot = this.#makeSnapshot();
  }

  markRecoveredDirty(): void {
    this.#recoveryRequiresWrite = true;
    this.#savedAt = null;
    this.#publish();
  }

  serialize(): Uint8Array {
    const encoded = this.#codec.write(this.#model);
    if (!encoded.ok) throw new Error(`Could not serialize ${this.identity.path}: ${encoded.error.message}`);
    return encoded.value.slice();
  }

  getSnapshot(): DocumentSnapshot<Command> & Fields {
    return this.#snapshot;
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  apply(command: Command): ApplyResult {
    if (this.#readOnly !== null) {
      return { ok: false, rejection: { reason: "read-only", message: this.#readOnly.message } };
    }
    const next = this.#codec.apply(this.#model, command);
    const refusal = this.#codec.refuse(next, command, this.#model);
    if (refusal !== null) return { ok: false, rejection: refusal };
    const record: EditRecord<Command> = { editId: `edit-${this.#nextId}`, label: this.#codec.label(command), command };
    this.#nextId += 1;
    // A new command discards what could have been redone; a saved state inside the discarded part can never be reached again.
    this.#stack = [...this.#stack.slice(0, this.#applied), record];
    if (this.#savedAt !== null && this.#savedAt > this.#applied) this.#savedAt = null;
    this.#applied += 1;
    this.#generation += 1;
    this.#model = next;
    this.#publish();
    return { ok: true, editId: record.editId };
  }

  undo(editId?: string): HistoryResult {
    if (this.#readOnly !== null) return { ok: false, reason: "read-only" };
    const latest = this.#stack[this.#applied - 1];
    if (latest === undefined) return { ok: false, reason: "nothing-to-undo" };
    if (editId !== undefined && editId !== latest.editId) return { ok: false, reason: "stale-edit" };
    this.#applied -= 1;
    this.#generation += 1;
    this.#model = this.#replay();
    this.#publish();
    return { ok: true, editId: latest.editId };
  }

  redo(editId?: string): HistoryResult {
    if (this.#readOnly !== null) return { ok: false, reason: "read-only" };
    const next = this.#stack[this.#applied];
    if (next === undefined) return { ok: false, reason: "nothing-to-redo" };
    if (editId !== undefined && editId !== next.editId) return { ok: false, reason: "stale-edit" };
    this.#applied += 1;
    this.#generation += 1;
    this.#model = this.#replay();
    this.#publish();
    return { ok: true, editId: next.editId };
  }

  save(): Promise<SaveResult> {
    const path = this.identity.path;
    if (this.#readOnly !== null) {
      return Promise.resolve(
        this.#failNow({ document: path, kind: "read-only", code: null, message: `${path} is read-only: ${this.#readOnly.message}` }),
      );
    }
    // The revision this save writes is fixed now, when it is asked for: the commands in force, identified by the last
    // one's id, and the bytes they make. Edits made after this call are not part of it and stay dirty (ADR 0022 D3.3).
    const revision = this.#applied;
    const head = this.#stack[revision - 1]?.editId ?? null;
    const encoded = this.#codec.write(this.#model);
    if (!encoded.ok) {
      return Promise.resolve(
        this.#failNow({ document: path, kind: "format", code: null, message: `Could not save ${path}: ${encoded.error.message}` }),
      );
    }
    const bytes = encoded.value;
    this.#pending += 1;
    // A later save starts: the failure of an earlier one is no longer news, and is not shown beside "Saving…".
    this.#saveError = null;
    this.#publish();
    // `#write` settles every outcome into a `SaveResult`, so the chain never holds a rejection and the next save runs.
    const run = this.#queue.then(() => this.#write(path, bytes, revision, head));
    this.#queue = run;
    return run;
  }

  checkExternal(): Promise<ExternalCheck> {
    // Behind any save in flight: the file it is writing is this document's own change, not another program's.
    const run = this.#queue.then(() => this.#check());
    this.#queue = run;
    return run;
  }

  resolveConflict(choice: ConflictChoice): ConflictResult {
    const path = this.identity.path;
    const external = this.#external;
    if (external === null) return { ok: false, reason: "no-conflict", message: `${path} has no change on disk waiting for a choice.` };
    if (choice === "keep-local") {
      // The file now holds the other version: the next save replaces it, by the user's choice. Until then no revision of
      // this document is on disk, so it is dirty even if undo comes back to what was saved before.
      this.#disk = external.bytes;
      this.#failedWriteMatchesBaseline = false;
      this.#external = null;
      if (this.#readOnly === null) this.#savedAt = null;
      this.#publish();
      return { ok: true };
    }
    if (external.bytes === null || !this.#load(external.bytes)) {
      return {
        ok: false,
        reason: "cannot-reload",
        message: external.bytes === null
          ? `${path} is no longer on disk, so there is no version to load; keep yours or close the document.`
          : `The version of ${path} on disk is not a main file this editor reads, so it cannot be loaded; keep yours or close the document.`,
      };
    }
    this.#publish();
    return { ok: true };
  }

  revert(expectedHead?: string | null): Promise<RevertResult> {
    const head = expectedHead === undefined ? (this.#stack[this.#applied - 1]?.editId ?? null) : expectedHead;
    const generation = this.#generation;
    const run = this.#queue.then(() => this.#revert(head, generation));
    this.#queue = run;
    return run;
  }

  async saveAs(storage: DocumentStorage, target: DocumentIdentity): Promise<SaveResult> {
    const destination = target.path;
    let bytes: Uint8Array;
    if (this.#readOnly !== null) {
      // A read-only document has no edits: a copy of the file is the file, never a conversion (D2.1).
      bytes = this.#opened.slice();
    } else {
      const encoded = this.#codec.write(this.#model);
      if (!encoded.ok) {
        return { ok: false, failure: { document: destination, kind: "format", code: null, message: `Could not save ${destination}: ${encoded.error.message}` } };
      }
      bytes = encoded.value;
    }
    let written: PlatformResult<void>;
    try {
      written = await storage.writeProject(target.projectId, destination, bytes);
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      return { ok: false, failure: { document: destination, kind: "write", code: null, message: `Could not save ${destination}: ${reason}` } };
    }
    if (!written.ok) {
      return {
        ok: false,
        failure: { document: destination, kind: "write", code: written.error.code, message: `Could not save ${destination}: ${written.error.message}` },
      };
    }
    return { ok: true };
  }

  async #write(path: string, bytes: Uint8Array, revision: number, head: string | null): Promise<SaveResult> {
    try {
      this.#saveError = null;
      if (this.#savedAt === revision && this.#isRevision(revision, head)) return { ok: true };
      // A change already waiting for the user's choice is never written over (D3.5).
      if (this.#external !== null) return this.#fail(this.#conflictFailure(this.#external.change));
      // A failed write may have changed the file, but the last known baseline remains the comparison point.
      const onDisk = await this.#readDisk();
      if (!onDisk.ok) {
        return this.#fail({
          document: path,
          kind: "write",
          code: onDisk.error.code,
          message: `Could not save ${path}: the file on disk could not be checked first: ${onDisk.error.message}`,
        });
      }
      // Seeing our failed write's bytes is not proof of durability: retry the host write.
      const matchesFailedWrite = this.#failedWriteMatchesBaseline && onDisk.bytes !== null && this.#failedWrite !== null
        && sameBytes(onDisk.bytes, this.#failedWrite);
      if (!sameContent(onDisk.bytes, this.#disk) && !matchesFailedWrite) {
        if (this.#failedWrite === null && onDisk.bytes !== null && sameBytes(onDisk.bytes, bytes)) {
          // An equal external revision is a valid baseline, but recovery still needs its own successful write.
          this.#disk = onDisk.bytes;
          if (!this.#recoveryRequiresWrite) {
            this.#savedAt = this.#isRevision(revision, head) ? revision : null;
            return { ok: true };
          }
        } else {
          const change = this.#raise(onDisk.bytes);
          return this.#fail(this.#conflictFailure(change));
        }
      }
      let written: PlatformResult<void>;
      try {
        written = await this.#storage.writeProject(this.identity.projectId, path, bytes);
      } catch (thrown) {
        // A host that throws or rejects instead of answering is a failed write like any other (ADR 0022 D3.3).
        return this.#failWrite(path, bytes, null, thrown instanceof Error ? thrown.message : String(thrown));
      }
      if (!written.ok) return this.#failWrite(path, bytes, written.error.code, written.error.message);
      this.#disk = bytes;
      this.#failedWrite = null;
      this.#failedWriteMatchesBaseline = false;
      this.#recoveryRequiresWrite = false;
      // Clean only if that revision is still part of the history: an edit made during the write stays dirty, and an
      // undo followed by a different edit during the write means the written state is gone from the history.
      this.#savedAt = this.#isRevision(revision, head) ? revision : null;
      return { ok: true };
    } finally {
      this.#pending -= 1;
      this.#publish();
    }
  }

  async #check(): Promise<ExternalCheck> {
    const onDisk = await this.#readDisk();
    if (!onDisk.ok) return "unknown";
    if (this.#failedWriteMatchesBaseline && onDisk.bytes !== null && this.#failedWrite !== null
      && sameBytes(onDisk.bytes, this.#failedWrite)) return "unknown";
    if (sameContent(onDisk.bytes, this.#disk)) {
      // The file is back to what this document knows: a change that was waiting is no longer a change.
      if (this.#external !== null) {
        this.#external = null;
        this.#publish();
      }
      return "unchanged";
    }
    const clean = this.#savedAt === this.#applied && this.#external === null;
    // A clean document has nothing of its own to lose, so it follows the file, as a text editor does.
    if (clean && onDisk.bytes !== null && this.#load(onDisk.bytes)) {
      this.#publish();
      return "reloaded";
    }
    const current = this.#readOnly === null ? this.#codec.write(this.#model) : null;
    if (this.#failedWrite === null && onDisk.bytes !== null && current?.ok === true && sameBytes(onDisk.bytes, current.value)) {
      // Another writer produced the current bytes. Recovery still requires its own successful write.
      this.#disk = onDisk.bytes;
      if (!this.#recoveryRequiresWrite) this.#savedAt = this.#applied;
      this.#external = null;
      this.#publish();
      return "unchanged";
    }
    this.#raise(onDisk.bytes);
    this.#publish();
    return "conflict";
  }

  async #revert(expectedHead: string | null, generation: number): Promise<RevertResult> {
    const path = this.identity.path;
    if (this.#generation !== generation || (this.#stack[this.#applied - 1]?.editId ?? null) !== expectedHead) {
      return {
        ok: false,
        failure: { document: path, kind: "changed", code: null, message: `Could not revert ${path}: it was edited after the revert was chosen, so nothing was reverted.` },
      };
    }
    const onDisk = await this.#readDisk();
    if (this.#generation !== generation || (this.#stack[this.#applied - 1]?.editId ?? null) !== expectedHead) {
      return {
        ok: false,
        failure: { document: path, kind: "changed", code: null, message: `Could not revert ${path}: it was edited after the revert was chosen, so nothing was reverted.` },
      };
    }
    if (!onDisk.ok) {
      return { ok: false, failure: { document: path, kind: "read", code: onDisk.error.code, message: `Could not revert ${path}: ${onDisk.error.message}` } };
    }
    if (onDisk.bytes === null) {
      return { ok: false, failure: { document: path, kind: "read", code: "not-found", message: `Could not revert ${path}: the file is no longer on disk.` } };
    }
    if (this.#savedAt !== null && sameContent(onDisk.bytes, this.#disk)) {
      // The saved revision is still the file: return to it, keep the history before it and drop what came after, as a
      // host's own revert does.
      this.#stack = this.#stack.slice(0, this.#savedAt);
      this.#applied = this.#savedAt;
      this.#generation += 1;
      this.#model = this.#replay();
      this.#external = null;
      this.#saveError = null;
      this.#publish();
      return { ok: true };
    }
    if (!this.#load(onDisk.bytes)) {
      return {
        ok: false,
        failure: { document: path, kind: "format", code: null, message: `Could not revert ${path}: the file on disk is not a main file this editor reads.` },
      };
    }
    this.#publish();
    return { ok: true };
  }

  /** Replace the document's content with `bytes` and start a new history over it; `false` (and nothing changed) if they are not a main file. */
  #load(bytes: Uint8Array): boolean {
    const read = this.#codec.read(bytes, this.identity.path);
    if (!read.ok) return false;
    this.#generation += 1;
    this.#base = read.value;
    this.#model = read.value;
    this.#opened = bytes.slice();
    this.#readOnly = this.#codec.readOnlyReason(read.value, this.#opened);
    this.#stack = [];
    this.#applied = 0;
    this.#savedAt = this.#failedWrite === null ? 0 : null;
    this.#recoveryRequiresWrite = false;
    this.#disk = this.#opened;
    this.#failedWriteMatchesBaseline = false;
    this.#external = null;
    this.#saveError = null;
    return true;
  }

  /** Read the file: its bytes, `null` when it does not exist, or the host's error. A throwing host is an error too. */
  async #readDisk(): Promise<{ readonly ok: true; readonly bytes: Uint8Array | null } | { readonly ok: false; readonly error: PlatformError }> {
    let read: PlatformResult<Uint8Array>;
    try {
      read = await this.#storage.readProject(this.identity.projectId, this.identity.path);
    } catch (thrown) {
      return { ok: false, error: { code: "io-error", message: thrown instanceof Error ? thrown.message : String(thrown) } };
    }
    if (read.ok) return { ok: true, bytes: read.value };
    if (read.error.code === "not-found") return { ok: true, bytes: null };
    return { ok: false, error: read.error };
  }

  /** Keep the version found on disk beside the local one until the user chooses (D3.5). */
  #raise(bytes: Uint8Array | null): ExternalChange {
    const path = this.identity.path;
    const read = bytes === null ? null : this.#codec.read(bytes, path);
    const change: ExternalChange = bytes === null
      ? { document: path, kind: "deleted", externalTitle: null, message: `${path} was deleted on disk by another program. Your version is kept; keep it to save it again, or close the document.` }
      : {
          document: path,
          kind: "changed",
          externalTitle: read?.ok === true ? this.#codec.summary(read.value) : null,
          message: `${path} was changed on disk by another program. Your version and the one on disk are both kept until you choose.`,
        };
    this.#external = { bytes: bytes === null ? null : bytes.slice(), change };
    return change;
  }

  #conflictFailure(change: ExternalChange): SaveFailure {
    return { document: change.document, kind: "conflict", code: null, message: `${change.message} Nothing was saved.` };
  }

  /**
   * A failed write may leave the file in any state. Keep the comparison baseline and the attempted bytes: seeing those
   * bytes later is not proof of a durable write. Only a successful write report clears this uncertainty.
   */
  #failWrite(path: string, bytes: Uint8Array, code: PlatformError["code"] | null, reason: string): SaveResult {
    this.#savedAt = null;
    this.#failedWrite = bytes;
    this.#failedWriteMatchesBaseline = true;
    return this.#fail({ document: path, kind: "write", code, message: `Could not save ${path}: ${reason}` });
  }

  /** Whether the commands that were in force at `revision` are still the first `revision` commands of the stack. */
  #isRevision(revision: number, head: string | null): boolean {
    return this.#stack.length >= revision && (this.#stack[revision - 1]?.editId ?? null) === head;
  }

  /** Record a failure that will be published with the rest of the save's outcome. */
  #fail(failure: SaveFailure): SaveResult {
    this.#saveError = failure;
    return { ok: false, failure };
  }

  /** Record a failure of a save that never reached the host, and tell the listeners. */
  #failNow(failure: SaveFailure): SaveResult {
    const result = this.#fail(failure);
    this.#publish();
    return result;
  }

  #replay(): Model {
    let model = this.#base;
    for (let index = 0; index < this.#applied; index += 1) {
      const record = this.#stack[index];
      if (record !== undefined) model = this.#codec.apply(model, record.command);
    }
    return model;
  }

  #makeSnapshot(): DocumentSnapshot<Command> & Fields {
    return {
      ...this.#codec.fields(this.#model),
      identity: this.identity,
      dirty: this.#savedAt !== this.#applied,
      readOnly: this.#readOnly,
      canUndo: this.#readOnly === null && this.#applied > 0,
      canRedo: this.#readOnly === null && this.#applied < this.#stack.length,
      edits: this.#stack.slice(0, this.#applied),
      saving: this.#pending > 0,
      saveError: this.#saveError,
      conflict: this.#external?.change ?? null,
    };
  }

  #publish(): void {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of [...this.#listeners]) {
      // A listener is somebody else's code. If it throws, the document's state and the other listeners are not its to spoil.
      try {
        listener();
      } catch {
        // Nothing to do here: a view that cannot update is that view's fault, and the snapshot it missed is still current.
      }
    }
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return firstDifference(a, b) === null;
}

/** Equal file states: the same bytes, or both absent. */
function sameContent(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a === null || b === null ? a === b : sameBytes(a, b);
}
