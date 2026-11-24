import { foldPath, utf8Decode, utf8Encode } from "@tk-reawakened/core";
import { platformError, platformOk, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";

/** docs/spec/editor-animation-authoring.md#persistent-checkpoint-groups */
export interface CheckpointFile {
  path: string;
  before: string | null;
  after: string | null;
  status: "pending" | "writing" | "written" | "failed" | "already-as-wanted" | "kept-uncertain" | "kept-changed" | "uncovered";
  message: string | null;
}
export interface CheckpointUncovered { readonly path: string; readonly reason: "type" | "size"; readonly size: number }
export interface CheckpointGroup {
  schema: 1;
  id: string;
  reason: "before-wizard" | "before-script" | "before-restore" | "named";
  time: string;
  name: string | null;
  restores: string | null;
  files: CheckpointFile[];
  uncovered: CheckpointUncovered[];
}
/** A directory entry that cannot supply trustworthy group metadata. Never usable for retry or restore. */
export interface CheckpointProblem {
  readonly id: string;
  readonly path: string;
  readonly error: string;
  readonly deletable: boolean;
}
export type CheckpointEntry = CheckpointGroup | CheckpointProblem;
export interface CheckpointTarget { readonly path: string; readonly bytes: Uint8Array | null; readonly expectedBefore?: Uint8Array | null }
export interface CheckpointEnvironment {
  readonly fs: FileSystemService;
  /** Optional history location; project paths still use `fs`, only `.tkr-history` is written here. */
  readonly storage?: Pick<FileSystemService, "read" | "write" | "createFolder" | "list" | "delete">;
  readonly projectId: string;
  readonly hash: (bytes: Uint8Array) => Promise<string>;
  readonly newId: () => string;
  readonly time: () => string;
  /** Refuse unsafe open-document replacement/removal. Called before capture and again before every target write. */
  readonly guard: (path: string, removing: boolean, intended?: Uint8Array | null) => Promise<string | null>;
  readonly consent: (paths: readonly string[]) => Promise<boolean>;
  /** Read authoritative open-document state instead of stale bytes on disk. */
  readonly current?: (path: string) => Promise<Uint8Array | null>;
  /** A host may route an authoritative open document through accepted edits and normal save. */
  readonly write?: (path: string, bytes: Uint8Array | null, context: { readonly groupId: string; readonly expected: Uint8Array | null }) => Promise<PlatformResult<void>>;
}
const ROOT = ".tkr-history";
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-zA-Z0-9-]+$/;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function validPath(path: string): boolean {
  return path.length > 0 && !/[\\\u0000-\u001f:]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..") && foldPath(path.split("/")[0]!) !== ROOT;
}

class CheckpointPathConflict extends Error {}

/** Resolve each segment without following links; a missing suffix keeps its proposed spelling. */
export async function checkpointFilePath(list: FileSystemService["list"], path: string): Promise<string> {
  if (!validPath(path)) throw new CheckpointPathConflict(`Invalid checkpoint destination: ${path}`);
  let parent = "";
  const parts = path.split("/");
  for (let i = 0; i < parts.length; i++) {
    const listed = await list(parent);
    if (!listed.ok) {
      if (listed.error.code !== "not-found") throw new Error(listed.error.message);
      return [parent, ...parts.slice(i)].filter(Boolean).join("/");
    }
    const matches = listed.value.filter((entry) => foldPath(entry.name) === foldPath(parts[i]!));
    if (matches.length > 1) throw new CheckpointPathConflict(`${path} has entries that differ only in case; it is ambiguous.`);
    const found = matches[0];
    if (found?.kind === "link") throw new CheckpointPathConflict(`${path} crosses a symbolic link at ${found.name}; it was not changed.`);
    if (found !== undefined && (i < parts.length - 1 ? found.kind !== "directory" : found.kind !== "file")) {
      throw new CheckpointPathConflict(`File/directory collision at ${path}.`);
    }
    parent = [parent, found?.name ?? parts[i]!].filter(Boolean).join("/");
  }
  return parent;
}

