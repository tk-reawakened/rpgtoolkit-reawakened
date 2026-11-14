/**
 * Toolkit 2.x dialect frontend (docs/spec/engine/rpgcode-dialects.md#toolkit-2x).
 *
 * TK2 source is never rewritten on disk. This adapter normalises its line
 * introducers and legacy spellings into the shared Unified AST frontend. Raw
 * unquoted command text is quoted only where the command signature identifies
 * a text-shaped argument; sigil variables and expressions remain executable.
 */

import type { BuiltinSpec, ParamSpec } from "./builtins.ts";
import { ScriptError } from "./errors.ts";
import { lower } from "./lower.ts";
import { tokenizeObjects, type Token } from "./lex.ts";
import type { Ast, Expr } from "./ast.ts";
import { parse } from "./parse.ts";
import { IR_VERSION, type Program } from "./program.ts";


export type Tk2CommandLookup =
  | ReadonlyMap<string, BuiltinSpec>
  | ((name: string) => BuiltinSpec | undefined);

function lookupCommand(lookup: Tk2CommandLookup | undefined, name: string): BuiltinSpec | undefined {
  if (lookup === undefined) return undefined;
  if (typeof lookup === "function") return lookup(name);
  return lookup.get(name);
}

function quoted(value: string): string {
  return value.includes('"') ? JSON.stringify(value) : `"${value}"`;
}

function matchingClose(text: string, open: number): number {
  let depth = 0;
  let quote = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') quote = !quote;
    if (quote) continue;
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitArgs(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') quote = !quote;
    if (quote) continue;
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      result.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  result.push(text.slice(start).trim());
  return result.filter((item) => item.length > 0);
}

function paramAt(spec: BuiltinSpec | undefined, index: number): ParamSpec | undefined {
  if (spec === undefined) return undefined;
  if (spec.params.length === 0) return undefined;
  const direct = spec.params[index];
  if (direct !== undefined) return direct;
  return spec.params.find((param) => param.variadic) ?? spec.params[spec.params.length - 1];
}

function looksExpression(value: string): boolean {
  return /^[-+]?\d(?:[\d.eE+-]*\d)?$/.test(value) || /[+\-*/%<>=&|()[\]]/.test(value);
}

/** A sigil marks executable legacy syntax only if the whole argument parses. */
function isSigilledExpression(value: string): boolean {
  if (!value.includes("!") && !value.includes("$")) return false;
  const candidate = `__tk2_expression(${value})`;
  try {
    const tokens = tokenizeObjects(candidate);
    const hasSigil = tokens.some((token) =>
      token.kind === "identifier" && (candidate[token.endCol - 1] === "!" || candidate[token.endCol - 1] === "$"));
    if (!hasSigil) return false;
    parse(tokens);
    return true;
  } catch (error) {
    if (error instanceof ScriptError) return false;
    throw error;
  }
}

function isTextCommand(name: string, param: ParamSpec | undefined): boolean {
  const lowerName = name.toLowerCase();
  if (["mwin", "text", "print", "prompt", "setimage", "setimagetransparent", "setimageadditive", "font", "walkspeed", "itemwalkspeed", "newplyr", "newplayer", "include", "redirect"].includes(lowerName)) return true;
  return param !== undefined && /^(?:text|file|filename|image|path|message|player|name|method)$/i.test(param.name);
}

/** Bind TK2's unquoted command words without changing the source text. */
function bindRawArguments(line: string, lookup: Tk2CommandLookup | undefined): string {
  let cursor = 0;
  let result = "";
  while (cursor < line.length) {
    const match = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    match.lastIndex = cursor;
    const found = match.exec(line);
    if (found === null) {
      result += line.slice(cursor);
      break;
    }
    const name = found[1]!.toLowerCase();
    const open = line.indexOf("(", found.index);
    const close = matchingClose(line, open);
    if (close < 0) return line;
    result += line.slice(cursor, open + 1);
    const args = splitArgs(line.slice(open + 1, close));
    const spec = lookupCommand(lookup, name);
    const bound = args.map((arg, index) => {
      if (arg.startsWith('"') || arg.startsWith("'") || arg.startsWith(":") || isSigilledExpression(arg)) return arg;
      const param = paramAt(spec, index);
      if (looksExpression(arg)) return arg;
      // A TK2 word with spaces, a filename, or a text-typed command argument is
      if (arg.includes(" ") || arg.includes(".") || isTextCommand(name, param)) return quoted(arg);
      return arg;
    });
    result += bound.join(", ") + ")";
    cursor = close + 1;
  }
  return result;
}

function stripSigils(text: string): string {
  return text.replace(
    /"[^"]*"|([A-Za-z_][A-Za-z0-9_]*|\])([$!])(?=\s*(?:=|[)\],;~]|$))/g,
    (match, name: string | undefined) => name === undefined ? match : match.slice(0, -1),
  );
}

