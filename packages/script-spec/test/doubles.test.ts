import { deepEqual, equal, match, ok } from "node:assert/strict";
import test from "node:test";
import { createAssetIndex, createInputSection, ENGINE_DEFAULT_MANIFEST, PACKAGE_ROOT, type CommandView, type KeyInput, type PluginDefinition } from "@tk-reawakened/core";
import { applyDue, createDoubles, wrapPlugins } from "../src/doubles.ts";
import { createSpecPlugin, runSpecFile, SPEC_PLUGIN, type SpecCaseResult, type SpecFileReport } from "../src/index.ts";
import type { SpecProgramLoader } from "../src/runner.ts";

/**
 * TOOL-5 test doubles and spies (docs/spec/engine/rpgcode-tooling.md#tool-5-doubles, #2042), proved through the
 * runner on authored RPGCode: scheduled key edges, whole-tick waits, scripted RNG draws, forwarding spies and the
 * two call matchers, with per-run isolation and replay. Every case asserts one behaviour, so `ok` is its verdict.
 */

function run(spec: string, loader?: SpecProgramLoader): SpecFileReport {
  return runSpecFile("doubles.spec.prg", spec, loader === undefined ? {} : { loader });
}

function caseOf(report: SpecFileReport, name: string): SpecCaseResult {
  const found = report.cases.find((item) => item.name === name);
  ok(found, `no case "${name}" in ${JSON.stringify(report.cases.map((item) => item.name))}`);
  return found;
}

function verdicts(report: SpecFileReport): { readonly passed: string[]; readonly failed: string[] } {
  return {
    passed: report.cases.filter((item) => item.ok).map((item) => item.name),
    failed: report.cases.filter((item) => !item.ok).map((item) => item.name),
  };
}

/** The runtime error codes a case failed with, in order. */
function errorCodes(item: SpecCaseResult): string[] {
  return item.outcomes.filter((outcome) => outcome.label.endsWith("/runtime error")).map((outcome) => outcome.actual.split(":")[0]!);
}

/**
 * A project native plugin for the spy cases: `probe` accepts any value and returns 1 (one alias, `probealias`);
 * `twice` writes double its argument to a by-reference output; `random` is an upper layer over the engine's own
 * `random` that forwards to it, so a spy has a layered target.
 */
const PROBE_PLUGIN: PluginDefinition = {
  id: "probe-pack",
  version: "1.0.0",
  commands: [
    {
      name: "probe",
      aliases: ["probealias"],
      params: [{ name: "value", optional: true, byRef: true, variadic: true }],
      call: () => ({ value: 1 }),
    },
    {
      name: "twice",
      aliases: [],
      params: [
        { name: "value", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: false, byRef: true, variadic: false },
      ],
      call: (_view, args) => ({ value: 7, out: [[1, Number(args[0]?.value ?? 0) * 2]] }),
    },
    {
      name: "random",
      aliases: [],
      params: [
        { name: "max", optional: false, byRef: false, variadic: false },
        { name: "dest", optional: true, byRef: true, variadic: false },
      ],
      call: (view, args, next) => next(view, args, next),
    },
  ],
};

const PROBE_LOADER: SpecProgramLoader = {
  index: createAssetIndex([]),
  root: PACKAGE_ROOT,
  read: () => undefined,
  nativePlugin: PROBE_PLUGIN,
};

// ------------------------------------------------------------------------------------------------ specInput

test("specInput: a scheduled press reaches a waiting script at its tick, edges of one tick in scheduling order", () => {
  const report = run([
    'it("press at its tick", () => {',
    '  t = specTicks(0)',
    '  specInput(t + 3, "ENTER", "Enter", "", 1)',
    '  k = wait()',
    '  expect(k).toEqual("ENTER")',
    '  expect(specTicks(0) - t).toEqual(3)',
    '})',
    // A wait sees only keys queued after it parked, so each order is checked by the first wait of its own case.
    'it("same tick, B scheduled first", () => {',
    '  t = specTicks(0)',
    '  specInput(t + 2, "B", "KeyB", "b", 1)',
    '  specInput(t + 2, "A", "KeyA", "a", 1)',
    '  expect(wait()).toEqual("B")',
    '})',
    'it("same tick, A scheduled first", () => {',
    '  t = specTicks(0)',
    '  specInput(t + 2, "A", "KeyA", "a", 1)',
    '  specInput(t + 2, "B", "KeyB", "b", 1)',
    '  expect(wait()).toEqual("A")',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report).failed, []);
  equal(report.cases.length, 3);
});

