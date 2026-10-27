import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  decodeSurfaceBytes,
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
  replaceSurface,
  restoreGameState,
  saveScreen,
  snapshot,
  createGameState,
  type SurfaceId,
} from "../src/index.ts";

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

test("decoded-surface cache entries of replaced revisions are dropped", () => {
  const state = createSurfacesSection(2, 1);
  const id = createSurface(state, 2, 1);
  const cache = new Map<string, Uint8Array>();
  surfaceTextures(state, cache);
  editSurface(state, id, (rgba) => { rgba[0] = 9; });
  editSurface(state, id, (rgba) => { rgba[1] = 9; });
  surfaceTextures(state, cache);
  deepEqual([...cache.keys()].sort(), [`0:0`, `${id}:2`], "only the current revision of each surface stays cached");
});
