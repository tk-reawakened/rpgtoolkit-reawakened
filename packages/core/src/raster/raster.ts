import type { DecodedTexture } from "../formats/image/model.ts";
import type { LegacyFont } from "../formats/font/model.ts";
import { readTrueTypeFont, trueTypeFontMetrics, type TrueTypeFont } from "../formats/font/truetype.ts";
import { getGlyphRaster } from "./glyph.ts";
import { tintChannel } from "./tint.ts";
import type {
  BlitCommand,
  DrawCommand,
  DrawList,
  EllipseCommand,
  Rgb,
  Rect,
  TextCommand,
} from "../ports/draw.ts";
import type { AssetKey, ScratchId, SurfaceId } from "../ports/keys.ts";

export type RasterAsset = DecodedTexture | LegacyFont | TrueTypeFont | Uint8Array;
export type RasterAssets = ReadonlyMap<AssetKey, RasterAsset>;
export type RasterSurfaces = ReadonlyMap<SurfaceId, DecodedTexture>;
export type RasterResult = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly error: string | null;
};

type Target = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };
type TargetEntry = Target & { readonly scratch: ScratchId | null };

const clampByte = (value: number): number =>
  Math.max(0, Math.min(255, value));

function validRect(rect: Rect): boolean {
  return Number.isInteger(rect.x) && Number.isInteger(rect.y) &&
    Number.isInteger(rect.w) && Number.isInteger(rect.h) &&
    rect.w >= 0 && rect.h >= 0;
}
function isTexture(asset: RasterAsset | undefined): asset is DecodedTexture {
  return asset !== undefined && "rgba" in asset && "w" in asset && "h" in asset;
}

function isFont(asset: RasterAsset | undefined): asset is LegacyFont {
  return asset !== undefined && "values" in asset && asset.values.length >= 256 * 8;
}

function isTrueTypeFont(asset: RasterAsset | undefined): asset is TrueTypeFont {
  return asset !== undefined && typeof asset === "object" && "kind" in asset && asset.kind === "truetype";
}

function sourceTexture(
  command: BlitCommand,
  assets: RasterAssets,
  surfaces: RasterSurfaces,
): DecodedTexture | null {
  if ("asset" in command.source) {
    const asset = assets.get(command.source.asset);
    return isTexture(asset) ? asset : null;
  }
  return surfaces.get(command.source.surface) ?? null;
}

function drawPixel(target: TargetEntry, x: number, y: number, rgb: Rgb): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const at = (y * target.width + x) * 4;
  target.rgba[at] = clampByte(rgb.r);
  target.rgba[at + 1] = clampByte(rgb.g);
  target.rgba[at + 2] = clampByte(rgb.b);
  target.rgba[at + 3] = 255;
}

function drawLine(target: TargetEntry, x1: number, y1: number, x2: number, y2: number, rgb: Rgb): void {
  let x = x1;
  let y = y1;
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    drawPixel(target, x, y, rgb);
    if (x === x2 && y === y2) return;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

function drawRect(target: TargetEntry, rect: Rect, rgb: Rgb, filled: boolean): void {
  if (rect.w <= 0 || rect.h <= 0) return;
  if (filled) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) drawPixel(target, x, y, rgb);
    }
    return;
  }
  drawLine(target, rect.x, rect.y, rect.x + rect.w - 1, rect.y, rgb);
  drawLine(target, rect.x, rect.y + rect.h - 1, rect.x + rect.w - 1, rect.y + rect.h - 1, rgb);
  if (rect.h > 2) {
    drawLine(target, rect.x, rect.y + 1, rect.x, rect.y + rect.h - 2, rgb);
    drawLine(target, rect.x + rect.w - 1, rect.y + 1, rect.x + rect.w - 1, rect.y + rect.h - 2, rgb);
  }
}

/**
 * Plot a midpoint ellipse over the inclusive integer box. This is the
 * all-integer algorithm specified by E-17; collecting row extrema lets the
 * filled variant use exactly the same generated boundary.
 */
