// Autotiling in the real views (story 8, T-25): the H toggle and its visible state, the warnings the original never gave,
// the 47-shape preview drawn from the chosen set's own tiles, an explicit mark, and a Shift note that follows the key.
import { after, before, test } from "node:test";
import { equal, match, ok } from "node:assert/strict";
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
  DEFAULT_EDITOR_PREFERENCES,
  pixelToCell,
  previewBoard,
  type BoardCoordSystem,
  type BoardDocument,
  type Cell,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBrowserSession, type BrowserSession } from "../dist/brush.js";
import type { BoardPreferencesSource, BoardViewDocument, ViewHandle } from "../src/mount.ts";
import type { mount as MountFn } from "../src/index.ts";
import { exampleTileset } from "./fixtures.ts";

const PATH = "Boards/map.brd";
let mount: typeof MountFn;
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
  readonly session: BrowserSession;
  readonly el: HTMLElement;
  readonly centre: Cell;
  dispose(): void;
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 12; turn += 1) await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); });
};

async function setup(system: BoardCoordSystem = "2d"): Promise<Setup> {
  const built = buildNewBoard({ name: "map", coordSystem: system, pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: {
    [PATH]: built.bytes,
    "Tiles/village.tst": exampleTileset(),
    "Tiles/AUTOTILES_village.tst": exampleTileset(),
    "Tiles/nested/autotiles_Marsh.tst": exampleTileset(),
  } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", PATH), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const doc = opened.document;
  const session = createBrowserSession();
  const view: BoardViewDocument = {
    kind: doc.kind, identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(), subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => doc.apply(command), save: () => doc.save(), resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: async (request) => {
      const preview = await previewBoard(host.fs, "memory-project", doc.serialize(), request);
      return preview.ok ? { ok: true, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings, objectBounds: preview.objectBounds } : preview;
    },
    undo: () => doc.undo(), redo: () => doc.redo(),
  };
  const el = document.createElement("div");
  document.body.append(el);
  const extent = boardExtent(doc.getSnapshot());
  const centre = pixelToCell(doc.getSnapshot(), extent.width / 2, extent.height / 2);
  if (centre === null) throw new Error("no centre cell");
  const source: BoardPreferencesSource = { get: () => DEFAULT_EDITOR_PREFERENCES, subscribe: () => () => undefined };
  let handle: ViewHandle | undefined;
  await act(() => { handle = mount(el, { document: view, services: host, browser: { session, fs: host.fs, layout: { projectFolder: "" } }, boardPreferences: source }); });
  await settle();
  return { host, doc, session, el, centre, dispose: () => handle?.dispose() };
}

const text = (s: Setup): string => s.el.textContent ?? "";
const canvas = (s: Setup): HTMLCanvasElement => s.el.querySelector<HTMLCanvasElement>("canvas.tkr-board-canvas")!;
const toggle = (s: Setup): HTMLButtonElement => s.el.querySelector<HTMLButtonElement>(".tkr-board-autotile-toggle")!;
const notes = (s: Setup): string[] => [...s.el.querySelectorAll(".tkr-board-autotile-note")].map((node) => node.textContent ?? "");
function screenOf(s: Setup, cell: Cell): { x: number; y: number } {
  const board = s.doc.getSnapshot();
  const viewport = clampViewport(board, { x: 0, y: 0, zoomIndex: 2, width: canvas(s).width, height: canvas(s).height });
  const centre = cellCentre(board, cell.x, cell.y);
  return boardToScreen(viewport, centre.x, centre.y);
}
const mouse = (type: string, at: { x: number; y: number }): Event => new MouseEvent(type, { clientX: at.x, clientY: at.y, bubbles: true, cancelable: true });
async function click(s: Setup, cell: Cell): Promise<void> {
  await act(() => { canvas(s).dispatchEvent(mouse("pointerdown", screenOf(s, cell))); });
  await act(async () => { canvas(s).dispatchEvent(mouse("pointerup", screenOf(s, cell))); await Promise.resolve(); });
  await settle();
}
const tileAt = (s: Setup, cell: Cell): string => boardTileAt(s.doc.getSnapshot(), 0, cell.x, cell.y) ?? "";
const choose = async (s: Setup, reference: string, path = reference.replace(/\\/g, "/").replace(/\d+$/, ""), extra: object = {}): Promise<void> => {
  await act(() => s.session.update({ selection: { kind: "tiles", path, reference, label: reference, boardTile: reference, stamp: null, ...extra } as never }));
};
const keyboard = (s: Setup, init: KeyboardEventInit): Promise<void> | void => act(() => { s.el.querySelector("section.tkr-board")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const openSource = async (s: Setup, path: string): Promise<void> => {
  const select = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select")!;
  await act(() => { select.value = path; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
};

test("the Autotile toggle starts off, follows A, and says what it does while on", async () => {
  const s = await setup();
  equal(toggle(s).getAttribute("aria-pressed"), "false");
  match(toggle(s).textContent ?? "", /Autotile \(A\): off/);
  equal(notes(s).length, 0, "nothing is said about autotiling while it is off");
  await keyboard(s, { key: "a" });
  equal(toggle(s).getAttribute("aria-pressed"), "true");
  match(toggle(s).textContent ?? "", /Autotile \(A\): on/);
  match(text(s), /Autotiling is on for Draw and Erase, Fill and Rectangle on this board only/);
  match(text(s), /Hold Shift to reshape only the set you are painting/);
  await act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true })); });
  match(text(s), /Shift is held: only cells of the set you are painting reshape/);
  await act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", shiftKey: false })); });
  match(text(s), /Hold Shift to reshape only/);
  s.dispose();
});

test("a recognised set paints and reshapes through the view; an ordinary set is warned about and painted as it is", async () => {
  const s = await setup();
  await keyboard(s, { key: "a" });
  await choose(s, "Tiles\\village.tst3");
  ok(notes(s).some((note) => /not an autotile set/.test(note)), "the ordinary set is named as such");
  await click(s, s.centre);
  equal(tileAt(s, s.centre), "Tiles\\village.tst3");
  await choose(s, "Tiles\\AUTOTILES_village.tst3", undefined, { autotileTileCount: 52 });
  equal(notes(s).filter((note) => /not an autotile set|fewer than 52/.test(note)).length, 0);
  await click(s, { x: s.centre.x + 1, y: s.centre.y + 1 });
  await click(s, { x: s.centre.x + 2, y: s.centre.y + 1 });
  equal(tileAt(s, { x: s.centre.x + 1, y: s.centre.y + 1 }), "Tiles\\AUTOTILES_village.tst48");
  equal(tileAt(s, { x: s.centre.x + 2, y: s.centre.y + 1 }), "Tiles\\AUTOTILES_village.tst50");
  equal(tileAt(s, s.centre), "Tiles\\village.tst3", "the ordinary tile beside it is kept");
  s.dispose();
});

test("a set in a sub-folder is recognised in any letter case, and a short set names the shapes it is missing", async () => {
  const s = await setup();
  await keyboard(s, { key: "a" });
  await choose(s, "Tiles\\nested\\autotiles_Marsh.tst1", undefined, { autotileTileCount: 9 });
  const shown = notes(s).join(" ");
  match(shown, /fewer than 52, so shapes 10, 11, 12/);
  ok(!/not an autotile set/.test(shown));
  await click(s, s.centre);
  equal(tileAt(s, s.centre), "Tiles\\nested\\autotiles_Marsh.tst51");
  s.dispose();
});

test("a square set on an isometric board is warned about and still paints", async () => {
  const s = await setup("iso-stacked");
  await keyboard(s, { key: "a" });
  await choose(s, "Tiles\\AUTOTILES_village.tst1", undefined, { autotileTileCount: 52 });
  match(notes(s).join(" "), /square autotile set is on a isometric board/);
  await click(s, s.centre);
  equal(tileAt(s, s.centre), "Tiles\\AUTOTILES_village.tst51");
  s.dispose();
});

test("the tileset browser says whether a set is an autotile set and previews its 47 shapes from its own tiles, gaps included", async () => {
  const s = await setup();
  await openSource(s, "Tiles/AUTOTILES_village.tst");
  const section = s.el.querySelector(".tkr-tileset-browser-autotile")!;
  match(section.textContent ?? "", /recognised by its AUTOTILES_ file name/);
  const slots = [...section.querySelectorAll("[data-autotile-slot-item]")];
  equal(slots.length, 47);
  const drawn = section.querySelectorAll("canvas[data-autotile-slot]").length;
  const gaps = section.querySelectorAll(".tkr-tileset-browser-autotile-gap").length;
  equal(drawn + gaps, 47, "every shape is a drawn tile or a visible gap");
  ok(drawn > 0, "tiles are drawn from the set itself");
  if (gaps > 0) match(section.textContent ?? "", /fewer than 52/);
  equal(slots[0]!.getAttribute("aria-label"), "Slot 1: N E S W + corner NE SE SW");
  await openSource(s, "Tiles/village.tst");
  const ordinary = s.el.querySelector(".tkr-tileset-browser-autotile")!;
  match(ordinary.textContent ?? "", /Ordinary tileset/);
  equal(ordinary.querySelectorAll("[data-autotile-slot-item]").length, 0);
  s.dispose();
});

test("marking an ordinary set uses the legacy order for it and can be undone by clearing the mark", async () => {
  const s = await setup();
  await openSource(s, "Tiles/village.tst");
  const check = (): HTMLInputElement => s.el.querySelector<HTMLInputElement>(".tkr-tileset-browser-autotile input[type=checkbox]")!;
  equal(check().checked, false);
  await act(() => { check().click(); });
  await settle();
  equal(s.session.getSnapshot().selection?.autotile, "legacy-52");
  equal(check().checked, true);
  match(s.el.querySelector(".tkr-tileset-browser-autotile")?.textContent ?? "", /Marked as a legacy 52-slot autotile set/);
  await keyboard(s, { key: "a" });
  await click(s, s.centre);
  equal(tileAt(s, s.centre), "village.tst51", "the marked set's isolated shape, from the set that was marked");
  await act(() => { check().click(); });
  await settle();
  equal(s.session.getSnapshot().selection?.autotile, undefined);
  s.dispose();
});
