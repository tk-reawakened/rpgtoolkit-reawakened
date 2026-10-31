/**
 * Lowering: the Unified AST to the flat Step IR (ADR 0004 decision 1;
 * docs/spec/engine/rpgcode-errors-and-threads.md#threads THR-3).
 *
 * Emits a linear StepOp array whose every instruction carries an interned
 * `pos: SourcePos`. Top-level code is emitted from op 0, ending with `return`.
 * Function definitions are hoisted and emitted after top-level code.
 *
 * Each statement leaves exactly one value on the operand stack, and the caller
 * appends a `pop`. Control statements leave the unset value (`push 0`).
 *
 * docs/adr/0004 decision 1; docs/spec/engine/rpgcode-functions.md#rpgcode-built-in-commands.
 */

import type { Ast, Block, ClassDef, Expr, FunctionDef, MethodDef, Statement } from "./ast.ts";
import { ScriptError } from "./errors.ts";
import type { SourcePos, StepOp } from "./ops.ts";

/** Parameter info retained on a compiled function for call resolution. */
export type ParamInfo = {
  readonly name: string;
  readonly byRef: boolean;
};

/** Metadata for one compiled function or method. */
export type FunctionInfo = {
  readonly entry: number;
  readonly end: number;
  readonly params: readonly ParamInfo[];
  readonly labels: { readonly [name: string]: number };
  readonly className?: string;
  readonly access?: "public" | "private";
  /**
   * The enclosing names a lambda reads, in first-use order (FUN-8; entry 18.4).
   * The VM allocates one cell per name when it runs the matching `load_fn` and
   * binds those cells back to these names, in this order, on every call. Absent
   * on a named function or method, which captures nothing.
   */
  readonly captures?: readonly string[];
};

export type CompiledClass = {
  readonly name: string;
  readonly bases: readonly string[];
  readonly members: ClassDef["members"];
  readonly methods: { readonly [name: string]: readonly FunctionInfo[] };
  readonly constructor: FunctionInfo | null;
  readonly destructor: FunctionInfo | null;
  readonly abstract: boolean;
};

/** The op range `[start, end)` of one statement, its trailing `pop` included (ERR-1 `resumeNext`). */
export type StatementRange = { readonly start: number; readonly end: number };

/** Where one function definition sits: its name, parameter count and line. */
export type FunctionDefInfo = { readonly name: string; readonly argc: number; readonly line: number };

/** Lowering result: instructions, hoisted function/class tables, top-level labels and statement ranges. */
export type LowerResult = {
  readonly ops: StepOp[];
  readonly functions: { readonly [name: string]: readonly FunctionInfo[] };
  readonly classes: { readonly [name: string]: CompiledClass };
  readonly labels: { readonly [name: string]: number };
  readonly statements: readonly StatementRange[];
  /** Each function definition in source order, for clash warnings (MOD-1). */
  readonly defs: readonly FunctionDefInfo[];
};

/**
 * The enclosing names a lambda body reads, in first-use order — what the lambda
 * captures (FUN-8; docs/spec/engine/rpgcode-language.md#keywords-and-structure;
 * entries 18.4 and 18.5). The body's own `load`s with no explicit scope are its
 * free variable reads, and the name of a plain-name call (`g(args)`, a `call`
 * with no `file.` qualifier) reads the variable `g` to see whether it holds a
 * callable, so it is a capture site too: without it a closure could not call a
 * local callable of its creating function once that function had returned. A
 * name that is not a local of the creating function costs one `""` entry in the
 * handle and nothing else. A parameter (which the body reads without a scope but
 * which shadows the outer name), `this`, a scoped read (`local(x)`,
 * `global(x)`) and an array element are not captures; an array element never
 * appears as a `load` at all, because only its index expression does.
 */
function capturedNames(body: readonly StepOp[], params: readonly ParamInfo[]): string[] {
  const seen = new Set<string>(["this"]);
  for (const param of params) seen.add(param.name);
  const names: string[] = [];
  for (const op of body) {
    const free =
      (op.op === "load" && op.scope === undefined) || (op.op === "call" && op.file === undefined);
    if (!free || seen.has(op.name)) continue;
    seen.add(op.name);
    names.push(op.name);
  }
  return names;
}

