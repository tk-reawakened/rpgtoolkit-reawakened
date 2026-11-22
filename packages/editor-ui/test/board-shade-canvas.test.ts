import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { buildNewBoard, createBoardDocument, createBoardEditor, createDocumentIdentity, newLight, shadeAt, zoomOf, type BoardCommand, type BoardDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";

// Pointer gestures of the Shading and Lighting canvas modes: one gesture is one command and one undo step.
let BoardCanvas: typeof import("../src/board-canvas.tsx").BoardCanvas;
type ShadeUi = import("../src/board-lighting-view.tsx").ShadeUi;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let createElement: typeof import("preact").createElement;
let render: typeof import("preact").render;
let getContext: typeof HTMLCanvasElement.prototype.getContext;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ createElement, render } = await import("preact"));
  ({ BoardCanvas } = await import("../dist/board-canvas.js"));
  getContext = HTMLCanvasElement.prototype.getContext;
  // The canvas is drawn with a context that accepts every call: these tests read documents, not pixels.
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => undefined, set: () => true })) as unknown as typeof getContext;
});

after(() => {
  HTMLCanvasElement.prototype.getContext = getContext;
  GlobalRegistrator.unregister();
});

async function setup(initial: Partial<ShadeUi> & Pick<ShadeUi, "mode">) {
  const built = buildNewBoard({ name: "shade", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { "Boards/shade.brd": built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/shade.brd"), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc: BoardDocument = opened.document;
  const editor = createBoardEditor({ board: () => doc.getSnapshot(), apply: (command: BoardCommand) => doc.apply(command), brush: () => null, pickTile: () => false, preferences: () => ({}) as never });
  let ui: ShadeUi = { tool: "draw", brush: { r: 64, g: 32, b: 16 }, showShading: true, showLighting: true, ...initial };
  const messages: (string | null)[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const draw = async (): Promise<void> => {
    await act(() => render(createElement(BoardCanvas, {
      editor, state: editor.getState(), board: doc.getSnapshot(), picture: null, stamp: null,
      shade: { ui, onUi: (next) => { ui = next; }, submit: async (command) => (await doc.apply(command)).ok, onMessage: (text) => { messages.push(text); }, disabled: false },
    }), root));
  };
  await draw();
  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  // Positions are board pixels; the view is centred and zoomed, so they are converted to the canvas's own screen pixels.
  const pointer = async (type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number, init: PointerEventInit = {}): Promise<void> => {
    const view = editor.getState().viewport;
    const zoom = zoomOf(view);
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent(type, { clientX: (x - view.x) * zoom, clientY: (y - view.y) * zoom, button: 0, bubbles: true, ...init }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await draw();
  };
  return { doc, canvas, messages, pointer, ui: () => ui, setUi: (next: ShadeUi) => { ui = next; return draw(); } };
}

test("Draw paints every cell a drag crosses in one edit, and one undo takes it all back", async () => {
  const s = await setup({ mode: "shading" });
  await s.pointer("pointerdown", 16, 16);
  await s.pointer("pointermove", 80, 16);
  await s.pointer("pointerup", 80, 16);
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 0, y: 0 }), { r: 64, g: 32, b: 16 });
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 2, y: 0 }), { r: 64, g: 32, b: 16 });
  equal(s.doc.getSnapshot().edits.length, 1);
  ok(s.doc.undo().ok);
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 0, y: 0 }), { r: 0, g: 0, b: 0 });
});

test("a right-click erases, and Rectangle outlines in cell numbers", async () => {
  const s = await setup({ mode: "shading" });
  await s.pointer("pointerdown", 16, 16);
  await s.pointer("pointerup", 16, 16);
  await s.pointer("pointerdown", 16, 16, { button: 2 });
  await s.pointer("pointerup", 16, 16, { button: 2 });
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 0, y: 0 }), { r: 0, g: 0, b: 0 });
  await s.setUi({ ...s.ui(), tool: "rectangle" });
  await s.pointer("pointerdown", 16, 16);
  await s.pointer("pointermove", 80, 80);
  await s.pointer("pointerup", 80, 80);
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 1, y: 1 }), { r: 0, g: 0, b: 0 }, "the middle of an outline is left alone");
  deepEqual(shadeAt(s.doc.getSnapshot(), { x: 2, y: 2 }), { r: 64, g: 32, b: 16 });
});

test("Dropper copies a cell's shade into the brush and changes no document", async () => {
  const s = await setup({ mode: "shading" });
  await s.doc.apply({ type: "set-shade-cells", cells: [{ x: 1, y: 0, r: 9, g: 8, b: 7 }] });
  const edits = s.doc.getSnapshot().edits.length;
  await s.setUi({ ...s.ui(), tool: "dropper" });
  await s.pointer("pointerdown", 48, 16);
  await s.pointer("pointerup", 48, 16);
  deepEqual(s.ui().brush, { r: 9, g: 8, b: 7 });
  equal(s.doc.getSnapshot().edits.length, edits);
});

test("a click off the board explains itself and changes nothing", async () => {
  const s = await setup({ mode: "shading" });
  await s.pointer("pointerdown", 400, 400);
  await s.pointer("pointerup", 400, 400);
  equal(s.doc.getSnapshot().edits.length, 0);
  ok(s.messages.some((text) => text !== null && text.includes("not on the board")));
});

test("dragging a light's node moves it in one edit; Escape drops the gesture", async () => {
  const s = await setup({ mode: "lighting" });
  const light = newLight(1, { x: 40, y: 40 }, { r: 50, g: 50, b: 50 });
  ok((await s.doc.apply({ type: "set-board-fields", fields: { lights: [light] } })).ok);
  await s.setUi(s.ui());
  await s.pointer("pointerdown", 40, 40);
  await s.pointer("pointermove", 90, 60);
  await s.pointer("pointerup", 90, 60);
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[0], { x: 90, y: 60 });
  equal(s.doc.getSnapshot().edits.length, 2);
  await s.pointer("pointerdown", 90, 60);
  await s.pointer("pointermove", 20, 20);
  await act(() => { s.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await s.pointer("pointerup", 20, 20);
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[0], { x: 90, y: 60 }, "the dropped gesture changed nothing");
});
