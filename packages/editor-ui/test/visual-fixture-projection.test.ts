import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  appendFixtureCase,
  codeString,
  fixtureSource,
  projectVisualFixtureSource,
  replaceFixtureLine,
  type VisualFixtureDefinition,
} from "../src/visual-fixture-projection.ts";

const definition: VisualFixtureDefinition = {
  board: "Boards/wall.brd",
  party: ["Chrs/Hero.tem"],
  x: 1,
  y: 2,
  layer: 1,
  facing: "E",
  seed: 17,
};

test("TOOL-12 fixture and ordered action cards project their TOOL-5 calls without consuming opaque RPGCode", () => {
  const source = [
    "// authored opaque 🧭 line",
    fixtureSource(definition),
    'it("wall holds the player", () => {',
    '  specAction("right", 35)',
    '  specWait("player.tileX", 2, 60)',
    '  expect(specValue("player.tileX")).toBe(2)',
    "})",
    'Send("Boards/door.brd", 1, 1, 1)',
  ].join("\r\n") + "\r\n";
  const projection = projectVisualFixtureSource(source);
  deepEqual(projection.fixture?.definition, { ...definition, extra: {}, partyForm: "object", order: ["board", "party", "x", "y", "layer", "seed", "facing"] });
  deepEqual(projection.cases.map(({ name, actions }) => ({ name, actions: actions.map(({ action, ticks }) => ({ action, ticks })) })), [
    { name: "wall holds the player", actions: [{ action: "right", ticks: 35 }] },
  ]);
  deepEqual(projection.opaque.map(({ text }) => text), ["// authored opaque 🧭 line", '  specWait("player.tileX", 2, 60)', '  expect(specValue("player.tileX")).toBe(2)', 'Send("Boards/door.brd", 1, 1, 1)']);
  ok(source.includes("\r\n"), "authored CRLF bytes remain in the source");
});

test("fixture updates and action-card additions preserve every unrelated source byte and CRLF", () => {
  const original = `// opaque prefix 🧭\r\n${fixtureSource(definition)}\r\n// opaque suffix\r\n`;
  const projection = projectVisualFixtureSource(original);
  const line = projection.fixture;
  ok(line !== null);
  const changed: VisualFixtureDefinition = { ...line.definition, board: "Boards/door.brd", seed: 99 };
  const replaced = replaceFixtureLine(original, line.from, line.to, fixtureSource(changed));
  equal(replaced, `// opaque prefix 🧭\r\n${fixtureSource(changed)}\r\n// opaque suffix\r\n`);
  const appended = appendFixtureCase(replaced, {
    name: "door transition",
    actions: [{ action: "confirm", ticks: 1 }],
    assertPath: "board",
    expected: "Boards/door.brd",
    waitTicks: 8,
    waitForValue: true,
    insert: projectVisualFixtureSource(replaced).insert,
  });
  equal(appended, `${replaced}it("door transition", () => {\r\n  specAction("confirm", 1)\r\n  specWait("board", "Boards/door.brd", 8)\r\n  expect(specValue("board")).toBe("Boards/door.brd")\r\n})`);
  const roundTrip = projectVisualFixtureSource(appended);
  deepEqual(roundTrip.cases[0]?.actions.map(({ action, ticks }) => ({ action, ticks })), [{ action: "confirm", ticks: 1 }]);
  deepEqual(roundTrip.opaque.map(({ text }) => text), [
    "// opaque prefix 🧭",
    "// opaque suffix",
    "  specWait(\"board\", \"Boards/door.brd\", 8)",
    '  expect(specValue("board")).toBe("Boards/door.brd")',
  ]);
});

test("a fixture card keeps authored fields it cannot show and the authored party shape and order", () => {
  const source = 'specFixture({ gold: 120, party: ["Chrs/Hero.tem", "Chrs/Mage.tem"], variables: { met: 1 }, x: 0, y: 16, board: "Boards/pixel.brd", stats: { hp: 40 }, files: ["Misc/note.txt"] })\n';
  const projection = projectVisualFixtureSource(source);
  const line = projection.fixture;
  ok(line !== null);
  const parsed = line.definition;
  deepEqual(parsed.extra, { gold: 120, variables: { met: 1 }, stats: { hp: 40 }, files: ["Misc/note.txt"] });
  equal(parsed.partyForm, "array");
  equal(parsed.x, 0, "a pixel board's zero start stays editable");
  equal(parsed.y, 16);
  const rewritten = fixtureSource({ ...parsed, y: 32 });
  equal(rewritten, 'specFixture({"gold":120,"party":["Chrs/Hero.tem","Chrs/Mage.tem"],"variables":{"met":1},"x":0,"y":32,"board":"Boards/pixel.brd","stats":{"hp":40},"files":["Misc/note.txt"]})');
  const again = projectVisualFixtureSource(rewritten);
  deepEqual(again.fixture?.definition.extra, parsed.extra);
});

