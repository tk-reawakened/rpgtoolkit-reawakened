// The board clipboard of story 13.13 (T-28) over the real board document and the in-memory platform clipboard: regions of
// tiles and shading and whole vectors, programs, sprites and images copy, cut and paste as single edits that undo, redo
// and survive a reload, while partial point sets and lights are refused without changing the board or the clipboard.
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import type { PlatformError } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  BOARD_CLIPBOARD_FORMAT,
  BOARD_CLIPBOARD_VERSION,
  boardCodec,
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
  parseClip,
  pixelToCell,
  shadeAt,
  type BoardCoordSystem,
  type BoardDocument,
  type BoardEditor,
  type BoardObjectKind,
  type Cell,
} from "../src/index.ts";
import { defaultBoardObject } from "../src/board-object-tools.ts";

const GRASS = "village.tst1";
const ROCK = "village.tst2";

function rig(coordSystem: BoardCoordSystem = "2d", withClipboard = true, layers = 2) {
  const built = buildNewBoard({ name: "t", coordSystem, pixelCoordinates: false, width: 8, height: 8, layers, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes }, capabilities: ["clipboard"] });
  const identity = createDocumentIdentity("memory-project", "Boards/t.brd");
  const opened = createBoardDocument(host.fs, identity, built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const board = doc.getSnapshot();
  const extent = boardExtent(board);
  const centre = pixelToCell(board, extent.width / 2, extent.height / 2);
  if (centre === null) throw new Error("the board has no cell in its middle");
  const state = { lights: false, removals: [] as { family: BoardObjectKind; count: number }[], answer: true };
  const editor: BoardEditor = createBoardEditor({
    board: () => doc.getSnapshot(),
    apply: (command) => doc.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    ...(withClipboard ? { clipboard: host.clipboard! } : {}),
    lightsActive: () => state.lights,
  });
  const confirm = async (removal: { family: BoardObjectKind; count: number }): Promise<boolean> => { state.removals.push(removal); return state.answer; };
  const at = (cell: Cell) => { const c = cellCentre(doc.getSnapshot(), cell.x, cell.y); return boardToScreen(editor.getState().viewport, c.x, c.y); };
  const select = async (from: Cell, to: Cell): Promise<void> => {
    editor.setTool("select");
    editor.pointerDown(at(from), {});
    editor.pointerMove(at(to), {});
    await editor.pointerUp(at(to), {});
  };
  /** Reopen the document's saved bytes, as a reload would. */
  const reload = (): BoardDocument => {
    const bytes = doc.serialize();
    const again = createBoardDocument(host.fs, identity, bytes);
    if (!again.ok) throw new Error(JSON.stringify(again.error));
    return again.document;
  };
  return { doc, editor, host, centre, state, confirm, at, select, reload, bytes: built.bytes };
}

const near = (centre: Cell, dx: number, dy: number): Cell => ({ x: centre.x + dx, y: centre.y + dy });
const LAYOUTS: readonly [string, BoardCoordSystem][] = [["top-down", "2d"], ["iso-stacked", "iso-stacked"], ["iso-rotated", "iso-rotated"]];

for (const [name, system] of LAYOUTS) {
  test(`${name}: a copied region of tiles and shading pastes as one edit that undoes, redoes and reloads`, async () => {
    const s = rig(system);
    const a = near(s.centre, 0, 0);
    const b = near(s.centre, 1, 0);
    ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }, { layer: 0, ...b, tile: ROCK }] })).ok);
    ok((await s.doc.apply({ type: "set-shade-cells", cells: [{ ...a, r: 30, g: -40, b: 50 }] })).ok);
    await s.select(a, b);
    ok(await s.editor.copy());
    equal(s.editor.getState().message?.kind, "info");
    const parsed = parseClip(s.host.clipboardText);
    ok(parsed.ok);
    equal(parsed.value.kind, "region");
    const before = s.doc.getSnapshot().edits.length;
    const target = near(s.centre, 0, 2);
    s.editor.setCursor(target);
    ok(await s.editor.paste());
    const board = s.doc.getSnapshot();
    equal(board.edits.length, before + 1, "paste is one edit");
    equal(boardTileAt(board, 0, target.x, target.y), GRASS);
    equal(boardTileAt(board, 0, target.x + 1, target.y), ROCK);
    deepEqual(shadeAt(board, target), { r: 30, g: -40, b: 50 });
    deepEqual(shadeAt(board, { x: target.x + 1, y: target.y }), { r: 0, g: 0, b: 0 });
    equal(board.edits.at(-1)?.label.startsWith("Paste"), true);
    const saved = s.doc.serialize();
    const reloaded = s.reload().getSnapshot();
    equal(boardTileAt(reloaded, 0, target.x, target.y), GRASS);
    deepEqual(shadeAt(reloaded, target), { r: 30, g: -40, b: 50 });

    ok(s.doc.undo(board.edits.at(-1)!.editId).ok);
    equal(boardTileAt(s.doc.getSnapshot(), 0, target.x, target.y), "");
    deepEqual(shadeAt(s.doc.getSnapshot(), target), { r: 0, g: 0, b: 0 });
    ok(s.doc.redo().ok);
    deepEqual(s.doc.serialize(), saved, "redo puts the pasted bytes back");
  });

  test(`${name}: cut removes the region's tiles and shading in one edit and keeps them on the clipboard`, async () => {
    const s = rig(system);
    const a = near(s.centre, 0, 0);
    ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
    ok((await s.doc.apply({ type: "set-shade-cells", cells: [{ ...a, r: 9, g: 9, b: 9 }] })).ok);
    const before = s.doc.serialize();
    const edits = s.doc.getSnapshot().edits.length;
    await s.select(a, a);
    ok(await s.editor.cut(s.confirm));
    equal(s.state.removals.length, 0, "a region cut removes no stored slots, so it asks nothing");
    equal(s.doc.getSnapshot().edits.length, edits + 1);
    equal(boardTileAt(s.doc.getSnapshot(), 0, a.x, a.y), "");
    deepEqual(shadeAt(s.doc.getSnapshot(), a), { r: 0, g: 0, b: 0 });
    const clip = parseClip(s.host.clipboardText);
    ok(clip.ok && clip.value.kind === "region" && clip.value.tiles.includes(GRASS));
    ok(s.doc.undo(s.doc.getSnapshot().edits.at(-1)!.editId).ok);
    deepEqual(s.doc.serialize(), before, "undo restores the exact bytes");
    ok(s.doc.redo().ok);
    equal(boardTileAt(s.reload().getSnapshot(), 0, a.x, a.y), "", "the cut survives a reload");
  });

  test(`${name}: a region that does not fit at the cursor goes back where it was copied from`, async () => {
    const s = rig(system);
    const a = near(s.centre, 0, 0);
    ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
    await s.select(a, near(a, 1, 1));
    ok(await s.editor.copy());
    const board = s.doc.getSnapshot();
    let corner = a;
    for (let y = 0; y < board.grid.height; y += 1) for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, y) && x + y >= corner.x + corner.y) corner = { x, y };
    s.editor.setCursor(corner);
    s.editor.setLayer(1);
    equal(await s.editor.paste(), true, "the clip fits where it came from, so it is pasted there");
    match(s.editor.getState().message!.text, /did not fit at the cursor/);
    equal(boardTileAt(s.doc.getSnapshot(), 1, a.x, a.y), GRASS);
    deepEqual(s.editor.getState().selection?.rect, { x0: a.x, y0: a.y, x1: a.x + 1, y1: a.y + 1 });
  });
}

