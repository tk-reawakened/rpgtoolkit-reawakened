import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  addTint,
  assetKey,
  bakeLights,
  cellTint,
  composeBoard,
  lightSamplePoint,
  rasterizeLights,
  type WorldBoard,
  type WorldLight,
} from "../src/index.ts";

const baseBoard: WorldBoard = {
  key: assetKey("boards/shade.brd"),
  coordType: 0,
  sizeX: 2,
  sizeY: 1,
  sizeL: 2,
  gridWidth: 2,
  gridHeight: 1,
  width: 64,
  height: 32,
  background: { r: 0, g: 0, b: 0 },
  ambient: { r: 5, g: 6, b: 7 },
  shadeLayers: [{ castLayer: 2, records: [{ runCount: 1, r: 10, g: 20, b: 30 }, { runCount: 1, r: -2, g: -3, b: -4 }] }],
  layers: [
    { tiles: [{ asset: assetKey("tiles/a.tst"), tile: 1 }, { asset: assetKey("tiles/a.tst"), tile: 1 }] },
    { tiles: [{ asset: assetKey("tiles/a.tst"), tile: 1 }, { asset: assetKey("tiles/a.tst"), tile: 1 }] },
  ],
};

test("cellTint sums ambient and shade layers cast onto the selected layer", () => {
  deepEqual(cellTint(baseBoard, 1, 0, 0, { r: 1, g: 2, b: 3 }), { r: 16, g: 28, b: 40 });
  deepEqual(cellTint(baseBoard, 2, 1, 0), { r: 3, g: 3, b: 3 });
});

test("ambient and tint sums are bounded by the draw contract", () => {
  deepEqual(addTint({ r: 1000, g: -1000, b: 0 }, { r: 100, g: -100, b: 2048 }), { r: 1020, g: -1020, b: 1020 });
});

const grey = (low: number, high: number) => [{ r: low, g: low, b: low }, { r: high, g: high, b: high }];
const SQUARE = { width: 4, height: 4 };
/** One grey value per cell, row by row, from a rasterized layer (docs/spec/formats/board.md#lights worked examples). */
const greys = (lights: readonly WorldLight[], grid = SQUARE): number[][] => {
  const layer = rasterizeLights(lights, grid);
  const cells: number[] = [];
  for (const record of layer.records) for (let index = 0; index < (record.runCount > 1 ? record.runCount : 1); index += 1) cells.push(record.r);
  return Array.from({ length: grid.height }, (_row, y) => cells.slice(y * grid.width, (y + 1) * grid.width));
};

test("a circle lights the cells whose top-left corner is strictly inside it", () => {
  const circle: WorldLight = { layer: 1, type: 0, nodes: [{ x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }], colours: grey(0, 100) };
  deepEqual(greys([circle]), [[0, 0, 0, 0], [0, 52, 52, 0], [0, 52, 52, 0], [0, 0, 0, 0]]);
});

test("a spotlight rotates by its longer radius point and keeps the shorter one's length", () => {
  const ellipse: WorldLight = { layer: 1, type: 0, nodes: [{ x: 32, y: -16 }, { x: 32, y: 32 }, { x: 96, y: 32 }], colours: grey(0, 100) };
  deepEqual(greys([ellipse]), [[16, 33, 16, 0], [50, 100, 50, 0], [16, 33, 16, 0], [0, 0, 0, 0]]);
});

test("a spotlight on a tested point gives that cell its full centre colour; one off the points can light nothing", () => {
  const small = (x: number, y: number, radius: number): WorldLight => ({ layer: 1, type: 0, nodes: [{ x: x, y: y - radius }, { x, y }, { x: x - radius, y }], colours: grey(0, 100) });
  const onPoint = greys([small(32, 32, 8)]);
  equal(onPoint[1]?.[1], 100);
  equal(onPoint.flat().filter((value) => value !== 0).length, 1);
  deepEqual(greys([small(48, 48, 12)]).flat().every((value) => value === 0), true);
  deepEqual(greys([small(48, 48, 0)]).flat().every((value) => value === 0), true);
});

