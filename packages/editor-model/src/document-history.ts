import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";

/**
 * Per-document saved-version timelines (ADR 0022 D12): successful saves of covered documents are kept as SHA-256 content
 * records with timelines and restore. Project-operation checkpoints and named project checkpoints use the canonical
 * `CheckpointGroups` service in `checkpoint-groups.ts`; this store does not persist group manifests.
 */

export type HistoryReason =
  | "auto"
  | "manual"
  | "before-run"
  | "before-restore"
  | "before-conflict-resolution"
  | "before-delete"
  | "before-wizard"
  | "checkpoint";

/** The reserved project-root folder (D12.10 item 1). Compared ASCII-folded like every project path. */
export const HISTORY_FOLDER = ".tkr-history";
const BLOBS = `${HISTORY_FOLDER}/blobs`;
const ENTRIES = `${HISTORY_FOLDER}/entries`;

/** Folders that history, packages and named checkpoints never treat as project content (D12.10 items 1 and 7). */
export const RESERVED_NON_CONTENT = [HISTORY_FOLDER, ".tkr-exports", "saved"] as const;

/** The retention knobs (D12.8). They are user-only editor settings; the values live in `history-policy.ts`. */
export interface HistoryPolicy {
  /** `auto` saves of one document within this many milliseconds of the window's first save share one entry. */
  readonly mergeWindowMs: number;
  /** An `auto` entry may be offered for thinning only after it is this old. Every other entry is kept until the user deletes it. */
  readonly autoFloorMs: number;
  /** Above this many bytes of history in a project the view warns and offers thinning. */
  readonly warnBytes: number;
  /** A file larger than this is not covered by history. */
  readonly maxCoveredBytes: number;
}

export interface DocumentHistoryEntry {
  readonly id: string;
  readonly path: string;
  /** When the newest save this entry holds happened. */
  readonly savedAt: number;
  readonly reason: HistoryReason;
  readonly sha256: string;
  readonly size: number;
  readonly groupId: string | null;
  /** A merged autosave entry: when its merge window opened, and how many saves it holds. */
  readonly windowStart?: number;
  readonly merged?: number;
}

export interface UncoveredFile {
  readonly path: string;
  readonly reason: "type" | "size";
  readonly size: number;
}


export type Coverage = { readonly covered: true } | { readonly covered: false; readonly reason: "type" | "size" };

export type RecordOutcome =
  | { readonly outcome: "recorded" | "merged"; readonly entry: DocumentHistoryEntry }
  | { readonly outcome: "uncovered"; readonly reason: "type" | "size" };

export interface HistoryPreview {
  readonly entry: DocumentHistoryEntry;
  readonly bytes: Uint8Array;
}


/** Where history is kept in this host (D12.10 item 8): the view says which one, truthfully. */
export interface HistoryLocation {
  readonly kind: "project-folder" | "host-storage" | "session-memory";
  readonly description: string;
}

export type FileRestoreResult = "restored" | "already-as-wanted" | "kept-uncertain" | "uncovered" | "failed";

export interface FileRestoreReport {
  readonly path: string;
  readonly result: FileRestoreResult;
  readonly message?: string;
}

export interface GroupRestoreReport {
  readonly groupId: string;
  /** The group the restore itself recorded, or `null` when it could not start. Restoring it undoes this restore. */
  readonly restoreGroupId: string | null;
  readonly files: readonly FileRestoreReport[];
}

