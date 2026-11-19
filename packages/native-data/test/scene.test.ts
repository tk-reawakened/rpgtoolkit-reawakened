import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";
import {
  checkScene,
  formatSceneProblems,
  readScene,
  sceneCellCount,
  sceneFindings,
  sceneNativeReferences,
  SCENE_CONTRACT,
  SCENE_VERSION,
  setSceneProperty,
  writeScene,
  type Scene,
  type SceneProblem,
} from "../src/scene.ts";

/**
 * An authored scene, the spec's sample: comments, mixed quoting, flow and block style, optional keys
 * left out, an empty trigger slot and an empty item slot, a shading channel of 286, and a plugin block.
 * The board is 4 by 3 tiles on a 2-D grid, so each of its two floors has 12 cells.
 */
const AUTHORED = `contract: scene # the stamp
version: 1.0.0-pre.1
# Imported from cottage.brd, then extended in the scene editor.
tags: [imported]
metadata:
  source: cottage.brd
name: Cottage
projection: 2d
pixelCoordinates: true
size: {width: 4, height: 3}
floors:
  - id: ground
    title: Ground
    tiles: [[4, 1], [2, 2], [2, 4], [4, 1]]  # three rows of four cells
    boundarySources:
      walkableTiles:
        - {tileset: tiles/village.tkrtile, tile: grass-main}
        - {legacy: village.tst1}
      autoWallCaps: true
  - id: roof
    tiles: [[12, 0]]
tilePalette:
  - {}
  - {legacy: village.tst1}
  - {tileset: tiles/village.tkrtile, tile: stone-wall-base}
  - {}
  - {legacy: water.tan}
shading:
  - floor: roof
    cells: [[8, 0, 0, 0], [4, 286, -20, -10]] # 286 is carried as stored
    legacy: {excessCells: [2, 286, -20, -10]}
lights:
  - floor: ground
    type: ellipse
    nodes: [[64, 48], [96, 48], [64, 80]]
    colors: [[0, 0, 0], [60, 50, 20]]
vectors:
  - id: north-wall
    label: "North wall"
    floor: ground
    type: solid
    closed: false
    points: [[0, 8], [128, 8]]
  - floor: ground
    type: under
    attributes: 3
    closed: true
    points: [[32, 8], [64, 8], [64, 32], [32, 32]]
  - floor: ground
    type: stairs
    toFloor: roof
    closed: true
    points: [[96, 56], [124, 56], [124, 88], [96, 88]]
  - floor: ground
    type: waypoint
    handle: patrol
    closed: false
    points: [[16, 80], [112, 80]]
triggers:
  - id: open-door
    floor: ground
    program: open_door.prg # the cottage door
    condition: {mode: conditional, variable: "7f3a9c1e"}
    afterRun: {variable: "7f3a9c1e", value: _guid}
    activation: {keyPress: true, repeat: true, repeatDistance: 16}
    points: [[32, 64], [64, 64], [64, 96], [32, 96]]
    closed: true
    legacy: {graphic: door.gph, reserved: keep}
  # the second slot is empty and keeps its index
  - floor: ground
items:
  - id: chest-gold
    floor: ground
    item: chest.itm
    x: 48
    y: 80
    activationProgram: open_chest.prg
    multitaskProgram: sparkle.prg
    condition: {mode: conditional, variable: chest_opened, value: "0"}
    afterRun: {variable: chest_opened, value: "1"}
    loadCondition: {variable: chapter, value: "2"}
    activation: {keyPress: true}
    legacy: {reserved: 7}
  - {floor: ground, x: 0, y: 0}
images:
  - id: fountain
    floor: ground
    source: fountain.png
    x: 32
    y: 16
    type: parallax
    transparent: [255, 0, 255]
    legacy: {reserved: 90}
placedPacks:
  - instanceId: lantern-1
    pack: packs/cottage-props.tkrpack
    asset: lantern
    floor: ground
    x: 24
    y: 40
atmosphere:
  ambient: [-10, -10, 0]
  music: cottage_theme.ogg
  background:
    image: sky.png
    type: stretch
    color: [120, 160, 240]
start: {x: 64, y: 80, floor: ground}
links: {north: village.brd, east: exit.prg}
enterProgram: enter_cottage.prg
battle: {background: forest.bkg, skill: 2, allowed: true}
savingDisabled: true
threads: [ambient.prg, ""]
constants: [gold, "", "7"]
legacy: {layerTitleZero: unused, trailingBytes: AAEC, excessTiles: [3, 0]}
pluginData:
  com.example.weather: # plugin-owned block
    version: 0.1.0
    data:
      wind: 3.10
      perItem:
        chest-gold: {shimmer: 2}
`;

const PLUGIN_BLOCK = AUTHORED.slice(AUTHORED.indexOf("pluginData:"));

function refused(text: string): readonly SceneProblem[] {
  const result = readScene(text);
  if (result.ok) throw new Error("expected the reader to refuse the document");
  return result.problems;
}

function accepted(text: string): Scene {
  const result = readScene(text);
  if (!result.ok) throw new Error(`expected the reader to accept the document:\n${formatSceneProblems(result.problems)}`);
  return result.scene;
}

/** `text` with `from` replaced by `to`; fails the test when `from` is not there. */
function swap(text: string, from: string, to: string): string {
  ok(text.includes(from), `the fixture holds ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

/** The 1-based number of the first line that holds `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  ok(index >= 0, `the text holds ${JSON.stringify(needle)}`);
  return index + 1;
}

/** The 0-based numbers of the lines that differ, for two texts of the same line count. */
function changedLines(before: string, after: string): number[] {
  const left = before.split("\n");
  const right = after.split("\n");
  equal(right.length, left.length, "the edit kept the number of lines");
  return left.flatMap((line, index) => (line === right[index] ? [] : [index]));
}

const comments = (text: string): string[] => text.split("\n").flatMap((line) => (line.includes("#") ? [line.slice(line.indexOf("#"))] : []));

/** The authored model without its plugin parts, as an importer would hold it. */
function plain(): Record<string, any> {
  const { pluginData: _pluginData, pluginSource: _pluginSource, ...rest } = accepted(AUTHORED);
  return structuredClone(rest) as Record<string, any>;
}

function edited(path: (string | number)[], value: string | number | boolean, text = AUTHORED): string {
  const result = setSceneProperty(text, path, value);
  if (!result.ok) throw new Error(`expected the edit to be made:\n${formatSceneProblems(result.problems)}`);
  return result.text;
}

function refusedEdit(path: (string | number)[], value: string | number | boolean, text = AUTHORED): readonly SceneProblem[] {
  const result = setSceneProperty(text, path, value);
  if (result.ok) throw new Error("expected the edit to be refused");
  return result.problems;
}

/** The smallest scene the contract allows: a stamp, a projection, a size and one floor. */
const MINIMAL = `contract: scene
version: 1.0.0-pre.1
projection: 2d
size: {width: 2, height: 1}
floors:
  - id: layer-1
`;

// ---------------------------------------------------------------- reading

void test("an authored scene reads into the typed model and keeps its source", () => {
  const result = readScene(AUTHORED);
  if (!result.ok) throw new Error(formatSceneProblems(result.problems));
  equal(result.source, AUTHORED);
  const scene = result.scene;
  equal(scene.contract, SCENE_CONTRACT);
  equal(scene.version, SCENE_VERSION);
  deepEqual(scene.tags, ["imported"]);
  deepEqual(scene.metadata, { source: "cottage.brd" });
  equal(scene.name, "Cottage");
  equal(scene.projection, "2d");
  equal(scene.pixelCoordinates, true);
  deepEqual(scene.size, { width: 4, height: 3 });

  equal(scene.floors.length, 2);
  deepEqual(scene.floors[0], {
    id: "ground",
    title: "Ground",
    tiles: [[4, 1], [2, 2], [2, 4], [4, 1]],
    boundarySources: {
      walkableTiles: [{ tileset: "tiles/village.tkrtile", tile: "grass-main" }, { legacy: "village.tst1" }],
      autoWallCaps: true,
    },
  });
  deepEqual(scene.floors[1], { id: "roof", tiles: [[12, 0]] });
  ok(!("title" in scene.floors[1]!), "an absent title stays absent");

  deepEqual(scene.tilePalette, [{}, { legacy: "village.tst1" }, { tileset: "tiles/village.tkrtile", tile: "stone-wall-base" }, {}, { legacy: "water.tan" }]);
  deepEqual(scene.shading, [{ floor: "roof", cells: [[8, 0, 0, 0], [4, 286, -20, -10]], legacy: { excessCells: [2, 286, -20, -10] } }]);
  deepEqual(scene.lights, [{ floor: "ground", type: "ellipse", nodes: [[64, 48], [96, 48], [64, 80]], colors: [[0, 0, 0], [60, 50, 20]] }]);
  equal(scene.vectors?.length, 4);
  deepEqual(scene.vectors?.[0], { id: "north-wall", label: "North wall", floor: "ground", type: "solid", closed: false, points: [[0, 8], [128, 8]] });
  equal(scene.vectors?.[1]?.attributes, 3);
  deepEqual([scene.vectors?.[2]?.type, scene.vectors?.[2]?.toFloor], ["stairs", "roof"]);
  deepEqual([scene.vectors?.[3]?.type, scene.vectors?.[3]?.handle], ["waypoint", "patrol"]);

  equal(scene.triggers?.length, 2);
  deepEqual(scene.triggers?.[0], {
    id: "open-door",
    floor: "ground",
    program: "open_door.prg",
    condition: { mode: "conditional", variable: "7f3a9c1e" },
    afterRun: { variable: "7f3a9c1e", value: "_guid" },
    activation: { keyPress: true, repeat: true, repeatDistance: 16 },
    points: [[32, 64], [64, 64], [64, 96], [32, 96]],
    closed: true,
    legacy: { graphic: "door.gph", reserved: "keep" },
  });
  deepEqual(scene.triggers?.[1], { floor: "ground" }, "an empty trigger slot keeps its place");

  equal(scene.items?.length, 2);
  deepEqual(scene.items?.[0], {
    id: "chest-gold",
    floor: "ground",
    item: "chest.itm",
    x: 48,
    y: 80,
    activationProgram: "open_chest.prg",
    multitaskProgram: "sparkle.prg",
    condition: { mode: "conditional", variable: "chest_opened", value: "0" },
    afterRun: { variable: "chest_opened", value: "1" },
    loadCondition: { variable: "chapter", value: "2" },
    activation: { keyPress: true },
    legacy: { reserved: 7 },
  });
  deepEqual(scene.items?.[1], { floor: "ground", x: 0, y: 0 }, "an empty item slot keeps its place");
  deepEqual(scene.images, [{ id: "fountain", floor: "ground", source: "fountain.png", x: 32, y: 16, type: "parallax", transparent: [255, 0, 255], legacy: { reserved: 90 } }]);
  deepEqual(scene.placedPacks, [{ instanceId: "lantern-1", pack: "packs/cottage-props.tkrpack", asset: "lantern", floor: "ground", x: 24, y: 40 }]);
  deepEqual(scene.atmosphere, {
    ambient: [-10, -10, 0],
    music: "cottage_theme.ogg",
    background: { image: "sky.png", type: "stretch", color: [120, 160, 240] },
  });
  deepEqual(scene.start, { x: 64, y: 80, floor: "ground" });
  deepEqual(scene.links, { north: "village.brd", east: "exit.prg" });
  equal(scene.enterProgram, "enter_cottage.prg");
  deepEqual(scene.battle, { background: "forest.bkg", skill: 2, allowed: true });
  equal(scene.savingDisabled, true);
  deepEqual(scene.threads, ["ambient.prg", ""]);
  deepEqual(scene.constants, ["gold", "", "7"]);
  deepEqual(scene.legacy, { layerTitleZero: "unused", trailingBytes: "AAEC", excessTiles: [3, 0] });
  deepEqual(scene.pluginData?.["com.example.weather"]?.data, { wind: 3.1, perItem: { "chest-gold": { shimmer: 2 } } });
  equal(scene.pluginSource, PLUGIN_BLOCK);
});

void test("the reader reports the notes the contract names, with their lines, and they do not refuse the scene", () => {
  const result = readScene(AUTHORED);
  if (!result.ok) throw new Error(formatSceneProblems(result.problems));
  deepEqual(
    result.findings.map((finding) => [finding.severity, finding.path, finding.line]),
    [
      ["note", "shading[0].cells[1][1]", lineOf(AUTHORED, "cells: [[8, 0, 0, 0]")],
      ["note", "shading[0].legacy.excessCells[1]", lineOf(AUTHORED, "legacy: {excessCells")],
    ],
  );
  ok(result.findings[0]!.message.includes("286 is outside -255 to 255"));
  ok(result.findings[0]!.message.includes("carried exactly as stored"));
  equal(accepted(AUTHORED).shading?.[0]?.cells[1]?.[1], 286, "the channel is carried, never clamped");
});

void test("the smallest scene reads, and every optional key stays absent", () => {
  const result = readScene(MINIMAL);
  if (!result.ok) throw new Error(formatSceneProblems(result.problems));
  deepEqual(result.scene, { contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 2, height: 1 }, floors: [{ id: "layer-1" }] });
  deepEqual(result.findings, []);
  equal(accepted(swap(MINIMAL, "version: 1.0.0-pre.1", "version: 1.0.0-pre.1+build.7")).version, "1.0.0-pre.1+build.7");
});

