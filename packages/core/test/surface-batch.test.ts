import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  blitSurface,
  blitTexture,
  colourSurface,
  createSurface,
  createSurfacesSection,
  decodeSurfaceBytes,
  drawSurfaceCircle,
  drawSurfaceLine,
  drawSurfaceRect,
  editSurface,
  encodeSurfaceBytes,
  getPixel,
  readSurfacePixels,
  replaceSurface,
  type SurfaceId,
} from "../src/index.ts";
import {
  beginSurfaceBatch,
  blitBounds,
  circleBounds,
  editSurfaceWithBounds,
  endSurfaceBatch,
  flushSurfaceBatch,
  lineBounds,
  pixelBounds,
  rectBounds,
  surfaceCircleBounds,
  surfaceLineBounds,
  surfacePixelBounds,
  surfaceRectBounds,
  type PixelBounds,
} from "../src/raster/surfaces.ts";
import type { SurfacesSection } from "../src/save/sections/surfaces.ts";

type Surfaces = SurfacesSection;
const SCREEN = 0 as SurfaceId;
const INK = { r: 200, g: 100, b: 50 };

/** A fixed xorshift32 stream so every failure replays from its seed. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)]!;
}

function live(state: Surfaces, id: SurfaceId): Uint8Array {
  const entry = state.entries[String(id)]!;
  const pixels = readSurfacePixels(state, id, entry.rev);
  if (pixels === null) throw new Error("expected live surface pixels");
  return pixels.rgba;
}

/** The saved snapshot must be exactly the canonical encoding of the pixels a reader sees. */
function assertCanonical(state: Surfaces, id: SurfaceId, label: string): void {
  const entry = state.entries[String(id)]!;
  const pixels = live(state, id);
  equal(entry.bitmap.b64, encodeSurfaceBytes(pixels), `${label}: b64 is not the canonical encoding of the live pixels`);
  deepEqual(decodeSurfaceBytes(entry.bitmap.b64), pixels, `${label}: b64 does not decode to the live pixels`);
}

function noise(next: () => number, w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(next() * 256);
  return bytes;
}

const SIZES: readonly (readonly [number, number])[] = [[0, 0], [1, 1], [1, 3], [3, 1], [2, 2], [5, 7], [8, 8], [13, 5], [17, 9]];

function surfaceWith(next: () => number, w: number, h: number, canvases: readonly (readonly [number, number])[] = []): { state: Surfaces; ids: SurfaceId[] } {
  const state = createSurfacesSection(w, h);
  replaceSurface(state, SCREEN, w, h, noise(next, w, h));
  const ids = [SCREEN, ...canvases.map(([cw, ch]) => createSurface(state, cw, ch, noise(next, cw, ch)))];
  return { state, ids };
}

/** A coordinate: in range, fractional, reversed-friendly, huge or (when allowed) infinite/NaN. */
function coord(next: () => number, extent: number, nonFinite: boolean): number {
  const t = next();
  if (nonFinite && t < 0.08) return pick(next, [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN]);
  if (t < 0.16) return Math.trunc((next() * 2 - 1) * 1e4);
  if (t < 0.6) return Math.floor(next() * (extent + 12)) - 6;
  if (t < 0.85) return next() * (extent + 12) - 6;
  return pick(next, [0, extent - 1, extent, extent + 1, -1, -0.5, 0.999, extent - 0.001]);
}

type Draw = { readonly name: string; readonly bounds: (w: number, h: number) => PixelBounds; readonly draw: (rgba: Uint8Array, w: number, h: number) => void };

/**
 * One random drawing operation with the bounds the engine pairs with it. Non-finite
 * coordinates are only generated where the draw routine terminates on them (fills, points,
 * circle centres); a Bresenham line or outline with an infinite end never returns.
 */
