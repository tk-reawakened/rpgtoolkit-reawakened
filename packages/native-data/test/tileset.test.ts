import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";
import {
  checkTileset,
  formatTilesetProblems,
  readTileset,
  setTilesetProperty,
  tilesetAssetPaths,
  tilesetCellBounds,
  tilesetCellReferences,
  TILESET_CONTRACT,
  TILESET_VERSION,
  writeTileset,
  type Tileset,
  type TilesetProblem,
} from "../src/tileset.ts";

/** An authored tileset: comments, mixed quoting, flow and block style, an optional field left out, and a plugin block. */
const AUTHORED = `contract: tileset # the stamp
version: 1.0.0-pre.1
# A small village set, hand-authored.
tags: [village]
name: Village Master Tileset
projection: 2d
cellSize: [32, 32]
sources:
  - id: village-sheet
    file: Bitmap/village_tiles_source.png   # the master sheet
    grid:
      width: 32
      height: 32
      marginX: 0
      marginY: 0
      gapX: 0
      gapY: 0
    transparent: {mode: alpha}
  - id: props-sheet
    file: Bitmap/props.png
    grid: {width: 16, height: 16, marginX: 1, marginY: 1, gapX: 2, gapY: 2}
    transparent: {mode: colorKey, color: [255, 0, 255]}
tiles:
  - id: grass-main
    name: "Meadow Grass"
    source: village-sheet
    cell: [0, 0]
    role: floor
    collision: walkable  # walk on it
  - id: stone-wall-base
    name: Rough Stone Wall
    source: village-sheet
    cell: [1, 0]
    role: wall
    collision: solid
  - id: wood-counter-diagonal
    name: Angled Counter Corner
    source: props-sheet
    cell: [2, 0]
    role: decorative
    collision: walkable
    kitbash:
      - op: cutCorner
        diagonal: north-west
        clearHalf: true
isoBlocks:
  - id: stone-cube
    name: Stone Isometric Cube
    heightPixels: 32
    faces:
      top: {source: village-sheet, cell: [3, 0], tint: [0, 0, 0]}
      left: {source: village-sheet, cell: [4, 0], tint: [-24, -24, -24]}
      right: {source: village-sheet, cell: [4, 0], tint: [-56, -56, -56]}
    collision: solid
    wallCapUnder: true
  - {id: plain-cube, name: Plain Cube, heightPixels: 16, faces: {top: {source: village-sheet, cell: [3, 1]}, left: {source: village-sheet, cell: [4, 1]}, right: {source: village-sheet, cell: [4, 1]}}, collision: walkable}
autotiles:
  - id: water-edge
    name: Water Coast Autotile
    mode: blob-47
    base: {source: village-sheet, cell: [5, 0]}
    border: {source: village-sheet, cell: [6, 0]}
    innerCorner: {source: village-sheet, cell: [7, 0]}
    exportOrder: t25-canonical
outputBinding:
  target: Tiles/village_auto.tst
  detail: 1
pluginData:
  com.example.shadows: # plugin-owned block
    version: 1.0.0
    data: {strength: 1.10, perTile: {grass-main: "keep: exact"}, futureKnob: [1, 2]}
`;

const PLUGIN_BLOCK = AUTHORED.slice(AUTHORED.indexOf("pluginData:"));

function refused(text: string): readonly TilesetProblem[] {
  const result = readTileset(text);
  if (result.ok) throw new Error("expected the reader to refuse the document");
  return result.problems;
}

function accepted(text: string): Tileset {
  const result = readTileset(text);
  if (!result.ok) throw new Error(`expected the reader to accept the document:\n${formatTilesetProblems(result.problems)}`);
  return result.tileset;
}

/** `text` with `from` replaced by `to`; fails the test when `from` is not there. */
function swap(text: string, from: string, to: string): string {
  ok(text.includes(from), `the fixture holds ${JSON.stringify(from)}`);
  return text.replace(from, to);
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
  const result = setTilesetProperty(text, path, value);
  if (!result.ok) throw new Error(`expected the edit to be made:\n${formatTilesetProblems(result.problems)}`);
  return result.text;
}

function refusedEdit(path: (string | number)[], value: string | number | boolean, text = AUTHORED): readonly TilesetProblem[] {
  const result = setTilesetProperty(text, path, value);
  if (result.ok) throw new Error("expected the edit to be refused");
  return result.problems;
}

// ---------------------------------------------------------------- reading

