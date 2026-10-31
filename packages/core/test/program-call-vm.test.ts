import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  addActor,
  advanceScriptTick,
  assetKey,
  createAssetIndex,
  createGameState,
  drainDiagnostics,
  hashState,
  PACKAGE_ROOT,
  restoreGameState,
  snapshot,
  startProgram,
  startThread,
  stepThread,
  verifyRestoredHandles,
  type Diagnostic,
  type GameState,
  type ProgramLoader,
  type ScriptServices,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

const AUTHORED = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "authored");
const PROGRAM_NAMES = [
  "program-call-budget.prg",
  "program-call-context.prg",
  "program-call-deep.prg",
  "program-call-done.prg",
  "program-call-end.prg",
  "program-call-error.prg",
  "program-call-handles.prg",
  "program-call-local.prg",
  "program-call-next.prg",
  "program-call-replace-inside.prg",
  "program-call-replacement.prg",
  "program-call-result.prg",
  "program-call-run.prg",
  "program-call-self.prg",
  "program-call-stop.prg",
  "program-call-wait.prg",
] as const;

function loaderOf(): ProgramLoader {
  const files = new Map<string, Uint8Array>();
  for (const name of PROGRAM_NAMES) files.set(assetKey(`Prg/${name}`), new TextEncoder().encode(readFileSync(join(AUTHORED, name), "utf8")));
  return {
    index: createAssetIndex(PROGRAM_NAMES.map((name) => `Prg/${name}`)),
    root: PACKAGE_ROOT,
    read: (key) => files.get(key),
  };
}

function makeRig(
  source: string,
  loader: ProgramLoader,
  pair: { readonly source: string | null; readonly target: string | null } = { source: null, target: null },
) {
  const state = createGameState({ seed: 0 });
  startProgram(state.vm, { kind: "inline", text: source, ir: "1" });
  const thread = state.vm.threads[0]!;
  thread.source = pair.source;
  thread.target = pair.target;
  const services = createScriptServices(state, [], undefined, undefined, loader);
  return { state, thread, services };
}

function liveHandles(state: GameState, count: number): string[] {
  const handles: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const actor = addActor(state.actors, {
      kind: index === 0 ? "party" : "enemy",
      source: `Entity${index + 1}.tem`,
      name: `Entity${index + 1}`,
    });
    handles.push(String(actor.id));
  }
  return handles;
}

function runToFinish(state: GameState, services: ScriptServices, limit = 40) {
  const diagnostics: Diagnostic[] = [];
  for (let tick = 0; state.vm.threads[0]?.status !== "finished" && tick < limit; tick += 1) {
    advanceScriptTick(state, services);
    diagnostics.push(...drainDiagnostics(services));
  }
  equal(state.vm.threads[0]?.status, "finished", "the calling thread should complete within the test limit");
  diagnostics.push(...drainDiagnostics(services));
  return diagnostics;
}

test("executeProgram returns zero, resumes its caller, shares globals, and gives each call fresh locals", () => {
  const loader = loaderOf();
  const { state, services } = makeRig(
    'program_result = executeProgram("program-call-result.prg")\n' +
    'first = executeProgram("program-call-local.prg")\n' +
    'second = executeProgram("program-call-local.prg")\n' +
    'self_result = executeProgram("program-call-self.prg", { depth: 0 })\n' +
    "caller_resumed = 1\n",
    loader,
  );

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.program_result, 0);
  equal(state.vm.globals.first, 0);
  equal(state.vm.globals.second, 0);
  equal(state.vm.globals.shared_calls, 2);
  equal(state.vm.globals.local_seen, 1);
  equal(state.vm.globals.self_result, 0);
  equal(state.vm.globals.self_calls, 3);
  equal(state.vm.globals.self_seen, 1);
  equal(state.vm.globals.caller_resumed, 1);
});

test("executeProgram binds context in the root and its functions, without binding this", () => {
  const loader = loaderOf();
  const { state, services } = makeRig(
    'result = executeProgram("program-call-context.prg", { value: 73 })\n',
    loader,
  );

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.result, 0);
  equal(state.vm.globals.context_root, 73);
  equal(state.vm.globals.context_function, 73);
  equal(state.vm.globals.context_is_this, 0);
});

