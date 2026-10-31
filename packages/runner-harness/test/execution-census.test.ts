// ADR 0010; docs/spec/engine/rpgcode-errors-and-threads.md#threads.
import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { CATALOGUE_STUBS_PLUGIN, type CallObservation, type HandlerObservation, type PluginDefinition, type ScriptObservers } from "@tk-reawakened/core";
import { createScriptHost, restoreScriptHost } from "../src/script-host.ts";
import { summariseCensus, type ExecutionCensus } from "../src/execution-census.ts";

test("a known fixture executes exactly ten StepOps with the specified opcode histogram", () => {
  const histogram: Record<string, number> = {};
  const calls: CallObservation[] = [];
  let count = 0;
  const host = createScriptHost({ program: "a = 1 + 2\ncastint(3.7)\n", seed: 1, scriptObservers: {
    postStep: (op) => { count += 1; histogram[op.op] = (histogram[op.op] ?? 0) + 1; },
    postCall: (call) => { calls.push(call); },
  } });
  host.advance(1, []);
  equal(count, 10);
  deepEqual(histogram, { load: 1, push: 3, binop: 1, storeRef: 1, pop: 2, call: 1, return: 1 });
  deepEqual(calls.map(({ kind, name, argc, via }) => ({ kind, name, argc, via })), [{ kind: "builtin", name: "castint", argc: 1, via: "source" }]);
  host.advance(2, []);
  equal(count, 10, "finished threads emit no steps");
});

test("traced, untraced, repeated and restored runs have identical per-tick hashes", () => {
  const program = "a = 1\nsleep(2)\na += castint(3.7)\n";
  const execute = (scriptObservers?: ScriptObservers) => {
    const host = createScriptHost({ program, seed: 99, ...(scriptObservers === undefined ? {} : { scriptObservers }) });
    const hashes: string[] = [];
    for (let tick = 0; tick < 6; tick += 1) hashes.push(host.advance(1, []).stateHash);
    return hashes;
  };
  const first: string[] = [];
  const second: string[] = [];
  deepEqual(execute({ postStep: (op, thread) => { first.push(`${thread}:${op.op}`); } }), execute());
  deepEqual(execute({ postStep: (op, thread) => { second.push(`${thread}:${op.op}`); } }), execute());
  deepEqual(first, second);
  const host = createScriptHost({ program, seed: 99 });
  host.advance(1, []);
  let restoredSteps = 0;
  const restored = restoreScriptHost(host.snapshot(), { scriptObservers: { postStep: () => { restoredSteps += 1; } } });
  for (let tick = 0; tick < 5; tick += 1) equal(restored.advance(1, []).stateHash, host.advance(1, []).stateHash);
  equal(restoredSteps > 0, true);
});

test("observer mutation and exceptions cannot alter instructions, state or runtime diagnostics", () => {
  const program = "a = 1 + 2\ncastint(3.7)\nunknownCommand()\n";
  const plain = createScriptHost({ program, seed: 3 });
  let frozenSteps = 0;
  const traced = createScriptHost({ program, seed: 3, scriptObservers: {
    postStep: (op) => {
      equal(Object.isFrozen(op), true);
      equal(Object.isFrozen(op.pos), true);
      frozenSteps += 1;
      Reflect.set(op, "op", "return");
      Reflect.set(op.pos, "line", 999);
      throw new Error("observer failure");
    },
    postCall: (call) => { Reflect.set(call, "name", "end"); throw new Error("call observer failure"); },
    postHandler: () => { throw new Error("handler observer failure"); },
  } });
  deepEqual(traced.advance(1, []), plain.advance(1, []));
  equal(traced.snapshot(), plain.snapshot());
  equal(frozenSteps > 0, true);
});

test("one extension resolution can invoke two handlers and a generated stub exactly once", () => {
  const stub = CATALOGUE_STUBS_PLUGIN.commands.find((command) => command.name === "empty");
  if (stub === undefined) throw new Error("expected exported generated empty stub");
  const lower: PluginDefinition = { id: "stub-fixture", version: "1", commands: [stub] };
  const upper: PluginDefinition = { id: "wrapper-fixture", version: "1", commands: [{
    ...stub, call: (view, args, next) => next(view, args, next),
  }] };
  const calls: CallObservation[] = [];
  const handlers: HandlerObservation[] = [];
  const host = createScriptHost({ program: "EmPtY()", seed: 0, manifest: [{ id: "core" }, { id: lower.id }, { id: upper.id }], plugins: [lower, upper], scriptObservers: {
    postCall: (call) => { calls.push(call); }, postHandler: (handler) => { handlers.push(handler); },
  } });
  host.advance(1, []);
  equal(calls.length, 1);
  equal(calls[0]?.kind, "extension");
  equal(calls[0]?.name, "empty");
  equal(calls[0]?.plugin, upper.id);
  deepEqual(handlers, [{ plugin: upper.id, name: "empty", generatedStub: false }, { plugin: lower.id, name: "empty", generatedStub: true }]);
  const bypass: PluginDefinition = { ...upper, commands: [{ ...stub, call: () => ({ value: 0 }) }] };
  const untouched: HandlerObservation[] = [];
  createScriptHost({ program: "empty()", seed: 0, manifest: [{ id: "core" }, { id: lower.id }, { id: bypass.id }], plugins: [lower, bypass], scriptObservers: { postHandler: (handler) => { untouched.push(handler); } } }).advance(1, []);
  equal(untouched.some((handler) => handler.generatedStub), false, "a next layer that was never entered is never counted");
});

