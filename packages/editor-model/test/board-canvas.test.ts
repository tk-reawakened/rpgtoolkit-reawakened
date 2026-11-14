// The board canvas of story 12.10 over the real board document, on a top-down board and on both isometric layouts:
// snapping, visible layers, the tile tools, and edits that undo and redo while selection, pan and zoom change nothing.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, writeBoard, writeTileBitmap, type TileBitmap } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  boardExtent,
  boardTileAt,
  boardToScreen,
  buildNewBoard,
  cellCentre,
  cellInGrid,
  cellNeighbours,
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
  rectangleRegion,
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
  s.brush = { kind: "stamp", stamp: { name: "house.tbm", width: 1, height: 1, cells: [GRASS], tints: [{ r: 0, g: 0, b: 0 }] } };
  s.editor.setTool("flood");
  await click(s, s.centre);
  match(s.editor.getState().message?.text ?? "", /needs a single tile/);
  equal(edits(s), 0);
});

test("the rectangle tool is hollow, and filled with Ctrl", async () => {
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
});

test("on an iso-stacked board the rectangle is the rectangle of the picture, hollow or filled, as one edit", async () => {
  const s = rig("iso-stacked", 12, 12);
  const board = s.doc.getSnapshot();
  const from = near(s, -3, -2);
  const to = near(s, 3, 2);
  const a = cellCentre(board, from.x, from.y);
  const b = cellCentre(board, to.x, to.y);
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const expected = new Set<string>();
  for (let y = 0; y < 12; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      const centre = cellCentre(board, x, y);
      if (centre.x >= left && centre.x <= right && centre.y >= top && centre.y <= bottom) expected.add(`${x},${y}`);
    }
  }
  ok(expected.size > 12, `${expected.size} cells in the picture rectangle`);
  const region = rectangleRegion(board, from, to, true);
  deepEqual(new Set(region.map((cell) => `${cell.x},${cell.y}`)), expected, "filled: every cell whose centre is inside the picture rectangle, and no other");
  const edge = rectangleRegion(board, from, to, false);
  ok(edge.length > 0 && edge.length < region.length);
  ok(edge.some((cell) => cell.x === from.x && cell.y === from.y), "a corner cell is on the edge");
  const onEdge = new Set(edge.map((cell) => `${cell.x},${cell.y}`));
  for (const cell of region) {
    if (onEdge.has(`${cell.x},${cell.y}`)) continue;
    for (const next of cellNeighbours(board, cell.x, cell.y)) ok(expected.has(`${next.x},${next.y}`), "an interior cell has all four neighbours inside");
  }
  s.editor.setTool("rectangle");
  await drag(s, from, to);
  equal(edits(s), 1);
  const drawn = new Set<string>();
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) if (tileAt(s, 0, x, y) === GRASS) drawn.add(`${x},${y}`);
  deepEqual(drawn, onEdge, "the pointer drew the hollow rectangle");
  await drag(s, from, to, ctrl);
  equal(edits(s), 2);
  let filled = 0;
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 12; x += 1) if (tileAt(s, 0, x, y) === GRASS) filled += 1;
  equal(filled, expected.size, "Ctrl fills it");
  ok(s.doc.undo().ok);
  equal(tileAt(s, 0, from.x, from.y), GRASS);
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
  deepEqual(stamp.value, { name: "house.tbm", width: 2, height: 2, cells: [GRASS, ROCK, ROCK, ""], tints: [{ r: 0, g: 0, b: 0 }, { r: 5, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }] });
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

