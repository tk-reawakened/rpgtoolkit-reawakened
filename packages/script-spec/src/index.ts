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

import type { PluginDefinition } from "@tk-reawakened/core";
import type { SpecDoubles } from "./doubles.ts";
import { specCommands, SPEC_GROUP } from "./natives.ts";

export { discoverCases, failureMessage, hasOnlyCases, NO_CASES, ONLY_WARNING, runSpecFile } from "./runner.ts";
export type { SpecCaseResult, SpecFileReport, SpecOutcome, SpecOutcomeKind, SpecRunOptions } from "./runner.ts";
export { discoverProjectSpecs, runSpecProject, watchSpecProject } from "./project.ts";
export type { SpecProjectOptions, SpecProjectReport } from "./project.ts";

/**
 * The `script-spec` plugin, its test doubles bound to one run's host-side state. The runner makes one per run; the
 * static `SPEC_PLUGIN` has none, so its doubles raise `spec.no-doubles`.
 */
export function createSpecPlugin(doubles?: SpecDoubles): PluginDefinition {
  return {
    id: "script-spec",
    version: "1.0.0",
    doc: {
      summary: "The native commands behind the RPGCode spec API: one result channel, seven matcher helpers and four test doubles.",
      groups: [{
        id: SPEC_GROUP,
        name: "RPGCode spec package",
        summary: "Test-only commands loaded by the test runner; a shipped game never has them.",
      }],
    },
    commands: specCommands(doubles),
  };
}

export const SPEC_PLUGIN: PluginDefinition = createSpecPlugin();
