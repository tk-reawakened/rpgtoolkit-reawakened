import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { BinaryReader, PACKAGE_ROOT, SCRIPT_SCREEN, assetKey, blitTexture, createAssetIndex, createEngine, createSurface, createSurfacesSection, readBoard, readSurfacePixels, readTileset, resolveTileReference, utf8Encode, writeBoard, type EnginePhaseRegistration, type GameState } from "@tk-reawakened/core";
import { readScene, writeAssetPack, writeScene, writeTileset as writeNativeTileset, type AssetPack, type Scene, type Tileset } from "@tk-reawakened/native-data";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { previewBoard } from "../src/board-preview.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage } from "../src/scene-build-ownership.ts";
import { proposeSceneBuildRecovery } from "../src/scene-build-recovery.ts";
import { asTerrainSceneDocument } from "../src/kinds.ts";
import { buildScene } from "../src/scene-build.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { prepareTerrainSceneProject, previewTerrainSceneProject, writePreparedTerrainSceneProject } from "../src/terrain-scene-project.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const scene: Scene = {
  contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 1, height: 1 },
  floors: [{ id: "ground", tiles: [[1, 1]] }],
  tilePalette: [{}, { tileset: "Art/walls.tkrtst", tile: "wall" }],
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
  resolveTileset: async (path: string) => path === "Art/walls.tkrtst" ? tileset : null,
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