void test("a document with no stamp, a wrong stamp or an unknown version is refused by name", () => {
  const body = AUTHORED.slice(AUTHORED.indexOf("name:"));
  deepEqual(
    refused(body).map((problem) => [problem.kind, problem.path]),
    [
      ["stamp", "contract"],
      ["stamp", "version"],
    ],
  );
  deepEqual(
    refused(swap(AUTHORED, "contract: scene", "contract: tileset")).map((problem) => [problem.kind, problem.path, problem.message]),
    [["shape", "contract", "must be `scene`"]],
  );
  ok(refused(swap(AUTHORED, "version: 1.0.0-pre.1", "version: 1.1.0"))[0]!.message.includes("not a version this reader knows"));
  ok(refused(swap(AUTHORED, "version: 1.0.0-pre.1", "version: 1.0"))[0]!.message.includes("patch is missing"));
  ok(refused(`name: Early\ncontract: scene\nversion: 1.0.0-pre.1\n${MINIMAL.slice(MINIMAL.indexOf("projection:"))}`)[0]!.message.includes("must be the first two keys"));
  equal(accepted(`version: 1.0.0-pre.1\ncontract: scene\n${MINIMAL.slice(MINIMAL.indexOf("projection:"))}`).projection, "2d");
  ok(refused(swap(AUTHORED, "projection: 2d\n", "projection: 2d\nprojection: 2d\n"))[0]!.message.includes("YAML error"));
});

void test("every plugin envelope problem kind is surfaced by the shared validator", () => {
  const cases: [string, string][] = [
    [swap(AUTHORED, PLUGIN_BLOCK, "pluginData: [com.example.weather]\n"), "container"],
    [swap(AUTHORED, "com.example.weather", "Com.example.weather"), "id"],
    [swap(AUTHORED, "pluginData:\n", "pluginData:\n  contract:\n    version: 1.0.0\n    data: {}\n"), "id"],
    [swap(AUTHORED, "    version: 0.1.0\n", "    version: 0.1\n"), "version"],
    [swap(AUTHORED, "    data:\n", "    extra: true\n    data:\n"), "shape"],
    [swap(AUTHORED, /    data:\n.*$/s.exec(AUTHORED)![0], "    data: [wind]\n"), "data"],
  ];
  for (const [text, kind] of cases) {
    const problems = refused(text);
    ok(problems.some((problem) => problem.kind === "plugin-block" && problem.pluginKind === kind), `${kind}: ${formatSceneProblems(problems)}`);
  }
});

void test("a plugin id that is a field name of the scene is refused, because it would be read as the field", () => {
  for (const id of ["size", "floors", "legacy"]) {
    const problems = refused(swap(AUTHORED, "com.example.weather", id));
    ok(problems.some((problem) => problem.kind === "plugin-block" && problem.pluginKind === "id" && problem.path === `pluginData.${id}`), formatSceneProblems(problems));
  }
});

// ---------------------------------------------------------------- the closed contract

void test("an unknown top-level key is refused while the plugin payload is kept, and removing the key reads again", () => {
  const typo = swap(AUTHORED, "projection: 2d\n", "projection: 2d\ntilepalette: []\n");
  const problems = refused(typo);
  deepEqual(
    problems.map((problem) => [problem.kind, problem.path, problem.line]),
    [["shape", "tilepalette", lineOf(typo, "tilepalette")]],
  );
  ok(problems[0]!.message.includes("the contract is closed"));
  ok(typo.endsWith(PLUGIN_BLOCK), "the refused text still holds the plugin block exactly");
  deepEqual(accepted(typo.replace("tilepalette: []\n", "")).pluginData?.["com.example.weather"]?.data["perItem"], { "chest-gold": { shimmer: 2 } });
  deepEqual(refused(swap(AUTHORED, "name: Cottage", "id: cottage\nname: Cottage")).map((problem) => problem.path), ["id"], "a document-level id is not a field");
});

void test("a plugin block cannot sit on a floor, a record or a placement: those objects are closed and there is one door", () => {
  const cases: [string, string][] = [
    ["    title: Ground\n", "floors[0].pluginData"],
    ["    item: chest.itm\n", "items[0].pluginData"],
    ["    asset: lantern\n", "placedPacks[0].pluginData"],
    ["    type: ellipse\n", "lights[0].pluginData"],
  ];
  for (const [anchor, path] of cases) {
    const problems = refused(swap(AUTHORED, anchor, `${anchor}    pluginData: {}\n`));
    ok(problems.some((problem) => problem.path === path), `${path}: ${formatSceneProblems(problems)}`);
  }
});

