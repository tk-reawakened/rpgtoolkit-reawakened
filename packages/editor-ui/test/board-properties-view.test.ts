import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  buildNewBoard,
  cellCentre,
  createBoardDocument,
  createDocumentIdentity,
  createPendingEdits,
  previewBoard,
  type BoardDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { BoardViewDocument } from "../src/mount.ts";

const PATH = "Boards/properties.brd";
// A static component import would initialize Preact before happy-dom supplies its browser environment.
let BoardPropertiesView: typeof import("../src/board-properties-view.tsx").BoardPropertiesView;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;
let createElement: typeof import("preact").createElement;
let render: typeof import("preact").render;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ createElement, render } = await import("preact"));
  ({ BoardPropertiesView } = await import("../dist/board-properties-view.js"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly doc: BoardDocument;
  readonly root: HTMLElement;
  renderView(): void;
}

async function setup(): Promise<Setup> {
  const built = buildNewBoard({ name: "properties", coordSystem: "2d", pixelCoordinates: false, width: 4, height: 3, layers: 2, backgroundImage: "", template: null });
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
    render(createElement(BoardPropertiesView, {
      doc: view,
      disabled: false,
      onEdited: () => undefined,
      onChooseStart: () => undefined,
      onSetStart: async (column, row, layer) => {
        const snapshot = doc.getSnapshot();
        const point = cellCentre(snapshot, column - 1, row - 1);
        const result = await doc.apply({
          type: "set-board-fields",
          fields: { properties: { ...snapshot.properties, start: { ...point, layer } } },
        });
        return result.ok;
      },
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

test("an off-board numeric start explains its refusal and leaves the board unchanged", async () => {
  const s = await setup();
  const before = s.doc.getSnapshot().properties.start;
  await editInput(s.root, "Start column", "5");
  await click(s.root, "Apply player start");
  equal(s.doc.getSnapshot().dirty, false, "a refused start does not create an edit");
  deepEqual(s.doc.getSnapshot().properties.start, before, "an invalid start leaves the committed marker unchanged");
  equal(s.root.querySelector('[role="alert"]')?.textContent, "Start column, row and layer must name a cell and layer on this board.");
});

test("undoing a numeric start cannot be undone again by applying an unrelated property", async () => {
  const s = await setup();
  const originalStart = s.doc.getSnapshot().properties.start;
  await editInput(s.root, "Start column", "3");
  await editInput(s.root, "Start row", "2");
  await click(s.root, "Apply player start");
  deepEqual(s.doc.getSnapshot().properties.start, { ...cellCentre(s.doc.getSnapshot(), 2, 1), layer: 1 }, "a valid numeric start is committed to the real board model");
  ok(s.doc.undo().ok, "the start edit is available to undo");
  await act(() => s.renderView());
  deepEqual(s.doc.getSnapshot().properties.start, originalStart, "undo restores the previous committed start");
  await editInput(s.root, "Background music", "theme.mid");
  await click(s.root, "Apply");
  deepEqual(s.doc.getSnapshot().properties.start, originalStart, "applying another property does not resurrect the undone start");
  equal(s.doc.getSnapshot().properties.backgroundMusic, "theme.mid", "the unrelated property still applies");
});

test("an acknowledged numeric start preserves an unrelated staged property draft", async () => {
  const s = await setup();
  const originalThreads = s.doc.getSnapshot().threads;
  const originalLayerTitles = s.doc.getSnapshot().layerTitles;
  await editInput(s.root, "Background music", "theme.mid");
  await editInput(s.root, "Start column", "4");
  await editInput(s.root, "Start row", "3");
  await click(s.root, "Apply player start");
  const expectedStart = { ...cellCentre(s.doc.getSnapshot(), 3, 2), layer: 1 };
  deepEqual(s.doc.getSnapshot().properties.start, expectedStart, "the valid numeric start is committed");
  equal(input(s.root, "Background music").value, "theme.mid", "the unrelated staged text remains visible after start acknowledgement");
  await click(s.root, "Apply");
  equal(s.doc.getSnapshot().properties.backgroundMusic, "theme.mid", "the preserved draft can subsequently be applied");
  deepEqual(s.doc.getSnapshot().properties.start, expectedStart, "applying the staged property keeps the acknowledged start");
  deepEqual(s.doc.getSnapshot().threads, originalThreads, "applying unchanged multiline threads preserves the model list");
  deepEqual(s.doc.getSnapshot().layerTitles, originalLayerTitles, "applying unchanged multiline layer titles preserves the model list");
});
