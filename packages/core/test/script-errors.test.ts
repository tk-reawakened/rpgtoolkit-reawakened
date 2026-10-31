// Error handling, located diagnostics, the Logger and the failure table (ticket 3.7;
// docs/spec/engine/rpgcode-errors-and-threads.md#error-handling ERR-1/ERR-2, AD-24).
import { deepEqual, equal, throws } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  advanceScriptTick,
  compileInline,
  createCollectingSink,
  createGameState,
  createLogger,
  drainDiagnostics,
  failureClass,
  hashState,
  locateError,
  NULL_LOGGER,
  restoreGameState,
  ScriptError,
  snapshot,
  startProgram,
  toDiagnostic,
  type Diagnostic,
  type GameState,
  type LogRecord,
  type PluginDefinition,
  type ScriptServices,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

type Outcome = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly records: LogRecord[];
  readonly diagnostics: Diagnostic[];
};

function begin(program: string, plugins: readonly PluginDefinition[] = []) {
  const state = createGameState({ seed: 0 });
  const { sink, records } = createCollectingSink();
  const services = createScriptServices(state, plugins, createLogger([sink]));
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  return { state, services, records };
}

function run(program: string, ticks = 1, plugins: readonly PluginDefinition[] = []): Outcome {
  const { state, services, records } = begin(program, plugins);
  for (let tick = 0; tick < ticks; tick += 1) advanceScriptTick(state, services);
  return { state, services, records, diagnostics: drainDiagnostics(services) };
}

function codes(outcome: Outcome): string[] {
  return outcome.diagnostics.map((diagnostic) => diagnostic.code);
}

// ---------------------------------------------------------------------------
// The failure-class table (ERR-2)

test("the failure table marks runtime failures catchable and load-time failures not", () => {
  const runtime = [
    "unknown.command",
    "arity.mismatch",
    "builtin.bad-arg",
    "program.missing",
    "object.invalid",
    "object.abstract-class",
    "object.inaccessible-member",
    "vm.modulo-by-zero",
    "vm.unknown-label",
    "handler.top-level",
    "handler.unknown-label",
    "handler.not-handling",
  ];
  for (const code of runtime) equal(failureClass(code) !== null, true, `${code} is catchable`);

  for (const code of ["syntax.error", "compile.duplicate-function", "program.file-unsupported", "restore.shape"]) {
    equal(failureClass(code), null, `${code} is load-time`);
  }
  // A plugin's own stable code is a catchable built-in failure.
  equal(failureClass("plugin.custom"), "builtin");
  equal(failureClass("object.invalid"), "object");
  equal(failureClass("vm.modulo-by-zero"), "arithmetic");
});

test("a failure is located at its instruction and converts to the plain four-field diagnostic", () => {
  const bare = new ScriptError("builtin.bad-arg", "no position");
  const at = { file: "main.prg", line: 7 };
  const located = locateError(bare, at);
  deepEqual(toDiagnostic(located), {
    code: "builtin.bad-arg",
    file: "main.prg",
    line: 7,
    message: "no position",
  });
  equal(Object.keys(toDiagnostic(located)).sort().join(), "code,file,line,message");

  // The instruction's position wins over the error's own.
  const own = new ScriptError("builtin.bad-arg", "m", { file: "other.prg", line: 1 });
  deepEqual(locateError(own, at).pos, at);
  // With no instruction position the error's own is the fallback.
  equal(locateError(own, null), own);
});

// ---------------------------------------------------------------------------
// Handlers

test("an unhandled failure is reported and the thread continues at the next step", () => {
  const outcome = run("a = 1\nnope()\nb = 2\n");

  deepEqual(outcome.diagnostics, [
    {
      code: "unknown.command",
      file: "<inline>",
      line: 2,
      message: 'no built-in or function named "nope"',
    },
  ]);
  equal(outcome.state.vm.globals.a, 1);
  equal(outcome.state.vm.globals.b, 2);
  equal(outcome.state.vm.threads[0]!.status, "finished");
  deepEqual(
    outcome.records.map((record) => [record.level, record.code]),
    [["error", "unknown.command"]],
  );
});