void test("each rule of the contract page refuses what it says", () => {
  const cases: [string, (model: Record<string, any>) => void, string][] = [
  ["empty name", (m) => (m.name = ""), "name"],
  ["name as a number", (m) => (m.name = 7), "name"],
  ["unknown projection", (m) => (m.projection = "3d"), "projection"],
  ["projection in capitals", (m) => (m.projection = "2D"), "projection"],
  ["no projection", (m) => delete m.projection, "(document)"],
  ["pixelCoordinates as text", (m) => (m.pixelCoordinates = "yes"), "pixelCoordinates"],
  ["null tags", (m) => (m.tags = null), "tags"],
  ["empty tag", (m) => (m.tags = [""]), "tags[0]"],
  ["metadata as a list", (m) => (m.metadata = ["a"]), "metadata"],
  ["no size", (m) => delete m.size, "(document)"],
  ["size without a height", (m) => delete m.size.height, "size"],
  ["width zero", (m) => (m.size.width = 0), "size.width"],
  ["height above i16", (m) => (m.size.height = 32768), "size.height"],
  ["fractional width", (m) => (m.size.width = 4.5), "size.width"],
  ["unknown size key", (m) => (m.size.depth = 2), "size.depth"],
  ["a grid of cells over the limit", (m) => (m.size = { width: 2048, height: 1025 }), "size"],
  ["no floors", (m) => (m.floors = []), "floors"],
  ["floors as a mapping", (m) => (m.floors = {}), "floors"],
  ["a floor without an id", (m) => delete m.floors[0].id, "floors[0]"],
  ["floor id in capitals", (m) => (m.floors[0].id = "Ground"), "floors[0].id"],
  ["floor id with an underscore", (m) => (m.floors[0].id = "ground_floor"), "floors[0].id"],
  ["duplicate floor id", (m) => (m.floors[1].id = "ground"), "floors[1].id"],
  ["empty floor title", (m) => (m.floors[0].title = ""), "floors[0].title"],
  ["a layer key on a floor", (m) => (m.floors[0].layer = 1), "floors[0].layer"],
  ["a run of one number", (m) => (m.floors[0].tiles[0] = [4]), "floors[0].tiles[0]"],
  ["a run of zero cells", (m) => (m.floors[0].tiles[0] = [0, 1]), "floors[0].tiles[0][0]"],
  ["a fractional run count", (m) => (m.floors[0].tiles[0] = [4.5, 1]), "floors[0].tiles[0][0]"],
  ["a negative palette index", (m) => (m.floors[0].tiles[0] = [4, -1]), "floors[0].tiles[0][1]"],
  ["a palette index past the palette", (m) => (m.floors[0].tiles[0] = [4, 5]), "floors[0].tiles[0][1]"],
  ["a palette index above 32767", (m) => (m.floors[0].tiles[0] = [4, 32768]), "floors[0].tiles[0][1]"],
  ["runs that fall one cell short", (m) => (m.floors[0].tiles[3] = [3, 1]), "floors[0].tiles"],
  ["runs that run one cell over", (m) => (m.floors[1].tiles = [[13, 0]]), "floors[1].tiles"],
  ["an empty run list", (m) => (m.floors[1].tiles = []), "floors[1].tiles"],
  ["runs as text", (m) => (m.floors[1].tiles = "12x0"), "floors[1].tiles"],
  ["a run that would cross into the next floor", (m) => ((m.floors[0].tiles = [[20, 1]]), (m.floors[1].tiles = [[4, 0]])), "floors[0].tiles"],
  ["a nonzero index with no palette", (m) => delete m.tilePalette, "floors[0].tiles[0][1]"],
  ["an iso-rotated board with the runs of a 2d board", (m) => (m.projection = "iso-rotated"), "floors[0].tiles"],
  ["an empty boundary tile list", (m) => (m.floors[0].boundarySources.walkableTiles = []), "floors[0].boundarySources.walkableTiles"],
  ["an empty slot among the walkable tiles", (m) => (m.floors[0].boundarySources.walkableTiles[1] = {}), "floors[0].boundarySources.walkableTiles[1]"],
  ["a bare string among the walkable tiles", (m) => (m.floors[0].boundarySources.walkableTiles[1] = "village.tst1"), "floors[0].boundarySources.walkableTiles[1]"],
  ["autoWallCaps as text", (m) => (m.floors[0].boundarySources.autoWallCaps = "yes"), "floors[0].boundarySources.autoWallCaps"],
  ["an unknown boundary key", (m) => (m.floors[0].boundarySources.tracer = "fast"), "floors[0].boundarySources.tracer"],
  ["a palette that does not start with an empty slot", (m) => (m.tilePalette[0] = { legacy: "a.tst1" }), "tilePalette[0]"],
  ["an empty palette", (m) => (m.tilePalette = []), "tilePalette"],
  ["a null palette", (m) => (m.tilePalette = null), "tilePalette"],
  ["a palette entry as text", (m) => (m.tilePalette[1] = "village.tst1"), "tilePalette[1]"],
  ["an empty legacy tile", (m) => (m.tilePalette[1].legacy = ""), "tilePalette[1].legacy"],
  ["a tile that is legacy and native", (m) => (m.tilePalette[1].tileset = "tiles/village.tkrtile"), "tilePalette[1]"],
  ["a native tile with no tile id", (m) => delete m.tilePalette[2].tile, "tilePalette[2]"],
  ["a native tile with no tileset", (m) => delete m.tilePalette[2].tileset, "tilePalette[2]"],
  ["a tile id in capitals", (m) => (m.tilePalette[2].tile = "Stone"), "tilePalette[2].tile"],
  ["a tileset that is not a tileset path", (m) => (m.tilePalette[2].tileset = "tiles/village.png"), "tilePalette[2].tileset"],
  ["a tileset that is a pack", (m) => (m.tilePalette[2].tileset = "packs/props.tkrpack"), "tilePalette[2].tileset"],
  ["an absolute tileset path", (m) => (m.tilePalette[2].tileset = "/tiles/village.tkrtile"), "tilePalette[2].tileset"],
  ["a tileset path with a backslash", (m) => (m.tilePalette[2].tileset = "tiles\\village.tkrtile"), "tilePalette[2].tileset"],
  ["a tileset path leaving the project", (m) => (m.tilePalette[2].tileset = "../village.tkrtile"), "tilePalette[2].tileset"],
  ["an unknown palette key", (m) => (m.tilePalette[1].path = "x"), "tilePalette[1].path"],
  ["a shading layer with no cells", (m) => delete m.shading[0].cells, "shading[0]"],
  ["a shading layer with no layer", (m) => delete m.shading[0].floor, "shading[0]"],
  ["a shading layer with a floor and a layer", (m) => (m.shading[0].layer = 2), "shading[0]"],
  ["a shading layer on no floor", (m) => (m.shading[0].floor = "cellar"), "shading[0].floor"],
  ["shading cells that fall short", (m) => (m.shading[0].cells[1][0] = 3), "shading[0].cells"],
  ["a shading run of zero cells", (m) => (m.shading[0].cells[0][0] = 0), "shading[0].cells[0][0]"],
  ["a shading channel above i16", (m) => (m.shading[0].cells[1][1] = 40000), "shading[0].cells[1][1]"],
  ["a fractional shading channel", (m) => (m.shading[0].cells[0][2] = 0.5), "shading[0].cells[0][2]"],
  ["a shading run of three numbers", (m) => (m.shading[0].cells[0] = [8, 0, 0]), "shading[0].cells[0]"],
  ["a shading layer id in capitals", (m) => (m.shading[0].id = "Dusk"), "shading[0].id"],
  ["excess cells of zero", (m) => (m.shading[0].legacy.excessCells[0] = 0), "shading[0].legacy.excessCells[0]"],
  ["excess cells past what a record holds", (m) => (m.shading[0].legacy.excessCells[0] = 32767), "shading[0].legacy.excessCells[0]"],
  ["excess cells with another tint than the last cell", (m) => (m.shading[0].legacy.excessCells = [2, 0, 0, 0]), "shading[0].legacy.excessCells"],
  ["an unknown shading legacy key", (m) => (m.shading[0].legacy.excessTiles = [1, 0]), "shading[0].legacy.excessTiles"],
  ["a light of an unknown type", (m) => (m.lights[0].type = "spot"), "lights[0].type"],
  ["a light with no nodes", (m) => delete m.lights[0].nodes, "lights[0]"],
  ["a node of three numbers", (m) => (m.lights[0].nodes[0] = [1, 2, 3]), "lights[0].nodes[0]"],
  ["a light colour above i16", (m) => (m.lights[0].colors[1][0] = 40000), "lights[0].colors[1][0]"],
  ["a light on no floor", (m) => (m.lights[0].floor = "cellar"), "lights[0].floor"],
  ["a light with a fractional layer", (m) => ((m.lights[0].layer = 1.5), delete m.lights[0].floor), "lights[0].layer"],
  ["a vector with one point", (m) => (m.vectors[0].points = [[0, 8]]), "vectors[0].points"],
  ["a vector with no points", (m) => delete m.vectors[0].points, "vectors[0]"],
  ["a vector of an unknown type", (m) => (m.vectors[0].type = "wall"), "vectors[0].type"],
  ["a vector with no closed", (m) => delete m.vectors[0].closed, "vectors[0]"],
  ["closed as text", (m) => (m.vectors[0].closed = "yes"), "vectors[0].closed"],
  ["an empty label", (m) => (m.vectors[0].label = ""), "vectors[0].label"],
  ["an empty handle", (m) => (m.vectors[3].handle = ""), "vectors[3].handle"],
  ["attributes on a solid vector", (m) => (m.vectors[0].attributes = 1), "vectors[0].attributes"],
  ["attributes above 7", (m) => (m.vectors[1].attributes = 8), "vectors[1].attributes"],
  ["a fractional attributes mask", (m) => (m.vectors[1].attributes = 1.5), "vectors[1].attributes"],
  ["a stairs target on a solid vector", (m) => (m.vectors[0].toFloor = "roof"), "vectors[0].toFloor"],
  ["a stairs layer on a solid vector", (m) => (m.vectors[0].toLayer = 2), "vectors[0].toLayer"],
  ["stairs with no target", (m) => delete m.vectors[2].toFloor, "vectors[2]"],
  ["stairs with both targets", (m) => (m.vectors[2].toLayer = 2), "vectors[2]"],
  ["stairs to no floor", (m) => (m.vectors[2].toFloor = "cellar"), "vectors[2].toFloor"],
  ["stairs to a layer above i16", (m) => ((m.vectors[2].toLayer = 40000), delete m.vectors[2].toFloor), "vectors[2].toLayer"],
  ["a vector layer above i16", (m) => ((m.vectors[1].layer = 40000), delete m.vectors[1].floor), "vectors[1].layer"],
  ["a vector with a floor and a layer", (m) => (m.vectors[1].layer = 4), "vectors[1]"],
  ["a vector with no floor or layer", (m) => delete m.vectors[1].floor, "vectors[1]"],
  ["a vector on no floor", (m) => (m.vectors[1].floor = "cellar"), "vectors[1].floor"],
  ["a vector id repeated", (m) => (m.vectors[1].id = "north-wall"), "vectors[1].id"],
  ["a vector id in capitals", (m) => (m.vectors[0].id = "North-Wall"), "vectors[0].id"],
  ["a trigger program of empty text", (m) => (m.triggers[0].program = ""), "triggers[0].program"],
  ["a trigger condition mode that is not known", (m) => (m.triggers[0].condition.mode = "sometimes"), "triggers[0].condition.mode"],
  ["a trigger condition variable that is empty", (m) => (m.triggers[0].condition.variable = ""), "triggers[0].condition.variable"],
  ["an unknown afterRun key", (m) => (m.triggers[0].afterRun.flag = "x"), "triggers[0].afterRun.flag"],
  ["a fractional repeat distance", (m) => (m.triggers[0].activation.repeatDistance = 1.5), "triggers[0].activation.repeatDistance"],
  ["a repeat distance above i16", (m) => (m.triggers[0].activation.repeatDistance = 40000), "triggers[0].activation.repeatDistance"],
  ["an activation flag as text", (m) => (m.triggers[0].activation.keyPress = "yes"), "triggers[0].activation.keyPress"],
  ["a trigger point of one number", (m) => (m.triggers[0].points[0] = [32]), "triggers[0].points[0]"],
  ["a trigger activate key", (m) => (m.triggers[0].activate = 1), "triggers[0].activate"],
  ["an empty trigger graphic", (m) => (m.triggers[0].legacy.graphic = ""), "triggers[0].legacy.graphic"],
  ["a trigger reserved value that is a number", (m) => (m.triggers[0].legacy.reserved = 7), "triggers[0].legacy.reserved"],
  ["a trigger on no floor", (m) => (m.triggers[1].floor = "cellar"), "triggers[1].floor"],
  ["an item without x", (m) => delete m.items[0].x, "items[0]"],
  ["an item x above i16", (m) => (m.items[0].x = 40000), "items[0].x"],
  ["a fractional item y", (m) => (m.items[0].y = 80.5), "items[0].y"],
  ["an item file of empty text", (m) => (m.items[0].item = ""), "items[0].item"],
  ["an empty activation program", (m) => (m.items[0].activationProgram = ""), "items[0].activationProgram"],
  ["a stop-movement flag on an item", (m) => (m.items[0].activation.stopsMovement = true), "items[0].activation.stopsMovement"],
  ["a mode on a loading condition", (m) => (m.items[0].loadCondition.mode = "always"), "items[0].loadCondition.mode"],
  ["an item reserved value as text", (m) => (m.items[0].legacy.reserved = "7"), "items[0].legacy.reserved"],
  ["an unknown item legacy key", (m) => (m.items[0].legacy.graphic = "x"), "items[0].legacy.graphic"],
  ["an item id repeated", (m) => (m.items[1].id = "chest-gold"), "items[1].id"],
  ["an image without a colour", (m) => delete m.images[0].transparent, "images[0]"],
  ["an image colour above 255", (m) => (m.images[0].transparent = [256, 0, 255]), "images[0].transparent[0]"],
  ["an image colour of two channels", (m) => (m.images[0].transparent = [0, 0]), "images[0].transparent"],
  ["an unknown image type", (m) => (m.images[0].type = "tile"), "images[0].type"],
  ["a fractional image x", (m) => (m.images[0].x = 1.5), "images[0].x"],
  ["an image reserved value above i16", (m) => (m.images[0].legacy.reserved = 40000), "images[0].legacy.reserved"],
  ["a pack placement without an instance id", (m) => delete m.placedPacks[0].instanceId, "placedPacks[0]"],
  ["a pack placement instance id repeated", (m) => m.placedPacks.push({ ...m.placedPacks[0] }), "placedPacks[1].instanceId"],
  ["a pack that is a tileset path", (m) => (m.placedPacks[0].pack = "tiles/village.tkrtile"), "placedPacks[0].pack"],
  ["a pack with no extension", (m) => (m.placedPacks[0].pack = "packs/cottage-props"), "placedPacks[0].pack"],
  ["a pack placement asset in capitals", (m) => (m.placedPacks[0].asset = "Lantern"), "placedPacks[0].asset"],
  ["a pack placement without a floor", (m) => delete m.placedPacks[0].floor, "placedPacks[0]"],
  ["a pack placement on no floor", (m) => (m.placedPacks[0].floor = "cellar"), "placedPacks[0].floor"],
  ["a layer escape on a pack placement", (m) => (m.placedPacks[0].layer = 3), "placedPacks[0].layer"],
  ["a fractional pack placement x", (m) => (m.placedPacks[0].x = 24.5), "placedPacks[0].x"],
  ["an ambient tint of two channels", (m) => (m.atmosphere.ambient = [0, 0]), "atmosphere.ambient"],
  ["an ambient channel above i16", (m) => (m.atmosphere.ambient = [40000, 0, 0]), "atmosphere.ambient[0]"],
  ["an empty music file", (m) => (m.atmosphere.music = ""), "atmosphere.music"],
  ["a background type that is not known", (m) => (m.atmosphere.background.type = "tiled"), "atmosphere.background.type"],
  ["a background colour above 255", (m) => (m.atmosphere.background.color = [300, 0, 0]), "atmosphere.background.color[0]"],
  ["an unknown atmosphere key", (m) => (m.atmosphere.weather = "rain"), "atmosphere.weather"],
  ["a start x of zero", (m) => (m.start.x = 0), "start.x"],
  ["a start y of zero", (m) => (m.start.y = -3), "start.y"],
  ["a start layer of zero", (m) => ((m.start.layer = 0), delete m.start.floor), "start.layer"],
  ["a start with a floor and a layer", (m) => (m.start.layer = 5), "start"],
  ["a start floor that names nothing", (m) => (m.start.floor = "cellar"), "start.floor"],
  ["an empty link", (m) => (m.links.north = ""), "links.north"],
  ["an unknown link edge", (m) => (m.links.up = "a.brd"), "links.up"],
  ["an empty enter program", (m) => (m.enterProgram = ""), "enterProgram"],
  ["a battle skill above i16", (m) => (m.battle.skill = 40000), "battle.skill"],
  ["battle allowed as text", (m) => (m.battle.allowed = "true"), "battle.allowed"],
  ["an unknown battle key", (m) => (m.battle.music = "x"), "battle.music"],
  ["savingDisabled as a number", (m) => (m.savingDisabled = 1), "savingDisabled"],
  ["threads as text", (m) => (m.threads = "ambient.prg"), "threads"],
  ["a thread that is a number", (m) => (m.threads[0] = 7), "threads[0]"],
  ["null constants", (m) => (m.constants = null), "constants"],
  ["an unknown legacy key", (m) => (m.legacy.padding = 2), "legacy.padding"],
  ["trailing bytes that are not base64", (m) => (m.legacy.trailingBytes = "AAE"), "legacy.trailingBytes"],
  ["empty trailing bytes", (m) => (m.legacy.trailingBytes = ""), "legacy.trailingBytes"],
  ["an empty layer title zero", (m) => (m.legacy.layerTitleZero = ""), "legacy.layerTitleZero"],
  ["excess tiles of zero cells", (m) => (m.legacy.excessTiles = [0, 0]), "legacy.excessTiles[0]"],
  ["excess tiles that do not continue the last run", (m) => (m.legacy.excessTiles = [3, 1]), "legacy.excessTiles[1]"],
  ["excess tiles above 32767", (m) => (m.legacy.excessTiles = [32768, 0]), "legacy.excessTiles[0]"],
  ["a draft things list", (m) => (m.things = []), "things"],
  ["a document-level id", (m) => (m.id = "cottage"), "id"],
  ["the draft grid key", (m) => (m.grid = { width: 4, height: 3 }), "grid"],
  ["a mistyped top-level key", (m) => (m.tilepalette = []), "tilepalette"],
  ["a floor list key on the top level of another contract", (m) => (m.frames = []), "frames"],
  ["a placement door for plugin data", (m) => (m.items[0].pluginData = {}), "items[0].pluginData"],
  ["a floor door for plugin data", (m) => (m.floors[0].pluginData = {}), "floors[0].pluginData"],

  ];
  for (const [name, change, path] of cases) {
    const model = plain();
    change(model);
    const problems = checkScene(model);
    ok(
      problems.some((problem) => problem.path === path),
      `${name}: expected a problem at ${path}, got ${formatSceneProblems(problems)}`,
    );
  }
  deepEqual(checkScene(plain()), []);
  equal(new Set(cases.map(([name]) => name)).size, cases.length, "each case has its own name");
});

