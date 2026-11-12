import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { assetKey, createAssetIndex, encodeCp1252, PACKAGE_ROOT } from "@tk-reawakened/core";
import { mergeCoverage, runSpecFile, runSpecProject, toLcov, type SpecCoverage } from "../src/index.ts";
import type { SpecProgramLoader } from "../src/runner.ts";

/**
 * RPGCode line coverage (TOOL-5, docs/spec/engine/rpgcode-tooling.md#tool-5-coverage; #2041), proved through the
 * public runner on authored RPGCode. Every expected count below is worked out by hand from the source shown next to
 * it, never read back from the implementation.
 */

/** `{ line: hits }` of one file, for compact hand-worked expectations. */
function linesOf(coverage: SpecCoverage | undefined, file: string): Record<number, number> {
  const found = coverage?.files.find((item) => item.file === file);
  ok(found, `no coverage for ${file} in ${JSON.stringify(coverage?.files.map((item) => item.file))}`);
  return Object.fromEntries(found.lines.map((item) => [item.line, item.hits]));
}

/** A loader serving project programs from memory, by their `Prg/` paths. */
function memoryLoader(files: Record<string, string>): SpecProgramLoader {
  const bytes = new Map<string, Uint8Array>();
  for (const [path, text] of Object.entries(files)) {
    const encoded = encodeCp1252(text);
    ok(encoded.ok);
    bytes.set(assetKey(path), encoded.value);
  }
  return { index: createAssetIndex(Object.keys(files)), root: PACKAGE_ROOT, read: (key) => bytes.get(key) };
}

test("branches, a loop, a shared line, a multiline expression and an uncalled function, summed over two cases", () => {
  const source = [
    'function pick(a) {', //               1  header: not executable
    '  if (a > 0) {', //                   2  condition: once per call
    '    r = "pos"', //                    3  then-branch
    '  } else {', //                       4  punctuation
    '    r = "neg"', //                    5  else-branch
    '  }', //                              6
    '  return r', //                       7
    '}', //                                8
    'function unused() {', //              9
    '  never = 1', //                     10  executable, never run
    '}', //                               11
    '// a comment', //                    12
    '', //                                13
    'it("positive", () => {', //          14  registration, once per case run
    '  i = 0; n = 0', //                  15  two statements, one execution of the line
    '  while (i < 3) {', //               16  test runs 4 times
    '    i = i + 1', //                   17  body runs 3 times
    '  }', //                             18
    '  total = i +', //                   19  an expression continued onto line 20
    '    len(pick(1))', //                20
    '  expect(pick(1)).toEqual("pos")', //21
    '})', //                              22
    'it("negative", () => {', //          23
    '  expect(pick(-1)).toEqual("neg")', //24
    '})', //                              25
  ].join("\n");
  const report = runSpecFile("game/pick.spec.prg", source, { coverage: true });
  deepEqual(report.cases.map((item) => item.ok), [true, true]);
  // Each case run executes the whole spec program's registration (lines 14 and 23) once; only its own body runs.
  // pick runs twice in "positive" (lines 20, 21) and once in "negative": its condition and return count 3.
  deepEqual(linesOf(report.coverage, "game/pick.spec.prg"), {
    2: 3, 3: 2, 5: 1, 7: 3, 10: 0, 14: 2, 15: 1, 16: 4, 17: 3, 19: 1, 20: 1, 21: 1, 23: 2, 24: 1,
  });
  equal(report.coverage!.files.length, 1, "the bundled library and the appended lines are never listed");
});

