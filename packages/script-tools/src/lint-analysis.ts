/**
 * The parsed-program facts the scoped lint rules need
 * (docs/spec/engine/rpgcode-tooling.md#tool-3-rules).
 *
 * The TOOL-6 index is a flat, published view: it drops lexical scope, label
 * references and the call kind, so it cannot tell a callable parameter from a
 * command or a user method from a built-in (#2077). These facts are read from
 * the units the compiler parsed while the index was built - never from a
 * second parse - and stay internal: they are attached to the in-memory index
 * program, are not part of its JSON shape, and are absent from an index read
 * back from JSON (the linter then reports the affected rules unassessed).
 */

import { foldAscii, type Block, type Expr, type Param, type ProgramUnit, type ScriptDialect, type Statement } from "@tk-reawakened/core";
import type { IndexPos, IndexProgram } from "./index-document.ts";

export type ParsedFacts = {
  readonly units: readonly ProgramUnit[];
  /** The dialect the program reference stated; `undefined` when it relied on the compiler's default. */
  readonly dialect: ScriptDialect | undefined;
};

const PARSED = new WeakMap<IndexProgram, ParsedFacts>();

export function recordParsed(program: IndexProgram, facts: ParsedFacts): void {
  PARSED.set(program, facts);
}

export function parsedOf(program: IndexProgram): ParsedFacts | undefined {
  return PARSED.get(program);
}

/** A node span with the file it belongs to. */
export type Site = IndexPos;

export function siteOf(unit: ProgramUnit, node: { readonly line: number; readonly col?: number; readonly endCol?: number }): Site {
  return {
    file: unit.name === "" ? "<inline>" : unit.name,
    line: node.line,
    ...(node.col === undefined ? {} : { col: node.col }),
    ...(node.endCol === undefined ? {} : { endCol: node.endCol }),
  };
}

export function siteKey(site: Site): string {
  return `${site.file}\u0000${site.line}\u0000${site.col ?? 0}`;
}

/** Calls that can read or run code by computed text in the running scope (`#RPGCode`, `bindingOf`). */
const DYNAMIC_CALLS: ReadonlySet<string> = new Set(["rpgcode", "bindingof"]);
/** Calls that install or use an error handler, so a later statement may run after a failure (ERR-1). */
const HANDLER_CALLS: ReadonlySet<string> = new Set(["seterrorhandler", "setresumenexthandler", "resumenext"]);
/** Calls that take a label target (STX-5, ERR-1). */
const LABEL_TARGET_CALLS: ReadonlySet<string> = new Set(["branch", "seterrorhandler", "goto"]);
/** The built-in program-flow names that end the program (`done` and `stop` are aliases of `end`). */
export const TERMINATOR_NAMES: ReadonlySet<string> = new Set(["end", "done", "stop"]);

export function childExpressions(expr: Expr): readonly Expr[] {
  switch (expr.kind) {
    case "call":
    case "construct":
      return expr.args;
    case "methodCall":
      return [expr.receiver, ...expr.args];
    case "callIndirect":
      return [expr.callee, ...expr.args];
    case "member":
      return [expr.receiver];
    case "index":
      return [expr.base, expr.index];
    case "unary":
    case "postfix":
      return [expr.operand];
    case "binary":
      return [expr.left, expr.right];
    case "ternary":
      return [expr.cond, expr.then, expr.else];
    case "assign":
      return [expr.target, expr.value];
    case "object":
      return expr.entries.map((entry) => entry.value);
    default:
      return [];
  }
}

export function statementExpressions(statement: Statement): readonly Expr[] {
  switch (statement.kind) {
    case "expr":
      return [statement.expr];
    case "if":
      return statement.branches.map((branch) => branch.cond);
    case "while":
    case "until":
      return [statement.cond];
    case "for":
      return [statement.init, statement.cond, statement.step].filter((expr): expr is Expr => expr !== null);
    case "switch":
      return [statement.value, ...statement.cases.map((item) => item.value)];
    case "return":
      return statement.value === null ? [] : [statement.value];
    default:
      return [];
  }
}

