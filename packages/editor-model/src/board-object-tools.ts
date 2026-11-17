import {
  coordLayout,
  tileToPixel,
  type BoardImage,
  type BoardPoint,
  type BoardProgram,
  type BoardSprite,
  type BoardVector,
} from "@tk-reawakened/core";
import type { BoardObjectKind } from "./board-objects.ts";
import { layoutOf, type BoardShape, type Cell, type Pixel } from "./board-geometry.ts";
export type { BoardShape, Cell, Pixel } from "./board-geometry.ts";

export type BoardObject = BoardVector | BoardProgram | BoardSprite | BoardImage;

export interface ObjectRecordByKind {
  readonly vectors: BoardVector;
  readonly programs: BoardProgram;
  readonly sprites: BoardSprite;
  readonly images: BoardImage;
}

export function tileBasePoint(shape: BoardShape, cell: Cell): Pixel {
  if (layoutOf(shape) === "2d") return { x: cell.x * 32 + 16, y: cell.y * 32 + 31 };
  return tileToPixel(coordLayout(shape.coordType), shape.sizeX, cell.x + 1, cell.y + 1);
}

function snapGridScalar(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function snapIso(pixel: Pixel): Pixel {
  const middle = Math.round(pixel.y / 16);
  let best = { x: 0, y: 0 };
  let distance = Infinity;
  // Adjacent vertex rows alternate by half a diamond. Rounding only the nearest row misses nearer diagonal vertices.
  for (let row = middle - 1; row <= middle + 1; row += 1) {
    const offset = row % 2 === 0 ? 0 : 32;
    const column = (pixel.x - offset) / 64;
    const lower = Math.floor(column);
    const x = (column - lower <= 0.5 ? lower : lower + 1) * 64 + offset;
    const y = row * 16;
    const dx = x - pixel.x, dy = y - pixel.y;
    const squared = dx * dx + dy * dy;
    if (squared < distance) { distance = squared; best = { x, y }; }
  }
  return best;
}

export function snapObjectPoint(
  shape: BoardShape,
  pixel: Pixel,
  ctrl = false,
  from?: Pixel,
  shift = false,
): Pixel {
  const layout = layoutOf(shape);
  const shouldSnap = Boolean(shape.coordType & 4) ? ctrl : !ctrl;
  let point = shouldSnap
    ? layout === "2d"
      ? { x: snapGridScalar(pixel.x, 32), y: snapGridScalar(pixel.y, 32) }
      : snapIso(pixel)
    : { x: Math.round(pixel.x), y: Math.round(pixel.y) };

  if (shift && from !== undefined) {
    const directions = layout === "2d"
      ? [[1, 0, 32], [0, 1, 32], [1, 1, 32], [1, -1, 32]] as const
      : [[2, 1, 16], [2, -1, 16], [1, 0, 64], [0, 1, 32]] as const;
    let distance = Infinity;
    const dx = point.x - from.x, dy = point.y - from.y;
    const target = point;
    for (const [x, y, gridStep] of directions) {
      const step = shouldSnap ? gridStep : 1;
      const length = Math.round(((dx * x + dy * y) / (x * x + y * y)) / step) * step;
      const next = { x: from.x + length * x, y: from.y + length * y };
      const ex = next.x - target.x, ey = next.y - target.y;
      const squared = ex * ex + ey * ey;
      if (squared < distance) { distance = squared; point = next; }
    }
  }
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export function rectangleObjectPoints(shape: BoardShape, from: Pixel, to: Pixel): BoardPoint[] {
  if (layoutOf(shape) === "2d") {
    return [
      { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) },
      { x: Math.max(from.x, to.x), y: Math.min(from.y, to.y) },
      { x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) },
      { x: Math.min(from.x, to.x), y: Math.max(from.y, to.y) },
    ];
  }
  const a = { u: (from.x / 32 + from.y / 16) / 2, v: (from.x / 32 - from.y / 16) / 2 };
  const b = { u: (to.x / 32 + to.y / 16) / 2, v: (to.x / 32 - to.y / 16) / 2 };
  const u0 = Math.min(a.u, b.u), u1 = Math.max(a.u, b.u);
  const v0 = Math.min(a.v, b.v), v1 = Math.max(a.v, b.v);
  const point = (u: number, v: number): BoardPoint => ({ x: Math.round((u + v) * 32), y: Math.round((u - v) * 16) });
  return [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)];
}

