/**
 * `tkr script test` — run the project's `*.spec.prg` files through the 10.8
 * runner and report results.
 *
 * The spec API still contains owner-gated matchers (F-A/F-D). A spec that uses
 * one must fail the run loudly rather than silently pass; the scanner below
 * detects the common cases before the runner is invoked.
 */

import { decodeCp1252, tokenizeObjects, type Token } from "@tk-reawakened/core";
import { discoverProjectSpecs, runSpecProject } from "@tk-reawakened/script-spec";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

export type TestResult = {
  readonly result: ScriptResult;
  readonly text: string;
};

const GATED: Record<string, string> = {
  tothrow: "toThrow is owner-gated (F-A) and not implemented",
};

function gatedDiagnostics(source: string, file: string): ResultDiagnostic[] {
  const diagnostics: ResultDiagnostic[] = [];
  let tokens: Token[];
  try {
    tokens = tokenizeObjects(source);
  } catch {
    return [];
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "identifier") continue;
    const message = GATED[token.name];
    if (message !== undefined) {
      diagnostics.push({
        code: "spec.owner-gated-matcher",
        severity: "error",
        file,
        range: {
          start: { line: token.line, column: token.col },
          end: { line: token.line, column: token.endCol },
        },
        message,
      });
      continue;
    }
    if (token.name === "toequal" || token.name === "tocontain") {
      const arrayArg = hasArrayArgument(tokens, index);
      if (arrayArg) {
        diagnostics.push({
          code: "spec.owner-gated-matcher",
          severity: "error",
          file,
          range: {
            start: { line: token.line, column: token.col },
            end: { line: token.line, column: token.endCol },
          },
          message: `${token.name} with an array argument is owner-gated (F-A) and not implemented`,
        });
      }
    }
    if (token.name === "tobecloseto") {
      const fractional = hasFractionalTolerance(tokens, index);
      if (fractional) {
        diagnostics.push({
          code: "spec.owner-gated-matcher",
          severity: "error",
          file,
          range: {
            start: { line: token.line, column: token.col },
            end: { line: token.line, column: token.endCol },
          },
          message: "fractional toBeCloseTo is owner-gated (F-D) and not implemented",
        });
      }
    }
  }
  return diagnostics;
}

function hasArrayArgument(tokens: readonly Token[], callIndex: number): boolean {
  let depth = 0;
  for (let index = callIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "op" && token.text === "(") {
      depth += 1;
    } else if (token.kind === "op" && token.text === ")") {
      if (depth === 1) return false;
    } else if (depth === 1 && token.kind === "op" && token.text === "[") {
      return true;
    }
  }
  return false;
}

function hasFractionalTolerance(tokens: readonly Token[], callIndex: number): boolean {
  let depth = 0;
  let sawComma = false;
  for (let index = callIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === "op" && token.text === "(") {
      depth += 1;
    } else if (token.kind === "op" && token.text === ")") {
      if (depth === 1) return false;
    } else if (depth === 1 && token.kind === "op" && token.text === ",") {
      sawComma = true;
    } else if (depth === 1 && sawComma && token.kind === "number" && !Number.isInteger(token.value)) {
      return true;
    }
  }
  return false;
}

export function runTest(paths: readonly string[], strict: boolean, json: boolean): TestResult {
  const projectRoot = resolve(paths.length === 1 && !paths[0]!.includes("*") ? paths[0]! : ".");
  const sourceFiles = collectSpecSources(projectRoot);

  const gated: ResultDiagnostic[] = [];
  for (const file of sourceFiles) {
    for (const diagnostic of gatedDiagnostics(file.source, file.name)) gated.push(diagnostic);
  }

  if (gated.length > 0) {
    const summary = { ...emptySummary, files: sourceFiles.length, failed: gated.length };
    const result = makeResult("test", 1, gated, summary, { cases: [] });
    return { result, text: json ? stableStringify(result) : formatTestText(result) };
  }

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
  const text = json ? stableStringify(result) : formatTestText(result);
  return { result, text };
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
