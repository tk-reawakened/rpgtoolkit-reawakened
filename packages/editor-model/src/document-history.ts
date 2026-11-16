import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";

export type HistoryReason = "auto" | "manual" | "before-run" | "before-restore" | "before-conflict-resolution" | "before-delete" | "before-wizard" | "checkpoint";

export interface DocumentHistoryEntry {
  readonly id: string;
  readonly path: string;
  readonly savedAt: number;
  readonly reason: HistoryReason;
  readonly sha256: string;
  readonly size: number;
  readonly groupId: string | null;
}

export interface HistoryCheckpointGroup {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: number;
  readonly before: readonly { readonly path: string; readonly sha256: string | null }[];
  readonly created: readonly string[];
}

export interface HistoryPreview {
  readonly entry: DocumentHistoryEntry;
  readonly bytes: Uint8Array;
}

export interface HistoryCheckpointPreview {
  readonly groupId: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface GroupRestoreResult {
  readonly groupId: string;
  readonly restoreGroupId: string | null;
  readonly files: readonly { readonly path: string; readonly result: "restored" | "already-wanted" | "failed"; readonly message?: string }[];
}

export interface DocumentHistoryStore {
  recordSave(path: string, bytes: Uint8Array, reason: HistoryReason, groupId?: string | null): Promise<DocumentHistoryEntry>;
  createGroup(options: { readonly pathsBeforeWrite: readonly string[]; readonly createdPaths?: readonly string[]; readonly name?: string }): Promise<HistoryCheckpointGroup>;
  createNamedCheckpoint(name: string, documents: readonly { readonly path: string; readonly bytes: Uint8Array }[]): Promise<HistoryCheckpointGroup>;
  documentTimeline(path: string): Promise<readonly DocumentHistoryEntry[]>;
  projectTimeline(): Promise<readonly DocumentHistoryEntry[]>;
  groupTimeline(): Promise<readonly HistoryCheckpointGroup[]>;
  preview(entryId: string): Promise<HistoryPreview | null>;
  previewGroup(groupId: string, path: string): Promise<HistoryCheckpointPreview | null>;
  restoreEntry(entryId: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  restoreGroup(groupId: string): Promise<GroupRestoreResult>;
}

// ADR 0022 D12.7 confirms an in-project folder but leaves its name unresolved; this candidate remains provisional.
const ROOT = ".tkr-history";
const BLOBS = `${ROOT}/blobs`;
const ENTRIES = `${ROOT}/entries`;
const GROUPS = `${ROOT}/groups`;
const encode = (value: unknown): Uint8Array => utf8Encode(JSON.stringify(value));
const parse = <T>(bytes: Uint8Array): T => JSON.parse(utf8Decode(bytes)) as T;
const missing = (error: { readonly code: string | null }): boolean => error.code === "not-found";
const validPath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

async function digest(bytes: Uint8Array): Promise<string> {
  const crypto = Reflect.get(globalThis, "crypto") as { readonly subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } } | undefined;
  if (crypto?.subtle === undefined) throw new Error("This host does not provide Web Crypto SHA-256.");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Shared filesystem-backed history; retention and size policy intentionally remain unset. */
export function createDocumentHistoryStore(options: {
  readonly fs: Pick<FileSystemService, "read" | "write" | "createFolder" | "list" | "delete">;
  readonly now?: () => number;
}): DocumentHistoryStore {
  const { fs } = options;
  const now = options.now ?? Date.now;
  let sequence = 0;
  let queue = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const ensure = async (): Promise<void> => {
    for (const path of [ROOT, BLOBS, ENTRIES, GROUPS]) {
      const result = await fs.createFolder(path);
      if (!result.ok) throw new Error(`Could not create history folder ${path}: ${result.error.message}`);
    }
  };
  const allocate = async (folder: string, hash = ""): Promise<string> => {
    while (true) {
      const id = `${now().toString(36)}-${(++sequence).toString(36)}${hash === "" ? "" : `-${hash.slice(0, 12)}`}`;
      const found = await fs.read(`${folder}/${id}.json`);
      if (!found.ok && missing(found.error)) return id;
      if (!found.ok) throw new Error(`Could not allocate a history identity: ${found.error.message}`);
    }
  };
  const putBlob = async (bytes: Uint8Array): Promise<string> => {
    const hash = await digest(bytes);
    const path = `${BLOBS}/${hash}`;
    const current = await fs.read(path);
    if (current.ok) {
      if (await digest(current.value) !== hash) throw new Error(`History blob ${hash} is corrupt.`);
      return hash;
    }
    if (!missing(current.error)) throw new Error(`Could not check history blob ${hash}: ${current.error.message}`);
    const written = await fs.write(path, bytes);
    if (!written.ok) throw new Error(`Could not store history blob ${hash}: ${written.error.message}`);
    return hash;
  };
  const recordNow = async (path: string, bytes: Uint8Array, reason: HistoryReason, groupId: string | null = null): Promise<DocumentHistoryEntry> => {
    if (!validPath(path)) throw new Error(`Invalid project-relative history path: ${path}`);
    await ensure();
    const hash = await putBlob(bytes);
    const entry: DocumentHistoryEntry = { id: await allocate(ENTRIES, hash), path, savedAt: now(), reason, sha256: hash, size: bytes.byteLength, groupId };
    const written = await fs.write(`${ENTRIES}/${entry.id}.json`, encode(entry));
    if (!written.ok) throw new Error(`Could not record saved history for ${path}: ${written.error.message}`);
    return entry;
  };
  const readEntry = async (id: string): Promise<DocumentHistoryEntry | null> => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid history entry identity.");
    const result = await fs.read(`${ENTRIES}/${id}.json`);
    if (!result.ok) { if (missing(result.error)) return null; throw new Error(`Could not read history entry ${id}: ${result.error.message}`); }
    return parse<DocumentHistoryEntry>(result.value);
  };
  const readGroup = async (id: string): Promise<HistoryCheckpointGroup | null> => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid checkpoint group identity.");
    const result = await fs.read(`${GROUPS}/${id}.json`);
    if (!result.ok) { if (missing(result.error)) return null; throw new Error(`Could not read checkpoint group ${id}: ${result.error.message}`); }
    return parse<HistoryCheckpointGroup>(result.value);
  };
  const listedRecords = async <T>(folder: string): Promise<T[]> => {
    const listed = await fs.list(folder);
    if (!listed.ok) { if (missing(listed.error)) return []; throw new Error(`Could not list ${folder}: ${listed.error.message}`); }
    const records: T[] = [];
    for (const item of listed.value) {
      if (item.kind !== "file" || !item.name.endsWith(".json")) continue;
      const result = await fs.read(`${folder}/${item.name}`);
      if (!result.ok) throw new Error(`Could not read ${item.name}: ${result.error.message}`);
      records.push(parse<T>(result.value));
    }
    return records;
  };
  const createGroupNow = async (input: { readonly pathsBeforeWrite: readonly string[]; readonly createdPaths?: readonly string[]; readonly name?: string }): Promise<HistoryCheckpointGroup> => {
    await ensure();
    const beforePaths = [...new Set(input.pathsBeforeWrite)];
    const created = [...new Set(input.createdPaths ?? [])];
    if (beforePaths.some((path) => !validPath(path)) || created.some((path) => !validPath(path))) throw new Error("Checkpoint paths must be project-relative file paths.");
    const before: { path: string; sha256: string | null }[] = [];
    for (const path of beforePaths) {
      const current = await fs.read(path);
      if (!current.ok) {
        if (missing(current.error)) { before.push({ path, sha256: null }); continue; }
        throw new Error(`Could not capture ${path} before the operation: ${current.error.message}`);
      }
      before.push({ path, sha256: await putBlob(current.value) });
    }
    const group: HistoryCheckpointGroup = { id: await allocate(GROUPS), name: input.name?.trim() || null, createdAt: now(), before, created };
    const written = await fs.write(`${GROUPS}/${group.id}.json`, encode(group));
    if (!written.ok) throw new Error(`Could not record checkpoint group: ${written.error.message}`);
    return group;
  };
  const captureCurrent = async (path: string): Promise<Uint8Array | null> => {
    const result = await fs.read(path);
    if (result.ok) return result.value;
    if (missing(result.error)) return null;
    throw new Error(`Could not read ${path}: ${result.error.message}`);
  };

