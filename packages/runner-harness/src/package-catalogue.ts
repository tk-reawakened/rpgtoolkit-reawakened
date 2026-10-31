// The host side of the package catalogue (ticket 19.20; docs/spec/engine/rpgcode-package-loader.md).
//
// Core consumes a `PackageCatalogueEntry[]` but reads nothing itself (G2), so a host has to build
// that list before boot. A package folder is a `manifest.json` plus its start-up program, and this
// module turns such a folder's text into the entry core expects: the identity the manifest declares,
// a definition shell (a package's commands come from its RPGCode start-up, not from native code) and
// one start-up `ProgramRef`. Reading a folder from disk is the caller's job, which keeps this module
// free of I/O and usable from a runner, an editor, or a test alike.

import { HOST_REQUEST_KINDS, IR_VERSION, PACKAGE_IDENTIFIER, type HostRequestKind, type PackageCatalogueEntry } from "@tk-reawakened/core";

/** What a package folder's `manifest.json` must declare (docs/spec/engine/rpgcode-package-loader.md). */
export type PackageManifest = {
  readonly name: string;
  readonly version: string;
  readonly namespace?: string;
  readonly requests: readonly HostRequestKind[];
  /** The start-up program's path, relative to the package folder. */
  readonly program: string;
};

export type PackageManifestResult =
  | { readonly ok: true; readonly manifest: PackageManifest }
  | { readonly ok: false; readonly message: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse one package folder's manifest text. The name grammar is the package-identity rule: a
 * hyphenated or capitalised name is refused here, before boot, with the manifest named.
 */
export function parsePackageManifest(text: string, label = "manifest.json"): PackageManifestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: `${label}: not valid JSON` };
  }
  if (!record(parsed)) return { ok: false, message: `${label}: the manifest must be a JSON object` };
  const name = parsed["name"];
  if (typeof name !== "string" || !PACKAGE_IDENTIFIER.test(name)) {
    return { ok: false, message: `${label}: "name" must match the package identifier ${PACKAGE_IDENTIFIER.source}` };
  }
  const version = parsed["version"];
  if (typeof version !== "string" || version === "") {
    return { ok: false, message: `${label}: "version" must be a non-empty string` };
  }
  const namespace = parsed["namespace"];
  if (namespace !== undefined && (typeof namespace !== "string" || !PACKAGE_IDENTIFIER.test(namespace))) {
    return { ok: false, message: `${label}: "namespace" must match ${PACKAGE_IDENTIFIER.source} when present` };
  }
  const requests = parsed["requests"];
  if (!Array.isArray(requests)) {
    return { ok: false, message: `${label}: "requests" must be an array of ${HOST_REQUEST_KINDS.join(", ")}` };
  }
  const kinds: HostRequestKind[] = [];
  for (const request of requests as unknown[]) {
    if (typeof request !== "string" || !(HOST_REQUEST_KINDS as readonly string[]).includes(request)) {
      return { ok: false, message: `${label}: unknown host-request kind ${JSON.stringify(request)} (expected ${HOST_REQUEST_KINDS.join(", ")})` };
    }
    if (kinds.includes(request as HostRequestKind)) {
      return { ok: false, message: `${label}: host-request kind "${request}" is declared twice` };
    }
    kinds.push(request as HostRequestKind);
  }
  const program = parsed["program"];
  if (typeof program !== "string" || program === "" || program.startsWith("/") || program.startsWith("\\") ||
      /^[A-Za-z]:/.test(program) || program.split(/[\\/]/).includes("..")) {
    return { ok: false, message: `${label}: "program" must be a package-relative path that stays in the folder` };
  }
  return {
    ok: true,
    manifest: {
      name,
      version,
      ...(namespace === undefined ? {} : { namespace }),
      requests: kinds,
      program,
    },
  };
}

/**
 * One catalogue entry from a parsed manifest and its start-up source. The definition is a shell with
 * no native commands: a package's commands are what its RPGCode start-up registers, and the catalogue
 * only has to name the package, its identity and where its code starts.
 */
export function catalogueEntry(manifest: PackageManifest, programSource: string): PackageCatalogueEntry {
  return {
    name: manifest.name,
    version: manifest.version,
    ...(manifest.namespace === undefined ? {} : { namespace: manifest.namespace }),
    requests: [...manifest.requests],
    definition: { id: manifest.name, version: manifest.version, commands: [] },
    startup: { kind: "inline", text: programSource, ir: IR_VERSION, dialect: "tk3" },
  };
}

/** A package as a host has already read it: its manifest text and its start-up source. */
export type PackageFolder = {
  readonly label: string;
  readonly manifestText: string;
  readonly programSource: string;
};

export type PackageCatalogueResult =
  | { readonly ok: true; readonly entries: readonly PackageCatalogueEntry[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Build the whole catalogue from folders the host read. Every manifest is validated first, so a bad
 * folder is reported by name rather than booting a half-catalogue; duplicate package names are a
 * problem too, because the `.gam` list must select exactly one package per name.
 */
export function buildPackageCatalogue(folders: readonly PackageFolder[]): PackageCatalogueResult {
  const problems: string[] = [];
  const entries: PackageCatalogueEntry[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    const parsed = parsePackageManifest(folder.manifestText, folder.label);
    if (!parsed.ok) {
      problems.push(parsed.message);
      continue;
    }
    if (seen.has(parsed.manifest.name)) {
      problems.push(`${folder.label}: package "${parsed.manifest.name}" appears twice`);
      continue;
    }
    seen.add(parsed.manifest.name);
    entries.push(catalogueEntry(parsed.manifest, folder.programSource));
  }
  return problems.length === 0 ? { ok: true, entries } : { ok: false, problems };
}
