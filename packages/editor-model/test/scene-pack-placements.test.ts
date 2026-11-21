import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { Scene } from "@tk-reawakened/native-data";
import {
  copyScenePackPlacement, findTerrainScenePack, moveScenePackPlacement,
  nextScenePackPlacementId, placeScenePackAsset, placementPointForCell, removeScenePackPlacement,
  scenePackPlacementMissing, type TerrainScenePack,
} from "../src/scene-pack-placements.ts";

const packs: readonly TerrainScenePack[] = [
  {
    path: "Packs/props.tkrpack", name: "Props", projection: "2d",
    assets: [
      { id: "arch", name: "Arch", kind: "prop", anchor: { x: 1, y: 2, snap: "bottom-center" } },
      { id: "lantern", name: "Lantern", kind: "prop", anchor: { x: 4, y: 8, snap: "iso-diamond-center" } },
    ],
  },
  { path: "Packs/iso.tkrpack", name: "Iso", projection: "iso-stacked", assets: [{ id: "crate", name: "Crate", kind: "stamp", anchor: { x: 0, y: 0, snap: "top-left" } }] },
];

const scene = (placedPacks: NonNullable<Scene["placedPacks"]>): Scene => ({
  contract: "scene", version: "1.0.0-pre.2", projection: "2d", size: { width: 8, height: 8 },
  floors: [{ id: "ground" }, { id: "upper" }], placedPacks,
});

void test("placing an asset appends one record with a fresh ID and the chosen floor and anchor", () => {
  const first = placeScenePackAsset(scene([]), { pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground" }, 20, 40);
  equal(first.instanceId, "lantern-1");
  deepEqual(first.scene.placedPacks, [{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 }]);
  const second = placeScenePackAsset(first.scene, { pack: "Packs/props.tkrpack", asset: "lantern", floor: "upper" }, 52, 8);
  equal(second.instanceId, "lantern-2");
  equal(second.scene.placedPacks?.length, 2);
});

void test("moving a placement changes its floor and anchor but never its identity", () => {
  const source = scene([{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 }]);
  const moved = moveScenePackPlacement(source, "lantern-1", { floor: "upper", x: 60, y: 12 });
  ok(moved !== null);
  deepEqual(moved.placedPacks, [{ instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "upper", x: 60, y: 12 }]);
  equal(moveScenePackPlacement(source, "gone", { x: 1 }), null);
});

void test("copying inserts beside the source under a fresh ID and the copy takes a distinct generated name", () => {
  const source = scene([
    { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 },
    { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 4, y: 8 },
  ]);
  const copied = copyScenePackPlacement(source, "lantern-1");
  ok(copied !== null);
  equal(copied.instanceId, "lantern-2");
  deepEqual(copied.scene.placedPacks, [
    { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 },
    { instanceId: "lantern-2", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 },
    { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 4, y: 8 },
  ]);
  deepEqual(source.placedPacks?.map(({ instanceId }) => instanceId), ["lantern-1", "arch-1"]);
  equal(copyScenePackPlacement(source, "gone"), null);
});

void test("removing a placement takes only that record, and an unknown ID changes nothing", () => {
  const source = scene([
    { instanceId: "lantern-1", pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 20, y: 40 },
    { instanceId: "arch-1", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 4, y: 8 },
  ]);
  deepEqual(removeScenePackPlacement(source, "lantern-1").placedPacks?.map(({ instanceId }) => instanceId), ["arch-1"]);
  equal(removeScenePackPlacement(source, "gone"), source);
});

void test("a missing pack or asset stays identifiable, and a resolved reference reports nothing missing", () => {
  equal(scenePackPlacementMissing(packs, { instanceId: "a", pack: "Packs/props.tkrpack", asset: "arch", floor: "ground", x: 0, y: 0 }), null);
  equal(scenePackPlacementMissing(packs, { instanceId: "a", pack: "Packs/gone.tkrpack", asset: "arch", floor: "ground", x: 0, y: 0 }), "pack");
  equal(scenePackPlacementMissing(packs, { instanceId: "a", pack: "Packs/props.tkrpack", asset: "gone", floor: "ground", x: 0, y: 0 }), "asset");
  const linked: readonly TerrainScenePack[] = [
    { path: "Game/Other/Packs/Props.tkrpack", name: "Linked", projection: "2d", external: true, assets: [{ id: "arch", name: "Arch", kind: "prop", anchor: { x: 0, y: 0, snap: "bottom-center" } }] },
  ];
  equal(scenePackPlacementMissing(linked, { instanceId: "a", pack: "game/other/packs/PROPS.tkrpack", asset: "arch", floor: "ground", x: 0, y: 0 }), null, "document identity decides, not spelling");
  equal(findTerrainScenePack(linked, "GAME/OTHER/PACKS/props.TKRPACK")?.path, "Game/Other/Packs/Props.tkrpack", "the canonical inventory path is what an owner link opens");
});

void test("IDs are fresh, kebab-case and keep the source's stem", () => {
  const used = (["lantern-1", "lantern-2", "arch", "copy-3"] as const).map((instanceId) => ({ instanceId, pack: "Packs/props.tkrpack", asset: "lantern", floor: "ground", x: 0, y: 0 }));
  equal(nextScenePackPlacementId(used, "lantern-1"), "lantern-3");
  equal(nextScenePackPlacementId(used, "arch"), "arch-1");
  equal(nextScenePackPlacementId(used, "copy-3"), "copy-1");
  equal(nextScenePackPlacementId([], ""), "placement-1");
});

void test("pack placement snaps in board pixels for all three grid projections", () => {
  const square = scene([]);
  deepEqual(placementPointForCell(square, "bottom-center", 2, 3), { x: 80, y: 128 });
  deepEqual(placementPointForCell(square, "top-left", 4, 5), { x: 128, y: 160 });
  const stacked = { ...square, projection: "iso-stacked" } as const;
  deepEqual(placementPointForCell(stacked, "iso-diamond-center", 2, 3), { x: 128, y: 48 });
  deepEqual(placementPointForCell(stacked, "bottom-center", 2, 3), { x: 128, y: 64 });
  const rotated = { projection: "iso-rotated", size: { width: 4, height: 4 } } as const;
  deepEqual(placementPointForCell(rotated, "iso-diamond-center", 1, 2), { x: 96, y: 0 });
  equal(placementPointForCell(rotated, "iso-diamond-center", 0, 0), null, "this stored cell has no diamond on the board");
});
