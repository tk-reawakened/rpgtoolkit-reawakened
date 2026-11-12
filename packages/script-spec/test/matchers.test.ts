import { deepEqual, equal, ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { ENGINE_DEFAULT_MANIFEST } from "@tk-reawakened/core";
import { runSpecFile, SPEC_PLUGIN, type SpecCaseResult, type SpecFileReport } from "../src/index.ts";

/**
 * The matcher surface of TOOL-5 (docs/spec/engine/rpgcode-tooling.md#tool-5, #tool-5-natives), proved through the
 * runner on real RPGCode specs: element-wise equality over every array shape the language has, strict `toBe`,
 * containment, closeness on stored doubles, and `toThrow` over nested calls. Each spec case asserts one thing, so a
 * case's `ok` is the verdict on that thing.
 */

function run(spec: string): SpecFileReport {
  return runSpecFile("matchers.spec.prg", spec, {});
}

function caseOf(report: SpecFileReport, name: string): SpecCaseResult {
  const found = report.cases.find((item) => item.name === name);
  ok(found, `no case "${name}" in ${JSON.stringify(report.cases.map((item) => item.name))}`);
  return found;
}

/** The cases that passed and the cases that failed, by name. */
function verdicts(report: SpecFileReport): { readonly passed: string[]; readonly failed: string[] } {
  return {
    passed: report.cases.filter((item) => item.ok).map((item) => item.name),
    failed: report.cases.filter((item) => !item.ok).map((item) => item.name),
  };
}

test("toEqual compares sparse multi-dimensional global arrays element by element, and by key", () => {
  const report = run([
    'it("equal", () => {',
    '  a[0][0] = 1', '  a[0][1] = 2', '  a[1][0] = 3',
    '  b[0][0] = 1', '  b[0][1] = 2', '  b[1][0] = 3',
    '  expect(a).toEqual(b)',
    '})',
    'it("an element differs", () => {',
    '  a[0][0] = 1', '  a[0][1] = 2', '  a[1][0] = 3',
    '  b[0][0] = 1', '  b[0][1] = 2', '  b[1][0] = 4',
    '  expect(a).toEqual(b)',
    '})',
    'it("a nested element differs, so not.toEqual passes", () => {',
    '  a[0][0] = 1', '  a[0][1] = 2', '  a[1][0] = 3',
    '  b[0][0] = 1', '  b[0][1] = 9', '  b[1][0] = 3',
    '  expect(a).not.toEqual(b)',
    '})',
    'it("a key is missing", () => {',
    '  a[0][0] = 1', '  a[0][1] = 2', '  a[1][0] = 3',
    '  b[0][0] = 1', '  b[1][0] = 3',
    '  expect(a).toEqual(b)',
    '})',
    'it("sparse arrays with different keys", () => {',
    '  a[5] = 1', '  b[6] = 1',
    '  expect(a).toEqual(b)',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: ["equal", "a nested element differs, so not.toEqual passes"],
    failed: ["an element differs", "a key is missing", "sparse arrays with different keys"],
  });
  // The failure message shows both arrays' contents, and the line of the failing assertion.
  const differing = caseOf(report, "an element differs").outcomes[0]!;
  equal(differing.expected, "array[0: array[0: 1, 1: 2], 1: array[0: 4]]");
  equal(differing.actual, "array[0: array[0: 1, 1: 2], 1: array[0: 3]]");
  equal(differing.line, 17);
  ok(report.failures.includes("matchers.spec.prg: an element differs: toEqual: expected array[0: array[0: 1, 1: 2], 1: array[0: 4]], actual array[0: array[0: 1, 1: 2], 1: array[0: 3]] (line 17)"));
});

test("toEqual compares local arrays, whose elements a read resolves through the global table", () => {
  const report = run([
    'function compare(same) {',
    '  local(p)', '  local(q)',
    '  p[0][1] = 5', '  p[2] = "s"',
    '  q[0][1] = 5', '  q[2] = "s"',
    '  if (same == 0) { q[2] = "t" }',
    '  expect(p).toEqual(q)',
    '}',
    'it("equal local arrays", () => { compare(1) })',
    'it("different local arrays", () => { compare(0) })',
  ].join("\n"));
  deepEqual(verdicts(report), { passed: ["equal local arrays"], failed: ["different local arrays"] });
});

test("toEqual compares the member arrays of objects", () => {
  const report = run([
    'class Bag {',
    '  public:',
    '  var items[]',
    '}',
    'it("equal member arrays", () => {',
    '  one = Bag()', '  two = Bag()',
    '  one.items[0][0] = 1', '  one.items[0][1] = 2', '  one.items[3] = "x"',
    '  two.items[0][0] = 1', '  two.items[0][1] = 2', '  two.items[3] = "x"',
    '  expect(one.items).toEqual(two.items)',
    '})',
    'it("different member arrays", () => {',
    '  one = Bag()', '  two = Bag()',
    '  one.items[3] = "x"', '  two.items[3] = "y"',
    '  expect(one.items).toEqual(two.items)',
    '})',
    'it("instances are compared by handle, not by member", () => {',
    '  one = Bag()', '  two = Bag()',
    '  expect(one).toEqual(one)',
    '  expect(one).not.toEqual(two)',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: ["equal member arrays", "instances are compared by handle, not by member"],
    failed: ["different member arrays"],
  });
});

test("toEqual compares lists, dictionaries holding length and the keys 0 to length - 1, key by key", () => {
  const report = run([
    'it("equal lists", () => {',
    '  one = {}', '  one["0"] = "a"', '  one["1"] = "b"', '  one.length = 2',
    '  two = {}', '  two["0"] = "a"', '  two["1"] = "b"', '  two.length = 2',
    '  expect(one).toEqual(two)',
    '})',
    'it("a differing entry", () => {',
    '  one = {}', '  one["0"] = "a"', '  one.length = 1',
    '  two = {}', '  two["0"] = "z"', '  two.length = 1',
    '  expect(one).toEqual(two)',
    '})',
    'it("length is compared too", () => {',
    '  one = {}', '  one["0"] = "a"', '  one.length = 1',
    '  two = {}', '  two["0"] = "a"', '  two.length = 2',
    '  expect(one).toEqual(two)',
    '})',
  ].join("\n"));
  deepEqual(verdicts(report), { passed: ["equal lists"], failed: ["a differing entry", "length is compared too"] });
});

test("toEqual never converts between numbers and strings: 5 is not \"5\"", () => {
  const report = run([
    'it("scalars", () => { expect(5).toEqual("5") })',
    'it("array elements", () => { a[0] = 5; b[0] = "5"; expect(a).toEqual(b) })',
    'it("array elements, not.toEqual", () => { a[0] = 5; b[0] = "5"; expect(a).not.toEqual(b) })',
    'it("dictionary members", () => { one = { k: 5 }; two = { k: "5" }; expect(one).toEqual(two) })',
    'it("equal strings and numbers", () => { expect(5).toEqual(5); expect("5").toEqual("5"); expect(0 - 0).toEqual(0) })',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: ["array elements, not.toEqual", "equal strings and numbers"],
    failed: ["scalars", "array elements", "dictionary members"],
  });
  equal(caseOf(report, "scalars").outcomes[0]!.expected, '"5"');
  equal(caseOf(report, "scalars").outcomes[0]!.actual, "5");
});

test("toBe is strict: same type and value, arrays and instances by identity", () => {
  const report = run([
    'class Box {',
    '  public:',
    '  var n',
    '}',
    'it("same number", () => { expect(5).toBe(5) })',
    'it("number is not a string", () => { expect(5).toBe("5") })',
    'it("string is not a number", () => { expect("5").toBe(5) })',
    'it("same string", () => { expect("a").toBe("a") })',
    'it("an array is itself", () => { a[0] = 1; expect(a).toBe(a) })',
    'it("an equal array is not the same array", () => { a[0] = 1; b[0] = 1; expect(a).toBe(b) })',
    'it("an equal array is not the same array, not.toBe", () => { a[0] = 1; b[0] = 1; expect(a).not.toBe(b) })',
    'it("an instance is itself", () => { one = Box(); expect(one).toBe(one) })',
    'it("another instance is not it", () => { one = Box(); two = Box(); expect(one).toBe(two) })',
    'it("a dictionary is itself, an equal one is not", () => { d = { k: 1 }; e = { k: 1 }; expect(d).toBe(d); expect(d).not.toBe(e) })',
    'it("a callable is itself", () => { f = (x) => x; expect(f).toBe(f) })',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: [
      "same number", "same string", "an array is itself", "an equal array is not the same array, not.toBe",
      "an instance is itself", "a dictionary is itself, an equal one is not", "a callable is itself",
    ],
    failed: ["number is not a string", "string is not a number", "an equal array is not the same array", "another instance is not it"],
  });
});

test("toContain searches a string, an element array and a list, never a list's length", () => {
  const report = run([
    'it("substring", () => { expect("hello world").toContain("lo w") })',
    'it("substring is case-sensitive", () => { expect("Hello").toContain("hello") })',
    'it("string needle must be a string", () => { expect("a5").toContain(5) })',
    'it("string needle must be a string, not.toContain", () => { expect("a5").not.toContain(5) })',
    'it("array holds a number", () => { a[0] = 5; a[1] = "x"; expect(a).toContain(5) })',
    'it("array holds a string", () => { a[0] = 5; a[1] = "x"; expect(a).toContain("x") })',
    'it("array does not hold 5 as a string", () => { a[0] = 5; expect(a).toContain("5") })',
    'it("array does not hold 5 as a string, not.toContain", () => { a[0] = 5; expect(a).not.toContain("5") })',
    'it("array holds a sub-array", () => { a[0][0] = 1; a[0][1] = 2; s[0] = 1; s[1] = 2; expect(a).toContain(s) })',
    'it("list holds an entry", () => { l = {}; l["0"] = "a"; l["1"] = "b"; l.length = 2; expect(l).toContain("b") })',
    'it("list does not hold its length", () => { l = {}; l["0"] = "a"; l.length = 1; expect(l).toContain(1) })',
    'it("list does not hold its length, not.toContain", () => { l = {}; l["0"] = "a"; l.length = 1; expect(l).not.toContain(1) })',
    'it("list ignores entries past its length", () => { l = {}; l["0"] = "a"; l["1"] = "b"; l.length = 1; expect(l).toContain("b") })',
    'it("a number holds nothing", () => { expect(5).toContain(5) })',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: [
      "substring", "string needle must be a string, not.toContain", "array holds a number", "array holds a string",
      "array does not hold 5 as a string, not.toContain", "array holds a sub-array", "list holds an entry",
      "list does not hold its length, not.toContain",
    ],
    failed: [
      "substring is case-sensitive", "string needle must be a string", "array does not hold 5 as a string",
      "list does not hold its length", "list ignores entries past its length", "a number holds nothing",
    ],
  });
  equal(caseOf(report, "list does not hold its length").outcomes[0]!.actual, '{"0": "a", "length": 1}');
});

test("toBeCloseTo compares stored doubles at the tolerance: fractions pass and fail at 0.001", () => {
  const report = run([
    'it("inside", () => { expect(0.30000000000000004).toBeCloseTo(0.3, 0.001) })',
    'it("on the edge", () => { expect(1.5).toBeCloseTo(1.25, 0.25) })',
    'it("outside", () => { expect(0.5).toBeCloseTo(0.3, 0.001) })',
    'it("outside, not.toBeCloseTo", () => { expect(0.5).not.toBeCloseTo(0.3, 0.001) })',
    'it("inside, not.toBeCloseTo", () => { expect(0.3).not.toBeCloseTo(0.3, 0.001) })',
    'it("a stored double passed directly", () => { y = 1 / 3; expect(y).toBeCloseTo(0.333, 0.001) })',
    'it("a computed result", () => { expect(1 / 3).toBeCloseTo(0.3333, 0.0001) })',
    'it("SEM-3: a name read in the tested code already truncated", () => { x = 1.5; expect(x + 0.25).toBeCloseTo(1.25, 0.001) })',
    'it("SEM-3 truncation is visible", () => { x = 1.5; expect(x + 0.25).toBeCloseTo(1.75, 0.001) })',
    'it("a string is not a number", () => { expect("1").toBeCloseTo(1, 0.5) })',
    'it("a negative tolerance", () => { expect(1).toBeCloseTo(1, -1) })',
    'it("a tolerance is read as stored", () => { t = 0.001; expect(0.0005).toBeCloseTo(0, t) })',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: [
      "inside", "on the edge", "outside, not.toBeCloseTo", "a stored double passed directly", "a computed result",
      "SEM-3: a name read in the tested code already truncated", "a tolerance is read as stored",
    ],
    failed: ["outside", "inside, not.toBeCloseTo", "SEM-3 truncation is visible", "a string is not a number", "a negative tolerance"],
  });
  equal(caseOf(report, "outside").outcomes[0]!.expected, "0.3 ± 0.001");
  equal(caseOf(report, "outside").outcomes[0]!.actual, "0.5");
});

test("toBeCloseTo with one argument is the located failure callable.arity", () => {
  const report = run('it("one argument", () => {\n  expect(3).toBeCloseTo(3)\n})');
  const failure = caseOf(report, "one argument");
  equal(failure.ok, false);
  const outcome = failure.outcomes[0];
  ok(outcome?.actual.startsWith("callable.arity"), outcome?.actual);
  equal(outcome?.line, 2);
  ok(report.failures.some((item) => item.includes("callable.arity") && item.includes("(line 2)")));
});

test("toThrow passes on an error raised in a nested call, without failing the case", () => {
  const report = run([
    'function inner() { missingCommand() }',
    'function outer() { inner() }',
    'it("a nested call raises", () => { expect(() => outer()).toThrow() })',
    'it("a direct raise", () => { expect(() => { missingCommand() }).toThrow() })',
    'it("nothing raised", () => { expect(() => { }).toThrow() })',
    'it("nothing raised, not.toThrow", () => { expect(() => { }).not.toThrow() })',
    'it("raised, not.toThrow", () => { expect(() => outer()).not.toThrow() })',
    'it("two in one case", () => { expect(() => outer()).toThrow(); expect(() => inner()).toThrow() })',
    'it("an error outside the window still fails the case", () => { expect(() => outer()).toThrow(); missingAgain() })',
  ].join("\n"));
  deepEqual(verdicts(report), {
    passed: ["a nested call raises", "a direct raise", "nothing raised, not.toThrow", "two in one case"],
    failed: ["nothing raised", "raised, not.toThrow", "an error outside the window still fails the case"],
  });
  // The consumed error leaves no runtime-error outcome behind, only the matcher's own.
  deepEqual(caseOf(report, "a nested call raises").outcomes.map((item) => item.label), ["a nested call raises/toThrow"]);
  equal(caseOf(report, "nothing raised").outcomes[0]!.actual, "no error");
  equal(caseOf(report, "raised, not.toThrow").outcomes[0]!.actual, "unknown.command");
  // Only the error raised after the window closed is reported.
  const outside = caseOf(report, "an error outside the window still fails the case");
  deepEqual(outside.outcomes.map((item) => item.label), ["an error outside the window still fails the case/toThrow", "an error outside the window still fails the case/runtime error"]);
  ok(outside.outcomes[1]!.actual.includes("missingagain"));
});

test("toThrow fails in both polarities when the subject is not a callable", () => {
  const report = run([
    'it("a number", () => { expect(5).toThrow() })',
    'it("a number, not.toThrow", () => { expect(5).not.toThrow() })',
    'it("an array", () => { a[0] = 1; expect(a).toThrow() })',
  ].join("\n"));
  deepEqual(verdicts(report), { passed: [], failed: ["a number", "a number, not.toThrow", "an array"] });
  equal(caseOf(report, "a number").outcomes[0]!.expected, "a function");
});

test("two runs of a matcher spec give identical result JSON and identical state hashes", () => {
  const spec = [
    'class Bag {',
    '  public:',
    '  var items[]',
    '}',
    'function raise() { missingCommand() }',
    'describe("everything", () => {',
    '  beforeAll(() => { shared = 7 })',
    '  it("arrays", () => { a[0][1] = 1; b[0][1] = 1; expect(a).toEqual(b); expect(a).not.toBe(b) })',
    '  it("objects", () => { one = Bag(); one.items[2] = "x"; expect(one.items).toContain("x"); expect(one).toBe(one) })',
    '  it("close", () => { expect(0.1 + 0.2).toBeCloseTo(0.3, 0.001) })',
    '  it("throw", () => { expect(() => raise()).toThrow() })',
    '  it("group snapshot", () => { expect(shared).toBe(7) })',
    '})',
  ].join("\n");
  const first = run(spec);
  const second = run(spec);
  equal(JSON.stringify(first), JSON.stringify(second));
  deepEqual(verdicts(first).failed, []);
  for (const item of first.cases) ok(item.stateHash.length > 0);
  deepEqual(first.cases.map((item) => item.stateHash), second.cases.map((item) => item.stateHash));
});

test("the spec package is absent from the default manifest and its twelve commands pass the command-docs gate", () => {
  equal(ENGINE_DEFAULT_MANIFEST.some((entry) => entry.id === SPEC_PLUGIN.id), false);
  equal(SPEC_PLUGIN.commands.length, 12);
  // The gate checks the spec package's documentation too; it reads the built core and script-spec, which `tsc -b`
  // writes before the tests run.
  const gate = join(import.meta.dirname, "..", "..", "..", "tools", "command-docs", "check.mjs");
  const result = spawnSync(process.execPath, [gate], { encoding: "utf8" });
  equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
