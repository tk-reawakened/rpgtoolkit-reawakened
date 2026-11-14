// E-05 / main-file rows 58 and 59 (docs/spec/engine/display-input-audio.md#e-05, docs/spec/formats/main-file.md):
// a project's debug overlays are its main file's `drawVectors` bit mask and `pathColor`, turned into draw commands at
// draw time, and a runner's `init.debug` overrides them for one run without changing what the project says.

import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";

import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeTileset,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
  type MainFile,
} from "../src/index.ts";
import type { Engine } from "../src/ports/engine.ts";

function mainFile(overrides: Partial<MainFile>): Uint8Array {
  const written = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    startupPrg: "",
    initBoard: "start.brd",
    initChar: "hero.tem",
    ...overrides,
  });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
}

function gameFiles(main: Uint8Array): { readonly files: Map<AssetKey, Uint8Array>; readonly paths: readonly string[] } {
  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty,
    sizeX: 2,
    sizeY: 2,
    sizeL: 1,
    tileMatrix: Array.from({ length: 4 }, () => 0),
    tileRuns: [{ lutIndex: 0, count: 4, marker: true }],
    layerTitles: ["", ""],
    lut: ["tile.tst1"],
    properties: {
      ...empty.properties,
      backgroundColour: { r: 0, g: 0, b: 0 },
      ambient: { r: 0, g: 0, b: 0 },
      start: { x: 16, y: 16, layer: 1 },
    },
    // One closed 32x32 square: the overlay's line commands are these four edges, camera at the board origin.
    vectors: [{ points: [{ x: 8, y: 8 }, { x: 40, y: 8 }, { x: 40, y: 40 }, { x: 8, y: 40 }], attributes: 0, closed: 1, layer: 1, type: 1, handle: "" }],
  });
  if (!board.ok) throw new Error(board.error.message);
  const character = writeCharacter({
    ...createEmptyCharacter(),
    minor: 5,
    name: "Hero",
    movementAnimations: Array(8).fill(""),
    battleStances: ["", "", "", "", "", ""],
  });
  if (!character.ok) throw new Error(character.error.message);
  const tileset = writeTileset({
    version: 20,
    detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false },
    tiles: [{ pixels: new Uint8Array(32 * 32 * 3).fill(255) }],
    residue: new Uint8Array(),
  });
  if (!tileset.ok) throw new Error(tileset.error.message);
  const files = new Map<AssetKey, Uint8Array>([
    [assetKey("main.gam"), main],
    [assetKey("boards/start.brd"), new Uint8Array(board.value)],
    [assetKey("chrs/hero.tem"), new Uint8Array(character.value)],
    [assetKey("tiles/tile.tst"), tileset.value],
  ]);
  return { files, paths: ["main.gam", "Boards/start.brd", "Chrs/hero.tem", "Tiles/tile.tst"] };
}

/** Boot the game and run until its board is up, answering asset requests from `files`. */
function boot(files: Map<AssetKey, Uint8Array>, paths: readonly string[], debug?: Parameters<typeof createEngine>[0]["debug"], sprites?: Parameters<typeof createEngine>[0]["sprites"]) {
  const engine = createEngine({
    seed: 1,
    assetIndex: createAssetIndex(paths),
    assetRoot: PACKAGE_ROOT,
    mainFile: "main.gam",
    gameIdentity: "debug-overlay-test",
    width: 64,
    height: 64,
    maxTicks: 200,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    ...(debug === undefined ? {} : { debug }),
    ...(sprites === undefined ? {} : { sprites }),
  });
  const step = (replies: InputRecord[] = []): void => {
    const report = engine.advance(1, replies);
    const answers: InputRecord[] = [];
    for (const request of report.requests) {
      if ("key" in request && typeof (request as { key?: unknown }).key === "string") {
        const key = (request as { key: string; reqId: number }).key;
        answers.push({ tick: report.tickAfter, event: { kind: "asset", reqId: (request as { reqId: number }).reqId, bytes: files.get(assetKey(key)) ?? null } });
      }
    }
    if (answers.length > 0) step(answers);
  };
  for (let tick = 0; tick < 60; tick += 1) step();
  // The board is up once the frame holds a tile blit rather than the held surface of the previous frame.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = engine.drawList(0, { shading: false, images: false, sprites: false });
    if (list !== null && list.commands.some((command) => command.kind === "blit" && typeof command.source === "object" && "tile" in command.source && command.source.tile !== null)) return engine;
    step();
  }
  throw new Error("the board never loaded in the overlay fixture");
}

function lines(commands: readonly DrawCommand[]): { readonly kind: "line"; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly rgb: { r: number; g: number; b: number } }[] {
  return commands.filter((command): command is Extract<DrawCommand, { kind: "line" }> => command.kind === "line");
}

