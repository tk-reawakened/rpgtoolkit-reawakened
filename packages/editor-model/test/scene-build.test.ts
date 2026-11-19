import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { BinaryReader, PACKAGE_ROOT, SCRIPT_SCREEN, assetKey, blitTexture, createAssetIndex, createEngine, createSurface, createSurfacesSection, readBoard, readSurfacePixels, readTileset, resolveTileReference, writeBoard, type EnginePhaseRegistration, type GameState } from "@tk-reawakened/core";
import { readScene, type AssetPack, type Scene, type Tileset } from "@tk-reawakened/native-data";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { previewBoard } from "../src/board-preview.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage } from "../src/scene-build-ownership.ts";
import { proposeSceneBuildRecovery } from "../src/scene-build-recovery.ts";
import { prepareSceneBuild, writePreparedSceneBuild } from "../src/scene-build-save.ts";
import { previewSceneBuild } from "../src/scene-build-preview.ts";
import { buildScene } from "../src/scene-build.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const scene: Scene = {
  contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 1, height: 1 },
  floors: [{ id: "ground", tiles: [[1, 1]] }],
  tilePalette: [{}, { tileset: "Art/walls.tkrtile", tile: "wall" }],
  vectors: [{ id: "path", label: "Patrol", floor: "ground", type: "waypoint", closed: false, points: [[1, 2], [3, 4]], handle: "route" }],
  placedPacks: [{ instanceId: "arch", pack: "Art/props.tkrpack", asset: "arch", floor: "ground", x: 20, y: 30 }],
};
const tileset: Tileset = {
  contract: "tileset", version: "1.0.0-pre.1", name: "Walls", projection: "2d", cellSize: [32, 32],
  sources: [{ id: "sheet", file: "Bitmap/sheet.png", grid: { width: 32, height: 32, marginX: 0, marginY: 0, gapX: 0, gapY: 0 }, transparent: { mode: "alpha" } }],
  tiles: [{ id: "wall", name: "Wall", source: "sheet", cell: [0, 0], role: "wall", collision: "solid" }],
  outputBinding: { target: "Tiles/walls.tst", detail: 1 },
};
const pack: AssetPack = {
  contract: "asset-pack", version: "1.0.0-pre.1", name: "Props", projection: "2d", grid: { tileWidth: 32, tileHeight: 32 },
  sources: [{ id: "sheet", file: "Bitmap/prop.png", transparent: { mode: "alpha" } }],
  assets: [{ id: "arch", name: "Arch", kind: "prop", anchor: { x: 1, y: 2, snap: "bottom-center" }, visuals: [{ source: "sheet", rect: [0, 0, 2, 2] }],
    under: [{ label: "lintel", closed: true, attributes: 7, points: [[-2, -1], [2, -1], [2, 1], [-2, 1]] }] }],
};
const pixels = new Uint8Array(32 * 32 * 4);
for (let i = 0; i < pixels.length; i += 4) pixels.set([20, 30, 40, 255], i);
const png = encodeScenePng({ w: 32, h: 32, rgba: pixels });
const propPng = encodeScenePng({ w: 2, h: 2, rgba: new Uint8Array([0, 0, 255, 128, 0, 0, 255, 128, 0, 0, 255, 128, 0, 0, 255, 128]) });
const inputs = {
  scene, scenePath: "Boards/town.tkrscn",
  resolveTileset: async (path: string) => path === "Art/walls.tkrtile" ? tileset : null,
  resolvePack: async (path: string) => path === "Art/props.tkrpack" ? pack : null,
  readSource: async (path: string) => path === "Bitmap/sheet.png" ? png : path === "Bitmap/prop.png" ? propPng : null,
};

