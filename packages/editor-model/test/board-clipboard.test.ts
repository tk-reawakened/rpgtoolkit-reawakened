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

  test(`${name}: a region that would land partly off the board is refused whole, changing nothing`, async () => {
    const s = rig(system);
    const a = near(s.centre, 0, 0);
    ok((await s.doc.apply({ type: "set-tiles", gesture: "draw", cells: [{ layer: 0, ...a, tile: GRASS }] })).ok);
    await s.select(a, near(a, 1, 1));
    ok(await s.editor.copy());
    const bytes = s.doc.serialize();
    const edits = s.doc.getSnapshot().edits.length;
    const board = s.doc.getSnapshot();
    let corner = a;
    for (let y = 0; y < board.grid.height; y += 1) for (let x = 0; x < board.grid.width; x += 1) if (cellOnBoard(board, x, y) && x + y >= corner.x + corner.y) corner = { x, y };
    s.editor.setCursor(corner);
    equal(await s.editor.paste(), false);
    equal(s.editor.getState().message?.kind, "error");
    match(s.editor.getState().message!.text, /does not fit/);
    deepEqual(s.doc.serialize(), bytes);
    equal(s.doc.getSnapshot().edits.length, edits);
  });
}

test("select all in Tiles mode copies the whole layer and a paste with its corner anywhere else is refused", async () => {
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
  equal(await s.editor.paste(), false);
  deepEqual(s.doc.serialize(), bytes);
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
  ok(!boardCodec.isCommand({ type: "set-tiles", gesture: "paste", cells: [], shadeCells: [{ x: 0, y: 0, r: 999, g: 2, b: 3 }] }));
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
