import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService, PlatformResult } from "@tk-reawakened/platform-services";
import { sha256Hex, type DocumentHistoryStore, type HistoryLocation } from "./document-history.ts";

/** Ownership and recovery: docs/spec/formats/native-scene.md, build rules 6–7. */
export interface SceneBuildRecord {
  readonly version: 2;
  readonly scene: string;
  readonly producer: string;
  readonly output: string;
  readonly sha256: string;
}

/**
 * Storage is separate from the scene. Pending markers must be durable and independently stored from records: a
 * successful marker makes an old record untrusted until clearPending succeeds, including after a restart.
 */
export interface SceneBuildOwnershipStorage {
  readonly location: HistoryLocation;
  readRecord(output: string): Promise<PlatformResult<Uint8Array | null>>;
  isPending(output: string): Promise<PlatformResult<boolean>>;
  markPending(output: string): Promise<PlatformResult<void>>;
  writeRecord(output: string, record: Uint8Array): Promise<PlatformResult<void>>;
  clearPending(output: string): Promise<PlatformResult<void>>;
}

type StorageFs = Pick<FileSystemService, "read" | "write" | "delete">;

/** Project-local by default; a host or session filesystem may be passed with its truthful location. */
export function createSceneBuildOwnershipStorage(fs: StorageFs, location: HistoryLocation = {
  kind: "project-folder", description: "Project-local scene build history",
}): SceneBuildOwnershipStorage {
  const path = async (output: string, suffix: string): Promise<string> =>
    `.tkr-history/scene-build/${await sha256Hex(utf8Encode(output.replace(/[A-Z]/g, (c) => c.toLowerCase())))}.${suffix}`;
  return {
    location,
    async readRecord(output) {
      const result = await fs.read(await path(output, "json"));
      return !result.ok && result.error.code === "not-found" ? { ok: true, value: null } : result;
    },
    async isPending(output) {
      const result = await fs.read(await path(output, "pending"));
      if (result.ok) return { ok: true, value: true };
      return result.error.code === "not-found" ? { ok: true, value: false } : result;
    },
    async markPending(output) { return fs.write(await path(output, "pending"), utf8Encode("pending\n")); },
    async writeRecord(output, record) { return fs.write(await path(output, "json"), record); },
    async clearPending(output) { return fs.delete(await path(output, "pending")); },
  };
}

/**
 * One planned build output. `producer` names the document that produces `path`; omission means the scene itself, so a
 * generated pack image stays scene-owned while a shared tileset output names its tileset.
 */
export interface SceneBuildOutput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly producer?: string;
}
export type SceneBuildConflictKind = "unowned" | "modified" | "missing" | "owner-mismatch" | "untrusted";
export interface SceneBuildConflict { readonly path: string; readonly kind: SceneBuildConflictKind; readonly message: string }
export interface SceneBuildObservation {
  readonly path: string;
  /** The existing spelling this output resolves to, which is what a write addresses. */
  readonly resolvedPath: string;
  readonly producer: string;
  readonly plannedHash: string;
  readonly currentHash: string | null;
  readonly recordHash: string | null;
  readonly record: SceneBuildRecord | null;
  readonly pending: boolean;
  readonly skipReason: "unchanged" | "shared" | null;
}
export interface SceneBuildCheck {
  readonly scene: string;
  readonly observations: readonly SceneBuildObservation[];
  readonly conflicts: readonly SceneBuildConflict[];
}
export type SceneBuildCheckResult = { readonly ok: true; readonly check: SceneBuildCheck } | { readonly ok: false; readonly message: string };
export interface SceneBuildWriteOutcome {
  readonly path: string;
  readonly status: "written" | "unchanged" | "shared" | "file-failed" | "record-failed" | "not-written";
  readonly message: string;
}
export type SceneBuildWriteResult =
  | { readonly ok: true; readonly outcomes: readonly SceneBuildWriteOutcome[] }
  | { readonly ok: false; readonly message: string; readonly outcomes: readonly SceneBuildWriteOutcome[] };

