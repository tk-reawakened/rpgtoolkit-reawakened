import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { canon, composeBoard, createAssetIndex, createEmptyBoard, PACKAGE_ROOT, writeBoard, writeTileAnimation } from "../src/index.ts";
import { assetKey } from "../src/formats/resolver/resolver.ts";
import { hydrateBoard } from "../src/world/hydrate.ts";
import { createGameState } from "../src/save/state.ts";
import { restoreGameState, snapshot } from "../src/save/snapshot.ts";


test("hydrateBoard retains every animated board frame and requests uncached later assets", () => {
  const source = createEmptyBoard();
  const encodedBoard = writeBoard({
    ...source,
    sizeX: 2,
    sizeY: 1,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: ["", "flow.tan"],
    tileMatrix: [1, 1],
    tileRuns: [{ lutIndex: 1, count: 2, marker: true }],
  });
  if (!encodedBoard.ok) throw new Error(encodedBoard.error.message);
  const animation = writeTileAnimation({
    magic: "RPGTLKIT TILEANIM",
    major: 2,
    minor: 0,
    speed: 5,
    frameCount: 3,
    frames: ["one.tst1", "", "two.tst1"],
  });
  if (!animation.ok) throw new Error(animation.error.message);
  const index = createAssetIndex(["Boards/test.brd", "Tiles/flow.tan", "Tiles/one.tst", "Tiles/two.tst"]);
  const tileset = new Uint8Array(6 + 3072);
  tileset[0] = 20;
  tileset[2] = 1;
  tileset[4] = 1;
  const one = assetKey("tiles/one.tst");
  const two = assetKey("tiles/two.tst");
  const flow = assetKey("tiles/flow.tan");
  const initial = hydrateBoard(
    assetKey("boards/test.brd"),
    encodedBoard.value,
    index,
    PACKAGE_ROOT,
    new Map([[flow, animation.value], [one, tileset]]),
  );
  equal(initial.missing, two);
  const loaded = hydrateBoard(
    assetKey("boards/test.brd"),
    encodedBoard.value,
    index,
    PACKAGE_ROOT,
    new Map([[flow, animation.value], [one, tileset], [two, tileset]]),
  );
  if (loaded.value === null) throw new Error(loaded.error?.message ?? "expected hydrated board");
  const tile = loaded.value.board.layers[0]?.tiles[0];
  if (tile === null || tile === undefined) throw new Error("expected animated tile");
  deepEqual(tile.animation?.frames.map((frame) => frame === null ? null : [frame.asset, frame.tile]), [
    [one, 1],
    null,
    [two, 1],
  ]);
  deepEqual(loaded.value.board.layers[0]?.tiles[1]?.animation, tile.animation);
  const allBlankAnimation = writeTileAnimation({
    magic: "RPGTLKIT TILEANIM",
    major: 2,
    minor: 0,
    speed: 5,
    frameCount: 2,
    frames: ["", ""],
  });
  if (!allBlankAnimation.ok) throw new Error(allBlankAnimation.error.message);
  const allBlank = hydrateBoard(
    assetKey("boards/test.brd"),
    encodedBoard.value,
    index,
    PACKAGE_ROOT,
    new Map([[flow, allBlankAnimation.value]]),
  );
  if (allBlank.value === null) throw new Error(allBlank.error?.message ?? "expected hydrated all-blank board");
  equal(allBlank.value.board.layers[0]?.tiles[0], null, "all-empty animation stays an empty board cell");
  const state = createGameState({ seed: 7 });
  state.time.tick = 11;
  const restoredState = restoreGameState(snapshot({ ...state, world: { ...state.world, board: loaded.value.board } }));
  const restored = restoredState.world.board;
  deepEqual(restored, loaded.value.board);
  equal(restoredState.time.tick, 11);
  for (const tick of [11, 12, 24, 36]) {
    const draw = (board: typeof loaded.value.board) => composeBoard({
      board,
      tick,
      camera: { x: 0, y: 0 },
      viewport: { width: 64, height: 32 },
      alpha: 0,
      include: { shading: false, images: false, sprites: false },
    });
    deepEqual(draw(restored!), draw(loaded.value.board), `saved continuation at tick ${tick}`);
  }
});

test("hydrateBoard rejects malformed board bytes without partial world state", () => {
  const index = createAssetIndex(["Boards/village.brd", "Tiles/village.tst", "Tiles/water.tan"]);
  const result = hydrateBoard(assetKey("boards/village.brd"), new Uint8Array([0]), index, PACKAGE_ROOT, new Map());
  equal(result.value, null);
  equal(result.error !== null, true);
  equal(result.missing, null);
});
test("hydrateBoard builds plain world data and compacts empty item slots", () => {
  const source = createEmptyBoard();
  const board = {
    ...source,
    sizeX: 2,
    sizeY: 1,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: [""],
    tileMatrix: [0, 0],
    tileRuns: [{ lutIndex: 0, count: 2, marker: true }],
    sprites: [
      { itemFile: "", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 0, y: 0, layer: 1, reserved: -1 },
      { itemFile: "chest.itm", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0, x: 32, y: 32, layer: 1, reserved: -1 },
    ],
  };
  const encoded = writeBoard(board);
  if (!encoded.ok) throw new Error(encoded.error.message);
  const index = createAssetIndex(["Boards/test.brd"]);
  const result = hydrateBoard(assetKey("boards/test.brd"), encoded.value, index, PACKAGE_ROOT, new Map());
  if (result.value === null) throw new Error(result.error?.message ?? "expected hydration");
  equal(result.value.board.gridWidth, 2);
  equal(result.value.board.gridHeight, 1);
  equal(result.value.board.items?.length, 1);
  equal(result.value.board.items?.[0]?.slot, 1);
  equal(result.value.board.rawItems?.length, 2);
  const state = createGameState({ seed: 7 });
  const restored = restoreGameState(snapshot({ ...state, world: { ...state.world, board: result.value.board } })).world.board;
  if (restored === null || restored === undefined) throw new Error("expected restored board");
  deepEqual(restored, result.value.board);
  equal(canon(result.value.board as never), canon(restored as never));
});
