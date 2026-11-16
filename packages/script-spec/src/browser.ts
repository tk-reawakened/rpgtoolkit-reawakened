import { SPEC_LIBRARY_SOURCE } from "./library.generated.ts";
import { isIgnoredProjectPath, runSpecProjectFiles, type SpecProjectFile, type SpecProjectOptions, type SpecProjectReport } from "./project-core.ts";

/** Browser-safe creator-test runner: callers supply one frozen project inventory and this entry's bundled library. */
export function runCreatorSpecs(files: readonly SpecProjectFile[], options: SpecProjectOptions = {}): SpecProjectReport {
  return runSpecProjectFiles(files, SPEC_LIBRARY_SOURCE, options);
}

export { isIgnoredProjectPath };
export type { SpecProjectFile, SpecProjectOptions, SpecProjectReport } from "./project-core.ts";
export type {
  CreatorFixtureIdentity,
  CreatorFixtureRun,
  CreatorFrameObservation,
  CreatorLastAction,
  CreatorOutcomeContext,
  CreatorRunSnapshot,
} from "./runner-core.ts";

