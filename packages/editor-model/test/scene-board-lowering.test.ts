import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { BinaryReader, createEmptyBoard, readBoard, writeBoard, type Board } from "@tk-reawakened/core";
import { checkScene, type Scene } from "@tk-reawakened/native-data";
import { lowerSceneBoard } from "../src/scene-board-lowering.ts";

function sourceBoard(): Board {
  const base = createEmptyBoard();
  return {
    ...base,
    sizeX: 2,
    sizeY: 1,
    sizeL: 2,
    coordType: 4,
    lut: ["", "grass.tst1", "", "grass.tst1"],
    tileRuns: [
      { count: 1, lutIndex: 1, marker: true },
      { count: 1, lutIndex: 0, marker: false },
      { count: 1, lutIndex: 3, marker: false },
      { count: 3, lutIndex: 0, marker: true },
    ],
    tileMatrix: [1, 0, 3, 0, 0, 0],
    shadeLayers: [{ castLayer: 2, records: [{ runCount: 0, r: 286, g: -20, b: 4 }, { runCount: 2, r: 0, g: 0, b: 0 }] }],
    lights: [{ layer: 2, type: 2, nodes: [{ x: 2, y: 3 }, { x: 8, y: 9 }], colours: [{ r: -2, g: 4, b: 5 }, { r: 286, g: 0, b: 0 }] }],
    vectors: [
      { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 3, closed: -1, layer: 1, type: 2, handle: "" },
      { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 2, closed: 0, layer: 2, type: 8, handle: "" },
      { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 0, closed: 0, layer: 1, type: 16, handle: "patrol" },
    ],
    programs: [
      { program: "door.prg", graphic: "door.gph", initialVar: "gate", initialValue: "open", finalVar: "gate", finalValue: "closed", activate: 1, activationType: 3, repeatDistance: 16, layer: 1, points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], closed: -1, handle: "reserved" },
      { program: "", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", activate: 0, activationType: 0, repeatDistance: 0, layer: 2, points: [], closed: 0, handle: "" },
    ],
    sprites: [
      { itemFile: "chest.itm", activationPrg: "open.prg", multitaskPrg: "shine.prg", initialVar: "ready", initialValue: "yes", finalVar: "opened", finalValue: "1", loadingVar: "chapter", loadingValue: "2", activate: 1, activationType: 1, x: 8, y: 24, layer: 2, reserved: 3 },
      { itemFile: "", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 0, y: 0, layer: 1, reserved: -1 },
    ],
    images: [{ file: "art.png", left: 2, top: 3, layer: 2, drawType: 0, transparent: { r: 0, g: 0, b: 0 }, reserved: 99 }],
    links: { north: "north.brd", south: "", east: "east.prg", west: "" },
    threads: ["", "wake.prg"],
    constants: ["gold", ""],
    layerTitles: ["unused", "ground", "roof"],
    residue: new Uint8Array([0, 1, 255]),
    properties: {
      ...base.properties,
      backgroundImage: "sky.png",
      backgroundDrawType: 1,
      backgroundColour: { r: 12, g: 30, b: 40 },
      backgroundMusic: "song.ogg",
      enterPrg: "entry.prg",
      battleBackground: "woods.bkg",
      battleSkill: 4,
      allowBattles: -1,
      start: { x: 0, y: 32, layer: 7 },
      ambient: { r: 4, g: -5, b: 286 },
      disableSaving: 1,
    },
  };
}
function sourceScene(): Scene {
  return {
    contract: "scene",
    version: "1.0.0-pre.1",
    projection: "2d",
    pixelCoordinates: true,
    size: { width: 2, height: 1 },
    floors: [
      { id: "ground", title: "ground", tiles: [[1, 1], [1, 0]] },
      { id: "roof", title: "roof", tiles: [[1, 3], [1, 0]] },
    ],
    tilePalette: [{}, { legacy: "grass.tst1" }, {}, { legacy: "grass.tst1" }],
    shading: [{ floor: "roof", cells: [[1, 286, -20, 4], [1, 0, 0, 0]], legacy: { excessCells: [1, 0, 0, 0] } }],
    lights: [{ floor: "roof", type: "clipped-gradient", nodes: [[2, 3], [8, 9]], colors: [[-2, 4, 5], [286, 0, 0]] }],
    vectors: [
      { floor: "ground", type: "under", attributes: 3, closed: true, points: [[0, 0], [16, 0]] },
      { floor: "roof", type: "stairs", toFloor: "roof", closed: false, points: [[0, 0], [16, 0]] },
      { floor: "ground", type: "waypoint", handle: "patrol", closed: false, points: [[0, 0], [16, 0]] },
    ],
    triggers: [
      { floor: "ground", program: "door.prg", condition: { mode: "conditional", variable: "gate", value: "open" }, afterRun: { variable: "gate", value: "closed" }, activation: { keyPress: true, repeat: true, repeatDistance: 16 }, points: [[0, 0], [16, 0]], closed: true, legacy: { graphic: "door.gph", reserved: "reserved" } },
      { floor: "roof" },
    ],
    items: [
      { floor: "roof", item: "chest.itm", activationProgram: "open.prg", multitaskProgram: "shine.prg", condition: { mode: "conditional", variable: "ready", value: "yes" }, afterRun: { variable: "opened", value: "1" }, loadCondition: { variable: "chapter", value: "2" }, activation: { keyPress: true }, x: 8, y: 24, legacy: { reserved: 3 } },
      { floor: "ground", x: 0, y: 0 },
    ],
    images: [{ floor: "roof", source: "art.png", x: 2, y: 3, transparent: [0, 0, 0], legacy: { reserved: 99 } }],
    atmosphere: { ambient: [4, -5, 286], music: "song.ogg", background: { image: "sky.png", type: "parallax", color: [12, 30, 40] } },
    start: { y: 32, layer: 7 },
    links: { north: "north.brd", east: "east.prg" },
    enterProgram: "entry.prg",
    battle: { background: "woods.bkg", skill: 4, allowed: true },
    savingDisabled: true,
    threads: ["", "wake.prg"],
    constants: ["gold", ""],
    legacy: { layerTitleZero: "unused", trailingBytes: "AAH/", excessTiles: [2, 0] },
  };
}

