/**
 * The actor models and their constants (docs/spec/formats/character.md#layout,
 * docs/spec/formats/item.md#layout, docs/spec/formats/enemy.md#layout) plus the few reader/writer helpers all
 * three formats share.
 *
 * Players (`.tem`) and items (`.itm`) share a graphics model — directional
 * movement and idle animations, battle stances, custom stances and the two
 * sprite-local polygons (docs/spec/formats/character.md#layout,
 * docs/spec/formats/item.md#layout). Enemies (`.ene`) are their own, simpler shape.
 * Everything here is plain data (G2): the readers and writers consume a
 * caller-supplied `Uint8Array` and never touch a host.
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { checkI8, checkI32, checkListBound } from "../validate.ts";

// --- Character (`.tem`) ----------------------------------------------------

/** The magic every binary character starts with (docs/spec/formats/character.md#layout, docs/spec/formats/README.md#header-and-version). */
export const CHARACTER_MAGIC = "RPGTLKIT CHAR";

/** The byte the character layout uses to tell a 2.x text character from a binary one (docs/spec/formats/character.md#layout). */
export const CHARACTER_DETECT_OFFSET = 13;

/** The lowest minor the conditional rows describe (docs/spec/formats/character.md#layout). */
export const CHARACTER_MIN_MINOR = 0;

/** The newest minor the character layout describes; higher values are unsupported (docs/spec/formats/character.md#layout, docs/spec/formats/README.md#header-and-version). */
export const CHARACTER_MAX_MINOR = 8;

/** The section the character reader and writer implement (G7, docs/spec/formats/character.md#layout). */
export const CHARACTER_SECTION = "docs/spec/formats/character.md#layout";

// --- Item (`.itm`) ---------------------------------------------------------

/** The magic every binary item starts with (docs/spec/formats/item.md#layout, docs/spec/formats/README.md#header-and-version). */
export const ITEM_MAGIC = "RPGTLKIT ITEM";

/** The byte the item layout requires to be 0 to tell a text item from a binary one (docs/spec/formats/item.md#layout). */
export const ITEM_DETECT_OFFSET = 13;

/** The lowest minor the conditional rows describe (docs/spec/formats/item.md#layout). */
export const ITEM_MIN_MINOR = 0;

/** The newest minor the item layout describes; higher values are unsupported (docs/spec/formats/item.md#layout, docs/spec/formats/README.md#header-and-version). */
export const ITEM_MAX_MINOR = 7;

/** The section the item reader and writer implement (G7, docs/spec/formats/item.md#layout). */
export const ITEM_SECTION = "docs/spec/formats/item.md#layout";

/** The first item minor whose `i16` price/bonus fields widen to `i32` (docs/spec/formats/item.md#layout). */
export const ITEM_I32_MINOR = 3;

/** The first item minor that stores movement animations and custom stances (docs/spec/formats/item.md#layout). */
export const ITEM_MOVEMENT_MINOR = 4;

/** The first item minor that stores idle animations and speed/idleTime (docs/spec/formats/item.md#layout). */
export const ITEM_IDLE_MINOR = 5;

/** The first item minor that stores the two vector bases (docs/spec/formats/item.md#layout). */
export const ITEM_BASES_MINOR = 7;

// --- Enemy (`.ene`) --------------------------------------------------------

/** The magic every binary enemy starts with (docs/spec/formats/enemy.md#layout, docs/spec/formats/README.md#header-and-version). */
export const ENEMY_MAGIC = "RPGTLKIT ENEMY";

/** The byte the enemy layout uses to tell a 2.0 text enemy from a binary one (docs/spec/formats/enemy.md#layout). */
export const ENEMY_DETECT_OFFSET = 14;

/** The only binary enemy minor (2.1); minor 0 is the 2.0 text form (docs/spec/formats/enemy.md#layout). */
export const ENEMY_BINARY_MINOR = 1;

/** The major every enemy carries (docs/spec/formats/enemy.md#layout, docs/spec/formats/README.md#header-and-version). */
export const ENEMY_MAJOR = 2;

