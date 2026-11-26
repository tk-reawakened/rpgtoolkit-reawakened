// Neighbour-aware autotiling (story 8, T-25) over the real board document and editor. Expected tile numbers are read by
// hand from the 52-slot table in docs/spec/editor/autotiling.md#1-2, never computed by the code under test.
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  LEGACY_AUTOTILE_SLOTS,
  autotileSource,
  autotileSourceForSelection,
  boardExtent,
  boardToScreen,
  boardTileAt,
  buildNewBoard,
  cellCentre,
  createBoardDocument,
  createBoardEditor,
  createDocumentIdentity,
  DEFAULT_EDITOR_PREFERENCES,
  legacyAutotileGaps,
  legacyAutotileShape,
  paintAutotileStroke,
  pixelToCell,
  type BoardCoordSystem,
  type BoardDocument,
  type BoardEditor,
  floodFill,
  type Brush,
  type Cell,
  type EditorPreferences,
  type Modifiers,
} from "../src/index.ts";

const WATER = "Tiles\\AUTOTILES_Water.tst";
const water = (slot: number): string => `${WATER}${slot}`;
const GROUND = "Tiles\\Grass.tst1";

interface Rig {
  readonly doc: BoardDocument;
  readonly editor: BoardEditor;
  brush: Brush | null;
  autotile: boolean;
  prefs: EditorPreferences;
}

function rig(coordSystem: BoardCoordSystem, width = 8, height = 8): Rig {
  const built = buildNewBoard({ name: "t", coordSystem, pixelCoordinates: false, width, height, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const state = { doc: opened.document, brush: { kind: "tile", tile: water(14), label: "water" } as Brush | null, autotile: true, prefs: DEFAULT_EDITOR_PREFERENCES };
  const editor = createBoardEditor({
    board: () => state.doc.getSnapshot(),
    apply: (command) => state.doc.apply(command),
    brush: () => state.brush,
    pickTile: () => true,
    preferences: () => state.prefs,
    autotileEnabled: () => state.autotile,
  });
  return Object.assign(state, { editor });
}

const none: Modifiers = {};
const at = (s: Rig, cell: Cell): { x: number; y: number } => {
  const centre = cellCentre(s.doc.getSnapshot(), cell.x, cell.y);
  return boardToScreen(s.editor.getState().viewport, centre.x, centre.y);
};
async function click(s: Rig, cell: Cell, modifiers: Modifiers = none): Promise<void> {
  s.editor.pointerDown(at(s, cell), modifiers);
  await s.editor.pointerUp(at(s, cell), modifiers);
}
const tile = (s: Rig, x: number, y: number, layer = 0): string => boardTileAt(s.doc.getSnapshot(), layer, x, y) ?? "";
const edits = (s: Rig): number => s.doc.getSnapshot().edits.length;
const centreOf = (s: Rig): Cell => {
  const extent = boardExtent(s.doc.getSnapshot());
  const cell = pixelToCell(s.doc.getSnapshot(), extent.width / 2, extent.height / 2);
  if (cell === null) throw new Error("no middle cell");
  return cell;
};

test("legacy slots, name recognition in any case and folder, and explicit marks follow the compatibility table", () => {
  deepEqual(LEGACY_AUTOTILE_SLOTS, [
    1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25,
    26, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52,
  ]);
  equal(autotileSource("AUTOTILES_water.tst1"), "AUTOTILES_water.tst");
  equal(autotileSource("autotiles_Water.iso52"), "autotiles_Water.iso");
  equal(autotileSource("terrain\\AUTOTILES_water.tst52"), "terrain\\AUTOTILES_water.tst");
  equal(autotileSource("terrain/AUTOTILES_water.tst3"), "terrain\\AUTOTILES_water.tst");
  equal(autotileSource("AUTOTILES_folder\\ordinary.tst1"), null, "only the file name counts, not a folder");
  equal(autotileSource("terrain\\ordinary.tst1"), null);
  equal(autotileSource("terrain\\AUTOTILES_water.tan"), null);
  equal(autotileSourceForSelection({ reference: "terrain\\ordinary.tst1", autotile: "legacy-52" }), "terrain\\ordinary.tst");
  equal(autotileSourceForSelection({ reference: "terrain\\ordinary.tan", autotile: "legacy-52" }), null);
  equal(autotileSourceForSelection({ reference: "terrain\\ordinary.tst1" }), null);
});

test("a set shorter than 52 tiles names the shapes it cannot draw, and unused slots are never named", () => {
  deepEqual(legacyAutotileGaps(52), []);
  deepEqual(legacyAutotileGaps(47), [48, 49, 50, 51, 52]);
  deepEqual(legacyAutotileGaps(9), [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 34, 35, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52]);
  equal(legacyAutotileShape(51), "isolated");
  equal(legacyAutotileShape(52), "N E S W + corner NW NE SE SW");
  equal(legacyAutotileShape(14), "N E S W + corner NE");
  equal(legacyAutotileShape(48), "E");
  equal(legacyAutotileShape(9), null);
});

test("a click seeds the isolated tile whichever tile of the set was picked, and a neighbour closes onto it as one edit that undoes whole", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  await click(s, c);
  equal(tile(s, c.x, c.y), water(51));
  await click(s, { x: c.x + 1, y: c.y });
  equal(tile(s, c.x, c.y), water(48), "east link only");
  equal(tile(s, c.x + 1, c.y), water(50), "west link only");
  equal(edits(s), 2);
  ok(s.doc.undo().ok);
  equal(tile(s, c.x, c.y), water(51), "the neighbour reshaped by the click comes back with it");
  equal(tile(s, c.x + 1, c.y), "");
  ok(s.doc.redo().ok);
  equal(tile(s, c.x, c.y), water(48));
  equal(tile(s, c.x + 1, c.y), water(50));
});

test("a filled rectangle of 3 by 3 gives the hand-read shapes, corner rule included, as one edit", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  s.editor.setTool("rectangle");
  s.editor.pointerDown(at(s, { x: c.x - 1, y: c.y - 1 }), { ctrl: true });
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y + 1 }), { ctrl: true });
  equal(edits(s), 1);
  const read = (dx: number, dy: number): string => tile(s, c.x + dx, c.y + dy);
  equal(read(0, 0), water(52), "N S W E and every corner");
  equal(read(-1, -1), water(38), "S E and SE");
  equal(read(0, -1), water(22), "S W E and SW SE");
  equal(read(1, -1), water(40), "S W and SW");
  equal(read(-1, 0), water(17), "N S E and NE SE");
  equal(read(1, 0), water(26), "N S W and NW SW");
  equal(read(-1, 1), water(44), "N E and NE");
  equal(read(0, 1), water(31), "N W E and NW NE");
  equal(read(1, 1), water(42), "N W and NW");
  ok(s.doc.undo().ok);
  equal(read(0, 0), "");
});

