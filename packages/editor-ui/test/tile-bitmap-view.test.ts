// The tile bitmap editor of story 12.8 over the real model and the in-memory platform-services double, under the same DOM
// shim as the board view. Assertions are on the DOM and on bytes; expected bytes are written by hand from the stored layout.
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createDocumentIdentity,
  openTileBitmapDocument,
  previewTileBitmap,
  tileBitmapCellAt,
  type TileBitmapDocument,
} from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { TILE_BITMAP_MAGIC, writeTileBitmap, type TileBitmap, type TileBitmapCell } from "@tk-reawakened/editor-model/testing";
import { createBrowserSession, type BrowserSession } from "../dist/brush.js";
import type { TileBitmapViewDocument, ViewHandle } from "../src/mount.ts";
import type { TilesetBrowserContext } from "../src/tileset-browser.tsx";
import { exampleTileset } from "./fixtures.ts";

const PATH = "Bitmap/house.tbm";
const identity = createDocumentIdentity("memory-project", PATH);

let mount: typeof import("../src/index.ts").mount;
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});

after(() => GlobalRegistrator.unregister());

const EMPTY: TileBitmapCell = { tile: "", r: 0, g: 0, b: 0 };

/** A bitmap with the given drawn cells and a stored extra column and row that holds `padding`. */
function bitmap(width: number, height: number, drawn: (x: number, y: number) => TileBitmapCell, padding: TileBitmapCell = EMPTY): TileBitmap {
  const cells: TileBitmapCell[] = [];
  for (let x = 0; x <= width; x += 1) for (let y = 0; y <= height; y += 1) cells.push(x < width && y < height ? drawn(x, y) : padding);
  return { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width, height, cells, residue: Uint8Array.from([9, 9]) };
}

const bytesOf = (model: TileBitmap): Uint8Array => {
  const written = writeTileBitmap(model);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
};

/** A 2 × 2 bitmap: one drawn, shaded cell, the rest empty; the extra row and column hold a tile of their own. */
const PAD: TileBitmapCell = { tile: "pad.gph", r: 1, g: 2, b: 3 };
const START = bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? { tile: "village.tst1", r: 5, g: 6, b: 7 } : EMPTY), PAD);

interface Setup {
  readonly host: MemoryPlatformServices;
  readonly doc: TileBitmapDocument;
  readonly view: TileBitmapViewDocument;
  readonly browser: TilesetBrowserContext;
  readonly session: BrowserSession;
  readonly el: HTMLElement;
  /** While `holding`, edits wait here and reach the document only when released, as a host's slow answer does. */
  readonly gate: { holding: boolean; readonly queue: (() => void)[] };
}

async function setup(bytes: Uint8Array = bytesOf(START), extra: Readonly<Record<string, Uint8Array>> = {}): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes, "Tiles/village.tst": exampleTileset(), ...extra } });
  const opened = await openTileBitmapDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  const doc = opened.document;
  const gate: Setup["gate"] = { holding: false, queue: [] };
  const view: TileBitmapViewDocument = {
    kind: doc.kind,
    identity: doc.identity,
    getSnapshot: () => doc.getSnapshot(),
    subscribe: (listener) => doc.subscribe(listener),
    apply: (command) => {
      if (!gate.holding) return doc.apply(command);
      return new Promise((resolve) => { gate.queue.push(() => resolve(doc.apply(command))); });
    },
    save: () => doc.save(),
    resolveConflict: (choice) => doc.resolveConflict(choice),
    preview: () => previewTileBitmap(host.fs, "memory-project", doc.serialize()),
  };
  const session = createBrowserSession();
  const el = document.createElement("div");
  document.body.append(el);
  return { host, doc, view, session, browser: { session, fs: host.fs, layout: { projectFolder: "" } }, el, gate };
}

async function show(s: Setup, browser: TilesetBrowserContext | undefined = s.browser): Promise<ViewHandle> {
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(s.el, { document: s.view, services: s.host, ...(browser === undefined ? {} : { browser }) });
  });
  await until(() => {
    const drawn = s.el.querySelector('canvas[role="img"]') !== null || (s.el.querySelector(".tkr-bitmap-preview-state")?.textContent ?? "").startsWith("No picture");
    return drawn && (browser === undefined || s.el.querySelector(".tkr-tileset-browser-item") !== null);
  });
  if (handle === undefined) throw new Error("mount returned nothing");
  return handle;
}