/** What the restore loop needs from the editor: current content (open documents included) and an accepted way to change it. */
export interface HistoryRestorer {
  /** The content `path` has now as the editor sees it (an open document's content even when unsaved); `bytes: null` when absent. */
  current(path: string): Promise<{ readonly ok: true; readonly bytes: Uint8Array | null; readonly unsaved: boolean } | { readonly ok: false; readonly message: string }>;
  /**
   * Make `path` hold `bytes` (`null` deletes it) as an accepted change. It must record its own save when it writes.
   * `expected` is exactly what `current(path)` returned for this restore: applying must refuse (`ok: false`) when the path
   * no longer holds it, because an edit accepted while the restore recorded its history would otherwise be overwritten.
   */
  apply(path: string, bytes: Uint8Array | null, context: { readonly groupId: string; readonly expected: Uint8Array | null }): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

export interface HistoryUsage {
  readonly entries: number;
  readonly distinctContents: number;
  /** Bytes of content plus records. */
  readonly bytes: number;
  readonly warnBytes: number;
  readonly overWarning: boolean;
}

export interface ThinningCandidate {
  readonly entry: DocumentHistoryEntry;
  /** Bytes freed by deleting this entry alone, given the ones listed before it. */
  readonly frees: number;
}

export interface HistoryProblem {
  readonly at: number;
  readonly path: string | null;
  readonly message: string;
}

export interface DocumentHistoryStore {
  readonly location: HistoryLocation;
  coverage(path: string, size: number): Coverage;
  /** Record a successful save. `auto` saves merge inside the window (D12.8). Uncovered files record nothing. */
  recordSave(path: string, bytes: Uint8Array, reason: HistoryReason, groupId?: string | null): Promise<RecordOutcome>;
  /** Keep content that is about to be replaced or discarded unless an entry already holds it (D12.10 items 4 and 5). */
  keep(path: string, bytes: Uint8Array, reason: HistoryReason): Promise<RecordOutcome | { readonly outcome: "held" }>;
  documentTimeline(path: string): Promise<readonly DocumentHistoryEntry[]>;
  projectTimeline(): Promise<readonly DocumentHistoryEntry[]>;
  /** Files the editor saved that history does not cover, for the history view (D12.10 item 7). */
  uncovered(): Promise<readonly UncoveredFile[]>;
  preview(entryId: string): Promise<HistoryPreview | null>;
  usage(): Promise<HistoryUsage>;
  /** The `auto` entries older than the floor, oldest first; nothing is deleted by asking. */
  thinningPlan(): Promise<readonly ThinningCandidate[]>;
  /** Delete the listed entries, but only those the plan would offer now (never below the floors). Returns the bytes freed. */
  thin(entryIds: readonly string[]): Promise<number>;
  /** A user's own deletion of one entry, with no floor (D12.10 item 10). */
  deleteEntry(entryId: string): Promise<void>;
  /** Failures to record history that the user has not seen resolved (D12.10 item 4). */
  problems(): readonly HistoryProblem[];
  reportProblem(path: string | null, message: string): void;
  clearProblems(path: string): void;
  subscribe(listener: () => void): () => void;
  /** Read everything again from storage, for a view that opens after another editor wrote. */
  reload(): Promise<void>;
}

export class HistoryError extends Error {}

const encode = (value: unknown): Uint8Array => utf8Encode(JSON.stringify(value));
const missing = (error: { readonly code: string | null }): boolean => error.code === "not-found";
const validPath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const validId = (id: string): boolean => /^[a-z0-9-]+$/.test(id);
const byTime = <T extends { readonly id: string }>(time: (item: T) => number) => (a: T, b: T): number => time(a) - time(b) || a.id.localeCompare(b.id);

/** SHA-256 in lower-case hex, by Web Crypto, which every host provides. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const crypto = Reflect.get(globalThis, "crypto") as { readonly subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } } | undefined;
  if (crypto?.subtle === undefined) throw new HistoryError("This host does not provide Web Crypto SHA-256, so history cannot be kept.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSuffix(): string {
  const crypto = Reflect.get(globalThis, "crypto") as { getRandomValues?(array: Uint8Array): Uint8Array } | undefined;
  const bytes = new Uint8Array(4);
  crypto?.getRandomValues?.(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface DocumentHistoryOptions {
  /** The project's own files: what a group captures and a named checkpoint walks. */
  readonly project: Pick<FileSystemService, "read" | "list" | "stat">;
  /** Where history is kept: the project's filesystem, or a host's own storage (D12.10 item 8). */
  readonly storage: Pick<FileSystemService, "read" | "write" | "createFolder" | "list" | "delete">;
  readonly location: HistoryLocation;
  readonly policy: () => HistoryPolicy;
  /** Whether a path is a type history covers. The editor passes the document registry. */
  readonly coveredType: (path: string) => boolean;
  readonly now?: () => number;
}

