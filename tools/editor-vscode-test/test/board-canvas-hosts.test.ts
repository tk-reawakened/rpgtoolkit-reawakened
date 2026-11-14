// Story 12.10 in every host: a representative top-down board and both isometric boards are edited with the pointer on the
// canvas, one gesture is one edit, the view's selection, pan, zoom and layer visibility are not edits, the file saved
// holds exactly the gesture's cells, and a reopened view shows them. The browser host and VS Code (desktop and web
// builds) run the same steps, over the same bridge their webviews use.
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { BinaryReader, readBoard, writeBoard } from "@tk-reawakened/core";
import { boardExtent, boardToScreen, buildNewBoard, cellCentre, clampViewport, createBoardDocument, createDocumentIdentity, pixelToCell, type BoardCoordSystem, type BoardPicture, type Cell } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const tileset = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

const PATH = "Boards/map.brd";
const SYSTEMS: readonly BoardCoordSystem[] = ["2d", "iso-stacked", "iso-rotated"];

function board(system: BoardCoordSystem): Uint8Array {
  const built = buildNewBoard({ name: "map", coordSystem: system, pixelCoordinates: false, width: 8, height: 8, layers: 3, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  return built.bytes;
}

interface Tab {
  readonly element: HTMLElement;
  workbenchDirty(): boolean;
  picture(): Promise<BoardPicture>;
  close(): Promise<void>;
}
interface Host {
  open(path: string): Promise<Tab>;
  disk(path: string): Promise<Uint8Array | null>;
}

let act: Act;
let hosts: readonly { readonly name: string; readonly make: (files: Readonly<Record<string, Uint8Array>>) => Host; readonly ownsUndo: boolean }[] = [];

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
    { name: "browser host", make: (files) => createWebBoardProofHost(gam, files, act), ownsUndo: false },
    { name: "VS Code desktop", make: (files) => createVscodeBoardProofHost(true, gam, files, act), ownsUndo: true },
    { name: "VS Code for the Web", make: (files) => createVscodeBoardProofHost(false, gam, files, act), ownsUndo: true },
  ];
});

after(() => GlobalRegistrator.unregister());

const canvasOf = (tab: Tab): HTMLCanvasElement => {
  const found = tab.element.querySelector<HTMLCanvasElement>("canvas.tkr-board-canvas");
  if (found === null) throw new Error("no board canvas");
  return found;
};

function pointer(type: string, at: { x: number; y: number }): Event {
  return new MouseEvent(type, { clientX: at.x, clientY: at.y, button: 0, bubbles: true, cancelable: true });
}

async function drag(tab: Tab, shape: Parameters<typeof cellCentre>[0], from: Cell, to: Cell): Promise<void> {
  const canvas = canvasOf(tab);
  const viewport = clampViewport(shape, { x: 0, y: 0, zoomIndex: 2, width: canvas.width, height: canvas.height });
  const at = (cell: Cell): { x: number; y: number } => {
    const centre = cellCentre(shape, cell.x, cell.y);
    return boardToScreen(viewport, centre.x, centre.y);
  };
  await act(() => { canvas.dispatchEvent(pointer("pointerdown", at(from))); });
  await act(() => { canvas.dispatchEvent(pointer("pointermove", at(to))); });
  await act(() => { canvas.dispatchEvent(pointer("pointerup", at(to))); });
  await settle(act, 4);
}

const state = (tab: Tab): string => tab.element.querySelector(".tkr-board-state")?.textContent ?? "";
const button = (tab: Tab, selector: string): HTMLButtonElement => {
  const found = tab.element.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
};