test("select all in Tiles mode copies the whole layer, which pastes at its own origin whatever the cursor is", async () => {
  const s = rig();
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 0, y: 0, tile: GRASS }, { layer: 0, x: 7, y: 7, tile: ROCK }] })).ok);
  s.editor.selectAll();
  ok(await s.editor.copy());
  s.editor.setLayer(1);
  s.editor.setCursor({ x: 0, y: 0 });
  ok(await s.editor.paste());
  equal(boardTileAt(s.doc.getSnapshot(), 1, 7, 7), ROCK, "whole-board paste with its corner on the origin fits and lands on the current layer");
  equal(boardTileAt(s.doc.getSnapshot(), 0, 7, 7), ROCK, "the source layer is unchanged");
  s.editor.setCursor({ x: 1, y: 1 });
  const bytes = s.doc.serialize();
  equal(await s.editor.paste(), false, "pasting the same grid twice changes nothing");
  deepEqual(s.doc.serialize(), bytes);
  deepEqual(s.editor.getState().selection?.rect, { x0: 0, y0: 0, x1: 7, y1: 7 }, "the whole grid is still the selection");
});

test("a board with more than one shading layer copies tiles only, says so, and refuses a shaded clip", async () => {
  const s = rig();
  ok((await s.doc.apply({ type: "set-board-fields", fields: { shadeLayers: [
    { castLayer: 1, records: [{ runCount: 64, r: 5, g: 5, b: 5 }] },
    { castLayer: 2, records: [{ runCount: 64, r: 1, g: 1, b: 1 }] },
  ] } })).ok);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 1, y: 1, tile: GRASS }] })).ok);
  s.editor.selectAll();
  ok(await s.editor.copy());
  match(s.editor.getState().message!.text, /more than one shading layer/);
  const clip = parseClip(s.host.clipboardText);
  ok(clip.ok && clip.value.kind === "region");
  equal(clip.value.shades, null);
  // A clip that does carry shade cannot be placed on this board.
  const other = rig();
  ok((await other.doc.apply({ type: "set-shade-cells", cells: [{ x: 0, y: 0, r: 4, g: 4, b: 4 }] })).ok);
  other.editor.selectAll();
  ok(await other.editor.copy());
  s.host.clipboardText = other.host.clipboardText;
  const bytes = s.doc.serialize();
  s.editor.setCursor({ x: 0, y: 0 });
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /more than one shading layer/);
  deepEqual(s.doc.serialize(), bytes);
});

function seedObjects(s: { readonly doc: BoardDocument }) {
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }];
  const board = s.doc.getSnapshot();
  const fields = {
    vectors: [...board.vectors, { ...defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), handle: "v0", attributes: 77 }, { ...defaultBoardObject("vectors", 2, { x: 0, y: 0 }, points), handle: "v1", attributes: 5 }, { ...defaultBoardObject("vectors", 1, { x: 64, y: 0 }, points), handle: "v2", attributes: 6 }],
    programs: [...board.programs, { ...defaultBoardObject("programs", 1, { x: 32, y: 32 }, points), program: "go.prg", handle: "p0", repeatDistance: 3 }],
    sprites: [...board.sprites, { ...defaultBoardObject("sprites", 1, { x: 64, y: 64 }, []), itemFile: "npc.itm", reserved: -7 }],
    images: [...board.images, { ...defaultBoardObject("images", 1, { x: 16, y: 16 }, []), file: "tree.png", reserved: 42 }],
  };
  return s.doc.apply({ type: "set-board-fields", fields });
}

const FAMILIES: readonly BoardObjectKind[] = ["vectors", "programs", "sprites", "images"];