/** The section the enemy reader and writer implement (G7, docs/spec/formats/enemy.md#layout). */
export const ENEMY_SECTION = "docs/spec/formats/enemy.md#layout";

// --- Shared slot counts (docs/spec/formats/README.md#primitive-encoding) ----------------------

/** The nine script-variable-name slots of a character (docs/spec/formats/character.md#layout). */
export const CHARACTER_VARIABLE_SLOTS = 9;

/** The fixed special-move slot count of a character (docs/spec/formats/character.md#layout). */
export const SPECIAL_MOVE_SLOTS = 201;

/** The eleven accessory-slot names of a character (docs/spec/formats/character.md#layout). */
export const ACCESSORY_SLOT_COUNT = 11;

/** The seven body-slot flags of a character (docs/spec/formats/character.md#layout). */
export const BODY_SLOT_COUNT = 7;

/** The eight directional slots shared by movement and idle animations (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout). */
export const DIRECTIONAL_ANIMATION_COUNT = 8;

/** The five battle stances FIGHT, DEFEND, SPECIAL MOVE, DIE, REST (docs/spec/formats/character.md#layout). */
export const BATTLE_STANCE_COUNT = 5;

/** The battle-stance block including its one reserved trailing slot (docs/spec/formats/character.md#layout). */
export const BATTLE_STANCE_SLOTS = 6;

/** The four per-level stat increases HP, DP, FP, SMP (docs/spec/formats/character.md#layout). */
export const LEVEL_INCREASE_COUNT = 4;

/** The four obsolete battle-sound slots of a minor < 5 character (docs/spec/formats/character.md#layout). */
export const BATTLE_SOUND_COUNT = 4;

/** The 51 allowed-character handle slots of an item (docs/spec/formats/item.md#layout). */
export const ITEM_CHARACTER_SLOTS = 51;

/** The eight equipment-slot flags head … accessory of an item (docs/spec/formats/item.md#layout). */
export const EQUIP_SLOT_COUNT = 8;

/** The four equip-bonus stats HP, DP, FP, SMP of an item (docs/spec/formats/item.md#layout). */
export const EQUIP_BONUS_COUNT = 4;

/** The five `i8` item use flags: equipable, menu, board, battle, usedBy (docs/spec/formats/item.md#layout). */
export const ITEM_USE_FLAG_COUNT = 5;

/** The sixteen legacy two-tile-tall walk frames of a minor < 4 item (docs/spec/formats/item.md#layout). */
export const LEGACY_WALK_FRAME_COUNT = 16;

/** The two legacy rest tiles of a minor < 4 item (docs/spec/formats/item.md#layout). */
export const LEGACY_REST_TILE_COUNT = 2;

/** The sixteen legacy two-tile-tall walk frames of a minor < 5 character (docs/spec/formats/character.md#layout). */
export const LEGACY_CHARACTER_WALK_FRAME_COUNT = 16;

/** The 64 legacy battle tiles of a minor < 5 character (docs/spec/formats/character.md#layout): 4 frames × 2 rows × 2 cols × 4 stances. */
export const LEGACY_CHARACTER_BATTLE_TILE_COUNT = 64;

/** The four legacy 2×2 battle rest tiles of a minor < 5 character (docs/spec/formats/character.md#layout). */
export const LEGACY_CHARACTER_REST_TILE_COUNT = 4;

/** The ten legacy two-tile-tall custom graphics of a minor < 5 character (docs/spec/formats/character.md#layout). */
export const LEGACY_CHARACTER_CUSTOM_FRAME_COUNT = 10;

/**
 * The seven body-slot names of a character (docs/spec/formats/character.md#layout). Index 0 is the
 * unused padding byte the VB6 1-based `armorType(6)` array left behind; bytes
 * 1..6 are head, neck, left hand, right hand, body, legs.
 */
export const BODY_SLOT_NAMES = [
  "padding",
  "head",
  "neck",
  "leftHand",
  "rightHand",
  "body",
  "legs",
] as const;

