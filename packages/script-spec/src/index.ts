/**
 * `@tk-reawakened/script-spec` — the RPGCode test package (TOOL-5,
 * docs/spec/engine/rpgcode-tooling.md#tool-5; ADR 0014 and its 2026-11-11 amendment).
 *
 * The package is a library program (`package/startup.prg`, plain RPGCode) plus a **closed, test-only set of twelve
 * native commands** (`natives.ts`): `specResult`, which records an outcome together with the source position of
 * its call, seven matcher helpers (`specCapture`, `specEqual`, `specContain`, `specClose`, `specThrowBegin`,
 * `specThrowEnd`, `specCalled`) that read what a library program cannot, and four test doubles (`specInput`,
 * `specTicks`, `specRng`, `spyOn`; #tool-5-doubles). The package is loadable only by the test runner and is never
 * part of a game's manifest.
 */


export { createSpecPlugin, SPEC_PLUGIN } from "./plugin.ts";
export type { SpecCaseResult, SpecFileReport, SpecOutcome, SpecOutcomeKind, SpecRunOptions } from "./runner.ts";
export { discoverProjectSpecs, runSpecProject, watchSpecProject } from "./project.ts";
export { mergeCoverage, toLcov } from "./coverage.ts";
export type { SpecCoverage, SpecFileCoverage, SpecLineCoverage } from "./coverage.ts";
export type { SpecProjectOptions, SpecProjectReport } from "./project.ts";