test("a gradient clamps to its end colours and a clipped one lights only the band between its nodes", () => {
  const nodes = [{ x: 16, y: 0 }, { x: 80, y: 0 }];
  const clipped: WorldLight = { layer: 1, type: 2, nodes, colours: grey(0, 100) };
  const plain: WorldLight = { ...clipped, type: 1 };
  deepEqual(greys([clipped]), Array.from({ length: 4 }, () => [0, 25, 75, 0]));
  deepEqual(greys([plain]), Array.from({ length: 4 }, () => [0, 25, 75, 100]));
  deepEqual(greys([{ ...plain, nodes: [{ x: 16, y: 0 }, { x: 16, y: 0 }] }]).flat().every((value) => value === 0), true);
});

test("a negative gradient start rounds toward zero", () => {
  const diagonal: WorldLight = { layer: 1, type: 2, nodes: [{ x: 0, y: 0 }, { x: 100, y: 100 }], colours: grey(-60, 100) };
  deepEqual(greys([diagonal]), [[-60, -34, -8, 16], [-34, -8, 16, 42], [-8, 16, 42, 68], [16, 42, 68, 93]]);
});

test("lights add to the painted shade, rounding once per light and keeping values past 255", () => {
  const light: WorldLight = { layer: 1, type: 1, nodes: [{ x: 0, y: 0 }, { x: 32, y: 0 }], colours: grey(100, 100) };
  const layer = rasterizeLights([light], { width: 1, height: 1 }, [{ runCount: 1, r: 200, g: 200, b: 200 }]);
  deepEqual(layer.records, [{ runCount: 1, r: 300, g: 300, b: 300 }]);
});

test("cells are tested at the diamond centre on isometric boards", () => {
  deepEqual(lightSamplePoint(1, 4, 0, 0), { x: 32, y: 0 });
  deepEqual(lightSamplePoint(1, 4, 0, 1), { x: 0, y: 16 });
  deepEqual(lightSamplePoint(2, 4, 0, 0), { x: 128, y: -48 });
  deepEqual(lightSamplePoint(0, 4, 2, 1), { x: 64, y: 32 });
});

test("bakeLights adds source light objects into the board's one shading layer and consumes them", () => {
  const light: WorldLight = { layer: 7, type: 1, nodes: [{ x: 0, y: 0 }, { x: 64, y: 0 }], colours: [{ r: 0, g: 0, b: 0 }, { r: 10, g: 20, b: 30 }] };
  const baked = bakeLights({ ...baseBoard, lights: [light] });
  equal(baked.lights?.length, 0);
  equal(baked.shadeLayers?.length, 1);
  equal(baked.shadeLayers?.[0]?.castLayer, 2);
  deepEqual(baked.shadeLayers?.[0]?.records, [{ runCount: 1, r: 10, g: 20, b: 30 }, { runCount: 1, r: 3, g: 7, b: 11 }]);
});

test("composeBoard applies shading only when included", () => {
  const shaded = composeBoard({ board: baseBoard, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 64, height: 32 }, alpha: 0, include: { shading: true, images: false, sprites: false }, globalAmbient: { r: 1, g: 1, b: 1 } });
  const plain = composeBoard({ board: baseBoard, tick: 0, camera: { x: 0, y: 0 }, viewport: { width: 64, height: 32 }, alpha: 0, include: { shading: false, images: false, sprites: false }, globalAmbient: { r: 99, g: 99, b: 99 } });
  equal(shaded.commands[1]?.kind, "blit");
  equal(plain.commands[1]?.kind, "blit");
  if (shaded.commands[1]?.kind !== "blit" || plain.commands[1]?.kind !== "blit") throw new Error("expected blits");
  deepEqual(shaded.commands[1].tint, { r: 16, g: 27, b: 38 });
  deepEqual(plain.commands[1].tint, { r: 0, g: 0, b: 0 });
});
