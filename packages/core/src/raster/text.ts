/**
 * Text ink: which destination pixels an AD-3 `text` command covers and how much (AD-15, AD-3's `FontRef`).
 *
 * A glyph's *pixels* are a decision the core owns — the legacy 8×8 cell scaled to the requested size (with the
 * reference's forward cell mapping, its italic shear and its bold +1-pixel second ink), and the TrueType outline's
 * nonzero-winding coverage — so the reference rasteriser and every replayer must draw the same set. This module
 * answers that question once, and `raster.ts` and `render-webgl2` both consume the answer instead of each scaling a
 * font their own way.
 *
 * A replayer draws one one-pixel quad per entry: coverage `255` writes the command's colour, any other coverage is the
 * reference's integer coverage blend, which D-7 allows a GPU to round by one unit per channel.
 */

import type { LegacyFont } from "../formats/font/model.ts";
import { readTrueTypeFont, trueTypeFontMetrics, type TrueTypeFont } from "../formats/font/truetype.ts";
import type { TextCommand } from "../ports/draw.ts";
import type { AssetKey } from "../ports/keys.ts";
import { assetKey } from "../formats/resolver/resolver.ts";
import { getGlyphRaster } from "./glyph.ts";

/**
 * The bitmap font a text command draws in when the game ships no font of the family it names
 * (`Comic Sans MS` on a machine that no longer has it). The engine substitutes it before rasterising, so a runner must
 * apply the same rule or the same draw list presents differently.
 */
export const DEFAULT_FONT_ASSET: AssetKey = assetKey("media/fonts/tkr-8x8.fnt");

/** One covered destination pixel: absolute logical coordinates and a 0–255 coverage. */
export type TextInk = { readonly x: number; readonly y: number; readonly coverage: number };

/** What `textInk` needs of the asset map: any decoded asset, or TrueType bytes; it narrows to what it can draw. */
export type TextAsset = LegacyFont | TrueTypeFont | Uint8Array | object | undefined;

export function isTrueType(asset: TextAsset): asset is TrueTypeFont {
  return asset !== undefined && "charToGlyph" in asset;
}

function isLegacyFont(asset: TextAsset): asset is LegacyFont {
  return asset !== undefined && "values" in asset && asset.values.length >= 256 * 8;
}

/** The rounded size the reference uses, never below 1. */
export function textSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? Math.max(1, Math.floor(size + 0.5)) : 8;
}

/**
 * Every covered destination pixel of `command`, or `null` when the asset is not a font this page can draw. The order is
 * the drawing order: glyph by glyph, top row first, so a later ink of the same pixel wins, exactly as plotting does.
 */
export function textInk(command: TextCommand, asset: TextAsset): readonly TextInk[] | null {
  let resolved = asset;
  if (resolved instanceof Uint8Array) {
    const parsed = readTrueTypeFont(resolved);
    if (parsed.ok) resolved = parsed.value;
  }
  if (isTrueType(resolved)) return trueTypeInk(command, resolved);
  if (isLegacyFont(resolved)) return legacyInk(command, resolved);
  return null;
}

function trueTypeInk(command: TextCommand, font: TrueTypeFont): readonly TextInk[] {
  const size = textSize(command.font.size);
  const metrics = trueTypeFontMetrics(font, size);
  let cursorX = Math.trunc(command.x);
  let cursorY = Math.trunc(command.y);
  let glyphIndex = 0;
  const ink: TextInk[] = [];

  for (const character of Array.from(command.text)) {
    if (character === "\n") {
      cursorX = Math.trunc(command.x);
      cursorY += metrics.lineHeight;
      continue;
    }
    const glyphInfo = command.advances[glyphIndex];
    glyphIndex += 1;
    const glyph = glyphInfo !== undefined ? font.glyphById(glyphInfo.glyph) : font.charToGlyph(character);
    const advance = glyphInfo !== undefined
      ? glyphInfo.advance
      : Math.floor(glyph.advance * size / font.unitsPerEm + 0.5) + (command.font.bold ? 1 : 0);

    const raster = getGlyphRaster(font, glyph, size, command.font.bold, command.font.italic);
    if (raster.width > 0 && raster.height > 0) {
      const baselineY = cursorY + metrics.ascent;
      const startX = cursorX + raster.offsetX;
      const startY = baselineY + raster.offsetY;
      for (let gy = 0; gy < raster.height; gy += 1) {
        for (let gx = 0; gx < raster.width; gx += 1) {
          const coverage = raster.coverage[gy * raster.width + gx] ?? 0;
          if (coverage === 0) continue;
          ink.push({ x: startX + gx, y: startY + gy, coverage });
        }
      }
    }
    cursorX += Math.max(0, Math.trunc(advance));
  }
  return ink;
}

function legacyInk(command: TextCommand, font: LegacyFont): readonly TextInk[] {
  const size = textSize(command.font.size);
  let cursorX = Math.trunc(command.x);
  let cursorY = Math.trunc(command.y);
  let glyphIndex = 0;
  const ink: TextInk[] = [];

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
      const row = font.values[glyphCode * 8 + sourceY] ?? 0;
      const destinationY = cursorY + Math.floor(sourceY * size / 8);
      const nextY = cursorY + Math.floor((sourceY + 1) * size / 8);
      for (let sourceX = 0; sourceX < 8; sourceX += 1) {
        if ((row & (1 << (7 - sourceX))) === 0) continue;
        const destinationX = cursorX + Math.floor(sourceX * size / 8);
        const nextX = cursorX + Math.floor((sourceX + 1) * size / 8);
        const italicOffset = command.font.italic ? Math.floor((7 - sourceY) * size / 32) : 0;
        for (let y = destinationY; y < Math.max(destinationY + 1, nextY); y += 1) {
          for (let x = destinationX + italicOffset; x < Math.max(destinationX + 1, nextX) + italicOffset; x += 1) {
            ink.push({ x, y, coverage: 255 });
            if (command.font.bold) ink.push({ x: x + 1, y, coverage: 255 });
          }
        }
      }
    }
    cursorX += Math.max(1, Math.trunc(advance));
  }
  return ink;
}

/** The keys `textInk` reads, so a host can prefetch exactly the fonts a draw list names. */
export function textFontKeys(commands: readonly { kind: string; font?: { asset: AssetKey } }[]): readonly AssetKey[] {
  const keys = new Set<AssetKey>();
  for (const command of commands) if (command.kind === "text" && command.font !== undefined) keys.add(command.font.asset);
  return [...keys];
}
