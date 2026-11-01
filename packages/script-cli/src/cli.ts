#!/usr/bin/env node
/**
 * `tkr` — the RPGCode command-line front end (docs/spec/engine/rpgcode-tooling.md#tool-9).
 *
 * Every subcommand writes the same `tkr-script-result/1` envelope when given
 * `--json`, and returns one of the stable exit codes: 0 nothing to report,
 * 1 findings in the project, 2 usage or configuration error, 3 internal error.
 */

import { parseArgs } from "./args.ts";
import { runCheck } from "./commands/check.ts";
import { runDocs } from "./commands/docs.ts";
import { runFmt } from "./commands/fmt.ts";
import { runIndex } from "./commands/index.ts";
import { runTest } from "./commands/test.ts";
import { makeResult, stableStringify, type ScriptResult } from "./result.ts";

function run(): { readonly result: ScriptResult; readonly text: string } {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    const result = makeResult("check", 2, [], { files: 0, diagnostics: { error: 1, warning: 0, info: 0, hint: 0 }, changed: 0, passed: 0, failed: 0, skipped: 0 }, { message: parsed.message });
    return { result, text: `${parsed.message}\n` };
  }

  const { args } = parsed;
  switch (args.subcommand) {
    case "check":
      return runCheck(args.paths, args.json);
    case "fmt":
      return runFmt(args.paths, args.dialect, args.check, args.json);
    case "test":
      return runTest(args.paths, args.strict, args.json);
    case "docs":
      return runDocs(args.check, args.out, args.json);
    case "index":
      return runIndex(args.paths, args.check, args.out, args.json);
  }
  throw new Error("unreachable");
}

const jsonMode = process.argv.includes("--json");

try {
  const { result, text } = run();
  const output = jsonMode ? stableStringify(result) : text;
  if (output.length > 0) process.stdout.write(output);
  process.exitCode = result.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const result = makeResult(
    "check",
    3,
    [{ code: "tkr.internal", severity: "error", file: "<cli>", range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }, message }],
    { files: 0, diagnostics: { error: 1, warning: 0, info: 0, hint: 0 }, changed: 0, passed: 0, failed: 0, skipped: 0 },
    {},
  );
  if (jsonMode) {
    process.stdout.write(stableStringify(result));
  } else {
    process.stderr.write(`tkr: internal error: ${message}\n`);
  }
  process.exitCode = 3;
}