type RestoreNoOp = { readonly status: "failed" | "kept-changed" | "kept-uncertain" | "already-as-wanted"; readonly message: string };
type CaptureTarget = CheckpointTarget | { readonly path: string; readonly noOp: RestoreNoOp };
const noOp = (path: string, status: RestoreNoOp["status"], message: string): CaptureTarget => ({ path, noOp: { status, message } });
interface RestoreOptions {
  readonly only?: readonly string[];
  readonly deleteUncertain?: readonly string[];
  readonly confirmBefore?: (paths: readonly string[]) => Promise<ReadonlyMap<string, Uint8Array | null> | null>;
}
const spellingChanged = (path: string, actual: string): string =>
  `${path} has a different stored spelling (${actual}); it was not changed.`;

function notRestored(file: CheckpointFile): boolean {
  return file.status === "kept-changed" || file.status === "kept-uncertain" || file.status === "already-as-wanted"
    || (file.status === "failed" && file.before === null && file.after === null);
}

async function pathConflict(canonical: (path: string) => Promise<string>, path: string): Promise<string | null> {
  try {
    const resolved = await canonical(path);
    return resolved === path ? null : spellingChanged(path, resolved);
  } catch (error) {
    if (error instanceof CheckpointPathConflict) return error.message;
    throw error;
  }
}
function unwrap<T>(result: PlatformResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }
function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++) if (a[index] !== b[index]) return false;
  return true;
}

const projectOperations = new WeakMap<FileSystemService, Map<string, Promise<void>>>();

