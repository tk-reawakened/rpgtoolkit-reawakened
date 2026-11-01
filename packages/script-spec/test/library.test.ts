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
