import { assetKey, createAssetIndex, decodeCp1252, FIRST_PARTY_PLUGINS, PACKAGE_ROOT, type PluginDefinition } from "@tk-reawakened/core";
import { mergeCoverage, type SpecCoverage } from "./coverage.ts";
import { discoverCasesWithLibrary, hasOnlyCasesWithLibrary, runSpecFileWithLibrary, type SpecFileReport, type SpecProgramLoader, type SpecRunOptions } from "./runner-core.ts";

/** One immutable file from a host's project snapshot. Paths use project-relative `/` separators. */
export interface SpecProjectFile {
  readonly path: string;
  readonly bytes: Uint8Array;
  /** Host revision identity for these exact bytes, such as a SHA-256 snapshot digest. */
  readonly revision?: string;
}

export type SpecProjectReport = {
  readonly files: readonly SpecFileReport[];
  readonly failures: readonly string[];
  readonly skipped: readonly string[];
  readonly warnings: readonly string[];
  /** The exact supplied snapshot in path order; absent host revisions are explicitly `null`. */
  readonly sources: readonly { readonly path: string; readonly revision: string | null }[];
  readonly coverage?: SpecCoverage;
};

export type SpecProjectOptions = Pick<SpecRunOptions, "seed" | "strict" | "name" | "coverage" | "project" | "onFrame">;

const compareNames = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const projectPath = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

/** Omit dependencies, repository databases and reserved in-project editor data consistently across hosts. */
export function isIgnoredProjectPath(path: string): boolean {
  return projectPath(path).split("/").some((part) => {
    const folded = assetKey(part);
    return folded === assetKey("node_modules") || folded === assetKey(".git") || folded === assetKey(".tkr-history");
  });
}

function loaderFor(files: readonly SpecProjectFile[]): SpecProgramLoader {
  const normalized = [...files].map((file) => ({ ...file, path: projectPath(file.path) })).sort((left, right) => compareNames(left.path, right.path));
  const programs = normalized.filter((file) => {
    const parts = file.path.split("/");
    return assetKey(parts[0] ?? "") === assetKey("Prg") && assetKey(parts.at(-1) ?? "").endsWith(".prg");
  });
  const entries: { path: string; file: SpecProjectFile }[] = programs.map((file) => ({
    path: `Prg/${file.path.split("/").slice(1).join("/")}`,
    file,
  }));
  let nativePlugin: PluginDefinition | undefined;
  const manifest = normalized.find((file) => assetKey(file.path) === assetKey("manifest.json"));
  if (manifest !== undefined) {
    const value: unknown = JSON.parse(new TextDecoder().decode(manifest.bytes));
    if (typeof value === "object" && value !== null && "program" in value && typeof value.program === "string" && /^[\w.-]+\.prg$/i.test(value.program)) {
      const programPath = value.program;
      if ("name" in value && typeof value.name === "string") nativePlugin = FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === value.name);
      const startup = normalized.find((file) => assetKey(file.path) === assetKey(programPath));
      if (startup === undefined) throw new Error(`package program "${programPath}" is missing from the project snapshot`);
      entries.unshift({ path: `Prg/${programPath}`, file: startup });
    }
  }
  const index = createAssetIndex(entries.map((entry) => entry.path));
  const contents = new Map<string, Uint8Array>();
  const sourcePaths = new Map<string, string>();
  for (const entry of entries) {
    const key = assetKey(entry.path);
    if (!contents.has(key)) {
      contents.set(key, entry.file.bytes);
      sourcePaths.set(key, entry.file.path);
    }
  }
  return {
    index,
    root: PACKAGE_ROOT,
    read: (key) => contents.get(key),
    sourcePath: (key) => sourcePaths.get(key),
    fixtureFiles: normalized.map(({ path, bytes, revision }) => ({ path, bytes, ...(revision === undefined ? {} : { revision }) })),
    ...(nativePlugin === undefined ? {} : { nativePlugin }),
  };
}

/** Run every spec against the frozen project files supplied by any host; this module performs no filesystem I/O. */
export function runSpecProjectFiles(files: readonly SpecProjectFile[], librarySource: string, options: SpecProjectOptions = {}): SpecProjectReport {
  const ordered = [...files].filter((file) => !isIgnoredProjectPath(file.path)).map((file) => ({ ...file, path: projectPath(file.path) })).sort((left, right) => compareNames(left.path, right.path));
  const loader = loaderFor(ordered);
  const specs = ordered.filter((file) => assetKey(file.path).endsWith(".spec.prg")).map((file) => {
    const bytes = file.bytes;
    return { projectPath: file.path, source: decodeCp1252(bytes, 0, bytes.length), revision: file.revision ?? null };
  });
  const selected = specs.map((spec) => {
    try {
      return { ...spec, hasOnly: hasOnlyCasesWithLibrary(spec.source, librarySource, options.seed ?? 0, loader), error: null };
    } catch (error) {
      return { ...spec, hasOnly: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const hasAnyOnly = selected.some((spec) => spec.hasOnly);
  const reports: SpecFileReport[] = [];
  const failures: string[] = [];
  for (const spec of selected) {
    if (spec.error !== null) {
      reports.push({ file: spec.projectPath, cases: [], skipped: [], warning: null, failures: [spec.error] });
      failures.push(`${spec.projectPath}: ${spec.error}`);
      continue;
    }
    if (hasAnyOnly && !spec.hasOnly && discoverCasesWithLibrary(spec.source, librarySource, options.seed ?? 0, loader).length > 0) continue;
    try {
      const report = runSpecFileWithLibrary(spec.projectPath, spec.source, librarySource, { ...options, loader });
      reports.push(report);
      failures.push(...report.failures);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reports.push({ file: spec.projectPath, cases: [], skipped: [], warning: null, failures: [message] });
      failures.push(`${spec.projectPath}: ${message}`);
    }
  }
  return {
    files: reports,
    failures,
    skipped: reports.flatMap((report) => report.skipped.map((name) => `${report.file}: ${name}`)),
    warnings: reports.flatMap((report) => report.warning === null ? [] : [`${report.file}: ${report.warning}`]),
    sources: ordered.map((file) => ({ path: file.path, revision: file.revision ?? null })),
    ...(options.coverage === true ? { coverage: mergeCoverage(reports.flatMap((report) => report.coverage === undefined ? [] : [report.coverage])) } : {}),
  };
}