void test("what the contract allows is read: every projection, empty lists, no palette, capitals in extensions, a layer no floor has", () => {
  const allowed: [string, (model: Record<string, any>) => void][] = [
    ["iso-stacked", (m) => (m.projection = "iso-stacked")],
    [
      "iso-rotated, whose grid is (width + height) square",
      (m) => {
        m.projection = "iso-rotated";
        m.floors[0].tiles = [[40, 1], [9, 2]];
        m.floors[1].tiles = [[49, 0]];
        m.shading[0].cells = [[49, 0, 0, 0]];
        m.shading[0].legacy.excessCells = [1, 0, 0, 0];
      },
    ],
    ["runs that carry across a row end", (m) => (m.floors[0].tiles = [[3, 1], [6, 2], [3, 1]])],
    [
      "every list empty",
      (m) => {
        for (const key of ["shading", "lights", "vectors", "triggers", "items", "images", "placedPacks", "threads", "constants"]) m[key] = [];
        delete m.legacy.excessTiles;
      },
    ],
    [
      "no palette, so every index is 0",
      (m) => {
        delete m.tilePalette;
        delete m.legacy;
        m.floors[0].tiles = [[12, 0]];
        m.floors[0].boundarySources.walkableTiles = [{ legacy: "village.tst1" }];
      },
    ],
    ["trailing empty palette slots", (m) => m.tilePalette.push({}, {})],
    [
      "capitals in the extension of a native document",
      (m) => {
        m.tilePalette[2].tileset = "Tiles/Village.TKRTILE";
        m.placedPacks[0].pack = "Packs/Props.TkrPack";
      },
    ],
    [
      "a layer that no floor has, as stored",
      (m) => {
        delete m.vectors[0].floor;
        m.vectors[0].layer = 3;
        delete m.items[0].floor;
        m.items[0].layer = -5;
        delete m.vectors[2].toFloor;
        m.vectors[2].toLayer = 7;
        delete m.start.floor;
        m.start.layer = 3;
      },
    ],
    ["a layer as wide as an i32 on a shading layer and a light", (m) => ((m.shading[0].layer = 100000), delete m.shading[0].floor, (m.lights[0].layer = -100000), delete m.lights[0].floor)],
    ["an empty start, which is the board's default", (m) => (m.start = {})],
    ["a handle on a solid vector and a zero under mask", (m) => ((m.vectors[0].handle = "wall"), (m.vectors[1].attributes = 0))],
    ["the largest under mask", (m) => (m.vectors[1].attributes = 7)],
    ["excess cells as long as a record can hold", (m) => (m.shading[0].legacy.excessCells[0] = 32766)],
    ["free-form metadata", (m) => (m.metadata = { source: "a.brd", nested: [1, { b: null }] })],
    [
      "a board of exactly 4,194,304 cells",
      (m) => {
        m.size = { width: 2048, height: 1024 };
        delete m.floors[0].tiles;
        delete m.floors[1].tiles;
        delete m.shading;
        delete m.legacy.excessTiles;
      },
    ],
  ];
  for (const [name, change] of allowed) {
    const model = plain();
    change(model);
    const problems = checkScene(model);
    deepEqual(problems, [], `${name}: ${formatSceneProblems(problems)}`);
  }
  const noTiles = plain();
  delete noTiles.floors[0].tiles;
  deepEqual(checkScene(noTiles), [], "a floor with no tiles has every cell empty");
});

void test("what the contract refuses at its limits: too many cells, too many floors, a record layer wider than an i16", () => {
  const big = plain();
  big.size = { width: 2048, height: 1025 };
  delete big.floors[0].tiles;
  delete big.floors[1].tiles;
  delete big.shading;
  delete big.legacy.excessTiles;
  const sized = checkScene(big);
  deepEqual(sized.map((problem) => problem.path), ["size"]);
  ok(sized[0]!.message.includes("2099200 cells") && sized[0]!.message.includes("at most 4,194,304"), sized[0]!.message);

  const floors = plain();
  floors.floors = Array.from({ length: 32768 }, (_, index) => ({ id: `f${index}` }));
  for (const key of ["tilePalette", "shading", "lights", "vectors", "triggers", "items", "images", "placedPacks", "start", "legacy"]) delete floors[key];
  deepEqual(checkScene(floors).map((problem) => problem.path), ["floors"]);

  const trigger = plain();
  delete trigger.triggers[0].floor;
  trigger.triggers[0].layer = 100000;
  deepEqual(checkScene(trigger).map((problem) => problem.path), ["triggers[0].layer"]);
});

// ---------------------------------------------------------------- warnings and notes