const LABEL_HANDLER = `function f() {
  setErrorHandler(:failed)
  nope()
  skipped = 1
  return 0
  :failed
  handled = 1
  return 0
}
f()
after = 1
`;

const LEGACY_LABEL_HANDLER = LABEL_HANDLER.replace("setErrorHandler(:failed)", "on error goto :failed");

for (const [name, program] of [
  ["setErrorHandler", LABEL_HANDLER],
  ["on error goto", LEGACY_LABEL_HANDLER],
] as const) {
  test(`a ${name} label handler jumps to its label in the same function`, () => {
    const outcome = run(program);
    deepEqual(codes(outcome), ["unknown.command"]);
    equal(outcome.diagnostics[0]!.line, 3);
    equal(Object.hasOwn(outcome.state.vm.globals, "skipped"), false);
    equal(outcome.state.vm.globals.handled, 1);
    equal(outcome.state.vm.globals.after, 1);
  });
}

test("a label handler stays active after it fires, so a later failure in the function is caught again", () => {
  const outcome = run(`function f() {
  setErrorHandler(:failed)
  a = nope()
  b = nope2()
  return 0
  :failed
  count = count + 1
  resumeNext()
}
f()
`);
  deepEqual(codes(outcome), ["unknown.command", "unknown.command"]);
  deepEqual(
    outcome.diagnostics.map((diagnostic) => diagnostic.line),
    [3, 4],
  );
  equal(outcome.state.vm.globals.count, 2);
  equal(outcome.state.vm.threads[0]!.status, "finished");
});

const RESUME_NEXT = `function f() {
  setResumeNextHandler()
  x = nope()
  y = 5
  return 0
}
f()
done = 1
`;

for (const [name, program] of [
  ["setResumeNextHandler", RESUME_NEXT],
  ["on error resume next", RESUME_NEXT.replace("setResumeNextHandler()", "on error resume next")],
] as const) {
  test(`${name} swallows the failure and the failed call contributes the unset value`, () => {
    const outcome = run(program);
    deepEqual(codes(outcome), ["unknown.command"]);
    equal(outcome.diagnostics[0]!.line, 3);
    equal(outcome.state.vm.globals.x, 0);
    equal(outcome.state.vm.globals.y, 5);
    equal(outcome.state.vm.globals.done, 1);
  });
}

const RESUME_FROM_HANDLER = `function f() {
  setErrorHandler(:failed)
  x = nope()
  after = 1
  return 0
  :failed
  seen = 1
  resumeNext()
}
f()
done = 1
`;

test("resumeNext() continues after the failing statement and consumes the resume point once", () => {
  const outcome = run(RESUME_FROM_HANDLER);
  deepEqual(codes(outcome), ["unknown.command"]);
  equal(outcome.state.vm.globals.seen, 1);
  equal(outcome.state.vm.globals.after, 1);
  equal(outcome.state.vm.globals.done, 1);
});

test("resumeNext() outside a handler, twice for one failure, or at top level is an error", () => {
  const outside = run("function f() {\n  resumeNext()\n  return 0\n}\nf()\n");
  deepEqual(codes(outside), ["handler.not-handling"]);
  equal(outside.diagnostics[0]!.line, 2);

  const top = run("resumeNext()\n");
  deepEqual(codes(top), ["handler.not-handling"]);
  equal(top.diagnostics[0]!.line, 1);

  const twice = run(`function f() {
  setErrorHandler(:failed)
  nope()
  resumeNext()
  return 0
  :failed
  resumeNext()
}
f()
`);
  // The handler's resumeNext() consumes the resume point, so the second one, reached by
  // normal flow, is itself an error (which the still-active handler then catches).
  deepEqual(codes(twice), ["unknown.command", "handler.not-handling"]);
  equal(twice.diagnostics[1]!.line, 4);
});