test("a plus has no corner links, and a missing corner beside two linked sides gives the inner-corner shape", async () => {
  const plus = rig("2d");
  const c = centreOf(plus);
  for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) await click(plus, { x: c.x + dx, y: c.y + dy });
  equal(tile(plus, c.x, c.y), water(16));
  equal(tile(plus, c.x, c.y - 1), water(47), "S only");
  const inner = rig("2d");
  const d = centreOf(inner);
  for (const [dx, dy] of [[-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [0, -1], [-1, -1]] as const) await click(inner, { x: d.x + dx, y: d.y + dy });
  equal(tile(inner, d.x, d.y), water(2), "N S W E with NE missing: NW SW SE");
  const corner = rig("2d");
  const e = centreOf(corner);
  await click(corner, e);
  await click(corner, { x: e.x + 1, y: e.y + 1 });
  equal(tile(corner, e.x, e.y), water(51), "corner contact alone never connects");
  equal(tile(corner, e.x + 1, e.y + 1), water(51));
});

test("the board edge never connects", async () => {
  const s = rig("2d");
  s.editor.setTool("rectangle");
  s.editor.pointerDown(at(s, { x: 0, y: 0 }), { ctrl: true });
  await s.editor.pointerUp(at(s, { x: 1, y: 1 }), { ctrl: true });
  equal(tile(s, 0, 0), water(38), "S E and SE, nothing beyond the corner");
  equal(tile(s, 1, 0), water(40));
  equal(tile(s, 0, 1), water(44));
  equal(tile(s, 1, 1), water(42));
});

