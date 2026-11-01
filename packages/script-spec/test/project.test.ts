import { Buffer } from "node:buffer";
import { deepEqual, equal } from "node:assert/strict";
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
    writeProjectFile(root, "tests/case.SPEC.PRG", 'it("case variant", () => { expect(0).toBe(1) })');

    deepEqual(discoverProjectSpecs(root), [
      "tests/a-first.spec.prg",
      "tests/deep/middle.spec.prg",
      "z-last.spec.prg",
    ]);

    const report = runSpecProject(root);
    deepEqual(report.files.map((file) => file.file), [
      "tests/a-first.spec.prg",
      "tests/deep/middle.spec.prg",
      "z-last.spec.prg",
    ]);
    deepEqual(report.files.map((file) => file.cases.map((item) => item.name)), [["first"], ["middle"], ["last"]]);
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
