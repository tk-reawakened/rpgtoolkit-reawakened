/**
 * The manifest of the project's own distribution package (docs/spec/formats/packaging-and-paths.md,
 * AD-6, AD-23, AD-5).
 *
 * A distribution package is a `.tpk`-compatible ZIP holding the game files plus
 * `manifest.json` `{ schema, main, index }` at the archive root. This module
 * owns that descriptor's shape and its path rules — `schema` is the
 * project-level integer version (AD-23), `main` the in-package path of the main
 * file (never `manifest.json` itself) and `index` the relative paths of every
 * game file except the manifest, each once — and both the writer (`write.ts`)
 * and the reader (`readDistributionManifest`) validate through the same
 * functions, so the two cannot drift.
 *
 * The reader decodes the manifest's bytes as UTF-8 the way `zip.ts` decodes an
 * entry name, through `fflate/browser`'s `strFromU8`, and never throws: a
 * missing file, malformed JSON, a wrong shape or a path rule that does not hold
 * is a located `FormatError` naming the docs/spec/formats/packaging-and-paths.md rule it hit (AD-18).
 */

import { strFromU8 } from "fflate/browser";
import { foldPath, toSlashes } from "../main-file/layout.ts";
import { err, ok, type FormatError, type Result } from "../result.ts";
import { checkEntryPath } from "./path-rules.ts";
import type { LoadedPackage } from "./model.ts";

/** The format specification section every failure here cites. */
const SECTION = "docs/spec/formats/packaging-and-paths.md";

/** The manifest's name at the archive root (AD-6). */
export const MANIFEST_FILE_NAME = "manifest.json";

/**
 * The manifest's own keys, in docs/spec/formats/packaging-and-paths.md's order (a `Record`'s string keys keep their
 * insertion order). A distribution manifest holds exactly these: no key may be
 * missing and none may be extra.
 */
const MANIFEST_KEYS: Readonly<Record<string, true>> = { schema: true, main: true, index: true };

/** The manifest's own key names, in docs/spec/formats/packaging-and-paths.md's order. */
const MANIFEST_KEY_ORDER: readonly string[] = Object.keys(MANIFEST_KEYS);

/**
 * The manifest of the project's distribution package (AD-6, AD-23, AD-5).
 *
 * `schema` is the project-level integer version; `main` is the in-package path
 * of the main file; `index` lists the relative paths of the game files the
 * resolver keys on.
 */
export interface DistributionManifest {
  /** The project-level integer schema version (AD-23). */
  readonly schema: number;
  /** The in-package path of the main file, e.g. `Main/demo.gam`(docs/spec/formats/README.md#paths-inside-files, docs/spec/formats/packaging-and-paths.md. */
  readonly main: string;
  /** The game files' relative paths, each once; the resolver's index (AD-5). */
  readonly index: readonly string[];
}

/** A located failure citing docs/spec/formats/packaging-and-paths.md (AD-18). */
function failure(offset: number, message: string): FormatError {
  return { offset, section: SECTION, message };
}

/**
 * Check a path that names a *file*: it must be a plain relative path, not empty,
 * not ending with a separator, and holding no empty or `.` segment. The shared
 * `checkEntryPath` then applies the docs/spec/formats/README.md#paths-inside-files escape, length, depth and basename
 * rules; this refuses the shapes that would make the reader treat the entry as a
 * directory or an odd path.
 */
export function checkFilePath(path: string): string | null {
  const normalised = toSlashes(path);
  const segments = normalised.split("/");
  if (normalised.length === 0 || segments.some((segment) => segment === "" || segment === ".")) {
    return `Path "${path}" is not a plain relative file path; a file path must not be empty, end with a separator, or hold an empty or "." segment (path shape)`;
  }
  return null;
}

/**
 * Check the manifest's shape and its own path rules, returning the failure
 * message naming the rule or `null`. A missing or malformed manifest is refused
 * rather than written (AD-18).
 */
export function checkManifest(manifest: DistributionManifest): string | null {
  const schema = manifest.schema;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 0) {
    return `The manifest's schema is ${String(schema)}; it must be a non-negative integer project schema version (project schema, AD-23)`;
  }
  const main = manifest.main;
  if (typeof main !== "string" || main.length === 0) {
    return `The manifest's main is ${String(main)}; it must name the main file inside the package (manifest main, AD-6)`;
  }
  const pathProblem = checkEntryPath(main);
  if (pathProblem !== null) return `${pathProblem} (manifest main)`;
  const shapeProblem = checkFilePath(main);
  if (shapeProblem !== null) return `${shapeProblem} (manifest main)`;
  if (foldPath(main) === foldPath(MANIFEST_FILE_NAME)) {
    return `The manifest's main must not be "${MANIFEST_FILE_NAME}"; it names the main game file (manifest main, AD-6)`;
  }
  if (!Array.isArray(manifest.index)) {
    return `The manifest's index is missing; it must list the game files' relative paths (asset index, AD-5)`;
  }
  return null;
}

/**
 * Check the manifest's `index`: an array of plain relative file paths, each once,
 * whose folded set equals the asset tree's. Every file must be indexed and no
 * index entry may name a file the tree does not hold, so `index` is the
 * resolver's lookup over the package (AD-5).
 */