export function objectPoints(object: BoardObject): readonly BoardPoint[] {
  if ("points" in object) return object.points;
  if ("itemFile" in object) return [{ x: object.x, y: object.y }];
  return [{ x: object.left, y: object.top }];
}

export function translatedObject<T extends BoardObject>(object: T, delta: Pixel, indices: readonly number[]): T {
  if ("points" in object) {
    const selected = indices.length === 0 ? null : new Set(indices);
    return {
      ...object,
      points: object.points.map((point, index) => selected === null || selected.has(index)
        ? { x: point.x + delta.x, y: point.y + delta.y }
        : point),
    } as T;
  }
  if ("itemFile" in object) return { ...object, x: object.x + delta.x, y: object.y + delta.y } as T;
  return { ...object, left: object.left + delta.x, top: object.top + delta.y } as T;
}

export function nearestObjectPoint(points: readonly BoardPoint[], pixel: Pixel, tolerance: number): number | null {
  let bestIndex: number | null = null;
  let bestDistance = tolerance;
  for (let index = 0; index < points.length; index += 1) {
    const dx = points[index]!.x - pixel.x;
    const dy = points[index]!.y - pixel.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function nearestObjectSegment(
  points: readonly BoardPoint[],
  closed: boolean,
  pixel: Pixel,
): { readonly index: number; readonly point: Pixel; readonly distance: number } | null {
  const count = closed ? points.length : points.length - 1;
  let best: { readonly index: number; readonly point: Pixel; readonly distance: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((pixel.x - start.x) * dx + (pixel.y - start.y) * dy) / lengthSquared));
    const point = { x: start.x + t * dx, y: start.y + t * dy };
    const distance = Math.hypot(pixel.x - point.x, pixel.y - point.y);
    if (best === null || distance < best.distance) best = { index, point, distance };
  }
  return best;
}

function insidePolygon(points: readonly BoardPoint[], pixel: Pixel): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]!;
    const b = points[j]!;
    if ((a.y > pixel.y) !== (b.y > pixel.y) && pixel.x < (b.x - a.x) * (pixel.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function objectHitDistance(
  object: BoardObject,
  pixel: Pixel,
  bounds?: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
): number {
  if ("points" in object) {
    if (object.closed !== 0 && object.points.length >= 3 && insidePolygon(object.points, pixel)) return 0;
    return nearestObjectSegment(object.points, object.closed !== 0, pixel)?.distance ?? Infinity;
  }
  const sprite = "itemFile" in object;
  const rect = bounds ?? (sprite
    ? { left: object.x - 16, top: object.y - 32, width: 32, height: 32 }
    : { left: object.left, top: object.top, width: 32, height: 32 });
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const dx = Math.max(rect.left - pixel.x, 0, pixel.x - right);
  const dy = Math.max(rect.top - pixel.y, 0, pixel.y - bottom);
  if (dx === 0 && dy === 0) return 0;
  return nearestObjectSegment(
    [{ x: rect.left, y: rect.top }, { x: right, y: rect.top }, { x: right, y: bottom }, { x: rect.left, y: bottom }],
    true,
    pixel,
  )?.distance ?? Infinity;
}

export function defaultBoardObject<K extends BoardObjectKind>(
  kind: K,
  layer: number,
  at: Pixel,
  points: readonly BoardPoint[],
  closed = -1,
): ObjectRecordByKind[K] {
  const copy = points.map(({ x, y }) => ({ x, y }));
  switch (kind) {
    case "vectors":
      return { points: copy, attributes: 0, closed, layer, type: 1, handle: "" } as unknown as ObjectRecordByKind[K];
    case "programs":
      return {
        program: "", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
        activate: 0, activationType: 0, repeatDistance: 0, layer, points: copy, closed, handle: "",
      } as unknown as ObjectRecordByKind[K];
    case "sprites":
      return {
        itemFile: "", activationPrg: "", multitaskPrg: "", initialVar: "", initialValue: "", finalVar: "",
        finalValue: "", loadingVar: "", loadingValue: "", activate: 0, activationType: 0,
        x: at.x, y: at.y, layer, reserved: -1,
      } as unknown as ObjectRecordByKind[K];
    case "images":
      return {
        file: "", left: at.x, top: at.y, layer, drawType: 0,
        transparent: { r: 255, g: 0, b: 255 }, reserved: 100,
      } as unknown as ObjectRecordByKind[K];
  }
}
