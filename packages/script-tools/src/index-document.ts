/**
 * The machine-readable RPGCode index (docs/spec/engine/rpgcode-tooling.md#tool-6):
 * one versioned document the language server, the linter and the CLI all read,
 * instead of each walking the compiler again.
 *
 * The facts come from the compiler, not from a second pass: definitions from the
 * parsed units and the compiled function/class/label tables, sites from the
 * lowered ops at their `SourcePos`, includes from the requests the compiler
 * applied, and listeners from the literal first argument of `on`/`once`/`emit`
 * in the parsed AST. A program that does not compile contributes its diagnostic
 * and no facts at all.
 */

import {
  compileProgram,
  foldAscii,
  ScriptError,
  type Block,
  type Expr,
  type FunctionDef,
  type Program,
  type ProgramLoader,
  type ProgramRef,
  type ProgramUnit,
  type SourcePos,
  type Statement,
} from "@tk-reawakened/core";
import { rangeOf, type Diagnostic } from "./diagnostics.ts";

/** The document's schema identity. A change to a field's meaning is a major bump (TOOL-6). */
export const INDEX_SCHEMA = "tkr-index/1.0";

export type IndexPos = {
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type IndexFunction = {
  readonly id: string;
  readonly qualifiedName: string;
  readonly name: string;
  readonly arity: number;
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
  readonly className: string | null;
  readonly isInline?: boolean;
};

export type IndexMember = {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
  readonly access: "public" | "private";
  readonly arraySize: number | null;
};

export type IndexMethod = {
  readonly id: string;
  readonly qualifiedName: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
  readonly arity: number;
  readonly access: "public" | "private";
  readonly isPure: boolean;
};

export type IndexClass = {
  readonly id: string;
  readonly qualifiedName: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
  readonly bases: readonly string[];
  readonly members: readonly IndexMember[];
  readonly methods: readonly IndexMethod[];
};

export type IndexLabel = {
  readonly id: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type IndexInclude = {
  readonly path: string;
  readonly file: string;
  readonly implicit: boolean;
  readonly key?: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type IndexCall = {
  readonly name: string;
  /** The source spelling when the call's position is the callee token. */
  readonly written: string | null;
  readonly arity: number;
  readonly file: string | null;
  readonly fileParam?: boolean;
  readonly pos: IndexPos;
};

export type IndexReference = {
  readonly kind: "read" | "decl" | "member" | "store";
  readonly name: string | null;
  readonly written: string | null;
  readonly scope: "local" | "global" | null;
  readonly pos: IndexPos;
};

export type IndexListener = {
  readonly event: string;
  readonly call: "on" | "once" | "emit";
  readonly pos: IndexPos;
};

export type IndexProgram = {
  readonly name: string;
  readonly key: string;
  readonly files: readonly string[];
  readonly functions: readonly IndexFunction[];
  readonly classes: readonly IndexClass[];
  readonly labels: readonly IndexLabel[];
  readonly includes: readonly IndexInclude[];
  readonly calls: readonly IndexCall[];
  readonly references: readonly IndexReference[];
  readonly listeners: readonly IndexListener[];
  readonly startup: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
};

export type IndexDocument = {
  readonly schema: string;
  readonly programs: readonly IndexProgram[];
  readonly diagnostics: readonly Diagnostic[];
};

export type IndexProgramInput = {
  /** The program's identity in the document (the CLI passes the path it was given). */
  readonly name: string;
  /** How to compile it; a file reference needs the loader in the options. */
  readonly ref: ProgramRef;
};

export type IndexStartup = {
  readonly package: string;
  /** The name of the program in this index that is the package's start-up. */
  readonly program: string;
};

export type IndexOptions = {
  /** Resolves `#include` and `file.func` across files (MOD-2); without one, includes are listed but unresolved. */
  readonly loader?: ProgramLoader;
  /** Package start-up programs, so each is marked in the document. */
  readonly startups?: readonly IndexStartup[];
};

/** The empty facts of a program that did not compile: the absence is the fact (TOOL-6). */
function emptyProgram(name: string, key: string, startup: readonly string[], diagnostics: readonly Diagnostic[]): IndexProgram {
  return {
    name,
    key,
    files: [],
    functions: [],
    classes: [],
    labels: [],
    includes: [],
    calls: [],
    references: [],
    listeners: [],
    startup,
    diagnostics,
  };
}

function sourceOf(error: unknown, source: string, file: string): Diagnostic | null {
  if (!(error instanceof ScriptError)) return null;
  const pos: SourcePos = error.pos ?? { file, line: 1 };
  return {
    code: error.code,
    severity: "error",
    range: rangeOf({ ...pos, file: pos.file === "" ? file : pos.file }, source),
    message: error.message,
  };
}

/** The text a position names, or `null` when the compiler had no identifier token there. */
function writtenAt(unit: ProgramUnit, pos: SourcePos): string | null {
  if (pos.col === undefined || pos.endCol === undefined) return null;
  const line = (unit.text.split("\n")[pos.line - 1] ?? "").slice(pos.col - 1, pos.endCol);
  return line.length === 0 ? null : line;
}

function posOf(pos: SourcePos): IndexPos {
  return {
    file: pos.file === "" ? "<inline>" : pos.file,
    line: pos.line,
    ...(pos.col === undefined ? {} : { col: pos.col }),
    ...(pos.endCol === undefined ? {} : { endCol: pos.endCol }),
  };
}

function spanOf(node: { readonly line: number; readonly col?: number; readonly endCol?: number }): {
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
} {
  return {
    line: node.line,
    ...(node.col === undefined ? {} : { col: node.col }),
    ...(node.endCol === undefined ? {} : { endCol: node.endCol }),
  };
}

function functionsOf(unit: ProgramUnit): IndexFunction[] {
  return unit.ast.functions.map((fn: FunctionDef) => ({
    id: `${unit.key}#function:${fn.name}`,
    qualifiedName: fn.name,
    name: fn.name,
    arity: fn.params.length,
    file: unit.key,
    ...spanOf(fn),
    className: null,
    isInline: fn.isInline,
  }));
}

function classesOf(unit: ProgramUnit): IndexClass[] {
  return unit.ast.classes.map((cls) => ({
    id: `${unit.key}#class:${cls.name}`,
    qualifiedName: cls.name,
    name: cls.name,
    file: unit.key,
    ...spanOf(cls),
    bases: [...cls.bases],
    members: cls.members.map((member) => ({
      id: `${unit.key}#member:${cls.name}.${member.name}`,
      name: member.name,
      file: unit.key,
      ...spanOf(member),
      access: member.access,
      arraySize: member.arraySize,
    })),
    methods: cls.methods.map((method) => ({
      id: `${unit.key}#method:${cls.name}.${method.name}`,
      qualifiedName: `${cls.name}.${method.name}`,
      name: method.name,
      file: unit.key,
      ...spanOf(method),
      arity: method.params.length,
      access: method.access,
      isPure: method.isPure,
    })),
  }));
}

function labelsOf(unit: ProgramUnit): IndexLabel[] {
  const labels: IndexLabel[] = [];
  const walk = (block: Block): void => {
    for (const statement of block) walkStatement(statement);
  };
  function walkStatement(statement: Statement): void {
    switch (statement.kind) {
      case "label":
        labels.push({
          id: `${unit.key}#label:${statement.name}`,
          name: statement.name,
          file: unit.key,
          ...spanOf(statement),
        });
        break;
      case "if":
        for (const branch of statement.branches) walk(branch.body);
        if (statement.elseBody !== null) walk(statement.elseBody);
        break;
      case "while":
      case "until":
      case "for":
        walk(statement.body);
        break;
      case "switch":
        for (const item of statement.cases) walk(item.body);
        if (statement.defaultBody !== null) walk(statement.defaultBody);
        break;
      default:
        break;
    }
  }
  walk(unit.ast.statements);
  return labels;
}

const LISTENER_CALLS: { readonly [name: string]: true } = { on: true, once: true, emit: true };

/** Every `on("event", …)`-style literal listener in one expression tree, in source order. */
function listenersOf(unit: ProgramUnit): IndexListener[] {
  const found: IndexListener[] = [];
  const visitExpr = (expr: Expr): void => {
    // `on(...)` is a plain call; `game.on(...)` is a method call on the receiver.
    const listener = expr.kind === "call" || expr.kind === "methodCall" ? expr : null;
    if (listener !== null && Object.hasOwn(LISTENER_CALLS, listener.name)) {
      const [first] = listener.args;
      if (first !== undefined && first.kind === "literal" && typeof first.value === "string") {
        found.push({
          event: first.value,
          call: listener.name as "on" | "once" | "emit",
          pos: posOf({ file: unit.key, ...spanOf(listener) }),
        });
      }
    }
    for (const child of childExpressions(expr)) visitExpr(child);
  };
  const visitStatement = (statement: Statement): void => {
    for (const expr of statementExpressions(statement)) visitExpr(expr);
  };
  const walk = (block: Block): void => {
    for (const statement of block) visitStatement(statement);
  };
  walk(unit.ast.statements);
  return found;
}

function childExpressions(expr: Expr): Expr[] {
  switch (expr.kind) {
    case "call":
      return [...expr.args];
    case "methodCall":
      return [expr.receiver, ...expr.args];
    case "callIndirect":
      return [expr.callee, ...expr.args];
    case "member":
      return [expr.receiver];
    case "construct":
      return [...expr.args];
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
    case "lambda":
      return [];
    case "object":
      return expr.entries.map((entry) => entry.value);
    default:
      return [];
  }
}

function statementExpressions(statement: Statement): Expr[] {
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

function includeKey(program: Program, path: string): string | undefined {
  return program.fileKeys[foldAscii(path)];
}

function programFacts(
  program: Program,
  name: string,
  startup: readonly string[],
  unitsByName: ReadonlyMap<string, ProgramUnit>,
): IndexProgram {
  const units = program.units;
  const mainKey = units[0]?.key ?? name;
  const functions: IndexFunction[] = [];
  const classes: IndexClass[] = [];
  const labels: IndexLabel[] = [];
  const includes: IndexInclude[] = [];
  const calls: IndexCall[] = [];
  const references: IndexReference[] = [];
  const listeners: IndexListener[] = [];

  for (const unit of units) {
    functions.push(...functionsOf(unit));
    classes.push(...classesOf(unit));
    labels.push(...labelsOf(unit));
    listeners.push(...listenersOf(unit));
    for (const request of unit.requests) {
      const key = includeKey(program, request.path);
      includes.push({
        path: request.path,
        file: unit.name,
        implicit: request.implicit,
        ...(key === undefined ? {} : { key }),
        line: request.line,
        ...(request.col === undefined ? {} : { col: request.col }),
        ...(request.endCol === undefined ? {} : { endCol: request.endCol }),
      });
    }
  }

  for (const op of program.ops) {
    const unit = unitsByName.get(op.pos.file);
    switch (op.op) {
      case "call":
        calls.push({
          name: op.name,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          arity: op.argc,
          file: op.file ?? null,
          ...(op.fileParam === true ? { fileParam: true } : {}),
          pos: posOf(op.pos),
        });
        break;
      case "methodCall":
        calls.push({
          name: op.name,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          arity: op.argc,
          file: null,
          pos: posOf(op.pos),
        });
        break;
      case "construct":
        calls.push({
          name: op.className,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          arity: op.argc,
          file: null,
          pos: posOf(op.pos),
        });
        break;
      case "load":
        references.push({
          kind: "read",
          name: op.name,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          scope: op.scope ?? null,
          pos: posOf(op.pos),
        });
        break;
      case "declRef":
        references.push({
          kind: "decl",
          name: op.name,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          scope: op.scope,
          pos: posOf(op.pos),
        });
        break;
      case "member":
      case "get_member_bound":
        references.push({
          kind: "member",
          name: op.name,
          written: unit === undefined ? null : writtenAt(unit, op.pos),
          scope: null,
          pos: posOf(op.pos),
        });
        break;
      case "storeRef":
        references.push({ kind: "store", name: null, written: null, scope: null, pos: posOf(op.pos) });
        break;
      default:
        break;
    }
  }

  return {
    name,
    key: mainKey,
    files: units.map((unit) => unit.key),
    functions,
    classes,
    labels,
    includes,
    calls,
    references,
    listeners,
    startup,
    diagnostics: [],
  };
}

/**
 * Build the index for the given programs, in order. Each is compiled through the
 * core compiler with the supplied loader, so a `file.func` include resolves
 * exactly as it does at run time; a program that fails contributes its one
 * TOOL-3 diagnostic and no facts.
 */
export function buildIndex(programs: readonly IndexProgramInput[], options: IndexOptions = {}): IndexDocument {
  const startupsOf = (name: string): string[] =>
    (options.startups ?? []).filter((entry) => entry.program === name).map((entry) => entry.package);
  const output: IndexProgram[] = [];
  for (const input of programs) {
    try {
      const program = compileProgram(
        input.ref,
        options.loader === undefined ? {} : { loader: options.loader },
      );
      const unitsByName = new Map(program.units.map((unit) => [unit.name, unit]));
      output.push(programFacts(program, input.name, startupsOf(input.name), unitsByName));
    } catch (error) {
      // The text is the main unit's; a failure inside an included file has its own
      // file name, and slicing the main text with that position would be a lie.
      const mainName = input.ref.kind === "inline" ? "<inline>" : input.ref.path;
      const failing = error instanceof ScriptError ? error.pos?.file ?? "" : "";
      const isMain = failing === "" || failing === mainName;
      const source = input.ref.kind === "inline" && isMain ? input.ref.text : "";
      const diagnostic = sourceOf(error, source, input.name);
      if (diagnostic === null) throw error;
      const key = input.ref.kind === "file" ? input.ref.path : "<inline>";
      output.push(emptyProgram(input.name, key, startupsOf(input.name), [diagnostic]));
    }
  }
  return {
    schema: INDEX_SCHEMA,
    programs: output,
    diagnostics: output.flatMap((program) => [...program.diagnostics]),
  };
}
