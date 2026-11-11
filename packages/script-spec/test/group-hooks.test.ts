import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { discoverCases, NO_CASES, runSpecFile, type SpecCaseResult, type SpecFileReport } from "../src/index.ts";

/**
 * Group hooks and `spec.no-cases` (TOOL-5, docs/spec/engine/rpgcode-tooling.md#tool-5-group-hooks): a describe's
 * `beforeAll` runs once, every case of the group starts from the snapshot taken after it (nested groups chain their
 * snapshots), `afterAll` runs once from the group's snapshot after the group's last case, and a failing `beforeAll`
 * fails every case of its group while its `afterAll` still runs. The hooks record outcomes with `specResult`, so the
 * report shows where each hook ran.
 */

function run(spec: string): SpecFileReport {
  return runSpecFile("hooks.spec.prg", spec, {});
}

function caseOf(report: SpecFileReport, name: string): SpecCaseResult {
  const found = report.cases.find((item) => item.name === name);
  ok(found, `no case "${name}" in ${JSON.stringify(report.cases.map((item) => item.name))}`);
  return found;
}

function labels(report: SpecFileReport, name: string): string[] {
  return caseOf(report, name).outcomes.map((item) => item.label);
}

test("a case starts from the group's post-setup snapshot, not from the previous case's state", () => {
  const report = run([
    'describe("group", () => {',
    '  beforeAll(() => { setup = setup + 1; box = { n: 5 } })',
    '  it("changes everything", () => { expect(setup).toBe(1); setup = 99; box.n = 6; later = 1 })',
    '  it("sees none of it", () => { expect(setup).toBe(1); expect(box.n).toBe(5); expect(later).toBe(0) })',
    '})',
    'it("outside the group the fixture is fresh", () => { expect(setup).toBe(0); expect(later).toBe(0) })',
  ].join("\n"));
  deepEqual(report.failures, []);
  deepEqual(report.cases.map((item) => item.ok), [true, true, true]);
});

test("beforeAll and afterAll each run once per group: afterAll's outcomes sit on the last case alone", () => {
  const report = run([
    'describe("group", () => {',
    '  beforeAll(() => { setup = 1; specResult("pass", "setup", "", "") })',
    '  afterAll(() => { specResult("pass", "teardown", "", ""); expect(setup).toBe(1) })',
    '  it("first", () => { setup = 50; expect(setup).toBe(50) })',
    '  it("second", () => { setup = 60; expect(setup).toBe(60) })',
    '  it("third", () => { expect(setup).toBe(1) })',
    '})',
  ].join("\n"));
  deepEqual(report.failures, []);
  // afterAll ran from the group's snapshot (setup is 1, not the 60 a case left), once, after the last case.
  deepEqual(labels(report, "first"), ["setup", "first/toBe"]);
  deepEqual(labels(report, "second"), ["setup", "second/toBe"]);
  deepEqual(labels(report, "third"), ["setup", "third/toBe", "teardown", "afterAll/toBe"]);
});

test("a case with no assertion of its own is still reported, whatever its group's hooks recorded", () => {
  const report = run([
    'describe("group", () => {',
    '  beforeAll(() => { specResult("pass", "setup", "", "") })',
    '  it("asserts nothing", () => { })',
    '})',
  ].join("\n"));
  equal(caseOf(report, "asserts nothing").ok, false);
  deepEqual(report.failures, ["hooks.spec.prg: asserts nothing: recorded no assertion"]);
});

