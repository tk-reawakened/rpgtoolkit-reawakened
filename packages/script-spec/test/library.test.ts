import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  advanceScriptTick,
  createGameState,
  createScriptServices,
  drainEffects,
  startProgram,
  STEP_BUDGET,
} from "@tk-reawakened/core";
import { SPEC_PLUGIN } from "../src/index.ts";

/**
 * The library's behaviours (TOOL-5): hook order across nested describes, and
 * `toBeCloseTo`'s arities (one argument, and the explicit tolerance) with `.not`.
 * Both are proved through the recorded order of `specResult` outcomes. Closeness
 * is decided on whole numbers, because SEM-3:209 truncates every variable operand
 * of script arithmetic, so the tolerance cases use integers and one case pins the
 * truncation of fractions.
 */

const library = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package", "startup.prg"), "utf8");

function run(spec: string): string[] {
  const state = createGameState({ seed: 1 });
  startProgram(state.vm, { kind: "inline", text: `${library}\n${spec}`, ir: "1" });
  const services = createScriptServices(state, [{ definition: SPEC_PLUGIN }]);
  for (let step = 0; step < 200; step += 1) {
    if (advanceScriptTick(state, services, STEP_BUDGET) === "finished") break;
  }
  return drainEffects(state.vm)
    .filter((record) => record.name === "specresult")
    .map((record) => `${String(record.args[0])}:${String(record.args[1])}`);
}

test("hooks run in the documented order, nested describes included", () => {
  const spec = [
    'describe("outer", () => {',
    '  beforeAll(() => { specResult("pass", "A", "", "") })',
    '  beforeEach(() => { specResult("pass", "B", "", "") })',
    '  afterEach(() => { specResult("pass", "C", "", "") })',
    '  afterAll(() => { specResult("pass", "D", "", "") })',
    '  it("o1", () => { specResult("pass", "o1", "", "") })',
    '  describe("inner", () => {',
    '    beforeEach(() => { specResult("pass", "B2", "", "") })',
    '    afterEach(() => { specResult("pass", "C2", "", "") })',
    '    afterAll(() => { specResult("pass", "D2", "", "") })',
    '    it("i1", () => { specResult("pass", "i1", "", "") })',
    '  })',
    '  it("o2", () => { specResult("pass", "o2", "", "") })',
    '})',
  ].join("\n");
  deepEqual(run(spec), [
    "pass:A",
    "pass:B", "pass:o1", "pass:C",
    "pass:B", "pass:B2", "pass:i1", "pass:C2", "pass:C",
    "pass:D2",
    "pass:B", "pass:o2", "pass:C",
    "pass:D",
  ]);
});
test("toBeCloseTo compares whole numbers, at the arities it declares, including .not", () => {
  // SEM-3:209 truncates every variable operand of arithmetic to an integer, and
  // both the actual and the expected value reach the matcher through a variable
  // read. So closeness is decided on whole numbers, and the 1e-7 default is itself
  // truncated to 0 inside `specClose`. Fractional closeness needs a native helper;
  // the last case pins the truncation rather than hiding it.
  const spec = [
    'it("default-equal", () => { expect(3).toBeCloseTo(3) })',
    'it("default-outside", () => { expect(4).toBeCloseTo(3) })',
    'it("default-negative-equal", () => { expect(0 - 3).toBeCloseTo(0 - 3) })',
    'it("default-negative-outside", () => { expect(0 - 4).toBeCloseTo(0 - 3) })',
    'it("explicit-tolerance-inside", () => { expect(5).toBeCloseTo(3, 2) })',
    'it("explicit-tolerance-outside", () => { expect(6).toBeCloseTo(3, 2) })',
    'it("zero-tolerance-equal", () => { expect(3).toBeCloseTo(3, 0) })',
    'it("zero-tolerance-outside", () => { expect(4).toBeCloseTo(3, 0) })',
    'it("not-default-outside", () => { expect(4).not.toBeCloseTo(3) })',
    'it("not-default-equal", () => { expect(3).not.toBeCloseTo(3) })',
    'it("not-explicit-tolerance-outside", () => { expect(6).not.toBeCloseTo(3, 2) })',
    'it("not-explicit-tolerance-inside", () => { expect(5).not.toBeCloseTo(3, 2) })',
    'it("fractions-truncate-to-equal", () => { expect(0.4).toBeCloseTo(0.1, 0) })',
  ].join("\n");
  deepEqual(run(spec), [
    "pass:default-equal/toBeCloseTo",
    "fail:default-outside/toBeCloseTo",
    "pass:default-negative-equal/toBeCloseTo",
    "fail:default-negative-outside/toBeCloseTo",
    "pass:explicit-tolerance-inside/toBeCloseTo",
    "fail:explicit-tolerance-outside/toBeCloseTo",
    "pass:zero-tolerance-equal/toBeCloseTo",
    "fail:zero-tolerance-outside/toBeCloseTo",
    "pass:not-default-outside/toBeCloseTo",
    "fail:not-default-equal/toBeCloseTo",
    "pass:not-explicit-tolerance-outside/toBeCloseTo",
    "fail:not-explicit-tolerance-inside/toBeCloseTo",
    "pass:fractions-truncate-to-equal/toBeCloseTo",
  ]);
});
