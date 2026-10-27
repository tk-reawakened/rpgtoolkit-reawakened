/**
 * Core-owned persistent RGBA surfaces (AD-27).
 *
 * Surface pixels live in save state as a small tagged snapshot rather than a
 * `Uint8Array`, so snapshots remain canonical JSON.  The decoded byte cache is
 * deliberately supplied by the caller and is never part of `GameState`.
 */

import type { DecodedTexture } from "../formats/image/model.ts";
import type { SurfacePixels } from "../ports/engine.ts";
import type { Rgb } from "../ports/draw.ts";
import type { SurfaceId } from "../ports/keys.ts";
import type { SurfacesSection, SurfaceState, RgbaSnapshot } from "../save/sections/surfaces.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** A decoded-pixel cache owned by a runner/core facade, never by save state. */
export type SurfacePixelCache = Map<string, Uint8Array>;

function key(id: SurfaceId, rev: number): string {
  return `${id}:${rev}`;
}

function idOf(value: number): SurfaceId {
  return value as SurfaceId;
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function byteCount(width: number, height: number): number {
  return width * height * 4;
}

const BASE64_CODES = new Uint8Array(64);
const BASE64_VALUES = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i += 1) {
  BASE64_CODES[i] = BASE64.charCodeAt(i);
  BASE64_VALUES[BASE64_CODES[i]!] = i;
}
const ENCODE_CHUNK = 8192;

/**
 * Encode bytes without relying on host `btoa`/`Buffer` APIs (G2). A whole-surface edit encodes the full canvas, so
 * this writes character codes into a byte buffer and builds the string in large chunks instead of one character at a
 * time; the output is the same canonical padded base64.
 */
export function encodeSurfaceBytes(bytes: Uint8Array): string {
  const length = bytes.length;
  const whole = length - (length % 3);
  const out = new Uint8Array(Math.ceil(length / 3) * 4);
  let at = 0;
  let i = 0;
  for (; i < whole; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    out[at++] = BASE64_CODES[a >> 2]!;
    out[at++] = BASE64_CODES[((a & 3) << 4) | (b >> 4)]!;
    out[at++] = BASE64_CODES[((b & 15) << 2) | (c >> 6)]!;
    out[at++] = BASE64_CODES[c & 63]!;
  }
  if (i < length) {
    const a = bytes[i]!;
    const hasB = i + 1 < length;
    const b = hasB ? bytes[i + 1]! : 0;
    out[at++] = BASE64_CODES[a >> 2]!;
    out[at++] = BASE64_CODES[((a & 3) << 4) | (b >> 4)]!;
    out[at++] = hasB ? BASE64_CODES[(b & 15) << 2]! : 61;
    out[at++] = 61;
  }
  const parts: string[] = [];
  for (let start = 0; start < out.length; start += ENCODE_CHUNK) {
    parts.push(String.fromCharCode.apply(null, out.subarray(start, Math.min(out.length, start + ENCODE_CHUNK)) as unknown as number[]));
  }
  return parts.join("");
}

function base64Value(code: number): number {
  return code < 128 ? BASE64_VALUES[code]! : -1;
}

/** Decode a canonical base64 surface payload, rejecting malformed input. */
export function decodeSurfaceBytes(value: string): Uint8Array {
  if (value.length % 4 !== 0) throw new TypeError("invalid surface base64 length");
  let padding = 0;
  if (value.endsWith("=")) padding += 1;
  if (value.endsWith("==")) padding += 1;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < value.length; i += 4) {
    const cCode = value.charCodeAt(i + 2);
    const dCode = value.charCodeAt(i + 3);
    const cPad = cCode === 61;
    const dPad = dCode === 61;
    const ai = base64Value(value.charCodeAt(i));
    const bi = base64Value(value.charCodeAt(i + 1));
    const ci = cPad ? 0 : base64Value(cCode);
    const di = dPad ? 0 : base64Value(dCode);
    if (ai < 0 || bi < 0 || ci < 0 || di < 0 || (cPad && !dPad) || (i + 4 < value.length && (cPad || dPad))) {
      throw new TypeError("invalid surface base64 payload");
    }
    const first = (ai << 2) | (bi >> 4);
    if (at < output.length) output[at++] = first;
    if (!cPad) {
      const second = ((bi & 15) << 4) | (ci >> 2);
      if (at < output.length) output[at++] = second;
    }
    if (!dPad) {
      const third = ((ci & 3) << 6) | di;
      if (at < output.length) output[at++] = third;
    }
  }
  return output;
}

