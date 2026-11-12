/**
 * The conformance page: replays the committed raster kit through `render-webgl2` and reports the pixels it produced.
 *
 * Three files make up the kit, and each vector is one logical-pixel scene plus the RGBA the reference rasteriser
 * produced: `vectors.json` (geometry and the pixel pipeline), `text-vectors.json` (a legacy bitmap font) and
 * `truetype-vectors.json` (a TrueType face's rendered text). The page draws each into a canvas of the vector's own size
 * and reads the pixels back, so a lane can apply D-7's bound: exact on key, tint, alpha-0 skipping and row order, at
 * most one unit per channel on blend arithmetic — and it reports the worst channel per vector rather than a boolean.
 *
 * A text vector carries glyph rows rather than a font file, and a TrueType vector carries only the face's name, so the
 * page rebuilds the exact command the reference recorded and first checks that `rasterize` reproduces the committed
 * bytes: a lane that fails there is testing the wrong command, not the renderer.
 */

import {
  rasterizePresentation,
  readTrueTypeFont,
  type AssetKey,
  type DrawList,
  type LegacyFont,
  type RasterAsset,
} from "@tk-reawakened/core";
import { createWebgl2Renderer, type TexturePixels } from "@tk-reawakened/render-webgl2";

type BitmapVector = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly texture?: { readonly asset: string; readonly w: number; readonly h: number; readonly rgba: string };
  readonly commands: readonly unknown[];
  readonly rgba: string;
};

type TextVector = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly font: { readonly asset: string; readonly glyphs: { readonly [code: string]: string } };
  readonly commands: readonly unknown[];
  readonly rgba: string;
};

type TrueTypeVector = {
  readonly id: string;
  readonly font: string;
  readonly size: number;
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
};

type VectorReport = {
  readonly id: string;
  readonly actual: string;
  readonly expected: string;
  /** The largest per-channel difference, and the pixel and channel it happened at. */
  readonly worst: number;
  readonly at: string;
  /** True when the committed kit's own reference reproduction failed, so the comparison is not about the renderer. */
  readonly kitError: string | null;
};