test("specInput: due edges enter the input section in scheduling order, and a key-up releases the held key", () => {
  // No RPGCode command reads a held key yet, so the runner's per-tick step is checked on a real input section.
  const doubles = createDoubles();
  const input = createInputSection();
  const key = (down: boolean): KeyInput => ({ kind: "key", name: "A", code: "KeyA", char: "a", down });
  doubles.pending.push({ tick: 5, event: key(true) }, { tick: 6, event: key(false) }, { tick: 5, event: { ...key(true), name: "B", code: "KeyB", char: "b" } });
  applyDue(doubles, input, 4);
  equal(input.held.KeyA === true, false);
  applyDue(doubles, input, 5);
  equal(input.held.KeyA, true);
  deepEqual(input.keys.map((item) => item.name), ["A", "B"]);
  deepEqual(doubles.pending.map((item) => item.tick), [6]);
  applyDue(doubles, input, 6);
  equal(input.held.KeyA === true, false, "the key-up edge did not release the key");
  equal(input.held.KeyB, true);
  deepEqual(doubles.pending, []);
});

test("specInput: a tick that is not in the future, or a malformed edge, is spec.bad-input at the call", () => {
  const report = run([
    'it("current tick", () => { t = specTicks(0); specInput(t, "A", "KeyA", "a", 1) })',
    'it("fractional tick", () => { t = specTicks(0); specInput(t + 1.5, "A", "KeyA", "a", 1) })',
    'it("empty name", () => { t = specTicks(0); specInput(t + 1, "", "KeyA", "a", 1) })',
    'it("two characters", () => { t = specTicks(0); specInput(t + 1, "A", "KeyA", "ab", 1) })',
    'it("down must be 0 or 1", () => { t = specTicks(0); specInput(t + 1, "A", "KeyA", "a", 2) })',
    'it("observable with toThrow", () => { expect(() => specInput(0, "A", "KeyA", "a", 1)).toThrow() })',
  ].join("\n"));
  for (const name of ["current tick", "fractional tick", "empty name", "two characters", "down must be 0 or 1"]) {
    const item = caseOf(report, name);
    equal(item.ok, false, name);
    deepEqual(errorCodes(item), ["spec.bad-input"], name);
    equal(item.outcomes.find((outcome) => outcome.label.endsWith("/runtime error"))?.line, report.cases.indexOf(item) + 1, name);
  }
  equal(caseOf(report, "observable with toThrow").ok, true);
});

test("specInput: an edge still scheduled when the run ends fails it with spec.input-pending", () => {
  const report = run('it("never reached", () => { t = specTicks(0); specInput(t + 50, "A", "KeyA", "a", 1); expect(1).toEqual(1) })');
  const item = caseOf(report, "never reached");
  equal(item.ok, false);
  deepEqual(errorCodes(item), ["spec.input-pending"]);
  match(item.outcomes.at(-1)!.actual, /tick 50/);
});

// ------------------------------------------------------------------------------------------------ specTicks

test("specTicks: 0 reads the tick, a count waits exactly that many ticks, and a bad count is spec.bad-ticks", () => {
  const report = run([
    'it("waits whole ticks", () => {',
    '  t0 = specTicks(0)',
    '  v = specTicks(5)',
    '  expect(specTicks(0) - t0).toEqual(5)',
    '  expect(v).toBeNull()',
    '  specTicks(1)',
    '  expect(specTicks(0) - t0).toEqual(6)',
    '})',
    'it("negative", () => { specTicks(-1) })',
    'it("fractional", () => { specTicks(1.5) })',
    'it("over the budget", () => { specTicks(1001) })',
    'it("not a number", () => { specTicks("3") })',
  ].join("\n"));
  equal(caseOf(report, "waits whole ticks").ok, true);
  for (const name of ["negative", "fractional", "over the budget", "not a number"]) deepEqual(errorCodes(caseOf(report, name)), ["spec.bad-ticks"], name);
});