function snapshot(width: number, height: number, rgba: Uint8Array): RgbaSnapshot {
  return { t: "rgba", w: width, h: height, b64: encodeSurfaceBytes(rgba) };
}

function decode(entry: SurfaceState, cache?: SurfacePixelCache): Uint8Array {
  const cacheKey = key(entry.id, entry.rev);
  const cached = cache?.get(cacheKey);
  if (cached !== undefined) return cached;
  const rgba = decodeSurfaceBytes(entry.bitmap.b64);
  if (rgba.length !== byteCount(entry.bitmap.w, entry.bitmap.h)) throw new TypeError("surface pixel length does not match dimensions");
  cache?.set(cacheKey, rgba);
  return rgba;
}

function entry(state: SurfacesSection, id: SurfaceId): SurfaceState | null {
  return state.entries[String(id)] ?? null;
}

function checkedRgba(width: number, height: number, rgba: Uint8Array): void {
  if (!validDimension(width) || !validDimension(height)) throw new RangeError("surface dimensions must be non-negative integers");
  if (rgba.length !== byteCount(width, height)) throw new RangeError("surface pixel length does not match dimensions");
}

/** Create an empty surfaces section; `width`/`height` install composed frame 0. */
export function createSurfacesSection(width?: number, height?: number): SurfacesSection {
  const state: SurfacesSection = { nextId: 1, entries: {}, slots: {}, colours: {} };
  if (width !== undefined || height !== undefined) {
    if (width === undefined || height === undefined) throw new RangeError("surface frame dimensions must be supplied together");
    checkedRgba(width, height, new Uint8Array(byteCount(width, height)));
    state.entries["0"] = { id: 0 as SurfaceId, rev: 0, bitmap: snapshot(width, height, new Uint8Array(byteCount(width, height))) };
  }
  return state;
}

/** Allocate a monotonically increasing surface id. Ids are never reused. */
export function createSurface(state: SurfacesSection, width: number, height: number, rgba?: Uint8Array): SurfaceId {
  const pixels = rgba === undefined ? new Uint8Array(byteCount(width, height)) : new Uint8Array(rgba);
  checkedRgba(width, height, pixels);
  const id = idOf(state.nextId);
  state.nextId += 1;
  state.entries[String(id)] = { id, rev: 0, bitmap: snapshot(width, height, pixels) };
  return id;
}

/** Replace a surface's pixels and increment its revision exactly once. */
export function replaceSurface(state: SurfacesSection, id: SurfaceId, width: number, height: number, rgba: Uint8Array): number | null {
  const current = entry(state, id);
  if (current === null) return null;
  const pixels = new Uint8Array(rgba);
  checkedRgba(width, height, pixels);
  for (const colour of Object.keys(state.colours)) {
    if (state.colours[colour] === id) delete state.colours[colour];
  }
  current.rev += 1;
  current.bitmap = snapshot(width, height, pixels);
  return current.rev;
}

/** The live reserved render-now canvas, or null when none was created or the script killed it (E-57). Handle 0 is the screen, never a canvas. */
export function renderNowCanvas(state: SurfacesSection): SurfaceId | null {
  const handle = state.renderNow;
  if (typeof handle !== "number" || handle <= 0 || !Object.hasOwn(state.entries, String(handle))) return null;
  return handle;
}

/** Whether the reserved canvas is switched on and live. An absent flag (an older save) means on whenever a handle is named. */
export function renderNowEnabled(state: SurfacesSection): boolean {
  return renderNowCanvas(state) !== null && (state.renderNowOn ?? true);
}