interface Index {
  readonly entries: Map<string, DocumentHistoryEntry>;
  /** Records that were present but unreadable, reported once each. */
  readonly unreadable: string[];
}

export function createDocumentHistoryStore(options: DocumentHistoryOptions): DocumentHistoryStore {
  const { project, storage, location } = options;
  const now = options.now ?? Date.now;
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let index: Index | null = null;
  const listeners = new Set<() => void>();
  const issues: HistoryProblem[] = [];
  const uncoveredSeen = new Map<string, UncoveredFile>();

  const notify = (): void => { for (const listener of [...listeners]) { try { listener(); } catch { /* a listener is somebody else's code */ } } };
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const fail = (message: string): never => { throw new HistoryError(message); };
  const coverage = (path: string, size: number): Coverage => {
    const folded = path.toLowerCase();
    if (RESERVED_NON_CONTENT.some((folder) => folded === folder || folded.startsWith(`${folder}/`))) return { covered: false, reason: "type" };
    if (!options.coveredType(path)) return { covered: false, reason: "type" };
    if (size > options.policy().maxCoveredBytes) return { covered: false, reason: "size" };
    return { covered: true };
  };
  const noteUncovered = (path: string, reason: "type" | "size", size: number): void => { uncoveredSeen.set(path, { path, reason, size }); };

  const ensure = async (): Promise<void> => {
    for (const path of [HISTORY_FOLDER, BLOBS, ENTRIES]) {
      const made = await storage.createFolder(path);
      if (!made.ok) fail(`Could not create the history folder ${path}: ${made.error.message}`);
    }
  };
  const newId = (): string => `${now().toString(36)}-${(++sequence).toString(36)}-${randomSuffix()}`;

  const readRecords = async <T>(folder: string, known: string[]): Promise<T[]> => {
    const listed = await storage.list(folder);
    if (!listed.ok) { if (missing(listed.error)) return []; return fail(`Could not list ${folder}: ${listed.error.message}`); }
    const records: T[] = [];
    for (const item of listed.value) {
      if (item.kind !== "file" || !item.name.endsWith(".json")) continue;
      const read = await storage.read(`${folder}/${item.name}`);
      if (!read.ok) { known.push(`${folder}/${item.name}: ${read.error.message}`); continue; }
      try { records.push(JSON.parse(utf8Decode(read.value)) as T); }
      catch { known.push(`${folder}/${item.name} is not a complete history record and is ignored.`); }
    }
    return records;
  };
  const load = async (force = false): Promise<Index> => {
    if (index !== null && !force) return index;
    const unreadable: string[] = [];
    const entries = new Map((await readRecords<DocumentHistoryEntry>(ENTRIES, unreadable)).map((entry) => [entry.id, entry] as const));
    index = { entries, unreadable };
    for (const message of unreadable) if (!issues.some((issue) => issue.message === message)) issues.push({ at: now(), path: null, message });
    return index;
  };
  const referenced = (idx: Index, sha: string, except?: { readonly entry?: string }): boolean => {
    for (const entry of idx.entries.values()) if (entry.sha256 === sha && entry.id !== except?.entry) return true;
    return false;
  };

  const putBlob = async (bytes: Uint8Array): Promise<string> => {
    const hash = await sha256Hex(bytes);
    const path = `${BLOBS}/${hash}`;
    const current = await storage.read(path);
    if (current.ok) {
      if (await sha256Hex(current.value) === hash) return hash;
      // A blob that fails its own name is replaced, never trusted.
    } else if (!missing(current.error)) fail(`Could not check history content ${hash}: ${current.error.message}`);
    const written = await storage.write(path, bytes);
    if (!written.ok) fail(`Could not store history content ${hash}: ${written.error.message}`);
    return hash;
  };
  const readBlob = async (sha: string, what: string): Promise<Uint8Array> => {
    const blob = await storage.read(`${BLOBS}/${sha}`);
    if (!blob.ok) return fail(`History content for ${what} is unavailable: ${blob.error.message}`);
    if (await sha256Hex(blob.value) !== sha) return fail(`History content for ${what} failed its SHA-256 check and is not used.`);
    return blob.value;
  };
  const writeRecord = async (folder: string, id: string, value: unknown, what: string): Promise<void> => {
    const written = await storage.write(`${folder}/${id}.json`, encode(value));
    if (!written.ok) fail(`Could not record ${what}: ${written.error.message}`);
  };
  const dropBlobIfUnused = async (idx: Index, sha: string): Promise<number> => {
    if (referenced(idx, sha)) return 0;
    const sizes = [...idx.entries.values()].find((entry) => entry.sha256 === sha)?.size;
    const removed = await storage.delete(`${BLOBS}/${sha}`);
    return removed.ok ? (sizes ?? 0) : 0;
  };

  const latestFor = (idx: Index, path: string): DocumentHistoryEntry | undefined => {
    let latest: DocumentHistoryEntry | undefined;
    for (const entry of idx.entries.values()) if (entry.path === path && (latest === undefined || entry.savedAt > latest.savedAt || (entry.savedAt === latest.savedAt && entry.id > latest.id))) latest = entry;
    return latest;
  };
  const holds = (idx: Index, path: string, sha: string): boolean => {
    for (const entry of idx.entries.values()) if (entry.path === path && entry.sha256 === sha) return true;
    return false;
  };

  const recordNow = async (path: string, bytes: Uint8Array, reason: HistoryReason, groupId: string | null): Promise<RecordOutcome> => {
    if (!validPath(path)) fail(`Invalid project-relative history path: ${path}`);
    const cover = coverage(path, bytes.byteLength);
    if (!cover.covered) { noteUncovered(path, cover.reason, bytes.byteLength); return { outcome: "uncovered", reason: cover.reason }; }
    await ensure();
    const idx = await load();
    const hash = await putBlob(bytes);
    const time = now();
    const latest = latestFor(idx, path);
    const window = options.policy().mergeWindowMs;
    if (reason === "auto" && groupId === null && latest !== undefined && latest.reason === "auto" && latest.groupId === null && time - (latest.windowStart ?? latest.savedAt) < window) {
      const merged: DocumentHistoryEntry = { ...latest, savedAt: time, sha256: hash, size: bytes.byteLength, windowStart: latest.windowStart ?? latest.savedAt, merged: (latest.merged ?? 1) + 1 };
      await writeRecord(ENTRIES, merged.id, merged, `saved history for ${path}`);
      idx.entries.set(merged.id, merged);
      if (latest.sha256 !== hash) await dropBlobIfUnused(idx, latest.sha256);
      notify();
      return { outcome: "merged", entry: merged };
    }
    const entry: DocumentHistoryEntry = { id: newId(), path, savedAt: time, reason, sha256: hash, size: bytes.byteLength, groupId };
    await writeRecord(ENTRIES, entry.id, entry, `saved history for ${path}`);
    idx.entries.set(entry.id, entry);
    notify();
    return { outcome: "recorded", entry };
  };


  return {
    location,
    coverage,
    recordSave: (path, bytes, reason, groupId = null) => serial(() => recordNow(path, bytes, reason, groupId)),
    keep: (path, bytes, reason) => serial(async () => {
      if (!validPath(path)) fail(`Invalid project-relative history path: ${path}`);
      const cover = coverage(path, bytes.byteLength);
      if (!cover.covered) { noteUncovered(path, cover.reason, bytes.byteLength); return { outcome: "uncovered" as const, reason: cover.reason }; }
      await ensure();
      const idx = await load();
      const hash = await sha256Hex(bytes);
      // A floor-bearing reason (`before-delete`, `before-restore`, `before-conflict-resolution`) must have its own permanent
      // record: an eligible autosave entry that happens to hold the bytes may be thinned (D12.8).
      if (reason !== "auto" && reason !== "checkpoint" && ![...idx.entries.values()].some((entry) => entry.path === path && entry.sha256 === hash && entry.reason !== "auto")) {
        return recordNow(path, bytes, reason, null);
      }
      if (holds(idx, path, hash)) {
        // The entry's hash is only metadata: read the blob and prove it, repairing it when it is missing or corrupt, so a
        // later save can never replace content history claims to hold but does not (D12.10 item 4).
        const blob = await storage.read(`${BLOBS}/${hash}`);
        if (blob.ok && await sha256Hex(blob.value) === hash) return { outcome: "held" as const };
        await putBlob(bytes);
        return { outcome: "held" as const };
      }
      return recordNow(path, bytes, reason, null);
    }),
    documentTimeline: async (path) => [...(await load()).entries.values()].filter((entry) => entry.path === path).sort(byTime((entry) => entry.savedAt)),
    projectTimeline: async () => [...(await load()).entries.values()].sort(byTime((entry) => entry.savedAt)),
    uncovered: async () => [...uncoveredSeen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    preview: async (entryId) => {
      if (!validId(entryId)) fail("Invalid history entry identity.");
      const entry = (await load()).entries.get(entryId);
      if (entry === undefined) return null;
      return { entry, bytes: (await readBlob(entry.sha256, entry.path)).slice() };
    },
    usage: async () => {
      const idx = await load();
      let bytes = 0;
      const contents = new Set<string>();
      const countFiles = async (path: string): Promise<void> => {
        const listed = await storage.list(path);
        if (!listed.ok) {
          if (missing(listed.error)) return;
          throw new HistoryError(`Could not count history storage at ${path}: ${listed.error.message}`);
        }
        for (const entry of listed.value) {
          const child = `${path}/${entry.name}`;
          if (entry.kind === "directory") {
            await countFiles(child);
            continue;
          }
          if (entry.kind !== "file") continue;
          const data = await storage.read(child);
          if (!data.ok) {
            if (missing(data.error)) continue;
            throw new HistoryError(`Could not count history storage at ${child}: ${data.error.message}`);
          }
          bytes += data.value.byteLength;
          if (child.startsWith(`${HISTORY_FOLDER}/blobs/`) || child.startsWith(`${HISTORY_FOLDER}/contents/`)) {
            contents.add(entry.name);
          }
        }
      };
      await countFiles(HISTORY_FOLDER);
      const warnBytes = options.policy().warnBytes;
      return { entries: idx.entries.size, distinctContents: contents.size, bytes, warnBytes, overWarning: bytes > warnBytes };
    },
    thinningPlan: async () => {
      const idx = await load();
      const floor = now() - options.policy().autoFloorMs;
      const eligible = [...idx.entries.values()].filter((entry) => entry.reason === "auto" && entry.groupId === null && entry.savedAt <= floor).sort(byTime((entry) => entry.savedAt));
      const gone = new Set<string>();
      const plan: ThinningCandidate[] = [];
      for (const entry of eligible) {
        gone.add(entry.id);
        const stillNeeded = [...idx.entries.values()].some((other) => !gone.has(other.id) && other.sha256 === entry.sha256);
        const alreadyFreed = plan.some((candidate) => candidate.entry.sha256 === entry.sha256 && candidate.frees > 0);
        plan.push({ entry, frees: stillNeeded || alreadyFreed ? 0 : entry.size });
      }
      return plan;
    },
    thin: (entryIds) => serial(async () => {
      const idx = await load();
      const floor = now() - options.policy().autoFloorMs;
      let freed = 0;
      for (const id of entryIds) {
        const entry = idx.entries.get(id);
        if (entry === undefined || entry.reason !== "auto" || entry.groupId !== null || entry.savedAt > floor) continue;
        const removed = await storage.delete(`${ENTRIES}/${id}.json`);
        if (!removed.ok && !missing(removed.error)) fail(`Could not delete history entry ${id}: ${removed.error.message}`);
        idx.entries.delete(id);
        const size = entry.size;
        if (!referenced(idx, entry.sha256)) {
          const dropped = await storage.delete(`${BLOBS}/${entry.sha256}`);
          if (dropped.ok) freed += size;
        }
      }
      notify();
      return freed;
    }),
    deleteEntry: (entryId) => serial(async () => {
      if (!validId(entryId)) fail("Invalid history entry identity.");
      const idx = await load();
      const entry = idx.entries.get(entryId);
      if (entry === undefined) return;
      const removed = await storage.delete(`${ENTRIES}/${entryId}.json`);
      if (!removed.ok && !missing(removed.error)) fail(`Could not delete history entry ${entryId}: ${removed.error.message}`);
      idx.entries.delete(entryId);
      if (!referenced(idx, entry.sha256)) await storage.delete(`${BLOBS}/${entry.sha256}`);
      notify();
    }),
    problems: () => [...issues],
    reportProblem: (path, message) => { issues.push({ at: now(), path, message }); notify(); },
    clearProblems: (path) => { for (let position = issues.length - 1; position >= 0; position -= 1) if (issues[position]!.path === path) issues.splice(position, 1); notify(); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload: () => serial(async () => { await load(true); }),
  };

}

/**
 * Storage for a host that cannot write the project folder (D12.10 item 8): kept in this page only, and gone when it
 * closes. It is a real filesystem surface so the store behaves identically over it.
 */
export function createMemoryHistoryStorage(): DocumentHistoryOptions["storage"] {
  const files = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  const notFound = { ok: false as const, error: { code: "not-found" as const, message: "Not found." } };
  return {
    async read(path) { const bytes = files.get(path); return bytes === undefined ? notFound : { ok: true as const, value: bytes.slice() }; },
    async write(path, bytes) { files.set(path, bytes.slice()); return { ok: true as const, value: undefined }; },
    async createFolder(path) { folders.add(path); return { ok: true as const, value: undefined }; },
    async list(path) {
      if (!folders.has(path)) return notFound;
      const prefix = `${path}/`;
      const entries = new Map<string, "file" | "directory">();
      const add = (childPath: string, kind: "file" | "directory"): void => {
        if (!childPath.startsWith(prefix)) return;
        const remainder = childPath.slice(prefix.length);
        if (remainder.length === 0) return;
        const separator = remainder.indexOf("/");
        const name = separator < 0 ? remainder : remainder.slice(0, separator);
        entries.set(name, separator >= 0 ? "directory" : kind);
      };
      for (const file of files.keys()) add(file, "file");
      for (const folder of folders) add(folder, "directory");
      return { ok: true as const, value: [...entries].map(([name, kind]) => ({ name, kind })) };
    },
    async delete(path) { files.delete(path); return { ok: true as const, value: undefined }; },
  };
}

/** One file an operation wrote, and how that went. */
export interface OperationWrite {
  readonly path: string;
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * Run a multi-document operation through the canonical checkpoint service (D12.3, D12.10 item 6). The group naming
 * every planned destination is durable before `run` can write; each successful write then registers its actual bytes.
 * Nothing here is atomic: `write` reports each file separately and `run` decides what a failure means.
 */
export async function runCheckpointedOperation<T>(
  store: {
    begin(name: string, planned: readonly string[]): Promise<{ readonly ok: true; readonly groupId: string } | { readonly ok: false; readonly message: string }>;
    written(groupId: string, path: string, bytes: Uint8Array): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  },
  fs: Pick<FileSystemService, "write">,
  input: { readonly name: string; readonly planned: readonly string[] },
  run: (write: (path: string, bytes: Uint8Array) => Promise<OperationWrite>) => Promise<T>,
): Promise<{ readonly ok: true; readonly groupId: string; readonly value: T } | { readonly ok: false; readonly message: string }> {
  const started = await store.begin(input.name, input.planned);
  if (!started.ok) return { ok: false, message: `${input.name} was not started because its history checkpoint could not be recorded: ${started.message}` };
  const planned = new Set(input.planned);
  const value = await run(async (path, bytes) => {
    if (!planned.has(path)) return { path, ok: false, message: `${path} was not in the operation's plan, so it was not written.` };
    const written = await fs.write(path, bytes);
    if (!written.ok) return { path, ok: false, message: written.error.message };
    const recorded = await store.written(started.groupId, path, bytes);
    return recorded.ok ? { path, ok: true } : { path, ok: false, message: `${path} was written, but its history could not be recorded: ${recorded.message}` };
  });
  return { ok: true, groupId: started.groupId, value };
}
