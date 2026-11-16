import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { ScriptError, type Arg, type CommandView } from "@tk-reawakened/core";
import { createDoubles, type SpecDoubles } from "../src/doubles.ts";
import { specCommands } from "../src/natives.ts";

function actionCommand(doubles: SpecDoubles) {
  const command = specCommands(doubles).find((item) => item.name === "specaction");
  if (command === undefined) throw new Error("specaction native was not registered");
  return command;
}

const commandView = { clock: { tick: () => 5 } } as unknown as CommandView;
const args = (action: unknown, ticks: unknown) => [{ value: action, ref: null }, { value: ticks, ref: null }] as unknown as Arg[];

test("native action command refuses script-only runs instead of simulating a creator fixture", () => {
  const doubles = createDoubles();
  throws(() => actionCommand(doubles).call(commandView, args("left", 1), (() => ({ value: null })) as never), (error: unknown) => error instanceof ScriptError && error.code === "spec.no-fixture");
  deepEqual(doubles.creatorActions.actions, []);
});

test("native action command schedules a claimed edge and waits through the release tick", () => {
  const doubles = createDoubles(() => ["game.openDoor"], true);
  const result = actionCommand(doubles).call(commandView, args("game.openDoor", 3), (() => ({ value: null })) as never);

  deepEqual(result.wait, { kind: "sleep", global: false, until: 9, resumesCall: true });
  const edges = [...doubles.creatorActions.takeInputs(6), ...doubles.creatorActions.takeInputs(9)];
  deepEqual(edges.map(({ tick, event }) => [tick, event.kind, event.kind === "action" ? event.action : "", event.kind === "action" ? event.source : "", event.kind === "action" ? event.down : false]), [
    [6, "action", "game.openDoor", "spec.action:1", true],
    [9, "action", "game.openDoor", "spec.action:1", false],
  ]);
  equal(doubles.creatorActions.actions[0]?.completedAt, null);
  doubles.creatorActions.completeTick(9);
  equal(doubles.creatorActions.actions[0]?.completedAt, 9);
});