/** Delete a surface. The allocation counter remains untouched. Surface 0 is permanent. */
export function killSurface(state: SurfacesSection, id: SurfaceId): boolean {
  if (id === (0 as SurfaceId) || !Object.hasOwn(state.entries, String(id))) return false;
  delete state.entries[String(id)];
  for (const slot of Object.keys(state.slots)) if (state.slots[slot] === id) delete state.slots[slot];
  for (const colour of Object.keys(state.colours)) if (state.colours[colour] === id) delete state.colours[colour];
  return true;
}

/** Read pixels only when the caller's revision is current; always return an owned copy. */
export function readSurfacePixels(state: SurfacesSection, id: SurfaceId, rev: number, cache?: SurfacePixelCache): SurfacePixels | null {
  const current = entry(state, id);
  if (current === null || current.rev !== rev) return null;
  const rgba = decode(current, cache);
  return { w: current.bitmap.w, h: current.bitmap.h, rgba: new Uint8Array(rgba) };
}

export function surfaceTextures(state: SurfacesSection, cache: SurfacePixelCache = new Map()): ReadonlyMap<SurfaceId, DecodedTexture> {
  const textures = new Map<SurfaceId, DecodedTexture>();
  const live = new Set<string>();
  for (const raw of Object.keys(state.entries)) {
    const current = state.entries[raw]!;
    live.add(key(current.id, current.rev));
    textures.set(current.id, { w: current.bitmap.w, h: current.bitmap.h, rgba: decode(current, cache) });
  }
  // A script that redraws a canvas every tick would otherwise keep one decoded copy of every past revision.
  for (const cached of [...cache.keys()]) if (!live.has(cached)) cache.delete(cached);
  return textures;
}

/** Return a stable 1×1 opaque colour surface, reusing one id for each RGB triple. */
export function colourSurface(state: SurfacesSection, rgb: Rgb): SurfaceId {
  const r = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
  const g = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
  const b = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
  const colour = `${r},${g},${b}`;
  const existing = state.colours[colour];
  if (existing !== undefined && entry(state, existing) !== null) return existing;
  const id = createSurface(state, 1, 1, new Uint8Array([r, g, b, 255]));
  state.colours[colour] = id;
  return id;
}

function copyRegion(state: SurfacesSection, source: SurfaceId, rect: { x: number; y: number; w: number; h: number }, cache?: SurfacePixelCache): { w: number; h: number; rgba: Uint8Array } | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null || !validDimension(rect.w) || !validDimension(rect.h) || !Number.isInteger(rect.x) || !Number.isInteger(rect.y)) return null;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > sourceEntry.bitmap.w || rect.y + rect.h > sourceEntry.bitmap.h) return null;
  const input = decode(sourceEntry, cache);
  const output = new Uint8Array(byteCount(rect.w, rect.h));
  for (let y = 0; y < rect.h; y += 1) {
    const from = ((rect.y + y) * sourceEntry.bitmap.w + rect.x) * 4;
    output.set(input.subarray(from, from + rect.w * 4), y * rect.w * 4);
  }
  return { w: rect.w, h: rect.h, rgba: output };
}