test("specTicks parks only the caller: its wait is the cooperative, non-global sleep", () => {
  // A blocking (global) sleep would hold every thread (R-32); THR-1's cooperative sleep parks only its own.
  const doubles = createDoubles();
  const ticks = createSpecPlugin(doubles).commands.find((command) => command.name === "specticks")!;
  const view = { clock: { tick: () => 40 } } as unknown as CommandView;
  const result = ticks.call(view, [{ value: 3, ref: null }], (() => ({ value: null })) as never);
  deepEqual(result.wait, { kind: "sleep", global: false, until: 43, resumesCall: true });
  deepEqual(ticks.call(view, [{ value: 0, ref: null }], (() => ({ value: null })) as never), { value: 40 });
});

// ------------------------------------------------------------------------------------------------ specRng

test("specRng: random applies its real range rules to each supplied draw, in order, with no fallback", () => {
  const report = run([
    'it("range rules", () => {',
    '  specRng({ "0": 7, "1": 4294967295, "2": 0, length: 3 })',
    '  expect(random(6)).toEqual(2)',
    '  expect(random(100)).toEqual(96)',
    '  expect(random(-5)).toEqual(1)',
    '})',
    'it("random(0) takes no draw", () => {',
    '  specRng({ "0": 3, length: 1 })',
    '  expect(random(0)).toEqual(1)',
    '  expect(random(10)).toEqual(4)',
    '})',
    'it("exhausted", () => {',
    '  specRng({ "0": 1, length: 1 })',
    '  random(6)',
    '  random(6)',
    '})',
    'it("exhaustion is observable", () => {',
    '  specRng({ "0": 1, length: 1 })',
    '  random(6)',
    '  expect(() => random(6)).toThrow()',
    '})',
    'it("a later call replaces what is left", () => {',
    '  specRng({ "0": 1, "1": 1, length: 2 })',
    '  random(6)',
    '  specRng({ "0": 5, length: 1 })',
    '  expect(random(6)).toEqual(6)',
    '  expect(() => random(6)).toThrow()',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: ["range rules", "random(0) takes no draw", "exhaustion is observable", "a later call replaces what is left"],
    failed: ["exhausted"],
  });
  deepEqual(errorCodes(caseOf(report, "exhausted")), ["spec.rng-exhausted"]);
  equal(caseOf(report, "exhausted").outcomes.at(-1)?.line, 15);
});

test("specRng: anything but a non-empty list of whole draws 0 to 2^32 - 1 is spec.bad-rng", () => {
  const report = run([
    'it("empty", () => { specRng({ length: 0 }) })',
    'it("not a list", () => { specRng(5) })',
    'it("an extra key", () => { specRng({ "0": 1, x: 2, length: 1 }) })',
    'it("negative", () => { specRng({ "0": -1, length: 1 }) })',
    'it("fractional", () => { specRng({ "0": 1.5, length: 1 }) })',
    'it("too large", () => { specRng({ "0": 4294967296, length: 1 }) })',
    'it("a string", () => { specRng({ "0": "1", length: 1 }) })',
  ].join("\n"));
  for (const item of report.cases) deepEqual(errorCodes(item), ["spec.bad-rng"], item.name);
});

test("specRng: a scripted draw never touches the seeded generator, before or after the draws run out", () => {
  // The wrapped handler gets the scripted port; the seeded port of the view is never called, and exhaustion is an
  // error rather than a fallback to it.
  const doubles = createDoubles();
  const [plugin] = wrapPlugins([{ definition: { id: "draw", version: "1", commands: [{
    name: "draw", aliases: [], params: [], call: (view) => ({ value: view.rng.nextUint32() }),
  }] } }], doubles);
  let seeded = 0;
  const view = Object.freeze({ rng: { nextUint32: () => { seeded += 1; return 99; } } }) as unknown as CommandView;
  const draw = (): unknown => plugin!.definition.commands[0]!.call(view, [], (() => ({ value: null })) as never).value;
  equal(draw(), 99);
  equal(seeded, 1);
  doubles.draws = [5, 6];
  equal(draw(), 5);
  equal(draw(), 6);
  let code = "";
  try { draw(); } catch (error) { code = (error as { code?: string }).code ?? ""; }
  equal(code, "spec.rng-exhausted");
  equal(seeded, 1, "the seeded generator was drawn from while draws were scripted");
});

