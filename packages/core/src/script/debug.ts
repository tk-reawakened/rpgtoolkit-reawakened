/**
 * The debug projection and the expression reader (TOOL-8; docs/spec/engine/rpgcode-tooling.md).
 *
 * `buildDebugView` copies out what a debugger reads: the tick, each thread
 * with its wait and frames, each frame's own locals and, at the top level, the
 * innermost frame's locals and the globals (P2). `evaluateExpression` parses
 * one expression, refuses everything a watch must not do (a statement, a write,
 * a call outside the closed list `EVALUATE_COMMANDS`, a lambda or a dictionary
 * literal), and runs it on a copied thread and a copied global table under a
 * restricted command table, so no effect can reach the game (P1).
 *
 * Both leave the state hash unchanged: nothing here writes live storage. The
 * instruction budget is `EVALUATE_STEP_BUDGET`, the same figure a thread gets
 * per tick (THR-3), and reaching it is the error `evaluate.budget`.
 *
 * docs/spec/engine/rpgcode-tooling.md#tool-8 (P1 and P2, approved 2026-11-11).
 */

import type { Diagnostic } from "../ports/engine.ts";
import type {
  DebugFrame,
  DebugProgram,
  DebugThread,
  DebugValue,
  DebugVariable,
  DebugView,
  EvalError,
  EvalResult,
} from "../ports/engine.ts";
import type { Value } from "../ports/value.ts";
import type { Expr, Statement } from "./ast.ts";
import type { ProgramCache } from "./cache.ts";
import { createErrorWindows } from "./error-windows.ts";
import { scan } from "./lex.ts";
import { lower } from "./lower.ts";
import { parse } from "./parse.ts";
import { IR_VERSION, type Program, type ProgramRef } from "./program.ts";
import { createCommandLookup } from "./registry.ts";
import { findThread, type Frame, type Thread, type VmState } from "./state.ts";
import { isCallableValue } from "./values.ts";
import { readVariableReference, stepThread, type ScriptServices } from "./vm.ts";
import type { GameState } from "../save/state.ts";

/**
 * The closed list of built-ins `evaluate()` may call (TOOL-8, P1): the folded
 * names of every command whose catalogue row in
 * `docs/spec/engine/rpgcode-functions.md` changes nothing and does not wait.
 * It grows only by editing TOOL-8's table.
 */
export const EVALUATE_COMMANDS: readonly string[] = Object.freeze([
  "asc",
  "castint",
  "castlit",
  "castnum",
  "charat",
  "chr",
  "cos",
  "integermuldiv",
  "instr",
  "isfinite",
  "isinfinity",
  "isnan",
  "lcase",
  "left",
  "len",
  "length",
  "log",
  "mid",
  "replace",
  "right",
  "sin",
  "sqrt",
  "tan",
  "trim",
  "ucase",
]);

const EVALUATE_SET: ReadonlySet<string> = new Set(EVALUATE_COMMANDS);

/** The most VM instructions one `evaluate()` call may run (TOOL-8, P1). */
export const EVALUATE_STEP_BUDGET = 1000;

/** The wrapper the reader parses the text in, so a bare name stays an expression and not a call. */
const WRAPPER = "__tkr_evaluate";
/** The local the lowered expression stores its value in, inside the copied frame only. */
const RESULT_SLOT = "__tkr_result__";

function copyValue(value: Value): DebugValue {
  if (typeof value === "number" || typeof value === "string" || value === null) return value;
  if (isCallableValue(value)) return { kind: "callable", def: value.def };
  return { kind: "object", handle: value.handle, className: value.className };
}

function debugProgram(ref: ProgramRef, program: Program): DebugProgram {
  const key = ref.kind === "file" ? ref.path : "<inline>";
  const text = ref.kind === "file" ? (program.units[0]?.text ?? "") : ref.text;
  return { key, text };
}

/** The function or method whose op range holds `ip`, as the author writes it, or `null` for top-level code. */
function functionNameAt(program: Program, ip: number): string | null {
  for (const [name, list] of Object.entries(program.functions)) {
    for (const fn of list) if (ip >= fn.entry && ip < fn.end) return name;
  }
  for (const [className, compiled] of Object.entries(program.classes)) {
    for (const [methodName, list] of Object.entries(compiled.methods)) {
      for (const fn of list) if (ip >= fn.entry && ip < fn.end) return `${className}.${methodName}`;
    }
  }
  return null;
}

/**
 * The statement a frame is on: the instruction about to run in the innermost
 * frame, and the call it is inside in every outer frame (that frame's
 * instruction pointer has already moved past the call).
 */
