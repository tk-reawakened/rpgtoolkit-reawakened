import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_DEFAULT_MANIFEST } from "@tk-reawakened/core";
import { discoverCases, failureMessage, ONLY_WARNING, runSpecFile, SPEC_PLUGIN } from "../src/index.ts";

/**
 * The runner (TOOL-5): discovery, a fresh fixture per case, determinism, strict
 * mode failing a skip, `only` narrowing with a warning, the exact failure
 * message, and the package's absence from the engine's default manifest.
 *
 * The three matchers blocked on F-A (element-wise toEqual, array toContain,
 * toThrow) are deliberately absent from these fixtures.
 */

const library = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package", "startup.prg"), "utf8");

const SPEC = [
  'describe("math", () => {',
  '  it("adds", () => { expect(1 + 1).toBe(2) })',
  '  it("subtracts", () => { expect(3 - 1).toBe(1) })',
  '})',
  'it("fresh", () => { expect(leak).toBe(0) })',
  'it("leaky", () => { leak = 1; expect(leak).toBe(1) })',
  'skip("omitted", () => { expect(1).toBe(1) })',
].join("\n");

test("discovery lists every case in source order, the skipped one included", () => {
  deepEqual(discoverCases(library, SPEC), ["adds", "subtracts", "fresh", "leaky", "omitted"]);
});

test("discovery registers duplicate and assertion-free cases without running their bodies", () => {
  const source = [
    'it("same", () => { missingCommand() })',
    'it("same", () => { })',
    'it("empty", () => { })',
  ].join("\n");
  deepEqual(discoverCases(library, source), ["same", "same", "empty"]);
  const report = runSpecFile("cases.spec.prg", source, { library });
  equal(report.cases.length, 3);
  equal(report.cases[0]?.ok, false);
  equal(report.cases[1]?.ok, true);
  equal(report.cases[2]?.ok, true);
  ok(report.failures[0]?.includes("unknown.command"));
});

test("a top-level failure cannot turn discovery into a successful empty run", () => {
  throws(() => discoverCases(library, "missingCommand()"), /discovery failed/);
});

test("every case runs on a fresh fixture: a global set by one case is unset in the next", () => {
  const report = runSpecFile("math.spec.prg", SPEC, { library });
  equal(report.cases.find((item) => item.name === "fresh")?.ok, true);
  equal(report.cases.find((item) => item.name === "leaky")?.ok, true);
});

test("board and selected party actor are fresh for every case", () => {
  const source = [
    'it("change", () => { HP! = 3; ambientRed = 7; expect(HP!).toBe(3); expect(ambientRed).toBe(7) })',
    'it("fresh", () => { expect(HP!).toBe(10); expect(ambientRed).toBe(0) })',
  ].join("\n");
  const report = runSpecFile("fixtures.spec.prg", source, { library });
  deepEqual(report.cases.map((item) => item.ok), [true, true]);
});

test("truthy matcher follows the RPGCode truth test for strings and numbers", () => {
  const source = [
    'it("truth", () => {',
    '  expect("").toBeTruthy()',
    '  expect("0").toBeTruthy()',
    '  expect("OFF").not.toBeTruthy()',
    '  expect(0).not.toBeTruthy()',
    '  expect(1).toBeTruthy()',
    '})',
  ].join("\n");
  const report = runSpecFile("truth.spec.prg", source, { library });
  equal(report.cases[0]?.ok, true, JSON.stringify(report.failures));
  equal(report.cases[0]?.outcomes.length, 5);
});

test("multiple hooks of the same kind all run in registration order", () => {
  const source = [
    'describe("hooks", () => {',
    '  beforeEach(() => { specResult("pass", "before1", "", "") })',
    '  beforeEach(() => { specResult("pass", "before2", "", "") })',
    '  afterEach(() => { specResult("pass", "after1", "", "") })',
    '  afterEach(() => { specResult("pass", "after2", "", "") })',
    '  afterAll(() => { specResult("pass", "all1", "", "") })',
    '  afterAll(() => { specResult("pass", "all2", "", "") })',
    '  it("example", () => { expect(1).toBe(1) })',
    '})',
  ].join("\n");
  const report = runSpecFile("hooks.spec.prg", source, { library });
  deepEqual(report.cases[0]?.outcomes.map((item) => item.label), [
    "before1", "before2", "example/toBe", "after1", "after2", "all1", "all2",
  ]);
});

test("two runs of the same file give identical outcomes and identical state hashes", () => {
  const first = runSpecFile("math.spec.prg", SPEC, { library });
  const second = runSpecFile("math.spec.prg", SPEC, { library });
  deepEqual(first, second);
  for (const item of first.cases) equal(item.stateHash.length > 0, true);
});

test("strict mode fails a skip; the lenient run tolerates it and still reports it", () => {
  const strict = runSpecFile("math.spec.prg", SPEC, { library, strict: true });
  equal(strict.cases.find((item) => item.name === "omitted")?.ok, false);
  deepEqual(strict.skipped, ["omitted"]);
  const lenient = runSpecFile("math.spec.prg", SPEC, { library, strict: false });
  equal(lenient.cases.find((item) => item.name === "omitted")?.ok, true);
  deepEqual(lenient.skipped, ["omitted"]);
  equal(strict.failures.includes("math.spec.prg: omitted: skipped in strict mode"), true);
  equal(lenient.failures.includes("math.spec.prg: omitted: skipped in strict mode"), false);
});

test("a failing scalar assertion reports the exact message, expected against actual", () => {
  const report = runSpecFile("math.spec.prg", SPEC, { library });
  const failing = report.cases.find((item) => item.name === "subtracts");
  ok(failing);
  const [outcome] = failing.outcomes;
  ok(outcome);
  equal(failureMessage(outcome), "toBe: expected 1, actual 2");
  equal(outcome.line, 3);
  deepEqual(report.failures, ["math.spec.prg: subtracts: toBe: expected 1, actual 2 (line 3)", "math.spec.prg: omitted: skipped in strict mode"]);
});

test("only narrows the run and warns with the documented text", () => {
  const source = ['it("marked", () => { expect(1).toBe(1) })', 'only("chosen", () => { expect(2).toBe(2) })'].join("\n");
  const report = runSpecFile("only.spec.prg", source, { library });
  equal(report.warning, ONLY_WARNING);
  equal(report.warning, "only() narrowed the run to the marked cases; unmarked cases were not run");
  deepEqual(report.cases.map((item) => item.name), ["chosen"]);
  equal(report.cases[0]?.ok, true);
  equal(report.cases[0]?.outcomes.some((item) => item.kind === "only"), true);
});

test("script-spec is absent from the engine's default manifest, and registers only specresult", () => {
  equal(ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id).includes("script-spec"), false);
  deepEqual(SPEC_PLUGIN.commands.map((command) => command.name), ["specresult"]);
});
