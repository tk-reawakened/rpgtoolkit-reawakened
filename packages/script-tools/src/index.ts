/**
 * `@tk-reawakened/script-tools` - the shared RPGCode tooling library of epic 10
 * (docs/spec/engine/rpgcode-tooling.md).
 *
 * One `analyse()` entry produces the TOOL-3 diagnostic model over the core
 * parser; `projectHelp()` and `helpFor()` project the command documentation for
 * hover, call tips and the documentation site. The package is pure: no Node API,
 * no DOM, no I/O - every input is a string or a value the caller passes in.
 */

export { analyse } from "./analyse.ts";
export type { Analysis, AnalyseOptions } from "./analyse.ts";
export { applyEdits, DIAGNOSTIC_ONLY_ROWS, legacyFixes, sameLowering } from "./fixes.ts";
export type { LegacyFix } from "./fixes.ts";
export { canonicalNames, formatChanged, formatCheck, formatSource } from "./format.ts";
export type { FormatCheck, FormatDialect, FormatFile, FormatOptions, FormatResult, FormatSkipReason } from "./format.ts";
export { lint, readLintConfig, RULES } from "./lint.ts";
export type { LintConfig, LintIgnore, LintResult, LintSeverity, LintSummary, LintOptions, RuleDefinition, RuleId } from "./lint.ts";
export { rangeOf, sliceRange } from "./diagnostics.ts";
export type { Diagnostic, Position, Range, Severity, TextEdit } from "./diagnostics.ts";
export { helpFor, projectHelp } from "./help.ts";
export type { HelpEntry } from "./help.ts";
export { buildIndex, INDEX_SCHEMA } from "./index-document.ts";
export type {
  IndexCall,
  IndexClass,
  IndexDocument,
  IndexFunction,
  IndexInclude,
  IndexLabel,
  IndexListener,
  IndexMember,
  IndexMethod,
  IndexOptions,
  IndexPos,
  IndexProgram,
  IndexProgramInput,
  IndexReference,
  IndexStartup,
} from "./index-document.ts";