test("a handler cannot be set at top level, and none is installed", () => {
  const outcome = run("setErrorHandler(:x)\nnope()\n:x\nmarker = 1\n");
  deepEqual(codes(outcome), ["handler.top-level", "unknown.command"]);
  equal(outcome.diagnostics[0]!.line, 1);
  equal(outcome.diagnostics[1]!.line, 2);
  equal(outcome.state.vm.threads[0]!.frames.length, 0);

  const resume = run("setResumeNextHandler()\n");
  deepEqual(codes(resume), ["handler.top-level"]);
  const legacy = run("on error resume next\n");
  deepEqual(codes(legacy), ["handler.top-level"]);
});

test("a handler label that is missing or in another function is a catchable error at the handler statement", () => {
  const missing = run("function f() {\n  setErrorHandler(:gone)\n  return 0\n}\nf()\nafter = 1\n");
  deepEqual(codes(missing), ["handler.unknown-label"]);
  equal(missing.diagnostics[0]!.line, 2);
  equal(missing.state.vm.globals.after, 1);

  const other = run(`function g() {
  return 0
  :elsewhere
  return 1
}
function f() {
  setErrorHandler(:elsewhere)
  return 0
}
f()
`);
  deepEqual(codes(other), ["handler.unknown-label"]);
  equal(other.diagnostics[0]!.line, 7);
});

test("a callee's failure is never caught by the caller's handler", () => {
  const outcome = run(`function inner() {
  nope()
  innerDone = 1
  return 0
}
function outer() {
  setErrorHandler(:caught)
  inner()
  outerDone = 1
  return 0
  :caught
  callerCaught = 1
  return 0
}
outer()
`);
  deepEqual(codes(outcome), ["unknown.command"]);
  equal(outcome.diagnostics[0]!.line, 2);
  equal(outcome.state.vm.globals.innerdone, 1);
  equal(outcome.state.vm.globals.outerdone, 1);
  equal(Object.hasOwn(outcome.state.vm.globals, "callercaught"), false);
});

test("a callee's own handler catches its failure", () => {
  const outcome = run(`function inner() {
  setErrorHandler(:mine)
  nope()
  return 0
  :mine
  innerHandled = 1
  return 0
}
function outer() {
  setErrorHandler(:caught)
  inner()
  return 0
  :caught
  callerCaught = 1
  return 0
}
outer()
`);
  deepEqual(codes(outcome), ["unknown.command"]);
  equal(outcome.state.vm.globals.innerhandled, 1);
  equal(Object.hasOwn(outcome.state.vm.globals, "callercaught"), false);
});

test("a snapshot taken inside a handler restores the active handler and finishes identically", () => {
  const program = `function f() {
  setErrorHandler(:failed)
  x = nope()
  after = 1
  return 0
  :failed
  seen = 1
  sleep(1)
  resumeNext()
}
f()
done = 1
`;
  const straight = begin(program);
  for (let tick = 0; tick < 4; tick += 1) advanceScriptTick(straight.state, straight.services);

  const first = begin(program);
  advanceScriptTick(first.state, first.services);
  const thread = first.state.vm.threads[0]!;
  equal(thread.status, "waiting");
  const handler = thread.frames[1]!.errorHandler;
  equal(handler?.mode, "label");
  equal(handler?.label, "failed");
  equal(handler?.active, true);
  equal(typeof handler?.resume, "number");

  const restored = restoreGameState(snapshot(first.state));
  deepEqual(restored.vm.threads[0]!.frames[1]!.errorHandler, handler);
  const services = createScriptServices(restored);
  for (let tick = 0; tick < 3; tick += 1) advanceScriptTick(restored, services);

  equal(restored.vm.globals.after, 1);
  equal(restored.vm.globals.done, 1);
  equal(hashState(restored), hashState(straight.state));
  equal(restored.vm.threads[0]!.frames.length, 0);
});

