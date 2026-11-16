/**
 * `@tk-reawakened/script-spec` — the RPGCode test package (TOOL-5,
 * docs/spec/engine/rpgcode-tooling.md#tool-5; ADR 0014 and its 2026-11-11 amendment).
 *
 * This library program and its closed, test-only native command set (`natives.ts`) are loadable only by the test runner
 * and are never part of a game's manifest.
 */

export { discoverCases, failureMessage, hasOnlyCases, NO_CASES, ONLY_WARNING, runSpecFile } from "./runner.ts";
export { createSpecPlugin, SPEC_PLUGIN } from "./plugin.ts";
export type { SpecCaseResult, SpecFileReport, SpecOutcome, SpecOutcomeKind, SpecRunOptions } from "./runner.ts";
export { discoverProjectSpecs, runSpecProject, watchSpecProject } from "./project.ts";
export { mergeCoverage, toLcov } from "./coverage.ts";
export type { SpecCoverage, SpecFileCoverage, SpecLineCoverage } from "./coverage.ts";
export type { SpecProjectOptions, SpecProjectReport } from "./project.ts";
export { FixtureError, fixturePath, listEntries, readFixture } from "./fixture.ts";
export type { FixtureDefinition, FixtureStart, Plain } from "./fixture.ts";
export { createFixtureWorld } from "./fixture-world.ts";
export type { FixtureWorld, FixtureWorldFile, FixtureWorldInputFile } from "./fixture-world.ts";
export { sha256Hex } from "./sha256.ts";