void test("an authored tileset reads into the typed model and keeps its source", () => {
  const result = readTileset(AUTHORED);
  if (!result.ok) throw new Error(formatTilesetProblems(result.problems));
  equal(result.source, AUTHORED);
  const tileset = result.tileset;
  equal(tileset.contract, TILESET_CONTRACT);
  equal(tileset.version, TILESET_VERSION);
  deepEqual(tileset.tags, ["village"]);
  equal(tileset.name, "Village Master Tileset");
  equal(tileset.projection, "2d");
  deepEqual(tileset.cellSize, [32, 32]);
  deepEqual(tileset.sources[1], {
    id: "props-sheet",
    file: "Bitmap/props.png",
    grid: { width: 16, height: 16, marginX: 1, marginY: 1, gapX: 2, gapY: 2 },
    transparent: { mode: "colorKey", color: [255, 0, 255] },
  });
  deepEqual(tileset.tiles[2], {
    id: "wood-counter-diagonal",
    name: "Angled Counter Corner",
    source: "props-sheet",
    cell: [2, 0],
    role: "decorative",
    collision: "walkable",
    kitbash: [{ op: "cutCorner", diagonal: "north-west", clearHalf: true }],
  });
  equal(tileset.tiles[0]!.name, "Meadow Grass");
  equal(tileset.isoBlocks![0]!.faces.left.tint![0], -24);
  equal(tileset.isoBlocks![0]!.wallCapUnder, true);
  ok(!("wallCapUnder" in tileset.isoBlocks![1]!), "an absent optional field stays absent");
  ok(!("tint" in tileset.isoBlocks![1]!.faces.top), "an absent tint stays absent");
  equal(tileset.autotiles![0]!.exportOrder, "t25-canonical");
  deepEqual(tileset.outputBinding, { target: "Tiles/village_auto.tst", detail: 1 });
  deepEqual(tileset.pluginData?.["com.example.shadows"]?.data, { strength: 1.1, perTile: { "grass-main": "keep: exact" }, futureKnob: [1, 2] });
  equal(tileset.pluginSource, PLUGIN_BLOCK);
});

void test("the spec's example, with every tile, block and autotile, reads", () => {
  accepted(
    [
      "contract: tileset",
      "version: 1.0.0-pre.1+debug.4",
      "name: Village Master Tileset",
      "projection: iso-rotated",
      "cellSize: [32, 32]",
      "sources:",
      "  - id: village-sheet",
      "    file: Bitmap/village_tiles_source.png",
      "    grid: {width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0}",
      "    transparent: {mode: alpha}",
      "tiles:",
      "  - {id: grass-main, name: Meadow Grass, source: village-sheet, cell: [0, 0], role: wall-cap, collision: solid}",
      "outputBinding: {target: Tiles/village_auto.tst, detail: 1}",
      "",
    ].join("\n"),
  );
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
    refused(swap(AUTHORED, "contract: tileset", "contract: animation-clip")).map((problem) => [problem.kind, problem.path, problem.message]),
    [["shape", "contract", "must be `tileset`"]],
  );
  ok(refused(swap(AUTHORED, "version: 1.0.0-pre.1", "version: 1.1.0"))[0]!.message.includes("not a version this reader knows"));
  ok(refused(swap(AUTHORED, "version: 1.0.0-pre.1", "version: 1.0"))[0]!.message.includes("patch is missing"));
  // The two stamp keys in either order are still the first two keys; a stamp is "not first" only when another key precedes it.
  ok(refused(`name: Early\ncontract: tileset\nversion: 1.0.0-pre.1\n${body.replace(/^name:.*\n/, "")}`)[0]!.message.includes("must be the first two keys"));
  equal(accepted(`version: 1.0.0-pre.1\ncontract: tileset\n${body}`).name, "Village Master Tileset");
  ok(refused(swap(AUTHORED, "projection: 2d\n", "projection: 2d\nprojection: 2d\n"))[0]!.message.includes("YAML error"));
  equal(accepted(swap(AUTHORED, "version: 1.0.0-pre.1", "version: 1.0.0-pre.1+build.7")).version, "1.0.0-pre.1+build.7");
});

void test("every plugin envelope problem kind is surfaced by the shared validator", () => {
  const cases: [string, string][] = [
    [swap(AUTHORED, PLUGIN_BLOCK, "pluginData: [com.example.shadows]\n"), "container"],
    [swap(AUTHORED, "com.example.shadows", "Com.example.shadows"), "id"],
    [swap(AUTHORED, "pluginData:\n", "pluginData:\n  contract:\n    version: 1.0.0\n    data: {}\n"), "id"],
    [swap(AUTHORED, "    version: 1.0.0\n", "    version: 1.0\n"), "version"],
    [swap(AUTHORED, "    data: {", "    extra: true\n    data: {"), "shape"],
    [swap(AUTHORED, /data: \{.*\}\n$/s.exec(AUTHORED)![0], "data: [strength]\n"), "data"],
  ];
  for (const [text, kind] of cases) {
    const problems = refused(text);
    ok(problems.some((problem) => problem.kind === "plugin-block" && problem.pluginKind === kind), `${kind}: ${formatTilesetProblems(problems)}`);
  }
});

// ---------------------------------------------------------------- the closed contract