test("erasing closes the surrounding tiles around the hole, and Shift leaves them as they were", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  for (const dx of [-1, 0, 1]) await click(s, { x: c.x + dx, y: c.y });
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), [water(48), water(37), water(50)]);
  s.editor.setTool("erase");
  await click(s, c);
  equal(tile(s, c.x, c.y), "");
  equal(tile(s, c.x - 1, c.y), water(51));
  equal(tile(s, c.x + 1, c.y), water(51));
  ok(s.doc.undo().ok);
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), [water(48), water(37), water(50)]);
  await click(s, c, { shift: true });
  equal(tile(s, c.x, c.y), "");
  equal(tile(s, c.x - 1, c.y), water(48), "Shift erase reshapes nothing, as the original did");
});

test("ordinary paint reshapes nearby autotiles; Shift paints one set without disturbing another; layers stay apart", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  await click(s, { x: c.x - 1, y: c.y });
  await click(s, c);
  equal(tile(s, c.x, c.y), water(50));
  s.brush = { kind: "tile", tile: GROUND, label: "ground" };
  await click(s, { x: c.x - 1, y: c.y });
  equal(tile(s, c.x - 1, c.y), GROUND, "an ordinary tile is placed as picked");
  equal(tile(s, c.x, c.y), water(51), "its autotile neighbour lost the link");
  s.brush = { kind: "tile", tile: "Tiles\\AUTOTILES_Sand.tst1", label: "sand" };
  await click(s, { x: c.x, y: c.y - 1 });
  equal(tile(s, c.x, c.y), water(51), "a different set never links");
  equal(tile(s, c.x, c.y - 1), "Tiles\\AUTOTILES_Sand.tst51");
  // A sand tile placed while autotiling was off keeps a stale shape until an edit nearby reshapes it.
  s.autotile = false;
  s.brush = { kind: "tile", tile: "Tiles\\AUTOTILES_Sand.tst14", label: "sand" };
  await click(s, { x: c.x + 2, y: c.y - 1 });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(4), label: "water" };
  await click(s, { x: c.x + 1, y: c.y }, { shift: true });
  equal(tile(s, c.x, c.y), water(48), "Shift reshapes the painted set");
  equal(tile(s, c.x + 2, c.y - 1), "Tiles\\AUTOTILES_Sand.tst14", "and leaves the other set's stale tile alone");
  await click(s, { x: c.x + 1, y: c.y - 1 });
  equal(tile(s, c.x + 2, c.y - 1), "Tiles\\AUTOTILES_Sand.tst51", "without Shift the same edit reshapes it");
  s.editor.setLayer(1);
  await click(s, { x: c.x, y: c.y + 1 });
  equal(tile(s, c.x, c.y), water(48), "a tile on another layer never connects or changes");
  equal(tile(s, c.x, c.y + 1, 1), water(51));
});

test("autotiling off places tiles exactly as stored, and switching it on reshapes only around the next edit", async () => {
  const s = rig("2d");
  s.autotile = false;
  const c = centreOf(s);
  await click(s, c);
  equal(tile(s, c.x, c.y), water(14));
  s.autotile = true;
  await click(s, { x: c.x + 1, y: c.y });
  equal(tile(s, c.x, c.y), water(48), "turning it on reshapes only near the next edit");
});

test("Fill works in autotile mode: every filled cell gets its shape and one Undo restores the layer", async () => {
  const s = rig("2d", 5, 4);
  s.editor.setTool("flood");
  await click(s, { x: 2, y: 2 });
  equal(edits(s), 1);
  equal(tile(s, 0, 0), water(38));
  equal(tile(s, 4, 3), water(42));
  equal(tile(s, 2, 2), water(52));
  equal(tile(s, 2, 0), water(22));
  equal(tile(s, 0, 2), water(17));
  ok(s.doc.undo().ok);
  equal(tile(s, 2, 2), "");
});

