// The tile bitmap proof (story 12.8, T-62, host-conformance for the tile-bitmap kind): in every host a shaded multi-cell
// bitmap is opened, edited through the view with a tile chosen in the shared browser, saved, closed and reopened; the
// file holds exactly the bytes written by hand from the stored layout, the reopened view shows the same size and cells,
// the picture equals what the real engine's `bitmap` command draws from the saved file, and the whole bitmap is
// selectable as a stamp brush. The browser host and VS Code (desktop and web builds) run the same steps.
import { deepEqual, equal, match, notDeepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { BinaryReader, TILE_BITMAP_MAGIC, readTileBitmap, writeTileBitmap, type TileBitmap, type TileBitmapCell } from "@tk-reawakened/core";
import type { TileBitmapPicture } from "@tk-reawakened/editor-model";
import { engineBitmapView } from "../conformance/engine-bitmap-view.ts";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const tileset = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

const PATH = "Bitmap/house.tbm";
const OTHER_PATH = "Bitmap/other.tbm";

const cellOf = (tile: string, r = 0, g = 0, b = 0): TileBitmapCell => ({ tile, r, g, b });

/** A bitmap whose drawn cells come from `drawn`; the stored extra column and row hold their own tile, which no edit may disturb. */
function bitmap(width: number, height: number, drawn: (x: number, y: number) => TileBitmapCell): TileBitmap {
  const cells: TileBitmapCell[] = [];
  for (let x = 0; x <= width; x += 1) for (let y = 0; y <= height; y += 1) cells.push(x < width && y < height ? drawn(x, y) : cellOf("pad.gph", 1, 2, 3));
  return { magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width, height, cells, residue: Uint8Array.from([7, 7, 7]) };
}

const bytesOf = (model: TileBitmap): Uint8Array => {
  const written = writeTileBitmap(model);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
};

/** A 2 × 1 stamp, fully drawn so the engine's canvas and the editor's picture cover the same pixels: tile 1 plain, tile 2 shaded. */
const ORIGINAL = bytesOf(bitmap(2, 1, (x) => (x === 0 ? cellOf("village.tst1") : cellOf("village.tst2", 10, -20, 30))));
const FILES = { [PATH]: ORIGINAL, [OTHER_PATH]: ORIGINAL, "Tiles/village.tst": tileset };

interface Tab {
  readonly element: HTMLElement;
  workbenchDirty(): boolean;
  picture(): Promise<TileBitmapPicture>;
  close(): Promise<void>;
}

interface Host {
  readonly name: string;
  open(path: string): Promise<Tab>;
  disk(path: string): Promise<Uint8Array | null>;
}

let act: Act;
let hosts: readonly { readonly name: string; readonly make: () => Host }[] = [];

before(async () => {
  GlobalRegistrator.register();
  const { act: preactAct } = await import("preact/test-utils");
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebBoardProofHost } = await import("../conformance/web-host.ts");
  const { createVscodeBoardProofHost } = await import("../conformance/vscode-host.ts");
  hosts = [
    { name: "browser host", make: () => createWebBoardProofHost(gam, FILES, act) },
    { name: "VS Code desktop", make: () => createVscodeBoardProofHost(true, gam, FILES, act) },
    { name: "VS Code for the Web", make: () => createVscodeBoardProofHost(false, gam, FILES, act) },
  ];
});

after(() => GlobalRegistrator.unregister());

const cell = (tab: Tab, column: number, row: number): HTMLButtonElement => {
  const found = tab.element.querySelector<HTMLButtonElement>(`[aria-label^="Column ${column}, row ${row}:"]`);
  if (found === null) throw new Error(`no cell at column ${column}, row ${row}: ${tab.element.textContent}`);
  return found;
};
const control = <Element extends HTMLElement>(tab: Tab, selector: string): Element => {
  const found = tab.element.querySelector<Element>(selector);
  if (found === null) throw new Error(`no ${selector}: ${tab.element.textContent}`);
  return found;
};
const state = (tab: Tab): string => tab.element.querySelector(".tkr-bitmap-state")?.textContent ?? "";

