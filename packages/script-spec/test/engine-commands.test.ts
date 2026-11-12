import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { runSpecFile, type SpecCaseResult, type SpecFileReport } from "../src/index.ts";

/**
 * The runner runs a spec on the real engine command set (TOOL-5, "creator tests": it runs the real engine, not a
 * pretend one): the engine default manifest's built-ins plus the script-spec natives. Issue #1940: the runner used to
 * register only the natives, so a spec could not call `len`, `castint`, `autoLocal` or an `on error` form.
 */

function run(spec: string): SpecFileReport {
  return runSpecFile("engine.spec.prg", spec, {});
}

function caseOf(report: SpecFileReport, name: string): SpecCaseResult {
  const found = report.cases.find((item) => item.name === name);
  ok(found, `no case "${name}" in ${JSON.stringify(report.cases.map((item) => item.name))}`);
  return found;
}

test("a spec calls built-in commands: len, castint and instr", () => {
  const report = run([
    'it("len", () => { expect(len("abc")).toBe(3) })',
    'it("castint", () => { expect(castint(7.9)).toBe(7) })',
    'it("instr", () => { expect(instr("hello", "ll")).toBe(3) })',
  ].join("\n"));
  deepEqual(report.failures, []);
  deepEqual(report.cases.map((item) => [item.name, item.ok]), [["len", true], ["castint", true], ["instr", true]]);
});

test("a spec calls autoLocal and a function that sets an on error handler, and passes", () => {
  const report = run([
    'function scoped() { autoLocal(true); inner = 5; seen = inner; autoLocal(false); return seen }',
    'function guarded() { on error goto :h; n = len("ab"); return n; :h; return -1 }',
    'function resumes() { on error resume next; n = castint(2.9); return n }',
    'it("autoLocal keeps a new variable local to its function", () => { x = scoped(); expect(x).toBe(5); expect(inner).toBeNull() })',
    'it("on error goto, no error raised", () => { expect(guarded()).toBe(2) })',
    'it("on error resume next, no error raised", () => { expect(resumes()).toBe(2) })',
  ].join("\n"));
  deepEqual(report.failures, []);
  deepEqual(report.cases.map((item) => item.ok), [true, true, true]);
});

test("toThrow stays a pass for .not.toThrow over a function whose own handler takes the error", () => {
  // A failure a handler took is not an unhandled one, so the matcher must not count it (core pair:
  // packages/core/test/script-command-view-seams.test.ts "a failure a handler took is not consumed").
  // The handled failure is still a host diagnostic (ERR-2), so the runner still lists it as a `runtime error`
  // outcome of the case; whether a handled failure should fail a case is a separate ruling, not pinned here.
  const report = run([
    'function swallow() { on error resume next; missingA() }',
    'function labelled() { on error goto :h; missingB(); :h; x = 1 }',
    'function raise() { missingC() }',
    'it("resume next handles it", () => { expect(() => swallow()).not.toThrow() })',
    'it("goto handler handles it", () => { expect(() => labelled()).not.toThrow() })',
    'it("resume next handled, toThrow fails", () => { expect(() => swallow()).toThrow() })',
    'it("unhandled still throws", () => { expect(() => raise()).toThrow() })',
    'it("unhandled, not.toThrow fails", () => { expect(() => raise()).not.toThrow() })',
  ].join("\n"));
  const matcher = (name: string) => caseOf(report, name).outcomes.find((item) => item.label === `${name}/toThrow`)!;
  equal(matcher("resume next handles it").kind, "pass");
  equal(matcher("goto handler handles it").kind, "pass");
  equal(matcher("resume next handled, toThrow fails").kind, "fail");
  equal(matcher("resume next handled, toThrow fails").actual, "no error");
  equal(matcher("unhandled still throws").kind, "pass");
  equal(matcher("unhandled, not.toThrow fails").kind, "fail");
  equal(matcher("unhandled, not.toThrow fails").actual, "unknown.command");
  // An unhandled error the window consumed leaves no runtime-error outcome; a handled one is not consumed.
  deepEqual(caseOf(report, "unhandled still throws").outcomes.map((item) => item.label), ["unhandled still throws/toThrow"]);
  ok(caseOf(report, "resume next handles it").outcomes.some((item) => item.label.endsWith("/runtime error")));
});

test("an unknown command still fails the case, on the real command set", () => {
  const report = run('it("typo", () => { expect(lenn("abc")).toBe(3) })');
  const failing = caseOf(report, "typo");
  equal(failing.ok, false);
  ok(failing.outcomes.some((outcome) => outcome.actual.includes("unknown.command")));
});
