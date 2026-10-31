/**
 * The full RPGCode docs/spec/engine/rpgcode-runtime.md and docs/spec/engine/rpgcode-language.md#keywords-and-structure parser.
 *
 * Precedence-climbing over the 15-level operator table (EXP-2), statement
 * forms (`if`, `while`, `until`, `for`, `switch`, `label`, `return`,
 * assignment, call), function declarations with typed and `&` parameters
 * (FUN-1), and declaration forms (`local(x)`, `global(x)`).
 *
 * docs/adr/0004 decision 1; docs/spec/engine/rpgcode-language.md#keywords-and-structure
 */

import type {
  AccessLevel,
  Ast,
  IncludeRequest,
  Block,
  ClassDef,
  Expr,
  FunctionDef,
  IfBranch,
  MemberDef,
  MethodDef,
  ObjectEntry,
  Param,
  Statement,
  SwitchCase,
} from "./ast.ts";
import { ScriptError } from "./errors.ts";
import { foldAscii, type Token } from "./lex.ts";
import type { BinaryOp, UnaryOp } from "./ops.ts";

function isOp(token: Token, text: string): token is Token & { kind: "op" } {
  return token.kind === "op" && token.text === text;
}

function isIdent(token: Token, name: string): token is Token & { kind: "identifier" } {
  return token.kind === "identifier" && token.name === name;
}

function describe(token: Token): string {
  switch (token.kind) {
    case "identifier":
      return `identifier \`${token.name}\``;
    case "number":
      return `the number ${token.value}`;
    case "string":
      return "a string literal";
    case "op":
      return `\`${token.text}\``;
    case "end":
      return "the end of a statement";
    case "eof":
      return "the end of the program";
  }
}

const ASSIGNMENT_OPS = [
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "&=",
  "|=",
  "`=",
  "<<=",
  ">>=",
];

// Binding powers for binary operators (higher = tighter, 15 tightest .. 1 loosest)
// Level 3: ^ (BP 13, left-assoc)
// Level 4: * / % (BP 12, left)
// Level 5: + - (BP 11, left)
// Level 6: << >> (BP 10, left)
// Level 7: < <= > >= (BP 9, left)
// Level 8: == ~= != (BP 8, left)
// Level 9: & (BP 7, left)
// Level 10: ` (BP 6, left)
// Level 11: | (BP 5, left)
// Level 12: && and (BP 4, left)
// Level 13: || or (BP 3, left)
// Level 14: ?: (BP 2, right)
// Level 15: assignments (BP 1, right)
function binaryBindingPower(opText: string): number | undefined {
  if (ASSIGNMENT_OPS.includes(opText)) return 1;
  if (opText === "?") return 2;
  if (opText === "||" || opText === "or") return 3;
  if (opText === "&&" || opText === "and") return 4;
  if (opText === "|") return 5;
  if (opText === "`") return 6;
  if (opText === "&") return 7;
  if (opText === "==" || opText === "~=" || opText === "!=") return 8;
  if (opText === "<" || opText === "<=" || opText === ">" || opText === ">=") return 9;
  if (opText === "<<" || opText === ">>") return 10;
  if (opText === "+" || opText === "-") return 11;
  if (opText === "*" || opText === "/" || opText === "%") return 12;
  if (opText === "^") return 13;
  return undefined;
}

/** What a parse shares with the files parsed before and after it: the one redirect table (R-42). */
export type ParseContext = {
  readonly redirects: Map<string, string>;
  /** TK2 keeps `system.func` as a namespace token until its compatibility rewrite. */
  readonly preserveSystemNamespace?: boolean;
};

/** The call names that edit the module state rather than reach a built-in (MOD-3, R-42). */
export const MODULE_COMMANDS: { readonly [name: string]: true } = {
  include: true,
  redirect: true,
  killredirect: true,
  killallredirects: true,
};

