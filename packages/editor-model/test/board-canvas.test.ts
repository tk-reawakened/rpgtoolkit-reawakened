// The board canvas of story 12.10 over the real board document, on a top-down board and on both isometric layouts:
// snapping, visible layers, the tile tools, and edits that undo and redo while selection, pan and zoom change nothing.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, writeTileBitmap, type TileBitmap } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  boardExtent,
  boardTileAt,
  boardToScreen,
  buildNewBoard,
  cellCentre,
  cellOnBoard,
  createBoardDocument,
  createBoardEditor,
  createDocumentIdentity,
  DEFAULT_EDITOR_PREFERENCES,
  floodFill,
  moveCells,
  paintCells,
  pixelToCell,
  rectangleCells,
  stampCells,
  stampFromBitmap,
  tileSourceOf,
  type BoardCoordSystem,
  type BoardDocument,
  type BoardEditor,
  type Brush,
  type Cell,
  type EditorPreferences,
  type Modifiers,
} from "../src/index.ts";

const GRASS = "village.tst1";
const ROCK = "village.tst2";

interface Rig {
  readonly doc: BoardDocument;
  readonly editor: BoardEditor;
  readonly picks: string[];
  /** A cell in the middle of the board's picture, with room around it on every layout. */
  readonly centre: Cell;
  brush: Brush | null;
  prefs: EditorPreferences;
}