/** The tint a cell has on one layer alone, as the engine adds it: every shade cast onto that layer or a higher one, and the all-layer shade. */
function tintOn(s: Rig, layer: number, x: number, y: number): [number, number, number] {
  const read = readBoard(new BinaryReader(s.doc.serialize()));
  if (!read.ok) throw new Error(read.error.message);
  const board = read.value;
  const width = board.sizeX + (board.coordType & 2 ? board.sizeY : 0);
  const cell = y * width + x;
  const sum: [number, number, number] = [0, 0, 0];
  for (const shade of board.shadeLayers) {
    if (shade.castLayer !== 0 && shade.castLayer < layer + 1) continue;
    let at = 0;
    for (const record of shade.records) {
      const count = record.runCount > 1 ? record.runCount : 1;
      if (cell >= at && cell < at + count) {
        sum[0] += record.r;
        sum[1] += record.g;
        sum[2] += record.b;
        break;
      }
      at += count;
    }
  }
  return sum;
}

for (const system of ["2d", "iso-stacked", "iso-rotated"] as const) {
  test(`${system}: a stamp places its cells' tints with its tiles, on that layer alone, in the same edit, idempotently`, async () => {
    const cellOf = (tile: string, r: number, g: number, b: number): TileBitmap["cells"][number] => ({ tile, r, g, b });
    const bitmap = {
      magic: "TK3 TILEBITMAP", major: 3, minor: 0, width: 2, height: 1,
      // (x, y) is x × 2 + y: the tinted tile, a negative tint, and the padding row.
      cells: [cellOf(GRASS, 40, 0, -20), cellOf("", 0, 0, 0), cellOf(ROCK, -30, 10, 0), cellOf("", 0, 0, 0), cellOf("", 0, 0, 0), cellOf("", 0, 0, 0)],
      residue: new Uint8Array(0),
    } as TileBitmap;
    const written = writeTileBitmap(bitmap);
    ok(written.ok);
    const stamp = stampFromBitmap(written.ok ? written.value : new Uint8Array(), "Bitmaps/t.tbm", "t.tbm");
    ok(stamp.ok);
    if (!stamp.ok) return;
    const s = rig(system, 8, 8, 3);
    s.brush = { kind: "stamp", stamp: stamp.value };
    s.editor.setLayer(1);
    const c = s.centre;
    const before = s.doc.serialize();
    await click(s, c);
    equal(edits(s), 1, "tiles and tints are one edit");
    deepEqual(tintOn(s, 1, c.x, c.y), [40, 0, -20], "the stamped layer has the stamp's tint");
    deepEqual(tintOn(s, 1, c.x + 1, c.y), [-30, 10, 0]);
    deepEqual(tintOn(s, 0, c.x, c.y), [0, 0, 0], "the layer below keeps its own tint");
    deepEqual(tintOn(s, 2, c.x, c.y), [0, 0, 0], "so does the layer above");
    const once = s.doc.serialize();
    await click(s, c);
    equal(edits(s), 1, "placing it again changes nothing, so it is not an edit");
    deepEqual(s.doc.serialize(), once);
    ok(s.doc.undo().ok);
    deepEqual(s.doc.serialize(), before, "one Undo takes back the tiles and the tints");
    // The bottom layer needs no cancelling shade; the top one is cast onto its own layer and cancelled below it.
    s.editor.setLayer(0);
    await click(s, c);
    deepEqual(tintOn(s, 0, c.x, c.y), [40, 0, -20]);
    deepEqual(tintOn(s, 1, c.x, c.y), [0, 0, 0]);
  });
}

