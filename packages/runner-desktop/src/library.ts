/**
 * The desktop player's library registry (entry 9.10; `docs/spec/engine/launcher.md#storage-and-registry`).
 *
 * `library.schema = 1` exactly as that page defines it, written to `library.json` in the application-data directory
 * beside the saves and outside the AD-17 blob store. Installing means registering a package; opening one means
 * verifying it first, because a registry that cannot refuse a swapped file is a launcher for arbitrary bytes.
 *
 * Node's `fs` and `crypto` live here and nowhere near `core` (G2): the app hands `core` bytes through the existing asset
 * source and the registry stays a host concern.
 */

import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

import type { LibraryRow } from "./launch.ts";

export const LIBRARY_SCHEMA = 1;

export type LibraryEntry = {
  readonly gameId: string;
  readonly title: string;
  readonly version: string;
  readonly sha256: string;
  readonly size: number;
  /** An absolute path on the desktop. */
  readonly packageLocation: string;
  /** ISO 8601. */
  readonly installedAt: string;
  readonly lastPlayedAt: string | null;
  readonly customSettings?: { readonly volumeMaster?: number; readonly soundFont?: string };
};

export type LibraryRegistry = {
  readonly schema: typeof LIBRARY_SCHEMA;
  readonly defaultGameId: string | null;
  readonly entries: readonly LibraryEntry[];
};

/** The install descriptor an export writes as `<package>.tpk.json`. */
export type InstallDescriptor = {
  readonly schema?: number;
  readonly file?: string;
  readonly sha256?: string;
  readonly size?: number;
  readonly gameId?: string;
  readonly title?: string;
  readonly version?: string;
};

export function emptyLibrary(): LibraryRegistry {
  return { schema: LIBRARY_SCHEMA, defaultGameId: null, entries: [] };
}

const SHA256 = /^[0-9a-f]{64}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function entryProblem(value: unknown, index: number): string | null {
  if (typeof value !== "object" || value === null) return `entries[${index}] is not an object`;
  const entry = value as Record<string, unknown>;
  for (const field of ["gameId", "title", "version", "packageLocation"] as const) {
    if (typeof entry[field] !== "string" || (entry[field] as string).length === 0) {
      return `entries[${index}].${field} must be a non-empty string`;
    }
  }
  if (typeof entry["sha256"] !== "string" || !SHA256.test(entry["sha256"])) {
    return `entries[${index}].sha256 must be 64 lowercase hex characters`;
  }
  if (typeof entry["size"] !== "number" || !Number.isInteger(entry["size"]) || entry["size"] < 0) {
    return `entries[${index}].size must be a non-negative integer`;
  }
  if (!isIsoDate(entry["installedAt"])) return `entries[${index}].installedAt must be an ISO 8601 date`;
  if (entry["lastPlayedAt"] !== null && !isIsoDate(entry["lastPlayedAt"])) {
    return `entries[${index}].lastPlayedAt must be null or an ISO 8601 date`;
  }
  const settings = entry["customSettings"];
  if (settings !== undefined) {
    if (typeof settings !== "object" || settings === null) return `entries[${index}].customSettings must be an object`;
    const record = settings as Record<string, unknown>;
    if (record["volumeMaster"] !== undefined && typeof record["volumeMaster"] !== "number") {
      return `entries[${index}].customSettings.volumeMaster must be a number`;
    }
    if (record["soundFont"] !== undefined && typeof record["soundFont"] !== "string") {
      return `entries[${index}].customSettings.soundFont must be a string`;
    }
  }
  return null;
}

/** Read a registry value. A malformed document is a refusal with a diagnostic, never a half-loaded registry. */
export function parseLibrary(value: unknown): { readonly ok: true; readonly registry: LibraryRegistry } | { readonly ok: false; readonly error: string } {
  if (typeof value !== "object" || value === null) return { ok: false, error: "the registry is not an object" };
  const record = value as Record<string, unknown>;
  if (record["schema"] !== LIBRARY_SCHEMA) {
    return { ok: false, error: `library.schema must be ${LIBRARY_SCHEMA}, found ${JSON.stringify(record["schema"])}` };
  }
  const defaultGameId = record["defaultGameId"];
  if (defaultGameId !== null && typeof defaultGameId !== "string") {
    return { ok: false, error: "defaultGameId must be a string or null" };
  }
  const entries = record["entries"];
  if (!Array.isArray(entries)) return { ok: false, error: "entries must be an array" };
  for (let index = 0; index < entries.length; index += 1) {
    const problem = entryProblem(entries[index], index);
    if (problem !== null) return { ok: false, error: problem };
  }
  return { ok: true, registry: { schema: LIBRARY_SCHEMA, defaultGameId, entries: entries as readonly LibraryEntry[] } };
}