test("a load-time error is not catchable and still throws", () => {
  const { state, services } = begin("function f() {\n  setResumeNextHandler()\n  x = (\n}\nf()\n");
  throws(
    () => advanceScriptTick(state, services),
    (error: unknown) => error instanceof ScriptError && error.code.startsWith("syntax."),
  );
  throws(() => compileInline("on error sideways\n"), (error: unknown) => {
    return error instanceof ScriptError && error.code === "syntax.error";
  });
});

// ---------------------------------------------------------------------------
// ERR-2's failure table

test("the failure table's catchable rows reach the same diagnostic path", () => {
  const cases: readonly (readonly [string, string, number])[] = [
    ["function g(a) { return a }\ng(1, 2)\n", "unknown.command", 2],
    ["sleep()\n", "arity.mismatch", 1],
    ["sleep(1, 2)\n", "arity.mismatch", 1],
    ["sleep(0)\n", "builtin.bad-arg", 1],
    ["x = 7 % 0\n", "vm.modulo-by-zero", 1],
    ["underarrow()\n", "builtin.obsolete", 1],
  ];
  for (const [program, code, line] of cases) {
    const outcome = run(program);
    equal(outcome.diagnostics.length, 1, program);
    equal(outcome.diagnostics[0]!.code, code, program);
    equal(outcome.diagnostics[0]!.line, line, program);
    equal(outcome.diagnostics[0]!.file, "<inline>", program);
    equal(outcome.state.vm.threads[0]!.status === "finished" || outcome.state.vm.threads[0]!.status === "waiting", true);
  }
});

test("modulo by zero produces no value; division by zero, sparse reads and conversions are not errors", () => {
  const modulo = run("x = 5\nx = 7 % 0\ny = 3\n");
  deepEqual(codes(modulo), ["vm.modulo-by-zero"]);
  // The failed `%` contributes the unset value, so the assignment stores 0 and the next statement runs.
  equal(modulo.state.vm.globals.x, 0);
  equal(modulo.state.vm.globals.y, 3);

  const quiet = run('d = 6 / 0\nm = arr[3]\nn = "12abc" + 1\n');
  deepEqual(quiet.diagnostics, []);
  equal(quiet.state.vm.globals.d, Infinity);
  equal(quiet.records.length, 0);
});

const OBJECTS = `class A { method f() = 0 }
class B { private: var x; method B() { x = 1 } }
class C {}
`;

test("the 3.6 object failures are catchable runtime errors with stable codes and exact lines", () => {
  const abstract = run(`${OBJECTS}a = A()\nafter = 1\n`);
  deepEqual(abstract.diagnostics, [
    { code: "object.abstract-class", file: "<inline>", line: 4, message: "class a is abstract" },
  ]);
  equal(abstract.state.vm.globals.after, 1);

  const inaccessible = run(`${OBJECTS}b = B()\nr = b.x\nafter = 1\n`);
  deepEqual(codes(inaccessible), ["object.inaccessible-member"]);
  equal(inaccessible.diagnostics[0]!.line, 5);
  equal(inaccessible.state.vm.globals.after, 1);

  const freed = run(`${OBJECTS}c = C()\nc->release()\nr = c->x()\nafter = 1\n`);
  deepEqual(codes(freed), ["object.invalid"]);
  equal(freed.diagnostics[0]!.line, 6);
  equal(freed.state.vm.globals.after, 1);

  for (const code of ["object.invalid", "object.abstract-class", "object.inaccessible-member"]) {
    equal(failureClass(code), "object");
  }
});

test("an object failure inside a function is caught by that function's handler", () => {
  const outcome = run(`${OBJECTS}function f() {
  setErrorHandler(:failed)
  a = A()
  return 0
  :failed
  caught = 1
  return 0
}
f()
`);
  deepEqual(codes(outcome), ["object.abstract-class"]);
  equal(outcome.diagnostics[0]!.line, 6);
  equal(outcome.state.vm.globals.caught, 1);
});

// ---------------------------------------------------------------------------
// debug(), debugger() and the Logger