test("a project's drawVectors draw board-vector outlines in its pathColor", () => {
  const { files, paths } = gameFiles(mainFile({ drawVectorsFlags: 1, pathColor: { r: 10, g: 20, b: 30 } }));
  const engine = boot(files, paths);
  const list = engine.drawList(0, { shading: false, images: false, sprites: false });
  if (list === null) throw new Error("the board frame is absent");
  const overlay = lines(list.commands);
  equal(overlay.length, 4, `a closed vector draws four edges: ${JSON.stringify(list.commands.map((command) => command.kind))}`);
  deepEqual(overlay[0], { kind: "line", x1: 8, y1: 8, x2: 40, y2: 8, rgb: { r: 10, g: 20, b: 30 } });
});

test("a project without drawVectors draws no overlays and leaves the frame as it was", () => {
  const { files, paths } = gameFiles(mainFile({ drawVectorsFlags: 0 }));
  const engine = boot(files, paths);
  const list = engine.drawList(0, { shading: false, images: false, sprites: false });
  if (list === null) throw new Error("the board frame is absent");
  equal(lines(list.commands).length, 0);
});

test("a runner's per-run debug flags override the project for that run", () => {
  const project = gameFiles(mainFile({ drawVectorsFlags: 1, pathColor: { r: 10, g: 20, b: 30 } }));
  // Override off: the project says 1, the run says 0.
  const off = boot(project.files, project.paths, { drawVectorsFlags: 0 });
  const offList = off.drawList(0, { shading: false, images: false, sprites: false });
  if (offList === null) throw new Error("the board frame is absent");
  equal(lines(offList.commands).length, 0, "the per-run override must win over the project's value");

  // Override colour: the project's pathColor is replaced, not merged.
  const recoloured = boot(project.files, project.paths, { pathColor: { r: 200, g: 1, b: 2 } });
  const recolouredList = recoloured.drawList(0, { shading: false, images: false, sprites: false });
  if (recolouredList === null) throw new Error("the board frame is absent");
  deepEqual(lines(recolouredList.commands)[0]?.rgb, { r: 200, g: 1, b: 2 });
});

test("a per-run colour overrides sprite outlines without changing their default orange", () => {
  const { files, paths } = gameFiles(mainFile({}));
  const sprites = [{ id: "test", key: "test", layer: 1, x: 0, y: 0, drawId: 1, collisionBase: [{ x: 4, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 12 }] }];
  const defaultEngine = boot(files, paths, { drawVectorsFlags: 2 }, sprites);
  const recolouredEngine = boot(files, paths, { drawVectorsFlags: 2, pathColor: { r: 10, g: 20, b: 255 } }, sprites);
  const draw = (engine: Engine) => {
    const frame = engine.drawList(0, { shading: false, images: false, sprites: false });
    if (frame === null) throw new Error("the board frame is absent");
    return lines(frame.commands).filter((line) => line.x1 === 4 && line.y1 === 4 && line.x2 === 12 && line.y2 === 4);
  };
  deepEqual(draw(defaultEngine).map((line) => line.rgb), [{ r: 255, g: 128, b: 0 }]);
  deepEqual(draw(recolouredEngine).map((line) => line.rgb), [{ r: 10, g: 20, b: 255 }]);
});

test("a file older than the pathColor row falls back to white rather than the model's zero sentinel", () => {
  // Both rows arrived at minor 9, so an old file carries neither: the overlay here comes from a per-run flag, which is
  // exactly when the colour default matters.
  const old = gameFiles(mainFile({ minor: 8 }));
  const engine = boot(old.files, old.paths, { drawVectorsFlags: 1 });
  const list = engine.drawList(0, { shading: false, images: false, sprites: false });
  if (list === null) throw new Error("the board frame is absent");
  const overlay = lines(list.commands);
  equal(overlay.length, 4);
  deepEqual(overlay[0]?.rgb, { r: 255, g: 255, b: 255 }, "main-file row 59 is absent before minor 9, so the colour is white");
});

test("the path and destination bits draw the route a host supplies", () => {
  const { files, paths } = gameFiles(mainFile({ drawVectorsFlags: 4 | 8, pathColor: { r: 1, g: 2, b: 3 } }));
  const engine = boot(files, paths, {
    path: [{ x: 16, y: 16 }, { x: 80, y: 16 }, { x: 80, y: 48 }],
    destination: { x: 80, y: 48 },
  });
  const list = engine.drawList(0, { shading: false, images: false, sprites: false });
  if (list === null) throw new Error("the board frame is absent");
  equal(lines(list.commands).length, 2, "a two-segment path draws two lines");
  const marker = list.commands.find((command) => command.kind === "ellipse");
  deepEqual(marker, { kind: "ellipse", rect: { x: 75, y: 43, w: 10, h: 10 }, rgb: { r: 1, g: 2, b: 3 }, filled: false });
});