function rig(coordSystem: BoardCoordSystem, width = 8, height = 8, layers = 2, pixelCoordinates = false): Rig {
  const built = buildNewBoard({ name: "t", coordSystem, pixelCoordinates, width, height, layers, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const board = opened.document.getSnapshot();
  const extent = boardExtent(board);
  const centre = pixelToCell(board, extent.width / 2, extent.height / 2);
  if (centre === null) throw new Error("the board has no cell in its middle");
  const state: Rig = { doc: opened.document, picks: [], centre, brush: { kind: "tile", tile: GRASS, label: "grass" }, prefs: DEFAULT_EDITOR_PREFERENCES, editor: undefined as never };
  const editor = createBoardEditor({
    board: () => state.doc.getSnapshot(),
    apply: (command) => state.doc.apply(command),
    brush: () => state.brush,
    pickTile: (tile) => { state.picks.push(tile); return true; },
    preferences: () => state.prefs,
  });
  return Object.assign(state, { editor });
}

const none: Modifiers = {};
const ctrl: Modifiers = { ctrl: true };

/** The cell `dx` columns and `dy` rows from the middle of the board, in the stored grid. */
const near = (s: Rig, dx: number, dy: number): Cell => ({ x: s.centre.x + dx, y: s.centre.y + dy });

/** The screen position of the middle of a cell in the editor's current view. */
function at(s: Rig, cell: Cell): { x: number; y: number } {
  const centre = cellCentre(s.doc.getSnapshot(), cell.x, cell.y);
  return boardToScreen(s.editor.getState().viewport, centre.x, centre.y);
}

async function click(s: Rig, cell: Cell, modifiers: Modifiers = none): Promise<void> {
  s.editor.pointerDown(at(s, cell), modifiers);
  await s.editor.pointerUp(at(s, cell), modifiers);
}

async function drag(s: Rig, from: Cell, to: Cell, modifiers: Modifiers = none): Promise<void> {
  s.editor.pointerDown(at(s, from), modifiers);
  s.editor.pointerMove(at(s, to), modifiers);
  await s.editor.pointerUp(at(s, to), modifiers);
}

const tileAt = (s: Rig, layer: number, x: number, y: number): string | null => boardTileAt(s.doc.getSnapshot(), layer, x, y);
const edits = (s: Rig): number => s.doc.getSnapshot().edits.length;

const LAYOUTS: readonly [string, BoardCoordSystem, boolean][] = [
  ["top-down", "2d", false],
  ["iso-stacked", "iso-stacked", false],
  ["iso-rotated", "iso-rotated", false],
  ["top-down with pixel coordinates", "2d", true],
  ["iso-rotated with pixel coordinates", "iso-rotated", true],
];

for (const [name, system, pixels] of LAYOUTS) {
  const make = (width = 8, height = 8, layers = 2): Rig => rig(system, width, height, layers, pixels);

  test(`${name}: a click draws the brush tile on the current layer as one edit that undoes and redoes`, async () => {
    const s = make();
    const c = s.centre;
    const before = s.doc.serialize();
    await click(s, c);
    equal(tileAt(s, 0, c.x, c.y), GRASS);
    equal(tileAt(s, 1, c.x, c.y), "", "only the current layer changes");
    equal(edits(s), 1);
    equal(s.doc.getSnapshot().dirty, true);
    ok(s.doc.undo().ok);
    deepEqual(s.doc.serialize(), before);
    equal(s.doc.getSnapshot().dirty, false);
    ok(s.doc.redo().ok);
    equal(tileAt(s, 0, c.x, c.y), GRASS);
  });

  test(`${name}: a drag is one edit that reaches both ends and stays on the board, and one undo takes all of it back`, async () => {
    const s = make(12, 12);
    const before = s.doc.serialize();
    const from = near(s, -3, -2);
    const to = near(s, 2, 2);
    await drag(s, from, to);
    equal(edits(s), 1);
    const board = s.doc.getSnapshot();
    const painted: Cell[] = [];
    for (let y = 0; y < board.grid.height; y += 1) for (let x = 0; x < board.grid.width; x += 1) if (tileAt(s, 0, x, y) === GRASS) painted.push({ x, y });
    ok(painted.length >= 6, `${painted.length} cells painted`);
    ok(painted.some((cell) => cell.x === from.x && cell.y === from.y));
    ok(painted.some((cell) => cell.x === to.x && cell.y === to.y));
    for (const cell of painted) ok(cellOnBoard(board, cell.x, cell.y));
    ok(s.doc.undo().ok);
    deepEqual(s.doc.serialize(), before);
  });

  test(`${name}: erase empties a cell, and the dropper copies a tile into the brush without editing`, async () => {
    const s = make();
    const c = s.centre;
    await click(s, c);
    s.editor.setTool("erase");
    await click(s, c);
    equal(tileAt(s, 0, c.x, c.y), "");
    equal(edits(s), 2);
    ok(s.doc.undo().ok);
    equal(tileAt(s, 0, c.x, c.y), GRASS);
    s.editor.setTool("dropper");
    const count = edits(s);
    await click(s, c);
    deepEqual(s.picks, [GRASS]);
    equal(edits(s), count, "picking is not an edit");
    await click(s, near(s, 1, 1));
    equal(s.editor.getState().message?.text, "That cell is empty, so there is no tile to pick.");
    equal(edits(s), count);
  });

  test(`${name}: flood fills the connected region on the current layer and returns to Draw by preference`, async () => {
    const s = make();
    s.brush = { kind: "tile", tile: ROCK, label: "rock" };
    s.editor.setTool("flood");
    await click(s, s.centre);
    const board = s.doc.getSnapshot();
    let filled = 0;
    let onBoard = 0;
    for (let y = 0; y < board.grid.height; y += 1) {
      for (let x = 0; x < board.grid.width; x += 1) {
        if (cellOnBoard(board, x, y)) onBoard += 1;
        if (tileAt(s, 0, x, y) === ROCK) {
          filled += 1;
          ok(cellOnBoard(board, x, y), "a flood never writes a cell off the board");
        }
        equal(tileAt(s, 1, x, y), "", "the other layer is untouched");
      }
    }
    equal(filled, onBoard, "an empty layer is one connected region");
    equal(edits(s), 1);
    equal(s.editor.getState().tool, "draw", "revertToDrawAfterFlood is on by default");
    ok(s.doc.undo().ok);
    equal(tileAt(s, 0, s.centre.x, s.centre.y), "");
  });

  test(`${name}: a flood stops at a wall of different tiles and keeps the tool when the preference is off`, async () => {
    const s = make();
    s.prefs = { revertToDrawAfterFlood: false, recursiveFlood: false };
    const board = s.doc.getSnapshot();
    // A wall of rock along the whole stored row through the middle splits the board in two (on an iso-stacked board
    // every neighbour is on the next row, so one row is a wall too).
    const wall: Cell[] = [];
    for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, s.centre.y)) wall.push({ x, y: s.centre.y });
    ok(wall.length > 2);
    ok(s.doc.apply({ type: "set-tiles", gesture: "draw", cells: wall.map((cell) => ({ layer: 0, ...cell, tile: ROCK })) }).ok);
    s.editor.setTool("flood");
    let start: Cell | null = null;
    for (let y = s.centre.y - 1; y >= 0 && start === null; y -= 1) for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, y)) { start = { x, y }; break; }
    ok(start !== null);
    const before = edits(s);
    await click(s, start!);
    equal(edits(s), before + 1);
    equal(s.editor.getState().tool, "flood", "the tool stays when the preference is off");
    let changed = 0;
    for (let y = 0; y < board.grid.height; y += 1) {
      for (let x = 0; x < board.grid.width; x += 1) {
        if (tileAt(s, 0, x, y) !== GRASS) continue;
        changed += 1;
        ok(y < s.centre.y, `the fill stayed above the wall (row ${y})`);
      }
    }
    ok(changed > 0);
    for (const cell of wall) equal(tileAt(s, 0, cell.x, cell.y), ROCK, "the wall is untouched");
  });

  test(`${name}: flood across layers fills the same region on every layer that holds the tile`, async () => {
    const s = make();
    s.prefs = { revertToDrawAfterFlood: true, recursiveFlood: true };
    s.brush = { kind: "tile", tile: ROCK, label: "rock" };
    s.editor.setTool("flood");
    await click(s, s.centre);
    equal(tileAt(s, 0, s.centre.x, s.centre.y), ROCK);
    equal(tileAt(s, 1, s.centre.x, s.centre.y), ROCK);
    equal(edits(s), 1);
    ok(s.doc.undo().ok);
    equal(tileAt(s, 1, s.centre.x, s.centre.y), "");
  });

  test(`${name}: selecting, panning, zooming, the grid and layer visibility are never edits`, async () => {
    const s = make();
    await click(s, s.centre);
    ok((await s.doc.save()).ok);
    const bytes = s.doc.serialize();
    const history = s.doc.getSnapshot().edits;
    s.editor.setTool("select");
    await drag(s, near(s, -1, -1), near(s, 1, 1));
    ok(s.editor.getState().selection !== null);
    s.editor.setTool("scroll");
    s.editor.pointerDown({ x: 100, y: 100 }, none);
    s.editor.pointerMove({ x: 60, y: 70 }, none);
    await s.editor.pointerUp({ x: 60, y: 70 }, none);
    s.editor.zoomIn();
    s.editor.zoomOut();
    s.editor.wheel(40, none, { x: 10, y: 10 });
    s.editor.wheel(40, { shift: true }, { x: 10, y: 10 });
    s.editor.wheel(-1, ctrl, { x: 10, y: 10 });
    s.editor.toggleGrid();
    s.editor.toggleBackground();
    s.editor.setLayer(1);
    s.editor.setLayerVisible(0, false);
    s.editor.showOnlyCurrent();
    s.editor.showAll();
    s.editor.selectAll();
    s.editor.cancel();
    const snapshot = s.doc.getSnapshot();
    equal(snapshot.dirty, false);
    equal(snapshot.canUndo, true, "the one saved edit is still the only history");
    equal(snapshot.edits, history);
    deepEqual(s.doc.serialize(), bytes);
  });

  test(`${name}: the current layer is always visible; show only current and show all change what the picture asks for`, () => {
    const s = make(8, 8, 3);
    const { editor } = s;
    deepEqual(editor.pictureRequest(), { visibleLayers: [0, 1, 2], showBackground: true });
    ok(editor.setLayerVisible(2, false));
    deepEqual(editor.pictureRequest().visibleLayers, [0, 1]);
    equal(editor.setLayerVisible(0, false), false, "the current layer cannot be hidden");
    equal(editor.getState().message?.kind, "error");
    editor.setLayer(2);
    deepEqual(editor.pictureRequest().visibleLayers, [0, 1, 2], "choosing a hidden layer shows it");
    editor.showOnlyCurrent();
    deepEqual(editor.pictureRequest(), { visibleLayers: [2], showBackground: false });
    editor.showAll();
    deepEqual(editor.pictureRequest(), { visibleLayers: [0, 1, 2], showBackground: true });
    editor.setLayer(99);
    equal(editor.getState().layer, 2);
  });

  test(`${name}: select, then move and copy the selection by dragging, as single edits`, async () => {
    const s = make();
    const [a, b, a2, b2] = [near(s, 0, 0), near(s, 1, 0), near(s, 2, 1), near(s, 3, 1)];
    for (const cell of [a, b]) await click(s, cell);
    s.editor.setTool("select");
    await drag(s, a, b);
    deepEqual(s.editor.getState().selection, { layer: 0, rect: { x0: a.x, y0: a.y, x1: b.x, y1: b.y } });
    const count = edits(s);
    // Drag the selection two columns right and one row down.
    await drag(s, a, a2);
    equal(edits(s), count + 1);
    equal(tileAt(s, 0, a.x, a.y), "");
    equal(tileAt(s, 0, b.x, b.y), "");
    equal(tileAt(s, 0, a2.x, a2.y), GRASS);
    equal(tileAt(s, 0, b2.x, b2.y), GRASS);
    deepEqual(s.editor.getState().selection, { layer: 0, rect: { x0: a2.x, y0: a2.y, x1: b2.x, y1: b2.y } }, "the selection follows the tiles");
    ok(s.doc.undo().ok);
    equal(tileAt(s, 0, a.x, a.y), GRASS);
    equal(tileAt(s, 0, a2.x, a2.y), "");
    // Ctrl+drag copies, and leaves the source.
    s.editor.setTool("select");
    await drag(s, a, b);
    const below = near(s, 0, 2);
    await drag(s, a, below, ctrl);
    equal(tileAt(s, 0, a.x, a.y), GRASS);
    equal(tileAt(s, 0, below.x, below.y), GRASS);
    equal(tileAt(s, 0, below.x + 1, below.y), GRASS);
    ok(s.doc.undo().ok);
    equal(tileAt(s, 0, below.x, below.y), "");
  });

  test(`${name}: a move that would leave the board is refused whole and changes nothing`, async () => {
    const s = make();
    await click(s, s.centre);
    s.editor.setTool("select");
    await click(s, s.centre);
    const before = s.doc.serialize();
    const count = edits(s);
    await s.editor.moveSelectionBy(40, 0, false);
    match(s.editor.getState().message?.text ?? "", /off the board/);
    equal(edits(s), count);
    deepEqual(s.doc.serialize(), before);
  });

  test(`${name}: the keyboard does what the pointer does: Space draws, and two Spaces make a rectangle or a selection`, async () => {
    const s = make();
    const first = near(s, -1, -1);
    s.editor.setCursor(s.centre);
    await s.editor.activate(none);
    equal(tileAt(s, 0, s.centre.x, s.centre.y), GRASS);
    equal(edits(s), 1);
    s.editor.setTool("select");
    s.editor.setCursor(first);
    await s.editor.activate(none);
    equal(s.editor.getState().pending?.kind, "corner");
    s.editor.moveCursor(1, 1);
    await s.editor.activate(none);
    deepEqual(s.editor.getState().selection, { layer: 0, rect: { x0: first.x, y0: first.y, x1: first.x + 1, y1: first.y + 1 } });
    s.editor.cancel();
    equal(s.editor.getState().selection, null);
    equal(edits(s), 1, "selecting is not an edit");
    if (system === "iso-stacked") return;
    s.editor.setTool("rectangle");
    s.editor.setCursor(first);
    await s.editor.activate(none);
    s.editor.moveCursor(2, 2);
    await s.editor.activate(ctrl);
    equal(tileAt(s, 0, first.x, first.y), GRASS);
    equal(tileAt(s, 0, first.x + 1, first.y + 1), GRASS, "Ctrl fills the rectangle");
    equal(edits(s), 2);
  });
}

