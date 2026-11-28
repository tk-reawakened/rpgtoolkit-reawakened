import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { BinaryReader, PACKAGE_ROOT, SCRIPT_SCREEN, assetKey, blitTexture, createAssetIndex, createEmptyCharacter, createEmptyMainFile, createEngine, createSurface, createSurfacesSection, expandTileToRgba, readBoard, readSurfacePixels, readTileAnimation, readTileset, resolveTileReference, utf8Encode, writeBoard, writeCharacter, writeMainFile, type EnginePhaseRegistration, type GameState } from "@tk-reawakened/core";
import { readScene, writeAssetPack, writeScene, writeTile as writeNativeTile, writeTileset as writeNativeTileset, type AssetPack, type NativeTile, type NativeTileSample, type Scene, type Tileset } from "@tk-reawakened/native-data";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { boardPreviewRootForPath, previewBoard } from "../src/board-preview.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage } from "../src/scene-build-ownership.ts";
import { proposeSceneBuildRecovery } from "../src/scene-build-recovery.ts";
import { asTerrainSceneDocument } from "../src/kinds.ts";
import { buildScene } from "../src/scene-build.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { compileSceneProject, prepareTerrainSceneProject, previewTerrainSceneProject, writePreparedTerrainSceneProject } from "../src/terrain-scene-project.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const scene: Scene = {
  contract: "scene", version: "1.0.0-pre.2", projection: "2d", size: { width: 1, height: 1 },
  floors: [{ id: "ground", tiles: [[1, 1]] }],
  tilePalette: [{}, { tile: "Tiles/wall.tkrtle" }],
  vectors: [{ id: "path", label: "Patrol", floor: "ground", type: "waypoint", closed: false, points: [[1, 2], [3, 4]], handle: "route" }],
  placedPacks: [{ instanceId: "arch", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 20, y: 30 }],
};
const wall: NativeTile = {
  contract: "tile", version: "1.0.0-pre.1", name: "Wall", projection: "2d", role: "wall",
  visual: { transparent: { mode: "alpha" }, sample: { file: "Bitmap/sheet.png", rect: [0, 0, 32, 32] } },
  solid: [{ label: "Wall", closed: true, points: [[0, 0], [32, 0], [32, 32], [0, 32]] }],
};
const tileset: Tileset = {
  contract: "tileset", version: "1.0.0-pre.2", name: "Walls",
  expects: { projection: "2d", cellSize: [32, 32] },
  tiles: [{ tile: "Tiles/wall.tkrtle" }],
  outputBinding: { target: "Tiles/walls.tst", detail: 1, slots: [{ slot: 1, tile: "Tiles/wall.tkrtle" }] },
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
const crop = async (sample: NativeTileSample) => "file" in sample ? { image: { rgba: pixels, w: 32, h: 32 }, rect: sample.rect } : null;
const inputs = {
  scene, scenePath: "Boards/town.tkrscn",
  resolvePack: async (path: string) => path === "Packs/props.tkrpack" ? pack : null,
  readSource: async (path: string) => path === "Bitmap/sheet.png" ? png : path === "Bitmap/prop.png" ? propPng : null,
  terrain: {
    tilesets: new Map([["Tiles/walls.tkrtst", tileset]]),
    loadTile: async (path: string) => path === "Tiles/wall.tkrtle" ? wall : null,
    resolveCrop: crop,
  },
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
  equal(decoded.value.lut[1], "walls.tst1");
  const resolved = resolveTileReference(createAssetIndex(["Tiles/walls.tst"]), PACKAGE_ROOT, decoded.value.lut[1]!);
  ok(resolved.ok && resolved.value.kind === "tileset");
  equal(resolved.value.asset, assetKey("Tiles/walls.tst"));
  equal(decoded.value.vectors[0]?.handle, "route");
  deepEqual(decoded.value.vectors[1]?.points, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 0, y: 32 }]);
  deepEqual(decoded.value.vectors[2]?.points, [{ x: 18, y: 29 }, { x: 22, y: 29 }, { x: 22, y: 31 }, { x: 18, y: 31 }]);
  equal(decoded.value.vectors[2]?.attributes, 7);
  equal(decoded.value.images[0]?.left, 19);
  const tileOutput = first.outputs.find((output) => output.path === "Tiles/walls.tst");
  ok(tileOutput && readTileset(tileOutput.bytes).ok);
  equal(tileOutput.producer, "Tiles/walls.tkrtst");
  ok(first.outputs.some((output) => output.path.startsWith("Bitmap/.tkr-generated/") && output.path.endsWith("/arch-0.png")));

  const placements = scene.placedPacks!;
  const appended = await buildScene({
    ...inputs, scene: { ...scene, placedPacks: [...placements, { ...placements[0]!, instanceId: "second-arch", x: 8 }] },
  });
  ok(appended.ok);
  const afterOutput = appended.outputs.find((output) => output.path === boardOutput.path);
  ok(afterOutput);
  const after = readBoard(new BinaryReader(afterOutput.bytes, afterOutput.path));
  ok(after.ok);
  deepEqual(after.value.lut, decoded.value.lut);
  deepEqual(after.value.vectors.slice(0, decoded.value.vectors.length), decoded.value.vectors);
  deepEqual(after.value.images.slice(0, decoded.value.images.length), decoded.value.images);
  equal(after.value.images.length, decoded.value.images.length + 1);
});