test("on a stacked isometric board the four diamond sides are the cardinal links and straight up or down is only a corner", async () => {
  const s = rig("iso-stacked", 8, 10);
  await click(s, { x: 3, y: 2 });
  await click(s, { x: 4, y: 3 });
  // Stored row 2 is an odd row of the spec: E is (x+1, y+1). Row 3 is even: W is (x-1, y-1).
  equal(tile(s, 3, 2), water(48), "E only");
  equal(tile(s, 4, 3), water(50), "W only");
  await click(s, { x: 3, y: 0 });
  equal(tile(s, 3, 0), water(51), "straight up touches only at a point, so nothing links");
  equal(tile(s, 3, 2), water(48));
});

test("on a stacked isometric board an edit reaches two rows up and down, where a corner link can change", async () => {
  const s = rig("iso-stacked", 8, 10);
  for (const cell of [{ x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 }]) await click(s, cell);
  // (3,4): N is (4,3), W is (3,3) and its straight-up corner NW is (3,2): N W and NW, tile 42.
  equal(tile(s, 3, 4), water(42));
  s.editor.setTool("erase");
  await click(s, { x: 3, y: 2 });
  equal(tile(s, 3, 4), water(43), "the corner went with the erased cell, two rows away");
  ok(s.doc.undo().ok);
  equal(tile(s, 3, 4), water(42));
});

test("an explicitly marked set uses the legacy order under any name, and a stroke is order independent", () => {
  const s = rig("2d");
  const c = centreOf(s);
  const marked = "Tiles\\grass.tst";
  const forward = paintAutotileStroke(s.doc.getSnapshot(), 0, [{ x: c.x, y: c.y }, { x: c.x + 1, y: c.y }], `${marked}7`, true, false, marked);
  const backward = paintAutotileStroke(s.doc.getSnapshot(), 0, [{ x: c.x + 1, y: c.y }, { x: c.x, y: c.y }], `${marked}7`, true, false, marked);
  deepEqual(forward, [{ layer: 0, x: c.x, y: c.y, tile: `${marked}48` }, { layer: 0, x: c.x + 1, y: c.y, tile: `${marked}50` }]);
  deepEqual(backward, forward);
  deepEqual(paintAutotileStroke(s.doc.getSnapshot(), 0, [c], `${marked}7`, true), [{ layer: 0, x: c.x, y: c.y, tile: `${marked}7` }], "unmarked, the name is ordinary");
});

test("painting the spec example's water cell by cell, in any order, gives exactly the committed Marsh board", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/editor/examples/autotiling/Boards/Marsh.brd", import.meta.url)));
  const host = createMemoryPlatformServices({ files: { "Boards/Marsh.brd": bytes } });
  const marsh = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/Marsh.brd"), bytes);
  if (!marsh.ok) throw new Error(JSON.stringify(marsh.error));
  const example = marsh.document.getSnapshot();
  const { width, height } = example.grid;
  const water: Cell[] = [];
  const slots = new Set<number>();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const ref = boardTileAt(example, 1, x, y) ?? "";
    if (ref !== "") { water.push({ x, y }); slots.add(Number(/(\d+)$/.exec(ref)![1])); }
  }
  deepEqual([...slots].sort((a, b) => a - b), [...LEGACY_AUTOTILE_SLOTS], "the example uses all 47 shapes");
  const shuffled = water.map((cell, index) => ({ cell, key: (index * 7919) % 101 })).sort((a, b) => a.key - b.key).map(({ cell }) => cell);
  for (const order of [water, [...water].reverse(), shuffled]) {
    const built = buildNewBoard({ name: "m", coordSystem: "2d", pixelCoordinates: false, width, height, layers: 2, backgroundImage: "", template: null });
    if (!built.ok) throw new Error(built.message);
    const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/m.brd"), built.bytes);
    if (!opened.ok) throw new Error(JSON.stringify(opened.error));
    for (const cell of order) {
      const cells = paintAutotileStroke(opened.document.getSnapshot(), 1, [cell], "AUTOTILES_Water.tst1", true);
      ok(opened.document.apply({ type: "set-tiles", gesture: "draw", cells }).ok);
    }
    const painted = opened.document.getSnapshot();
    for (const { x, y } of water) equal(boardTileAt(painted, 1, x, y), boardTileAt(example, 1, x, y), `cell ${x},${y}`);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (!water.some((cell) => cell.x === x && cell.y === y)) equal(boardTileAt(painted, 1, x, y), "", `no stray tile at ${x},${y}`);
    }
  }
});