/** Lower an AST to the flat Step IR array and function tables. */
export function lower(ast: Ast, file = "<inline>", knownClasses?: ReadonlySet<string>): LowerResult {
  const classNames = new Set([...(knownClasses ?? []), ...ast.classes.map((item) => item.name)]);
  const defs: FunctionDefInfo[] = [];
  const ops: StepOp[] = [];
  const posCache = new Map<string, SourcePos>();
  const statements: StatementRange[] = [];
  const lambdaDefs: { readonly def: string; readonly expr: Extract<Expr, { kind: "lambda" }> }[] = [];
  let lambdaNumber = 0;
  /** The parameter names of the function body being lowered (OOP-6: a parameter shadows a field of the object). */
  let paramNames: ReadonlySet<string> = new Set();
  /** Whether an indexed base is a bare name that is a parameter of the body being lowered. */
  function indexesParam(base: Expr): boolean {
    return base.kind === "variable" && base.name !== "this" && paramNames.has(base.name);
  }
  /**
   * The interned `SourcePos` of a node or a bare line. A node carries the span
   * of the token its `line` came from, so the instruction names exactly that
   * token (docs/spec/engine/rpgcode-tooling.md#tool-3-range-convention); a
   * synthesized instruction with no node keeps `file` and `line` only.
   */
  function getPos(at: { readonly line: number; readonly col?: number; readonly endCol?: number } | number): SourcePos {
    const line = typeof at === "number" ? at : at.line;
    const col = typeof at === "number" ? undefined : at.col;
    const endCol = typeof at === "number" ? undefined : at.endCol;
    const span = col === undefined || endCol === undefined ? undefined : { col, endCol };
    const key = span === undefined ? `line:${line}` : `line:${line}:${col}:${endCol}`;
    let p = posCache.get(key);
    if (!p) {
      p = Object.freeze({ file, line, ...span });
      posCache.set(key, p);
    }
    return p;
  }

  function emitJump(op: "jump" | "jumpIfFalse", target: number, line: number): number {
    const idx = ops.length;
    ops.push({ op, target, pos: getPos(line) });
    return idx;
  }

  function patchJump(idx: number, target: number): void {
    const existing = ops[idx]!;
    if (existing.op === "jump" || existing.op === "jumpIfFalse") {
      ops[idx] = { op: existing.op, target, pos: existing.pos };
    }
  }

  function lowerLvalue(target: Expr): void {
    if (target.kind === "variable") {
      if (target.scope) {
        ops.push({ op: "load", name: target.name, scope: target.scope, pos: getPos(target) });
      } else {
        ops.push({
          op: "load",
          name: target.name,
          ...(paramNames.has(target.name) ? { param: true as const } : {}),
          pos: getPos(target),
        });
      }
      return;
    }
    if (target.kind === "decl") {
      ops.push({ op: "declRef", scope: target.scope, name: target.name, pos: getPos(target) });
      return;
    }
    if (target.kind === "index") {
      lowerIndexBase(target.base);
      lowerExpr(target.index);
      ops.push({ op: "index", ...(indexesParam(target.base) ? { baseParam: true as const } : {}), pos: getPos(target) });
      return;
    }
    if (target.kind === "member") {
      lowerExpr(target.receiver);
      ops.push({ op: "member", name: target.name, pos: getPos(target) });
      return;
    }
    if (target.kind === "call" || target.kind === "methodCall") {
      lowerExpr(target);
      return;
    }
    throw new ScriptError("syntax.error", "invalid assignment target", getPos(target));
  }

  function lowerIndexBase(base: Expr): void {
    if (base.kind === "variable" && base.name !== "this") {
      ops.push({ op: "name", name: base.name, pos: getPos(base) });
    } else {
      lowerExpr(base);
    }
  }

  function lowerExpr(expr: Expr): void {
    switch (expr.kind) {
      case "literal":
        ops.push({ op: "push", value: expr.value, pos: getPos(expr) });
        break;
      case "variable":
        if (expr.scope) {
          ops.push({ op: "load", name: expr.name, scope: expr.scope, pos: getPos(expr) });
        } else {
          ops.push({
            op: "load",
            name: expr.name,
            ...(paramNames.has(expr.name) ? { param: true as const } : {}),
            pos: getPos(expr),
          });
        }
        break;
      case "index":
        lowerIndexBase(expr.base);
        lowerExpr(expr.index);
        ops.push({ op: "index", ...(indexesParam(expr.base) ? { baseParam: true as const } : {}), pos: getPos(expr) });
        break;
      case "decl":
        ops.push({ op: "declRef", scope: expr.scope, name: expr.name, pos: getPos(expr) });
        break;
      case "labelRef":
        ops.push({ op: "push", value: expr.name, pos: getPos(expr) });
        break;
      case "call":
        for (const arg of expr.args) lowerExpr(arg);
        if (expr.file !== undefined) {
          ops.push({
            op: "call",
            name: expr.name,
            argc: expr.args.length,
            file: expr.file,
            ...(paramNames.has(expr.file) ? { fileParam: true as const } : {}),
            pos: getPos(expr),
          });
        } else if (classNames.has(expr.name)) {
          ops.push({ op: "construct", className: expr.name, argc: expr.args.length, pos: getPos(expr) });
        } else {
          ops.push({ op: "call", name: expr.name, argc: expr.args.length, pos: getPos(expr) });
        }
        break;
      case "methodCall":
        lowerExpr(expr.receiver);
        for (const arg of expr.args) lowerExpr(arg);
        ops.push({ op: "methodCall", name: expr.name, argc: expr.args.length, pos: getPos(expr) });
        break;
      case "construct":
        for (const arg of expr.args) lowerExpr(arg);
        ops.push({ op: "construct", className: expr.className, argc: expr.args.length, pos: getPos(expr) });
        break;
      case "member":
        lowerExpr(expr.receiver);
        ops.push({ op: "get_member_bound", name: expr.name, pos: getPos(expr) });
        break;
      case "unary":
        if (expr.operator === "++") {
          lowerLvalue(expr.operand);
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "push", value: 1, pos: getPos(expr) });
          ops.push({ op: "binop", operator: "+", pos: getPos(expr) });
          ops.push({ op: "storeRef", pos: getPos(expr) });
        } else if (expr.operator === "--") {
          lowerLvalue(expr.operand);
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "push", value: 1, pos: getPos(expr) });
          ops.push({ op: "binop", operator: "-", pos: getPos(expr) });
          ops.push({ op: "storeRef", pos: getPos(expr) });
        } else {
          lowerExpr(expr.operand);
          ops.push({ op: "unop", operator: expr.operator, pos: getPos(expr) });
        }
        break;
      case "postfix":
        if (expr.operator === "++") {
          lowerLvalue(expr.operand);
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "push", value: 1, pos: getPos(expr) });
          ops.push({ op: "binop", operator: "+", pos: getPos(expr) });
          ops.push({ op: "storeRef", pos: getPos(expr) });
          ops.push({ op: "pop", pos: getPos(expr) });
        } else {
          lowerLvalue(expr.operand);
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "dup", pos: getPos(expr) });
          ops.push({ op: "push", value: 1, pos: getPos(expr) });
          ops.push({ op: "binop", operator: "-", pos: getPos(expr) });
          ops.push({ op: "storeRef", pos: getPos(expr) });
          ops.push({ op: "pop", pos: getPos(expr) });
        }
        break;
      case "binary":
        lowerExpr(expr.left);
        lowerExpr(expr.right);
        ops.push({ op: "binop", operator: expr.operator, pos: getPos(expr) });
        break;
      case "ternary":
        lowerExpr(expr.cond);
        lowerExpr(expr.then);
        lowerExpr(expr.else);
        ops.push({ op: "select", pos: getPos(expr) });
        break;
      case "assign":
        lowerLvalue(expr.target);
        if (expr.operator === "=") {
          lowerExpr(expr.value);
          ops.push({ op: "storeRef", pos: getPos(expr) });
        } else {
          lowerExpr(expr.value);
          ops.push({ op: "compound", operator: expr.operator, pos: getPos(expr) });
        }
        break;
      case "lambda": {
        const def = `${file}#lambda_${lambdaNumber + 1}`;
        lambdaNumber += 1;
        lambdaDefs.push({ def, expr });
        // Captures are represented as stable cell IDs by the VM. The lowerer does not
        // allocate runtime cells, so this instruction deliberately carries the empty
        // deterministic set; 18.4 resolves the enclosing environment when invoked.
        ops.push({ op: "load_fn", def, captures: [], pos: getPos(expr) });
        break;
      }
      case "callIndirect": {
        lowerExpr(expr.callee);
        for (const arg of expr.args) lowerExpr(arg);
        ops.push({ op: "call_indirect", argc: expr.args.length, pos: getPos(expr) });
        break;
      }
      case "object":
        // A dictionary literal makes its object first and then evaluates the values in
        // the order written, so a nested literal's handle is allocated after its parent's (OOP-10).
        ops.push({ op: "newObject", pos: getPos(expr) });
        for (const entry of expr.entries) {
          lowerExpr(entry.value);
          ops.push({ op: "initMember", key: entry.key, pos: getPos(entry) });
        }
        break;
      }
    }

  /** Lower one statement and its trailing `pop`, recording its op range. */
  function emitStatement(statement: Statement, currentLabels: { [name: string]: number }): void {
    const start = ops.length;
    lowerStatement(statement, currentLabels);
    ops.push({ op: "pop", pos: getPos(statement) });
    statements.push({ start, end: ops.length });
  }

  function lowerBlock(block: Block, currentLabels: { [name: string]: number }): void {
    for (const statement of block) emitStatement(statement, currentLabels);
  }

  function lowerStatement(stmt: Statement, currentLabels: { [name: string]: number }): void {
    switch (stmt.kind) {
      case "expr":
        lowerExpr(stmt.expr);
        break;
      case "if": {
        const jumpEnds: number[] = [];
        let nextBranchJump: number | null = null;

        for (let i = 0; i < stmt.branches.length; i++) {
          const branch = stmt.branches[i]!;
          if (nextBranchJump !== null) {
            patchJump(nextBranchJump, ops.length);
          }
          lowerExpr(branch.cond);
          nextBranchJump = emitJump("jumpIfFalse", 0, branch.line);
          lowerBlock(branch.body, currentLabels);
          jumpEnds.push(emitJump("jump", 0, branch.line));
        }

        if (nextBranchJump !== null) {
          patchJump(nextBranchJump, ops.length);
        }

        if (stmt.elseBody) {
          lowerBlock(stmt.elseBody, currentLabels);
        }

        const endTarget = ops.length;
        for (const j of jumpEnds) {
          patchJump(j, endTarget);
        }
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      }
      case "while": {
        const top = ops.length;
        lowerExpr(stmt.cond);
        const jumpEnd = emitJump("jumpIfFalse", 0, stmt.line);
        lowerBlock(stmt.body, currentLabels);
        emitJump("jump", top, stmt.line);
        patchJump(jumpEnd, ops.length);
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      }
      case "until": {
        const top = ops.length;
        lowerExpr(stmt.cond);
        ops.push({ op: "unop", operator: "!", pos: getPos(stmt) });
        const jumpEnd = emitJump("jumpIfFalse", 0, stmt.line);
        lowerBlock(stmt.body, currentLabels);
        emitJump("jump", top, stmt.line);
        patchJump(jumpEnd, ops.length);
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      }
      case "for": {
        if (stmt.init) {
          lowerExpr(stmt.init);
          ops.push({ op: "pop", pos: getPos(stmt) });
        }
        const top = ops.length;
        let jumpEnd: number | null = null;
        if (stmt.cond) {
          lowerExpr(stmt.cond);
          jumpEnd = emitJump("jumpIfFalse", 0, stmt.line);
        }
        lowerBlock(stmt.body, currentLabels);
        if (stmt.step) {
          lowerExpr(stmt.step);
          ops.push({ op: "pop", pos: getPos(stmt) });
        }
        emitJump("jump", top, stmt.line);
        if (jumpEnd !== null) {
          patchJump(jumpEnd, ops.length);
        }
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      }
      case "switch": {
        lowerExpr(stmt.value);
        const jumpEnds: number[] = [];

        for (const cs of stmt.cases) {
          ops.push({ op: "dup", pos: getPos(cs) });
          lowerExpr(cs.value);
          ops.push({ op: "binop", operator: "==", pos: getPos(cs) });
          const jumpNext = emitJump("jumpIfFalse", 0, cs.line);
          ops.push({ op: "pop", pos: getPos(cs) });
          lowerBlock(cs.body, currentLabels);
          jumpEnds.push(emitJump("jump", 0, cs.line));
          patchJump(jumpNext, ops.length);
        }

        // Pop the test value carried on stack
        ops.push({ op: "pop", pos: getPos(stmt) });

        if (stmt.defaultBody) {
          lowerBlock(stmt.defaultBody, currentLabels);
        }

        const endTarget = ops.length;
        for (const j of jumpEnds) {
          patchJump(j, endTarget);
        }
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      }
      case "label":
        if (Object.hasOwn(currentLabels, stmt.name)) {
          throw new ScriptError(
            "compile.duplicate-label",
            `label \`:${stmt.name}\` is already defined in this scope`,
            getPos(stmt),
          );
        }
        currentLabels[stmt.name] = ops.length;
        ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        break;
      case "return":
        if (stmt.byRef) {
          if (!stmt.value) {
            ops.push({ op: "push", value: 0, pos: getPos(stmt) });
          } else {
            lowerLvalue(stmt.value);
          }
        } else if (stmt.value) {
          lowerExpr(stmt.value);
        } else {
          ops.push({ op: "push", value: 0, pos: getPos(stmt) });
        }
        ops.push({ op: "return", pos: getPos(stmt) });
        break;
    }
  }

  // --- Top-level lowering ---
  const topLabels: { [name: string]: number } = {};
  for (const statement of ast.statements) emitStatement(statement, topLabels);
  const lastLine = ast.statements[ast.statements.length - 1]?.line ?? 1;
  ops.push({ op: "return", pos: getPos(lastLine) });

  // --- Hoisted function and class-method lowering ---
  const functions: { [name: string]: FunctionInfo[] } = {};
  const classes: { [name: string]: CompiledClass } = {};

  function lowerBody(
    body: Block,
    line: number,
    params: readonly { readonly name: string }[],
  ): { entry: number; end: number; labels: { [name: string]: number } } {
    const outer = paramNames;
    paramNames = new Set(params.map((param) => param.name));
    const entry = ops.length;
    const labels: { [name: string]: number } = {};
    for (const statement of body) emitStatement(statement, labels);
    const lastLine = body[body.length - 1]?.line ?? line;
    ops.push({ op: "return", pos: getPos(lastLine) });
    paramNames = outer;
    return { entry, end: ops.length, labels };
  }

  function infoFor(method: FunctionDef | MethodDef, className?: string): FunctionInfo {
    const access = "access" in method ? method.access : undefined;
    if (method.body === null) {
      const base = { entry: -1, end: -1, params: method.params.map((p) => ({ name: p.name, byRef: p.byRef })), labels: {} };
      if (className === undefined) return base;
      return access === undefined ? { ...base, className } : { ...base, className, access };
    }
    const lowered = lowerBody(method.body, method.line, method.params);
    const base = { ...lowered, params: method.params.map((p) => ({ name: p.name, byRef: p.byRef })) };
    if (className === undefined) return base;
    return access === undefined ? { ...base, className } : { ...base, className, access };
  }

  for (const fn of ast.functions) {
    const list = functions[fn.name] ?? [];
    if (list.some((existing) => existing.params.length === fn.params.length)) {
      throw new ScriptError("compile.duplicate-function", `function \`${fn.name}\` with ${fn.params.length} parameter(s) is already defined`, getPos(fn));
    }
    const info = infoFor(fn);
    functions[fn.name] = [...list, info];
    defs.push({ name: fn.name, argc: fn.params.length, line: fn.line });
  }

  for (const cls of ast.classes) {
    const methods: { [name: string]: FunctionInfo[] } = {};
    let constructor: FunctionInfo | null = null;
    let destructor: FunctionInfo | null = null;
    let abstract = false;
    for (const method of cls.methods) {
      if (method.isPure) abstract = true;
      const info = infoFor(method, cls.name);
      if (info.entry < 0) continue;
      const list = methods[method.name] ?? [];
      methods[method.name] = [...list, info];
      if (method.name === cls.name && method.params.length >= 0) constructor = info;
      if (method.name === `~${cls.name}` || method.name === `destructor`) destructor = info;
    }
    classes[cls.name] = { name: cls.name, bases: cls.bases, members: cls.members, methods, constructor, destructor, abstract };
  }
  // Lambdas are anonymous definitions with deterministic IDs. They are lowered after named
  // functions and methods so a `load_fn` emitted in any body can point at a complete range.
  for (let index = 0; index < lambdaDefs.length; index += 1) {
    const lambda = lambdaDefs[index]!;
    const lowered = lowerBody(lambda.expr.body, lambda.expr.line, lambda.expr.params);
    const params = lambda.expr.params.map((param) => ({ name: param.name, byRef: param.byRef }));
    // The captures are worked out here, once per definition, because the load
    // site and the call site must agree on the order without either embedding
    // the list: `load_fn` fills the cells, and the frame bind reads them back in
    // this order (18.4; ADR 0004 decision 8).
    functions[lambda.def] = [
      {
        ...lowered,
        params,
        captures: capturedNames(ops.slice(lowered.entry, lowered.end), params),
      },
    ];
  }

  return { ops, functions, classes, labels: topLabels, statements, defs };
}