/** Wait, a few turns at a time, until `done` holds: the browser and the picture arrive through the host's own messages. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 400 && !done(); round += 1) await settle(act, 1);
  ok(done(), "the host did what the view asked");
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

function pixels(picture: TileBitmapPicture): Uint8Array {
  ok(picture.ok, picture.ok ? "" : picture.message);
  return picture.rgba;
}

/** Open `path` and wait until the picture and the browser's tiles are shown. */
async function openReady(host: Host, path: string): Promise<Tab> {
  const tab = await host.open(path);
  await until(() => tab.element.querySelector('canvas[role="img"]') !== null && tab.element.querySelector(".tkr-tileset-browser-item") !== null);
  return tab;
}

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`tile bitmap proof: ${entry}`, () => {
    test("a shaded multi-cell bitmap is edited with a browser tile, saved and reopened, and its picture is the engine's", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();

      const first = await openReady(host, PATH);
      equal(first.element.querySelector("h2")?.textContent, "Tile bitmap");
      match(first.element.querySelector(".tkr-bitmap-summary")?.textContent ?? "", /2 × 1 tiles, 64 × 32 pixels/);
      equal(first.element.querySelectorAll('[role="gridcell"]').length, 2);
      equal(cell(first, 2, 1).getAttribute("aria-label"), "Column 2, row 1: village.tst2, shade 10, -20, 30");
      const before = pixels(await first.picture());
      deepEqual(before, engineBitmapView(FILES, PATH, 64, 32), "the unedited bitmap draws as the engine draws it");

      // Choose tile 1 in the shared browser, draw it on the second cell with the Draw tool, then shade the first cell.
      const choice = control<HTMLButtonElement>(first, '[data-browser-reference="village.tst1"] .tkr-tileset-browser-source');
      await act(() => { choice.click(); });
      equal(first.workbenchDirty(), false, "choosing a brush edits nothing");
      await act(() => { control<HTMLButtonElement>(first, ".tkr-bitmap-tool-draw").click(); });
      await act(() => { cell(first, 2, 1).click(); });
      await until(() => cell(first, 2, 1).getAttribute("aria-label") === "Column 2, row 1: village.tst1, shade 10, -20, 30");
      await act(() => { cell(first, 1, 1).click(); });
      await until(() => first.element.querySelector<HTMLInputElement>(".tkr-bitmap-shade-r") !== null);
      await type(control(first, ".tkr-bitmap-shade-r"), "-255");
      await until(() => cell(first, 1, 1).getAttribute("aria-label") === "Column 1, row 1: village.tst1, shade -255, 0, 0");
      equal(first.workbenchDirty(), true, "the host knows the document is unsaved");
      equal(state(first), "Unsaved changes");
      deepEqual(await host.disk(PATH), ORIGINAL, "nothing is written before Save");

      await act(() => { control<HTMLButtonElement>(first, ".tkr-bitmap-save").click(); });
      await until(() => state(first) === "All changes saved");
      await settle(act);
      equal(first.workbenchDirty(), false);
      const expected = bytesOf(bitmap(2, 1, (x) => (x === 0 ? cellOf("village.tst1", -255, 0, 0) : cellOf("village.tst1", 10, -20, 30))));
      deepEqual(await host.disk(PATH), expected, "the file holds exactly the two edits; the extra row and column and the trailing bytes are the file's own");

      const afterSave = pixels(await first.picture());
      notDeepEqual(afterSave, before, "the picture shows the edits");
      deepEqual(afterSave, engineBitmapView({ ...FILES, [PATH]: expected }, PATH, 64, 32), "the saved bitmap draws as the engine draws it");
      await first.close();
      await settle(act);

      const second = await openReady(host, PATH);
      match(second.element.querySelector(".tkr-bitmap-summary")?.textContent ?? "", /2 × 1 tiles/);
      equal(cell(second, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1, shade -255, 0, 0", "the reopened view shows the saved cell and its shade");
      equal(cell(second, 2, 1).getAttribute("aria-label"), "Column 2, row 1: village.tst1, shade 10, -20, 30");
      equal(second.workbenchDirty(), false);
      deepEqual(pixels(await second.picture()), afterSave, "the reopened picture is the saved one");

      // Growing the bitmap saves a 3 × 2 file that still stores its extra column and row.
      await type(control(second, ".tkr-bitmap-width"), "3");
      await type(control(second, ".tkr-bitmap-height"), "2");
      await until(() => /3 × 2 tiles/.test(second.element.querySelector(".tkr-bitmap-summary")?.textContent ?? ""));
      await act(() => { control<HTMLButtonElement>(second, ".tkr-bitmap-save").click(); });
      await until(() => state(second) === "All changes saved");
      const grown = await host.disk(PATH);
      ok(grown !== null);
      const read = readTileBitmap(new BinaryReader(grown));
      ok(read.ok);
      equal(read.value.width, 3);
      equal(read.value.height, 2);
      equal(read.value.cells.length, 4 * 3, "the extra column and row are still stored");
      deepEqual(read.value.cells[0], cellOf("village.tst1", -255, 0, 0), "cells that stay keep their tile and shade");
      deepEqual([...read.value.residue], [7, 7, 7], "bytes no editor models are kept");
      await second.close();
    });

    test("a whole tile bitmap is selected as a stamp brush from the browser, edits nothing, and is still the brush in another bitmap", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();
      const first = await openReady(host, PATH);
      const source = control<HTMLSelectElement>(first, ".tkr-tileset-browser select");
      await act(() => {
        source.value = PATH;
        source.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await until(() => first.element.querySelector(".tkr-tileset-browser-select-brush")?.textContent === "Select stamp brush");
      match(first.element.querySelector(".tkr-tileset-browser-message")?.textContent ?? "", /Tile bitmap, 2 × 1 tiles\. Select it as a whole stamp brush/);
      await act(() => { control<HTMLButtonElement>(first, ".tkr-tileset-browser-select-brush").click(); });
      await until(() => /A whole stamp \(2 × 1 tiles\) is chosen/.test(first.element.querySelector(".tkr-bitmap-brush")?.textContent ?? ""));
      equal(first.workbenchDirty(), false, "choosing a stamp edits nothing");
      deepEqual(await host.disk(PATH), ORIGINAL, "and leaves its file as it was");

      await act(() => { control<HTMLButtonElement>(first, ".tkr-bitmap-tool-draw").click(); });
      await act(() => { cell(first, 1, 1).click(); });
      match(first.element.querySelector('[role="alert"]')?.textContent ?? "", /whole stamp, not a single tile/);
      equal(first.workbenchDirty(), false, "Draw explains a stamp is not a tile instead of changing the cell");
      await first.close();
      await settle(act);

      const other = await openReady(host, OTHER_PATH);
      await until(() => /A whole stamp \(2 × 1 tiles\) is chosen/.test(other.element.querySelector(".tkr-bitmap-brush")?.textContent ?? ""));
      const retained = other.element.querySelector<HTMLElement>(`[data-browser-reference="house.tbm"] .tkr-tileset-browser-source`);
      ok(retained !== null && retained.getAttribute("aria-pressed") === "true", "the stamp stays chosen in the browser after another document opens");
      equal(other.workbenchDirty(), false);
      await other.close();
    });
  });
}