function equalityInCondition(text: string): string {
  const masked = text.replace(/"[^"]*"/g, (value) => " ".repeat(value.length));
  const condition = /\b(if|while)\s*\(/gi;
  let cursor = 0;
  let result = "";
  for (let found = condition.exec(masked); found !== null; found = condition.exec(masked)) {
    const open = masked.indexOf("(", found.index);
    const close = matchingClose(text, open);
    if (close < 0) break;
    const body = text.slice(open + 1, close);
    const fixed = body.replace(/"[^"]*"|(?<![<>=!~])=(?!=)/g, (match) => match === "=" ? "==" : match);
    result += text.slice(cursor, found.index) + found[1] + " (" + fixed + ")";
    cursor = close + 1;
    condition.lastIndex = cursor;
  }
  return result + text.slice(cursor);
}

function stripInlinePrefixes(line: string): string {
  return line.replace(/"[^"]*"|(^|[{\s;])#(?=[A-Za-z_@])/g, (match, prefix: string | undefined) => prefix === undefined ? match : prefix);
}


/** Preserve valid unprefixed expression statements accepted by the shared frontend. */
function isExpressionWithEquals(line: string, lookup: Tk2CommandLookup | undefined): boolean {
  if (!line.includes("=")) return false;
  try {
    const tokens = tokenizeObjects(stripSigils(bindRawArguments(stripInlinePrefixes(line), lookup)));
    if (!tokens.some((token) => (token.kind === "op" && token.text.includes("=")) || (token.kind === "string" && token.value.includes("=")))) return false;
    const ast = parse(tokens);
    const stmt = ast.statements[0];
    if (stmt?.kind !== "expr") return false;
    lower(ast);
    return true;
  } catch (error) {
    if (error instanceof ScriptError) return false;
    throw error;
  }
}

/** A star following a complete parenthesized command begins a TK2 comment. */
function removeTrailingStarComment(line: string): string {
  const call = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(/.exec(line);
  if (call === null) return line;
  const close = matchingClose(line, call[0].length - 1);
  return close >= 0 && /^[ \t]+\*/.test(line.slice(close + 1)) ? line.slice(0, close + 1) : line;
}

function normaliseLine(raw: string, lookup: Tk2CommandLookup | undefined, literal: (value: string) => void, continuedCode = false): string {
  let line = raw.replace(/\r$/, "").trim();
  if (line.length === 0 || line.startsWith("*")) return "";
  if (line === "@") return 'mwin("")';
  if (line.startsWith("#")) {
    line = line.slice(1).trimStart();
    line = removeTrailingStarComment(line);
  }
  line = line.replace(/^returnmethod\b/i, "return").replace(/^method\b/i, "function");
  if (line.length === 0) return "";
  if (!continuedCode && !raw.trimStart().startsWith("#") && !/^(if|while|until|for|switch|case|default|else|function|return|[:{}])(?:\b|$)/i.test(line) && !line.endsWith("{") && !isExpressionWithEquals(line, lookup)) {
    if (line.includes('"')) {
      literal(line);
      return 'mwin("")';
    }
    return `mwin(${quoted(line)})`;
  }
  line = stripInlinePrefixes(line);
  // Bind raw text while variable sigils still distinguish names from literals.
  line = bindRawArguments(line, lookup);
  line = stripSigils(line);
  return equalityInCondition(line);
}


/** Classify complete continued statements while keeping physical lines for the lexer. */
function continuedCodeRows(lines: readonly string[], lookup: Tk2CommandLookup | undefined): Set<number> {
  const rows = new Set<number>();
  const continuation = /[ \t]+_[ \t]*(?:\/\/[^\r]*)?\r?$/;
  for (let first = 0; first < lines.length; first += 1) {
    if (lines[first]!.trimStart().startsWith("*")) continue;
    let candidate = lines[first]!;
    let last = first;
    while (last + 1 < lines.length) {
      const code = removeTrailingStarComment(candidate.replace(/^\s*#\s*/, ""));
      const marker = continuation.exec(code);
      let quoted = false;
      let commented = false;
      let blockComment = false;
      let nesting = 0;
      for (let index = 0; index < (marker?.index ?? code.length); index += 1) {
        if (blockComment) {
          if (code[index] === "*" && code[index + 1] === "/") {
            blockComment = false;
            index += 1;
          }
          continue;
        }
        if (!quoted && code[index] === "/" && code[index + 1] === "*") {
          blockComment = true;
          index += 1;
          continue;
        }
        if (code[index] === '"') quoted = !quoted;
        if (!quoted && ((code[index] === "/" && code[index + 1] === "/") || (code[index] === "*" && code[index + 1] === "*"))) {
          const newline = code.indexOf("\n", index);
          if (newline === -1) {
            commented = true;
            break;
          }
          index = newline;
          continue;
        }
        if (!quoted && (code[index] === "(" || code[index] === "[")) nesting += 1;
        if (!quoted && (code[index] === ")" || code[index] === "]")) nesting -= 1;
      }
      if (blockComment || (nesting > 0 && (marker === null || commented))) {
        candidate += "\n" + lines[last + 1]!.replace(/^\s*#\s*/, "");
        last += 1;
        continue;
      }
      if (marker === null || quoted || commented) break;
      candidate = candidate.replace(continuation, " ") + lines[last + 1]!.replace(/^\s*#\s*/, "");
      last += 1;
    }
    if (last === first) continue;
    const startsCode = lines[first]!.trimStart().startsWith("#")
      || (lines[first]!.includes("=") && isExpressionWithEquals(candidate, lookup));
    if (startsCode) {
      for (let row = first; row <= last; row += 1) rows.add(row);
      first = last;
    }
  }
  return rows;
}

/** Lower inline ReturnMethod at statement boundaries without touching literals or comments. */
function lowerInlineReturns(text: string): string {
  if (!/\breturnmethod\b/i.test(text)) return text;
  let result = "";
  let copied = 0;
  let statement = false;
  for (let i = 0; i < text.length;) {
    const char = text[i]!;
    if (char === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") i += 1;
      if (text[i] === '"') i += 1;
      statement = false;
    } else if ((char === "/" && text[i + 1] === "/") || (char === "*" && text[i + 1] === "*")) {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      if (i < text.length) i += 2;
    } else if (char === "\n") {
      statement = false;
      i += 1;
    } else if (/\s/.test(char)) {
      i += 1;
    } else if (char === "{" || char === ";") {
      statement = true;
      i += 1;
    } else if (/[A-Za-z_]/.test(char)) {
      const start = i;
      i += 1;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i]!)) i += 1;
      if (statement && text.slice(start, i).toLowerCase() === "returnmethod") {
        let next = i;
        while (next < text.length && (text[next] === " " || text[next] === "\t")) next += 1;
        if (text[next] === "(") {
          result += text.slice(copied, start) + "return";
          copied = i;
        }
      }
      statement = false;
    } else {
      statement = false;
      i += 1;
    }
  }
  return copied === 0 ? text : result + text.slice(copied);
}

type Tk2SourceMap = { readonly text: string; readonly offsets: readonly (number | undefined)[] };

function sourceOffsetWithoutQuotedText(source: string, visibleOffset: number): number {
  let sourceOffset = 0;
  let visible = 0;
  while (visible < visibleOffset && sourceOffset < source.length) {
    if (source[sourceOffset] === '"') {
      const close = source.indexOf('"', sourceOffset + 1);
      const newline = source.indexOf("\n", sourceOffset + 1);
      if (close >= 0 && (newline < 0 || close < newline)) {
        sourceOffset = close + 1;
        continue;
      }
    }
    sourceOffset += 1;
    visible += 1;
  }
  return sourceOffset;
}
function normalizeTk2Text(source: string, lookup: Tk2CommandLookup | undefined, literals: Map<number, string> | null): string {
  const codeWithoutStrings = source.replace(/"[^"\n]*"/g, "");
  const unsupported = /^\s*#?\s*if\b[^\n]*\bthen\s*<|^\s*<(?=[#\s]|$)|^\s*>\s*$/im.exec(codeWithoutStrings);
  if (unsupported !== null) {
    const marker = unsupported[0].lastIndexOf("<") >= 0 ? unsupported[0].lastIndexOf("<") : unsupported[0].lastIndexOf(">");
    const offset = sourceOffsetWithoutQuotedText(source, unsupported.index + Math.max(0, marker));
    const coordinates = sourceCoordinates(source);
    throw new ScriptError("syntax.unsupported", "Toolkit 1.x `< >` blocks are outside the MVP (docs/spec/engine/rpgcode-dialects.md#toolkit-1x)", {
      file: "",
      line: coordinates.lines[offset]!,
      col: coordinates.columns[offset]!,
      endCol: coordinates.columns[offset]!,
    });
  }
  const lines = source.split("\n");
  const continued = continuedCodeRows(lines, lookup);
  return lowerInlineReturns(lines.map((line, index) => normaliseLine(line, lookup, (_value) => {
    if (literals === null) {
      const column = (lines[index] ?? "").indexOf('"') + 1;
      throw new ScriptError("syntax.unsupported", "Cannot convert loose dialogue containing a double quote: 3.1 has no unshadowable quote literal encoding (LEX-8).", { file: "", line: index + 1, col: column, endCol: column });
    }
    literals.set(index + 1, _value);
  }, continued.has(index))).join("\n"));
}

function normalizeWithSourceMap(source: string, lookup: Tk2CommandLookup | undefined, literals: Map<number, string> | null): Tk2SourceMap {
  const text = normalizeTk2Text(source, lookup, literals);
  const sourceLines = source.split("\n");
  const offsets: (number | undefined)[] = new Array(text.length + 1);
  const normalizedLines = text.split("\n");
  let sourceBase = 0;
  let normalizedBase = 0;
  for (let line = 0; line < normalizedLines.length; line += 1) {
    const original = sourceLines[line] ?? "";
    const normalized = normalizedLines[line]!;
    let i = 0;
    let j = 0;
    while (j < normalized.length) {
      if (i < original.length && normalized[j] === original[i]) {
        offsets[normalizedBase + j] = sourceBase + i;
        i += 1;
        j += 1;
        continue;
      }
      if (original.slice(i, i + "method".length).toLowerCase() === "method" && normalized.startsWith("function", j)) {
        j += "function".length;
        i += "method".length;
        continue;
      }
      if (i < original.length && /\s/.test(original[i]!) && !/\s/.test(normalized[j]!)) {
        i += 1;
        continue;
      }
      if (i < original.length && /[#!$]/.test(original[i]!) && normalized[j] !== original[i]) {
        i += 1;
        continue;
      }
      let sourceSkip = -1;
      let normalizedSkip = -1;
      for (let distance = 1; distance <= 8; distance += 1) {
        if (sourceSkip < 0 && i + distance < original.length && normalized[j] === original[i + distance]) sourceSkip = distance;
        if (normalizedSkip < 0 && j + distance < normalized.length && normalized[j + distance] === original[i]) normalizedSkip = distance;
      }
      if (sourceSkip >= 0 && (normalizedSkip < 0 || sourceSkip <= normalizedSkip)) i += sourceSkip;
      else {
        offsets[normalizedBase + j] = undefined;
        j += 1;
      }
    }
    offsets[normalizedBase + normalized.length] = sourceBase + original.length - (original.endsWith("\r") ? 1 : 0);
    sourceBase += original.length + 1;
    normalizedBase += normalized.length + 1;
  }
  if (!text.endsWith("\n")) offsets[text.length] = source.length;
  return { text, offsets };
}

function sourceCoordinates(source: string): { readonly lines: readonly number[]; readonly columns: readonly number[] } {
  const lines: number[] = new Array(source.length + 1);
  const columns: number[] = new Array(source.length + 1);
  let line = 1;
  let column = 1;
  for (let index = 0; index < source.length; index += 1) {
    lines[index] = line;
    columns[index] = column;
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
  }
  lines[source.length] = line;
  columns[source.length] = column;
  return { lines, columns };
}

function mapTk2Tokens(source: string, mapped: Tk2SourceMap): Token[] {
  const coordinates = sourceCoordinates(source);
  const normalizedStarts: number[] = [];
  let normalizedStart = 0;
  for (const line of mapped.text.split("\n")) {
    normalizedStarts.push(normalizedStart);
    normalizedStart += line.length + 1;
  }
  let tokens: Token[];
  try {
    tokens = tokenizeObjects(mapped.text);
  } catch (error) {
    remapTk2Error(error, source, mapped);
  }
  return tokens.map((token) => {
    const start = normalizedStarts[token.line - 1];
    if (start === undefined) return { ...token, col: 0, endCol: 0 };
    const tokenStart = start + token.col - 1;
    let first: number | undefined;
    let last: number | undefined;
    for (let index = tokenStart; index < tokenStart + Math.max(1, token.endCol - token.col + 1); index += 1) {
      const sourceOffset = mapped.offsets[index];
      if (sourceOffset !== undefined) {
        first ??= sourceOffset;
        last = sourceOffset;
      }
    }
    if (first === undefined || last === undefined) return { ...token, col: 0, endCol: 0 };
    const suffix = source[last + 1];
    const nextOutputOffset = mapped.offsets[start + token.endCol];
    if (token.kind === "identifier" && (suffix === "!" || suffix === "$") && nextOutputOffset !== last + 1) last += 1;
    return {
      ...token,
      line: coordinates.lines[first]!,
      col: coordinates.columns[first]!,
      endCol: coordinates.columns[last]!,
    };
  });
}

function remapTk2Error(error: unknown, source: string, mapped: Tk2SourceMap): never {
  if (error instanceof ScriptError && error.pos?.col !== undefined) {
    const coordinates = sourceCoordinates(source);
    const normalizedLines = mapped.text.split("\n");
    let normalizedStart = 0;
    for (let index = 0; index < error.pos.line - 1; index += 1) normalizedStart += normalizedLines[index]!.length + 1;
    const tokenStart = normalizedStart + error.pos.col - 1;
    const tokenEnd = normalizedStart + (error.pos.endCol ?? error.pos.col) - 1;
    let first: number | undefined;
    let last: number | undefined;
    for (let index = tokenStart; index <= tokenEnd; index += 1) {
      const sourceOffset = mapped.offsets[index];
      if (sourceOffset !== undefined) {
        first ??= sourceOffset;
        last = sourceOffset;
      }
    }
    if (first !== undefined && last !== undefined) {
      throw new ScriptError(error.code, error.message, {
        ...error.pos,
        line: coordinates.lines[first]!,
        col: coordinates.columns[first]!,
        endCol: coordinates.columns[last]!,
      });
    }
    const pos = { ...error.pos };
    delete pos.col;
    delete pos.endCol;
    throw new ScriptError(error.code, error.message, pos);
  }
  throw error;
}

function declaredNameToken(tokens: readonly Token[], keyword: string, name: string): Token | undefined {
  const foldedName = name.toLowerCase();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== "identifier" || token.name !== keyword) continue;
    let nextIndex = index + 1;
    while (tokens[nextIndex]?.kind === "end") nextIndex += 1;
    const next = tokens[nextIndex];
    if (next?.kind === "identifier" && next.name.toLowerCase() === foldedName) return next;
  }
  return undefined;
}

function methodNameAt(tokens: readonly Token[], index: number, name: string): Token | undefined {
  const first = tokens[index];
  if (first?.kind === "identifier" && first.name.toLowerCase() === name.toLowerCase()) return first;
  if (name.startsWith("operator") && first?.kind === "identifier" && first.name === "operator") {
    const suffix = name.slice("operator".length);
    const operator = tokens[index + 1];
    const close = tokens[index + 2];
    if (operator?.kind === "op" && operator.text === suffix) return { ...first, endCol: operator.endCol };
    if (suffix === "[]" && operator?.kind === "op" && operator.text === "[" && close?.kind === "op" && close.text === "]") {
      return { ...first, endCol: close.endCol };
    }
  }
  if (name.startsWith("~") && first?.kind === "op" && first.text === "~") {
    const destructor = tokens[index + 1];
    if (destructor?.kind === "identifier" && `~${destructor.name}`.toLowerCase() === name.toLowerCase()) return { ...first, endCol: destructor.endCol };
  }
  return undefined;
}

function methodNameToken(tokens: readonly Token[], owner: string, name: string): Token | undefined {
  const foldedOwner = owner.toLowerCase();
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const keyword = tokens[index];
    const ownerToken = tokens[index + 1];
    const separator = tokens[index + 2];
    if (keyword?.kind !== "identifier" || keyword.name !== "method") continue;
    if (ownerToken?.kind !== "identifier" || ownerToken.name.toLowerCase() !== foldedOwner) continue;
    if (separator?.kind !== "op" || separator.text !== "::") continue;
    const method = methodNameAt(tokens, index + 3, name);
    if (method !== undefined) return method;
  }
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    const keyword = tokens[index];
    const ownerToken = tokens[index + 1];
    if (keyword?.kind !== "identifier" || keyword.name !== "class") continue;
    if (ownerToken?.kind !== "identifier" || ownerToken.name.toLowerCase() !== foldedOwner) continue;
    let open = index + 2;
    while (open < tokens.length) {
      const token = tokens[open]!;
      if (token.kind === "op" && token.text === "{") break;
      open += 1;
    }
    let depth = 0;
    for (let cursor = open; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.kind === "op" && token.text === "{") depth += 1;
      else if (token.kind === "op" && token.text === "}") {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1 && token.kind === "identifier" && token.name === "method") {
        const method = methodNameAt(tokens, cursor + 1, name);
        if (method !== undefined) return method;
      }
    }
  }
  return undefined;
}

