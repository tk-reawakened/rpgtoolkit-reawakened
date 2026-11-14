// Creating a board (T-20): a blank board or one from a template, in each coordinate system, never over an existing file,
// remembering the last choices, and opening as an ordinary editable board.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, BOARD_MAX_CELLS, boardGrid, createEmptyBoard, readBoard, writeBoard } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  DEFAULT_NEW_BOARD,
  NEW_BOARD_MAX_LAYERS,
  NEW_BOARD_MAX_SIZE,
  asksBeforeCreating,
  boardFileName,
  buildNewBoard,
  coordSystemOf,
  coordTypeOf,
  createBoardDocument,
  createBoardFile,
  createDocumentIdentity,
  createPreferences,
  newBoardSettingsFrom,
  newBoardSummary,
  rememberNewBoard,
  uniqueBoardName,
  validateNewBoard,
  type BoardCoordSystem,
  type NewBoardSettings,
} from "../src/index.ts";

const base: NewBoardSettings = { ...DEFAULT_NEW_BOARD, name: "village", width: 10, height: 6, layers: 3 };
const SYSTEMS: readonly [BoardCoordSystem, number][] = [["2d", 0], ["iso-stacked", 1], ["iso-rotated", 2]];

for (const [system, flag] of SYSTEMS) {
  for (const pixelCoordinates of [false, true]) {
    test(`a blank ${system} board${pixelCoordinates ? " with pixel coordinates" : ""} is a board the reader and the editor open read-write`, () => {
      const settings = { ...base, coordSystem: system, pixelCoordinates };
      const built = buildNewBoard(settings);
      ok(built.ok, built.ok ? "" : built.message);
      if (!built.ok) return;
      const read = readBoard(new BinaryReader(built.bytes, "new.brd"));
      ok(read.ok);
      if (!read.ok) return;
      const board = read.value;
      equal(board.coordType, flag | (pixelCoordinates ? 4 : 0));
      equal(coordTypeOf(settings), board.coordType);
      equal(coordSystemOf(board.coordType), system);
      deepEqual([board.sizeX, board.sizeY, board.sizeL], [10, 6, 3]);
      const grid = boardGrid(10, 6, board.coordType);
      equal(board.tileMatrix.length, grid.width * grid.height * 3);
      ok(board.tileMatrix.every((index) => index === 0));
      deepEqual(board.lut, [""]);
      equal(board.layerTitles.length, 4);
      deepEqual(writeBoard(board), { ok: true, value: built.bytes, warnings: [] });
      const host = createMemoryPlatformServices({});
      const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/village.brd"), built.bytes);
      ok(opened.ok);
      if (!opened.ok) return;
      equal(opened.document.getSnapshot().readOnly, null, "a new board has a same-version writer");
      equal(opened.document.getSnapshot().coordType, board.coordType);
      ok(opened.document.apply({ type: "set-tile", layer: 2, x: 1, y: 1, tile: "village.tst1" }).ok);
    });
  }
}

test("the summary says the board's pixel size and how many cells it stores", () => {
  deepEqual(newBoardSummary({ coordSystem: "2d", width: 10, height: 6, layers: 3 }), { pixelWidth: 320, pixelHeight: 192, cells: 180 });
  deepEqual(newBoardSummary({ coordSystem: "iso-stacked", width: 10, height: 6, layers: 3 }), { pixelWidth: 608, pixelHeight: 80, cells: 180 });
  deepEqual(newBoardSummary({ coordSystem: "iso-rotated", width: 10, height: 6, layers: 2 }), { pixelWidth: 608, pixelHeight: 192, cells: 512 });
});

test("a board larger than one run marker holds is written as several runs that read back as one empty grid", () => {
  const built = buildNewBoard({ ...base, width: 200, height: 100, layers: 2 });
  ok(built.ok);
  if (!built.ok) return;
  const read = readBoard(new BinaryReader(built.bytes));
  ok(read.ok);
  if (!read.ok) return;
  deepEqual(read.value.tileRuns.map((run) => run.count), [32768, 7232]);
  equal(read.value.tileMatrix.length, 40000);
});

