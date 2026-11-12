/**
 * Behavior-preserving legacy edits (docs/spec/engine/rpgcode-dialects.md and
 * docs/spec/engine/rpgcode-tooling.md#tool-4). The Toolkit 2 converter is only
 * used when the caller explicitly identifies the source dialect.
 */
import { compileInline, normaliseTk2, ScriptError, tokenizeObjects, type Program, type ScriptDialect } from "@tk-reawakened/core";
import type { TextEdit } from "./diagnostics.ts";

/** These calls can read or execute source outside the one-file comparison. */
const DYNAMIC_SOURCE_COMMANDS: Readonly<Record<string, true>> = {
  include: true, executeprogram: true, replaceprogram: true, thread: true, run: true, change: true, rpgcode: true,
};

export type LegacyFix = {
  readonly rule: string;
  readonly title: string;
  readonly edits: readonly TextEdit[];
};

/** Apply non-overlapping, single-line edits from right to left. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const lines = source.split("\n");
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line;
    return b.range.start.column - a.range.start.column;
  });
  for (const item of sorted) {
    const index = item.range.start.line - 1;
    const line = lines[index];
    if (line === undefined) continue;
    lines[index] = line.slice(0, item.range.start.column - 1) + item.newText + line.slice(item.range.end.column);
  }
  return lines.join("\n");
}

function edit(line: number, from: number, to: number, newText: string): TextEdit {
  return { range: { start: { line, column: from }, end: { line, column: to } }, newText };
}

/** Compare code and execution metadata, not source spans or source hashes. */
function behavior(program: Program): string {
  return JSON.stringify({
    ops: program.ops.map(({ pos, ...op }) => op),
    functions: program.functions,
    classes: Object.fromEntries(Object.entries(program.classes).map(([name, cls]) => [
      name,
      { ...cls, members: cls.members.map(({ line, col, endCol, ...member }) => member) },
    ])),
    labels: program.labels,
    statements: program.statements,
    files: program.files,
    fileKeys: program.fileKeys,
    includes: program.units.flatMap((unit) => unit.requests.map(({ path, implicit, line }) => ({ path, implicit, line }))),
  });
}

function sameBehavior(original: string, fixed: string, dialect: ScriptDialect): boolean {
  try {
    const before = compileInline(original, "<migration>", dialect);
    const after = compileInline(fixed, "<migration>");
    if (dialect === "tk2" && [before, after].some((program) =>
      program.units.some((unit) => unit.requests.length > 0) ||
      program.ops.some((op) => op.op === "call" && Object.hasOwn(DYNAMIC_SOURCE_COMMANDS, op.name)))) return false;
    return behavior(before) === behavior(after);
  } catch (error) {
    if (error instanceof ScriptError) return false;
    throw error;
  }
}

/** Whether a TK2 program and the proposed 3.1 source compile to the same behavior. */
export function sameLowering(original: string, fixed: string): boolean {
  return sameBehavior(original, fixed, "tk2");
}

/** Return a TK2 trailing star comment after a standalone command, if present. */
function trailingComment(line: string): string | null {
  const match = /^\s*#(?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*\s*\(/.exec(line);
  if (match === null) return null;
  let depth = 1;
  let quoted = false;
  for (let index = match[0].length; index < line.length; index++) {
    const ch = line[index];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth++;
    if (ch === ")" && --depth === 0) {
      const suffix = line.slice(index + 1);
      const comment = /^[ \t]+\*(.*)$/.exec(suffix);
      return comment === null ? null : ` //${comment[1]}`;
    }
  }
  return null;
}

/** Convert all TK2 lines as one action; never drop comment text or line endings. */
function migrateTk2(source: string): LegacyFix[] {
  // The spec conflicts with dynamic array indices for this shape (#2050).
  // Do not offer a conversion whose meaning has not been established.
  if (/\[\s*\d*[A-Za-z_]\w*[$!]?\s*\]/.test(source)) return [];
  let converted: string[];
  try {
    converted = normaliseTk2(source).split("\n");
  } catch (error) {
    if (error instanceof ScriptError) return [];
    throw error;
  }
  const lines = source.split("\n");
  const edits: TextEdit[] = [];
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index]!;
    const content = original.endsWith("\r") ? original.slice(0, -1) : original;
    const ending = original.endsWith("\r") ? "\r" : "";
    const trimmed = content.trimStart();
    if (trimmed === "" || trimmed.startsWith("*")) continue;
    // Until comment parsing is shared, refuse these rather than delete or reinterpret them.
    if (trimmed.includes("//") || trimmed.includes("/*") || trimmed.includes("*/")) return [];
    const indent = content.slice(0, content.length - trimmed.length);
    const rewritten = indent + (converted[index] ?? "") + (trailingComment(content) ?? "") + ending;
    if (original !== rewritten) edits.push(edit(index + 1, 1, original.length, rewritten));
  }
  if (edits.length === 0) return [];
  const fixed = applyEdits(source, edits);
  if (!sameLowering(source, fixed)) return [];
  return [{ rule: "dialect/tk2-to-tk3", title: "Preview Toolkit 2.x conversion in an unsaved 3.1 file", edits }];
}

/** Offer only edits proved against the caller-selected source dialect. */
export function legacyFixes(source: string, dialect: ScriptDialect = "tk3"): readonly LegacyFix[] {
  if (dialect === "tk2") return migrateTk2(source);
  let tokens;
  try {
    tokens = tokenizeObjects(source);
  } catch (error) {
    if (error instanceof ScriptError) return [];
    throw error;
  }
  const lines = source.split("\n");
  const fixes: LegacyFix[] = [];
  for (const token of tokens) {
    if (token.kind !== "identifier") continue;
    const written = (lines[token.line - 1] ?? "").slice(token.col - 1, token.endCol);
    if (!written.endsWith("!") && !written.endsWith("$")) continue;
    const edits = [edit(token.line, token.endCol, token.endCol, "")];
    if (sameBehavior(source, applyEdits(source, edits), "tk3")) {
      fixes.push({ rule: "dialect/sigil", title: `Drop the ignored sigil in \`${written}\``, edits });
    }
  }
  return fixes;
}
