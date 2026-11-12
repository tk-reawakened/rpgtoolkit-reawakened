/**
 * The debug projection and the expression reader (TOOL-8, P1 and P2;
 * docs/spec/engine/rpgcode-tooling.md#tool-8).
 *
 * `debugView()` copies the VM out and reports each frame's own locals; a call
 * leaves the state hash where it was. `evaluate()` reads one expression against
 * a copy, refuses a statement, a write and a call outside the closed pure list,
 * and reports the instruction cap as `evaluate.budget`.
 */

import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import {
  commandDocumentation,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  ENGINE_PLUGIN_TABLE,
  EVALUATE_COMMANDS,
  PACKAGE_ROOT,
  writeBoard,
  type DebugView,
  type Engine,
} from "../src/index.ts";

// Lines: 1 total, 2 spare, 3-7 twice, 8-13 compute, 14 counter, 15 end().
const PROGRAM = [
  "total = 1",
  'spare = thread("sleeploop = 1", 1)',
  "function twice(n) {",
  "    local(doubled)",
  "    doubled = n * 2",
  "    return doubled",
  "}",
  "function compute() {",
  "    local(seed)",
  "    seed = total + 2",
  "    result = twice(seed)",
  "    return seed * 10",
  "}",
  "counter = compute()",
  "end()",
].join("\n");

/** A SceneInit engine over an empty board and the fixture program (the seam 10.10 launches). */
function fixtureEngine(): Engine {
  const board = writeBoard(createEmptyBoard());
  if (!board.ok) throw new Error(board.error.message);
  const engine = createEngine({
    seed: 7,
    assetIndex: createAssetIndex(["Boards/test.brd"]),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "test.brd",
    width: 32,
    height: 32,
    maxTicks: 8,
    program: PROGRAM,
  });
  const first = engine.advance(0, []);
  const request = first.requests[0];
  if (request?.kind !== "asset") throw new Error("expected board asset request");
  engine.advance(0, [{ tick: 0, event: { kind: "asset", reqId: request.reqId, bytes: board.value } }]);
  return engine;
}

/** Stop on line 11, the call to `twice` inside `compute`. */
function pausedEngine(): Engine {
  const engine = fixtureEngine();
  engine.setBreakpoints([{ file: "<inline>", line: 11 }]);
  const stopped = engine.advance(2, []);
  equal(stopped.paused?.line, 11, "the fixture stops on the call");
  return engine;
}

function localOf(values: readonly { readonly name: string; readonly value: unknown }[], name: string): unknown {
  return values.find((variable) => variable.name === name)?.value;
}

function frameLines(view: DebugView): string {
  return view.threads.map((thread) => `${thread.id}:${thread.frames.map((frame) => `${frame.line}/${frame.function ?? "-"}`).join(",")}`).join(" | ");
}

test("debugView reports two threads with frames, per-frame locals and the globals", () => {
  const engine = pausedEngine();
  const view = engine.debugView();
  equal(view.tick, 0);
  deepEqual(view.threads.map((thread) => thread.id), [1, 2], "the blocking thread and the started thread");
  equal(view.threads[0]?.kind, "blocking");
  equal(view.threads[1]?.kind, "persistent");
  equal(view.threads[1]?.status, "ready", "a background thread takes no turn while a blocking thread is live");
  equal(view.threads[1]?.frames.length, 1);
  deepEqual(view.threads[1]?.frames[0]?.program, { key: "<inline>", text: "sleeploop = 1" });

  equal(frameLines(view), "1:14/-,11/compute | 2:1/-");
  const frames = view.threads[0]!.frames;
  deepEqual(frames[1]?.locals, [{ name: "seed", value: 3 }]);
  deepEqual(frames[0]?.locals, [], "top-level statements write globals");
  deepEqual(view.locals, frames[1]!.locals, "the view's locals is the innermost frame's own list");
  equal(localOf(view.globals, "total"), 1);
  equal(localOf(view.globals, "spare"), 2);
});