/** Let the picture and the browser's asynchronous listing arrive. */
async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
}

const cell = (el: HTMLElement, column: number, row: number): HTMLButtonElement => {
  const found = el.querySelector<HTMLButtonElement>(`[aria-label^="Column ${column}, row ${row}:"]`);
  if (found === null) throw new Error(`no cell at column ${column}, row ${row}`);
  return found;
};
const control = <Element extends HTMLElement>(el: HTMLElement, selector: string): Element => {
  const found = el.querySelector<Element>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};
const tool = (el: HTMLElement, name: "select" | "draw" | "erase"): HTMLButtonElement => control(el, `.tkr-bitmap-tool-${name}`);
const alerts = (el: HTMLElement): string[] => [...el.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
const state = (el: HTMLElement): string => el.querySelector(".tkr-bitmap-state")?.textContent ?? "";

async function type(input: HTMLInputElement, value: string, event: "change" | "enter" = "change"): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    if (event === "enter") input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    else input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Wait, a few turns at a time, until `done` holds: the browser lists and previews its sources asynchronously. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !done(); turn += 1) await settle(1);
}

/** Choose the browser's tile `reference` as the brush, as a person clicks it. */
async function chooseTile(s: Setup, reference: string): Promise<void> {
  const button = s.el.querySelector<HTMLButtonElement>(`[data-browser-reference="${reference}"] .tkr-tileset-browser-source`);
  if (button === null) throw new Error(`the browser lists no ${reference}: ${s.el.querySelector(".tkr-tileset-browser")?.textContent}`);
  await act(() => button.click());
}

test("the view names the bitmap, shows its size, every cell with its tile and shade, the picture, and a saved state", async () => {
  const s = await setup();
  await show(s);
  equal(s.el.querySelector("h2")?.textContent, "Tile bitmap");
  match(s.el.querySelector(".tkr-bitmap-summary")?.textContent ?? "", /2 × 2 tiles, 64 × 64 pixels/);
  equal(s.el.querySelectorAll('[role="gridcell"]').length, 4, "only drawn cells, never the stored extra row and column");
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade 5, 6, 7");
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-width").value, "2");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-height").value, "2");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g").value, "6", "the shade fields show the selected cell");
  ok(s.el.querySelector('canvas[role="img"]') !== null, "the engine's picture is shown");
  ok(s.el.querySelector(".tkr-tileset-browser") !== null, "the shared tileset browser is the tile palette");
  equal(state(s.el), "All changes saved");
  equal(control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").disabled, true);
  deepEqual(alerts(s.el), []);
});

test("choosing a tile in the browser changes nothing; Draw puts it on a cell, Erase empties it, and Save and reopen keep the shade", async () => {
  const s = await setup();
  await show(s);
  await chooseTile(s, "village.tst2");
  equal(s.doc.getSnapshot().dirty, false, "selection alone never edits the bitmap");
  match(control(s.el, ".tkr-bitmap-brush").textContent ?? "", /Brush: village\.tst tile 2/);

  await act(() => cell(s.el, 2, 2).click());
  equal(s.doc.getSnapshot().dirty, false, "with the Select tool a click only selects");
  equal(cell(s.el, 2, 2).getAttribute("tabindex"), "0");

  await act(() => tool(s.el, "draw").click());
  await act(() => cell(s.el, 2, 2).click());
  equal(cell(s.el, 2, 2).getAttribute("aria-label"), "Column 2, row 2: village.tst2");
  await act(() => cell(s.el, 1, 1).click());
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst2, shade 5, 6, 7", "drawing keeps the cell's shade");
  equal(state(s.el), "Unsaved changes");

  await act(() => tool(s.el, "erase").click());
  await act(() => cell(s.el, 2, 2).click());
  equal(cell(s.el, 2, 2).getAttribute("aria-label"), "Column 2, row 2: empty");
  deepEqual(s.host.bytesOf(PATH), bytesOf(START), "nothing is written before Save");

  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").click());
  await settle();
  equal(state(s.el), "All changes saved");
  deepEqual(
    s.host.bytesOf(PATH),
    bytesOf(bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? { tile: "village.tst2", r: 5, g: 6, b: 7 } : EMPTY), PAD)),
    "the file holds exactly the one drawn cell; the extra row and column and the other bytes are the file's own",
  );

  const reopened = await openTileBitmapDocument(s.host.fs, identity);
  ok(reopened.ok);
  deepEqual(tileBitmapCellAt(reopened.document.getSnapshot(), 0, 0), { tile: "village.tst2", r: 5, g: 6, b: 7 });
});

