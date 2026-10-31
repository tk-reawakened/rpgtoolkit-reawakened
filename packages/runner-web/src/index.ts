/**
 * The web runner (D-3, D-5, D-8, D-11; docs/spec/engine/runners.md).
 *
 * A browser host for the core, and nothing more: it fetches the bytes the core asks for, hands back an AD-14 reply, and
 * presents the draw list through `render-webgl2`. The boot sequence is `runner-harness`'s `runClosingFrames`, the same
 * function the headless closing suite uses, so this host's hashes are the baseline's by construction rather than by a
 * copy of the boot code.
 *
 * What is here today is the tracer's path: a served game folder, one scripted frame, the presentation. Streaming load
 * modes, prefetch hints, the service worker and the library land with entries 9.9 and 9.10 and are named in the runner
 * page's Implementation status table.
 */

import { assetKey, type AssetKey, type DrawList } from "@tk-reawakened/core";
import {
  decodeAssetTexture,
  parseClosingPlan,
  runClosingFrames,
  type ClosingFiles,
  type ClosingGamePlan,
  type ClosingPlan,
} from "@tk-reawakened/runner-harness";
import { createWebgl2Renderer, type RenderStats, type TexturePixels } from "@tk-reawakened/render-webgl2";

/** One file of a served game or of the bundled assets, as the browser received it. */
export type ServedFile = { readonly path: string; readonly bytes: Uint8Array };

/** Decode a served file list into the map the harness takes (`path -> bytes`, `/`-separated). */
export function toFiles(files: readonly ServedFile[]): ClosingFiles {
  const map = new Map<string, Uint8Array>();
  for (const file of files) map.set(file.path, file.bytes);
  return map;
}

type WireFiles = { readonly files: readonly { readonly path: string; readonly bytes: string }[] };

async function getFiles(url: string): Promise<ClosingFiles> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`runner-web: ${url} answered ${response.status}`);
  const wire = (await response.json()) as WireFiles;
  return toFiles(wire.files.map((file) => ({ path: file.path, bytes: base64Bytes(file.bytes) })));
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Fetch one game folder: its files keyed by their path inside the game (`Main/x.gam`, `Tiles/x.tst`, …). */
export function fetchGame(base: string, root: string): Promise<ClosingFiles> {
  return getFiles(`${base}/api/game?root=${encodeURIComponent(root)}`);
}

/** Fetch the bundled assets, keyed as the harness keys them (`media/fonts/…`, `media/cursors/…`). */
export function fetchBundled(base: string, folders: readonly string[]): Promise<ClosingFiles> {
  return getFiles(`${base}/api/bundled?folders=${encodeURIComponent(folders.join(","))}`);
}

export type FrameReport = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
  readonly commands: number;
  readonly render: RenderStats;
};

/** Decoded textures for a draw list, decoded once per asset from the game's own bytes (AD-28). */
export function textureProvider(files: ClosingFiles): (asset: AssetKey) => TexturePixels | null {
  const byKey = new Map<AssetKey, Uint8Array>();
  for (const [path, bytes] of files) byKey.set(assetKey(path), bytes);
  const cache = new Map<AssetKey, TexturePixels | null>();
  return (asset: AssetKey): TexturePixels | null => {
    const cached = cache.get(asset);
    if (cached !== undefined) return cached;
    const bytes = byKey.get(asset);
    const decoded = bytes === undefined ? null : decodeAssetTexture(asset, bytes);
    const pixels = decoded === null ? null : { w: decoded.w, h: decoded.h, rgba: decoded.rgba };
    cache.set(asset, pixels);
    return pixels;
  };
}

export type ScriptedFrameOptions = {
  readonly planText: string;
  readonly game: string;
  readonly files: ClosingFiles;
  readonly bundled: ClosingFiles;
  readonly gl: WebGL2RenderingContext;
  /** Which captured frame to present; the plan's `board` frame is tick 120. */
  readonly tick?: number;
};

/**
 * Boot one game exactly as the headless closing suite does and present one captured frame through WebGL2. Returns the
 * hashes the core reported, so a lane can compare them with the committed baseline without trusting the renderer.
 */
export function runScriptedFrame(options: ScriptedFrameOptions): FrameReport {
  const plan: ClosingPlan = parseClosingPlan(options.planText);
  const game: ClosingGamePlan | undefined = plan.games.find((candidate) => candidate.name === options.game);
  if (game === undefined) throw new Error(`runner-web: the plan does not list ${options.game}`);
  const run = runClosingFrames(plan, game, options.files, options.bundled);
  const frame = run.frames.find((candidate) => candidate.tick === (options.tick ?? 120)) ?? run.frames.at(-1);
  if (frame === undefined) throw new Error(`runner-web: ${options.game} captured no frame`);
  const renderer = createWebgl2Renderer(options.gl);
  const render = renderer.render(frame.drawList as DrawList, textureProvider(options.files), (id, rev) => {
    const pixels = run.surfacePixels(id, rev);
    return pixels === null ? null : { w: pixels.w, h: pixels.h, rgba: pixels.rgba };
  });
  return { tick: frame.tick, stateHash: frame.stateHash, drawHash: frame.drawHash, commands: frame.commands, render };
}
