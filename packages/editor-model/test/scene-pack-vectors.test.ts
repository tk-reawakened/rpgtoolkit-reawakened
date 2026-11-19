import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { Scene } from "@tk-reawakened/native-data";
import { lowerScenePackVectors } from "../src/scene-pack-vectors.ts";

type PackAsset = {
  readonly id: string;
  readonly name: string;
  readonly kind: "prop";
  readonly anchor: { readonly x: number; readonly y: number; readonly snap: string };
  readonly visuals: readonly { readonly source: string; readonly rect: readonly [number, number, number, number] }[];
  readonly solid: readonly { readonly label: string; readonly closed: boolean; readonly points: readonly (readonly [number, number])[] }[];
  readonly under: readonly { readonly label: string; readonly closed: boolean; readonly attributes: number; readonly points: readonly (readonly [number, number])[] }[];
};

const scene = (placedPacks: NonNullable<Scene["placedPacks"]>): Scene => ({
  contract: "scene",
  version: "1.0.0-pre.1",
  projection: "2d",
  size: { width: 10, height: 10 },
  floors: [{ id: "ground" }, { id: "upper" }],
  placedPacks,
});

const asset: PackAsset = {
  id: "arch",
  name: "Arch",
  kind: "prop",
  anchor: { x: 48, y: 70, snap: "bottom-center" },
  visuals: [{ source: "src", rect: [0, 0, 8, 8] }],
  solid: [
    { label: "collision", closed: true, points: [[-4, 0], [4, 0], [4, 8]] },
    { label: "barrier", closed: false, points: [[0, -3], [2, 1]] },
  ],
  under: [{ label: "canopy", closed: true, attributes: 5, points: [[-8, -2], [8, -2], [0, 6]] }],
};

const placed = scene([
  { instanceId: "first", pack: "packs/props.tkrpack", asset: "arch", floor: "upper", x: 100, y: 50 },
  { instanceId: "second", pack: "packs/props.tkrpack", asset: "arch", floor: "ground", x: -10, y: 4 },
]);
const resolve = (pack: string, id: string): PackAsset | null => pack === "packs/props.tkrpack" && id === asset.id ? asset : null;

test("pack vectors translate anchor-relative points and retain type, masks, closure, layers, and stable order", () => {
  const result = lowerScenePackVectors(placed, resolve, 2);
  ok(result.ok);
  equal(result.vectors.length, 6);
  deepEqual(result.vectors.map(({ points, attributes, closed, layer, type, handle }) => ({ points, attributes, closed, layer, type, handle })), [
    { points: [{ x: 96, y: 50 }, { x: 104, y: 50 }, { x: 104, y: 58 }], attributes: 0, closed: -1, layer: 2, type: 1, handle: "" },
    { points: [{ x: 100, y: 47 }, { x: 102, y: 51 }], attributes: 0, closed: 0, layer: 2, type: 1, handle: "" },
    { points: [{ x: 92, y: 48 }, { x: 108, y: 48 }, { x: 100, y: 56 }], attributes: 5, closed: -1, layer: 2, type: 2, handle: "" },
    { points: [{ x: -14, y: 4 }, { x: -6, y: 4 }, { x: -6, y: 12 }], attributes: 0, closed: -1, layer: 1, type: 1, handle: "" },
    { points: [{ x: -10, y: 1 }, { x: -8, y: 5 }], attributes: 0, closed: 0, layer: 1, type: 1, handle: "" },
    { points: [{ x: -18, y: 2 }, { x: -2, y: 2 }, { x: -10, y: 10 }], attributes: 5, closed: -1, layer: 1, type: 2, handle: "" },
  ]);
});

test("unresolved pack assets return a located problem rather than silently disappearing", () => {
  const result = lowerScenePackVectors(scene([
    { instanceId: "missing", pack: "packs/missing.tkrpack", asset: "arch", floor: "ground", x: 0, y: 0 },
  ]), () => null);
  ok(!result.ok);
  deepEqual(result.problems, [{ path: "placedPacks[0].asset", message: "Unable to resolve pack asset packs/missing.tkrpack#arch." }]);
});

test("translated points outside the board i32 range are refused", () => {
  const overflowing: PackAsset = { ...asset, solid: [{ label: "edge", closed: false, points: [[1, 0], [0, 1]] }], under: [] };
  const result = lowerScenePackVectors(scene([
    { instanceId: "edge", pack: "packs/props.tkrpack", asset: "arch", floor: "ground", x: 2147483647, y: 0 },
  ]), () => overflowing);
  ok(!result.ok);
  deepEqual(result.problems, [{ path: "placedPacks[0].solid[0].points[0]", message: "Translated point exceeds the board's signed 32-bit coordinate range." }]);
});

test("vector counts that would exceed the board's signed 16-bit upper bound are refused", () => {
  const result = lowerScenePackVectors(scene([
    { instanceId: "last-slot", pack: "packs/props.tkrpack", asset: "arch", floor: "ground", x: 0, y: 0 },
  ]), resolve, 32767);
  ok(!result.ok);
  equal(result.problems[0]?.path, "placedPacks[0].solid[1]");
});
