import { BinaryReader, assetKey, readAnimation, readItem, resolveAsset, type AssetIndex, type AssetKey, type AssetKind, type AssetRoot, type Board, type DecodedTexture, type SpriteDraw } from "@tk-reawakened/core";
import { classifyImageReference, spriteAnimationCanvasPreview, spriteGifPreview, spritePicturePreview, spriteTileBitmapPreviewFromAssets, spriteTileFrameFromReference, type SpritePreviewFrame } from "./sprite-document.ts";

export interface BoardSpritePreview {
  readonly draws: readonly SpriteDraw[];
  readonly textures: ReadonlyMap<AssetKey, DecodedTexture>;
  readonly bounds: readonly { readonly index: number; readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly placeholder: boolean }[];
  readonly warnings: readonly string[];
}

/** Resolve the first south-rest frame without executing item programs or evaluating game-state conditions. */
export async function previewBoardSprites(
  board: Board,
  index: AssetIndex,
  root: AssetRoot,
  load: (key: AssetKey) => Promise<Uint8Array | null>,
): Promise<BoardSpritePreview> {
  const textures = new Map<AssetKey, DecodedTexture>();
  const warnings: string[] = [];
  const graphics = new Map<AssetKey, SpritePreviewFrame | null>();
  const animations = new Map<AssetKey, SpritePreviewFrame | null>();
  const items = new Map<AssetKey, { readonly frame: SpritePreviewFrame | null; readonly reason: string | null }>();
  const readReference = async (kind: AssetKind, reference: string): Promise<{ readonly key: AssetKey; readonly bytes: Uint8Array } | null> => {
    const resolved = resolveAsset(index, root, kind, reference);
    if (!resolved.ok) return null;
    const bytes = await load(resolved.value);
    return bytes === null ? null : { key: resolved.value, bytes };
  };
  const loadTile = async (path: string): Promise<Uint8Array | null> => (await readReference("tiles", path))?.bytes ?? null;
  const graphic = async (reference: string): Promise<SpritePreviewFrame | null> => {
    const kind = classifyImageReference(reference);
    if (kind.kind === "tile" || kind.kind === "singleTile" || reference.toLowerCase().endsWith(".tan")) {
      return spriteTileFrameFromReference(reference, loadTile);
    }
    if (kind.kind !== "tileBitmap" && kind.kind !== "picture") return null;
    const source = await readReference("bitmaps", kind.path);
    if (source === null) return null;
    if (graphics.has(source.key)) return graphics.get(source.key)!;
    const frame = kind.kind === "tileBitmap"
      ? await spriteTileBitmapPreviewFromAssets(source.bytes, source.key, loadTile)
      : spritePicturePreview(source.bytes, source.key);
    graphics.set(source.key, frame);
    return frame;
  };
  const animationFrame = async (reference: string): Promise<SpritePreviewFrame | null> => {
    const source = await readReference("animations", reference);
    if (source === null) return null;
    if (animations.has(source.key)) return animations.get(source.key)!;
    let frame: SpritePreviewFrame | null = null;
    if (reference.toLowerCase().endsWith(".gif")) {
      const gif = spriteGifPreview(source.bytes, source.key);
      const page = gif?.frames[0];
      if (gif !== null && page !== undefined) frame = spriteAnimationCanvasPreview(page, page.width, page.height, gif.transparent);
    } else {
      const animation = readAnimation(new BinaryReader(source.bytes, source.key));
      const first = animation.ok ? animation.value.frames[0] : undefined;
      if (animation.ok && first !== undefined && first.image !== "") {
        const image = await graphic(first.image);
        if (image !== null) {
          const kind = classifyImageReference(first.image);
          const picture = kind.kind === "picture" || kind.kind === "tileBitmap";
          frame = spriteAnimationCanvasPreview(image, animation.value.width, animation.value.height, picture ? first.transparent : undefined, picture);
        }
      }
    }
    animations.set(source.key, frame);
    return frame;
  };
  const itemFrame = async (reference: string): Promise<{ readonly frame: SpritePreviewFrame | null; readonly reason: string | null }> => {
    const source = await readReference("items", reference);
    if (source === null) return { frame: null, reason: "item file is missing or could not be read" };
    const cached = items.get(source.key);
    if (cached !== undefined) return cached;
    const parsed = readItem(new BinaryReader(source.bytes, source.key));
    let result: { readonly frame: SpritePreviewFrame | null; readonly reason: string | null };
    if (!parsed.ok) result = { frame: null, reason: parsed.error.message };
    else {
      const item = parsed.value;
      const reference = item.idleAnimations?.[0] || (item.minor < 6 ? item.restAnimation : "") || item.movementAnimations?.[0] || "";
      const frame = reference === "" ? null : await animationFrame(reference);
      result = { frame, reason: reference === "" ? "item has no south idle or movement animation" : frame === null ? `${reference} has no decodable first frame` : null };
    }
    items.set(source.key, result);
    return result;
  };
  const draws: SpriteDraw[] = [];
  const bounds: BoardSpritePreview["bounds"][number][] = [];
  for (let slot = 0; slot < board.sprites.length; slot += 1) {
    const placed = board.sprites[slot]!;
    const result = placed.itemFile === "" ? { frame: null, reason: null } : await itemFrame(placed.itemFile);
    const frame = result.frame;
    const width = frame?.width ?? 32, height = frame?.height ?? 32;
    bounds.push({ index: slot, left: placed.x - Math.floor(width / 2), top: placed.y - height, width, height, placeholder: frame === null });
    if (frame !== null) {
      const key = assetKey(`__board_preview_sprite_${slot}`);
      textures.set(key, { w: width, h: height, rgba: frame.rgba });
      draws.push({ id: `board-item-${slot}`, key: placed.itemFile, layer: placed.layer, x: placed.x, y: placed.y, drawId: slot,
        frame: { asset: key, width, height, transparent: null } });
    } else if (result.reason !== null) warnings.push(`${placed.itemFile}: ${result.reason}`);
  }
  return { draws, textures, bounds, warnings };
}
