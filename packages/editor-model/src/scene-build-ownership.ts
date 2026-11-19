import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import type { FileSystemService, PlatformResult } from "@tk-reawakened/platform-services";
import { sha256Hex, type DocumentHistoryStore, type HistoryLocation } from "./document-history.ts";

/** Ownership and recovery: docs/spec/formats/native-scene.md, build rules 5–6. */
export interface SceneBuildRecord {
  readonly version: 1;
  readonly scene: string;
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

export interface SceneBuildOutput { readonly path: string; readonly bytes: Uint8Array }
export type SceneBuildConflictKind = "unowned" | "modified" | "missing" | "owner-mismatch" | "untrusted";
export interface SceneBuildConflict { readonly path: string; readonly kind: SceneBuildConflictKind; readonly message: string }
export interface SceneBuildObservation {
  readonly path: string;
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

function parseRecord(bytes: Uint8Array | null): SceneBuildRecord | null {
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(utf8Decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || typeof item.scene !== "string" || !validPath(item.scene) || typeof item.output !== "string" || !validPath(item.output) || typeof item.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.sha256)) return null;
    return { version: 1, scene: item.scene, output: item.output, sha256: item.sha256 };
  } catch { return null; }
}

/**
 * The coordinator supplies a filesystem bound to the intended project, ownership storage and the existing document
 * history. Call check before showing conflicts; call write with that exact check and the paths the author explicitly
 * approved. Identical verified outputs already owned by another scene are reused without rewriting or changing the record;
 * every other conflict requires explicit authorization. No check mutates files or records. Before a write, all replaced
 * bytes enter history and each destination is rechecked after history capture. This narrows but cannot eliminate the host
 * filesystem's check/write race. Session location must be shown to the author.
 */
