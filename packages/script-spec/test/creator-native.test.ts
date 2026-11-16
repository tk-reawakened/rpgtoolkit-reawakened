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
const args = (...values: unknown[]) => values.map((value) => ({ value, ref: null })) as unknown as Arg[];

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

test("specValue and specWait delegate reads and bounded waits only to a live fixture bridge", () => {
  const calls: unknown[][] = [];
  const bridge = {
    value: (path: string, view: CommandView) => {
      calls.push(["value", path, view]);
      return 17;
    },
    wait: (path: string, expected: number | string, maxTicks: number, elapsed: number, view: CommandView) => {
      calls.push(["wait", path, expected, maxTicks, elapsed, view]);
      return { value: 3 };
    },
  };
  const doubles = createDoubles(() => [], true, bridge);
  const value = specCommands(doubles).find((item) => item.name === "specvalue")!;
  const wait = specCommands(doubles).find((item) => item.name === "specwaitcheck")!;

  equal(value.call(commandView, args("player.x"), (() => ({ value: null })) as never).value, 17);
  equal(wait.call(commandView, args("board", "boards/open.brd", 12, 0), (() => ({ value: null })) as never).value, 3);
  deepEqual(calls, [
    ["value", "player.x", commandView],
    ["wait", "board", "boards/open.brd", 12, 0, commandView],
  ]);
});

test("specValue and specWait reject runs without a live fixture bridge and validate wait bounds", () => {
  const value = specCommands(createDoubles(() => [], true)).find((item) => item.name === "specvalue")!;
  const wait = specCommands(createDoubles(() => [], true)).find((item) => item.name === "specwaitcheck")!;
  throws(() => value.call(commandView, args("board"), (() => ({ value: null })) as never), (error: unknown) => error instanceof ScriptError && error.code === "spec.no-fixture");
  throws(() => wait.call(commandView, args("board", "Boards/open.brd", 1001), (() => ({ value: null })) as never), (error: unknown) => error instanceof ScriptError && error.code === "spec.no-fixture");

  const live = createDoubles(() => [], true, { value: () => 0, wait: () => ({ value: 0 }) });
  const liveWait = specCommands(live).find((item) => item.name === "specwaitcheck")!;
  throws(() => liveWait.call(commandView, args("board", "open", -1), (() => ({ value: null })) as never), (error: unknown) => error instanceof ScriptError && error.code === "spec.bad-ticks");
  throws(() => liveWait.call(commandView, args("board", null, 0), (() => ({ value: null })) as never), (error: unknown) => error instanceof ScriptError && error.code === "spec.bad-wait");
});