function drawEllipse(target: TargetEntry, command: EllipseCommand): void {
  const { rect, rgb, filled } = command;
  if (rect.w <= 0 || rect.h <= 0) return;
  if (rect.w === 1) {
    drawLine(target, rect.x, rect.y, rect.x, rect.y + rect.h - 1, rgb);
    return;
  }
  if (rect.h === 1) {
    drawLine(target, rect.x, rect.y, rect.x + rect.w - 1, rect.y, rgb);
    return;
  }
  const points: Array<[number, number]> = [];
  const xMin = rect.x;
  const xMax = rect.x + rect.w - 1;
  const yMin = rect.y;
  const yMax = rect.y + rect.h - 1;
  let x0 = xMin;
  let y0 = yMin;
  let x1 = xMax;
  let y1 = yMax;
  let a = Math.abs(x1 - x0);
  let b = Math.abs(y1 - y0);
  const b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  if (x0 > x1) { const swap = x0; x0 = x1; x1 = swap; }
  if (y0 > y1) y0 = y1;
  y0 += Math.floor((b + 1) / 2);
  y1 = y0 - b1;
  a *= 8 * a;
  const bb = 8 * b * b;
  do {
    points.push([x1, y0], [x0, y0], [x0, y1], [x1, y1]);
    const e2 = 2 * err;
    if (e2 <= dy) { y0 += 1; y1 -= 1; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0 += 1; x1 -= 1; err += dx += bb; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    points.push([x0 - 1, y0], [x1 + 1, y0], [x0 - 1, y1], [x1 + 1, y1]);
    y0 += 1;
    y1 -= 1;
  }
  if (!filled) {
    for (const [x, y] of points) drawPixel(target, x, y, rgb);
    return;
  }
  const rows = new Map<number, [number, number]>();
  for (const [x, y] of points) {
    const row = rows.get(y);
    if (!row) rows.set(y, [x, x]);
    else { row[0] = Math.min(row[0], x); row[1] = Math.max(row[1], x); }
  }
  for (const [y, [left, right]] of rows) {
    for (let x = left; x <= right; x += 1) drawPixel(target, x, y, rgb);
  }
}

/** A tileset texture is a strip of tiles 32 pixels apart, or 64 for the diamonds of an `.iso` tileset. */
function sourceOffset(command: BlitCommand): number {
  if (!("asset" in command.source) || command.source.tile === null) return 0;
  return (command.source.tile - 1) * (command.source.asset.endsWith(".iso") ? 64 : 32);
}

function isoSource(command: BlitCommand, x: number, y: number): [number, number] | null {
  const k = y <= 15 ? y : 31 - y;
  if (x < 31 - 2 * k || x > 32 + 2 * k) return null;
  // Inverse of the fixed 32x32 -> 64x32 affine map, with integer half-up rounding.
  // round_half_up(n, 2) is floor((n + 1) / 2), including for negative n.
  const sx = Math.floor((x - 32 + 2 * y + 1) / 2);
  const sy = Math.floor((32 - x + 2 * y + 1) / 2);
  return [Math.max(0, Math.min(31, sx)), Math.max(0, Math.min(31, sy))];
}

function blend(
  target: TargetEntry,
  at: number,
  source: [number, number, number, number],
  command: BlitCommand,
): void {
  const [sr, sg, sb, sa] = source;
  const tint = command.tint;
  const tinted = tint.r !== 0 || tint.g !== 0 || tint.b !== 0;
  const r = tintChannel(sr, tint.r, tinted);
  const g = tintChannel(sg, tint.g, tinted);
  const b = tintChannel(sb, tint.b, tinted);
  const alpha = Math.max(0, Math.min(255, command.alpha));
  if (command.blend === "normal") {
    target.rgba[at] = r;
    target.rgba[at + 1] = g;
    target.rgba[at + 2] = b;
    target.rgba[at + 3] = sa;
    return;
  }
  const dr = target.rgba[at] ?? 0;
  const dg = target.rgba[at + 1] ?? 0;
  const db = target.rgba[at + 2] ?? 0;
  if (command.blend === "translucent") {
    target.rgba[at] = Math.floor((dr * (255 - alpha) + r * alpha + 127) / 255);
    target.rgba[at + 1] = Math.floor((dg * (255 - alpha) + g * alpha + 127) / 255);
    target.rgba[at + 2] = Math.floor((db * (255 - alpha) + b * alpha + 127) / 255);
  } else {
    target.rgba[at] = Math.min(255, dr + Math.floor((r * alpha + 127) / 255));
    target.rgba[at + 1] = Math.min(255, dg + Math.floor((g * alpha + 127) / 255));
    target.rgba[at + 2] = Math.min(255, db + Math.floor((b * alpha + 127) / 255));
  }
  target.rgba[at + 3] = 255;
}

function drawBlit(
  target: TargetEntry,
  command: BlitCommand,
  assets: RasterAssets,
  surfaces: RasterSurfaces,
): string | null {
  const texture = sourceTexture(command, assets, surfaces);
  if (!texture) return "missing decoded texture or surface";
  if (!validRect(command.src) || !validRect(command.dst) || command.dst.w <= 0 || command.dst.h <= 0) {
    return "invalid blit rectangle";
  }
  const tileOffset = sourceOffset(command);
  for (let y = 0; y < command.dst.h; y += 1) {
    for (let x = 0; x < command.dst.w; x += 1) {
      const iso = command.iso2d ? isoSource(command, x, y) : null;
      if (command.iso2d && !iso) continue;
      const sourceX = iso
        ? command.src.x + Math.floor(iso[0] * command.src.w / 32)
        : command.src.x + Math.floor(x * command.src.w / command.dst.w);
      const sourceY = iso
        ? command.src.y + Math.floor(iso[1] * command.src.h / 32)
        : command.src.y + Math.floor(y * command.src.h / command.dst.h);
      const tx = tileOffset + sourceX;
      if (tx < 0 || sourceY < 0 || tx >= texture.w || sourceY >= texture.h) {
        return "blit source rectangle is outside its decoded texture";
      }
      const si = (sourceY * texture.w + tx) * 4;
      const sr = texture.rgba[si] ?? 0;
      const sg = texture.rgba[si + 1] ?? 0;
      const sb = texture.rgba[si + 2] ?? 0;
      const sa = texture.rgba[si + 3] ?? 0;
      if (sa === 0 || (command.key !== null && sr === command.key.r && sg === command.key.g && sb === command.key.b)) continue;
      const dx = command.dst.x + x;
      const dy = command.dst.y + y;
      if (dx < 0 || dy < 0 || dx >= target.width || dy >= target.height) continue;
      blend(target, (dy * target.width + dx) * 4, [sr, sg, sb, sa], command);
    }
  }
  return null;
}

function drawText(
  target: TargetEntry,
  command: TextCommand,
  assets: RasterAssets,
): string | null {
  let asset = assets.get(command.font.asset);
  if (asset instanceof Uint8Array) {
    const parsed = readTrueTypeFont(asset);
    if (parsed.ok) asset = parsed.value;
  }

  if (isTrueTypeFont(asset)) {
    const size = Number.isFinite(command.font.size) && command.font.size > 0
      ? Math.max(1, Math.floor(command.font.size + 0.5))
      : 8;
    const metrics = trueTypeFontMetrics(asset, size);
    let cursorX = Math.trunc(command.x);
    let cursorY = Math.trunc(command.y);
    let glyphIndex = 0;

    for (const character of Array.from(command.text)) {
      if (character === "\n") {
        cursorX = Math.trunc(command.x);
        cursorY += metrics.lineHeight;
        continue;
      }
      const glyphInfo = command.advances[glyphIndex];
      glyphIndex += 1;
      const glyph = glyphInfo !== undefined
        ? asset.glyphById(glyphInfo.glyph)
        : asset.charToGlyph(character);
      const advance = glyphInfo !== undefined
        ? glyphInfo.advance
        : (Math.floor(glyph.advance * size / asset.unitsPerEm + 0.5) + (command.font.bold ? 1 : 0));

      const raster = getGlyphRaster(asset, glyph, size, command.font.bold, command.font.italic);
      if (raster.width > 0 && raster.height > 0) {
        const baselineY = cursorY + metrics.ascent;
        const startX = cursorX + raster.offsetX;
        const startY = baselineY + raster.offsetY;

        for (let gy = 0; gy < raster.height; gy += 1) {
          const dy = startY + gy;
          if (dy < 0 || dy >= target.height) continue;
          for (let gx = 0; gx < raster.width; gx += 1) {
            const dx = startX + gx;
            if (dx < 0 || dx >= target.width) continue;
            const cov = raster.coverage[gy * raster.width + gx]!;
            if (cov === 0) continue;
            const at = (dy * target.width + dx) * 4;

            if (cov === 255) {
              target.rgba[at] = clampByte(command.rgb.r);
              target.rgba[at + 1] = clampByte(command.rgb.g);
              target.rgba[at + 2] = clampByte(command.rgb.b);
              target.rgba[at + 3] = 255;
            } else {
              const dr = target.rgba[at]!;
              const dg = target.rgba[at + 1]!;
              const db = target.rgba[at + 2]!;
              const da = target.rgba[at + 3]!;
              target.rgba[at] = Math.floor((dr * (255 - cov) + command.rgb.r * cov + 127) / 255);
              target.rgba[at + 1] = Math.floor((dg * (255 - cov) + command.rgb.g * cov + 127) / 255);
              target.rgba[at + 2] = Math.floor((db * (255 - cov) + command.rgb.b * cov + 127) / 255);
              target.rgba[at + 3] = Math.min(255, da + Math.floor((cov * (255 - da) + 127) / 255));
            }
          }
        }
      }

      cursorX += Math.max(0, Math.trunc(advance));
    }
    return null;
  }

  if (!isFont(asset)) return "missing bitmap font asset";
  const size = Number.isFinite(command.font.size) && command.font.size > 0
    ? Math.max(1, Math.floor(command.font.size + 0.5))
    : 8;
  let cursorX = Math.trunc(command.x);
  let cursorY = Math.trunc(command.y);
  let glyphIndex = 0;
  for (const character of Array.from(command.text)) {
    if (character === "\n") {
      cursorX = Math.trunc(command.x);
      cursorY += 16;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0xfffd;
    const advance = command.advances[glyphIndex]?.advance ?? (size + (command.font.bold ? 1 : 0));
    const glyph = command.advances[glyphIndex]?.glyph ?? (codePoint <= 0xff ? codePoint : 0xff);
    glyphIndex += 1;
    const glyphCode = Math.max(0, Math.min(255, Math.trunc(glyph)));
    for (let sourceY = 0; sourceY < 8; sourceY += 1) {
      const row = asset.values[glyphCode * 8 + sourceY] ?? 0;
      const destinationY = cursorY + Math.floor(sourceY * size / 8);
      const nextY = cursorY + Math.floor((sourceY + 1) * size / 8);
      for (let sourceX = 0; sourceX < 8; sourceX += 1) {
        if ((row & (1 << (7 - sourceX))) === 0) continue;
        const destinationX = cursorX + Math.floor(sourceX * size / 8);
        const nextX = cursorX + Math.floor((sourceX + 1) * size / 8);
        const italicOffset = command.font.italic ? Math.floor((7 - sourceY) * size / 32) : 0;
        for (let y = destinationY; y < Math.max(destinationY + 1, nextY); y += 1) {
          for (let x = destinationX + italicOffset; x < Math.max(destinationX + 1, nextX) + italicOffset; x += 1) {
            drawPixel(target, x, y, command.rgb);
            if (command.font.bold) drawPixel(target, x + 1, y, command.rgb);
          }
        }
      }
    }
    cursorX += Math.max(1, Math.trunc(advance));
  }
  return null;
}

function result(root: TargetEntry, error: string | null): RasterResult {
  return { width: root.width, height: root.height, rgba: root.rgba, error };
}

/** Replay the AD-3 draw list into a fresh straight-RGBA target (AD-4). */
export function rasterize(
  list: DrawList,
  assets: RasterAssets,
  surfaces: RasterSurfaces = new Map(),
): RasterResult {
  if (!Number.isInteger(list.width) || !Number.isInteger(list.height) || list.width <= 0 || list.height <= 0) {
    return { width: list.width, height: list.height, rgba: new Uint8Array(), error: "invalid draw-list dimensions" };
  }
  const root: TargetEntry = {
    width: list.width,
    height: list.height,
    rgba: new Uint8Array(list.width * list.height * 4),
    scratch: null,
  };
  const targets: TargetEntry[] = [root];
  const scratchTargets = new Map<ScratchId, TargetEntry>();
  for (const command of list.commands) {
    let error: string | null = null;
    switch (command.kind) {
      case "fill":
        for (let y = 0; y < targets[targets.length - 1]!.height; y += 1) {
          for (let x = 0; x < targets[targets.length - 1]!.width; x += 1) drawPixel(targets[targets.length - 1]!, x, y, command.rgb);
        }
        break;
      case "blit":
        error = drawBlit(targets[targets.length - 1]!, command, assets, surfaces);
        break;
      case "line":
        drawLine(targets[targets.length - 1]!, command.x1, command.y1, command.x2, command.y2, command.rgb);
        break;
      case "rect":
        if (!validRect(command.rect)) error = "invalid rectangle";
        else drawRect(targets[targets.length - 1]!, command.rect, command.rgb, command.filled);
        break;
      case "ellipse":
        if (!validRect(command.rect)) error = "invalid ellipse rectangle";
        else drawEllipse(targets[targets.length - 1]!, command);
        break;
      case "pushTarget": {
        const prior = scratchTargets.get(command.scratch);
        const scratch = prior ?? {
          width: list.width,
          height: list.height,
          rgba: new Uint8Array(list.width * list.height * 4),
          scratch: command.scratch,
        };
        scratch.rgba.fill(0);
        scratchTargets.set(command.scratch, scratch);
        targets.push(scratch);
        break;
      }
      case "popTarget":
        if (targets.length === 1) error = "popTarget without pushTarget";
        else targets.pop();
        break;
      case "text":
        error = drawText(targets[targets.length - 1]!, command, assets);
        break;
      default: {
        const exhaustive: never = command;
        error = `unsupported draw command: ${String(exhaustive)}`;
      }
    }
    if (error) return result(root, error);
  }
  if (targets.length !== 1) return result(root, "unclosed pushTarget");
  return result(root, null);
}