function encode(board: Board): Uint8Array {
  const result = writeBoard(board);
  ok(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

function decode(bytes: Uint8Array): Board {
  const result = readBoard(new BinaryReader(bytes));
  ok(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

test("a hand-authored scene lowers through the real writer and reader without losing scene-owned fields", () => {
  const source = sourceBoard();
  const scene = sourceScene();
  const lowered = lowerSceneBoard(scene, source.lut);
  ok(lowered.ok, lowered.ok ? "" : lowered.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; "));
  const actual = decode(encode(lowered.board));
  equal(actual.sizeX, source.sizeX);
  equal(actual.sizeY, source.sizeY);
  equal(actual.sizeL, source.sizeL);
  equal(actual.coordType, source.coordType);
  deepEqual(actual.lut, source.lut);
  deepEqual(actual.tileMatrix, source.tileMatrix);
  deepEqual(actual.tileRuns.map(({ count, lutIndex }) => [count, lutIndex]), [[1, 1], [1, 0], [1, 3], [3, 0]]);
  deepEqual(actual.shadeLayers, [{ castLayer: 2, records: [{ runCount: 1, r: 286, g: -20, b: 4 }, { runCount: 2, r: 0, g: 0, b: 0 }] }]);
  deepEqual(actual.lights, [{ layer: 2, type: 2, nodes: [{ x: 2, y: 3 }, { x: 8, y: 9 }], colours: [{ r: -2, g: 4, b: 5 }, { r: 286, g: 0, b: 0 }] }]);
  deepEqual(actual.vectors, [
    { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 3, closed: -1, layer: 1, type: 2, handle: "" },
    { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 2, closed: 0, layer: 2, type: 8, handle: "" },
    { points: [{ x: 0, y: 0 }, { x: 16, y: 0 }], attributes: 0, closed: 0, layer: 1, type: 16, handle: "patrol" },
  ]);
  deepEqual(actual.programs, source.programs);
  deepEqual(actual.sprites, source.sprites);
  deepEqual(actual.images, source.images);
  deepEqual(actual.threads, source.threads);
  deepEqual(actual.constants, source.constants);
  deepEqual(actual.layerTitles, source.layerTitles);
  deepEqual(actual.residue, source.residue);
  deepEqual(actual.properties.start, { x: 64, y: 32, layer: 7 });
  deepEqual(actual.properties.ambient, source.properties.ambient);
  equal(actual.properties.disableSaving, -1);
  deepEqual(actual.links, source.links);
  deepEqual(
    {
      backgroundImage: actual.properties.backgroundImage,
      backgroundDrawType: actual.properties.backgroundDrawType,
      backgroundColour: actual.properties.backgroundColour,
      backgroundMusic: actual.properties.backgroundMusic,
      enterPrg: actual.properties.enterPrg,
      battleBackground: actual.properties.battleBackground,
      battleSkill: actual.properties.battleSkill,
      allowBattles: actual.properties.allowBattles,
    },
    {
      backgroundImage: source.properties.backgroundImage,
      backgroundDrawType: source.properties.backgroundDrawType,
      backgroundColour: source.properties.backgroundColour,
      backgroundMusic: source.properties.backgroundMusic,
      enterPrg: source.properties.enterPrg,
      battleBackground: source.properties.battleBackground,
      battleSkill: source.properties.battleSkill,
      allowBattles: -1,
    },
  );
});

test("no palette stays absent and every empty or duplicate palette slot keeps its index", () => {
  const absent: Scene = { contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 1, height: 1 }, floors: [{ id: "floor", tiles: [[1, 0]] }] };
  const noPalette = lowerSceneBoard(absent, null);
  ok(noPalette.ok);
  deepEqual(noPalette.board.lut, []);
  const present: Scene = {
    ...absent,
    tilePalette: [{}, { legacy: "grass.tst1" }, {}, { legacy: "grass.tst1" }],
    floors: [{ id: "floor", tiles: [[1, 3]] }],
  };
  const slots = lowerSceneBoard(present, ["", "grass.tst1", "", "grass.tst1"]);
  ok(slots.ok);
  deepEqual(decode(encode(slots.board)).lut, ["", "grass.tst1", "", "grass.tst1"]);
  const invalid = lowerSceneBoard(present, ["", "grass.tst1", "other.tst2", "grass.tst1"]);
  equal(invalid.ok, false);
  if (!invalid.ok) equal(invalid.problems[0]?.path, "tilePalette[2]");
});

test("tile and shading overshoot is carried by the final encoded run and record", () => {
  const scene: Scene = {
    contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 2, height: 1 },
    floors: [{ id: "floor", tiles: [[2, 1]] }], tilePalette: [{}, { legacy: "grass.tst1" }],
    legacy: { excessTiles: [3, 1] },
    shading: [{ floor: "floor", cells: [[2, 0, 0, 0]], legacy: { excessCells: [2, 0, 0, 0] } }],
  };
  const lowered = lowerSceneBoard(scene, ["", "grass.tst1"]);
  ok(lowered.ok, lowered.ok ? "" : lowered.problems.map((problem) => problem.message).join("; "));
  const board = decode(encode(lowered.board));
  deepEqual(board.tileRuns.map((run) => [run.count, run.lutIndex]), [[5, 1]]);
  deepEqual(board.tileMatrix, [1, 1, 1, 1, 1]);
  deepEqual(board.shadeLayers[0]?.records, [{ runCount: 4, r: 0, g: 0, b: 0 }]);
});

test("lowering is byte deterministic and rejects invalid scene or unresolved palette values", () => {
  const source = sourceBoard();
  const scene = sourceScene();
  const first = lowerSceneBoard(scene, source.lut);
  const second = lowerSceneBoard(scene, source.lut);
  ok(first.ok && second.ok);
  deepEqual(encode(first.board), encode(second.board));
  const badPalette = lowerSceneBoard(scene, ["", "other.tst", "", "grass.tst1"]);
  equal(badPalette.ok, false);
  const badScene = { ...scene, vectors: [{ floor: "missing-floor", type: "solid", closed: false, points: [[0, 0], [1, 1]] }] } as unknown as Scene;
  ok(checkScene(badScene).length > 0);
  const rejected = lowerSceneBoard(badScene, source.lut);
  equal(rejected.ok, false);
  if (!rejected.ok) ok(rejected.problems.some((problem) => problem.path === "vectors[0].floor"));
});
