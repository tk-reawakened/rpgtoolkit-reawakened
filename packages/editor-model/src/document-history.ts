import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";

/**
 * Document history (ADR 0022 D12): every successful save of a covered document is kept, deduplicated by SHA-256, in one
 * reserved folder, with checkpoint groups, named checkpoints, timelines and restore. It is shared code over `fs`: a host
 * adds nothing of its own (D12.9). The folder, layout and every rule below are fixed by D12.7, D12.8 and D12.10.
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
const GROUPS = `${HISTORY_FOLDER}/groups`;

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

export interface GroupBefore {
  readonly path: string;
  /** `null` when the file did not exist before the operation. */
  readonly sha256: string | null;
  readonly size: number;
}

export interface HistoryGroup {
  readonly id: string;
  readonly kind: "group" | "named";
  readonly name: string | null;
  readonly createdAt: number;
  readonly before: readonly GroupBefore[];
  /** Each path the operation reports having written, with the SHA-256 of the bytes it wrote (ownership proof for deleting a created file). */
  readonly written: readonly { readonly path: string; readonly sha256: string }[];
  readonly uncovered: readonly UncoveredFile[];
  /** The group this one restored, when it is a restore. */
  readonly restores: string | null;
}

export type Coverage = { readonly covered: true } | { readonly covered: false; readonly reason: "type" | "size" };

export type RecordOutcome =
  | { readonly outcome: "recorded" | "merged"; readonly entry: DocumentHistoryEntry }
  | { readonly outcome: "uncovered"; readonly reason: "type" | "size" };

export interface HistoryPreview {
  readonly entry: DocumentHistoryEntry;
  readonly bytes: Uint8Array;
}

