/**
 * `tkr script check` — parser diagnostics and lint over the given sources.
 */

import { FIRST_PARTY_PLUGINS, type ResolvedPlugin } from "@tk-reawakened/core";
import {
  analyse,
  buildIndex,
  lint,
  readLintConfig,
  type Diagnostic,
  type LintConfig,
} from "@tk-reawakened/script-tools";
import { collectSourceFiles, readProjectConfig } from "../files.ts";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

export type CheckResult = {
  readonly result: ScriptResult;
  readonly text: string;
};

function withFile(diagnostic: Diagnostic, file: string): ResultDiagnostic {
  return { ...diagnostic, file };
}

export function runCheck(paths: readonly string[], json: boolean): CheckResult {
  const diagnostics: ResultDiagnostic[] = [];
  let files = 0;
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let hints = 0;

  const configResult = loadLintConfig();
  if (!configResult.ok) {
    const result = makeResult("check", 2, [], emptySummary, { configError: configResult.message });
    return { result, text: json ? stableStringify(result) : `tkr script check: ${configResult.message}` };
  }
  const lintConfig = configResult.config;

  const sources = collectSourceFiles(paths);
  files = sources.length;

  for (const file of sources) {
    try {
      const analysis = analyse(file.source, { file: file.name });
      for (const diagnostic of analysis.diagnostics) diagnostics.push(withFile(diagnostic, file.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        code: "tkr.internal",
        severity: "error",
        file: file.name,
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
        message,
      });
    }
  }

  // Only run the linter on files that compiled; the index stops at the first
  // parser error and a partial index would invent missing-command findings.
  const compilable = sources.filter((file) => diagnostics.every((d) => d.file !== file.name));
  if (compilable.length > 0) {
    const index = buildIndex(
      compilable.map((file) => ({ name: file.name, ref: { kind: "inline", text: file.source, ir: "1" } })),
      {},
    );
    const lintResult = lint(index, {
      plugins,
      config: lintConfig,
      sources: Object.fromEntries(compilable.map((file) => [file.name, file.source])),
      resolveIncludes: false,
    });
    for (const diagnostic of lintResult.diagnostics) {
      const program = index.programs.find((p) => p.diagnostics.includes(diagnostic as Diagnostic));
      diagnostics.push(withFile(diagnostic, program?.name ?? "<unknown>"));
    }
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    if (diagnostic.severity === "warning") warnings += 1;
    if (diagnostic.severity === "info") infos += 1;
    if (diagnostic.severity === "hint") hints += 1;
  }

  const hasError = diagnostics.some((d) => d.severity === "error");
  const exitCode = hasError ? 1 : 0;
  const summary = { ...emptySummary, files, diagnostics: { error: errors, warning: warnings, info: infos, hint: hints } };
  const result = makeResult("check", exitCode, diagnostics, summary, {});
  const text = json ? stableStringify(result) : formatCheckText(result);
  return { result, text };
}

function loadLintConfig(): { readonly ok: true; readonly config: LintConfig } | { readonly ok: false; readonly message: string } {
  const value = readProjectConfig("tkr-lint.json");
  if (value === null) return { ok: true, config: {} };
  const parsed = readLintConfig(value);
  if (parsed.ok) return { ok: true, config: parsed.config };
  return { ok: false, message: `tkr-lint.json: ${parsed.problems.join("; ")}` };
}

function formatCheckText(result: ScriptResult): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) {
    const rule = diagnostic.rule === undefined ? "" : ` [${diagnostic.rule}]`;
    lines.push(`${diagnostic.file}:${diagnostic.range.start.line}:${diagnostic.range.start.column}: ${diagnostic.severity}: ${diagnostic.message}${rule}`);
  }
  lines.push(`${result.summary.files} file(s), ${result.summary.diagnostics.error} error(s), ${result.summary.diagnostics.warning} warning(s)`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