void test("an unknown top-level key is refused while the plugin payload is kept, and removing the key reads again", () => {
  const typo = swap(AUTHORED, "projection: 2d\n", "projection: 2d\ncellsize: [32, 32]\n");
  const problems = refused(typo);
  deepEqual(
    problems.map((problem) => [problem.kind, problem.path, problem.line]),
    [["shape", "cellsize", 7]],
  );
  ok(problems[0]!.message.includes("the contract is closed"));
  ok(typo.endsWith(PLUGIN_BLOCK), "the refused text still holds the plugin block exactly");
  deepEqual(accepted(typo.replace("cellsize: [32, 32]\n", "")).pluginData?.["com.example.shadows"]?.data["futureKnob"], [1, 2]);
  const id = refused(swap(AUTHORED, "name: Village", "id: village\nname: Village"));
  deepEqual(id.map((problem) => problem.path), ["id"], "a document-level id is not a field");
});

void test("a plugin block cannot sit on a tile, a source or a block: those objects are closed", () => {
  ok(refused(swap(AUTHORED, "    role: wall\n", "    role: wall\n    pluginData: {}\n")).some((problem) => problem.path === "tiles[1].pluginData"));
  ok(refused(swap(AUTHORED, "    transparent: {mode: alpha}\n", "    transparent: {mode: alpha}\n    pluginData: {}\n")).some((problem) => problem.path === "sources[0].pluginData"));
});