// ------------------------------------------------------------------------------------------------ spies

test("spyOn records argument pictures at call time and forwards: return value and by-reference writes unchanged", () => {
  const report = run([
    'it("forwards", () => {',
    '  specRng({ "0": 2, "1": 8, length: 2 })',
    '  s = spyOn("Random")',
    '  a = random(6)',
    '  x = 0',
    '  b = random(10, x)',
    '  expect(a).toEqual(3)',
    '  expect(b).toEqual(9)',
    '  expect(x).toEqual(9)',
    '  expect(s).toHaveBeenCalledWith({ "0": 6, length: 1 })',
    // `x` is pictured before random wrote 9 into it.
    '  expect(s).toHaveBeenNthCalledWith(2, { "0": 10, "1": 0, length: 2 })',
    '  expect(s).not.toHaveBeenNthCalledWith(2, { "0": 10, "1": 9, length: 2 })',
    '})',
    'it("no call before installation", () => {',
    '  random(6)',
    '  s = spyOn("random")',
    '  expect(s).not.toHaveBeenCalledWith({ "0": 6, length: 1 })',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report).failed, []);
});

test("toHaveBeenCalledWith and toHaveBeenNthCalledWith: matching and mismatching nested arguments, count and order", () => {
  const report = run([
    'function setup() {',
    '  s = spyOn("probe")',
    '  inner = { "0": 1, "1": "two", length: 2 }',
    '  probe({ name: "a", list: inner }, 5)',
    '  probe("x")',
    '}',
    'it("nested match", () => { setup(); expect(s).toHaveBeenCalledWith({ "0": { name: "a", list: { "0": 1, "1": "two", length: 2 } }, "1": 5, length: 2 }) })',
    'it("nested mismatch", () => { setup(); expect(s).toHaveBeenCalledWith({ "0": { name: "a", list: { "0": 1, "1": "2", length: 2 } }, "1": 5, length: 2 }) })',
    'it("nested mismatch, not", () => { setup(); expect(s).not.toHaveBeenCalledWith({ "0": { name: "a", list: { "0": 1, "1": "2", length: 2 } }, "1": 5, length: 2 }) })',
    'it("count matters", () => { setup(); expect(s).toHaveBeenCalledWith({ "0": "x", "1": 0, length: 2 }) })',
    'it("no number/string conversion", () => { setup(); expect(s).toHaveBeenCalledWith({ "0": "5", length: 1 }) })',
    'it("first call", () => { setup(); expect(s).toHaveBeenNthCalledWith(1, { "0": { name: "a", list: inner }, "1": 5, length: 2 }) })',
    'it("second call", () => { setup(); expect(s).toHaveBeenNthCalledWith(2, { "0": "x", length: 1 }) })',
    'it("order matters", () => { setup(); expect(s).toHaveBeenNthCalledWith(1, { "0": "x", length: 1 }) })',
    'it("order matters, not", () => { setup(); expect(s).not.toHaveBeenNthCalledWith(1, { "0": "x", length: 1 }) })',
    'it("no third call", () => { setup(); expect(s).toHaveBeenNthCalledWith(3, { "0": "x", length: 1 }) })',
    'it("no third call, not", () => { setup(); expect(s).not.toHaveBeenNthCalledWith(3, { "0": "x", length: 1 }) })',
  ].join("\n"), PROBE_LOADER);
  deepEqual(verdicts(report), {
    passed: ["nested match", "nested mismatch, not", "first call", "second call", "order matters, not", "no third call, not"],
    failed: ["nested mismatch", "count matters", "no number/string conversion", "order matters", "no third call"],
  });
  const failure = caseOf(report, "order matters").outcomes.find((outcome) => outcome.kind === "fail")!;
  equal(failure.label, "order matters/toHaveBeenNthCalledWith");
  equal(failure.expected, 'call 1 of probe with ("x")');
  equal(failure.actual, '1: ({"list": {"0": 1, "1": "two", "length": 2}, "name": "a"}, 5), 2: ("x")');
  equal(failure.line, 14);
  equal(caseOf(report, "no third call").outcomes.at(-1)?.actual, '1: ({"list": {"0": 1, "1": "two", "length": 2}, "name": "a"}, 5), 2: ("x")');
});

