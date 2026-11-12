/**
 * `tkr script test` — run the project's `*.spec.prg` files through the 10.8
 * runner and report results.
 */

import { decodeCp1252 } from "@tk-reawakened/core";
import { discoverProjectSpecs, runSpecProject } from "@tk-reawakened/script-spec";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

export type TestResult = {
  readonly result: ScriptResult;
  readonly text: string;
  /** The readable report, for stderr when `--json` keeps stdout for the envelope. */
  readonly human: string;
};

export function runTest(paths: readonly string[], strict: boolean, json: boolean): TestResult {
  const projectRoot = resolve(paths.length === 1 && !paths[0]!.includes("*") ? paths[0]! : ".");
  const sourceFiles = collectSpecSources(projectRoot);

  const projectReport = runSpecProject(projectRoot, { seed: 0, strict });
  const diagnostics: ResultDiagnostic[] = [];
  for (const failure of projectReport.failures) {
    diagnostics.push({
      code: "spec.case-failed",
      severity: "error",
      file: failure.split(":")[0] ?? "<unknown>",
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      message: failure,
    });
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const file of projectReport.files) {
    for (const caseResult of file.cases) {
      if (caseResult.ok) passed += 1;
      else failed += 1;
    }
    skipped += file.skipped.length;
  }

  const exitCode = projectReport.failures.length > 0 || (strict && projectReport.skipped.length > 0) ? 1 : 0;
  const summary = { ...emptySummary, files: sourceFiles.length, passed, failed, skipped };
  const result = makeResult("test", exitCode, diagnostics, summary, { files: projectReport.files });
  const human = formatTestText(result);
  return { result, text: json ? stableStringify(result) : human, human };
}

function collectSpecSources(projectRoot: string): { readonly name: string; readonly source: string }[] {
  const paths = discoverProjectSpecs(projectRoot);
  return paths.map((name) => {
    const bytes = readFileSync(join(projectRoot, name));
    return { name, source: decodeCp1252(bytes, 0, bytes.length) };
  });
}

function formatTestText(result: ScriptResult): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) lines.push(diagnostic.message);
  lines.push(`${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped`);
  return lines.join("\n") + "\n";
}