for (const family of FAMILIES) {
  test(`${family}: select all, copy and paste whole objects as one edit with every stored field, undo, redo and reload`, async () => {
    const s = rig();
    ok((await seedObjects(s)).ok);
    s.editor.setMode(family);
    s.editor.selectAll();
    const originals = s.doc.getSnapshot()[family].filter((object) => object.layer === 1);
    equal(s.editor.getState().objectGroup.length > 0 || originals.length === 1, true);
    ok(await s.editor.copy());
    const edits = s.doc.getSnapshot().edits.length;
    const count = s.doc.getSnapshot()[family].length;
    ok(await s.editor.paste());
    const board = s.doc.getSnapshot();
    equal(board.edits.length, edits + 1, "paste is one edit");
    equal(board[family].length, count + originals.length);
    deepEqual(board[family].slice(count), originals, "the pasted objects are the copied ones, field for field");
    equal(s.editor.getState().objectSelection?.index, count);
    const saved = s.doc.serialize();
    deepEqual(s.reload().getSnapshot()[family].slice(count), originals, "the paste survives a reload");
    ok(s.doc.undo(board.edits.at(-1)!.editId).ok);
    equal(s.doc.getSnapshot()[family].length, count);
    ok(s.doc.redo().ok);
    deepEqual(s.doc.serialize(), saved);
  });

  test(`${family}: cut asks first, removes the objects in one edit, and a refusal changes nothing`, async () => {
    const s = rig();
    ok((await seedObjects(s)).ok);
    s.editor.setMode(family);
    s.editor.selectAll();
    const before = s.doc.serialize();
    const edits = s.doc.getSnapshot().edits.length;
    s.host.clipboardText = "untouched";
    s.state.answer = false;
    equal(await s.editor.cut(s.confirm), false);
    equal(s.state.removals.length, 1);
    equal(s.state.removals[0]!.family, family);
    equal(s.host.clipboardText, "untouched", "a refused cut leaves the clipboard alone");
    deepEqual(s.doc.serialize(), before);
    equal(s.doc.getSnapshot().edits.length, edits);
    s.state.answer = true;
    const had = s.doc.getSnapshot()[family].length;
    const group = s.editor.getState().objectGroup.length || 1;
    ok(await s.editor.cut(s.confirm));
    equal(s.doc.getSnapshot()[family].length, had - group);
    equal(s.doc.getSnapshot().edits.length, edits + 1);
    const clip = parseClip(s.host.clipboardText);
    ok(clip.ok && clip.value.kind === "objects" && clip.value.family === family);
    ok(s.doc.undo(s.doc.getSnapshot().edits.at(-1)!.editId).ok);
    deepEqual(s.doc.serialize(), before, "undo restores the exact bytes");
  });
}

test("a partial set of a region's points is refused by copy and cut without touching board, history or clipboard", async () => {
  const s = rig();
  ok((await seedObjects(s)).ok);
  s.editor.setMode("vectors");
  s.editor.selectObject(0);
  s.editor.selectPoints([0, 1]);
  s.host.clipboardText = "sentinel";
  const bytes = s.doc.serialize();
  const edits = s.doc.getSnapshot().edits.length;
  equal(await s.editor.copy(), false);
  match(s.editor.getState().message!.text, /partial set of points/);
  equal(await s.editor.cut(s.confirm), false);
  match(s.editor.getState().message!.text, /partial set of points/);
  equal(s.state.removals.length, 0, "the question is never asked for a refused selection");
  equal(s.host.clipboardText, "sentinel");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().edits.length, edits);
  // All of its points, or none of them, is the whole object.
  s.editor.selectAllPoints();
  ok(await s.editor.copy());
  s.editor.selectPoints([]);
  ok(await s.editor.copy());
});

test("lights are refused by copy, cut and paste without touching board, history or clipboard", async () => {
  const s = rig();
  ok((await s.doc.apply({ type: "set-board-fields", fields: { lights: [{ layer: 1, type: 1, nodes: [{ x: 0, y: 0 }, { x: 64, y: 0 }], colours: [{ r: 0, g: 0, b: 0 }, { r: 9, g: 9, b: 9 }] }] } })).ok);
  s.editor.selectAll();
  ok(await s.editor.copy());
  const valid = s.host.clipboardText;
  s.state.lights = true;
  s.host.clipboardText = "sentinel";
  const bytes = s.doc.serialize();
  const edits = s.doc.getSnapshot().edits.length;
  for (const action of [() => s.editor.copy(), () => s.editor.cut(s.confirm), () => s.editor.paste()]) {
    equal(await action(), false);
    equal(s.editor.getState().message?.kind, "error");
    match(s.editor.getState().message!.text, /Lights cannot be/);
  }
  equal(s.host.clipboardText, "sentinel");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().edits.length, edits);
  // A clipboard that holds a light is not board data either.
  s.state.lights = false;
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: BOARD_CLIPBOARD_VERSION, kind: "lights", lights: [] });
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /Lights and partial sets of points are never copied/);
  deepEqual(s.doc.serialize(), bytes);
  ok(parseClip(valid).ok);
});

test("without a host clipboard, copy, cut and paste say so and change nothing", async () => {
  const s = rig("2d", false);
  ok((await seedObjects(s)).ok);
  s.editor.selectAll();
  const bytes = s.doc.serialize();
  for (const action of [() => s.editor.copy(), () => s.editor.cut(s.confirm), () => s.editor.paste()]) {
    equal(await action(), false);
    match(s.editor.getState().message!.text, /cannot reach the system clipboard/);
  }
  deepEqual(s.doc.serialize(), bytes);
});