// --- Shared model types (docs/spec/formats/README.md#primitive-encoding) ------------------------------------

/** An `(x, y)` position in sprite-local pixels, relative to the anchor (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout). */
export interface ActorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * One closed vector polygon in sprite-local pixels (docs/spec/formats/character.md#layout,
 * docs/spec/formats/item.md#layout). A sprite
 */
export interface ActorBase {
  readonly points: readonly ActorPoint[];
}

/** One (animation → handle) custom stance (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout, docs/spec/formats/enemy.md#layout). */
export interface ActorStance {
  readonly animation: string;
  readonly handle: string;
}

/** One special-move slot of a character and its learn condition (docs/spec/formats/character.md#layout). */
export interface CharacterSpecialMove {
  /** The move's animation/program file. */
  readonly file: string;
  /** The minimum experience needed to learn the move. */
  readonly minExp: number;
  /** The minimum level needed to learn the move. */
  readonly minLevel: number;
  /** The script variable the learn condition tests. */
  readonly condVar: string;
  /** The value the condition must equal. */
  readonly condValue: string;
}

/** The eight initial stats of a character in file order (docs/spec/formats/character.md#layout). */
export interface CharacterStats {
  readonly experience: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly dp: number;
  readonly fp: number;
  readonly smp: number;
  readonly maxSmp: number;
  readonly level: number;
}

/**
 * A whole player character (docs/spec/formats/character.md#layout).
 *
 * The conditional fields are `undefined` when the character's `minor` does not
 * store them; the writer keys every conditional row on `minor`, so a model
 * built by `readCharacter` always writes back byte for byte. `maxLevel === 0`
 * means level progression is disabled: the level-up condition (`level >=
 * maxLevel`) is satisfied immediately (docs/spec/formats/character.md#layout).
 */
export interface Character {
  readonly magic: string;
  readonly major: number;
  readonly minor: number;
  readonly name: string;
  /**
   * The nine script-variable names in exact order (experience, DP, FP, HP, max
   * HP, name, SMP, max SMP, level). Kept verbatim, including the legacy VB type
   * tag (`!`/`$`) that the character layout says callers strip.
   */
  readonly variableNames: readonly string[];
  readonly stats: CharacterStats;
  readonly profilePicture: string;
  /** The fixed 201 special-move slots; empty slots are kept (docs/spec/formats/character.md#layout). */
  readonly specialMoves: readonly CharacterSpecialMove[];
  readonly specialMoveCategory: string;
  /** The stored `i8` flag: 0 = the character has special moves, 1 = not (docs/spec/formats/character.md#layout). */
  readonly hasSpecialMoves: number;
  /** The eleven accessory-slot names (docs/spec/formats/character.md#layout). */
  readonly accessorySlots: readonly string[];
  /** The seven body-slot flags; index 0 is padding, 1..6 are the slots (docs/spec/formats/character.md#layout). */
  readonly bodySlots: readonly number[];
  /** Initial experience for the first level-up; `i8` at minor 3, else `i32` (docs/spec/formats/character.md#layout). */
  readonly firstLevelExp: number;
  /** Experience increase per level: percent or points (docs/spec/formats/character.md#layout). */
  readonly experienceIncrease: number;
  /** The maximum level; 0 disables level progression (docs/spec/formats/character.md#layout). */
  readonly maxLevel: number;
  /** Per-level increase of HP, DP, FP, SMP (docs/spec/formats/character.md#layout). */
  readonly levelIncreases: readonly number[];
  /** The four obsolete battle sounds; only present at `minor < 5` (docs/spec/formats/character.md#layout). */
  readonly battleSounds: readonly string[] | undefined;
  readonly levelUpProgram: string;
  /** The stored `i8`: 0 = exponential/percent, 1 = linear/points (docs/spec/formats/character.md#layout). */
  readonly levelUpType: number;
  /** The stored legacy size type: 0 = 32×32, 1 = 64×32 (docs/spec/formats/character.md#layout). */
  readonly sizeType: number;
  /** Movement animations S, N, E, W, NW, NE, SW, SE; `minor >= 5` (docs/spec/formats/character.md#layout). */
  readonly movementAnimations: readonly string[] | undefined;
  /**
   * FIGHT, DEFEND, SPECIAL MOVE, DIE, REST then one reserved slot; six strings,
   * `minor >= 5` (docs/spec/formats/character.md#layout).
   */
  readonly battleStances: readonly string[] | undefined;
  /** Idle animations, same direction order; `minor >= 6` (docs/spec/formats/character.md#layout). */
  readonly idleAnimations: readonly string[] | undefined;
  /** Seconds before idle animations begin; `minor >= 7` (docs/spec/formats/character.md#layout). */
  readonly idleTime: number | undefined;
  /** Seconds per animation frame / step; `minor >= 7` (docs/spec/formats/character.md#layout). */
  readonly speed: number | undefined;
  /** The custom-stance pairs; `minor >= 5` (docs/spec/formats/character.md#layout). */
  readonly customStances: readonly ActorStance[] | undefined;
  /**
   * The two vector bases, collision then activation; `minor >= 8` (docs/spec/formats/character.md#layout). The
   * stored upper bound is what decides the count: stored `1` means two bases,
   * stored `-1` means none.
   */
  readonly vectorBases: readonly ActorBase[] | undefined;
  /**
   * The legacy tile references of a minor < 5 character (docs/spec/formats/character.md#layout); undefined at
   * minor >= 5. Exactly 120 strings across walk, battle, rest and custom.
   */
  readonly legacyGraphics: LegacyCharacterGraphics | undefined;
  /**
   * Trailing bytes the character layout did not cover, kept verbatim so a writer
   * reproduces the input exactly (AD-18). A non-empty residue is a warning.
   */
  readonly residue: Uint8Array;
}

/** One legacy two-tile-tall walk frame of a minor < 4 item (docs/spec/formats/item.md#layout). */
export interface LegacyWalkFrame {
  readonly top: string;
  readonly bottom: string;
}

/**
 * The legacy tile names of a minor < 5 character (docs/spec/formats/character.md#layout): sixteen walk frames
 * (each top and bottom tile), 64 battle tiles (for frame 0..3, row 0..1, col 0..1:
 * fight, defend, special, death), 4 battle rest tiles (2×2), and 10 custom frames
 * (top and bottom). Exactly 120 strings in total.
 */
export interface LegacyCharacterGraphics {
  readonly walkFrames: readonly LegacyWalkFrame[];
  readonly battleTiles: readonly string[];
  readonly restTiles: readonly string[];
  readonly customFrames: readonly LegacyWalkFrame[];
}

/**
 * The legacy walk frames of a minor < 4 item (docs/spec/formats/item.md#layout): sixteen frames (four per
 * direction S, E, N, W), each a top and a bottom tile, then two rest tiles. A
 * consumer synthesises 1×2 tile bitmaps and 4-frame animations from these.
 */
export interface LegacyWalk {
  readonly frames: readonly LegacyWalkFrame[];
  readonly restTiles: readonly string[];
}

/**
 * A whole item — an inventory object, a piece of equipment or a board NPC
 * (docs/spec/formats/item.md#layout).
 *
 * The conditional fields are `undefined` when the item's `minor` does not store
 * them. Note the delivery-order trap: items store `speed` then `idleTime`,
 * opposite the character format, and the custom-stance block sits right after
 * the ten movement strings at `minor = 4` but after idle animations and
 * speed/idleTime at `minor >= 5` (docs/spec/formats/item.md#layout).
 */
export interface Item {
  readonly magic: string;
  readonly major: number;
  readonly minor: number;
  /** The item's name / board handle (docs/spec/formats/item.md#layout). */
  readonly name: string;
  readonly description: string;
  /** The stored `i8` equipable flag (0 = all, 1 = listed) (docs/spec/formats/item.md#layout). */
  readonly equipable: number;
  /** The stored `i8` menu-usable flag (docs/spec/formats/item.md#layout). */
  readonly menuUsable: number;
  /** The stored `i8` board-usable flag (docs/spec/formats/item.md#layout). */
  readonly boardUsable: number;
  /** The stored `i8` battle-usable flag (docs/spec/formats/item.md#layout). */
  readonly battleUsable: number;
  /** The stored `i8` usedBy flag (0 = all, 1 = the 51 listed handles) (docs/spec/formats/item.md#layout). */
  readonly usedBy: number;
  /** The 51 allowed-character handle slots; empty slots are kept (docs/spec/formats/item.md#layout). */
  readonly allowedCharacters: readonly string[];
  /** Buy price; `i32` at `minor >= 3`, else `i16` (docs/spec/formats/item.md#layout). */
  readonly buyPrice: number;
  /** Sell price; `i32` at `minor >= 3`, else `i16` (docs/spec/formats/item.md#layout). */
  readonly sellPrice: number;
  /** The stored `i8` key-item flag (cannot be dropped) (docs/spec/formats/item.md#layout). */
  readonly keyItem: number;
  /** The eight equipment-slot flags head … accessory (docs/spec/formats/item.md#layout). */
  readonly equipSlots: readonly number[];
  readonly accessoryName: string;
  /** Equip bonus HP, DP, FP, SMP; `i32` at `minor >= 3`, else `i16` (docs/spec/formats/item.md#layout). */
  readonly equipBonus: readonly number[];
  readonly onEquipProgram: string;
  readonly onRemoveProgram: string;
  /** Menu use +HP, +SMP; `i32` at `minor >= 3`, else `i16` (docs/spec/formats/item.md#layout). */
  readonly menuUseHp: number;
  readonly menuUseSmp: number;
  readonly menuUseProgram: string;
  /** Battle use +HP, +SMP; `i32` at `minor >= 3`, else `i16` (docs/spec/formats/item.md#layout). */
  readonly battleUseHp: number;
  readonly battleUseSmp: number;
  readonly battleUseProgram: string;
  readonly battleAnimation: string;
  /** The thread that runs while the item is on the board (docs/spec/formats/item.md#layout). */
  readonly multitaskProgram: string;
  /** The program that runs when the player interacts (docs/spec/formats/item.md#layout). */
  readonly activationProgram: string;
  /** The stored legacy size type (docs/spec/formats/item.md#layout). */
  readonly sizeType: number;
  /** Movement animations S, N, E, W, NW, NE, SW, SE; `minor >= 4` (docs/spec/formats/item.md#layout). */
  readonly movementAnimations: readonly string[] | undefined;
  /** The legacy rest animation; at `minor < 6` it is the idle-South one (docs/spec/formats/item.md#layout). */
  readonly restAnimation: string | undefined;
  /** The one reserved string after the movement block; `minor >= 4` (docs/spec/formats/item.md#layout). */
  readonly reservedAnimation: string | undefined;
  /** Idle animations, same direction order; `minor >= 5` (docs/spec/formats/item.md#layout). */
  readonly idleAnimations: readonly string[] | undefined;
  /** Seconds per animation frame / step; `minor >= 5` (items store speed first) (docs/spec/formats/item.md#layout). */
  readonly speed: number | undefined;
  /** Seconds before idle animations begin; `minor >= 5` (docs/spec/formats/item.md#layout). */
  readonly idleTime: number | undefined;
  /** The custom-stance pairs; `minor >= 4` (placement differs by minor) (docs/spec/formats/item.md#layout). */
  readonly customStances: readonly ActorStance[] | undefined;
  /**
   * The two vector bases, collision then activation; `minor >= 7` (docs/spec/formats/item.md#layout). Same
   * upper-bound rule as characters: stored `1` means two bases.
   */
  readonly vectorBases: readonly ActorBase[] | undefined;
  /** The legacy two-tile-tall walk frames; only present at `minor < 4` (docs/spec/formats/item.md#layout). */
  readonly legacyWalk: LegacyWalk | undefined;
  /** Trailing bytes the item layout did not cover, kept verbatim (AD-18). */
  readonly residue: Uint8Array;
}

/**
 * A whole enemy (docs/spec/formats/enemy.md#layout).
 *
 * Both the binary minor 1 form and the 2.0 text form (minor 0) are represented.
 * The stance list keeps its six slots so the indices stay stable: slot 0 REST,
 * 1 FIGHT/ATTACK, 2 DEFEND, 3 SPECIAL MOVE, 4 DIE, 5 unused padding.
 */
export interface Enemy {
  readonly magic: string;
  readonly major: number;
  readonly minor: number;
  readonly name: string;
  /** The `i32` HP, stored equal to the maximum (docs/spec/formats/enemy.md#layout). */
  readonly hp: number;
  /** The `i32` SMP, stored equal to the maximum (docs/spec/formats/enemy.md#layout). */
  readonly smp: number;
  readonly fp: number;
  readonly dp: number;
  /** The stored `i8` flag: 0 = the player cannot run (docs/spec/formats/enemy.md#layout). */
  readonly canRun: number;
  /** 1-in-N chance of a critical hit **on** this enemy (defence ignored) (docs/spec/formats/enemy.md#layout). */
  readonly criticalOn: number;
  /** 1-in-N chance of a critical hit **by** this enemy (docs/spec/formats/enemy.md#layout). */
  readonly criticalBy: number;
  /** Special-move files (upper bound, then files) (docs/spec/formats/enemy.md#layout). */
  readonly specialMoves: readonly string[];
  /** Special moves that hurt this enemy more (docs/spec/formats/enemy.md#layout). */
  readonly weaknesses: readonly string[];
  /** Special moves this enemy resists (docs/spec/formats/enemy.md#layout). */
  readonly strengths: readonly string[];
  /** AI level 0–3 (low, medium, high, very high) (docs/spec/formats/enemy.md#layout). */
  readonly aiLevel: number;
  /** The stored `i8` flag to use the custom AI program (docs/spec/formats/enemy.md#layout). */
  readonly customAi: number;
  readonly aiProgram: string;
  readonly experienceReward: number;
  readonly goldReward: number;
  readonly defeatProgram: string;
  readonly runAwayProgram: string;
  /** The six stance slots 0..5 (stored bound 5); slot 5 is unused (docs/spec/formats/enemy.md#layout). */
  readonly stances: readonly string[];
  /** The custom-stance pairs; the bound is an `i32`, not an `i16` (docs/spec/formats/enemy.md#layout). */
  readonly customStances: readonly ActorStance[];
  /** Trailing bytes the enemy layout did not cover, kept verbatim (AD-18). */
  readonly residue: Uint8Array;
  /** Width in tiles (text enemy, minor 0; format specification legacy). */
  readonly width?: number | undefined;
  /** Height in tiles (text enemy, minor 0; format specification legacy). */
  readonly height?: number | undefined;
  /** Fixed 19×7 tile grid names (text enemy, minor 0; R-20). */
  readonly tileGrid?: readonly string[] | undefined;
}

// --- Shared reader/writer helpers (docs/spec/formats/README.md#counts-are-usually-upper-bounds) --------------------

/** A located failure while reading an actor (AD-18). */
export function actorError(
  reader: BinaryReader,
  offset: number,
  section: string,
  message: string,
): Result<never> {
  return err({
    ...(reader.path === undefined ? {} : { path: reader.path }),
    offset,
    section,
    message,
  });
}

/**
 * Read an `i16`-bounded list of strings (docs/spec/formats/README.md#counts-are-usually-upper-bounds). Every entry is
 * kept, empty ones included; the bound is checked against the bytes that remain
 * so a damaged file cannot make the reader loop (each string needs at least the
 */
export function readBoundedStrings(reader: BinaryReader): Result<string[]> {
  const boundResult = reader.readUpperBound();
  if (!boundResult.ok) {
    return boundResult;
  }
  const count = boundResult.value;
  if (count > reader.remaining) {
    return actorError(
      reader,
      reader.offset,
      "docs/spec/formats/README.md#counts-are-usually-upper-bounds",
      `a string list's upper bound needs ${count} entries but only ${reader.remaining} byte(s) remain`,
    );
  }
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = reader.str();
    if (!value.ok) {
      return value;
    }
    values.push(value.value);
  }
  return ok(values);
}

