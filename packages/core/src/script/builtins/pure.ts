/**
 * Pure RPGCode maths, seeded random and language-flow commands (ticket 3.13;
 * AD-2, AD-12, AD-13; FUN-7; docs/spec/engine/rpgcode-language.md).
 */

import {
  cos,
  log,
  sin,
  sqrt,
  tan,
} from "../../fmath/index.ts";
import { TICKS_PER_SECOND, secondsToTicks } from "../../time/time.ts";
import type { Arg, BuiltinDoc, BuiltinSpec } from "../builtins.ts";
import {
  CALLABLE_NOT_CALLABLE,
  ScriptError,
} from "../errors.ts";
import type { CommandEffect } from "../plugin.ts";
import { isCallableValue, toNumberValue, toStringValue, truthy } from "../values.ts";

function unaryMath(name: string, operation: (value: number) => number): BuiltinSpec {
  return {
    name,
    aliases: [],
    params: [
      { name: "value", optional: false, byRef: false, variadic: false },
      { name: "dest", optional: true, byRef: true, variadic: false },
    ],
    call: (_view, args) => {
      const value = operation(toNumberValue(args[0]?.value ?? 0));
      return args.length > 1 ? { value, out: [[1, value]] } : { value };
    },
  };
}

function numberClassification(
  name: string,
  predicate: (value: number) => boolean,
  doc?: BuiltinSpec["doc"],
): BuiltinSpec {
  return {
    name,
    aliases: [],
    params: [
      { name: "value", optional: false, byRef: true, variadic: false },
      { name: "dest", optional: true, byRef: true, variadic: false },
    ],
    ...(doc === undefined ? {} : { doc }),
    call: (_view, args) => {
      const raw = args[0]?.value;
      const value = typeof raw === "number" && predicate(raw) ? 1 : 0;
      return args.length > 1 ? { value, out: [[1, value]] } : { value };
    },
  };
}

