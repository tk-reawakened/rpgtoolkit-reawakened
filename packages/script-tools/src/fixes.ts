/**
 * The legacy-form quick fixes of docs/spec/engine/rpgcode-dialects.md:57-69.
 *
 * Each fix is a set of span edits over the source text - never an AST printer,
 * which would drop comments and whitespace (TOOL-4's ruling) - and each is
 * re-parsed after it is applied: a fix whose result does not compile is dropped
 * rather than offered, so a rewrite can never leave a worse diagnostic behind.
 *
 * A row is offered only when it is a rewrite of the *same* program. Two rows are
 * deliberately diagnostic-only: `#Method` is the same keyword in 3.1, and a loose
 * text line cannot be told from a typo without guessing, so the linter (10.6)
 * reports them instead.
 */

import { compileInline, compileTk2, tokenize } from "@tk-reawakened/core";
import { analyse } from "./analyse.ts";
import type { TextEdit } from "./diagnostics.ts";

export type LegacyFix = {
  /** The dialect row this rewrite implements, as `<area>/<rule>` (TOOL-3 rule id). */
  readonly rule: string;
  readonly title: string;
  readonly edits: readonly TextEdit[];
};

/** Apply span edits: they never overlap, and replacements are applied right to left. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const lines = source.split("\n");
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.column - a.range.start.column;
  });
  for (const edit of sorted) {
    const index = edit.range.start.line - 1;
    const line = lines[index];
    if (line === undefined) continue;
    const start = edit.range.start.column - 1;
    const end = edit.range.end.column;
    lines[index] = line.slice(0, start) + edit.newText + line.slice(end);
  }
  return lines.join("\n");
}

function edit(line: number, from: number, to: number, newText: string): TextEdit {
  return { range: { start: { line, column: from }, end: { line, column: to } }, newText };
}

const OBSOLETE = new Set(["dos", "windows", "gone", "over", "reset", "win"]);

/** Every rewrite the source admits, before the re-parse filter. */
function candidates(source: string): LegacyFix[] {
  const fixes: LegacyFix[] = [];
  const lines = source.split("\n");

  // `#Command(arg)` / `#ReturnMethod(x)` / an obsolete `#Dos` control line (TK2).
  lines.forEach((text, index) => {
    const line = index + 1;
    const match = /^(\s*)#(\w+)\s*(?:\((.*)\))?\s*$/.exec(text);
    if (match === null) return;
    const indent = match[1]!;
    const name = match[2]!;
    const argument = match[3];
    if (OBSOLETE.has(name.toLowerCase())) {
      fixes.push({ rule: "dialect/obsolete-control", title: `Remove the obsolete \`#${name}\` engine control`, edits: [edit(line, 1, text.length, indent)] });
      return;
    }
    if (name.toLowerCase() === "returnmethod" && argument !== undefined) {
      fixes.push({ rule: "dialect/return-method", title: "Rewrite `#ReturnMethod(x)` as `return x`", edits: [edit(line, 1, text.length, `${indent}return ${argument.trim()}`)] });
      return;
    }
    if (argument !== undefined && !/^".*"$/.test(argument.trim())) {
      fixes.push({
        rule: "dialect/unquoted-command-argument",
        title: `Quote the unquoted argument of \`#${name}\``,
        edits: [edit(line, 1, text.length, `${indent}${name.toLowerCase()}("${argument.trim()}")`)],
      });
    }
  });

  // Sigils: `x!` and `name$` are ignored by the lexer, so deleting the sigil keeps the program.
  for (const token of tokenize(source)) {
    if (token.kind !== "identifier") continue;
    const text = (lines[token.line - 1] ?? "").slice(token.col - 1, token.endCol);
    if (text.endsWith("!") || text.endsWith("$")) {
      fixes.push({
        rule: "dialect/sigil",
        title: `Drop the ignored sigil in \`${text}\``,
        edits: [edit(token.line, token.endCol, token.endCol, "")],
      });
    }
  }

  return fixes;
}

/**
 * Rows the page lists whose fix is **not** behaviour-preserving, so they are
 * reported and never rewritten:
 *
 * - `if (x = 5)`: as a 3.1 program that is an assignment, and rewriting it to a
 *   comparison changes what it does. It is a TK2-frontend reading, corrected
 *   when that source is migrated, not a 3.1 rewrite.
 * - unquoted map keys `m[key]`: in 3.1 `m[key]` indexes by the variable `key`;
 *   quoting it would silently turn a variable index into a string key.
 * - loose text lines: a line with no `#` may be a typo, a label or authored
 *   prose, and no rewrite can tell which without guessing.
 */
export const DIAGNOSTIC_ONLY_ROWS = ["if (x = 5)", "m[key]", "loose text lines"] as const;

/**
 * The fixes the source admits, each applied and re-parsed: a rewrite that leaves
 * a syntax error is dropped, because offering it would trade one diagnostic for
 * a worse one.
 */
export function legacyFixes(source: string): readonly LegacyFix[] {
  return candidates(source).filter((fix) => analyse(applyEdits(source, fix.edits)).ok);
}

/**
 * Whether a rewrite lowers to the same instruction array as the TK2 frontend's
 * own reading of the original. Identical ops mean identical behaviour for every
 * input (G3 determinism), which is stronger than one run's hash.
 */
export function sameLowering(original: string, fixed: string): boolean {
  // The original is read by the TK2 frontend and the fixed text by the 3.1
  // reader: identical instructions mean the migration changed nothing about
  // what the program does. Source positions are not compared - the rewrite
  // moves text on the line, and a position is not behaviour.
  const body = (ops: readonly { readonly pos?: unknown }[]): string =>
    JSON.stringify(ops.map((op) => ({ ...op, pos: undefined })));
  return body(compileTk2(original).ops) === body(compileInline(fixed, "<tk2>").ops);
}