test("nested groups chain their snapshots: an inner beforeAll runs from the outer snapshot", () => {
  const report = run([
    'describe("outer", () => {',
    '  beforeAll(() => { level = level + 1; specResult("pass", "outer setup", "", "") })',
    '  afterAll(() => { specResult("pass", "outer teardown", "", ""); expect(level).toBe(1) })',
    '  beforeEach(() => { specResult("pass", "outer each", "", "") })',
    '  afterEach(() => { specResult("pass", "outer after each", "", "") })',
    '  it("outer one", () => { expect(level).toBe(1); level = 500 })',
    '  describe("inner", () => {',
    '    beforeAll(() => { level = level + 10; specResult("pass", "inner setup", "", "") })',
    '    afterAll(() => { specResult("pass", "inner teardown", "", ""); expect(level).toBe(11) })',
    '    beforeEach(() => { specResult("pass", "inner each", "", "") })',
    '    afterEach(() => { specResult("pass", "inner after each", "", "") })',
    '    it("inner one", () => { expect(level).toBe(11); level = 500 })',
    '    it("inner two", () => { expect(level).toBe(11) })',
    '  })',
    '  it("outer two", () => { expect(level).toBe(1) })',
    '})',
  ].join("\n"));
  deepEqual(report.failures, []);
  deepEqual(labels(report, "outer one"), ["outer setup", "outer each", "outer one/toBe", "outer after each"]);
  deepEqual(labels(report, "inner one"), [
    "outer setup", "inner setup", "outer each", "inner each", "inner one/toBe", "inner after each", "outer after each",
  ]);
  // The inner afterAll follows the inner group's last case; the outer one follows the outer group's.
  deepEqual(labels(report, "inner two"), [
    "outer setup", "inner setup", "outer each", "inner each", "inner two/toBe", "inner after each", "outer after each",
    "inner teardown", "afterAll/toBe",
  ]);
  deepEqual(labels(report, "outer two"), [
    "outer setup", "outer each", "outer two/toBe", "outer after each", "outer teardown", "afterAll/toBe",
  ]);
});

test("a hook applies to every case of its group, wherever in the group it was written", () => {
  const report = run([
    'describe("late hooks", () => {',
    '  it("before the hooks are written", () => { expect(v).toBe(7); expect(w).toBe(1) })',
    '  beforeAll(() => { v = 7 })',
    '  beforeEach(() => { w = 1 })',
    '})',
  ].join("\n"));
  deepEqual(report.failures, []);
});

test("hooks written outside any describe belong to the file, as the outermost group", () => {
  const report = run([
    'beforeAll(() => { shared = 3; specResult("pass", "file setup", "", "") })',
    'afterAll(() => { specResult("pass", "file teardown", "", "") })',
    'it("one", () => { expect(shared).toBe(3); shared = 0 })',
    'describe("group", () => { it("two", () => { expect(shared).toBe(3) }) })',
  ].join("\n"));
  deepEqual(report.failures, []);
  deepEqual(labels(report, "one"), ["file setup", "one/toBe"]);
  deepEqual(labels(report, "two"), ["file setup", "two/toBe", "file teardown"]);
});

test("a beforeAll that raises an error fails every case of its group, and its afterAll still runs", () => {
  const report = run([
    'describe("broken", () => {',
    '  beforeAll(() => { missingCommand() })',
    '  afterAll(() => { specResult("pass", "teardown ran", "", "") })',
    '  it("first", () => { expect(1).toBe(1) })',
    '  it("second", () => { expect(1).toBe(1) })',
    '})',
    'it("a case outside the group is unaffected", () => { expect(1).toBe(1) })',
  ].join("\n"));
  deepEqual(report.cases.map((item) => item.ok), [false, false, true]);
  for (const name of ["first", "second"]) {
    const failure = caseOf(report, name).outcomes.find((item) => item.kind === "fail");
    ok(failure, name);
    equal(failure.label, `${name}/beforeAll`);
    ok(failure.actual.startsWith("unknown.command"), failure.actual);
    equal(failure.line, 2);
    // The case body did not run: it recorded nothing of its own.
    equal(caseOf(report, name).outcomes.some((item) => item.label === `${name}/toBe`), false);
  }
  ok(labels(report, "second").includes("teardown ran"));
  equal(labels(report, "first").includes("teardown ran"), false);
  equal(report.failures.length, 2);
  ok(report.failures.every((item) => item.includes("beforeAll") && item.includes("unknown.command") && item.includes("(line 2)")));
});

test("a beforeAll whose assertion fails fails every case of its group", () => {
  const report = run([
    'describe("group", () => {',
    '  beforeAll(() => { expect(1).toBe(2) })',
    '  it("a", () => { expect(1).toBe(1) })',
    '  it("b", () => { expect(1).toBe(1) })',
    '})',
  ].join("\n"));
  deepEqual(report.cases.map((item) => item.ok), [false, false]);
  deepEqual(report.failures, [
    "hooks.spec.prg: a: toBe: expected 2, actual 1 (line 2)",
    "hooks.spec.prg: b: toBe: expected 2, actual 1 (line 2)",
  ]);
});