function omitSyntheticSpans<T>(value: T): T {
  if (Array.isArray(value)) return value.map(omitSyntheticSpans) as T;
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === "col" || key === "endCol") && child === 0) continue;
    result[key] = omitSyntheticSpans(child);
  }
  return result as T;
}

function normaliseTk2Internal(text: string, lookup: Tk2CommandLookup | undefined, literals: Map<number, string> | null): string {
  return normalizeTk2Text(text, lookup, literals);
}

/** Convert TK2 source into equivalent 3.1 source, or report an unrepresentable literal. */
export function normaliseTk2(text: string, lookup?: Tk2CommandLookup): string {
  return normaliseTk2Internal(text, lookup, null);
}

function rewriteAst(ast: Ast, literals: ReadonlyMap<number, string>, tokens: readonly Token[]): Ast {
  const rewriteExpression = (expr: Expr): Expr => {
    if (expr.kind === "methodCall") {
      return { ...expr, receiver: rewriteExpression(expr.receiver), args: expr.args.map(rewriteExpression) };
    }
    if (expr.kind === "call") return { ...expr, args: expr.args.map(rewriteExpression) };
    if (expr.kind === "callIndirect") return { ...expr, callee: rewriteExpression(expr.callee), args: expr.args.map(rewriteExpression) };
    if (expr.kind === "member") return { ...expr, receiver: rewriteExpression(expr.receiver) };
    if (expr.kind === "binary") return { ...expr, left: rewriteExpression(expr.left), right: rewriteExpression(expr.right) };
    if (expr.kind === "unary" || expr.kind === "postfix") return { ...expr, operand: rewriteExpression(expr.operand) };
    if (expr.kind === "assign") return { ...expr, target: rewriteExpression(expr.target), value: rewriteExpression(expr.value) };
    if (expr.kind === "index") return { ...expr, base: rewriteExpression(expr.base), index: rewriteExpression(expr.index) };
    if (expr.kind === "ternary") return { ...expr, cond: rewriteExpression(expr.cond), then: rewriteExpression(expr.then), else: rewriteExpression(expr.else) };
    if (expr.kind === "lambda") return { ...expr, body: expr.body.map(rewriteStatement) };
    if (expr.kind === "object") return { ...expr, entries: expr.entries.map((entry) => ({ ...entry, value: rewriteExpression(entry.value) })) };
    return expr;
  };
  const rewriteStatement = (statement: Ast["statements"][number]): Ast["statements"][number] => {
    if (statement.kind === "expr") {
      const literal = literals.get(statement.line);
      if (literal !== undefined && statement.expr.kind === "call") {
        const arg = statement.expr.args[0];
        if (arg === undefined || arg.kind !== "literal") throw new Error("invalid TK2 dialogue placeholder");
        return { ...statement, expr: { ...statement.expr, args: [{ ...arg, value: literal }, ...statement.expr.args.slice(1).map(rewriteExpression)] } };
      }
      return { ...statement, expr: rewriteExpression(statement.expr) };
    }
    if (statement.kind === "if") return { ...statement, branches: statement.branches.map((branch) => ({ ...branch, cond: rewriteExpression(branch.cond), body: branch.body.map(rewriteStatement) })), elseBody: statement.elseBody?.map(rewriteStatement) ?? null };
    if (statement.kind === "while" || statement.kind === "until") return { ...statement, cond: rewriteExpression(statement.cond), body: statement.body.map(rewriteStatement) };
    if (statement.kind === "for") return { ...statement, init: statement.init ? rewriteExpression(statement.init) : null, cond: statement.cond ? rewriteExpression(statement.cond) : null, step: statement.step ? rewriteExpression(statement.step) : null, body: statement.body.map(rewriteStatement) };
    if (statement.kind === "switch") return { ...statement, value: rewriteExpression(statement.value), cases: statement.cases.map((item) => ({ ...item, value: rewriteExpression(item.value), body: item.body.map(rewriteStatement) })), defaultBody: statement.defaultBody?.map(rewriteStatement) ?? null };
    if (statement.kind === "return") return { ...statement, value: statement.value ? rewriteExpression(statement.value) : null };
    return statement;
  };
  return {
    statements: ast.statements.map(rewriteStatement),
    functions: ast.functions.map((fn) => {
      const nameToken = declaredNameToken(tokens, "function", fn.name);
      return {
        ...fn,
        ...(nameToken === undefined ? {} : { line: nameToken.line, col: nameToken.col, endCol: nameToken.endCol }),
        body: fn.body.map(rewriteStatement),
      };
    }),
    classes: ast.classes.map((cls) => {
      const nameToken = declaredNameToken(tokens, "class", cls.name);
      return {
        ...cls,
        ...(nameToken === undefined ? {} : { line: nameToken.line, col: nameToken.col, endCol: nameToken.endCol }),
        members: cls.members,
        methods: cls.methods.map((method) => {
          const methodToken = methodNameToken(tokens, cls.name, method.name);
          return {
            ...method,
            ...(methodToken === undefined ? {} : { line: methodToken.line, col: methodToken.col, endCol: methodToken.endCol }),
            body: method.body?.map(rewriteStatement) ?? null,
          };
        }),
      };
    }),
    includes: ast.includes,
  };
}