void test("each rule of the contract page refuses what it says", () => {
  const cases: [string, (model: Record<string, any>) => void, string][] = [
    ["empty name", (m) => (m.name = ""), "name"],
    ["name as a number", (m) => (m.name = 7), "name"],
    ["unknown projection", (m) => (m.projection = "3d"), "projection"],
    ["projection in capitals", (m) => (m.projection = "2D"), "projection"],
    ["cell size of zero", (m) => (m.cellSize = [32, 0]), "cellSize[1]"],
    ["cell size of one number", (m) => (m.cellSize = [32]), "cellSize"],
    ["fractional cell size", (m) => (m.cellSize = [32.5, 32]), "cellSize[0]"],
    ["null tags", (m) => (m.tags = null), "tags"],
    ["empty tag", (m) => (m.tags = [""]), "tags[0]"],
    ["metadata as a list", (m) => (m.metadata = ["a"]), "metadata"],
    ["no sources", (m) => (m.sources = []), "sources"],
    ["sources as a mapping", (m) => (m.sources = {}), "sources"],
    ["source id in capitals", (m) => (m.sources[0].id = "Village-Sheet"), "sources[0].id"],
    ["source id with an underscore", (m) => (m.sources[0].id = "village_sheet"), "sources[0].id"],
    ["duplicate source id", (m) => (m.sources[1].id = "village-sheet"), "sources[1].id"],
    ["unknown source key", (m) => (m.sources[0].dpi = 96), "sources[0].dpi"],
    ["absolute file", (m) => (m.sources[0].file = "/Bitmap/a.png"), "sources[0].file"],
    ["drive file", (m) => (m.sources[0].file = "C:/Bitmap/a.png"), "sources[0].file"],
    ["file leaving the project", (m) => (m.sources[0].file = "../a.png"), "sources[0].file"],
    ["file with a backslash", (m) => (m.sources[0].file = "Bitmap\\a.png"), "sources[0].file"],
    ["empty file", (m) => (m.sources[0].file = ""), "sources[0].file"],
    ["file naming a folder", (m) => (m.sources[0].file = "Bitmap/"), "sources[0].file"],
    ["file with a space at the end", (m) => (m.sources[0].file = "a.png "), "sources[0].file"],
    ["missing grid", (m) => delete m.sources[0].grid, "sources[0]"],
    ["grid width zero", (m) => (m.sources[0].grid.width = 0), "sources[0].grid.width"],
    ["grid height negative", (m) => (m.sources[0].grid.height = -32), "sources[0].grid.height"],
    ["negative margin", (m) => (m.sources[0].grid.marginX = -1), "sources[0].grid.marginX"],
    ["fractional gap", (m) => (m.sources[0].grid.gapY = 0.5), "sources[0].grid.gapY"],
    ["missing gap", (m) => delete m.sources[0].grid.gapX, "sources[0].grid"],
    ["unknown grid key", (m) => (m.sources[0].grid.padding = 1), "sources[0].grid.padding"],
    ["missing transparent", (m) => delete m.sources[0].transparent, "sources[0]"],
    ["unknown transparent mode", (m) => (m.sources[0].transparent = { mode: "mask" }), "sources[0].transparent.mode"],
    ["alpha with a colour", (m) => (m.sources[0].transparent = { mode: "alpha", color: [0, 0, 0] }), "sources[0].transparent.color"],
    ["colour key without a colour", (m) => (m.sources[1].transparent = { mode: "colorKey" }), "sources[1].transparent"],
    ["colour channel 256", (m) => (m.sources[1].transparent.color = [256, 0, 0]), "sources[1].transparent.color[0]"],
    ["colour channel negative", (m) => (m.sources[1].transparent.color = [0, -1, 0]), "sources[1].transparent.color[1]"],
    ["colour of two channels", (m) => (m.sources[1].transparent.color = [0, 0]), "sources[1].transparent.color"],
    ["no tiles", (m) => (m.tiles = []), "tiles"],
    ["tile id in capitals", (m) => (m.tiles[0].id = "Grass"), "tiles[0].id"],
    ["duplicate tile id", (m) => (m.tiles[1].id = "grass-main"), "tiles[1].id"],
    ["empty tile name", (m) => (m.tiles[0].name = ""), "tiles[0].name"],
    ["tile source that names nothing", (m) => (m.tiles[0].source = "missing-sheet"), "tiles[0].source"],
    ["tile source in capitals", (m) => (m.tiles[0].source = "Village-Sheet"), "tiles[0].source"],
    ["negative cell column", (m) => (m.tiles[0].cell = [-1, 0]), "tiles[0].cell[0]"],
    ["fractional cell row", (m) => (m.tiles[0].cell = [0, 1.5]), "tiles[0].cell[1]"],
    ["cell as text", (m) => (m.tiles[0].cell = "0,0"), "tiles[0].cell"],
    ["unknown role", (m) => (m.tiles[0].role = "ceiling"), "tiles[0].role"],
    ["unknown collision", (m) => (m.tiles[0].collision = "lava"), "tiles[0].collision"],
    ["missing collision", (m) => delete m.tiles[0].collision, "tiles[0]"],
    ["null collision", (m) => (m.tiles[0].collision = null), "tiles[0].collision"],
    ["unknown tile key", (m) => (m.tiles[0].tint = [0, 0, 0]), "tiles[0].tint"],
    ["unknown kitbash operation", (m) => (m.tiles[2].kitbash[0].op = "flip"), "tiles[2].kitbash[0].op"],
    ["unknown kitbash parameter", (m) => (m.tiles[2].kitbash[0].angle = 45), "tiles[2].kitbash[0].angle"],
    ["unknown diagonal", (m) => (m.tiles[2].kitbash[0].diagonal = "north"), "tiles[2].kitbash[0].diagonal"],
    ["clearHalf as text", (m) => (m.tiles[2].kitbash[0].clearHalf = "yes"), "tiles[2].kitbash[0].clearHalf"],
    ["missing clearHalf", (m) => delete m.tiles[2].kitbash[0].clearHalf, "tiles[2].kitbash[0]"],
    ["kitbash as a mapping", (m) => (m.tiles[2].kitbash = { op: "cutCorner" }), "tiles[2].kitbash"],
    ["block id repeated", (m) => (m.isoBlocks[1].id = "stone-cube"), "isoBlocks[1].id"],
    ["block height zero", (m) => (m.isoBlocks[0].heightPixels = 0), "isoBlocks[0].heightPixels"],
    ["block height fractional", (m) => (m.isoBlocks[0].heightPixels = 16.5), "isoBlocks[0].heightPixels"],
    ["block without a face", (m) => delete m.isoBlocks[0].faces.right, "isoBlocks[0].faces"],
    ["block with a fourth face", (m) => (m.isoBlocks[0].faces.bottom = m.isoBlocks[0].faces.top), "isoBlocks[0].faces.bottom"],
    ["face source that names nothing", (m) => (m.isoBlocks[0].faces.top.source = "missing-sheet"), "isoBlocks[0].faces.top.source"],
    ["face tint above 255", (m) => (m.isoBlocks[0].faces.left.tint = [0, 256, 0]), "isoBlocks[0].faces.left.tint[1]"],
    ["face tint below -255", (m) => (m.isoBlocks[0].faces.left.tint = [-256, 0, 0]), "isoBlocks[0].faces.left.tint[0]"],
    ["face tint of four channels", (m) => (m.isoBlocks[0].faces.left.tint = [0, 0, 0, 0]), "isoBlocks[0].faces.left.tint"],
    ["unknown face key", (m) => (m.isoBlocks[0].faces.left.alpha = 1), "isoBlocks[0].faces.left.alpha"],
    ["block collision unknown", (m) => (m.isoBlocks[0].collision = "wall"), "isoBlocks[0].collision"],
    ["wallCapUnder as text", (m) => (m.isoBlocks[0].wallCapUnder = "true"), "isoBlocks[0].wallCapUnder"],
    ["null wallCapUnder", (m) => (m.isoBlocks[0].wallCapUnder = null), "isoBlocks[0].wallCapUnder"],
    ["unknown block key", (m) => (m.isoBlocks[0].depth = 1), "isoBlocks[0].depth"],
    ["null isoBlocks", (m) => (m.isoBlocks = null), "isoBlocks"],
    ["unsupported autotile mode", (m) => (m.autotiles[0].mode = "blob-16"), "autotiles[0].mode"],
    ["unsupported export order", (m) => (m.autotiles[0].exportOrder = "legacy"), "autotiles[0].exportOrder"],
    ["autotile border source that names nothing", (m) => (m.autotiles[0].border.source = "missing-sheet"), "autotiles[0].border.source"],
    ["autotile without an inner corner", (m) => delete m.autotiles[0].innerCorner, "autotiles[0]"],
    ["autotile reference with a tint", (m) => (m.autotiles[0].base.tint = [0, 0, 0]), "autotiles[0].base.tint"],
    ["autotile id repeated", (m) => m.autotiles.push({ ...m.autotiles[0] }), "autotiles[1].id"],
    ["no output binding", (m) => delete m.outputBinding, "(document)"],
    ["output target that is not a tst", (m) => (m.outputBinding.target = "Tiles/village.png"), "outputBinding.target"],
    ["output target without an extension", (m) => (m.outputBinding.target = "Tiles/village"), "outputBinding.target"],
    ["output target that is a native document", (m) => (m.outputBinding.target = "tiles/village.tkrtile"), "outputBinding.target"],
    [
      "output target that overwrites a source",
      (m) => {
        m.sources[0].file = "./Tiles//VILLAGE_AUTO.TST";
      },
      "outputBinding.target",
    ],
    ["output target outside the project", (m) => (m.outputBinding.target = "../out.tst"), "outputBinding.target"],
    ["output detail zero", (m) => (m.outputBinding.detail = 0), "outputBinding.detail"],
    ["output detail as text", (m) => (m.outputBinding.detail = "1"), "outputBinding.detail"],
    ["unknown output key", (m) => (m.outputBinding.format = "tst"), "outputBinding.format"],
    ["a top-level key of another contract", (m) => (m.canvas = { width: 1, height: 1 }), "canvas"],
    ["a mistyped top-level key", (m) => (m.cellsize = [32, 32]), "cellsize"],
    ["a document-level id", (m) => (m.id = "village"), "id"],
  ];
  for (const [name, change, path] of cases) {
    const model = plain();
    change(model);
    const problems = checkTileset(model);
    ok(
      problems.some((problem) => problem.path === path),
      `${name}: expected a problem at ${path}, got ${formatTilesetProblems(problems)}`,
    );
  }
  deepEqual(checkTileset(plain()), []);
});

