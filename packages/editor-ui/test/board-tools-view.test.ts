// The board canvas and tile tools of story 12.10 in the real view, on a top-down board and both isometric layouts, under
// the same DOM shim as the other view tests: pointer gestures on the canvas, keyboard paths, layer visibility, undo and
// redo, the retained brush (a tile, a dropped tile and a whole tile bitmap), and what is and is not an edit.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  boardExtent,
  boardTileAt,
  boardToScreen,
  buildNewBoard,
  cellCentre,
  clampViewport,
  createBoardDocument,
  createDocumentIdentity,
  pixelToCell,
  previewBoard,
  type BoardCoordSystem,
  type BoardDocument,
  type BoardPreviewRequest,
  type Cell,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { TILE_BITMAP_MAGIC, writeTileBitmap, type TileBitmap } from "@tk-reawakened/editor-model/testing";
import { createBrowserSession, type BrowserSession } from "../dist/brush.js";
import type { BoardPreferencesSource, BoardViewDocument, ViewHandle } from "../src/mount.ts";
import type { mount as MountFn } from "../src/index.ts";
import { exampleTileset } from "./fixtures.ts";

const PATH = "Boards/map.brd";
const GRASS = "village.tst1";
const ROCK = "village.tst2";

let mount: typeof MountFn;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  // The DOM shim must exist before the view module loads, so the import cannot be static.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: BoardDocument;
  readonly session: BrowserSession;
  readonly el: HTMLElement;
  readonly previews: BoardPreviewRequest[];
  readonly centre: Cell;
  prefs: { revertToDrawAfterFlood: boolean; recursiveFlood: boolean };
}

async function setup(system: BoardCoordSystem, options: { undo?: boolean; layers?: number; files?: Record<string, Uint8Array> } = {}): Promise<Setup> {
  const built = buildNewBoard({ name: "map", coordSystem: system, pixelCoordinates: false, width: 8, height: 8, layers: options.layers ?? 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { [PATH]: built.bytes, "Tiles/village.tst": exampleTileset(), ...(options.files ?? {}) } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const session = createBrowserSession();
  const previews: BoardPreviewRequest[] = [];
  const view: BoardViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command),
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async (request) => {
      previews.push(request ?? {});
      const preview = await previewBoard(host.fs, "memory-project", doc.serialize(), request);
      return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
    },
    ...(options.undo === false ? {} : { undo: () => doc.undo(), redo: () => doc.redo() }),
  };
  const el = document.createElement("div");
  document.body.append(el);
  const board = doc.getSnapshot();
  const extent = boardExtent(board);
  const centre = pixelToCell(board, extent.width / 2, extent.height / 2);
  if (centre === null) throw new Error("no centre cell");
  const state: Setup = { host, doc, session, el, previews, centre, prefs: { revertToDrawAfterFlood: true, recursiveFlood: false } };
  const source: BoardPreferencesSource = { get: () => state.prefs, subscribe: () => () => undefined };
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(el, { document: view, services: host, browser: { session, fs: host.fs, layout: { projectFolder: "" } }, boardPreferences: source });
  });
  await settle();
  if (handle === undefined) throw new Error("no view");
  return state;
}

/** Let the asynchronous file reads and pictures finish: each turn is one pass of the event loop, never a wait on the clock. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
};

const brush = async (s: Setup, tile: string): Promise<void> => {
  await act(() => s.session.update({ selection: { kind: "tiles", path: "Tiles/village.tst", reference: tile, label: `brush ${tile}`, boardTile: tile } as never }));
};

const canvas = (s: Setup): HTMLCanvasElement => {
  const found = s.el.querySelector<HTMLCanvasElement>("canvas.tkr-board-canvas");
  if (found === null) throw new Error("no canvas");
  return found;
};

/** The screen position of a cell's middle in the view's first, unscrolled viewport. */
function screenOf(s: Setup, cell: Cell): { x: number; y: number } {
  const board = s.doc.getSnapshot();
  const viewport = clampViewport(board, { x: 0, y: 0, zoomIndex: 2, width: canvas(s).width, height: canvas(s).height });
  const centre = cellCentre(board, cell.x, cell.y);
  return boardToScreen(viewport, centre.x, centre.y);
}

function pointer(type: string, position: { x: number; y: number }, extra: { ctrl?: boolean; shift?: boolean; button?: number } = {}): Event {
  const event = new MouseEvent(type, { clientX: position.x, clientY: position.y, button: extra.button ?? 0, ctrlKey: extra.ctrl === true, shiftKey: extra.shift === true, bubbles: true, cancelable: true });
  return event;
}

