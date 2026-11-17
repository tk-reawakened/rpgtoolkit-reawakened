import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  boardToScreen, buildNewBoard, createBoardDocument, createBoardEditor, createDocumentIdentity,
  DEFAULT_EDITOR_PREFERENCES, type BoardCoordSystem, type Modifiers, type Pixel,
} from "../src/index.ts";
import { defaultBoardObject } from "../src/board-object-tools.ts";

function rig(coordSystem: BoardCoordSystem = "2d", initialBytes?: Uint8Array) {
  const built = initialBytes === undefined
    ? buildNewBoard({ name: "objects", coordSystem, pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null })
    : { ok: true as const, bytes: initialBytes };
  ok(built.ok);
  const host = createMemoryPlatformServices({ files: { "Boards/objects.brd": built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/objects.brd"), built.bytes);
  ok(opened.ok);
  const doc = opened.document;
  const editor = createBoardEditor({ board: () => doc.getSnapshot(), apply: (command) => doc.apply(command),
    brush: () => null, pickTile: () => false, preferences: () => DEFAULT_EDITOR_PREFERENCES });
  const screen = (point: Pixel) => boardToScreen(editor.getState().viewport, point.x, point.y);
  const click = async (point: Pixel, modifiers: Modifiers = {}) => {
    editor.pointerDown(screen(point), modifiers);
    await editor.pointerUp(screen(point), modifiers);
  };
  return { doc, editor, screen, click, bytes: built.bytes, host };
}

test("a polygon is one edit only on finish, and Undo restores the original bytes", async () => {
  const { doc, editor, click, bytes } = rig();
  editor.setMode("vectors");
  await click({ x: 32, y: 32 });
  await click({ x: 96, y: 32 });
  await click({ x: 96, y: 96 });
  deepEqual(doc.serialize(), bytes);
  equal(doc.getSnapshot().dirty, false);
  ok(await editor.finishObjectPath(false));
  deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }]);
  equal(doc.getSnapshot().vectors[0]!.closed, -1);
  equal(doc.getSnapshot().vectors[0]!.type, 1);
  equal(doc.getSnapshot().edits.length, 1);
  ok(doc.undo(doc.getSnapshot().edits[0]!.editId).ok);
  editor.sync();
  deepEqual(doc.serialize(), bytes);
  equal(editor.getState().objectSelection, null);
});

