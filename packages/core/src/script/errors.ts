/**
 * The script error channel (AD-24; docs/spec/engine/rpgcode-errors-and-threads.md#error-handling ERR-1/ERR-2).
 *
 * A `ScriptError` is thrown, never stored in state, so it is an ordinary class
 * (guard-rail G1 rule 2 binds saveable state only). It carries a stable
 * machine-readable `code` and an optional source position `pos`.
 *
 * This file also holds the failure-class table: which stable codes are
 * catchable runtime errors (they reach a handler and become a host
 * diagnostic) and which are load-time (they are reported once while loading
 * and never caught, because no frame exists yet).
 *
 * docs/adr/0004; docs/spec/engine/rpgcode-errors-and-threads.md#error-handling (ERR-1/ERR-2).
 */

import type { Diagnostic } from "../ports/engine.ts";
import type { SourcePos } from "./ops.ts";

/** A script failure with a stable machine-readable `code` and optional source position. */
export class ScriptError extends Error {
  readonly code: string;
  readonly pos: SourcePos | null;

  constructor(code: string, message: string, pos: SourcePos | null = null) {
    super(message);
    this.name = "ScriptError";
    this.code = code;
    this.pos = pos;
  }
}

/** The 3.6 object failure codes: freed or unknown handle or class, abstract construction, access denial. */
export const OBJECT_INVALID = "object.invalid";
export const OBJECT_ABSTRACT_CLASS = "object.abstract-class";
export const OBJECT_INACCESSIBLE_MEMBER = "object.inaccessible-member";

/** System-owned-name failures from KILL-1 and VIRT-1. */
export const KILL_SYSTEM_OWNED = "kill.system-owned";
export const ASSIGN_READ_ONLY = "assign.read-only";

/** The error-handler misuse codes (ERR-1). */
export const HANDLER_TOP_LEVEL = "handler.top-level";
export const HANDLER_UNKNOWN_LABEL = "handler.unknown-label";
export const HANDLER_NOT_HANDLING = "handler.not-handling";

/** A run-time include or a `file.`-qualified call names a file the asset index does not hold (MOD-2, R2-Q21). */
export const INCLUDE_MISSING = "include.missing";
/** A compiled `.prg` (first byte `0x00`) is refused: re-save the source (docs/spec/formats/rpgcode-program.md §9.1). */
export const PROGRAM_COMPILED = "program.compiled";
/** An include whose file is already being parsed: reported, and the file counts as included (MOD-3). */
export const INCLUDE_CYCLE = "include.cycle";
/** A run-time `include()` names a file that is indexed but cannot be read or compiled (compiled `.prg`, syntax error). */
export const INCLUDE_REFUSED = "include.refused";

/** A `call_indirect` (or a plain-name call of a variable) found a value that is not a callable (FUN-8, 18.4). */
export const CALLABLE_NOT_CALLABLE = "callable.not-callable";
/** A callable names a definition that is in no compiled program: a stale handle or a source that changed (FUN-8, 18.4). */
export const CALLABLE_UNKNOWN_DEF = "callable.unknown-def";
/** A callable was invoked with a different number of arguments than its definition takes (FUN-8, 18.4, FUN-1). */
export const CALLABLE_ARITY = "callable.arity";