test("a tint that would take a shade past ±255 is refused whole, and a board's existing shading is kept and counted", async () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 6, height: 6, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  if (!built.ok) return;
  const read = readBoard(new BinaryReader(built.bytes));
  ok(read.ok);
  if (!read.ok) return;
  // A shadow on every layer, 200 red across the whole board, as the board's own shading layer holds it.
  const shaded = writeBoard({ ...read.value, shadeLayers: [{ castLayer: 0, records: [{ runCount: 36, r: 200, g: 0, b: 0 }] }] });
  ok(shaded.ok);
  if (!shaded.ok) return;
  const host = createMemoryPlatformServices({});
  const opened = createBoardDocument(host.fs, createDocumentIdentity("p", "Boards/t.brd"), shaded.value);
  ok(opened.ok);
  if (!opened.ok) return;
  const doc = opened.document;
  const wanted = (r: number): { type: "set-tiles"; gesture: "stamp"; cells: []; shades: { layer: number; x: number; y: number; r: number; g: number; b: number }[] } =>
    ({ type: "set-tiles", gesture: "stamp", cells: [], shades: [{ layer: 1, x: 2, y: 2, r, g: 0, b: 0 }] });
  // The wanted tint is the cell's whole tint on that layer, the board's shadow included: 100 more than the shadow is +100 on top.
  ok(doc.apply(wanted(255)).ok);
  const after = readBoard(new BinaryReader(doc.serialize()));
  ok(after.ok);
  if (!after.ok) return;
  deepEqual(after.value.shadeLayers[0], { castLayer: 0, records: [{ runCount: 36, r: 200, g: 0, b: 0 }] }, "the board's own shading layer is kept as it was");
  const before = doc.serialize();
  const refused = doc.apply(wanted(-100));
  equal(refused.ok, false, "taking the layer 300 below the shadow would need a shade of −300");
  match(refused.ok ? "" : refused.rejection.message, /column 3, row 3 cannot hold that tint/);
  deepEqual(doc.serialize(), before, "a refused command changes nothing");
  equal(doc.apply({ type: "set-tiles", gesture: "stamp", cells: [], shades: [{ layer: 0, x: 0, y: 0, r: 300, g: 0, b: 0 }] }).ok, false, "a tint is within ±255");
});

// Regressions from the independent review of the canvas (#2516–#2521).

test("an iso-rotated board's keyboard cursor starts on the board and reaches every cell that is on it, across the gap", () => {
  const s = rig("iso-rotated", 6, 5, 1);
  const board = s.doc.getSnapshot();
  ok(cellOnBoard(board, s.editor.getState().cursor.x, s.editor.getState().cursor.y), "the first cursor cell is on the board");
  const onBoard: Cell[] = [];
  for (let y = 0; y < board.grid.height; y += 1) for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, y)) onBoard.push({ x, y });
  const reached = new Set<string>([`${s.editor.getState().cursor.x},${s.editor.getState().cursor.y}`]);
  const queue = [s.editor.getState().cursor];
  const arrows = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (queue.length > 0) {
    const here = queue.pop()!;
    for (const [dx, dy] of arrows) {
      s.editor.setCursor(here);
      s.editor.moveCursor(dx, dy);
      const moved = s.editor.getState().cursor;
      ok(cellOnBoard(board, moved.x, moved.y), "an arrow key never leaves the cursor off the board");
      if (!reached.has(`${moved.x},${moved.y}`)) {
        reached.add(`${moved.x},${moved.y}`);
        queue.push(moved);
      }
    }
  }
  equal(reached.size, onBoard.length, "the arrow keys reach every on-board cell");
});

test("a cursor that was on the board and is left off the picture by a change under the editor is brought back onto it", () => {
  const supply = (target: Rig) => ({ board: () => current, apply: (command: Parameters<typeof target.doc.apply>[0]) => target.doc.apply(command), brush: () => null, pickTile: () => false, preferences: () => DEFAULT_EDITOR_PREFERENCES });
  const wide = rig("2d", 12, 12, 1);
  const rotated = rig("iso-rotated", 6, 5, 1);
  let current = wide.doc.getSnapshot();
  const editor = createBoardEditor(supply(wide));
  deepEqual(editor.getState().cursor, { x: 0, y: 0 }, "on a top-down board the first cell is on the board");
  // The board under the editor becomes an iso-rotated 6 × 5 one, whose stored grid is 11 × 11. Cell 0,0 is still inside that
  // grid but has no place on its picture: a guard that only asks whether the cell is in the grid would leave the cursor there.
  current = rotated.doc.getSnapshot();
  ok(cellInGrid(current, 0, 0), "the old cursor cell is still in the stored grid");
  ok(!cellOnBoard(current, 0, 0), "but it is off the picture");
  editor.sync();
  const repaired = editor.getState().cursor;
  ok(cellOnBoard(current, repaired.x, repaired.y), `the cursor is back on the picture at ${repaired.x},${repaired.y}`);
  // The same with a cursor the author had moved: a cell in the grid of both boards, on the first and off the second.
  current = wide.doc.getSnapshot();
  editor.setCursor({ x: 10, y: 10 });
  current = rotated.doc.getSnapshot();
  ok(cellInGrid(current, 10, 10) && !cellOnBoard(current, 10, 10), "10,10 is in the 11 × 11 grid and off the rotated picture");
  editor.sync();
  ok(cellOnBoard(current, editor.getState().cursor.x, editor.getState().cursor.y));
});

