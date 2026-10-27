/** Script animation playback and compositor records (E-54; docs/spec/engine/plugins-and-battle.md#e-54, docs/spec/formats/animation.md). */
import { decodeGif } from "../formats/image/index.ts";
import { readAnimation } from "../formats/animation/reader.ts";
import { classifyImageReference } from "../formats/animation/image-reference.ts";
import { BinaryReader } from "../formats/binary/reader.ts";
import { frameAt, secondsToTicks } from "../time/time.ts";
import type { AssetKey } from "../ports/keys.ts";
import type { DrawCommand, Rect, Rgb } from "../ports/draw.ts";
import { createSurface } from "../raster/surfaces.ts";
import type { AnimationFrameState, AnimationState, FxSection } from "../save/sections/fx.ts";
import type { GameState } from "../save/state.ts";

type ImageResolver = (image: string) => { readonly asset: AssetKey; readonly tile: number | null } | null;

function frameColor(color: { readonly r: number; readonly g: number; readonly b: number }): Rgb {
  return { r: color.r, g: color.g, b: color.b };
}

function animationFrames(
  bytes: Uint8Array,
  path: string,
  sourceAsset: AssetKey,
  resolver: ImageResolver,
): { width: number; height: number; delayTicks: number; frames: AnimationFrameState[]; gifPixels?: readonly Uint8Array[] } | null {
  if (path.toLowerCase().endsWith(".gif")) {
    const gif = decodeGif(bytes, path);
    if (!gif.ok || gif.value.frames.length === 0) return null;
    const delayTicks = secondsToTicks(gif.value.frames[0]?.delay ?? 0) ?? 1;
    return {
      width: gif.value.w,
      height: gif.value.h,
      delayTicks,
      gifPixels: gif.value.frames.map((frame) => frame.rgba),
      frames: gif.value.frames.map((_frame) => ({
        image: path,
        asset: sourceAsset,
        tile: null,
        srcWidth: gif.value.w,
        srcHeight: gif.value.h,
        transparent: frameColor(gif.value.transparent),
        sound: "",
      })),
    };
  }
  const parsed = readAnimation(new BinaryReader(bytes, path));
  if (!parsed.ok) return null;
  const frames: AnimationFrameState[] = [];
  for (const frame of parsed.value.frames) {
    const resolved = classifyImageReference(frame.image);
    if (resolved.kind === "empty") continue;
    const target = resolved.kind === "tile"
      ? resolver(resolved.tileset)
      : resolver(resolved.kind === "picture" ? resolved.path : resolved.path);
    if (target === null) continue;
    frames.push({
      image: frame.image,
      asset: target.asset,
      tile: resolved.kind === "tile" ? resolved.index : target.tile,
      srcWidth: parsed.value.width,
      srcHeight: parsed.value.height,
      transparent: frameColor(frame.transparent),
      sound: frame.sound,
    });
  }
  if (frames.length === 0) return null;
  return {
    width: parsed.value.width,
    height: parsed.value.height,
    delayTicks: secondsToTicks(parsed.value.delay) ?? 1,
    frames,
  };
}

/**
 * The first frame of a fetched `.anm` or GIF, for `drawEnemy` (frame 0): a GIF's first page as pixels with its
 * transparent colour, or an `.anm` frame's image reference with its size and transparent colour. Null when the bytes
 * hold no usable frame.
 */
export function animationFrameAtTick(
  bytes: Uint8Array,
  path: string,
  sourceAsset: AssetKey,
  resolver: ImageResolver,
  tick: number,
  loop = true,
): { readonly gif: { readonly w: number; readonly h: number; readonly rgba: Uint8Array } | null; readonly frame: AnimationFrameState } | null {
  const loaded = animationFrames(bytes, path, sourceAsset, resolver);
  if (loaded === null || loaded.frames.length === 0) return null;
  const index = frameAt(0, tick, loaded.delayTicks, loaded.frames.length, loop);
  if (index < 0) return null;
  const frame = loaded.frames[index];
  if (frame === undefined) return null;
  const pixels = loaded.gifPixels?.[index];
  return { gif: pixels === undefined ? null : { w: loaded.width, h: loaded.height, rgba: pixels }, frame };
}

export function firstAnimationFrame(
  bytes: Uint8Array,
  path: string,
  sourceAsset: AssetKey,
  resolver: ImageResolver,
): { readonly gif: { readonly w: number; readonly h: number; readonly rgba: Uint8Array } | null; readonly frame: AnimationFrameState } | null {
  return animationFrameAtTick(bytes, path, sourceAsset, resolver, 0, false);
}

/** Decode a fetched `.anm` or GIF into saveable frame metadata. */
export function loadAnimation(state: GameState, animation: AnimationState, bytes: Uint8Array, resolver: ImageResolver): boolean {
  const sourceAsset = animation.asset ?? (animation.file as AssetKey);
  const loaded = animationFrames(bytes, animation.file, sourceAsset, resolver);
  if (loaded === null) return false;
  animation.asset = sourceAsset;
  animation.width = animation.width > 0 ? animation.width : loaded.width;
  animation.height = animation.height > 0 ? animation.height : loaded.height;
  animation.delayTicks = loaded.delayTicks;
  animation.frames = loaded.frames;
  if (loaded.gifPixels !== undefined && state.surfaces.entries !== undefined && state.surfaces.nextId !== undefined) {
    animation.frames = loaded.frames.map((frame, index) => {
      const pixels = loaded.gifPixels?.[index];
      if (pixels === undefined) return frame;
      return { ...frame, surface: createSurface(state.surfaces, loaded.width, loaded.height, pixels) };
    });
  }
  animation.frame = 0;
  animation.originTick = state.time.tick;
  animation.soundFrame = -1;
  animation.loaded = true;
  return true;
}

