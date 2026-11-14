// The first P0 proof (story 12.1, host-conformance for the board kind): in every host a small authored board is opened,
// one tile is changed through the view, saved, closed and reopened; the file holds exactly the bytes the model makes of
// that edit, the reopened view shows the tile, and the board's picture equals what the real engine's `viewbrd` draws
// from the saved file. The browser host and VS Code (desktop and web builds) run the same steps.
import { deepEqual, equal, notDeepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createEmptyBoard, writeBoard, type Board } from "@tk-reawakened/core";
import { createBoardDocument, createDocumentIdentity, type BoardPicture } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { engineBoardView } from "../conformance/engine-view.ts";
import { settle, type Act } from "../conformance/view.ts";

const gam = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const tileset = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/tileset/tileset_detail1.tst", import.meta.url)));

const PATH = "Boards/village.brd";

/** A 2×2, one-layer board of the committed two-tile tileset: tiles 1, 2 / 2, 1. */
function smallBoard(): Uint8Array {
  const empty = createEmptyBoard();
  const board: Board = {
    ...empty,
    sizeX: 2,
    sizeY: 2,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: ["", "village.tst1", "village.tst2"],
    tileMatrix: [1, 2, 2, 1],
    tileRuns: [
      { lutIndex: 1, count: 1, marker: false },
      { lutIndex: 2, count: 1, marker: true },
      { lutIndex: 2, count: 1, marker: false },
      { lutIndex: 1, count: 1, marker: false },
    ],
  };
  const written = writeBoard(board);
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

const original = smallBoard();
const FILES = { [PATH]: original, "Tiles/village.tst": tileset };

/** The bytes the model makes of putting `tile` on a cell: the oracle for what a host must write. */
function expectedBytes(layer: number, x: number, y: number, tile: string): Uint8Array {
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("oracle", PATH), original);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-tile", layer, x, y, tile }).ok);
  return opened.document.serialize();
}

interface Tab {
  readonly element: HTMLElement;
  workbenchDirty(): boolean;
  picture(): Promise<BoardPicture>;
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
const state = (tab: Tab): string => tab.element.querySelector(".tkr-board-state")?.textContent ?? "";

async function untilState(tab: Tab, wanted: string): Promise<void> {
  for (let round = 0; round < 200 && state(tab) !== wanted; round += 1) await settle(act, 1);
  equal(state(tab), wanted);
}

function pixels(picture: BoardPicture): Uint8Array {
  ok(picture.ok, picture.ok ? "" : picture.message);
  return picture.rgba;
}

for (const entry of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`board proof: ${entry}`, () => {
    test("a tile is changed, saved and reopened, and the picture is the engine's", async () => {
      document.body.replaceChildren();
      const host = hosts.find((candidate) => candidate.name === entry)!.make();

      const first = await host.open(PATH);
      await settle(act);
      equal(first.element.querySelector("h2")?.textContent, "Board");
      equal(first.element.querySelectorAll('[role="gridcell"]').length, 4);
      equal(cell(first, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1");
      const before = pixels(await first.picture());
      deepEqual(before, engineBoardView(FILES, PATH, 64), "the unedited board draws as the engine draws it");

      // Select the cell at column 2, row 2 and put the other tile on it, as a person does.
      await act(() => { cell(first, 2, 2).click(); });
      await settle(act);
      const field = first.element.querySelector<HTMLInputElement>('input[type="text"]');
      ok(field !== null && field.value === "village.tst1");
      await act(() => {
        field.value = "village.tst2";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(() => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      await settle(act);
      equal(cell(first, 2, 2).textContent, "village.tst2");
      equal(first.workbenchDirty(), true, "the host knows the document is unsaved");
      equal(state(first), "Unsaved changes");
      deepEqual(await host.disk(PATH), original, "nothing is written before Save");

      const save = [...first.element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Save");
      ok(save !== undefined && !save.disabled);
      await act(() => { save.click(); });
      await untilState(first, "All changes saved");
      await settle(act);
      equal(first.workbenchDirty(), false);

      const saved = await host.disk(PATH);
      ok(saved !== null);
      deepEqual(saved, expectedBytes(0, 1, 1, "village.tst2"), "the file holds exactly the model's bytes for that one edit");
      notDeepEqual(saved, original);

      const afterSave = pixels(await first.picture());
      notDeepEqual(afterSave, before, "the picture shows the changed tile");
      deepEqual(afterSave, engineBoardView({ ...FILES, [PATH]: saved }, PATH, 64), "the saved board draws as the engine draws it");

      await first.close();
      await settle(act);
      const second = await host.open(PATH);
      await settle(act);
      equal(cell(second, 2, 2).getAttribute("aria-label"), "Column 2, row 2: village.tst2", "the reopened view shows the saved tile");
      equal(cell(second, 1, 1).getAttribute("aria-label"), "Column 1, row 1: village.tst1", "the other cells are as they were");
      equal(second.workbenchDirty(), false);
      deepEqual(pixels(await second.picture()), afterSave, "the reopened picture is the saved one");
      await second.close();
    });
  });
}
