/**
 * Core-owned persistent RGBA surfaces (AD-27).
 *
 * Surface pixels live in save state as a tagged base64 snapshot rather than a
 * `Uint8Array`, so snapshots remain canonical JSON. Decoded bytes are held
 * outside the state and discarded whenever their snapshot no longer matches.
 */

import type { DecodedTexture } from "../formats/image/model.ts";
import type { SurfacePixels } from "../ports/engine.ts";
import type { Rgb } from "../ports/draw.ts";
import type { SurfaceId } from "../ports/keys.ts";
import type { SurfacesSection, SurfaceState, RgbaSnapshot } from "../save/sections/surfaces.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

type DecodedRecord = { rev: number; bitmap: RgbaSnapshot; b64: string; w: number; h: number; rgba: Uint8Array; canonical: boolean };
type BatchEntry = { entry: SurfaceState; bitmap: RgbaSnapshot; b64: string; rev: number; w: number; h: number; rgba: Uint8Array };
type SurfaceBatch = { depth: number; entries: Map<SurfaceState, BatchEntry> };
const decodedRecords = new WeakMap<SurfaceState, DecodedRecord>();
const pendingEntries = new WeakMap<SurfaceState, BatchEntry>();
const batches = new WeakMap<SurfacesSection, SurfaceBatch>();
const BASE64_PAIRS = Array.from({ length: 4096 }, (_, i) => BASE64[i >> 6]! + BASE64[i & 63]!);

/** A decoded-pixel cache owned by a runner/core facade, never by save state. */
export type SurfacePixelCache = Map<string, Uint8Array>;


function idOf(value: number): SurfaceId {
  return value as SurfaceId;
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function byteCount(width: number, height: number): number {
  return width * height * 4;
}

/** Encode bytes without relying on host `btoa`/`Buffer` APIs (G2). */
export function encodeSurfaceBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let output = "";
  let i = 0;
  const limit = bytes.length - (bytes.length % 3);
  for (; i < limit; i += 3) {
    const bits = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    output += BASE64_PAIRS[bits >>> 12]! + BASE64_PAIRS[bits & 4095]!;
    if (output.length >= 8192) {
      chunks.push(output);
      output = "";
    }
  }
  if (i < bytes.length) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    output += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    output += b === undefined ? "==" : BASE64[(b & 15) << 2]! + "=";
  }
  chunks.push(output);
  return chunks.join("");
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
    const a = value.charCodeAt(i);
    const b = value.charCodeAt(i + 1);
    const c = value.charCodeAt(i + 2);
    const d = value.charCodeAt(i + 3);
    const ai = BASE64_VALUES[a] ?? -1;
    const bi = BASE64_VALUES[b] ?? -1;
    const ci = c === 61 ? 0 : BASE64_VALUES[c] ?? -1;
    const di = d === 61 ? 0 : BASE64_VALUES[d] ?? -1;
    if (ai < 0 || bi < 0 || ci < 0 || di < 0 || (c === 61 && d !== 61) || (i + 4 < value.length && (c === 61 || d === 61))) {
      throw new TypeError("invalid surface base64 payload");
    }
    const first = (ai << 2) | (bi >> 4);
    if (at < output.length) output[at++] = first;
    if (c !== 61) {
      const second = ((bi & 15) << 4) | (ci >> 2);
      if (at < output.length) output[at++] = second;
    }
    if (d !== 61) {
      const third = ((ci & 3) << 6) | di;
      if (at < output.length) output[at++] = third;
    }
  }
  return output;
}

function snapshot(width: number, height: number, rgba: Uint8Array): RgbaSnapshot {
  return { t: "rgba", w: width, h: height, b64: encodeSurfaceBytes(rgba) };
}

/** Rewrite only the changed, three-byte-aligned span of a canonical bitmap. */
type PixelBounds = { first: number; last: number };
function editedSnapshot(bitmap: RgbaSnapshot, before: Uint8Array, after: Uint8Array, bounds?: PixelBounds): RgbaSnapshot {
  const oldWords = new Uint32Array(before.buffer, before.byteOffset, before.byteLength / 4);
  const newWords = new Uint32Array(after.buffer, after.byteOffset, after.byteLength / 4);
  let first = bounds?.first ?? 0;
  const limit = bounds?.last ?? oldWords.length - 1;
  while (first <= limit && oldWords[first] === newWords[first]) first += 1;
  if (first > limit) return { ...bitmap };
  let last = limit;
  while (last > first && oldWords[last] === newWords[last]) last -= 1;
  const start = Math.floor(first * 4 / 3) * 3;
  const end = Math.min(after.length, Math.ceil((last + 1) * 4 / 3) * 3);
  const b64 = bitmap.b64.slice(0, start / 3 * 4)
    + encodeSurfaceBytes(after.subarray(start, end))
    + bitmap.b64.slice(Math.ceil(end / 3) * 4);
  return { t: "rgba", w: bitmap.w, h: bitmap.h, b64 };
}