export interface HistoryGroupPreview {
  readonly groupId: string;
  readonly path: string;
  readonly sha256: string;
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
  /** Make `path` hold `bytes` (`null` deletes it) as an accepted change. It must record its own save when it writes. */
  apply(path: string, bytes: Uint8Array | null, context: { readonly groupId: string }): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

export interface HistoryUsage {
  readonly entries: number;
  readonly groups: number;
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
  /** Begin a checkpoint group before the first write of a multi-document operation (D12.10 item 6). */
  beginGroup(input: { readonly name?: string; readonly paths: readonly string[] }): Promise<HistoryGroup>;
  /** Report a file the operation has just written (D12.10 item 6): its hash is the proof that the file is the operation's own. */
  registerWritten(groupId: string, path: string, bytes: Uint8Array): Promise<HistoryGroup>;
  /** Name a project checkpoint: the hash of every covered file, and every uncovered member listed (D12.4, D12.10 item 7). */
  createNamedCheckpoint(name: string): Promise<HistoryGroup>;
  documentTimeline(path: string): Promise<readonly DocumentHistoryEntry[]>;
  projectTimeline(): Promise<readonly DocumentHistoryEntry[]>;
  groupTimeline(): Promise<readonly HistoryGroup[]>;
  /** Files the editor saved or a group touched that history does not cover, for the history view (D12.10 item 7). */
  uncovered(): Promise<readonly UncoveredFile[]>;
  preview(entryId: string): Promise<HistoryPreview | null>;
  previewGroup(groupId: string, path: string): Promise<HistoryGroupPreview | null>;
  /** Restore one entry. It is itself a group, so restoring it back is a group restore (D12.5). */
  restoreEntry(entryId: string, restorer: HistoryRestorer): Promise<GroupRestoreReport>;
  /** Restore a group, or with `only` just those paths (the retry of D12.10 item 6). */
  restoreGroup(groupId: string, restorer: HistoryRestorer, options?: { readonly only?: readonly string[]; readonly deleteUncertain?: readonly string[] }): Promise<GroupRestoreReport>;
  usage(): Promise<HistoryUsage>;
  /** The `auto` entries older than the floor, oldest first; nothing is deleted by asking. */
  thinningPlan(): Promise<readonly ThinningCandidate[]>;
  /** Delete the listed entries, but only those the plan would offer now (never below the floors). Returns the bytes freed. */
  thin(entryIds: readonly string[]): Promise<number>;
  /** A user's own deletion of one entry or one group, with no floor (D12.10 item 10). */
  deleteEntry(entryId: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
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
  readonly groups: Map<string, HistoryGroup>;
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
    for (const path of [HISTORY_FOLDER, BLOBS, ENTRIES, GROUPS]) {
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
    const groups = new Map((await readRecords<HistoryGroup>(GROUPS, unreadable)).map((group) => [group.id, group] as const));
    index = { entries, groups, unreadable };
    for (const message of unreadable) if (!issues.some((issue) => issue.message === message)) issues.push({ at: now(), path: null, message });
    return index;
  };
  const referenced = (idx: Index, sha: string, except?: { readonly entry?: string; readonly group?: string }): boolean => {
    for (const entry of idx.entries.values()) if (entry.sha256 === sha && entry.id !== except?.entry) return true;
    for (const group of idx.groups.values()) if (group.id !== except?.group && group.before.some((item) => item.sha256 === sha)) return true;
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

  const createGroupRecord = async (idx: Index, group: HistoryGroup): Promise<void> => {
    await writeRecord(GROUPS, group.id, group, "a checkpoint group");
    idx.groups.set(group.id, group);
    notify();
  };

  /** Capture the content `path` has now, as `before-*` entries tied to `groupId`. */
  const captureBefore = async (idx: Index, path: string, groupId: string, reason: HistoryReason, read: (path: string) => Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; message: string }>): Promise<{ before?: GroupBefore; uncovered?: UncoveredFile }> => {
    const current = await read(path);
    if (!current.ok) return fail(`Could not capture ${path} before the operation: ${current.message}`);
    if (current.bytes === null) return { before: { path, sha256: null, size: 0 } };
    const cover = coverage(path, current.bytes.byteLength);
    if (!cover.covered) { noteUncovered(path, cover.reason, current.bytes.byteLength); return { uncovered: { path, reason: cover.reason, size: current.bytes.byteLength } }; }
    const hash = await putBlob(current.bytes);
    // Content an entry already holds is not entered twice; the group still names it.
    const entry: DocumentHistoryEntry = { id: newId(), path, savedAt: now(), reason, sha256: hash, size: current.bytes.byteLength, groupId };
    await writeRecord(ENTRIES, entry.id, entry, `the state of ${path} before the operation`);
    idx.entries.set(entry.id, entry);
    return { before: { path, sha256: hash, size: current.bytes.byteLength } };
  };
  const projectRead = async (path: string): Promise<{ ok: true; bytes: Uint8Array | null } | { ok: false; message: string }> => {
    const result = await project.read(path);
    if (result.ok) return { ok: true, bytes: result.value };
    return missing(result.error) ? { ok: true, bytes: null } : { ok: false, message: result.error.message };
  };

  const beginGroupNow = async (input: { readonly name?: string; readonly paths: readonly string[]; readonly kind?: "group" | "named"; readonly restores?: string | null; readonly reason?: (path: string) => HistoryReason; readonly read?: typeof projectRead; readonly id?: string }): Promise<HistoryGroup> => {
    await ensure();
    const idx = await load();
    const paths = [...new Set(input.paths)];
    if (paths.some((path) => !validPath(path))) fail("Checkpoint paths must be project-relative file paths.");
    const id = input.id ?? newId();
    const before: GroupBefore[] = [];
    const uncovered: UncoveredFile[] = [];
    for (const path of paths) {
      const captured = await captureBefore(idx, path, id, input.reason?.(path) ?? "before-wizard", input.read ?? projectRead);
      if (captured.before !== undefined) before.push(captured.before);
      if (captured.uncovered !== undefined) uncovered.push(captured.uncovered);
    }
    const group: HistoryGroup = { id, kind: input.kind ?? "group", name: input.name?.trim() || null, createdAt: now(), before, written: [], uncovered, restores: input.restores ?? null };
    await createGroupRecord(idx, group);
    return group;
  };

  const restoreWanted = async (group: HistoryGroup, restorer: HistoryRestorer, only: ReadonlySet<string> | null, deleteUncertain: ReadonlySet<string>): Promise<GroupRestoreReport> => {
    const wantedPaths = group.before.map((item) => item.path).filter((path) => only === null || only.has(path));
    // What the restore is about to change is itself recorded first, as a group, so restoring it undoes this restore.
    const currentByPath = new Map<string, Uint8Array | null>();
    const files: FileRestoreReport[] = [];
    for (const path of wantedPaths) {
      const current = await restorer.current(path);
      if (!current.ok) { files.push({ path, result: "failed", message: current.message }); continue; }
      currentByPath.set(path, current.bytes);
    }
    // A file the operation created is deleted only when its bytes are the ones the operation registered (D12.10 item 6).
    const ownership = new Map<string, "owned" | "uncertain">();
    for (const item of group.before) {
      const current = currentByPath.get(item.path);
      if (item.sha256 !== null || current === undefined || current === null) continue;
      const proof = group.written.find((written) => written.path === item.path)?.sha256;
      ownership.set(item.path, (proof !== undefined && await sha256Hex(current) === proof) || deleteUncertain.has(item.path) ? "owned" : "uncertain");
    }
    const restoreInput = [...currentByPath.keys()].filter((path) => ownership.get(path) !== "uncertain");
    let restoreGroup: HistoryGroup;
    try {
      // The restore itself must not hold the queue: applying a file records its save through the same store.
      restoreGroup = await serial(() => beginGroupNow({
        name: `Restore ${group.name ?? "checkpoint group"}`,
        paths: restoreInput,
        restores: group.id,
        reason: (path) => (ownership.get(path) === "owned" ? "before-delete" : "before-restore"),
        read: async (path) => ({ ok: true, bytes: currentByPath.get(path) ?? null }),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { groupId: group.id, restoreGroupId: null, files: [...files, ...restoreInput.map((path) => ({ path, result: "failed" as const, message: `Nothing was changed: ${message}` }))] };
    }
    const applyTo = async (path: string, wanted: Uint8Array | null): Promise<void> => {
      const result = await restorer.apply(path, wanted, { groupId: restoreGroup.id });
      files.push(result.ok ? { path, result: "restored" } : { path, result: "failed", message: result.message });
    };
    for (const item of group.before) {
      if (!currentByPath.has(item.path)) continue;
      const current = currentByPath.get(item.path)!;
      if (item.sha256 === null) {
        if (current === null) files.push({ path: item.path, result: "already-as-wanted" });
        else if (ownership.get(item.path) === "owned") await applyTo(item.path, null);
        else files.push({ path: item.path, result: "kept-uncertain", message: `${item.path} exists but the operation did not register writing it, so it was not deleted. Delete it yourself if it is not yours.` });
        continue;
      }
      let wanted: Uint8Array;
      try { wanted = await readBlob(item.sha256, item.path); }
      catch (error) { files.push({ path: item.path, result: "failed", message: error instanceof Error ? error.message : String(error) }); continue; }
      if (current !== null && await sha256Hex(current) === item.sha256) { files.push({ path: item.path, result: "already-as-wanted" }); continue; }
      await applyTo(item.path, wanted);
    }
    for (const item of group.uncovered) if (only === null || only.has(item.path)) files.push({ path: item.path, result: "uncovered", message: item.reason === "size" ? `${item.path} is larger than history keeps (${item.size} bytes); it cannot be restored.` : `${item.path} is a type history does not keep; it cannot be restored.` });
    const order = new Map(wantedPaths.map((path, position) => [path, position] as const));
    files.sort((a, b) => (order.get(a.path) ?? 1e9) - (order.get(b.path) ?? 1e9));
    return { groupId: group.id, restoreGroupId: restoreGroup.id, files };
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
      if (holds(idx, path, await sha256Hex(bytes))) return { outcome: "held" as const };
      return recordNow(path, bytes, reason, null);
    }),
    beginGroup: (input) => serial(() => beginGroupNow({ paths: input.paths, ...(input.name === undefined ? {} : { name: input.name }) })),
    registerWritten: (groupId, path, bytes) => serial(async () => {
      if (!validId(groupId)) fail("Invalid checkpoint group identity.");
      if (!validPath(path)) fail(`Invalid project-relative path: ${path}`);
      const idx = await load();
      const group = idx.groups.get(groupId);
      if (group === undefined) return fail(`Checkpoint group ${groupId} does not exist.`);
      const proof = { path, sha256: await sha256Hex(bytes) };
      const next: HistoryGroup = { ...group, written: [...group.written.filter((item) => item.path !== path), proof] };
      await createGroupRecord(idx, next);
      return next;
    }),
    createNamedCheckpoint: (name) => serial(async () => {
      await ensure();
      const covered: string[] = [];
      const uncoveredFiles: UncoveredFile[] = [];
      const pending = [""];
      while (pending.length > 0) {
        const folder = pending.pop()!;
        const listed = await project.list(folder);
        if (!listed.ok) { fail(`Could not list ${folder === "" ? "the project" : folder}: ${listed.error.message}`); continue; }
        for (const item of listed.value) {
          const path = folder === "" ? item.name : `${folder}/${item.name}`;
          const folded = path.toLowerCase();
          if (item.kind === "directory") {
            if (RESERVED_NON_CONTENT.some((reserved) => folded === reserved) || folded === ".git" || folded === "node_modules") continue;
            pending.push(path);
          } else if (item.kind === "file") {
            const stat = await project.stat(path);
            const size = stat.ok ? stat.value.size : 0;
            const cover = coverage(path, size);
            if (cover.covered) covered.push(path);
            else { noteUncovered(path, cover.reason, size); uncoveredFiles.push({ path, reason: cover.reason, size }); }
          }
        }
      }
      covered.sort();
      uncoveredFiles.sort((a, b) => a.path.localeCompare(b.path));
      const idx = await load();
      const id = newId();
      const before: GroupBefore[] = [];
      for (const path of covered) {
        const read = await projectRead(path);
        if (!read.ok) return fail(`Could not read ${path} for the checkpoint: ${read.message}`);
        if (read.bytes === null) continue;
        const hash = await putBlob(read.bytes);
        before.push({ path, sha256: hash, size: read.bytes.byteLength });
        if (!holds(idx, path, hash)) {
          const entry: DocumentHistoryEntry = { id: newId(), path, savedAt: now(), reason: "checkpoint", sha256: hash, size: read.bytes.byteLength, groupId: id };
          await writeRecord(ENTRIES, entry.id, entry, `the checkpoint entry for ${path}`);
          idx.entries.set(entry.id, entry);
        }
      }
      const group: HistoryGroup = { id, kind: "named", name: name.trim() || "Checkpoint", createdAt: now(), before, written: [], uncovered: uncoveredFiles, restores: null };
      await createGroupRecord(idx, group);
      return group;
    }),
    documentTimeline: async (path) => [...(await load()).entries.values()].filter((entry) => entry.path === path).sort(byTime((entry) => entry.savedAt)),
    projectTimeline: async () => [...(await load()).entries.values()].sort(byTime((entry) => entry.savedAt)),
    groupTimeline: async () => [...(await load()).groups.values()].sort(byTime((group) => group.createdAt)),
    uncovered: async () => [...uncoveredSeen.values()].sort((a, b) => a.path.localeCompare(b.path)),
    preview: async (entryId) => {
      if (!validId(entryId)) fail("Invalid history entry identity.");
      const entry = (await load()).entries.get(entryId);
      if (entry === undefined) return null;
      return { entry, bytes: (await readBlob(entry.sha256, entry.path)).slice() };
    },
    previewGroup: async (groupId, path) => {
      if (!validId(groupId)) fail("Invalid checkpoint group identity.");
      const saved = (await load()).groups.get(groupId)?.before.find((item) => item.path === path);
      if (saved === undefined || saved.sha256 === null) return null;
      return { groupId, path, sha256: saved.sha256, bytes: (await readBlob(saved.sha256, path)).slice() };
    },
    restoreEntry: async (entryId, restorer) => {
      if (!validId(entryId)) fail("Invalid history entry identity.");
      const idx = await load();
      const entry = idx.entries.get(entryId);
      if (entry === undefined) return fail(`History entry ${entryId} does not exist.`);
      // The entry becomes a one-file group so the shared restore loop (reporting, before-restore, restore-of-restore) is the only path.
      const synthetic: HistoryGroup = { id: entry.id, kind: "group", name: `${entry.path} (${new Date(entry.savedAt).toISOString()})`, createdAt: entry.savedAt, before: [{ path: entry.path, sha256: entry.sha256, size: entry.size }], written: [], uncovered: [], restores: null };
      return restoreWanted(synthetic, restorer, null, new Set());
    },
    restoreGroup: async (groupId, restorer, restoreOptions) => {
      if (!validId(groupId)) fail("Invalid checkpoint group identity.");
      const group = (await load()).groups.get(groupId);
      if (group === undefined) return { groupId, restoreGroupId: null, files: [{ path: "", result: "failed" as const, message: "Checkpoint group does not exist." }] };
      return restoreWanted(group, restorer, restoreOptions?.only === undefined ? null : new Set(restoreOptions.only), new Set(restoreOptions?.deleteUncertain ?? []));
    },
    usage: async () => {
      const idx = await load();
      const sizes = new Map<string, number>();
      for (const entry of idx.entries.values()) sizes.set(entry.sha256, entry.size);
      for (const group of idx.groups.values()) for (const item of group.before) if (item.sha256 !== null) sizes.set(item.sha256, item.size);
      const records = [...idx.entries.values(), ...idx.groups.values()].reduce((total, record) => total + JSON.stringify(record).length, 0);
      const bytes = [...sizes.values()].reduce((total, size) => total + size, 0) + records;
      const warnBytes = options.policy().warnBytes;
      return { entries: idx.entries.size, groups: idx.groups.size, distinctContents: sizes.size, bytes, warnBytes, overWarning: bytes > warnBytes };
    },
    thinningPlan: async () => {
      const idx = await load();
      const floor = now() - options.policy().autoFloorMs;
      const eligible = [...idx.entries.values()].filter((entry) => entry.reason === "auto" && entry.groupId === null && entry.savedAt <= floor).sort(byTime((entry) => entry.savedAt));
      const gone = new Set<string>();
      const plan: ThinningCandidate[] = [];
      for (const entry of eligible) {
        gone.add(entry.id);
        const stillNeeded = [...idx.entries.values()].some((other) => !gone.has(other.id) && other.sha256 === entry.sha256)
          || [...idx.groups.values()].some((group) => group.before.some((item) => item.sha256 === entry.sha256));
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
    deleteGroup: (groupId) => serial(async () => {
      if (!validId(groupId)) fail("Invalid checkpoint group identity.");
      const idx = await load();
      const group = idx.groups.get(groupId);
      if (group === undefined) return;
      const removed = await storage.delete(`${GROUPS}/${groupId}.json`);
      if (!removed.ok && !missing(removed.error)) fail(`Could not delete checkpoint group ${groupId}: ${removed.error.message}`);
      idx.groups.delete(groupId);
      for (const item of group.before) if (item.sha256 !== null && !referenced(idx, item.sha256)) await storage.delete(`${BLOBS}/${item.sha256}`);
      notify();
    }),
    problems: () => [...issues],
    reportProblem: (path, message) => { issues.push({ at: now(), path, message }); notify(); },
    clearProblems: (path) => { for (let position = issues.length - 1; position >= 0; position -= 1) if (issues[position]!.path === path) issues.splice(position, 1); notify(); },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reload: () => serial(async () => { await load(true); notify(); }),
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
      const entries = [...files.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/")).map((key) => ({ name: key.slice(prefix.length), kind: "file" as const }));
      return { ok: true as const, value: entries };
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
 * Run a multi-document operation under a checkpoint group (D12.3, D12.10 item 6): the group naming every planned
 * destination, absent ones included, is durably recorded before `run` can write anything, and each file `run` writes
 * through `write` is registered with the hash of its bytes. If the group cannot be recorded nothing is written. Nothing
 * here is atomic: `write` reports each file separately and `run` decides what a failure means.
 */
export async function runCheckpointedOperation<T>(
  store: Pick<DocumentHistoryStore, "beginGroup" | "registerWritten" | "recordSave">,
  fs: Pick<FileSystemService, "write">,
  input: { readonly name: string; readonly planned: readonly string[] },
  run: (write: (path: string, bytes: Uint8Array) => Promise<OperationWrite>) => Promise<T>,
): Promise<{ readonly ok: true; readonly groupId: string; readonly value: T } | { readonly ok: false; readonly message: string }> {
  let group: HistoryGroup;
  try { group = await store.beginGroup({ name: input.name, paths: input.planned }); }
  catch (error) { return { ok: false, message: `${input.name} was not started because its history checkpoint could not be recorded: ${error instanceof Error ? error.message : String(error)}` }; }
  const planned = new Set(input.planned);
  const value = await run(async (path, bytes) => {
    if (!planned.has(path)) return { path, ok: false, message: `${path} was not in the operation's plan, so it was not written.` };
    const written = await fs.write(path, bytes);
    if (!written.ok) return { path, ok: false, message: written.error.message };
    try {
      await store.registerWritten(group.id, path, bytes);
      await store.recordSave(path, bytes, "manual", group.id);
    } catch (error) {
      return { path, ok: false, message: `${path} was written, but its history could not be recorded: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { path, ok: true };
  });
  return { ok: true, groupId: group.id, value };
}