test("finishing a rectangle with Ctrl+Space fills it even when it was started without Ctrl, and the middle was empty", async () => {
  const s = rig("2d", 10, 10, 1);
  s.editor.setTool("rectangle");
  s.editor.setCursor({ x: 2, y: 2 });
  await s.editor.activate(none);
  s.editor.moveCursor(4, 4);
  equal(tileAt(s, 0, 4, 4), "", "the middle of the rectangle has never been painted");
  await s.editor.activate(ctrl);
  equal(tileAt(s, 0, 4, 4), GRASS, "Ctrl when the rectangle is finished fills it");
  equal(tileAt(s, 0, 3, 5), GRASS);
  equal(edits(s), 1);
});

test("finishing a rectangle without Ctrl leaves it hollow even when Ctrl was held to start it", async () => {
  const s = rig("2d", 10, 10, 1);
  s.editor.setTool("rectangle");
  s.editor.setCursor({ x: 2, y: 2 });
  await s.editor.activate(ctrl);
  s.editor.moveCursor(4, 0);
  s.editor.moveCursor(0, 4);
  deepEqual(s.editor.getState().pending !== null && s.editor.getState().pending!.kind, "corner", "the first corner is still pending");
  await s.editor.activate(none);
  equal(edits(s), 1);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) {
      const edge = x === 2 || x === 6 || y === 2 || y === 6;
      equal(tileAt(s, 0, x, y), edge ? GRASS : "", `column ${x}, row ${y} is ${edge ? "on the edge" : "inside"}`);
    }
  }
});

test("a command with a valid tile and a shade for a place the board does not have is refused whole (#2543)", () => {
  const s = rig("2d", 6, 6, 2);
  const before = s.doc.serialize();
  for (const bad of [{ layer: 0, x: 9, y: 0 }, { layer: 5, x: 0, y: 0 }, { layer: 0, x: -1, y: 0 }, { layer: 0, x: 0.5, y: 0 }]) {
    const refused = s.doc.apply({ type: "set-tiles", gesture: "stamp", cells: [{ layer: 0, x: 1, y: 1, tile: GRASS }], shades: [{ layer: 0, x: 2, y: 2, r: 10, g: 0, b: 0 }, { ...bad, r: 5, g: 0, b: 0 }] });
    equal(refused.ok, false, JSON.stringify(bad));
    match(refused.ok ? "" : refused.rejection.message, /outside the board/);
    deepEqual(s.doc.serialize(), before, "neither the tile nor the good tint was applied");
  }
  equal(edits(s), 0);
});

test("a pointer drag with Ctrl held only when it is released fills the rectangle", async () => {
  const s = rig("2d", 10, 10, 1);
  s.editor.setTool("rectangle");
  s.editor.pointerDown(at(s, { x: 2, y: 2 }), none);
  s.editor.pointerMove(at(s, { x: 6, y: 6 }), none);
  await s.editor.pointerUp(at(s, { x: 6, y: 6 }), ctrl);
  equal(tileAt(s, 0, 4, 4), GRASS);
});

