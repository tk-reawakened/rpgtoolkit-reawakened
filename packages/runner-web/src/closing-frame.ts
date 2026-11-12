/**
 * The demo board at tick 120, replayed through `render-webgl2` and compared with the reference rasteriser
 * (`docs/spec/engine/runners.md#webgl2-agreement`).
 *
 * One implementation, three callers: the desktop and mobile measurement page (`player-page.ts`), the desktop parity probe
 * that compares a frame against the PWA build (entry 9.10), and the PWA's own parity page. Returning the pixels as well
 * as the hashes is what lets two hosts be compared channel by channel instead of by a hash.
 */

import { assetKey, DEFAULT_FONT_ASSET, rasterizePresentation, readTrueTypeFont, type AssetKey, type DrawList, type HostDisplayGeometry, type RasterAsset, type RasterSurfaces, type SurfaceId } from "@tk-reawakened/core";
import { createWebgl2Renderer } from "@tk-reawakened/render-webgl2";
import { decodeAssetTexture, parseClosingPlan, runClosingFrames } from "@tk-reawakened/runner-harness";

export type ClosingFrame = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly commands: number;
  readonly width: number;
  readonly height: number;
  /** The presented frame's pixels, top row first, RGBA8. */
  readonly topFirst: Uint8Array;
  /** The worst per-channel difference against the reference rasteriser; D-7 allows one unit. */
  readonly worst: number;
};

/**
 * Replay `demo`'s closing board frame and return the presented pixels. The plan, the package's files and the bundled
 * assets all come from the caller, because a desktop origin has no directory listing and the PWA fetches over HTTP.
 */
export function renderClosingDemoFrame(options: {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly fonts: ReadonlyMap<AssetKey, RasterAsset>;
  readonly bundled: ReadonlyMap<string, Uint8Array>;
  readonly planText: string;
}): ClosingFrame {
  const plan = parseClosingPlan(options.planText);
  const game = plan.games.find((candidate) => candidate.name === "demo");
  if (game === undefined) throw new Error("the plan does not list demo");
  const run = runClosingFrames(plan, game, options.files, options.bundled);
  const frame = run.frames.find((candidate) => candidate.tick === 120);
  if (frame === undefined) throw new Error("no tick-120 frame");
  const list = frame.drawList as DrawList;

  const textures = new Map<AssetKey, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>();
  for (const [path, bytes] of options.files) {
    const key = assetKey(path);
    const decoded = decodeAssetTexture(key, bytes);
    if (decoded !== null) textures.set(key, { w: decoded.w, h: decoded.h, rgba: decoded.rgba });
  }
  // The draw list's TrueType glyph IDs only mean something against the face that made them, so the package's own faces
  // are decoded once and win over a bundled face of the same key (docs/spec/engine/runners.md#draw-list).
  const fonts = new Map<AssetKey, RasterAsset>(options.fonts);
  for (const [path, bytes] of options.files) {
    const key = assetKey(path);
    if (!key.endsWith(".ttf")) continue;
    const font = readTrueTypeFont(bytes, path);
    if (font.ok) fonts.set(key, font.value);
  }
  const geometry: HostDisplayGeometry = {
    content: { width: list.width, height: list.height },
    game: { x: 0, y: 0, width: list.width, height: list.height },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  const canvas = document.createElement("canvas");
  canvas.width = list.width;
  canvas.height = list.height;
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (gl === null) throw new Error("no WebGL2 context");
  const renderer = createWebgl2Renderer(gl);
  renderer.render(list, geometry, {
    textures: (asset) => textures.get(asset) ?? null,
    surfaces: (id, rev) => {
      const pixels = frame.surfaces.get(`${id}:${rev}`);
      return pixels === null || pixels === undefined ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
    },
    fonts: (asset) => fonts.get(asset),
    ...(fonts.get(DEFAULT_FONT_ASSET) === undefined ? {} : { fallbackFont: fonts.get(DEFAULT_FONT_ASSET) }),
  });
  const pixels = new Uint8Array(list.width * list.height * 4);
  gl.readPixels(0, 0, list.width, list.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  renderer.dispose();

  // WebGL reads bottom row first; every comparison and every capture here is top first.
  const stride = list.width * 4;
  const topFirst = new Uint8Array(pixels.length);
  for (let row = 0; row < list.height; row += 1) {
    topFirst.set(pixels.subarray(row * stride, (row + 1) * stride), (list.height - 1 - row) * stride);
  }

  const assets = new Map<AssetKey, RasterAsset>([...textures, ...fonts]);
  const surfaces = new Map<SurfaceId, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>() as RasterSurfaces;
  surfaces.get = (id: SurfaceId, rev?: number) => {
    const surface = frame.surfaces.get(`${id}:${rev ?? 0}`);
    return surface === null || surface === undefined ? undefined : { w: surface.w, h: surface.h, rgba: surface.rgba };
  };
  const reference = rasterizePresentation(list, geometry, assets, surfaces);
  let worst = 0;
  if (reference.error === null) {
    for (let index = 0; index < reference.rgba.length; index += 1) {
      worst = Math.max(worst, Math.abs(reference.rgba[index]! - topFirst[index]!));
    }
  }

  return {
    tick: frame.tick,
    stateHash: frame.stateHash,
    drawHash: frame.drawHash,
    commands: frame.commands,
    width: list.width,
    height: list.height,
    topFirst,
    worst,
  };
}

/** Base64 of a frame's pixels, in chunks, for a report or a DOM property. */
export function frameBase64(rgba: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < rgba.length; index += chunk) {
    binary += String.fromCharCode(...rgba.subarray(index, index + chunk));
  }
  return btoa(binary);
}
