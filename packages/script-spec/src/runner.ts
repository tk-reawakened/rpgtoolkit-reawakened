import { SPEC_LIBRARY_SOURCE as PACKAGE_STARTUP } from "./library.generated.ts";
import { discoverCasesWithLibrary, failureMessage, hasOnlyCasesWithLibrary, NO_CASES, ONLY_WARNING, runSpecFileWithLibrary, type SpecFileReport, type SpecProgramLoader, type SpecRunOptions } from "./runner-core.ts";


export { failureMessage, NO_CASES, ONLY_WARNING };
export type {
  CreatorFixtureIdentity,
  CreatorFixtureRun,
  CreatorLastAction,
  CreatorFrameObservation,
  CreatorOutcomeContext,
  CreatorRunSnapshot,
  SpecCaseResult,
  SpecFileReport,
  SpecOutcome,
  SpecOutcomeKind,
  SpecRunOptions,
  SpecProgramLoader,
} from "./runner-core.ts";

export function discoverCases(source: string, seed = 0, loader?: SpecProgramLoader): string[] {
  return discoverCasesWithLibrary(source, PACKAGE_STARTUP, seed, loader);
}

export function hasOnlyCases(source: string, seed = 0, loader?: SpecProgramLoader): boolean {
  return hasOnlyCasesWithLibrary(source, PACKAGE_STARTUP, seed, loader);
}

export function runSpecFile(file: string, source: string, options: SpecRunOptions): SpecFileReport {
  return runSpecFileWithLibrary(file, source, PACKAGE_STARTUP, options);
}