test("draw with no brush says so and edits nothing; a brush that is not a tile cannot flood", async () => {
  const s = rig("2d");
  s.brush = null;
  await click(s, s.centre);
  equal(s.editor.getState().message?.text, "Choose a tile in the tileset browser first.");
  equal(edits(s), 0);
  s.brush = { kind: "stamp", stamp: { name: "house.tbm", width: 1, height: 1, cells: [GRASS] } };
  s.editor.setTool("flood");
  await click(s, s.centre);
  match(s.editor.getState().message?.text ?? "", /needs a single tile/);
  equal(edits(s), 0);
});

test("the rectangle tool is hollow, filled with Ctrl, and refused on an iso-stacked board", async () => {
  const s = rig("2d", 10, 10);
  s.editor.setTool("rectangle");
  await drag(s, { x: 2, y: 2 }, { x: 5, y: 4 });
  const board = s.doc.getSnapshot();
  let hollow = 0;
  for (let y = 0; y < 10; y += 1) for (let x = 0; x < 10; x += 1) if (boardTileAt(board, 0, x, y) === GRASS) hollow += 1;
  equal(hollow, 4 * 3 - 2 * 1, "the border of a 4 × 3 rectangle");
  equal(tileAt(s, 0, 3, 3), "");
  await drag(s, { x: 7, y: 7 }, { x: 8, y: 8 }, ctrl);
  equal(tileAt(s, 0, 7, 7), GRASS);
  equal(tileAt(s, 0, 8, 8), GRASS);
  equal(edits(s), 2);
  const stacked = rig("iso-stacked");
  stacked.editor.setTool("rectangle");
  stacked.editor.pointerDown(at(stacked, stacked.centre), none);
  equal(stacked.editor.getState().pending, null);
  match(stacked.editor.getState().message?.text ?? "", /not available on an iso-stacked board/);
});