function randomDraw(next: () => number, w: number, h: number): Draw {
  const kind = pick(next, ["fillrect", "drawrect", "line", "fillcircle", "drawcircle", "pixel"] as const);
  if (kind === "fillrect") {
    const [a, b, c, d] = [coord(next, w, true), coord(next, h, true), coord(next, w, true), coord(next, h, true)];
    return { name: `fillrect(${a},${b},${c},${d})`, bounds: (cw, ch) => rectBounds(cw, ch, a, b, c, d), draw: (rgba, cw, ch) => drawSurfaceRect(rgba, cw, ch, a, b, c, d, INK, true) };
  }
  if (kind === "drawrect") {
    const [a, b, c, d] = [coord(next, w, false), coord(next, h, false), coord(next, w, false), coord(next, h, false)];
    return { name: `drawrect(${a},${b},${c},${d})`, bounds: (cw, ch) => rectBounds(cw, ch, a, b, c, d), draw: (rgba, cw, ch) => drawSurfaceRect(rgba, cw, ch, a, b, c, d, INK, false) };
  }
  if (kind === "line") {
    const [a, b, c, d] = [coord(next, w, false), coord(next, h, false), coord(next, w, false), coord(next, h, false)];
    return { name: `line(${a},${b},${c},${d})`, bounds: (cw, ch) => lineBounds(cw, ch, a, b, c, d), draw: (rgba, cw, ch) => drawSurfaceLine(rgba, cw, ch, a, b, c, d, INK) };
  }
  if (kind === "pixel") {
    const [a, b] = [coord(next, w, true), coord(next, h, true)];
    return {
      name: `pixel(${a},${b})`,
      bounds: (cw, ch) => pixelBounds(cw, ch, a, b),
      draw: (rgba, cw, ch) => {
        // setpixel's own plot, so the pair under test is the one the command ships.
        const x = Math.trunc(a);
        const y = Math.trunc(b);
        if (x >= 0 && y >= 0 && x < cw && y < ch) { const at = (y * cw + x) * 4; rgba[at] = INK.r; rgba[at + 1] = INK.g; rgba[at + 2] = INK.b; rgba[at + 3] = 255; }
      },
    };
  }
  const centre = [coord(next, w, true), coord(next, h, true)] as const;
  const radius = pick(next, [0, 0.5, 1, 2, 3.7, 5, 9, -2, 15, 40, Number.NaN]);
  const filled = kind === "fillcircle";
  return { name: `${kind}(${centre[0]},${centre[1]},${radius})`, bounds: (cw, ch) => circleBounds(cw, ch, centre[0], centre[1], radius), draw: (rgba, cw, ch) => drawSurfaceCircle(rgba, cw, ch, centre[0], centre[1], radius, INK, filled) };
}

test("bounds are exact for in-range, reversed, fractional and offscreen shapes", () => {
  const state = createSurfacesSection(10, 10);
  deepEqual(pixelBounds(10, 10, 2.7, 3.1), { first: 32, last: 32 });
  deepEqual(pixelBounds(10, 10, -1, 5), { first: 0, last: -1 });
  deepEqual(pixelBounds(10, 10, 10, 5), { first: 0, last: -1 });
  deepEqual(pixelBounds(10, 10, 5, Number.NaN), { first: 0, last: -1 });
  deepEqual(pixelBounds(10, 10, Number.POSITIVE_INFINITY, 5), { first: 0, last: -1 });
  deepEqual(surfacePixelBounds(state, SCREEN, 4.9, 5.2), { first: 54, last: 54 });
  equal(surfacePixelBounds(state, 99 as SurfaceId, 0, 0), undefined);

  deepEqual(rectBounds(10, 10, 8.9, 7.5, 2.1, 1.3), { first: 12, last: 78 });
  deepEqual(rectBounds(10, 10, -5, -5, -1, -1), { first: 0, last: -1 });
  deepEqual(rectBounds(10, 10, -5, 2, 5, 4), { first: 20, last: 45 });
  deepEqual(surfaceRectBounds(state, SCREEN, 5, 5, 2, 2), { first: 22, last: 55 });

  deepEqual(lineBounds(10, 10, 1.2, 2.8, 8.7, 5.1), { first: 21, last: 58 });
  deepEqual(lineBounds(10, 10, 8, 8, 2, 2), { first: 22, last: 88 });
  deepEqual(lineBounds(10, 10, -10, 12, -2, 15), { first: 0, last: -1 });
  deepEqual(surfaceLineBounds(state, SCREEN, 0, 0, 9, 9), { first: 0, last: 99 });

  deepEqual(circleBounds(10, 10, 5.2, 5.8, 2.9), { first: 33, last: 77 });
  deepEqual(circleBounds(10, 10, -10, -10, 3), { first: 0, last: -1 });
  deepEqual(circleBounds(10, 10, 0, 0, 3), { first: 0, last: 33 });
  deepEqual(circleBounds(10, 10, 5, 5, -2), { first: 55, last: 55 });
  deepEqual(surfaceCircleBounds(state, SCREEN, 5, 5, 2), { first: 33, last: 77 });
  deepEqual(rectBounds(0, 0, 1, 1, 2, 2), { first: 0, last: -1 });
});

