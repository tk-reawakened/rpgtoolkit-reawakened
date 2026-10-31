import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, composeBoard, rasterize, resolveFontAsset, type WorldBoard } from "../src/index.ts";

const board: WorldBoard = { key: assetKey("boards/test.brd"), coordType: 0, sizeX: 2, sizeY: 1, sizeL: 1, width: 64, height: 32, background: { r: 4, g: 5, b: 6 }, ambient: { r: 0, g: 0, b: 0 }, layers: [{ tiles: [{ asset: assetKey("tiles/test.tst"), tile: 1 }, { asset: assetKey("tiles/test.tst"), tile: 2 }] }] };

test("composeBoard emits fill then visible cells in layer/y/x order", () => {
  const list = composeBoard({ board, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 32, height: 32 }, alpha: 0, include: { shading: false, images: false, sprites: false } });
  equal(list.commands.length, 2);
  equal(list.commands[0]?.kind, "fill");
  const blit = list.commands[1];
  if (blit?.kind !== "blit") throw new Error("expected tile blit");
  deepEqual(blit.source, { asset: assetKey("tiles/test.tst"), tile: 1 });
  deepEqual(blit.key, { r: 0, g: 1, b: 2 });
  deepEqual(blit.tint, { r: 0, g: 0, b: 0 });
});

test("rasterize fills RGBA and leaves keyed source pixels transparent", () => {
  const key = assetKey("tiles/test.tst");
  const list = composeBoard({ board: { ...board, sizeX: 1, width: 32, layers: [{ tiles: [{ asset: key, tile: 1 }] }] }, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 1, height: 1 }, alpha: 0, include: { shading: false, images: false, sprites: false } });
  const pixels = new Uint8Array(32 * 32 * 4);
  pixels.set([0, 1, 2, 255], 0);
  pixels.set([9, 8, 7, 255], 4);
  const result = rasterize(list, new Map([[key, { w: 32, h: 32, rgba: pixels }]]));
  equal(result.error, null);
  deepEqual(Array.from(result.rgba), [4, 5, 6, 255]);
});

test("composeBoard emits background, tile, then layer images with viewport culling", () => {
  const imageKey = assetKey("bitmap/house.png");
  const imageBoard: WorldBoard = {
    ...board,
    images: [{ file: "house.png", left: 32, top: 0, layer: 1, drawType: 0, transparent: { r: 7, g: 8, b: 9 }, reserved: 100 }],
  };
  const list = composeBoard({
    board: imageBoard,
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 64, height: 32 },
    alpha: 0,
    include: { shading: false, images: true, sprites: false },
    assets: new Map([[imageKey, { w: 16, h: 16, rgba: new Uint8Array(16 * 16 * 4) }]]),
  });
  equal(list.commands.length, 4);
  const image = list.commands[3];
  if (image?.kind !== "blit") throw new Error("expected image blit");
  deepEqual(image.source, { asset: imageKey, tile: null });
  deepEqual(image.dst, { x: 32, y: 0, w: 16, h: 16 });
  deepEqual(image.key, { r: 7, g: 8, b: 9 });
});

test("composeBoard selects animated tile frames from the fixed tick", () => {
  const first = assetKey("tiles/first.tst");
  const second = assetKey("tiles/second.tst");
  const animated: WorldBoard = {
    ...board,
    sizeX: 1,
    width: 32,
    layers: [{
      tiles: [{
        asset: first,
        tile: 1,
        animation: { ticksPerFrame: 7, frames: [{ asset: first, tile: 1 }, { asset: second, tile: 2 }] },
      }],
    }],
  };
  const atZero = composeBoard({ board: animated, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 32, height: 32 }, alpha: 0, include: { shading: false, images: false, sprites: false } });
  const atSeven = composeBoard({ board: animated, tick: 7, camera: { x: 0, y: 0 }, viewport: { width: 32, height: 32 }, alpha: 0, include: { shading: false, images: false, sprites: false } });
  if (atZero.commands[1]?.kind !== "blit" || atSeven.commands[1]?.kind !== "blit") throw new Error("expected animated tile blits");
  deepEqual(atZero.commands[1].source, { asset: first, tile: 1 });
  deepEqual(atSeven.commands[1].source, { asset: second, tile: 2 });
});

test("composeBoard accepts the AD-29 board/assets/view form", () => {
  const list = composeBoard(board, new Map(), {
    tick: 0,
    camera: { x: 0, y: 0 },
    viewport: { width: 32, height: 32 },
    alpha: 0,
    include: { shading: false, images: false, sprites: false },
  });
  equal(list.commands.length, 2);
});

test("resolveFontAsset prefers an exact path, then a family match, then the Liberation substitution", () => {
  const keys = [assetKey("media/fonts/Custom Hand.ttf"), assetKey("media/fonts/LiberationSans-Regular.ttf"), assetKey("media/fonts/tkr-8x8.fnt")];
  equal(resolveFontAsset("media/fonts/Custom Hand.ttf", keys), assetKey("media/fonts/Custom Hand.ttf"), "an exact path wins");
  equal(resolveFontAsset("custom hand", keys), assetKey("media/fonts/Custom Hand.ttf"), "a family name matches ignoring case and spaces");
  equal(resolveFontAsset("Arial", keys), assetKey("media/fonts/LiberationSans-Regular.ttf"), "Arial substitutes Liberation Sans");
  equal(resolveFontAsset("sans-serif", keys), assetKey("media/fonts/LiberationSans-Regular.ttf"));
  equal(resolveFontAsset("Comic Sans MS", keys), null, "an unknown family resolves to nothing, so the caller falls back");
  equal(resolveFontAsset("", keys), null);
});