test("fixture literals preserve RPGCode backslashes, including nested extra-field strings", () => {
  const source = 'specFixture({ board: "Boards\\wall.brd", party: { length: 1, "0": "Chrs\\Hero.tem" }, x: 1, y: 2, note: "one\\two", nested: { path: "Misc\\a.txt" } })';
  const line = projectVisualFixtureSource(source).fixture;
  ok(line !== null);
  deepEqual(line.definition.extra, { note: "one\\two", nested: { path: "Misc\\a.txt" } });
  const rewritten = fixtureSource(line.definition);
  equal(rewritten, String.raw`specFixture({"board":"Boards\wall.brd","party":{"0":"Chrs\Hero.tem","length":1},"x":1,"y":2,"note":"one\two","nested":{"path":"Misc\a.txt"}})`);
  const again = projectVisualFixtureSource(rewritten).fixture;
  ok(again !== null);
  deepEqual(again.definition.extra, line.definition.extra);
});

test("an object party keeps its length-and-index shape through an unrelated card edit", () => {
  const source = `${fixtureSource({ ...definition, party: ["Chrs/Hero.tem", "Chrs/Mage.tem"] })}\r\n`;
  const projection = projectVisualFixtureSource(source);
  const line = projection.fixture;
  ok(line !== null);
  equal(line.definition.partyForm, "object");
  equal(fixtureSource({ ...line.definition, board: "Boards/next.brd" }).includes('"party":{"0":"Chrs/Hero.tem","1":"Chrs/Mage.tem","length":2}'), true);
});

test("a fixture inside a describe keeps new cases in that group and indented with its body", () => {
  const source = [
    'describe("doorway", () => {',
    '  specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2 })',
    '  it("walks", () => {',
    '    specAction("right", 4)',
    "  })",
    "})",
    "",
  ].join("\n");
  const projection = projectVisualFixtureSource(source);
  deepEqual(projection.groups.map(({ name, startLine, endLine }) => ({ name, startLine, endLine })), [{ name: "doorway", startLine: 1, endLine: 6 }]);
  equal(projection.insert.indent, "  ");
  const appended = appendFixtureCase(source, {
    name: "opens",
    actions: [{ action: "confirm", ticks: 1 }],
    assertPath: "board",
    expected: "Boards/door.brd",
    waitTicks: 12,
    waitForValue: true,
    insert: projection.insert,
  });
  const expected = [
    'describe("doorway", () => {',
    '  specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2 })',
    '  it("walks", () => {',
    '    specAction("right", 4)',
    "  })",
    '  it("opens", () => {',
    '    specAction("confirm", 1)',
    '    specWait("board", "Boards/door.brd", 12)',
    '    expect(specValue("board")).toBe("Boards/door.brd")',
    "  })",
    "})",
    "",
  ].join("\n");
  equal(appended, expected);
  deepEqual(projectVisualFixtureSource(appended).cases.map(({ name }) => name), ["walks", "opens"]);
});

test("fixture projection leaves unsupported calls opaque instead of treating them as editable cards", () => {
  const source = [
    'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2 })',
    'it("unsupported", () => {',
    '  specAction("warp", 1)',
    '  expect(specValue("player.tileX")).toBe(1)',
    "})",
  ].join("\n");
  const projection = projectVisualFixtureSource(source);
  equal(projection.cases.length, 1);
  equal(projection.cases[0]?.actions.length, 0);
  ok(projection.opaque.some(({ text }) => text.includes('specAction("warp"')));
});

test("a fixture a card cannot spell stays opaque instead of losing its fields", () => {
  const unquotable = 'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, icon: "a" })';
  const line = projectVisualFixtureSource(unquotable).fixture;
  ok(line !== null);
  deepEqual(line.definition.extra, { icon: "a" });
  const invalidLayer = 'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, layer: 0 })';
  equal(projectVisualFixtureSource(invalidLayer).fixture, null);
  const outside = 'specFixture({ board: "Boards/wall.brd", party: { length: 1, "0": "Chrs/Hero.tem" }, x: 1, y: 2, seed: 4294967296 })';
  equal(projectVisualFixtureSource(outside).fixture, null);
});

test("card text becomes one RPGCode string literal or is refused, never a JSON escape", () => {
  equal(codeString("door opens"), '"door opens"');
  equal(codeString("one\\two"), '"one\\two"');
  equal(codeString('the "inner" door'), null);
  equal(codeString("line\nbreak"), null);
  equal(codeString("nul\u0000"), null);
  throws(() => appendFixtureCase("", { name: 'say "hi"', actions: [{ action: "right", ticks: 1 }], assertPath: "board", expected: 1, waitTicks: 2 }), /quotes/);
  throws(() => appendFixtureCase("", { name: "ok", actions: [{ action: "right", ticks: 1 }], assertPath: "board", expected: 'a"b', waitTicks: 2 }), /expected text/);
  equal(appendFixtureCase("", { name: "zero", actions: [], assertPath: "player.x", expected: 0, waitTicks: 0 }), 'it("zero", () => {\n  specTicks(0)\n  expect(specValue("player.x")).toBe(0)\n})');
});
