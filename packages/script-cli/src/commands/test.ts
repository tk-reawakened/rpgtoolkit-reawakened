/**
 * `tkr script test` — run the project's `*.spec.prg` files through the 10.8
 * runner and report results.
 */

import { decodeCp1252 } from "@tk-reawakened/core";
import { discoverProjectSpecs, runSpecProject, type SpecProjectReport } from "@tk-reawakened/script-spec";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

export type TestResult = {
  readonly result: ScriptResult;
  readonly text: string;
  /** The readable report, for stderr when `--json` keeps stdout for the envelope. */
  readonly human: string;
};

export function runTest(paths: readonly string[], strict: boolean, json: boolean, name = "", reporter: "spec" | "junit" | "json" = json ? "json" : "spec"): TestResult {
  const projectRoot = resolve(paths.length === 1 && !paths[0]!.includes("*") ? paths[0]! : ".");
  const sourceFiles = collectSpecSources(projectRoot);

  const projectReport = runSpecProject(projectRoot, { seed: 0, strict, name });
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
    if (file.cases.length === 0 && file.failures.length > 0) failed += 1;
    for (const caseResult of file.cases) {
      if (caseResult.outcomes.some((outcome) => outcome.kind === "skip")) continue;
      if (caseResult.ok) passed += 1;
      else failed += 1;
    }
    skipped += file.skipped.length;
  }

  const exitCode = projectReport.failures.length > 0 || (strict && projectReport.skipped.length > 0) ? 1 : 0;
  const summary = { ...emptySummary, files: sourceFiles.length, passed, failed, skipped };
  const result = makeResult("test", exitCode, diagnostics, summary, { files: projectReport.files });
  const human = formatTestText(projectReport, result);
  return { result, text: reporter === "json" ? stableStringify(result) : reporter === "junit" ? formatJunit(projectReport) : human, human };
}

function collectSpecSources(projectRoot: string): { readonly name: string; readonly source: string }[] {
  const paths = discoverProjectSpecs(projectRoot);
  return paths.map((name) => {
    const bytes = readFileSync(join(projectRoot, name));
    return { name, source: decodeCp1252(bytes, 0, bytes.length) };
  });
}

function formatTestText(report: SpecProjectReport, result: ScriptResult): string {
  const lines: string[] = [];
  for (const file of report.files) {
    lines.push(file.file);
    for (const item of file.cases) {
      const status = item.outcomes.some((outcome) => outcome.kind === "skip") ? "SKIP" : item.ok ? "PASS" : "FAIL";
      lines.push(`  ${status} ${[...item.groups, item.name].join(" > ")}`);
    }
  }
  for (const diagnostic of result.diagnostics) lines.push(diagnostic.message);
  for (const warning of report.warnings) lines.push(warning);
  lines.push(`${result.summary.passed} passed, ${result.summary.failed} failed, ${result.summary.skipped} skipped`);
  return lines.join("\n") + "\n";
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\t", "&#9;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "\ufffd");
}

function formatJunit(report: SpecProjectReport): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<testsuites>"];
  for (const file of report.files) {
    const discoveryFailure = file.cases.length === 0 && file.failures.length > 0;
    const failures = file.cases.filter((item) => !item.ok).length + (discoveryFailure ? 1 : 0);
    const skips = file.cases.filter((item) => item.ok && item.outcomes.some((outcome) => outcome.kind === "skip")).length;
    lines.push(`  <testsuite name="${xml(file.file)}" tests="${file.cases.length + (discoveryFailure ? 1 : 0)}" failures="${failures}" skipped="${skips}">`);
    if (discoveryFailure) lines.push(`    <testcase name="discovery"><failure>${xml(file.failures.join("\n"))}</failure></testcase>`);
    for (const item of file.cases) {
      const classname = [file.file, ...item.groups].join(" > ");
      lines.push(`    <testcase classname="${xml(classname)}" name="${xml(item.name)}">`);
      if (!item.ok) {
        const failures = item.outcomes.filter((outcome) => outcome.kind === "fail").map((outcome) => `${outcome.label}: expected ${outcome.expected}, actual ${outcome.actual} (line ${outcome.line})`);
        lines.push(`      <failure>${xml(failures.length > 0 ? failures.join("\n") : item.outcomes.some((outcome) => outcome.kind === "skip") ? "skipped in strict mode" : "recorded no assertion")}</failure>`);
      } else if (item.outcomes.some((outcome) => outcome.kind === "skip")) lines.push("      <skipped/>");
      lines.push("    </testcase>");
    }
    if (file.warning !== null) lines.push(`    <system-out>${xml(file.warning)}</system-out>`);
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n") + "\n";
}