test("a clipboard that refuses a write stops a cut before anything is removed, and a refused read pastes nothing", async () => {
  const s = rig();
  ok((await seedObjects(s)).ok);
  s.editor.setMode("images");
  s.editor.selectAll();
  const bytes = s.doc.serialize();
  const denied: PlatformError = { code: "permission-denied", message: "no clipboard for you" };
  s.host.failClipboard(denied);
  equal(await s.editor.cut(s.confirm), false);
  match(s.editor.getState().message!.text, /Nothing was cut: no clipboard for you/);
  equal(await s.editor.copy(), false);
  match(s.editor.getState().message!.text, /Nothing was copied/);
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /Nothing was pasted/);
  deepEqual(s.doc.serialize(), bytes);
});

test("paste refuses foreign, newer and malformed clipboard text, a wrong mode and a layer the board lacks", async () => {
  const s = rig("2d", true, 1);
  const bytes = s.doc.serialize();
  const refuse = async (text: string, expected: RegExp): Promise<void> => {
    s.host.clipboardText = text;
    equal(await s.editor.paste(), false, text.slice(0, 40));
    match(s.editor.getState().message!.text, expected);
    deepEqual(s.doc.serialize(), bytes);
  };
  await refuse("just some words", /does not hold board data/);
  await refuse(JSON.stringify({ format: "other", version: 1 }), /does not hold board data/);
  await refuse(JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 2, kind: "region" }), /version 2/);
  await refuse(JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", width: 2, height: 1, tiles: [GRASS], shades: null }), /does not hold one tile/);
  await refuse(JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "objects", family: "vectors", objects: [{ nope: 1 }] }), /not stored vectors/);
  const record = defaultBoardObject("images", 2, { x: 1, y: 1 }, []);
  const images = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "objects", family: "images", objects: [record] });
  await refuse(images, /Switch to Images \(5\)/);
  s.editor.setMode("images");
  await refuse(images, /belongs to layer 2, and this board has 1 layer/);
  s.editor.setMode("vectors");
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", width: 1, height: 1, tiles: [GRASS], shades: null });
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /Switch to Tiles/);
});

test("the new set-tiles fields are validated and labelled by the board codec", () => {
  ok(boardCodec.isCommand({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 0, y: 0, r: 1, g: 2, b: 3 }] }));
  ok(boardCodec.isCommand({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 0, y: 0, r: 999, g: 2, b: 3 }] }), "a baked shade is a stored i16");
  ok(!boardCodec.isCommand({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 0, y: 0, r: 40_000, g: 2, b: 3 }] }));
  ok(!boardCodec.isCommand({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: "no" }));
  equal(boardCodec.label({ type: "set-tiles", gesture: "cut", cells: [{ layer: 0, x: 0, y: 0, tile: "" }] }), "Cut 1 cell on layer 1");
  notEqual(boardCodec.label({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 0, y: 0, r: 1, g: 1, b: 1 }, { x: 1, y: 0, r: 1, g: 1, b: 1 }] }), "");
});

test("a pasted group is shown as selected and ends with the next selection, a removal or a reorder", async () => {
  const s = rig();
  ok((await seedObjects(s)).ok);
  s.editor.setMode("vectors");
  s.editor.selectAll();
  ok(await s.editor.copy());
  ok(await s.editor.paste());
  const state = s.editor.getState();
  ok(state.objectGroup.length >= 1);
  s.editor.selectObject(0);
  deepEqual(s.editor.getState().objectGroup, []);
  notEqual(state.objectGroup, s.editor.getState().objectGroup);
});

test("a baked shade beyond ±255 survives copy and paste, because the board stores it as an i16", async () => {
  const s = rig();
  ok((await s.doc.apply({ type: "set-board-fields", fields: { shadeLayers: [{ castLayer: 2, records: [{ runCount: 64, r: 300, g: -400, b: 0 }] }] } })).ok);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 2, y: 2, tile: GRASS }] })).ok);
  s.editor.selectAll();
  ok(await s.editor.copy());
  const clip = parseClip(s.host.clipboardText);
  ok(clip.ok && clip.value.kind === "region");
  ok(clip.value.shades !== null && clip.value.shades.some((shade) => shade !== null && shade[0] === 300 && shade[1] === -400));
  s.editor.setLayer(1);
  ok(await s.editor.paste(), "a shade past the painted ±255 is stored data, not a refusal");
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 2, y: 2 }), { r: 300, g: -400, b: 0 });
  deepEqual(shadeAt(s.reload().getSnapshot(), { x: 2, y: 2 }), { r: 300, g: -400, b: 0 }, "the saved file holds it exactly");
  ok(s.doc.apply({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 3, y: 3, r: 300, g: 1, b: 1 }] }).ok);
  const beyond = s.doc.apply({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 3, y: 3, r: 40_000, g: 1, b: 1 }] });
  equal(beyond.ok, false, "a channel the i16 record cannot hold is still refused");
});

for (const [name, system] of LAYOUTS) {
  test(`${name}: select all copies the whole stored grid and pastes it on another layer at its own origin`, async () => {
    const s = rig(system);
    ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...s.centre, tile: GRASS }] })).ok);
    s.editor.selectAll();
    ok(await s.editor.copy());
    s.editor.setLayer(1);
    // A cell the pointer can reach, which on the iso-rotated layout is never the stored corner (0, 0).
    s.editor.setCursor(s.centre);
    ok(await s.editor.paste());
    const board = s.doc.getSnapshot();
    deepEqual([boardTileAt(board, 1, s.centre.x, s.centre.y), boardTileAt(board, 0, s.centre.x, s.centre.y)], [GRASS, GRASS], "the whole grid lands on the same stored cells, one layer up");
    const selection = s.editor.getState().selection;
    if (system === "iso-rotated") {
      equal(selection, null, "a rotated grid has cells with no place on the picture, so no rectangle is selected over them");
    } else {
      ok(selection !== null, "a grid without gaps selects the pasted rectangle");
      deepEqual([selection.rect.x0, selection.rect.y0], [0, 0]);
    }
  });
}

