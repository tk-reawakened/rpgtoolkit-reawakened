// Modules (ticket 3.8; docs/spec/engine/rpgcode-modules-and-objects.md#modules
// MOD-1..3, R-35, R-41..R-44; docs/spec/formats/rpgcode-program.md §9.1): literal and
// implicit includes through the asset resolver, hoisting and clashes, redirects
// that survive a snapshot, the source-hash cache and the compiled-program refusal.
import { deepEqual, equal, throws } from "node:assert/strict";
import { TextEncoder } from "node:util";
import { test } from "node:test";
import {
  advanceScriptTick,
  assetKey,
  compileProgram,
  COMPILER_VERSION,
  createAssetIndex,
  createCollectingSink,
  createGameState,
  createLogger,
  createProgramCache,
  drainDiagnostics,
  failureClass,
  fileProgramRef,
  hashState,
  PACKAGE_ROOT,
  resolveCall,
  restoreGameState,
  ScriptError,
  snapshot,
  startProgram,
  type Diagnostic,
  type GameState,
  type LogRecord,
  type PluginDefinition,
  type ProgramLoader,
  type ProgramRef,
  type ScriptServices,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const encoder = new TextEncoder();

/** A package-rooted loader that also records every read, so a test can prove what was (not) parsed. */
type CountingLoader = ProgramLoader & { readonly reads: string[] };

/** A loader over `Prg/<name>` files; raw bytes model a compiled program. */
function loaderOf(files: Readonly<Record<string, string | Uint8Array>>): CountingLoader {
  const paths = Object.keys(files).map((name) => `Prg/${name}`);
  const bytes = new Map<string, Uint8Array>();
  for (const [name, content] of Object.entries(files)) {
    bytes.set(assetKey(`Prg/${name}`), typeof content === "string" ? encoder.encode(content) : content);
  }
  const reads: string[] = [];
  return {
    index: createAssetIndex(paths),
    root: PACKAGE_ROOT,
    read: (key) => {
      reads.push(key);
      return bytes.get(key);
    },
    reads,
  };
}

type Run = {
  readonly state: GameState;
  readonly services: ScriptServices;
  readonly records: LogRecord[];
};

function setup(loader: ProgramLoader, ref: ProgramRef, state = createGameState({ seed: 1 })): Run {
  const { sink, records } = createCollectingSink();
  const services = createScriptServices(state, [], createLogger([sink]), undefined, loader);
  startProgram(state.vm, ref);
  return { state, services, records };
}

/** Run one tick and return the diagnostics it collected, oldest first. */
function tick(run: Run): Diagnostic[] {
  advanceScriptTick(run.state, run.services);
  return drainDiagnostics(run.services);
}

type MainRun = Run & { readonly loader: CountingLoader; readonly ref: ProgramRef; readonly diagnostics: Diagnostic[] };

/** Start `main` from `files` as a file program and run one tick. */
function runMain(files: Record<string, string>, main = "main.prg"): MainRun {
  const loader = loaderOf(files);
  const ref = fileProgramRef(loader, main);
  const run = setup(loader, ref);
  return { ...run, loader, ref, diagnostics: tick(run) };
}

test("a literal include hoists its functions, runs no top-level code and counts one folded path once", () => {
  const run = runMain({
    "main.prg": ["r = twice(4)", '#include "Lib\\Queue.prg"', '#include "lib/QUEUE.PRG"'].join("\n"),
    "Lib/Queue.prg": "function twice(n) { return n * 2 }\nloose = 99\n",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 8);
  equal(run.state.vm.globals.loose, undefined);

  const program = run.services.programs.get(run.ref);
  deepEqual(Object.keys(program.files).sort(), ["prg/lib/queue.prg", "prg/main.prg"]);
});

test("an include inside a never-run branch is still applied when the file's parse ends", () => {
  const run = runMain({
    "main.prg": 'if (0) {\n#include "lib.prg"\n}\nr = f()\n',
    "lib.prg": "function f() { return 3 }\n",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 3);
});

test("end in an included function unwinds the including program", () => {
  const run = runMain({
    "main.prg": '#include "lib.prg"\nstopHere()\nafter = 1\n',
    "lib.prg": "function stopHere() { end() }\n",
  });
  equal(run.diagnostics.length, 0);
  equal(run.state.vm.threads[0]?.status, "finished");
  equal(run.state.vm.globals.after, undefined);
});

test("an include cycle ends with a located diagnostic instead of recursing", () => {
  const run = runMain({
    "main.prg": '#include "a.prg"\nr = fa()\n',
    "a.prg": '#include "b.prg"\nfunction fa() { return 1 }\n',
    "b.prg": '#include "a.prg"\nfunction fb() { return 2 }\n',
  });
  equal(run.diagnostics.length, 1);
  const [cycle] = run.diagnostics;
  equal(cycle!.code, "include.cycle");
  equal(cycle!.file, "prg/b.prg");
  equal(cycle!.line, 1);
  equal(run.state.vm.globals.r, 1);
  equal(run.records.filter((record) => record.code === "include.cycle").length, 1);
});

test("a missing included file is ignored at load time and an empty one is not an error", () => {
  const run = runMain({
    "main.prg": '#include "gone.prg"\n#include "empty.prg"\nr = 1\n',
    "empty.prg": "",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 1);
});

test("a file-qualified call queues its file, reaches that file's own definition and shows later calls its functions", () => {
  const run = runMain({
    "main.prg": '#include "other.prg"\nr1 = queue.poplit()\nr2 = poplit()\nr3 = onlyq()\n',
    "queue.prg": "function poplit() { return 1 }\nfunction onlyq() { return 5 }\n",
    "other.prg": "function poplit() { return 2 }\n",
  });
  deepEqual(run.diagnostics, []);
  // The implicit include of queue is applied after `other`, so the plain name is queue's too (R-41).
  equal(run.state.vm.globals.r1, 1);
  equal(run.state.vm.globals.r2, 1);
  equal(run.state.vm.globals.r3, 5);
});

test("two files defining the same name and arity: the last added wins and warns with a location", () => {
  const run = runMain({
    "main.prg": '#include "one.prg"\n#include "two.prg"\nr = popit()\ns = one.popit()\n',
    "one.prg": "function popit() { return 1 }\n",
    "two.prg": "function popit() {\n  return 2\n}\n",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 2);
  equal(run.state.vm.globals.s, 1);
  const warn = run.records.find((record) => record.code === "command.overridden");
  equal(Boolean(warn), true);
  equal(warn!.level, "warn");
  deepEqual(warn!.data, {
    file: "prg/two.prg",
    line: 1,
    notice: { name: "popit", kind: "script", previous: "prg/one.prg", replacement: "prg/two.prg", argc: 0 },
  });
});

test("a wrong parameter count in the file falls through to the ordinary order", () => {
  const run = runMain({
    "main.prg": "r = lib.f(1, 2)\n",
    "lib.prg": "function f(a) { return a }\n",
  });
  equal(run.diagnostics.length, 1);
  equal(run.diagnostics[0]!.code, "unknown.command");
});

test("a built-in binds ahead of a script function of the same name, and the definition is reported as shadowing", () => {
  const loader = loaderOf({ "main.prg": "function mid(a, b, c) { return 0 }\nx = 1\n" });
  const ref = fileProgramRef(loader, "main.prg");
  const run = setup(loader, ref);
  const program = run.services.programs.get(ref);
  equal(resolveCall("mid", 3, program, run.services.commands)?.kind, "command");
  const shadow = run.records.find((record) => record.code === "command.shadowed");
  equal(Boolean(shadow), true);
  deepEqual(shadow!.data, {
    file: "prg/main.prg",
    line: 1,
    notice: { name: "mid", file: "prg/main.prg" },
  });
  equal(shadow!.message.includes("mid"), true);
});

test("a file-qualified call to a file that cannot load is a catchable runtime error", () => {
  const run = runMain({ "main.prg": "queue.nothing()\n" });
  equal(run.diagnostics.length, 1);
  equal(run.diagnostics[0]!.code, "include.missing");
  equal(failureClass("include.missing"), "call");
});

test("redirect substitutes one hop at parse time and a restored snapshot keeps the table", () => {
  const source = [
    "function b() { return 1 }",
    "function c() { return 2 }",
    'redirect("A", "b")',
    'redirect("B", "c")',
    "r = a()",
  ].join("\n");
  const loader = loaderOf({});
  const run = setup(loader, { kind: "inline", text: source, compiler: "2" });
  deepEqual(tick(run), []);
  // a -> b only: no chaining through b -> c.
  equal(run.state.vm.globals.r, 1);
  const table = [
    ["a", "b"],
    ["b", "c"],
  ];
  deepEqual(run.state.vm.redirects, table);

  const restored = restoreGameState(snapshot(run.state));
  equal(hashState(restored), hashState(run.state));
  deepEqual(restored.vm.redirects, table);

  // A program started later is compiled under the table in force and records it in its ref.
  for (const state of [run.state, restored]) {
    const next = setup(loader, { kind: "inline", text: "function b() { return 7 }\ns = a()\n", compiler: "2" }, state);
    deepEqual(state.vm.threads[1]!.frames[0]!.program.redirects, table);
    deepEqual(tick(next), []);
    equal(state.vm.globals.s, 7);
  }
  equal(hashState(restored), hashState(run.state));
});

test("killRedirect and killAllRedirects end a redirect for programs parsed after them", () => {
  const loader = loaderOf({});
  const state = createGameState({ seed: 2 });
  const first = setup(
    loader,
    { kind: "inline", text: 'redirect("a", "b")\nredirect("c", "d")\nkillredirect("A")\n', compiler: "2" },
    state,
  );
  deepEqual(tick(first), []);
  deepEqual(state.vm.redirects, [["c", "d"]]);

  startProgram(state.vm, { kind: "inline", text: "killallredirects()\n", compiler: "2" });
  deepEqual(tick(first), []);
  deepEqual(state.vm.redirects, []);

  // With the table empty again `a()` is no longer substituted.
  startProgram(state.vm, { kind: "inline", text: "function b() { return 1 }\nr = a()\n", compiler: "2" });
  equal(tick(first)[0]?.code, "unknown.command");
});

test("a redirect target of the form file.func also queues the file", () => {
  const run = runMain({
    "main.prg": 'redirect("old", "queue.addlit")\nr = old(5)\n',
    "queue.prg": "function addlit(n) { return n + 100 }\n",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 105);
});

test("include() at run time adds the file to the program's saved include list", () => {
  const loader = loaderOf({
    "main.prg": 'include("Lib.prg")\ninclude("lib.PRG")\nr = libfn()\nsleep(100)\n',
    "lib.prg": "function libfn() { return 11 }\n",
  });
  const run = setup(loader, fileProgramRef(loader, "main.prg"));
  deepEqual(tick(run), []);
  equal(run.state.vm.globals.r, 11);
  deepEqual(run.state.vm.threads[0]!.frames[0]!.program.includes, ["lib.prg"]);

  const restored = restoreGameState(snapshot(run.state));
  equal(hashState(restored), hashState(run.state));
  deepEqual(restored.vm.threads[0]!.frames[0]!.program.includes, ["lib.prg"]);
});

test("include() of a missing file at run time raises a catchable error", () => {
  const loader = loaderOf({ "main.prg": 'include("nope.prg")\n' });
  const run = setup(loader, fileProgramRef(loader, "main.prg"));
  equal(tick(run)[0]?.code, "include.missing");
});

test("the cache compiles a source hash once and recompiles when includes or redirects differ", () => {
  const loader = loaderOf({ "main.prg": "x = 1\n", "lib.prg": "function f() { return 1 }\n" });
  const cache = createProgramCache({ loader });
  const ref = fileProgramRef(loader, "main.prg");
  const first = cache.get(ref);
  equal(cache.get({ ...ref }), first);
  equal(cache.compiles, 1);
  const readsAfterFirst = loader.reads.length;
  cache.get(ref);
  equal(loader.reads.length, readsAfterFirst);

  const withInclude = cache.get({ ...ref, includes: ["lib.prg"] });
  equal(cache.compiles, 2);
  equal(Object.hasOwn(withInclude.functions, "f"), true);
  cache.get({ ...ref, redirects: [["a", "b"]] });
  equal(cache.compiles, 3);
  equal(cache.get({ ...ref, redirects: [["a", "b"]] }).ref.redirects?.[0]?.[1], "b");
  equal(cache.compiles, 3);
});

test("a reference is answered from memory, and equal content still shares one compile", () => {
  const cache = createProgramCache({});
  const text = "x = 1\ny = 2\n";
  const ref: ProgramRef = { kind: "inline", text, compiler: COMPILER_VERSION, dialect: "tk3" };
  const first = cache.get(ref);
  equal(cache.get(ref), first, "the same reference is answered from the cache");
  equal(cache.compiles, 1, "a repeated request compiles nothing");
  // The key is the content, not the object: a distinct reference with the same content is the same program.
  const copy: ProgramRef = { kind: "inline", text, compiler: COMPILER_VERSION, dialect: "tk3" };
  equal(cache.get(copy), first, "an equal-content reference reuses the compile");
  equal(cache.compiles, 1);
  // A changed program arrives as a new reference and is compiled on its own key.
  const changed = cache.get({ ...ref, text: "x = 2\n" });
  equal(cache.compiles, 2, "changed content is a new program");
  equal(changed === first, false);
});

test("the cache never writes to a reference: a frozen ref caches normally and a change arrives as a new object", () => {
  const loader = loaderOf({ "main.prg": "x = 1\n", "lib.prg": "function f() { return 1 }\n" });
  const cache = createProgramCache({ loader });
  const includes = ["lib.prg"];
  Object.freeze(includes);
  const ref: ProgramRef = Object.freeze({ ...fileProgramRef(loader, "main.prg"), includes });
  const first = cache.get(ref);
  equal(cache.get(ref), first, "the frozen reference is served from its own entry");
  equal(cache.compiles, 1);
  // Invalidation is a new reference: the memo never answers for content it was not asked about.
  const without = cache.get({ ...ref, includes: [] });
  equal(cache.compiles, 2, "dropping the include compiles the plain program again");
  equal(Object.hasOwn(without.functions, "f"), false);
});

test("a compiled program is refused with the re-save message and no binary parser runs", () => {
  const loader = loaderOf({ "bin.prg": new Uint8Array([0, 1, 2, 3]), "main.prg": '#include "bin.prg"\n' });
  throws(
    () => fileProgramRef(loader, "bin.prg"),
    (caught: unknown) =>
      caught instanceof ScriptError &&
      caught.code === "program.compiled" &&
      caught.message.includes("re-save the source"),
  );
  equal(failureClass("program.compiled"), null);

  // An included compiled file is refused the same way when its includer compiles.
  const ref = fileProgramRef(loader, "main.prg");
  throws(
    () => compileProgram(ref, { loader }),
    (caught: unknown) => caught instanceof ScriptError && caught.code === "program.compiled",
  );
});

test("a file program without a loader, or naming a missing file, is refused", () => {
  const ref: ProgramRef = { kind: "file", path: "x.prg", sourceHash: "0", compiler: "2" };
  throws(
    () => compileProgram(ref),
    (caught: unknown) => caught instanceof ScriptError && caught.code === "program.file-unsupported",
  );
  throws(
    () => compileProgram(ref, { loader: loaderOf({}) }),
    (caught: unknown) => caught instanceof ScriptError && caught.code === "program.missing",
  );
});

test("system.func is the engine namespace, not a file, and a file may call itself qualified", () => {
  const run = runMain({
    "main.prg": 'x = system.mid("abc", 1, 1)\nr = main.helper()\nfunction helper() { return 4 }\n',
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 4);
  equal(run.records.filter((record) => record.code === "include.cycle").length, 0);
});

test("two files calling each other qualified is not an include cycle", () => {
  const run = runMain({
    "main.prg": "r = a.fa()\n",
    "a.prg": "function fa() { return b.fb() }\n",
    "b.prg": "function fb() { return 5 }\nfunction g() { return a.fa() }\n",
  });
  equal(run.state.vm.globals.r, 5);
  equal(run.records.filter((record) => record.code === "include.cycle").length, 0);
  equal(run.diagnostics.filter((item) => item.code === "include.cycle").length, 0);
});

test("the main file's own definition wins over an included one and warns", () => {
  const run = runMain({
    "main.prg": '#include "lib.prg"\nr = f()\nfunction f() { return 1 }\n',
    "lib.prg": "function f() { return 2 }\n",
  });
  deepEqual(run.diagnostics, []);
  equal(run.state.vm.globals.r, 1);
  const warn = run.records.find((record) => record.code === "command.overridden");
  equal(Boolean(warn), true);
  deepEqual(warn!.data, {
    file: "prg/main.prg",
    line: 3,
    notice: { name: "f", kind: "script", previous: "prg/lib.prg", replacement: "prg/main.prg", argc: 0 },
  });
});

test("a duplicate class name across files is last-added-wins with a located warning", () => {
  const run = runMain({
    "main.prg": '#include "one.prg"\n#include "two.prg"\nx = 1\n',
    "one.prg": "class K { method K() { } }\n",
    "two.prg": "\nclass K { method K() { } }\n",
  });
  const warn = run.records.find(
    (record) => record.code === "command.overridden" && JSON.stringify(record.data).includes('"kind":"class"'),
  );
  equal(Boolean(warn), true);
  deepEqual(warn!.data, {
    file: "prg/two.prg",
    line: 2,
    notice: { name: "k", kind: "class", previous: "prg/one.prg", replacement: "prg/two.prg" },
  });
});

test("a changed source file is not resumed from stale offsets", () => {
  const ref = fileProgramRef(loaderOf({ "main.prg": "x = 1\n" }), "main.prg");
  const changed = loaderOf({ "main.prg": "x = 2\ny = 3\n" });
  throws(
    () => compileProgram(ref, { loader: changed }),
    (caught: unknown) => caught instanceof ScriptError && caught.code === "restore.source-changed",
  );
});

test("a refused run-time include is catchable and leaves refs and state untouched", () => {
  const loader = loaderOf({
    "main.prg": 'include("bin.prg")\nsleep(100)\n',
    "bin.prg": new Uint8Array([0, 9]),
  });
  const run = setup(loader, fileProgramRef(loader, "main.prg"));
  equal(tick(run)[0]?.code, "include.refused");
  equal(failureClass("include.refused"), "call");
  // A refused file must not have been written into any saved ref.
  equal(snapshot(run.state).includes('"includes"'), false);
});

test("a plugin command is reached after script functions, so it is not a built-in shadow", () => {
  const state = createGameState({ seed: 1 });
  const plugin: PluginDefinition = {
    id: "game.pack",
    version: "1.0.0",
    commands: [{ name: "gamecmd", aliases: [], params: [], call: () => ({ value: 1 }) }],
  };
  const { sink, records } = createCollectingSink();
  const services = createScriptServices(state, [plugin], createLogger([sink]));
  startProgram(state.vm, {
    kind: "inline",
    text: "function gamecmd() { return 9 }\nr = gamecmd()\n",
    compiler: "2",
  });
  advanceScriptTick(state, services);
  deepEqual(drainDiagnostics(services), []);
  equal(state.vm.globals.r, 9);
  equal(records.filter((record) => record.code === "command.shadowed").length, 0);
});