test("source and target context handles resolve from the old pair, inherit when omitted, and restore", () => {
  const loader = loaderOf();
  const state = createGameState({ seed: 0 });
  const [hero, foe, third] = liveHandles(state, 3);
  startProgram(state.vm, {
    kind: "inline",
    text:
      'executeProgram("program-call-handles.prg", { source: "target", target: "source" })\n' +
      "special_source = observed_source\nspecial_target = observed_target\n" +
      "special_context_source = observed_context_source\nspecial_context_target = observed_context_target\n" +
      'executeProgram("program-call-handles.prg", { source: "' + third + '" })\n' +
      "inherited_source = observed_source\ninherited_target = observed_target\n" +
      'executeProgram("program-call-handles.prg", { source: null, target: 0 })\n' +
      "unset_source = observed_source\nunset_target = observed_target\n" +
      'executeProgram("program-call-handles.prg", "target", "source")\n' +
      "positional_source = observed_source\npositional_target = observed_target\n" +
      "restored_source = sourceHandle()\nrestored_target = targetHandle()\n",
    ir: "1",
  });
  const thread = state.vm.threads[0]!;
  thread.source = hero!;
  thread.target = foe!;
  const liveServices = createScriptServices(state, [], undefined, undefined, loader);
  deepEqual(runToFinish(state, liveServices), []);
  equal(state.vm.globals.special_source, foe);
  equal(state.vm.globals.special_target, hero);
  equal(state.vm.globals.special_context_source, "target");
  equal(state.vm.globals.special_context_target, "source");
  equal(state.vm.globals.inherited_source, third);
  equal(state.vm.globals.inherited_target, foe);
  equal(state.vm.globals.unset_source, 0);
  equal(state.vm.globals.unset_target, 0);
  equal(state.vm.globals.positional_source, foe);
  equal(state.vm.globals.positional_target, hero);
  equal(state.vm.globals.restored_source, hero);
  equal(state.vm.globals.restored_target, foe);
  equal(thread.source, hero);
  equal(thread.target, foe);
});

test("bad contexts and wrong counts are catchable and do not start or replace a program", () => {
  const loader = loaderOf();
  const { state, thread, services } = makeRig(
    'executeProgram("program-call-result.prg", 17)\n' +
    'executeProgram("program-call-result.prg", { source: "not-live" })\n' +
    'replaceProgram("program-call-next.prg", 17)\n' +
    'executeProgram("program-call-result.prg", {}, 0, 0)\n' +
    'replaceProgram("program-call-next.prg", {}, 0)\n' +
    'run("program-call-run.prg", {}, 0)\n' +
    "after_bad_arguments = 1\n",
    loader,
  );
  const handles = liveHandles(state, 2);
  thread.source = handles[0]!;
  thread.target = handles[1]!;

  const diagnostics = runToFinish(state, services);
  deepEqual(diagnostics.map((diagnostic) => diagnostic.code), [
    "builtin.bad-arg",
    "builtin.bad-arg",
    "builtin.bad-arg",
    "arity.mismatch",
    "arity.mismatch",
    "arity.mismatch",
  ]);
  equal(state.vm.globals.after_bad_arguments, 1);
  equal(state.vm.globals.replacement_started, undefined);
  equal(thread.source, handles[0]);
  equal(thread.target, handles[1]);
});

test("blank names are silent no-ops and missing names are located catchable errors", () => {
  const loader = loaderOf();
  const { state, thread, services } = makeRig(
    'blank_result = executeProgram("")\n' +
    'replaceProgram("")\n' +
    'run("")\n' +
    'missing_result = executeProgram("does-not-exist.prg")\n' +
    'replaceProgram("also-missing.prg")\n' +
    'run("missing-alias.prg")\n' +
    "after_missing = 1\n",
    loader,
  );
  const handles = liveHandles(state, 2);
  thread.source = handles[0]!;
  thread.target = handles[1]!;

  const diagnostics = runToFinish(state, services);
  deepEqual(diagnostics.map((diagnostic) => diagnostic.code), [
    "program.missing",
    "program.missing",
    "program.missing",
  ]);
  ok(diagnostics.every((diagnostic) => diagnostic.file !== "" && diagnostic.line > 0));
  equal(state.vm.globals.blank_result, 0);
  equal(state.vm.globals.after_missing, 1);
  equal(thread.source, handles[0]);
  equal(thread.target, handles[1]);
});

test("called-program failures use only the callee error path and the caller resumes", () => {
  const loader = loaderOf();
  const { state, services } = makeRig(
    'function caller() {\n' +
    "  setErrorHandler(:caller_error)\n" +
    '  executeProgram("program-call-error.prg")\n' +
    "  caller_resumed = 1\n" +
    "  return 0\n" +
    "  :caller_error\n" +
    "  caller_caught = 1\n" +
    "  resumeNext()\n" +
    "}\n" +
    "caller()\n",
    loader,
  );

  const diagnostics = runToFinish(state, services);
  equal(diagnostics.length, 1);
  equal(diagnostics[0]!.code, "unknown.command");
  ok(diagnostics[0]!.file.toLowerCase().includes("program-call-error.prg"));
  equal(diagnostics[0]!.line, 3);
  equal(state.vm.globals.callee_caught, 1);
  equal(state.vm.globals.callee_continued, 1);
  equal(state.vm.globals.caller_resumed, 1);
  equal(state.vm.globals.caller_caught, undefined);
});