export function checkIndex(index: readonly string[], tree: ReadonlyMap<string, string>): string | null {
  const listed = new Map<string, string>();
  for (const value of index) {
    if (typeof value !== "string" || value.length === 0) {
      return `The manifest's index holds ${String(value)}; every entry must be a relative file path (asset index, AD-5)`;
    }
    const pathProblem = checkEntryPath(value);
    if (pathProblem !== null) return `${pathProblem} (asset index)`;
    const shapeProblem = checkFilePath(value);
    if (shapeProblem !== null) return `${shapeProblem} (asset index)`;
    const folded = foldPath(value);
    const first = listed.get(folded);
    if (first !== undefined) {
      return `The manifest's index lists "${first}" and "${value}"; the same path after case and separator folding (asset index, L10)`;
    }
    listed.set(folded, value);
    if (!tree.has(folded)) {
      return `The manifest's index lists "${value}", which is not in the asset tree (asset index, AD-5)`;
    }
  }
  if (listed.size !== tree.size) {
    return `The manifest's index lists ${listed.size} files but the asset tree holds ${tree.size}; every file must be indexed (asset index, AD-5)`;
  }
  return null;
}

/**
 * Check that a decoded, untrusted value is a plain object holding exactly the
 * manifest's three keys, returning the failure message naming the key or `null`.
 *
 * A missing key or an extra one is refused, so the reader consumes only the
 * documented fields. An own `__proto__` key is just an extra key: the value is
 * only ever read, never spread or assigned, so it cannot change any prototype.
 */
function checkManifestKeys(value: object): string | null {
  const has = Object.prototype.hasOwnProperty;
  for (const key of Object.keys(value)) {
    if (!has.call(MANIFEST_KEYS, key)) {
      return `The manifest holds the extra key "${key}"; a distribution manifest has exactly schema, main and index (manifest shape, AD-6)`;
    }
  }
  for (const key of MANIFEST_KEY_ORDER) {
    if (!has.call(value, key)) {
      return `The manifest is missing "${key}"; a distribution manifest has exactly schema, main and index (manifest shape, AD-6)`;
    }
  }
  return null;
}

/** Describe a decoded, non-object value by kind, for the shape failure. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/**
 * Read the manifest of a loaded distribution package (docs/spec/formats/packaging-and-paths.md, AD-6).
 *
 * `manifest.json` is looked up at the archive root among `pkg.files`, matched
 * case- and separator-insensitively (`foldPath`, docs/spec/formats/README.md#paths-inside-files; its bytes are decoded as
 * UTF-8 and parsed inside a try/catch, so malformed JSON is a failure rather
 * than a throw (AD-18). The decoded value must be a plain object holding
 * exactly `schema`, `main` and `index`, and those fields are checked with the
 * same rules the writer applies; then `main` and every `index` entry must name a
 * file in the package, and every file but the manifest must be indexed.
 *
 * The returned manifest is built fresh from the validated fields alone, so
 * nothing untrusted reaches the caller. Never throws (AD-18).
 */
export function readDistributionManifest(pkg: LoadedPackage): Result<DistributionManifest> {
  const wanted = foldPath(MANIFEST_FILE_NAME);
  const entry = pkg.files.find((file) => foldPath(file.path) === wanted);
  return readDistributionManifestFrom(
    pkg.name,
    entry?.bytes,
    pkg.files.map((file) => file.path),
  );
}

/**
 * `readDistributionManifest` for a host that does not hold every file: the manifest's bytes (`undefined` when the
 * package has none) and the path of every file in the package, in any order. It applies exactly the checks
 * `readDistributionManifest` applies — that function is this one over a loaded package — so a streaming host and an
 * in-memory host accept and refuse the same manifests with the same messages. `paths` includes the manifest's own.
 */
export function readDistributionManifestFrom(
  name: string,
  manifestBytes: Uint8Array | undefined,
  paths: readonly string[],
): Result<DistributionManifest> {
  const wanted = foldPath(MANIFEST_FILE_NAME);
  if (manifestBytes === undefined) {
    return err(
      failure(
        0,
        `Package "${name}" has no ${MANIFEST_FILE_NAME} at its root; a distribution package requires ${MANIFEST_FILE_NAME} { schema, main, index } (manifest, AD-6).`,
      ),
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return err(
      failure(
        0,
        `The ${MANIFEST_FILE_NAME} in package "${name}" is not valid UTF-8 JSON (manifest JSON, AD-6).`,
      ),
    );
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return err(
      failure(
        0,
        `The ${MANIFEST_FILE_NAME} in package "${name}" is ${describeValue(decoded)}, not a JSON object { schema, main, index } (manifest shape, AD-6).`,
      ),
    );
  }

  const keysProblem = checkManifestKeys(decoded);
  if (keysProblem !== null) return err(failure(0, `${keysProblem}.`));

  const manifest = decoded as DistributionManifest;
  const manifestProblem = checkManifest(manifest);
  if (manifestProblem !== null) return err(failure(0, `${manifestProblem}.`));

  // The asset tree is every file but the manifest itself, keyed as the resolver
  // keys it (AD-5), so the index rules check the same set the writer checked.
  const tree = new Map<string, string>();
  for (const path of paths) {
    const folded = foldPath(path);
    if (folded === wanted) continue;
    tree.set(folded, path);
  }
  if (!tree.has(foldPath(manifest.main))) {
    return err(
      failure(
        0,
        `The manifest's main file "${manifest.main}" is not in the package (manifest main, AD-6).`,
      ),
    );
  }
  const indexProblem = checkIndex(manifest.index, tree);
  if (indexProblem !== null) return err(failure(0, `${indexProblem}.`));

  return ok({ schema: manifest.schema, main: manifest.main, index: [...manifest.index] });
}
