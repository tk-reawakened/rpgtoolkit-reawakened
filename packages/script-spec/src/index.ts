/**
 * `@tk-reawakened/script-spec` — the RPGCode test package (TOOL-5,
 * docs/spec/engine/rpgcode-tooling.md#tool-5; ADR 0014).
 *
 * The package is a library program (`package/startup.prg`, plain RPGCode) plus
 * **one** native command, `specResult`, which records an outcome together with
 * the source position of its call. `CommandView.pos` supplies that position, so
 * no engine capability beyond a getter was added. The package is loadable only
 * by the test runner and is never part of a game's manifest.
 */

import {
  recordEffect,
  type BuiltinSpec,
  type CommandResult,
  type PluginDefinition,
  type Value,
} from "@tk-reawakened/core";

const KINDS = new Set(["pass", "fail", "skip", "only"]);

function text(value: Value): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value === null ? "" : "";
}

const SPEC_RESULT: BuiltinSpec = {
  name: "specresult",
  aliases: [],
  // One variadic parameter: `specResult` accepts kind, name, expected and actual
  // in any arity the library uses, and the handler reads the first four.
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  doc: {
    summary: "Record one spec outcome with the source position of this call.",
    behaviour:
      "Registered under the folded name `specresult`, so `specResult(...)` in a spec program reaches it (LEX-10). Records `{ kind, name, expected, actual, file, line, column }` on the run's result channel and returns nothing; `kind` is pass, fail, skip or only. The test runner reports the record with the file and line of the call.",
    groups: ["tooling"],
    access: "public",
    see: ["docs/spec/engine/rpgcode-tooling.md#tool-5", "docs/spec/engine/rpgcode-functions.md#tooling-the-rpgcode-spec-package"],
  },
  call: (view, args): CommandResult => {
    const kind = text(args[0]?.value ?? null);
    if (!KINDS.has(kind)) {
      // Not a result: the runner sees a diagnostic record with the offending kind.
      return { value: null, effects: [{ kind: "diagnostic", section: "vm", args: ["spec.bad-kind", kind] }] };
    }
    const name = text(args[1]?.value ?? null);
    const expected = text(args[2]?.value ?? null);
    const actual = text(args[3]?.value ?? null);
    const pos = view.pos;
    if (view.state !== undefined) {
      recordEffect(view.state.vm, {
        tick: view.state.time.tick,
        thread: view.thread ?? 0,
        name: "specresult",
        kind: "pure",
        args: [kind, name, expected, actual, pos?.file ?? "", pos?.line ?? 0, pos?.col ?? 0],
        out: {},
        result: null,
        patch: null,
        wait: null,
        request: null,
      });
    }
    return { value: null };
  },
};

/** The package's only native definition: `specResult`, and nothing else. */
export { discoverCases, failureMessage, hasOnlyCases, ONLY_WARNING, runSpecFile } from "./runner.ts";
export type { SpecCaseResult, SpecFileReport, SpecOutcome, SpecOutcomeKind, SpecRunOptions } from "./runner.ts";
export { discoverProjectSpecs, runSpecProject } from "./project.ts";
export type { SpecProjectOptions, SpecProjectReport } from "./project.ts";

export const SPEC_PLUGIN: PluginDefinition = {
  id: "script-spec",
  version: "1.0.0",
  commands: [SPEC_RESULT],
};