function statementIp(frame: Frame, program: Program, innermost: boolean): number {
  const ops = program.ops;
  if (innermost) return ops[frame.ip] === undefined ? frame.ip - 1 : frame.ip;
  return frame.ip - 1 < 0 ? frame.ip : frame.ip - 1;
}

function frameOf(
  vm: VmState,
  services: ScriptServices,
  thread: Thread,
  index: number,
): DebugFrame {
  const frame = thread.frames[index]!;
  const program = services.programs.get(frame.program);
  const at = statementIp(frame, program, index === thread.frames.length - 1);
  const pos = program.ops[at]?.pos ?? program.ops[frame.ip]?.pos ?? program.ops[frame.ip - 1]?.pos ?? null;
  return {
    index,
    program: debugProgram(frame.program, program),
    ip: frame.ip,
    line: pos?.line ?? 0,
    function: functionNameAt(program, at),
    locals: localVariables(vm, services, thread, index),
  };
}

/** One frame's locals in insertion order, each read through its own reference (P2). */
function localVariables(vm: VmState, services: ScriptServices, thread: Thread, index: number): readonly DebugVariable[] {
  const frame = thread.frames[index];
  if (frame === undefined) return [];
  const variables: DebugVariable[] = [];
  for (const [name, slot] of Object.entries(frame.locals)) {
    variables.push({ name, value: copyValue(readVariableReference(vm, thread, index, slot.ref, services)) });
  }
  return variables;
}

function debugThread(vm: VmState, services: ScriptServices, thread: Thread, tick: number): DebugThread {
  const frames = thread.frames.map((_frame, index) => frameOf(vm, services, thread, index));
  return {
    id: thread.id,
    kind: thread.kind,
    status: thread.status,
    wait: thread.wait === null
      ? null
      : {
        kind: thread.wait.kind,
        global: thread.wait.global,
        remainingTicks: thread.wait.kind === "sleep" && thread.wait.until !== null
          ? Math.max(0, thread.wait.until - tick)
          : null,
      },
    frames,
  };
}

/**
 * The view of TOOL-8. `pausedThread` names the thread the last `advance` paused
 * in, which decides what the top-level `locals` holds; with no pause it is the
 * lowest-id thread that still has frames.
 */
export function buildDebugView(state: GameState, services: ScriptServices, pausedThread: number | null): DebugView {
  const tick = state.time.tick;
  const threads = state.vm.threads.map((thread) => debugThread(state.vm, services, thread, tick));
  const paused = pausedThread === null ? undefined : threads.find((thread) => thread.id === pausedThread && thread.frames.length > 0);
  const fallback = threads.filter((thread) => thread.frames.length > 0).sort((left, right) => left.id - right.id)[0];
  const holder = paused ?? fallback;
  const locals = holder === undefined ? [] : holder.frames[holder.frames.length - 1]!.locals;
  const globals: DebugVariable[] = [];
  for (const [name, value] of Object.entries(state.vm.globals)) globals.push({ name, value: copyValue(value) });
  return { tick, threads, locals, globals };
}

type Rejection = { readonly code: string; readonly message: string; readonly line: number };

/** Why `expr` is not something a watch may run, or `null` when it is (TOOL-8, P1). */
function classify(expr: Expr): Rejection | null {
  switch (expr.kind) {
    case "assign":
      return { code: "evaluate.assignment", message: `"${expr.operator}" writes a value, and a watch cannot write`, line: expr.line };
    case "postfix":
      return { code: "evaluate.assignment", message: `"${expr.operator}" writes a value, and a watch cannot write`, line: expr.line };
    case "lambda":
      return { code: "evaluate.form", message: "a watch cannot make a lambda", line: expr.line };
    case "object":
      return { code: "evaluate.form", message: "a watch cannot make a dictionary", line: expr.line };
    case "construct":
      return { code: "evaluate.form", message: `a watch cannot construct "${expr.className}"`, line: expr.line };
    case "callIndirect":
      return { code: "evaluate.call", message: "a call through a value is not one of the pure built-ins a watch may call", line: expr.line };
    case "methodCall":
      return { code: "evaluate.call", message: `".${expr.name}()" is a method call, and a watch may call only the pure built-ins`, line: expr.line };
    case "call": {
      if (expr.file !== undefined) {
        return { code: "evaluate.call", message: `"${expr.file}.${expr.name}()" reaches another file, and a watch may call only the pure built-ins`, line: expr.line };
      }
      if (!EVALUATE_SET.has(expr.name)) {
        return { code: "evaluate.call", message: `"${expr.name}" is not one of the pure built-ins a watch may call`, line: expr.line };
      }
      for (const argument of expr.args) {
        const rejected = classify(argument);
        if (rejected !== null) return rejected;
      }
      return null;
    }
    case "member":
      return classify(expr.receiver);
    case "index":
      return classify(expr.base) ?? classify(expr.index);
    case "unary":
      return classify(expr.operand);
    case "binary":
      return classify(expr.left) ?? classify(expr.right);
    case "ternary":
      return classify(expr.cond) ?? classify(expr.then) ?? classify(expr.else);
    default:
      return null;
  }
}