test("bounds fail open: infinite edges clip like the draw routines and unknown extents cover the surface", () => {
  // fillrect clips an infinite edge to the surface, so the span must reach the far edge.
  deepEqual(rectBounds(10, 10, 2, 2, Number.POSITIVE_INFINITY, 4), { first: 22, last: 49 });
  deepEqual(rectBounds(10, 10, Number.NEGATIVE_INFINITY, 0, 3, 1), { first: 0, last: 13 });
  deepEqual(rectBounds(10, 10, 0, 0, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY), { first: 0, last: 99 });
  deepEqual(rectBounds(10, 10, 2, 2, Number.NaN, 4), { first: 0, last: -1 });
  // A NaN endpoint leaves a line's extent unknown (it plots its start pixel first), so report everything.
  deepEqual(lineBounds(10, 10, 2, 2, Number.NaN, 4), { first: 0, last: 99 });
  deepEqual(lineBounds(10, 10, 2, 2, Number.POSITIVE_INFINITY, 4), { first: 22, last: 49 });
  // Circles: a non-finite centre plots nothing, an infinite radius covers everything.
  deepEqual(circleBounds(10, 10, Number.POSITIVE_INFINITY, 3, 2), { first: 0, last: -1 });
  deepEqual(circleBounds(10, 10, 3, 3, Number.NaN), { first: 0, last: -1 });
  deepEqual(circleBounds(10, 10, 3, 3, Number.POSITIVE_INFINITY), { first: 0, last: 99 });
  // Blits outside the safe-integer range are unbounded, never narrowed.
  const bitmap = createSurfacesSection(4, 4).entries["0"]!.bitmap;
  equal(blitBounds(bitmap, 2 ** 60, 0, 2, 2), undefined);
  equal(blitBounds(bitmap, Number.NaN, 0, 2, 2), undefined);
  deepEqual(blitBounds(bitmap, -1, -1, 3, 3), { first: 0, last: 5 });
  deepEqual(blitBounds(bitmap, 4, 0, 2, 2), { first: 0, last: -1 });
});

test("randomized bounds always cover every pixel the draw routine writes (seeded)", () => {
  const next = seeded(0xb0a4d5);
  for (let trial = 0; trial < 3000; trial += 1) {
    const [w, h] = pick(next, SIZES);
    const op = randomDraw(next, w, h);
    const pixels = new Uint8Array(w * h * 4);
    op.draw(pixels, w, h);
    const bounds = op.bounds(w, h);
    for (let p = 0; p < w * h; p += 1) {
      if (pixels[p * 4 + 3] === 0) continue;
      ok(p >= bounds.first && p <= bounds.last, `trial ${trial} ${op.name} on ${w}x${h} wrote pixel ${p} outside ${JSON.stringify(bounds)}`);
    }
    ok(bounds.first > bounds.last || (bounds.first >= 0 && bounds.last < w * h), `trial ${trial} ${op.name} reports bounds ${JSON.stringify(bounds)} off the ${w}x${h} surface`);
  }
});

test("bounded eager edits keep b64 equal to a full re-encode and to a plain-buffer model (seeded)", () => {
  const next = seeded(0x5eed01);
  for (let trial = 0; trial < 400; trial += 1) {
    const [w, h] = pick(next, SIZES);
    const { state } = surfaceWith(next, w, h);
    const model = new Uint8Array(live(state, SCREEN));
    for (let step = 0; step < 1 + Math.floor(next() * 6); step += 1) {
      const op = randomDraw(next, w, h);
      op.draw(model, w, h);
      equal(editSurfaceWithBounds(state, SCREEN, (rgba, cw, ch) => op.draw(rgba, cw, ch), op.bounds(w, h)), true);
      deepEqual(live(state, SCREEN), model, `trial ${trial} ${op.name}: pixels differ from the plain-buffer model`);
      assertCanonical(state, SCREEN, `trial ${trial} ${op.name}`);
      equal(state.entries["0"]!.rev, 1 + step + 1);
    }
  }
});