test("end, done, and stop end only the nested program and restore its pair", () => {
  const loader = loaderOf();
  for (const command of ["end", "done", "stop"] as const) {
    const state = createGameState({ seed: 0 });
    const [hero, foe] = liveHandles(state, 2);
    startProgram(state.vm, {
      kind: "inline",
      text: `result = executeProgram("program-call-${command}.prg")\nafter = 1\n`,
      ir: "1",
    });
    const thread = state.vm.threads[0]!;
    thread.source = hero!;
    thread.target = foe!;
    const services = createScriptServices(state, [], undefined, undefined, loader);
    deepEqual(runToFinish(state, services), []);
    equal(state.vm.globals.result, 0);
    equal(state.vm.globals.after, 1);
    equal(state.vm.globals.child_resumed, undefined);
    equal(thread.source, hero);
    equal(thread.target, foe);
  }
});

test("replaceProgram inside executeProgram discards pending returns and leaves the replacement pair installed", () => {
  const loader = loaderOf();
  const state = createGameState({ seed: 0 });
  const handles = liveHandles(state, 5);
  startProgram(state.vm, {
    kind: "inline",
    text:
      'executeProgram("program-call-replace-inside.prg", { source: "' + handles[2] + '", new_source: "' + handles[3] + '", new_target: "' + handles[4] + '", marker: "replacement" })\n' +
      "outer_resumed = 1\n",
    ir: "1",
  });
  const thread = state.vm.threads[0]!;
  thread.source = handles[0]!;
  thread.target = handles[1]!;
  const services = createScriptServices(state, [], undefined, undefined, loader);

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.replacement_started, 1);
  equal(state.vm.globals.replacement_context, "replacement");
  equal(state.vm.globals.outer_resumed, undefined);
  equal(state.vm.globals.replace_caller_resumed, undefined);
  equal(thread.status, "finished");
  equal(thread.source, handles[3]);
  equal(thread.target, handles[4]);
});

test("replaceProgram installs its resolved pair and inherits omitted slots", () => {
  const loader = loaderOf();
  const state = createGameState({ seed: 0 });
  const handles = liveHandles(state, 3);
  startProgram(state.vm, {
    kind: "inline",
    text:
      'replaceProgram("program-call-replacement.prg", { target: "' + handles[2] + '", marker: "replacement" })\n' +
      "after_replace = 1\n",
    ir: "1",
  });
  const thread = state.vm.threads[0]!;
  thread.source = handles[0]!;
  thread.target = handles[1]!;
  const services = createScriptServices(state, [], undefined, undefined, loader);

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.replacement_context, "replacement");
  equal(state.vm.globals.replacement_source, handles[0]);
  equal(state.vm.globals.replacement_target, handles[2]);
  equal(state.vm.globals.after_replace, undefined);
  equal(thread.source, handles[0]);
  equal(thread.target, handles[2]);
});

test("run without context remains a non-returning replacement alias; run context is explicit", () => {
  const loader = loaderOf();
  const legacy = makeRig(
    'before_run = 1\nrun("program-call-next.prg")\nafter_run = 1\n',
    loader,
  );
  deepEqual(runToFinish(legacy.state, legacy.services), []);
  equal(legacy.state.vm.globals.before_run, 1);
  equal(legacy.state.vm.globals.after_run, undefined);
  equal(legacy.state.vm.globals.replacement_started, 1);
  equal(legacy.state.vm.globals.replacement_context, 0);

  const contextual = makeRig('run("program-call-run.prg", { value: 31 })\nafter_run = 1\n', loader);
  deepEqual(runToFinish(contextual.state, contextual.services), []);
  equal(contextual.state.vm.globals.run_child, 2);
  equal(contextual.state.vm.globals.run_context, 31);
  equal(contextual.state.vm.globals.after_run, undefined);
});

