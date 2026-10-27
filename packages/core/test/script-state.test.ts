// The save tree, canonical form and restore checks (AD-7, AD-10, AD-11, AD-23):
// the 20-section shape, a mid-yield round-trip and the two pinned restore errors.
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  canon,
  CANON_MAX_DEPTH,
  createAssetIndex,
  createGameState,
  advanceScriptTick,
  fileProgramRef,
  PACKAGE_ROOT,
  readStepCounters,
  restoreGameState,
  SCHEMA_VERSIONS,
  snapshot,
  startProgram,
  startThread,
  withOwner,
  type GameState,
  type ScriptError,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

function errorOf(run: () => unknown): { code: string; message: string } {
  try {
    run();
  } catch (error) {
    const scriptError = error as ScriptError;
    equal(typeof scriptError.code, "string");
    return { code: scriptError.code, message: scriptError.message };
  }
  throw new Error("expected the call to throw");
}

function midYieldState(): GameState {
  const state = createGameState({ seed: 3 });
  startProgram(state.vm, {
    kind: "inline",
    text: 'greeting = "hi"\ncount = 2\nsleep(count)\ncount = 3\nend()\n',
    compiler: "2",
  });
  advanceScriptTick(state, createScriptServices(state));
  return state;
}

test("GameState is PlainData and has exactly the AD-10 sections", () => {
  const state = createGameState({ seed: 0 });
  deepEqual(Object.keys(state).sort(), Object.keys(SCHEMA_VERSIONS).sort());
  equal(Object.keys(state).length, 20);
  equal(typeof canon(state), "string");
  deepEqual(state.schema.compiler, "2");
});

test("canon round-trips through restore for a mid-yield state", () => {
  const state = midYieldState();
  equal(state.vm.threads[0]!.status, "waiting");

  const json = snapshot(state);
  equal(canon(restoreGameState(json)), json);
});

test("restore rejects a different compiler version and a missing section", () => {
  const json = snapshot(createGameState({ seed: 0 }));

  const wrongCompiler = JSON.parse(json) as { schema: { compiler: string } };
  wrongCompiler.schema.compiler = "999";
  equal(
    errorOf(() => restoreGameState(JSON.stringify(wrongCompiler))).code,
    "restore.compiler-mismatch",
  );

  const missingSection = JSON.parse(json) as Record<string, unknown>;
  delete missingSection.vm;
  equal(errorOf(() => restoreGameState(JSON.stringify(missingSection))).code, "restore.shape");

  equal(errorOf(() => restoreGameState("{ not json")).code, "restore.shape");
});

test("restore rejects a compiler: 1 snapshot fixture before reading payload", () => {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "save",
    "compiler-1-snapshot.json",
  );
  const fixture = readFileSync(fixturePath, "utf8");
  equal(errorOf(() => restoreGameState(fixture)).code, "restore.compiler-mismatch");
});

test("a save whose frame program names another compiler is refused whole, not restarted", () => {
  // schema.compiler is current, so only the per-program check can catch this.
  const state = createGameState({ seed: 7 });
  startProgram(state.vm, { kind: "inline", text: "value = 42\nend()\n", compiler: "2" });
  const json = JSON.parse(snapshot(state)) as { vm: { threads: { frames: { program: { compiler: string } }[] }[] } };
  json.vm.threads[0]!.frames[0]!.program.compiler = "1";

  const error = errorOf(() => restoreGameState(JSON.stringify(json)));
  equal(error.code, "restore.compiler-mismatch");
  ok(error.message.includes("vm.threads[0].frames[0].program.compiler"), error.message);
  // The refusal is a whole-save decision: nothing was built to run.
  equal(state.vm.threads[0]!.frames[0]!.program.compiler, "2");
});

test("a file-backed owner program from another compiler is refused whole, not restarted", () => {
  const bytes = Uint8Array.from([...`value = 42\nend()\n`].map((char) => char.charCodeAt(0)));
  const loader = { index: createAssetIndex(["Prg/main.prg"]), root: PACKAGE_ROOT, read: () => bytes };
  const state = createGameState({ seed: 9 });
  startThread(state.vm, { ref: withOwner(fileProgramRef(loader, "main.prg"), "alpha"), kind: "blocking", owner: "script" });
  const json = JSON.parse(snapshot(state)) as { vm: { threads: { frames: { program: { compiler: string } }[] }[] } };
  json.vm.threads[0]!.frames[0]!.program.compiler = "1";

  equal(errorOf(() => restoreGameState(JSON.stringify(json))).code, "restore.compiler-mismatch");
});

test("a vm.defOwners entry from another compiler is refused whole", () => {
  const state = createGameState({ seed: 3 });
  state.vm.defOwners = { f: { kind: "inline", text: "function f() { return 1 }\n", compiler: "1" } };
  const error = errorOf(() => restoreGameState(JSON.stringify(JSON.parse(snapshot(state)))));
  equal(error.code, "restore.compiler-mismatch");
  ok(error.message.includes("vm.defOwners.f.compiler"), error.message);
});

test("restore rejects malformed nested VM state", () => {
  const malformed = JSON.parse(snapshot(midYieldState())) as { vm: { threads: Array<Record<string, unknown>> } };
  malformed.vm.threads[0]!.frames = "not-an-array";
  equal(errorOf(() => restoreGameState(JSON.stringify(malformed))).code, "restore.shape");
});

test("a changed owner file source restarts with package attribution", () => {
  const source = { bytes: Uint8Array.from([...`value = 2\nend()\n`].map((char) => char.charCodeAt(0))) };
  const loader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: () => source.bytes,
  };
  const state = createGameState({ seed: 9 });
  const ref = withOwner(fileProgramRef(loader, "main.prg"), "alpha");
  const thread = startThread(state.vm, { ref, kind: "blocking", owner: "script" });
  const services = createScriptServices(state, [], undefined, undefined, loader);

  source.bytes = Uint8Array.from([...`value = 7\nend()\n`].map((char) => char.charCodeAt(0)));
  advanceScriptTick(state, services);

  equal(state.vm.globals.value, 7);
  equal(thread.status, "finished");
  const counters = readStepCounters(state.vm);
  equal(Object.keys(counters).join(","), "alpha");
  equal(counters.alpha! > 0, true);
});
test("a changed unowned file source remains unowned", () => {
  const source = { bytes: Uint8Array.from([...`value = 2\nend()\n`].map((char) => char.charCodeAt(0))) };
  const loader = {
    index: createAssetIndex(["Prg/main.prg"]),
    root: PACKAGE_ROOT,
    read: () => source.bytes,
  };
  const state = createGameState({ seed: 9 });
  const thread = startThread(state.vm, { ref: fileProgramRef(loader, "main.prg"), kind: "blocking", owner: "script" });
  const services = createScriptServices(state, [], undefined, undefined, loader);

  source.bytes = Uint8Array.from([...`value = 7\nend()\n`].map((char) => char.charCodeAt(0)));
  advanceScriptTick(state, services);

  equal(state.vm.globals.value, 7);
  equal(thread.status, "finished");
  equal(Object.keys(readStepCounters(state.vm)).length, 0);
});

test("snapshot rejects script-created nesting at the deterministic bound", () => {
  const state = createGameState({ seed: 11 });
  let value: unknown = 0;
  for (let depth = 0; depth <= CANON_MAX_DEPTH; depth++) value = { value };
  (state.vm.globals as Record<string, unknown>).deep = value;

  throws(
    () => snapshot(state),
    (error: unknown) =>
      error instanceof TypeError &&
      error.message === `canon: maximum nesting depth ${CANON_MAX_DEPTH} exceeded`,
  );
});
