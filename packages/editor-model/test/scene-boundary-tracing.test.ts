import { deepEqual, equal } from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@tk-reawakened/native-data";
import { buildScene } from "../src/scene-build.ts";
import { traceSceneBoundaries } from "../src/scene-boundary-tracing.ts";

function scene(projection: Scene["projection"], width: number, height: number, cells: readonly number[]): Scene {
  const tiles: [number, number][] = [];
  for (const cell of cells) {
    const last = tiles[tiles.length - 1];
    if (last?.[1] === cell) last[0] += 1;
    else tiles.push([1, cell]);
  }
  return {
    contract: "scene", version: "1.0.0-pre.1", projection, size: { width, height },
    floors: [{ id: "ground", tiles }], tilePalette: [{}, { legacy: "grass.tst1" }],
  };
}

test("boundary tracing merges adjacent walkable cells and orders disconnected contours", () => {
  const adjacent = traceSceneBoundaries(scene("2d", 2, 1, [1, 1]), 0, [1]);
  equal(adjacent.length, 1);
  deepEqual(adjacent[0]?.points, [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 64, y: 32 }, { x: 0, y: 32 }, { x: 0, y: 0 }]);
  equal(adjacent[0]?.closed, 0);

  const separated = traceSceneBoundaries(scene("2d", 3, 1, [1, 0, 1]), 0, [1]);
  equal(separated.length, 2);
  deepEqual(separated.map((vector) => vector.points[0]), [{ x: 0, y: 0 }, { x: 64, y: 0 }]);
});

test("boundary tracing emits a closed hole and supports isometric diamonds", () => {
  const holeScene: Scene = {
    contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 3, height: 3 },
    floors: [{ id: "ground", tiles: [[1, 1], [1, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1], [1, 1], [1, 1]] }],
    tilePalette: [{}, { legacy: "grass.tst1" }],
  };
  const contours = traceSceneBoundaries(holeScene, 0, [1]);
  equal(contours.length, 2);
  equal(contours[0]?.closed, 0);
  equal(contours[1]?.closed, -1);
  equal(contours[1]?.points.length, 4);

  const iso = traceSceneBoundaries(scene("iso-stacked", 1, 1, [1]), 0, [1]);
  equal(iso.length, 1);
  deepEqual(iso[0]?.points, [{ x: 32, y: 0 }, { x: 64, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 16 }, { x: 32, y: 0 }]);
});

test("scene builds append boundary vectors after authored vector slots", async () => {
  const authored = { id: "route", floor: "ground", type: "waypoint" as const, closed: false, points: [[1, 2], [3, 4]] as const, handle: "route" };
  const input: Parameters<typeof buildScene>[0] = {
    scenePath: "Boards/boundary.tkrscn",
    scene: {
      contract: "scene", version: "1.0.0-pre.1", projection: "2d", size: { width: 1, height: 1 },
      floors: [{ id: "ground", tiles: [[1, 1]], boundarySources: { walkableTiles: [{ legacy: "grass.tst1" }] } }],
      tilePalette: [{}, { legacy: "grass.tst1" }], vectors: [authored],
    },
    resolveTileset: async () => null, resolvePack: async () => null, readSource: async () => null,
  };
  const result = await buildScene(input);
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join("; "));
  equal(result.board.vectors.length, 2);
  equal(result.board.vectors[0]?.handle, "route");
  deepEqual(result.board.vectors[1]?.points, [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 32 }, { x: 0, y: 32 }, { x: 0, y: 0 }]);
});