test("a nested project keeps tilesets, animation frames and PNGs inside its own folders", async () => {
  const water: NativeTile = {
    contract: "tile", version: "1.0.0-pre.1", name: "Water", projection: "2d", role: "floor",
    visual: { transparent: { mode: "alpha" }, cels: [
      { id: "first", sample: { file: "Game/Quest/Bitmap/sheet.png", rect: [0, 0, 32, 32] } },
      { id: "second", sample: { file: "Game/Quest/Bitmap/sheet.png", rect: [0, 0, 32, 32] } },
    ], timeline: { frames: [{ cel: "first", ms: 200 }, { cel: "second", ms: 200 }] } },
  };
  const nestedTileset: Tileset = {
    ...tileset,
    tiles: [{ tile: "Game/Quest/Tiles/wall.tkrtle" }, { tile: "Game/Quest/Tiles/water.tkrtle" }],
    outputBinding: { target: "Tiles/sets.tst", detail: 1, slots: [
      { slot: 1, tile: "Game/Quest/Tiles/wall.tkrtle" },
      { slot: 2, tile: "Game/Quest/Tiles/water.tkrtle", cel: "first" },
      { slot: 3, tile: "Game/Quest/Tiles/water.tkrtle", cel: "second" },
    ] },
  };
  const nestedPack: AssetPack = { ...pack, sources: [{ id: "sheet", file: "Game/Quest/Bitmap/prop.png", transparent: { mode: "alpha" } }] };
  const nestedScene: Scene = {
    ...scene,
    size: { width: 2, height: 1 },
    floors: [{ id: "ground", tiles: [[1, 0], [1, 1]] }],
    tilePalette: [{}, { tile: "Game/Quest/Tiles/wall.tkrtle" }, { tile: "Game/Quest/Tiles/water.tkrtle" }],
    placedPacks: [{ ...scene.placedPacks![0]!, pack: "Game/Quest/Packs/props.tkrpack" }],
  };
  const result = await buildScene({
    scene: nestedScene, scenePath: "Game/Quest/Boards/town.tkrscn", projectFolder: "Game/Quest",
    resolvePack: async (path) => path === "Game/Quest/Packs/props.tkrpack" ? nestedPack : null,
    readSource: async (path) => path === "Game/Quest/Bitmap/prop.png" ? propPng : png,
    terrain: {
      tilesets: new Map([["Game/Quest/Tiles/sets.tkrtst", nestedTileset]]),
      loadTile: async (path) => path === "Game/Quest/Tiles/wall.tkrtle" ? wall : path === "Game/Quest/Tiles/water.tkrtle" ? water : null,
      resolveCrop: crop,
    },
  });
  ok(result.ok, result.ok ? "" : result.problems.map((problem) => problem.message).join("; "));
  const tst = result.outputs.find((output) => output.path === "Game/Quest/Tiles/sets.tst");
  const tan = result.outputs.find((output) => output.path.startsWith("Game/Quest/Tiles/sets.tile-"));
  ok(tst && tan);
  equal(tst.producer, "Game/Quest/Tiles/sets.tkrtst");
  equal(tan.producer, "Game/Quest/Tiles/sets.tkrtst");
  const board = result.board;
  equal(board.lut[1], "sets.tst1");
  equal(board.lut[2], tan.path.slice("Game/Quest/Tiles/".length).replaceAll("/", "\\"));
  const tanAsset = tan.path.slice("Game/Quest/".length);
  const index = createAssetIndex(["Tiles/sets.tst", tanAsset]);
  const animated = resolveTileReference(index, PACKAGE_ROOT, board.lut[2]!);
  ok(animated.ok, board.lut[2]);
  equal(animated.value.kind, "animatedTile");
  equal(animated.value.asset, assetKey(tanAsset));
  const frames = readTileAnimation(new BinaryReader(tan.bytes));
  ok(frames.ok);
  deepEqual(frames.value.frames, ["sets.tst2", "sets.tst3"]);
  for (const frame of frames.value.frames) {
    const resolved = resolveTileReference(index, PACKAGE_ROOT, frame);
    ok(resolved.ok && resolved.value.kind === "tileset", frame);
    equal(resolved.value.asset, assetKey("Tiles/sets.tst"));
  }
  const generated = result.outputs.find((output) => output.path.startsWith("Game/Quest/Bitmap/.tkr-generated/"));
  ok(generated);
  equal(board.images[0]?.file, generated.path.slice("Game/Quest/Bitmap/".length).replaceAll("/", "\\"));
});