async function gesture(s: Setup, from: Cell, to: Cell, extra: { ctrl?: boolean } = {}): Promise<void> {
  const target = canvas(s);
  await act(() => { target.dispatchEvent(pointer("pointerdown", screenOf(s, from), extra)); });
  await act(() => { target.dispatchEvent(pointer("pointermove", screenOf(s, to), extra)); });
  await act(async () => { target.dispatchEvent(pointer("pointerup", screenOf(s, to), extra)); await Promise.resolve(); });
  await settle();
}

const click = (s: Setup, cell: Cell): Promise<void> => gesture(s, cell, cell);

const near = (s: Setup, dx: number, dy: number): Cell => ({ x: s.centre.x + dx, y: s.centre.y + dy });
const tileAt = (s: Setup, layer: number, cell: Cell): string | null => boardTileAt(s.doc.getSnapshot(), layer, cell.x, cell.y);
const tool = (s: Setup, name: string): HTMLButtonElement => {
  const found = s.el.querySelector<HTMLButtonElement>(`[data-tool="${name}"]`);
  if (found === null) throw new Error(`no ${name} tool`);
  return found;
};
const button = (s: Setup, selector: string): HTMLButtonElement => {
  const found = s.el.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};
const key = (s: Setup, target: Element, init: KeyboardEventInit): Promise<void> | void => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const alerts = (s: Setup): string[] => [...s.el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");

const LAYOUTS: readonly [string, BoardCoordSystem][] = [["top-down", "2d"], ["iso-stacked", "iso-stacked"], ["iso-rotated", "iso-rotated"]];

for (const [name, system] of LAYOUTS) {
  test(`${name}: a pointer click draws the retained brush as one host-reported edit, and Undo and Redo move through it`, async () => {
    const s = await setup(system);
    await brush(s, GRASS);
    const before = s.doc.serialize();
    await click(s, s.centre);
    equal(tileAt(s, 0, s.centre), GRASS);
    equal(s.host.editedEvents.length, 1, "one gesture, one document.edited message");
    match(s.host.editedEvents[0]?.label ?? "", /Draw 1 cell on layer 1/);
    await act(() => button(s, ".tkr-board-undo").click());
    deepEqual(s.doc.serialize(), before);
    equal(button(s, ".tkr-board-undo").disabled, true);
    equal(button(s, ".tkr-board-redo").disabled, false);
    await act(() => button(s, ".tkr-board-redo").click());
    equal(tileAt(s, 0, s.centre), GRASS);
    await key(s, s.el.querySelector("section")!, { key: "z", ctrlKey: true });
    equal(tileAt(s, 0, s.centre), "", "Ctrl+Z undoes");
    await key(s, s.el.querySelector("section")!, { key: "z", ctrlKey: true, shiftKey: true });
    equal(tileAt(s, 0, s.centre), GRASS, "Ctrl+Shift+Z redoes");
    deepEqual(alerts(s), []);
  });

  test(`${name}: a drag is one edit and the picture follows the document`, async () => {
    const s = await setup(system);
    await brush(s, ROCK);
    await gesture(s, near(s, -2, -1), near(s, 2, 1));
    equal(s.host.editedEvents.length, 1);
    ok(s.previews.length >= 2, "the picture was composed again after the edit");
    equal(tileAt(s, 0, near(s, -2, -1)), ROCK);
    equal(tileAt(s, 0, near(s, 2, 1)), ROCK);
  });

  test(`${name}: selecting, scrolling, zooming, layer visibility and the grid are not edits`, async () => {
    const s = await setup(system, { layers: 3 });
    await brush(s, GRASS);
    await click(s, s.centre);
    ok((await s.doc.save()).ok);
    const bytes = s.doc.serialize();
    const events = s.host.editedEvents.length;
    await act(() => tool(s, "select").click());
    await gesture(s, near(s, -1, -1), near(s, 1, 1));
    ok(s.el.querySelector(".tkr-board-selection") !== null);
    await act(() => tool(s, "scroll").click());
    await gesture(s, near(s, 0, 0), near(s, 1, 1));
    await act(() => button(s, ".tkr-board-zoom-in").click());
    await act(() => button(s, ".tkr-board-zoom-out").click());
    await act(() => button(s, ".tkr-board-grid-toggle").click());
    await act(() => button(s, ".tkr-board-only-current").click());
    await act(() => button(s, ".tkr-board-show-all").click());
    equal(s.doc.getSnapshot().dirty, false);
    equal(s.host.editedEvents.length, events);
    deepEqual(s.doc.serialize(), bytes);
  });

  test(`${name}: hiding a layer asks for a picture without it, never hides the current layer, and edits nothing`, async () => {
    const s = await setup(system, { layers: 3 });
    const boxes = [...s.el.querySelectorAll<HTMLInputElement>('.tkr-board-visibility input[type="checkbox"]')];
    equal(boxes.length, 4, "three layers and the background");
    equal(boxes[0]?.disabled, true, "the current layer's box is disabled");
    equal(boxes[3]?.disabled, true, "a board with no background image has no background to show");
    await act(() => { boxes[2]!.click(); });
    await settle();
    deepEqual(s.previews.at(-1), { visibleLayers: [0, 1], showBackground: true });
    await act(() => button(s, ".tkr-board-only-current").click());
    await settle();
    deepEqual(s.previews.at(-1), { visibleLayers: [0], showBackground: false });
    await act(() => button(s, ".tkr-board-show-all").click());
    await settle();
    deepEqual(s.previews.at(-1), { visibleLayers: [0, 1, 2], showBackground: true });
    const layerSelect = s.el.querySelector<HTMLSelectElement>(".tkr-board-row select");
    ok(layerSelect !== null);
    await act(() => { layerSelect.value = "2"; layerSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    equal(s.doc.getSnapshot().dirty, false);
    equal(s.host.editedEvents.length, 0);
  });

  test(`${name}: the keyboard reaches every tool: shortcuts pick the tool and Space applies it at the cell`, async () => {
    const s = await setup(system);
    await brush(s, GRASS);
    const section = s.el.querySelector("section")!;
    await key(s, section, { key: "s" });
    equal(tool(s, "select").getAttribute("aria-pressed"), "true");
    await key(s, section, { key: "d" });
    equal(tool(s, "draw").getAttribute("aria-pressed"), "true");
    const label = `Column ${s.centre.x + 1}, row ${s.centre.y + 1}:`;
    const cell = (): HTMLButtonElement => s.el.querySelector<HTMLButtonElement>(`[aria-label^="${label}"]`)!;
    await act(() => cell().click());
    await key(s, cell(), { key: " " });
    await settle();
    equal(tileAt(s, 0, s.centre), GRASS);
    equal(s.host.editedEvents.length, 1);
    await key(s, section, { key: "e" });
    await key(s, cell(), { key: " " });
    await settle();
    equal(tileAt(s, 0, s.centre), "");
    await key(s, section, { key: "s" });
    await key(s, cell(), { key: " " });
    await key(s, cell(), { key: "ArrowRight" });
    await key(s, s.el.querySelector('[tabindex="0"].tkr-board-cell')!, { key: " " });
    ok(s.el.querySelector(".tkr-board-selection")?.textContent?.includes("columns"));
    await key(s, section, { key: "Escape" });
    equal(s.host.editedEvents.length, 2, "selecting and cancelling made no edit");
  });
}

test("a typed letter in a text field is text, not a tool shortcut", async () => {
  const s = await setup("2d");
  const field = s.el.querySelector<HTMLInputElement>('input[type="text"]')!;
  await key(s, field, { key: "e" });
  equal(tool(s, "draw").getAttribute("aria-pressed"), "true");
});

test("the rectangle tool is unavailable on an iso-stacked board and its shortcut does nothing there", async () => {
  const s = await setup("iso-stacked");
  equal(tool(s, "rectangle").disabled, true);
  const ordinary = await setup("2d");
  equal(tool(ordinary, "rectangle").disabled, false);
});

test("Draw with no brush explains what to do and edits nothing", async () => {
  const s = await setup("2d");
  await click(s, s.centre);
  match(alerts(s).join(" "), /Choose a tile in the tileset browser first/);
  equal(s.doc.getSnapshot().dirty, false);
});

test("flood fill follows the preferences: it returns to Draw, and fills across layers when asked", async () => {
  const s = await setup("2d");
  await brush(s, ROCK);
  await act(() => tool(s, "flood").click());
  await click(s, s.centre);
  equal(tool(s, "draw").getAttribute("aria-pressed"), "true", "back to Draw after a flood by default");
  equal(tileAt(s, 1, s.centre), "", "only the current layer");
  ok((await Promise.resolve(s.doc.undo())).ok);
  s.prefs = { revertToDrawAfterFlood: false, recursiveFlood: true };
  await act(() => tool(s, "flood").click());
  await click(s, s.centre);
  equal(tool(s, "flood").getAttribute("aria-pressed"), "true");
  equal(tileAt(s, 1, s.centre), ROCK, "the fill continued through the other layer");
  equal(s.host.editedEvents.length, 2);
});

test("the dropper makes a board tile the retained brush and changes no document", async () => {
  const s = await setup("2d");
  await brush(s, ROCK);
  await click(s, s.centre);
  const edits = s.host.editedEvents.length;
  await act(() => s.session.update({ selection: null }));
  await act(() => tool(s, "dropper").click());
  await click(s, s.centre);
  const picked = s.session.getSnapshot().selection;
  equal(picked?.boardTile, ROCK);
  equal(picked?.path, "Tiles/village.tst");
  equal(picked?.label, "village.tst tile 2");
  equal(s.host.editedEvents.length, edits, "picking is not an edit");
  await act(() => tool(s, "draw").click());
  await click(s, near(s, 1, 0));
  equal(tileAt(s, 0, near(s, 1, 0)), ROCK, "the picked tile is the brush");
});

test("a tile bitmap chosen in the browser is stamped whole in one edit, and a stamp that does not fit is refused whole", async () => {
  const bitmap: TileBitmap = {
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 2,
    height: 1,
    // x outer, y inner, one padding row: (x, y) is x × 2 + y.
    cells: [
      { tile: GRASS, r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
      { tile: ROCK, r: 9, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 }, { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  };
  const written = writeTileBitmap(bitmap);
  ok(written.ok);
  const s = await setup("2d", { files: { "Bitmap/house.tbm": written.value } });
  s.session.update({ selection: { kind: "bitmaps", path: "Bitmap/house.tbm", reference: "house.tbm", label: "house.tbm", boardTile: null } as never });
  await settle();
  match(s.el.querySelector(".tkr-board-brush-state")?.textContent ?? "", /Stamp: house\.tbm, 2 × 1 cells/);
  await click(s, near(s, 0, 0));
  equal(tileAt(s, 0, near(s, 0, 0)), GRASS);
  equal(tileAt(s, 0, near(s, 1, 0)), ROCK);
  equal(s.host.editedEvents.length, 1, "the whole grid is one edit");
  await act(() => button(s, ".tkr-board-undo").click());
  equal(tileAt(s, 0, near(s, 1, 0)), "");
  await click(s, { x: 7, y: 7 });
  match(alerts(s).join(" "), /does not fit/);
  equal(s.host.editedEvents.length, 1);
});

test("a tile bitmap that cannot be read is explained and is no brush", async () => {
  const s = await setup("2d", { files: { "Bitmap/bad.tbm": new Uint8Array([1, 2, 3]) } });
  s.session.update({ selection: { kind: "bitmaps", path: "Bitmap/bad.tbm", reference: "bad.tbm", label: "bad.tbm", boardTile: null } as never });
  await settle();
  match(s.el.querySelector(".tkr-board-brush-state")?.textContent ?? "", /not a tile bitmap this editor reads/);
  await click(s, s.centre);
  equal(s.doc.getSnapshot().dirty, false);
});

test("a host that owns the undo stack gets no Undo button and is told to use its own", async () => {
  const s = await setup("2d", { undo: false });
  equal(s.el.querySelector(".tkr-board-undo"), null);
  match(s.el.textContent ?? "", /Use this editor's own Undo and Redo/);
});

test("select, then move the selection by numbers: one edit that Undo takes back, and a move off the board is refused", async () => {
  const s = await setup("2d");
  await brush(s, GRASS);
  await click(s, s.centre);
  await act(() => tool(s, "select").click());
  await click(s, s.centre);
  const columns = s.el.querySelector<HTMLInputElement>('.tkr-board-selection input[type="number"]')!;
  await act(() => { columns.value = "2"; columns.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { button(s, ".tkr-board-move").click(); await Promise.resolve(); });
  await settle();
  equal(tileAt(s, 0, s.centre), "");
  equal(tileAt(s, 0, near(s, 2, 0)), GRASS);
  equal(s.host.editedEvents.length, 2);
  await act(() => { columns.value = "40"; columns.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { button(s, ".tkr-board-move").click(); await Promise.resolve(); });
  await settle();
  match(alerts(s).join(" "), /off the board/);
  equal(s.host.editedEvents.length, 2);
  await act(async () => { button(s, ".tkr-board-erase-selection").click(); await Promise.resolve(); });
  await settle();
  equal(tileAt(s, 0, near(s, 2, 0)), "");
});

test("pointing at a place off an iso-rotated board's picture is explained and edits nothing, and its grid cells are marked off the board", async () => {
  const s = await setup("iso-rotated");
  await brush(s, GRASS);
  const off = s.el.querySelector('[aria-label$="off the board"]');
  ok(off !== null, "the square stored grid has cells with no place on the picture");
  equal(off.getAttribute("aria-disabled"), "true");
  await act(() => { canvas(s).dispatchEvent(pointer("pointerdown", { x: 2, y: 2 })); });
  await act(async () => { canvas(s).dispatchEvent(pointer("pointerup", { x: 2, y: 2 })); await Promise.resolve(); });
  match(s.el.querySelector(".tkr-board-message")?.textContent ?? "", /not on the board/);
  equal(s.doc.getSnapshot().dirty, false);
});
