/**
 * Every landed reader wrapped as an `AssetDecoder` (AD-31), and the registry
 * over them — the core format registry the epic's Description names.
 *
 * One entry per reader family, keyed by its `CoreFormatId`: the main game file
 *(docs/spec/formats/main-file.md#layout), boards(docs/spec/formats/board.md, with docs/spec/formats/board.md#version-dispatch's branch decided here and a pre-vector board
 * converted to the docs/spec/formats/board.md#vector-layout-minor-4-and-later model), tilesets(docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso), animations(docs/spec/formats/animation.md#layout), characters,
 * items and enemies(docs/spec/formats/character.md#layout), special moves, status effects and battle
 * backgrounds(docs/spec/formats/battle-data.md#special-move-spc), the Toolkit 2 single tiles, animated tiles and
 * bitmap fonts(docs/spec/formats/tiles.md#tile-data, docs/spec/formats/tiles.md#animated-tile-tan, docs/spec/formats/legacy/README.md, and images(docs/spec/formats/images.md). The dump reads its data-format rows
 * from `CORE_REGISTRY` and decodes through `CORE_DECODERS`, so the project has
 * one dispatch.
 *
 * The decode context (AD-31's `AssetResolver`) is part of the interface but no
 * landed reader follows a reference while reading, so every decoder here ignores
 * it; a decoder that needs it reads it from the parameter.
 */

import { BinaryReader } from "../binary/reader.ts";
import { decodeTexture } from "../image/index.ts";
import { readTileset } from "../tileset/tileset.ts";
import { readTileAnimation, TILE_ANIMATION_MAGIC, type TileAnimation } from "../tile-animation/index.ts";
import { readSingleTile, SINGLE_TILE_MAGIC, type SingleTile } from "../single-tile/index.ts";
import { readLegacyFont, FONT_MAGIC, type LegacyFont } from "../font/index.ts";
import {
  readTileBitmap,
  TILE_BITMAP_MAGIC,
  TILE_BITMAP_SECTION,
  type TileBitmap,
} from "../tile-bitmap/index.ts";
import { readMainFile, MAIN_MAGIC, type MainFile } from "../main-file/index.ts";
import { readAnimation, ANIMATION_MAGIC, type Animation } from "../animation/index.ts";
import {
  readBattleBackground,
  readSpecialMove,
  readStatusEffect,
  BATTLE_BACKGROUND_MAGIC,
  SPECIAL_MOVE_MAGIC,
  STATUS_EFFECT_MAGIC,
  type BattleBackground,
  type SpecialMove,
  type StatusEffect,
} from "../battle/index.ts";
import {
  readCharacter,
  readEnemy,
  readItem,
  CHARACTER_MAGIC,
  ENEMY_MAGIC,
  ITEM_MAGIC,
  type Character,
  type Enemy,
  type Item,
} from "../actor/index.ts";
import { convertPreVectorBoard } from "../board/pre-vector-convert.ts";
import { readPreVectorBoard } from "../board/pre-vector-reader.ts";
import { readBoard } from "../board/reader.ts";
import { BOARD_DETECT_OFFSET, BOARD_MAGIC } from "../board/model.ts";
import { boardLayout, type DecodedBoard } from "../board/layout.ts";
import type { DecodedTexture } from "../image/model.ts";
import type { Tileset } from "../tileset/tileset.ts";
import type { Result } from "../result.ts";
import type { AssetDecoder } from "./decoder.ts";
import { createAssetRegistry } from "./registry.ts";

/** The PNG signature `89 50 4E 47 0D 0A 1A 0A` (docs/spec/formats/images.md#the-shared-decode-contract). */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** The JPEG SOI marker plus the start of any following segment: `FF D8 FF`(docs/spec/formats/images.md). */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/** The Windows bitmap file-header signature: `BM` (docs/spec/formats/images.md). */
const BMP_SIGNATURE = [0x42, 0x4d] as const;

/** The GIF versions' common prefix: `GIF8` (docs/spec/formats/images.md#gif-header). */
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38] as const;

/** The `i16` version bytes a `.tst` (20) or `.iso` (30) starts with, little-endian(docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso). */
const TILESET_VERSION_BYTES = [0x14, 0x1e] as const;

