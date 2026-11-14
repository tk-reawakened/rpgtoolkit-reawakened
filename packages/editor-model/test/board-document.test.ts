// The board kind (ADR 0026): one tile changed, saved and reopened, with everything the editor does not model kept as it was (AD-18).
import { deepEqual, equal, notDeepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { BinaryReader, readBoard, type Board } from "@tk-reawakened/core";
import { boardTileAt, createBoardDocument, createDocumentIdentity, createDocumentWorkspace, openBoardDocument } from "../src/index.ts";
import { exampleBoard } from "./fixtures.ts";

const PATH = "Boards/village.brd";
const identity = createDocumentIdentity("memory-project", PATH);

/** The full model a document would save: what the snapshot leaves out (runs, vectors, residue) is checked through the bytes. */
function modelOf(doc: { serialize(): Uint8Array }): Board {
  const read = readBoard(new BinaryReader(doc.serialize()));
  ok(read.ok);
  return read.value;
}

async function open(bytes = exampleBoard(4)) {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openBoardDocument(host.fs, identity);
  ok(opened.ok);
  return { host, doc: opened.document };
}

test("a board opens with its grid, layers and tiles", async () => {
  const { doc } = await open();
  const snapshot = doc.getSnapshot();
  deepEqual(snapshot.grid, { width: 4, height: 3 });
  equal(snapshot.layers, 2);
  equal(boardTileAt(snapshot, 0, 0, 0), "village.tst1");
  equal(boardTileAt(snapshot, 1, 3, 2), "");
  equal(boardTileAt(snapshot, 2, 0, 0), null, "a layer the board does not have");
});

test("one tile changes, saves and reopens; the other cells, the table's old entries and the unmodelled data are kept", async () => {
  const { host, doc } = await open();
  const before = doc.getSnapshot();
  const modelBefore = modelOf(doc);
  ok(doc.apply({ type: "set-tile", layer: 0, x: 1, y: 1, tile: "village.tst8" }).ok);
  equal(boardTileAt(doc.getSnapshot(), 0, 1, 1), "village.tst8");
  ok((await doc.save()).ok);
  const reopened = await openBoardDocument(host.fs, identity);
  ok(reopened.ok);
  const after = reopened.document.getSnapshot();
  const modelAfter = modelOf(reopened.document);
  equal(boardTileAt(after, 0, 1, 1), "village.tst8");
  for (let layer = 0; layer < 2; layer += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        if (layer === 0 && x === 1 && y === 1) continue;
        equal(boardTileAt(after, layer, x, y), boardTileAt(before, layer, x, y), `layer ${layer} (${x}, ${y})`);
      }
    }
  }
  deepEqual({ ...modelAfter, tileMatrix: [], tileRuns: [] }, { ...modelBefore, tileMatrix: [], tileRuns: [] }, "everything but the tile matrix is as it was");
});

test("only the run that held the cell is split; every other run is kept verbatim", async () => {
  const { doc } = await open();
  const before = modelOf(doc).tileRuns;
  ok(doc.apply({ type: "set-tile", layer: 0, x: 1, y: 0, tile: "village.tst8" }).ok);
  const after = modelOf(doc).tileRuns;
  deepEqual(after.slice(0, 3), [
    { lutIndex: 1, count: 1, marker: true },
    { lutIndex: 2, count: 1, marker: false },
    { lutIndex: 1, count: 10, marker: true },
  ]);
  deepEqual(after.slice(3), before.slice(1));
});

test("a tile the board has not used is added to its table, and the old entries keep their places", async () => {
  const { doc } = await open();
  const lutBefore = doc.getSnapshot().lut;
  ok(doc.apply({ type: "set-tile", layer: 1, x: 0, y: 0, tile: "town.tst2" }).ok);
  deepEqual(doc.getSnapshot().lut, [...lutBefore, "town.tst2"]);
  equal(boardTileAt(doc.getSnapshot(), 1, 0, 0), "town.tst2");
});

test("a command that names a cell outside the board, or the tile already there, is refused whole", async () => {
  const { doc } = await open();
  const before = doc.getSnapshot();
  for (const command of [
    { type: "set-tile", layer: 0, x: 4, y: 0, tile: "village.tst8" },
    { type: "set-tile", layer: 2, x: 0, y: 0, tile: "village.tst8" },
    { type: "set-tile", layer: 0, x: 0.5, y: 0, tile: "village.tst8" },
    { type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst1" },
    { type: "set-tile", layer: 0, x: 0, y: 0, tile: "bad\u0000name" },
  ] as const) {
    const result = doc.apply(command);
    ok(!result.ok, JSON.stringify(command));
    equal(result.rejection.reason, "invalid");
  }
  equal(doc.getSnapshot(), before);
});

test("a board before the vector layout is refused with the reader's located error and never upgraded (ADR 0022 D2.1)", async () => {
  for (const minor of [2, 3] as const) {
    const host = createMemoryPlatformServices({ files: { [PATH]: exampleBoard(minor) } });
    const opened = await openBoardDocument(host.fs, identity);
    ok(!opened.ok);
    equal(opened.error.kind, "format");
    deepEqual(host.bytesOf(PATH), exampleBoard(minor));
  }
});

test("a save after another program changed the board writes nothing and keeps the conflict (ADR 0022 D3.5)", async () => {
  const { host, doc } = await open();
  ok(doc.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst8" }).ok);
  const theirs = createBoardDocument(host.fs, identity, exampleBoard(4));
  ok(theirs.ok);
  ok(theirs.document.apply({ type: "set-tile", layer: 1, x: 0, y: 0, tile: "village.tst8" }).ok);
  host.seed(PATH, theirs.document.serialize());
  const saved = await doc.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "conflict");
  deepEqual(host.bytesOf(PATH), theirs.document.serialize());
  notDeepEqual(doc.getSnapshot().conflict, null);
});

test("the workspace opens a .brd as a board, one document per identity, and refuses a file type no kind claims", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleBoard(4), "Misc/notes.txt": new Uint8Array([1]) } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const first = await workspace.open("boards/VILLAGE.BRD");
  ok(first.ok);
  equal(first.document.kind, "board");
  const again = await workspace.open(PATH);
  ok(again.ok);
  equal(again.document, first.document);
  const unsupported = await workspace.open("Misc/notes.txt");
  ok(!unsupported.ok);
  equal(unsupported.error.kind, "unsupported");
  workspace.dispose();
});