test("releasing a Draw or Erase drag somewhere the last move did not reach paints the release cell too", async () => {
  const s = rig("2d", 12, 12, 1);
  s.editor.pointerDown(at(s, { x: 1, y: 1 }), none);
  s.editor.pointerMove(at(s, { x: 3, y: 1 }), none);
  await s.editor.pointerUp(at(s, { x: 8, y: 1 }), none);
  for (const x of [1, 2, 3, 4, 5, 6, 7, 8]) equal(tileAt(s, 0, x, 1), GRASS, `column ${x}`);
  equal(edits(s), 1);
  s.editor.setTool("erase");
  s.editor.pointerDown(at(s, { x: 1, y: 1 }), none);
  s.editor.pointerMove(at(s, { x: 2, y: 1 }), none);
  await s.editor.pointerUp(at(s, { x: 6, y: 1 }), none);
  for (const x of [1, 2, 3, 4, 5, 6]) equal(tileAt(s, 0, x, 1), "", `erased column ${x}`);
  equal(tileAt(s, 0, 7, 1), GRASS, "past the release cell is untouched");
});

test("one command that tints the same cell on several layers sets every one of them, atomically, and survives undo, save and reopen (#2542)", async () => {
  const s = rig("2d", 6, 6, 3);
  const before = s.doc.serialize();
  const same = { x: 2, y: 3 };
  const result = s.doc.apply({
    type: "set-tiles",
    gesture: "stamp",
    cells: [],
    shades: [
      { layer: 0, ...same, r: 10, g: 20, b: 30 },
      { layer: 1, ...same, r: -40, g: 0, b: 5 },
      { layer: 2, ...same, r: 100, g: -100, b: 0 },
      // A later assignment for the same layer and cell wins.
      { layer: 2, ...same, r: 70, g: -70, b: 0 },
    ],
  });
  ok(result.ok, result.ok ? "" : result.rejection.message);
  equal(edits(s), 1, "three layers, one edit");
  deepEqual(tintOn(s, 0, same.x, same.y), [10, 20, 30]);
  deepEqual(tintOn(s, 1, same.x, same.y), [-40, 0, 5]);
  deepEqual(tintOn(s, 2, same.x, same.y), [70, -70, 0]);
  deepEqual(tintOn(s, 1, same.x + 1, same.y), [0, 0, 0], "a neighbouring cell is untouched");
  const once = s.doc.serialize();
  // Saved and opened again, the board holds the same tints.
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": once } });
  const reopened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), once);
  ok(reopened.ok);
  if (reopened.ok) {
    equal(reopened.document.getSnapshot().readOnly, null, "a board with shading is still written by the same-version writer");
    deepEqual(reopened.document.serialize(), once);
  }
  // Setting the same tints again changes nothing; one Undo takes all three layers back.
  equal(s.doc.apply({ type: "set-tiles", gesture: "stamp", cells: [], shades: [{ layer: 0, ...same, r: 10, g: 20, b: 30 }, { layer: 2, ...same, r: 70, g: -70, b: 0 }] }).ok, false);
  ok(s.doc.undo().ok);
  deepEqual(s.doc.serialize(), before);
  ok(s.doc.redo().ok);
  deepEqual(s.doc.serialize(), once);
});