test("settings that cannot make a board are each refused on the field to blame, and nothing is built", () => {
  const field = (settings: Partial<NewBoardSettings>): string | undefined => validateNewBoard({ ...base, ...settings })[0]?.field;
  equal(field({ name: "" }), "name");
  equal(field({ name: "a/b" }), "name");
  equal(field({ width: 0 }), "width");
  equal(field({ width: NEW_BOARD_MAX_SIZE + 1 }), "width");
  equal(field({ height: 1.5 }), "height");
  equal(field({ height: -2 }), "height");
  equal(field({ layers: 0 }), "layers");
  equal(field({ layers: NEW_BOARD_MAX_LAYERS + 1 }), "layers");
  equal(field({ backgroundImage: "a\nb" }), "backgroundImage");
  const huge = { width: 1000, height: 1000, layers: 8 };
  ok(newBoardSummary({ coordSystem: "2d", ...huge }).cells > BOARD_MAX_CELLS);
  match(validateNewBoard({ ...base, ...huge })[0]?.message ?? "", /at most 4194304/);
  const refused = buildNewBoard({ ...base, ...huge });
  equal(refused.ok, false);
  deepEqual(validateNewBoard(base), []);
});

test("the board file name gains .brd once", () => {
  equal(boardFileName(" village "), "village.brd");
  equal(boardFileName("village.BRD"), "village.BRD");
});

test("a template contributes its layer titles, background and ambience but none of its tiles, vectors or programs", () => {
  const empty = createEmptyBoard();
  const template = {
    ...empty,
    sizeX: 2,
    sizeY: 1,
    sizeL: 2,
    lut: ["", "village.tst1"],
    tileMatrix: [1, 1, 1, 1],
    tileRuns: [{ lutIndex: 1, count: 4, marker: true }],
    layerTitles: ["", "ground", "objects"],
    vectors: [{ points: [{ x: 0, y: 0 }, { x: 8, y: 8 }], attributes: 0, closed: 0, layer: 1, type: 1, handle: "wall" }],
    properties: {
      ...empty.properties,
      backgroundImage: "sky.png",
      backgroundColour: { r: 1, g: 2, b: 3 },
      backgroundMusic: "theme.mid",
      ambient: { r: 10, g: -10, b: 0 },
      enterPrg: "enter.prg",
    },
  };
  const built = buildNewBoard({ ...base, layers: 3 }, template);
  ok(built.ok);
  if (!built.ok) return;
  const read = readBoard(new BinaryReader(built.bytes));
  ok(read.ok);
  if (!read.ok) return;
  deepEqual(read.value.layerTitles, ["", "ground", "objects", ""]);
  equal(read.value.properties.backgroundImage, "sky.png");
  deepEqual(read.value.properties.backgroundColour, { r: 1, g: 2, b: 3 });
  equal(read.value.properties.backgroundMusic, "theme.mid");
  deepEqual(read.value.properties.ambient, { r: 10, g: -10, b: 0 });
  equal(read.value.properties.enterPrg, "", "programs are not copied");
  equal(read.value.vectors.length, 0);
  ok(read.value.tileMatrix.every((index) => index === 0));
  const own = buildNewBoard({ ...base, backgroundImage: "mine.png" }, template);
  ok(own.ok);
  if (own.ok) {
    const reread = readBoard(new BinaryReader(own.bytes));
    ok(reread.ok);
    if (reread.ok) equal(reread.value.properties.backgroundImage, "mine.png", "a background named in the dialog replaces the template's");
  }
});

test("creating a board writes it once into the boards folder and never over another file, whatever the case", async () => {
  const host = createMemoryPlatformServices({ files: { "Boards/Village.brd": new Uint8Array([1, 2, 3]) } });
  const refused = await createBoardFile(host.fs, { projectFolder: "" }, base);
  equal(refused.ok, false);
  if (!refused.ok) {
    equal(refused.reason, "exists");
    match(refused.message, /Boards\/village\.brd already exists/);
  }
  const read = await host.fs.read("Boards/Village.brd");
  ok(read.ok);
  if (read.ok) deepEqual([...read.value], [1, 2, 3], "the existing file is untouched");
  const created = await createBoardFile(host.fs, { projectFolder: "" }, { ...base, name: "meadow" });
  deepEqual(created, { ok: true, path: "Boards/meadow.brd" });
  const written = await host.fs.read("Boards/meadow.brd");
  ok(written.ok);
  if (written.ok) ok(readBoard(new BinaryReader(written.value)).ok);
  const invalid = await createBoardFile(host.fs, { projectFolder: "" }, { ...base, name: "x", width: 0 });
  equal(invalid.ok, false);
  const listed = await host.fs.list("Boards");
  ok(listed.ok);
  if (listed.ok) deepEqual(listed.value.map((entry) => entry.name).sort(), ["Village.brd", "meadow.brd"], "a refused board writes nothing");
});

