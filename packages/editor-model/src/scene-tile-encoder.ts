import { DOS_PALETTE, isInsideIsoDiamond, tileDimensions, tilesetDetail, type DecodedTexture, type TilesetTile } from "@tk-reawakened/core";
import type { NativeTile } from "@tk-reawakened/native-data";

/** A composed image, in row-major RGBA byte order. */
export interface SceneTileImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type SceneTileEncodeResult =
  | { readonly ok: true; readonly tile: TilesetTile }
  | { readonly ok: false; readonly error: { readonly section: string; readonly message: string; readonly x?: number; readonly y?: number } };

const CORNERS = { "north-west": 1, "north-east": 2, "south-east": 4, "south-west": 8 } as const;

/** Apply the source transparency and the promised half-plane masks before wire encoding. */
export function encodeSceneTileCrop(
  detailCode: number,
  image: DecodedTexture,
  [x, y, width, height]: readonly [number, number, number, number],
  transparent: NativeTile["visual"]["transparent"],
  kitbash: NativeTile["kitbash"],
): SceneTileEncodeResult {
  const detail = tilesetDetail(detailCode);
  if (detail === undefined) return { ok: false, error: { section: "detail", message: `Unsupported tileset detail ${detailCode}.` } };
  const size = tileDimensions(detail);
  if (width !== size.width || height !== size.height) return { ok: false, error: { section: "size", message: `Detail ${detailCode} requires ${size.width}×${size.height} pixels.` } };
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x + width > image.w || y + height > image.h) {
    return { ok: false, error: { section: "rect", message: `Crop lies outside its source (${image.w}×${image.h}).` } };
  }
  let corners = 0;
  for (const operation of kitbash ?? []) if (operation.clearHalf) corners |= CORNERS[operation.diagonal];
  const colorKey = transparent.mode === "colorKey" ? transparent.color : null;
  const targetRgb = detail.bytesPerPixel === 3;
  const limit = 2 * width * height;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const v = 2 * row + 1;
    for (let column = 0; column < width; column += 1) {
      const u = 2 * column + 1;
      const from = ((y + row) * image.w + x + column) * 4;
      const to = (row * width + column) * 4;
      const r = image.rgba[from]!, g = image.rgba[from + 1]!, b = image.rgba[from + 2]!;
      const keyed = colorKey !== null && colorKey[0] === r && colorKey[1] === g && colorKey[2] === b;
      const cleared = ((corners & 1) !== 0 && u * height + v * width < limit)
        || ((corners & 2) !== 0 && (2 * width - u) * height + v * width < limit)
        || ((corners & 4) !== 0 && (2 * width - u) * height + (2 * height - v) * width < limit)
        || ((corners & 8) !== 0 && u * height + (2 * height - v) * width < limit);
      const alpha = keyed || cleared ? 0 : image.rgba[from + 3]!;
      if (alpha !== 0) {
        pixels[to] = r; pixels[to + 1] = g; pixels[to + 2] = b; pixels[to + 3] = alpha;
      } else if (targetRgb) {
        pixels[to + 1] = 1; pixels[to + 2] = 2;
      }
    }
  }
  return encodeSceneTile(detailCode, { width, height, pixels });
}

/**
 * Encode one already-composed tile (docs/spec/formats/tiles.md#tile-data).
 * Dimensions are the stored dimensions, not the doubled drawing dimensions.
 * Transparent RGB must match the reader's actual output: [0,1,2] for RGB
 * pixels, [0,0,0] for indexed pixels and outside the isometric diamond.
 * Duplicate palette colours deterministically choose the first usable index.
 */
export function encodeSceneTile(detailCode: number, image: SceneTileImage): SceneTileEncodeResult {
  const detail = tilesetDetail(detailCode);
  if (detail === undefined) return { ok: false, error: { section: "detail", message: `Unsupported tileset detail ${detailCode}.` } };
  const { width, height } = tileDimensions(detail);
  if (image.width !== width || image.height !== height || image.pixels.length !== width * height * 4) {
    return { ok: false, error: { section: "size", message: `Detail ${detailCode} requires ${width}×${height} RGBA pixels (${width * height * 4} bytes).` } };
  }
  const palette = new Map<number, number>();
  if (detail.bytesPerPixel === 1) {
    const limit = detailCode === 5 || detailCode === 6 ? 16 : 255;
    for (let i = 0; i < limit; i += 1) {
      const at = i * 3;
      const color = (DOS_PALETTE[at]! << 16) | (DOS_PALETTE[at + 1]! << 8) | DOS_PALETTE[at + 2]!;
      if (!palette.has(color)) palette.set(color, i);
    }
  }
  const pixels = new Uint8Array(detail.size * detail.size * detail.bytesPerPixel);
  let output = 0;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const at = (y * width + x) * 4;
      const r = image.pixels[at]!;
      const g = image.pixels[at + 1]!;
      const b = image.pixels[at + 2]!;
      const a = image.pixels[at + 3]!;
      const fail = (message: string): SceneTileEncodeResult => ({ ok: false, error: { section: "pixel", x, y, message } });
      if (detail.isometric && !isInsideIsoDiamond(x, y)) {
        if (r !== 0 || g !== 0 || b !== 0 || a !== 0) return fail("Pixels outside the isometric diamond must be transparent black.");
        continue;
      }
      if (a !== 0 && a !== 255) return fail("Partial alpha is not representable.");
      if (detail.bytesPerPixel === 3) {
        const key = r === 0 && g === 1 && b === 2;
        if ((a === 0) !== key) return fail("The RGB transparency key must be exactly [0,1,2,0] and cannot be opaque.");
        pixels[output++] = r;
        pixels[output++] = g;
        pixels[output++] = b;
      } else if (a === 0) {
        if (r !== 0 || g !== 0 || b !== 0) return fail("Indexed transparency must be transparent black.");
        pixels[output++] = 255;
      } else {
        const index = palette.get((r << 16) | (g << 8) | b);
        if (index === undefined) return fail(`Colour is not representable in detail ${detailCode}'s palette.`);
        pixels[output++] = index;
      }
    }
  }
  return { ok: true, tile: { pixels } };
}