const MATH_SPECS: readonly BuiltinSpec[] = [
  unaryMath("sin", sin),
  unaryMath("cos", cos),
  unaryMath("tan", tan),
  unaryMath("sqrt", sqrt),
  unaryMath("log", log),
  {
    name: "random",
    aliases: [],
    params: [
      {
        name: "max",
        optional: false,
        byRef: false,
        variadic: false,
        doc: { summary: "Largest possible result after integer truncation.", type: "integer", range: { min: 1, note: "For finite nonzero max, the generated result is 1 through abs(max); max 0 and NaN follow the command behaviour." } },
      },
      {
        name: "dest",
        optional: true,
        byRef: true,
        variadic: false,
        doc: { summary: "Optional output variable receiving the generated number.", type: "integer", ifOmitted: "No by-reference write occurs; use the returned value." },
      },
    ],
    doc: {
      summary: "Generate a random number from one to the supplied maximum, inclusive.",
      behaviour: "Truncate max to an integer; max 0 returns 1, a nonzero finite max draws from 1 through abs(max), and NaN draws from 1 through 32768. Use the injected deterministic RNG and optionally write dest. This command does not wait.",
      groups: ["variables-strings-math-30", "core-runtime"],
      returns: { summary: "The generated integer, also written to dest when supplied." },
      since: "3.1",
      waits: { kind: "never", summary: "Never waits; random draws are deterministic under the injected RNG." },
    },
    call: (view, args) => {
      if (args.length < 1) {
        throw new ScriptError("builtin.bad-arg", "random requires max argument");
      }
      const raw = toNumberValue(args[0]?.value ?? 0);
      let value: number;
      if (Number.isNaN(raw)) {
        value = 1 + (view.rng.nextUint32() % 32768);
      } else {
        const truncated = Math.trunc(raw);
        if (truncated === 0) {
          value = 1;
        } else {
          const range = Math.abs(truncated);
          value = 1 + (view.rng.nextUint32() % range);
        }
      }
      return args.length > 1 ? { value, out: [[1, value]] } : { value };
    },
  },
  {
    name: "iif",
    aliases: [],
    params: [
      { name: "condition", optional: false, byRef: false, variadic: false },
      { name: "whenTrue", optional: false, byRef: false, variadic: false },
      { name: "whenFalse", optional: false, byRef: false, variadic: false },
    ],
    doc: {
      summary: "Obsolete. Use the tertiary operator result = (expression ? true part : false part)",
      behaviour: "Evaluate condition and return whenTrue when it is on, otherwise whenFalse; this obsolete command does not wait.",
      groups: ["program-flow-errors-debugging-25", "core-runtime"],
      tags: ["obsolete"],
      replacedBy: { kind: "syntax", text: "?: operator" },
      reason: "The specification directs new programs to use the ?: operator.",
      waits: { kind: "never", summary: "Never waits." },
    },
    call: (_view, args) => ({ value: truthy(args[0]?.value ?? 0) ? (args[1]?.value ?? 0) : (args[2]?.value ?? 0) }),
  },
  {
    name: "gettickcount",
    aliases: [],
    params: [{
      name: "milliseconds",
      optional: true,
      byRef: true,
      variadic: false,
      doc: { summary: "Optional output variable receiving elapsed milliseconds.", type: "integer", ifOmitted: "No by-reference write occurs; use the returned value." },
    }],
    doc: {
      summary: "Get the number of milliseconds since Windows started.",
      behaviour: "Return floor(tick × 1000 / 60) milliseconds from the injected fixed 60 Hz simulation tick, and write the same value to milliseconds when supplied. This command does not wait.",
      groups: ["program-flow-errors-debugging-25", "core-runtime"],
      returns: { summary: "Elapsed deterministic simulation milliseconds." },
      waits: { kind: "never", summary: "Never waits." },
    },
    call: (view, args) => {
      const value = Math.floor((view.clock.tick() * 1000) / TICKS_PER_SECOND);
      return args.length > 0 ? { value, out: [[0, value]] } : { value };
    },
  },
  numberClassification("isnan", (v) => Number.isNaN(v)),
  numberClassification("isinfinity", (v) => v === Infinity || v === -Infinity),
  numberClassification("isfinite", (v) => Number.isFinite(v), {
    summary: "Returns 1 if `value` is numeric and a finite number (not NaN, not ±Infinity), 0 otherwise.",
    behaviour: "Return 1 exactly when value is a finite number; otherwise return 0 and optionally write that result to dest. This command does not wait.",
    groups: ["reawakened-additions-not-part-of-the-282-legacy-catalogue"],
    tags: ["experimental"],
    waits: { kind: "never", summary: "Never waits." },
  }),
];

function programControl(args: readonly Arg[], action: "executeProgram" | "replaceProgram"): CommandEffect {
  const file = toStringValue(args[0]?.value ?? "");
  if (action === "executeProgram" && args.length === 3) {
    const source = args[1]?.value;
    const target = args[2]?.value;
    return {
      kind: "vm.control",
      args: [action, file, "positional", source === undefined ? 0 : source, target === undefined ? 0 : target],
    };
  }
  if (args.length === 2) {
    return { kind: "vm.control", args: [action, file, "object", args[1]!.value] };
  }
  return { kind: "vm.control", args: [action, file, "default"] };
}

function control(args: readonly Arg[], action: "run" | "jump"): CommandEffect {
  if (action === "run") return programControl(args, "replaceProgram");
  return { kind: "vm.control", args: ["jump", toStringValue(args[0]?.value ?? 0)] };
}

function programDoc(summary: string, behaviour: string, see: string): BuiltinDoc {
  return {
    summary,
    behaviour,
    groups: ["reawakened-additions-not-part-of-the-282-legacy-catalogue", "core-runtime"],
    waits: { kind: "other", summary: "Runs on the calling thread; a wait in the program parks that thread." },
    see: [`docs/spec/engine/rpgcode-functions.md#${see}`],
  };
}

const EXECUTE_PROGRAM_DOC = programDoc(
  "Run Prg/<file> as a nested call and return 0 when it finishes.",
  "Runs a named file as a nested frame on this thread, with fresh locals and shared globals. It returns 0 when the nested program ends; a blank filename also returns 0, and a missing file raises catchable `program.missing` without starting it. The optional dictionary (or positional source and target) is bound to the called program's root variable `context`, not `this`. Supplied source and target handles apply only during the call; omitted values inherit the caller's pair, and the pair is restored when the called program ends.",
  "reawakened-executeprogram",
);