test("remove and reorder preserve raw slots, residue, undo bytes, and saved order", async () => {
  const built = buildNewBoard({ name: "objects", coordSystem: "2d", pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  ok(built.ok);
  const decoded = readBoard(new BinaryReader(built.bytes));
  ok(decoded.ok);
  const points = [{ x: 32, y: 32 }, { x: 64, y: 32 }];
  const source = {
    ...decoded.value,
    vectors: [32, 96, 160].map((x, index) => ({
      ...defaultBoardObject("vectors", 1, { x, y: 32 }, points), handle: `slot-${index}`, attributes: index + 10,
    })),
    programs: [
      { ...defaultBoardObject("programs", 1, { x: 0, y: 0 }, []), graphic: "reserved.gph", handle: "empty slot" },
      { ...defaultBoardObject("programs", 1, { x: 0, y: 0 }, points), program: "kept.prg", activationType: 64 },
    ],
    residue: Uint8Array.of(17, 39, 205, 0),
  };
  const encoded = writeBoard(source);
  ok(encoded.ok);
  const { doc, editor, host } = rig("2d", encoded.value);
  editor.setMode("vectors");
  const original = [...doc.getSnapshot().vectors];
  const originalBytes = doc.serialize();
  editor.selectObject(1);
  ok(await editor.removeObject());
  deepEqual(doc.getSnapshot().vectors, [original[0], original[2]]);
  equal(editor.getState().objectSelection, null);
  deepEqual(doc.getSnapshot().programs, source.programs);
  const removalId = doc.getSnapshot().edits.at(-1)!.editId;
  ok(doc.undo(removalId).ok);
  editor.sync();
  deepEqual(doc.serialize(), originalBytes);
  editor.selectObject(0);
  ok(await editor.reorderObject(2));
  deepEqual(doc.getSnapshot().vectors, [original[1], original[2], original[0]]);
  equal(editor.getState().objectSelection?.index, 2);
  deepEqual(doc.getSnapshot().programs, source.programs);
  const reorderedBytes = doc.serialize();
  const reorderId = doc.getSnapshot().edits.at(-1)!.editId;
  ok(doc.undo(reorderId).ok);
  editor.sync();
  deepEqual(doc.serialize(), originalBytes);
  ok(doc.redo(reorderId).ok);
  editor.sync();
  deepEqual(doc.serialize(), reorderedBytes);
  ok((await doc.save()).ok);
  const saved = await host.fs.readProject("memory-project", "Boards/objects.brd");
  ok(saved.ok);
  const reopened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/objects.brd"), saved.value);
  ok(reopened.ok);
  deepEqual(reopened.document.getSnapshot().vectors, [original[1], original[2], original[0]]);
  deepEqual(reopened.document.getSnapshot().programs, source.programs);
  deepEqual(reopened.document.serialize().slice(-4), Uint8Array.of(17, 39, 205, 0));
});

test("Draw starts a new path on a segment, while Alt subdivides and Ctrl controls snapping", async () => {
  const { doc, editor, screen, click } = rig();
  editor.setMode("vectors");
  await click({ x: 32, y: 32 });
  await click({ x: 96, y: 32 });
  ok(await editor.finishObjectPath(false));
  editor.pointerDown(screen({ x: 64, y: 32 }), {});
  equal(editor.getState().pending?.kind, "object-path");
  equal(doc.getSnapshot().vectors[0]!.points.length, 2);
  editor.cancel();
  editor.selectObject(0);
  await click({ x: 64, y: 32 }, { alt: true });
  deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 64, y: 32 }, { x: 96, y: 32 }]);
  editor.cancel();
  await click({ x: 41, y: 47 });
  await click({ x: 64, y: 96 });
  ok(await editor.finishObjectPath(false));
  deepEqual(doc.getSnapshot().vectors[1]!.points, [{ x: 32, y: 32 }, { x: 64, y: 96 }]);
  editor.cancel();
  await click({ x: 41, y: 47 }, { ctrl: true });
  await click({ x: 80, y: 95 }, { ctrl: true });
  ok(await editor.finishObjectPath(false));
  deepEqual(doc.getSnapshot().vectors[2]!.points, [{ x: 41, y: 47 }, { x: 80, y: 95 }]);
});

for (const ctrl of [false, true]) {
  test(`Alt segment insertion ${ctrl ? "reverses" : "uses"} grid snapping`, async () => {
    const { doc, editor, click } = rig();
    editor.setMode("vectors");
    await click({ x: 32, y: 32 }); await click({ x: 96, y: 96 });
    ok(await editor.finishObjectPath(false));
    await click({ x: 69, y: 70 }, { alt: true, ctrl });
    const inserted = ctrl ? { x: 70, y: 70 } : { x: 64, y: 64 };
    deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, inserted, { x: 96, y: 96 }]);
    const editId = doc.getSnapshot().edits.at(-1)!.editId;
    ok(doc.undo(editId).ok);
    deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 96 }]);
  });
}

test("Alt resumes a visible region, and hidden geometry is not a Draw target", async () => {
  const { doc, editor, screen, click } = rig();
  editor.setMode("vectors");
  await click({ x: 32, y: 32 });
  await click({ x: 96, y: 32 });
  ok(await editor.finishObjectPath(false));
  editor.selectObject(0);
  editor.pointerDown(screen({ x: 96, y: 96 }), { alt: true });
  equal(editor.getState().pending?.kind, "object-path");
  editor.cancel();
  deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }]);
  editor.pointerDown(screen({ x: 96, y: 96 }), { alt: true });
  await click({ x: 128, y: 96 });
  ok(await editor.finishObjectPath(true));
  deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }, { x: 128, y: 96 }]);
  editor.selectObject(0);
  editor.setLayer(1);
  editor.setLayerVisible(0, false);
  editor.pointerDown(screen({ x: 32, y: 32 }), {});
  equal(editor.getState().pending?.kind, "object-path");
  editor.cancel();
  editor.setLayer(0);
  editor.setLayerVisible(0, true);
  editor.setObjectTypeVisible(1, false);
  editor.pointerDown(screen({ x: 32, y: 32 }), {});
  equal(editor.getState().pending?.kind, "object-path");
  editor.cancel();
  deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }, { x: 128, y: 96 }]);
});