test("an included program is one file across specs and spellings, under its project path, summed per logical run", () => {
  const root = mkdtempSync(join(tmpdir(), "script-spec-coverage-"));
  try {
    const write = (path: string, text: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write("Prg/lib/Math.prg", [
      'function double(x) {', //  1
      '  return x * 2', //         2
      '}', //                      3
      'function triple(x) {', //  4
      '  return x * 3', //         5
      '}', //                      6
    ].join("\n"));
    write("Prg/other/math.prg", 'function other() {\n  return 0\n}\n');
    write("specs/a.spec.prg", '#include "lib/Math.prg"\nit("a", () => { expect(double(2)).toEqual(4) })\n');
    write("specs/b.spec.prg", '#include "LIB/MATH.PRG"\nit("b1", () => { expect(double(3)).toEqual(6) })\nit("b2", () => { expect(double(4)).toEqual(8) })\n');
    const report = runSpecProject(root, { coverage: true });
    deepEqual(report.failures, []);
    // Three logical case runs called double once each; triple never ran; other/math.prg was never loaded.
    deepEqual(linesOf(report.coverage, "Prg/lib/Math.prg"), { 2: 3, 5: 0 });
    deepEqual(report.coverage!.files.map((item) => item.file), ["Prg/lib/Math.prg", "specs/a.spec.prg", "specs/b.spec.prg"]);
    deepEqual(linesOf(report.files[1]!.coverage, "Prg/lib/Math.prg"), { 2: 2, 5: 0 });
    deepEqual(report.coverage, mergeCoverage(report.files.map((file) => file.coverage!)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a program loaded at run time is listed under its own path, with its uncalled lines", () => {
  const loader = memoryLoader({
    "Prg/dyn.prg": [
      'loaded = loaded + 1', //      1
      'function spare() {', //       2
      '  wasted = 1', //             3
      '}', //                        4
      'if (loaded > 5) {', //        5
      '  loaded = 0', //             6
      '}', //                        7
    ].join("\n"),
  });
  const report = runSpecFile("dyn.spec.prg", 'it("loads", () => {\n  loaded = 0\n  executeProgram("dyn.prg")\n  expect(loaded).toEqual(1)\n})', { coverage: true, loader });
  deepEqual(report.cases.map((item) => item.ok), [true]);
  deepEqual(linesOf(report.coverage, "Prg/dyn.prg"), { 1: 1, 3: 0, 5: 1, 6: 0 });
});

test("group hooks count once, skipped and unselected bodies count nothing, and the replay is never added", () => {
  const source = [
    'describe("g", () => {', //               1
    '  beforeAll(() => {', //                 2
    '    setup = 1', //                       3  once for the group
    '  })', //                                4
    '  afterAll(() => {', //                  5
    '    teardown = 1', //                    6  once for the group
    '  })', //                                7
    '  beforeEach(() => {', //                8
    '    each = 1', //                        9  once per case run
    '  })', //                               10
    '  it("one", () => { one = 1; expect(one).toEqual(1) })', //   11
    '  it("two", () => { two = 2; expect(two).toEqual(2) })', //   12
    '  skip("three", () => {', //                                  13
    '    three = 3', //                                            14  a skipped body never runs
    '  })', //                                                     15
    '})', //                                 16
  ].join("\n");
  const all = runSpecFile("hooks.spec.prg", source, { coverage: true, strict: false });
  const lines = linesOf(all.coverage, "hooks.spec.prg");
  equal(lines[3], 1, "beforeAll body");
  equal(lines[6], 1, "afterAll body");
  equal(lines[9], 2, "beforeEach body, two cases");
  // Line 11 holds the registration call and the case body. Registration runs in the beforeAll run (cases and the
  // afterAll resume from its snapshot, past registration) and again in the skipped case's run, which starts from a
  // fresh fixture; the body runs once in case "one": 1 + 1 + 1.
  equal(lines[11], 3);
  equal(lines[13], 2, "skip registration: the beforeAll run and the skipped case's own run");
  equal(lines[14], 0, "a skipped body never runs");
  const one = runSpecFile("hooks.spec.prg", source, { coverage: true, strict: false, name: "one" });
  const selected = linesOf(one.coverage, "hooks.spec.prg");
  equal(selected[9], 1, "an unselected case runs no hook and no body");
  equal(selected[12], 1, "line 12's registration ran in setup; its body did not");
  equal(selected[13], 1, "the unselected skip case does not run at all");
});

test("LCOV text is exact, deterministic and matches the coverage data; empty coverage is empty text", () => {
  const source = 'function f() {\n  return 1\n}\nfunction g() {\n  return 2\n}\nit("c", () => { expect(f()).toEqual(1) })\n';
  const first = runSpecFile("lcov.spec.prg", source, { coverage: true });
  const second = runSpecFile("lcov.spec.prg", source, { coverage: true });
  equal(toLcov(first.coverage!), "SF:lcov.spec.prg\nDA:2,1\nDA:5,0\nDA:7,1\nLF:3\nLH:2\nend_of_record\n");
  equal(toLcov(first.coverage!), toLcov(second.coverage!));
  deepEqual(first, second);
  equal(toLcov({ files: [] }), "");
  equal(toLcov(mergeCoverage([])), "");
});

test("coverage is opt-in and leaves the run unchanged: no field, no observer, the same outcomes and hashes", () => {
  const source = 'it("c", () => { i = 0; while (i < 2) { i = i + 1 }; expect(i).toEqual(2) })';
  const plain = runSpecFile("plain.spec.prg", source, {});
  const covered = runSpecFile("plain.spec.prg", source, { coverage: true });
  equal("coverage" in plain, false);
  deepEqual({ ...covered, coverage: undefined }, { ...plain, coverage: undefined });
  equal(covered.cases[0]!.stateHash, plain.cases[0]!.stateHash);
  const root = mkdtempSync(join(tmpdir(), "script-spec-coverage-"));
  try {
    writeFileSync(join(root, "a.spec.prg"), source);
    equal("coverage" in runSpecProject(root), false);
    deepEqual(runSpecProject(root, { coverage: true }).coverage, { files: [{ file: "a.spec.prg", lines: covered.coverage!.files[0]!.lines }] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