export function nestedBlocks(statement: Statement): readonly Block[] {
  switch (statement.kind) {
    case "if":
      return [...statement.branches.map((branch) => branch.body), ...(statement.elseBody === null ? [] : [statement.elseBody])];
    case "while":
    case "until":
    case "for":
      return [statement.body];
    case "switch":
      return [...statement.cases.map((item) => item.body), ...(statement.defaultBody === null ? [] : [statement.defaultBody])];
    default:
      return [];
  }
}

/** One scope a label or a local belongs to: the program body, a function, a method or a lambda (STX-5, FUN-8). */
export type Scope = {
  readonly kind: "program" | "function" | "method" | "lambda";
  readonly params: readonly Param[];
  readonly body: Block;
  /** The scope a lambda was created in; `null` for every other kind, because a function never sees its caller's locals. */
  readonly parent: Scope | null;
};

/** Every scope of one unit, in source order: the program body, its functions, its methods and every lambda inside them. */
export function scopesOf(unit: ProgramUnit): Scope[] {
  const scopes: Scope[] = [];
  const add = (scope: Scope): void => {
    scopes.push(scope);
    forEachExpression(scope.body, (expr) => {
      if (expr.kind === "lambda") add({ kind: "lambda", params: expr.params, body: expr.body, parent: scope });
    }, false);
  };
  add({ kind: "program", params: [], body: unit.ast.statements, parent: null });
  for (const fn of unit.ast.functions) add({ kind: "function", params: fn.params, body: fn.body, parent: null });
  for (const cls of unit.ast.classes) {
    for (const method of cls.methods) {
      if (method.body !== null) add({ kind: "method", params: method.params, body: method.body, parent: null });
    }
  }
  return scopes;
}

/**
 * Visit every expression of a block. With `intoLambdas` false a lambda is
 * visited itself but not its body, which belongs to its own scope.
 */
export function forEachExpression(block: Block, visit: (expr: Expr, parent: Expr | null) => void, intoLambdas: boolean): void {
  const walkExpr = (expr: Expr, parent: Expr | null): void => {
    visit(expr, parent);
    if (expr.kind === "lambda") {
      if (intoLambdas) walkBlock(expr.body);
      return;
    }
    for (const child of childExpressions(expr)) walkExpr(child, expr);
  };
  const walkBlock = (items: Block): void => {
    for (const statement of items) {
      for (const expr of statementExpressions(statement)) walkExpr(expr, null);
      for (const nested of nestedBlocks(statement)) walkBlock(nested);
    }
  };
  walkBlock(block);
}

/** The label statements of a block and its nested control blocks (not of nested lambdas). */
export function labelsIn(block: Block): Extract<Statement, { kind: "label" }>[] {
  const found: Extract<Statement, { kind: "label" }>[] = [];
  const walk = (items: Block): void => {
    for (const statement of items) {
      if (statement.kind === "label") found.push(statement);
      for (const nested of nestedBlocks(statement)) walk(nested);
    }
  };
  walk(block);
  return found;
}

/** The folded names a scope's own frame holds: its parameters and its declared locals (not those of nested lambdas). */
export function localNames(scope: Scope): Set<string> {
  const names = new Set(scope.params.map((param) => foldAscii(param.name)));
  forEachExpression(scope.body, (expr) => {
    if (expr.kind === "decl" && expr.scope === "local") names.add(foldAscii(expr.name));
  }, false);
  return names;
}

/** A string literal's possible names: the text folded, with a leading `:` or trailing sigil removed. */
export function namesInString(value: string): string[] {
  const folded = foldAscii(value.trim());
  const bare = folded.replace(/^:/, "").replace(/[!$]$/, "");
  return bare === folded ? [folded] : [folded, bare];
}