test("debug(false) silences interpreter Logger messages but never the host diagnostics, and debug(true) restores them", () => {
  const outcome = run("debug(false)\nnope()\nnope2()\ndebug(true)\nnope3()\n");

  deepEqual(codes(outcome), ["unknown.command", "unknown.command", "unknown.command"]);
  deepEqual(
    outcome.diagnostics.map((diagnostic) => diagnostic.line),
    [2, 3, 5],
  );
  deepEqual(
    outcome.records.map((record) => record.message),
    ['no built-in or function named "nope3"'],
  );
  equal(Object.hasOwn(outcome.state.vm, "messagesOff"), false);
});

test("debug(false) is saved state and survives a snapshot", () => {
  const state = run("debug(false)\n").state;
  equal(state.vm.messagesOff, true);
  equal(restoreGameState(snapshot(state)).vm.messagesOff, true);
});

test("an interpreter-internal fault is logged even while messages are off", () => {
  const bad: PluginDefinition = {
    id: "test.bad",
    version: "1.0.0",
    commands: [
      {
        name: "bad",
        aliases: [],
        params: [{ name: "x", optional: false, byRef: false, variadic: false }],
        call: () => ({ value: null, out: [[0, 1]] }),
      },
    ],
  };
  const outcome = run("debug(false)\nbad(1)\n", 1, [bad]);
  deepEqual(codes(outcome), ["builtin.out-not-by-ref"]);
  equal(outcome.records.length, 1);
  equal(outcome.records[0]!.code, "builtin.out-not-by-ref");
});

test("debugger(msg) sends a plain located record to the sink", () => {
  const outcome = run('x = 1\ndebugger("look here")\n');
  equal(outcome.records.length, 1);
  const record = outcome.records[0]!;
  deepEqual(record, {
    level: "info",
    code: "script.debugger",
    message: "look here",
    data: { file: "<inline>", line: 2, thread: outcome.state.vm.threads[0]!.id },
  });
  deepEqual(outcome.diagnostics, []);
});

test("the Logger fans plain records to every sink in order and filters by level", () => {
  const order: string[] = [];
  const first = createCollectingSink();
  const logger = createLogger([
    (record) => {
      order.push(`a:${record.level}`);
      first.sink(record);
    },
    (record) => {
      order.push(`b:${record.level}`);
    },
  ]);

  logger.debug({ level: "debug", code: "t.debug", message: "d", data: { n: 1 } });
  logger.info({ level: "info", code: "t.info", message: "i", data: null });
  logger.warn({ level: "warn", code: "t.warn", message: "w", data: [1, "x"] });
  logger.error({ level: "error", code: "t.error", message: "e", data: { nested: { ok: true } } });

  deepEqual(order, ["a:debug", "b:debug", "a:info", "b:info", "a:warn", "b:warn", "a:error", "b:error"]);
  deepEqual(
    first.records.map((record) => [record.level, record.code, record.message]),
    [
      ["debug", "t.debug", "d"],
      ["info", "t.info", "i"],
      ["warn", "t.warn", "w"],
      ["error", "t.error", "e"],
    ],
  );
  deepEqual(first.records[3]!.data, { nested: { ok: true } });

  // A minimum level drops the records below it.
  const filtered = createCollectingSink();
  const quiet = createLogger([filtered.sink], "warn");
  quiet.debug({ level: "debug", code: "x", message: "", data: null });
  quiet.info({ level: "info", code: "x", message: "", data: null });
  quiet.warn({ level: "warn", code: "x", message: "", data: null });
  quiet.error({ level: "error", code: "x", message: "", data: null });
  deepEqual(
    filtered.records.map((record) => record.level),
    ["warn", "error"],
  );
});

test("a logger with no sink is a no-op and core never calls console", () => {
  NULL_LOGGER.error({ level: "error", code: "t", message: "m", data: null });
  createLogger().warn({ level: "warn", code: "t", message: "m", data: null });

  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const offenders = readdirSync(root, { recursive: true })
    .filter((path) => path.endsWith(".ts"))
    .filter((path) => /\bconsole\./.test(readFileSync(join(root, path), "utf8")));
  deepEqual(offenders, []);
});