/**
 * Read exactly `count` NUL-terminated strings (docs/spec/formats/README.md#primitive-encoding). Used for
 * the fixed-size blocks (`str × 8`, `str × 51`, …) whose count is not stored.
 */
export function readStrings(reader: BinaryReader, count: number): Result<string[]> {
  const values: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = reader.str();
    if (!value.ok) {
      return value;
    }
    values.push(value.value);
  }
  return ok(values);
}

/** Read exactly `count` copies of a one-byte integer. */
export function readBytes(reader: BinaryReader, count: number): Result<number[]> {
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const value = reader.i8();
    if (!value.ok) {
      return value;
    }
    values.push(value.value);
  }
  return ok(values);
}

/**
 * Read a list of vector bases (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout): an `i16` upper bound
 * (`1` means two bases, `-1` means none), then each base as an `i16` points
 * upper bound followed by `i32 x, i32 y` pairs.
 */
export function readBases(reader: BinaryReader, section: string): Result<ActorBase[]> {
  const countResult = reader.readUpperBound();
  if (!countResult.ok) {
    return countResult;
  }
  const bases: ActorBase[] = [];
  for (let i = 0; i < countResult.value; i += 1) {
    const pointCount = reader.readUpperBound();
    if (!pointCount.ok) {
      return pointCount;
    }
    if (pointCount.value > Math.floor(reader.remaining / 8)) {
      return actorError(
        reader,
        reader.offset,
        section,
        `a vector base needs ${pointCount.value} points (${pointCount.value * 8} bytes) but only ${reader.remaining} byte(s) remain`,
      );
    }
    const points: ActorPoint[] = [];
    for (let p = 0; p < pointCount.value; p += 1) {
      const x = reader.i32();
      if (!x.ok) {
        return x;
      }
      const y = reader.i32();
      if (!y.ok) {
        return y;
      }
      points.push({ x: x.value, y: y.value });
    }
    bases.push({ points });
  }
  return ok(bases);
}

