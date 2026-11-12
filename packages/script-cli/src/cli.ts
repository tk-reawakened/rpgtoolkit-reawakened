#!/usr/bin/env node
/**
 * `tkr` — the RPGCode command-line front end (docs/spec/engine/rpgcode-tooling.md#tool-9).
 *
 * Every subcommand writes the same `tkr-script-result/1` envelope when given
 * `--json`, and returns one of the stable exit codes: 0 nothing to report,
 * 1 findings in the project, 2 usage or configuration error, 3 internal error.
 */

import { accessSync, constants, existsSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, type SubcommandName } from "./args.ts";
import { runCheck } from "./commands/check.ts";
import { runDocs } from "./commands/docs.ts";
import { runFmt } from "./commands/fmt.ts";
import { runIndex } from "./commands/index.ts";
import { runTest } from "./commands/test.ts";
import { emptySummary, internalErrorResult, makeResult, stableStringify, usageDiagnostic, type ResultDiagnostic, type ScriptResult } from "./result.ts";

function validatePaths(paths: readonly string[]): ResultDiagnostic[] {
  const diagnostics: ResultDiagnostic[] = [];
  for (const path of paths) {
    try {
      statSync(path);
      accessSync(path, constants.R_OK);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      diagnostics.push(usageDiagnostic(path, code === "ENOENT" ? `no such file or directory: ${path}` : `cannot access ${path}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  return diagnostics;
}

/** What one run produced: the envelope, the text for stdout without `--json`, and the readable report for stderr with it. */
type Outcome = { readonly result: ScriptResult; readonly text: string; readonly human: string };

/** The subcommand the arguments name, if they got that far, so a failure is reported under the right one. */
let activeSubcommand: SubcommandName = "check";

function run(): Outcome {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    activeSubcommand = parsed.subcommand ?? "check";
    const result = makeResult(
      activeSubcommand,
      2,
      [usageDiagnostic("<cli>", parsed.message)],
      { files: 0, diagnostics: { error: 1, warning: 0, info: 0, hint: 0 }, changed: 0, passed: 0, failed: 0, skipped: 0 },
      { message: parsed.message, attemptedSubcommand: parsed.attemptedSubcommand },
    );
    return { result, text: `${parsed.message}\n`, human: `${parsed.message}\n` };
  }

  const { args } = parsed;
  activeSubcommand = args.subcommand;

  if (args.subcommand !== "docs") {
    const pathDiagnostics = validatePaths(args.paths);
    if (pathDiagnostics.length > 0) {
      const result = makeResult(args.subcommand, 2, pathDiagnostics, { ...emptySummary, files: args.paths.length, diagnostics: { error: pathDiagnostics.length, warning: 0, info: 0, hint: 0 } }, {});
      const human = pathDiagnostics.map((d) => `tkr script ${args.subcommand}: ${d.message}`).join("\n") + "\n";
      return { result, text: args.json ? stableStringify(result) : human, human };
    }
  }

  switch (args.subcommand) {
    case "check":
      return runCheck(args.paths, args.json);
    case "fmt":
      return runFmt(args.paths, args.dialect, args.check, args.json);
    case "test":
      return runTest(args.paths, args.strict, args.json, args.name, args.reporter);
    case "docs":
      return runDocs(args.check, args.out, args.json);
    case "index":
      return runIndex(args.paths, args.check, args.out, args.json);
  }
}

const parsed = parseArgs(process.argv);
const jsonMode = process.argv.includes("--json") || process.argv.includes("--reporter=json")
  || process.argv.some((arg, index) => arg === "--reporter" && process.argv[index + 1] === "json");

function execute(): void {
  try {
    const { result, text, human } = run();
    if (jsonMode) {
      process.stdout.write(stableStringify(result));
      if (human.length > 0) process.stderr.write(human);
    } else if (parsed.ok && parsed.args.subcommand === "test" && parsed.args.reporter === "junit" && parsed.args.out !== null && result.exitCode < 2) {
      const output = parsed.args.out;
      let previous: string | null = null;
      try {
        previous = readFileSync(output, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (previous !== text) writeFileSync(output, text);
      if (human.length > 0) process.stderr.write(human);
    } else if (text.length > 0) {
      process.stdout.write(text);
    }
    process.exitCode = result.exitCode;
  } catch (error) {
    const result = internalErrorResult(activeSubcommand, error);
    if (jsonMode) process.stdout.write(stableStringify(result));
    process.stderr.write(`tkr: internal error: ${result.diagnostics[0]!.message}\n`);
    process.exitCode = 3;
  }
}

if (parsed.ok && parsed.args.subcommand === "test" && parsed.args.watch && validatePaths(parsed.args.paths).length === 0) {
  const root = parsed.args.paths.length === 1 && !parsed.args.paths[0]!.includes("*") ? parsed.args.paths[0]! : ".";
  try {
    const output = parsed.args.out === null ? null : resolve(parsed.args.out);
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (filename !== null && output !== null && resolve(root, filename.toString()) === output && existsSync(output)) return;
      execute();
    });
    watcher.on("error", (error) => {
      const result = internalErrorResult("test", error);
      if (jsonMode) process.stdout.write(stableStringify(result));
      process.stderr.write(`tkr: watch error: ${error.message}\n`);
      process.exitCode = result.exitCode;
      watcher.close();
    });
    process.once("SIGINT", () => { watcher.close(); });
    execute();
  } catch (error) {
    const result = internalErrorResult("test", error);
    if (jsonMode) process.stdout.write(stableStringify(result));
    process.stderr.write(`tkr: watch error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 3;
  }
} else {
  execute();
}
