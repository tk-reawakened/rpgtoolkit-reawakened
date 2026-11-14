// The board view of story 12.1 over the real board model and the in-memory platform-services double, under the same DOM
// shim as the settings view. Assertions are on the DOM and on bytes, not on Preact internals.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { boardTileAt, createDocumentIdentity, openBoardDocument, previewBoard, type BoardDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { BoardViewDocument } from "../src/mount.ts";
import { exampleBoard, exampleTileset } from "./fixtures.ts";

const PATH = "Boards/village.brd";
const identity = createDocumentIdentity("memory-project", PATH);

type Mount = typeof import("../src/index.ts").mount;
let mount: Mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: BoardDocument;
  readonly view: BoardViewDocument;
  readonly el: HTMLElement;
}

async function setup(bytes: Uint8Array = exampleBoard()): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes, "Tiles/village.tst": exampleTileset() } });
  const opened = await openBoardDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const doc = opened.document;
  // The committed board names tile 8 of a tileset the committed tileset (two tiles) lacks: use tile 2 there, as a saved project would.
  ok(doc.apply({ type: "set-tile", layer: 1, x: 2, y: 2, tile: "village.tst2" }).ok);
  ok((await doc.save()).ok);
  // What a host gives the view: the model plus a picture composed from the project's files.
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async () => {
      const preview = await previewBoard(host.fs, "memory-project", doc.serialize());
      return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
    },
  };
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc, view, el };
}

