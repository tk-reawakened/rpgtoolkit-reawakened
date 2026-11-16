/**
 * Lexical colouring and comment bookmarks for the program editor
 * (docs/spec/engine/rpgcode-tooling.md#tool-10).
 *
 * The scanner reads the lexical rules of docs/spec/engine/rpgcode-language.md and never fails: an unfinished string,
 * an unclosed `/*` or text the parser would refuse is still classified, because an editor colours a buffer while it is
 * being typed. It is not the parser and does not decide what a program means; it only says what each stretch of text
 * looks like. A stretch never crosses a line: a block comment is reported once per line it covers.
 */

import { FIRST_PARTY_PLUGINS, foldAscii } from "@tk-reawakened/core";
import { projectHelp } from "./help.ts";
import { KEYWORDS } from "./format.ts";

/** The token types a host styles (the semantic token legend of the language server). */
export const PROGRAM_TOKEN_TYPES = ["comment", "string", "number", "keyword", "function", "label", "macro"] as const;
export type ProgramTokenType = (typeof PROGRAM_TOKEN_TYPES)[number];

/** The token modifiers a host may style. */
export const PROGRAM_TOKEN_MODIFIERS = ["declaration", "defaultLibrary"] as const;
export type ProgramTokenModifier = (typeof PROGRAM_TOKEN_MODIFIERS)[number];

export type ProgramToken = {
  /** 0-based line. */
  readonly line: number;
  /** 0-based UTF-16 offset in the line. */
  readonly start: number;
  readonly length: number;
  readonly type: ProgramTokenType;
  readonly modifiers: readonly ProgramTokenModifier[];
  /** A comment line inside a `/* … *\/` block that began on an earlier line. */
  readonly continuation?: true;
};

export type ClassifyOptions = {
  /** ASCII-folded public command names and aliases; every first-party command by default. */
  readonly commandNames?: ReadonlySet<string>;
};

let defaultCommands: ReadonlySet<string> | undefined;

/** The folded names of every public registered command and alias. */
export function publicCommandNames(plugins: Parameters<typeof projectHelp>[0] = FIRST_PARTY_PLUGINS.map((definition) => ({ definition }))): ReadonlySet<string> {
  return new Set(projectHelp(plugins).filter((entry) => entry.access === "public").map((entry) => foldAscii(entry.name)));
}

function commandNamesOrDefault(options: ClassifyOptions): ReadonlySet<string> {
  if (options.commandNames !== undefined) return options.commandNames;
  defaultCommands ??= publicCommandNames();
  return defaultCommands;
}

const KEYWORD_SET: ReadonlySet<string> = new Set(KEYWORDS);

const NUMBER = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const IDENTIFIER = /^[A-Za-z0-9_]+/;
const INCLUDE = /^#\s*include\b/i;
const LABEL = /^:[A-Za-z0-9_]+/;
const NOTHING_MORE = /^\s*(?:;|\/\/.*|\*\*.*)?$/;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_");
}

