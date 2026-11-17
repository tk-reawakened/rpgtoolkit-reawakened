import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  defaultBoardObject,
  nearestObjectPoint,
  nearestObjectSegment,
  objectHitDistance,
  objectPoints,
  rectangleObjectPoints,
  snapObjectPoint,
  tileBasePoint,
  translatedObject,
  type BoardShape,
} from "../src/board-object-tools.ts";

const TOP_DOWN: BoardShape = { sizeX: 8, sizeY: 6, coordType: 0 };
const STACKED: BoardShape = { sizeX: 8, sizeY: 6, coordType: 1 };
const ROTATED: BoardShape = { sizeX: 8, sizeY: 6, coordType: 2 };
const ROTATED_PIXELS: BoardShape = { ...ROTATED, coordType: 6 };

test("tile base points use core layout coordinates and the 2D bottom-centre", () => {
  deepEqual(tileBasePoint(TOP_DOWN, { x: 2, y: 3 }), { x: 80, y: 127 });
  deepEqual(tileBasePoint(STACKED, { x: 2, y: 3 }), { x: 128, y: 48 });
  deepEqual(tileBasePoint(ROTATED, { x: 2, y: 3 }), { x: 224, y: -32 });
});

test("snapping follows square or isometric grid, Ctrl inversion, Shift axes and flag 4", () => {
  deepEqual(snapObjectPoint(TOP_DOWN, { x: 47, y: 49 }), { x: 32, y: 64 });
  deepEqual(snapObjectPoint(TOP_DOWN, { x: 47, y: 49 }, true), { x: 47, y: 49 });
  deepEqual(snapObjectPoint(ROTATED, { x: 100, y: 50 }), { x: 96, y: 48 });
  deepEqual(snapObjectPoint(STACKED, { x: 97, y: 31 }), { x: 96, y: 16 });
  deepEqual(snapObjectPoint(TOP_DOWN, { x: 63, y: 49 }, false, { x: 32, y: 32 }, true), { x: 64, y: 64 });
  for (const shape of [STACKED, ROTATED]) {
    deepEqual(snapObjectPoint(shape, { x: 32, y: 0 }), { x: 32, y: -16 });
  }
  deepEqual(snapObjectPoint(ROTATED_PIXELS, { x: 47, y: 49 }), { x: 47, y: 49 });
  deepEqual(snapObjectPoint(ROTATED_PIXELS, { x: 47, y: 49 }, true), { x: 32, y: 48 });
  const constrained = snapObjectPoint(ROTATED, { x: 160, y: 80 }, false, { x: 96, y: 48 }, true);
  ok((constrained.x - 96) % 32 === 0 && Math.abs(constrained.y - 48) === Math.abs(constrained.x - 96) / 2);
});

test("rectangles use square corners and grid-aligned isometric parallelograms", () => {
  deepEqual(rectangleObjectPoints(TOP_DOWN, { x: 90, y: 80 }, { x: 10, y: 20 }), [
    { x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 80 }, { x: 10, y: 80 },
  ]);
  const stacked = rectangleObjectPoints(STACKED, { x: 32, y: 16 }, { x: 160, y: 48 });
  deepEqual(stacked, [{ x: 32, y: 16 }, { x: 128, y: 64 }, { x: 160, y: 48 }, { x: 64, y: 0 }]);
  deepEqual(rectangleObjectPoints(ROTATED, { x: 64, y: 32 }, { x: 192, y: 64 }), [
    { x: 64, y: 32 }, { x: 160, y: 80 }, { x: 192, y: 64 }, { x: 96, y: 16 },
  ]);
  deepEqual(rectangleObjectPoints(ROTATED_PIXELS, { x: 11, y: 7 }, { x: 63, y: 22 }), [
    { x: 11, y: 7 }, { x: 52, y: 28 }, { x: 63, y: 22 }, { x: 22, y: 2 },
  ]);
});

test("object points and selective movement preserve all unrelated raw fields", () => {
  const vector = { points: [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }], attributes: 7, closed: -1, layer: 2, type: 4, handle: "raw" } as const;
  const moved = translatedObject(vector, { x: 5, y: -2 }, [1]);
  deepEqual(moved.points, [{ x: 0, y: 0 }, { x: 37, y: -2 }, { x: 32, y: 32 }]);
  equal(moved.attributes, 7);
  equal(moved.type, 4);
  equal(moved.handle, "raw");
  const allMoved = translatedObject(vector, { x: 1, y: 2 }, []);
  deepEqual(allMoved.points[2], { x: 33, y: 34 });
  const sprite = { ...defaultBoardObject("sprites", 3, { x: 64, y: 95 }, []), itemFile: "raw.itm", reserved: 22 };
  deepEqual(objectPoints(sprite), [{ x: 64, y: 95 }]);
  const spriteMoved = translatedObject(sprite, { x: -4, y: 9 }, []);
  equal(spriteMoved.itemFile, "raw.itm");
  equal(spriteMoved.reserved, 22);
  equal(spriteMoved.x, 60);
  const image = { ...defaultBoardObject("images", 1, { x: 3, y: 4 }, []), file: "raw.png", reserved: -5 };
  const imageMoved = translatedObject(image, { x: 2, y: 7 }, []);
  equal(imageMoved.file, "raw.png");
  equal(imageMoved.reserved, -5);
  deepEqual(objectPoints(imageMoved), [{ x: 5, y: 11 }]);
});

test("nearest point and segment include a closing edge only for closed shapes", () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  equal(nearestObjectPoint(points, { x: 9, y: 1 }, 2), 1);
  equal(nearestObjectPoint(points, { x: 9, y: 1 }, 1), null);
  deepEqual(nearestObjectSegment(points, false, { x: 1, y: 5 }), {
    index: 0, point: { x: 1, y: 0 }, distance: 5,
  });
  const closed = nearestObjectSegment(points, true, { x: 1, y: 5 });
  equal(closed?.index, 2);
  deepEqual(closed?.point, { x: 3, y: 3 });
});

test("hit distance handles closed polygons, object bounds and placeholders", () => {
  const vector = defaultBoardObject("vectors", 1, { x: 0, y: 0 }, [
    { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 },
  ]);
  equal(objectHitDistance(vector, { x: 10, y: 10 }), 0);
  equal(objectHitDistance(vector, { x: 10, y: 25 }), 5);
  const sprite = defaultBoardObject("sprites", 1, { x: 32, y: 64 }, []);
  equal(objectHitDistance(sprite, { x: 32, y: 40 }), 0);
  equal(objectHitDistance(sprite, { x: 10, y: 40 }), 6);
  const image = defaultBoardObject("images", 1, { x: 5, y: 6 }, []);
  equal(objectHitDistance(image, { x: 20, y: 20 }), 0);
  equal(objectHitDistance(image, { x: 53, y: 38 }), 16);
  equal(objectHitDistance(image, { x: 54, y: 38 }), 17);
  equal(objectHitDistance(image, { x: 17, y: 12 }, { left: 10, top: 10, width: 2, height: 2 }), 5);
});