test("an outer beforeAll failure fails the inner group's cases without running the inner hooks", () => {
  const report = run([
    'describe("outer", () => {',
    '  beforeAll(() => { missingCommand() })',
    '  describe("inner", () => {',
    '    beforeAll(() => { specResult("pass", "inner setup ran", "", "") })',
    '    it("deep", () => { expect(1).toBe(1) })',
    '  })',
    '})',
  ].join("\n"));
  equal(caseOf(report, "deep").ok, false);
  equal(labels(report, "deep").includes("inner setup ran"), false);
  equal(labels(report, "deep").includes("deep/toBe"), false);
});

test("a group whose cases are all skipped runs none of its hooks", () => {
  const report = run([
    'describe("skipped", () => {',
    '  beforeAll(() => { specResult("pass", "setup", "", "") })',
    '  afterAll(() => { specResult("pass", "teardown", "", "") })',
    '  skip("later", () => { expect(1).toBe(1) })',
    '})',
    'it("live", () => { expect(1).toBe(1) })',
  ].join("\n"));
  deepEqual(labels(report, "later"), ["later"]);
  equal(report.cases.find((item) => item.name === "later")?.outcomes[0]?.kind, "skip");
  deepEqual(report.skipped, ["later"]);
});

test("only narrows to the focused case's group: the hooks of other groups do not run", () => {
  const report = run([
    'describe("other", () => {',
    '  beforeAll(() => { specResult("pass", "other setup", "", "") })',
    '  it("unfocused", () => { expect(1).toBe(1) })',
    '})',
    'describe("chosen", () => {',
    '  beforeAll(() => { specResult("pass", "chosen setup", "", "") })',
    '  afterAll(() => { specResult("pass", "chosen teardown", "", "") })',
    '  only("focused", () => { expect(1).toBe(1) })',
    '  it("not focused", () => { expect(1).toBe(1) })',
    '})',
  ].join("\n"));
  deepEqual(report.cases.map((item) => item.name), ["focused"]);
  deepEqual(labels(report, "focused"), ["chosen setup", "focused", "focused/toBe", "chosen teardown"]);
});

test("beforeEach and afterEach keep their order and run for every case, group hooks or not", () => {
  const report = run([
    'describe("order", () => {',
    '  beforeEach(() => { specResult("pass", "before 1", "", "") })',
    '  beforeEach(() => { specResult("pass", "before 2", "", "") })',
    '  afterEach(() => { specResult("pass", "after 1", "", "") })',
    '  afterEach(() => { specResult("pass", "after 2", "", "") })',
    '  it("one", () => { expect(1).toBe(1) })',
    '  it("two", () => { expect(1).toBe(1) })',
    '})',
  ].join("\n"));
  for (const name of ["one", "two"]) deepEqual(labels(report, name), ["before 1", "before 2", `${name}/toBe`, "after 1", "after 2"]);
});

test("two runs of a hook spec give identical result JSON and state hashes", () => {
  const spec = [
    'describe("outer", () => {',
    '  beforeAll(() => { level = 1; specResult("pass", "outer setup", "", "") })',
    '  afterAll(() => { specResult("pass", "outer teardown", "", "") })',
    '  describe("inner", () => {',
    '    beforeAll(() => { level = level + 10 })',
    '    it("a", () => { expect(level).toBe(11) })',
    '    it("b", () => { expect(level).toBe(11) })',
    '  })',
    '})',
  ].join("\n");
  const first = run(spec);
  const second = run(spec);
  equal(JSON.stringify(first), JSON.stringify(second));
  deepEqual(first.failures, []);
  for (const item of first.cases) ok(item.stateHash.length > 0);
});

test("a spec file that registers no case is the failing outcome spec.no-cases at line 1", () => {
  // A spec that never reaches the library registers nothing either, so a spec whose include of the package was not
  // found cannot pass silently.
  for (const source of ['describe("nothing", () => { })', "", "// only a comment", 'beforeAll(() => { })\nafterAll(() => { })', "x = 1"]) {
    const report = run(source);
    equal(report.cases.length, 1, source);
    const [only] = report.cases;
    equal(only?.name, NO_CASES);
    equal(only.ok, false);
    equal(only.outcomes[0]?.kind, "fail");
    equal(only.outcomes[0]?.line, 1);
    deepEqual(report.failures, [`hooks.spec.prg: ${NO_CASES}: the spec file registers no case (line 1)`]);
    deepEqual(discoverCases(source), []);
  }
});
