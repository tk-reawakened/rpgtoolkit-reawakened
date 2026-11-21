import { ok } from "node:assert/strict";
import { test } from "node:test";
import { assetKey, composeBoard, type AssetKey, type DecodedTexture, type SpriteDraw, type WorldBoard } from "../src/index.ts";

// An ordinary draw and at most one lazy under-image index lookup per image, regardless of actor count.
const MAX_LOOKUPS_PER_IMAGE = 2;

void test("under-vector promotion does not resolve board images once per covered actor", () => {
  const arch = assetKey("Bitmap/arch.png");
  const texture: DecodedTexture = { w: 16, h: 16, rgba: new Uint8Array(16 * 16 * 4).fill(255) };
  let lookups = 0;
  class AssetReads extends Map<AssetKey, DecodedTexture> {
    override get(key: AssetKey): DecodedTexture | undefined {
      if (key === arch) lookups += 1;
      return super.get(key);
    }
  }
  const board: WorldBoard = {
    key: assetKey("Boards/garden.brd"), coordType: 0, sizeX: 2, sizeY: 2, sizeL: 1, width: 64, height: 64,
    background: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, layers: [{ tiles: Array.from({ length: 4 }, () => null) }],
    images: Array.from({ length: 4 }, (_, i) => ({ asset: arch, file: "Bitmap/arch.png", left: 4 + i * 4, top: 4, layer: 1, drawType: 0, transparent: { r: 1, g: 2, b: 3 }, reserved: 0 })),
    vectors: [{ type: 2, layer: 1, attributes: 4, closed: 1, handle: "arch", points: [{ x: 4, y: 4 }, { x: 32, y: 4 }, { x: 32, y: 20 }, { x: 4, y: 20 }] }],
  };
  const sprites: SpriteDraw[] = Array.from({ length: 6 }, (_, i) => ({ id: `actor-${i}`, key: "item", x: 12 + i, y: 20, layer: 1, drawId: i, width: 16, height: 16 }));
  const draw = composeBoard({ board, assets: new AssetReads([[arch, texture]]), sprites, spriteTranslucency: 0, tick: 0, alpha: 0,
    viewport: { width: 64, height: 64 }, camera: { x: 0, y: 0 }, include: { shading: false, images: true, sprites: true } });
  ok(draw.commands.some((command) => command.kind === "blit" && "asset" in command.source && command.source.asset === arch && command.dst.h === 1),
    "an image really is promoted over the actors");
  ok(lookups <= board.images!.length * MAX_LOOKUPS_PER_IMAGE, `resolved the four images ${lookups} times across six covered actors`);
});