test("clipboard text that is not a version number is refused, never thrown", async () => {
  const s = rig();
  const bytes = s.doc.serialize();
  for (const version of [{ toString: null }, null, ["1"], { a: 1 }]) {
    s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version, kind: "region", width: 1, height: 1, tiles: [GRASS], shades: null });
    equal(await s.editor.paste(), false);
    match(s.editor.getState().message!.text, /version/);
    deepEqual(s.doc.serialize(), bytes);
  }
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", width: { toString: null }, height: 1, tiles: [], shades: null });
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /valid size/);
});

test("pasting where the cells already show what was copied still selects the new destination", async () => {
  const s = rig();
  const a = near(s.centre, 0, 0);
  const b = near(s.centre, 0, 2);
  const elsewhere = near(s.centre, 3, 3);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }, { layer: 0, ...b, tile: GRASS }] })).ok);
  await s.select(a, a);
  ok(await s.editor.copy());
  // A different selection, then a no-op paste: the selection must still move to where the paste went.
  await s.select(elsewhere, elsewhere);
  const bytes = s.doc.serialize();
  const edits = s.doc.getSnapshot().edits.length;
  s.editor.setCursor(b);
  equal(await s.editor.paste(), false, "nothing changed, so no edit was made");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().edits.length, edits);
  const selection = s.editor.getState().selection;
  ok(selection !== null, "the destination is selected so a second copy takes it");
  deepEqual([selection.rect.x0, selection.rect.y0, selection.rect.x1, selection.rect.y1], [b.x, b.y, b.x, b.y]);
  notEqual(selection.rect.x0, elsewhere.x);
});

test("select all with no visible object clears the earlier selection instead of keeping it for a cut", async () => {
  const s = rig();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points)] } })).ok);
  s.editor.setMode("vectors");
  s.editor.selectObject(0);
  equal(s.editor.getState().objectSelection?.index, 0);
  s.editor.setLayer(1);
  s.editor.selectAll();
  equal(s.editor.getState().objectSelection, null);
  deepEqual(s.editor.getState().objectGroup, []);
  match(s.editor.getState().message!.text, /nothing was selected/);
  const bytes = s.doc.serialize();
  s.host.clipboardText = "sentinel";
  equal(await s.editor.cut(s.confirm), false);
  match(s.editor.getState().message!.text, /Select a whole vector first/);
  equal(s.host.clipboardText, "sentinel");
  deepEqual(s.doc.serialize(), bytes);
});

test("a cut whose slots changed while the clipboard was written removes nothing", async () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes }, capabilities: ["clipboard"] });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), built.bytes);
  ok(opened.ok);
  const doc = opened.document;
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }];
  ok((await doc.apply({ type: "set-board-fields", fields: {
    vectors: [defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), { ...defaultBoardObject("vectors", 1, { x: 0, y: 0 }, points), handle: "second" }],
  } })).ok);
  let release = (): void => {};
  let writing = false;
  const editor = createBoardEditor({
    board: () => doc.getSnapshot(),
    apply: (command) => doc.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: {
      readText: async () => ({ ok: true, value: "" }),
      writeText: async () => {
        writing = true;
        await new Promise<void>((resolve) => { release = resolve; });
        return { ok: true, value: undefined };
      },
    },
  });
  editor.setMode("vectors");
  editor.selectObject(0);
  const cut = editor.cut(async () => true);
  for (let turn = 0; turn < 20 && !writing; turn += 1) await Promise.resolve();
  ok(writing, "the cut waits for the clipboard write");
  const records = doc.getSnapshot().vectors;
  ok((await doc.apply({ type: "set-board-fields", fields: { vectors: [records[1]!, records[0]!] } })).ok);
  const after = doc.serialize();
  release();
  equal(await cut, false);
  match(editor.getState().message!.text, /changed while the cut was being written/);
  deepEqual(doc.serialize(), after, "no vector was removed");
});

test("a pasted object's selection drops the previous object's point indices", async () => {
  const s = rig();
  const four = [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }, { x: 32, y: 96 }];
  const three = [{ x: 160, y: 32 }, { x: 192, y: 32 }, { x: 192, y: 64 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [defaultBoardObject("vectors", 1, { x: 32, y: 32 }, four), defaultBoardObject("vectors", 1, { x: 160, y: 32 }, three)] } })).ok);
  s.editor.setMode("vectors");
  s.editor.selectObject(0);
  s.editor.selectAllPoints();
  ok(await s.editor.copy());
  s.editor.selectObject(1);
  s.editor.selectPoints([0, 1, 2]);
  ok(await s.editor.paste());
  deepEqual(s.editor.getState().pointSelection, [], "the pasted vector starts with no points selected");
  s.host.clipboardText = "sentinel";
  ok(await s.editor.copy(), "a whole pasted vector can be copied again");
  match(s.editor.getState().message!.text, /Copied 1 vector/);
});