/** Save a region of a surface into a numbered slot, preserving the slot id. */
export function saveScreen(state: SurfacesSection, slot: number, source: SurfaceId = 0 as SurfaceId, rect?: { x: number; y: number; w: number; h: number }, cache?: SurfacePixelCache): SurfaceId | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null || !Number.isInteger(slot) || slot < 0) return null;
  const region = copyRegion(state, source, rect ?? { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (region === null) return null;
  const slotKey = String(slot);
  const prior = state.slots[slotKey];
  if (prior !== undefined && entry(state, prior) !== null) {
    replaceSurface(state, prior, region.w, region.h, region.rgba);
    return prior;
  }
  const id = createSurface(state, region.w, region.h, region.rgba);
  state.slots[slotKey] = id;
  return id;
}

/** Read a pixel's RGB colour, or `null` outside its bounds (E-56). */
export function getPixel(state: SurfacesSection, id: SurfaceId, x: number, y: number, cache?: SurfacePixelCache): Rgb | null {
  const current = entry(state, id);
  if (current === null || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= current.bitmap.w || y >= current.bitmap.h) return null;
  const rgba = decode(current, cache);
  const at = (y * current.bitmap.w + x) * 4;
  return { r: rgba[at]!, g: rgba[at + 1]!, b: rgba[at + 2]! };
}

/** The snapshot shape used by save files, exposed for format and test callers. */
export type { RgbaSnapshot, SurfaceState };

/** `canvasGetScreen` copies the composed screen into an existing canvas (E-56). */
export function canvasGetScreen(state: SurfacesSection, destination: SurfaceId, source: SurfaceId = 0 as SurfaceId, cache?: SurfacePixelCache): number | null {
  const sourceEntry = entry(state, source);
  if (sourceEntry === null) return null;
  const region = copyRegion(state, source, { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (region === null) return null;
  return replaceSurface(state, destination, region.w, region.h, region.rgba);
}

/** Restore one numbered saved-screen slot into an existing destination surface. */
export function restoreScreen(
  state: SurfacesSection,
  slot: number,
  destination: SurfaceId = 0 as SurfaceId,
  cache?: SurfacePixelCache,
  region?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly dx: number; readonly dy: number },
): number | null {
  if (!Number.isInteger(slot) || slot < 0) return null;
  const source = state.slots[String(slot)];
  const sourceEntry = source === undefined ? null : entry(state, source);
  if (sourceEntry === null || source === undefined) return null;
  if (region !== undefined) {
    if (region.w < 0 || region.h < 0) return null;
    const ok = blitSurface(state, source, destination, region.dx, region.dy, region.w, region.h, undefined, 255, false, region);
    return ok ? (entry(state, destination)?.rev ?? null) : null;
  }
  const copied = copyRegion(state, source, { x: 0, y: 0, w: sourceEntry.bitmap.w, h: sourceEntry.bitmap.h }, cache);
  if (copied === null) return null;
  return replaceSurface(state, destination, copied.w, copied.h, copied.rgba);
}
/** The callback used by script drawing commands to mutate one persistent surface. */
export type SurfaceEditor = (rgba: Uint8Array, width: number, height: number) => void;

/** Mutate a surface in place, bumping its revision exactly once. */
export function editSurface(state: SurfacesSection, id: SurfaceId, editor: SurfaceEditor): boolean {
  const current = entry(state, id);
  if (current === null) return false;
  const rgba = decode(current);
  editor(rgba, current.bitmap.w, current.bitmap.h);
  current.rev += 1;
  current.bitmap = snapshot(current.bitmap.w, current.bitmap.h, rgba);
  for (const colour of Object.keys(state.colours)) {
    if (state.colours[colour] === id) delete state.colours[colour];
  }
  return true;
}

/** Return a surface's dimensions, or null when the handle is not live. */
export function surfaceSize(state: SurfacesSection, id: SurfaceId): { readonly w: number; readonly h: number } | null {
  const current = entry(state, id);
  return current === null ? null : { w: current.bitmap.w, h: current.bitmap.h };
}

function plot(rgba: Uint8Array, width: number, height: number, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const at = (y * width + x) * 4;
  rgba[at] = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
  rgba[at + 1] = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
  rgba[at + 2] = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
  rgba[at + 3] = 255;
}

/** Integer Bresenham line, used by drawLine and the circle boundary. */
export function drawSurfaceLine(
  rgba: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb: Rgb,
): void {
  let x = Math.trunc(x1);
  let y = Math.trunc(y1);
  const endX = Math.trunc(x2);
  const endY = Math.trunc(y2);
  const dx = Math.abs(endX - x);
  const sx = x < endX ? 1 : -1;
  const dy = -Math.abs(endY - y);
  const sy = y < endY ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    plot(rgba, width, height, x, y, rgb);
    if (x === endX && y === endY) return;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

export function drawSurfaceRect(
  rgba: Uint8Array,
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgb: Rgb,
  filled: boolean,
): void {
  const left = Math.min(Math.trunc(x1), Math.trunc(x2));
  const right = Math.max(Math.trunc(x1), Math.trunc(x2));
  const top = Math.min(Math.trunc(y1), Math.trunc(y2));
  const bottom = Math.max(Math.trunc(y1), Math.trunc(y2));
  if (filled) {
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) plot(rgba, width, height, x, y, rgb);
    return;
  }
  drawSurfaceLine(rgba, width, height, left, top, right, top, rgb);
  drawSurfaceLine(rgba, width, height, right, top, right, bottom, rgb);
  drawSurfaceLine(rgba, width, height, right, bottom, left, bottom, rgb);
  drawSurfaceLine(rgba, width, height, left, bottom, left, top, rgb);
}

export function drawSurfaceCircle(
  rgba: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  rgb: Rgb,
  filled: boolean,
): void {
  const centerX = Math.trunc(cx);
  const centerY = Math.trunc(cy);
  const r = Math.max(0, Math.trunc(radius));
  for (let y = -r; y <= r; y += 1) {
    const span = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
    if (filled) {
      for (let x = -span; x <= span; x += 1) plot(rgba, width, height, centerX + x, centerY + y, rgb);
    } else {
      plot(rgba, width, height, centerX - span, centerY + y, rgb);
      plot(rgba, width, height, centerX + span, centerY + y, rgb);
    }
  }
}

/** Copy a source surface into a destination with optional key and alpha. */
export function blitSurface(
  state: SurfacesSection,
  source: SurfaceId,
  destination: SurfaceId,
  x: number,
  y: number,
  width?: number,
  height?: number,
  key?: Rgb,
  alpha = 255,
  additive = false,
  sourceRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  const sourceEntry = entry(state, source);
  const destinationEntry = entry(state, destination);
  if (sourceEntry === null || destinationEntry === null) return false;
  const sourcePixels = new Uint8Array(decode(sourceEntry));
  const sourceWidth = sourceEntry.bitmap.w;
  const sourceHeight = sourceEntry.bitmap.h;
  const cropX = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.x));
  const cropY = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.y));
  const cropWidth = sourceRect === undefined ? sourceWidth : Math.min(sourceWidth - cropX, Math.max(0, Math.trunc(sourceRect.w)));
  const cropHeight = sourceRect === undefined ? sourceHeight : Math.min(sourceHeight - cropY, Math.max(0, Math.trunc(sourceRect.h)));
  const outWidth = width === undefined ? cropWidth : Math.max(0, Math.trunc(width));
  const outHeight = height === undefined ? cropHeight : Math.max(0, Math.trunc(height));
  if (outWidth === 0 || outHeight === 0 || cropWidth === 0 || cropHeight === 0) return true;
  const dx = Math.trunc(x);
  const dy = Math.trunc(y);
  return editSurface(state, destination, (target, targetWidth, targetHeight) => {
    for (let row = 0; row < outHeight; row += 1) {
      const sourceY = cropY + Math.min(cropHeight - 1, Math.floor(row * cropHeight / outHeight));
      for (let column = 0; column < outWidth; column += 1) {
        const sourceX = cropX + Math.min(cropWidth - 1, Math.floor(column * cropWidth / outWidth));
        const from = (sourceY * sourceWidth + sourceX) * 4;
        const sr = sourcePixels[from]!;
        const sg = sourcePixels[from + 1]!;
        const sb = sourcePixels[from + 2]!;
        const sa = sourcePixels[from + 3]!;
        if (key !== undefined && sr === Math.trunc(key.r) && sg === Math.trunc(key.g) && sb === Math.trunc(key.b)) continue;
        const tx = dx + column;
        const ty = dy + row;
        if (tx < 0 || ty < 0 || tx >= targetWidth || ty >= targetHeight) continue;
        const at = (ty * targetWidth + tx) * 4;
        if (additive) {
          target[at] = Math.min(255, target[at]! + Math.trunc(sr * alpha / 255));
          target[at + 1] = Math.min(255, target[at + 1]! + Math.trunc(sg * alpha / 255));
          target[at + 2] = Math.min(255, target[at + 2]! + Math.trunc(sb * alpha / 255));
          target[at + 3] = 255;
          continue;
        }
        const effective = Math.trunc(sa * alpha / 255);
        if (effective >= 255) {
          target[at] = sr;
          target[at + 1] = sg;
          target[at + 2] = sb;
          target[at + 3] = sa;
        } else if (effective > 0) {
          target[at] = Math.trunc((sr * effective + target[at]! * (255 - effective)) / 255);
          target[at + 1] = Math.trunc((sg * effective + target[at + 1]! * (255 - effective)) / 255);
          target[at + 2] = Math.trunc((sb * effective + target[at + 2]! * (255 - effective)) / 255);
          target[at + 3] = 255;
        }
      }
    }
  });
}
/** Copy decoded image pixels into a persistent surface without allocating a source handle. */
export function blitTexture(
  state: SurfacesSection,
  texture: DecodedTexture,
  destination: SurfaceId,
  x: number,
  y: number,
  width?: number,
  height?: number,
  key?: Rgb,
  alpha = 255,
  additive = false,
  sourceRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): boolean {
  const destinationEntry = entry(state, destination);
  if (destinationEntry === null) return false;
  const cropX = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.x));
  const cropY = sourceRect === undefined ? 0 : Math.max(0, Math.trunc(sourceRect.y));
  const cropWidth = sourceRect === undefined ? texture.w : Math.min(texture.w - cropX, Math.max(0, Math.trunc(sourceRect.w)));
  const cropHeight = sourceRect === undefined ? texture.h : Math.min(texture.h - cropY, Math.max(0, Math.trunc(sourceRect.h)));
  const outWidth = width === undefined ? cropWidth : Math.max(0, Math.trunc(width));
  const outHeight = height === undefined ? cropHeight : Math.max(0, Math.trunc(height));
  if (outWidth === 0 || outHeight === 0 || cropWidth === 0 || cropHeight === 0) return true;
  const dx = Math.trunc(x);
  const dy = Math.trunc(y);
  return editSurface(state, destination, (target, targetWidth, targetHeight) => {
    for (let row = 0; row < outHeight; row += 1) {
      const sourceY = cropY + Math.min(cropHeight - 1, Math.floor(row * cropHeight / outHeight));
      for (let column = 0; column < outWidth; column += 1) {
        const sourceX = cropX + Math.min(cropWidth - 1, Math.floor(column * cropWidth / outWidth));
        const from = (sourceY * texture.w + sourceX) * 4;
        const sr = texture.rgba[from] ?? 0;
        const sg = texture.rgba[from + 1] ?? 0;
        const sb = texture.rgba[from + 2] ?? 0;
        const sa = texture.rgba[from + 3] ?? 0;
        if (key !== undefined && sr === Math.trunc(key.r) && sg === Math.trunc(key.g) && sb === Math.trunc(key.b)) continue;
        const tx = dx + column;
        const ty = dy + row;
        if (tx < 0 || ty < 0 || tx >= targetWidth || ty >= targetHeight) continue;
        const at = (ty * targetWidth + tx) * 4;
        if (additive) {
          target[at] = Math.min(255, (target[at] ?? 0) + Math.trunc(sr * alpha / 255));
          target[at + 1] = Math.min(255, (target[at + 1] ?? 0) + Math.trunc(sg * alpha / 255));
          target[at + 2] = Math.min(255, (target[at + 2] ?? 0) + Math.trunc(sb * alpha / 255));
          target[at + 3] = 255;
          continue;
        }
        const effective = Math.trunc(sa * alpha / 255);
        if (effective >= 255) {
          target[at] = sr;
          target[at + 1] = sg;
          target[at + 2] = sb;
          target[at + 3] = sa;
        } else if (effective > 0) {
          target[at] = Math.trunc((sr * effective + (target[at] ?? 0) * (255 - effective)) / 255);
          target[at + 1] = Math.trunc((sg * effective + (target[at + 1] ?? 0) * (255 - effective)) / 255);
          target[at + 2] = Math.trunc((sb * effective + (target[at + 2] ?? 0) * (255 - effective)) / 255);
          target[at + 3] = 255;
        }
      }
    }
  });
}