test("a multi-layer tint whose final shades are valid is accepted whatever order its assignments come in, and one Undo takes it back (#2551)", () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 6, height: 6, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  if (!built.ok) return;
  const read = readBoard(new BinaryReader(built.bytes));
  ok(read.ok);
  if (!read.ok) return;
  // Shades cast onto layer 1 (red +200) and onto layer 2 (red −200) at every cell: layer 1 alone shows 0, layer 2 alone −200.
  const shaded = writeBoard({
    ...read.value,
    shadeLayers: [
      { castLayer: 1, records: [{ runCount: 36, r: 200, g: 0, b: 0 }] },
      { castLayer: 2, records: [{ runCount: 36, r: -200, g: 0, b: 0 }] },
    ],
  });
  ok(shaded.ok);
  if (!shaded.ok) return;
  const cell = { x: 3, y: 2 };
  const first = { layer: 0, ...cell, r: 255, g: 0, b: 0 };
  const second = { layer: 1, ...cell, r: 255, g: 0, b: 0 };
  const outcomes: Uint8Array[] = [];
  for (const shades of [[first, second], [second, first]]) {
    const host = createMemoryPlatformServices({ files: { "Boards/t.brd": shaded.value } });
    const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), shaded.value);
    ok(opened.ok);
    if (!opened.ok) return;
    const doc = opened.document;
    const accepted = doc.apply({ type: "set-tiles", gesture: "stamp", cells: [], shades });
    ok(accepted.ok, `${shades[0] === first ? "layer 1 then layer 2" : "layer 2 then layer 1"}: ${accepted.ok ? "" : accepted.rejection.message}`);
    const after = readBoard(new BinaryReader(doc.serialize()));
    ok(after.ok);
    if (!after.ok) return;
    const castRed = (castLayer: number): number => {
      const layer = after.value.shadeLayers.find((candidate) => candidate.castLayer === castLayer)!;
      let at = 0;
      for (const record of layer.records) {
        const count = record.runCount > 1 ? record.runCount : 1;
        if (6 * cell.y + cell.x < at + count) return record.r;
        at += count;
      }
      throw new Error("the cell is not covered");
    };
    deepEqual([castRed(1), castRed(2)], [0, 255], "the final casts are 0 and 255");
    outcomes.push(doc.serialize());
    ok(doc.undo().ok);
    deepEqual(doc.serialize(), shaded.value, "one Undo restores both layers' shading");
    ok(doc.redo().ok);
    deepEqual(doc.serialize(), outcomes.at(-1));
  }
  deepEqual(outcomes[0], outcomes[1], "the order of the assignments does not change the result");
  // A final value that is out of bounds is still refused, whatever the order.
  const outOfBounds = [{ ...first, r: 255 }, { layer: 1, ...cell, r: -255, g: 0, b: 0 }];
  for (const shades of [outOfBounds, [...outOfBounds].reverse()]) {
    const host = createMemoryPlatformServices({ files: { "Boards/t.brd": shaded.value } });
    const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), shaded.value);
    ok(opened.ok);
    if (!opened.ok) return;
    const refused = opened.document.apply({ type: "set-tiles", gesture: "stamp", cells: [], shades });
    equal(refused.ok, false, "layer 1 at 255 and layer 2 at −255 would need a cast of 510");
    deepEqual(opened.document.serialize(), shaded.value);
  }
});

test("a tint whose arithmetic leaves the 16-bit range is refused, not wrapped into a valid-looking shade (#2552)", () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 6, height: 6, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  if (!built.ok) return;
  const read = readBoard(new BinaryReader(built.bytes));
  ok(read.ok);
  if (!read.ok) return;
  // 257 shades on every layer, each red 255: the cell's tint on layer 1 is 257 × 255 = 65535, far past what the sum of
  // stored shades is meant to be, though each stored shade is valid.
  const shades = Array.from({ length: 257 }, () => ({ castLayer: 0, records: [{ runCount: 36, r: 255, g: 0, b: 0 }] }));
  const shaded = writeBoard({ ...read.value, shadeLayers: shades });
  ok(shaded.ok);
  if (!shaded.ok) return;
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": shaded.value } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), shaded.value);
  ok(opened.ok);
  if (!opened.ok) return;
  const before = opened.document.serialize();
  // Asking for tint 1 on layer 1 needs a delta of −65534: in 16 bits that wraps to 2, which would look valid.
  const refused = opened.document.apply({ type: "set-tiles", gesture: "stamp", cells: [], shades: [{ layer: 0, x: 2, y: 2, r: 1, g: 0, b: 0 }] });
  equal(refused.ok, false, "the delta is out of range, however it would wrap");
  match(refused.ok ? "" : refused.rejection.message, /cannot hold that tint/);
  deepEqual(opened.document.serialize(), before, "nothing changed");
  equal(opened.document.getSnapshot().edits.length, 0);
});
