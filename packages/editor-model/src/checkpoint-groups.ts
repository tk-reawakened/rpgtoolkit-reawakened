import { foldPath, utf8Decode, utf8Encode } from "@tk-reawakened/core";
import { platformError, platformOk, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";

/** docs/spec/editor-animation-authoring.md#persistent-checkpoint-groups */
export interface CheckpointFile {
  path: string;
  before: string | null;
  after: string | null;
  status: "pending" | "writing" | "written" | "failed";
  message: string | null;
}
export interface CheckpointGroup {
  schema: 1;
  id: string;
  reason: "before-wizard" | "before-restore";
  time: string;
  files: CheckpointFile[];
}
export interface CheckpointTarget { readonly path: string; readonly bytes: Uint8Array | null }
export interface CheckpointEnvironment {
  readonly fs: FileSystemService;
  readonly projectId: string;
  readonly hash: (bytes: Uint8Array) => Promise<string>;
  readonly newId: () => string;
  readonly time: () => string;
  /** Refuse unsafe open-document replacement/removal. Called before capture and again before every target write. */
  readonly guard: (path: string, removing: boolean, intended?: Uint8Array | null) => Promise<string | null>;
  readonly consent: (paths: readonly string[]) => Promise<boolean>;
  /** A host may route an authoritative open document through accepted edits and normal save. */
  readonly write?: (path: string, bytes: Uint8Array | null) => Promise<PlatformResult<void>>;
}
const ROOT = ".tkr-history";
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-zA-Z0-9-]+$/;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
function validPath(path: string): boolean {
  return path.length > 0 && !/[\\\u0000-\u001f:]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..") && foldPath(path.split("/")[0]!) !== ROOT;
}
function unwrap<T>(result: PlatformResult<T>): T { if (!result.ok) throw new Error(result.error.message); return result.value; }

const projectOperations = new WeakMap<FileSystemService, Map<string, Promise<void>>>();

