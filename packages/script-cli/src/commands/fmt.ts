/**
 * `tkr script fmt` — re-indent and canonicalise, or `--check` what would change.
 */

import { formatCheck, formatSource, type FormatDialect } from "@tk-reawakened/script-tools";
import { collectSourceFiles, writeTextFile } from "../files.ts";
import { emptySummary, makeResult, stableStringify, type ResultDiagnostic, type ScriptResult } from "../result.ts";

export type FmtResult = {
  readonly result: ScriptResult;
  readonly text: string;
};

export function runFmt(paths: readonly string[], dialect: FormatDialect, check: boolean, json: boolean): FmtResult {
  const diagnostics: ResultDiagnostic[] = [];
  const sources = collectSourceFiles(paths);
  const files = sources.map((file) => ({ path: file.path, source: file.source, dialect }));
  const checkResult = formatCheck(files, {});

  if (!check) {
    for (const file of sources) {
      const result = formatSource(file.source, { dialect });
      if (result.skipped === undefined && result.changed) {
        writeTextFile(file.path, result.text);
      }
    }
  }

  const changed = checkResult.changed;
  const skipped = checkResult.skipped.map((entry) => entry.path);
  const exitCode = changed.length > 0 || checkResult.skipped.length > 0 ? 1 : 0;

  for (const entry of checkResult.skipped) {
    diagnostics.push({
      code: "fmt.skipped",
      severity: "warning",
      file: entry.path,
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      message: `formatter refused ${entry.reason}: ${entry.path}`,
    });
  }

  const summary = { ...emptySummary, files: sources.length, changed: changed.length };
  const result = makeResult("fmt", exitCode, diagnostics, summary, { changed, skipped });
  const text = json ? stableStringify(result) : formatFmtText(result, check);
  return { result, text };
}

type FmtResults = {
  readonly changed: readonly string[];
  readonly skipped: readonly string[];
};

function asFmtResults(value: unknown): FmtResults {
  if (typeof value !== "object" || value === null) return { changed: [], skipped: [] };
  const record = value as Record<string, unknown>;
  const changed = Array.isArray(record.changed) ? record.changed.filter((item): item is string => typeof item === "string") : [];
  const skipped = Array.isArray(record.skipped) ? record.skipped.filter((item): item is string => typeof item === "string") : [];
  return { changed, skipped };
}

function formatFmtText(result: ScriptResult, check: boolean): string {
  const lines: string[] = [];
  const { changed, skipped } = asFmtResults(result.results);
  if (check) {
    for (const path of changed) lines.push(`would change: ${path}`);
  } else {
    for (const path of changed) lines.push(`formatted: ${path}`);
  }
  for (const path of skipped) lines.push(`skipped: ${path}`);
  lines.push(`${result.summary.files} file(s), ${changed.length} changed, ${skipped.length} skipped`);
  return lines.join("\n") + "\n";
}