/** A located error from a writer for a value it cannot encode (AD-18). */
export function writerError(writer: BinaryWriter, section: string, message: string): Result<never> {
  return err({ offset: writer.toBytes().length, section, message });
}

/**
 * Append exactly `count` NUL-terminated strings (docs/spec/formats/README.md#primitive-encoding). A
 * fixed-size block with the wrong number of entries cannot be serialised, so a
 * mismatch is a located error rather than a silently short file.
 */
export function writeFixedStrings(
  writer: BinaryWriter,
  values: readonly string[],
  count: number,
  section: string,
  what: string,
): Result<void> {
  if (values.length !== count) {
    return writerError(
      writer,
      section,
      `${what} needs exactly ${count} entries but the model has ${values.length}`,
    );
  }
  return writeStrings(writer, values, section, what);
}

/** Append exactly `count` copies of a one-byte integer. */
export function writeFixedBytes(
  writer: BinaryWriter,
  values: readonly number[],
  count: number,
  section: string,
  what: string,
): Result<void> {
  if (values.length !== count) {
    return writerError(
      writer,
      section,
      `${what} needs exactly ${count} entries but the model has ${values.length}`,
    );
  }
  for (const [index, value] of values.entries()) {
    const checked = checkI8(writer, section, `${what}[${index}]`, value);
    if (checked !== undefined) return checked;
    writer.i8(value);
  }
  return ok(undefined);
}

