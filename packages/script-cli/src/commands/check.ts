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
  type LintSummary,
} from "@tk-reawakened/script-tools";
import { collectSourceFiles, readProjectConfig } from "../files.ts";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

const plugins: ResolvedPlugin[] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }));

export type CheckResult = {
  readonly result: ScriptResult;
  readonly text: string;
  /** The readable report, for stderr when `--json` keeps stdout for the envelope. */
  readonly human: string;
};

function withFile(diagnostic: Diagnostic, file: string): ResultDiagnostic {
  return { ...diagnostic, file };
}

export function runCheck(paths: readonly string[], json: boolean, dialect?: "tk3" | "tk2"): CheckResult {
  const diagnostics: ResultDiagnostic[] = [];
  let files = 0;
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  let hints = 0;

  const configResult = loadLintConfig();
  if (!configResult.ok) {
    const diagnostic: ResultDiagnostic = {
      code: "tkr.config",
      severity: "error",
      file: "tkr-lint.json",
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      message: configResult.message,
    };
    const summary = { ...emptySummary, files: 0, diagnostics: { error: 1, warning: 0, info: 0, hint: 0 } };
    const result = makeResult("check", 2, [diagnostic], summary, { configError: configResult.message });
    const human = `tkr script check: ${configResult.message}\n`;
    return { result, text: json ? stableStringify(result) : human, human };
  }
  const lintConfig = configResult.config;

  const sources = collectSourceFiles(paths);
  files = sources.length;

  for (const file of sources) {
    try {
      const analysis = analyse(file.source, { file: file.name, ...(dialect === undefined ? {} : { dialect }) });
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
  let lintSummary: Pick<LintSummary, "disabledRules" | "ignoredRanges" | "unassessed"> = { disabledRules: [], ignoredRanges: 0, unassessed: [] };
  if (compilable.length > 0) {
    // The stated dialect compiles the program; without one, the dialect-dependent rules are unassessed (TOOL-3 assessment).
    const index = buildIndex(
      compilable.map((file) => ({ name: file.name, ref: { kind: "inline", text: file.source, ir: "1", ...(dialect === undefined ? {} : { dialect }) } })),
      {},
    );
    const lintResult = lint(index, {
      plugins,
      config: lintConfig,
      sources: Object.fromEntries(compilable.map((file) => [file.name, file.source])),
      resolveIncludes: false,
      ...(dialect === undefined ? {} : { dialect }),
    });
    lintSummary = { disabledRules: lintResult.summary.disabledRules, ignoredRanges: lintResult.summary.ignoredRanges, unassessed: lintResult.summary.unassessed };
    lintResult.diagnostics.forEach((diagnostic, position) => {
      diagnostics.push(withFile(diagnostic, lintResult.programs[position]!));
    });
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
  const result = makeResult("check", exitCode, diagnostics, summary, { lint: lintSummary });
  const human = formatCheckText(result, lintSummary);
  return { result, text: json ? stableStringify(result) : human, human };
}

function loadLintConfig(): { readonly ok: true; readonly config: LintConfig } | { readonly ok: false; readonly message: string } {
  const read = readProjectConfig("tkr-lint.json");
  if (read.kind === "absent") return { ok: true, config: {} };
  if (read.kind === "error") return { ok: false, message: read.message };
  const parsed = readLintConfig(read.value);
  if (parsed.ok) return { ok: true, config: parsed.config };
  return { ok: false, message: `tkr-lint.json: ${parsed.problems.join("; ")}` };
}

function formatCheckText(result: ScriptResult, lintSummary: Pick<LintSummary, "disabledRules" | "ignoredRanges" | "unassessed">): string {
  const lines: string[] = [];
  for (const diagnostic of result.diagnostics) {
    const rule = diagnostic.rule === undefined ? "" : ` [${diagnostic.rule}]`;
    lines.push(`${diagnostic.file}:${diagnostic.range.start.line}:${diagnostic.range.start.column}: ${diagnostic.severity}: ${diagnostic.message}${rule}`);
  }
  lines.push(`${result.summary.files} file(s), ${result.summary.diagnostics.error} error(s), ${result.summary.diagnostics.warning} warning(s)`);
  if (lintSummary.disabledRules.length > 0) lines.push(`disabled rule(s): ${lintSummary.disabledRules.join(", ")}`);
  if (lintSummary.ignoredRanges > 0) lines.push(`${lintSummary.ignoredRanges} finding(s) ignored by tkr-lint.json`);
  if (lintSummary.unassessed.length > 0) {
    // A skipped analysis is not a clean result, so the report says which rules did not run and why.
    const byRule = new Map<string, Set<string>>();
    for (const entry of lintSummary.unassessed) {
      const reasons = byRule.get(entry.rule) ?? new Set<string>();
      reasons.add(entry.reason);
      byRule.set(entry.rule, reasons);
    }
    const parts = [...byRule].map(([rule, reasons]) => `${rule} (${[...reasons].join(", ")})`);
    lines.push(`not fully checked: ${parts.join("; ")}`);
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
