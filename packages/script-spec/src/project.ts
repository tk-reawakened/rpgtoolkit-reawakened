import { readFileSync, readdirSync } from "node:fs";
import { assetKey, createAssetIndex, decodeCp1252, PACKAGE_ROOT, type ProgramLoader } from "@tk-reawakened/core";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hasOnlyCases, runSpecFile, type SpecFileReport, type SpecRunOptions } from "./runner.ts";

const LIBRARY_PATH = fileURLToPath(new URL("../package/startup.prg", import.meta.url));
const compareNames = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function projectFiles(directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  };
  visit(directory);
  return files.sort(compareNames);
}

/** Find project-owned `*.spec.prg` files recursively, ordered by project-relative path. */
export function discoverProjectSpecs(projectRoot: string): string[] {
  const root = resolve(projectRoot);
  return projectFiles(root)
    .filter((file) => file.endsWith(".spec.prg"))
    .map((file) => relative(root, file).split(sep).join("/"));
}

function projectProgramLoader(projectRoot: string): ProgramLoader {
  const rootEntries = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && assetKey(entry.name) === assetKey("Prg"))
    .sort((left, right) => compareNames(left.name, right.name));
  const rootEntry = rootEntries[0];
  const programDirectory = rootEntry === undefined ? undefined : join(projectRoot, rootEntry.name);
  const programFiles = programDirectory === undefined
    ? []
    : projectFiles(programDirectory).filter((file) => assetKey(file.slice(file.lastIndexOf(sep) + 1)).endsWith(".prg"));
  const programEntries = programDirectory === undefined
    ? []
    : programFiles.map((file) => ({
      path: `Prg/${relative(programDirectory, file).split(sep).join("/")}`,
      file,
    }));
  const index = createAssetIndex(programEntries.map((entry) => entry.path));
  const contents = new Map<string, Uint8Array>();
  for (const entry of programEntries) {
    const key = assetKey(entry.path);
    if (!contents.has(key)) contents.set(key, readFileSync(entry.file));
  }
  return { index, root: PACKAGE_ROOT, read: (key) => contents.get(key) };
}

export type SpecProjectReport = {
  readonly files: readonly SpecFileReport[];
  /** Failing cases, prefixed by their project-relative spec path. */
  readonly failures: readonly string[];
  /** Skipped cases, prefixed by their project-relative spec path. */
  readonly skipped: readonly string[];
  /** `only()` warnings, prefixed by their project-relative spec path. */
  readonly warnings: readonly string[];
};

export type SpecProjectOptions = Pick<SpecRunOptions, "seed" | "strict">;

/** Read and run every discovered project spec against its RPGCode files and the bundled API. */
export function runSpecProject(projectRoot: string, options: SpecProjectOptions = {}): SpecProjectReport {
  const root = resolve(projectRoot);
  const library = readFileSync(LIBRARY_PATH, "utf8");
  const loader = projectProgramLoader(root);
  const specs = discoverProjectSpecs(root).map((projectPath) => {
    const absolutePath = join(root, ...projectPath.split("/"));
    const bytes = readFileSync(absolutePath);
    return { projectPath, source: decodeCp1252(bytes, 0, bytes.length) };
  });
  const selected = specs.map((spec) => {
    try {
      return { ...spec, hasOnly: hasOnlyCases(library, spec.source, options.seed ?? 0, loader), error: null };
    } catch (error) {
      // One malformed spec must not abort the rest of the project run (TOOL-5).
      return { ...spec, hasOnly: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const hasAnyOnly = selected.some((spec) => spec.hasOnly);
  const reports: SpecFileReport[] = [];
  const failures: string[] = [];
  for (const spec of selected) {
    if (hasAnyOnly && !spec.hasOnly) continue;
    if (spec.error !== null) {
      reports.push({ file: spec.projectPath, cases: [], skipped: [], warning: null, failures: [spec.error] });
      failures.push(`${spec.projectPath}: ${spec.error}`);
      continue;
    }
    try {
      const report = runSpecFile(spec.projectPath, spec.source, { ...options, library, loader });
      reports.push(report);
      for (const failure of report.failures) failures.push(failure);
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
  };
}

