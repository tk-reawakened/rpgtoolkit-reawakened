import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { FixtureError, readFixture } from "../src/fixture.ts";

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    board: "Boards/wall.brd",
    party: { length: 1, "0": "Chrs/hero.tem" },
    x: 1,
    y: 1,
    ...overrides,
  };
}

test("fixture validation normalizes path separators and facing without changing named values", () => {
  const result = readFixture(definition({
    board: "Boards\\wall.brd",
    party: { length: 1, "0": "Chrs\\hero.tem" },
    facing: "sw",
    variables: { score: 1.5, label$: "door" },
    files: { length: 1, "0": "Prg\\open.prg" },
  }));
  equal(result.board, "Boards/wall.brd");
  deepEqual(result.party, ["Chrs/hero.tem"]);
  equal(result.facing, "SW");
  deepEqual(result.variables, { score: 1.5, "label$": "door" });
  deepEqual(result.files, ["Prg/open.prg"]);
});

test("fixture lists reject holes, invalid lengths, and path traversal without iterating unbounded lists", () => {
  for (const party of [
    { length: 2, "0": "Chrs/hero.tem" },
    { length: 1.5, "0": "Chrs/hero.tem" },
    { length: 0 },
    { length: 1_000_000_000 },
    { length: 1, "0": "../hero.tem" },
  ]) {
    throws(() => readFixture(definition({ party })), (error: unknown) =>
      error instanceof FixtureError && error.code === "spec.bad-fixture");
  }
  throws(() => readFixture(definition({ files: { length: 1_000_000_000 } })), (error: unknown) =>
    error instanceof FixtureError && error.code === "spec.bad-fixture");
});
test("fixture values enforce path, type, and matching RPGCode variable suffix rules", () => {
  for (const overrides of [
    { board: "C:/game/Boards/wall.brd" },
    { facing: "north" },
    { seed: -1 },
    { variables: { "count!": "one" } },
    { variables: { "title$": 3 } },
  ]) {
    throws(() => readFixture(definition(overrides)), (error: unknown) =>
      error instanceof FixtureError && error.code === "spec.bad-fixture");
  }
});

test("fixture size cap measures UTF-8 bytes rather than UTF-16 code units", () => {
  const variables: Record<string, string> = {};
  for (let index = 0; index < 32; index += 1) {
    variables[`value${index}`] = "😀".repeat(127);
  }
  throws(() => readFixture(definition({ variables })), (error: unknown) =>
    error instanceof FixtureError && error.code === "spec.bad-fixture");
});
test("fixture inventory preserves a legal special property name as data", () => {
  const result = readFixture(definition({ inventory: { ["__proto__"]: 2 } }));
  equal(Object.hasOwn(result.inventory, "__proto__"), true);
  equal(result.inventory["__proto__"], 2);
});
