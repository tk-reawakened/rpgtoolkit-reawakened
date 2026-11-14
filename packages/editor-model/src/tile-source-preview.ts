import {
  assetKey,
  BinaryReader,
  compositeTileBitmap,
  decodeTileTexture,
  expandTileToRgba,
  readTileAnimation,
  readTileBitmap,
  readTileset,
  tileDimensions,
} from "@tk-reawakened/core";
import type { AssetCandidate } from "./reserved-folders.ts";

export interface TilePreviewPixels {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type TileSourcePreview =
  | { readonly kind: "tileset"; readonly tiles: readonly TilePreviewPixels[] }
  | { readonly kind: "single"; readonly preview: TilePreviewPixels }
  | { readonly kind: "animation"; readonly frameCount: number; readonly speed: number; readonly preview: TilePreviewPixels | null }
  | { readonly kind: "bitmap"; readonly preview: TilePreviewPixels };

export type TileSourcePreviewResult =
  | { readonly ok: true; readonly value: TileSourcePreview }
  | { readonly ok: false; readonly message: string };

interface DecodedSourcePreview {
  readonly preview: TilePreviewPixels;
  readonly tileCount: number | null;
}

const failure = (message: string): TileSourcePreviewResult => ({ ok: false, message });

function suffix(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

function withoutTilesPrefix(reference: string): string {
  const normalized = reference.replaceAll("/", "\\");
  const prefix = "Tiles\\";
  return assetKey(normalized.slice(0, prefix.length)) === assetKey(prefix)
    ? normalized.slice(prefix.length)
    : normalized;
}

/**
 * The format-aware, project-scoped previewer for tiles, animations and tile bitmaps. UI hosts provide the project asset
 * candidates and byte reader; all parsing, reference resolution and pixel composition stays behind editor-model.
 */
export function createTileSourcePreviewer(
  sources: readonly Pick<AssetCandidate, "reference" | "path">[],
  readAsset: (path: string) => Promise<Uint8Array | null>,
) {
  const decodedCache = new Map<string, Promise<DecodedSourcePreview | null>>();

  async function previewReference(reference: string, resolving = new Set<string>()): Promise<TilePreviewPixels | undefined> {
    const relative = withoutTilesPrefix(reference);
    const single = /\.gph$/i.test(relative);
    const animated = /\.tan$/i.test(relative);
    const match = single || animated ? null : /^(.*\.(?:tst|iso))(\d+)$/i.exec(relative);
    if (!single && !animated && match === null) return undefined;
    const wantedSourceKey = assetKey(single || animated ? relative : match![1]!);
    const source = sources.find((candidate) => assetKey(candidate.reference.replaceAll("/", "\\")) === wantedSourceKey);
    if (source === undefined) return undefined;
    const key = assetKey(source.reference.replaceAll("/", "\\"));
    if (resolving.has(key)) return undefined;
    let decoded = decodedCache.get(key);
    if (decoded === undefined) {
      decoded = (async (): Promise<DecodedSourcePreview | null> => {
        const bytes = await readAsset(source.path);
        if (bytes === null) return null;
        if (suffix(source.path) === ".tan") {
          const animation = readTileAnimation(new BinaryReader(bytes, source.path));
          if (!animation.ok) return null;
          const frame = animation.value.frames.find((entry) => entry !== "");
          if (frame === undefined) return null;
          const nextResolving = new Set(resolving);
          nextResolving.add(key);
          const preview = await previewReference(frame, nextResolving);
          return preview === undefined ? null : { preview, tileCount: null };
        }
        const texture = decodeTileTexture(assetKey(source.reference), bytes);
        if (!texture.ok) return null;
        if (suffix(source.path) !== ".tst" && suffix(source.path) !== ".iso") {
          return { preview: { width: texture.texture.w, height: texture.texture.h, pixels: texture.texture.rgba }, tileCount: null };
        }
        const tileset = readTileset(bytes, source.path);
        if (!tileset.ok) return null;
        return {
          preview: { width: texture.texture.w, height: texture.texture.h, pixels: texture.texture.rgba },
          tileCount: tileset.value.tiles.length,
        };
      })();
      decodedCache.set(key, decoded);
    }
    const data = await decoded;
    if (data === null) return undefined;
    if (single || animated) return data.preview;
    const index = Number(match![2]) - 1;
    if (data.tileCount === null || !Number.isInteger(index) || index < 0 || index >= data.tileCount) return undefined;
    const width = data.preview.width / data.tileCount;
    if (!Number.isInteger(width)) return undefined;
    const height = data.preview.height;
    const pixels = new Uint8Array(width * height * 4);
    const offsetX = index * width;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (y * data.preview.width + offsetX + x) * 4;
        pixels.set(data.preview.pixels.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
      }
    }
    return { width, height, pixels };
  }

  async function previewSource(source: AssetCandidate, bytes: Uint8Array): Promise<TileSourcePreviewResult> {
    const ext = suffix(source.path);
    if (ext === ".tst" || ext === ".iso") {
      const tileset = readTileset(bytes, source.path);
      if (!tileset.ok) return failure(tileset.error.message);
      const { width, height } = tileDimensions(tileset.value.detail);
      const tiles: TilePreviewPixels[] = [];
      for (let index = 0; index < tileset.value.tiles.length; index += 1) {
        const image = expandTileToRgba(tileset.value, index);
        if (!image.ok) return failure(image.error.message);
        const pixels = new Uint8Array(image.value.length);
        for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) {
          const offset = (x * height + y) * 4;
          pixels.set(image.value.subarray(offset, offset + 4), (y * width + x) * 4);
        }
        tiles.push({ width, height, pixels });
      }
      return { ok: true, value: { kind: "tileset", tiles } };
    }
    if (ext === ".gph") {
      const texture = decodeTileTexture(assetKey(source.reference), bytes);
      if (!texture.ok) return failure(texture.error?.message ?? `Cannot decode ${source.path}`);
      return { ok: true, value: { kind: "single", preview: { width: texture.texture.w, height: texture.texture.h, pixels: texture.texture.rgba } } };
    }
    if (ext === ".tan") {
      const animation = readTileAnimation(new BinaryReader(bytes, source.path));
      if (!animation.ok) return failure(animation.error.message);
      const frame = animation.value.frames.find((entry) => entry !== "");
      const preview = frame === undefined ? undefined : await previewReference(frame);
      return {
        ok: true,
        value: {
          kind: "animation",
          frameCount: animation.value.frames.length,
          speed: animation.value.speed,
          preview: preview ?? null,
        },
      };
    }
    const bitmap = readTileBitmap(new BinaryReader(bytes, source.path));
    if (!bitmap.ok) return failure(bitmap.error.message);
    const tiles = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
    for (const cell of bitmap.value.cells) {
      if (cell.tile === "" || tiles.has(cell.tile)) continue;
      const preview = await previewReference(cell.tile);
      if (preview !== undefined) tiles.set(cell.tile, { w: preview.width, h: preview.height, rgba: preview.pixels });
    }
    const composed = compositeTileBitmap(bitmap.value, tiles);
    if (!composed.ok) return failure(composed.error.message);
    return {
      ok: true,
      value: { kind: "bitmap", preview: { width: composed.value.w, height: composed.value.h, pixels: composed.value.rgba } },
    };
  }

  return { previewSource };
}
