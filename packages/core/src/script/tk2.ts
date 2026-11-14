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
import { tokenizeObjects } from "./lex.ts";
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

function normaliseTk2Internal(text: string, lookup: Tk2CommandLookup | undefined, literals: Map<number, string> | null): string {
  const codeWithoutStrings = text.replace(/"[^"\n]*"/g, "");
  if (/^\s*#?\s*if\b[^\n]*\bthen\s*<|^\s*<(?=[#\s]|$)|^\s*>\s*$/im.test(codeWithoutStrings)) {
    throw new ScriptError("syntax.unsupported", "Toolkit 1.x `< >` blocks are outside the MVP (docs/spec/engine/rpgcode-dialects.md#toolkit-1x)", { file: "", line: 1 });
  }
  const lines = text.split("\n");
  const continued = continuedCodeRows(lines, lookup);
  return lines.map((line, index) => normaliseLine(line, lookup, (value) => {
    if (literals === null) {
      throw new ScriptError("syntax.unsupported", "Cannot convert loose dialogue containing a double quote: 3.1 has no unshadowable quote literal encoding (LEX-8).", { file: "", line: index + 1 });
    }
    literals.set(index + 1, value);
  }, continued.has(index))).join("\n");
}

/** Convert TK2 source into equivalent 3.1 source, or report an unrepresentable literal. */
export function normaliseTk2(text: string, lookup?: Tk2CommandLookup): string {
  return normaliseTk2Internal(text, lookup, null);
}

function rewriteAst(ast: Ast, literals: ReadonlyMap<number, string>): Ast {
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
    functions: ast.functions.map((fn) => ({ ...fn, body: fn.body.map(rewriteStatement) })),
    classes: ast.classes.map((cls) => ({ ...cls, methods: cls.methods.map((method) => ({ ...method, body: method.body?.map(rewriteStatement) ?? null })) })),
    includes: ast.includes,
  };
}

/** Parse TK2 into the same Unified AST used by the TK3 frontend. */
export function parseTk2(text: string, lookup?: Tk2CommandLookup): Ast {
  const literals = new Map<number, string>();
  const normalised = normaliseTk2Internal(text, lookup, literals);
  return rewriteAst(parse(tokenizeObjects(normalised), { redirects: new Map(), preserveSystemNamespace: true }), literals);
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
