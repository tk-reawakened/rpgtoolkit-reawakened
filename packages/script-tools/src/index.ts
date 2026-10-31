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
export { rangeOf, sliceRange } from "./diagnostics.ts";
export type { Diagnostic, Position, Range, Severity, TextEdit } from "./diagnostics.ts";
export { helpFor, projectHelp } from "./help.ts";
export type { HelpEntry } from "./help.ts";
