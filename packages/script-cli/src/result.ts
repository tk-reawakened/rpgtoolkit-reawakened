/**
 * The `tkr-script-result/1` envelope shared by every `tkr script` subcommand
 * (docs/spec/engine/rpgcode-tooling.md#tool-9).
 *
 * The shape is intentionally plain so it can be written without a runtime JSON
 * Schema dependency; a separate guard checks the fields a test needs.
 */

import type { Diagnostic } from "@tk-reawakened/script-tools";

export type { Diagnostic } from "@tk-reawakened/script-tools";

export const RESULT_SCHEMA = "tkr-script-result/1";
export const TOOL_NAME = "tkr";

export type Subcommand = "check" | "fmt" | "test" | "docs" | "index";

export type ResultStatus = "ok" | "findings" | "error";

export type Summary = {
  readonly files: number;
  readonly diagnostics: {
    readonly error: number;
    readonly warning: number;
    readonly info: number;
    readonly hint: number;
  };
  readonly changed: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
};

export type ScriptResult = {
  readonly schema: typeof RESULT_SCHEMA;
  readonly tool: typeof TOOL_NAME;
  readonly subcommand: Subcommand;
  readonly status: ResultStatus;
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly diagnostics: readonly ResultDiagnostic[];
  readonly summary: Summary;
  readonly results: unknown;
};

export const emptySummary: Summary = {
  files: 0,
  diagnostics: { error: 0, warning: 0, info: 0, hint: 0 },
  changed: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
};

export function makeResult(
  subcommand: Subcommand,
  exitCode: 0 | 1 | 2 | 3,
  diagnostics: readonly ResultDiagnostic[],
  summary: Summary,
  results: unknown,
): ScriptResult {
  const status: ResultStatus = exitCode === 0 ? "ok" : exitCode === 1 ? "findings" : "error";
  return {
    schema: RESULT_SCHEMA,
    tool: TOOL_NAME,
    subcommand,
    status,
    exitCode,
    diagnostics,
    summary,
    results,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Deterministic JSON: every object is emitted with keys in lexicographic order,
 * arrays keep their order, and a single trailing newline is added. This is the
 * byte-stability promise TOOL-9 makes for the same inputs.
 */
export function stableStringify(value: unknown): string {
  return `${stableStringifyValue(value, "  ")}\n`;
}

function stableStringifyValue(value: unknown, indent: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const deeper = `${indent}  `;
    const items = value.map((item) => `${deeper}${stableStringifyValue(item, deeper)}`).join(",\n");
    return `[\n${items}\n${indent}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort(compareKeys);
    if (keys.length === 0) return "{}";
    const deeper = `${indent}  `;
    const items = keys.map((key) => `${deeper}${JSON.stringify(key)}: ${stableStringifyValue((value as Record<string, unknown>)[key], deeper)}`).join(",\n");
    return `{\n${items}\n${indent}}`;
  }
  return "null";
}

export function isResultStatus(value: unknown): value is ResultStatus {
  return value === "ok" || value === "findings" || value === "error";
}

export function isSubcommand(value: unknown): value is Subcommand {
  return value === "check" || value === "fmt" || value === "test" || value === "docs" || value === "index";
}

export function isPosition(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (typeof value.line !== "number" || typeof value.column !== "number") return false;
  return true;
}

export function isRange(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isPosition(value.start) && isPosition(value.end);
}

export type ResultDiagnostic = Diagnostic & { readonly file: string };

export function isDiagnostic(value: unknown): value is ResultDiagnostic {
  if (!isPlainObject(value)) return false;
  if (typeof value.code !== "string" || typeof value.severity !== "string") return false;
  if (typeof value.file !== "string" || typeof value.message !== "string") return false;
  if (!isRange(value.range)) return false;
  if (value.rule !== undefined && typeof value.rule !== "string") return false;
  return true;
}

export function isSummary(value: unknown): value is Summary {
  if (!isPlainObject(value)) return false;
  const required = ["files", "changed", "passed", "failed", "skipped"] as const;
  for (const key of required) if (typeof value[key] !== "number") return false;
  const diag = value.diagnostics;
  if (!isPlainObject(diag)) return false;
  for (const key of ["error", "warning", "info", "hint"] as const) {
    if (typeof diag[key] !== "number") return false;
  }
  return true;
}

export function isScriptResult(value: unknown): value is ScriptResult {
  if (!isPlainObject(value)) return false;
  if (value.schema !== RESULT_SCHEMA) return false;
  if (value.tool !== TOOL_NAME) return false;
  if (!isSubcommand(value.subcommand)) return false;
  if (!isResultStatus(value.status)) return false;
  if (![0, 1, 2, 3].includes(value.exitCode as number)) return false;
  if (!Array.isArray(value.diagnostics) || !value.diagnostics.every(isDiagnostic)) return false;
  if (!isSummary(value.summary)) return false;
  return true;
}