test("Escape, tool and mode changes cancel uncommitted regions without dirtying the board", async () => {
  const { doc, editor, click, bytes } = rig();
  editor.setMode("programs");
  await click({ x: 32, y: 32 });
  await click({ x: 96, y: 32 });
  editor.cancel();
  equal(editor.getState().pending, null);
  deepEqual(doc.serialize(), bytes);
  await click({ x: 32, y: 32 });
  editor.setTool("select");
  equal(editor.getState().pending, null);
  editor.setTool("draw");
  await click({ x: 32, y: 32 });
  editor.setMode("images");
  equal(editor.getState().pending, null);
  deepEqual(doc.serialize(), bytes);
  equal(doc.getSnapshot().dirty, false);
});

test("selected points move in one edit while other vertices and raw metadata survive", async () => {
  const { doc, editor, screen, click } = rig();
  editor.setMode("vectors");
  await click({ x: 32, y: 32 }); await click({ x: 96, y: 32 }); await click({ x: 96, y: 96 });
  ok(await editor.finishObjectPath(false));
  const original = doc.getSnapshot().vectors[0]!;
  editor.setTool("select");
  editor.selectPoints([1]);
  editor.pointerDown(screen({ x: 96, y: 32 }), {});
  editor.pointerMove(screen({ x: 128, y: 64 }), {});
  await editor.pointerUp(screen({ x: 128, y: 64 }), {});
  deepEqual(doc.getSnapshot().vectors[0], { ...original, points: [{ x: 32, y: 32 }, { x: 128, y: 64 }, { x: 96, y: 96 }] });
  equal(doc.getSnapshot().edits.length, 2);
  ok(doc.undo(doc.getSnapshot().edits.at(-1)!.editId).ok);
  deepEqual(doc.getSnapshot().vectors[0], original);
});

for (const layout of ["iso-stacked", "iso-rotated"] as const) {
  test(`${layout} rectangles follow diamond grid axes, not a screen-aligned box`, async () => {
    const { doc, editor, screen } = rig(layout);
    editor.setMode("vectors"); editor.setTool("rectangle");
    editor.pointerDown(screen({ x: 64, y: 32 }), {});
    editor.pointerMove(screen({ x: 192, y: 64 }), {});
    await editor.pointerUp(screen({ x: 192, y: 64 }), {});
    deepEqual(doc.getSnapshot().vectors[0]!.points, [{ x: 64, y: 32 }, { x: 160, y: 80 }, { x: 192, y: 64 }, { x: 96, y: 16 }]);
    equal(doc.getSnapshot().edits.length, 1);
  });
}

test("open program paths, subdivision, resume and point deletion are undoable record edits", async () => {
  const { doc, editor, click } = rig();
  editor.setMode("programs");
  await click({ x: 32, y: 32 }); await click({ x: 96, y: 32 });
  ok(await editor.finishObjectPath(true));
  equal(doc.getSnapshot().programs[0]!.closed, 0);
  ok(await editor.subdivideObject());
  deepEqual(doc.getSnapshot().programs[0]!.points, [{ x: 32, y: 32 }, { x: 64, y: 32 }, { x: 96, y: 32 }]);
  editor.selectPoints([1]);
  ok(await editor.deletePoints());
  deepEqual(doc.getSnapshot().programs[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }]);
  editor.resumeObjectPath();
  await click({ x: 96, y: 96 });
  ok(await editor.finishObjectPath(false));
  deepEqual(doc.getSnapshot().programs[0]!.points, [{ x: 32, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 96 }]);
  equal(doc.getSnapshot().programs[0]!.closed, -1);
});

test("sprite dragging uses stored tile bases and clearing selection makes no edit", async () => {
  const { doc, editor, screen } = rig();
  editor.setMode("sprites");
  ok(await editor.createObject());
  equal(doc.getSnapshot().sprites[0]!.x, 16);
  equal(doc.getSnapshot().sprites[0]!.y, 31);
  editor.setTool("select");
  editor.pointerDown(screen({ x: 16, y: 15 }), {});
  editor.pointerMove(screen({ x: 47, y: 45 }), {});
  await editor.pointerUp(screen({ x: 47, y: 45 }), {});
  equal(doc.getSnapshot().sprites[0]!.x, 48);
  equal(doc.getSnapshot().sprites[0]!.y, 63);
  const before = doc.serialize();
  editor.cancel();
  deepEqual(doc.serialize(), before);
});