/**
 * Append an `i16`-bounded list of strings (docs/spec/formats/README.md#counts-are-usually-upper-bounds). The bound is
 * derived back from the array length, so empty slots round-trip and indices
 * stay stable.
 */
export function writeBoundedStrings(
  writer: BinaryWriter,
  values: readonly string[],
  section: string,
  what: string,
): Result<void> {
  const bound = checkListBound(writer, section, what, values.length);
  if (bound !== undefined) return bound;
  writer.i16(values.length === 0 ? -1 : values.length - 1);
  return writeStrings(writer, values, section, what);
}

/** Append a list of strings with no bound of its own (a fixed block). */
export function writeStrings(
  writer: BinaryWriter,
  values: readonly string[],
  section: string,
  what: string,
): Result<void> {
  for (const value of values) {
    const written = writer.str(value);
    if (!written.ok) {
      return writerError(writer, section, `${what}: ${written.error.message}`);
    }
  }
  return ok(undefined);
}

/**
 * Append the `i16` bound of a list that is not a string list (vector bases,
 * custom stances): `-1` for none, else `count - 1` (docs/spec/formats/README.md#counts-are-usually-upper-bounds).
 */
export function writeBound(writer: BinaryWriter, count: number, width: "i16" | "i32"): void {
  const stored = count === 0 ? -1 : count - 1;
  if (width === "i32") {
    writer.i32(stored);
  } else {
    writer.i16(stored);
  }
}

