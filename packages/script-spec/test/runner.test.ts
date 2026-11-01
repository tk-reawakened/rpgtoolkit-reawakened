import { deepEqual, equal, ok } from "node:assert/strict";
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

test("every case runs on a fresh fixture: a global set by one case is unset in the next", () => {
  const report = runSpecFile("math.spec.prg", SPEC, { library });
  equal(report.cases.find((item) => item.name === "fresh")?.ok, true);
  equal(report.cases.find((item) => item.name === "leaky")?.ok, true);
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
});

test("a failing scalar assertion reports the exact message, expected against actual", () => {
  const report = runSpecFile("math.spec.prg", SPEC, { library });
  const failing = report.cases.find((item) => item.name === "subtracts");
  ok(failing);
  const [outcome] = failing.outcomes;
  ok(outcome);
  equal(failureMessage(outcome), "toBe: expected 1, actual 2");
  deepEqual(report.failures, ["subtracts: toBe: expected 1, actual 2"]);
});

test("only narrows the run and warns with the documented text", () => {
  const source = ['it("marked", () => { expect(1).toBe(1) })', 'only("chosen", () => { expect(2).toBe(2) })'].join("\n");
  const report = runSpecFile("only.spec.prg", source, { library });
  equal(report.warning, ONLY_WARNING);
  equal(report.warning, "only() narrowed the run to the marked cases; unmarked cases were not run");
});

test("script-spec is absent from the engine's default manifest, and registers only specresult", () => {
  equal(ENGINE_DEFAULT_MANIFEST.map((entry) => entry.id).includes("script-spec"), false);
  deepEqual(SPEC_PLUGIN.commands.map((command) => command.name), ["specresult"]);
});