test("one project scene build keeps terrain, pack art, and traced boundaries in preview, Save and the engine", async () => {
  const authored = writeScene({
    ...scene,
    size: { width: 4, height: 1 },
    floors: [{ id: "ground", tiles: [[1, 0], [1, 1], [2, 0]], boundarySources: { walkableTiles: [{ legacy: "WALLS.tst1" }] } }],
  });
  const authoredTileset = writeNativeTileset(tileset);
  const authoredPack = writeAssetPack(pack);
  ok(authored.ok && authoredTileset.ok && authoredPack.ok);
  const fsFiles = {
    [inputs.scenePath]: utf8Encode(authored.text),
    "Art/walls.tkrtst": utf8Encode(authoredTileset.text),
    "Art/props.tkrpack": utf8Encode(authoredPack.text),
    "Bitmap/sheet.png": png,
    "Bitmap/prop.png": propPng,
    "Art/rail.tkrtle": utf8Encode(`contract: tile
version: 1.0.0-pre.1
name: Rail
projection: 2d
role: wall
visual:
  transparent: {mode: alpha}
  sample: {file: Bitmap/sheet.png, rect: [0,0,32,32]}
solid: [{label: Rail, closed: false, points: [[3,13], [27,13]]}]
`),
    "Art/rail.tkrtst": utf8Encode(`contract: tileset
version: 1.0.0-pre.1
name: Rail
expects: {projection: 2d, cellSize: [32,32]}
tiles: [{tile: Art/rail.tkrtle}]
terrains:
  - id: rail
    name: Rail
    resolver: {provider: builtin, id: neighbour-match, version: 1.0.0}
    neighbours: cardinal-4
    coverage: complete
    sync: lockstep
    rules: [{id: rail, when: {}, use: {tile: Art/rail.tkrtle}}]
outputBinding:
  target: Tiles/rail.tst
  detail: 1
  slots: [{slot: 1, tile: Art/rail.tkrtle}]
`),
  };
  const host = createMemoryPlatformServices({ files: fsFiles });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(inputs.scenePath);
  ok(opened.ok);
  const doc = asTerrainSceneDocument(opened.document);
  ok(doc.apply({ type: "edit-scene-terrain", terrain: {
    terrainRegions: [{ id: "rail", floor: "ground", terrain: { tileset: "Art/rail.tkrtst", terrain: "rail" }, coverage: { shape: "tile-grid", spans: [[0, 0, 1], [2, 0, 1]] } }],
    tileOverrides: [{ floor: "ground", cell: [2, 0], tile: { legacy: "walls.tst1" } }],
  } }).ok);
  const path = "Boards/town.brd";
  const preview = await previewTerrainSceneProject({ fs: host.fs, projectId: "memory-project", scenePath: inputs.scenePath, sceneText: doc.getSnapshot().text });
  ok(preview.ok, preview.ok ? "" : JSON.stringify(preview.problems));
  equal(host.bytesOf(path), undefined, "preview must not generate files");
  deepEqual(host.bytesOf(inputs.scenePath), fsFiles[inputs.scenePath], "preview must not save the edit");
  deepEqual(await workspace.saveAll(), [{ document: inputs.scenePath, result: { ok: true } }]);
  const bytes = host.bytesOf(path);
  ok(bytes);
  const board = readBoard(new BinaryReader(bytes, path));
  ok(board.ok);
  deepEqual(board.value.tileMatrix, [2, 1, 3, 0]);
  deepEqual(board.value.lut, ["", "Tiles\\walls.tst1", "rail.tst1", "walls.tst1"]);
  const packImage = board.value.images[0]!;
  deepEqual([packImage.left, packImage.top, packImage.layer], [19, 28, 1]);
  const vectors = board.value.vectors.map(({ type, points }) => [type, points.map(({ x, y }) => [x, y])]);
  deepEqual(vectors, [
    [16, [[1, 2], [3, 4]]], // Authored waypoint.
    [1, [[3, 13], [27, 13]]], // Standalone rail; not a full-cell obstacle.
    [1, [[32, 0], [64, 0], [64, 32], [32, 32]]], // Embedded solid tile.
    [2, [[18, 29], [22, 29], [22, 31], [18, 31]]], // Pack under-vector uses its placement.
    [1, [[64, 0], [96, 0], [96, 32], [64, 32], [64, 0]]], // Traces the final overridden cell, not the base grid.
  ]);
  const paths = [path, "Tiles/walls.tst", "Tiles/rail.tst", `Bitmap/${packImage.file.replaceAll("\\", "/")}`];
  const files = new Map(paths.map((output) => {
    const data = host.bytesOf(output);
    ok(data);
    return [assetKey(output), data] as const;
  }));
  ok((await doc.save()).ok);
  for (const output of paths) deepEqual(host.bytesOf(output), files.get(assetKey(output)));
  const savedPreview = await previewBoard(host.fs, "memory-project", bytes);
  ok(savedPreview.ok);
  deepEqual(preview.preview.drawList, savedPreview.drawList);
  deepEqual(preview.preview.rgba, savedPreview.rgba);
  ok(preview.preview.drawList.commands.some((command) => command.kind === "blit" && "asset" in command.source && command.source.asset === assetKey(paths[3]!)));
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const engine = createEngine({
    seed: 19, assetIndex: createAssetIndex(paths), assetRoot: PACKAGE_ROOT,
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
  deepEqual(latest.world.board?.vectors?.map(({ type, points }) => [type, points.map(({ x, y }) => [x, y])]), vectors);
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
});

test("saving checks a built board against its last build and preserves an outside edit", async () => {
  const text = writeScene(scene);
  const tileText = writeNativeTileset(tileset);
  const packText = writeAssetPack(pack);
  ok(text.ok && tileText.ok && packText.ok);
  const host = createMemoryPlatformServices({ files: {
    [inputs.scenePath]: utf8Encode(text.text),
    "Art/walls.tkrtst": utf8Encode(tileText.text),
    "Art/props.tkrpack": utf8Encode(packText.text),
    "Bitmap/sheet.png": png,
    "Bitmap/prop.png": propPng,
  } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const ownership = createSceneBuildOwnership({
    fs: host.fs,
    storage: createSceneBuildOwnershipStorage(host.fs),
    history: workspace.history,
  });
  const options = { fs: host.fs, scenePath: inputs.scenePath, ownership };
  const first = await prepareTerrainSceneProject(options);
  ok(first.ok);
  deepEqual(first.check.conflicts, []);
  const written = await writePreparedTerrainSceneProject(first, ownership);
  ok(written.ok);
  const repeated = await prepareTerrainSceneProject(options);
  ok(repeated.ok);
  ok((await writePreparedTerrainSceneProject(repeated, ownership)).ok);
  equal(workspace.history.coverage("Bitmap/unrelated.png", 1).covered, false);
  equal(workspace.history.coverage("Bitmap/.tkr-generated/test/output.png", 1).covered, true);
  const changedBoard = writeBoard({ ...first.built.board, links: { ...first.built.board.links, north: "outside.brd" } });
  ok(changedBoard.ok);
  const changed = changedBoard.value;
  ok((await host.fs.write("Boards/town.brd", changed)).ok);
  const next = await prepareTerrainSceneProject(options);
  ok(next.ok);
  ok(next.check.conflicts.some((conflict) => conflict.path === "Boards/town.brd" && conflict.kind === "modified"));
  const refused = await writePreparedTerrainSceneProject(next, ownership);
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