/** Everything a scope (with its lambdas) names: variables read, plain calls, label references and string literals. */
export function mentionsIn(block: Block, options: { readonly readsOnly: boolean }): Set<string> {
  const names = new Set<string>();
  forEachExpression(block, (expr, parent) => {
    switch (expr.kind) {
      case "variable":
        // A plain `x = value` writes x without reading it; every other appearance reads it.
        if (options.readsOnly && parent !== null && parent.kind === "assign" && parent.operator === "=" && parent.target === expr) return;
        names.add(foldAscii(expr.name));
        return;
      case "call":
        names.add(foldAscii(expr.name));
        return;
      case "labelRef":
        names.add(foldAscii(expr.name));
        return;
      case "literal":
        if (typeof expr.value === "string") for (const name of namesInString(expr.value)) names.add(name);
        return;
      default:
        return;
    }
  }, true);
  return names;
}

/** Whether a scope (with its lambdas) evaluates code or resolves names from computed text. */
export function hasDynamicReference(block: Block): boolean {
  let found = false;
  forEachExpression(block, (expr) => {
    if (expr.kind === "call" && expr.file === undefined && DYNAMIC_CALLS.has(foldAscii(expr.name))) found = true;
  }, true);
  return found;
}

/** Whether a scope passes a label-taking call a target that is not a literal label or string. */
export function hasComputedLabelTarget(block: Block): boolean {
  let found = false;
  forEachExpression(block, (expr) => {
    if (expr.kind !== "call" || expr.file !== undefined || !LABEL_TARGET_CALLS.has(foldAscii(expr.name))) return;
    const [first] = expr.args;
    if (first === undefined) return;
    if (first.kind === "labelRef" || (first.kind === "literal" && typeof first.value === "string")) return;
    found = true;
  }, true);
  return found;
}

/** Whether a scope's own frame installs or uses an error handler (not a nested lambda's frame). */
export function hasErrorHandler(block: Block): boolean {
  let found = false;
  forEachExpression(block, (expr) => {
    if (expr.kind === "call" && expr.file === undefined && HANDLER_CALLS.has(foldAscii(expr.name))) found = true;
  }, false);
  return found;
}

/**
 * Plain-call and method-call sites that cannot be the registered command of
 * that name (#2077; FUN-8 "Calling a name", entry 1):
 * - a plain call of a name the running scope or a creating scope holds (a
 *   parameter, a declared local, a captured local), or of a name the program
 *   assigns as a variable anywhere, since a callable bound to it runs first;
 * - a method call whose name is a method of a class the program declares.
 */
export function boundCallSites(units: readonly ProgramUnit[], hostMethods: ReadonlySet<string>): { readonly sites: Set<string>; readonly assigned: Set<string> } {
  const assigned = new Set<string>();
  const methods = new Set<string>();
  for (const unit of units) {
    for (const cls of unit.ast.classes) for (const method of cls.methods) methods.add(foldAscii(method.name));
    for (const scope of scopesOf(unit)) {
      forEachExpression(scope.body, (expr) => {
        if (expr.kind !== "assign") return;
        if (expr.target.kind === "variable" || expr.target.kind === "decl") assigned.add(foldAscii(expr.target.name));
      }, false);
    }
  }
  const sites = new Set<string>();
  for (const unit of units) {
    for (const scope of scopesOf(unit)) {
      const reachable = new Set<string>();
      for (let current: Scope | null = scope; current !== null; current = current.parent) {
        for (const name of localNames(current)) reachable.add(name);
      }
      forEachExpression(scope.body, (expr) => {
        if (expr.kind === "call" && expr.file === undefined) {
          const name = foldAscii(expr.name);
          if (reachable.has(name) || assigned.has(name)) sites.add(siteKey(siteOf(unit, expr)));
        } else if (expr.kind === "methodCall") {
          const name = foldAscii(expr.name);
          if (methods.has(name) || hostMethods.has(name)) sites.add(siteKey(siteOf(unit, expr)));
        }
      }, false);
    }
  }
  return { sites, assigned };
}
