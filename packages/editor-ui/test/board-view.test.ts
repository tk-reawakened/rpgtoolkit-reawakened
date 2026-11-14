// The board view of story 12.1 over the real board model and the in-memory platform-services double, under the same DOM
// shim as the settings view. Assertions are on the DOM and on bytes, not on Preact internals.
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { boardTileAt, createDocumentIdentity, openBoardDocument, previewBoard, type BoardDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { assetKey, BinaryReader, compositeTileBitmap, decodeTileTexture, readTileset, TILE_ANIMATION_MAGIC, TILE_BITMAP_MAGIC, readTileBitmap, writeTileAnimation, writeTileBitmap, type TileAnimation, type TileBitmap } from "@tk-reawakened/editor-model/testing";
import { createBrowserSession, type BrowserSession } from "../dist/brush.js";
import type { BoardViewDocument, ViewHandle } from "../src/mount.ts";
import type { TilesetBrowserContext } from "../src/tileset-browser.tsx";
import { exampleBoard, exampleTileset } from "./fixtures.ts";

const PATH = "Boards/village.brd";
const identity = createDocumentIdentity("memory-project", PATH);

let mount: typeof import("../src/index.ts").mount;
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
  readonly browser: TilesetBrowserContext;
  readonly el: HTMLElement;
}

async function setup(
  bytes: Uint8Array = exampleBoard(),
  session: BrowserSession = createBrowserSession(),
  extraFiles: Readonly<Record<string, Uint8Array>> = {},
): Promise<Setup> {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes, "Tiles/village.tst": exampleTileset(), ...extraFiles } });
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
  return { host, doc, view, browser: { session, fs: host.fs, layout: { projectFolder: "" } }, el };
}

