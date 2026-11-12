/**
 * Behavior-preserving legacy edits (docs/spec/engine/rpgcode-dialects.md and
 * docs/spec/engine/rpgcode-tooling.md#tool-4). The Toolkit 2 converter is only
 * used when the caller explicitly identifies the source dialect.
 */
import { compileInline, normaliseTk2, ScriptError, tokenizeObjects, type Program, type ScriptDialect } from "@tk-reawakened/core";
import type { TextEdit } from "./diagnostics.ts";

/** These calls can read or execute source outside the one-file comparison. */
const DYNAMIC_SOURCE_COMMANDS: Readonly<Record<string, true>> = {
  include: true, executeprogram: true, replaceprogram: true, thread: true, tellthread: true, run: true, change: true, rpgcode: true,
};

/** A converted spot a person should check; the conversion kept its meaning but the intent is unclear. */
export type LegacyReview = {
  /** 1-based line of the source (and of the converted text: conversion never changes the line count). */
  readonly line: number;
  /** The index as written in the converted text, without brackets. */
  readonly index: string;
  readonly message: string;
};

export type LegacyFix = {
  readonly rule: string;
  readonly title: string;
  readonly edits: readonly TextEdit[];
  /** Bare TK2 indices preserved as variable indices (docs/spec/engine/rpgcode-dialects.md#tk2-bare-index). */
  readonly reviews?: readonly LegacyReview[];
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

function sameBehavior(original: string, fixed: string, dialect: ScriptDialect, fixedDialect: ScriptDialect = "tk3"): boolean {
  try {
    const before = compileInline(original, "<migration>", dialect);
    const after = compileInline(fixed, "<migration>", fixedDialect);
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

/** Remove quoted strings so comment markers are only seen in code. */
function withoutStrings(text: string): string {
  return text.replace(/"[^"]*"/g, '""');
}

/** A converted loose dialogue line: exactly `mwin("…")` produced from a line with no `#`. */
function isDialogue(trimmed: string, converted: string): boolean {
  if (trimmed.startsWith("#") || !converted.startsWith("mwin(")) return false;
  try {
    const tokens = tokenizeObjects(converted).filter((token) => token.kind !== "end" && token.kind !== "eof");
    return tokens.length === 4 && tokens[2]!.kind === "string" && tokens[3]!.kind === "op" && tokens[3]!.text === ")";
  } catch (error) {
    if (error instanceof ScriptError) return false;
    throw error;
  }
}

/**
 * Find bare single-word indices (`m[key]`) in converted 3.1 text. Both dialects
 * read them as variable indices; a person must confirm a literal key was not meant
 * (docs/spec/engine/rpgcode-dialects.md#tk2-bare-index, #2050).
 */
function bareIndices(fixed: string): Map<number, string[]> {
  const found = new Map<number, string[]>();
  const tokens = tokenizeObjects(fixed);
  for (let index = 1; index + 1 < tokens.length; index++) {
    const open = tokens[index - 1]!;
    const word = tokens[index]!;
    const close = tokens[index + 1]!;
    if (open.kind !== "op" || open.text !== "[" || word.kind !== "identifier" || close.kind !== "op" || close.text !== "]") continue;
    const written = fixed.split("\n")[word.line - 1]!.slice(word.col - 1, word.endCol);
    found.set(word.line, [...(found.get(word.line) ?? []), written]);
  }
  return found;
}

/** Drop every ignored `!`/`$` sigil the TK2 frontend left inside expressions, editing `lines` in place. */
function dropSigils(lines: string[]): string | null {
  let tokens;
  try {
    tokens = tokenizeObjects(lines.join("\n"));
  } catch (error) {
    if (error instanceof ScriptError) return null;
    throw error;
  }
  for (const token of [...tokens].reverse()) {
    if (token.kind !== "identifier") continue;
    const line = lines[token.line - 1]!;
    const last = line[token.endCol - 1];
    if (last === "!" || last === "$") lines[token.line - 1] = line.slice(0, token.endCol - 1) + line.slice(token.endCol);
  }
  return lines.join("\n");
}

function reviewMessage(word: string): string {
  return `[${word}] reads the variable ${word}; write ["${word}"] if a literal key was meant`;
}

/** Convert all TK2 lines as one action; never drop comment text or line endings. */
function migrateTk2(source: string): LegacyFix[] {
  let converted: string[];
  try {
    converted = normaliseTk2(source).split("\n");
  } catch (error) {
    if (error instanceof ScriptError) return [];
    throw error;
  }
  const lines = source.split("\n");
  const rewritten: string[] = [];
  const comments: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index]!;
    const content = original.endsWith("\r") ? original.slice(0, -1) : original;
    const trimmed = content.trimStart();
    rewritten.push(content);
    comments.push("");
    if (trimmed === "" || trimmed.startsWith("*")) continue;
    const line = converted[index] ?? "";
    // TK2 does not specify `//` or `/* */` in code, so their meaning cannot be shown to be kept.
    // Dialogue keeps them as text inside its string.
    if (!isDialogue(trimmed, line) && /\/\/|\/\*|\*\//.test(withoutStrings(content))) return [];
    const indent = content.slice(0, content.length - trimmed.length);
    rewritten[index] = indent + line;
    comments[index] = trailingComment(content) ?? "";
  }
  const code = dropSigils(rewritten);
  if (code === null) return [];
  const reviews: LegacyReview[] = [];
  for (const [line, words] of bareIndices(code)) {
    comments[line - 1] += ` // TKR review: ${words.map(reviewMessage).join("; ")}`;
    for (const word of words) reviews.push({ line, index: word, message: reviewMessage(word) });
  }
  const edits: TextEdit[] = [];
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index]!;
    const ending = original.endsWith("\r") ? "\r" : "";
    const next = rewritten[index]! + comments[index] + ending;
    if (original !== next) edits.push(edit(index + 1, 1, original.length, next));
  }
  if (edits.length === 0) return [];
  // The review comments are part of the offered text, so compare it as offered.
  if (!sameLowering(source, applyEdits(source, edits))) return [];
  const title = "Preview Toolkit 2.x conversion in an unsaved 3.1 file";
  if (reviews.length === 0) return [{ rule: "dialect/tk2-to-tk3", title, edits }];
  const noun = reviews.length === 1 ? "bare index" : "bare indices";
  return [{ rule: "dialect/tk2-to-tk3", title: `${title} (${reviews.length} ${noun} to review)`, edits, reviews }];
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
    const fixed = applyEdits(source, edits);
    if (sameBehavior(source, fixed, "tk3") && sameBehavior(source, fixed, "tk2", "tk2")) {
      fixes.push({ rule: "dialect/sigil", title: `Drop the ignored sigil in \`${written}\``, edits });
    }
  }
  return fixes;
}