/** Parse TK2 into the same Unified AST used by the TK3 frontend. */
export function parseTk2(text: string, lookup?: Tk2CommandLookup): Ast {
  const literals = new Map<number, string>();
  const mapped = normalizeWithSourceMap(text, lookup, literals);
  const tokens = mapTk2Tokens(text, mapped);
  let ast: Ast;
  try {
    ast = parse(tokens, { redirects: new Map(), preserveSystemNamespace: true });
  } catch (error) {
    if (error instanceof ScriptError && (error.pos?.col === 0 || error.pos?.endCol === 0)) {
      const pos = { ...error.pos };
      delete pos.col;
      delete pos.endCol;
      throw new ScriptError(error.code, error.message, pos);
    }
    throw error;
  }
  return omitSyntheticSpans(rewriteAst(ast, literals, tokens));
}

/** Compile TK2 source into the shared flat Step IR without modifying its input. */
export function compileTk2(text: string, file = "<tk2>", lookup?: Tk2CommandLookup): Program {
  const ast = parseTk2(text, lookup);
  const result = lower(ast, file);
  return {
    ref: { kind: "inline", text, ir: IR_VERSION, dialect: "tk2" },
    ops: result.ops,
    functions: result.functions,
    classes: result.classes,
    labels: result.labels,
    statements: result.statements,
    files: {},
    fileKeys: {},
    notices: [],
    units: [{ name: file, key: file, ast, requests: ast.includes, text }],
  };
}
