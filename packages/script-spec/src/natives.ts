/**
 * The seven native commands of the `script-spec` package (TOOL-5, ADR 0014 amendment of 2026-11-11):
 * `specResult` records an outcome and the position of its call, and six matcher helpers read what a library
 * program cannot (docs/spec/engine/rpgcode-tooling.md#tool-5-natives). The set is closed: a command joins it by
 * editing TOOL-5 first. They are registered only by `SPEC_PLUGIN`, never by the engine's default manifest.
 *
 * Every command here is a pure read or a log record: none re-enters the interpreter, none waits. The two error
 * commands bracket a call the library makes itself, so the VM runs that call as an ordinary call (G1).
 */

import {
  isCallableValue,
  recordEffect,
  ScriptError,
  type Arg,
  type BuiltinSpec,
  type CommandResult,
  type ParamSpec,
  type Value,
} from "@tk-reawakened/core";
import { captureArg, display, finiteNumber, parseSnap, snapContains, snapsEqual, type Snap } from "./snapshot.ts";

const SEE = [
  "docs/spec/engine/rpgcode-tooling.md#tool-5-natives",
  "docs/spec/engine/rpgcode-tooling.md#tool-5",
];

/** The native Purpose group the command-docs gate derives from the spec page's section heading. */
export const SPEC_GROUP = "tooling-the-rpgcode-spec-package-not-part-of-the-282-legacy-catalogue";

const KINDS = new Set(["pass", "fail", "skip", "only"]);

function text(value: Value): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function param(name: string, summary: string, flags: { readonly optional?: boolean; readonly byRef?: boolean } = {}): ParamSpec {
  return { name, optional: flags.optional === true, byRef: flags.byRef === true, variadic: false, doc: { summary } };
}

const OUT_TEXT = "Receives the text a failure message shows; left alone when the argument is not a variable.";

/** The `out` pairs for the optional text parameters that were supplied as variables, at the given positions. */
function texts(args: readonly Arg[], ...pairs: readonly (readonly [number, string])[]): readonly (readonly [number, Value])[] {
  return pairs.filter(([index]) => args[index]?.ref != null);
}

function snapshotOf(value: Value | undefined, command: string): Snap {
  const snap = parseSnap(value ?? null);
  if (snap === null) throw new ScriptError("builtin.bad-arg", `${command}: the first argument must be the text specCapture returned`);
  return snap;
}

const SPEC_RESULT: BuiltinSpec = {
  name: "specresult",
  aliases: [],
  // One variadic parameter: `specResult` accepts kind, name, expected and actual in any arity the library uses,
  // and the handler reads the first four.
  params: [{ name: "args", optional: true, byRef: false, variadic: true }],
  doc: {
    summary: "Record one spec outcome with the source position of this call.",
    behaviour:
      "Registered under the folded name `specresult`, so `specResult(...)` in a spec program reaches it (LEX-10). Records `{ kind, name, expected, actual, file, line, column }` on the run's result channel and returns nothing; `kind` is pass, fail, skip or only, and any other kind records nothing and reports `spec.bad-kind`. The test runner reports the record with the file and line of the call. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    waits: { kind: "never", summary: "Records the outcome and returns at once." },
    see: SEE,
  },
  call: (view, args): CommandResult => {
    const kind = text(args[0]?.value ?? null);
    if (!KINDS.has(kind)) {
      // Not a result: the runner sees a diagnostic record with the offending kind.
      return { value: null, effects: [{ kind: "diagnostic", section: "vm", args: ["spec.bad-kind", kind] }] };
    }
    const pos = view.pos;
    if (view.state !== undefined) {
      recordEffect(view.state.vm, {
        tick: view.state.time.tick,
        thread: view.thread ?? 0,
        name: "specresult",
        kind: "pure",
        args: [kind, text(args[1]?.value ?? null), text(args[2]?.value ?? null), text(args[3]?.value ?? null), pos?.file ?? "", pos?.line ?? 0, pos?.col ?? 0],
        out: {},
        result: null,
        patch: null,
        wait: null,
        request: null,
      });
    }
    return { value: null };
  },
};

