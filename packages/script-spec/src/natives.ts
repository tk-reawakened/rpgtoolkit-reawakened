/**
 * The twelve native commands of the `script-spec` package (TOOL-5, ADR 0014 amendments of 2026-11-11 and
 * 2026-11-12): `specResult` records an outcome and the position of its call, seven matcher helpers read what a
 * library program cannot (docs/spec/engine/rpgcode-tooling.md#tool-5-natives), and four test doubles act on the
 * runner's side of the VM (#tool-5-doubles). The set is closed: a command joins it by editing TOOL-5 first. They are
 * registered only by the `script-spec` plugin, never by the engine's default manifest.
 *
 * No command here re-enters the interpreter. The two error commands bracket a call the library makes itself, so the
 * VM runs that call as an ordinary call, and `specTicks` waits through the ordinary cooperative sleep (G1). The
 * doubles reach the run's host-side `SpecDoubles`; without one (the static `SPEC_PLUGIN`) they raise
 * `spec.no-doubles`.
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
import { installSpy, type SpecDoubles } from "./doubles.ts";
import { captureArg, display, finiteNumber, parseSnap, snapContains, snapsEqual, type Snap } from "./snapshot.ts";

const SEE = [
  "docs/spec/engine/rpgcode-tooling.md#tool-5-natives",
  "docs/spec/engine/rpgcode-tooling.md#tool-5",
];

const SEE_DOUBLES = [
  "docs/spec/engine/rpgcode-tooling.md#tool-5-doubles",
  "docs/spec/engine/rpgcode-tooling.md#tool-5-natives",
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

/** The largest scripted draw: an RNG port draw is an unsigned 32-bit number. */
const MAX_DRAW = 4_294_967_295;
/** The largest `specTicks` count; the run's own 1,000-tick ceiling still applies. */
const MAX_TICKS = 1000;

