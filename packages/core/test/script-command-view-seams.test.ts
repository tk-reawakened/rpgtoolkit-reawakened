// The two read seams the test-only `script-spec` package needs on `CommandView` (TOOL-5,
// docs/spec/engine/rpgcode-tooling.md#tool-5-natives): `elementArray`, the element variables a by-reference
// argument names, and `errorWindows`, the observation windows over the calling thread's unhandled failures
// (ERR-1/ERR-2). Neither is saved state.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  createGameState,
  snapshot,
  startProgram,
  startThread,
  type GameState,
  type PluginDefinition,
  type ScriptServices,
} from "../src/index.ts";
import { createScriptServices } from "./script-test-services.ts";

/** One line per probe call, in call order. */
const log: string[] = [];

const PROBE: PluginDefinition = {
  id: "probe",
  version: "1.0.0",
  commands: [
    { name: "winopen", aliases: [], params: [], call: (view) => { view.errorWindows!.open(); return { value: null }; } },
    {
      name: "winclose",
      aliases: [],
      params: [],
      call: (view) => {
        const before = view.state!.events.queue.length;
        const consumed = view.errorWindows!.close();
        log.push(`close ${consumed === null ? "none" : consumed.map((item) => item.code).join(",")} queue ${before}->${view.state!.events.queue.length}`);
        return { value: consumed === null ? -1 : consumed.length };
      },
    },
    {
      name: "elements",
      aliases: [],
      params: [{ name: "value", optional: false, byRef: true, variadic: false }],
      call: (view, args) => {
        const ref = args[0]!.ref;
        if (ref === null) {
          log.push("literal");
          return { value: null };
        }
        const array = view.elementArray!(ref);
        log.push(`${array.table}|${array.entries.map((entry) => `${entry.name}=${String(entry.value)}`).join(",")}`);
        return { value: null };
      },
    },
  ],
};

function run(program: string, ticks = 3): { readonly state: GameState; readonly services: ScriptServices; readonly lines: string[] } {
  const state = createGameState({ seed: 0 });
  const services = createScriptServices(state, [PROBE]);
  startProgram(state.vm, { kind: "inline", text: program, ir: "1" });
  for (let tick = 0; tick < ticks; tick += 1) advanceScriptTick(state, services);
  return { state, services, lines: log.splice(0) };
}

const codes = (services: ScriptServices): string[] => services.diagnostics.map((item) => item.code);

test("a closed window consumes the unhandled failures of nested calls, with their diagnostics and queued events", () => {
  const { services, lines } = run([
    "function boom() { missingOne() }",
    "function outer() { boom() }",
    "winopen()",
    "outer()",
    "n = winclose()",
    "missingTwo()",
  ].join("\n"));
  // The failure raised two calls down is consumed, its queued `error` event with it; the one after the window stays.
  deepEqual(lines, ["close unknown.command queue 1->0"]);
  deepEqual(services.diagnostics.map((item) => item.message), ['no built-in or function named "missingtwo"']);
});

test("a failure a handler took is not consumed", () => {
  const { services, lines } = run([
    "function swallow() { on error resume next; missingA() }",
    "function labelled() { on error goto :h; missingB(); :h; x = 1 }",
    "winopen()",
    "swallow()",
    "labelled()",
    "n = winclose()",
  ].join("\n"));
  deepEqual(lines, ["close  queue 2->2"]);
  deepEqual(codes(services), ["unknown.command", "unknown.command"]);
});

test("windows nest: the inner one consumes what was raised inside it, the outer one the rest; none open gives null", () => {
  const { services, state, lines } = run([
    "winopen()",
    "missingOuter()",
    "winopen()",
    "missingInner()",
    "a = winclose()",
    "b = winclose()",
    "c = winclose()",
  ].join("\n"));
  deepEqual(lines, ["close unknown.command queue 2->1", "close unknown.command queue 1->0", "close none queue 0->0"]);
  deepEqual([state.vm.globals.a, state.vm.globals.b, state.vm.globals.c], [1, 1, -1]);
  deepEqual(codes(services), []);
});

test("a window is per thread: another thread's failure while it is open is not consumed", () => {
  const state = createGameState({ seed: 0 });
  const services = createScriptServices(state, [PROBE]);
  // The first thread opens its window and then runs past one tick's step budget, so the second thread runs while it is open.
  startThread(state.vm, {
    ref: { kind: "inline", text: "winopen()\nfor (i = 0; i < 700; i = i + 1) { }\nn = winclose()", ir: "1" },
    kind: "persistent",
    owner: "script",
  });
  startThread(state.vm, { ref: { kind: "inline", text: "missingFromOther()\nother = 1", ir: "1" }, kind: "persistent", owner: "script" });
  for (let tick = 0; tick < 40; tick += 1) advanceScriptTick(state, services);
  deepEqual(log.splice(0), ["close  queue 0->0"]);
  equal(state.vm.globals.n, 0);
  equal(state.vm.globals.other, 1);
  deepEqual(codes(services), ["unknown.command"]);
});

test("elementArray lists the element variables of a global array, a local array, an auto-local frame and an object", () => {
  const { lines } = run([
    "class Bag {",
    "  public:",
    "  var items[]",
    "}",
    'a[1] = 5',
    'a[0][2] = "x"',
    "elements(a)",
    "function declared() { local(b); b[0] = 1; elements(b) }",
    "declared()",
    "function automatic() { autoLocal(1); c[0] = 2; c[1] = 3; elements(c) }",
    "automatic()",
    "bag = Bag()",
    "bag.items[0][1] = 8",
    "bag.items[3] = 9",
    "elements(bag.items)",
    "elements(nothing)",
    "elements(5)",
  ].join("\n"));
  equal(lines[0], "global|a[1]=5,a[0]=0,a[0][2]=x");
  // The element of a `local(b)` array is a read of `b[0]`: the global table holds it, the reference names the frame.
  ok(/^local:\d+:\d+\|b\[0\]=1$/.test(lines[1]!), lines[1]);
  // In an auto-local frame the elements are the frame's own locals.
  ok(/^local:\d+:\d+\|c\[0\]=2,c\[1\]=3$/.test(lines[2]!), lines[2]);
  ok(/^object:\d+\|items\[0\]\[1\]=8,items\[3\]=9$/.test(lines[3]!), lines[3]);
  deepEqual(lines.slice(4), ["global|", "literal"]);
});

test("an open window is session bookkeeping: it is not in the saved state", () => {
  const { state } = run("winopen()\nmissingOpen()\nx = 1", 1);
  ok(!snapshot(state).toLowerCase().includes("window"));
  deepEqual(log.splice(0), []);
});
