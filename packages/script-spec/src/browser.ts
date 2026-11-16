import librarySource from "../package/startup.prg";
import { isIgnoredProjectPath, runSpecProjectFiles, type SpecProjectFile, type SpecProjectOptions, type SpecProjectReport } from "./project-core.ts";

/** Browser-safe creator-test runner: callers supply one frozen project inventory and this entry's bundled library. */
export function runCreatorSpecs(files: readonly SpecProjectFile[], options: SpecProjectOptions = {}): SpecProjectReport {
  return runSpecProjectFiles(files, librarySource, options);
}

export { isIgnoredProjectPath };
export type { SpecProjectFile, SpecProjectReport } from "./project-core.ts";