/** An internal blit can only write pixels within this clipped destination. */
function blitBounds(bitmap: RgbaSnapshot, x: number, y: number, width: number, height: number): PixelBounds | undefined {
  if (![x, y, width, height, x + width, y + height].every(Number.isSafeInteger) || width < 0 || height < 0) return undefined;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(bitmap.w, x + width);
  const bottom = Math.min(bitmap.h, y + height);
  if (left >= right || top >= bottom) return { first: 0, last: -1 };
  return { first: top * bitmap.w + left, last: (bottom - 1) * bitmap.w + right - 1 };
}

function decode(entry: SurfaceState, cache?: SurfacePixelCache): Uint8Array {
  // A caller's id:rev cache cannot distinguish different restored states.
  // The entry association also checks the snapshot itself, not just its rev.
  void cache;
  const pending = pendingEntries.get(entry);
  if (pending !== undefined && pending.rev === entry.rev && pending.bitmap === entry.bitmap && pending.b64 === entry.bitmap.b64 && pending.w === entry.bitmap.w && pending.h === entry.bitmap.h) return pending.rgba;
  const record = decodedRecords.get(entry);
  const bitmap = entry.bitmap;
  if (record !== undefined && record.rev === entry.rev && record.bitmap === bitmap && record.b64 === bitmap.b64 && record.w === bitmap.w && record.h === bitmap.h) return record.rgba;
  const rgba = decodeSurfaceBytes(bitmap.b64);
  if (rgba.length !== byteCount(bitmap.w, bitmap.h)) throw new TypeError("surface pixel length does not match dimensions");
  decodedRecords.set(entry, { rev: entry.rev, bitmap, b64: bitmap.b64, w: bitmap.w, h: bitmap.h, rgba, canonical: false });
  return rgba;
}

/** Internal synchronous batch; callers must flush before exposing or saving state. */
export function beginSurfaceBatch(state: SurfacesSection): void {
  const batch = batches.get(state);
  if (batch !== undefined) batch.depth += 1;
  else batches.set(state, { depth: 1, entries: new Map() });
}

/** Materialize every dirty bitmap, including on a thrown command. */
export function endSurfaceBatch(state: SurfacesSection): void {
  const batch = batches.get(state);
  if (batch === undefined) throw new Error("surface batch is not active");
  batch.depth -= 1;
  if (batch.depth !== 0) return;
  batches.delete(state);
  for (const pending of batch.entries.values()) {
    pendingEntries.delete(pending.entry);
    const current = pending.entry;
    if (state.entries[String(current.id)] !== current || current.rev !== pending.rev || current.bitmap !== pending.bitmap || current.bitmap.b64 !== pending.b64 || current.bitmap.w !== pending.w || current.bitmap.h !== pending.h) continue;
    current.bitmap = snapshot(current.bitmap.w, current.bitmap.h, pending.rgba);
    decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: current.bitmap.w, h: current.bitmap.h, rgba: new Uint8Array(pending.rgba), canonical: true });
  }
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
    const pixels = new Uint8Array(byteCount(width, height));
    checkedRgba(width, height, pixels);
    const current: SurfaceState = { id: 0 as SurfaceId, rev: 0, bitmap: snapshot(width, height, pixels) };
    state.entries["0"] = current;
    decodedRecords.set(current, { rev: 0, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  }
  return state;
}

/** Allocate a monotonically increasing surface id. Ids are never reused. */
export function createSurface(state: SurfacesSection, width: number, height: number, rgba?: Uint8Array): SurfaceId {
  const pixels = rgba === undefined ? new Uint8Array(byteCount(width, height)) : new Uint8Array(rgba);
  checkedRgba(width, height, pixels);
  const id = idOf(state.nextId);
  state.nextId += 1;
  const current: SurfaceState = { id, rev: 0, bitmap: snapshot(width, height, pixels) };
  state.entries[String(id)] = current;
  decodedRecords.set(current, { rev: 0, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
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
  pendingEntries.delete(current);
  batches.get(state)?.entries.delete(current);
  decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: width, h: height, rgba: pixels, canonical: true });
  return current.rev;
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
  for (const raw of Object.keys(state.entries)) {
    const current = state.entries[raw]!;
    textures.set(current.id, { w: current.bitmap.w, h: current.bitmap.h, rgba: new Uint8Array(decode(current, cache)) });
  }
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
  return editSurfaceWithBounds(state, id, editor);
}