/** The rows the fallback view lists, without hashes or settings. */
export function libraryRows(registry: LibraryRegistry): readonly LibraryRow[] {
  return registry.entries.map((entry) => ({
    gameId: entry.gameId,
    title: entry.title,
    version: entry.version,
    lastPlayedAt: entry.lastPlayedAt,
  }));
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A registry entry's identity against a package's bytes. Both fields are checked: size catches a swap cheaply, the hash proves it. */
export function verifyEntry(entry: LibraryEntry, bytes: Uint8Array): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (bytes.length !== entry.size) {
    return { ok: false, reason: `package size ${bytes.length} does not match the registry's ${entry.size} for ${entry.gameId}` };
  }
  const actual = sha256Of(bytes);
  if (actual !== entry.sha256) {
    return { ok: false, reason: `package sha256 ${actual} does not match the registry's ${entry.sha256} for ${entry.gameId}` };
  }
  return { ok: true };
}

/**
 * Register a package: the bytes are hashed here, and the descriptor's own `sha256`/`size` (when it carries them) must
 * agree, because a descriptor that disagrees with its package is a broken export rather than a different install.
 */
export function registerPackage(options: {
  readonly registry: LibraryRegistry;
  readonly bytes: Uint8Array;
  readonly descriptor: InstallDescriptor | null;
  readonly packageLocation: string;
  readonly gameId: string;
  readonly title: string;
  readonly version: string;
  readonly now: string;
}): { readonly ok: true; readonly registry: LibraryRegistry } | { readonly ok: false; readonly error: string } {
  const { descriptor, bytes } = options;
  const sha256 = sha256Of(bytes);
  if (descriptor?.sha256 !== undefined && descriptor.sha256 !== sha256) {
    return { ok: false, error: `the descriptor's sha256 ${descriptor.sha256} does not match the package's ${sha256}` };
  }
  if (descriptor?.size !== undefined && descriptor.size !== bytes.length) {
    return { ok: false, error: `the descriptor's size ${descriptor.size} does not match the package's ${bytes.length}` };
  }
  if (options.gameId.length === 0) return { ok: false, error: "a library entry needs a gameId" };
  const entry: LibraryEntry = {
    gameId: options.gameId,
    title: options.title,
    version: options.version,
    sha256,
    size: bytes.length,
    packageLocation: options.packageLocation,
    installedAt: options.now,
    lastPlayedAt: null,
  };
  const previous = options.registry.entries.find((candidate) => candidate.gameId === entry.gameId);
  // `exactOptionalPropertyTypes`: a re-register keeps the earlier install date and settings, and omits the settings key
  // entirely when the earlier entry had none rather than writing `undefined` into it.
  const kept: LibraryEntry = previous === undefined
    ? entry
    : {
        ...entry,
        installedAt: previous.installedAt,
        ...(previous.customSettings === undefined ? {} : { customSettings: previous.customSettings }),
      };
  const entries = [kept, ...options.registry.entries.filter((candidate) => candidate.gameId !== entry.gameId)];
  return { ok: true, registry: { ...options.registry, entries } };
}

/** Read `library.json`: `null` when the file is absent, an exception when it exists and cannot be trusted. */
export function readLibraryFile(path: string): LibraryRegistry | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parsed = parseLibrary(JSON.parse(text) as unknown);
  if (!parsed.ok) throw new Error(`${path}: ${parsed.error}`);
  return parsed.registry;
}

/**
 * Write the registry atomically: a full write to a sibling then a rename, so a player killed mid-write leaves the
 * previous registry rather than half of a new one.
 */
export function writeLibraryFile(path: string, registry: LibraryRegistry): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(temporary, path);
}