test("a board is created in the boards folder of a project that keeps its folders below a project folder", async () => {
  const host = createMemoryPlatformServices({});
  const created = await createBoardFile(host.fs, { projectFolder: "Game" }, { ...base, name: "map" });
  deepEqual(created, { ok: true, path: "Game/Boards/map.brd" });
});

test("a template that is missing or not a board stops the creation before anything is written", async () => {
  const host = createMemoryPlatformServices({ files: { "Boards/broken.brd": new Uint8Array([9, 9]) } });
  const missing = await createBoardFile(host.fs, { projectFolder: "" }, { ...base, template: "Boards/none.brd" });
  equal(missing.ok, false);
  if (!missing.ok) equal(missing.reason, "template");
  const broken = await createBoardFile(host.fs, { projectFolder: "" }, { ...base, template: "Boards/broken.brd" });
  equal(broken.ok, false);
  if (!broken.ok) match(broken.message, /not a board this editor reads/);
  const listed = await host.fs.list("Boards");
  ok(listed.ok);
  if (listed.ok) deepEqual(listed.value.map((entry) => entry.name), ["broken.brd"]);
});

test("a board created from a template copies the template and keeps both files", async () => {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, sizeX: 1, sizeY: 1, sizeL: 1, layerTitles: ["", "ground"], tileMatrix: [0], tileRuns: [{ lutIndex: 0, count: 1, marker: false }] });
  ok(written.ok);
  if (!written.ok) return;
  const host = createMemoryPlatformServices({ files: { "Boards/start.brd": written.value } });
  const created = await createBoardFile(host.fs, { projectFolder: "" }, { ...base, name: "second", layers: 1, template: "Boards/start.brd" });
  deepEqual(created, { ok: true, path: "Boards/second.brd" });
  const copy = await host.fs.read("Boards/second.brd");
  ok(copy.ok);
  if (!copy.ok) return;
  const read = readBoard(new BinaryReader(copy.value));
  ok(read.ok);
  if (read.ok) deepEqual(read.value.layerTitles, ["", "ground"]);
});

test("a board made without the dialog gets the first name that is free", async () => {
  const host = createMemoryPlatformServices({ files: { "Boards/untitled.brd": new Uint8Array([0]), "Boards/Untitled 2.brd": new Uint8Array([0]) } });
  equal(await uniqueBoardName(host.fs, { projectFolder: "" }), "untitled 3");
  equal(await uniqueBoardName(createMemoryPlatformServices({}).fs, { projectFolder: "" }), "untitled");
});

test("the last choices are remembered as user preferences and the dialog can be switched off", async () => {
  const host = createMemoryPlatformServices({});
  const preferences = createPreferences({ settings: host.settings, projectLayer: false });
  await preferences.refresh();
  deepEqual(newBoardSettingsFrom(preferences.getSnapshot()), { ...DEFAULT_NEW_BOARD });
  equal(asksBeforeCreating(preferences.getSnapshot()), true);
  const problem = await rememberNewBoard(preferences, { ...base, coordSystem: "iso-rotated", pixelCoordinates: true, width: 33, height: 21, layers: 5 });
  equal(problem, null);
  deepEqual(newBoardSettingsFrom(preferences.getSnapshot()), { ...DEFAULT_NEW_BOARD, coordSystem: "iso-rotated", pixelCoordinates: true, width: 33, height: 21, layers: 5 });
  // A fresh model over the same host sees what was stored.
  const again = createPreferences({ settings: host.settings, projectLayer: false });
  await again.refresh();
  equal(newBoardSettingsFrom(again.getSnapshot()).coordSystem, "iso-rotated");
  ok((await again.set("board.showNewBoardDialog", "user", false)).ok);
  equal(asksBeforeCreating(again.getSnapshot()), false);
});
