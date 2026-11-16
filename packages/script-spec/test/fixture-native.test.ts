import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { createGameState, ScriptError, type CommandView, type Value } from "@tk-reawakened/core";
import { createDoubles, type SpecDoubles } from "../src/doubles.ts";
import { specCommands } from "../src/natives.ts";

const dictionary = (handle: number): Value => ({ kind: "object", handle, className: "" });
const baseMembers: Readonly<Record<number, Readonly<Record<string, Value>>>> = {
  1: { board: "Boards/wall.brd", party: dictionary(2), x: 1, y: 1 },
  2: { length: 1, "0": "Chrs/Hero.tem" },
};

function fixtureCall(doubles: SpecDoubles, members = baseMembers, mode = 1, group = 4, definition: Value = dictionary(1)) {
  const state = createGameState({ seed: 0 });
  state.vm.globals.specmode = mode;
  state.vm.globals.speccurrent = group;
  const command = specCommands(doubles).find((item) => item.name === "specfixture");
  if (command === undefined) throw new Error("specfixture native was not registered");
  const view = {
    state,
    clock: { tick: () => state.time.tick },
    pos: { file: "prg/wall.spec.prg", line: 8, col: 3 },
    objectMembers: (handle: number) => members[handle],
  } as unknown as CommandView;
  const result = command.call(view, [{ value: definition, ref: null }], (() => ({ value: null })) as never);
  return { state, result };
}

test("specFixture validates one registration dictionary and records the group declaration effect", () => {
  const doubles = createDoubles();
  const { state, result } = fixtureCall(doubles);

  equal(result.value, null);
  deepEqual(doubles.fixtures.get(4), {
    group: 4,
    definition: {
      board: "Boards/wall.brd",
      party: ["Chrs/Hero.tem"],
      start: { x: 1, y: 1, layer: 1 },
      facing: null,
      stats: {},
      inventory: Object.create(null),
      gold: 0,
      variables: {},
      seed: null,
      files: [],
    },
    line: 8,
    column: 3,
  });
  equal(state.vm.effects[0]?.name, "specfixture");
  equal(state.vm.effects[0]?.args[1], 4);
});

test("specFixture rejects duplicate, late, cyclic and invalid data without installing a partial declaration", () => {
  const doubles = createDoubles();
  const first = fixtureCall(doubles);
  throws(() => fixtureCall(doubles), (error: unknown) => error instanceof ScriptError && error.code === "spec.fixture-twice");
  throws(() => fixtureCall(createDoubles(), baseMembers, 2), (error: unknown) => error instanceof ScriptError && error.code === "spec.fixture-late");
  throws(
    () => fixtureCall(createDoubles(), { 1: { ...baseMembers[1]!, self: dictionary(1) }, 2: baseMembers[2]! }),
    (error: unknown) => error instanceof ScriptError && error.code === "spec.bad-fixture",
  );
  throws(
    () => fixtureCall(createDoubles(), { 1: { ...baseMembers[1]!, unknown: 1 }, 2: baseMembers[2]! }),
    (error: unknown) => error instanceof ScriptError && error.code === "spec.bad-fixture",
  );
  equal(first.state.vm.effects.length, 1);
});