test("a clipped rotated-isometric selection whose bounding box starts on an absent cell still pastes back", async () => {
  const s = rig("iso-rotated");
  // The two visible ends of the diagonal: their stored bounding box starts at (0, 0), which has no place on the picture.
  const first: Cell = { x: 0, y: 7 };
  const last: Cell = { x: 7, y: 0 };
  ok(cellOnBoard(s.doc.getSnapshot(), first.x, first.y) && cellOnBoard(s.doc.getSnapshot(), last.x, last.y));
  ok(!cellOnBoard(s.doc.getSnapshot(), 0, 0), "the stored corner really is off the picture");
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...first, tile: GRASS }, { layer: 0, ...last, tile: ROCK }] })).ok);
  await s.select(first, last);
  ok(await s.editor.copy());
  const clip = parseClip(s.host.clipboardText);
  ok(clip.ok && clip.value.kind === "region");
  ok(clip.value.origin !== null, "a copied region records where it came from");
  deepEqual([clip.value.origin.x, clip.value.origin.y, clip.value.width, clip.value.height], [0, 0, 8, 8]);
  s.editor.setLayer(1);
  s.editor.setCursor(s.centre);
  ok(await s.editor.paste(), "the clip goes back to the cells it was copied from");
  deepEqual([boardTileAt(s.doc.getSnapshot(), 1, first.x, first.y), boardTileAt(s.doc.getSnapshot(), 1, last.x, last.y)], [GRASS, ROCK]);
  equal(s.editor.getState().selection, null, "a clip with gaps selects no rectangle, so a cut cannot take unpasted cells");
});

test("a region cut whose cells changed while the clipboard was written clears nothing", async () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes }, capabilities: ["clipboard"] });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), built.bytes);
  ok(opened.ok);
  const doc = opened.document;
  ok((await doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 1, y: 1, tile: GRASS }] })).ok);
  let release = (): void => {};
  let writing = false;
  const editor = createBoardEditor({
    board: () => doc.getSnapshot(),
    apply: (command) => doc.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: {
      readText: async () => ({ ok: true, value: "" }),
      writeText: async () => {
        writing = true;
        await new Promise<void>((resolve) => { release = resolve; });
        return { ok: true, value: undefined };
      },
    },
  });
  editor.selectAll();
  const cut = editor.cut(async () => true);
  for (let turn = 0; turn < 20 && !writing; turn += 1) await Promise.resolve();
  ok(writing);
  ok((await doc.apply({ type: "set-tile", layer: 0, x: 1, y: 1, tile: ROCK })).ok, "someone changes a copied cell during the write");
  const after = doc.serialize();
  release();
  equal(await cut, false);
  match(editor.getState().message!.text, /changed while the cut was being written/);
  deepEqual(doc.serialize(), after, "the changed cell is still there");
  equal(boardTileAt(doc.getSnapshot(), 0, 1, 1), ROCK);
});

test("a cut of an object whose slot was replaced during the question cuts nothing", async () => {
  const s = rig();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: {
    vectors: [{ ...defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), handle: "A" }, { ...defaultBoardObject("vectors", 1, { x: 0, y: 0 }, points), handle: "B" }],
  } })).ok);
  s.editor.setMode("vectors");
  s.editor.selectObject(0);
  s.host.clipboardText = "sentinel";
  let reordered: string | null = null;
  const cut = s.editor.cut(async () => {
    // While the question is open, another view reorders the family: slot 0 now holds B.
    const records = s.doc.getSnapshot().vectors;
    ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [records[1]!, records[0]!] } })).ok);
    reordered = s.doc.serialize().length.toString();
    return true;
  });
  equal(await cut, false);
  match(s.editor.getState().message!.text, /changed while the cut was being asked about/);
  equal(s.host.clipboardText, "sentinel", "nothing was written to the clipboard either");
  ok(reordered !== null);
  equal(s.doc.serialize().length, Number(reordered), "no third edit removed anything after the reorder");
  deepEqual(s.doc.getSnapshot().vectors.map((record) => record.handle), ["B", "A"], "the reorder stands; neither record was cut");
});

test("a paste the file refuses leaves the selection as it was", async () => {
  const s = rig();
  const a = near(s.centre, 0, 0);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
  s.editor.selectAll();
  const before = s.editor.getState().selection;
  const bytes = s.doc.serialize();
  const edits = s.doc.getSnapshot().edits.length;
  // A tile reference the board file cannot store (Windows-1252 refuses it), so the edit is a validation failure, not a no-op.
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin: { x: 0, y: 0 }, width: 1, height: 1, tiles: ["🌿"], shades: null });
  equal(await s.editor.paste(), false);
  equal(s.editor.getState().message?.kind, "error");
  deepEqual(s.editor.getState().selection, before, "a refused paste selects nothing");
  deepEqual(s.doc.serialize(), bytes);
  equal(s.doc.getSnapshot().edits.length, edits);
});

test("turning to the lights while the clipboard is read refuses the paste", async () => {
  const built = buildNewBoard({ name: "t", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  const host = createMemoryPlatformServices({ files: { "Boards/t.brd": built.bytes }, capabilities: ["clipboard"] });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/t.brd"), built.bytes);
  ok(opened.ok);
  const doc = opened.document;
  let lights = false;
  let release = (): void => {};
  const clipText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin: { x: 0, y: 0 }, width: 1, height: 1, tiles: [GRASS], shades: null });
  const editor = createBoardEditor({
    board: () => doc.getSnapshot(),
    apply: (command) => doc.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    lightsActive: () => lights,
    clipboard: {
      readText: () => new Promise((resolve) => { release = () => resolve({ ok: true, value: clipText }); }),
      writeText: async () => ({ ok: true, value: undefined }),
    },
  });
  const bytes = doc.serialize();
  const paste = editor.paste();
  lights = true;
  release();
  equal(await paste, false);
  match(editor.getState().message!.text, /Lights cannot be/);
  deepEqual(doc.serialize(), bytes);
});