void test("what the contract allows is read: no optional list, an empty optional list, capitals and spaces in names and paths", () => {
  const minimal = plain();
  delete minimal.isoBlocks;
  delete minimal.autotiles;
  delete minimal.tags;
  deepEqual(checkTileset(minimal), []);
  deepEqual(checkTileset({ ...minimal, isoBlocks: [], autotiles: [] }), []);
  const spaced = plain();
  spaced.sources[0].file = "Bitmap/My Village (v2).PNG";
  spaced.name = "  Village  ";
  deepEqual(checkTileset(spaced), []);
});

void test("a problem names its line, and a local reference names the entry that is wrong", () => {
  const text = swap(AUTHORED, "    source: village-sheet\n    cell: [1, 0]", "    source: village-shet\n    cell: [1, 0]");
  const problems = refused(text);
  deepEqual(
    problems.map((problem) => [problem.kind, problem.path, problem.line]),
    [["shape", "tiles[1].source", text.split("\n").findIndex((line) => line === "    source: village-shet") + 1]],
  );
  ok(problems[0]!.message.includes("`village-shet` names no source of this document"));
  const duplicate = refused(swap(AUTHORED, "id: stone-wall-base", "id: grass-main"));
  deepEqual(duplicate.map((problem) => problem.path), ["tiles[1].id"]);
  ok(duplicate[0]!.message.includes("tiles[0]"));
  const empty = refused(swap(AUTHORED, "      width: 32\n", "      width: 0\n"));
  deepEqual(empty.map((problem) => problem.path), ["sources[0].grid.width"]);
  ok(empty[0]!.line !== null && empty[0]!.line > 8);
});

void test("a document that is not a mapping, or whose list is null, is refused and never repaired", () => {
  equal(refused("- not\n- a mapping\n")[0]!.kind, "stamp");
  equal(refused("").length, 2);
  ok(refused(swap(AUTHORED, "cellSize: [32, 32]", "cellSize:")).some((problem) => problem.path === "cellSize"));
});

// ---------------------------------------------------------------- the model check