test("compiler output for two raster cels plays at exact phase-zero boundaries in the engine", async () => {
  const project = "Game/Example";
  const scenePath = `${project}/Boards/pond.tkrscn`;
  const tilesetPath = `${project}/Tiles/pond.tkrtst`;
  const westPath = `${project}/Tiles/west.tkrtle`;
  const eastPath = `${project}/Tiles/east.tkrtle`;
  const imagePath = `${project}/Bitmap/pond.png`;
  const rgba = new Uint8Array(96 * 64 * 4);
  const paint = (column: number, row: number, color: readonly [number, number, number, number]) => {
    for (let y = row * 32; y < (row + 1) * 32; y += 1) {
      for (let x = column * 32; x < (column + 1) * 32; x += 1) rgba.set(color, (y * 96 + x) * 4);
    }
  };
  const colors = {
    westFirst: [220, 20, 20, 255] as const,
    westLast: [20, 220, 20, 255] as const,
    eastFirst: [20, 20, 220, 255] as const,
    eastMiddle: [220, 220, 20, 255] as const,
    eastLast: [220, 20, 220, 255] as const,
    clear: [0, 0, 0, 0] as const,
  };
  paint(0, 0, colors.westFirst);
  paint(1, 0, colors.clear);
  paint(2, 0, colors.westLast);
  paint(0, 1, colors.eastFirst);
  paint(1, 1, colors.eastMiddle);
  paint(2, 1, colors.eastLast);
  const png = encodeScenePng({ w: 96, h: 64, rgba });
  const sample = (column: number, row: number): NativeTileSample => ({ file: imagePath, rect: [column * 32, row * 32, 32, 32] });
  const timeline = { frames: [{ cel: "first", ms: 200 }, { cel: "middle", ms: 200 }, { cel: "last", ms: 200 }] };
  const tile = (name: string, row: number): NativeTile => ({
    contract: "tile", version: "1.0.0-pre.1", name, projection: "2d", role: "floor",
    visual: {
      transparent: { mode: "alpha" },
      cels: [
        { id: "first", sample: sample(0, row) },
        { id: "middle", sample: sample(1, row) },
        { id: "last", sample: sample(2, row) },
      ],
      timeline,
    },
  });
  const west = tile("West water", 0);
  const east = tile("East water", 1);
  const authoredScene = writeScene({
    ...scene,
    size: { width: 2, height: 1 },
    floors: [{ id: "ground", tiles: [[1, 1], [1, 2]] }],
    tilePalette: [{}, { tile: westPath }, { tile: eastPath }],
    placedPacks: [],
  });
  const authoredTileset = writeNativeTileset({
    contract: "tileset", version: "1.0.0-pre.2", name: "Pond",
    expects: { projection: "2d", cellSize: [32, 32] },
    tiles: [{ tile: westPath }, { tile: eastPath }],
    outputBinding: {
      target: "Tiles/pond.tst", detail: 1,
      slots: [
        { slot: 1, tile: westPath, cel: "first" },
        { slot: 2, tile: westPath, cel: "middle" },
        { slot: 3, tile: westPath, cel: "last" },
        { slot: 4, tile: eastPath, cel: "first" },
        { slot: 5, tile: eastPath, cel: "middle" },
        { slot: 6, tile: eastPath, cel: "last" },
      ],
    },
  });
  const authoredWest = writeNativeTile(west);
  const authoredEast = writeNativeTile(east);
  ok(authoredScene.ok, authoredScene.ok ? "" : JSON.stringify(authoredScene.problems));
  ok(authoredTileset.ok, authoredTileset.ok ? "" : JSON.stringify(authoredTileset.problems));
  ok(authoredWest.ok, authoredWest.ok ? "" : JSON.stringify(authoredWest.problems));
  ok(authoredEast.ok, authoredEast.ok ? "" : JSON.stringify(authoredEast.problems));
  const host = createMemoryPlatformServices({ files: {
    [scenePath]: utf8Encode(authoredScene.text),
    [tilesetPath]: utf8Encode(authoredTileset.text),
    [westPath]: utf8Encode(authoredWest.text),
    [eastPath]: utf8Encode(authoredEast.text),
    [imagePath]: png,
  } });
  const compiled = await compileSceneProject({ fs: host.fs, scenePath });
  ok(compiled.ok, compiled.ok ? "" : compiled.problems.map(({ path, message }) => `${path}: ${message}`).join("; "));
  const boardOutput = compiled.built.outputs.find((output) => output.path === `${project}/Boards/pond.brd`);
  const tilesetOutput = compiled.built.outputs.find((output) => output.path === `${project}/Tiles/pond.tst`);
  const tanOutputs = compiled.built.outputs.filter((output) => output.path.endsWith(".tan"));
  ok(boardOutput && tilesetOutput);
  equal(tanOutputs.length, 2, "the compiler emits a distinct TAN for each animated source tile");
  const runtimeFiles = new Map(compiled.built.outputs.map((output) => [
    assetKey(output.path.slice(`${project}/`.length)), output.bytes,
  ] as const));
  const main = writeMainFile({
    ...createEmptyMainFile(), major: 2, minor: 9, startupPrg: "", initBoard: "pond.brd", initChar: "hero.tem",
  });
  ok(main.ok);
  const character = writeCharacter({
    ...createEmptyCharacter(), minor: 5, name: "Hero",
    movementAnimations: Array(8).fill(""), battleStances: Array(6).fill(""),
  });
  ok(character.ok);
  runtimeFiles.set(assetKey("main.gam"), main.value);
  runtimeFiles.set(assetKey("chrs/hero.tem"), character.value);
  const assetIndex = createAssetIndex([...runtimeFiles.keys()]);
  const board = readBoard(new BinaryReader(boardOutput.bytes, boardOutput.path));
  ok(board.ok);
  const tanReferences = board.value.lut.filter((reference) => reference.toLowerCase().endsWith(".tan"));
  equal(tanReferences.length, 2, "the built board references both compiled animations");
  const resolvedTans = tanReferences.map((reference) => {
    const resolved = resolveTileReference(assetIndex, PACKAGE_ROOT, reference);
    ok(resolved.ok && resolved.value.kind === "animatedTile", reference);
    return resolved.value.asset;
  });
  deepEqual(resolvedTans.slice().sort(), tanOutputs.map((output) => assetKey(output.path.slice(`${project}/`.length))).sort());

  const decodedTileset = readTileset(tilesetOutput.bytes);
  ok(decodedTileset.ok);
  const pixelForSlot = (slot: number): number[] => {
    const expanded = expandTileToRgba(decodedTileset.value, slot - 1);
    ok(expanded.ok, `expanded output slot ${slot}`);
    return [...expanded.value.subarray(0, 4)];
  };
  const assertPixel = (actual: readonly number[], expected: readonly number[], message: string) => {
    equal(actual[3], expected[3], `${message} alpha`);
    if (expected[3] !== 0) deepEqual(actual, expected, message);
  };
  const expectedSlots = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const actualFrameSlots = tanOutputs.map((output) => {
    const animation = readTileAnimation(new BinaryReader(output.bytes, output.path));
    ok(animation.ok, output.path);
    equal(animation.value.speed, 5, output.path);
    return animation.value.frames;
  });
  deepEqual(actualFrameSlots.slice().sort((a, b) => a[0]!.localeCompare(b[0]!)), [
    ["pond.tst1", "pond.tst2", "pond.tst3"],
    ["pond.tst4", "pond.tst5", "pond.tst6"],
  ]);
  const expectedCelPixels = [
    colors.westFirst, colors.clear, colors.westLast,
    colors.eastFirst, colors.eastMiddle, colors.eastLast,
  ];
  for (const [index, slot] of expectedSlots.flat().entries()) {
    assertPixel(pixelForSlot(slot), expectedCelPixels[index]!, `compiled raster in slot ${slot}`);
  }

  const engine = createEngine({
    seed: 7,
    assetIndex,
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "compiled-animation-output",
    width: 64,
    height: 32,
    maxTicks: 36,
    startup: {
      presence: { hasPlayer: () => true },
      savedGame: { load: () => ({ kind: "missing" }), restored: () => false },
    },
  });
  let report = engine.advance(0, []);
  for (let guard = 0; guard < 20 && (report.loading || report.requests.length > 0); guard += 1) {
    const events = report.requests.map((request) => {
      ok(request.kind === "asset", `unexpected engine request ${request.kind}`);
      const bytes = runtimeFiles.get(request.key);
      ok(bytes !== undefined, `compiled output exists for ${request.key}`);
      return { tick: report.tickAfter, event: { kind: "asset" as const, reqId: request.reqId, bytes } };
    });
    report = engine.advance(0, events);
  }
  equal(report.loading, false, "the held board and its compiled assets load in the real engine");
  equal(report.tickAfter, 0);
  const tstAsset = assetKey("Tiles/pond.tst");
  const checkpoints = [
    { tick: 0, slots: [1, 4], pixels: [colors.westFirst, colors.eastFirst] },
    { tick: 11, slots: [1, 4], pixels: [colors.westFirst, colors.eastFirst] },
    { tick: 12, slots: [2, 5], pixels: [colors.clear, colors.eastMiddle] },
    { tick: 24, slots: [3, 6], pixels: [colors.westLast, colors.eastLast] },
    { tick: 36, slots: [1, 4], pixels: [colors.westFirst, colors.eastFirst] },
  ];
  let currentTick = 0;
  for (const checkpoint of checkpoints) {
    const delta = checkpoint.tick - currentTick;
    for (let step = 0; step < delta; step += 1) {
      const previousTick = currentTick;
      report = engine.advance(1, []);
      currentTick = report.tickAfter;
      equal(currentTick, previousTick + 1, `engine advances at each tick before ${checkpoint.tick}`);
    }
    equal(currentTick, checkpoint.tick);
    const ordered = engine.drawList().commands.flatMap((command) => {
      if (command.kind !== "blit" || !("asset" in command.source) || command.source.asset !== tstAsset || command.source.tile === null) return [];
      return [{ x: command.dst.x, slot: command.source.tile }];
    }).sort((a, b) => a.x - b.x);
    deepEqual(ordered.map(({ x }) => x), [0, 32], `cell positions at tick ${checkpoint.tick}`);
    equal(ordered.length, 2, `two independently drawn cells at tick ${checkpoint.tick}`);
    deepEqual(ordered.map(({ slot }) => slot), checkpoint.slots, `tile slots at tick ${checkpoint.tick}`);
    for (const [index, { slot }] of ordered.entries()) {
      assertPixel(pixelForSlot(slot), checkpoint.pixels[index]!, `raster at tick ${checkpoint.tick}, cell ${index}`);
    }
  }
});