test("batched edits with random flush points match an eager twin and stay canonical at every flush (seeded)", () => {
  const next = seeded(0xba7c4e);
  for (let trial = 0; trial < 300; trial += 1) {
    const [w, h] = pick(next, SIZES);
    const canvases = [pick(next, SIZES), pick(next, SIZES)] as const;
    const seed = Math.floor(next() * 0x7fffffff) + 1;
    const eager = surfaceWith(seeded(seed), w, h, canvases);
    const batched = surfaceWith(seeded(seed), w, h, canvases);
    beginSurfaceBatch(batched.state);
    try {
      for (let step = 0; step < 1 + Math.floor(next() * 10); step += 1) {
        const target = pick(next, eager.ids);
        const size = eager.state.entries[String(target)]!.bitmap;
        const roll = next();
        if (roll < 0.25) {
          // Blits, including a surface onto itself; sizes and offsets include clipped and scaled cases.
          const source = pick(next, eager.ids);
          const x = Math.floor(next() * 14) - 5;
          const y = Math.floor(next() * 14) - 5;
          const scaled = next() < 0.4;
          const bw = scaled ? Math.floor(next() * 9) : undefined;
          const bh = scaled ? Math.floor(next() * 9) : undefined;
          const keyed = next() < 0.3 ? { r: 7, g: 7, b: 7 } : undefined;
          const alpha = pick(next, [255, 255, 128, 0]);
          equal(blitSurface(eager.state, source, target, x, y, bw, bh, keyed, alpha), true);
          equal(blitSurface(batched.state, source, target, x, y, bw, bh, keyed, alpha), true);
        } else {
          const op = randomDraw(next, size.w, size.h);
          equal(editSurfaceWithBounds(eager.state, target, (rgba, cw, ch) => op.draw(rgba, cw, ch), op.bounds(size.w, size.h)), true);
          equal(editSurfaceWithBounds(batched.state, target, (rgba, cw, ch) => op.draw(rgba, cw, ch), op.bounds(size.w, size.h)), true);
        }
        for (const id of eager.ids) deepEqual(live(batched.state, id), live(eager.state, id), `trial ${trial} step ${step}: batched pixels differ from the eager twin on surface ${id}`);
        if (next() < 0.3) {
          flushSurfaceBatch(batched.state);
          for (const id of eager.ids) assertCanonical(batched.state, id, `trial ${trial} step ${step} flush`);
        }
      }
    } finally {
      endSurfaceBatch(batched.state);
    }
    for (const id of eager.ids) {
      assertCanonical(batched.state, id, `trial ${trial} end`);
      assertCanonical(eager.state, id, `trial ${trial} eager`);
      equal(JSON.stringify(batched.state.entries[String(id)]), JSON.stringify(eager.state.entries[String(id)]), `trial ${trial}: surface ${id} differs from the eager twin after the batch`);
    }
  }
});

test("an unbounded edit is never narrowed by a later bounded one", () => {
  for (const second of ["bounded", "public"] as const) {
    const state = createSurfacesSection(8, 8);
    replaceSurface(state, SCREEN, 8, 8, Uint8Array.from({ length: 256 }, (_, i) => (i * 7) & 255));
    beginSurfaceBatch(state);
    editSurfaceWithBounds(state, SCREEN, (rgba) => { rgba.set([1, 2, 3, 4], 60 * 4); });
    if (second === "bounded") editSurfaceWithBounds(state, SCREEN, (rgba) => { rgba[0] = 9; }, { first: 0, last: 0 });
    else editSurface(state, SCREEN, (rgba) => { rgba[0] = 9; });
    endSurfaceBatch(state);
    assertCanonical(state, SCREEN, second);
    deepEqual([...live(state, SCREEN).slice(60 * 4, 60 * 4 + 4)], [1, 2, 3, 4]);
  }
  // The same through an intermediate flush: a flushed unbounded edit is clean afterwards.
  const state = createSurfacesSection(8, 8);
  beginSurfaceBatch(state);
  editSurfaceWithBounds(state, SCREEN, (rgba) => { rgba[60 * 4 + 3] = 255; });
  flushSurfaceBatch(state);
  assertCanonical(state, SCREEN, "after flush");
  editSurfaceWithBounds(state, SCREEN, (rgba) => { rgba[3] = 255; }, { first: 0, last: 0 });
  endSurfaceBatch(state);
  assertCanonical(state, SCREEN, "after end");
});

