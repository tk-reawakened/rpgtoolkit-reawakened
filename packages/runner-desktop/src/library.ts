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
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { deriveGameId, derivePackageIdentity, loadPackage, readDistributionManifest, readZip, utf8Decode, utf8Encode } from "@tk-reawakened/core";
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


/** Validate the setup entirely in memory; only the verified game package is copied into the store. */
export function installSetupBytes(options: {
  readonly bytes: Uint8Array;
  readonly userData: string;
  readonly now: string;
}): { readonly ok: true; readonly registry: LibraryRegistry; readonly gameId: string } | { readonly ok: false; readonly error: string } {
  const setup = readZip(options.bytes, "setup ZIP");
  if (!setup.ok) return { ok: false, error: `Setup ZIP was refused: ${setup.error.message}` };
  if (setup.value.length !== 3) return { ok: false, error: "Setup ZIP must contain exactly a package, its descriptor, and README.txt." };
  const instructions = setup.value.find((file) => file.path === "README.txt");
  const descriptors = setup.value.filter((file) => file.path.endsWith(".tpk.json"));
  const packages = setup.value.filter((file) => file.path.endsWith(".tpk"));
  if (instructions === undefined || descriptors.length !== 1 || packages.length !== 1
    || packages[0]!.path.includes("/") || packages[0]!.path.includes("\\")
    || descriptors[0]!.path !== `${packages[0]!.path}.json`) {
    return { ok: false, error: "Setup ZIP must contain exactly one root-level .tpk, its matching root-level descriptor, and README.txt." };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(utf8Decode(descriptors[0]!.bytes)) as unknown; }
  catch { return { ok: false, error: "The setup install descriptor is not valid UTF-8 JSON." }; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "The setup install descriptor must be a JSON object." };
  }
  const descriptor = parsed as Record<string, unknown>;
  const fields = ["schema", "file", "sha256", "size", "gameId", "title", "version"];
  const packageName = packages[0]!.path;
  if (Object.keys(descriptor).length !== fields.length || !fields.every((field) => Object.hasOwn(descriptor, field))
    || descriptor["schema"] !== 1 || descriptor["file"] !== packageName
    || typeof descriptor["sha256"] !== "string" || !SHA256.test(descriptor["sha256"])
    || typeof descriptor["size"] !== "number" || !Number.isSafeInteger(descriptor["size"]) || descriptor["size"] < 0
    || typeof descriptor["gameId"] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(descriptor["gameId"])
    || typeof descriptor["title"] !== "string" || descriptor["title"].trim().length === 0
    || typeof descriptor["version"] !== "string" || descriptor["version"].length === 0) {
    return { ok: false, error: "The setup install descriptor must have seven valid fields and name its package." };
  }
  const packageBytes = packages[0]!.bytes;
  const loaded = loadPackage({ kind: "tpk", name: packageName, bytes: packageBytes });
  if (!loaded.ok) return { ok: false, error: `The game package was refused: ${loaded.error.message}` };
  const manifest = readDistributionManifest(loaded.value);
  if (!manifest.ok) return { ok: false, error: `The game package has no valid distribution manifest: ${manifest.error.message}` };
  const main = loaded.value.files.find((file) => file.path === manifest.value.main);
  if (main === undefined) return { ok: false, error: "The game package manifest names a missing main file." };
  const packageFiles = loaded.value.files.filter((file) => file.path !== "manifest.json");
  const packageGameId = deriveGameId(main.bytes, derivePackageIdentity(packageFiles));
  if (descriptor["gameId"] !== packageGameId) {
    return { ok: false, error: "The install descriptor's gameId does not match the package's content identity." };
  }
  const digest = sha256Of(packageBytes);
  if (descriptor["sha256"] !== digest || descriptor["size"] !== packageBytes.length) {
    return { ok: false, error: "The install descriptor's SHA-256 or size does not match the game package." };
  }
  const userData = resolve(options.userData);
  const games = join(userData, "games");
  const gameId = descriptor["gameId"];
  const installedPackageName = `${gameId}.tpk`;
  const packageLocation = join(games, installedPackageName);
  const descriptorLocation = `${packageLocation}.json`;
  const installedDescriptorBytes = utf8Encode(JSON.stringify({ ...descriptor, file: installedPackageName }));
  const registryPath = join(userData, "library.json");
  let registry: LibraryRegistry;
  try { registry = readLibraryFile(registryPath) ?? emptyLibrary(); }
  catch (error) { return { ok: false, error: `The existing game library is invalid: ${error instanceof Error ? error.message : String(error)}` }; }
  const prior = registry.entries.find((entry) => entry.gameId === gameId);
  if (prior !== undefined && (prior.sha256 !== digest || resolve(prior.packageLocation) !== packageLocation)) {
    return { ok: false, error: `Game ${gameId} is already installed with different package bytes; existing data was not overwritten.` };
  }
  let packageStagingCreated = false;
  let descriptorStagingCreated = false;
  let packageCreated = false;
  let descriptorCreated = false;
  const packageStaging = `${packageLocation}.tmp`;
  const descriptorStaging = `${descriptorLocation}.tmp`;
  const cleanupCreatedFiles = (): void => {
    for (const [path, created] of [
      [packageStaging, packageStagingCreated],
      [descriptorStaging, descriptorStagingCreated],
      [packageLocation, packageCreated],
      [descriptorLocation, descriptorCreated],
    ] as const) {
      if (!created) continue;
      try {
        if (existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()) unlinkSync(path);
      } catch { /* Best-effort cleanup must not replace the install refusal. */ }
    }
  };
  try {
    if (existsSync(games) && lstatSync(games).isSymbolicLink()) return { ok: false, error: "Refusing to install through a symbolic link in the player's library store." };
    mkdirSync(games, { recursive: true });
    if (lstatSync(games).isSymbolicLink()) return { ok: false, error: "Refusing to install through a symbolic link in the player's library store." };
    if (prior !== undefined) {
      if (!existsSync(packageLocation) || !lstatSync(packageLocation).isFile() || lstatSync(packageLocation).isSymbolicLink()) {
        return { ok: false, error: "The registered package copy is missing or is not a regular file; nothing was changed." };
      }
      if (!existsSync(descriptorLocation) || !lstatSync(descriptorLocation).isFile() || lstatSync(descriptorLocation).isSymbolicLink()) {
        return { ok: false, error: "The registered install descriptor is missing or is not a regular file; nothing was changed." };
      }
      const existing = new Uint8Array(readFileSync(packageLocation));
      const existingDescriptor = new Uint8Array(readFileSync(descriptorLocation));
      if (existing.length !== prior.size || sha256Of(existing) !== prior.sha256
        || existingDescriptor.length !== installedDescriptorBytes.length
        || sha256Of(existingDescriptor) !== sha256Of(installedDescriptorBytes)) {
        return { ok: false, error: "The registered package or descriptor copy no longer matches its library record; nothing was overwritten." };
      }
    } else {
      if (existsSync(packageLocation) || existsSync(descriptorLocation)) {
        return { ok: false, error: "A package or descriptor file already exists at the library destination; it was not overwritten." };
      }
      writeFileSync(packageStaging, packageBytes, { flag: "wx" });
      packageStagingCreated = true;
      writeFileSync(descriptorStaging, installedDescriptorBytes, { flag: "wx" });
      descriptorStagingCreated = true;
      renameSync(packageStaging, packageLocation);
      packageStagingCreated = false;
      packageCreated = true;
      renameSync(descriptorStaging, descriptorLocation);
      descriptorStagingCreated = false;
      descriptorCreated = true;
    }
    const registered = registerPackage({
      registry, bytes: packageBytes, descriptor: descriptor as InstallDescriptor, packageLocation,
      gameId, title: descriptor["title"], version: descriptor["version"], now: options.now,
    });
    if (!registered.ok) {
      cleanupCreatedFiles();
      return registered;
    }
    writeLibraryFile(registryPath, registered.registry);
    return { ok: true, registry: registered.registry, gameId };
  } catch (error) {
    cleanupCreatedFiles();
    return { ok: false, error: `Could not install the game into the library: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Remove only the registered package copy inside the player's library store. Save blobs are always preserved. */
export function removeInstalledGame(options: {
  readonly userData: string;
  readonly gameId: string;
}): { readonly ok: true; readonly registry: LibraryRegistry } | { readonly ok: false; readonly error: string } {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.gameId)) return { ok: false, error: "The game id is invalid." };
  const userData = resolve(options.userData);
  const registryPath = join(userData, "library.json");
  let registry: LibraryRegistry;
  try { registry = readLibraryFile(registryPath) ?? emptyLibrary(); }
  catch (error) { return { ok: false, error: `The existing game library is invalid: ${error instanceof Error ? error.message : String(error)}` }; }
  const entry = registry.entries.find((candidate) => candidate.gameId === options.gameId);
  if (entry === undefined) return { ok: true, registry };
  const games = join(userData, "games");
  const packageLocation = join(games, `${options.gameId}.tpk`);
  const descriptorLocation = `${packageLocation}.json`;
  if (resolve(entry.packageLocation) !== packageLocation || !packageLocation.startsWith(`${games}${sep}`)) {
    return { ok: false, error: "Refusing to remove a package outside the player's library store." };
  }
  try {
    if (existsSync(games) && lstatSync(games).isSymbolicLink()) {
      return { ok: false, error: "Refusing to remove a package through a symbolic link in the player's library store." };
    }
    for (const path of [packageLocation, descriptorLocation]) {
      if (!existsSync(path)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return { ok: false, error: "Refusing to remove an installed package artifact that is a symbolic link." };
      if (!stat.isFile()) return { ok: false, error: "Refusing to remove an installed package artifact that is not a regular file." };
    }
    for (const path of [packageLocation, descriptorLocation]) {
      if (existsSync(path)) unlinkSync(path);
    }
    const next = { ...registry, entries: registry.entries.filter((candidate) => candidate.gameId !== options.gameId) };
    writeLibraryFile(registryPath, next);
    return { ok: true, registry: next };
  } catch (error) {
    return { ok: false, error: `Could not remove the game from the library: ${error instanceof Error ? error.message : String(error)}` };
  }
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
