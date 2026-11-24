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

/** Explain the loose-quote case where 3.1 cannot preserve a TK2 literal. */
export function tk2ConversionRefusal(source: string): string | null {
  try {
    normaliseTk2(source);
    return null;
  } catch (error) {
    if (error instanceof ScriptError && error.message.startsWith("Cannot convert loose dialogue containing a double quote:")) return error.message;
    if (error instanceof ScriptError) return null;
    throw error;
  }
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
  const lines = fixed.split("\n");
  for (let index = 1; index + 1 < tokens.length; index++) {
    const open = tokens[index - 1]!;
    const word = tokens[index]!;
    const close = tokens[index + 1]!;
    if (open.kind !== "op" || open.text !== "[" || word.kind !== "identifier" || close.kind !== "op" || close.text !== "]") continue;
    const written = lines[word.line - 1]!.slice(word.col - 1, word.endCol);
    const words = found.get(word.line);
    if (words === undefined) found.set(word.line, [written]);
    else words.push(written);
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

/** Where a conversion stopped, so a person can find it (docs/spec/engine/rpgcode-tooling.md#tool-11-transforms). */
export type UnsupportedFragment = {
  /** 1-based line, or `null` when the reason is about the whole file. */
  readonly line: number | null;
  readonly code: "dialogue-quote" | "comment-marker" | "dynamic-source" | "compile-error" | "reading-dependent" | "legacy-prefix-line";
  readonly message: string;
};

const DIALOGUE_QUOTE = "Cannot convert loose dialogue containing a double quote";

/** Every fragment the Toolkit 2.x conversion refuses, with its line (the "Not converted" list of the conversion contract). */
export function tk2UnsupportedFragments(source: string): readonly UnsupportedFragment[] {
  const found: UnsupportedFragment[] = [];
  const lines = source.split("\n");
  // A loose dialogue line with a double quote stops normaliseTk2 at the first; blank each in turn to list them all.
  let working = lines;
  let converted: string[] | null = null;
  for (let attempt = 0; attempt <= lines.length; attempt += 1) {
    try {
      converted = normaliseTk2(working.join("\n")).split("\n");
      break;
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      const line = error.pos?.line ?? null;
      if (error.message.startsWith(DIALOGUE_QUOTE) && line !== null) {
        found.push({ line, code: "dialogue-quote", message: "Loose dialogue with a double quote: 3.1 string literals have no escape for a quote, so the text cannot be kept exactly." });
        working = working.map((text, index) => (index === line - 1 ? "" : text));
        continue;
      }
      found.push({ line, code: "compile-error", message: error.message });
      break;
    }
  }
  if (converted !== null) {
    for (let index = 0; index < lines.length; index++) {
      const content = lines[index]!.endsWith("\r") ? lines[index]!.slice(0, -1) : lines[index]!;
      const trimmed = content.trimStart();
      if (trimmed === "" || trimmed.startsWith("*") || working[index] !== lines[index]) continue;
      if (!isDialogue(trimmed, converted[index] ?? "") && /\/\/|\/\*|\*\//.test(withoutStrings(content))) {
        found.push({ line: index + 1, code: "comment-marker", message: "A code line holds `//`, `/*` or `*/` outside a string; the Toolkit 2.x meaning of those markers is not specified, so a conversion cannot show it keeps it." });
      }
    }
  }
  try {
    const program = compileInline(source, "<migration>", "tk2");
    for (const unit of program.units) {
      for (const request of unit.requests) {
        found.push({ line: request.line, code: "dynamic-source", message: `${request.implicit ? "An implicit call into" : "An include of"} ${request.path} reads another program, so one file cannot be compared on its own.` });
      }
    }
    for (const op of program.ops) {
      if (op.op === "call" && Object.hasOwn(DYNAMIC_SOURCE_COMMANDS, op.name)) {
        found.push({ line: op.pos?.line ?? null, code: "dynamic-source", message: `${op.name} loads or runs another program, so one file cannot be compared on its own.` });
      }
    }
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    if (!found.some((fragment) => fragment.code === "compile-error")) found.push({ line: error.pos?.line ?? null, code: "compile-error", message: error.message });
  }
  const seen = new Set<string>();
  return found.filter((fragment) => {
    const key = `${fragment.line}|${fragment.code}|${fragment.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** What converting a Toolkit 2.x source gives (docs/spec/engine/rpgcode-dialects.md#tk2-conversion-contract). */
export type Tk2Outcome =
  | { readonly kind: "converted"; readonly fix: LegacyFix }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly code: "unsupported-fragments" | "not-proven"; readonly unsupported: readonly UnsupportedFragment[] };

function tk2Refusal(source: string): Tk2Outcome {
  const unsupported = tk2UnsupportedFragments(source);
  return { kind: "refused", code: unsupported.length > 0 ? "unsupported-fragments" : "not-proven", unsupported };
}

/** Convert all TK2 lines as one action; never drop comment text or line endings. */
export function convertTk2(source: string): Tk2Outcome {
  let converted: string[];
  try {
    converted = normaliseTk2(source).split("\n");
  } catch (error) {
    if (error instanceof ScriptError) return tk2Refusal(source);
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
    if (!isDialogue(trimmed, line) && /\/\/|\/\*|\*\//.test(withoutStrings(content))) return tk2Refusal(source);
    const indent = content.slice(0, content.length - trimmed.length);
    rewritten[index] = indent + line;
    comments[index] = trailingComment(content) ?? "";
  }
  const code = dropSigils(rewritten);
  if (code === null) return tk2Refusal(source);
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
  // Nothing to rewrite still has to be a program the conversion would accept: a source that does not compile in either
  // reading is refused with the reason, never reported as already 3.1.
  if (edits.length === 0) return sameLowering(source, source) ? { kind: "unchanged" } : tk2Refusal(source);
  // The review comments are part of the offered text, so compare it as offered.
  if (!sameLowering(source, applyEdits(source, edits))) return tk2Refusal(source);
  const title = "Preview Toolkit 2.x conversion in an unsaved 3.1 file";
  if (reviews.length === 0) return { kind: "converted", fix: { rule: "dialect/tk2-to-tk3", title, edits } };
  const noun = reviews.length === 1 ? "bare index" : "bare indices";
  return { kind: "converted", fix: { rule: "dialect/tk2-to-tk3", title: `${title} (${reviews.length} ${noun} to review)`, edits, reviews } };
}

/** What a person is told about the reading an in-place edit was proved under. */
export type LegacyOptions = {
  /**
   * The running project assessed the document as 3.1, so the dialect is a project fact rather than the editor's language
   * mode and an in-place edit need only be proved under 3.1 (docs/spec/engine/rpgcode-tooling.md#tool-4).
   */
  readonly dialectEstablished?: boolean;
};

/** Whether a 3.1 in-place edit keeps the program's behaviour under every reading the document may have. */
export function sameInPlaceBehavior(original: string, fixed: string, options: LegacyOptions = {}): boolean {
  return sameBehavior(original, fixed, "tk3") && (options.dialectEstablished === true || sameBehavior(original, fixed, "tk2", "tk2"));
}

/** The ignored-sigil quick fixes of a 3.1 source, and the spots where the 3.1 reading allows the edit but another reading does not. */
export function sigilFixes(source: string, options: LegacyOptions = {}): { readonly fixes: readonly LegacyFix[]; readonly readingDependent: readonly UnsupportedFragment[] } {
  let tokens;
  try {
    tokens = tokenizeObjects(source);
  } catch (error) {
    if (error instanceof ScriptError) return { fixes: [], readingDependent: [] };
    throw error;
  }
  const lines = source.split("\n");
  const fixes: LegacyFix[] = [];
  const readingDependent: UnsupportedFragment[] = [];
  for (const token of tokens) {
    if (token.kind !== "identifier") continue;
    const written = (lines[token.line - 1] ?? "").slice(token.col - 1, token.endCol);
    if (!written.endsWith("!") && !written.endsWith("$")) continue;
    const edits = [edit(token.line, token.endCol, token.endCol, "")];
    const fixed = applyEdits(source, edits);
    if (!sameBehavior(source, fixed, "tk3")) continue;
    if (sameInPlaceBehavior(source, fixed, options)) {
      fixes.push({ rule: "dialect/sigil", title: `Drop the ignored sigil in \`${written}\``, edits });
    } else {
      readingDependent.push({ line: token.line, code: "reading-dependent", message: `\`${written}\` is read differently if this file is Toolkit 2.x, and the running project has not said which it is.` });
    }
  }
  return { fixes, readingDependent };
}