/** Whole-byte, SHA-256 deduplicated groups. No retention policy and no atomic rollback promise. */
export function createCheckpointGroups(env: CheckpointEnvironment) {
  const { fs, projectId } = env;
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
  const captureManifest = async (group: CheckpointGroup): Promise<void> => { unwrap(await fs.writeProject(projectId, manifestPath(group.id), utf8Encode(JSON.stringify(group)))); };
  const persist = async (group: CheckpointGroup): Promise<void> => {
    const directory = `${ROOT}/progress/${group.id}`;
    const entries = await fs.listProject(projectId, directory);
    if (!entries.ok && entries.error.code !== "not-found") throw new Error(entries.error.message);
    const numbers = entries.ok ? entries.value.map((entry) => Number(entry.name.replace(/\.json$/, ""))).filter(Number.isSafeInteger) : [];
    const next = Math.max(0, ...numbers) + 1;
    // Append, never overwrite capture or earlier progress. A torn later record cannot destroy recovery.
    unwrap(await fs.writeProject(projectId, `${directory}/${next}.json`, utf8Encode(JSON.stringify(group))));
  };
  const store = async (bytes: Uint8Array): Promise<string> => {
    const key = await hash(bytes);
    const existing = await fs.readProject(projectId, blobPath(key));
    if (existing.ok) {
      if (await hash(existing.value) !== key) throw new Error(`Corrupt recovery contents: ${key}`);
    } else {
      if (existing.error.code !== "not-found") throw new Error(existing.error.message);
      unwrap(await fs.writeProject(projectId, blobPath(key), bytes));
    }
    return key;
  };
  const contents = async (key: string | null): Promise<Uint8Array | null> => {
    if (key === null) return null;
    const bytes = unwrap(await fs.readProject(projectId, blobPath(key)));
    if (await hash(bytes) !== key) throw new Error(`Corrupt recovery contents: ${key}`);
    return bytes;
  };
  // Resolve every segment using the same ASCII identity as documents, rejecting aliases and links.
  const canonical = async (path: string): Promise<string> => {
    if (!validPath(path)) throw new Error(`Invalid checkpoint destination: ${path}`);
    let parent = "";
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const listed = await fs.listProject(projectId, parent);
      if (!listed.ok) {
        if (listed.error.code !== "not-found") throw new Error(listed.error.message);
        return [parent, ...parts.slice(i)].filter(Boolean).join("/");
      }
      const matches = listed.value.filter((entry) => foldPath(entry.name) === foldPath(parts[i]!));
      if (matches.length > 1) throw new Error(`Case-insensitive aliases make ${path} ambiguous.`);
      const found = matches[0];
      if (found !== undefined && (found.kind === "link" || (i < parts.length - 1 ? found.kind !== "directory" : found.kind !== "file"))) throw new Error(`File/directory collision at ${path}.`);
      parent = [parent, found?.name ?? parts[i]!].filter(Boolean).join("/");
    }
    return parent;
  };
  const current = async (path: string): Promise<Uint8Array | null> => {
    const bytes = await fs.readProject(projectId, path);
    if (bytes.ok) return bytes.value;
    if (bytes.error.code === "not-found") return null;
    throw new Error(bytes.error.message);
  };
  const currentHash = async (path: string): Promise<string | null> => { const bytes = await current(path); return bytes === null ? null : hash(bytes); };
  const load = async (id: string): Promise<CheckpointGroup> => {
    if (!idPattern.test(id)) throw new Error("Invalid recovery group identity.");
    const value: unknown = JSON.parse(utf8Decode(unwrap(await fs.readProject(projectId, manifestPath(id)))));
    if (typeof value !== "object" || value === null) throw new Error("Invalid recovery manifest.");
    const group = value as CheckpointGroup;
    if (group.schema !== 1 || group.id !== id || !["before-wizard", "before-restore"].includes(group.reason) || typeof group.time !== "string" || !Array.isArray(group.files) || group.files.length === 0) throw new Error("Invalid recovery manifest.");
    const seen = new Set<string>();
    for (const file of group.files) {
      if (typeof file !== "object" || file === null || typeof file.path !== "string" || !validPath(file.path)
        || ![file.before, file.after].every((key) => key === null || typeof key === "string" && digestPattern.test(key))
        || !["pending", "writing", "written", "failed"].includes(file.status)
        || !(file.message === null || typeof file.message === "string") || seen.has(foldPath(file.path))) throw new Error("Invalid recovery manifest entry.");
      seen.add(foldPath(file.path));
    }
    const progress = await fs.listProject(projectId, `${ROOT}/progress/${id}`);
    if (!progress.ok && progress.error.code !== "not-found") throw new Error(progress.error.message);
    if (progress.ok) {
      const records = progress.value.filter((entry) => entry.kind === "file" && /^\d+\.json$/.test(entry.name)).sort((a, b) => Number(b.name.slice(0, -5)) - Number(a.name.slice(0, -5)));
      for (const record of records) {
        const bytes = await fs.readProject(projectId, `${ROOT}/progress/${id}/${record.name}`);
        if (!bytes.ok) continue;
        try {
          const update = JSON.parse(utf8Decode(bytes.value)) as CheckpointGroup;
          if (update.schema !== 1 || update.id !== id || !Array.isArray(update.files) || update.files.length !== group.files.length) continue;
          if (!update.files.every((file, i) => file.path === group.files[i]!.path && file.before === group.files[i]!.before && file.after === group.files[i]!.after && ["pending", "writing", "written", "failed"].includes(file.status) && (file.message === null || typeof file.message === "string"))) continue;
          group.files = update.files;
          break;
        } catch { /* A partial progress record leaves the preceding durable record authoritative. */ }
      }
    }
    return group;
  };
  const capture = async (targets: readonly CheckpointTarget[], reason: CheckpointGroup["reason"]): Promise<CheckpointGroup> => {
    if (targets.length === 0) throw new Error("A checkpoint needs at least one destination.");
    const seen = new Set<string>();
    const prepared: { path: string; before: Uint8Array | null; after: Uint8Array | null }[] = [];
    for (const target of targets) {
      const path = await canonical(target.path);
      if (seen.has(foldPath(path))) throw new Error(`Duplicate destination: ${path}`);
      seen.add(foldPath(path));
      const refused = await env.guard(path, target.bytes === null, target.bytes);
      if (refused !== null) throw new Error(refused);
      prepared.push({ path, before: await current(path), after: target.bytes?.slice() ?? null });
    }
    const collisions = prepared.filter((file) => file.before !== null).map((file) => file.path);
    if (reason === "before-wizard" && collisions.length > 0 && !await env.consent(collisions)) throw new Error("Cancelled; no target files changed.");
    const id = env.newId();
    if (!idPattern.test(id)) throw new Error("Invalid new checkpoint identity.");
    const known = await fs.readProject(projectId, manifestPath(id));
    if (known.ok || known.error.code !== "not-found") throw new Error("Could not reserve a new checkpoint identity.");
    const group: CheckpointGroup = { schema: 1, id, reason, time: env.time(), files: [] };
    for (const file of prepared) group.files.push({ path: file.path, before: file.before === null ? null : await store(file.before), after: file.after === null ? null : await store(file.after), status: "pending", message: null });
    await captureManifest(group);
    return group;
  };
  const execute = async (group: CheckpointGroup): Promise<CheckpointGroup> => {
    // Validate ALL referenced bytes before even the first destructive operation.
    const intended = await Promise.all(group.files.map((file) => contents(file.after)));
    await Promise.all(group.files.map((file) => contents(file.before)));
    for (let index = 0; index < group.files.length; index++) {
      const file = group.files[index]!;
      if (file.status === "written") continue;
      try {
        if (await canonical(file.path) !== file.path) throw new Error(`Destination spelling changed: ${file.path}`);
        const refused = await env.guard(file.path, file.after === null, intended[index]);
        if (refused !== null) throw new Error(refused);
        const now = await currentHash(file.path);
        // A failed/unknown write never becomes durable by readback. Fresh permission is needed to retry.
        if ((now !== file.before || file.status === "writing" || file.status === "failed") && !await env.consent([file.path])) throw new Error(`Replacement declined: ${file.path}`);
        file.status = "writing";
        file.message = null;
        await persist(group);
        const bytes = intended[index]!;
        const lateRefusal = await env.guard(file.path, bytes === null, bytes);
        if (lateRefusal !== null) throw new Error(lateRefusal);
        if (group.reason === "before-restore" && now === file.after) { /* No destructive operation is needed. */ }
        else if (env.write !== undefined) unwrap(await env.write(file.path, bytes));
        else if (bytes !== null) unwrap(await fs.writeProject(projectId, file.path, bytes));
        else if (now !== null) unwrap(await fs.deleteProject(projectId, file.path));
        file.status = "written";
        file.message = group.reason === "before-restore" ? now === file.after ? "Already as wanted" : "Restored" : "Written";
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
    async commit(targets: readonly CheckpointTarget[]): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await capture(targets, "before-wizard"))); } catch (error) { return platformError("io-error", message(error)); }
    },
    async retry(id: string): Promise<PlatformResult<CheckpointGroup>> {
      try { return platformOk(await execute(await load(id))); } catch (error) { return platformError("io-error", message(error)); }
    },
    async restore(id: string): Promise<PlatformResult<CheckpointGroup>> {
      try {
        const source = await load(id);
        const targets: CheckpointTarget[] = [];
        for (const file of source.files) { await contents(file.after); targets.push({ path: file.path, bytes: await contents(file.before) }); }
        // A new persistent group captures even the files about to be removed.
        return platformOk(await execute(await capture(targets, "before-restore")));
      } catch (error) { return platformError("io-error", message(error)); }
    },
    async list(): Promise<PlatformResult<readonly CheckpointGroup[]>> {
      try {
        const entries = await fs.listProject(projectId, `${ROOT}/groups`);
        if (!entries.ok && entries.error.code === "not-found") return platformOk([]);
        const groups: CheckpointGroup[] = [];
        for (const entry of unwrap(entries)) {
          if (entry.kind !== "file" || !entry.name.endsWith(".json")) throw new Error("Invalid recovery directory entry.");
          groups.push(await load(entry.name.slice(0, -5)));
        }
        return platformOk(groups.sort((a, b) => a.time < b.time ? 1 : a.time > b.time ? -1 : a.id.localeCompare(b.id)));
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
      try { await load(id); return await fs.deleteProject(projectId, manifestPath(id)); } catch (error) { return platformError("io-error", message(error)); }
    },
  };
  return {
    ...api,
    commit: (targets: readonly CheckpointTarget[]) => serial(() => api.commit(targets)),
    retry: (id: string) => serial(() => api.retry(id)),
    restore: (id: string) => serial(() => api.restore(id)),
    deleteGroup: (id: string) => serial(() => api.deleteGroup(id)),
    ignoreHistory: () => serial(() => api.ignoreHistory()),
  };
}
export type CheckpointGroups = ReturnType<typeof createCheckpointGroups>;
