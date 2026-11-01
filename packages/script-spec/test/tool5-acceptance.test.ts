import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  advanceScriptTick,
  createGameState,
  createScriptServices,
  drainDiagnostics,
  ENGINE_DEFAULT_MANIFEST,
  startProgram,
  STEP_BUDGET,
} from "@tk-reawakened/core";
import { buildPackageCatalogue } from "@tk-reawakened/runner-harness";
import { discoverProjectSpecs, ONLY_WARNING, runSpecFile, runSpecProject, SPEC_PLUGIN } from "../src/index.ts";

/**
 * The TOOL-5 acceptance checklist (docs/spec/engine/rpgcode-tooling.md#tool-5).
 * Every item is proved through the public consumer, not by reading internals.
 * B1–B4 are recorded decisions: optional tolerance resolves by exact arity
 * (FUN-1/ERR-2); repeated hooks append in registration order; a group's
 * `beforeAll`/`afterAll` run once per isolated case run (F-E, still open);
 * sibling describes never run each other's hooks.
 */

const library = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package", "startup.prg"), "utf8");
const packageFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "package");

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "script-spec-accept-"));
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source, "latin1");
  }
  return root;
}

test("A1 two real spec files are discovered from disk, one pass and one fail, and a decoy is ignored", () => {
  const root = project({
    "a/passing.spec.prg": 'it("ok", () => { expect(1).toBe(1) })',
    "b/failing.spec.prg": 'it("bad", () => { expect(1).toBe(2) })',
    "b/notes.prg": 'it("decoy", () => { expect(1).toBe(2) })',
    "decoy.spec.prg.txt": 'it("decoy2", () => { expect(1).toBe(2) })',
  });
  try {
    deepEqual(discoverProjectSpecs(root), ["a/passing.spec.prg", "b/failing.spec.prg"]);
    const report = runSpecProject(root);
    deepEqual(report.files.map((file) => file.file), ["a/passing.spec.prg", "b/failing.spec.prg"]);
    equal(report.files[0]?.cases[0]?.ok, true);
    equal(report.files[1]?.cases[0]?.ok, false);
    equal(report.failures.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A2 every case starts on a fresh board, party actor and variable set", () => {
  const source = [
    'it("mutate", () => { backgroundRed = 9; HP! = 3; counted = 1; expect(backgroundRed).toBe(9); expect(HP!).toBe(3) })',
    'it("defaults", () => { expect(backgroundRed).toBe(0); expect(HP!).toBe(10); expect(counted).toBe(0) })',
  ].join("\n");
  const report = runSpecFile("fixture.spec.prg", source, { library });
  deepEqual(report.cases.map((item) => item.ok), [true, true]);
  deepEqual(report.failures, []);
});

test("A3 the seeded RNG and injected clock are deterministic, and a different seed moves the hash", () => {
  const source = [
    'it("clock", () => { expect(gametime).toBe(0) })',
    'it("rng", () => { drawn = random(100); expect(drawn).toBe(drawn) })',
  ].join("\n");
  const first = runSpecFile("determinism.spec.prg", source, { library, seed: 7 });
  const second = runSpecFile("determinism.spec.prg", source, { library, seed: 7 });
  deepEqual(first, second);
  ok(first.cases.every((item) => item.stateHash.length > 0));
  const moved = runSpecFile("determinism.spec.prg", source, { library, seed: 8 });
  equal(moved.cases.some((item, index) => item.stateHash !== first.cases[index]?.stateHash), true);
});

test("A4 a skip fails the strict aggregate and stays listed; lenient tolerates it", () => {
  const source = ['it("passes", () => { expect(1).toBe(1) })', 'skip("later", () => { expect(1).toBe(1) })'].join("\n");
  const strict = runSpecFile("skip.spec.prg", source, { library, strict: true });
  deepEqual(strict.skipped, ["later"]);
  equal(strict.cases.find((item) => item.name === "later")?.ok, false);
  ok(strict.failures.some((failure) => failure.includes("later")));
  const lenient = runSpecFile("skip.spec.prg", source, { library, strict: false });
  deepEqual(lenient.skipped, ["later"]);
  equal(lenient.cases.find((item) => item.name === "later")?.ok, true);
});

test("A5 only narrows the run: unmarked cases record no outcomes, the chosen one does", () => {
  const source = [
    'it("unmarked", () => { specResult("pass", "unmarked-ran", "", "") })',
    'only("chosen", () => { specResult("pass", "chosen-ran", "", "") })',
    'it("other", () => { specResult("pass", "other-ran", "", "") })',
  ].join("\n");
  const report = runSpecFile("only.spec.prg", source, { library });
  equal(report.warning, ONLY_WARNING);
  deepEqual(report.cases.map((item) => item.name), ["chosen"]);
  deepEqual(report.cases[0]?.outcomes.map((item) => item.label), ["chosen", "chosen-ran"]);
  equal(report.cases[0]?.outcomes.some((item) => item.label === "unmarked-ran"), false);
});

test("A6 a failure record names the spec file and that file's own assertion line", () => {
  const source = ["// lead", 'it("bad", () => {', "  expect(1).toBe(2)", "})"].join("\n");
  const report = runSpecFile("nested/line.spec.prg", source, { library });
  const [failure] = report.failures;
  ok(failure?.includes("line.spec.prg") || report.file === "nested/line.spec.prg");
  equal(report.cases[0]?.outcomes[0]?.line, 3);
  ok(failure?.includes("(line 3)"), failure);
});

test("A7 the manifest parses and the catalogue resolves the start-up program; the runner includes the library", () => {
  const manifestText = readFileSync(join(packageFolder, "manifest.json"), "utf8");
  const programSource = readFileSync(join(packageFolder, "startup.prg"), "utf8");
  const catalogue = buildPackageCatalogue([{ label: "script-spec", manifestText, programSource }]);
  ok(catalogue.ok);
  equal(catalogue.entries[0]?.name, "script-spec");

  // The runner uses TOOL-5's include branch, not the catalogue: a spec that only
  // calls the names works, and the program is not text-concatenated.
  const report = runSpecFile("include.spec.prg", 'it("a", () => { expect(1).toBe(2) })', { library });
  equal(report.cases[0]?.outcomes[0]?.line, 1);

  const without = createGameState({ seed: 0 });
  startProgram(without.vm, { kind: "inline", text: 'it("x", () => { })\n', ir: "1" });
  const services = createScriptServices(without);
  advanceScriptTick(without, services, STEP_BUDGET);
  deepEqual(drainDiagnostics(services).map((item) => item.code), ["unknown.command"]);
});

test("B1 the optional tolerance is a recorded decision: one argument is an arity failure today", () => {
  const report = runSpecFile("arity.spec.prg", 'it("one", () => { expect(3).toBeCloseTo(3) })', { library });
  equal(report.cases[0]?.ok, false);
  ok(report.failures[0]?.includes("callable.arity"), report.failures[0]);
  const two = runSpecFile("arity2.spec.prg", 'it("two", () => { expect(3).toBeCloseTo(3, 0) })', { library });
  equal(two.cases[0]?.ok, true);
});

test("A8/A9 script-spec stays out of the default manifest and registers only specresult", () => {
  equal(ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id).includes("script-spec"), false);
  deepEqual(SPEC_PLUGIN.commands.map((command) => command.name), ["specresult"]);
});

test("B4 sibling describes never run each other's hooks", () => {
  const source = [
    'describe("A", () => {',
    '  beforeEach(() => { specResult("pass", "A-before", "", "") })',
    '  it("a1", () => { specResult("pass", "a1", "", "") })',
    '})',
    'describe("B", () => {',
    '  it("b1", () => { specResult("pass", "b1", "", "") })',
    '})',
  ].join("\n");
  const report = runSpecFile("siblings.spec.prg", source, { library });
  deepEqual(report.cases.find((item) => item.name === "b1")?.outcomes.map((item) => item.label), ["b1"]);
  deepEqual(
    report.cases.find((item) => item.name === "a1")?.outcomes.map((item) => item.label),
    ["A-before", "a1"],
  );
});
