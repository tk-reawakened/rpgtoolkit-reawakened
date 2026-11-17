import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  boardToScreen, buildNewBoard, createBoardDocument, createBoardEditor, createDocumentIdentity,
  DEFAULT_EDITOR_PREFERENCES, type BoardCoordSystem, type Modifiers, type Pixel,
} from "../src/index.ts";

function rig(coordSystem: BoardCoordSystem = "2d") {
  const built = buildNewBoard({ name: "objects", coordSystem, pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
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
  return { doc, editor, screen, click, bytes: built.bytes };
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