test("a drag is one edit however many cells it crosses and reshapes, and cells of other sets or ordinary tiles beside it are kept", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  s.brush = { kind: "tile", tile: GROUND, label: "ground" };
  s.editor.setTool("draw");
  await click(s, { x: c.x, y: c.y + 1 });
  s.brush = { kind: "tile", tile: "Tiles\\AUTOTILES_Sand.tst1", label: "sand" };
  await click(s, { x: c.x + 2, y: c.y + 1 });
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  const before = edits(s);
  s.editor.pointerDown(at(s, { x: c.x - 1, y: c.y }), none);
  s.editor.pointerMove(at(s, c), none);
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), none);
  equal(edits(s), before + 1, "the whole stroke and every reshaped neighbour is one undo step");
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), [water(48), water(37), water(50)]);
  equal(tile(s, c.x, c.y + 1), GROUND, "an ordinary neighbour is untouched");
  equal(tile(s, c.x + 2, c.y + 1), "Tiles\\AUTOTILES_Sand.tst51", "another set's cell is untouched");
  ok(s.doc.undo().ok);
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), ["", "", ""]);
  equal(tile(s, c.x, c.y + 1), GROUND);
});

test("two different sets never connect, even when one of them is marked for the legacy order", () => {
  const s = rig("2d");
  const c = centreOf(s);
  const marked = "Tiles\\grass.tst";
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  ok(s.doc.apply({ type: "set-tiles", gesture: "draw", cells: paintAutotileStroke(s.doc.getSnapshot(), 0, [c], `${sand}14`, true) }).ok);
  equal(tile(s, c.x, c.y), `${sand}51`);
  // The marked stroke reaches into the sand cell's neighbourhood; a mark says which cells take part, not that they link.
  const next = paintAutotileStroke(s.doc.getSnapshot(), 0, [{ x: c.x + 1, y: c.y }], `${marked}7`, true, false, marked);
  ok(s.doc.apply({ type: "set-tiles", gesture: "draw", cells: next }).ok);
  equal(tile(s, c.x + 1, c.y), `${marked}51`);
  equal(tile(s, c.x, c.y), `${sand}51`, "the sand cell keeps its isolated shape: it is a different set");
});

test("a drag holds Shift per cell: only the cells crossed with it reshape one set", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  // A stale sand tile, placed while autotiling was off, beside the cell the drag crosses with Shift.
  s.autotile = false;
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: c.x, y: c.y });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  // Down without Shift, crossed with Shift, released without it: the crossed cell keeps the Shift it was crossed with.
  s.editor.pointerDown(at(s, { x: c.x + 2, y: c.y }), none);
  s.editor.pointerMove(at(s, { x: c.x + 1, y: c.y }), { shift: true });
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), none);
  equal(tile(s, c.x + 1, c.y), water(48), "the crossed cell was painted");
  equal(tile(s, c.x, c.y), `${sand}14`, "a cell crossed with Shift leaves the other set's stale tile alone");
});

test("keyboard activation carries its Shift: a keyed autotile placement reshapes only its own set", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  s.autotile = false;
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: c.x, y: c.y });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  s.editor.setCursor({ x: c.x + 1, y: c.y });
  await s.editor.activate({ shift: true });
  equal(tile(s, c.x + 1, c.y), water(51));
  equal(tile(s, c.x, c.y), `${sand}14`, "the keyboard's Shift reached the autotiler");
  await s.editor.setCursor({ x: c.x + 1, y: c.y + 1 });
  await s.editor.activate({});
  equal(tile(s, c.x, c.y), `${sand}51`, "without Shift the same placement reshapes it");
});