test("a spy without calls reports no calls; a subject that is not a spy, args that is not a list or a bad n fail both polarities", () => {
  const report = run([
    'it("no calls", () => { s = spyOn("random"); expect(s).toHaveBeenCalledWith({ "0": 1, length: 1 }) })',
    'it("not a spy", () => { expect("<spy random #1>").toHaveBeenCalledWith({ "0": 1, length: 1 }) })',
    'it("not a spy, not", () => { expect("<spy random #1>").not.toHaveBeenCalledWith({ "0": 1, length: 1 }) })',
    'it("not a list", () => { s = spyOn("random"); expect(s).toHaveBeenCalledWith(1) })',
    'it("not a list, not", () => { s = spyOn("random"); expect(s).not.toHaveBeenCalledWith(1) })',
    'it("n zero", () => { s = spyOn("random"); random(1); expect(s).toHaveBeenNthCalledWith(0, { "0": 1, length: 1 }) })',
    'it("n zero, not", () => { s = spyOn("random"); expect(s).not.toHaveBeenNthCalledWith(0, { "0": 1, length: 1 }) })',
    'it("n fractional, not", () => { s = spyOn("random"); expect(s).not.toHaveBeenNthCalledWith(1.5, { "0": 1, length: 1 }) })',
    'it("n a string, not", () => { s = spyOn("random"); expect(s).not.toHaveBeenNthCalledWith("1", { "0": 1, length: 1 }) })',
    'it("a spy of another case", () => { expect("<spy random #1>").not.toHaveBeenNthCalledWith(1, { "0": 1, length: 1 }) })',
  ].join("\n"));
  equal(verdicts(report).passed.length, 0, JSON.stringify(verdicts(report)));
  equal(caseOf(report, "no calls").outcomes.at(-1)?.actual, "no calls");
  equal(caseOf(report, "not a spy, not").outcomes.at(-1)?.actual, '"<spy random #1>"');
  equal(caseOf(report, "not a list, not").outcomes.at(-1)?.expected, "a list of expected arguments");
  equal(caseOf(report, "n zero, not").outcomes.at(-1)?.expected, "a call number of 1 or more");
});

test("spyOn: aliases and folded names reach one target; a layered command is spied at its top layer", () => {
  const report = run([
    'it("alias", () => { s = spyOn("PROBEALIAS"); probe(1); probeAlias(2); expect(s).toHaveBeenNthCalledWith(1, { "0": 1, length: 1 }); expect(s).toHaveBeenNthCalledWith(2, { "0": 2, length: 1 }) })',
    'it("alias is the same target", () => { spyOn("probe"); spyOn("probealias") })',
    // The project's `random` layer forwards to the engine's: one call records once and still draws.
    'it("top layer, recorded once", () => {',
    '  specRng({ "0": 4, length: 1 })',
    '  s = spyOn("random")',
    '  expect(random(6)).toEqual(5)',
    '  expect(s).toHaveBeenCalledWith({ "0": 6, length: 1 })',
    '  expect(s).not.toHaveBeenNthCalledWith(2, { "0": 6, length: 1 })',
    '})',
    'it("forwarded by-reference write", () => { s = spyOn("twice"); y = 0; r = twice(4, y); expect(r).toEqual(7); expect(y).toEqual(8); expect(s).toHaveBeenCalledWith({ "0": 4, "1": 0, length: 2 }) })',
  ].join("\n"), PROBE_LOADER);
  deepEqual(verdicts(report), {
    passed: ["alias", "top layer, recorded once", "forwarded by-reference write"],
    failed: ["alias is the same target"],
  });
  deepEqual(errorCodes(caseOf(report, "alias is the same target")), ["spec.spy-exists"]);
});