void test("the model check judges a model the way the reader judges a document, and ignores the source token", () => {
  const read = accepted(AUTHORED);
  deepEqual(checkTileset(read), []);
  deepEqual(checkTileset({ ...read, tiles: [] }).map((problem) => problem.path), ["tiles"]);
  deepEqual(checkTileset(null).map((problem) => problem.path), ["(document)"]);
  deepEqual(checkTileset({ ...read, tags: undefined }).map((problem) => problem.path), ["tags"]);
});

// ---------------------------------------------------------------- what a project checker needs

void test("the project paths, the used cells and the addressable cells are available to a project checker", () => {
  const tileset = accepted(AUTHORED);
  deepEqual(tilesetAssetPaths(tileset), [
    { path: "sources[0].file", role: "source", value: "Bitmap/village_tiles_source.png" },
    { path: "sources[1].file", role: "source", value: "Bitmap/props.png" },
    { path: "outputBinding.target", role: "output", value: "Tiles/village_auto.tst" },
  ]);
  const cells = tilesetCellReferences(tileset);
  equal(cells.length, 3 + 6 + 3);
  deepEqual(cells[2], { path: "tiles[2].cell", source: "props-sheet", cell: [2, 0] });
  deepEqual(cells[4], { path: "isoBlocks[0].faces.left.cell", source: "village-sheet", cell: [4, 0] });
  deepEqual(cells.at(-1), { path: "autotiles[0].innerCorner.cell", source: "village-sheet", cell: [7, 0] });

  const plainGrid = { width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0 };
  deepEqual(tilesetCellBounds(plainGrid, 128, 64), { columns: 4, rows: 2 });
  deepEqual(tilesetCellBounds(plainGrid, 127, 63), { columns: 3, rows: 1 }, "a partial final cell is not addressable");
  const spaced = { width: 31, height: 31, marginX: 1, marginY: 1, gapX: 1, gapY: 1 };
  deepEqual(tilesetCellBounds(spaced, 64, 64), { columns: 2, rows: 2 });
  deepEqual(tilesetCellBounds(spaced, 63, 63), { columns: 1, rows: 1 });
  deepEqual(tilesetCellBounds(plainGrid, 16, 0), { columns: 0, rows: 0 });
});

// ---------------------------------------------------------------- writing

void test("a source-backed write returns the authored bytes, comments, quoting and plugin block included", () => {
  const read = readTileset(AUTHORED);
  if (!read.ok) throw new Error(formatTilesetProblems(read.problems));
  const written = writeTileset(read.tileset, read.source);
  if (!written.ok) throw new Error(formatTilesetProblems(written.problems));
  equal(written.text, AUTHORED);
});

void test("the byte-preservation proof can fail: re-printing or regenerating the document changes the authored bytes", () => {
  notEqual(parseDocument(AUTHORED, { version: "1.2", schema: "core" }).toString(), AUTHORED, "a re-printed document differs");
  const regenerated = writeTileset(plain() as Tileset);
  if (!regenerated.ok) throw new Error(formatTilesetProblems(regenerated.problems));
  notEqual(regenerated.text, AUTHORED, "a document regenerated from the model differs");
  ok(!regenerated.text.includes("com.example.shadows"));
  ok(!regenerated.text.includes("# plugin-owned block"));
});

void test("a write refuses a plugin-bearing model without its source, a stale source and a source of another model", () => {
  const read = accepted(AUTHORED);
  const noSource = writeTileset(read);
  ok(!noSource.ok && noSource.problems[0]!.kind === "edit" && noSource.problems[0]!.path === "pluginData");
  ok(!writeTileset({ ...read, name: "Other" }, AUTHORED).ok, "a changed model cannot be paired with stale source");
  ok(!writeTileset(read, swap(AUTHORED, "strength: 1.10", "strength: 1.1")).ok, "a lexically changed plugin block is a different source");
  ok(writeTileset(read, swap(AUTHORED, "# walk on it", "# stroll on it")).ok, "a comment-only difference still reads as the same model");
  const refusedSource = writeTileset(read, swap(AUTHORED, "projection: 2d", "projection: 4d"));
  ok(!refusedSource.ok && refusedSource.problems[0]!.path === "projection", "a source the reader refuses is refused with its problems");
});

void test("a write refuses a model that breaks the contract and reports where", () => {
  const model = plain();
  model.tiles[0].source = "missing-sheet";
  const result = writeTileset(model as Tileset);
  ok(!result.ok);
  if (!result.ok) deepEqual(result.problems.map((problem) => problem.path), ["tiles[0].source"]);
});