test("a rectangle or fill over cells that already show the brush still reshapes the neighbourhood", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  // Three stale water tiles in a row, all in slot 51 — the slot the tested rectangle also paints, placed with autotiling off.
  s.autotile = false;
  s.brush = { kind: "tile", tile: water(51), label: "water" };
  s.editor.setTool("rectangle");
  s.editor.pointerDown(at(s, { x: c.x - 1, y: c.y }), { ctrl: true });
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), { ctrl: true });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(51), label: "water" };
  // The same brush over the same cells: no cell changes tile *before* the reshape, and all three must still reshape.
  const before = edits(s);
  s.editor.pointerDown(at(s, { x: c.x - 1, y: c.y }), { ctrl: true });
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), { ctrl: true });
  equal(edits(s), before + 1);
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), [water(48), water(37), water(50)]);

  const f = rig("2d");
  const d = centreOf(f);
  f.autotile = false;
  f.brush = { kind: "tile", tile: water(51), label: "water" };
  f.editor.setTool("rectangle");
  f.editor.pointerDown(at(f, { x: d.x, y: d.y }), { ctrl: true });
  await f.editor.pointerUp(at(f, { x: d.x + 1, y: d.y }), { ctrl: true });
  f.autotile = true;
  f.editor.setTool("flood");
  await click(f, d);
  equal(tile(f, d.x, d.y), water(48), "a fill over cells that already show the brush reshapes them");
  equal(tile(f, d.x + 1, d.y), water(50));
});

test("a fill that continues on another layer paints it as stored and never reshapes its neighbours", async () => {
  const s = rig("2d");
  s.prefs = { ...DEFAULT_EDITOR_PREFERENCES, recursiveFlood: true };
  const c = centreOf(s);
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  s.autotile = false;
  s.brush = { kind: "tile", tile: water(51), label: "water" };
  s.editor.setTool("rectangle");
  s.editor.pointerDown(at(s, { x: c.x, y: c.y }), { ctrl: true });
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), { ctrl: true });
  s.brush = { kind: "tile", tile: water(51), label: "water" };
  s.editor.setLayer(1);
  await click(s, { x: c.x, y: c.y });
  await click(s, { x: c.x + 1, y: c.y });
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: c.x + 2, y: c.y });
  s.editor.setLayer(0);
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  s.editor.setTool("flood");
  await click(s, c);
  equal(tile(s, c.x, c.y), water(48), "the clicked layer reshapes");
  equal(tile(s, c.x + 1, c.y), water(50));
  equal(tile(s, c.x, c.y, 1), water(9), "the other layer is painted with the picked tile, as stored");
  equal(tile(s, c.x + 1, c.y, 1), water(9));
  equal(tile(s, c.x + 2, c.y, 1), `${sand}14`, "and its neighbours are not reshaped");
});

test("a right-button press on the tile canvas paints nothing: erase is the Erase tool, not a second gesture", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const before = edits(s);
  s.editor.pointerDown(at(s, c), {}, 2);
  s.editor.pointerMove(at(s, { x: c.x + 1, y: c.y }), {});
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), {});
  equal(edits(s), before);
  equal(s.editor.getState().pending, null);
  equal(tile(s, c.x, c.y), "");
});

test("Shift at release does not reach back over cells the stroke crossed without it", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  for (const dx of [-1, 0, 1]) await click(s, { x: c.x + dx, y: c.y });
  deepEqual([-1, 0, 1].map((dx) => tile(s, c.x + dx, c.y)), [water(48), water(37), water(50)]);
  s.editor.setTool("erase");
  // Crossed without Shift, released with it: both visits are unshifted, so the row closes instead of going stale.
  s.editor.pointerDown(at(s, { x: c.x, y: c.y }), none);
  s.editor.pointerMove(at(s, { x: c.x + 1, y: c.y }), none);
  await s.editor.pointerUp(at(s, { x: c.x + 1, y: c.y }), { shift: true });
  equal(tile(s, c.x, c.y), "");
  equal(tile(s, c.x + 1, c.y), "");
  equal(tile(s, c.x - 1, c.y), water(51), "the neighbour closed its edge");
});

test("a revisit reshapes with the modifier of that visit, not with the one the cell was first crossed with", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  s.autotile = false;
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: c.x, y: c.y + 1 });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  // Out with Shift (the other set is left alone), back without it (the revisited cell reshapes everything).
  s.editor.pointerDown(at(s, { x: c.x, y: c.y }), { shift: true });
  s.editor.pointerMove(at(s, { x: c.x + 2, y: c.y }), { shift: true });
  equal(tile(s, c.x, c.y + 1), `${sand}14`);
  s.editor.pointerMove(at(s, { x: c.x, y: c.y }), none);
  await s.editor.pointerUp(at(s, { x: c.x, y: c.y }), none);
  equal(tile(s, c.x, c.y + 1), `${sand}51`, "the unshifted revisit reshaped it");
});