/** Parse a token list into the full Unified AST. */
export function parse(tokens: readonly Token[], context: ParseContext = { redirects: new Map() }): Ast {
  const last = tokens[tokens.length - 1];
  const eof: Token = {
    kind: "eof",
    line: last?.line ?? 1,
    col: last?.endCol ?? 1,
    endCol: last?.endCol ?? 1,
  };
  let index = 0;
  const redirects = context.redirects;
  const implicit: IncludeRequest[] = [];

  /**
   * Build a call site. Redirects apply here, at parse time, in textual order and
   * one hop only (docs/spec/engine/rpgcode-modules-and-objects.md#redirects R-42..R-44);
   * a `file.func` target or an explicit `file.func` call queues the file (MOD-2).
   */
  function makeCall(name: string, args: readonly Expr[], line: number, file?: string): Expr {
    let callName = name;
    let callFile = file;
    if (callFile === undefined) {
      if (Object.hasOwn(MODULE_COMMANDS, name)) {
        applyRedirectCommand(name, args);
      } else {
        const target = redirects.get(name);
        if (target !== undefined) {
          const dot = target.indexOf(".");
          if (dot < 0) {
            callName = target;
          } else {
            callFile = target.slice(0, dot);
            callName = target.slice(dot + 1);
          }
        }
      }
    }
    // `system.func` is the engine's own namespace, not a file (PRG-1): it is the plain call `func`.
    if (callFile === "system" && context.preserveSystemNamespace !== true) callFile = undefined;
    if (callFile === undefined) return { kind: "call", name: callName, args, line };
    implicit.push({ path: `${callFile}.prg`, line, implicit: true });
    return { kind: "call", name: callName, args, file: callFile, line };
  }

  /** A literal `redirect`/`killRedirect`/`killAllRedirects` changes the table for text parsed after it. */
  function applyRedirectCommand(name: string, args: readonly Expr[]): void {
    const literal = (arg: Expr | undefined): string | undefined =>
      arg?.kind === "literal" && typeof arg.value === "string" ? foldAscii(arg.value) : undefined;
    if (name === "redirect") {
      const from = literal(args[0]);
      const to = literal(args[1]);
      if (from !== undefined && to !== undefined) redirects.set(from, to);
    } else if (name === "killredirect") {
      const from = literal(args[0]);
      if (from !== undefined) redirects.delete(from);
    } else if (name === "killallredirects") {
      redirects.clear();
    }
  }

  function peek(): Token {
    return tokens[index] ?? eof;
  }

  function skipEnds(): void {
    while (peek().kind === "end") index += 1;
  }

  function peekSkippingEnds(): Token {
    let cursor = index;
    while (tokens[cursor]?.kind === "end") cursor += 1;
    return tokens[cursor] ?? eof;
  }

  function consume(): Token {
    const token = peek();
    index += 1;
    return token;
  }

  function expectOp(text: string, context: string): Token {
    const token = peek();
    if (!isOp(token, text)) {
      throw new ScriptError(
        "syntax.error",
        `expected \`${text}\` ${context} but found ${describe(token)}`,
        { file: "", line: token.line },
      );
    }
    return consume();
  }

  function expectStatementEnd(): void {
    const token = peek();
    if (token.kind === "end" || token.kind === "eof") {
      if (token.kind === "end") consume();
      return;
    }
    if (isOp(token, "}")) {
      // STX-6: '}' ends the statement before it; do not consume '}'
      return;
    }
    throw new ScriptError(
      "syntax.error",
      `expected the end of a statement but found ${describe(token)}`,
      { file: "", line: token.line },
    );
  }

  function expectBlock(context: string): Block {
    skipEnds();
    const token = peek();
    if (!isOp(token, "{")) {
      throw new ScriptError(
        "syntax.unsupported",
        `braces are mandatory (STX-1): expected \`{\` ${context} but found ${describe(token)}`,
        { file: "", line: token.line },
      );
    }
    consume(); // consume '{'
    return parseBlockStatements();
  }

  function parseBlockStatements(): Block {
    const statements: Statement[] = [];
    skipEnds();
    while (peek().kind !== "eof" && !isOp(peek(), "}")) {
      statements.push(parseStatement(true));
      skipEnds();
    }
    if (!isOp(peek(), "}")) {
      throw new ScriptError(
        "syntax.error",
        `expected \`}\` to close block but found ${describe(peek())}`,
        { file: "", line: peek().line },
      );
    }
    consume(); // consume '}'
    return statements;
  }

  // --- Expressions ---

  /** Whether the `(` at `start` opens a lambda parameter list: its matching `)` is followed by `=>`. */
  function isLambdaHead(start: number): boolean {
    let depth = 0;
    for (let cursor = start; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (token === undefined || token.kind === "eof") return false;
      if (token.kind !== "op") continue;
      if (token.text === "(") depth += 1;
      else if (token.text === ")") {
        depth -= 1;
        if (depth === 0) {
          let after = cursor + 1;
          while (tokens[after]?.kind === "end") after += 1;
          const next = tokens[after];
          return next !== undefined && isOp(next, "=>");
        }
      }
    }
    return false;
  }

  /**
   * The part of a lambda after `=>`: a `{` always opens a block body; anything else is a single
   * expression returned by the lambda. Lambdas are expressions, so they never declare a name.
   */
  function parseLambdaBody(params: readonly Param[], line: number, inArgs: boolean): Expr {
    skipEnds();
    if (isOp(peek(), "{")) {
      return { kind: "lambda", params, body: expectBlock("after `=>`"), exprBody: false, line };
    }
    const value = parseExpression(inArgs);
    return {
      kind: "lambda",
      params,
      body: [{ kind: "return", value, byRef: false, line }],
      exprBody: true,
      line,
    };
  }

  /** `{ key: value, key2: value2 }`: keys are identifiers or strings, a trailing comma is allowed (OOP-10). */
  function parseObjectLiteral(): Expr {
    const open = expectOp("{", "to open a dictionary literal");
    const entries: ObjectEntry[] = [];
    skipEnds();
    while (!isOp(peek(), "}")) {
      const keyToken = peek();
      if (keyToken.kind !== "identifier" && keyToken.kind !== "string") {
        throw new ScriptError(
          "syntax.error",
          `expected a dictionary key but found ${describe(keyToken)}`,
          { file: "", line: keyToken.line },
        );
      }
      consume();
      skipEnds();
      const key = keyToken.kind === "identifier" ? keyToken.name : keyToken.value;
      expectOp(":", `after the dictionary key \`${key}\``);
      skipEnds();
      const value = parseExpression();
      entries.push({ key, value, line: keyToken.line });
      skipEnds();
      if (isOp(peek(), ",")) {
        consume();
        skipEnds();
        continue;
      }
      if (!isOp(peek(), "}")) {
        throw new ScriptError(
          "syntax.error",
          `expected \`,\` or \`}\` in a dictionary literal but found ${describe(peek())}`,
          { file: "", line: peek().line },
        );
      }
    }
    consume(); // '}'
    return { kind: "object", entries, line: open.line };
  }

  function parsePrimary(inArgs = false): Expr {
    skipEnds();
    const token = peek();

    if (token.kind === "number") {
      consume();
      return { kind: "literal", value: token.value, line: token.line };
    }

    if (token.kind === "string") {
      consume();
      return { kind: "literal", value: token.value, line: token.line };
    }

    // `(params) => body` lambda (FUN-8), or a parenthesized expression.
    if (isOp(token, "(")) {
      if (isLambdaHead(index)) {
        const params = parseParams();
        skipEnds();
        expectOp("=>", "after the lambda parameter list");
        return parseLambdaBody(params, token.line, inArgs);
      }
      consume();
      const expr = parseExpression();
      skipEnds();
      expectOp(")", "to close parenthesized expression");
      return expr;
    }

    // Dictionary literal `{ key: value, ... }` (OOP-10).
    if (isOp(token, "{")) {
      return parseObjectLiteral();
    }

    // :name -> label reference in args list (STX-5), global-forcing name read elsewhere (SEM-4)
    if (isOp(token, ":")) {
      const line = token.line;
      consume();
      const next = peek();
      if (next.kind !== "identifier") {
        throw new ScriptError(
          "syntax.error",
          `expected an identifier after \`:\` but found ${describe(next)}`,
          { file: "", line },
        );
      }
      consume();
      if (inArgs) {
        return { kind: "labelRef", name: next.name, line };
      }
      return { kind: "variable", name: next.name, scope: "global", line };
    }

    // local(x) or global(x) declaration form (FUN-2)
    if (token.kind === "identifier" && (token.name === "local" || token.name === "global")) {
      const next = tokens[index + 1];
      if (next && isOp(next, "(")) {
        const line = token.line;
        const scope = token.name as "local" | "global";
        consume(); // consume local/global
        consume(); // consume (
        skipEnds();
        const ident = peek();
        if (ident.kind !== "identifier") {
          throw new ScriptError(
            "syntax.error",
            `expected variable name in \`${scope}()\` declaration but found ${describe(ident)}`,
            { file: "", line: ident.line },
          );
        }
        consume();
        skipEnds();
        expectOp(")", `after \`${scope}(${ident.name})\``);
        return { kind: "decl", scope, name: ident.name, line };
      }
    }

    // Single-parameter lambda without parentheses: `x => expr` (FUN-8).
    if (token.kind === "identifier") {
      const arrow = tokens[index + 1];
      if (arrow !== undefined && isOp(arrow, "=>")) {
        consume();
        consume();
        const param: Param = { name: token.name, byRef: false, typeName: null, line: token.line };
        return parseLambdaBody([param], token.line, inArgs);
      }
      consume();
      return { kind: "variable", name: token.name, scope: null, line: token.line };
    }

    throw new ScriptError(
      "syntax.error",
      `expected an expression but found ${describe(token)}`,
      { file: "", line: token.line },
    );
  }

  function parsePostfix(inArgs = false): Expr {
    let expr = parsePrimary(inArgs);

    while (true) {
      const token = peek();

      // Function or method call.
      if (isOp(token, "(")) {
        if (expr.kind === "variable") {
          consume();
          const args = parseArgs();
          expr = makeCall(expr.name, args, expr.line);
          continue;
        }
        if (expr.kind === "member") {
          consume();
          const args = parseArgs();
          expr = { kind: "methodCall", receiver: expr.receiver, name: expr.name, args, line: expr.line };
          continue;
        }
        // Any other callee (`f()()`, `a[i](x)`, a parenthesised lambda) is an indirect call (FUN-8).
        consume();
        const indirectArgs = parseArgs();
        expr = { kind: "callIndirect", callee: expr, args: indirectArgs, line: expr.line };
        continue;
      }

      // `file.func(args)`: a call bound to that file first, which queues the file (MOD-2).
      // `this` is never a file name.
      if (isOp(token, ".") && expr.kind === "variable" && expr.scope === null && expr.name !== "this") {
        const nameToken = tokens[index + 1];
        const open = tokens[index + 2];
        if (nameToken?.kind === "identifier" && open !== undefined && isOp(open, "(")) {
          consume();
          consume();
          consume();
          const args = parseArgs();
          expr = makeCall(nameToken.name, args, expr.line, expr.name);
          continue;
        }
      }

      // Object member access (`->` is canonical; `.` is accepted in authored
      // class programs as equivalent spelling).
      if (isOp(token, "->") || isOp(token, ".")) {
        consume();
        const member = peek();
        if (member.kind !== "identifier") {
          throw new ScriptError("syntax.error", "expected member name after object access", {
            file: "",
            line: member.line,
          });
        }
        consume();
        expr = { kind: "member", receiver: expr, name: member.name, line: member.line };
        continue;
      }

      // Index access: expr[idx]
      if (isOp(token, "[")) {
        consume(); // consume '['
        skipEnds();
        const indexExpr = parseExpression();
        skipEnds();
        expectOp("]", "to close index expression");
        expr = {
          kind: "index",
          base: expr,
          index: indexExpr,
          line: expr.line,
        };
        continue;
      }

      // Postfix ++ / --
      if (isOp(token, "++") || isOp(token, "--")) {
        consume();
        expr = {
          kind: "postfix",
          operator: token.text as "++" | "--",
          operand: expr,
          line: expr.line,
        };
        continue;
      }

      break;
    }

    return expr;
  }

  function parseUnary(inArgs = false): Expr {
    skipEnds();
    const token = peek();

    // Level 2 prefix operators: - + ! ~ ++ --
    if (
      isOp(token, "-") ||
      isOp(token, "+") ||
      isOp(token, "!") ||
      isOp(token, "~") ||
      isOp(token, "++") ||
      isOp(token, "--")
    ) {
      consume();
      const operand = parseUnary(inArgs);
      return {
        kind: "unary",
        operator: token.text as UnaryOp,
        operand,
        line: token.line,
      };
    }

    return parsePostfix(inArgs);
  }

  function parseBinary(minBindingPower: number, inArgs = false): Expr {
    let left = parseUnary(inArgs);

    while (true) {
      const token = peek();
      if (token.kind !== "op") break;

      const bp = binaryBindingPower(token.text);
      if (bp === undefined || bp < minBindingPower) break;

      const op = token;
      consume();

      // Level 15: assignment operators (right-associative)
      if (ASSIGNMENT_OPS.includes(op.text)) {
        const right = parseBinary(bp, inArgs);
        left = {
          kind: "assign",
          operator: op.text,
          target: left,
          value: right,
          line: op.line,
        };
        continue;
      }

      // Level 14: ternary ?: (right-associative)
      if (op.text === "?") {
        skipEnds();
        const thenExpr = parseBinary(1, inArgs);
        skipEnds();
        expectOp(":", "in ternary conditional expression");
        skipEnds();
        const elseExpr = parseBinary(bp, inArgs);
        left = {
          kind: "ternary",
          cond: left,
          then: thenExpr,
          else: elseExpr,
          line: op.line,
        };
        continue;
      }

      // Level 3 to 13: left-associative binary operators
      // Standard precedence climbing: right child gets bp + 1
      const right = parseBinary(bp + 1, inArgs);
      const binaryOp: BinaryOp =
        op.text === "and" ? "&&" : op.text === "or" ? "||" : (op.text as BinaryOp);
      left = {
        kind: "binary",
        operator: binaryOp,
        left,
        right,
        line: op.line,
      };
    }

    return left;
  }

  function parseExpression(inArgs = false): Expr {
    return parseBinary(0, inArgs);
  }

  function parseArgs(): Expr[] {
    const args: Expr[] = [];
    skipEnds();
    if (isOp(peek(), ")")) {
      consume();
      return args;
    }
    args.push(parseExpression(true));
    skipEnds();
    while (isOp(peek(), ",")) {
      consume();
      skipEnds();
      args.push(parseExpression(true));
      skipEnds();
    }
    expectOp(")", "to close argument list");
    return args;
  }

  // --- Function parameter list (FUN-1) ---

  function parseParams(): Param[] {
    expectOp("(", "at start of parameter list");
    const params: Param[] = [];
    skipEnds();
    if (isOp(peek(), ")")) {
      consume();
      return params;
    }

    function parseOneParam(): Param {
      skipEnds();
      let byRef = false;
      let typeName: string | null = null;

      if (isOp(peek(), "&")) {
        consume();
        byRef = true;
      }

      const first = peek();
      if (first.kind !== "identifier") {
        throw new ScriptError(
          "syntax.error",
          `expected parameter name but found ${describe(first)}`,
          { file: "", line: first.line },
        );
      }
      consume();

      let nameToken: Token & { kind: "identifier" };
      const second = peek();
      if (second.kind === "identifier") {
        typeName = first.name;
        nameToken = second;
        consume();
      } else {
        nameToken = first;
      }

      // Check trailing `&` form: `n &`
      if (isOp(peek(), "&")) {
        consume();
        byRef = true;
      }

      return {
        name: nameToken.name,
        byRef,
        typeName,
        line: nameToken.line,
      };
    }

    params.push(parseOneParam());
    skipEnds();
    while (isOp(peek(), ",")) {
      consume();
      skipEnds();
      params.push(parseOneParam());
      skipEnds();
    }

    expectOp(")", "at end of parameter list");
    return params;
  }
  function parseMethod(owner: string, access: AccessLevel, allowPrototype: boolean): MethodDef {
    const methodToken = consume(); // method
    const nameToken = peek();
    let name: string;
    if (nameToken.kind === "identifier") {
      consume();
      name = nameToken.name;
      const operatorCandidate = peek();
      if (name === "operator" && operatorCandidate.kind === "op") {
        const operatorToken = consume();
        if (operatorToken.kind !== "op") throw new ScriptError("syntax.error", "expected operator name", { file: "", line: operatorToken.line });
        name += operatorToken.text;
        if (operatorToken.text === "[") {
          expectOp("]", "at end of operator[] name");
          name += "]";
        }
      }
    } else if (nameToken.kind === "op" && nameToken.text === "~") {
      consume();
      const classToken = peek();
      if (classToken.kind !== "identifier") throw new ScriptError("syntax.error", "expected destructor name", { file: "", line: classToken.line });
      consume();
      name = `~${classToken.name}`;
    } else {
      throw new ScriptError("syntax.error", "expected method name", { file: "", line: nameToken.line });
    }
    const params = parseParams();
    skipEnds();
    let isPure = false;
    let body: Block | null;
    if (isOp(peek(), "=")) {
      if (!allowPrototype) {
        throw new ScriptError("syntax.error", "pure methods are only declarations", {
          file: "",
          line: peek().line,
        });
      }
      consume();
      const zero = peek();
      if (zero.kind !== "number" || zero.value !== 0) {
        throw new ScriptError("syntax.error", "pure method must use `= 0`", {
          file: "",
          line: zero.line,
        });
      }
      consume();
      expectStatementEnd();
      isPure = true;
      body = null;
    } else if (isOp(peek(), "{")) {
      body = expectBlock(`in method \`${name}\``);
    } else if (allowPrototype) {
      body = null;
    } else {
      body = expectBlock(`in method \`${name}\``);
    }
    return {
      name,
      params,
      body,
      isPure,
      access,
      owner,
      line: methodToken.line,
    };
  }

  function parseClass(isStruct: boolean): ClassDef {
    const classToken = consume();
    const nameToken = peek();
    if (nameToken.kind !== "identifier") {
      throw new ScriptError("syntax.error", "expected class name", { file: "", line: nameToken.line });
    }
    consume();
    const bases: string[] = [];
    if (isOp(peek(), ":")) {
      consume();
      while (true) {
        const base = peek();
        if (base.kind !== "identifier") {
          throw new ScriptError("syntax.error", "expected base class name", { file: "", line: base.line });
        }
        bases.push(base.name);
        consume();
        if (!isOp(peek(), ",")) break;
        consume();
      }
    }
    const members: MemberDef[] = [];
    const methods: MethodDef[] = [];
    let access: AccessLevel = isStruct ? "public" : "private";
    skipEnds();
    expectOp("{", "to start class body");
    skipEnds();
    while (!isOp(peek(), "}") && peek().kind !== "eof") {
      const token = peek();
      if (isIdent(token, "public") || isIdent(token, "private")) {
        access = token.name as AccessLevel;
        consume();
        expectOp(":", "after access label");
        skipEnds();
        continue;
      }
      if (isIdent(token, "protected")) {
        throw new ScriptError("syntax.unsupported", "`protected` is not a language access level", {
          file: "",
          line: token.line,
        });
      }
      if (isIdent(token, "method")) {
        methods.push(parseMethod(nameToken.name, access, true));
        skipEnds();
        continue;
      }
      if (isIdent(token, "var") || token.kind === "identifier") {
        if (isIdent(token, "var")) consume();
        const member = peek();
        if (member.kind !== "identifier") {
          throw new ScriptError("syntax.error", "expected member name", { file: "", line: member.line });
        }
        consume();
        let arraySize: number | null = null;
        if (isOp(peek(), "[")) {
          consume();
          const size = peek();
          if (size.kind === "number") {
            arraySize = size.value;
            consume();
          }
          expectOp("]", "after member array");
        }
        expectStatementEnd();
        members.push({ name: member.name, arraySize, access, line: member.line });
        skipEnds();
        continue;
      }
      throw new ScriptError("syntax.error", "unexpected token in class body", {
        file: "",
        line: token.line,
      });
    }
    expectOp("}", "to close class body");
    return {
      name: nameToken.name,
      bases,
      members,
      methods,
      isStruct,
      line: classToken.line,
    };
  }

  // --- Statements ---
  function parseOutOfClassMethod(): MethodDef {
    consume(); // method
    const owner = peek();
    if (owner.kind !== "identifier") throw new ScriptError("syntax.error", "expected class name", { file: "", line: owner.line });
    consume();
    expectOp("::", "between class and method name");
    const name = peek();
    if (name.kind !== "identifier") throw new ScriptError("syntax.error", "expected method name", { file: "", line: name.line });
    consume();
    const params = parseParams();
    const body = expectBlock(`in method \`${name.name}\``);
    return { name: name.name, params, body, isPure: false, access: "public", owner: owner.name, line: name.line };
  }
  const classes: ClassDef[] = [];

  function parseFunction(isInline: boolean): FunctionDef {
    const fnToken = consume(); // 'function' or 'method'
    skipEnds();
    const nameToken = peek();
    if (nameToken.kind !== "identifier") {
      throw new ScriptError(
        "syntax.error",
        `expected function name after \`${fnToken.kind === "identifier" ? fnToken.name : "function"}\` but found ${describe(nameToken)}`,
        { file: "", line: nameToken.line },
      );
    }
    consume();
    const params = parseParams();
    const body = expectBlock(`in \`function ${nameToken.name}\``);
    return {
      name: nameToken.name,
      params,
      body,
      isInline,
      line: fnToken.line,
    };
  }

  function parseIf(): Statement {
    const ifToken = consume(); // 'if'
    skipEnds();
    expectOp("(", "after `if`");
    const cond = parseExpression();
    skipEnds();
    expectOp(")", "after `if` condition");
    const body = expectBlock("after `if` condition");

    const branches: IfBranch[] = [{ cond, body, line: ifToken.line }];
    let elseBody: Block | null = null;

    // Check for `elseif` or `else if` (STX-3)
    while (true) {
      const next = peekSkippingEnds();
      if (isIdent(next, "elseif")) {
        skipEnds();
        const elifToken = consume();
        skipEnds();
        expectOp("(", "after `elseif`");
        const elifCond = parseExpression();
        skipEnds();
        expectOp(")", "after `elseif` condition");
        const elifBody = expectBlock("after `elseif` condition");
        branches.push({ cond: elifCond, body: elifBody, line: elifToken.line });
        continue;
      }
      if (isIdent(next, "else")) {
        // Peek ahead to see if it's `else if`
        let cursor = index;
        while (tokens[cursor]?.kind === "end") cursor++;
        cursor++; // skip 'else'
        while (tokens[cursor]?.kind === "end") cursor++;
        const afterElse = tokens[cursor];
        if (afterElse && isIdent(afterElse, "if")) {
          skipEnds();
          const elseToken = consume(); // 'else'
          skipEnds();
          consume(); // 'if'
          skipEnds();
          expectOp("(", "after `else if`");
          const elifCond = parseExpression();
          skipEnds();
          expectOp(")", "after `else if` condition");
          const elifBody = expectBlock("after `else if` condition");
          branches.push({ cond: elifCond, body: elifBody, line: elseToken.line });
          continue;
        }

        // Plain `else`
        skipEnds();
        consume(); // 'else'
        elseBody = expectBlock("after `else`");
        break;
      }
      break;
    }

    return {
      kind: "if",
      branches,
      elseBody,
      line: ifToken.line,
    };
  }

  function parseWhile(): Statement {
    const token = consume(); // 'while'
    skipEnds();
    expectOp("(", "after `while`");
    const cond = parseExpression();
    skipEnds();
    expectOp(")", "after `while` condition");
    const body = expectBlock("after `while` condition");
    return { kind: "while", cond, body, line: token.line };
  }

  function parseUntil(): Statement {
    const token = consume(); // 'until'
    skipEnds();
    expectOp("(", "after `until`");
    const cond = parseExpression();
    skipEnds();
    expectOp(")", "after `until` condition");
    const body = expectBlock("after `until` condition");
    return { kind: "until", cond, body, line: token.line };
  }

  function parseFor(): Statement {
    const token = consume(); // 'for'
    skipEnds();
    expectOp("(", "after `for`");

    let init: Expr | null = null;
    if (peek().kind !== "end") {
      init = parseExpression();
    }
    if (peek().kind !== "end") {
      throw new ScriptError("syntax.error", `expected \`;\` after \`for\` initialiser but found ${describe(peek())}`, { file: "", line: peek().line });
    }
    consume(); // consume ';'

    let cond: Expr | null = null;
    if (peek().kind !== "end") {
      cond = parseExpression();
    }
    if (peek().kind !== "end") {
      throw new ScriptError("syntax.error", `expected \`;\` after \`for\` condition but found ${describe(peek())}`, { file: "", line: peek().line });
    }
    consume(); // consume ';'

    let step: Expr | null = null;
    if (!isOp(peek(), ")")) {
      step = parseExpression();
    }
    expectOp(")", "after `for` step");

    const body = expectBlock("after `for` header");
    return { kind: "for", init, cond, step, body, line: token.line };
  }

  function parseSwitch(): Statement {
    const token = consume(); // 'switch'
    skipEnds();
    expectOp("(", "after `switch`");
    const value = parseExpression();
    skipEnds();
    expectOp(")", "after `switch` value");

    skipEnds();
    const openBrace = peek();
    if (!isOp(openBrace, "{")) {
      throw new ScriptError(
        "syntax.unsupported",
        `braces are mandatory (STX-1): expected \`{\` after \`switch\` but found ${describe(openBrace)}`,
        { file: "", line: openBrace.line },
      );
    }
    consume();

    const cases: SwitchCase[] = [];
    let defaultBody: Block | null = null;

    skipEnds();
    while (peek().kind !== "eof" && !isOp(peek(), "}")) {
      const caseOrDef = peek();
      if (isIdent(caseOrDef, "case")) {
        consume(); // 'case'
        skipEnds();
        const caseValue = parseExpression();
        skipEnds();
        if (isOp(peek(), ":")) consume(); // colon is optional (STX-2)
        const caseBody = expectBlock("in `case` label");
        cases.push({ value: caseValue, body: caseBody, line: caseOrDef.line });
        skipEnds();
        continue;
      }
      if (isIdent(caseOrDef, "default")) {
        consume(); // 'default'
        skipEnds();
        if (isOp(peek(), ":")) consume(); // colon is optional
        defaultBody = expectBlock("in `default` label");
        skipEnds();
        continue;
      }
      throw new ScriptError(
        "syntax.error",
        `expected \`case\` or \`default\` inside \`switch\` but found ${describe(caseOrDef)}`,
        { file: "", line: caseOrDef.line },
      );
    }

    if (!isOp(peek(), "}")) {
      throw new ScriptError(
        "syntax.error",
        `expected \`}\` to close \`switch\` but found ${describe(peek())}`,
        { file: "", line: peek().line },
      );
    }
    consume(); // '}'

    return {
      kind: "switch",
      value,
      cases,
      defaultBody,
      line: token.line,
    };
  }

  function parseReturn(): Statement {
    const token = consume(); // 'return'
    const next = peek();

    // Bare return
    if (next.kind === "end" || next.kind === "eof" || isOp(next, "}")) {
      expectStatementEnd();
      return { kind: "return", value: null, byRef: false, line: token.line };
    }

    // return &lvalue (FUN-3)
    if (isOp(next, "&")) {
      consume(); // consume '&'
      const value = parseExpression();
      expectStatementEnd();
      return { kind: "return", value, byRef: true, line: token.line };
    }

    // return expr
    const value = parseExpression();
    expectStatementEnd();
    return { kind: "return", value, byRef: false, line: token.line };
  }

  /**
   * Legacy `on error goto :label` and `on error resume next` (ERR-1). Each
   * lowers to the same call as its modern form, `setErrorHandler(:label)` or
   * `setResumeNextHandler()`, so both share one runtime path.
   */
  function parseOnError(): Statement {
    const token = consume(); // 'on'
    consume(); // 'error'
    const mode = peek();
    if (isIdent(mode, "resume")) {
      consume();
      const word = peek();
      if (!isIdent(word, "next")) {
        throw new ScriptError(
          "syntax.error",
          `expected \`next\` after \`on error resume\` but found ${describe(word)}`,
          { file: "", line: word.line },
        );
      }
      consume();
      expectStatementEnd();
      return {
        kind: "expr",
        expr: { kind: "call", name: "setresumenexthandler", args: [], line: token.line },
        line: token.line,
      };
    }
    if (isIdent(mode, "goto")) {
      consume();
      expectOp(":", "before the handler label of `on error goto`");
      const label = peek();
      if (label.kind !== "identifier") {
        throw new ScriptError(
          "syntax.error",
          `expected a label name after \`on error goto :\` but found ${describe(label)}`,
          { file: "", line: token.line },
        );
      }
      consume();
      expectStatementEnd();
      return {
        kind: "expr",
        expr: {
          kind: "call",
          name: "seterrorhandler",
          args: [{ kind: "labelRef", name: label.name, line: token.line }],
          line: token.line,
        },
        line: token.line,
      };
    }
    throw new ScriptError(
      "syntax.error",
      `expected \`goto\` or \`resume next\` after \`on error\` but found ${describe(mode)}`,
      { file: "", line: token.line },
    );
  }

  function parseStatement(inBlock = false): Statement {
    const token = peek();

    // Inline function hint
    if (isIdent(token, "inline")) {
      const next = tokens[index + 1];
      if (next && (isIdent(next, "function") || isIdent(next, "method"))) {
        if (inBlock) {
          throw new ScriptError(
            "syntax.error",
            "function definitions cannot appear inside blocks",
            { file: "", line: token.line },
          );
        }
        consume(); // 'inline'
        const fn = parseFunction(true);
        functions.push(fn);
        return {
          kind: "expr",
          expr: { kind: "literal", value: 0, line: token.line },
          line: token.line,
        };
      }
    }

    // Class and struct declarations are hoisted metadata, not executable statements.
    if (isIdent(token, "class") || isIdent(token, "struct")) {
      if (inBlock) throw new ScriptError("syntax.error", "class declarations cannot appear inside blocks", { file: "", line: token.line });
      classes.push(parseClass(token.name === "struct"));
      return { kind: "expr", expr: { kind: "literal", value: 0, line: token.line }, line: token.line };
    }
    // Function or out-of-class method definition.
    if (isIdent(token, "function") || isIdent(token, "method")) {
      if (inBlock) {
        throw new ScriptError(
          "syntax.error",
          "function definitions cannot appear inside blocks",
          { file: "", line: token.line },
        );
      }
      if (isIdent(token, "method") && isOp(tokens[index + 2] ?? eof, "::")) {
        const method = parseOutOfClassMethod();
        const owner = classes.find((item) => item.name === method.owner);
        if (owner === undefined) {
          throw new ScriptError("compile.unknown-class", `class \`${method.owner}\` is not defined`, {
            file: "",
            line: method.line,
          });
        }
        owner.methods = [...owner.methods, method];
      } else {
        functions.push(parseFunction(false));
      }
      return {
        kind: "expr",
        expr: { kind: "literal", value: 0, line: token.line },
        line: token.line,
      };
    }

    // Control statements
    if (isIdent(token, "if")) return parseIf();
    if (isIdent(token, "while")) return parseWhile();
    if (isIdent(token, "until")) return parseUntil();
    if (isIdent(token, "for")) return parseFor();
    if (isIdent(token, "switch")) return parseSwitch();
    if (isIdent(token, "return")) return parseReturn();
    if (isIdent(token, "on") && isIdent(tokens[index + 1] ?? eof, "error")) return parseOnError();

    // :label statement (STX-5) vs :x = 1 global variable write
    if (isOp(token, ":")) {
      const next = tokens[index + 1];
      const after = tokens[index + 2];
      if (
        next &&
        next.kind === "identifier" &&
        after &&
        (after.kind === "end" || after.kind === "eof" || isOp(after, "}"))
      ) {
        consume(); // ':'
        consume(); // identifier
        expectStatementEnd();
        return { kind: "label", name: next.name, line: token.line };
      }
    }

    // Bare identifier alone on a line: zero-argument call (e.g. `end\n` -> `end()`)
    if (token.kind === "identifier") {
      const next = tokens[index + 1];
      if (next && (next.kind === "end" || next.kind === "eof" || isOp(next, "}"))) {
        consume();
        expectStatementEnd();
        return {
          kind: "expr",
          expr: makeCall(token.name, [], token.line),
          line: token.line,
        };
      }
    }

    // Expression statement (assignment, call, decl, etc.)
    const expr = parseExpression();
    expectStatementEnd();
    return { kind: "expr", expr, line: expr.line };
  }

  const statements: Statement[] = [];
  const functions: FunctionDef[] = [];
  skipEnds();
  while (peek().kind !== "eof") {
    const stmt = parseStatement(false);
    // Function definitions are collected into `functions` and leave a dummy expr;
    // do not add them to top-level statements
    if (
      !(
        stmt.kind === "expr" &&
        stmt.expr.kind === "literal" &&
        stmt.expr.value === 0 &&
        functions.length > 0 &&
        functions[functions.length - 1]?.line === stmt.line
      )
    ) {
      statements.push(stmt);
    }
    skipEnds();
  }

  return { statements, functions, classes, includes: implicit };
}
