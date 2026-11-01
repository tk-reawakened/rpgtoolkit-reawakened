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
 * `toBeCloseTo`'s optional tolerance. Both are proved through the recorded order
 * of `specResult` outcomes.
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
test("toBeCloseTo accepts its default and explicit tolerance at exact arities, including .not", () => {
  const spec = [
    'it("default-one-arg", () => { expect(0.00000005).toBeCloseTo(0) })',
    'it("default-outside-one-arg", () => { expect(0.0000002).toBeCloseTo(0) })',
    'it("default-negative-one-arg", () => { expect(-0.00000005).toBeCloseTo(0) })',
    'it("explicit-two-arg", () => { expect(0.0005).toBeCloseTo(0, 0.001) })',
    'it("explicit-negative-two-arg", () => { expect(-0.0005).toBeCloseTo(0, 0.001) })',
    'it("explicit-two-arg-fails", () => { expect(0.002).toBeCloseTo(0, 0.001) })',
    'it("zero-tolerance-is-exact", () => { expect(0.00000005).toBeCloseTo(0, 0) })',
    'it("not-default-one-arg", () => { expect(0.0000002).not.toBeCloseTo(0) })',
    'it("not-default-negative-one-arg", () => { expect(-0.0000002).not.toBeCloseTo(0) })',
    'it("not-explicit-two-arg", () => { expect(0.002).not.toBeCloseTo(0, 0.001) })',
    'it("not-explicit-negative-two-arg", () => { expect(-0.002).not.toBeCloseTo(0, 0.001) })',
    'it("not-explicit-two-arg-fails", () => { expect(0.0005).not.toBeCloseTo(0, 0.001) })',
    'it("not-explicit-negative-two-arg-fails", () => { expect(-0.0005).not.toBeCloseTo(0, 0.001) })',
  ].join("\n");
  deepEqual(run(spec), [
    "pass:default-one-arg/toBeCloseTo",
    "fail:default-outside-one-arg/toBeCloseTo",
    "pass:default-negative-one-arg/toBeCloseTo",
    "pass:explicit-two-arg/toBeCloseTo",
    "pass:explicit-negative-two-arg/toBeCloseTo",
    "fail:explicit-two-arg-fails/toBeCloseTo",
    "fail:zero-tolerance-is-exact/toBeCloseTo",
    "pass:not-default-one-arg/toBeCloseTo",
    "pass:not-default-negative-one-arg/toBeCloseTo",
    "pass:not-explicit-two-arg/toBeCloseTo",
    "pass:not-explicit-negative-two-arg/toBeCloseTo",
    "fail:not-explicit-two-arg-fails/toBeCloseTo",
    "fail:not-explicit-negative-two-arg-fails/toBeCloseTo",
  ]);
});
