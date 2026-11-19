import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { decodeTexture, utf8Encode } from "@tk-reawakened/core";
import type { AssetPack, Scene } from "@tk-reawakened/native-data";
import { sha256Hex } from "../src/document-history.ts";
import { encodeScenePng } from "../src/scene-png.ts";
import { lowerScenePackImages } from "../src/scene-pack-images.ts";

const scene = (placedPacks: NonNullable<Scene["placedPacks"]>, projection: Scene["projection"] = "2d"): Scene => ({
  contract: "scene", version: "1.0.0-pre.1", projection, size: { width: 8, height: 8 },
  floors: [{ id: "ground" }, { id: "upper" }, { id: "loft" }], placedPacks,
});

const sourceBytes = encodeScenePng({ w: 3, h: 1, rgba: new Uint8Array([
  0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128,
]) });
const pack: AssetPack = {
  contract: "asset-pack", version: "1.0.0-pre.1", name: "test", projection: "2d",
  grid: { tileWidth: 32, tileHeight: 32 },
  sources: [{ id: "atlas", file: "Bitmap/atlas.png", transparent: { mode: "colorKey", color: [255, 0, 0] } }],
  assets: [{ id: "prop", name: "Prop", kind: "prop", anchor: { x: 1, y: 0, snap: "bottom-center" }, visuals: [
    { source: "atlas", rect: [0, 0, 3, 1], layerOffset: 1 },
  ] }],
};
const placements: Scene["placedPacks"] = [
  { instanceId: "first", pack: "Packs/test.tkrpack", asset: "prop", floor: "ground", x: 20, y: 30 },
  { instanceId: "second", pack: "Packs/test.tkrpack", asset: "prop", floor: "upper", x: 50, y: 60 },
];
const resolve = async (path: string): Promise<AssetPack | null> => path === "Packs/test.tkrpack" ? pack : null;
const read = async (path: string): Promise<Uint8Array | null> => path === "Bitmap/atlas.png" ? sourceBytes : null;

test("pack visuals lower in placement order with exact pixels, transparency key, alpha, and board placement", async () => {
  const result = await lowerScenePackImages(scene(placements), "Boards/one.tkrscn", resolve, read);
  ok(result.ok);
  equal(result.images.length, 2);
  equal(result.outputs.length, 2);
  deepEqual(result.images.map(({ file, left, top, layer, transparent }) => ({ file, left, top, layer, transparent })), [
    { file: `.tkr-generated\\${await sha256Hex(utf8Encode("Boards/one.tkrscn"))}\\first-0.png`, left: 19, top: 30, layer: 2, transparent: { r: 0, g: 0, b: 1 } },
    { file: `.tkr-generated\\${await sha256Hex(utf8Encode("Boards/one.tkrscn"))}\\second-0.png`, left: 49, top: 60, layer: 3, transparent: { r: 0, g: 0, b: 1 } },
  ]);
  const decoded = decodeTexture(result.outputs[0]!.bytes);
  ok(decoded.ok);
  deepEqual([...decoded.value.rgba], [0, 0, 0, 255, 0, 0, 1, 0, 0, 0, 255, 128]);
});

test("generated path and PNG bytes are deterministic for the same scene identity", async () => {
  const first = await lowerScenePackImages(scene([placements[0]!]), "Boards/one.tkrscn", resolve, read);
  const second = await lowerScenePackImages(scene([placements[0]!]), "Boards/one.tkrscn", resolve, read);
  ok(first.ok && second.ok);
  equal(first.outputs[0]!.path, second.outputs[0]!.path);
  deepEqual(first.outputs[0]!.bytes, second.outputs[0]!.bytes);
});

test("reports projection, crop, floor-layer, source-read, path conflict, and duplicate identity failures", async () => {
  const wrongProjection = await lowerScenePackImages(scene([placements[0]!], "iso-stacked"), "Boards/a.tkrscn", resolve, read);
  ok(!wrongProjection.ok);
  equal(wrongProjection.problems[0]?.path, "placedPacks[0].pack");
  const badCropPack = { ...pack, assets: [{ ...pack.assets[0]!, visuals: [{ source: "atlas", rect: [2, 0, 2, 1] as const }] }] };
  const badCrop = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", async () => badCropPack, read);
  ok(!badCrop.ok);
  equal(badCrop.problems[0]?.path, "placedPacks[0].visuals[0]");
  const badLayerPack = { ...pack, assets: [{ ...pack.assets[0]!, visuals: [{ source: "atlas", rect: [0, 0, 3, 1] as const, layerOffset: 3 }] }] };
  const badLayer = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", async () => badLayerPack, read);
  ok(!badLayer.ok);
  equal(badLayer.problems[0]?.path, "placedPacks[0].visuals[0]");
  const missing = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", resolve, async () => null);
  ok(!missing.ok);
  equal(missing.problems[0]?.path, "placedPacks[0].visuals[0]");
  const collision = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", resolve, read,
    [`Bitmap/.tkr-generated/${await sha256Hex(utf8Encode("Boards/a.tkrscn"))}/first-0.png`]);
  ok(!collision.ok);
  equal(collision.problems[0]?.path, "placedPacks[0].visuals[0]");
  const duplicate = await lowerScenePackImages(scene([placements[0]!, { ...placements[0]!, x: 1 }]), "Boards/a.tkrscn", resolve, read);
  ok(!duplicate.ok);
  equal(duplicate.problems[0]?.path, "placedPacks[1].instanceId");
});
test("rejects coordinate overflow, unresolved packs, and board image table overflow", async () => {
  const overflowPack = { ...pack, assets: [{ ...pack.assets[0]!, anchor: { x: -1, y: 0, snap: "bottom-center" } }] };
  const overflow = await lowerScenePackImages(scene([{ ...placements[0]!, x: 2147483647 }]), "Boards/a.tkrscn",
    async () => overflowPack, read);
  ok(!overflow.ok);
  equal(overflow.problems[0]?.path, "placedPacks[0]");
  const unresolved = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn",
    async () => { throw new Error("read failed"); }, read);
  ok(!unresolved.ok);
  equal(unresolved.problems[0]?.path, "placedPacks[0].pack");
  const crowded = {
    ...scene([placements[0]!]),
    images: Array.from({ length: 32768 }, () => ({
      x: 0, y: 0, layer: 1, transparent: [0, 0, 0] as const,
    })),
  };
  const tooMany = await lowerScenePackImages(crowded, "Boards/a.tkrscn", resolve, read);
  ok(!tooMany.ok);
  equal(tooMany.problems[0]?.path, "placedPacks[0].visuals[0]");
});


test("rejects JPEG crops and color-key conversion instead of re-encoding", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  const croppedPack = { ...pack, assets: [{ ...pack.assets[0]!, visuals: [{ source: "atlas", rect: [1, 0, 1, 1] as const }] }] };
  const cropped = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", async () => croppedPack,
    async () => jpeg);
  ok(!cropped.ok);
  equal(cropped.problems[0]?.message, "JPEG crops and transparency conversion are unavailable.");
  const keyConversion = await lowerScenePackImages(scene([placements[0]!]), "Boards/a.tkrscn", resolve, async () => jpeg);
  ok(!keyConversion.ok);
  equal(keyConversion.problems[0]?.message, "JPEG crops and transparency conversion are unavailable.");
});