function failure(code: string, message: string, line = 1): EvalResult {
  return { value: null, error: { code, message, line } };
}

/**
 * Parse `text` as exactly one expression. The text is wrapped in a call so the
 * expression grammar — not the statement grammar, where a lone name is a
 * zero-argument call — decides what it is, and the wrapper is then removed.
 */
function parseExpression(text: string): { readonly expr: Expr } | { readonly error: EvalError } {
  let ast;
  try {
    ast = parse(scan(`${WRAPPER}(${text})`, true).tokens, { redirects: new Map() });
  } catch (error) {
    const located = error as { message?: unknown; pos?: { line?: unknown } };
    const message = typeof located.message === "string" ? located.message : "the expression could not be parsed";
    const line = typeof located.pos?.line === "number" ? located.pos.line : 1;
    return { error: { code: "evaluate.syntax", message, line } };
  }
  const statement = ast.statements.length === 1 && ast.functions.length === 0 && ast.classes.length === 0
    ? ast.statements[0]
    : undefined;
  const call = statement !== undefined && statement.kind === "expr" ? statement.expr : undefined;
  if (
    call === undefined ||
    call.kind !== "call" ||
    call.name !== WRAPPER ||
    call.file !== undefined ||
    call.args.length !== 1
  ) {
    return { error: { code: "evaluate.syntax", message: "evaluate reads one expression, and this text is not one", line: 1 } };
  }
  return { expr: call.args[0]! };
}

/** The first local slot or global holding a callable under a name the expression calls, if any. */
function shadowedCalls(ops: readonly { readonly op: string; readonly name?: string }[], vm: VmState, thread: Thread, depth: number): string | null {
  const called = new Set<string>();
  for (const op of ops) if (op.op === "call" && op.name !== undefined) called.add(op.name);
  if (called.size === 0) return null;
  for (const [name, value] of Object.entries(vm.globals)) {
    if (called.has(name) && isCallableValue(value)) return name;
  }
  for (let index = 0; index <= depth; index += 1) {
    const frame = thread.frames[index];
    if (frame === undefined) continue;
    for (const [name, slot] of Object.entries(frame.locals)) {
      if (called.has(name) && isCallableValue(slot.value)) return name;
    }
  }
  return null;
}

function diagnosticResult(diagnostic: Diagnostic): EvalResult {
  return { value: null, error: { code: diagnostic.code, message: diagnostic.message, line: diagnostic.line } };
}

/**
 * Read one expression against `threadId`, on a copy (TOOL-8, P1). The global
 * table, the thread's frames above `frameDepth` and the closure cells are
 * copied, so every write the expression makes is discarded; the command table
 * answers only `EVALUATE_COMMANDS`, so nothing that waits, draws, plays, saves,
 * starts a thread or consumes the seeded RNG can run.
 */
