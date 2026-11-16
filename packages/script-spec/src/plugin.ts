import type { PluginDefinition } from "@tk-reawakened/core";
import type { SpecDoubles } from "./doubles.ts";
import { specCommands, SPEC_GROUP } from "./natives.ts";

/**
 * The `script-spec` plugin, its test doubles bound to one run's host-side state. The runner makes one per run; the
 * static `SPEC_PLUGIN` has none, so stateful test commands raise `spec.no-doubles`.
 */
export function createSpecPlugin(doubles?: SpecDoubles): PluginDefinition {
  return {
    id: "script-spec",
    version: "1.0.0",
    doc: {
      summary: "Test-only native commands for RPGCode spec results, matchers, doubles and creator operations.",
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