// Load-time failures of a saved game's function values (FUN-8, entry 18.6). They are
// `restore.` codes, so a script's error handler never sees them: a host catches the
// `ScriptError` and the message names the place in the save.
/** A value whose `type` is `"callable"` is not a whole `{ type, def, captures, receiver }` record with an optional `owner` package name. */
export const RESTORE_CALLABLE_MALFORMED = "restore.callable-malformed";
/** A `captures` entry, a slot's or operand's `cell:` reference or a wait's resume reference names a cell that is not in `vm.cells`. */
export const RESTORE_CELL_MISSING = "restore.cell-missing";
/** `vm.cells` and `vm.cellSeq` disagree, a cell id is not one the VM issues, or an id is above `vm.cellSeq` so the next id would collide. */
export const RESTORE_CELL_SEQ = "restore.cell-seq";
/** A callable's `def` is defined by no compiled program and is no command, or its recorded owner does not define it. */
export const RESTORE_CALLABLE_UNKNOWN_DEF = "restore.callable-unknown-def";
/** A callable's `captures` count differs from its definition's capture count. */
export const RESTORE_CALLABLE_CAPTURES = "restore.callable-captures";
/** A callable receiver does not name a live object handle in the restored object table. */
export const RESTORE_CALLABLE_RECEIVER = "restore.callable-receiver";

/**
 * The family of a catchable runtime failure (ERR-2's failure table).
 * `internal` marks a fault in the host/plugin contract rather than in the
 * script; `debug(false)` never silences it.
 */
export type FailureClass =
  | "call"
  | "arity"
  | "argument"
  | "object"
  | "arithmetic"
  | "builtin"
  | "handler"
  | "internal";

/** Codes that are catchable runtime errors, with their failure-table family. */
const CATCHABLE: { readonly [code: string]: FailureClass } = {
  "unknown.command": "call",
  "arity.mismatch": "arity",
  "builtin.bad-arg": "argument",
  "builtin.obsolete": "builtin",
  "builtin.out-not-by-ref": "internal",
  [OBJECT_INVALID]: "object",
  [OBJECT_ABSTRACT_CLASS]: "object",
  [OBJECT_INACCESSIBLE_MEMBER]: "object",
  [KILL_SYSTEM_OWNED]: "builtin",
  [ASSIGN_READ_ONLY]: "builtin",
  "vm.modulo-by-zero": "arithmetic",
  "vm.bad-lvalue": "argument",
  "vm.bad-operand": "internal",
  "vm.stack-underflow": "internal",
  "vm.unknown-label": "call",
  "command.request-unsupported": "internal",
  [HANDLER_TOP_LEVEL]: "handler",
  [HANDLER_UNKNOWN_LABEL]: "handler",
  [HANDLER_NOT_HANDLING]: "handler",
  [INCLUDE_MISSING]: "call",
  "program.missing": "call",
  [INCLUDE_REFUSED]: "call",
  [CALLABLE_NOT_CALLABLE]: "call",
  [CALLABLE_UNKNOWN_DEF]: "call",
  [CALLABLE_ARITY]: "arity",
};

/** Code prefixes that are load-time or restore failures: reported once, never caught. */
const LOAD_TIME_PREFIXES: readonly string[] = ["syntax.", "compile.", "program.", "restore.", "thread.", "package."];

/**
 * The failure family of `code`, or `null` when it is not a catchable runtime
 * error. A code that is neither in the table nor load-time is treated as a
 * catchable builtin failure, because a plugin may throw its own stable codes
 * (ERR-2: "a built-in that fails").
 */
export function failureClass(code: string): FailureClass | null {
  if (Object.hasOwn(CATCHABLE, code)) return CATCHABLE[code] ?? null;
  for (const prefix of LOAD_TIME_PREFIXES) {
    if (code.startsWith(prefix)) return null;
  }
  return "builtin";
}

/**
 * The same failure with its position normalised to the failing instruction's:
 * the instruction's `pos` wins over the error's own, which is only a fallback
 * for an error raised without one (AD-24).
 */
export function locateError(error: ScriptError, at: SourcePos | null): ScriptError {
  const pos = at ?? error.pos;
  if (pos === error.pos) return error;
  return new ScriptError(error.code, error.message, pos);
}

/** The plain `{ code, file, line, message }` host diagnostic for a located failure. */
export function toDiagnostic(error: ScriptError): Diagnostic {
  return {
    code: error.code,
    file: error.pos?.file ?? "",
    line: error.pos?.line ?? 0,
    message: error.message,
  };
}