test("an editor that throws restores its region, keeps earlier edits and leaves the revision alone", () => {
  for (const kind of ["bounded", "unbounded", "first"] as const) {
    const state = createSurfacesSection(10, 10);
    beginSurfaceBatch(state);
    const bounds = kind === "unbounded" ? undefined : { first: 0, last: 0 };
    if (kind !== "first") {
      editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([255, 0, 0, 255], 0), { first: 0, last: 0 });
      editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([0, 255, 0, 255], 4), { first: 1, last: 1 });
    }
    const revBefore = state.entries["0"]!.rev;
    const pixelsBefore = new Uint8Array(live(state, SCREEN));
    throws(() => editSurfaceWithBounds(state, SCREEN, (rgba) => {
      rgba.set([0, 0, 255, 255], 0);
      throw new Error("aborted mid-draw");
    }, bounds), /aborted mid-draw/);
    equal(state.entries["0"]!.rev, revBefore, `${kind}: revision bumped by a failed edit`);
    deepEqual(live(state, SCREEN), pixelsBefore, `${kind}: failed edit left pixels behind`);
    endSurfaceBatch(state);
    equal(state.entries["0"]!.rev, revBefore);
    assertCanonical(state, SCREEN, kind);
    deepEqual(live(state, SCREEN), pixelsBefore);
  }
});

test("flushSurfaceBatch makes snapshots canonical mid-batch while buffers stay valid and clean", () => {
  const state = createSurfacesSection(8, 8);
  flushSurfaceBatch(state); // outside a batch: nothing to do, nothing thrown
  beginSurfaceBatch(state);
  editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([9, 8, 7, 255], 3 * 4), { first: 3, last: 3 });
  const stale = state.entries["0"]!.bitmap.b64;
  ok(stale !== encodeSurfaceBytes(live(state, SCREEN)), "the batch should hold the snapshot back until a flush");
  equal(getPixel(state, SCREEN, 3, 0)?.r, 9, "batched pixels are readable before the flush");

  flushSurfaceBatch(state);
  assertCanonical(state, SCREEN, "first flush");
  equal(state.entries["0"]!.rev, 1);
  const flushed = state.entries["0"]!.bitmap;
  flushSurfaceBatch(state);
  equal(state.entries["0"]!.bitmap, flushed, "a clean batch is not re-encoded");

  editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([1, 1, 1, 255], 5 * 4), { first: 5, last: 5 });
  equal(getPixel(state, SCREEN, 5, 0)?.r, 1);
  equal(getPixel(state, SCREEN, 3, 0)?.r, 9);
  flushSurfaceBatch(state);
  assertCanonical(state, SCREEN, "second flush");
  editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([2, 2, 2, 255], 6 * 4), { first: 6, last: 6 });
  endSurfaceBatch(state);
  assertCanonical(state, SCREEN, "end");
  equal(state.entries["0"]!.rev, 3);
  const clone = JSON.parse(JSON.stringify(state)) as Surfaces;
  equal(clone.entries["0"]!.bitmap.b64, state.entries["0"]!.bitmap.b64);
});

test("a surface changed behind the batch is not clobbered by a later batched edit", () => {
  const state = createSurfacesSection(4, 1);
  beginSurfaceBatch(state);
  editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([1, 1, 1, 255], 0), { first: 0, last: 0 });
  flushSurfaceBatch(state);
  // Outside code replaces the snapshot directly, as untrusted plain data can.
  const entry = state.entries["0"]!;
  const external = decodeSurfaceBytes(entry.bitmap.b64);
  external.set([5, 5, 5, 255], 4);
  entry.bitmap = { ...entry.bitmap, b64: encodeSurfaceBytes(external) };
  editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([9, 9, 9, 255], 12), { first: 3, last: 3 });
  endSurfaceBatch(state);
  deepEqual([...live(state, SCREEN)], [1, 1, 1, 255, 5, 5, 5, 255, 0, 0, 0, 0, 9, 9, 9, 255]);
  assertCanonical(state, SCREEN, "external write");
});

