import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import {
  advanceScriptTick,
  createGameState,
  createScriptServices,
  drainEffects,
  startProgram,
  STEP_BUDGET,
} from "@tk-reawakened/core";
import { SPEC_PLUGIN } from "../src/index.ts";

/** Run one inline program to completion on the VM with the spec plugin registered. */
function run(text: string) {
  const state = createGameState({ seed: 1 });
  startProgram(state.vm, { kind: "inline", text, ir: "1" });
  const services = createScriptServices(state, [{ definition: SPEC_PLUGIN }]);
  for (let step = 0; step < 100; step += 1) {
    if (advanceScriptTick(state, services, STEP_BUDGET) === "finished") break;
  }
  return state;
}

/**
 * The one native channel (TOOL-5): `specResult` records kind, case name,
 * expected, actual and the position of its own call site.
 */

test("specResult records an outcome with the call's position", () => {
  const state = run('\nspecResult("pass", "adds", "2", "2")\n');
  const records = drainEffects(state.vm).filter((record) => record.name === "specresult");
  equal(records.length, 1);
  deepEqual(records[0]?.args, ["pass", "adds", "2", "2", "<inline>", 2, 1]);
});

test("an unknown kind is a diagnostic, not a recorded result", () => {
  const state = run('specResult("bogus", "x", "", "")\n');
  const outcomes = drainEffects(state.vm).filter(
    (record) => record.name === "specresult" && ["pass", "fail", "skip", "only"].includes(String(record.args[0])),
  );
  equal(outcomes.length, 0);
});
