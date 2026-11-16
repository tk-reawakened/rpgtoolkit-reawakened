import { createHash } from "node:crypto";
import { readFileSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { assetKey } from "@tk-reawakened/core";
import { SPEC_LIBRARY_SOURCE } from "./library.generated.ts";
import { isIgnoredProjectPath, runSpecProjectFiles, type SpecProjectFile, type SpecProjectOptions, type SpecProjectReport } from "./project-core.ts";

const compareNames = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function projectFiles(directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => compareNames(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredProjectPath(entry.name)) visit(absolutePath);
      } else if (entry.isFile()) files.push(absolutePath);
    }
  };
  visit(directory);
  return files.sort(compareNames);
}

/** Find project-owned `*.spec.prg` files recursively, ordered by project-relative path. */
export function discoverProjectSpecs(projectRoot: string): string[] {
  const root = resolve(projectRoot);
  return projectFiles(root)
    .filter((file) => assetKey(file).endsWith(".spec.prg"))
    .map((file) => relative(root, file).split(sep).join("/"));
}

/** Read a project once and run every spec against that immutable host-neutral file inventory. */
export function runSpecProject(projectRoot: string, options: SpecProjectOptions = {}): SpecProjectReport {
  const root = resolve(projectRoot);
  const files: SpecProjectFile[] = projectFiles(root).map((absolutePath) => {
    const bytes = readFileSync(absolutePath);
    return {
      path: relative(root, absolutePath).split(sep).join("/"),
      bytes,
      revision: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  return runSpecProjectFiles(files, SPEC_LIBRARY_SOURCE, options);
}

/** Run immediately, then rerun the entire project whenever a project file changes. */
export function watchSpecProject(projectRoot: string, options: SpecProjectOptions, onReport: (report: SpecProjectReport) => void): FSWatcher {
  const watcher = watch(resolve(projectRoot), { recursive: true }, () => onReport(runSpecProject(projectRoot, options)));
  try {
    onReport(runSpecProject(projectRoot, options));
  } catch (error) {
    watcher.close();
    throw error;
  }
  return watcher;
}

export type { SpecProjectOptions, SpecProjectReport } from "./project-core.ts";