void test("a new document is written in contract order, reads back to the same model, and leaves absent fields absent", () => {
  const model = plain() as Tileset;
  const written = writeTileset(model);
  if (!written.ok) throw new Error(formatTilesetProblems(written.problems));
  ok(written.text.startsWith("contract: tileset\nversion: 1.0.0-pre.1\ntags: [village]\nname: Village Master Tileset\n"), written.text);
  ok(written.text.includes("cellSize: [32, 32]\n"));
  ok(written.text.includes("    transparent: {mode: alpha}\n"));
  ok(written.text.includes("      top: {source: village-sheet, cell: [3, 0], tint: [0, 0, 0]}\n"));
  ok(written.text.includes("    cell: [2, 0]\n"));
  equal(written.text.split("wallCapUnder").length - 1, 1, "the block that leaves it out still leaves it out");
  deepEqual(accepted(written.text), model);
  const again = writeTileset(accepted(written.text), written.text);
  ok(again.ok && again.text === written.text);

  const quoted = plain();
  quoted.name = "Village: the 2nd set";
  const text = writeTileset(quoted as Tileset);
  ok(text.ok);
  if (text.ok) equal(accepted(text.text).name, "Village: the 2nd set");
});

// ---------------------------------------------------------------- editing

void test("a collision edit changes that one value and nothing else: comments, quoting and the plugin block stay", () => {
  const result = edited(["tiles", 0, "collision"], "solid");
  equal(result, swap(AUTHORED, "collision: walkable  # walk on it", "collision: solid  # walk on it"));
  deepEqual(changedLines(AUTHORED, result), [AUTHORED.split("\n").findIndex((line) => line.includes("# walk on it"))]);
  deepEqual(comments(result), comments(AUTHORED));
  equal(result.slice(result.indexOf("pluginData:")), PLUGIN_BLOCK);
  equal(accepted(result).tiles[0]!.collision, "solid");
  deepEqual(accepted(result).tiles[1], accepted(AUTHORED).tiles[1]);
  equal(accepted(result).pluginSource, PLUGIN_BLOCK);
});

void test("an edit of an isometric block's collision and of a flow-style entry changes only that text", () => {
  const block = edited(["isoBlocks", 0, "collision"], "walkable");
  equal(block, swap(AUTHORED, "    collision: solid\n    wallCapUnder", "    collision: walkable\n    wallCapUnder"));
  const flow = edited(["isoBlocks", 1, "collision"], "solid");
  equal(flow, swap(AUTHORED, "right: {source: village-sheet, cell: [4, 1]}}, collision: walkable}", "right: {source: village-sheet, cell: [4, 1]}}, collision: solid}"));
  const cell = edited(["tiles", 1, "cell", 0], 4);
  equal(cell, swap(AUTHORED, "    cell: [1, 0]", "    cell: [4, 0]"));
  const tint = edited(["isoBlocks", 0, "faces", "left", "tint", 1], -30);
  equal(tint, swap(AUTHORED, "tint: [-24, -24, -24]", "tint: [-24, -30, -24]"));
  const detail = edited(["outputBinding", "detail"], 2);
  equal(detail, swap(AUTHORED, "  detail: 1\n", "  detail: 2\n"));
});

void test("a replaced quoted value keeps its quote style, and a plain value is quoted only when it must be", () => {
  const renamed = edited(["tiles", 0, "name"], "Lawn");
  equal(renamed, swap(AUTHORED, 'name: "Meadow Grass"', 'name: "Lawn"'));
  const colon = edited(["tiles", 1, "name"], "Wall: rough");
  equal(colon, swap(AUTHORED, "name: Rough Stone Wall", 'name: "Wall: rough"'));
  equal(accepted(colon).tiles[1]!.name, "Wall: rough");
});

void test("wallCapUnder is set in place, and added after collision when it is absent", () => {
  equal(edited(["isoBlocks", 0, "wallCapUnder"], false), swap(AUTHORED, "wallCapUnder: true", "wallCapUnder: false"));

  const without = swap(AUTHORED, "    wallCapUnder: true\n", "");
  const added = edited(["isoBlocks", 0, "wallCapUnder"], true, without);
  equal(added, AUTHORED, "a block-style entry is added as a line with the block's indent");

  const flow = edited(["isoBlocks", 1, "wallCapUnder"], true);
  equal(flow, swap(AUTHORED, "cell: [4, 1]}}, collision: walkable}", "cell: [4, 1]}}, collision: walkable, wallCapUnder: true}"));
  equal(accepted(flow).isoBlocks![1]!.wallCapUnder, true);

  const crlf = swap(AUTHORED, "    wallCapUnder: true\n", "").replaceAll("\n", "\r\n");
  equal(edited(["isoBlocks", 0, "wallCapUnder"], true, crlf), AUTHORED.replaceAll("\n", "\r\n"), "a CRLF document gets a CRLF line");
});