test("a scene builds deterministic board and art with authored slots before generated collision", async () => {
  const first = await buildScene(inputs);
  const second = await buildScene(inputs);
  ok(first.ok, first.ok ? "" : first.problems.map((p) => p.message).join("; "));
  ok(second.ok);
  deepEqual(first.outputs, second.outputs);
  deepEqual(first.notes.map((note) => note.path), ["vectors[0].id", "vectors[0].label", "tilePalette", "placedPacks"]);
  const boardOutput = first.outputs.find((output) => output.path === "Boards/town.brd");
  ok(boardOutput);
  const decoded = readBoard(new BinaryReader(boardOutput.bytes, boardOutput.path));
  ok(decoded.ok);
  equal(decoded.value.lut[1], "Tiles\\walls.tst1");
  equal(decoded.value.vectors[0]?.handle, "route");
  deepEqual(decoded.value.vectors[1]?.points, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 0, y: 32 }]);
  deepEqual(decoded.value.vectors[2]?.points, [{ x: 18, y: 29 }, { x: 22, y: 29 }, { x: 22, y: 31 }, { x: 18, y: 31 }]);
  equal(decoded.value.vectors[2]?.attributes, 7);
  equal(decoded.value.images[0]?.left, 19);
  const tileOutput = first.outputs.find((output) => output.path === "Tiles/walls.tst");
  ok(tileOutput && readTileset(tileOutput.bytes).ok);
  ok(first.outputs.some((output) => output.path.startsWith("Bitmap/.tkr-generated/") && output.path.endsWith("/arch-0.png")));
});

test("scene preview uses the generated board and art without writing them", async () => {
  const emptyHost = createMemoryPlatformServices({ files: {} });
  const preview = await previewSceneBuild(emptyHost.fs, "memory-project", inputs);
  ok(preview.ok, preview.ok ? "" : preview.problems.map((problem) => problem.message).join("; "));
  const built = await buildScene(inputs);
  ok(built.ok);
  const host = createMemoryPlatformServices({ files: Object.fromEntries(built.outputs.map((output) => [output.path, output.bytes])) });
  const board = built.outputs.find((output) => output.path === "Boards/town.brd");
  ok(board);
  const savedPreview = await previewBoard(host.fs, "memory-project", board.bytes);
  ok(savedPreview.ok);
  deepEqual(preview.preview.drawList, savedPreview.drawList);
  deepEqual(preview.preview.rgba, savedPreview.rgba);
  const files = new Map(built.outputs.map((output) => [assetKey(output.path), output.bytes]));
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const engine = createEngine({
    seed: 19, assetIndex: createAssetIndex(built.outputs.map((output) => output.path)), assetRoot: PACKAGE_ROOT,
    initialBoard: "town.brd", width: preview.preview.width, height: preview.preview.height, maxTicks: 20,
    program: `createcanvas(${preview.preview.width}, ${preview.preview.height}, c)\nviewbrd("town.brd", 0, 0, c)\nend()\n`,
    phaseRegistrations: [registration],
  });
  let advance = engine.advance(0, []);
  for (let step = 0; step < 10; step += 1) {
    const events = advance.requests.filter((request) => request.kind === "asset")
      .map((request) => ({ tick: advance.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes: files.get(request.key) ?? new Uint8Array() } }));
    advance = engine.advance(1, events);
    if (advance.requests.length === 0 && !advance.loading) break;
  }
  ok(latest);
  const canvas = Object.values(latest.surfaces.entries).find((entry) => entry.id !== (0 as never) && entry.id !== SCRIPT_SCREEN);
  ok(canvas);
  const rendered = engine.surfacePixels(canvas.id, canvas.rev);
  ok(rendered);
  // viewbrd blits the composed preview onto a canvas; compare after that same
  // step, rather than comparing straight-RGBA pixels with canvas pixels.
  const surfaces = createSurfacesSection();
  const id = createSurface(surfaces, preview.preview.width, preview.preview.height);
  ok(blitTexture(surfaces, { w: preview.preview.width, h: preview.preview.height, rgba: preview.preview.rgba }, id, 0, 0));
  const entry = surfaces.entries[String(id)];
  ok(entry);
  const previewOnCanvas = readSurfacePixels(surfaces, id, entry.rev);
  ok(previewOnCanvas);
  deepEqual(previewOnCanvas.rgba, rendered.rgba);
  const root = await emptyHost.fs.list("");
  ok(root.ok);
  deepEqual(root.value, []);
});