/** Append a list of vector bases (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout). */
export function writeBases(
  writer: BinaryWriter,
  bases: readonly ActorBase[],
  section: string,
): Result<void> {
  const bound = checkListBound(writer, section, "vector bases", bases.length);
  if (bound !== undefined) return bound;
  writeBound(writer, bases.length, "i16");
  for (const [index, base] of bases.entries()) {
    const points = checkListBound(writer, section, `vector base ${index}`, base.points.length);
    if (points !== undefined) return points;
    writeBound(writer, base.points.length, "i16");
    for (const [position, point] of base.points.entries()) {
      for (const [axis, value] of [["x", point.x], ["y", point.y]] as const) {
        const checked = checkI32(writer, section, `vector base ${index} point ${position} ${axis}`, value);
        if (checked !== undefined) return checked;
        writer.i32(value);
      }
    }
  }
  return ok(undefined);
}

/**
 * Append a custom-stance list (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout, docs/spec/formats/enemy.md#layout): an `i32` upper
 * bound, then the `animation, handle` pairs. Empty pairs are written back
 * verbatim; the character format's "skip if either is empty" is a rule for consumers.
 */
export function writeStances(
  writer: BinaryWriter,
  stances: readonly ActorStance[],
  section: string,
): Result<void> {
  writeBound(writer, stances.length, "i32");
  for (const stance of stances) {
    const animation = writer.str(stance.animation);
    if (!animation.ok) {
      return writerError(writer, section, `custom stance animation: ${animation.error.message}`);
    }
    const handle = writer.str(stance.handle);
    if (!handle.ok) {
      return writerError(writer, section, `custom stance handle: ${handle.error.message}`);
    }
  }
  return ok(undefined);
}

/** Read a custom-stance list: `i32` upper bound, then the pairs (docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout, docs/spec/formats/enemy.md#layout). */
export function readStances(reader: BinaryReader, section: string): Result<ActorStance[]> {
  const countResult = reader.readUpperBound("i32");
  if (!countResult.ok) {
    return countResult;
  }
  const count = countResult.value;
  if (count > Math.floor(reader.remaining / 2)) {
    return actorError(
      reader,
      reader.offset,
      section,
      `custom stances: ${count} pairs need at least ${count * 2} byte(s) but only ${reader.remaining} remain`,
    );
  }
  const stances: ActorStance[] = [];
  for (let i = 0; i < count; i += 1) {
    const animation = reader.str();
    if (!animation.ok) {
      return animation;
    }
    const handle = reader.str();
    if (!handle.ok) {
      return handle;
    }
    stances.push({ animation: animation.value, handle: handle.value });
  }
  return ok(stances);
}