const REPLACE_PROGRAM_DOC = programDoc(
  "End the calling program's frame chain and start Prg/<file> on the same thread without returning.",
  "Discards every frame on this thread, including pending `executeProgram` returns and source/target restorations, then starts the named file with fresh locals and shared globals. The optional dictionary is bound to the new program's root variable `context`, not `this`. A blank filename leaves the current program unchanged; a missing file raises catchable `program.missing` without discarding the current frames.",
  "reawakened-replaceprogram",
);


const PROGRAM_CALL_SPECS: readonly BuiltinSpec[] = [
  {
    name: "executeprogram",
    aliases: [],
    params: [
      { name: "program", optional: false, byRef: false, variadic: false },
      { name: "contextOrSource", optional: true, byRef: false, variadic: false },
      { name: "target", optional: true, byRef: false, variadic: false },
    ],
    doc: EXECUTE_PROGRAM_DOC,
    call: (_view, args) => ({ value: 0, effects: [programControl(args, "executeProgram")] }),
  },
  {
    name: "replaceprogram",
    aliases: [],
    params: [
      { name: "program", optional: false, byRef: false, variadic: false },
      { name: "context", optional: true, byRef: false, variadic: false },
    ],
    doc: REPLACE_PROGRAM_DOC,
    call: (_view, args) => ({ value: null, effects: [programControl(args, "replaceProgram")] }),
  },
];

const FLOW_SPECS: readonly BuiltinSpec[] = [
  {
    name: "run",
    aliases: [],
    params: [
      { name: "program", optional: false, byRef: false, variadic: false },
      { name: "context", optional: true, byRef: false, variadic: false },
    ],
    doc: programDoc(
      "Transfer control to a different program.",
      "Legacy alias of `replaceProgram`: discards every frame on this thread and starts the named file. The optional context dictionary is passed to the replacement program.",
      "reawakened-replaceprogram",
    ),
    call: (_view, args) => ({ value: null, effects: [control(args, "run")] }),
  },
  ...PROGRAM_CALL_SPECS,
  {
    name: "change",
    aliases: [],
    params: [{ name: "program", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [{ kind: "flow-control", args: ["change", toStringValue(args[0]?.value ?? "")] }] }),
  },
  {
    name: "rpgcode",
    aliases: [],
    params: [{ name: "line", optional: false, byRef: false, variadic: false }],
    call: (view, args) => ({
      value: null,
      effects: view.thread === undefined ? [] : [{ kind: "vm.control", args: ["threadTell", view.thread, toStringValue(args[0]?.value ?? "")] }],
    }),
  },
  {
    name: "delay",
    aliases: [],
    params: [{ name: "seconds", optional: false, byRef: false, variadic: false }],
    doc: {
      summary: "Delay for a certain number of seconds.",
      behaviour: "Convert seconds with max(1, floor(seconds × 60 + 0.5)), then block the whole game until the resulting absolute end tick.",
      groups: ["program-flow-errors-debugging-25", "core-runtime"],
      waits: { kind: "ticks", summary: "Blocks for the converted number of simulation ticks." },
    },
    call: (view, args) => {
      const seconds = toNumberValue(args[0]?.value ?? 0);
      const ticks = secondsToTicks(seconds);
      if (ticks === null || ticks < 1) throw new ScriptError("builtin.bad-arg", `delay: ${seconds} is not a valid duration`);
      if (view.packageStartup === true) throw new ScriptError("package.startup-unfinished", "a package start-up program waits; start-up programs must not wait");
      return { value: null, wait: { kind: "sleep", global: true, until: view.clock.tick() + ticks, resumesCall: true } };
    },
  },
  {
    name: "end",
    aliases: ["done", "stop"],
    params: [],
    doc: {
      summary: "End the program.",
      behaviour: "Unwind every pending frame of the running program immediately; aliases done and stop perform the same control effect and the call does not wait.",
      groups: ["program-flow-errors-debugging-25", "core-runtime"],
      waits: { kind: "never", summary: "Never waits." },
    },
    call: () => ({ value: null, effects: [{ kind: "vm.control", args: ["end"] }] }),
  },
  {
    name: "branch",
    aliases: ["fbranch"],
    params: [{ name: "label", optional: false, byRef: false, variadic: false }],
    call: (_view, args) => ({ value: null, effects: [control(args, "jump")] }),
  },
];

