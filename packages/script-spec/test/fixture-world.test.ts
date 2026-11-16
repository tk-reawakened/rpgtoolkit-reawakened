import { deepEqual, equal, throws } from "node:assert/strict";
import test from "node:test";
import { FixtureError, type FixtureDefinition } from "../src/fixture.ts";
import { createFixtureWorld } from "../src/fixture-world.ts";

function fixture(overrides: Partial<FixtureDefinition> = {}): FixtureDefinition {
  return {
    board: "Boards/wall.brd",
    party: ["Chrs/Hero.tem"],
    start: { x: 1, y: 1, layer: 1 },
    facing: null,
    stats: {},
    inventory: { "Keys/brass.itm": 1 },
    gold: 0,
    variables: {},
    seed: null,
    files: ["Prg/open.prg"],
    ...overrides,
  };
}

const file = (path: string, text: string, revision = path) => ({ path, bytes: new TextEncoder().encode(text), revision });

test("fixture world shares overlay precedence across the restricted asset and program inventory", () => {
  const world = createFixtureWorld([
    file("Boards/wall.brd", "project board"),
    file(".TKR-Tests/boards/WALL.brd", "overlay board", "overlay-revision"),
    file(".tkr-tests/Prg/helper.prg", "real helper"),
    file("Chrs/Hero.tem", "hero"),
    file("Item/Keys/brass.itm", "key"),
    file("Prg/open.prg", "open door"),
    file("Prg/unlisted.prg", "not visible"),
  ], fixture());

  const board = world.byKey.get("boards/wall.brd");
  equal(board?.sourcePath, ".TKR-Tests/boards/WALL.brd");
  equal(board?.path, "boards/WALL.brd");
  equal(board?.revision, "overlay-revision");
  deepEqual(world.files.map((entry) => entry.path), [
    "Chrs/Hero.tem",
    "Item/Keys/brass.itm",
    "Prg/helper.prg",
    "Prg/open.prg",
    "boards/WALL.brd",
  ]);
  equal(world.byKey.has("prg/unlisted.prg"), false);
});

test("overlay files satisfy named fixture paths without the project copy", () => {
  const world = createFixtureWorld([
    file(".tkr-tests/Boards/wall.brd", "board"),
    file(".tkr-tests/Chrs/Hero.tem", "hero"),
    file(".tkr-tests/Item/Keys/brass.itm", "key"),
    file(".tkr-tests/Prg/open.prg", "program"),
  ], fixture());
  equal(world.files.length, 4);
  equal(world.byKey.has("prg/open.prg"), true);
});

test("a named file outside the frozen world fails instead of falling back to the project", () => {
  throws(() => createFixtureWorld([
    file("Boards/wall.brd", "board"),
    file("Chrs/Hero.tem", "hero"),
    file("Item/Keys/brass.itm", "key"),
  ], fixture()), (error: unknown) => error instanceof FixtureError && error.code === "spec.fixture-load");
});
