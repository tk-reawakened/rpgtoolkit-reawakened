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
  return JSON.stringify(value);
}

function matchingClose(text: string, open: number): number {
  let depth = 0;
  let quote = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"' && text[i - 1] !== "\\") quote = !quote;
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
    if (ch === '"' && text[i - 1] !== "\\") quote = !quote;
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
      if (arg.startsWith('"') || arg.startsWith("'") || arg.startsWith(":") || arg.includes("$") || arg.includes("!")) return arg;
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
  return text.replace(/([A-Za-z_][A-Za-z0-9_]*)([$!])(?=\s*(?:=|[),;]|$))/g, "$1");
}

function equalityInCondition(text: string): string {
  return text.replace(/\b(if|while)\s*\(([^\n]*)\)/gi, (_whole, keyword: string, body: string) => {
    const fixed = body.replace(/(^|[^<>=!~])=([^=]|$)/g, "$1==$2");
    return `${keyword} (${fixed})`;
  });
}

function normaliseLine(raw: string, lookup: Tk2CommandLookup | undefined): string {
  let line = raw.replace(/\r$/, "").trim();
  if (line.length === 0 || line.startsWith("*")) return "";
  if (line === "@") return 'mwin("")';
  if (line.startsWith("#")) line = line.slice(1).trimStart();
  line = line.replace(/(^|[{\s;])#(?=[A-Za-z_@])/g, "$1");
  line = line.replace(/^returnmethod\b/i, "return").replace(/^method\b/i, "function");
  line = stripSigils(line);
  line = equalityInCondition(line);
  if (line.length === 0) return "";
  if (!raw.trimStart().startsWith("#") && !/^(if|while|until|for|switch|case|default|else|function|return|[:{}])(?:\b|$)/i.test(line) && !line.includes("=") && !line.endsWith("{")) {
    return `mwin(${quoted(line)})`;
  }
  return bindRawArguments(line, lookup);
}


/** Convert TK2 source into an equivalent TK3 source string for the shared parser. */
export function normaliseTk2(text: string, lookup?: Tk2CommandLookup): string {
  const codeWithoutStrings = text.replace(/"[^"\n]*"/g, "");
  if (/(?:^|\bthen\s*)<|^\s*</m.test(codeWithoutStrings) || />\s*$/m.test(codeWithoutStrings)) {
    throw new ScriptError("syntax.unsupported", "Toolkit 1.x `< >` blocks are outside the MVP (docs/spec/engine/rpgcode-dialects.md#toolkit-1x)", { file: "", line: 1 });
  }
  return text.split("\n").map((line) => normaliseLine(line, lookup)).join("\n");
}

function rewriteNamespaces(expr: Expr): Expr {
  if (expr.kind === "call" && expr.file === "system") {
    const { file: _file, ...call } = expr;
    return { ...call, name: `system.${expr.name}`, args: expr.args.map(rewriteNamespaces) };
  }
  if (expr.kind === "methodCall" && expr.receiver.kind === "variable") {
    return { kind: "call", name: `${expr.receiver.name}.${expr.name}`, args: expr.args.map(rewriteNamespaces), line: expr.line };
  }
  if (expr.kind === "binary") return { ...expr, left: rewriteNamespaces(expr.left), right: rewriteNamespaces(expr.right) };
  if (expr.kind === "unary" || expr.kind === "postfix") return { ...expr, operand: rewriteNamespaces(expr.operand) };
  if (expr.kind === "assign") return { ...expr, target: rewriteNamespaces(expr.target), value: rewriteNamespaces(expr.value) };
  if (expr.kind === "index") return { ...expr, base: rewriteNamespaces(expr.base), index: rewriteNamespaces(expr.index) };
  if (expr.kind === "ternary") return { ...expr, cond: rewriteNamespaces(expr.cond), then: rewriteNamespaces(expr.then), else: rewriteNamespaces(expr.else) };
  return expr;
}

function rewriteAst(ast: Ast): Ast {
  const rewriteStatement = (statement: Ast["statements"][number]): Ast["statements"][number] => {
    if (statement.kind === "expr") return { ...statement, expr: rewriteNamespaces(statement.expr) };
    if (statement.kind === "if") return { ...statement, branches: statement.branches.map((branch) => ({ ...branch, cond: rewriteNamespaces(branch.cond), body: branch.body.map(rewriteStatement) })), elseBody: statement.elseBody?.map(rewriteStatement) ?? null };
    if (statement.kind === "while" || statement.kind === "until") return { ...statement, cond: rewriteNamespaces(statement.cond), body: statement.body.map(rewriteStatement) };
    if (statement.kind === "for") return { ...statement, init: statement.init ? rewriteNamespaces(statement.init) : null, cond: statement.cond ? rewriteNamespaces(statement.cond) : null, step: statement.step ? rewriteNamespaces(statement.step) : null, body: statement.body.map(rewriteStatement) };
    if (statement.kind === "switch") return { ...statement, value: rewriteNamespaces(statement.value), cases: statement.cases.map((item) => ({ ...item, value: rewriteNamespaces(item.value), body: item.body.map(rewriteStatement) })), defaultBody: statement.defaultBody?.map(rewriteStatement) ?? null };
    if (statement.kind === "return") return { ...statement, value: statement.value ? rewriteNamespaces(statement.value) : null };
    return statement;
  };
  return {
    statements: ast.statements.map(rewriteStatement),
    functions: ast.functions.map((fn) => ({ ...fn, body: fn.body.map(rewriteStatement) })),
    classes: ast.classes,
    includes: ast.includes,
  };
}

/** Parse TK2 into the same Unified AST used by the TK3 frontend. */
export function parseTk2(text: string, lookup?: Tk2CommandLookup): Ast {
  return rewriteAst(parse(tokenizeObjects(normaliseTk2(text, lookup)), { redirects: new Map(), preserveSystemNamespace: true }));
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