function wholeNumber(value: Value | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** The entries `"0"` to `"<length - 1>"` of a list snapshot, or `null` when the snapshot is not exactly a list. */
function listEntries(snap: Snap): readonly Snap[] | null {
  if (snap[0] !== "d") return null;
  const members = new Map(snap[3]);
  const length = members.get("length");
  if (length === undefined || length[0] !== "n") return null;
  const count = Number(length[1]);
  if (!Number.isInteger(count) || count < 0 || members.size !== count + 1) return null;
  const entries: Snap[] = [];
  for (let at = 0; at < count; at += 1) {
    const entry = members.get(String(at));
    if (entry === undefined) return null;
    entries.push(entry);
  }
  return entries;
}

function callText(args: readonly Snap[]): string {
  return `(${args.map(display).join(", ")})`;
}

function doublesOf(doubles: SpecDoubles | undefined, command: string): SpecDoubles {
  if (doubles === undefined) throw new ScriptError("spec.no-doubles", `${command}: this runner offers no test doubles`);
  return doubles;
}

function specCalled(doubles: SpecDoubles | undefined): BuiltinSpec {
  return {
    name: "speccalled",
    aliases: [],
    params: [
      param("actual", "The snapshot text `specCapture` returned for the spy handle under test."),
      param("args", "The list of expected arguments; read by reference so its entries are seen.", { byRef: true }),
      param("any", "1 asks whether any recorded call matches; 0 asks about call `nth`."),
      param("nth", "With `any` 0, the call to check, counted from 1; read by reference, so it is not truncated.", { byRef: true }),
      param("expectedText", OUT_TEXT, { optional: true, byRef: true }),
      param("actualText", OUT_TEXT, { optional: true, byRef: true }),
    ],
    doc: {
      summary: "Check what a spy recorded, for `toHaveBeenCalledWith` and `toHaveBeenNthCalledWith`.",
      behaviour:
        "Used by the two spy matchers. `actual` is the snapshot of a spy handle `spyOn` returned in this run; `args` is a list (a dictionary holding `length` and exactly the keys `\"0\"` to `\"<length - 1>\"`). With `any` 1, returns 1 when at least one recorded call has as many arguments as `args` has entries and each equals its entry under `toEqual`'s rules (no number/string conversion); with `any` 0, returns 1 when call `nth` (counted from 1, in call order) exists and matches. Otherwise returns 0. Returns -1, so the matcher fails in both polarities, when `actual` is not a spy of this run, `args` is not a list, or with `any` 0 `nth` is not a whole number of 1 or more. Writes the expected call and the recorded calls (or \"no calls\") to the optional variables. Does not wait.",
      groups: [SPEC_GROUP],
      access: "public",
      returns: { summary: "1 for a match, 0 for none, -1 for an invalid subject, list or call number." },
      waits: { kind: "never", summary: "Compares and returns at once." },
      see: SEE_DOUBLES,
    },
    call: (view, args) => {
      const subject = snapshotOf(args[0]?.value, "specCalled");
      const expected = captureArg(view, args[1]!);
      const any = typeof args[2]?.value === "number" && args[2].value !== 0;
      const nthSnap = captureArg(view, args[3]!);
      const fail = (expectedText: string, actualText: string): CommandResult =>
        ({ value: -1, out: texts(args, [4, expectedText], [5, actualText]) });
      const spy = subject[0] === "s" ? doubles?.spies.get(subject[1]) : undefined;
      if (spy === undefined) return fail("a spy installed by spyOn in this case", display(subject));
      const entries = listEntries(expected);
      if (entries === null) return fail("a list of expected arguments", display(expected));
      const nth = nthSnap[0] === "n" ? Number(nthSnap[1]) : Number.NaN;
      if (!any && !(Number.isInteger(nth) && nth >= 1)) return fail("a call number of 1 or more", display(nthSnap));
      const matches = (call: readonly Snap[]): boolean =>
        call.length === entries.length && call.every((arg, at) => snapsEqual(arg, entries[at]!, false));
      const ok = any ? spy.calls.some(matches) : spy.calls.length >= nth && matches(spy.calls[nth - 1]!);
      const expectedText = any ? `a call of ${spy.name} with ${callText(entries)}` : `call ${nth} of ${spy.name} with ${callText(entries)}`;
      const actualText = spy.calls.length === 0 ? "no calls" : spy.calls.map((call, at) => `${at + 1}: ${callText(call)}`).join(", ");
      return { value: ok ? 1 : 0, out: texts(args, [4, expectedText], [5, actualText]) };
    },
  };
}

function specInput(doubles: SpecDoubles | undefined): BuiltinSpec {
  return {
    name: "specinput",
    aliases: [],
    params: [
      param("tick", "The absolute fixture tick the edge enters the input section in; later than the tick of the call."),
      param("name", "The key name scripts see, as the engine's key event carries it (for example \"ENTER\")."),
      param("code", "The physical key code, as the engine's key event carries it (for example \"Enter\")."),
      param("char", "The one character the key types, or \"\" or the unset value for none."),
      param("down", "1 for a press, 0 for a release."),
    ],
    doc: {
      summary: "Press or release a key at a chosen game tick, as if the player did it.",
      behaviour:
        "Called by a case. Schedules one key edge for the absolute fixture tick `tick`, which must be a whole number later than the tick the call runs in. `name` and `code` are non-empty strings, `char` is a one-character string or `\"\"` or the unset value for none, and `down` is 1 (press) or 0 (release); any other argument raises `spec.bad-input`. At the start of that tick, before its wait poll, every edge scheduled for it enters the ordinary input section as a host key event would, once, in scheduling order, so a script waiting for a key sees it in that tick. An edge still scheduled when the run ends fails the run with `spec.input-pending`. Does not wait.",
      groups: [SPEC_GROUP],
      access: "public",
      waits: { kind: "never", summary: "Schedules the edge and returns at once." },
      see: SEE_DOUBLES,
    },
    call: (view, args) => {
      const run = doublesOf(doubles, "specInput");
      const tick = wholeNumber(args[0]?.value);
      const now = view.clock.tick();
      const bad = (why: string): never => { throw new ScriptError("spec.bad-input", `specInput: ${why}`); };
      if (tick === null || !Number.isSafeInteger(tick)) bad("the tick must be a whole number");
      if (tick! <= now) bad(`tick ${tick} is not later than the current tick ${now}`);
      const name = args[1]?.value;
      const code = args[2]?.value;
      if (typeof name !== "string" || name === "") bad("the key name must be a non-empty string");
      if (typeof code !== "string" || code === "") bad("the key code must be a non-empty string");
      const rawChar = args[3]?.value ?? null;
      let char: string | null;
      if (rawChar === null || rawChar === 0 || rawChar === "") char = null;
      else if (typeof rawChar === "string" && rawChar.length === 1) char = rawChar;
      else char = bad("the character must be one character, \"\" or unset");
      const down = args[4]?.value;
      if (down !== 0 && down !== 1) bad("down must be 1 (press) or 0 (release)");
      run.pending.push({ tick: tick!, event: { kind: "key", name: name as string, code: code as string, char, down: down === 1 } });
      return { value: null };
    },
  };
}

function specTicks(doubles: SpecDoubles | undefined): BuiltinSpec {
  return {
    name: "specticks",
    aliases: [],
    params: [param("count", "The whole number of ticks to wait, 0 to 1,000.")],
    doc: {
      summary: "Let a number of game ticks pass before the case carries on.",
      behaviour:
        "Called by a case. `count` is a whole number from 0 to 1,000; anything else raises `spec.bad-ticks`. With 0, returns the current fixture tick at once, so `specTicks(0)` reads the tick. Otherwise the value is the unset value and only the calling thread sleeps cooperatively: it resumes in the wait poll of the call's tick plus `count`, while other threads, events and engine phases keep running. The run's 1,000-tick ceiling still applies.",
      groups: [SPEC_GROUP],
      access: "public",
      returns: { summary: "The current fixture tick when `count` is 0; otherwise the unset value." },
      waits: { kind: "ticks", summary: "The calling thread waits for `count` ticks; 0 does not wait." },
      see: SEE_DOUBLES,
    },
    call: (view, args) => {
      doublesOf(doubles, "specTicks");
      const count = wholeNumber(args[0]?.value);
      if (count === null || count < 0 || count > MAX_TICKS) {
        throw new ScriptError("spec.bad-ticks", `specTicks: the count must be a whole number from 0 to ${MAX_TICKS}`);
      }
      const now = view.clock.tick();
      if (count === 0) return { value: now };
      return { value: null, wait: { kind: "sleep", global: false, until: now + count, resumesCall: true } };
    },
  };
}

function specRng(doubles: SpecDoubles | undefined): BuiltinSpec {
  return {
    name: "specrng",
    aliases: [],
    params: [param("draws", "The list of whole numbers 0 to 4,294,967,295 the next draws take, in order.", { byRef: true })],
    doc: {
      summary: "Decide in advance which random numbers the commands of the case get.",
      behaviour:
        "Called by a case. `draws` is a list (a dictionary holding `length` of 1 or more and exactly the keys `\"0\"` to `\"<length - 1>\"`) of whole numbers from 0 to 4,294,967,295; anything else raises `spec.bad-rng`. From then on each draw a command takes through the injected RNG port takes the next number in order instead of advancing the seeded generator, and the command applies its usual rules to it (`random(6)` given the draw 7 returns 2). A draw after the last number raises `spec.rng-exhausted` at the call that drew it; there is no fallback to the seeded generator. A later `specRng` replaces whatever is left. Scripted draws do not advance the saved generator state. Does not wait.",
      groups: [SPEC_GROUP],
      access: "public",
      waits: { kind: "never", summary: "Installs the draws and returns at once." },
      see: SEE_DOUBLES,
    },
    call: (view, args) => {
      const run = doublesOf(doubles, "specRng");
      const entries = listEntries(captureArg(view, args[0]!));
      const draws = entries?.map((entry) => (entry[0] === "n" ? Number(entry[1]) : Number.NaN));
      if (draws === undefined || draws.length === 0 || !draws.every((draw) => Number.isInteger(draw) && draw >= 0 && draw <= MAX_DRAW)) {
        throw new ScriptError("spec.bad-rng", "specRng: the draws must be a list of 1 or more whole numbers from 0 to 4294967295");
      }
      run.draws = draws;
      run.drawAt = 0;
      return { value: null };
    },
  };
}

function spyOn(doubles: SpecDoubles | undefined): BuiltinSpec {
  return {
    name: "spyon",
    aliases: [],
    params: [param("name", "The name of the command to watch; any of its names or aliases.")],
    doc: {
      summary: "Watch a built-in command so a case can check later how it was called.",
      behaviour:
        "Called by a case. Wraps the command a plain call of `name` reaches (its top layer; `name` is folded and an alias reaches the same command) and returns an opaque handle to pass to `expect`. From then on, each call that reaches the command records `specCapture` pictures of its arguments at call time, before the command runs, and then runs the real command unchanged: its return value, by-reference writes, waits, effects and errors are those of the unwatched call. Calls before installation are not recorded. A name that reaches no command, a `script-spec` command or a catalogue placeholder with no implementation raises `spec.spy-target`; a second spy on the same command in one run raises `spec.spy-exists`. Does not wait.",
      groups: [SPEC_GROUP],
      access: "public",
      returns: { summary: "The spy's opaque handle." },
      waits: { kind: "never", summary: "Installs the spy and returns at once." },
      see: SEE_DOUBLES,
    },
    call: (_view, args) => {
      const run = doublesOf(doubles, "spyOn");
      const name = args[0]?.value;
      if (typeof name !== "string" || name === "") throw new ScriptError("spec.spy-target", "spyOn: the command name must be a non-empty string");
      return { value: installSpy(run, name) };
    },
  };
}

/** The twelve natives, the doubles bound to one run's host-side state (or to none). */
export function specCommands(doubles?: SpecDoubles): readonly BuiltinSpec[] {
  return [
    SPEC_RESULT,
    SPEC_CAPTURE,
    SPEC_EQUAL,
    SPEC_CONTAIN,
    SPEC_CLOSE,
    SPEC_THROW_BEGIN,
    SPEC_THROW_END,
    specCalled(doubles),
    specInput(doubles),
    specTicks(doubles),
    specRng(doubles),
    spyOn(doubles),
  ];
}

export const SPEC_COMMANDS: readonly BuiltinSpec[] = specCommands();
