import type { AssetKey } from "../ports/keys.ts";
import type { DecodedTexture } from "../formats/image/index.ts";
import { expandSingleTileToRgba, readSingleTile } from "../formats/single-tile/index.ts";
import { expandTileToRgba, readTileset, tileDimensions } from "../formats/tileset/index.ts";

/** Why a tile file could not become a texture: the reader's located message. */
export type TileTextureError = { readonly offset: number; readonly message: string };

export type TileTextureResult =
  | { readonly ok: true; readonly texture: DecodedTexture }
  | { readonly ok: false; readonly error: TileTextureError | null };

/**
 * Decode a single tile (`.gph`) or a tileset (`.tst`, `.iso`) to the texture the board compositor blits from: a tileset
 * is one strip, tile `n` at `x = n × tileWidth`, with a 16×16 tileset doubled to 32×32 (`docs/spec/formats/tiles.md`).
 * The engine and the editor's board preview both decode through this one function, so what an author sees is what the
 * engine draws. A key with another extension is not a tile file and gives `{ ok: false, error: null }`.
 */
export function decodeTileTexture(key: AssetKey, bytes: Uint8Array): TileTextureResult {
  const lower = key.toLowerCase();
  if (lower.endsWith(".gph")) {
    const parsed = readSingleTile(bytes, key);
    if (!parsed.ok) return { ok: false, error: { offset: parsed.error.offset, message: parsed.error.message } };
    const rgba = expandSingleTileToRgba(parsed.value, "row-major");
    if (!rgba.ok) return { ok: false, error: null };
    return { ok: true, texture: { w: parsed.value.width, h: parsed.value.height, rgba: rgba.value } };
  }
  if (!lower.endsWith(".tst") && !lower.endsWith(".iso")) return { ok: false, error: null };
  const parsed = readTileset(bytes, key);
  if (!parsed.ok) return { ok: false, error: { offset: parsed.error.offset, message: parsed.error.message } };
  const native = tileDimensions(parsed.value.detail);
  const scale = parsed.value.detail.size === 16 ? 2 : 1;
  const width = native.width * scale;
  const height = native.height * scale;
  const rgba = new Uint8Array(width * parsed.value.tiles.length * height * 4);
  for (let tile = 0; tile < parsed.value.tiles.length; tile += 1) {
    const expanded = expandTileToRgba(parsed.value, tile);
    if (!expanded.ok) return { ok: false, error: null };
    for (let x = 0; x < native.width; x += 1) {
      for (let y = 0; y < native.height; y += 1) {
        const source = (x * native.height + y) * 4;
        for (let dx = 0; dx < scale; dx += 1) {
          for (let dy = 0; dy < scale; dy += 1) {
            const targetX = tile * width + x * scale + dx;
            const targetY = y * scale + dy;
            const target = (targetY * width * parsed.value.tiles.length + targetX) * 4;
            rgba[target] = expanded.value[source] ?? 0;
            rgba[target + 1] = expanded.value[source + 1] ?? 0;
            rgba[target + 2] = expanded.value[source + 2] ?? 0;
            rgba[target + 3] = expanded.value[source + 3] ?? 0;
          }
        }
      }
    }
  }
  return { ok: true, texture: { w: width * parsed.value.tiles.length, h: height, rgba } };
}