/** The findings of a model other than the two notes the fixture's shading always has. */
function findingsOf(model: Record<string, any>): [string, string][] {
  return sceneFindings(model).flatMap((finding): [string, string][] => (finding.path.startsWith("shading[0]") ? [] : [[finding.severity, finding.path]]));
}

void test("a layer that a floor has is a warning to write the floor, and never a refusal", () => {
  const model = plain();
  deepEqual(findingsOf(model), []);
  delete model.vectors[0].floor;
  model.vectors[0].layer = 1;
  delete model.vectors[1].floor;
  model.vectors[1].layer = 2;
  delete model.vectors[2].toFloor;
  model.vectors[2].toLayer = 2;
  delete model.start.floor;
  model.start.layer = 1;
  deepEqual(checkScene(model), [], "a warning never refuses");
  deepEqual(findingsOf(model), [
    ["warning", "vectors[0].layer"],
    ["warning", "vectors[1].layer"],
    ["warning", "vectors[2].toLayer"],
    ["warning", "start.layer"],
  ]);
  const message = sceneFindings(model).find((finding) => finding.path === "vectors[1].layer")!.message;
  ok(message.includes("floor `roof`") && message.includes("write `floor`"), message);

  const text = swap(AUTHORED, "  - floor: ground\n    type: under", "  - layer: 1\n    type: under");
  const read = readScene(text);
  if (!read.ok) throw new Error(formatSceneProblems(read.problems));
  const found = read.findings.find((finding) => finding.path === "vectors[1].layer")!;
  deepEqual([found.severity, found.line], ["warning", lineOf(text, "- layer: 1")]);
});

void test("a light whose node or colour count does not fit its type is a warning", () => {
  const cases: [string, (model: Record<string, any>) => void, string[]][] = [
    ["an ellipse with two nodes", (m) => m.lights[0].nodes.pop(), ["lights[0].nodes"]],
    ["a gradient with three nodes", (m) => (m.lights[0].type = "gradient"), ["lights[0].nodes"]],
    ["an ellipse with one colour", (m) => m.lights[0].colors.pop(), ["lights[0].colors"]],
    ["a clipped gradient with one node", (m) => ((m.lights[0].type = "clipped-gradient"), (m.lights[0].nodes = [[1, 1]])), ["lights[0].nodes"]],
    ["a clipped gradient with one colour", (m) => ((m.lights[0].type = "clipped-gradient"), m.lights[0].colors.pop()), []],
    ["a light with no nodes and no colours", (m) => ((m.lights[0].nodes = []), (m.lights[0].colors = [])), ["lights[0].nodes", "lights[0].colors"]],
  ];
  for (const [name, change, paths] of cases) {
    const model = plain();
    change(model);
    deepEqual(checkScene(model), [], name);
    deepEqual(findingsOf(model), paths.map((path) => ["warning", path]), name);
  }
});

void test("a shade, light or ambient channel outside -255 to 255 is a note and is never clamped or refused", () => {
  const model = plain();
  model.atmosphere.ambient = [300, -300, 255];
  model.lights[0].colors[1] = [-256, 0, 0];
  model.shading[0].cells[0] = [8, 0, 32767, -32768];
  deepEqual(checkScene(model), []);
  deepEqual(sceneFindings(model).map((finding) => [finding.severity, finding.path]), [
    ["note", "shading[0].cells[0][2]"],
    ["note", "shading[0].cells[0][3]"],
    ["note", "shading[0].cells[1][1]"],
    ["note", "shading[0].legacy.excessCells[1]"],
    ["note", "lights[0].colors[1][0]"],
    ["note", "atmosphere.ambient[0]"],
    ["note", "atmosphere.ambient[1]"],
  ]);
  ok(sceneFindings(model).every((finding) => finding.line === null), "a model has no lines");
  ok(!sceneFindings(model).some((finding) => finding.path === "atmosphere.ambient[2]"), "255 is inside the range");
});

// ---------------------------------------------------------------- cells, the grid and the residue

void test("a floor's runs and a shading layer's cells cover the effective grid exactly, once, and the problem says the grid", () => {
  const short = plain();
  short.floors[0].tiles[3] = [3, 1];
  const shortProblem = checkScene(short).find((problem) => problem.path === "floors[0].tiles")!;
  ok(shortProblem.message.includes("covers 11 cells") && shortProblem.message.includes("4 by 3, 12 cells"), shortProblem.message);

  const rotated = plain();
  rotated.projection = "iso-rotated";
  const problems = checkScene(rotated);
  deepEqual(
    problems.map((problem) => problem.path),
    ["floors[0].tiles", "floors[1].tiles", "shading[0].cells"],
  );
  ok(problems[0]!.message.includes("7 by 7") && problems[0]!.message.includes("49 cells"), problems[0]!.message);
  ok(problems[2]!.message.includes("no layers"), problems[2]!.message);

  const wide = plain();
  wide.size = { width: 5, height: 3 };
  deepEqual(
    checkScene(wide).map((problem) => problem.path),
    ["floors[0].tiles", "floors[1].tiles", "shading[0].cells"],
    "a size that disagrees with the runs is reported where the runs are",
  );
});

void test("the cells past the end of the last run are carried and must continue it", () => {
  const model = plain();
  model.floors[1].tiles = [[11, 0], [1, 2]];
  model.legacy.excessTiles = [1, 2];
  deepEqual(checkScene(model), [], "the extra cells show the index of the last cell");
  model.legacy.excessTiles = [1, 0];
  const problems = checkScene(model);
  deepEqual(problems.map((problem) => problem.path), ["legacy.excessTiles[1]"]);
  ok(problems[0]!.message.includes("the index of the last cell of the last floor, 2"), problems[0]!.message);

  const bare = plain();
  delete bare.floors[1].tiles;
  bare.legacy.excessTiles = [3, 1];
  deepEqual(checkScene(bare).map((problem) => problem.path), ["legacy.excessTiles[1]"], "a floor with no tiles ends on index 0");

  const unsound = plain();
  unsound.floors[1].tiles = [[11, 0], [1, 99]];
  unsound.legacy.excessTiles = [3, 5];
  deepEqual(checkScene(unsound).map((problem) => problem.path), ["floors[1].tiles[1][1]"], "an unsound last floor leaves the residue unjudged, not doubly reported");

  const shade = plain();
  shade.shading[0].legacy.excessCells = [2, 286, -20, -11];
  const shadeProblems = checkScene(shade);
  deepEqual(shadeProblems.map((problem) => problem.path), ["shading[0].legacy.excessCells"]);
  ok(shadeProblems[0]!.message.includes("[286, -20, -10]"), shadeProblems[0]!.message);
});

// ---------------------------------------------------------------- slots

void test("a palette keeps every slot: empty ones, trailing ones included, and an absent palette is not an empty one", () => {
  const trailing = accepted(swap(AUTHORED, "  - {legacy: water.tan}\n", "  - {legacy: water.tan}\n  - {}\n  - {}\n"));
  equal(trailing.tilePalette?.length, 7);
  deepEqual(trailing.tilePalette?.slice(3), [{}, { legacy: "water.tan" }, {}, {}]);

  const none = accepted(MINIMAL);
  ok(!("tilePalette" in none), "no table at all");
  deepEqual(checkScene({ ...none, floors: [{ id: "layer-1", tiles: [[2, 1]] }] }).map((problem) => problem.path), ["floors[0].tiles[0][1]"]);
  const empty = refused(`${MINIMAL}tilePalette: []\n`);
  deepEqual(empty.map((problem) => problem.path), ["tilePalette"]);
  ok(empty[0]!.message.includes("no position 0"), empty[0]!.message);
  const first = refused(`${MINIMAL}tilePalette:\n  - {legacy: a.tst1}\n`);
  deepEqual(first.map((problem) => problem.path), ["tilePalette[0]"]);
});

void test("threads and constants tell absent, empty and one empty entry apart, and an empty entry keeps its slot", () => {
  const absent = accepted(MINIMAL);
  ok(!("threads" in absent) && !("constants" in absent));
  const none = accepted(`${MINIMAL}threads: []\nconstants: []\n`);
  deepEqual([none.threads, none.constants], [[], []]);
  const one = accepted(`${MINIMAL}threads: [""]\nconstants: ["", gold, ""]\n`);
  deepEqual([one.threads, one.constants], [[""], ["", "gold", ""]]);
  ok(refused(`${MINIMAL}threads: [1]\n`).some((problem) => problem.path === "threads[0]"));
  ok(refused(`${MINIMAL}constants:\n`).some((problem) => problem.path === "constants"));
});

void test("a keyed text is never empty, but a record with nothing but its layer is a slot that keeps its index", () => {
  const slot = accepted(swap(AUTHORED, "  - floor: ground\nitems:", "  - floor: ground\n  - floor: ground\nitems:"));
  equal(slot.triggers?.length, 3);
  deepEqual(slot.triggers?.slice(1), [{ floor: "ground" }, { floor: "ground" }]);
  deepEqual(refused(swap(AUTHORED, "    program: open_door.prg", '    program: ""')).map((problem) => problem.path), ["triggers[0].program"]);
  ok(refused(swap(AUTHORED, "    item: chest.itm\n", '    item: ""\n'))[0]!.message.includes("an empty value is written by leaving the key out"));
});

// ---------------------------------------------------------------- locating a problem

void test("a problem names its line, and a floor reference names the entry that is wrong", () => {
  const text = swap(AUTHORED, "  - floor: ground\n    type: under", "  - floor: grund\n    type: under");
  const problems = refused(text);
  deepEqual(
    problems.map((problem) => [problem.kind, problem.path, problem.line]),
    [["shape", "vectors[1].floor", lineOf(text, "- floor: grund")]],
  );
  ok(problems[0]!.message.includes("`grund` names no floor of this document"));

  const duplicate = refused(swap(AUTHORED, "  - id: roof\n", "  - id: ground\n"));
  deepEqual(duplicate.map((problem) => problem.path), ["floors[1].id"]);
  ok(duplicate[0]!.message.includes("floors[0]"));

  const both = refused(swap(AUTHORED, "  - floor: roof\n    cells", "  - floor: roof\n    layer: 2\n    cells"));
  deepEqual(both.map((problem) => problem.path), ["shading[0]"]);
  ok(both[0]!.message.includes("both `floor` and `layer`"));

  const sum = refused(swap(AUTHORED, "[[12, 0]]", "[[11, 0]]"));
  deepEqual(sum.map((problem) => [problem.path, problem.line]), [["floors[1].tiles", lineOf(AUTHORED, "tiles: [[12, 0]]")]]);

  const every = refused(swap(swap(AUTHORED, "    type: ellipse\n", "    type: spot\n"), "    x: 48\n", "    x: 99999\n"));
  deepEqual(every.map((problem) => problem.path), ["lights[0].type", "items[0].x"], "every problem is reported, not the first");
});

