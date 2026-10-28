import { deepEqual, equal, throws } from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import {
  blitSurface,
  canon,
  decodeSurfaceBytes,
  drawSurfaceRect,
  encodeSurfaceBytes,
  surfaceTextures,
  blitTexture,
  canvasGetScreen,
  colourSurface,
  createSurface,
  createSurfacesSection,
  editSurface,
  getPixel,
  killSurface,
  readSurfacePixels,
  renderNowCanvas,
  renderNowEnabled,
  replaceSurface,
  restoreGameState,
  saveScreen,
  snapshot,
  createGameState,
  type SurfaceId,
} from "../src/index.ts";
import { beginSurfaceBatch, endSurfaceBatch } from "../src/raster/surfaces.ts";

test("surface read-back is revision guarded and returns owned bytes", () => {
  const state = createSurfacesSection(2, 1);
  const id = createSurface(state, 2, 1, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]));
  const first = readSurfacePixels(state, id, 0);
  if (first === null) throw new Error("expected surface pixels");
  first.rgba[0] = 99;
  const second = readSurfacePixels(state, id, 0);
  if (second === null) throw new Error("expected surface pixels");
  equal(second.rgba[0], 1);
  equal(readSurfacePixels(state, id, 1), null);
  equal(replaceSurface(state, id, 2, 1, new Uint8Array([7, 8, 9, 255, 1, 1, 1, 255])), 1);
  equal(readSurfacePixels(state, id, 0), null);
  deepEqual(readSurfacePixels(state, id, 1)?.rgba, new Uint8Array([7, 8, 9, 255, 1, 1, 1, 255]));
});

test("surface ids are monotonic and colour surfaces are interned", () => {
  const state = createSurfacesSection();
  const first = createSurface(state, 1, 1);
  equal(killSurface(state, first), true);
  const second = createSurface(state, 1, 1);
  equal(second > first, true);
  const red = colourSurface(state, { r: 255, g: 0, b: 0 });
  equal(colourSurface(state, { r: 255, g: 0, b: 0 }), red);
  equal(getPixel(state, red, 0, 0)?.r, 255);
});

test("editing an interned colour surface invalidates its colour cache entry", () => {
  const state = createSurfacesSection();
  const red = colourSurface(state, { r: 255, g: 0, b: 0 });
  equal(editSurface(state, red, (rgba) => { rgba[0] = 0; }), true);
  const replacement = colourSurface(state, { r: 255, g: 0, b: 0 });
  equal(replacement === red, false);
  equal(getPixel(state, replacement, 0, 0)?.r, 255);
});

test("screen capture and slots round-trip through the save shape", () => {
  const state = createSurfacesSection(2, 1);
  const source = createSurface(state, 2, 1, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]));
  const saved = saveScreen(state, 3, source);
  if (saved === null) throw new Error("expected saved slot");
  const destination = createSurface(state, 2, 1);
  equal(canvasGetScreen(state, destination, source), 1);
  equal(getPixel(state, destination, 1, 0)?.g, 5);
  equal(typeof restoreGameState(snapshot({ ...createGameState({ seed: 1 }), surfaces: state })), "object");
  equal(replaceSurface(state, destination, 2, 1, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255])), 2);
  equal((saved as SurfaceId) > source, true);
  equal(destination !== saved, true);
});

test("the reserved overlay's handle and on/off flag round-trip through the save shape", () => {
  const state = createSurfacesSection(4, 4);
  const canvas = createSurface(state, 4, 4);
  state.renderNow = canvas;
  state.renderNowOn = false;
  const restored = restoreGameState(snapshot({ ...createGameState({ seed: 1 }), surfaces: state }));
  equal(restored.surfaces.renderNow, canvas, "the handle persists while it is switched off");
  equal(restored.surfaces.renderNowOn, false, "and so does the flag");
  equal(renderNowCanvas(restored.surfaces), canvas);
  equal(renderNowEnabled(restored.surfaces), false);
  state.renderNowOn = true;
  equal(renderNowEnabled(restoreGameState(snapshot({ ...createGameState({ seed: 1 }), surfaces: state })).surfaces), true);
});

