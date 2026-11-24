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
  BinaryReader,
  readBoard,
  writeBoard,
  type Board,
  type EnginePhaseRegistration,
  type GameState,
} from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { boardPreviewRootForPath, buildNewBoard, createBoardDocument, createDocumentIdentity, previewBoard, type BoardCoordSystem, type BoardDocument } from "../src/index.ts";

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
function engineView(bytes: Uint8Array, width: number, height = width): Uint8Array {
  const files = new Map<string, Uint8Array>([["boards/village.brd", bytes], ["tiles/village.tst", tileset]]);
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const engine = createEngine({
    seed: 19,
    assetIndex: createAssetIndex(Object.keys(FILES)),
    assetRoot: PACKAGE_ROOT,
    initialBoard: "village.brd",
    width,
    height,
    maxTicks: 20,
    program: `createcanvas(${width}, ${height}, c)\nviewbrd("village.brd", 0, 0, c)\nend()\n`,
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


test("board preview roots follow the owning game's reserved-folder path", () => {
  deepEqual(boardPreviewRootForPath("Game/Example/Boards/nested/Map.brd"), { kind: "game", projectPath: "example" });
  deepEqual(boardPreviewRootForPath("Boards/nested/Map.brd"), PACKAGE_ROOT);
});
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
test("current-view preview crops the shared board composition at the requested camera", async () => {
  const host = createMemoryPlatformServices({ files: FILES });
  const whole = await previewBoard(host.fs, "memory-project", smallBoard());
  ok(whole.ok);
  const view = await previewBoard(host.fs, "memory-project", smallBoard(), {
    camera: { x: 16, y: 8 },
    viewport: { width: 24, height: 32 },
  });
  ok(view.ok, view.ok ? "" : view.message);
  if (!whole.ok || !view.ok) return;
  equal(view.width, 24);
  equal(view.height, 32);
  const expected = new Uint8Array(view.width * view.height * 4);
  for (let y = 0; y < view.height; y += 1) {
    const sourceStart = ((y + 8) * whole.width + 16) * 4;
    expected.set(whole.rgba.subarray(sourceStart, sourceStart + view.width * 4), y * view.width * 4);
  }
  deepEqual(view.rgba, expected, "viewport pixels are a clean crop of the full compositor output");
});


test("a board whose tileset the project lacks has no preview and says which file", async () => {
  const host = createMemoryPlatformServices({ files: { "Boards/village.brd": FILES["Boards/village.brd"] } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/village.brd"), FILES["Boards/village.brd"]);
  ok(opened.ok);
  const preview = await previewBoard(host.fs, "memory-project", opened.document.serialize());
  ok(!preview.ok);
  ok(preview.message.includes("village.tst"), preview.message);
});

/** A board of `system` with village.tst1 on layer 0 and village.tst2 on layer 1 along its first row of cells. */
function isoBoard(system: BoardCoordSystem, width: number, height: number): { readonly bytes: Uint8Array; readonly doc: BoardDocument } {
  const built = buildNewBoard({ name: "iso", coordSystem: system, pixelCoordinates: false, width, height, layers: 2, backgroundImage: "", template: null });
  if (!built.ok) throw new Error(built.message);
  const host = createMemoryPlatformServices({ files: { "Boards/village.brd": built.bytes } });
  const opened = createBoardDocument(host.fs, createDocumentIdentity("memory-project", "Boards/village.brd"), built.bytes);
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const cells = [0, 1, 2].flatMap((x) => [{ layer: 0, x, y: 1, tile: "village.tst1" }, { layer: 1, x, y: 1, tile: "village.tst2" }]);
  if (!opened.document.apply({ type: "set-tiles", gesture: "draw", cells }).ok) throw new Error("the cells were refused");
  return { bytes: opened.document.serialize(), doc: opened.document };
}

for (const [system, width, height, pixelWidth, pixelHeight] of [
  ["iso-stacked", 3, 4, 160, 48],
  ["iso-rotated", 3, 2, 160, 64],
] as const) {
  test(`an ${system} board previews as the engine's viewbrd draws it, at the board's pixel size`, async () => {
    const host = createMemoryPlatformServices({ files: FILES });
    const { bytes } = isoBoard(system, width, height);
    const preview = await previewBoard(host.fs, "memory-project", bytes);
    ok(preview.ok, preview.ok ? "" : preview.message);
    equal(preview.width, pixelWidth);
    equal(preview.height, pixelHeight);
    deepEqual(preview.rgba, engineView(bytes, pixelWidth, pixelHeight));
    ok(preview.rgba.some((value, index) => index % 4 !== 3 && value !== 0), "something is drawn");
  });

  test(`hiding a layer of an ${system} board leaves it out of the picture only`, async () => {
    const host = createMemoryPlatformServices({ files: FILES });
    const { bytes, doc } = isoBoard(system, width, height);
    const everything = await previewBoard(host.fs, "memory-project", bytes);
    const lowest = await previewBoard(host.fs, "memory-project", bytes, { visibleLayers: [0] });
    const nothing = await previewBoard(host.fs, "memory-project", bytes, { visibleLayers: [] });
    ok(everything.ok && lowest.ok && nothing.ok);
    if (!everything.ok || !lowest.ok || !nothing.ok) return;
    notDeepEqual(lowest.rgba, everything.rgba, "layer 2 is left out");
    notDeepEqual(nothing.rgba, lowest.rgba, "layer 1 is left out");
    // The picture without layer 2 is the picture of a board that never had its tiles.
    const emptied = doc.serialize();
    ok(doc.apply({ type: "set-tiles", gesture: "erase", cells: [0, 1, 2].map((x) => ({ layer: 1, x, y: 1, tile: "" })) }).ok);
    const withoutTiles = await previewBoard(host.fs, "memory-project", doc.serialize());
    ok(withoutTiles.ok);
    if (withoutTiles.ok) deepEqual(withoutTiles.rgba, lowest.rgba);
    deepEqual(await previewBoard(host.fs, "memory-project", emptied, { visibleLayers: [0, 1] }), everything, "naming every layer is the whole picture");
  });
}

/** A 32×32 24-bit bitmap, all one colour, written by hand. */
function solidBmp(red: number, green: number, blue: number): Uint8Array {
  const pixels = new Uint8Array(32 * 32 * 3);
  for (let at = 0; at < pixels.length; at += 3) pixels.set([blue, green, red], at);
  const header = new Uint8Array(54);
  const view = new DataView(header.buffer);
  header.set([0x42, 0x4d]);
  view.setUint32(2, 54 + pixels.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 32, true);
  view.setInt32(22, 32, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixels.length, true);
  return Uint8Array.from([...header, ...pixels]);
}

test("hiding the background leaves its image out of the picture", async () => {
  const empty = createEmptyBoard();
  const written = writeBoard({ ...empty, sizeX: 1, sizeY: 1, sizeL: 1, layerTitles: ["", ""], tileMatrix: [0], tileRuns: [{ lutIndex: 0, count: 1, marker: false }], properties: { ...empty.properties, backgroundImage: "sky.bmp" } });
  ok(written.ok);
  const host = createMemoryPlatformServices({ files: { "Bitmap/sky.bmp": solidBmp(200, 10, 10) } });
  const withImage = await previewBoard(host.fs, "memory-project", written.value);
  ok(withImage.ok, withImage.ok ? "" : withImage.message);
  const hidden = await previewBoard(host.fs, "memory-project", written.value, { showBackground: false });
  ok(hidden.ok, hidden.ok ? "" : hidden.message);
  if (!withImage.ok || !hidden.ok) return;
  deepEqual([...withImage.rgba.subarray(0, 4)], [200, 10, 10, 255]);
  deepEqual([...hidden.rgba.subarray(0, 4)], [0, 0, 0, 255], "the board's own background colour shows instead");
  deepEqual(await previewBoard(host.fs, "memory-project", written.value, { showBackground: true }), withImage);
});

/** The small board with painted shade and a light, saved as the editor saves them: one shading layer and an editable light. */
function litBoard(): Uint8Array {
  const read = readBoard(new BinaryReader(smallBoard()));
  if (!read.ok) throw new Error(read.error.message);
  const written = writeBoard({
    ...read.value,
    shadeLayers: [{ castLayer: 1, records: [{ runCount: 1, r: -60, g: 0, b: 30 }, { runCount: 3, r: 0, g: 0, b: 0 }] }],
    lights: [{ layer: 1, type: 1, nodes: [{ x: 0, y: 0 }, { x: 64, y: 0 }], colours: [{ r: 0, g: 0, b: 0 }, { r: 90, g: 60, b: -40 }] }],
  });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

test("a board with painted shade and a light previews as the engine's viewbrd draws it, and each can be hidden", async () => {
  const bytes = litBoard();
  const host = createMemoryPlatformServices({ files: { "Boards/village.brd": bytes, "Tiles/village.tst": tileset } });
  const show = async (options: Parameters<typeof previewBoard>[3] = {}) => {
    const picture = await previewBoard(host.fs, "memory-project", bytes, options);
    ok(picture.ok, picture.ok ? "" : picture.message);
    return picture.rgba;
  };
  const both = await show();
  deepEqual(both, engineView(bytes, 64), "shade and light together match the real engine's picture");
  const shadeOnly = await show({ showLighting: false });
  const lightOnly = await show({ showShading: false });
  const neither = await show({ showShading: false, showLighting: false });
  notDeepEqual(shadeOnly, both, "hiding the light changes the picture");
  notDeepEqual(lightOnly, both, "hiding the shade changes the picture");
  notDeepEqual(shadeOnly, lightOnly);
  const plain = await previewBoard(host.fs, "memory-project", smallBoard());
  ok(plain.ok);
  deepEqual(neither, plain.rgba, "with both hidden the board draws as if it had neither");
});
