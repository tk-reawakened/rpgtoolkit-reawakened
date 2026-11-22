import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  buildNewBoard,
  createBoardDocument,
  createDocumentIdentity,
  createPendingEdits,
  previewBoard,
  type BoardDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { BoardViewDocument } from "../src/mount.ts";

const PATH = "Boards/lighting.brd";
// A static component import would initialize Preact before happy-dom supplies its browser environment.
let BoardLightingView: typeof import("../src/board-lighting-view.tsx").BoardLightingView;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let createElement: typeof import("preact").createElement;
let render: typeof import("preact").render;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ createElement, render } = await import("preact"));
  ({ BoardLightingView } = await import("../dist/board-lighting-view.js"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly doc: BoardDocument;
  readonly root: HTMLElement;
  renderView(): void;
}

async function setup(): Promise<Setup> {
  const built = buildNewBoard({ name: "lighting", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const pendingEdits = createPendingEdits();
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async (request) => {
      const picture = await previewBoard(host.fs, "memory-project", doc.serialize(), request);
      return picture.ok ? { ok: true, width: picture.width, height: picture.height, rgba: picture.rgba, warnings: picture.warnings, objectBounds: picture.objectBounds } : picture;
    },
    undo: () => doc.undo(),
    redo: () => doc.redo(),
  };
  const root = document.createElement("div");
  document.body.append(root);
  const renderView = (): void => {
    render(createElement(BoardLightingView, {
      doc: view,
      disabled: false,
      onEdited: () => undefined,
      pendingEdits,
    }), root);
  };
  await act(() => renderView());
  return { doc, root, renderView };
}

function input(root: HTMLElement, label: string): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (found === null) throw new Error(`missing input ${label}`);
  return found;
}

async function editInput(root: HTMLElement, label: string, value: string): Promise<void> {
  await act(() => {
    const field = input(root, label);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(root: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (button === undefined) throw new Error(`missing button ${label}`);
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function change(root: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const field = input(root, label);
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("adding a spotlight, moving its centre and converting it to shading are each one undoable edit", async () => {
  const s = await setup();
  await click(s.root, "Add spotlight");
  equal(s.doc.getSnapshot().lights.length, 1);
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[1], { x: 64, y: 48 });
  await change(s.root, "Light 1 Centre X (pixels)", "80");
  deepEqual(s.doc.getSnapshot().lights[0]?.nodes[1], { x: 80, y: 48 });
  await click(s.root, "Convert to shading");
  equal(s.doc.getSnapshot().lights.length, 0);
  ok(s.doc.getSnapshot().shadeLayers.length >= 1);
  ok(s.doc.undo().ok);
  equal(s.doc.getSnapshot().lights.length, 1, "one undo brings the editable light back");
  equal(s.doc.getSnapshot().shadeLayers.length, 0);
});

test("a shade cell is painted from the numeric fields and an off-board cell explains its refusal", async () => {
  const s = await setup();
  await change(s.root, "Shade Red", "-300");
  equal(input(s.root, "Shade Red").value, "-255", "typed channels clamp to the stored range");
  await change(s.root, "Shade column", "2");
  await change(s.root, "Shade row", "2");
  await click(s.root, "Shade cell");
  equal(s.doc.getSnapshot().shadeLayers.length, 1);
  const before = s.doc.getSnapshot().shadeLayers;
  await change(s.root, "Shade column", "9");
  await click(s.root, "Shade cell");
  equal(s.root.querySelector('[role="alert"]')?.textContent?.includes("outside the board"), true);
  deepEqual(s.doc.getSnapshot().shadeLayers, before);
  await click(s.root, "Zero RGB");
  equal(input(s.root, "Shade Green").value, "0");
});
