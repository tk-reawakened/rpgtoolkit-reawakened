import { deepEqual } from "node:assert/strict";
import test from "node:test";
import {
  createGameState,
  startProgram,
  type PluginDefinition,
  type SourcePos,
} from "../src/index.ts";
import { advanceOrFail } from "./script-failures.ts";
import { createScriptServices } from "./script-test-services.ts";

/**
 * `CommandView.pos` (TOOL-5): a command sees the source position of the `call`
 * instruction that invoked it, so `specResult` can report the failing line
 * without a new built-in or a position threaded through its arguments.
 */

const seen: SourcePos[] = [];
const PROBE: PluginDefinition = {
  id: "probe",
  version: "1.0.0",
  commands: [
    {
      name: "whereami",
      aliases: [],
      params: [],
      call: (view) => {
        if (view.pos !== undefined) seen.push(view.pos);
        return { value: 0 };
      },
    },
  ],
};

test("a command reads the call site's source position", () => {
  seen.length = 0;
  const state = createGameState({ seed: 1 });
  startProgram(state.vm, { kind: "inline", text: "\nwhereami()\n", ir: "1" });
  advanceOrFail(state, createScriptServices(state, [{ definition: PROBE }]));
  deepEqual(seen, [{ file: "<inline>", line: 2, col: 1, endCol: 8 }]);
});

test("the position follows the call, not the command's definition", () => {
  seen.length = 0;
  const state = createGameState({ seed: 1 });
  startProgram(state.vm, { kind: "inline", text: 'x = 1\n  whereami()\nwhereami()\n', ir: "1" });
  advanceOrFail(state, createScriptServices(state, [{ definition: PROBE }]));
  deepEqual(seen.map((pos) => [pos.line, pos.col, pos.endCol]), [[2, 3, 10], [3, 1, 8]]);
});