declare global {
  interface Window {
    __vectors?: readonly VectorReport[];
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

/** The largest per-channel difference, with the pixel's coordinates and the channel that carried it. */
function worstChannel(actual: Uint8Array, expected: Uint8Array, width: number): { worst: number; at: string } {
  let worst = 0;
  let at = "none";
  const channels = ["r", "g", "b", "a"];
  for (let index = 0; index < Math.min(actual.length, expected.length); index += 1) {
    const difference = Math.abs((actual[index] ?? 0) - (expected[index] ?? 0));
    if (difference <= worst) continue;
    const pixel = Math.floor(index / 4);
    worst = difference;
    at = `(${pixel % width},${Math.floor(pixel / width)}).${channels[index % 4]}`;
  }
  return { worst, at };
}

/** Draw one vector through WebGL2 and return its top-first RGBA, plus the reference's own pixels for the same command. */
function replay(
  width: number,
  height: number,
  commands: readonly unknown[],
  textures: ReadonlyMap<AssetKey, TexturePixels>,
  fonts: ReadonlyMap<AssetKey, RasterAsset>,
): { readonly actual: Uint8Array; readonly reference: Uint8Array } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // `alpha: true` keeps a real alpha channel: `alpha: false` forces readPixels alpha to 255 and hides transparency.
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("vectors: no WebGL2 context");
  const renderer = createWebgl2Renderer(gl);
  const list: DrawList = { protocolVersion: 3, tick: 0, width, height, commands: commands as DrawList["commands"], marginCommands: [] };
  const geometry = {
    content: { width, height },
    game: { x: 0, y: 0, width, height },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const render = renderer.render(list, geometry, {
    textures: (asset) => textures.get(asset) ?? null,
    fonts: (asset) => fonts.get(asset),
  });
  if (render.deferred !== 0) {
    throw new Error(`vectors: ${render.deferred} command(s) deferred: ${render.diagnostics.join(", ")}`);
  }
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  renderer.dispose();
  // `readPixels` returns rows bottom-up and a vector's expected RGBA is top-first, so compare in one order.
  const stride = width * 4;
  const actual = new Uint8Array(pixels.length);
  for (let row = 0; row < height; row += 1) {
    actual.set(pixels.subarray(row * stride, (row + 1) * stride), (height - 1 - row) * stride);
  }
  const assets = new Map<AssetKey, RasterAsset>([...textures, ...fonts] as [AssetKey, RasterAsset][]);
  const reference = rasterizePresentation(list, geometry, assets);
  if (reference.error !== null) throw new Error(`vectors: the reference refused the command: ${reference.error}`);
  return { actual, reference: reference.rgba };
}

function report(id: string, actual: Uint8Array, expected: Uint8Array, width: number, kitError: string | null = null): VectorReport {
  const { worst, at } = worstChannel(actual, expected, width);
  return { id, actual: hexFromBytes(actual), expected: hexFromBytes(expected), worst, at, kitError };
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`vectors: ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** Rebuild the legacy font a text vector names from its glyph rows, with every other cell blank. */
function legacyFont(glyphs: { readonly [code: string]: string }): LegacyFont {
  const values = new Uint8Array(2048);
  for (const [code, rows] of Object.entries(glyphs)) {
    values.set(bytesFromHex(rows).subarray(0, 8), Number(code) * 8);
  }
  return { magic: "RPGTLKIT FONT", version: 2, subversion: 0, values };
}

void (async () => {
  const results: VectorReport[] = [];

  const bitmaps = await json<{ vectors: readonly BitmapVector[] }>("/tools/fixtures/conformance/raster/vectors.json");
  for (const vector of bitmaps.vectors) {
    const textures = new Map<AssetKey, TexturePixels>();
    if (vector.texture !== undefined) {
      textures.set(vector.texture.asset as AssetKey, {
        w: vector.texture.w,
        h: vector.texture.h,
        rgba: bytesFromHex(vector.texture.rgba),
      });
    }
    const { actual, reference } = replay(vector.width, vector.height, vector.commands, textures, new Map());
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  const texts = await json<{ vectors: readonly TextVector[] }>("/tools/fixtures/conformance/raster/text-vectors.json");
  for (const vector of texts.vectors) {
    const fonts = new Map<AssetKey, RasterAsset>([[vector.font.asset as AssetKey, legacyFont(vector.font.glyphs)]]);
    const { actual, reference } = replay(vector.width, vector.height, vector.commands, new Map(), fonts);
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  const truetype = await json<{ rendered: readonly TrueTypeVector[] }>("/tools/fixtures/conformance/raster/truetype-vectors.json");
  for (const vector of truetype.rendered) {
    const response = await fetch(`/media/fonts/${vector.font}`);
    if (!response.ok) throw new Error(`vectors: ${vector.font} answered ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsed = readTrueTypeFont(bytes, vector.font);
    if (!parsed.ok) throw new Error(`vectors: ${vector.font} does not parse`);
    const asset = `media/fonts/${vector.font}` as AssetKey;
    const command = {
      kind: "text",
      x: 0,
      y: 0,
      text: vector.text,
      font: { asset, size: vector.size, bold: false, italic: false },
      rgb: { r: 255, g: 255, b: 255 },
      advances: [],
    };
    const fonts = new Map<AssetKey, RasterAsset>([[asset, parsed.value]]);
    const { actual, reference } = replay(vector.width, vector.height, [command], new Map(), fonts);
    const kitError = hexFromBytes(reference) === vector.rgba ? null : "the reference did not reproduce the committed pixels";
    results.push(report(vector.id, actual, reference, vector.width, kitError));
  }

  // Independent fixed pixel: Liberation Sans 20px "A" has coverage 98 at (5,4).
  const sansKey = "media/fonts/LiberationSans-Regular.ttf" as AssetKey;
  const sansBytes = new Uint8Array(await (await fetch(`/${sansKey}`)).arrayBuffer());
  const sans = readTrueTypeFont(sansBytes, sansKey);
  if (!sans.ok) throw new Error("vectors: Liberation Sans failed to parse");
  for (const [alpha, expected] of [
    [0, [255,255,255,98]], [128, [146,150,155,177]], [255, [104,110,116,255]],
  ] as const) {
    const background = "test/glyph-background" as AssetKey;
    const rgba = new Uint8Array(24 * 24 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([10,20,30,alpha], i);
    const commands = [
      { kind: "blit", source: { asset: background, tile: null }, src: { x: 0, y: 0, w: 24, h: 24 }, dst: { x: 0, y: 0, w: 24, h: 24 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "normal", iso2d: false },
      { kind: "text", x: 0, y: 0, text: "A", font: { asset: sansKey, size: 20, bold: false, italic: false }, rgb: { r: 255, g: 255, b: 255 }, advances: [] },
    ];
    const { actual, reference } = replay(24, 24, commands, new Map([[background, { w: 24, h: 24, rgba }]]), new Map([[sansKey, sans.value]]));
    const at = (4 * 24 + 5) * 4;
    const want = new Uint8Array(expected);
    results.push(report(`glyph-source-over-${alpha}`, actual.slice(at, at + 4), want, 1, hexFromBytes(reference.slice(at, at + 4)) === hexFromBytes(want) ? null : "CPU glyph pixel differs from independent calculation"));
  }
  const overlapGlyph = sans.value.charToGlyph("A").id;
  const overlap = replay(24, 24, [{ kind: "text", x: 0, y: 0, text: "AAAA", font: { asset: sansKey, size: 20, bold: false, italic: false }, rgb: { r: 255, g: 255, b: 255 }, advances: Array.from({ length: 4 }, () => ({ glyph: overlapGlyph, advance: 1 })) }], new Map(), new Map([[sansKey, sans.value]]));
  results.push(report("glyph-source-over-overlap", overlap.actual, overlap.reference, 24));

  // Browser canvas consumer: its default premultiplied context and the explicit straight context
  // must both composite the same known coverage-98 glyph pixel over opaque black.
  for (const premultipliedAlpha of [false, true]) {
    const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 24;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha, antialias: false, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("vectors: no WebGL2 context for browser composition");
    const renderer = createWebgl2Renderer(gl);
    const commands = [{ kind: "text", x: 0, y: 0, text: "A", font: { asset: sansKey, size: 20, bold: false, italic: false }, rgb: { r: 255, g: 255, b: 255 }, advances: [] }];
    const geometry = { content: { width: 24, height: 24 }, game: { x: 0, y: 0, width: 24, height: 24 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
    renderer.render({ protocolVersion: 3, tick: 0, width: 24, height: 24, commands: commands as DrawList["commands"], marginCommands: [] }, geometry, { textures: () => null, fonts: () => sans.value });
    const output = document.createElement("canvas"); output.width = 24; output.height = 24;
    const context = output.getContext("2d");
    if (context === null) throw new Error("vectors: no Canvas2D context");
    context.fillStyle = "black"; context.fillRect(0, 0, 24, 24); context.drawImage(canvas, 0, 0);
    const actual = context.getImageData(5, 4, 1, 1).data;
    results.push(report(`glyph-source-over-host-${String(premultipliedAlpha)}`, new Uint8Array(actual), new Uint8Array([98,98,98,255]), 1));
    renderer.dispose();
  }

  // Both planes blend in consecutive frames with different framebuffer sizes.
  {
    const canvas = document.createElement("canvas"); canvas.width = 3; canvas.height = 2;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (gl === null) throw new Error("vectors: no WebGL2 context for plane snapshots");
    const renderer = createWebgl2Renderer(gl); const asset = "test/plane-overlay" as AssetKey;
    const blit = (x: number) => ({ kind: "blit" as const, source: { asset, tile: null }, src: { x: 0, y: 0, w: 1, h: 1 }, dst: { x, y: 0, w: 1, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: "source-over" as const, iso2d: false });
    const frame: DrawList = { protocolVersion: 3, tick: 0, width: 2, height: 2, commands: [blit(0)], marginCommands: [blit(-1)] };
    const geometry = { content: { width: 3, height: 2 }, game: { x: 1, y: 0, width: 2, height: 2 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
    const options = { textures: () => ({ w: 1, h: 1, rgba: new Uint8Array([255, 255, 255, 128]) }) };
    for (let i = 0; i < 2; i += 1) {
      renderer.render(frame, geometry, options);
      const actual = new Uint8Array(8); gl.readPixels(0, 1, 2, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
      results.push(report(`source-over-plane-reuse-${i}`, actual, new Uint8Array([255,255,255,128,255,255,255,128]), 2));
    }
    renderer.dispose();
  }

  // Hand-calculated source-over checks: opaque RGB(12,30,50), white texels with alpha 0,81,128,255.
  const coverageAsset = "test/source-over" as AssetKey;
  const coverageTextures = new Map<AssetKey, TexturePixels>([[coverageAsset, { w: 4, h: 1, rgba: new Uint8Array([255,255,255,0, 255,255,255,81, 255,255,255,128, 255,255,255,255]) }]]);
  for (const [opacity, expected] of [
    [255, [12,30,50,255, 89,101,115,255, 134,143,153,255, 255,255,255,255]],
    [128, [12,30,50,255, 50,65,82,255, 73,86,101,255, 134,143,153,255]],
  ] as const) {
    const commands = [
      { kind: "fill", rgb: { r: 12, g: 30, b: 50 } },
      { kind: "blit", source: { asset: coverageAsset, tile: null }, src: { x: 0, y: 0, w: 4, h: 1 }, dst: { x: 0, y: 0, w: 4, h: 1 }, key: null, tint: { r: 0, g: 0, b: 0 }, alpha: opacity, blend: "source-over", iso2d: false },
    ];
    const pixels = new Uint8Array(expected);
    const { actual, reference } = replay(4, 1, commands, coverageTextures, new Map());
    const kitError = hexFromBytes(reference) === hexFromBytes(pixels) ? null : "the reference disagrees with hand-calculated source-over pixels";
    results.push(report(`source-over-${opacity}`, actual, pixels, 4, kitError));
  }

  // Straight-alpha source-over on transparent and translucent destinations, calculated independently.
  const targetAsset = "test/translucent-target" as AssetKey;
  const sourceAsset = "test/translucent-source" as AssetKey;
  const translucentTextures = new Map<AssetKey, TexturePixels>([
    [targetAsset, { w: 4, h: 1, rgba: new Uint8Array([12,30,50,0, 12,30,50,64, 12,30,50,128, 12,30,50,255]) }],
    [sourceAsset, { w: 4, h: 1, rgba: new Uint8Array([255,255,255,128, 255,255,255,128, 255,255,255,128, 255,255,255,128]) }],
  ]);
  const translucentCommands = [targetAsset, sourceAsset].map((asset, index) => ({
    kind: "blit", source: { asset, tile: null }, src: { x: 0, y: 0, w: 4, h: 1 }, dst: { x: 0, y: 0, w: 4, h: 1 },
    key: null, tint: { r: 0, g: 0, b: 0 }, alpha: 255, blend: index === 0 ? "normal" : "source-over", iso2d: false,
  }));
  const translucentExpected = new Uint8Array([255,255,255,128, 207,210,214,160, 174,180,187,192, 134,143,153,255]);
  const translucent = replay(4, 1, translucentCommands, translucentTextures, new Map());
  const translucentError = hexFromBytes(translucent.reference) === hexFromBytes(translucentExpected) ? null : "the reference disagrees with hand-calculated translucent-target pixels";
  results.push(report("source-over-translucent-target", translucent.actual, translucentExpected, 4, translucentError));

  const blackAsset = "test/translucent-black" as AssetKey;
  translucentTextures.set(blackAsset, { w: 4, h: 1, rgba: new Uint8Array([0,0,0,128, 0,0,0,128, 0,0,0,128, 0,0,0,128]) });
  const secondOverlay = { ...translucentCommands[1]!, source: { asset: blackAsset, tile: null } };
  const repeatedExpected = new Uint8Array([85,85,85,192, 79,81,82,208, 74,77,80,224, 67,71,76,255]);
  const repeated = replay(4, 1, [...translucentCommands, secondOverlay], translucentTextures, new Map());
  const repeatedError = hexFromBytes(repeated.reference) === hexFromBytes(repeatedExpected) ? null : "the reference disagrees with hand-calculated repeated-overlay pixels";
  results.push(report("source-over-repeated", repeated.actual, repeatedExpected, 4, repeatedError));

  window.__vectors = results;
  window.document.title = `vectors: ${results.length} replayed`;
})();
