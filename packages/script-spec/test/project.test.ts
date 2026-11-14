import { Buffer } from "node:buffer";
import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { discoverProjectSpecs, runSpecProject } from "../src/index.ts";

function writeProjectFile(root: string, path: string, source: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}
test("project consumer discovers and runs only recursively nested spec programs", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-"));
  try {
    writeProjectFile(root, "z-last.spec.prg", 'it("last", () => { expect(3).toBe(3) })');
    writeProjectFile(root, "tests/a-first.spec.prg", 'it("first", () => { expect(1).toBe(1) })');
    writeProjectFile(root, "tests/deep/middle.spec.prg", 'it("middle", () => { expect(2).toBe(2) })');
    writeProjectFile(root, "tests/not-a-spec.prg", 'it("ignored", () => { expect(0).toBe(1) })');
    writeProjectFile(root, "tests/almost.spec.prg.txt", 'it("ignored too", () => { expect(0).toBe(1) })');
    // The core resolver folds case, so discovery does too: a spec the loader
    // would serve must never be silently skipped.
    writeProjectFile(root, "tests/case.SPEC.PRG", 'it("case variant", () => { expect(4).toBe(4) })');

    deepEqual(discoverProjectSpecs(root), [
      "tests/a-first.spec.prg",
      "tests/case.SPEC.PRG",
      "tests/deep/middle.spec.prg",
      "z-last.spec.prg",
    ]);

    const report = runSpecProject(root);
    deepEqual(report.files.map((file) => file.file), [
      "tests/a-first.spec.prg",
      "tests/case.SPEC.PRG",
      "tests/deep/middle.spec.prg",
      "z-last.spec.prg",
    ]);
    deepEqual(report.files.map((file) => file.cases.map((item) => item.name)), [["first"], ["case variant"], ["middle"], ["last"]]);
    equal(report.files.every((file) => file.cases.every((item) => item.ok)), true);
    deepEqual(report.failures, []);
    deepEqual(report.skipped, []);
    deepEqual(report.warnings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project consumer prefixes failing cases with their relative spec path", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-failure-"));
  try {
    writeProjectFile(root, "nested/failing.spec.prg", 'it("bad", () => { expect(1).toBe(2) })');

    const report = runSpecProject(root);
    deepEqual(report.failures, ["nested/failing.spec.prg: bad: toBe: expected 2, actual 1 (line 1)"]);
    equal(report.files[0]?.cases[0]?.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only in one project file excludes unmarked cases in every other file", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-only-"));
  try {
    writeProjectFile(root, "a-unmarked.spec.prg", 'it("unmarked", () => { expect(1).toBe(1) })');
    writeProjectFile(root, "z-marked.spec.prg", 'only("selected", () => { expect(2).toBe(2) })');

    const report = runSpecProject(root);
    deepEqual(report.files.map((file) => [file.file, file.cases.map((item) => item.name)]), [
      ["z-marked.spec.prg", ["selected"]],
    ]);
    equal(report.warnings.length, 1);
    deepEqual(report.failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project consumer resolves Prg includes and decodes project scripts as Windows-1252", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-include-"));
  try {
    const programDirectory = join(root, "Prg");
    mkdirSync(programDirectory, { recursive: true });
    writeFileSync(join(programDirectory, "helper.prg"), Buffer.from('function greeting() { return "café" }\n', "latin1"));

    const specPath = join(root, "included.spec.prg");
    writeFileSync(specPath, Buffer.from(
      '#include "HELPER.prg"\nit("café", () => { expect(greeting()).toBe("café") })\n',
      "latin1",
    ));

    const report = runSpecProject(root);
    equal(report.files[0]?.cases[0]?.name, "café");
    equal(report.files[0]?.cases[0]?.ok, true);
    deepEqual(report.failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project thread programs run during cooperative waits but pause during blocking waits", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-thread-"));
  try {
    writeProjectFile(root, "Prg/worker.prg", [
      "while (true) {",
      "  ticked = ticked + 1",
      "  threadSleep(getThreadId(), 1 / 60)",
      "}",
    ].join("\n"));
    writeProjectFile(root, "thread.spec.prg", [
      'it("runs project programs as threads", () => {',
      "  ticked = 0",
      "  inlineRan = 0",
      '  workerId = thread("worker.prg", 0)',
      '  inlineId = thread("inlineRan = 1", 0)',
      "  specTicks(3)",
      "  running = ticked",
      "  sleep(3)",
      "  expect(running).toBeTruthy()",
      "  expect(ticked).toBe(running)",
      "  expect(inlineRan).toBe(1)",
      "  killThread(workerId)",
      "  killThread(inlineId)",
      "})",
    ].join("\n"));

    const report = runSpecProject(root);
    equal(report.files[0]?.cases[0]?.ok, true);
    deepEqual(report.failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("project thread load failures report, continue the caller, and register no thread", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-project-thread-load-"));
  try {
    const programDirectory = join(root, "Prg");
    mkdirSync(programDirectory, { recursive: true });
    writeFileSync(join(programDirectory, "compiled.prg"), Buffer.from([0]));
    writeProjectFile(root, "Prg/malformed.prg", "if (\n");
    writeProjectFile(root, "thread-load.spec.prg", [
      'it("continues after load failures", () => {',
      "  compiledId = 99",
      '  compiledResult = thread("compiled.prg", 0, compiledId)',
      "  compiledContinued = 1",
      "  expect(compiledContinued).toBe(1)",
      "  expect(compiledResult).toBe(0)",
      "  expect(compiledId).toBe(0)",
      "  expect(() => killThread(compiledResult)).toThrow()",
      "  malformedId = 99",
      '  malformedResult = thread("malformed.prg", 0, malformedId)',
      "  malformedContinued = 1",
      "  expect(malformedContinued).toBe(1)",
      "  expect(malformedResult).toBe(0)",
      "  expect(malformedId).toBe(0)",
      "  expect(() => killThread(malformedResult)).toThrow()",
      "})",
    ].join("\n"));

    const report = runSpecProject(root);
    const result = report.files[0]?.cases[0];
    ok(result);
    equal(result.outcomes.filter((outcome) => outcome.kind === "pass").length, 8);
    equal(result.outcomes.some((outcome) => outcome.actual.startsWith("program.compiled:")), true);
    equal(result.outcomes.some((outcome) => outcome.actual.startsWith("syntax.error:")), true);
    equal(result.outcomes.some((outcome) => outcome.actual.startsWith("spec.timeout:")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package specs execute the manifest's real startup, not an unrelated Prg file", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-package-"));
  try {
    writeProjectFile(root, "manifest.json", JSON.stringify({ name: "test-package", program: "startup.prg" }));
    writeProjectFile(root, "startup.prg", "packageValue = 17");
    writeProjectFile(root, "Prg/startup.prg", "packageValue = 99");
    writeProjectFile(root, "probe.spec.prg",
      'it("loads the package", () => { executeProgram("startup.prg"); expect(packageValue).toBe(17) })');
    const report = runSpecProject(root);
    equal(report.files[0]?.cases[0]?.ok, true);
    deepEqual(report.failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
