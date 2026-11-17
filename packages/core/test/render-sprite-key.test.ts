import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, composeBoard, rasterize, type SpriteDraw, type WorldBoard } from "../src/index.ts";

const WHITE = { r: 255, g: 255, b: 255 };
const TILE_KEY = { r: 0, g: 1, b: 2 };
const BACKGROUND = [4, 5, 6] as const;
const white = [255, 255, 255] as const;
const keyed = [0, 1, 2] as const;
const board: WorldBoard = { key: assetKey("boards/key.brd"), coordType: 0, sizeX: 1, sizeY: 1, sizeL: 1, width: 32, height: 32, background: WHITE, ambient: { r: 0, g: 0, b: 0 }, layers: [{ tiles: [] }] };
const cases: readonly {
  readonly name: string;
  readonly frame: Pick<NonNullable<SpriteDraw["frame"]>, "transparent">;
  readonly instance: Pick<SpriteDraw, "transparent">;
  readonly pixels: readonly (readonly number[])[];
}[] = [
  { name: "frame null overrides the instance key", frame: { transparent: null }, instance: { transparent: WHITE }, pixels: [white, keyed, BACKGROUND] },
  { name: "instance null disables colour-key exclusion", frame: {}, instance: { transparent: null }, pixels: [white, keyed, BACKGROUND] },
  { name: "omitted frame key inherits the instance key", frame: {}, instance: { transparent: TILE_KEY }, pixels: [white, BACKGROUND, BACKGROUND] },
  { name: "an explicit frame key overrides an unkeyed instance", frame: { transparent: WHITE }, instance: { transparent: null }, pixels: [BACKGROUND, keyed, BACKGROUND] },
];

for (const kind of ["picture", "tile"] as const) {
  for (const scenario of [...cases, {
    name: "omitted keys retain the documented legacy key",
    frame: {}, instance: {},
    pixels: kind === "picture" ? [BACKGROUND, keyed, BACKGROUND] : [white, BACKGROUND, BACKGROUND],
  }]) {
    test(`${kind} sprite: ${scenario.name}; alpha-zero pixels still expose the board`, () => {
      const asset = assetKey(kind === "picture" ? "bitmap/key.bmp" : "tiles/key.tst");
      const width = kind === "picture" ? 3 : 32;
      const height = kind === "picture" ? 1 : 32;
      const rgba = new Uint8Array(width * height * 4);
      rgba.set([255, 255, 255, 255, 0, 1, 2, 255, 200, 10, 20, 0]);
      const assets = new Map([[asset, { w: width, h: height, rgba }]]);
      const sprite: SpriteDraw = {
        id: "sprite", key: "sprite", layer: 1, x: Math.floor(width / 2), y: height, drawId: 0,
        ...scenario.instance,
        frame: { asset, width, height, ...(kind === "tile" ? { tile: 1 } : {}), ...scenario.frame },
      };
      const drawList = composeBoard({
        board: { ...board, background: { r: 4, g: 5, b: 6 } }, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 3, height: 1 }, alpha: 0,
        include: { shading: false, images: false, sprites: true }, sprites: [sprite], assets,
      });
      const result = rasterize(drawList, assets);
      equal(result.error, null);
      deepEqual([...result.rgba], scenario.pixels.flatMap((pixel) => [...pixel, 255]));
    });
  }
}