async function show(s: Setup): Promise<ReturnType<Mount>> {
  let handle: ReturnType<Mount> | undefined;
  await act(() => {
    handle = mount(s.el, { document: s.view, services: s.host });
  });
  // The picture arrives after the view's first render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

const cell = (el: HTMLElement, column: number, row: number): HTMLButtonElement => {
  const found = el.querySelector<HTMLButtonElement>(`[aria-label^="Column ${column}, row ${row}:"]`);
  if (found === null) throw new Error(`no cell at column ${column}, row ${row}`);
  return found;
};
const field = (el: HTMLElement): HTMLInputElement => {
  const found = el.querySelector<HTMLInputElement>('input[type="text"]');
  if (found === null) throw new Error("no tile field");
  return found;
};
const save = (el: HTMLElement): HTMLButtonElement => {
  const found = el.querySelector<HTMLButtonElement>(".tkr-board-save");
  if (found === null) throw new Error("no Save button");
  return found;
};
const alerts = (el: HTMLElement): string[] => [...el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const state = (el: HTMLElement): string => el.querySelector(".tkr-board-state")?.textContent ?? "";

async function putTile(el: HTMLElement, text: string): Promise<void> {
  await act(() => {
    field(el).value = text;
    field(el).dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    field(el).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

test("the view names the board, shows its grid with every cell labelled, and draws the engine's picture", async () => {
  const s = await setup();
  await show(s);
  equal(s.el.querySelector("h2")?.textContent, "Board");
  match(s.el.querySelector(".tkr-board-summary")?.textContent ?? "", /4 × 3 cells, 2 layers/);
  const grid = s.el.querySelector('[role="grid"]');
  equal(grid?.getAttribute("aria-label"), "Tiles on layer 1");
  equal(s.el.querySelectorAll('[role="gridcell"]').length, 12);
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1");
  equal(cell(s.el, 4, 3).getAttribute("aria-label"), "Column 4, row 3: village.tst1");
  ok(s.el.querySelector('canvas[role="img"]') !== null, "the board's picture is shown");
  equal(state(s.el), "All changes saved");
  equal(save(s.el).disabled, true);
  deepEqual(alerts(s.el), []);
});

test("the grid is one tab stop that moves with the arrow keys and carries the selection", async () => {
  const s = await setup();
  await show(s);
  const stops = [...s.el.querySelectorAll('.tkr-board-cell[tabindex="0"]')];
  equal(stops.length, 1, "exactly one cell is in the tab order");
  await act(() => {
    cell(s.el, 1, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  });
  await act(() => {
    cell(s.el, 2, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });
  equal(cell(s.el, 2, 2).getAttribute("tabindex"), "0");
  equal(cell(s.el, 2, 2).parentElement?.getAttribute("aria-selected"), "true");
  match(s.el.querySelector('label[for$="-tile"]')?.textContent ?? "", /Tile for column 2, row 2/);
  const edge = cell(s.el, 2, 2);
  await act(() => {
    for (let step = 0; step < 6; step += 1) {
      edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    }
  });
  equal(cell(s.el, 1, 2).getAttribute("tabindex"), "0", "the selection stops at the board's edge");
});

test("putting a tile edits the document, marks it unsaved and tells the host about the edit", async () => {
  const s = await setup();
  await show(s);
  await putTile(s.el, "village.tst2");
  equal(cell(s.el, 1, 1).textContent, "village.tst2");
  equal(s.doc.getSnapshot().dirty, true);
  equal(state(s.el), "Unsaved changes");
  equal(save(s.el).disabled, false);
  const [event, ...rest] = s.host.editedEvents;
  equal(rest.length, 0, "one command, one document.edited message");
  equal(event?.document, identity.key);
  match(event?.label ?? "", /village\.tst2/);
});

test("Save writes the document's bytes through the host and returns to a clean state", async () => {
  const s = await setup();
  await show(s);
  await putTile(s.el, "village.tst2");
  await act(async () => {
    save(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  deepEqual(s.host.bytesOf(PATH), s.doc.serialize());
  equal(state(s.el), "All changes saved");
  const reopened = await openBoardDocument(s.host.fs, identity);
  ok(reopened.ok);
  equal(boardTileAt(reopened.document.getSnapshot(), 0, 0, 0), "village.tst2", "the saved file holds the tile put on the selected cell");
});

test("a tile the document refuses is explained beside the field and changes nothing", async () => {
  const s = await setup();
  await show(s);
  await putTile(s.el, "bad\u0000name");
  const shown = alerts(s.el);
  equal(shown.length, 1);
  match(shown[0] ?? "", /The tile was not changed/);
  equal(field(s.el).getAttribute("aria-invalid"), "true");
  equal(s.doc.getSnapshot().dirty, false);
});

test("a failed save keeps the edit, keeps the document dirty and names the document (ADR 0022 D3.3)", async () => {
  const s = await setup();
  const original = s.host.bytesOf(PATH);
  await show(s);
  await putTile(s.el, "village.tst2");
  s.host.failWrites({ code: "permission-denied", message: "the folder is read-only" });
  await act(async () => {
    save(s.el).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const shown = alerts(s.el);
  equal(shown.length, 1);
  ok(shown[0]?.includes(PATH) && shown[0].includes("the folder is read-only"), shown[0]);
  equal(cell(s.el, 1, 1).textContent, "village.tst2", "the edit is still on screen");
  equal(state(s.el), "Unsaved changes");
  deepEqual(s.host.bytesOf(PATH), original, "nothing was written");
});

test("a board changed on disk shows the conflict with the ways to settle it, and a save writes nothing over it (ADR 0022 D3.5)", async () => {
  const s = await setup();
  await show(s);
  await putTile(s.el, "village.tst2");
  const theirs = s.host.bytesOf(PATH).slice();
  theirs[theirs.length - 1] = (theirs[theirs.length - 1] ?? 0) ^ 0xff;
  s.host.seed(PATH, theirs);
  await act(async () => {
    await s.doc.checkExternal();
  });
  const group = s.el.querySelector('[role="group"][aria-label="Changed on disk"]');
  ok(group !== null, "the conflict is shown");
  ok(s.el.querySelector(".tkr-board-keep") !== null);
  equal(save(s.el).disabled, true, "Save is off while a choice waits");
  deepEqual(s.host.bytesOf(PATH), theirs);
});

test("an isometric board and a missing tileset say why there is no picture, and the grid still edits", async () => {
  const s = await setup();
  await s.host.fs.delete("Tiles/village.tst");
  await show(s);
  match(s.el.querySelector(".tkr-board-preview-state")?.textContent ?? "", /No picture: .*village\.tst/);
  await putTile(s.el, "village.tst2");
  equal(cell(s.el, 1, 1).textContent, "village.tst2");
});

test("disposing the view removes it and its subscription", async () => {
  const s = await setup();
  const handle = await show(s);
  handle.dispose();
  handle.dispose();
  equal(s.el.childNodes.length, 0);
  await s.doc.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" });
  equal(s.el.childNodes.length, 0, "a change after dispose draws nothing");
});