function editSurfaceWithBounds(state: SurfacesSection, id: SurfaceId, editor: SurfaceEditor, bounds?: PixelBounds): boolean {
  const current = entry(state, id);
  if (current === null) return false;
  // The editor may retain or throw after mutating its argument. Keep the cache
  // owned and leave the previous revision intact if it throws.
  const before = decode(current);
  const canonical = decodedRecords.get(current)?.canonical === true;
  const rgba = new Uint8Array(before);
  editor(rgba, current.bitmap.w, current.bitmap.h);
  current.rev += 1;
  const batch = batches.get(state);
  if (batch === undefined) {
    current.bitmap = canonical ? editedSnapshot(current.bitmap, before, rgba, bounds) : snapshot(current.bitmap.w, current.bitmap.h, rgba);
    before.set(rgba);
    decodedRecords.set(current, { rev: current.rev, bitmap: current.bitmap, b64: current.bitmap.b64, w: current.bitmap.w, h: current.bitmap.h, rgba: before, canonical: true });
  } else {
    const pending: BatchEntry = { entry: current, bitmap: current.bitmap, b64: current.bitmap.b64, rev: current.rev, w: current.bitmap.w, h: current.bitmap.h, rgba };
    pendingEntries.set(current, pending);
    batch.entries.set(current, pending);
  }
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
    const x0 = Math.max(0, left);
    const x1 = Math.min(width - 1, right);
    const y0 = Math.max(0, top);
    const y1 = Math.min(height - 1, bottom);
    if (!(x0 <= x1 && y0 <= y1)) return;
    const row = new Uint8Array((x1 - x0 + 1) * 4);
    const red = Math.max(0, Math.min(255, Math.trunc(rgb.r)));
    const green = Math.max(0, Math.min(255, Math.trunc(rgb.g)));
    const blue = Math.max(0, Math.min(255, Math.trunc(rgb.b)));
    for (let at = 0; at < row.length; at += 4) {
      row[at] = red;
      row[at + 1] = green;
      row[at + 2] = blue;
      row[at + 3] = 255;
    }
    for (let y = y0; y <= y1; y += 1) rgba.set(row, (y * width + x0) * 4);
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
/** Copy clipped scanlines only when every copied source pixel is opaque. */
function copyOpaqueRows(
  source: Uint8Array, sourceWidth: number, cropX: number, cropY: number,
  target: Uint8Array, targetWidth: number, targetHeight: number,
  dx: number, dy: number, width: number, height: number,
): boolean {
  if (![cropX, cropY, dx, dy, width, height].every(Number.isSafeInteger) || width < 0 || height < 0) return false;
  const left = Math.max(0, -dx);
  const top = Math.max(0, -dy);
  const right = Math.min(width, targetWidth - dx);
  const bottom = Math.min(height, targetHeight - dy);
  for (let row = top; row < bottom; row += 1) {
    const start = ((cropY + row) * sourceWidth + cropX + left) * 4;
    const end = start + Math.max(0, right - left) * 4;
    for (let alpha = start + 3; alpha < end; alpha += 4) if (source[alpha] !== 255) return false;
  }
  for (let row = top; row < bottom && left < right; row += 1) {
    const start = ((cropY + row) * sourceWidth + cropX + left) * 4;
    target.set(source.subarray(start, start + (right - left) * 4), ((dy + row) * targetWidth + dx + left) * 4);
  }
  return true;
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
  const sourcePixels = decode(sourceEntry);
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
  return editSurfaceWithBounds(state, destination, (target, targetWidth, targetHeight) => {
    if (outWidth === cropWidth && outHeight === cropHeight && key === undefined && !additive && alpha === 255
      && copyOpaqueRows(sourcePixels, sourceWidth, cropX, cropY, target, targetWidth, targetHeight, dx, dy, cropWidth, cropHeight)) return;
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
  }, blitBounds(destinationEntry.bitmap, dx, dy, outWidth, outHeight));
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
  return editSurfaceWithBounds(state, destination, (target, targetWidth, targetHeight) => {
    if (outWidth === cropWidth && outHeight === cropHeight && key === undefined && !additive && alpha === 255
      && copyOpaqueRows(texture.rgba, texture.w, cropX, cropY, target, targetWidth, targetHeight, dx, dy, cropWidth, cropHeight)) return;
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
  }, blitBounds(destinationEntry.bitmap, dx, dy, outWidth, outHeight));
}