test("debugView is a copy: mutating it changes nothing and leaves the state hash alone", () => {
  const debugged = pausedEngine();
  const plain = pausedEngine();
  const view = debugged.debugView();
  (view.threads[0]!.frames[1]!.locals as { name: string; value: unknown }[]).push({ name: "injected", value: 99 });
  (view.globals as { name: string; value: unknown }[]).splice(0, 1);
  (view.threads as unknown[]).push({ id: 99 });
  const again = debugged.debugView();
  equal(again.threads.length, 2, "the injected thread never reached the VM");
  equal(localOf(again.globals, "total"), 1, "the removed global is still there");
  deepEqual(again.threads[0]!.frames[1]!.locals, [{ name: "seed", value: 3 }]);
  equal(debugged.advance(0, [], undefined, "step").stateHash, plain.advance(0, [], undefined, "step").stateHash);
});

test("evaluate reads a local of a frame that is not the innermost, and a global", () => {
  const engine = pausedEngine();
  equal(engine.evaluate("seed + 1", 1).value, 4, "the innermost frame of compute() is the default depth");
  equal(engine.evaluate("seed * 2", 1, 1).value, 6, "frameDepth 1 is compute()'s own frame");
  equal(engine.evaluate("total * 10", 1).value, 10);
  equal(engine.evaluate('"a" + "b"', 1).value, "ab");
});

test("evaluate may call only the closed list of pure built-ins", () => {
  const engine = pausedEngine();
  equal(engine.evaluate('len("abc")', 1).value, 3);
  equal(engine.evaluate("castint(2.7)", 1).value, 2);
  equal(engine.evaluate("sqrt(9) + 1", 1).value, 4);
  equal(engine.evaluate("local(seed)", 1).value, 3, "a declaration reference reads the local it names");
  const calls = ["random(6)", 'mwin("x")', "thread(1, 0)", "wait()", "save(0)", "gettickcount()", 'bindingof("len")'];
  for (const expression of calls) {
    const result = engine.evaluate(expression, 1);
    equal(result.value, null, expression);
    equal(result.error?.code, "evaluate.call", expression);
  }
});

test("evaluate refuses a statement, a write, a lambda, a dictionary and an unknown thread or frame", () => {
  const engine = pausedEngine();
  const refusals: [string, string][] = [
    ["counter = 1", "evaluate.assignment"],
    ["seed += 1", "evaluate.assignment"],
    ["seed++", "evaluate.assignment"],
    ["1 + ", "evaluate.syntax"],
    ["(x) => x", "evaluate.form"],
    ["{ a: 1 }", "evaluate.form"],
    ["if (1) { seed }", "evaluate.syntax"],
  ];
  for (const [expression, code] of refusals) {
    const result = engine.evaluate(expression, 1);
    equal(result.value, null, expression);
    equal(result.error?.code, code, expression);
  }
  equal(engine.evaluate("seed", 99).error?.code, "evaluate.thread");
  equal(engine.evaluate("seed", 1, 5).error?.code, "evaluate.frame");
});

test("evaluate reports the instruction cap as evaluate.budget", () => {
  const engine = pausedEngine();
  const long = Array.from({ length: 600 }, () => "1").join(" + ");
  const result = engine.evaluate(long, 1);
  equal(result.value, null);
  equal(result.error?.code, "evaluate.budget");
  ok(result.error!.message.includes("1000"), result.error!.message);
});

test("every command the watch may call is a registered catalogue name", () => {
  const plugins = Object.values(ENGINE_PLUGIN_TABLE).map((definition) => ({ definition }));
  const names = new Set(commandDocumentation(plugins).map((entry) => entry.name));
  for (const name of EVALUATE_COMMANDS) ok(names.has(name), `"${name}" is not a registered command`);
  ok(EVALUATE_COMMANDS.length > 0);
});

test("evaluate never changes the state hash, and a run to the end matches an uninterrupted one", () => {
  const debugged = pausedEngine();
  const plain = pausedEngine();
  equal(debugged.evaluate("seed + 1", 1).value, 4);
  equal(debugged.advance(0, [], undefined, "step").stateHash, plain.advance(0, [], undefined, "step").stateHash);

  // A continue stops at each pause it meets, so the driver calls it again until the game settles.
  let report = debugged.advance(6, []);
  for (let guard = 0; guard < 40 && report.paused !== null; guard += 1) report = debugged.advance(6, []);
  const settled = debugged.advance(0, []);
  const uninterrupted = fixtureEngine().advance(settled.tickAfter, []);
  equal(settled.stateHash, uninterrupted.stateHash, "the debug run ends on the uninterrupted hash");
  equal(localOf(debugged.debugView().globals, "counter"), 30);
  equal(localOf(debugged.debugView().globals, "sleeploop"), 1, "the started thread ran to its end");
});