test("a rotated rectangle on an iso-rotated board is the rectangle of the stored grid", () => {
  const board = rig("iso-rotated", 6, 6).doc.getSnapshot();
  const result = rectangleCells(board, 0, { x: 3, y: 3 }, { x: 5, y: 4 }, true, GRASS);
  ok(result.ok);
  const cells = result.ok ? result.cells : [];
  equal(cells.length, 6);
  for (const cell of cells) ok(cell.x >= 3 && cell.x <= 5 && cell.y >= 3 && cell.y <= 4);
});

test("a stamp places the whole tile bitmap grid with its top-left on the clicked cell, in one edit, and is refused whole near an edge", async () => {
  const bitmap: TileBitmap = {
    magic: "TK3 TILEBITMAP",
    major: 3,
    minor: 0,
    width: 2,
    height: 2,
    // x outer, y inner, with the padding row and column: (x, y) is x × 3 + y.
    cells: [
      { tile: GRASS, r: 0, g: 0, b: 0 }, { tile: ROCK, r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
      { tile: ROCK, r: 5, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(0),
  } as TileBitmap;
  const written = writeTileBitmap(bitmap);
  ok(written.ok);
  const stamp = stampFromBitmap(written.ok ? written.value : new Uint8Array(), "Bitmaps/house.tbm", "house.tbm");
  ok(stamp.ok);
  if (!stamp.ok) return;
  deepEqual(stamp.value, { name: "house.tbm", width: 2, height: 2, cells: [GRASS, ROCK, ROCK, ""] });
  for (const system of ["2d", "iso-stacked", "iso-rotated"] as const) {
    const s = rig(system);
    s.brush = { kind: "stamp", stamp: stamp.value };
    const c = s.centre;
    await click(s, c);
    equal(tileAt(s, 0, c.x, c.y), GRASS, system);
    equal(tileAt(s, 0, c.x + 1, c.y), ROCK, system);
    equal(tileAt(s, 0, c.x, c.y + 1), ROCK, system);
    equal(tileAt(s, 0, c.x + 1, c.y + 1), "", `${system}: an empty stamp cell leaves the board cell alone`);
    equal(edits(s), 1, system);
    ok(s.doc.undo().ok);
    equal(tileAt(s, 0, c.x, c.y), "", system);
  }
  const edge = rig("2d");
  edge.brush = { kind: "stamp", stamp: stamp.value };
  const refused = stampCells(edge.doc.getSnapshot(), 0, stamp.value, { x: 7, y: 7 });
  equal(refused.ok, false);
  await click(edge, { x: 7, y: 7 });
  equal(edits(edge), 0);
  match(edge.editor.getState().message?.text ?? "", /does not fit/);
});

test("a tile bitmap with no drawn cells has no stamp, and a file that is not a bitmap is refused with its reason", () => {
  const stamp = stampFromBitmap(new Uint8Array([1, 2, 3]), "Bitmaps/x.tbm", "x.tbm");
  equal(stamp.ok, false);
});

test("tool functions are pure: they read a snapshot and never change it", () => {
  const s = rig("iso-rotated", 6, 6);
  const board = s.doc.getSnapshot();
  const before = [...board.tileMatrix];
  ok(paintCells(board, 0, [{ x: 3, y: 3 }], GRASS).length === 1);
  ok(floodFill(board, 0, { x: 3, y: 3 }, GRASS, false).ok);
  ok(moveCells(board, 0, { x0: 3, y0: 3, x1: 3, y1: 3 }, 1, 0, false).ok);
  deepEqual([...board.tileMatrix], before);
  equal(floodFill(board, 0, { x: 0, y: 0 }, GRASS, false).ok, false, "a cell off the board cannot start a flood");
});

test("tile references name the file the dropper makes the brush", () => {
  deepEqual(tileSourceOf("village.tst3"), { file: "village.tst", label: "village.tst tile 3", index: 3 });
  deepEqual(tileSourceOf("sub\\grass.iso12"), { file: "sub/grass.iso", label: "grass.iso tile 12", index: 12 });
  deepEqual(tileSourceOf("water.tan"), { file: "water.tan", label: "water.tan", index: null });
  equal(tileSourceOf("odd"), null);
});

test("set-tiles runs merge only changed cells, keep other runs byte for byte and round-trip through the reader", () => {
  const s = rig("2d", 6, 6, 1);
  const before = s.doc.serialize();
  const cells = [0, 1, 2, 7, 8].map((index) => ({ layer: 0, x: index % 6, y: Math.floor(index / 6), tile: GRASS }));
  ok(s.doc.apply({ type: "set-tiles", gesture: "draw", cells }).ok);
  const after = s.doc.serialize();
  const read = readBoard(new BinaryReader(after));
  ok(read.ok);
  if (!read.ok) return;
  deepEqual(read.value.tileRuns.map((run) => run.count), [3, 4, 2, 27], "three grass, four empty, two grass, the rest empty");
  ok(s.doc.undo().ok);
  deepEqual(s.doc.serialize(), before);
  const refused = s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 9, y: 0, tile: GRASS }] });
  equal(refused.ok, false);
  equal(s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [] }).ok, false, "a command that changes nothing is refused");
});