test("decoded image blits preserve keys, alpha, scaling and one revision", () => {
  const state = createSurfacesSection(3, 2);
  const image = {
    w: 2,
    h: 1,
    rgba: new Uint8Array([255, 0, 255, 255, 20, 40, 60, 255]),
  };
  equal(blitTexture(state, image, 0 as SurfaceId, 0, 0, 3, 1, { r: 255, g: 0, b: 255 }), true);
  equal(state.entries["0"]?.rev, 1);
  deepEqual(getPixel(state, 0 as SurfaceId, 0, 0), { r: 0, g: 0, b: 0 });
  deepEqual(getPixel(state, 0 as SurfaceId, 2, 0), { r: 20, g: 40, b: 60 });
});

test("surface bytes are canonical padded base64 for every length remainder and malformed payloads are rejected", () => {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const reference = (bytes: Uint8Array): string => {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i]!;
      const b = bytes[i + 1];
      const c = bytes[i + 2];
      out += table[a >> 2]! + table[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
      out += b === undefined ? "=" : table[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
      out += c === undefined ? "=" : table[c & 63]!;
    }
    return out;
  };
  for (const length of [0, 1, 2, 3, 4, 5, 100, 8191, 8192, 8193, 40000]) {
    const bytes = new Uint8Array(length).map((_, index) => (index * 37 + length) & 255);
    const text = encodeSurfaceBytes(bytes);
    equal(text, reference(bytes), `length ${length}`);
    deepEqual(decodeSurfaceBytes(text), bytes);
  }
  for (const bad of ["ab", "a===", "ab=c", "!!!!", "QUJD\u00e9AAA", "QQ==QQ=="]) {
    let threw = false;
    try { decodeSurfaceBytes(bad); } catch { threw = true; }
    equal(threw, true, JSON.stringify(bad));
  }
});

test("surface textures remain independent across revisions", () => {
  const state = createSurfacesSection(2, 1);
  const id = createSurface(state, 2, 1);
  const cache = new Map<string, Uint8Array>();
  const first = surfaceTextures(state, cache).get(id)!;
  editSurface(state, id, (rgba) => { rgba[0] = 9; });
  editSurface(state, id, (rgba) => { rgba[1] = 9; });
  const current = surfaceTextures(state, cache).get(id)!;
  deepEqual([...first.rgba], [0, 0, 0, 0, 0, 0, 0, 0]);
  deepEqual([...current.rgba], [9, 9, 0, 0, 0, 0, 0, 0]);
  current.rgba[0] = 77;
  equal(surfaceTextures(state, cache).get(id)!.rgba[0], 9);
});

test("base64 is byte-identical for all remainder lengths", () => {
  for (let length = 0; length < 257; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 19) & 255);
    equal(encodeSurfaceBytes(bytes), Buffer.from(bytes).toString("base64"));
    deepEqual(decodeSurfaceBytes(encodeSurfaceBytes(bytes)), bytes);
  }
});

test("standalone edits preserve snapshots, cache ownership, clones and direct bitmap replacement", () => {
  const state = createSurfacesSection(2, 1);
  const id = 0 as SurfaceId;
  const cache = new Map<string, Uint8Array>();
  let retained: Uint8Array = new Uint8Array();
  editSurface(state, id, (pixels) => { pixels.set([1, 2, 3, 255]); retained = pixels; });
  retained[0] = 90;
  equal(getPixel(state, id, 0, 0, cache)?.r, 1);
  const json = JSON.stringify(state);
  const clone = JSON.parse(json) as typeof state;
  equal(canon(state), canon(clone));
  equal(clone.entries["0"]?.rev, 1);
  const clonedBitmap = clone.entries["0"]!.bitmap;
  clone.entries["0"]!.bitmap = { ...clonedBitmap, b64: encodeSurfaceBytes(new Uint8Array([7, 8, 9, 255, 0, 0, 0, 0])) };
  equal(getPixel(clone, id, 0, 0, cache)?.r, 7);
  equal(getPixel(state, id, 0, 0, cache)?.r, 1);
  const owned = surfaceTextures(state, cache).get(id)!;
  owned.rgba[0] = 55;
  equal(getPixel(state, id, 0, 0)?.r, 1);
  throws(() => editSurface(state, id, (rgba) => { rgba[0] = 99; throw new Error("abort"); }), /abort/);
  equal(JSON.stringify(state), json);
  equal(getPixel(state, id, 0, 0)?.r, 1);
  // Exercise an in-place mutation from untrusted plain JSON, despite the readonly type.
  const mutableBitmap = state.entries["0"]!.bitmap as { b64: string };
  mutableBitmap.b64 = encodeSurfaceBytes(new Uint8Array([11, 2, 3, 255, 0, 0, 0, 0]));
  equal(getPixel(state, id, 0, 0, cache)?.r, 11);
});