test("callable, builtin and script resolutions stay distinct, and unresolved calls are excluded", () => {
  const calls: CallObservation[] = [];
  const host = createScriptHost({ program: "method helper(x) { return x }\nhelper(1)\nf = (x) => x + 1\nf(2)\ncastint(3.7)\nnoSuchCommand()", seed: 0, scriptObservers: { postCall: (call) => { calls.push(call); } } });
  host.advance(1, []);
  deepEqual(calls.map(({ name, kind }) => [name, kind]), [["helper", "script"], ["f", "callable"], ["castint", "builtin"]]);
});

test("catalogue ownership and actual stub usage use separate resolution and handler counts", () => {
  const game: ExecutionCensus = { ticks: 1, stateHashes: [], bootSequence: [], programSpans: [], opcodeHistogram: { call: 2 }, callHistogram: {}, commandHistogram: { empty: 1, unknown: 1 }, handlerHistogram: { "fixture:empty": 2 }, generatedStubHistogram: { empty: 1 } };
  const row = { name: "Empty", owner: 3, ownerEpic: "vm", effectKind: "pure", sectionsRead: [], sectionsWrite: [] };
  const unused = { ...row, name: "unused" };
  const summary = summariseCensus({ one: game, two: game }, [row, unused]);
  deepEqual(summary.commandHistogram, { empty: 2, unknown: 2 });
  deepEqual(summary.generatedStubsInvoked, [{ name: "empty", count: 2, catalogue: row }]);
  equal(summary.calledByOwnerEpic.vm?.[0]?.count, 2);
  deepEqual(summary.calledWithoutOwner, [{ name: "unknown", count: 2, catalogue: null }]);
  deepEqual(summary.neverCalled, [unused]);
});

test("observers coexist with package startup lifecycle and its restore and forbidden-operation guards", () => {
  const modes: boolean[] = [];
  const plugin: PluginDefinition = { id: "trace-startup", version: "1", commands: [{
    name: "startupprobe", aliases: [], params: [], call: (view) => {
      modes.push(view.packageStartup === true);
      return { value: 0 };
    },
  }] };
  const packageStartups = [{ owner: plugin.id, ref: { kind: "inline" as const, text: "startupProbe()", ir: "1" } }];
  const init = { program: "answer = castint(3.7)\nsleep(2)", seed: 3, plugins: [plugin], packageStartups };
  const calls: CallObservation[] = [];
  const handlers: HandlerObservation[] = [];
  let steps = 0;
  const scriptObservers: ScriptObservers = {
    postStep: () => { steps += 1; },
    postCall: (call) => { calls.push(call); },
    postHandler: (handler) => { handlers.push(handler); },
  };
  const plain = createScriptHost(init);
  const traced = createScriptHost({ ...init, scriptObservers });
  equal(traced.snapshot(), plain.snapshot());
  equal(steps > 0, true, "startup instructions pass through stepThread");
  equal(calls.some((call) => call.name === "startupprobe" && call.plugin === plugin.id), true);
  equal(handlers.some((handler) => handler.plugin === plugin.id), true);
  deepEqual(modes, [true, true]);
  const restored = restoreScriptHost(traced.snapshot(), { plugins: [plugin], packageStartups, scriptObservers });
  equal(restored.snapshot(), plain.snapshot());
  equal(modes.every((mode) => mode), true);
  for (let tick = 0; tick < 4; tick += 1) {
    const expected = plain.advance(1, []).stateHash;
    equal(traced.advance(1, []).stateHash, expected);
    equal(restored.advance(1, []).stateHash, expected);
  }
  const forbidden = (observers?: ScriptObservers): string => {
    try {
      createScriptHost({ ...init, ...(observers === undefined ? {} : { scriptObservers: observers }), packageStartups: [{ owner: plugin.id, ref: { ...packageStartups[0]!.ref, text: "value = random(10)" } }] });
      return "startup unexpectedly succeeded";
    } catch (error) {
      return (error as { code: string }).code;
    }
  };
  equal(forbidden(), "package.startup-forbidden");
  equal(forbidden(scriptObservers), "package.startup-forbidden");
});