const SPEC_CAPTURE: BuiltinSpec = {
  name: "speccapture",
  aliases: [],
  params: [param("value", "The value to take a picture of; read by reference so an array's elements are seen.", { byRef: true })],
  doc: {
    summary: "Take a picture of a value so a matcher can compare it later, even after the variable changes.",
    behaviour:
      "Used by `expect`; test authors never call it. Reads `value` by reference while the caller's frame is live and returns an opaque text snapshot of its type, its full stored value (no truncation) and the text a failure message shows. A variable with element variables (`name[index]`, SEM-5) is captured as a whole array: the sparse, nested elements in canonical key order, whether the array is global, local or a member of an object. A dictionary is captured key by key, a class instance by live handle and a callable by definition, captured cells and receiver. Identities (for `toBe` on arrays, dictionaries and instances) are small numbers handed out in capture order and start again for every case, so two runs give identical text. No script may read the text; it is never saved and no stability promise covers it. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "The opaque snapshot text." },
    waits: { kind: "never", summary: "Reads and returns at once." },
    see: SEE,
  },
  call: (view, args) => ({ value: JSON.stringify(captureArg(view, args[0]!)) }),
};

const SPEC_EQUAL: BuiltinSpec = {
  name: "specequal",
  aliases: [],
  params: [
    param("actual", "The snapshot text `specCapture` returned for the value under test."),
    param("expected", "The value to compare with; read by reference so an array's elements are seen.", { byRef: true }),
    param("strict", "Zero or omitted compares by value (`toEqual`); non-zero compares by identity (`toBe`).", { optional: true }),
    param("expectedText", OUT_TEXT, { optional: true, byRef: true }),
    param("actualText", OUT_TEXT, { optional: true, byRef: true }),
  ],
  doc: {
    summary: "Check whether two values are the same, for `toEqual` and `toBe`.",
    behaviour:
      "Used by `toEqual` and `toBe`. Snapshots `expected` as `specCapture` does and compares it with `actual`, with no conversion between numbers and strings (`5` never equals `\"5\"`). With `strict` zero or omitted: numbers match by IEEE-754 value (`-0` equals `0`, `NaN` equals `NaN`), strings code unit by code unit, arrays over exactly the same index keys element by element to any depth, dictionaries key by key (a list's `length` included), class instances by live handle and callables by definition, captured cells and receiver. With `strict` non-zero: the same for numbers, strings and callables, but arrays, dictionaries and instances match only when they are the very same variable or object. Writes the text a failure message shows to the optional variables. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "1 when the values are the same, otherwise 0." },
    waits: { kind: "never", summary: "Compares and returns at once." },
    see: SEE,
  },
  call: (view, args) => {
    const actual = snapshotOf(args[0]?.value, "specEqual");
    const expected = captureArg(view, args[1]!);
    const strict = typeof args[2]?.value === "number" && args[2].value !== 0;
    return {
      value: snapsEqual(actual, expected, strict) ? 1 : 0,
      out: texts(args, [3, display(expected)], [4, display(actual)]),
    };
  },
};

const SPEC_CONTAIN: BuiltinSpec = {
  name: "speccontain",
  aliases: [],
  params: [
    param("actual", "The snapshot text `specCapture` returned for the string, array or list under test."),
    param("needle", "The value to look for; read by reference so an array's elements are seen.", { byRef: true }),
    param("needleText", OUT_TEXT, { optional: true, byRef: true }),
    param("actualText", OUT_TEXT, { optional: true, byRef: true }),
  ],
  doc: {
    summary: "Check whether a string or an array holds a value, for `toContain`.",
    behaviour:
      "Used by `toContain`. Returns 1 when `actual` is a string and `needle` is a string that occurs in it (case-sensitive), when `actual` is an element array with a direct element (a nested sub-array included) equal to `needle` as `toEqual` compares, or when `actual` is a list (a dictionary with a whole-number `length`) with an entry under the keys `\"0\"` to `\"<length - 1>\"` equal to `needle`; the `length` entry itself is never searched. Returns 0 in every other case, including a type that does not match. Writes the text a failure message shows to the optional variables. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "1 when `actual` holds `needle`, otherwise 0." },
    waits: { kind: "never", summary: "Searches and returns at once." },
    see: SEE,
  },
  call: (view, args) => {
    const actual = snapshotOf(args[0]?.value, "specContain");
    const needle = captureArg(view, args[1]!);
    return {
      value: snapContains(actual, needle) ? 1 : 0,
      out: texts(args, [2, display(needle)], [3, display(actual)]),
    };
  },
};

