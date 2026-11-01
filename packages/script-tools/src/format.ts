/**
 * The RPGCode formatter (docs/spec/engine/rpgcode-tooling.md#tool-4).
 *
 * A source-text rewrite with exactly two jobs: re-indent by brace depth, and
 * normalise built-in names, keywords and reserved literals to their canonical
 * lower-case spelling. It never parses-and-prints (that would drop comments and
 * whitespace), never reorders statements, never joins a continued line, never
 * touches a string's contents, a string map key, a comment, a label's spelling
 * or a `#include` directive, and never adds a final newline a file did not have.
 *
 * The canonical names come from every first-party plugin definition
 * (`FIRST_PARTY_PLUGINS`): the engine table plus the UI, graphics, movement,
 * battle and stock-RPG packs, because a partial list would mis-normalise those
 * commands exactly as the linter's old catalogue did.
 */

import { FIRST_PARTY_PLUGINS, commandDocumentation, tokenizeObjects, type Token } from "@tk-reawakened/core";

/** Keywords and reserved literals the 3.1 reader spells in lower case. */
const KEYWORDS: readonly string[] = [
  "function", "method", "inline", "if", "elseif", "else", "while", "until", "for", "switch", "case", "default",
  "return", "local", "global", "class", "struct", "var", "public", "private", "this", "new", "and", "or",
  "true", "false", "null", "on", "error", "resume", "next", "goto", "include", "redirect", "killredirect",
  "killallredirects", "break", "continue",
];

export type FormatOptions = {
  /** Spaces per brace depth; default four. */
  readonly indentWidth?: number;
};

export type FormatResult = {
  readonly text: string;
  readonly changed: boolean;
};

/** Every name the 3.1 reader spells canonically in lower case: keywords and registered commands. */
export function canonicalNames(): Set<string> {
  const names = new Set<string>(KEYWORDS);
  for (const entry of commandDocumentation(FIRST_PARTY_PLUGINS.map((definition) => ({ definition })))) {
    names.add(entry.name.toLowerCase());
  }
  return names;
}

/** Whether a line is one the formatter must not rewrite beyond indentation of code. */
function isOpaqueLine(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("#") ||
    trimmed === ""
  );
}

/**
 * Re-indent and normalise one source text. The rewrite is a pure function of the
 * brace depth and the token spells, so formatting formatted text is a no-op.
 */
export function formatSource(source: string, options: FormatOptions = {}): FormatResult {
  const indentWidth = options.indentWidth ?? 4;
  const names = canonicalNames();
  const lines = source.split("\n");
  // A file the scanner cannot read still gets its indentation; names are left as written.
  let tokens: readonly Token[] = [];
  try {
    tokens = tokenizeObjects(source);
  } catch {
    tokens = [];
  }
  const byLine = new Map<number, Token[]>();
  for (const token of tokens) {
    const list = byLine.get(token.line) ?? [];
    list.push(token);
    byLine.set(token.line, list);
  }

  // Depth at the start of each line, from braces outside strings and comments.
  const depths: number[] = [];
  let depth = 0;
  const lineText = source.split("\n");
  for (let index = 0; index < lineText.length; index += 1) {
    const text = lineText[index]!;
    const trimmed = text.trimStart();
    const closes = trimmed.startsWith("}");
    depths.push(closes ? Math.max(0, depth - 1) : depth);
    if (isOpaqueLine(text)) continue;
    const stripped = stripStringsAndComments(text);
    for (const ch of stripped) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }

  const output = lines.map((text, index) => {
    const line = index + 1;
    const replacements: { readonly from: number; readonly to: number; readonly text: string }[] = [];
    if (!isOpaqueLine(text)) {
      for (const token of byLine.get(line) ?? []) {
        const written = text.slice(token.col - 1, token.endCol);
        // `and`/`or` lex as operators and `true`/`false`/`null` as numbers; both are
        // canonical spellings the reader folds, so a word-shaped token counts.
        if (!/^[A-Za-z]+$/.test(written)) continue;
        if (!names.has(written.toLowerCase()) || written === written.toLowerCase()) continue;
        // A label's spelling is its identity and is left alone (STX-5).
        if (isLabelToken(text, token.col)) continue;
        replacements.push({ from: token.col - 1, to: token.endCol, text: written.toLowerCase() });
      }
      const trimmed = text.trimStart();
      const continuation = trimmed.startsWith("_");
      const leader = text.length - trimmed.length;
      if (!continuation && !trimmed.startsWith("#")) {
        const body = applyReplacements(text, replacements);
        const target = `${" ".repeat(indentWidth * depths[index]!)}${body.trimStart()}`;
        return target;
      }
    }
    return applyReplacements(text, replacements);
  });

  const text = output.join("\n");
  return { text, changed: text !== source };
}

function applyReplacements(
  text: string,
  replacements: readonly { readonly from: number; readonly to: number; readonly text: string }[],
): string {
  let result = text;
  for (const item of [...replacements].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, item.from) + item.text + result.slice(item.to);
  }
  return result;
}

/** A `:name` label: the first non-space character of the line is the colon. */
function isLabelToken(line: string, col: number): boolean {
  const before = line.slice(0, col - 1).trimStart();
  return before === ":";
}

/** Replace string bodies and trailing/whole-line comments with spaces, keeping brace columns. */
function stripStringsAndComments(line: string): string {
  let result = "";
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]!;
    if (inString) {
      result += ch === '"' ? '"' : " ";
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === "/" && line[index + 1] === "/") break;
    result += ch;
  }
  return result;
}

/** `--check` semantics: `true` when formatting would change the text (D-9 exit code 1). */
export function formatChanged(source: string, options: FormatOptions = {}): boolean {
  return formatSource(source, options).changed;
}