/**
 * The lines of a 3.1 source that begin with a legacy `#` command prefix (editor-features T-44, "Auto-command wizard").
 * The 3.1 lexer ignores such a line whole (LEX-6, docs/spec/engine/rpgcode-language.md), so removing the `#` would make
 * a dead line run and is never behaviour-preserving; the cleanup reports them instead. `#include` is a directive, and
 * a `#` inside a block comment is comment text.
 */
export function legacyPrefixLines(source: string): readonly UnsupportedFragment[] {
  const found: UnsupportedFragment[] = [];
  let inBlock = false;
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!;
    if (!inBlock && /^\s*#/.test(text) && !/^\s*#\s*include\b/i.test(text)) {
      found.push({ line: index + 1, code: "legacy-prefix-line", message: "This line begins with `#`, which 3.1 ignores whole; removing the `#` would make the line run, so it is left as written." });
      continue;
    }
    // A line whose first non-blank character is `*` is a star comment to the end of the line (LEX-4), so nothing in it
    // opens a block comment; inside a block, a leading `*/` still closes it.
    if (!inBlock && /^[ \t]*\*/.test(text)) continue;
    const code = withoutStrings(text);
    for (let at = 0; at < code.length - 1; at++) {
      if (!inBlock && code[at] === "/" && code[at + 1] === "/") break;
      if (!inBlock && code[at] === "*" && code[at + 1] === "*") break;
      if (!inBlock && code[at] === "/" && code[at + 1] === "*") { inBlock = true; at++; }
      else if (inBlock && code[at] === "*" && code[at + 1] === "/") { inBlock = false; at++; }
    }
  }
  return found;
}

/** Offer only edits proved against the caller-selected source dialect. */
export function legacyFixes(source: string, dialect: ScriptDialect = "tk3", options: LegacyOptions = {}): readonly LegacyFix[] {
  if (dialect === "tk2") {
    const outcome = convertTk2(source);
    return outcome.kind === "converted" ? [outcome.fix] : [];
  }
  return sigilFixes(source, options).fixes;
}