test("Draw explains what it needs when no tile is chosen or a whole stamp is, and changes nothing", async () => {
  const s = await setup();
  await show(s);
  await act(() => tool(s.el, "draw").click());
  await act(() => cell(s.el, 2, 2).click());
  match(alerts(s.el)[0] ?? "", /Choose a tile in the tileset browser first/);
  equal(s.doc.getSnapshot().dirty, false);

  s.session.update({ selection: { kind: "bitmaps", path: PATH, reference: "house.tbm", label: "house.tbm", boardTile: null, stamp: { width: 2, height: 2 } } });
  await settle(2);
  match(control(s.el, ".tkr-bitmap-brush").textContent ?? "", /A whole stamp \(2 × 2 tiles\) is chosen/);
  await act(() => cell(s.el, 1, 2).click());
  match(alerts(s.el)[0] ?? "", /whole stamp, not a single tile/);
  equal(s.doc.getSnapshot().dirty, false);
});

test("the grid is one tab stop that moves with the arrow keys, and Delete erases the selected cell", async () => {
  const s = await setup();
  await show(s);
  equal(s.el.querySelectorAll('.tkr-bitmap-cell[tabindex="0"]').length, 1);
  await act(() => { cell(s.el, 1, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })); });
  await act(() => { cell(s.el, 2, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  equal(cell(s.el, 2, 2).getAttribute("tabindex"), "0");
  equal(cell(s.el, 1, 1).getAttribute("tabindex"), "-1");
  await act(() => { cell(s.el, 2, 2).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  equal(cell(s.el, 2, 2).getAttribute("tabindex"), "0", "the selection stops at the edge");
  await act(() => { cell(s.el, 1, 1).click(); });
  await act(() => { cell(s.el, 1, 1).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: empty, shade 5, 6, 7", "Delete empties the tile and keeps the shade");
});

test("shading: the number fields, hue picker, lightness slider and Remove shade each change one cell's shade", async () => {
  const s = await setup();
  await show(s);
  await act(() => cell(s.el, 2, 1).click());
  await type(control(s.el, ".tkr-bitmap-shade-r"), "-255");
  await type(control(s.el, ".tkr-bitmap-shade-g"), "255", "enter");
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty, shade -255, 255, 0");
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade 5, 6, 7", "another cell is untouched");

  await type(control(s.el, ".tkr-bitmap-hue"), "#ff8000");
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty, shade 254, 0, -255", "the hue picker sets 2 × (channel − 128), limited to -255");

  await type(control(s.el, ".tkr-bitmap-lightness"), "10");
  // lightness of (254, 0, -255) is 0; moving to 10 shifts every channel by 10, each limited to -255…255.
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty, shade 255, 10, -245");

  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-shade-reset").click());
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty");
  equal(s.doc.getSnapshot().edits.length, 5);

  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").click());
  await settle();
  deepEqual(s.host.bytesOf(PATH), bytesOf(START), "an edit and its exact opposite leave the file as it was");
});

test("a shade outside -255…255 or not a number is refused with the reason and leaves the bitmap unchanged", async () => {
  const s = await setup();
  await show(s);
  await type(control(s.el, ".tkr-bitmap-shade-b"), "300");
  match(alerts(s.el)[0] ?? "", /Each shade is a whole number from -255 to 255/);
  equal(s.doc.getSnapshot().dirty, false);
  await type(control(s.el, ".tkr-bitmap-shade-b"), "");
  match(alerts(s.el)[0] ?? "", /Each shade is a number from -255 to 255/);
  equal(s.doc.getSnapshot().dirty, false);
});

test("resizing keeps the cells that stay and adds empty ones, refuses sizes outside 1 to 40, and the saved file keeps its size", async () => {
  const s = await setup();
  await show(s);
  await type(control(s.el, ".tkr-bitmap-width"), "3");
  match(s.el.querySelector(".tkr-bitmap-summary")?.textContent ?? "", /3 × 2 tiles, 96 × 64 pixels/);
  equal(s.el.querySelectorAll('[role="gridcell"]').length, 6);
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade 5, 6, 7");
  equal(cell(s.el, 3, 2).getAttribute("aria-label"), "Column 3, row 2: empty");

  await type(control(s.el, ".tkr-bitmap-height"), "41");
  match(alerts(s.el)[0] ?? "", /1 to 40 tiles/);
  match(s.el.querySelector(".tkr-bitmap-summary")?.textContent ?? "", /3 × 2 tiles/);

  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").click());
  await settle();
  const reopened = await openTileBitmapDocument(s.host.fs, identity);
  ok(reopened.ok);
  equal(reopened.document.getSnapshot().width, 3);
  equal(reopened.document.getSnapshot().height, 2);
  deepEqual(tileBitmapCellAt(reopened.document.getSnapshot(), 0, 0), { tile: "village.tst1", r: 5, g: 6, b: 7 });
});

test("the tile field takes a typed reference, the grid switch and Redraw are view-only, and a missing tile is named without hiding the rest", async () => {
  const s = await setup(bytesOf(bitmap(1, 1, () => ({ tile: "gone.tst1", r: 0, g: 0, b: 0 }))));
  await show(s);
  const warnings = [...s.el.querySelectorAll(".tkr-bitmap-warnings li")].map((node) => node.textContent ?? "");
  equal(warnings.length, 1);
  match(warnings[0] ?? "", /gone\.tst1/);

  await type(control(s.el, ".tkr-bitmap-tile"), "village.tst2", "enter");
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst2");
  await until(() => s.el.querySelectorAll(".tkr-bitmap-warnings li").length === 0);
  equal(s.el.querySelectorAll(".tkr-bitmap-warnings li").length, 0, "the picture follows the edit");

  const dirty = s.doc.getSnapshot().edits.length;
  await act(() => control<HTMLInputElement>(s.el, ".tkr-bitmap-grid-switch input").click());
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-redraw").click());
  await settle(2);
  equal(s.doc.getSnapshot().edits.length, dirty, "the grid switch and Redraw never edit the document");
});

test("a tile bitmap in the browser is a whole stamp brush that carries its size and edits nothing", async () => {
  const stamp = bytesOf(bitmap(3, 2, () => EMPTY));
  const s = await setup(bytesOf(START), { "Bitmap/stamp.tbm": stamp });
  await show(s);
  const source = control<HTMLSelectElement>(s.el, ".tkr-tileset-browser select");
  await act(async () => {
    source.value = "Bitmap/stamp.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await until(() => s.el.querySelector(".tkr-tileset-browser-select-brush")?.textContent === "Select stamp brush");
  const brush = control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-select-brush");
  equal(brush.textContent, "Select stamp brush");
  await act(() => brush.click());
  deepEqual(s.session.getSnapshot().selection, { kind: "bitmaps", path: "Bitmap/stamp.tbm", reference: "stamp.tbm", label: "stamp.tbm", boardTile: null, stamp: { width: 3, height: 2 } });
  equal(s.doc.getSnapshot().dirty, false);
  deepEqual(s.host.bytesOf("Bitmap/stamp.tbm"), stamp, "choosing a stamp never changes its file");
});

test("a host with a tab to open makes 'Edit tile bitmap' open the source, and the browser says when it cannot", async () => {
  const stamp = bytesOf(bitmap(1, 1, () => EMPTY));
  const s = await setup(bytesOf(START), { "Bitmap/stamp.tbm": stamp });
  const opened: string[] = [];
  const browser: TilesetBrowserContext = { ...s.browser, openSource: async (path) => { opened.push(path); return path === "Bitmap/stamp.tbm" ? "it is locked" : null; } };
  await show(s, browser);
  const source = control<HTMLSelectElement>(s.el, ".tkr-tileset-browser select");
  await act(async () => {
    source.value = "Bitmap/stamp.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await until(() => s.el.querySelector(".tkr-tileset-browser-select-brush")?.textContent === "Select stamp brush");
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-item button:last-of-type").click());
  const edit = [...s.el.querySelectorAll<HTMLButtonElement>(".tkr-tileset-browser-menu button")].find((button) => button.textContent === "Edit tile bitmap");
  ok(edit !== undefined, "the menu offers Edit tile bitmap");
  await act(() => edit.click());
  await settle(2);
  deepEqual(opened, ["Bitmap/stamp.tbm"]);
  match(s.el.querySelector(".tkr-tileset-browser-message")?.textContent ?? "", /Cannot open Bitmap\/stamp\.tbm: it is locked/);
});

test("undo through the host restores the cell and the saved state", async () => {
  const s = await setup();
  await show(s);
  await chooseTile(s, "village.tst2");
  await act(() => tool(s.el, "draw").click());
  await act(() => cell(s.el, 2, 2).click());
  const edit = s.doc.getSnapshot().edits.at(-1);
  ok(edit !== undefined);
  await act(() => { s.doc.undo(edit.editId); });
  equal(cell(s.el, 2, 2).getAttribute("aria-label"), "Column 2, row 2: empty");
  equal(state(s.el), "All changes saved");
});

test("a tile bitmap naming a tile the project lacks is still a stamp brush with its edit action, so it can be repaired", async () => {
  const broken = bytesOf(bitmap(2, 1, (x) => (x === 0 ? { tile: "gone.tst1", r: 0, g: 0, b: 0 } : { tile: "village.tst1", r: 0, g: 0, b: 0 })));
  const s = await setup(bytesOf(START), { "Bitmap/broken.tbm": broken });
  const opened: string[] = [];
  const browser: TilesetBrowserContext = { ...s.browser, openSource: async (path) => { opened.push(path); return null; } };
  await show(s, browser);
  const source = control<HTMLSelectElement>(s.el, ".tkr-tileset-browser select");
  await act(async () => {
    source.value = "Bitmap/broken.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await until(() => s.el.querySelector(".tkr-tileset-browser-select-brush")?.textContent === "Select stamp brush");
  const brush = control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-select-brush");
  equal(brush.disabled, false, "a missing tile does not take the source's actions away");
  match(s.el.querySelector(".tkr-tileset-browser-message")?.textContent ?? "", /2 × 1 tiles.*A tile it names is missing from the project \(gone\.tst1\).*open it to repair/);
  await act(() => brush.click());
  deepEqual(s.session.getSnapshot().selection?.stamp, { width: 2, height: 1 });
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-item button:last-of-type").click());
  const edit = [...s.el.querySelectorAll<HTMLButtonElement>(".tkr-tileset-browser-menu button")].find((button) => button.textContent === "Edit tile bitmap");
  ok(edit !== undefined && !edit.disabled);
  await act(() => edit.click());
  await settle(2);
  deepEqual(opened, ["Bitmap/broken.tbm"]);
});

test("a late answer to one shade field's edit never wipes what is typed in another, and edits sent meanwhile all land", async () => {
  const s = await setup();
  await show(s);
  const release = async (): Promise<void> => {
    const queued = s.gate.queue.splice(0);
    await act(() => { for (const apply of queued) apply(); });
    await settle(2);
  };
  s.gate.holding = true;
  await type(control(s.el, ".tkr-bitmap-shade-r"), "-255");
  equal(s.doc.getSnapshot().dirty, false, "the first edit is still waiting for the host");
  // Start typing in Green (not yet committed) while Red's answer is outstanding, then let Red's answer arrive.
  await act(() => {
    const green = control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g");
    green.value = "77";
    green.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await release();
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 6, 7", "Red landed");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g").value, "77", "Red's answer did not replace Green's unsent text");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-r").value, "-255");

  // Commit Green and Blue while both answers are held: neither undoes the other or Red.
  await act(() => { control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g").dispatchEvent(new Event("change", { bubbles: true })); });
  await type(control(s.el, ".tkr-bitmap-shade-b"), "-9");
  equal(s.gate.queue.length, 2);
  await release();
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 77, -9");

  s.gate.holding = false;
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").click());
  await settle();
  deepEqual(
    s.host.bytesOf(PATH),
    bytesOf(bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? { tile: "village.tst1", r: -255, g: 77, b: -9 } : EMPTY), PAD)),
    "the saved cell holds all three edits",
  );

  // Undo changes the document under the fields: an untouched field follows it.
  const edit = s.doc.getSnapshot().edits.at(-1);
  ok(edit !== undefined);
  await act(() => { s.doc.undo(edit.editId); });
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-b").value, "7", "the untouched Blue field follows the undo back to the file's own 7");
});

test("after overlapping held edits are answered and one is undone, the next edit starts from the document, not the undone value", async () => {
  const s = await setup();
  await show(s);
  s.gate.holding = true;
  await type(control(s.el, ".tkr-bitmap-shade-r"), "-255");
  await type(control(s.el, ".tkr-bitmap-shade-g"), "77");
  equal(s.gate.queue.length, 2, "both edits are outstanding at once");
  const queued = s.gate.queue.splice(0);
  await act(() => { for (const apply of queued) apply(); });
  await settle(2);
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 77, 7");

  s.gate.holding = false;
  const green = s.doc.getSnapshot().edits.at(-1);
  ok(green !== undefined);
  await act(() => { s.doc.undo(green.editId); });
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 6, 7", "the green edit is undone");

  await type(control(s.el, ".tkr-bitmap-shade-b"), "9");
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 6, 9", "a different channel's edit does not bring the undone green back");
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-bitmap-save").click());
  await settle();
  deepEqual(
    s.host.bytesOf(PATH),
    bytesOf(bitmap(2, 2, (x, y) => (x === 0 && y === 0 ? { tile: "village.tst1", r: -255, g: 6, b: 9 } : EMPTY), PAD)),
    "the saved cell is the document's, not the undone value",
  );
});

test("a shade edit still waiting on one cell is not lost when another cell is edited and the first is selected again", async () => {
  const s = await setup();
  await show(s);
  s.gate.holding = true;
  await type(control(s.el, ".tkr-bitmap-shade-r"), "-255");
  await act(() => cell(s.el, 2, 1).click());
  await type(control(s.el, ".tkr-bitmap-shade-b"), "9");
  await act(() => cell(s.el, 1, 1).click());
  await type(control(s.el, ".tkr-bitmap-shade-g"), "77");
  equal(s.gate.queue.length, 3);
  const queued = s.gate.queue.splice(0);
  s.gate.holding = false;
  await act(() => { for (const apply of queued) apply(); });
  await settle(2);
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 77, 7", "the later Green edit kept the earlier, still-waiting Red");
  equal(cell(s.el, 2, 1).getAttribute("aria-label"), "Column 2, row 1: empty, shade 0, 0, 9");
});

test("a shortcut's answer clears only what was typed when it was sent, never a newer draft", async () => {
  const s = await setup();
  await show(s);
  s.gate.holding = true;
  await type(control(s.el, ".tkr-bitmap-hue"), "#ff8000");
  await act(() => {
    const green = control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g");
    green.value = "55";
    green.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const queued = s.gate.queue.splice(0);
  s.gate.holding = false;
  await act(() => { for (const apply of queued) apply(); });
  await settle(2);
  equal(cell(s.el, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade 254, 0, -255");
  equal(control<HTMLInputElement>(s.el, ".tkr-bitmap-shade-g").value, "55", "Green typed after the shortcut was sent is still being typed");
});

test("a tile bitmap with no cells is no stamp but keeps its edit action, and choosing nothing changes nothing", async () => {
  const empty = bytesOf({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: -1, height: -1, cells: [], residue: new Uint8Array() });
  const s = await setup(bytesOf(START), { "Bitmap/empty.tbm": empty });
  const opened: string[] = [];
  const browser: TilesetBrowserContext = { ...s.browser, openSource: async (path) => { opened.push(path); return null; } };
  await show(s, browser);
  const source = control<HTMLSelectElement>(s.el, ".tkr-tileset-browser select");
  await act(async () => {
    source.value = "Bitmap/empty.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await until(() => /no cells/.test(s.el.querySelector(".tkr-tileset-browser-message")?.textContent ?? ""));
  equal(control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-select-brush").disabled, true);
  await act(() => control<HTMLButtonElement>(s.el, ".tkr-tileset-browser-item button:last-of-type").click());
  const menu = [...s.el.querySelectorAll<HTMLButtonElement>(".tkr-tileset-browser-menu button")];
  equal(menu.find((button) => button.textContent === "Select as stamp brush")?.disabled, true);
  const edit = menu.find((button) => button.textContent === "Edit tile bitmap");
  ok(edit !== undefined && !edit.disabled);
  await act(() => edit.click());
  await settle(2);
  deepEqual(opened, ["Bitmap/empty.tbm"]);
  equal(s.session.getSnapshot().selection, null);
});