const fold = (path: string): string => path.replace(/[A-Z]/g, (c) => c.toLowerCase());
const validPath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every((p) => p !== "" && p !== "." && p !== "..");

// Explicit project identities coordinate separate wrappers; otherwise weakly key queues by filesystem identity.
const projectQueues = new Map<string, Promise<void>>();
const filesystemQueues = new WeakMap<object, Promise<void>>();
export async function withSceneBuildProjectWrite<T>(key: string | object, action: () => Promise<T>): Promise<T> {
  const previous = (typeof key === "string" ? projectQueues.get(key) : filesystemQueues.get(key)) ?? Promise.resolve();
  const run = previous.then(action);
  const settled = run.then(() => undefined, () => undefined);
  if (typeof key === "string") projectQueues.set(key, settled);
  else filesystemQueues.set(key, settled);
  try { return await run; }
  finally { if (typeof key === "string" && projectQueues.get(key) === settled) projectQueues.delete(key); }
}

async function resolvePath(fs: Pick<FileSystemService, "read" | "write"> & Partial<Pick<FileSystemService, "list">>, path: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const list = fs.list;
  if (list === undefined) return { ok: true, path };
  const parts = path.split("/");
  let parent = "";
  for (let index = 0; index < parts.length; index += 1) {
    const listing = await list(parent);
    if (!listing.ok) {
      if (listing.error.code === "not-found") return { ok: true, path: [parent, ...parts.slice(index)].filter(Boolean).join("/") };
      return { ok: false, message: `Cannot list ${parent || "project root"}: ${listing.error.message}` };
    }
    const matches = listing.value.filter((entry) => fold(entry.name) === fold(parts[index]!));
    if (matches.length > 1) return { ok: false, message: `Case-insensitive path is ambiguous: ${path}` };
    const match = matches[0];
    if (match === undefined) return { ok: true, path: [parent, ...parts.slice(index)].filter(Boolean).join("/") };
    if (match.kind === "link" || (index < parts.length - 1 && match.kind !== "directory") || (index === parts.length - 1 && match.kind !== "file")) {
      return { ok: false, message: `Cannot safely resolve output path: ${path}` };
    }
    parent = parent ? `${parent}/${match.name}` : match.name;
  }
  return { ok: true, path: parent };
}

function parseRecord(bytes: Uint8Array | null): SceneBuildRecord | null {
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(utf8Decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (item.version !== 2 || typeof item.scene !== "string" || !validPath(item.scene) || typeof item.producer !== "string" || !validPath(item.producer) || typeof item.output !== "string" || !validPath(item.output) || typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) return null;
    return { version: 2, scene: item.scene, producer: item.producer, output: item.output, sha256: item.sha256 };
  } catch { return null; }
}

/**
 * Call check before showing conflicts; write repeats that review under project-wide serialization. A different producer
 * cannot take over an owned destination. Existing bytes are retained in history before replacement, and an optional
 * input verifier runs after that capture and before the first output write. External filesystem writers are not
 * serialized, so the host filesystem's check/write race cannot be eliminated here.
 */
