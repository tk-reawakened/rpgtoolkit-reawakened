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
test("toBeCloseTo takes both arguments today, compares whole numbers, and says so", () => {
  // SEM-3:209 truncates every variable operand of arithmetic to an integer, and
  // both the actual and the expected value reach the matcher through a variable
  // read, so closeness is decided on whole numbers. TOOL-5's optional tolerance is
  // not implemented: a callable takes exactly its declared arity (FUN-1/ERR-2) and
  // one- and two-argument overloads would need a class-method tear-off read, an
  // owner-gated language change (F-F). One-argument calls therefore fail loudly,
  // and fractional closeness needs a native helper (F-D).
  const spec = [
    'it("two-arg-equal", () => { expect(3).toBeCloseTo(3, 0) })',
    'it("two-arg-inside", () => { expect(5).toBeCloseTo(3, 2) })',
    'it("two-arg-outside", () => { expect(6).toBeCloseTo(3, 2) })',
    'it("not-inside", () => { expect(6).not.toBeCloseTo(3, 2) })',
    'it("not-outside", () => { expect(5).not.toBeCloseTo(3, 2) })',
    'it("fractions-truncate-to-equal", () => { expect(0.4).toBeCloseTo(0.1, 0) })',
  ].join("\n");
  deepEqual(run(spec), [
    "pass:two-arg-equal/toBeCloseTo",
    "pass:two-arg-inside/toBeCloseTo",
    "fail:two-arg-outside/toBeCloseTo",
    "pass:not-inside/toBeCloseTo",
    "fail:not-outside/toBeCloseTo",
    "pass:fractions-truncate-to-equal/toBeCloseTo",
  ]);
});