const BINDING_SPECS: readonly BuiltinSpec[] = [
  {
    name: "bindthis",
    aliases: [],
    params: [
      { name: "fn", optional: false, byRef: false, variadic: false },
      { name: "obj", optional: false, byRef: false, variadic: false },
    ],
    doc: {
      summary: "Return a new callable whose `this` receiver is `obj`, without mutating `fn`.",
      behaviour: "Require a callable and a live object handle, then return a new callable with the same definition and captures and the supplied object as receiver; the original callable is unchanged and the command does not wait.",
      groups: ["reawakened-additions-not-part-of-the-282-legacy-catalogue", "core-runtime"],
      returns: { summary: "A new callable whose receiver is the supplied object." },
      throws: [
        { code: CALLABLE_NOT_CALLABLE, when: "The first argument is not callable." },
        { code: "object.invalid", when: "The second argument is not a live object handle." },
      ],
      see: ["docs/spec/engine/rpgcode-modules-and-objects.md#oop-11"],
      waits: { kind: "never", summary: "Never waits." },
    },
    call: (view, args) => {
      const fn = args[0]?.value;
      if (!isCallableValue(fn)) {
        throw new ScriptError(CALLABLE_NOT_CALLABLE, "bindThis: the first argument must be callable");
      }
      const object = args[1]?.value;
      const objectHandle =
        typeof object === "object" &&
        object !== null &&
        "kind" in object &&
        object.kind === "object"
          ? object
          : undefined;
      if (
        objectHandle === undefined ||
        view.state === undefined ||
        view.state.vm.objects.every((record) => record.handle !== objectHandle.handle)
      ) {
        throw new ScriptError("object.invalid", "bindThis: the second argument must be a live object");
      }
      return {
        value: {
          type: "callable",
          def: fn.def,
          captures: fn.captures,
          receiver: String(objectHandle.handle),
          ...(fn.owner === undefined ? {} : { owner: fn.owner }),
        },
      };
    },
  },
  {
    name: "registerplugin",
    aliases: [],
    params: [{ name: "definition", optional: false, byRef: false, variadic: false }],
    doc: {
      summary: "Register command layers and/or replaceable menu-screen providers.",
      behaviour: "Take a dictionary with a name and a required commands dictionary, which may be empty, plus an optional menuProviders dictionary keyed by screen. Command interceptors call next to pass through to the layer below; menu providers replace their whole screen and receive no next. Later registrations win per key. Registrations are rebuilt at game start and are not saved; the returned remove function removes their layers/providers. The call does not wait.",
      groups: ["reawakened-additions-not-part-of-the-282-legacy-catalogue", "core-runtime"],
      returns: { summary: "A dictionary `{ name, remove }`; calling `remove()` returns 1, or 0 when the layers were already removed." },
      throws: [
        { code: "builtin.bad-arg", when: "The argument is not a dictionary, or its name is not a string, or it has no commands dictionary." },
        { code: CALLABLE_NOT_CALLABLE, when: "A command in the commands dictionary is not a function; nothing is registered." },
        { code: "unknown.command", when: "A listed command is neither an engine command nor a function; nothing is registered." },
      ],
      see: ["docs/spec/engine/rpgcode-modules-and-objects.md#registerplugin-layers-entry-198"],
      waits: { kind: "never", summary: "Never waits." },
    },
    // The VM registers the layers and supplies the value: they need the layer table, the programs and the object table.
    call: () => ({ value: null, effects: [{ kind: "vm.control", args: ["registerPlugin"] }] }),
  },
];

export const PURE_SPECS: readonly BuiltinSpec[] = [...MATH_SPECS, ...FLOW_SPECS, ...BINDING_SPECS];