test("incremental base64 remains canonical after edits across every alignment", () => {
  const state = createSurfacesSection(13, 7);
  const id = 0 as SurfaceId;
  const expected = new Uint8Array(13 * 7 * 4);
  for (let i = 0; i < 80; i += 1) {
    const at = (i * 67 + 1) % expected.length;
    const value = (i * 53 + 17) & 255;
    expected[at] = value;
    editSurface(state, id, (pixels) => { pixels[at] = value; });
    equal(state.entries["0"]!.bitmap.b64, Buffer.from(expected).toString("base64"));
    equal(state.entries["0"]!.rev, i + 1);
  }
});

test("a restored noncanonical base64 spelling is canonicalized by an edit", () => {
  const state = createSurfacesSection(1, 1);
  state.entries["0"]!.bitmap = { t: "rgba", w: 1, h: 1, b64: "AAAAAB==" };
  equal(editSurface(state, 0 as SurfaceId, () => {}), true);
  equal(state.entries["0"]!.bitmap.b64, "AAAAAA==");
});

test("batch writes read back and flush to plain JSON with one revision per edit", () => {
  const state = createSurfacesSection(2, 1);
  const id = 0 as SurfaceId;
  beginSurfaceBatch(state);
  editSurface(state, id, (pixels) => { pixels[0] = 12; });
  editSurface(state, id, (pixels) => { pixels[4] = 34; });
  equal(getPixel(state, id, 0, 0)?.r, 12);
  equal(getPixel(state, id, 1, 0)?.r, 34);
  endSurfaceBatch(state);
  equal(state.entries["0"]?.rev, 2);
  const clone = JSON.parse(JSON.stringify(state)) as typeof state;
  equal(canon(state), canon(clone));
  equal(getPixel(clone, id, 1, 0)?.r, 34);
});

test("filled rectangles clip and clamp exactly, including reversed bounds", () => {
  const pixels = new Uint8Array(4 * 3 * 4);
  drawSurfaceRect(pixels, 4, 3, 2, 1, -3, 9, { r: 257.5, g: -1, b: 12.8 }, true);
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 4; x += 1) {
    const at = (y * 4 + x) * 4;
    deepEqual([...pixels.slice(at, at + 4)], y >= 1 && x <= 2 ? [255, 0, 12, 255] : [0, 0, 0, 0]);
  }
});

test("scanline blits clip, preserve alpha blending and self-overlap", () => {
  const state = createSurfacesSection(3, 1);
  const dst = 0 as SurfaceId;
  const opaque = createSurface(state, 3, 1, new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]));
  equal(blitSurface(state, opaque, dst, -1, 0), true);
  deepEqual([...readSurfacePixels(state, dst, 1)!.rgba], [4, 5, 6, 255, 7, 8, 9, 255, 0, 0, 0, 0]);
  equal(blitSurface(state, dst, dst, 1, 0), true);
  deepEqual([...readSurfacePixels(state, dst, 2)!.rgba], [4, 5, 6, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
  equal(blitTexture(state, { w: 1, h: 1, rgba: new Uint8Array([100, 50, 0, 128]) }, dst, 0, 0), true);
  deepEqual([...readSurfacePixels(state, dst, 3)!.rgba.slice(0, 4)], [52, 27, 2, 255]);
  equal(state.entries["0"]!.bitmap.b64, Buffer.from(readSurfacePixels(state, dst, 3)!.rgba).toString("base64"));
});