void test("a document that is not a mapping, or whose key is null, is refused and never repaired", () => {
  equal(refused("- not\n- a mapping\n")[0]!.kind, "stamp");
  equal(refused("").length, 2);
  const nullSize = refused(swap(AUTHORED, "size: {width: 4, height: 3}", "size:"));
  deepEqual(nullSize.map((problem) => [problem.path, problem.line]), [["size", lineOf(swap(AUTHORED, "size: {width: 4, height: 3}", "size:"), "size:")]]);
  ok(nullSize[0]!.message.includes("leave the key out"));
});

// ---------------------------------------------------------------- the model check

void test("the model check judges a model the way the reader judges a document, and ignores the source token", () => {
  const read = accepted(AUTHORED);
  deepEqual(checkScene(read), []);
  deepEqual(checkScene({ ...read, floors: [] }).map((problem) => problem.path), ["floors"]);
  deepEqual(checkScene(null).map((problem) => problem.path), ["(document)"]);
  deepEqual(checkScene({ ...read, tags: undefined }).map((problem) => problem.path), ["tags"]);
  deepEqual(sceneFindings(read).map((finding) => finding.path), ["shading[0].cells[1][1]", "shading[0].legacy.excessCells[1]"]);
});

// ---------------------------------------------------------------- what a project checker needs

void test("the native references and the cell count are available to a project checker", () => {
  const scene = accepted(AUTHORED);
  deepEqual(sceneNativeReferences(scene), [
    { path: "tilePalette[2]", kind: "tile", document: "tiles/village.tkrtile", id: "stone-wall-base" },
    { path: "floors[0].boundarySources.walkableTiles[0]", kind: "tile", document: "tiles/village.tkrtile", id: "grass-main" },
    { path: "placedPacks[0]", kind: "asset", document: "packs/cottage-props.tkrpack", id: "lantern" },
  ]);
  deepEqual(sceneNativeReferences(accepted(MINIMAL)), []);
  equal(sceneCellCount(scene), 12);
  equal(sceneCellCount({ projection: "iso-stacked", size: { width: 4, height: 3 } }), 12);
  equal(sceneCellCount({ projection: "iso-rotated", size: { width: 4, height: 3 } }), 49);
});

// ---------------------------------------------------------------- writing

void test("a source-backed write returns the authored bytes, comments, quoting and plugin block included", () => {
  const read = readScene(AUTHORED);
  if (!read.ok) throw new Error(formatSceneProblems(read.problems));
  const written = writeScene(read.scene, read.source);
  if (!written.ok) throw new Error(formatSceneProblems(written.problems));
  equal(written.text, AUTHORED);
});

void test("the byte-preservation proof can fail: re-printing or regenerating the document changes the authored bytes", () => {
  notEqual(parseDocument(AUTHORED, { version: "1.2", schema: "core" }).toString(), AUTHORED, "a re-printed document differs");
  const regenerated = writeScene(plain() as Scene);
  if (!regenerated.ok) throw new Error(formatSceneProblems(regenerated.problems));
  notEqual(regenerated.text, AUTHORED, "a document regenerated from the model differs");
  ok(!regenerated.text.includes("com.example.weather"));
  ok(!regenerated.text.includes("# the cottage door"));
  ok(!regenerated.text.includes("the second slot is empty"));
});

void test("a write refuses a plugin-bearing model without its source, a stale source and a source of another model", () => {
  const read = accepted(AUTHORED);
  const noSource = writeScene(read);
  ok(!noSource.ok && noSource.problems[0]!.kind === "edit" && noSource.problems[0]!.path === "pluginData");
  ok(!writeScene({ ...read, name: "Other" }, AUTHORED).ok, "a changed model cannot be paired with stale source");
  ok(!writeScene(read, swap(AUTHORED, "wind: 3.10", "wind: 3.1")).ok, "a lexically changed plugin block is a different source");
  ok(writeScene(read, swap(AUTHORED, "# the cottage door", "# the front door")).ok, "a comment-only difference still reads as the same model");
  const refusedSource = writeScene(read, swap(AUTHORED, "projection: 2d", "projection: 4d"));
  ok(!refusedSource.ok && refusedSource.problems[0]!.path === "projection", "a source the reader refuses is refused with its problems");
});

void test("a write refuses a model that breaks the contract and reports where", () => {
  const model = plain();
  model.vectors[1].floor = "cellar";
  model.floors[0].tiles[3] = [3, 1];
  const result = writeScene(model as Scene);
  ok(!result.ok);
  if (!result.ok) deepEqual(result.problems.map((problem) => problem.path).sort(), ["floors[0].tiles", "vectors[1].floor"]);
});