test("one project scene build keeps terrain, pack art, and traced boundaries in preview, Save and the engine", async () => {
  const scenePath = "Game/Example/Boards/town.tkrscn";
  const tile = "Game/Example/Tiles/wall.tkrtle";
  const railTile = "Game/Example/Tiles/rail.tkrtle";
  const wallSet: Tileset = { ...tileset, tiles: [{ tile }], outputBinding: { target: "Tiles/walls.tst", detail: 1, slots: [{ slot: 1, tile }] } };
  const rail: NativeTile = {
    contract: "tile", version: "1.0.0-pre.1", name: "Rail", projection: "2d", role: "wall",
    visual: { transparent: { mode: "alpha" }, sample: { file: "Game/Example/Bitmap/sheet.png", rect: [0, 0, 32, 32] } },
    solid: [{ label: "Rail", closed: false, points: [[3, 13], [27, 13]] }],
  };
  const railTileset: Tileset = {
    contract: "tileset", version: "1.0.0-pre.2", name: "Rail",
    expects: { projection: "2d", cellSize: [32, 32] },
    tiles: [{ tile: railTile }],
    terrains: [{
      id: "rail", name: "Rail", resolver: { provider: "builtin", id: "neighbour-match", version: "1.0.0" },
      neighbours: "cardinal-4", coverage: "complete", sync: "lockstep",
      rules: [{ id: "rail", when: {}, use: { tile: railTile } }],
    }],
    outputBinding: { target: "Tiles/rail.tst", detail: 1, slots: [{ slot: 1, tile: railTile }] },
  };
  const nestedPack: AssetPack = { ...pack, sources: [{ id: "sheet", file: "Game/Example/Bitmap/prop.png", transparent: { mode: "alpha" } }] };
  const authored = writeScene({
    ...scene,
    size: { width: 4, height: 1 },
    tilePalette: [{}, { tile }],
    placedPacks: [{ ...scene.placedPacks![0]!, pack: "Game/Example/Packs/props.tkrpack" }],
    floors: [{ id: "ground", tiles: [[1, 0], [1, 1], [2, 0]], boundarySources: { walkableTiles: [{ legacy: "walls.tst1" }] } }],
  });
  const authoredTile = writeNativeTile({ ...wall, visual: { transparent: { mode: "alpha" }, sample: { file: "Game/Example/Bitmap/sheet.png", rect: [0, 0, 32, 32] } } });
  const authoredRail = writeNativeTile(rail);
  const authoredTileset = writeNativeTileset(wallSet);
  const authoredRailTileset = writeNativeTileset(railTileset);
  const authoredPack = writeAssetPack(nestedPack);
  ok(authored.ok && authoredTile.ok && authoredRail.ok && authoredTileset.ok && authoredRailTileset.ok && authoredPack.ok, authored.ok ? "" : JSON.stringify(authored.problems));
  const fsFiles = {
    [scenePath]: utf8Encode(authored.text),
    [tile]: utf8Encode(authoredTile.text),
    [railTile]: utf8Encode(authoredRail.text),
    "Game/Example/Tiles/walls.tkrtst": utf8Encode(authoredTileset.text),
    "Game/Example/Tiles/rail.tkrtst": utf8Encode(authoredRailTileset.text),
    "Game/Example/Packs/props.tkrpack": utf8Encode(authoredPack.text),
    "Game/Example/Bitmap/sheet.png": png,
    "Game/Example/Bitmap/prop.png": propPng,
  };
  const host = createMemoryPlatformServices({ files: fsFiles });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(scenePath);
  ok(opened.ok);
  const doc = asTerrainSceneDocument(opened.document);
  ok(doc.apply({ type: "edit-scene-terrain", terrain: {
    terrainRegions: [{ id: "rail", floor: "ground", terrain: { tileset: "Game/Example/Tiles/rail.tkrtst", terrain: "rail" }, coverage: { shape: "tile-grid", spans: [[0, 0, 1], [2, 0, 1]] } }],
    tileOverrides: [{ floor: "ground", cell: [2, 0], tile: { legacy: "walls.tst1" } }],
  } }).ok);
  const path = "Game/Example/Boards/town.brd";
  const preview = await previewTerrainSceneProject({ fs: host.fs, projectId: "memory-project", scenePath, sceneText: doc.getSnapshot().text });
  ok(preview.ok, preview.ok ? "" : JSON.stringify(preview.problems));
  const changedPixels = new Uint8Array(pixels.length);
  for (let i = 0; i < changedPixels.length; i += 4) changedPixels.set([180, 70, 10, 255], i);
  const changedHost = createMemoryPlatformServices({ files: { ...fsFiles, "Game/Example/Bitmap/sheet.png": encodeScenePng({ w: 32, h: 32, rgba: changedPixels }) } });
  const changedPreview = await previewTerrainSceneProject({ fs: changedHost.fs, projectId: "memory-project", scenePath, sceneText: doc.getSnapshot().text });
  ok(changedPreview.ok, changedPreview.ok ? "" : JSON.stringify(changedPreview.problems));
  ok(changedPreview.preview.rgba.some((value, index) => value !== preview.preview.rgba[index]), "same-path sampled source bytes change the rendered preview pixels");
  equal(host.bytesOf(path), undefined, "preview must not generate files");
  deepEqual(host.bytesOf(scenePath), fsFiles[scenePath], "preview must not save the edit");
  deepEqual(await workspace.saveAll(), [{ document: scenePath, result: { ok: true } }]);
  const bytes = host.bytesOf(path);
  ok(bytes);
  const board = readBoard(new BinaryReader(bytes, path));
  ok(board.ok);
  deepEqual(board.value.tileMatrix, [2, 1, 3, 0]);
  deepEqual(board.value.lut, ["", "walls.tst1", "rail.tst1", "walls.tst1"]);
  const packImage = board.value.images[0]!;
  deepEqual([packImage.left, packImage.top, packImage.layer], [19, 28, 1]);
  const vectors = board.value.vectors.map(({ type, points }) => [type, points.map(({ x, y }) => [x, y])]);
  deepEqual(vectors, [
    [16, [[1, 2], [3, 4]]], // Authored waypoint.
    [1, [[3, 13], [27, 13]]], // Standalone rail; not a full-cell obstacle.
    [1, [[32, 0], [64, 0], [64, 32], [32, 32]]], // Standalone wall geometry.
    [2, [[18, 29], [22, 29], [22, 31], [18, 31]]], // Pack under-vector uses its placement.
    [1, [[64, 0], [96, 0], [96, 32], [64, 32], [64, 0]]], // Traces the final overridden cell, not the base grid.
  ]);
  const paths = [path, "Game/Example/Tiles/walls.tst", "Game/Example/Tiles/rail.tst", `Game/Example/Bitmap/${packImage.file.replaceAll("\\", "/")}`];
  const files = new Map(paths.map((output) => {
    const data = host.bytesOf(output);
    ok(data);
    return [assetKey(output), data] as const;
  }));
  ok((await doc.save()).ok);
  for (const output of paths) deepEqual(host.bytesOf(output), files.get(assetKey(output)));
  const savedPreview = await previewBoard(host.fs, "memory-project", bytes, { root: boardPreviewRootForPath(scenePath) });
  ok(savedPreview.ok);
  deepEqual(preview.preview.drawList, savedPreview.drawList);
  deepEqual(preview.preview.rgba, savedPreview.rgba);
  ok(preview.preview.drawList.commands.some((command) => command.kind === "blit" && "asset" in command.source && command.source.asset === assetKey(paths[3]!)));
  let latest: GameState | undefined;
  const registration: EnginePhaseRegistration = { phase: "events", run: (state) => { latest = state; } };
  const engine = createEngine({
    seed: 19, assetIndex: createAssetIndex(paths), assetRoot: { kind: "game", projectPath: "Example" },
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
  const tileText = writeNativeTile(wall);
  const tilesetText = writeNativeTileset(tileset);
  const packText = writeAssetPack(pack);
  ok(text.ok && tileText.ok && tilesetText.ok && packText.ok);
  const host = createMemoryPlatformServices({ files: {
    [inputs.scenePath]: utf8Encode(text.text),
    "Tiles/wall.tkrtle": utf8Encode(tileText.text),
    "Tiles/walls.tkrtst": utf8Encode(tilesetText.text),
    "Packs/props.tkrpack": utf8Encode(packText.text),
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
  ok(first.ok, first.ok ? "" : JSON.stringify(first.problems));
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
  const result = await buildScene({ ...inputs, terrain: { ...inputs.terrain, tilesets: new Map() } });
  ok(!result.ok);
  equal(result.problems[0]?.path, "tilePalette[1].tile");
});

test("a generated tileset cannot overwrite a tile's source image", async () => {
  const clashing: NativeTile = { ...wall, visual: { transparent: { mode: "alpha" }, sample: { file: "Tiles/walls.tst", rect: [0, 0, 32, 32] } } };
  const result = await buildScene({ ...inputs, terrain: { ...inputs.terrain, loadTile: async () => clashing } });
  ok(!result.ok);
  ok(result.problems.some((problem) => problem.path === "Tiles/walls.tst" && problem.message.includes("overwrite")), JSON.stringify(result.problems));
});

test("duplicate generated targets and unallocated palette tiles are refused", async () => {
  const duplicate: Tileset = { ...tileset, outputBinding: { ...tileset.outputBinding, target: "Tiles/Walls.TST" } };
  const duplicated = await buildScene({ ...inputs, terrain: { ...inputs.terrain, tilesets: new Map([["Tiles/walls.tkrtst", tileset], ["Tiles/other.tkrtst", duplicate]]) } });
  ok(!duplicated.ok);
  ok(duplicated.problems.some((problem) => problem.message.includes("also declared by")), JSON.stringify(duplicated.problems));
  const unallocated: Tileset = { ...tileset, outputBinding: { ...tileset.outputBinding, slots: [{ slot: 1, reserved: true }] } };
  const missing = await buildScene({ ...inputs, terrain: { ...inputs.terrain, tilesets: new Map([["Tiles/walls.tkrtst", unallocated]]) } });
  ok(!missing.ok);
  ok(missing.problems.some((problem) => problem.message.includes("no output slot")), JSON.stringify(missing.problems));
});
