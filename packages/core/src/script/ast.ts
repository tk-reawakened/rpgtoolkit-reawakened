/**
 * The Unified AST for RPGCode (ADR 0004 decision 1; docs/spec/formats/rpgcode-program.md#text-form.
 *
 * Covers expressions, statements, control flow, functions and parameter lists,
 * with a source span on every node.
 *
 * A node's `line`, `col` and `endCol` all come from one token: the token the
 * node's `line` names. A composite node therefore anchors on the first token of
 * the construct, exactly as its `line` always did, and its range is one line
 * long. The columns follow the range convention of
 * docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention: UTF-16 code
 * units of the decoded source, 1-based and inclusive. `col` and `endCol` are
 * optional because a hand-written node (a test fixture, a synthesized node)
 * need not name a source site, while `line` is always present.
 *
 * docs/adr/0004 decision 1; docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands.
 */

import type { Value, VarScope } from "../ports/value.ts";
import type { BinaryOp, UnaryOp } from "./ops.ts";

/** One function parameter (docs/spec/engine/rpgcode-modules-and-objects.md#modules FUN-1). */
export type Param = {
  readonly name: string;
  readonly byRef: boolean;
  readonly typeName: string | null;
  readonly line: number;
  /** First code unit of the parameter's name (TOOL-3 range convention). */
  readonly col?: number;
  /** Last code unit of the parameter's name (TOOL-3 range convention). */
  readonly endCol?: number;
};

/** An ordered statement block. */
export type Block = readonly Statement[];

/** One program-level function definition (FUN-1, FUN-6). */
export type FunctionDef = {
  readonly name: string;
  readonly params: readonly Param[];
  readonly body: Block;
  readonly isInline: boolean;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type AccessLevel = "public" | "private";

export type MemberDef = {
  readonly name: string;
  readonly arraySize: number | null;
  readonly access: AccessLevel;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type MethodDef = {
  readonly name: string;
  readonly params: readonly Param[];
  readonly body: Block | null;
  readonly isPure: boolean;
  readonly access: AccessLevel;
  readonly owner: string;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

export type ClassDef = {
  readonly name: string;
  readonly bases: readonly string[];
  readonly members: readonly MemberDef[];
  methods: MethodDef[];
  readonly isStruct: boolean;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

/** A value-producing or variable-reading expression (docs/spec/formats/rpgcode-program.md#text-form. */
export type Expr =
  | {
      readonly kind: "literal";
      readonly value: Value;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "variable";
      readonly name: string;
      readonly scope: VarScope | null;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "decl";
      readonly scope: VarScope;
      readonly name: string;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "labelRef";
      readonly name: string;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "call";
      readonly name: string;
      readonly args: readonly Expr[];
      /** The folded file name of a `file.func(...)` call; the call binds to that file first (MOD-2). */
      readonly file?: string;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "methodCall";
      readonly receiver: Expr;
      readonly name: string;
      readonly args: readonly Expr[];
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "member";
      readonly receiver: Expr;
      readonly name: string;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "construct";
      readonly className: string;
      readonly args: readonly Expr[];
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "index";
      readonly base: Expr;
      readonly index: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "unary";
      readonly operator: UnaryOp;
      readonly operand: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "postfix";
      readonly operator: "++" | "--";
      readonly operand: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "binary";
      readonly operator: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "ternary";
      readonly cond: Expr;
      readonly then: Expr;
      readonly else: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "assign";
      readonly operator: string;
      readonly target: Expr;
      readonly value: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  /**
   * An arrow lambda (docs/spec/engine/rpgcode-language.md FUN-8). The body is always a block:
   * an expression body `(x) => x + 1` is stored as `{ return x + 1 }`.
   */
  | {
      readonly kind: "lambda";
      readonly params: readonly Param[];
      readonly body: Block;
      /** True when written with an expression body (no braces). */
      readonly exprBody: boolean;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  /** A dictionary literal `{ key: value, ... }` (OOP-10); keys keep source order. */
  | {
      readonly kind: "object";
      readonly entries: readonly ObjectEntry[];
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  /** A call whose callee is an arbitrary expression rather than a name: `f()()`, `a[i](x)`, `(x => x)(1)`. */
  | {
      readonly kind: "callIndirect";
      readonly callee: Expr;
      readonly args: readonly Expr[];
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    };

/** One `key: value` entry of a dictionary literal. */
export type ObjectEntry = {
  readonly key: string;
  readonly value: Expr;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

/** One branch of an if/elseif chain (STX-3). */
export type IfBranch = {
  readonly cond: Expr;
  readonly body: Block;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

/** One case in a switch statement (STX-2). */
export type SwitchCase = {
  readonly value: Expr;
  readonly body: Block;
  readonly line: number;
  readonly col?: number;
  readonly endCol?: number;
};

/** A statement (docs/spec/engine/rpgcode-modules-and-objects.md#modules). */
export type Statement =
  | {
      readonly kind: "expr";
      readonly expr: Expr;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "if";
      readonly branches: readonly IfBranch[];
      readonly elseBody: Block | null;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "while";
      readonly cond: Expr;
      readonly body: Block;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "until";
      readonly cond: Expr;
      readonly body: Block;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "for";
      readonly init: Expr | null;
      readonly cond: Expr | null;
      readonly step: Expr | null;
      readonly body: Block;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "switch";
      readonly value: Expr;
      readonly cases: readonly SwitchCase[];
      readonly defaultBody: Block | null;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "label";
      readonly name: string;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    }
  | {
      readonly kind: "return";
      readonly value: Expr | null;
      readonly byRef: boolean;
      readonly line: number;
      readonly col?: number;
      readonly endCol?: number;
    };

/**
 * One file a program asks to include: a literal `#include` or an implicit
 * `file.func` include (MOD-2), collected wherever it appears and applied when
 * the file's parse ends (docs/spec/engine/rpgcode-modules-and-objects.md#includes).
 */
export type IncludeRequest = {
  readonly path: string;
  readonly line: number;
  readonly implicit: boolean;
  /** The directive's first code unit (TOOL-3 range convention). */
  readonly col?: number;
  /** The directive's last code unit on its line (TOOL-3 range convention). */
  readonly endCol?: number;
};

/** A parsed program: statements, hoisted functions, class declarations and the files it includes. */
export type Ast = {
  readonly statements: Block;
  readonly functions: readonly FunctionDef[];
  readonly classes: readonly ClassDef[];
  readonly includes: readonly IncludeRequest[];
};