/** Classify `source` line by line. */
export function classifyProgram(source: string, options: ClassifyOptions = {}): readonly ProgramToken[] {
  const commands = commandNamesOrDefault(options);
  const tokens: ProgramToken[] = [];
  const lines = source.split("\n");
  let inBlock = false;
  let continued = false;
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const raw = lines[lineNumber]!;
    // The CR of a CRLF belongs to the line break, never to a token.
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const add = (start: number, length: number, type: ProgramTokenType, modifiers: readonly ProgramTokenModifier[] = [], continuation = false): void => {
      if (length > 0) tokens.push({ line: lineNumber, start, length, type, modifiers, ...(continuation ? { continuation: true as const } : {}) });
    };
    let i = 0;
    let startsBlockContinuation = false;
    if (inBlock) {
      const close = text.indexOf("*/");
      startsBlockContinuation = true;
      if (close < 0) {
        add(0, text.length, "comment", [], true);
        continued = false;
        continue;
      }
      add(0, close + 2, "comment", [], true);
      inBlock = false;
      i = close + 2;
    }
    let atStart = !startsBlockContinuation;
    const startedContinued = continued;
    let declaring = false;
    let lastSignificant = "";
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === " " || ch === "\t") {
        i += 1;
        continue;
      }
      const next = text[i + 1];
      if ((ch === "/" && next === "/") || (ch === "*" && next === "*") || (ch === "*" && atStart && !startedContinued)) {
        add(i, text.length - i, "comment");
        i = text.length;
        break;
      }
      if (ch === "/" && next === "*") {
        const close = text.indexOf("*/", i + 2);
        if (close < 0) {
          add(i, text.length - i, "comment");
          inBlock = true;
          i = text.length;
          break;
        }
        add(i, close + 2 - i, "comment");
        i = close + 2;
        atStart = false;
        continue;
      }
      if (ch === "#" && atStart) {
        const match = INCLUDE.exec(text.slice(i));
        if (match !== null) {
          add(i, match[0].length, "macro");
          i += match[0].length;
          atStart = false;
          lastSignificant = "include";
          continue;
        }
        // The Toolkit 2 command prefix is ignored; the rest of the line is code (LEX-6).
        i += 1;
        continue;
      }
      if (ch === '"') {
        const close = text.indexOf('"', i + 1);
        const end = close < 0 ? text.length : close + 1;
        add(i, end - i, "string");
        i = end;
        atStart = false;
        declaring = false;
        lastSignificant = '"';
        continue;
      }
      if (ch >= "0" && ch <= "9") {
        const run = IDENTIFIER.exec(text.slice(i))![0];
        const number = NUMBER.exec(text.slice(i))![0];
        // LEX-2: a run that starts with a digit but does not fit a number is an identifier.
        if (number.length === run.length || !isWordChar(text[i + number.length])) {
          add(i, number.length, "number");
          i += number.length;
        } else {
          i += run.length;
        }
        atStart = false;
        declaring = false;
        lastSignificant = "0";
        continue;
      }
      if (isWordChar(ch)) {
        const word = IDENTIFIER.exec(text.slice(i))![0];
        const folded = foldAscii(word);
        const member = lastSignificant === "." || lastSignificant === "->";
        const afterWord = text.slice(i + word.length);
        if (word === "_" && i > 0 && /\s/.test(text[i - 1]!) && /^\s*(?:\/\/.*)?$/.test(afterWord) && !member) {
          // A standalone `_` ends the line and continues the statement.
          i += 1;
          lastSignificant = "_";
          continue;
        }
        if (member) {
          // Members are never keywords or commands.
        } else if (declaring) {
          add(i, word.length, "function", ["declaration"]);
        } else if (KEYWORD_SET.has(folded)) {
          add(i, word.length, "keyword");
          if (folded === "function" || folded === "method") {
            i += word.length;
            atStart = false;
            declaring = true;
            lastSignificant = folded;
            continue;
          }
        } else if (commands.has(folded) && (afterWord.trimStart().startsWith("(") || (atStart && NOTHING_MORE.test(afterWord)))) {
          add(i, word.length, "function", ["defaultLibrary"]);
        }
        i += word.length;
        atStart = false;
        declaring = false;
        lastSignificant = "word";
        continue;
      }
      if (ch === ":") {
        const match = LABEL.exec(text.slice(i));
        const before = text.slice(0, i).trimEnd();
        const beforeOk = before === "" || before.endsWith("(") || before.endsWith(",");
        if (match !== null && beforeOk && (before !== "" || NOTHING_MORE.test(text.slice(i + match[0].length)))) {
          add(i, match[0].length, "label");
          i += match[0].length;
          atStart = false;
          lastSignificant = "label";
          continue;
        }
      }
      if (ch === "~" && declaring && lastSignificant === "method" && isWordChar(next)) {
        const name = IDENTIFIER.exec(text.slice(i + 1))![0];
        add(i, name.length + 1, "function", ["declaration"]);
        i += name.length + 1;
        atStart = false;
        declaring = false;
        lastSignificant = "word";
        continue;
      }
      if (ch === "-" && next === ">") {
        i += 2;
        atStart = false;
        declaring = false;
        lastSignificant = "->";
        continue;
      }
      atStart = false;
      declaring = false;
      lastSignificant = ch;
      i += 1;
    }
    // A standalone `_` as the last token continues the statement on the next line (LEX-1).
    continued = !inBlock && lastSignificant === "_";
  }
  return tokens;
}

/** One comment that starts its line, for the bookmark list. */
export type ProgramBookmark = {
  /** 0-based line. */
  readonly line: number;
  readonly start: number;
  readonly length: number;
  /** The comment's text without its marker, trimmed. */
  readonly name: string;
};

const MAX_BOOKMARK = 120;

/** The text of a comment line without its marker, trimmed; `null` when nothing readable is left. */
function bookmarkName(comment: string): string | null {
  const body = comment.replace(/^(?:\/\/+|\*\*+|\*+|\/\*+)/, "").replace(/\*+\/\s*$/, "").trim();
  if (!/[\p{L}\p{N}]/u.test(body)) return null;
  return body.length > MAX_BOOKMARK ? `${body.slice(0, MAX_BOOKMARK - 1)}…` : body;
}

/**
 * The comments that start their line (docs/spec/engine/rpgcode-tooling.md#tool-10): `//`, `**`, a leading `*` or the
 * first line of `/* … *\/`. A trailing comment after code, a later line of a block comment and a ruled line with no
 * letter or digit are not bookmarks.
 */
export function programBookmarks(source: string, options: ClassifyOptions = {}): readonly ProgramBookmark[] {
  const lines = source.split("\n");
  const bookmarks: ProgramBookmark[] = [];
  for (const token of classifyProgram(source, options)) {
    if (token.type !== "comment" || token.continuation === true) continue;
    const line = lines[token.line]!;
    if (line.slice(0, token.start).trim() !== "") continue;
    const name = bookmarkName(line.slice(token.start, token.start + token.length));
    if (name !== null) bookmarks.push({ line: token.line, start: token.start, length: token.length, name });
  }
  return bookmarks;
}