  return {
    recordSave: (path, bytes, reason, groupId = null) => serial(() => recordNow(path, bytes, reason, groupId)),
    createGroup: (input) => serial(() => createGroupNow(input)),
    createNamedCheckpoint: (name, documents) => serial(async () => {
      await ensure();
      const seen = new Set<string>();
      const before: { path: string; sha256: string }[] = [];
      for (const document of documents) {
        if (!validPath(document.path)) throw new Error(`Invalid checkpoint path: ${document.path}`);
        if (seen.has(document.path)) throw new Error(`Duplicate checkpoint path: ${document.path}`);
        seen.add(document.path);
        before.push({ path: document.path, sha256: await putBlob(document.bytes) });
      }
      const group: HistoryCheckpointGroup = { id: await allocate(GROUPS), name: name.trim() || null, createdAt: now(), before, created: [] };
      const written = await fs.write(`${GROUPS}/${group.id}.json`, encode(group));
      if (!written.ok) throw new Error(`Could not record named checkpoint: ${written.error.message}`);
      return group;
    }),
    documentTimeline: async (path) => (await listedRecords<DocumentHistoryEntry>(ENTRIES)).filter((entry) => entry.path === path).sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id)),
    projectTimeline: async () => (await listedRecords<DocumentHistoryEntry>(ENTRIES)).sort((a, b) => a.savedAt - b.savedAt || a.id.localeCompare(b.id)),
    groupTimeline: async () => (await listedRecords<HistoryCheckpointGroup>(GROUPS)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    preview: async (id) => {
      const entry = await readEntry(id);
      if (entry === null) return null;
      const blob = await fs.read(`${BLOBS}/${entry.sha256}`);
      if (!blob.ok || await digest(blob.value) !== entry.sha256) throw new Error(`History content for ${entry.path} is unavailable or failed its SHA-256 check.`);
      return { entry, bytes: blob.value.slice() };
    },
    previewGroup: async (groupId, path) => {
      const group = await readGroup(groupId);
      const saved = group?.before.find((item) => item.path === path);
      if (saved === undefined || saved.sha256 === null) return null;
      const blob = await fs.read(`${BLOBS}/${saved.sha256}`);
      if (!blob.ok || await digest(blob.value) !== saved.sha256) throw new Error(`Checkpoint content for ${path} is unavailable or failed its SHA-256 check.`);
      return { groupId, path, sha256: saved.sha256, bytes: blob.value.slice() };
    },
    restoreEntry: (id) => serial(async () => {
      const entry = await readEntry(id);
      if (entry === null) return { ok: false, message: `History entry ${id} does not exist.` };
      const current = await captureCurrent(entry.path);
      await createGroupNow({ pathsBeforeWrite: current === null ? [] : [entry.path], createdPaths: current === null ? [entry.path] : [], name: "Restore" });
      if (current !== null) await recordNow(entry.path, current, "before-restore");
      const blob = await fs.read(`${BLOBS}/${entry.sha256}`);
      if (!blob.ok || await digest(blob.value) !== entry.sha256) return { ok: false, message: `History content for ${entry.path} is unavailable or corrupt.` };
      const written = await fs.write(entry.path, blob.value);
      if (!written.ok) return { ok: false, message: `Could not restore ${entry.path}: ${written.error.message}` };
      try { await recordNow(entry.path, blob.value, "manual"); }
      catch (error) { return { ok: false, message: `${entry.path} was restored, but its history could not be recorded: ${error instanceof Error ? error.message : String(error)}` }; }
      return { ok: true };
    }),
    restoreGroup: (id) => serial(async () => {
      const group = await readGroup(id);
      if (group === null) return { groupId: id, restoreGroupId: null, files: [{ path: "", result: "failed", message: "Checkpoint group does not exist." }] };
      const beforePaths: string[] = [];
      const createdPaths: string[] = [];
      for (const path of [...group.before.map((item) => item.path), ...group.created]) {
        const current = await fs.read(path);
        if (current.ok) beforePaths.push(path);
        else if (missing(current.error)) createdPaths.push(path);
        else return { groupId: id, restoreGroupId: null, files: [{ path, result: "failed", message: current.error.message }] };
      }
      let restoreGroup: HistoryCheckpointGroup;
      try { restoreGroup = await createGroupNow({ pathsBeforeWrite: beforePaths, createdPaths, name: `Restore ${group.name ?? group.id}` }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { groupId: id, restoreGroupId: null, files: [...beforePaths, ...createdPaths].map((path) => ({ path, result: "failed" as const, message })) };
      }
      const files: { path: string; result: "restored" | "already-wanted" | "failed"; message?: string }[] = [];
      for (const item of group.before) {
        const current = await fs.read(item.path);
        if (!current.ok && !missing(current.error)) { files.push({ path: item.path, result: "failed", message: current.error.message }); continue; }
        if (item.sha256 === null) {
          if (!current.ok) { files.push({ path: item.path, result: "already-wanted" }); continue; }
          try { await recordNow(item.path, current.value, "before-delete", id); }
          catch (error) { files.push({ path: item.path, result: "failed", message: `Could not record ${item.path} before deletion: ${error instanceof Error ? error.message : String(error)}` }); continue; }
          const removed = await fs.delete(item.path);
          files.push(removed.ok ? { path: item.path, result: "restored" } : { path: item.path, result: "failed", message: removed.error.message });
          continue;
        }
        const blob = await fs.read(`${BLOBS}/${item.sha256}`);
        if (!blob.ok || await digest(blob.value) !== item.sha256) { files.push({ path: item.path, result: "failed", message: "Checkpoint content is unavailable or corrupt." }); continue; }
        if (current.ok && await digest(current.value) === item.sha256) { files.push({ path: item.path, result: "already-wanted" }); continue; }
        if (current.ok) {
          try { await recordNow(item.path, current.value, "before-restore", id); }
          catch (error) { files.push({ path: item.path, result: "failed", message: `Could not record ${item.path} before restoration: ${error instanceof Error ? error.message : String(error)}` }); continue; }
        }
        const written = await fs.write(item.path, blob.value);
        if (!written.ok) { files.push({ path: item.path, result: "failed", message: written.error.message }); continue; }
        try { await recordNow(item.path, blob.value, "manual", id); files.push({ path: item.path, result: "restored" }); }
        catch (error) { files.push({ path: item.path, result: "failed", message: `${item.path} was restored, but its history could not be recorded: ${error instanceof Error ? error.message : String(error)}` }); }
      }
      for (const path of group.created) {
        const current = await fs.read(path);
        if (!current.ok && !missing(current.error)) { files.push({ path, result: "failed", message: current.error.message }); continue; }
        if (!current.ok) { files.push({ path, result: "already-wanted" }); continue; }
        try { await recordNow(path, current.value, "before-delete", id); }
        catch (error) { files.push({ path, result: "failed", message: `Could not record ${path} before deletion: ${error instanceof Error ? error.message : String(error)}` }); continue; }
        const removed = await fs.delete(path);
        files.push(removed.ok ? { path, result: "restored" } : { path, result: "failed", message: removed.error.message });
      }
      return { groupId: id, restoreGroupId: restoreGroup.id, files };
    }),
  };
}
