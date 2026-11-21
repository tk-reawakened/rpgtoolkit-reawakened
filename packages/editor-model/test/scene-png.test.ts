import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { decodeTexture, type DecodedTexture } from "@tk-reawakened/core";
import { encodeScenePng } from "../src/scene-png.ts";

function image(w: number, h: number, rgba: number[]): DecodedTexture {
  return { w, h, rgba: new Uint8Array(rgba) };
}

function decode(png: Uint8Array): DecodedTexture {
  const result = decodeTexture(png, "scene.png");
  if (!result.ok) throw result.error;
  return result.value;
}

function colourType(png: Uint8Array): number {
  deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  equal(String.fromCharCode(...png.subarray(12, 16)), "IHDR");
  return png[25]!;
}

test("scene PNG uses indexed colour and preserves exact straight RGBA including transparency", () => {
  const source = image(3, 2, [
    7, 8, 9, 0, 7, 8, 9, 128, 7, 8, 9, 255,
    200, 10, 40, 64, 7, 8, 9, 0, 1, 2, 3, 255,
  ]);
  const png = encodeScenePng(source);
  equal(colourType(png), 3);
  const decoded = decode(png);
  equal(decoded.w, 3);
  equal(decoded.h, 2);
  deepEqual(decoded.rgba, source.rgba);
  deepEqual(encodeScenePng(source), png);
});

test("scene PNG keeps all 256 RGBA colours indexed", () => {
  const pixels: number[] = [];
  for (let i = 0; i < 256; i += 1) pixels.push(i, i ^ 0x55, 255 - i, (i * 17) & 255);
  const source = image(256, 1, pixels);
  const png = encodeScenePng(source);
  equal(colourType(png), 3);
  deepEqual(decode(png).rgba, source.rgba);
});

test("scene PNG switches to truecolour-alpha at 257 distinct RGBA colours", () => {
  const pixels: number[] = [];
  for (let i = 0; i < 257; i += 1) pixels.push(i & 255, (i >>> 8) * 37, 12, i & 255);
  const source = image(257, 1, pixels);
  const png = encodeScenePng(source);
  equal(colourType(png), 6);
  const decoded = decode(png);
  equal(decoded.w, 257);
  equal(decoded.h, 1);
  deepEqual(decoded.rgba, source.rgba);
  deepEqual(encodeScenePng(source), png);
});

test("scene PNG treats alpha as part of a colour and refuses invalid dimensions or RGBA lengths", () => {
  equal(colourType(encodeScenePng(image(2, 1, [1, 2, 3, 255, 1, 2, 3, 0]))), 3);
  throws(() => encodeScenePng(image(0, 1, [])), /dimensions/);
  throws(() => encodeScenePng(image(1.5, 1, [])), /dimensions/);
  throws(() => encodeScenePng(image(10_001, 10_000, [])), /dimensions/);
  throws(() => encodeScenePng(image(2, 1, [1, 2, 3, 4])), /RGBA length/);
});