export function createSceneBuildOwnership(options: {
  readonly fs: Pick<FileSystemService, "read" | "write">;
  readonly storage: SceneBuildOwnershipStorage;
  readonly history: Pick<DocumentHistoryStore, "keep">;
}) {
  async function check(scene: string, outputs: readonly SceneBuildOutput[]): Promise<SceneBuildCheckResult> {
    if (!validPath(scene)) return { ok: false, message: "The scene path must be project-relative." };
    const paths = new Set<string>();
    const observations: SceneBuildObservation[] = [];
    const conflicts: SceneBuildConflict[] = [];
    for (const output of outputs) {
      if (!validPath(output.path) || paths.has(fold(output.path))) return { ok: false, message: `Invalid or duplicate output path: ${output.path}` };
      paths.add(fold(output.path));
      const file = await options.fs.read(output.path);
      if (!file.ok && file.error.code !== "not-found") return { ok: false, message: `Cannot read ${output.path}: ${file.error.message}` };
      const recordBytes = await options.storage.readRecord(output.path);
      const pending = await options.storage.isPending(output.path);
      if (!pending.ok) return { ok: false, message: `Cannot check ownership of ${output.path}: ${pending.error.message}` };
      const raw = recordBytes.ok ? recordBytes.value : null;
      const record = parseRecord(raw);
      const currentHash = file.ok ? await sha256Hex(file.value) : null;
      const recordHash = raw === null ? null : await sha256Hex(raw);
      const plannedHash = await sha256Hex(output.bytes.slice());
      let kind: SceneBuildConflictKind | null = null;
      const sameOutput = record !== null && fold(record.output) === fold(output.path);
      const sceneMatches = record !== null && fold(record.scene) === fold(scene);
      const identicalVerified = recordBytes.ok && !pending.value && record !== null && sameOutput && currentHash !== null &&
        currentHash === record.sha256 && currentHash === plannedHash;
      if (!recordBytes.ok || pending.value || (raw !== null && record === null)) kind = "untrusted";
      else if (record !== null && !sameOutput) kind = "owner-mismatch";
      else if (record !== null && !sceneMatches && !identicalVerified) kind = "owner-mismatch";
      else if (record === null && currentHash !== null) kind = "unowned";
      else if (record !== null && currentHash === null) kind = "missing";
      else if (record !== null && currentHash !== record.sha256) kind = "modified";
      const skipReason = identicalVerified ? (sceneMatches ? "unchanged" : "shared") : null;
      observations.push({ path: output.path, plannedHash, currentHash, recordHash, record, pending: pending.value, skipReason });
      if (kind !== null) conflicts.push({ path: output.path, kind, message: `${output.path}: ${kind} build output; review before replacing or recreating it.` });
    }
    return { ok: true, check: { scene, observations, conflicts } };
  }

  async function write(review: SceneBuildCheck, outputs: readonly SceneBuildOutput[], authorizedPaths: readonly string[] = []): Promise<SceneBuildWriteResult> {
    const empty: SceneBuildWriteOutcome[] = [];
    const safeOutputs = outputs.map((output) => ({ path: output.path, bytes: output.bytes.slice() }));
    const fresh = await check(review.scene, safeOutputs);
    if (!fresh.ok) return { ok: false, message: fresh.message, outcomes: empty };
    if (JSON.stringify(fresh.check) !== JSON.stringify(review)) return { ok: false, message: "Outputs or ownership changed since review; check and review again.", outcomes: empty };
    const authorized = new Set(authorizedPaths.map(fold));
    if (fresh.check.conflicts.some((conflict) => !authorized.has(fold(conflict.path)))) return { ok: false, message: "Every conflict requires explicit authorization before writing.", outcomes: empty };

    // Retain only bytes that will actually be replaced; unchanged verified outputs need no new history entry.
    for (const observation of fresh.check.observations) {
      if (observation.skipReason !== null || observation.currentHash === null) continue;
      const file = await options.fs.read(observation.path);
      if (!file.ok || await sha256Hex(file.value) !== observation.currentHash) return { ok: false, message: `${observation.path} changed while preparing history; review again.`, outcomes: empty };
      try {
        const kept = await options.history.keep(observation.path, file.value, "before-conflict-resolution");
        if (kept.outcome === "uncovered") return { ok: false, message: `History cannot retain ${observation.path} (${kept.reason}).`, outcomes: empty };
      } catch (error) { return { ok: false, message: `Could not retain ${observation.path} in history: ${String(error)}`, outcomes: empty }; }
    }

    const outcomes: SceneBuildWriteOutcome[] = [];
    for (let index = 0; index < safeOutputs.length; index += 1) {
      const output = safeOutputs[index]!;
      const observation = fresh.check.observations[index]!;
      if (observation.skipReason !== null) {
        const file = await options.fs.read(output.path);
        if (!file.ok || await sha256Hex(file.value) !== observation.currentHash) {
          outcomes.push({ path: output.path, status: "not-written", message: "Output changed after review; it was left untouched." });
        } else {
          outcomes.push({
            path: output.path,
            status: observation.skipReason,
            message: observation.skipReason === "shared" ? "Identical output is already owned by another scene; reused without rewriting." : "Output already matches its trusted build; no write was needed.",
          });
        }
        continue;
      }
      const pending = await options.storage.markPending(output.path);
      if (!pending.ok) { outcomes.push({ path: output.path, status: "not-written", message: `Could not mark ownership pending: ${pending.error.message}` }); continue; }
      const current = await options.fs.read(output.path);
      if (!current.ok && current.error.code !== "not-found") {
        outcomes.push({ path: output.path, status: "not-written", message: `Could not recheck output immediately before writing: ${current.error.message}` });
        continue;
      }
      const currentHash = current.ok ? await sha256Hex(current.value) : null;
      if (currentHash !== observation.currentHash) {
        outcomes.push({ path: output.path, status: "not-written", message: "Output changed after review; it was left untouched." });
        continue;
      }
      const result = await options.fs.write(output.path, output.bytes);
      if (!result.ok) { outcomes.push({ path: output.path, status: "file-failed", message: result.error.message }); continue; }
      const record: SceneBuildRecord = { version: 1, scene: review.scene, output: output.path, sha256: await sha256Hex(output.bytes) };
      const saved = await options.storage.writeRecord(output.path, utf8Encode(`${JSON.stringify(record)}\n`));
      if (!saved.ok) { outcomes.push({ path: output.path, status: "record-failed", message: `Output written, but ownership could not be recorded: ${saved.error.message}` }); continue; }
      const cleared = await options.storage.clearPending(output.path);
      if (!cleared.ok) { outcomes.push({ path: output.path, status: "record-failed", message: `Output written, but ownership remains untrusted: ${cleared.error.message}` }); continue; }
      outcomes.push({ path: output.path, status: "written", message: "Output and ownership recorded." });
    }
    return outcomes.every((outcome) => outcome.status === "written" || outcome.status === "unchanged" || outcome.status === "shared")
      ? { ok: true, outcomes }
      : { ok: false, message: "Some outputs were not fully recorded; see individual outcomes.", outcomes };
  }
  return { location: options.storage.location, check, write };
}