test("ordinary Fill keeps its early exit: a uniform region that already holds the tile is no edit at all", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  s.autotile = false;
  s.brush = { kind: "tile", tile: water(51), label: "water" };
  await click(s, c);
  const before = edits(s);
  s.editor.setTool("flood");
  await click(s, c);
  equal(edits(s), before, "no command is submitted");
  equal(s.editor.getState().pending, null);
  equal(s.editor.getState().message?.kind, "info", "the same info the original path gave: nothing changed");
  // The tool itself answers with nothing before the editor looks at layers, as it always did.
  deepEqual(floodFill(s.doc.getSnapshot(), 0, c, water(51), true), { ok: true, cells: [] });
});

test("a stroke that re-enters the board keeps the first cell it comes back onto, with the Shift of that visit", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  const top = { x: c.x, y: 0 };
  const other = { x: Math.min(c.x + 3, 7), y: 0 };
  // A stale sand tile beside the re-entry cell, placed while autotiling was off.
  s.autotile = false;
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: other.x, y: 1 });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  const board = s.doc.getSnapshot();
  const above = (cell: Cell): { x: number; y: number } => {
    const centre = cellCentre(board, cell.x, cell.y);
    return boardToScreen(s.editor.getState().viewport, centre.x, -48);
  };
  // Out through the top edge and back in somewhere else: the cell it comes back onto is a visit of its own.
  s.editor.pointerDown(at(s, top), none);
  s.editor.pointerMove(above(top), none);
  s.editor.pointerMove(above(other), none);
  s.editor.pointerMove(at(s, other), { shift: true });
  await s.editor.pointerUp(at(s, other), none);
  equal(tile(s, other.x, other.y), water(51), "the re-entry cell was painted");
  equal(tile(s, other.x, 1), `${sand}14`, "with the Shift it was entered with, so the other set was left alone");
});

test("a stationary release re-entering the board revisits a cell from before the exit", async () => {
  const s = rig("2d");
  const c = centreOf(s);
  const top = { x: c.x, y: 0 };
  const sand = "Tiles\\AUTOTILES_Sand.tst";
  s.autotile = false;
  s.brush = { kind: "tile", tile: `${sand}14`, label: "sand" };
  await click(s, { x: top.x, y: 1 });
  s.autotile = true;
  s.brush = { kind: "tile", tile: water(9), label: "water" };
  s.editor.pointerDown(at(s, top), { shift: true });
  s.editor.pointerMove(boardToScreen(s.editor.getState().viewport, cellCentre(s.doc.getSnapshot(), top.x, top.y).x, -48), { shift: true });
  // No move event after re-entry: only pointerUp tells the editor the stroke returned to this cell.
  await s.editor.pointerUp(at(s, top), none);
  equal(tile(s, top.x, top.y), water(51));
  equal(tile(s, top.x, 1), `${sand}51`, "the unshifted release revisit reshaped the adjacent set");
});

test("ordinary Fill over a region that already holds the tile answers before walking it", () => {
  const s = rig("2d");
  const c = centreOf(s);
  const snapshot = s.doc.getSnapshot();
  let reads = 0;
  const counted = { ...snapshot, tileMatrix: new Proxy(snapshot.tileMatrix, { get(target, key) {
    if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
    return Reflect.get(target, key);
  } }) };
  // Every cell of both layers is empty, so a walk would read all 128; the early exit reads only the clicked cell.
  deepEqual(floodFill(counted, 0, c, "", true), { ok: true, cells: [] });
  ok(reads <= 1, `the clicked cell alone was read (read ${reads})`);
  reads = 0;
  const filled = floodFill(counted, 0, c, water(51), true);
  ok(filled.ok && filled.cells.length === 128, "a real fill covers both layers");
  ok(reads > 64, `a real fill does walk the region (read ${reads})`);
});