async function untilState(tab: Tab, wanted: string): Promise<void> {
  for (let round = 0; round < 200 && state(tab) !== wanted; round += 1) await settle(act, 1);
  equal(state(tab), wanted);
}

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  for (const system of SYSTEMS) {
    describe(`board canvas: ${entry}, ${system}`, () => {
      test("a drag on the canvas is one edit; navigation and layer visibility are not; the saved file holds the gesture and reopens", async () => {
        document.body.replaceChildren();
        const original = board(system);
        const spec = hosts.find((candidate) => candidate.name === entry)!;
        const host = spec.make({ [PATH]: original, "Tiles/village.tst": tileset });
        const tab = await host.open(PATH);
        await settle(act, 4);
        const model = createBoardDocument(createMemoryPlatformServices({}).fs, createDocumentIdentity("shape", PATH), original);
        ok(model.ok);
        const shape = model.document.getSnapshot();
        const extent = boardExtent(shape);
        const centre = pixelToCell(shape, extent.width / 2, extent.height / 2)!;
        const near = (dx: number, dy: number): Cell => ({ x: centre.x + dx, y: centre.y + dy });

        // Choose the second tile as the brush: a selection, not an edit.
        const rock = tab.element.querySelector<HTMLButtonElement>('[data-browser-reference="village.tst2"] .tkr-tileset-browser-source');
        ok(rock !== null);
        await act(() => rock.click());
        await settle(act, 2);
        equal(tab.workbenchDirty(), false);

        // Navigation and visibility change nothing in the document, and the host's picture of the board is unchanged.
        const unchanged = await tab.picture();
        await act(() => button(tab, ".tkr-board-zoom-in").click());
        await act(() => button(tab, ".tkr-board-grid-toggle").click());
        await act(() => button(tab, '[data-tool="select"]').click());
        await drag(tab, shape, near(-1, -1), near(1, 1));
        await act(() => button(tab, '[data-tool="draw"]').click());
        await act(() => button(tab, ".tkr-board-only-current").click());
        await act(() => button(tab, ".tkr-board-show-all").click());
        await settle(act, 3);
        equal(tab.workbenchDirty(), false, "selection, zoom, grid and visibility never dirty the board");
        deepEqual(await host.disk(PATH), original);
        deepEqual(await tab.picture(), unchanged);
        await act(() => button(tab, ".tkr-board-zoom-out").click());

        // One drag with Draw is one edit of the current layer.
        await drag(tab, shape, near(-2, -1), near(2, 1));
        equal(tab.workbenchDirty(), true, "the host knows the drag is unsaved work");
        equal(state(tab), "Unsaved changes");
        if (spec.ownsUndo) {
          equal(tab.element.querySelector(".tkr-board-undo"), null, "this host's workbench owns Undo and Redo");
          match(tab.element.textContent ?? "", /Use this editor's own Undo and Redo/);
        } else {
          await act(() => button(tab, ".tkr-board-undo").click());
          equal(tab.workbenchDirty(), false, "one Undo takes back the whole drag");
          await act(() => button(tab, ".tkr-board-redo").click());
          equal(tab.workbenchDirty(), true);
        }
        deepEqual(await host.disk(PATH), original, "nothing is written before Save");
        notEqualPictures(await tab.picture(), unchanged);

        await act(() => button(tab, ".tkr-board-save").click());
        await untilState(tab, "All changes saved");
        const saved = await host.disk(PATH);
        ok(saved !== null);
        const read = readBoard(new BinaryReader(saved));
        ok(read.ok);
        deepEqual(writeBoard(read.value), { ok: true, value: saved, warnings: [] }, "the saved file is the writer's own bytes");
        const grid = read.value.sizeX === 0 ? 0 : shape.grid.width * shape.grid.height;
        const changed: number[] = [];
        read.value.tileMatrix.forEach((index, cell) => { if (index !== 0) changed.push(cell); });
        ok(changed.length >= 3, `${changed.length} cells were drawn`);
        for (const cell of changed) {
          ok(cell < grid, "only layer 1 holds tiles");
          equal(read.value.lut[read.value.tileMatrix[cell]!], "village.tst2");
        }
        await tab.close();
        await settle(act);
        const reopened = await host.open(PATH);
        await settle(act, 4);
        const first = changed[0]!;
        const label = `Column ${(first % shape.grid.width) + 1}, row ${Math.floor(first / shape.grid.width) + 1}: village.tst2`;
        ok(reopened.element.querySelector(`[aria-label="${label}"]`) !== null, `the reopened view shows ${label}`);
        equal(reopened.workbenchDirty(), false);
        await reopened.close();
      });
    });
  }
}

function notEqualPictures(a: BoardPicture, b: BoardPicture): void {
  ok(a.ok && b.ok);
  if (a.ok && b.ok) ok(a.rgba.some((value, index) => value !== b.rgba[index]), "the picture shows the drawn tiles");
}