void test("an edit that would break the contract is refused with the reader's located reason, and nothing changes", () => {
  const lava = refusedEdit(["tiles", 0, "collision"], "lava");
  deepEqual(
    lava.map((problem) => [problem.kind, problem.path]),
    [["shape", "tiles[0].collision"]],
  );
  ok(lava[0]!.message.startsWith("the edit would leave a document the reader refuses:"));
  ok(lava[0]!.line !== null);
  deepEqual(refusedEdit(["tiles", 0, "source"], "missing-sheet").map((problem) => problem.path), ["tiles[0].source"]);
  deepEqual(refusedEdit(["tiles", 1, "id"], "grass-main").map((problem) => problem.path), ["tiles[1].id"]);
  deepEqual(refusedEdit(["tiles", 0, "cell", 0], -1).map((problem) => problem.path), ["tiles[0].cell[0]"]);
  deepEqual(refusedEdit(["outputBinding", "target"], "Bitmap/village_tiles_source.png").map((problem) => problem.path), ["outputBinding.target"]);
  deepEqual(refusedEdit(["sources", 0, "file"], "Tiles/village_auto.tst").map((problem) => problem.path), ["outputBinding.target"]);
  deepEqual(refusedEdit(["projection"], 2).map((problem) => problem.path), ["projection"]);
  deepEqual(refusedEdit(["contract"], "actor").map((problem) => problem.path), ["contract"]);
});

void test("an edit that cannot be made in place is refused as an edit problem", () => {
  const cases: [(string | number)[], string | number | boolean, RegExp][] = [
    [["pluginData", "com.example.shadows", "version"], "1.1.0", /plugin blocks are opaque/],
    [["pluginData"], "x", /plugin blocks are opaque/],
    [["tiles", 9, "cell", 0], 1, /no such place/],
    [["tiles", 0, "cell"], 1, /not a one-line scalar/],
    [["tiles", 2, "kitbash"], "x", /not a one-line scalar/],
    [["tiles", 0, "tint"], "x", /only an isometric block's `wallCapUnder` can be added/],
    [["isoBlocks", 0, "wallCapUnder", 0], true, /no such place/],
    [["tiles", 0, "collision"], Number.NaN, /finite/],
    [["isoBlocks", 1, "wallCapUnder"], "yes", /true or false/],
    [["nowhere", "at", "all"], 1, /no such place/],
    [[], "x", /names a place/],
  ];
  for (const [path, value, message] of cases) {
    const problems = refusedEdit(path, value);
    equal(problems[0]!.kind, "edit", `${path.join(".")}: ${formatTilesetProblems(problems)}`);
    ok(message.test(problems[0]!.message), `${path.join(".")}: ${problems[0]!.message}`);
  }
});

void test("a value that another place shares through an anchor is not edited in place", () => {
  const anchored = swap(AUTHORED, "tags: [village]\n", "tags: [&label village]\nmetadata: {label: *label}\n");
  accepted(anchored);
  ok(refusedEdit(["tags", 0], "town", anchored)[0]!.message.includes("anchored"));
  equal(edited(["tiles", 0, "collision"], "solid", anchored), swap(anchored, "collision: walkable", "collision: solid"));
});

void test("a document the reader refuses is not edited", () => {
  const broken = swap(AUTHORED, "projection: 2d", "projection: 3d");
  const problems = refusedEdit(["tiles", 0, "collision"], "solid", broken);
  deepEqual(problems.map((problem) => problem.path), ["projection"]);
  ok(!problems[0]!.message.includes("the edit would leave"), "the document was already refused");
});

void test("an edit before the plugin block moves no byte of it", () => {
  const result = edited(["name"], "A much longer display name for the village set");
  equal(result.slice(result.indexOf("pluginData:")), PLUGIN_BLOCK);
  equal(accepted(result).pluginSource, PLUGIN_BLOCK);
  const shorter = edited(["name"], "V");
  equal(shorter.slice(shorter.indexOf("pluginData:")), PLUGIN_BLOCK);
});

void test("a plugin block above other fields is bounded exactly: fields below it are editable and written back unchanged", () => {
  const head = AUTHORED.slice(0, AUTHORED.indexOf("pluginData:"));
  const above = swap(head, "tiles:\n", `${PLUGIN_BLOCK}tiles:\n`);
  const read = readTileset(above);
  if (!read.ok) throw new Error(formatTilesetProblems(read.problems));
  equal(read.tileset.pluginSource, PLUGIN_BLOCK, "the token is the block alone, not the text after it");

  const result = edited(["tiles", 0, "collision"], "solid", above);
  equal(result, swap(above, "collision: walkable  # walk on it", "collision: solid  # walk on it"));
  equal(accepted(result).pluginSource, PLUGIN_BLOCK);
  deepEqual(changedLines(above, result), [above.split("\n").findIndex((line) => line.includes("# walk on it"))]);
  equal(edited(["outputBinding", "detail"], 3, above), swap(above, "  detail: 1\n", "  detail: 3\n"));
  ok(!refusedEdit(["pluginData", "com.example.shadows", "version"], "1.1.0", above)[0]!.message.includes("would leave"));

  const written = writeTileset(read.tileset, above);
  ok(written.ok && written.text === above);
});