test("spyOn forwards waits and errors unchanged, and refuses targets it cannot wrap", () => {
  const report = run([
    'it("a wait is kept", () => { s = spyOn("sleep"); t = specTicks(0); sleep(3); expect(specTicks(0) - t).toEqual(3); expect(s).toHaveBeenCalledWith({ "0": 3, length: 1 }) })',
    'it("an error is kept and the call recorded", () => { s = spyOn("sleep"); expect(() => sleep(0)).toThrow(); expect(s).toHaveBeenCalledWith({ "0": 0, length: 1 }) })',
    'it("unknown", () => { spyOn("noSuchCommand") })',
    'it("a spec command", () => { spyOn("specResult") })',
    'it("a catalogue placeholder", () => { spyOn("putPlayer") })',
    'it("not a name", () => { spyOn(3) })',
  ].join("\n"));
  equal(caseOf(report, "a wait is kept").ok, true);
  equal(caseOf(report, "an error is kept and the call recorded").ok, true);
  for (const name of ["unknown", "a spec command", "not a name"]) deepEqual(errorCodes(caseOf(report, name)), ["spec.spy-target"], name);
  const placeholder = errorCodes(caseOf(report, "a catalogue placeholder"));
  deepEqual(placeholder, ["spec.spy-target"]);
});

// ------------------------------------------------------------------------------------------------ isolation, replay

test("isolation: nothing installed in beforeAll or an earlier case reaches a case, even from a group snapshot", () => {
  const report = run([
    'describe("group", () => {',
    '  beforeAll(() => {',
    '    specRng({ "0": 0, length: 1 })',
    '    spyOn("random")',
    '    random(6)',
    '  })',
    '  it("first", () => {',
    '    s = spyOn("random")',
    '    random(6)',
    '    random(6)',
    '    expect(s).toHaveBeenNthCalledWith(2, { "0": 6, length: 1 })',
    '  })',
    '  it("second", () => {',
    '    s = spyOn("random")',
    '    expect(s).not.toHaveBeenCalledWith({ "0": 6, length: 1 })',
    '    expect(() => random(1000)).not.toThrow()',
    '  })',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report).failed, []);
  equal(report.cases.length, 2);
});

test("replay: two runs of a spec using every double give identical reports and state hashes", () => {
  const spec = [
    'it("everything", () => {',
    '  t = specTicks(0)',
    '  specInput(t + 2, "ENTER", "Enter", "", 1)',
    '  specInput(t + 3, "ENTER", "Enter", "", 0)',
    '  specRng({ "0": 11, length: 1 })',
    '  s = spyOn("random")',
    '  wait()',
    '  r = random(4)',
    '  specTicks(2)',
    '  expect(r).toEqual(4)',
    '  expect(s).toHaveBeenCalledWith({ "0": 4, length: 1 })',
    '})',
  ].join("\n");
  const first = run(spec);
  const second = run(spec);
  deepEqual(verdicts(first).failed, []);
  equal(JSON.stringify(first), JSON.stringify(second));
});

test("the doubles are absent from the default manifest; the static plugin has none to offer", () => {
  equal(ENGINE_DEFAULT_MANIFEST.some((entry) => entry.id === SPEC_PLUGIN.id), false);
  const names = SPEC_PLUGIN.commands.map((command) => command.name);
  for (const name of ["speccalled", "specinput", "specticks", "specrng", "spyon"]) ok(names.includes(name), name);
  const spy = SPEC_PLUGIN.commands.find((command) => command.name === "spyon")!;
  let code = "";
  try {
    spy.call({} as never, [{ value: "random", ref: null }], (() => ({ value: null })) as never);
  } catch (error) {
    code = (error as { code?: string }).code ?? "";
  }
  equal(code, "spec.no-doubles");
});