async function show(s: Setup, browser: TilesetBrowserContext = s.browser): Promise<ViewHandle> {
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(s.el, { document: s.view, services: s.host, browser });
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
  const theirs = (s.host.bytesOf(PATH) ?? new Uint8Array()).slice();
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
test("brush choice is retained per project, never paints on selection, and paints only the active board", async () => {
  const session = createBrowserSession();
  const first = await setup(exampleBoard(), session);
  const second = await setup(exampleBoard(), session);
  const otherProject = await setup(exampleBoard(), createBrowserSession());
  const firstHandle = await show(first);
  const secondHandle = await show(second);
  const otherHandle = await show(otherProject);
  const before = boardTileAt(first.doc.getSnapshot(), 0, 0, 0);
  await act(() => session.update({ selection: { kind: "tiles", path: "Tiles/village.tst", reference: "village.tst2", label: "village.tst tile 2", boardTile: "village.tst2" } }));
  equal(boardTileAt(first.doc.getSnapshot(), 0, 0, 0), before, "selection alone never changes either board");
  equal(boardTileAt(second.doc.getSnapshot(), 0, 0, 0), before);
  equal(otherProject.el.querySelector<HTMLButtonElement>(".tkr-board-brush")?.disabled, true, "another project does not inherit the brush");
  const paint = second.el.querySelector<HTMLButtonElement>(".tkr-board-brush");
  ok(paint !== null);
  ok(!paint.disabled, `brush action should be enabled: ${paint.textContent}`);
  await act(async () => { paint.click(); await Promise.resolve(); });
  equal(boardTileAt(second.doc.getSnapshot(), 0, 0, 0), "village.tst2");
  equal(boardTileAt(first.doc.getSnapshot(), 0, 0, 0), before, "painting targets only the board whose action was invoked");
  firstHandle.dispose();

  secondHandle.dispose();
  otherHandle.dispose();
});
test("L from the focused board cell opens the retained tileset browser without changing the board", async () => {
  const s = await setup();
  const handle = await show(s);
  const active = cell(s.el, 1, 1);
  const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(source !== null);
  active.focus();
  active.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
  equal(document.activeElement, source, "L moves keyboard focus into the visible browser source selector");
  equal(s.doc.getSnapshot().dirty, false, "opening the browser does not paint or edit the board");
  handle.dispose();
});

test("mounted browser views share source and scroll changes through their project session", async () => {
  const session = createBrowserSession();
  const extraFiles = { "Tiles/other.tst": exampleTileset() };
  const first = await setup(exampleBoard(), session, extraFiles);
  const second = await setup(exampleBoard(), session, extraFiles);
  const firstHandle = await show(first);
  const secondHandle = await show(second);
  const firstSource = first.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  const secondSource = second.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(firstSource !== null && secondSource !== null);
  await act(async () => {
    firstSource.value = "Tiles/other.tst";
    firstSource.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  for (let turn = 0; turn < 100 && !second.el.textContent?.includes("other.tst tile 1"); turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  equal(secondSource.value, "Tiles/other.tst");
  ok(second.el.textContent?.includes("other.tst tile 1"), "the already-mounted second view loads the retained source");
  const firstList = first.el.querySelector<HTMLElement>(".tkr-tileset-browser-list");
  const secondList = second.el.querySelector<HTMLElement>(".tkr-tileset-browser-list");
  ok(firstList !== null && secondList !== null);
  await act(() => {
    firstList.scrollTop = 41;
    firstList.dispatchEvent(new Event("scroll"));
  });
  equal(secondList.scrollTop, 41, "an already-mounted split view receives the shared scroll position");
  equal(first.doc.getSnapshot().dirty, false);
  equal(second.doc.getSnapshot().dirty, false);
  firstHandle.dispose();
  secondHandle.dispose();
});
test("a stale asset read cannot replace the selected source, and source plus scroll context survive remount", async () => {
  const slowPath = "Tiles/a-slow.tst";
  const fastPath = "Tiles/b-fast.tst";
  const s = await setup(exampleBoard(), createBrowserSession(), {
    [slowPath]: exampleTileset(),
    [fastPath]: exampleTileset(),
  });
  let releaseSlow!: () => void;
  let markSlowStarted!: () => void;
  const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
  const browser: TilesetBrowserContext = {
    ...s.browser,
    fs: {
      list: (path) => s.host.fs.list(path),
      read: async (path) => {
        if (path === slowPath) {
          markSlowStarted();
          await slowGate;
        }
        return s.host.fs.read(path);
      },
    },
  };
  const handle = await show(s, browser);
  await slowStarted;
  const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(source !== null);
  await act(async () => {
    source.value = fastPath;
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  match(s.el.querySelector(".tkr-tileset-browser-item")?.textContent ?? "", /b-fast\.tst tile 1/);
  releaseSlow();
  await act(async () => { await Promise.resolve(); });
  await new Promise<void>((resolve) => setImmediate(resolve));
  match(s.el.querySelector(".tkr-tileset-browser-item")?.textContent ?? "", /b-fast\.tst tile 1/, "the stale slow read cannot replace the fast source");

  const list = s.el.querySelector<HTMLElement>(".tkr-tileset-browser-list");
  ok(list !== null);
  await act(() => {
    list.scrollTop = 37;
    list.dispatchEvent(new Event("scroll"));
  });
  equal(s.browser.session.getSnapshot().path, fastPath);
  equal(s.browser.session.getSnapshot().scrollTop, 37);
  handle.dispose();
  await show(s, browser);
  equal(s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select")?.value, fastPath, "the active source is restored when the board view remounts");
  equal(s.el.querySelector<HTMLElement>(".tkr-tileset-browser-list")?.scrollTop, 37, "the browser scroll position is restored");
});
test("animated tiles are selectable brushes while tile bitmaps stay browse-only with an explained edit limit", async () => {
  const animation: TileAnimation = {
    magic: TILE_ANIMATION_MAGIC,
    major: 2,
    minor: 0,
    speed: 5,
    frameCount: 1,
    frames: ["village.tst2"],
  };
  const bitmap: TileBitmap = {
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 1,
    height: 1,
    cells: [
      { tile: "village.tst2", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  };
  const animationBytes = writeTileAnimation(animation);
  const bitmapBytes = writeTileBitmap(bitmap);
  ok(animationBytes.ok);
  ok(bitmapBytes.ok);
  const s = await setup(exampleBoard(), createBrowserSession(), {
    "Tiles/walk.tan": animationBytes.value,
    "Bitmap/portrait.tbm": bitmapBytes.value,
  });
  await show(s);
  const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(source !== null);
  await act(async () => {
    source.value = "Tiles/walk.tan";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const animationBrush = s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-select-brush");
  ok(animationBrush !== null && !animationBrush.disabled);
  match(s.el.querySelector('[role="alert"]')?.textContent ?? "", /Animated tile: 1 frames at 200 ms per frame/);
  await act(() => animationBrush.click());
  equal(s.browser.session.getSnapshot().selection?.reference, "walk.tan");
  equal(s.doc.getSnapshot().dirty, false, "animation selection does not edit the board");

  await act(async () => {
    source.value = "Bitmap/portrait.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  for (let turn = 0; turn < 100 && s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-select-brush")?.disabled !== true; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const bitmapBrush = s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-select-brush");
  ok(bitmapBrush !== null && bitmapBrush.disabled, `a bitmap is available to browse but not as a board brush; source=${source.value}, options=${[...source.options].map((option) => option.value).join(",")}, item=${s.el.querySelector(".tkr-tileset-browser-item")?.textContent}, message=${s.el.querySelector(".tkr-tileset-browser-message")?.textContent}`);
  match(s.el.querySelector(".tkr-tileset-browser-message")?.textContent ?? "", /Bitmap sources are browse-only/);
  match(s.el.querySelector(".tkr-tileset-browser-note")?.textContent ?? "", /Source editing is unavailable until the P1 tile editor provider exists/);
  equal(s.doc.getSnapshot().dirty, false);
});

test("Shift+F10 opens the bitmap actions, gives them focus, and Escape restores the invoking control", async () => {
  const bitmap: TileBitmap = {
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 1,
    height: 1,
    cells: [
      { tile: "village.tst2", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  };
  const bytes = writeTileBitmap(bitmap);
  ok(bytes.ok);
  const s = await setup(exampleBoard(), createBrowserSession(), { "Bitmap/portrait.tbm": bytes.value });
  const handle = await show(s);
  const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(source !== null);
  await act(async () => {
    source.value = "Bitmap/portrait.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  for (let turn = 0; turn < 100 && s.el.querySelector(".tkr-tileset-browser-item")?.textContent?.includes("portrait") !== true; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  const invoke = s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-source");
  ok(invoke !== null);
  const shortcut = new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true });
  await act(() => { invoke.dispatchEvent(shortcut); });
  equal(shortcut.defaultPrevented, true, "Shift+F10 suppresses the browser-native context menu so the menu can return focus to its invoker");
  const close = s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-menu button:last-child");
  ok(close !== null && close.textContent === "Close actions");
  equal(document.activeElement, close, "the bitmap menu has an enabled focused action");
  await act(async () => {
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await Promise.resolve();
  });
  equal(s.el.querySelector(".tkr-tileset-browser-menu"), null);
  equal(document.activeElement, invoke, "Escape returns focus to the control that opened the menu");
  equal(s.doc.getSnapshot().dirty, false);
  handle.dispose();
});

test("bitmap previews resolve .gph and scale 16px tiles to their documented pixel dimensions", async () => {
  const tiny = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail2.tst", import.meta.url)));
  const single = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/files/flower.gph", import.meta.url)));
  const bitmap: TileBitmap = {
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 3,
    height: 1,
    cells: [
      { tile: "tileset_detail2.tst1", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "tileset_detail2.tst2", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "flower.gph", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  };
  const bytes = writeTileBitmap(bitmap);
  ok(bytes.ok);
  const decoded = decodeTileTexture(assetKey("tileset_detail2.tst"), tiny);
  const tileSet = readTileset(tiny, "tileset_detail2.tst");
  const flower = decodeTileTexture(assetKey("flower.gph"), single);
  const parsedBitmap = readTileBitmap(new BinaryReader(bytes.value, "Bitmap/mix.tbm"));
  ok(decoded.ok && tileSet.ok && flower.ok && parsedBitmap.ok);
  const tileWidth = decoded.texture.w / tileSet.value.tiles.length;
  equal(tileWidth, 32, "16px detail tiles are expanded to the board's 32px tile size");
  const firstTile = new Uint8Array(tileWidth * decoded.texture.h * 4);
  const secondTile = new Uint8Array(tileWidth * decoded.texture.h * 4);
  for (let y = 0; y < decoded.texture.h; y += 1) {
    firstTile.set(decoded.texture.rgba.subarray(y * decoded.texture.w * 4, (y * decoded.texture.w + tileWidth) * 4), y * tileWidth * 4);
    secondTile.set(decoded.texture.rgba.subarray((y * decoded.texture.w + tileWidth) * 4, (y * decoded.texture.w + tileWidth * 2) * 4), y * tileWidth * 4);
  }
  const expected = compositeTileBitmap(parsedBitmap.value, new Map([
    ["tileset_detail2.tst1", { w: tileWidth, h: decoded.texture.h, rgba: firstTile }],
    ["tileset_detail2.tst2", { w: tileWidth, h: decoded.texture.h, rgba: secondTile }],
    ["flower.gph", { w: flower.texture.w, h: flower.texture.h, rgba: flower.texture.rgba }],
  ]));
  ok(expected.ok);
  equal(expected.value.w, 96);
  equal(expected.value.h, 32);
  const s = await setup(exampleBoard(), createBrowserSession(), {
    "Tiles/tileset_detail2.tst": tiny,
    "Tiles/flower.gph": single,
    "Bitmap/mix.tbm": bytes.value,
  });
  const canvasDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const drawnPixels = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: HTMLCanvasElement, type: string) {
      if (this.dataset.previewReference === undefined) return originalGetContext.call(this, "2d");
      const canvas = this;
      return {
        createImageData(width: number, height: number) {
          return { width, height, colorSpace: "srgb", data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(image: ImageData) { drawnPixels.set(canvas, image.data); },
        getImageData() { return { data: drawnPixels.get(canvas) }; },
      } as unknown as CanvasRenderingContext2D;
    },
  });
  let handle: ViewHandle | undefined;
  let atlasReads = 0;
  const browser: TilesetBrowserContext = {
    ...s.browser,
    fs: {
      list: (path) => s.host.fs.list(path),
      read: (path) => {
        if (path === "Tiles/tileset_detail2.tst") atlasReads += 1;
        return s.host.fs.read(path);
      },
    },
  };
  try {
    handle = await show(s, browser);
    const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
    ok(source !== null);
    await act(async () => {
      source.value = "Bitmap/mix.tbm";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      for (let turn = 0; turn < 100 && s.el.querySelector(".tkr-tileset-browser-item")?.textContent?.includes("mix.tbm") !== true; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const preview = s.el.querySelector<HTMLCanvasElement>(".tkr-tileset-browser-preview");
    ok(preview !== null, "bitmap cells resolve both a tileset index and a .gph single tile");
    equal(preview.width, expected.value.w);
    equal(preview.height, expected.value.h);
    const context = preview.getContext("2d");
    ok(context !== null);
    deepEqual([...context.getImageData(0, 0, preview.width, preview.height).data], [...expected.value.rgba], "the drawn bitmap preview matches the canonical compositor pixel-for-pixel");
    equal(atlasReads, 1, "distinct indices reuse one decoded atlas during the bitmap load");
  } finally {
    handle?.dispose();
    if (canvasDescriptor !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasDescriptor);
  }
});
test("tile bitmap previews resolve Tiles-prefixed references and animated-tile frames pixel-for-pixel", async () => {
  const flowerBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/files/flower.gph", import.meta.url)));
  const makeAnimation = (frame: string) => writeTileAnimation({
    magic: TILE_ANIMATION_MAGIC,
    major: 2,
    minor: 0,
    speed: 10,
    frameCount: 1,
    frames: [frame],
  });
  const animation = makeAnimation("Tiles/middle.tan");
  const nestedAnimation = makeAnimation("Tiles/flower.gph");
  const bitmap = writeTileBitmap({
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 1,
    height: 1,
    cells: [
      { tile: "Tiles/walk.tan", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  });
  ok(animation.ok && nestedAnimation.ok && bitmap.ok);
  const decodedFlower = decodeTileTexture(assetKey("flower.gph"), flowerBytes);
  const parsedBitmap = readTileBitmap(new BinaryReader(bitmap.value, "Bitmap/animated.tbm"));
  ok(decodedFlower.ok && parsedBitmap.ok);
  const expected = compositeTileBitmap(parsedBitmap.value, new Map([
    ["Tiles/walk.tan", { w: decodedFlower.texture.w, h: decodedFlower.texture.h, rgba: decodedFlower.texture.rgba }],
  ]));
  ok(expected.ok);
  const s = await setup(exampleBoard(), createBrowserSession(), {
    "Tiles/walk.tan": animation.value,
    "Tiles/middle.tan": nestedAnimation.value,
    "Tiles/flower.gph": flowerBytes,
    "Bitmap/animated.tbm": bitmap.value,
  });
  const canvasDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const drawnPixels = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: HTMLCanvasElement, type: string) {
      if (this.dataset.previewReference === undefined) return originalGetContext.call(this, "2d");
      const canvas = this;
      return {
        createImageData(width: number, height: number) {
          return { width, height, colorSpace: "srgb", data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(image: ImageData) { drawnPixels.set(canvas, image.data); },
        getImageData() { return { data: drawnPixels.get(canvas) }; },
      } as unknown as CanvasRenderingContext2D;
    },
  });
  let handle: ViewHandle | undefined;
  try {
    handle = await show(s);
    const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
    ok(source !== null);
    await act(async () => {
      source.value = "Bitmap/animated.tbm";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      for (let turn = 0; turn < 100 && s.el.querySelector('[data-browser-reference="Bitmap/animated.tbm"] canvas') === null; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    const preview = s.el.querySelector<HTMLCanvasElement>(".tkr-tileset-browser-preview");
    ok(preview !== null, `a Tiles-prefixed TAN cell resolves through its first non-empty GPH frame; item=${s.el.querySelector(".tkr-tileset-browser-item")?.textContent}; message=${s.el.querySelector(".tkr-tileset-browser-message")?.textContent}; sources=${[...(source?.options ?? [])].map((option) => option.value).join(",")}`);
    equal(preview.width, expected.value.w);
    equal(preview.height, expected.value.h);
    const context = preview.getContext("2d");
    ok(context !== null);
    deepEqual([...context.getImageData(0, 0, preview.width, preview.height).data], [...expected.value.rgba], "TAN-backed bitmap pixels equal the canonical tile-bitmap composition");
  } finally {
    handle?.dispose();
    if (canvasDescriptor !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasDescriptor);
  }
});

test("optional Tiles prefixes do not collapse nested asset paths", async () => {
  const rootBytes = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/files/flower.gph", import.meta.url)));
  const nestedBytes = new TextEncoder().encode(new TextDecoder().decode(rootBytes).replaceAll(" 7885040 ", " 16711680 "));
  const bitmap = writeTileBitmap({
    magic: TILE_BITMAP_MAGIC,
    major: 3,
    minor: 0,
    width: 2,
    height: 1,
    cells: [
      { tile: "Tiles/foo.gph", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "Tiles/Tiles/foo.gph", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
      { tile: "", r: 0, g: 0, b: 0 },
    ],
    residue: new Uint8Array(),
  });
  ok(bitmap.ok);
  const rootTexture = decodeTileTexture(assetKey("foo.gph"), rootBytes);
  const nestedTexture = decodeTileTexture(assetKey("Tiles/foo.gph"), nestedBytes);
  const parsedBitmap = readTileBitmap(new BinaryReader(bitmap.value, "Bitmap/collision.tbm"));
  ok(rootTexture.ok && nestedTexture.ok && parsedBitmap.ok);
  const expected = compositeTileBitmap(parsedBitmap.value, new Map([
    ["Tiles/foo.gph", { w: rootTexture.texture.w, h: rootTexture.texture.h, rgba: rootTexture.texture.rgba }],
    ["Tiles/Tiles/foo.gph", { w: nestedTexture.texture.w, h: nestedTexture.texture.h, rgba: nestedTexture.texture.rgba }],
  ]));
  ok(expected.ok);
  const s = await setup(exampleBoard(), createBrowserSession(), {
    "Tiles/foo.gph": rootBytes,
    "Tiles/Tiles/foo.gph": nestedBytes,
    "Bitmap/collision.tbm": bitmap.value,
  });
  const canvasDescriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const drawnPixels = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: HTMLCanvasElement, type: string) {
      if (this.dataset.previewReference === undefined) return originalGetContext.call(this, "2d");
      const canvas = this;
      return {
        createImageData(width: number, height: number) {
          return { width, height, colorSpace: "srgb", data: new Uint8ClampedArray(width * height * 4) };
        },
        putImageData(image: ImageData) { drawnPixels.set(canvas, image.data); },
        getImageData() { return { data: drawnPixels.get(canvas) }; },
      } as unknown as CanvasRenderingContext2D;
    },
  });
  let handle: ViewHandle | undefined;
  try {
    handle = await show(s);
    const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
    ok(source !== null);
    await act(async () => {
      source.value = "Bitmap/collision.tbm";
      source.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      for (let turn = 0; turn < 100 && !s.el.querySelector(".tkr-tileset-browser-item")?.textContent?.includes("collision.tbm"); turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    const preview = s.el.querySelector<HTMLCanvasElement>(".tkr-tileset-browser-preview");
    ok(preview !== null, `the bitmap draws both same-named assets from distinct nested paths; item=${s.el.querySelector(".tkr-tileset-browser-item")?.textContent}; message=${s.el.querySelector(".tkr-tileset-browser-message")?.textContent}; sources=${[...(source?.options ?? [])].map((option) => `${option.value}=${option.textContent}`).join(",")}`);
    const context = preview.getContext("2d");
    ok(context !== null);
    deepEqual([...context.getImageData(0, 0, preview.width, preview.height).data], [...expected.value.rgba], "optional Tiles prefix and nested asset identity resolve to distinct canonical pixels");
  } finally {
    handle?.dispose();
    if (canvasDescriptor !== undefined) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasDescriptor);
  }
});

test("tile-reference matching folds ASCII path characters without conflating Unicode case", async () => {
  const single = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/files/flower.gph", import.meta.url)));
  const bitmapFor = (reference: string): Uint8Array => {
    const written = writeTileBitmap({
      magic: TILE_BITMAP_MAGIC,
      major: 3,
      minor: 0,
      width: 1,
      height: 1,
      cells: [
        { tile: reference, r: 0, g: 0, b: 0 },
        { tile: "", r: 0, g: 0, b: 0 },
        { tile: "", r: 0, g: 0, b: 0 },
        { tile: "", r: 0, g: 0, b: 0 },
      ],
      residue: new Uint8Array(),
    });
    ok(written.ok);
    return written.value;
  };
  const s = await setup(exampleBoard(), createBrowserSession({ selection: null, path: "Bitmap/unicode.tbm", scrollTop: 0 }), {
    "Tiles/Ä.gph": single,
    "Tiles/FLOWER.GPH": single,
    "Bitmap/unicode.tbm": bitmapFor("ä.gph"),
    "Bitmap/ascii.tbm": bitmapFor("flower.gph"),
  });
  const readPaths: string[] = [];
  const browser: TilesetBrowserContext = {
    ...s.browser,
    fs: {
      list: (path) => s.host.fs.list(path),
      read: (path) => {
        readPaths.push(path);
        return s.host.fs.read(path);
      },
    },
  };
  const handle = await show(s, browser);
  const source = s.el.querySelector<HTMLSelectElement>(".tkr-tileset-browser select");
  ok(source !== null);
  await act(async () => {
    for (let turn = 0; turn < 100 && s.el.querySelector(".tkr-tileset-browser-message") === null; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
  equal(readPaths.includes("Tiles/Ä.gph"), false, "a lower-case Unicode reference does not resolve to an upper-case Unicode path");

  await act(async () => {
    source.value = "Bitmap/ascii.tbm";
    source.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  for (let turn = 0; turn < 100 && s.el.querySelector('[data-browser-reference="Bitmap/ascii.tbm"]') === null; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  ok(readPaths.includes("Tiles/FLOWER.GPH"), "ASCII case folding still finds the same source across extension hosts");
  handle.dispose();
});

test("the native context menu can explicitly choose a tile brush without painting", async () => {
  const s = await setup();
  const handle = await show(s);
  for (let turn = 0; turn < 100 && s.el.querySelector('[data-browser-reference="village.tst2"]') === null; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  const item = s.el.querySelector<HTMLElement>('[data-browser-reference="village.tst2"]');
  ok(item !== null);
  await act(() => { item.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  const select = s.el.querySelector<HTMLButtonElement>(".tkr-tileset-browser-menu button:not(:disabled)");
  ok(select !== null && select.textContent === "Select as board brush");
  await act(() => select.click());
  equal(s.browser.session.getSnapshot().selection?.reference, "village.tst2");
  equal(s.doc.getSnapshot().dirty, false, "a context-menu brush action selects but does not paint");
  handle.dispose();
});