test("a stale editor snapshot cannot cut: the stored board enforces the cut's requirement", async () => {
  const s = rig();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: {
    vectors: [{ ...defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), handle: "A" }, { ...defaultBoardObject("vectors", 1, { x: 0, y: 0 }, points), handle: "B" }],
  } })).ok);
  // A split view: this editor keeps the snapshot it read, while another view changes the document first.
  const stale = s.doc.getSnapshot();
  const records = stale.vectors;
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [records[1]!, records[0]!] } })).ok);
  const authoritative = s.doc;
  const afterChange = authoritative.serialize();
  const host = createMemoryPlatformServices({ files: {}, capabilities: ["clipboard"] });
  let release = (): void => {};
  const editor = createBoardEditor({
    board: () => stale,
    apply: (command) => authoritative.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: {
      readText: async () => ({ ok: true, value: "" }),
      writeText: async () => { await new Promise<void>((resolve) => { release = resolve; }); return { ok: true, value: undefined }; },
    },
  });
  editor.setMode("vectors");
  editor.selectObject(0);
  const cut = editor.cut(async () => true);
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  release();
  equal(await cut, false, "the stored board refuses a cut whose slots are not what the editor read");
  match(editor.getState().message!.text, /board changed since this edit was prepared/);
  deepEqual(authoritative.serialize(), afterChange);
  deepEqual(authoritative.getSnapshot().vectors.map((record) => record.handle), ["B", "A"]);
  ok(!host.clipboardText.includes("tkr-board-clipboard"));
});

test("a stale editor snapshot cannot cut a changed region cell either", async () => {
  const s = rig();
  const a = near(s.centre, 0, 0);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
  const stale = s.doc.getSnapshot();
  ok((await s.doc.apply({ type: "set-tile", layer: 0, x: a.x, y: a.y, tile: ROCK })).ok);
  const afterChange = s.doc.serialize();
  const authoritative = s.doc;
  const editor = createBoardEditor({
    board: () => stale,
    apply: (command) => authoritative.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: { readText: async () => ({ ok: true, value: "" }), writeText: async () => ({ ok: true, value: undefined }) },
  });
  const board = stale;
  editor.setTool("select");
  editor.pointerDown({ x: 0, y: 0 }, {});
  editor.pointerUp({ x: 0, y: 0 }, {});
  editor.selectAll();
  equal(await editor.cut(async () => true), false);
  match(editor.getState().message!.text, /board changed since this edit was prepared/);
  deepEqual(authoritative.serialize(), afterChange);
  equal(boardTileAt(authoritative.getSnapshot(), 0, a.x, a.y), ROCK, "the cell the other view wrote is untouched");
  ok(board.grid.width > 0);
});

test("a clip without an origin pastes only at the cursor and never invents (0, 0)", async () => {
  const s = rig();
  const a = near(s.centre, -1, 0);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: 0, y: 0, tile: ROCK }] })).ok);
  const bytes = s.doc.serialize();
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", width: 3, height: 1, tiles: [GRASS, GRASS, GRASS], shades: null });
  s.editor.setCursor(a);
  ok(await s.editor.paste(), "it fits at the cursor");
  equal(boardTileAt(s.doc.getSnapshot(), 0, a.x, a.y), GRASS);
  equal(boardTileAt(s.doc.getSnapshot(), 0, 0, 0), ROCK, "nothing was pasted at the stored corner");
  // A clip with no origin that does not fit nowhere to fall back to is refused, and (0, 0) is not overwritten.
  const edge = s.doc.getSnapshot().grid.width - 1;
  s.editor.setCursor({ x: edge, y: 0 });
  const before = s.doc.serialize();
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", width: 3, height: 1, tiles: [GRASS, GRASS, GRASS], shades: null });
  equal(await s.editor.paste(), false);
  match(s.editor.getState().message!.text, /does not say where it was copied from/);
  deepEqual(s.doc.serialize(), before);
  ok(bytes.length > 0);
});

test("a clipboard region whose origin is malformed is refused", async () => {
  const s = rig();
  const bytes = s.doc.serialize();
  for (const origin of ["here", { x: -1, y: 0 }, { x: 0.5, y: 1 }, { x: "0", y: 0 }]) {
    s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin, width: 1, height: 1, tiles: [GRASS], shades: null });
    equal(await s.editor.paste(), false);
    match(s.editor.getState().message!.text, /does not say which cell it was copied from/);
    deepEqual(s.doc.serialize(), bytes);
  }
});

