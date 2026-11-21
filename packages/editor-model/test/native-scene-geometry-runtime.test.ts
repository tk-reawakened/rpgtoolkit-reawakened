import { deepEqual, equal, notDeepEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, composeBoard, createAssetIndex, decodeTexture, enqueueDirectionMove, hydrateBoard, hydrateSprites, PACKAGE_ROOT, rasterize, runMovementPhase } from "@tk-reawakened/core";
import type { AssetPack, NativeTile, Scene, Tileset } from "@tk-reawakened/native-data";
import { buildScene } from "../src/scene-build.ts";
import { encodeScenePng } from "../src/scene-png.ts";

const scenePath = "Boards/geometry.tkrscn";
const fencePath = "Tiles/fence.tkrtle";
const packPath = "Packs/garden.tkrpack";
const scene: Scene = {
  contract: "scene", version: "1.0.0-pre.2", projection: "2d", pixelCoordinates: true,
  size: { width: 4, height: 4 }, floors: [{ id: "yard" }],
  tileOverrides: [{ floor: "yard", cell: [2, 1], tile: { tile: fencePath } }],
  placedPacks: [{ instanceId: "arch-one", pack: packPath, asset: "arch", floor: "yard", x: 48, y: 88 }],
};
const tile: NativeTile = {
  contract: "tile", version: "1.0.0-pre.1", name: "Fence", projection: "2d", role: "wall",
  visual: { transparent: { mode: "alpha" }, sample: { file: "Bitmap/fence.png", rect: [0, 0, 32, 32] } },
  solid: [{ label: "Rails", closed: false, points: [[16, 5], [16, 12]] }],
};
const tileset: Tileset = {
  contract: "tileset", version: "1.0.0-pre.2", name: "Yard", expects: { projection: "2d", cellSize: [32, 32] },
  tiles: [{ tile: fencePath }], outputBinding: { target: "Tiles/fence.tst", detail: 1, slots: [{ slot: 1, tile: fencePath }] },
};
const pack: AssetPack = {
  contract: "asset-pack", version: "1.0.0-pre.1", name: "Garden", projection: "2d", grid: { tileWidth: 32, tileHeight: 32 },
  sources: [{ id: "arch-art", file: "Bitmap/arch.png" }],
  assets: [{ id: "arch", name: "Arch", kind: "prop", anchor: { x: 8, y: 16, snap: "bottom-center" },
    visuals: [{ source: "arch-art", rect: [0, 0, 16, 16] }],
    under: [{ label: "Lintel", closed: true, attributes: 4, points: [[-7, -15], [0, -15], [0, -6], [-7, -6]] }],
  }],
};
const ARCH = [27, 159, 55, 255] as const;
const HERO = [206, 31, 54, 255] as const;
const texture = (size: number, rgba: readonly number[]) => {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return { w: size, h: size, rgba: pixels };
};
const fence = texture(32, [66, 53, 38, 255]);
const arch = texture(16, ARCH);
arch.rgba.fill(0, (4 * 16 + 5) * 4, (4 * 16 + 6) * 4);
const png = encodeScenePng(arch);

async function builtBoard() {
  const result = await buildScene({
    scene, scenePath,
    resolvePack: async (path) => path === packPath ? pack : null,
    readSource: async (path) => path === "Bitmap/arch.png" ? png : null,
    terrain: { tilesets: new Map([["Tiles/fence.tkrtst", tileset]]), loadTile: async () => tile,
      resolveCrop: async () => ({ image: fence, rect: [0, 0, 32, 32] }) },
  });
  ok(result.ok, !result.ok ? JSON.stringify(result.problems) : undefined);
  const paths = result.outputs.map(({ path }) => path);
  const bytes = new Map(result.outputs.map((output) => [assetKey(output.path), output.bytes]));
  const key = assetKey("Boards/geometry.brd");
  const read = hydrateBoard(key, bytes.get(key)!, createAssetIndex(paths), PACKAGE_ROOT, bytes);
  ok(read.value, read.error?.message ?? read.missing ?? "No board was hydrated");
  return { board: read.value.board, bytes };
}

void test("the built fence blocks across its rails but allows movement in the clear part of the same tile", async () => {
  const { board } = await builtBoard();
  const tryEast = (y: number) => {
    const sprites = hydrateSprites({ board, players: [{ id: "hero", kind: "player", source: "hero.tem", x: 62, y, layer: 1, controlled: true }] });
    enqueueDirectionMove(sprites, "hero", "E", 1);
    const events = runMovementPhase(sprites, board, 0, { pixelMovement: 1 });
    return { x: sprites.players[0]?.x, blocked: events.some(({ type }) => type === "blocked") };
  };
  deepEqual(tryEast(54), { x: 62, blocked: true });
  deepEqual(tryEast(63), { x: 66, blocked: false });
});

void test("a packed walk-behind region covers the sprite only under opaque pixels inside its outline", async () => {
  const { board, bytes } = await builtBoard();
  const image = board.images?.[0];
  ok(image?.asset !== undefined);
  const renderedArt = decodeTexture(bytes.get(image.asset)!, image.asset);
  ok(renderedArt.ok);
  const hero = assetKey("Bitmap/hero.png");
  const assets = new Map([[image.asset, renderedArt.value], [hero, texture(12, HERO)]]);
  const camera = { x: 32, y: 64 };
  const viewport = { width: 32, height: 32 };
  const view = { assets, tick: 0, camera, viewport, alpha: 0,
    include: { shading: false, images: true, sprites: true },
    sprites: [{ id: "hero", key: "player", layer: 1, x: 46, y: 84, drawId: 1, frame: { asset: hero, transparent: null } }],
  } as const;
  const render = (spriteTranslucency: number, renderBoard = board) => {
    const image = rasterize(composeBoard({ ...view, board: renderBoard, spriteTranslucency }), assets);
    equal(image.error, null);
    return image.rgba;
  };
  const at = (pixels: Uint8Array, x: number, y: number) => {
    const offset = ((y - camera.y) * viewport.width + x - camera.x) * 4;
    return [...pixels.slice(offset, offset + 4)];
  };
  const opaque = render(0);
  deepEqual(at(opaque, 44, 76), ARCH, "the lintel is drawn over the player inside the region");
  deepEqual(at(opaque, 45, 76), HERO, "the transparent hole does not obscure the player");
  deepEqual(at(opaque, 50, 76), HERO, "the same image stays behind the player outside the region");

  const silhouette = render(50);
  notDeepEqual(at(silhouette, 44, 76), ARCH, "the silhouette still shows through the lintel");
  deepEqual(at(silhouette, 45, 76), HERO);
  const under = board.vectors?.find(({ type }) => type === 2);
  ok(under);
  deepEqual(render(50, { ...board, vectors: [...(board.vectors ?? []), under] }), silhouette, "overlapping regions do not stack the silhouette");
});
