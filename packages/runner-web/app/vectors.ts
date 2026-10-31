/**
 * The conformance page: replays the committed raster vectors through `render-webgl2` and reports the pixels it produced.
 *
 * A vector is one logical-pixel scene plus the RGBA the reference rasteriser produced. The page draws it into a canvas of
 * the vector's own size and reads the pixels back, so a lane can compare them with D-7's bound: exact on key, tint and
 * blend choice, at most one unit per channel on the blend arithmetic.
 */

import { createWebgl2Renderer, type TexturePixels } from "@tk-reawakened/render-webgl2";
import type { AssetKey, DrawList } from "@tk-reawakened/core";

type Vector = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly texture: { readonly asset: string; readonly w: number; readonly h: number; readonly rgba: string };
  readonly commands: readonly unknown[];
  readonly rgba: string;
};

declare global {
  interface Window {
    __vectors?: readonly { id: string; actual: string; expected: string }[];
  }
}

function bytesFromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function hexFromBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

void (async () => {
  const response = await fetch("/tools/fixtures/conformance/raster/vectors.json");
  const kit = (await response.json()) as { vectors: readonly Vector[] };
  const results: { id: string; actual: string; expected: string }[] = [];
  for (const vector of kit.vectors) {
    const canvas = document.createElement("canvas");
    canvas.width = vector.width;
    canvas.height = vector.height;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("vectors: no WebGL2 context");
    const texture: TexturePixels = {
      w: vector.texture.w,
      h: vector.texture.h,
      rgba: bytesFromHex(vector.texture.rgba),
    };
    const textures = new Map<AssetKey, TexturePixels>([[vector.texture.asset as AssetKey, texture]]);
    const renderer = createWebgl2Renderer(gl);
    const list: DrawList = { tick: 0, width: vector.width, height: vector.height, commands: vector.commands as DrawList["commands"] };
    renderer.render(list, (asset) => textures.get(asset) ?? null);
    const pixels = new Uint8Array(vector.width * vector.height * 4);
    gl.readPixels(0, 0, vector.width, vector.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    renderer.dispose();
    // `readPixels` returns rows bottom-up and a vector's expected RGBA is top-first, so compare in one order.
    const stride = vector.width * 4;
    const topFirst = new Uint8Array(pixels.length);
    for (let row = 0; row < vector.height; row += 1) {
      topFirst.set(pixels.subarray(row * stride, (row + 1) * stride), (vector.height - 1 - row) * stride);
    }
    results.push({ id: vector.id, actual: hexFromBytes(topFirst), expected: vector.rgba });
  }
  window.__vectors = results;
  window.document.title = `vectors: ${results.length} replayed`;
})();