/** Whether `bytes` begins with `magic`, matched as ASCII byte for byte. */
function startsWithAscii(bytes: Uint8Array, magic: string): boolean {
  if (bytes.length < magic.length) {
    return false;
  }
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

/** Whether `bytes` begins with the byte sequence `signature`. */
function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

/** The magic-header test for a reader whose file starts with an ASCII magic string. */
function magicIs(magic: string): (header: Uint8Array) => boolean {
  return (header) => startsWithAscii(header, magic);
}

/** Read a board of either docs/spec/formats/board.md#version-dispatch branch, converting a docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector pre-vector board(docs/spec/formats/board.md#vector-layout-minor-4-and-later model). */
export function decodeBoard(bytes: Uint8Array): Result<DecodedBoard> {
  if (bytes.length === 0) {
    const read = readBoard(new BinaryReader(bytes));
    return read.ok ? { ok: true, value: { board: read.value, layout: "vector" }, warnings: read.warnings } : read;
  }
  const isBinary = new BinaryReader(bytes).isBinaryAt(BOARD_DETECT_OFFSET);
  if (isBinary.ok && !isBinary.value) {
    const read = readBoard(new BinaryReader(bytes));
    return read.ok ? { ok: true, value: { board: read.value, layout: "pre-vector" }, warnings: read.warnings } : read;
  }
  const header = new BinaryReader(bytes).header();
  if (header.ok && boardLayout(header.value.minor) === "pre-vector") {
    const pre = readPreVectorBoard(new BinaryReader(bytes));
    if (!pre.ok) {
      return pre;
    }
    const converted = convertPreVectorBoard(pre.value);
    if (!converted.ok) {
      return converted;
    }
    return {
      ok: true,
      value: { board: converted.value, layout: "pre-vector" },
      warnings: [...pre.warnings, ...converted.warnings],
    };
  }
  const read = readBoard(new BinaryReader(bytes));
  return read.ok ? { ok: true, value: { board: read.value, layout: "vector" }, warnings: read.warnings } : read;
}

/**
 * Every core decoder, one per id (`CoreFormatId` is its keys).
 *
 * The order is also the magic-header scan order of `CORE_REGISTRY`; the landed
 * magics do not overlap, so the order changes nothing today.
 */
export interface CoreDecoders {
  /** docs/spec/formats/main-file.md#layout — the main game file. */
  gam: AssetDecoder<MainFile>;
  /** docs/spec/formats/board.md — boards; the branch of docs/spec/formats/board.md#version-dispatch is decided inside. */
  board: AssetDecoder<DecodedBoard>;
  /** docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso — tilesets (`.tst` version 20, `.iso` version 30). */
  tileset: AssetDecoder<Tileset>;
  /** docs/spec/formats/tiles.md#tile-bitmap-tbm — tile bitmaps (`.tbm`). */
  "tile-bitmap": AssetDecoder<TileBitmap>;
  /** docs/spec/formats/animation.md#layout — animations. */
  animation: AssetDecoder<Animation>;
  /** docs/spec/formats/character.md#layout — characters. */
  character: AssetDecoder<Character>;
  /** docs/spec/formats/item.md#layout — items. */
  item: AssetDecoder<Item>;
  /** docs/spec/formats/enemy.md#layout — enemies. */
  enemy: AssetDecoder<Enemy>;
  /** docs/spec/formats/battle-data.md#special-move-spc — special moves. */
  "special-move": AssetDecoder<SpecialMove>;
  /** docs/spec/formats/battle-data.md#status-effect-ste — status effects. */
  "status-effect": AssetDecoder<StatusEffect>;
  /** docs/spec/formats/battle-data.md#fight-background-bkg — battle backgrounds. */
  "battle-background": AssetDecoder<BattleBackground>;
  /** docs/spec/formats/tiles.md#tile-data — single tiles (`.gph`, text); a version 1 file has no magic and is claimed by extension. */
  "single-tile": AssetDecoder<SingleTile>;
  /** docs/spec/formats/tiles.md#animated-tile-tan — animated tiles (`.tan`). */
  "tile-animation": AssetDecoder<TileAnimation>;
  /** docs/spec/formats/legacy/README.md — Toolkit 2 bitmap fonts (`.fnt`, text). */
  font: AssetDecoder<LegacyFont>;
  /** docs/spec/formats/images.md — images (`decodeTexture` matches the PNG, JPEG, BMP and GIF signatures). */
  image: AssetDecoder<DecodedTexture>;
}

/** The id of a core decoder: the data formats `dump` parses, one per reader family. */
export type CoreFormatId = keyof CoreDecoders;

export const CORE_DECODERS: CoreDecoders = {
  gam: {
    id: "gam",
    section: "docs/spec/formats/main-file.md#layout",
    extensions: ["gam"],
    detect: (header) => startsWithAscii(header, MAIN_MAGIC) || startsWithAscii(header, "RPGTLKIT mainForm"),
    decode: (bytes) => readMainFile(new BinaryReader(bytes)),
  },
  board: {
    id: "board",
    section: "docs/spec/formats/board.md#vector-layout-minor-4-and-later",
    extensions: ["brd"],
    detect: magicIs(BOARD_MAGIC),
    decode: (bytes) => decodeBoard(bytes),
  },
  tileset: {
    id: "tileset",
    section: "docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso",
    extensions: ["tst", "iso"],
    detect: (header) =>
      header.length >= 2 && header[1] === 0 && TILESET_VERSION_BYTES.some((value) => header[0] === value),
    decode: (bytes) => readTileset(bytes),
  },
  "tile-bitmap": {
    id: "tile-bitmap",
    section: TILE_BITMAP_SECTION,
    extensions: ["tbm"],
    detect: magicIs(TILE_BITMAP_MAGIC),
    decode: (bytes) => readTileBitmap(new BinaryReader(bytes)),
  },
  animation: {
    id: "animation",
    section: "docs/spec/formats/animation.md#layout",
    extensions: ["anm"],
    detect: magicIs(ANIMATION_MAGIC),
    decode: (bytes) => readAnimation(new BinaryReader(bytes)),
  },
  character: {
    id: "character",
    section: "docs/spec/formats/character.md#layout",
    extensions: ["tem"],
    detect: magicIs(CHARACTER_MAGIC),
    decode: (bytes) => readCharacter(new BinaryReader(bytes)),
  },
  item: {
    id: "item",
    section: "docs/spec/formats/item.md#layout",
    extensions: ["itm"],
    detect: magicIs(ITEM_MAGIC),
    decode: (bytes) => readItem(new BinaryReader(bytes)),
  },
  enemy: {
    id: "enemy",
    section: "docs/spec/formats/enemy.md#layout",
    extensions: ["ene"],
    detect: magicIs(ENEMY_MAGIC),
    decode: (bytes) => readEnemy(new BinaryReader(bytes)),
  },
  "special-move": {
    id: "special-move",
    section: "docs/spec/formats/battle-data.md#special-move-spc",
    extensions: ["spc"],
    detect: magicIs(SPECIAL_MOVE_MAGIC),
    decode: (bytes) => readSpecialMove(new BinaryReader(bytes)),
  },
  "status-effect": {
    id: "status-effect",
    section: "docs/spec/formats/battle-data.md#status-effect-ste",
    extensions: ["ste"],
    detect: magicIs(STATUS_EFFECT_MAGIC),
    decode: (bytes) => readStatusEffect(new BinaryReader(bytes)),
  },
  "battle-background": {
    id: "battle-background",
    section: "docs/spec/formats/battle-data.md#fight-background-bkg",
    extensions: ["bkg"],
    detect: magicIs(BATTLE_BACKGROUND_MAGIC),
    decode: (bytes) => readBattleBackground(new BinaryReader(bytes)),
  },
  "single-tile": {
    id: "single-tile",
    section: "docs/spec/formats/tiles.md#single-tile-gph",
    extensions: ["gph"],
    // `RPGTLKIT TILE` is a prefix of the animated tile's `RPGTLKIT TILEANIM`.
    detect: (header) => startsWithAscii(header, SINGLE_TILE_MAGIC) && !startsWithAscii(header, TILE_ANIMATION_MAGIC),
    decode: (bytes) => readSingleTile(bytes),
  },
  "tile-animation": {
    id: "tile-animation",
    section: "docs/spec/formats/tiles.md#animated-tile-tan",
    extensions: ["tan"],
    detect: magicIs(TILE_ANIMATION_MAGIC),
    decode: (bytes) => readTileAnimation(new BinaryReader(bytes)),
  },
  font: {
    id: "font",
    section: "docs/spec/formats/legacy/text-formats.md#font-toolkit-2-text",
    extensions: ["fnt"],
    detect: magicIs(FONT_MAGIC),
    decode: (bytes) => readLegacyFont(bytes),
  },
  image: {
    id: "image",
    section: "docs/spec/formats/images.md#the-shared-decode-contract",
    extensions: ["png", "jpg", "jpeg", "bmp", "gif"],
    detect: (header) =>
      startsWithBytes(header, PNG_SIGNATURE) ||
      startsWithBytes(header, JPEG_SIGNATURE) ||
      startsWithBytes(header, BMP_SIGNATURE) ||
      startsWithBytes(header, GIF_SIGNATURE),
    decode: (bytes) => decodeTexture(bytes),
  },
};

/** The core format registry: the landed decoders, ready to dispatch (AD-31). */
export const CORE_REGISTRY = createAssetRegistry(Object.values(CORE_DECODERS));