export function evaluateExpression(
  state: GameState,
  services: ScriptServices,
  expression: string,
  threadId: number,
  frameDepth?: number,
): EvalResult {
  const thread = findThread(state.vm, threadId);
  if (thread === undefined) return failure("evaluate.thread", `no thread ${threadId} is registered`);
  if (thread.frames.length === 0) return failure("evaluate.thread", `thread ${threadId} has no frames left`);
  const depth = frameDepth === undefined ? thread.frames.length - 1 : frameDepth;
  if (!Number.isInteger(depth) || depth < 0 || depth >= thread.frames.length) {
    return failure("evaluate.frame", `frame ${frameDepth} is not one of thread ${threadId}'s ${thread.frames.length} frame(s)`);
  }

  const parsed = parseExpression(expression);
  if ("error" in parsed) return { value: null, error: parsed.error };
  const rejected = classify(parsed.expr);
  if (rejected !== null) return { value: null, error: rejected };

  const statement: Statement = {
    kind: "expr",
    expr: {
      kind: "assign",
      operator: "=",
      target: { kind: "decl", scope: "local", name: RESULT_SLOT, line: 1 },
      value: parsed.expr,
      line: 1,
    },
    line: 1,
  };
  const lowered = lower({ statements: [statement], functions: [], classes: [], includes: [] }, "<inline>");
  // Keep the instructions up to the store: the trailing `pop` and `return` would carry the
  // copied thread on into the paused frame's own program after the expression has ended.
  let store = lowered.ops.length - 1;
  while (store > 0 && lowered.ops[store]!.op !== "storeRef") store -= 1;
  const ops = lowered.ops.slice(0, store + 1);
  const evalRef: ProgramRef = { kind: "inline", text: `__tkr_evaluate_source__`, ir: IR_VERSION };
  const evalProgram: Program = {
    ref: evalRef,
    ops,
    functions: lowered.functions,
    classes: lowered.classes,
    labels: lowered.labels,
    statements: lowered.statements,
    files: {},
    fileKeys: {},
    notices: [],
    units: [],
  };

  const shadowed = shadowedCalls(ops, state.vm, thread, depth);
  if (shadowed !== null) {
    return failure("evaluate.call", `"${shadowed}" holds a callable here, and a watch may call only the pure built-ins`);
  }

  const pausedFrame = thread.frames[depth]!;
  const evalFrame: Frame = {
    program: evalRef,
    ip: 0,
    // The selected frame's own slots, so a bare name reads that frame's local exactly as it
    // would there (SEM-4 looks in the current frame, then the global table, never in a caller).
    locals: { ...pausedFrame.locals },
    operands: [],
    errorHandler: null,
    autoLocal: pausedFrame.autoLocal,
    ...(pausedFrame.objectHandle === undefined ? {} : { objectHandle: pausedFrame.objectHandle }),
    ...(pausedFrame.objectClass === undefined ? {} : { objectClass: pausedFrame.objectClass }),
  };
  const frames: Frame[] = thread.frames.slice(0, depth + 1).map((frame) => ({
    program: frame.program,
    ip: frame.ip,
    locals: { ...frame.locals },
    operands: [],
    errorHandler: null,
    autoLocal: frame.autoLocal,
    ...(frame.objectHandle === undefined ? {} : { objectHandle: frame.objectHandle }),
    ...(frame.objectClass === undefined ? {} : { objectClass: frame.objectClass }),
  }));
  frames.push(evalFrame);
  const evalThread: Thread = {
    id: thread.id,
    kind: thread.kind,
    owner: thread.owner,
    source: null,
    target: null,
    frames,
    status: "ready",
    wait: null,
    queue: [],
    pending: null,
    detached: [],
    collect: null,
  };
  const copiedVm: VmState = {
    ...state.vm,
    threads: [evalThread],
    globals: { ...state.vm.globals },
    block: null,
    ...(state.vm.cells === undefined ? {} : { cells: { ...state.vm.cells } }),
  };
  const copiedState: GameState = {
    ...state,
    vm: copiedVm,
    events: { ...state.events, queue: [...state.events.queue] },
  };
  const programs: ProgramCache = {
    get(ref) {
      return ref === evalRef ? evalProgram : services.programs.get(ref);
    },
    find(def) {
      return services.programs.find(def);
    },
    get compiles() {
      return 0;
    },
  };
  const { postStep: _postStep, postCall: _postCall, postHandler: _postHandler, ...observed } = services;
  const diagnostics: Diagnostic[] = [];
  const restricted: ScriptServices = {
    ...observed,
    view: Object.freeze({ ...services.view, state: copiedState }),
    commands: createCommandLookup({
      builtin: (name) => (EVALUATE_SET.has(name) ? services.commands.builtin(name) : undefined),
    }),
    programs,
    diagnostics,
    errorWindows: createErrorWindows(),
    setCommandThread: () => {},
    setCommandPos: () => {},
  };

  const steps = stepThread(evalThread, copiedVm, restricted, EVALUATE_STEP_BUDGET);
  const reported = diagnostics[0];
  if (reported !== undefined) return diagnosticResult(reported);
  if (evalThread.status === "waiting") return failure("evaluate.wait", "the expression entered a wait, which a watch cannot do");
  if (steps >= EVALUATE_STEP_BUDGET && evalThread.status === "ready") {
    return failure("evaluate.budget", `the expression reached the ${EVALUATE_STEP_BUDGET}-instruction limit`);
  }
  const slot = evalFrame.locals[RESULT_SLOT];
  if (slot === undefined) return failure("evaluate.form", "the expression produced no value");
  return { value: copyValue(slot.value), error: null };
}
