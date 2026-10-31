import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  compileProgram,
  parse,
  tokenize,
  type Ast,
  type Expr,
  type ScriptError,
  type Statement,
} from "../src/index.ts";
import type { IncludeRequest } from "../src/script/ast.ts";
import { scan } from "../src/script/lex.ts";

/**
 * The AST half of the source-span contract (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention):
 * a node's `line`, `col` and `endCol` all come from one token, so a node's range
 * is one line long and slices exactly the text it names. The scanner's own
 * convention is pinned by `script-lex-spans.test.ts`; this file pins the nodes
 * built from those tokens, over a program with a tab, CRLF and a Windows-1252
 * byte.
 */

const SOURCE = '\tlocal(n) = 0\r\n\tif (n == 1) {\r\n\t\tmwin("caf\u00e9")\r\n\t}\r\n';

/** Slice one line's `[col, endCol]` out of the source, the operation TOOL-3 promises works. */
function sliceAt(source: string, line: number, col: number, endCol: number): string {
  const text = source.split("\n")[line - 1] ?? "";
  return text.slice(col - 1, endCol);
}

/** The source text a node's own range names. */
function slice(source: string, node: { line: number; col?: number; endCol?: number }): string {
  if (node.col === undefined || node.endCol === undefined) throw new Error("node carries no span");
  return sliceAt(source, node.line, node.col, node.endCol);
}

function spanOf(node: { line: number; col?: number; endCol?: number }): [number, number, number] {
  return [node.line, node.col ?? -1, node.endCol ?? -1];
}

/** The first expression statement's expression, asserted to be an assignment for the table below. */
const ast: Ast = parse(tokenize(SOURCE));
const first = ast.statements[0] as Statement & { kind: "expr"; expr: Expr & { kind: "assign" } };
const ifStatement = ast.statements[1] as Statement & { kind: "if" };
const branch = ifStatement.branches[0]!;
const binary = branch.cond as Expr & { kind: "binary" };
const callStatement = branch.body[0] as Statement & { kind: "expr"; expr: Expr & { kind: "call" } };
const stringLiteral = callStatement.expr.args[0] as Expr & { kind: "literal" };

test("the node table: every node's span is its anchor token's range, columns 1-based and inclusive", () => {
  deepEqual(
    [
      ["statement expr (the `=`)", spanOf(first)],
      ["assign (the `=`)", spanOf(first.expr)],
      ["decl (the `local` keyword)", spanOf(first.expr.target)],
      ["literal 0", spanOf(first.expr.value)],
      ["if (the `if` keyword)", spanOf(ifStatement)],
      ["if branch (the `if` keyword)", spanOf(branch)],
      ["binary (the `==` operator)", spanOf(binary)],
      ["variable n", spanOf(binary.left)],
      ["nested statement (the call)", spanOf(callStatement)],
      ["call mwin", spanOf(callStatement.expr)],
      ["string literal", spanOf(stringLiteral)],
    ],
    [
      ["statement expr (the `=`)", [1, 11, 11]],
      ["assign (the `=`)", [1, 11, 11]],
      ["decl (the `local` keyword)", [1, 2, 6]],
      ["literal 0", [1, 13, 13]],
      ["if (the `if` keyword)", [2, 2, 3]],
      ["if branch (the `if` keyword)", [2, 2, 3]],
      ["binary (the `==` operator)", [2, 8, 9]],
      ["variable n", [2, 6, 6]],
      ["nested statement (the call)", [3, 3, 6]],
      ["call mwin", [3, 3, 6]],
      ["string literal", [3, 8, 13]],
    ],
  );
});

test("a node's range slices exactly its anchor token, tab and CRLF and Windows-1252 included", () => {
  equal(slice(SOURCE, first.expr.target), "local");
  equal(slice(SOURCE, first.expr), "=");
  equal(slice(SOURCE, first.expr.value), "0");
  equal(slice(SOURCE, ifStatement), "if");
  equal(slice(SOURCE, binary), "==");
  equal(slice(SOURCE, binary.left), "n");
  equal(slice(SOURCE, callStatement.expr), "mwin");
  // The quotes are part of the literal; `café` is the decoded form of a Win-1252 byte, one column.
  equal(slice(SOURCE, stringLiteral), '"caf\u00e9"');
  equal(stringLiteral.value, "caf\u00e9");
});

test("the span follows the anchor across a CRLF: line 3's first token is column 3 after two tabs", () => {
  equal(callStatement.line, 3);
  equal(callStatement.col, 3);
  equal(SOURCE.split("\n")[2]?.slice(2, 6), "mwin");
});

test("a zero-width anchor stays a position, not an empty special case", () => {
  // `eof` is the last token; a statement never anchors on it, but the position exists.
  const tokens = tokenize(SOURCE);
  const eof = tokens[tokens.length - 1]!;
  equal(eof.kind, "eof");
  equal(eof.col, eof.endCol);
  equal(sliceAt(SOURCE, eof.line, eof.col, eof.endCol), "");
});

test("the implicit include a `file.func` call queues carries the call's span", () => {
  const source = 'mwin("x")\r\nother.func()\r\n';
  const parsed = parse(tokenize(source));
  const include = parsed.includes[0] as IncludeRequest;
  equal(include.path, "other.prg");
  equal(include.implicit, true);
  deepEqual(spanOf(include), [2, 1, 5]);
  equal(slice(source, include), "other");
});

test("a SourcePos carries the span into the Step IR, so an error on an op names its token", () => {
  const program = compileProgram({ kind: "inline", text: SOURCE, ir: "1" });
  const call = program.ops.find((op) => op.op === "call" && op.name === "mwin");
  ok(call, "the mwin call lowered to a `call` op");
  deepEqual(call.pos, { file: "<inline>", line: 3, col: 3, endCol: 6 });
  equal(sliceAt(SOURCE, call.pos.line, call.pos.col ?? 0, call.pos.endCol ?? 0), "mwin");
});

test("a parse error names the exact token it is about", () => {
  const source = "x = 1\r\nx = )\r\n";
  let caught: ScriptError | undefined;
  try {
    parse(tokenize(source));
  } catch (error) {
    caught = error as ScriptError;
  }
  ok(caught, "the program has a syntax error");
  equal(caught.code, "syntax.error");
  deepEqual(caught.pos, { file: "", line: 2, col: 5, endCol: 5 });
  equal(sliceAt(source, 2, 5, 5), ")");
});

test("a lexical error names the exact character it is about", () => {
  const source = "x = @\n";
  let caught: ScriptError | undefined;
  try {
    tokenize(source);
  } catch (error) {
    caught = error as ScriptError;
  }
  ok(caught, "`@` is not in the 3.1 subset");
  equal(caught.code, "syntax.unsupported");
  deepEqual(caught.pos, { file: "", line: 1, col: 5, endCol: 5 });
  equal(sliceAt(source, 1, 5, 5), "@");
});

test("a literal #include directive carries its own span, and a CRLF's CR is not a column", () => {
  const source = 'x = 1\r\n#include "inc.prg"\r\n';
  const { includes } = scan(source, true);
  const directive = includes[0] as IncludeRequest;
  equal(directive.path, "inc.prg");
  equal(directive.implicit, false);
  deepEqual(spanOf(directive), [2, 1, 18]);
  equal(slice(source, directive), '#include "inc.prg"');
});