test("saving checks a built board against its last build and preserves an outside edit", async () => {
  const host = createMemoryPlatformServices({ files: {} });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const ownership = createSceneBuildOwnership({
    fs: host.fs,
    storage: createSceneBuildOwnershipStorage(host.fs),
    history: workspace.history,
  });
  const first = await prepareSceneBuild(inputs, ownership);
  ok(first.ok);
  deepEqual(first.check.conflicts, []);
  const written = await writePreparedSceneBuild(first, ownership);
  ok(written.ok);
  const repeated = await prepareSceneBuild(inputs, ownership);
  ok(repeated.ok);
  ok((await writePreparedSceneBuild(repeated, ownership)).ok);
  equal(workspace.history.coverage("Bitmap/unrelated.png", 1).covered, false);
  equal(workspace.history.coverage("Bitmap/.tkr-generated/test/output.png", 1).covered, true);
  const changedBoard = writeBoard({ ...first.built.board, links: { ...first.built.board.links, north: "outside.brd" } });
  ok(changedBoard.ok);
  const changed = changedBoard.value;
  ok((await host.fs.write("Boards/town.brd", changed)).ok);
  const next = await prepareSceneBuild(inputs, ownership);
  ok(next.ok);
  ok(next.check.conflicts.some((conflict) => conflict.path === "Boards/town.brd" && conflict.kind === "modified"));
  const refused = await writePreparedSceneBuild(next, ownership);
  ok(!refused.ok);
  const onDisk = await host.fs.read("Boards/town.brd");
  ok(onDisk.ok);
  deepEqual(onDisk.value, changed);
  const recovery = proposeSceneBuildRecovery("Boards/town.brd", onDisk.value, ["Boards/town.tkrscn"]);
  ok(recovery.ok);
  equal(recovery.path, "Boards/town.recovered.tkrscn");
  ok(recovery.findings.some((finding) => finding.field === "U6"));
  const recovered = readScene(recovery.text);
  ok(recovered.ok);
  equal(recovered.scene.links?.north, "outside.brd");
  const noWrite = await host.fs.read(recovery.path);
  ok(!noWrite.ok && noWrite.error.code === "not-found");
});

test("missing native documents are reported without writing outputs", async () => {
  const result = await buildScene({ ...inputs, resolveTileset: async () => null });
  ok(!result.ok);
  equal(result.problems[0]?.path, "tilePalette[1].tileset");
});

test("a generated tileset cannot overwrite another asset's source", async () => {
  const otherPack: AssetPack = { ...pack, sources: [{ id: "sheet", file: "Tiles/walls.tst", transparent: { mode: "alpha" } }] };
  const result = await buildScene({ ...inputs, resolvePack: async () => otherPack, readSource: async () => png });
  ok(!result.ok);
  ok(result.problems.some((problem) => problem.path === "Tiles/walls.tst" && problem.message.includes("overwrite")));
});

test("generated tile references keep a nested Tiles folder", async () => {
  const nested: Tileset = { ...tileset, outputBinding: { target: "Tiles/Tiles/walls.tst", detail: 1 } };
  const built = await buildScene({ ...inputs, resolveTileset: async () => nested });
  ok(built.ok);
  const resolved = resolveTileReference(createAssetIndex(["Tiles/Tiles/walls.tst"]), PACKAGE_ROOT, built.board.lut[1]!);
  ok(resolved.ok && resolved.value.kind === "tileset");
  equal(resolved.value.asset, assetKey("Tiles/Tiles/walls.tst"));
});