test("a surface blitted onto itself inside a batch reads its pre-blit pixels", () => {
  for (const [batched, keyed] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    const state = createSurfacesSection(8, 1);
    const pixels = new Uint8Array(32);
    for (let i = 0; i < 8; i += 1) pixels.set([10 * (i + 1), 0, 0, 255], i * 4);
    replaceSurface(state, SCREEN, 8, 1, pixels);
    if (batched) beginSurfaceBatch(state);
    // Dirty the surface first so the blit meets a live working buffer, not a decoded cache.
    editSurfaceWithBounds(state, SCREEN, (rgba) => rgba.set([99, 0, 0, 255], 7 * 4), { first: 7, last: 7 });
    // The keyed form takes the per-pixel copy; the plain opaque form takes a row copy.
    equal(blitSurface(state, SCREEN, SCREEN, 1, 0, undefined, undefined, keyed ? { r: 250, g: 250, b: 250 } : undefined), true);
    // Shift right by one: each pixel takes its left neighbour's original value (not a smear of pixel 0).
    deepEqual([...live(state, SCREEN)].filter((_, i) => i % 4 === 0), [10, 10, 20, 30, 40, 50, 60, 70]);
    equal(blitSurface(state, SCREEN, SCREEN, 0, 0, 4, 1), true); // scaled self-blit: 8 columns squeezed into 4
    deepEqual([...live(state, SCREEN)].filter((_, i) => i % 4 === 0).slice(0, 4), [10, 20, 40, 60]);
    if (batched) endSurfaceBatch(state);
    assertCanonical(state, SCREEN, `${batched ? "batched" : "eager"} ${keyed ? "keyed" : "opaque"}`);
  }
});

test("a texture that aliases the destination's live buffer is read from a stable copy", () => {
  const state = createSurfacesSection(6, 1);
  beginSurfaceBatch(state);
  editSurfaceWithBounds(state, SCREEN, (rgba) => { for (let i = 0; i < 6; i += 1) rgba.set([10 * (i + 1), 0, 0, 255], i * 4); }, { first: 0, last: 5 });
  let aliased: Uint8Array | undefined;
  editSurfaceWithBounds(state, SCREEN, (rgba) => { aliased = rgba; }, { first: 0, last: -1 });
  if (aliased === undefined) throw new Error("expected the live buffer");
  equal(blitTexture(state, { w: 6, h: 1, rgba: aliased }, SCREEN, 1, 0), true);
  endSurfaceBatch(state);
  deepEqual([...live(state, SCREEN)].filter((_, i) => i % 4 === 0), [10, 10, 20, 30, 40, 50]);
  assertCanonical(state, SCREEN, "aliased texture");
});

test("public editSurface isolates retained buffers and nested edits inside a batch", () => {
  const state = createSurfacesSection(4, 4);
  beginSurfaceBatch(state);
  let retained: Uint8Array = new Uint8Array();
  editSurface(state, SCREEN, (pixels) => {
    pixels[0] = 11;
    pixels[3] = 255;
    retained = pixels;
  });
  editSurfaceWithBounds(state, SCREEN, (pixels) => { pixels[0] = 22; }, { first: 0, last: 0 });
  equal(retained[0], 11, "the retained buffer must not follow later batch edits");
  retained[0] = 99;
  equal(getPixel(state, SCREEN, 0, 0)?.r, 22, "mutating a retained buffer must not reach the surface");
  editSurface(state, SCREEN, (pixels) => {
    editSurface(state, SCREEN, (inner) => { inner[4] = 33; inner[7] = 255; });
    pixels[8] = 44;
  });
  endSurfaceBatch(state);
  equal(getPixel(state, SCREEN, 0, 0)?.r, 22);
  equal(getPixel(state, SCREEN, 1, 0)?.r, 33);
  equal(getPixel(state, SCREEN, 2, 0)?.r, 44);
  assertCanonical(state, SCREEN, "retained");
});

test("editing an interned colour surface inside a batch still releases its colour entry", () => {
  const state = createSurfacesSection();
  const red = colourSurface(state, { r: 255, g: 0, b: 0 });
  beginSurfaceBatch(state);
  editSurfaceWithBounds(state, red, (rgba) => { rgba[0] = 0; }, { first: 0, last: 0 });
  const replacement = colourSurface(state, { r: 255, g: 0, b: 0 });
  endSurfaceBatch(state);
  equal(replacement === red, false);
  equal(getPixel(state, replacement, 0, 0)?.r, 255);
  assertCanonical(state, red, "edited colour surface");
});