test("a sparse clip pasted onto a flat board does not select cells it never wrote", async () => {
  const s = rig();
  // A 2 x 1 region whose first cell has no place on the source picture: pasting writes the second cell only.
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin: { x: 0, y: 0 }, width: 2, height: 1, tiles: [null, GRASS], shades: null });
  const a = near(s.centre, 1, 1);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: a.x, y: a.y, tile: ROCK }] })).ok);
  s.editor.setCursor(a);
  ok(await s.editor.paste());
  equal(boardTileAt(s.doc.getSnapshot(), 0, a.x + 1, a.y), GRASS, "the clip's second cell is written");
  equal(boardTileAt(s.doc.getSnapshot(), 0, a.x, a.y), ROCK, "the clip's gap cell is not written, so what it held stays");
  equal(s.editor.getState().selection, null, "no rectangle is selected over an unwritten cell");
  match(s.editor.getState().message!.text, /has gaps, so no cells are selected/);
  // A cut of a rectangle the user selects later takes exactly that rectangle.
  const bytes = s.doc.serialize();
  s.editor.setTool("select");
  const from = { x: a.x, y: a.y }, to = { x: a.x + 1, y: a.y };
  const centre = (cell: Cell) => cellCentre(s.doc.getSnapshot(), cell.x, cell.y);
  const screen = (cell: Cell) => boardToScreen(s.editor.getState().viewport, centre(cell).x, centre(cell).y);
  s.editor.pointerDown(screen(from), {});
  s.editor.pointerMove(screen(to), {});
  await s.editor.pointerUp(screen(to), {});
  ok(await s.editor.cut(async () => true), "the cut takes the region the user selected");
  deepEqual([boardTileAt(s.doc.getSnapshot(), 0, a.x, a.y), boardTileAt(s.doc.getSnapshot(), 0, a.x + 1, a.y)], ["", ""]);
  ok(bytes.length > 0);
});

test("a no-op paste that falls back reports where the destination is", async () => {
  const s = rig();
  const a = near(s.centre, 0, 0);
  // A three-cell clip copied from the middle, so the cursor at the far corner cannot hold it.
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: a.x, y: a.y, tile: GRASS }, { layer: 0, x: a.x + 1, y: a.y, tile: GRASS }, { layer: 0, x: a.x + 2, y: a.y, tile: GRASS }] })).ok);
  await s.select(a, { x: a.x + 2, y: a.y });
  ok(await s.editor.copy());
  s.editor.setCursor({ x: s.doc.getSnapshot().grid.width - 1, y: s.doc.getSnapshot().grid.height - 1 });
  const bytes = s.doc.serialize();
  equal(await s.editor.paste(), false, "the cells at the origin already show it");
  deepEqual(s.doc.serialize(), bytes);
  match(s.editor.getState().message!.text, new RegExp(`Nothing changed: those cells at column ${a.x + 1}, row ${a.y + 1} already show that`));
});

test("a stale editor snapshot cannot paste objects over what another view added", async () => {
  const s = rig();
  const points = [{ x: 32, y: 32 }, { x: 96, y: 32 }];
  ok((await s.doc.apply({ type: "set-board-fields", fields: { vectors: [{ ...defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), handle: "A" }] } })).ok);
  const stale = s.doc.getSnapshot();
  // Another view appends B before this one pastes.
  const authoritative = s.doc;
  ok((await authoritative.apply({ type: "set-board-fields", fields: { vectors: [...stale.vectors, { ...defaultBoardObject("vectors", 1, { x: 0, y: 0 }, points), handle: "B" }] } })).ok);
  const afterChange = authoritative.serialize();
  const editor = createBoardEditor({
    board: () => stale,
    apply: (command) => authoritative.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: {
      readText: async () => ({
        ok: true,
        value: JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "objects", family: "vectors", objects: [{ ...defaultBoardObject("vectors", 1, { x: 32, y: 32 }, points), handle: "C" }] }),
      }),
      writeText: async () => ({ ok: true, value: undefined }),
    },
  });
  editor.setMode("vectors");
  equal(await editor.paste(), false, "a paste built on a stale family is refused");
  match(editor.getState().message!.text, /board changed since this edit was prepared/);
  deepEqual(authoritative.serialize(), afterChange, "the object another view added is still there");
  deepEqual(authoritative.getSnapshot().vectors.map((record) => record.handle), ["A", "B"]);
});

test("a region paste writes every covered cell, so a stale view cannot skip one the host changed", async () => {
  const s = rig();
  const a = near(s.centre, 0, 0);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
  const stale = s.doc.getSnapshot();
  const authoritative = s.doc;
  ok((await authoritative.apply({ type: "set-tile", layer: 0, x: a.x, y: a.y, tile: ROCK })).ok);
  const editor = createBoardEditor({
    board: () => stale,
    apply: (command) => authoritative.apply(command),
    brush: () => null,
    pickTile: () => false,
    preferences: () => DEFAULT_EDITOR_PREFERENCES,
    clipboard: {
      readText: async () => ({
        ok: true,
        value: JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin: { x: a.x, y: a.y }, width: 1, height: 1, tiles: [GRASS], shades: null }),
      }),
      writeText: async () => ({ ok: true, value: undefined }),
    },
  });
  editor.setCursor(a);
  ok(await editor.paste());
  equal(boardTileAt(authoritative.getSnapshot(), 0, a.x, a.y), GRASS, "the cell the other view changed is written, not skipped");
});

test("a sparse paste that changes nothing still clears the old selection", async () => {
  const s = rig();
  const a = near(s.centre, 1, 1);
  ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, x: a.x, y: a.y, tile: GRASS }] })).ok);
  // Something else is selected: a later cut must not take it after a paste that lands elsewhere.
  await s.select(near(s.centre, -2, -2), near(s.centre, -1, -1));
  ok(s.editor.getState().selection !== null);
  s.host.clipboardText = JSON.stringify({ format: BOARD_CLIPBOARD_FORMAT, version: 1, kind: "region", origin: { x: a.x - 1, y: a.y }, width: 2, height: 1, tiles: [null, GRASS], shades: null });
  s.editor.setCursor({ x: a.x - 1, y: a.y });
  equal(await s.editor.paste(), false, "the only covered cell already shows the tile");
  match(s.editor.getState().message!.text, /Nothing changed/);
  equal(s.editor.getState().selection, null, "the old selection is cleared, so a cut cannot take unrelated cells");
});