export function createSceneBuildOwnership(options: {
  readonly fs: Pick<FileSystemService, "read" | "write"> & Partial<Pick<FileSystemService, "list">>;
  readonly storage: SceneBuildOwnershipStorage;
  readonly history: Pick<DocumentHistoryStore, "keep">;
  readonly projectId?: string;
}) {
  async function check(scene: string, outputs: readonly SceneBuildOutput[]): Promise<SceneBuildCheckResult> {
    if (!validPath(scene)) return { ok: false, message: "The scene path must be project-relative." };
    const paths = new Set<string>();
    const observations: SceneBuildObservation[] = [];
    const conflicts: SceneBuildConflict[] = [];
    for (const output of outputs) {
      if (!validPath(output.path) || paths.has(fold(output.path))) return { ok: false, message: `Invalid or duplicate output path: ${output.path}` };
      const producer = output.producer ?? scene;
      if (!validPath(producer)) return { ok: false, message: `Invalid producer path: ${producer}` };
      const resolved = await resolvePath(options.fs, output.path);
      if (!resolved.ok) return resolved;
      paths.add(fold(output.path));
      const file = await options.fs.read(resolved.path);
      if (!file.ok && file.error.code !== "not-found") return { ok: false, message: `Cannot read ${output.path}: ${file.error.message}` };
      const recordBytes = await options.storage.readRecord(resolved.path);
      const pending = await options.storage.isPending(resolved.path);
      if (!pending.ok) return { ok: false, message: `Cannot check ownership of ${output.path}: ${pending.error.message}` };
      const raw = recordBytes.ok ? recordBytes.value : null;
      const record = parseRecord(raw);
      const currentHash = file.ok ? await sha256Hex(file.value) : null;
      const recordHash = raw === null ? null : await sha256Hex(raw);
      const plannedHash = await sha256Hex(output.bytes.slice());
      let kind: SceneBuildConflictKind | null = null;
      const sameOutput = record !== null && fold(record.output) === fold(resolved.path);
      const sceneMatches = record !== null && fold(record.scene) === fold(scene);
      const producerMatches = record !== null && fold(record.producer) === fold(producer);
      const identicalVerified = recordBytes.ok && !pending.value && record !== null && sameOutput && producerMatches && currentHash !== null &&
        currentHash === record.sha256 && currentHash === plannedHash;
      // A durable record naming another producer outranks a leftover pending marker: an interruption must not make
      // another producer's output available for an authorized takeover.
      if (!recordBytes.ok) kind = "untrusted";
      else if (record !== null && (!sameOutput || !producerMatches)) kind = "owner-mismatch";
      else if (pending.value || (raw !== null && record === null)) kind = "untrusted";
      else if (record === null && currentHash !== null) kind = "unowned";
      else if (record !== null && currentHash === null) kind = "missing";
      else if (record !== null && currentHash !== record.sha256) kind = "modified";
      const skipReason = identicalVerified ? (sceneMatches ? "unchanged" : "shared") : null;
      observations.push({ path: output.path, resolvedPath: resolved.path, producer, plannedHash, currentHash, recordHash, record, pending: pending.value, skipReason });
      if (kind !== null) conflicts.push({ path: output.path, kind, message: `${output.path}: ${kind} build output; review before replacing or recreating it.` });
    }
    return { ok: true, check: { scene, observations, conflicts } };
  }

  async function write(
    review: SceneBuildCheck,
    outputs: readonly SceneBuildOutput[],
    authorizedPaths: readonly string[] = [],
    verifyInputs?: () => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>,
  ): Promise<SceneBuildWriteResult> {
    const safeOutputs = outputs.map((output) => ({ ...output, bytes: output.bytes.slice() }));
    const safeAuthorizedPaths = authorizedPaths.slice();
    return withSceneBuildProjectWrite(options.projectId ?? options.fs, () => commit(review, safeOutputs, safeAuthorizedPaths, verifyInputs));
  }

  async function commit(
    review: SceneBuildCheck,
    safeOutputs: readonly SceneBuildOutput[],
    safeAuthorizedPaths: readonly string[],
    verifyInputs?: () => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>,
  ): Promise<SceneBuildWriteResult> {
    const empty: SceneBuildWriteOutcome[] = [];
    const fresh = await check(review.scene, safeOutputs);
    if (!fresh.ok) return { ok: false, message: fresh.message, outcomes: empty };
    if (JSON.stringify(fresh.check) !== JSON.stringify(review)) return { ok: false, message: "Outputs or ownership changed since review; check and review again.", outcomes: empty };
    if (fresh.check.conflicts.some((conflict) => conflict.kind === "owner-mismatch")) return { ok: false, message: "A different producer already owns an output.", outcomes: empty };
    const authorized = new Set(safeAuthorizedPaths.map(fold));
    if (fresh.check.conflicts.some((conflict) => !authorized.has(fold(conflict.path)))) return { ok: false, message: "Every conflict requires explicit authorization before writing.", outcomes: empty };

    // Retain only bytes that will actually be replaced; unchanged verified outputs need no new history entry.
    for (const observation of fresh.check.observations) {
      if (observation.skipReason !== null || observation.currentHash === null) continue;
      const file = await options.fs.read(observation.resolvedPath);
      if (!file.ok || await sha256Hex(file.value) !== observation.currentHash) return { ok: false, message: `${observation.path} changed while preparing history; review again.`, outcomes: empty };
      try {
        const kept = await options.history.keep(observation.resolvedPath, file.value, "before-conflict-resolution");
        if (kept.outcome === "uncovered") return { ok: false, message: `History cannot retain ${observation.path} (${kept.reason}).`, outcomes: empty };
      } catch (error) { return { ok: false, message: `Could not retain ${observation.path} in history: ${String(error)}`, outcomes: empty }; }
    }

    // Verify last: history capture waits on the host, so inputs are observed immediately before any output write.
    if (verifyInputs !== undefined) {
      try {
        const verified = await verifyInputs();
        if (!verified.ok) return { ok: false, message: verified.message, outcomes: empty };
      } catch (error) { return { ok: false, message: `Could not verify build inputs: ${String(error)}`, outcomes: empty }; }
    }

    const outcomes: SceneBuildWriteOutcome[] = [];
    for (let index = 0; index < safeOutputs.length; index += 1) {
      const output = safeOutputs[index]!;
      const observation = fresh.check.observations[index]!;
      const resolved = await resolvePath(options.fs, output.path);
      if (!resolved.ok || resolved.path !== observation.resolvedPath) {
        outcomes.push({ path: output.path, status: "not-written", message: resolved.ok ? "Output path changed after review; it was left untouched." : resolved.message });
        continue;
      }
      if (observation.skipReason !== null) {
        const file = await options.fs.read(resolved.path);
        if (!file.ok || await sha256Hex(file.value) !== observation.currentHash) {
          outcomes.push({ path: output.path, status: "not-written", message: "Output changed after review; it was left untouched." });
        } else {
          outcomes.push({
            path: output.path,
            status: observation.skipReason,
            message: observation.skipReason === "shared" ? "Identical output from the same producer was reused without rewriting." : "Output already matches its trusted build; no write was needed.",
          });
        }
        continue;
      }
      const pending = await options.storage.markPending(resolved.path);
      if (!pending.ok) { outcomes.push({ path: output.path, status: "not-written", message: `Could not mark ownership pending: ${pending.error.message}` }); continue; }
      const current = await options.fs.read(resolved.path);
      if (!current.ok && current.error.code !== "not-found") {
        outcomes.push({ path: output.path, status: "not-written", message: `Could not recheck output immediately before writing: ${current.error.message}` });
        continue;
      }
      const currentHash = current.ok ? await sha256Hex(current.value) : null;
      if (currentHash !== observation.currentHash) {
        outcomes.push({ path: output.path, status: "not-written", message: "Output changed after review; it was left untouched." });
        continue;
      }
      const result = await options.fs.write(resolved.path, output.bytes);
      if (!result.ok) { outcomes.push({ path: output.path, status: "file-failed", message: result.error.message }); continue; }
      const record: SceneBuildRecord = { version: 2, scene: review.scene, producer: observation.producer, output: resolved.path, sha256: await sha256Hex(output.bytes) };
      const saved = await options.storage.writeRecord(resolved.path, utf8Encode(`${JSON.stringify(record)}\n`));
      if (!saved.ok) { outcomes.push({ path: output.path, status: "record-failed", message: `Output written, but ownership could not be recorded: ${saved.error.message}` }); continue; }
      const cleared = await options.storage.clearPending(resolved.path);
      if (!cleared.ok) { outcomes.push({ path: output.path, status: "record-failed", message: `Output written, but ownership remains untrusted: ${cleared.error.message}` }); continue; }
      outcomes.push({ path: output.path, status: "written", message: "Output and ownership recorded." });
    }
    return outcomes.every((outcome) => outcome.status === "written" || outcome.status === "unchanged" || outcome.status === "shared")
      ? { ok: true, outcomes }
      : { ok: false, message: "Some outputs were not fully recorded; see individual outcomes.", outcomes };
  }
  return { location: options.storage.location, check, write };
}