/** Whole-byte, SHA-256 deduplicated groups. No retention policy and no atomic rollback promise. */
export function createCheckpointGroups(env: CheckpointEnvironment) {
  const { fs, projectId } = env;
  const history = env.storage ?? {
    read: (path: string) => fs.readProject(projectId, path),
    write: (path: string, bytes: Uint8Array) => fs.writeProject(projectId, path, bytes),
    createFolder: (path: string) => fs.createFolder(path),
    list: (path: string) => fs.listProject(projectId, path),
    delete: (path: string) => fs.deleteProject(projectId, path),
  };
  const ensureHistory = async (path: string): Promise<void> => { unwrap(await history.createFolder(path)); };
  const captureManifest = async (group: CheckpointGroup): Promise<void> => {
    await ensureHistory(`${ROOT}/groups`);
    unwrap(await history.write(manifestPath(group.id), utf8Encode(JSON.stringify(group))));
  };
  const persist = async (group: CheckpointGroup): Promise<void> => {
    const directory = `${ROOT}/progress/${group.id}`;
    await ensureHistory(directory);
    const entries = await history.list(directory);
    if (!entries.ok && entries.error.code !== "not-found") throw new Error(entries.error.message);
    const numbers = entries.ok ? entries.value.map((entry) => Number(entry.name.replace(/\.json$/, ""))).filter(Number.isSafeInteger) : [];
    const next = Math.max(0, ...numbers) + 1;
    // Append, never overwrite capture or earlier progress. A torn later record cannot destroy recovery.
    unwrap(await history.write(`${directory}/${next}.json`, utf8Encode(JSON.stringify(group))));
  };
  const store = async (bytes: Uint8Array): Promise<string> => {
    const key = await hash(bytes);
    await ensureHistory(`${ROOT}/contents`);
    const existing = await history.read(blobPath(key));
    if (existing.ok) {
      if (await hash(existing.value) !== key) throw new Error(`Corrupt recovery contents: ${key}`);
    } else {
      if (existing.error.code !== "not-found") throw new Error(existing.error.message);
      unwrap(await history.write(blobPath(key), bytes));
    }
    return key;
  };
  const contents = async (key: string | null): Promise<Uint8Array | null> => {
    if (key === null) return null;
    const bytes = unwrap(await history.read(blobPath(key)));
    if (await hash(bytes) !== key) throw new Error(`Corrupt recovery contents: ${key}`);
    return bytes;
  };
  let operations = projectOperations.get(fs);
  if (operations === undefined) { operations = new Map(); projectOperations.set(fs, operations); }
  const serial = async <T>(action: () => Promise<T>): Promise<T> => {
    const previous = operations.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    operations.set(projectId, next);
    await previous;
    try { return await action(); } finally { release(); if (operations.get(projectId) === next) operations.delete(projectId); }
  };
  const manifestPath = (id: string): string => `${ROOT}/groups/${id}.json`;
  const blobPath = (hash: string): string => `${ROOT}/contents/${hash}`;
  const hash = async (bytes: Uint8Array): Promise<string> => {
    const value = await env.hash(bytes);
    if (!digestPattern.test(value)) throw new Error("History requires a valid SHA-256 digest.");
    return value;
  };
  const canonical = (path: string): Promise<string> =>
    checkpointFilePath((parent) => fs.listProject(projectId, parent), path);
  const current = async (path: string): Promise<Uint8Array | null> => {
    if (env.current !== undefined) return await env.current(path);
    const bytes = await fs.readProject(projectId, path);
    if (bytes.ok) return bytes.value;
    if (bytes.error.code === "not-found") return null;
    throw new Error(bytes.error.message);
  };
  const currentHash = async (path: string): Promise<string | null> => { const bytes = await current(path); return bytes === null ? null : hash(bytes); };
  const load = async (id: string): Promise<CheckpointGroup> => {
    if (!idPattern.test(id)) throw new Error("Invalid recovery group identity.");
    const value: unknown = JSON.parse(utf8Decode(unwrap(await history.read(manifestPath(id)))));
    if (typeof value !== "object" || value === null) throw new Error("Invalid recovery manifest.");
    const raw = value as Partial<CheckpointGroup>;
    const group: CheckpointGroup = { ...raw, name: raw.name ?? null, restores: raw.restores ?? null, uncovered: raw.uncovered ?? [] } as CheckpointGroup;
    if (group.schema !== 1 || group.id !== id || !["before-wizard", "before-script", "before-restore", "named"].includes(group.reason) || typeof group.time !== "string"
      || !(group.name === null || typeof group.name === "string") || !(group.restores === null || typeof group.restores === "string")
      || !Array.isArray(group.files) || (group.files.length === 0 && group.reason !== "named") || !Array.isArray(group.uncovered)) throw new Error("Invalid recovery manifest.");
    const seen = new Set<string>();
    for (const file of group.files) {
      if (typeof file !== "object" || file === null || typeof file.path !== "string" || !validPath(file.path)
        || ![file.before, file.after].every((key) => key === null || typeof key === "string" && digestPattern.test(key))
        || !["pending", "writing", "written", "failed", "already-as-wanted", "kept-uncertain", "kept-changed", "uncovered"].includes(file.status)
        || !(file.message === null || typeof file.message === "string") || seen.has(foldPath(file.path))) throw new Error("Invalid recovery manifest entry.");
      seen.add(foldPath(file.path));
    }
    for (const file of group.uncovered) {
      if (typeof file !== "object" || file === null || typeof file.path !== "string" || !validPath(file.path)
        || !["type", "size"].includes(file.reason) || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("Invalid uncovered checkpoint entry.");
    }
    const progress = await history.list(`${ROOT}/progress/${id}`);
    if (!progress.ok && progress.error.code !== "not-found") throw new Error(progress.error.message);
    if (progress.ok) {
      const records = progress.value.filter((entry) => entry.kind === "file" && /^\d+\.json$/.test(entry.name)).sort((a, b) => Number(b.name.slice(0, -5)) - Number(a.name.slice(0, -5)));
      for (const record of records) {
        const bytes = await history.read(`${ROOT}/progress/${id}/${record.name}`);
        if (!bytes.ok) continue;
        try {
          const update = JSON.parse(utf8Decode(bytes.value)) as CheckpointGroup;
          if (update.schema !== 1 || update.id !== id || !Array.isArray(update.files) || update.files.length !== group.files.length) continue;
          if (!update.files.every((file, i) => file.path === group.files[i]!.path && file.before === group.files[i]!.before
            && (file.after === null || digestPattern.test(file.after))
            && (group.reason === "before-wizard" || file.after === group.files[i]!.after)
            && ["pending", "writing", "written", "failed", "already-as-wanted", "kept-uncertain", "kept-changed", "uncovered"].includes(file.status)
            && (group.reason !== "before-restore" || !notRestored(group.files[i]!) || file.status === group.files[i]!.status)
            && (file.message === null || typeof file.message === "string"))) continue;
          group.files = update.files;
          break;
        } catch { /* A partial progress record leaves the preceding durable record authoritative. */ }
      }
    }
    return group;
  };
  const capture = async (targets: readonly CaptureTarget[], reason: CheckpointGroup["reason"], options: {
    readonly name?: string | null;
    readonly restores?: string | null;
    readonly uncovered?: readonly CheckpointUncovered[];
    readonly isolateRefusals?: boolean;
  } = {}): Promise<CheckpointGroup> => {
    if (targets.length === 0 && reason !== "named") throw new Error("A checkpoint needs at least one destination.");
    const seen = new Set<string>();
    const restoring = reason === "before-restore";
    const prepared: { path: string; before: Uint8Array | null; after: Uint8Array | null; noOp: RestoreNoOp | null }[] = [];
    for (const target of targets) {
      if (seen.has(foldPath(target.path))) throw new Error(`Duplicate destination: ${target.path}`);
      seen.add(foldPath(target.path));
      if ("noOp" in target) {
        prepared.push({ path: target.path, before: null, after: null, noOp: target.noOp });
        continue;
      }
      const conflict = restoring ? await pathConflict(canonical, target.path) : null;
      if (conflict !== null) {
        prepared.push({ path: target.path, before: null, after: null, noOp: { status: "kept-changed", message: conflict } });
        continue;
      }
      const path = restoring ? target.path : await canonical(target.path);
      if (reason === "before-script" && path !== target.path) throw new Error(spellingChanged(target.path, path));
      const before = await current(path);
      const refused = "expectedBefore" in target && !sameBytes(before, target.expectedBefore)
        ? `${path} changed since review; choose the version again.`
        : reason !== "named" && !sameBytes(before, target.bytes) ? await env.guard(path, target.bytes === null, target.bytes) : null;
      if (refused !== null) {
        if (options.isolateRefusals !== true) throw new Error(refused);
        prepared.push({ path, before: null, after: null, noOp: { status: "failed", message: refused } });
        continue;
      }
      prepared.push({ path, before, after: reason === "named" ? before?.slice() ?? null : target.bytes?.slice() ?? null, noOp: null });
    }
    const collisions = prepared.filter((file) => file.before !== null).map((file) => file.path);
    if ((reason === "before-wizard" || reason === "before-script") && collisions.length > 0 && !await env.consent(collisions)) throw new Error("Cancelled; no target files changed.");
    const id = env.newId();
    if (!idPattern.test(id)) throw new Error("Invalid new checkpoint identity.");
    const known = await history.read(manifestPath(id));
    if (known.ok || known.error.code !== "not-found") throw new Error("Could not reserve a new checkpoint identity.");
    const group: CheckpointGroup = {
      schema: 1, id, reason, time: env.time(), name: options.name ?? null, restores: options.restores ?? null,
      files: [], uncovered: [...(options.uncovered ?? [])],
    };
    for (const file of prepared) group.files.push({
      path: file.path,
      before: file.before === null ? null : await store(file.before),
      after: file.after === null ? null : await store(file.after),
      status: file.noOp?.status ?? (reason === "named" ? "written" : "pending"),
      message: file.noOp?.message ?? null,
    });
    await captureManifest(group);
    return group;
  };
  const execute = async (group: CheckpointGroup): Promise<CheckpointGroup> => {
    if (group.reason === "before-script") throw new Error("Script checkpoints are restore-only. Review the current programs to apply again.");
    // Validate ALL referenced bytes before even the first destructive operation.
    const intended = await Promise.all(group.files.map((file) => contents(file.after)));
    await Promise.all(group.files.map((file) => contents(file.before)));
    for (let index = 0; index < group.files.length; index++) {
      const file = group.files[index]!;
      if (file.status === "written" || file.status === "uncovered" || (group.reason === "before-restore" && notRestored(file))) continue;
      try {
        if (await canonical(file.path) !== file.path) throw new Error(`Destination spelling changed: ${file.path}`);
        const now = await currentHash(file.path);
        const interrupted = file.status === "writing" || file.status === "failed";
        if (group.reason === "before-restore" && now === file.after) {
          file.status = "already-as-wanted";
          file.message = "Already as wanted";
          await persist(group);
          continue;
        }
        if (group.reason === "before-restore" && now !== file.before && !interrupted) {
          throw new Error(`${file.path} changed after the restore started, so it was not restored. Choose the version again.`);
        }
        const refused = await env.guard(file.path, file.after === null, intended[index]);
        if (refused !== null) throw new Error(refused);
        // A failed/unknown write never becomes durable by readback. Fresh permission is needed to retry.
        if ((now !== file.before || interrupted) && !await env.consent([file.path])) throw new Error(`Replacement declined: ${file.path}`);
        file.status = "writing";
        file.message = null;
        await persist(group);
        const bytes = intended[index]!;
        const lateRefusal = await env.guard(file.path, bytes === null, bytes);
        if (lateRefusal !== null) throw new Error(lateRefusal);
        const expected = env.write === undefined ? null : await contents(file.before);
        if (await canonical(file.path) !== file.path) throw new Error(`Destination spelling changed: ${file.path}`);
        if (env.write !== undefined) unwrap(await env.write(file.path, bytes, { groupId: group.id, expected }));
        else if (bytes !== null) unwrap(await fs.writeProject(projectId, file.path, bytes));
        else if (now !== null) unwrap(await fs.deleteProject(projectId, file.path));
        file.status = "written";
        file.message = group.reason === "before-restore" ? "Restored" : "Written";
        await persist(group);
      } catch (error) {
        file.status = "failed";
        file.message = message(error);
        try { await persist(group); } catch (historyError) { file.message += `; recovery progress could not be saved: ${message(historyError)}`; }
        if (group.reason !== "before-restore") break;
      }
    }
    return group;
  };
  const api = {
    async begin(paths: readonly string[], name: string | null = null): Promise<PlatformResult<CheckpointGroup>> {
      try {
        const targets = await Promise.all(paths.map(async (path) => ({ path, bytes: await current(path) })));
        return platformOk(await capture(targets, "before-wizard", { name }));
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async prepareScripts(targets: readonly CheckpointTarget[], name: string): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await capture(targets, "before-script", { name })); }
      catch (error) { return platformError("io-error", message(error)); }
    },
    async registerWritten(id: string, path: string, bytes: Uint8Array | null): Promise<PlatformResult<CheckpointGroup>> {
      try {
        const group = await load(id);
        if (group.reason !== "before-wizard" && group.reason !== "before-script") throw new Error(`Checkpoint group ${id} does not accept wizard writes.`);
        const canonicalPath = await canonical(path);
        const file = group.files.find((entry) => group.reason === "before-script"
          ? canonicalPath === path && entry.path === path
          : foldPath(entry.path) === foldPath(canonicalPath));
        if (file === undefined) throw new Error(`${path} was not in checkpoint group ${id}.`);
        if (group.reason === "before-script") {
          if (file.after !== (bytes === null ? null : await hash(bytes))) throw new Error(`${path} does not match its reviewed result.`);
        } else {
          file.after = bytes === null ? null : await store(bytes);
        }
        file.status = "written";
        file.message = "Written";
        await persist(group);
        return platformOk(group);
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async apply(id: string): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await load(id))); } catch (error) { return platformError("io-error", message(error)); }
    },
    async commit(targets: readonly CheckpointTarget[]): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await capture(targets, "before-wizard"))); } catch (error) { return platformError("io-error", message(error)); }
    },
    async restoreTargets(targets: readonly CheckpointTarget[], restores: string | null = null, uncovered: readonly CheckpointUncovered[] = []): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await capture(targets, "before-restore", { restores, uncovered }))); }
      catch (error) { return platformError("io-error", message(error)); }
    },
    async createNamedCheckpoint(name: string, targets: readonly CheckpointTarget[], uncovered: readonly CheckpointUncovered[] = []): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await capture(targets, "named", { name: name.trim() || "Checkpoint", uncovered })); }
      catch (error) { return platformError("io-error", message(error)); }
    },
    async preview(id: string, path: string, version: "before" | "after" = "before"): Promise<PlatformResult<{ readonly groupId: string; readonly path: string; readonly sha256: string; readonly bytes: Uint8Array } | null>> {
      try {
        const group = await load(id);
        const file = group.files.find((entry) => entry.path === path);
        if (file === undefined) return platformOk(null);
        const sha256 = file[version];
        if (sha256 === null) return platformOk(null);
        return platformOk({ groupId: id, path, sha256, bytes: (await contents(sha256))!.slice() });
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async retry(id: string): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await load(id))); } catch (error) { return platformError("io-error", message(error)); }
    },
    async restore(id: string, options: RestoreOptions = {}): Promise<PlatformResult<CheckpointGroup>> {
      try {
        const source = await load(id);
        const isolateRefusals = source.reason === "before-script" || source.reason === "before-restore";
        const only = options.only === undefined ? null : new Set(options.only.map(foldPath));
        const deleteUncertain = new Set(options.deleteUncertain?.map(foldPath) ?? []);
        const selected = source.files.filter((file) => only === null || only.has(foldPath(file.path)));
        if (selected.length === 0) throw new Error("No checkpoint files were selected for restore.");
        const previousRefusals = new Map<string, string>();
        const eligible: string[] = [];
        for (const file of selected) {
          const kept = source.reason === "before-restore" && notRestored(file)
            ? file.status === "already-as-wanted" ? "The previous restore did not change this file; there is nothing to undo." : file.message ?? "No change to reverse for this path."
            : await pathConflict(canonical, file.path);
          if (kept === null) eligible.push(file.path);
          else previousRefusals.set(file.path, kept);
        }
        const expected = await options.confirmBefore?.(eligible);
        if (expected === null) throw new Error("Cancelled: nothing was changed.");
        const targets: CaptureTarget[] = [];
        for (const file of selected) {
          const desiredHash = source.reason === "named" ? file.after : file.before;
          const desired = await contents(desiredHash);
          const kept = previousRefusals.get(file.path) ?? await pathConflict(canonical, file.path);
          if (kept !== null) {
            targets.push(noOp(file.path, "kept-changed", kept));
            continue;
          }
          const actual = await current(file.path);
          if (expected?.has(file.path) && !sameBytes(actual, expected.get(file.path)!)) {
            const refused = `${file.path} changed after restore confirmation, so it was not restored. Choose the version again.`;
            if (!isolateRefusals) throw new Error(refused);
            targets.push(noOp(file.path, "failed", refused));
            continue;
          }
          const actualHash = actual === null ? null : await hash(actual);
          const expectedBefore = actual;
          // Reviewed intent is not a receipt that a previously absent file was actually created by this operation.
          const registeredAfter = source.reason === "before-script" && file.status !== "written" ? null : file.after;
          if (actualHash === desiredHash) {
            targets.push(noOp(file.path, "already-as-wanted", "Already as wanted"));
          } else if (source.reason === "before-script" && desiredHash !== null && actualHash !== file.after) {
            targets.push(noOp(file.path, "kept-changed", "The existing file no longer matches either reviewed version, so it was kept."));
          } else if (desiredHash === null && actual !== null && actualHash !== registeredAfter && !deleteUncertain.has(foldPath(file.path))) {
            targets.push(noOp(file.path, "kept-uncertain", "The file no longer matches the bytes recorded by this operation, so it was kept."));
          } else {
            targets.push({ path: file.path, bytes: desired, expectedBefore });
          }
        }
        const group = await capture(targets, "before-restore", { restores: id, uncovered: source.uncovered, isolateRefusals });
        return platformOk(await execute(group));
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async list(): Promise<PlatformResult<readonly CheckpointEntry[]>> {
      try {
        const entries = await history.list(`${ROOT}/groups`);
        if (!entries.ok && entries.error.code === "not-found") return platformOk([]);
        const groups: CheckpointGroup[] = [];
        const problems: CheckpointProblem[] = [];
        for (const entry of unwrap(entries)) {
          const id = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : entry.name;
          const deletable = entry.kind === "file" && entry.name.endsWith(".json") && idPattern.test(id);
          try {
            if (!deletable) throw new Error("Invalid recovery directory entry; inspect this path in the project files.");
            groups.push(await load(id));
          } catch (error) { problems.push({ id, path: `${ROOT}/groups/${entry.name}`, error: message(error), deletable }); }
        }
        return platformOk([...groups.sort((a, b) => a.time < b.time ? 1 : a.time > b.time ? -1 : a.id.localeCompare(b.id)), ...problems]);
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async ignoreHistory(): Promise<PlatformResult<void>> {
      try {
        const path = await canonical(".gitignore");
        const existing = await current(path);
        const text = existing === null ? "" : utf8Decode(existing);
        if (text.split(/\r?\n/).some((line) => line === "/.tkr-history/" || line === ".tkr-history/")) return platformOk(undefined);
        const group = await execute(await capture([{ path, bytes: utf8Encode(`${text}${text === "" || text.endsWith("\n") ? "" : "\n"}/.tkr-history/\n`) }], "before-wizard"));
        return group.files.every((file) => file.status === "written") ? platformOk(undefined) : platformError("io-error", group.files.find((file) => file.status !== "written")?.message ?? "Ignore update failed; see recovery.");
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async deleteGroup(id: string): Promise<PlatformResult<void>> {
      try {
        if (!idPattern.test(id)) return platformError("invalid-path", "Invalid recovery group identity.");
        return await history.delete(manifestPath(id));
      } catch (error) { return platformError("io-error", message(error)); }
    },
  };
  return {
    ...api,
    begin: (paths: readonly string[], name?: string | null) => serial(() => api.begin(paths, name)),
    prepareScripts: (targets: readonly CheckpointTarget[], name: string) => serial(() => api.prepareScripts(targets, name)),
    registerWritten: (id: string, path: string, bytes: Uint8Array | null) => serial(() => api.registerWritten(id, path, bytes)),
    apply: (id: string) => serial(() => api.apply(id)),
    commit: (targets: readonly CheckpointTarget[]) => serial(() => api.commit(targets)),
    restoreTargets: (targets: readonly CheckpointTarget[], restores?: string | null, uncovered?: readonly CheckpointUncovered[]) => serial(() => api.restoreTargets(targets, restores, uncovered)),
    createNamedCheckpoint: (name: string, targets: readonly CheckpointTarget[], uncovered?: readonly CheckpointUncovered[]) => serial(() => api.createNamedCheckpoint(name, targets, uncovered)),
    preview: (id: string, path: string, version?: "before" | "after") => serial(() => api.preview(id, path, version)),
    retry: (id: string) => serial(() => api.retry(id)),
    restore: (id: string, options?: RestoreOptions) => serial(() => api.restore(id, options)),
    list: () => serial(() => api.list()),
    deleteGroup: (id: string) => serial(() => api.deleteGroup(id)),
    ignoreHistory: () => serial(() => api.ignoreHistory()),
  };
}
export type CheckpointGroups = ReturnType<typeof createCheckpointGroups>;