test("a wait in the nested program parks its caller thread while another thread runs", () => {
  const loader = loaderOf();
  const { state, thread, services } = makeRig(
    'result = executeProgram("program-call-wait.prg")\nafter_wait = 1\n',
    loader,
  );
  const other = startThread(state.vm, {
    ref: { kind: "inline", text: "other_ran = other_ran + 1\n", ir: "1" },
    kind: "persistent",
    owner: "script",
  });

  advanceScriptTick(state, services);
  equal(thread.status, "waiting");
  equal(thread.wait?.kind, "sleep");
  equal(thread.frames.length, 2);
  ok(thread.frames[1]?.programRoot?.restore !== null);
  equal(other.status, "finished");
  equal(state.vm.globals.other_ran, 1);
  equal(state.vm.globals.after_wait, undefined);
  equal(state.vm.threads.length, 2, "executeProgram does not create a third thread");

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.result, 0);
  equal(state.vm.globals.wait_finished, 1);
  equal(state.vm.globals.after_wait, 1);
});

test("nested instructions are preempted at every VM step and share the calling thread budget", () => {
  const loader = loaderOf();
  const { state, thread, services } = makeRig(
    'executeProgram("program-call-budget.prg")\nafter_budget = 1\n',
    loader,
  );
  let nestedSteps = 0;
  let totalSteps = 0;
  for (let attempt = 0; thread.status !== "finished" && attempt < 100; attempt += 1) {
    const nested = thread.frames.some((frame) => frame.programRoot?.restore !== undefined && frame.programRoot.restore !== null);
    const used = stepThread(thread, state.vm, services, 1);
    equal(used, 1, "one budget unit advances exactly one VM instruction");
    totalSteps += used;
    if (nested) nestedSteps += used;
  }
  equal(thread.status, "finished");
  ok(nestedSteps > 0, "callee instructions were charged to the same thread");
  ok(totalSteps > nestedSteps, "the call and caller instructions also consume the budget");
  equal(state.vm.globals.budget_a, 1);
  equal(state.vm.globals.budget_b, 2);
  equal(state.vm.globals.budget_c, 3);
  equal(state.vm.globals.after_budget, 1);
});

test("each instruction-boundary save inside executeProgram restores context and the pending pair", () => {
  const loader = loaderOf();
  const state = createGameState({ seed: 0 });
  const handles = liveHandles(state, 3);
  startProgram(state.vm, {
    kind: "inline",
    text:
      'nested_result = executeProgram("program-call-context.prg", { source: "' + handles[2] + '", value: 47 })\nafter_save = 1\n',
    ir: "1",
  });
  const thread = state.vm.threads[0]!;
  thread.source = handles[0]!;
  thread.target = handles[1]!;
  const freshServices = createScriptServices(state, [], undefined, undefined, loader);
  for (let attempt = 0; !thread.frames.some((frame) => frame.programRoot !== undefined && frame.programRoot.restore !== null); attempt += 1) {
    ok(attempt < 100, "the executeProgram frame should be reached");
    equal(stepThread(thread, state.vm, freshServices, 1), 1);
  }
  let insideBoundaries = 0;
  while (thread.status !== "finished" && thread.frames.some((frame) => frame.programRoot !== undefined && frame.programRoot.restore !== null)) {
    const nestedRoot = thread.frames.find((frame) => frame.programRoot !== undefined && frame.programRoot.restore !== null)!;
    deepEqual(nestedRoot.programRoot!.restore, { source: handles[0], target: handles[1] });
    const saved = snapshot(state);
    const restored = restoreGameState(saved);
    equal(snapshot(restored), saved);
    const restoredServices = createScriptServices(restored, [], undefined, undefined, loader);
    verifyRestoredHandles(restored.vm, restoredServices);
    equal(stepThread(thread, state.vm, freshServices, 1), 1);
    equal(stepThread(restored.vm.threads[0]!, restored.vm, restoredServices, 1), 1);
    equal(hashState(restored), hashState(state));
    insideBoundaries += 1;
  }
  ok(insideBoundaries > 0);
  deepEqual(runToFinish(state, freshServices), []);
  equal(state.vm.globals.context_root, 47);
  equal(state.vm.globals.context_function, 47);
  equal(state.vm.globals.after_save, 1);
  equal(thread.source, handles[0]);
  equal(thread.target, handles[1]);
});

test("finite self-nesting reaches deep frames without an engine depth cap", () => {
  const loader = loaderOf();
  const { state, services } = makeRig(
    'executeProgram("program-call-deep.prg", { depth: 0 })\nafter_deep = 1\n',
    loader,
  );

  deepEqual(runToFinish(state, services), []);
  equal(state.vm.globals.deep_count, 25);
  equal(state.vm.globals.deepest_level, 0);
  equal(state.vm.globals.after_deep, 1);
});
