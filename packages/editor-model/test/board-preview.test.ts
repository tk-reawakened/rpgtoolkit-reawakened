// The board preview (AD-29): the editor's picture of a board is the engine's own composition of the same bytes. The
// proof runs the real engine's `viewbrd` over the saved file and compares pixels with the editor's preview.
import { deepEqual, equal, notDeepEqual, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PACKAGE_ROOT,
  SCRIPT_SCREEN,
  createAssetIndex,
  createEmptyBoard,
  createEngine,
  writeBoard,
  type Board,
  type EnginePhaseRegistration,
  type GameState,
} from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createBoardDocument, previewBoard } from "../src/index.ts";

const tileset = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "spec", "examples", "versions", "tileset", "tileset_detail1.tst")));

/** A 2×2, one-layer board of two tiles of the committed two-tile tileset. */
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

const FILES = { "Boards/village.brd": smallBoard(), "Tiles/village.tst": tileset } as const;

/** What the engine's `viewbrd` draws for `bytes`: its own composition and rasteriser, over the same project files. */
function engineView(bytes: Uint8Array, size: number): Uint8Array {
  const files = new Map<string, Uint8Array>([["boards/village.brd", bytes], ["tiles/village.tst", tileset]]);
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(Object.keys(FILES)),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "village.brd",
    width: size,
    height: size,
    maxTicks: 20,
    program: `createcanvas(${size}, ${size}, c)\nviewbrd("village.brd", 0, 0, c)\nend()\n`,
    phaseRegistrations: [registration],
  });
  let result = engine.advance(0, []);
  for (let step = 0; step < 10; step += 1) {
    const events = result.requests
      .filter((request) => request.kind === "asset")
      .map((request) => ({ tick: result.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? new Uint8Array() } }));
    result = engine.advance(1, events);
    if (result.requests.length === 0 && !result.loading) break;
  }
  ok(latest !== undefined);
  const canvas = Object.values(latest.surfaces.entries).find((entry) => entry.id !== (0 as never) && entry.id !== SCRIPT_SCREEN);
  ok(canvas !== undefined, "the program's canvas");
  const surface = engine.surfacePixels(canvas.id, canvas.rev);
  ok(surface !== null);
  return surface.rgba;
}

test("the editor's preview is the engine's viewbrd pixels for the same board, before and after an edit", async () => {
  const host = createMemoryPlatformServices({ files: FILES });
  const identity = createDocumentIdentity("memory-project", "Boards/village.brd");
  const opened = createBoardDocument(host.fs, identity, FILES["Boards/village.brd"]);
  ok(opened.ok);
  const doc = opened.document;

  const before = await previewBoard(host.fs, "memory-project", doc.serialize());
  ok(before.ok, before.ok ? "" : before.message);
  equal(before.width, 64);
  equal(before.height, 64);
  deepEqual(before.warnings, []);
  deepEqual(before.rgba, engineView(doc.serialize(), 64));

  ok(doc.apply({ type: "set-tile", layer: 0, x: 0, y: 0, tile: "village.tst2" }).ok);
  const after = await previewBoard(host.fs, "memory-project", doc.serialize());
  ok(after.ok, after.ok ? "" : after.message);
  notDeepEqual(after.rgba, before.rgba, "the changed tile changes the picture");
  deepEqual(after.rgba, engineView(doc.serialize(), 64), "unsaved edits preview as the engine would draw them once saved");
});

test("a board whose tileset the project lacks has no preview and says which file", async () => {
  const host = createMemoryPlatformServices({ files: { "Boards/village.brd": FILES["Boards/village.brd"] } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/village.brd"), FILES["Boards/village.brd"]);
  ok(opened.ok);
  const preview = await previewBoard(host.fs, "memory-project", opened.document.serialize());
  ok(!preview.ok);
  ok(preview.message.includes("village.tst"), preview.message);
});

test("an isometric board is refused by the top-down preview with a reason", async () => {
  const host = createMemoryPlatformServices({ files: FILES });
  const written = writeBoard({ ...createEmptyBoard(), coordType: 1 });
  ok(written.ok);
  const preview = await previewBoard(host.fs, "memory-project", written.value);
  ok(!preview.ok);
  ok(preview.message.includes("isometric"));
});