/** `value` with the keys of every mapping in the opposite order, so a writer cannot rely on the order it was given. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, part]) => [key, reversed(part)]));
}

void test("a new document is written in contract order, reads back to the same model, and leaves absent fields absent", () => {
  const model = plain() as Scene;
  const written = writeScene(model);
  if (!written.ok) throw new Error(formatSceneProblems(written.problems));
  ok(written.text.startsWith("contract: scene\nversion: 1.0.0-pre.1\ntags: [imported]\nmetadata:\n  source: cottage.brd\nname: Cottage\nprojection: 2d\npixelCoordinates: true\nsize: {width: 4, height: 3}\nfloors:\n"), written.text);
  for (const line of [
    "    tiles: [[4, 1], [2, 2], [2, 4], [4, 1]]\n",
    "        - {tileset: tiles/village.tkrtile, tile: grass-main}\n",
    "  - {}\n  - {legacy: village.tst1}\n  - {tileset: tiles/village.tkrtile, tile: stone-wall-base}\n",
    "    cells: [[8, 0, 0, 0], [4, 286, -20, -10]]\n    legacy: {excessCells: [2, 286, -20, -10]}\n",
    "    type: under\n    closed: true\n    points: [[32, 8], [64, 8], [64, 32], [32, 32]]\n    attributes: 3\n",
    "    activation: {keyPress: true, repeat: true, repeatDistance: 16}\n",
    "  - floor: ground\n    x: 0\n    y: 0\n",
    "    transparent: [255, 0, 255]\n",
    "start: {x: 64, y: 80, floor: ground}\n",
    'threads: [ambient.prg, ""]\n',
    'constants: [gold, "", "7"]\n',
    "legacy: {layerTitleZero: unused, trailingBytes: AAEC, excessTiles: [3, 0]}\n",
  ]) {
    ok(written.text.includes(line), `the text holds ${JSON.stringify(line)}:\n${written.text}`);
  }
  ok(!written.text.includes("pluginData"));
  deepEqual(accepted(written.text), model);
  const again = writeScene(accepted(written.text), written.text);
  ok(again.ok && again.text === written.text);

  const scrambled = writeScene(reversed(model) as Scene);
  ok(scrambled.ok && scrambled.text === written.text, "the order of the keys of the model does not change the text");
  const keys = Object.keys(parseDocument(written.text).toJS() as object);
  deepEqual(keys, [
    "contract", "version", "tags", "metadata", "name", "projection", "pixelCoordinates", "size", "floors", "tilePalette", "shading", "lights", "vectors",
    "triggers", "items", "images", "placedPacks", "atmosphere", "start", "links", "enterProgram", "battle", "savingDisabled", "threads", "constants", "legacy",
  ]);
});

void test("a new document keeps its slots: empty palette slots, an empty thread list, and a long run list one run to a line", () => {
  const model = {
    contract: "scene",
    version: "1.0.0-pre.1",
    name: "Quote: the 2nd",
    projection: "2d",
    size: { width: 3, height: 3 },
    floors: [{ id: "layer-1", tiles: [[1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [1, 0], [1, 1]] }],
    tilePalette: [{}, { legacy: "a.tst1" }, {}, {}],
    threads: [],
    constants: [""],
  } as unknown as Scene;
  const written = writeScene(model);
  if (!written.ok) throw new Error(formatSceneProblems(written.problems));
  ok(written.text.includes('name: "Quote: the 2nd"\n'));
  ok(written.text.includes("    tiles:\n      - [1, 1]\n      - [1, 0]\n"), written.text);
  ok(written.text.includes("tilePalette:\n  - {}\n  - {legacy: a.tst1}\n  - {}\n  - {}\n"), written.text);
  ok(written.text.includes("threads: []\nconstants: [\"\"]\n"), written.text);
  const back = accepted(written.text);
  deepEqual(back, model);
  deepEqual(back.tilePalette, [{}, { legacy: "a.tst1" }, {}, {}]);
  deepEqual([back.threads, back.constants], [[], [""]]);

  const eight = writeScene({ ...model, floors: [{ id: "layer-1", tiles: [[1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [2, 0]] }] } as Scene);
  ok(eight.ok && eight.text.includes("    tiles: [[1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [1, 0], [1, 1], [2, 0]]\n"), "eight runs still go on one line");
  const four = writeScene({ ...model, floors: [{ id: "layer-1", tiles: [[4, 1], [5, 0]] }] } as Scene);
  ok(four.ok && four.text.includes("    tiles: [[4, 1], [5, 0]]\n"), "a short list stays on one line");
});

// ---------------------------------------------------------------- editing

void test("a program edit changes that one value and nothing else: comments, quoting and the plugin block stay", () => {
  const result = edited(["triggers", 0, "program"], "close_door.prg");
  equal(result, swap(AUTHORED, "program: open_door.prg # the cottage door", "program: close_door.prg # the cottage door"));
  deepEqual(changedLines(AUTHORED, result), [lineOf(AUTHORED, "# the cottage door") - 1]);
  deepEqual(comments(result), comments(AUTHORED));
  equal(result.slice(result.indexOf("pluginData:")), PLUGIN_BLOCK);
  equal(accepted(result).triggers?.[0]?.program, "close_door.prg");
  deepEqual(accepted(result).triggers?.[1], accepted(AUTHORED).triggers?.[1]);
  equal(accepted(result).pluginSource, PLUGIN_BLOCK);
});

void test("an edit of a number, a boolean and a name in block, flow and list entries changes only that text", () => {
  equal(edited(["atmosphere", "music"], "other.ogg"), swap(AUTHORED, "music: cottage_theme.ogg", "music: other.ogg"));
  equal(edited(["atmosphere", "background", "color", 0], 10), swap(AUTHORED, "color: [120, 160, 240]", "color: [10, 160, 240]"));
  equal(edited(["floors", 0, "tiles", 1, 1], 3), swap(AUTHORED, "[[4, 1], [2, 2], [2, 4], [4, 1]]", "[[4, 1], [2, 3], [2, 4], [4, 1]]"));
  equal(edited(["savingDisabled"], false), swap(AUTHORED, "savingDisabled: true", "savingDisabled: false"));
  equal(edited(["battle", "skill"], 3), swap(AUTHORED, "skill: 2", "skill: 3"));
  equal(edited(["start", "x"], 100), swap(AUTHORED, "start: {x: 64,", "start: {x: 100,"));
  equal(edited(["vectors", 1, "attributes"], 5), swap(AUTHORED, "attributes: 3", "attributes: 5"));
  equal(edited(["lights", 0, "type"], "gradient"), swap(AUTHORED, "type: ellipse", "type: gradient"));
  equal(edited(["triggers", 0, "activation", "keyPress"], false), swap(AUTHORED, "activation: {keyPress: true,", "activation: {keyPress: false,"));
  equal(edited(["floors", 0, "boundarySources", "autoWallCaps"], false), swap(AUTHORED, "autoWallCaps: true", "autoWallCaps: false"));
  equal(edited(["threads", 1], "later.prg"), swap(AUTHORED, 'threads: [ambient.prg, ""]', 'threads: [ambient.prg, "later.prg"]'));
  equal(edited(["constants", 0], "silver"), swap(AUTHORED, 'constants: [gold, "", "7"]', 'constants: [silver, "", "7"]'));
  equal(edited(["constants", 2], "8"), swap(AUTHORED, 'constants: [gold, "", "7"]', 'constants: [gold, "", "8"]'), "a quoted value keeps its quote style");
});

void test("a replaced quoted value keeps its quote style, and a plain value is quoted only when it must be", () => {
  equal(edited(["vectors", 0, "label"], "South wall"), swap(AUTHORED, 'label: "North wall"', 'label: "South wall"'));
  equal(edited(["name"], "Cottage: the 2nd"), swap(AUTHORED, "name: Cottage", 'name: "Cottage: the 2nd"'));
  equal(accepted(edited(["name"], "Cottage: the 2nd")).name, "Cottage: the 2nd");
});

void test("a palette slot is filled in place and its neighbours do not move", () => {
  const filled = edited(["tilePalette", 3, "legacy"], "grass.tst2");
  equal(filled, swap(AUTHORED, "  - {tileset: tiles/village.tkrtile, tile: stone-wall-base}\n  - {}\n", "  - {tileset: tiles/village.tkrtile, tile: stone-wall-base}\n  - {legacy: grass.tst2}\n"));
  const scene = accepted(filled);
  equal(scene.tilePalette?.length, 5);
  deepEqual(scene.tilePalette?.[3], { legacy: "grass.tst2" });
  deepEqual(scene.tilePalette?.[4], { legacy: "water.tan" });
  equal(edited(["tilePalette", 1, "legacy"], "village.tst2"), swap(AUTHORED, "{legacy: village.tst1}\n  - {tileset", "{legacy: village.tst2}\n  - {tileset"));
  deepEqual(refusedEdit(["tilePalette", 0, "legacy"], "x.tst1").map((problem) => problem.path), ["tilePalette[0]"]);
  const half = refusedEdit(["tilePalette", 3, "tileset"], "tiles/village.tkrtile");
  ok(half.some((problem) => problem.path === "tilePalette[3]" && problem.message.includes("`tile` is required")), formatSceneProblems(half));
});

void test("an empty slot takes its program, item or id in the contract's key order, and the slot keeps its index", () => {
  const program = edited(["triggers", 1, "program"], "close.prg");
  equal(program, swap(AUTHORED, "  - floor: ground\nitems:", "  - floor: ground\n    program: close.prg\nitems:"));
  equal(accepted(program).triggers?.[1]?.program, "close.prg");
  equal(accepted(program).triggers?.length, 2);

  const id = edited(["triggers", 1, "id"], "trap");
  equal(id, swap(AUTHORED, "  - floor: ground\nitems:", "  - id: trap\n    floor: ground\nitems:"), "an id goes before the floor, on the dash's line, below the comment above the slot");
  ok(id.includes("  # the second slot is empty and keeps its index\n  - id: trap\n"));

  equal(edited(["items", 1, "item"], "bag.itm"), swap(AUTHORED, "{floor: ground, x: 0, y: 0}", "{floor: ground, item: bag.itm, x: 0, y: 0}"));
  equal(edited(["items", 1, "id"], "bag"), swap(AUTHORED, "{floor: ground, x: 0, y: 0}", "{id: bag, floor: ground, x: 0, y: 0}"));
});

void test("a key left out of the document is added where the contract's key order puts it, so removing and re-adding it gives back the authored text", () => {
  const cases: [string, string, (string | number)[], string | number | boolean][] = [
    ["name: Cottage\n", "the name, after the metadata block", ["name"], "Cottage"],
    ["pixelCoordinates: true\n", "a flag, after the projection", ["pixelCoordinates"], true],
    ["savingDisabled: true\n", "a flag, after the battle settings", ["savingDisabled"], true],
    ["enterProgram: enter_cottage.prg\n", "a program, after the links that are not there and the start", ["enterProgram"], "enter_cottage.prg"],
    ["    title: Ground\n", "a floor title, after its id", ["floors", 0, "title"], "Ground"],
    ["  music: cottage_theme.ogg\n", "the music, between the ambient tint and the background", ["atmosphere", "music"], "cottage_theme.ogg"],
    ["    type: parallax\n", "an image type, between the position and the colour", ["images", 0, "type"], "parallax"],
    ["    activationProgram: open_chest.prg\n", "an item program, after the position", ["items", 0, "activationProgram"], "open_chest.prg"],
  ];
  for (const [line, what, path, value] of cases) {
    const without = swap(AUTHORED, line, "");
    equal(edited(path, value, without), AUTHORED, what);
  }
  const flow = swap(AUTHORED, "links: {north: village.brd, east: exit.prg}", "links: {north: village.brd}");
  equal(edited(["links", "east"], "exit.prg", flow), AUTHORED, "a key is added at the end of a one-line mapping");
  const first = swap(AUTHORED, "links: {north: village.brd, east: exit.prg}", "links: {east: exit.prg}");
  equal(edited(["links", "north"], "village.brd", first), AUTHORED, "and at its front");
  const middle = swap(AUTHORED, "links: {north: village.brd, east: exit.prg}", "links: {north: village.brd, south: x.brd, east: exit.prg}");
  equal(edited(["links", "south"], "x.brd"), middle, "and in the middle");

  // The sample writes `handle` and `attributes` before `closed`; an added one goes where the contract's order puts it, after the points.
  const handle = swap(AUTHORED, "    handle: patrol\n", "");
  equal(
    edited(["vectors", 3, "handle"], "patrol", handle),
    swap(handle, "    points: [[16, 80], [112, 80]]\n", "    points: [[16, 80], [112, 80]]\n    handle: patrol\n"),
  );
  const mask = swap(AUTHORED, "    attributes: 3\n", "");
  equal(
    edited(["vectors", 1, "attributes"], 3, mask),
    swap(mask, "    points: [[32, 8], [64, 8], [64, 32], [32, 32]]\n", "    points: [[32, 8], [64, 8], [64, 32], [32, 32]]\n    attributes: 3\n"),
  );
});

void test("a new key goes below the comment lines that belong to the entry above it, and above those of the entry after it", () => {
  const text = `contract: scene
version: 1.0.0-pre.1
projection: 2d
size: {width: 1, height: 1}
floors:
  - id: ground # the first floor
    # about the tiles
    tiles: [[1, 0]]

# about the battle
battle:
  # about the skill
  skill: 2 # the skill level
  # about the flag
  allowed: true
# the end
`;
  accepted(text);
  equal(
    edited(["floors", 0, "title"], "Ground", text),
    swap(text, "  - id: ground # the first floor\n", "  - id: ground # the first floor\n    title: Ground\n"),
    "after the entry above, and before the comment of the entry below",
  );
  equal(
    edited(["battle", "background"], "forest.bkg", text),
    swap(text, "battle:\n  # about the skill\n", "battle:\n  background: forest.bkg\n  # about the skill\n"),
    "before the comment of the entry after it when no entry comes before",
  );
  equal(edited(["savingDisabled"], true, text), swap(text, "  allowed: true\n", "  allowed: true\nsavingDisabled: true\n"), "after the entry above, trailing comment and all, and before the comment that follows");
  equal(edited(["pixelCoordinates"], true, text), swap(text, "projection: 2d\n", "projection: 2d\npixelCoordinates: true\n"));
});

void test("a CRLF document gets CRLF lines, and every other byte stays", () => {
  const crlf = AUTHORED.replaceAll("\n", "\r\n");
  equal(edited(["floors", 1, "title"], "Roof", crlf), swap(AUTHORED, "  - id: roof\n", "  - id: roof\n    title: Roof\n").replaceAll("\n", "\r\n"));
  equal(edited(["triggers", 1, "id"], "trap", crlf), swap(AUTHORED, "  - floor: ground\nitems:", "  - id: trap\n    floor: ground\nitems:").replaceAll("\n", "\r\n"));
  equal(edited(["name"], "Hut", crlf), swap(AUTHORED, "name: Cottage", "name: Hut").replaceAll("\n", "\r\n"));
  const without = swap(AUTHORED, "name: Cottage\n", "").replaceAll("\n", "\r\n");
  equal(edited(["name"], "Cottage", without), crlf);
});

void test("an edit that would break the contract is refused with the reader's located reason, and nothing changes", () => {
  const cases: [(string | number)[], string | number | boolean, string[]][] = [
    [["triggers", 0, "condition", "mode"], "sometimes", ["triggers[0].condition.mode"]],
    [["floors", 0, "tiles", 1, 1], 9, ["floors[0].tiles[1][1]"]],
    [["floors", 0, "tiles", 1, 0], 3, ["floors[0].tiles"]],
    [["vectors", 1, "attributes"], 9, ["vectors[1].attributes"]],
    [["vectors", 2, "toFloor"], "cellar", ["vectors[2].toFloor"]],
    [["vectors", 2, "toLayer"], 2, ["vectors[2]"]],
    [["vectors", 0, "attributes"], 1, ["vectors[0].attributes"]],
    [["start", "layer"], 2, ["start"]],
    [["start", "y"], 0, ["start.y"]],
    [["placedPacks", 0, "pack"], "tiles/village.tkrtile", ["placedPacks[0].pack"]],
    [["placedPacks", 0, "floor"], "cellar", ["placedPacks[0].floor"]],
    [["tilePalette", 2, "tileset"], "tiles/village.tkrpack", ["tilePalette[2].tileset"]],
    [["tilePalette", 2, "tile"], "Stone", ["tilePalette[2].tile"]],
    [["legacy", "excessTiles", 1], 4, ["legacy.excessTiles[1]"]],
    [["contract"], "tileset", ["contract"]],
    [["version"], "1.0.0-pre.2", ["version"]],
    [["projection"], 2, ["projection"]],
    [["name"], "", ["name"]],
    [["triggers", 0, "program"], "", ["triggers[0].program"]],
  ];
  for (const [path, value, paths] of cases) {
    const problems = refusedEdit(path, value);
    deepEqual(problems.map((problem) => problem.path), paths, `${path.join(".")}: ${formatSceneProblems(problems)}`);
    ok(problems.every((problem) => problem.message.startsWith("the edit would leave a document the reader refuses:")), formatSceneProblems(problems));
    ok(problems.every((problem) => problem.line !== null), `${path.join(".")}: every problem has a line`);
  }
});

void test("an edit that leaves the runs or the grid out of step is refused where they disagree, and a floor cannot be renamed under its references", () => {
  deepEqual(refusedEdit(["size", "width"], 5).map((problem) => problem.path), ["floors[0].tiles", "floors[1].tiles", "shading[0].cells"]);
  deepEqual(refusedEdit(["projection"], "iso-rotated").map((problem) => problem.path), ["floors[0].tiles", "floors[1].tiles", "shading[0].cells"]);
  const renamed = refusedEdit(["floors", 0, "id"], "ground-floor");
  ok(renamed.length > 5);
  ok(renamed.every((problem) => problem.message.includes("names no floor of this document")), formatSceneProblems(renamed));
  deepEqual(
    renamed.map((problem) => problem.path).slice(0, 3),
    ["lights[0].floor", "vectors[0].floor", "vectors[1].floor"],
  );
  equal(edited(["floors", 1, "id"], "roof"), AUTHORED, "setting a value to what it is changes nothing");
});

void test("an edit that cannot be made in place is refused as an edit problem", () => {
  const cases: [(string | number)[], string | number | boolean, RegExp][] = [
    [["pluginData", "com.example.weather", "version"], "0.2.0", /plugin blocks are opaque/],
    [["pluginData"], "x", /plugin blocks are opaque/],
    [["floors", 9, "title"], "x", /no such place/],
    [["floors", 0, "tiles", 1, 5], 1, /no such list entry/],
    [["floors", 0, "tiles", -1], 1, /no such list entry/],
    [["floors", 0, "tiles"], 1, /not a one-line scalar/],
    [["floors", 0, "tiles", 1], 1, /not a one-line scalar/],
    [["tilePalette", 3], "x", /not a one-line scalar/],
    [["start", "x", "deeper"], 1, /no such place/],
    [["items", 1, "legacy", "reserved"], 3, /no such place/],
    [["links", "up"], "a.brd", /no such key/],
    [["nowhere"], 1, /no such key/],
    [["triggers", 0, "activate"], 1, /no such key/],
    [["floors", 0, "layer"], 1, /no such key/],
    [["name"], Number.NaN, /finite/],
    [["name"], Number.POSITIVE_INFINITY, /finite/],
    [[], "x", /names a place/],
  ];
  for (const [path, value, message] of cases) {
    const problems = refusedEdit(path, value);
    equal(problems[0]!.kind, "edit", `${path.join(".")}: ${formatSceneProblems(problems)}`);
    ok(message.test(problems[0]!.message), `${path.join(".")}: ${problems[0]!.message}`);
  }
  const multiline = swap(AUTHORED, "name: Cottage\n", "name: >\n  A multi-line\n  name\n");
  ok(refusedEdit(["name"], "x", multiline)[0]!.message.includes("not a one-line scalar"));
});

void test("a key that takes a list or a mapping cannot be added by a scalar edit, and the reader says why", () => {
  const bare = MINIMAL;
  for (const [path, message] of [
    [["threads"], "must be a list of text"],
    [["tags"], "must be a list of non-empty text"],
    [["legacy"], "must be the legacy data: a mapping"],
    [["tilePalette"], "must be a list"],
    [["atmosphere"], "must be the atmosphere: a mapping"],
  ] as [string[], string][]) {
    const problems = refusedEdit(path, "x", bare);
    ok(problems.length === 1 && problems[0]!.message.includes(message), `${path.join(".")}: ${formatSceneProblems(problems)}`);
  }
  ok(refusedEdit(["links", "north"], "a.brd", bare)[0]!.message.includes("no such place"), "the mapping must already be there");
  equal(edited(["name"], "Hut", bare), swap(bare, "projection: 2d", "name: Hut\nprojection: 2d"), "a key goes after the stamp when nothing else comes before it");
});

void test("a value that another place shares through an anchor is not edited in place", () => {
  const anchored = swap(swap(AUTHORED, "tags: [imported]\n", "tags: [&label imported]\n"), "metadata:\n  source: cottage.brd\n", "metadata:\n  source: *label\n");
  accepted(anchored);
  ok(refusedEdit(["tags", 0], "town", anchored)[0]!.message.includes("anchored"));
  equal(edited(["name"], "Hut", anchored), swap(anchored, "name: Cottage", "name: Hut"));
});

void test("a text with a flow indicator is quoted when it replaces a value inside a flow list or mapping, so no slot splits or shifts", () => {
  const split = edited(["constants", 0], "gold, silver");
  equal(split, swap(AUTHORED, 'constants: [gold, "", "7"]', 'constants: ["gold, silver", "", "7"]'));
  deepEqual(accepted(split).constants, ["gold, silver", "", "7"]);
  deepEqual(accepted(edited(["threads", 0], "a]b{c")).threads, ["a]b{c", ""]);
  equal(edited(["links", "north"], "a, b"), swap(AUTHORED, "north: village.brd", 'north: "a, b"'));
  equal(edited(["constants", 0], "silver"), swap(AUTHORED, 'constants: [gold, "", "7"]', 'constants: [silver, "", "7"]'), "a plain value stays plain");
  equal(edited(["name"], "Cottage, the 2nd"), swap(AUTHORED, "name: Cottage", "name: Cottage, the 2nd"), "block context needs no quotes");
  const absent = swap(AUTHORED, "links: {north: village.brd, east: exit.prg}", "links: {east: exit.prg}");
  equal(edited(["links", "north"], "a, b", absent), swap(AUTHORED, "north: village.brd", 'north: "a, b"'), "an added key is quoted the same way");
});

void test("an alias that names no anchor is a located problem, not a throw, and the checker stays usable", () => {
  const text = swap(AUTHORED, "name: Cottage", "name: *nope");
  const problems = refused(text);
  deepEqual(problems.map((problem) => [problem.kind, problem.path, problem.line]), [["shape", "(document)", lineOf(text, "name: *nope")]]);
  ok(problems[0]!.message.includes("Unresolved alias") && problems[0]!.message.includes("nope"));
  ok(!setSceneProperty(text, ["savingDisabled"], false).ok);
  deepEqual(checkScene(plain()), [], "the model check is unaffected");
  ok(readScene(swap(AUTHORED, "tags: [imported]\n", "tags: [&label imported]\nmetadata: {source: *label}\n").replace("metadata:\n  source: cottage.brd\n", "")).ok, "a resolved alias still reads");
});

void test("a multiline text replacing a value in a flow list is written as an escaped double-quoted scalar and reads back whole", () => {
  const code = "Pause()\n  Pause()";
  const result = edited(["threads", 0], code);
  equal(result, swap(AUTHORED, 'threads: [ambient.prg, ""]', 'threads: ["Pause()\\n  Pause()", ""]'));
  deepEqual(accepted(result).threads, [code, ""]);
  const single = swap(AUTHORED, 'threads: [ambient.prg, ""]', "threads: ['x', \"\"]");
  deepEqual(accepted(edited(["threads", 0], "a\nb", single)).threads, ["a\nb", ""], "a single-quoted entry is re-quoted when it must hold a line break");
});

void test("an alias expansion past the parser's limit is a located problem, not a throw", () => {
  const aliases = Array.from({ length: 150 }, () => "*a").join(", ");
  const text = `contract: scene\nversion: 1.0.0-pre.1\nprojection: 2d\nmetadata: {x: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], y: [${aliases}]}\nsize: {width: 2, height: 1}\nfloors:\n  - id: layer-1\n`;
  const problems = refused(text);
  deepEqual(problems.map((problem) => [problem.kind, problem.path, problem.line]), [["shape", "(document)", 4]]);
  ok(problems[0]!.message.includes("Excessive alias count"));
  deepEqual(checkScene(plain()), [], "the model check is unaffected");
});

void test("a document the reader refuses is not edited", () => {
  const broken = swap(AUTHORED, "projection: 2d", "projection: 3d");
  const problems = refusedEdit(["name"], "x", broken);
  deepEqual(problems.map((problem) => problem.path), ["projection"]);
  ok(!problems[0]!.message.includes("the edit would leave"), "the document was already refused");
});

void test("an edit before the plugin block moves no byte of it, and a plugin block above other fields is bounded exactly", () => {
  const longer = edited(["name"], "A much longer display name for the cottage");
  equal(longer.slice(longer.indexOf("pluginData:")), PLUGIN_BLOCK);
  const shorter = edited(["name"], "C");
  equal(shorter.slice(shorter.indexOf("pluginData:")), PLUGIN_BLOCK);
  equal(accepted(shorter).pluginSource, PLUGIN_BLOCK);

  const head = AUTHORED.slice(0, AUTHORED.indexOf("pluginData:"));
  const above = swap(head, "floors:\n", `${PLUGIN_BLOCK}floors:\n`);
  const read = readScene(above);
  if (!read.ok) throw new Error(formatSceneProblems(read.problems));
  equal(read.scene.pluginSource, PLUGIN_BLOCK, "the token is the block alone, not the text after it");
  const result = edited(["triggers", 0, "program"], "close_door.prg", above);
  equal(result, swap(above, "program: open_door.prg", "program: close_door.prg"));
  equal(accepted(result).pluginSource, PLUGIN_BLOCK);
  deepEqual(changedLines(above, result), [lineOf(above, "# the cottage door") - 1]);
  ok(!refusedEdit(["pluginData", "com.example.weather", "version"], "0.2.0", above)[0]!.message.includes("would leave"));
  const written = writeScene(read.scene, above);
  ok(written.ok && written.text === above);
});