const SPEC_CLOSE: BuiltinSpec = {
  name: "specclose",
  aliases: [],
  params: [
    param("actual", "The snapshot text `specCapture` returned for the number under test."),
    param("expected", "The number to compare with; read by reference, so it is not truncated.", { byRef: true }),
    param("tolerance", "The largest allowed difference; read by reference, so it is not truncated.", { byRef: true }),
    param("expectedText", OUT_TEXT, { optional: true, byRef: true }),
    param("actualText", OUT_TEXT, { optional: true, byRef: true }),
  ],
  doc: {
    summary: "Check whether two numbers are near enough, for `toBeCloseTo`.",
    behaviour:
      "Used by `toBeCloseTo`. Reads `expected` and `tolerance` by reference, so no name-read truncation applies to them (SEM-3), and compares in IEEE-754 doubles. Returns 1 when `actual`, `expected` and `tolerance` are all finite numbers (a string, an array, an object, a callable, `NaN` or an infinity is not), `tolerance` is 0 or more and the absolute difference of `actual` and `expected` is at most `tolerance`; otherwise 0. The expected text is the expected number followed by ` ± ` and the tolerance. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "1 when the numbers are within the tolerance, otherwise 0." },
    waits: { kind: "never", summary: "Compares and returns at once." },
    see: SEE,
  },
  call: (view, args) => {
    const actual = snapshotOf(args[0]?.value, "specClose");
    const expected = captureArg(view, args[1]!);
    const tolerance = captureArg(view, args[2]!);
    const [actualNumber, expectedNumber, toleranceNumber] = [finiteNumber(actual), finiteNumber(expected), finiteNumber(tolerance)];
    const near = actualNumber !== null && expectedNumber !== null && toleranceNumber !== null
      && toleranceNumber >= 0 && Math.abs(actualNumber - expectedNumber) <= toleranceNumber;
    return {
      value: near ? 1 : 0,
      out: texts(args, [3, `${display(expected)} ± ${display(tolerance)}`], [4, display(actual)]),
    };
  },
};

const SPEC_THROW_BEGIN: BuiltinSpec = {
  name: "specthrowbegin",
  aliases: [],
  params: [param("value", "The subject of `expect`; it must be a function.", { byRef: true })],
  doc: {
    summary: "Start watching for an error, for `toThrow`.",
    behaviour:
      "Used by `toThrow`, which then calls the subject itself and ends the watch with `specThrowEnd`. Returns 0 and watches nothing when `value` is not a callable, so both `toThrow()` and `.not.toThrow()` fail on a non-function. Otherwise opens an observation window on the calling thread and returns 1. Windows nest. A window is bookkeeping for this session, never saved state. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "1 when a window was opened, 0 when `value` is not a function." },
    waits: { kind: "never", summary: "Opens the window and returns at once." },
    see: SEE,
  },
  call: (view, args) => {
    if (!isCallableValue(args[0]?.value)) return { value: 0 };
    if (view.errorWindows === undefined) throw new ScriptError("builtin.bad-arg", "specThrowBegin: this runner offers no error observation");
    view.errorWindows.open();
    return { value: 1 };
  },
};

const SPEC_THROW_END: BuiltinSpec = {
  name: "specthrowend",
  aliases: [],
  params: [param("actualError", "Receives the code of the first error seen, or \"no error\"; left alone when the argument is not a variable.", { optional: true, byRef: true })],
  doc: {
    summary: "Stop watching and say whether an error happened.",
    behaviour:
      "Used by `toThrow` after it has called the subject. Closes the innermost window on the calling thread. Every unhandled catchable runtime error (ERR-2) raised inside it, nested calls included, is consumed: its queued `error` event and its host diagnostic are removed, so it does not fail the case. An error a script's own handler took is not counted. Writes the code of the first error seen, or \"no error\", to the optional variable. Does not wait.",
    groups: [SPEC_GROUP],
    access: "public",
    returns: { summary: "1 when at least one error happened inside the window, otherwise 0." },
    waits: { kind: "never", summary: "Closes the window and returns at once." },
    see: SEE,
  },
  call: (view, args) => {
    const failures = view.errorWindows?.close() ?? [];
    const first = failures[0]?.code ?? "no error";
    return { value: failures.length > 0 ? 1 : 0, out: texts(args, [0, first]) };
  },
};

export const SPEC_COMMANDS: readonly BuiltinSpec[] = [
  SPEC_RESULT,
  SPEC_CAPTURE,
  SPEC_EQUAL,
  SPEC_CONTAIN,
  SPEC_CLOSE,
  SPEC_THROW_BEGIN,
  SPEC_THROW_END,
];