/** Advance active animation frames and return newly-entered frame sounds. */
export function advanceAnimations(state: GameState): readonly { readonly file: string; readonly sound: string }[] {
  const fx = state.fx as Partial<FxSection>;
  const animations = fx.animations;
  if (animations === undefined) return [];
  const sounds: { file: string; sound: string }[] = [];
  const kept: AnimationState[] = [];
  for (const animation of animations) {
    if (animation.finished || !animation.loaded || animation.frames.length === 0) {
      if (!animation.finished) kept.push(animation);
      continue;
    }
    const frame = frameAt(animation.originTick, state.time.tick, animation.delayTicks, animation.frames.length, animation.loop);
    if (frame < 0) continue;
    animation.frame = frame;
    if (animation.soundFrame !== frame) {
      animation.soundFrame = frame;
      const sound = animation.frames[frame]?.sound ?? "";
      if (sound !== "") sounds.push({ file: animation.file, sound });
    }
    if (!animation.loop && state.time.tick - animation.originTick >= animation.delayTicks * animation.frames.length) {
      animation.finished = true;
    } else {
      kept.push(animation);
    }
  }
  state.fx = { ...state.fx, animations: kept };
  return sounds;
}

function rect(animation: AnimationState, frame: AnimationFrameState): Rect {
  return { x: animation.x, y: animation.y, w: animation.width > 0 ? animation.width : frame.srcWidth, h: animation.height > 0 ? animation.height : frame.srcHeight };
}

/** Append active script animations above the composed board in creation order. */
export function animationBlits(fx: FxSection): DrawCommand[] {
  const commands: DrawCommand[] = [];
  for (const animation of fx.animations) {
    if (!animation.loaded || animation.finished || animation.frames.length === 0) continue;
    const frame = animation.frames[animation.frame];
    if (frame === undefined || (frame.surface === undefined && frame.asset === null)) continue;
    const source = frame.surface === undefined
      ? { asset: frame.asset!, tile: frame.tile }
      : { surface: frame.surface, rev: 0 };
    commands.push({
      kind: "blit",
      source,
      src: { x: 0, y: 0, w: frame.srcWidth, h: frame.srcHeight },
      dst: rect(animation, frame),
      key: frameColor(frame.transparent),
      tint: { r: 0, g: 0, b: 0 },
      alpha: 255,
      blend: "normal",
      iso2d: false,
    });
  }
  return commands;
}

/** Apply a recorded `fx` command to saveable animation state. */
export function applyAnimationEffect(state: GameState, effect: { readonly name: string; readonly args?: readonly unknown[]; readonly result?: unknown }): void {
  const fx = state.fx as Partial<FxSection>;
  const current = fx.animations ?? [];
  if (effect.name === "endanimation") {
    const id = typeof effect.args?.[0] === "number" ? Math.trunc(effect.args[0]) : -1;
    state.fx = { ...createAnimationDefaults(fx), animations: current.filter((animation) => animation.id !== id) };
    return;
  }
  if (effect.name !== "animation" && effect.name !== "sizedanimation") return;
  const args = effect.args ?? [];
  const file = typeof args[0] === "string" ? args[0] : "";
  const x = typeof args[1] === "number" ? Math.trunc(args[1]) : 0;
  const y = typeof args[2] === "number" ? Math.trunc(args[2]) : 0;
  const sized = effect.name === "sizedanimation";
  const height = sized && typeof args[3] === "number" ? Math.max(1, Math.trunc(args[3])) : 0;
  const width = sized && typeof args[4] === "number" ? Math.max(1, Math.trunc(args[4])) : 0;
  const loopArg = args[sized ? 5 : 3];
  const loop = loopArg === true || loopArg === 1;
  const resultId = typeof effect.result === "number" ? Math.trunc(effect.result) : 0;
  const id = resultId > 0 ? resultId : (fx.nextAnimationId ?? 1);
  const nextAnimationId = Math.max(fx.nextAnimationId ?? 1, id + 1);
  const animation: AnimationState = {
    id, file, asset: null, x, y, width, height, loop, originTick: state.time.tick,
    delayTicks: 1, frame: 0, frames: [], loaded: false, finished: false, soundFrame: -1,
  };
  state.fx = { ...createAnimationDefaults(fx), animations: [...current, animation], nextAnimationId };
}

function createAnimationDefaults(fx: Partial<FxSection>): FxSection {
  return {
    borderColor: fx.borderColor ?? { r: 0, g: 0, b: 0 },
    fade: fx.fade ?? null,
    wipe: fx.wipe ?? null,
    zoomPercent: fx.zoomPercent ?? 0,
    zoom: fx.zoom ?? null,
    earthquake: fx.earthquake ?? null,
    animations: fx.animations ?? [],
    nextAnimationId: fx.nextAnimationId ?? 1,
  };
}
