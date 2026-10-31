/**
 * The one diagnostic model (docs/spec/engine/rpgcode-tooling.md#tool-3).
 *
 * One shape serves the parser, the linter, the language server, the CLI and CI:
 * a stable `code`, a `severity`, an exact `range`, one actionable `message`, and
 * - for a lint rule - the `rule` id and an optional `fix`. Nothing here reads a
 * file or a clock: a range is a value, and the caller owns the text.
 */

import type { SourcePos } from "@tk-reawakened/core";

/**
 * One source position. `line` and `column` are 1-based and `column` counts
 * UTF-16 code units of the decoded source
 * (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention).
 */
export type Position = {
  readonly line: number;
  readonly column: number;
};

/** A start and an inclusive end, both on one line for every range this package raises. */
export type Range = {
  readonly start: Position;
  readonly end: Position;
};

export type Severity = "error" | "warning" | "info" | "hint";

/** One rewrite over a range; `rule` names the rule that produced it. */
export type TextEdit = {
  readonly range: Range;
  readonly newText: string;
  readonly rule?: string;
};

export type Diagnostic = {
  /** The stable failure code (`syntax.error`) or lint rule id (`lint/unused-variable`). */
  readonly code: string;
  readonly severity: Severity;
  readonly range: Range;
  readonly message: string;
  /** Present only when a lint rule raised the diagnostic. */
  readonly rule?: string;
  /** Present only when the rule can rewrite the text safely. */
  readonly fix?: readonly TextEdit[];
};

/**
 * The text a range names. TOOL-3 promises `sliceRange` is exact: it returns the
 * code units the diagnostic is about and nothing else. `end` is inclusive, so a
 * zero-width range slices nothing.
 */
export function sliceRange(source: string, range: Range): string {
  const lines = source.split("\n");
  if (range.end.line === range.start.line) {
    return (lines[range.start.line - 1] ?? "").slice(range.start.column - 1, range.end.column);
  }
  const first = (lines[range.start.line - 1] ?? "").slice(range.start.column - 1);
  const middle = lines.slice(range.start.line, range.end.line - 1);
  const last = (lines[range.end.line - 1] ?? "").slice(0, range.end.column);
  return [first, ...middle, last].join("\n");
}

/**
 * Map an engine `SourcePos` to a range. A position with a span names exactly
 * its token; one without (a synthesized instruction, a diagnostic about a file)
 * names the whole line, because there is no narrower fact to state.
 */
export function rangeOf(pos: SourcePos, source: string): Range {
  if (pos.col !== undefined && pos.endCol !== undefined) {
    return {
      start: { line: pos.line, column: pos.col },
      end: { line: pos.line, column: pos.endCol },
    };
  }
  const text = (source.split("\n")[pos.line - 1] ?? "").replace(/\r$/, "");
  return {
    start: { line: pos.line, column: 1 },
    end: { line: pos.line, column: Math.max(1, text.length) },
  };
}
