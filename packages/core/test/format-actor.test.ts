// The actor formats of docs/spec/formats/character.md#layout: player characters (`.tem`, items
// and board NPCs (`.itm`, docs/spec/formats/item.md#layout and enemies (`.ene`, docs/spec/formats/enemy.md#layout, plus the sample
// fixtures when they have been fetched (G5 rule 4: fetched, never committed).
//
// The readers never throw, so the tests assert on values and on the error's
// offset and section rather than on exceptions. The synthetic buffers are built
// field by field with `BinaryWriter` in the exact spec order, so a reader that
// reads a field at the wrong width or in the wrong order fails here.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BODY_SLOT_NAMES,
  CHARACTER_SECTION,
  ENEMY_SECTION,
  ITEM_SECTION,
  BinaryReader,
  BinaryWriter,
  readCharacter,
  readEnemy,
  readItem,
  writeCharacter,
  writeEnemy,
  writeItem,
} from "../src/index.ts";
import type { ActorBase, ActorStance, LegacyCharacterGraphics, Result } from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message} (offset ${result.error.offset}, ${result.error.section})`);
  }
  return result.value;
}

/** The stored upper bound for `count` entries (docs/spec/formats/README.md#counts-are-usually-upper-bounds). */
function bound(count: number): number {
  return count === 0 ? -1 : count - 1;
}

/** A rectangular base with the four corners given as `[x, y]` pairs. */
function rect(x0: number, y0: number, x1: number, y1: number): ActorBase {
  return {
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  };
}

const BLANK8: readonly string[] = ["", "", "", "", "", "", "", ""];

/** Write a list of strings verbatim (the builder always knows its own counts). */
function putStrings(writer: BinaryWriter, values: readonly string[]): void {
  for (const value of values) {
    writer.str(value);
  }
}

/** Write a bounded string list as the formats store it (an upper bound, docs/spec/formats/README.md#counts-are-usually-upper-bounds. */
function putBoundedStrings(writer: BinaryWriter, values: readonly string[]): void {
  writer.i16(bound(values.length));
  putStrings(writer, values);
}

/** Write a custom-stance block: an `i32` bound, then the pairs(docs/spec/formats/character.md#layout). */
function putStances(writer: BinaryWriter, stances: readonly ActorStance[]): void {
  writer.i32(bound(stances.length));
  for (const stance of stances) {
    writer.str(stance.animation);
    writer.str(stance.handle);
  }
}

/** Write the two vector bases(docs/spec/formats/character.md#layout, docs/spec/formats/item.md#layout: an `i16` bound, then the polygons. */
function putBases(writer: BinaryWriter, bases: readonly ActorBase[]): void {
  writer.i16(bound(bases.length));
  for (const base of bases) {
    writer.i16(bound(base.points.length));
    for (const point of base.points) {
      writer.i32(point.x);
      writer.i32(point.y);
    }
  }
}

/** One special-move slot as docs/spec/formats/character.md#layout stores it (file, minExp, minLevel, conds). */
interface SpecialMoveSpec {
  readonly file: string;
  readonly minExp: number;
  readonly minLevel: number;
  readonly condVar: string;
  readonly condValue: string;
}

interface CharacterSpec {
  readonly minor?: number;
  readonly magic?: string;
  readonly bodySlots?: readonly number[];
  readonly idleTime?: number;
  readonly speed?: number;
  readonly bases?: readonly ActorBase[];
  readonly movement?: readonly string[];
  readonly battleStances?: readonly string[];
  readonly idle?: readonly string[];
  readonly customStances?: readonly ActorStance[];
  readonly specialMoves?: readonly SpecialMoveSpec[];
  readonly hasSpecialMoves?: number;
  readonly levelUpType?: number;
  readonly sizeType?: number;
  readonly legacyGraphics?: LegacyCharacterGraphics;
}

/** Build a character buffer in the exact docs/spec/formats/character.md#layout field order. */
function buildCharacter(spec: CharacterSpec = {}): Uint8Array {
  const minor = spec.minor ?? 8;
  const w = new BinaryWriter();
  w.str(spec.magic ?? "RPGTLKIT CHAR");
  w.i16(2);
  w.i16(minor);
  w.str("Hero");
  putStrings(w, ["exp!", "dp!", "fp!", "hp!", "maxhp!", "name$", "smp!", "maxsm!", "level!"]);
  for (const value of [10, 100, 100, 10, 40, 40, 40, 1]) {
    w.i32(value);
  }
  w.str(""); // profile picture
  for (let i = 0; i < 201; i += 1) {
    const move = spec.specialMoves?.[i];
    w.str(move?.file ?? "");
    w.i32(move?.minExp ?? 0);
    w.i32(move?.minLevel ?? 0);
    w.str(move?.condVar ?? "");
    w.str(move?.condValue ?? "");
  }
  w.str(""); // special-move category
  w.i8(spec.hasSpecialMoves ?? 0); // 0 = has special moves (yes)
  putStrings(w, ["", "", "", "", "", "", "", "", "", "", ""]); // 11 accessory slots
  for (const slot of spec.bodySlots ?? [0, 1, 1, 1, 1, 1, 1]) {
    w.i8(slot);
  }
  if (minor === 3) {
    w.i8(90);
  } else {
    w.i32(90);
  }
  w.i16(5); // experience increase
  w.i32(0); // max level (0 disables progression)
  for (const value of [5, 5, 5, 5]) {
    w.i16(value);
  }
  if (minor < 5) {
    putStrings(w, ["", "", "", ""]); // obsolete battle sounds
  }
  w.str(""); // level-up program
  w.i8(spec.levelUpType ?? 0); // level-up type
  w.i8(spec.sizeType ?? 1); // size type
  if (minor < 5) {
    if (spec.legacyGraphics !== undefined) {
      for (const frame of spec.legacyGraphics.walkFrames) {
        w.str(frame.top);
        w.str(frame.bottom);
      }
      putStrings(w, spec.legacyGraphics.battleTiles);
      putStrings(w, spec.legacyGraphics.restTiles);
      for (const frame of spec.legacyGraphics.customFrames) {
        w.str(frame.top);
        w.str(frame.bottom);
      }
    } else {
      for (let i = 0; i < 16; i += 1) {
        w.str(`walk_${i}_top`);
        w.str(`walk_${i}_bottom`);
      }
      for (let i = 0; i < 64; i += 1) {
        w.str(`battle_${i}`);
      }
      for (let i = 0; i < 4; i += 1) {
        w.str(`rest_${i}`);
      }
      for (let i = 0; i < 10; i += 1) {
        w.str(`custom_${i}_top`);
        w.str(`custom_${i}_bottom`);
      }
    }
  }
  if (minor >= 5) {
    putStrings(w, spec.movement ?? BLANK8);
    putStrings(w, spec.battleStances ?? ["", "", "", "", "", ""]);
  }
  if (minor >= 6) {
    putStrings(w, spec.idle ?? BLANK8);
  }
  if (minor >= 7) {
    w.f64(spec.idleTime ?? 3);
    w.f64(spec.speed ?? 0.05);
  }
  if (minor >= 5) {
    putStances(w, spec.customStances ?? []);
  }
  if (minor >= 8) {
    putBases(w, spec.bases ?? []);
  }
  return w.toBytes();
}

interface ItemSpec {
  readonly minor?: number;
  readonly magic?: string;
  readonly speed?: number;
  readonly idleTime?: number;
  readonly bases?: readonly ActorBase[];
  readonly movement?: readonly string[];
  readonly idle?: readonly string[];
  readonly customStances?: readonly ActorStance[];
  readonly flags?: readonly number[];
}

/** Build an item buffer in the exact docs/spec/formats/item.md#layout field order. */
function buildItem(spec: ItemSpec = {}): Uint8Array {
  const minor = spec.minor ?? 7;
  const wide = minor >= 3;
  const w = new BinaryWriter();
  w.str(spec.magic ?? "RPGTLKIT ITEM");
  w.i16(2);
  w.i16(minor);
  w.str("man");
  w.str(""); // description
  for (let i = 0; i < 5; i += 1) {
    w.i8(spec.flags?.[i] ?? 0); // use flags
  }
  putStrings(w, new Array<string>(51).fill(""));
  if (wide) {
    w.i32(0);
    w.i32(0);
  } else {
    w.i16(0);
    w.i16(0);
  }
  w.i8(0); // key item
  for (let i = 0; i < 8; i += 1) {
    w.i8(0); // equip slots
  }
  w.str(""); // accessory name
  for (let i = 0; i < 4; i += 1) {
    if (wide) {
      w.i32(0);
    } else {
      w.i16(0);
    }
  }
  w.str(""); // on-equip
  w.str(""); // on-remove
  for (let i = 0; i < 2; i += 1) {
    if (wide) {
      w.i32(0);
    } else {
      w.i16(0);
    }
  }
  w.str(""); // menu use program
  for (let i = 0; i < 2; i += 1) {
    if (wide) {
      w.i32(0);
    } else {
      w.i16(0);
    }
  }
  w.str(""); // battle use program
  w.str(""); // battle animation
  w.str(""); // multitask program
  w.str(""); // activation program
  w.i8(1); // size type
  if (minor >= 4) {
    putStrings(w, spec.movement ?? BLANK8);
    w.str(""); // legacy rest animation
    w.str(""); // reserved
  }
  if (minor >= 5) {
    putStrings(w, spec.idle ?? BLANK8);
    // Items store speed before idleTime — the opposite of characters(docs/spec/formats/item.md#layout).
    w.f64(spec.speed ?? 0.1);
    w.f64(spec.idleTime ?? 3);
  }
  if (minor >= 4) {
    putStances(w, spec.customStances ?? []);
  }
  if (minor >= 7) {
    putBases(w, spec.bases ?? []);
  }
  if (minor < 4) {
    for (let i = 0; i < 16; i += 1) {
      w.str("");
      w.str("");
    }
    w.str("");
    w.str("");
  }
  return w.toBytes();
}

interface EnemySpec {
  readonly minor?: number;
  readonly magic?: string;
  readonly stances?: readonly string[];
  readonly customStances?: readonly ActorStance[];
  readonly canRun?: number;
  readonly customAi?: number;
}

/** Build an enemy buffer in the exact docs/spec/formats/enemy.md#layout field order. */
function buildEnemy(spec: EnemySpec = {}): Uint8Array {
  const w = new BinaryWriter();
  w.str(spec.magic ?? "RPGTLKIT ENEMY");
  w.i16(2);
  w.i16(spec.minor ?? 1);
  w.str("Pirate");
  for (const value of [34, 12, 4, 2]) {
    w.i32(value);
  }
  w.i8(spec.canRun ?? 1); // player can run
  w.i16(4); // critical on this enemy
  w.i16(10); // critical by this enemy
  putBoundedStrings(w, []);
  putBoundedStrings(w, []);
  putBoundedStrings(w, []);
  w.i8(0); // AI level
  w.i8(spec.customAi ?? 0); // use custom AI
  w.str(""); // AI program
  w.i32(23); // experience reward
  w.i32(4); // gold reward
  w.str(""); // defeat program
  w.str(""); // run-away program
  putBoundedStrings(w, spec.stances ?? ["", "", "", "", "", ""]);
  putStances(w, spec.customStances ?? []);
  return w.toBytes();
}

/** A Windows-1252/ASCII buffer that pretends to be a 2.x text file. */
function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

/** Read `bytes` with `read` and require it to fail, returning the error. */
function readError<T>(bytes: Uint8Array, read: (reader: BinaryReader) => Result<T>): {
  readonly offset: number;
  readonly section: string;
} {
  const result = read(new BinaryReader(bytes, "synthetic"));
  equal(result.ok, false, "the reader was expected to fail");
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.error;
}

/** The warnings of a result the test expects to succeed. */
function warningsOf<T>(result: Result<T>): readonly string[] {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.warnings;
}

/** Write `model` with `write` and require it to fail, returning the error. */
function writeError<T>(model: T, write: (model: T) => Result<Uint8Array>): {
  readonly offset: number;
  readonly section: string;
} {
  const result = write(model);
  equal(result.ok, false, "the writer was expected to fail");
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.error;
}

/** Append `extra` bytes after `bytes` (a file with trailing residue). */
function withTrailing(bytes: Uint8Array, extra: readonly number[]): Uint8Array {
  const out = new Uint8Array(bytes.length + extra.length);
  out.set(bytes, 0);
  out.set(extra, bytes.length);
  return out;
}

// --- docs/spec/formats/character.md#layout character, the vector-bases upper bound ---------------------------

test("character: the vector-bases field is an upper bound (stored 1 means 2 bases)", () => {
  const collision = rect(-15, -15, 15, 0);
  const activation = rect(-24, -24, 24, 8);
  const bytes = buildCharacter({ bases: [collision, activation] });

  // A literal `i16 count` reading would read one base and stop, leaving the
  // 34 bytes of the second base (2 + 4 × 8) trailing — the discovery report's
  // exact symptom. Pin the stored value first, then the two bases.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  equal(view.getInt16(bytes.length - 70, true), 1, "the stored bound is 1");

  const reader = new BinaryReader(bytes);
  const character = unwrap(readCharacter(reader));
  equal(reader.remaining, 0, "no trailing bytes");
  equal(character.residue.length, 0, "no residue");
  deepEqual(character.vectorBases, [collision, activation]);
  deepEqual(unwrap(writeCharacter(character)), bytes, "byte-identical round-trip");

  const none = unwrap(readCharacter(new BinaryReader(buildCharacter({ bases: [] }))));
  equal(none.vectorBases?.length, 0, "a stored -1 means no bases");
});

// --- docs/spec/formats/character.md#layout character, the seven body slots -----------------------------------

test("character: seven body slots, byte 0 is padding", () => {
  const bytes = buildCharacter({ bodySlots: [0, 1, 1, 0, 1, 0, 1] });
  const character = unwrap(readCharacter(new BinaryReader(bytes)));
  equal(character.bodySlots.length, 7);
  deepEqual(character.bodySlots, [0, 1, 1, 0, 1, 0, 1]);
  deepEqual(
    [...BODY_SLOT_NAMES],
    ["padding", "head", "neck", "leftHand", "rightHand", "body", "legs"],
  );
  equal(BODY_SLOT_NAMES[0], "padding");
});

// --- docs/spec/formats/character.md#layout vs docs/spec/formats/item.md#layout, the speed/idleTime order ---------------------------------

test("character stores idleTime then speed; item stores speed then idleTime", () => {
  // The two values are deliberately distinguishable, and the opposite order in
  // items(docs/spec/formats/item.md#layout) means a reader that used one order for both would swap them.
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter({ idleTime: 3, speed: 0.05 }))));
  equal(character.idleTime, 3);
  equal(character.speed, 0.05);

  const item = unwrap(readItem(new BinaryReader(buildItem({ speed: 0.1, idleTime: 3 }))));
  equal(item.speed, 0.1);
  equal(item.idleTime, 3);
});

// --- docs/spec/formats/item.md#layout item, custom-stance placement -------------------------------------

test("item: custom stances follow the movement strings at minor 4 and idle+speed at minor 5", () => {
  const movement = ["m_s", "m_n", "m_e", "m_w", "", "", "", ""];
  const stances4: readonly ActorStance[] = [{ animation: "a4", handle: "h4" }];
  const bytes4 = buildItem({ minor: 4, movement, customStances: stances4 });
  const reader4 = new BinaryReader(bytes4);
  const item4 = unwrap(readItem(reader4));
  equal(reader4.remaining, 0);
  equal(item4.residue.length, 0);
  deepEqual(item4.movementAnimations, movement);
  deepEqual(item4.customStances, stances4);
  equal(item4.idleAnimations, undefined, "minor 4 has no idle animations");
  equal(item4.speed, undefined, "minor 4 has no speed");
  deepEqual(unwrap(writeItem(item4)), bytes4, "byte-identical round-trip");

  const idle = ["i_s", "", "", "", "", "", "", ""];
  const stances5: readonly ActorStance[] = [{ animation: "a5", handle: "h5" }];
  const bytes5 = buildItem({ minor: 5, idle, speed: 0.2, idleTime: 2, customStances: stances5 });
  const reader5 = new BinaryReader(bytes5);
  const item5 = unwrap(readItem(reader5));
  equal(reader5.remaining, 0);
  equal(item5.residue.length, 0);
  deepEqual(item5.idleAnimations, idle);
  equal(item5.speed, 0.2);
  equal(item5.idleTime, 2);
  deepEqual(item5.customStances, stances5);
  deepEqual(unwrap(writeItem(item5)), bytes5, "byte-identical round-trip");
});

// --- docs/spec/formats/enemy.md#layout enemy, six stance slots and the i32 custom-stance bound -----------

test("an enemy's two critical fields keep their own values, so a consistent swap fails", () => {
  // Round-tripping a swapped reader/writer pair cannot see the swap; distinct values can.
  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy({ criticalOn: 4, criticalBy: 10 }))));
  equal(enemy.criticalOn, 4, "criticalOn is the first critical field");
  equal(enemy.criticalBy, 10, "criticalBy is the second");
  const swapped = unwrap(readEnemy(new BinaryReader(unwrap(writeEnemy({ ...enemy, criticalOn: 10, criticalBy: 4 })))));
  equal(swapped.criticalOn, 10);
  equal(swapped.criticalBy, 4, "a swapped pair re-reads as itself, which only distinct values can prove");
});

test("enemy: the stance bound 5 yields six slots and the custom-stance bound is i32", () => {
  const stances = ["rest", "fight", "defend", "special", "die", ""];
  const bytes = buildEnemy({ stances });
  const reader = new BinaryReader(bytes);
  const enemy = unwrap(readEnemy(reader));
  equal(reader.remaining, 0);
  equal(enemy.residue.length, 0);
  equal(enemy.stances.length, 6, "six slots 0..5");
  deepEqual(enemy.stances, stances);
  equal(enemy.stances[5], "", "slot 5 is the unused boundary slot");
  deepEqual(unwrap(writeEnemy(enemy)), bytes, "byte-identical round-trip");

  // All-empty stances plus six empty custom-stance pairs: the tail is exactly
  // stance bound + 6 NULs + i32 bound + 12 NULs, so the two bounds can be read
  // back at known offsets. A four-byte 5 is what proves the custom bound is an
  // i32 and not the i16 legacy readers used.
  const custom: readonly ActorStance[] = [
    { animation: "", handle: "" },
    { animation: "", handle: "" },
    { animation: "", handle: "" },
    { animation: "", handle: "" },
    { animation: "", handle: "" },
    { animation: "", handle: "" },
  ];
  const tail = buildEnemy({ customStances: custom });
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  equal(view.getInt16(tail.length - 24, true), 5, "stored stance bound is 5");
  equal(view.getInt32(tail.length - 16, true), 5, "stored custom-stance bound is a 4-byte 5");
  const tailReader = new BinaryReader(tail);
  const tailEnemy = unwrap(readEnemy(tailReader));
  equal(tailReader.remaining, 0);
  equal(tailEnemy.residue.length, 0);
  deepEqual(tailEnemy.customStances, custom);
  equal(unwrap(readEnemy(new BinaryReader(buildEnemy({ customStances: [] })))).customStances.length, 0);
});

// --- Round-trips for all three formats -------------------------------------

test("every synthetic actor buffer round-trips byte for byte", () => {
  const cases: readonly { readonly name: string; readonly bytes: Uint8Array; readonly rewrite: (bytes: Uint8Array) => Uint8Array }[] = [
    {
      name: "character",
      bytes: buildCharacter({
        bases: [rect(-15, -15, 15, 0), rect(-24, -24, 24, 8)],
        movement: ["s", "n", "e", "w", "", "", "", ""],
        battleStances: ["fight", "defend", "item", "die", "rest", ""],
        idle: ["is", "", "", "", "", "", "", ""],
        customStances: [{ animation: "a", handle: "h" }],
      }),
      rewrite: (bytes) => unwrap(writeCharacter(unwrap(readCharacter(new BinaryReader(bytes))))),
    },
    {
      name: "item",
      bytes: buildItem({
        bases: [rect(-15, -15, 15, 0), rect(-24, -24, 24, 8)],
        movement: ["s", "n", "e", "w", "", "", "", ""],
        idle: ["is", "", "", "", "", "", "", ""],
        speed: 0.1,
        idleTime: 3,
        customStances: [{ animation: "a", handle: "h" }],
      }),
      rewrite: (bytes) => unwrap(writeItem(unwrap(readItem(new BinaryReader(bytes))))),
    },
    {
      name: "enemy",
      bytes: buildEnemy({
        stances: ["rest", "fight", "defend", "special", "die", ""],
        customStances: [{ animation: "a", handle: "h" }],
      }),
      rewrite: (bytes) => unwrap(writeEnemy(unwrap(readEnemy(new BinaryReader(bytes))))),
    },
  ];
  for (const { name, bytes, rewrite } of cases) {
    deepEqual(rewrite(bytes), bytes, `${name} did not round-trip`);
  }
});

// --- docs/spec/formats/character.md#layout the 201 special-move slots ----------------------------------------

test("character: the 201 special-move slots keep their five-field order", () => {
  // A slot is one record — `str file, i32 minExp, i32 minLevel, str condVar,
  // str condValue` — not a files-only block followed by a conditions-only
  // block. An all-empty slot has the same byte length either way, so the value
  // below is what distinguishes the orders: a writer that split the two blocks
  // re-emits a different byte sequence(docs/spec/formats/character.md#layout, readSpecialMove).
  const slot = { file: "sm/fire.spc", minExp: 120, minLevel: 7, condVar: "hasFire$", condValue: "yes" };
  const bytes = buildCharacter({ specialMoves: [slot] });
  const reader = new BinaryReader(bytes);
  const character = unwrap(readCharacter(reader));
  equal(reader.remaining, 0, "no trailing bytes");
  equal(character.residue.length, 0, "no residue");
  equal(character.specialMoves.length, 201, "the fixed slot count is kept");
  deepEqual(character.specialMoves[0], slot);
  equal(character.specialMoves[1]?.file, "", "slot 1 is empty");
  deepEqual(unwrap(writeCharacter(character)), bytes, "byte-identical round-trip");
});

// --- Version-conditional rows -----------------------------------------------

test("character: the version-conditional rows at minor 3 and minor 4 round-trip", () => {
  for (const minor of [3, 4]) {
    const bytes = buildCharacter({ minor });
    const reader = new BinaryReader(bytes);
    const character = unwrap(readCharacter(reader));
    equal(character.minor, minor);
    equal(reader.remaining, 0, `minor ${minor}: trailing bytes`);
    equal(character.residue.length, 0, `minor ${minor}: residue`);
    // Both minors still carry the obsolete battle sounds (minor < 5); the
    // first-level-exp row is an i8 only at minor 3, an i32 at minor 4.
    equal(character.battleSounds?.length, 4, `minor ${minor}: battle sounds`);
    equal(character.firstLevelExp, 90, `minor ${minor}: first-level exp`);
    equal(character.movementAnimations, undefined, `minor ${minor}: no movement animations`);
    equal(character.legacyGraphics?.walkFrames.length, 16, `minor ${minor}: 16 walk frames`);
    equal(character.legacyGraphics?.battleTiles.length, 64, `minor ${minor}: 64 battle tiles`);
    equal(character.legacyGraphics?.restTiles.length, 4, `minor ${minor}: 4 rest tiles`);
    equal(character.legacyGraphics?.customFrames.length, 10, `minor ${minor}: 10 custom frames`);
    const firstWalk = character.legacyGraphics?.walkFrames[0];
    equal(firstWalk?.top, "walk_0_top");
    equal(firstWalk?.bottom, "walk_0_bottom");
    equal(character.legacyGraphics?.battleTiles[0], "battle_0");
    equal(character.legacyGraphics?.restTiles[0], "rest_0");
    const firstCustom = character.legacyGraphics?.customFrames[0];
    equal(firstCustom?.top, "custom_0_top");
    equal(firstCustom?.bottom, "custom_0_bottom");
    deepEqual(unwrap(writeCharacter(character)), bytes, `minor ${minor}: byte-identical round-trip`);
  }
});

test("character: the writer refuses minor < 5 characters with missing or invalid legacy graphics", () => {
  const char = unwrap(readCharacter(new BinaryReader(buildCharacter({ minor: 4 }))));
  equal(writeCharacter({ ...char, legacyGraphics: undefined }).ok, false);
  const lg = char.legacyGraphics;
  if (lg !== undefined) {
    const badWalk = { ...lg, walkFrames: lg.walkFrames.slice(0, 15) };
    equal(writeCharacter({ ...char, legacyGraphics: badWalk }).ok, false);
    const badBattle = { ...lg, battleTiles: lg.battleTiles.slice(0, 63) };
    equal(writeCharacter({ ...char, legacyGraphics: badBattle }).ok, false);
    const badRest = { ...lg, restTiles: lg.restTiles.slice(0, 3) };
    equal(writeCharacter({ ...char, legacyGraphics: badRest }).ok, false);
    const badCustom = { ...lg, customFrames: lg.customFrames.slice(0, 9) };
    equal(writeCharacter({ ...char, legacyGraphics: badCustom }).ok, false);
  }
});

test("item: the version-conditional rows at minor 2 and minor 6 round-trip", () => {
  for (const minor of [2, 6]) {
    const bytes = buildItem({ minor });
    const reader = new BinaryReader(bytes);
    const item = unwrap(readItem(reader));
    equal(item.minor, minor);
    equal(reader.remaining, 0, `minor ${minor}: trailing bytes`);
    equal(item.residue.length, 0, `minor ${minor}: residue`);
    deepEqual(unwrap(writeItem(item)), bytes, `minor ${minor}: byte-identical round-trip`);
  }

  // minor 2 keeps the i16 price rows and the legacy walk frames; minor 6 uses
  // the i32 rows plus movement and idle animations, but no vector bases.
  const item2 = unwrap(readItem(new BinaryReader(buildItem({ minor: 2 }))));
  equal(item2.legacyWalk?.frames.length, 16, "minor 2 walk frames");
  equal(item2.movementAnimations, undefined, "minor 2 has no movement animations");
  const item6 = unwrap(readItem(new BinaryReader(buildItem({ minor: 6 }))));
  equal(item6.legacyWalk, undefined, "minor 6 has no legacy walk");
  equal(item6.movementAnimations?.length, 8, "minor 6 movement animations");
  equal(item6.idleAnimations?.length, 8, "minor 6 idle animations");
  equal(item6.vectorBases, undefined, "minor 6 has no vector bases");
});

// --- Residue ----------------------------------------------------------------

test("trailing bytes after each actor are kept as residue and re-emitted verbatim", () => {
  const trailing = [0xde, 0xad, 0xbe, 0xef];

  const characterBytes = withTrailing(buildCharacter(), trailing);
  const characterResult = readCharacter(new BinaryReader(characterBytes));
  const character = unwrap(characterResult);
  equal(character.residue.length, trailing.length, "character residue");
  equal(
    warningsOf(characterResult).some((warning) => warning.includes("residue")),
    true,
    "character warning",
  );
  deepEqual(unwrap(writeCharacter(character)), characterBytes, "character re-emit");

  const itemBytes = withTrailing(buildItem(), trailing);
  const itemResult = readItem(new BinaryReader(itemBytes));
  const item = unwrap(itemResult);
  equal(item.residue.length, trailing.length, "item residue");
  equal(
    warningsOf(itemResult).some((warning) => warning.includes("residue")),
    true,
    "item warning",
  );
  deepEqual(unwrap(writeItem(item)), itemBytes, "item re-emit");

  const enemyBytes = withTrailing(buildEnemy(), trailing);
  const enemyResult = readEnemy(new BinaryReader(enemyBytes));
  const enemy = unwrap(enemyResult);
  equal(enemy.residue.length, trailing.length, "enemy residue");
  equal(
    warningsOf(enemyResult).some((warning) => warning.includes("residue")),
    true,
    "enemy warning",
  );
  deepEqual(unwrap(writeEnemy(enemy)), enemyBytes, "enemy re-emit");
});

// --- Raw stored flags -------------------------------------------------------

test("non-canonical flag bytes are kept verbatim, not normalised", () => {
  const bodySlots = [1, 2, 3, 4, 5, 6, 7];
  const characterBytes = buildCharacter({
    hasSpecialMoves: 2,
    levelUpType: 3,
    sizeType: 127,
    bodySlots,
  });
  const character = unwrap(readCharacter(new BinaryReader(characterBytes)));
  equal(character.hasSpecialMoves, 2, "hasSpecialMoves kept raw");
  equal(character.levelUpType, 3, "levelUpType kept raw");
  equal(character.sizeType, 127, "sizeType kept raw");
  deepEqual(character.bodySlots, bodySlots, "body slots kept raw");
  deepEqual(unwrap(writeCharacter(character)), characterBytes, "character re-emit");

  const flags = [2, -1, 127, -128, 3];
  const itemBytes = buildItem({ flags });
  const item = unwrap(readItem(new BinaryReader(itemBytes)));
  deepEqual([item.equipable, item.menuUsable, item.boardUsable, item.battleUsable, item.usedBy], flags);
  deepEqual(unwrap(writeItem(item)), itemBytes, "item flag re-emit");

  const enemyBytes = buildEnemy({ canRun: 2, customAi: 5 });
  const enemy = unwrap(readEnemy(new BinaryReader(enemyBytes)));
  equal(enemy.canRun, 2, "canRun kept raw");
  equal(enemy.customAi, 5, "customAi kept raw");
  deepEqual(unwrap(writeEnemy(enemy)), enemyBytes, "enemy flag re-emit");
});

// --- Located errors ---------------------------------------------------------

test("a wrong magic is a located error at offset 0 in each section", () => {
  const cases: readonly { readonly bytes: Uint8Array; readonly read: (reader: BinaryReader) => Result<unknown>; readonly section: string }[] = [
    { bytes: buildCharacter({ magic: "RPGTLKIT CHAP" }), read: readCharacter, section: CHARACTER_SECTION },
    { bytes: buildItem({ magic: "RPGTLKIT ITEN" }), read: readItem, section: ITEM_SECTION },
    { bytes: buildEnemy({ magic: "RPGTLKIT ENEMZ" }), read: readEnemy, section: ENEMY_SECTION },
  ];
  for (const { bytes, read, section } of cases) {
    const error = readError(bytes, read);
    equal(error.offset, 0, `${section}: offset`);
    equal(error.section, section, "section");
  }
});

test("each actor format accepts the ends of its minor range", () => {
  for (const minor of [0, 8]) {
    const character = unwrap(readCharacter(new BinaryReader(buildCharacter({ minor }))));
    equal(character.minor, minor, `character minor ${minor}`);
  }
  for (const minor of [0, 7]) {
    const item = unwrap(readItem(new BinaryReader(buildItem({ minor }))));
    equal(item.minor, minor, `item minor ${minor}`);
  }
  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy({ minor: 1 }))));
  equal(enemy.minor, 1, "enemy minor 1");
});

test("an unsupported minor is a located error on the minor field", () => {
  // One above each accepted range's top: 9 > 8(docs/spec/formats/character.md#layout), 8 > 7(docs/spec/formats/item.md#layout) and the
  // only binary enemy minor is 1(docs/spec/formats/enemy.md#layout). An enemy at minor 0 is a binary
  // 2.0-form file (byte 14 is 0), so it too is refused on the version.
  const above: readonly [string, number, Uint8Array, string][] = [
    ["character", 16, buildCharacter({ minor: 9 }), CHARACTER_SECTION],
    ["character", 16, buildCharacter({ minor: 99 }), CHARACTER_SECTION],
    ["item", 16, buildItem({ minor: 8 }), ITEM_SECTION],
    ["item", 16, buildItem({ minor: 99 }), ITEM_SECTION],
    ["enemy", 17, buildEnemy({ minor: 0 }), ENEMY_SECTION],
    ["enemy", 17, buildEnemy({ minor: 2 }), ENEMY_SECTION],
  ];
  const readers: Record<string, (reader: BinaryReader) => Result<{ readonly minor: number }>> = {
    character: readCharacter,
    item: readItem,
    enemy: readEnemy,
  };
  for (const [name, offset, bytes, section] of above) {
    const error = readError(bytes, readers[name]!);
    equal(error.offset, offset, `${name} minor field`);
    equal(error.section, section, `${name} section`);
  }
});

test("a negative minor is refused at its own byte in each actor format", () => {
  const cases: readonly [string, number, Uint8Array][] = [
    ["character", 16, buildCharacter({ minor: -1 })],
    ["item", 16, buildItem({ minor: -1 })],
    ["enemy", 17, buildEnemy({ minor: -1 })],
  ];
  const readers: Record<string, (reader: BinaryReader) => Result<{ readonly minor: number }>> = {
    character: readCharacter,
    item: readItem,
    enemy: readEnemy,
  };
  for (const [name, offset, bytes] of cases) {
    const error = readError(bytes, readers[name]!);
    equal(error.offset, offset, `${name} minor field`);
    equal(error.section, "docs/spec/formats/README.md#header-and-version", `${name} negative minor section`);
  }
});

test("a 2.x text file is parsed or reports located error at invalid line", () => {
  const tem = readError(ascii("RPGTLKIT CHAR\r\nname=Frap\r\n"), readCharacter);
  equal(tem.offset, 15);
  equal(tem.section, CHARACTER_SECTION);

  const itm = readError(ascii("RPGTLKIT ITEM\r\nname=man\r\n"), readItem);
  equal(itm.offset, 15);
  equal(itm.section, ITEM_SECTION);

  const ene = readError(ascii("RPGTLKIT ENEMY\r\nname=Pirate\r\n"), readEnemy);
  equal(ene.offset, 16);
  equal(ene.section, ENEMY_SECTION);
});

test("a truncated file is a located error, never a throw", () => {
  const full = buildCharacter();
  const stub = readError(full.slice(0, 6), readCharacter);
  equal(stub.offset, 0, "the magic string is unterminated");
  equal(stub.section, "docs/spec/formats/README.md#primitive-encoding");

  // Truncated in the middle of the fixed 9-name block: the reader stops on the
  // first missing NUL rather than running past the end.
  const short = readError(full.slice(0, 20), readCharacter);
  equal(short.section, "docs/spec/formats/README.md#primitive-encoding");
});

test("the writers report an unencodable string and a wrong fixed-block length", () => {
  // A character with a Windows-1252-unencodable name, a per-level block with
  // three entries instead of four, and a special-move list that is one slot
  // short: each is a located writer error, never a silently truncated file.
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const badName = writeError({ ...character, name: "hero\u0100" }, writeCharacter);
  equal(badName.section, CHARACTER_SECTION, "unencodable character name");
  const shortIncreases = writeError({ ...character, levelIncreases: [1, 2, 3] }, writeCharacter);
  equal(shortIncreases.section, CHARACTER_SECTION, "wrong per-level increase count");
  const shortMoves = writeError(
    { ...character, specialMoves: character.specialMoves.slice(0, 200) },
    writeCharacter,
  );
  equal(shortMoves.section, CHARACTER_SECTION, "wrong special-move count");

  const item = unwrap(readItem(new BinaryReader(buildItem())));
  const badItemName = writeError({ ...item, name: "man\u0100" }, writeItem);
  equal(badItemName.section, ITEM_SECTION, "unencodable item name");
  const shortBonuses = writeError({ ...item, equipBonus: [1, 2, 3] }, writeItem);
  equal(shortBonuses.section, ITEM_SECTION, "wrong equip-bonus count");

  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy())));
  const badEnemyName = writeError({ ...enemy, name: "pirate\u0100" }, writeEnemy);
  equal(badEnemyName.section, ENEMY_SECTION, "unencodable enemy name");
});

// --- Sample fixtures (guard-rail G5 rule 4: fetched, never committed) -------

/** Every path under `root` whose lower-cased name ends with one of `suffixes`. */
function collect(root: string, suffixes: readonly string[]): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true })
    .filter((name) => suffixes.some((suffix) => name.toLowerCase().endsWith(suffix)))
    .map((name) => join(root, name));
}

const sampleActors = [
  ...collect(join(repoRoot, "fixtures", "legacy", "demo"), [".tem", ".itm", ".ene"]),
  ...collect(join(repoRoot, "fixtures", "legacy", "Basic"), [".tem", ".itm", ".ene"]),
];

/**
 * Find the fetched sample whose path ends with `suffix`, failing when it was
 * not fetched: a layout test that silently skips a missing fixture would pass
 * without checking anything.
 */
function sample(suffix: string): string {
  const path = sampleActors.find((candidate) => candidate.endsWith(suffix));
  if (path === undefined) {
    throw new Error(`expected sample fixture ${suffix} was not found under fixtures/legacy`);
  }
  return path;
}

/** Check one parsed sample: no trailing bytes, no residue, exact round-trip. */
function checkActor<T extends { readonly residue: Uint8Array }>(
  path: string,
  bytes: Uint8Array,
  reader: BinaryReader,
  result: Result<T>,
  write: (model: T) => Result<Uint8Array>,
): void {
  if (!result.ok) {
    throw new Error(`${path}: ${result.error.message} (offset ${result.error.offset})`);
  }
  // The readers absorb trailing bytes into `residue`, so `remaining === 0`
  // alone would hold even if the layout stopped matching the bytes. Asserting
  // an empty residue makes a field read at the wrong width fail here instead.
  equal(reader.remaining, 0, `${path}: trailing bytes`);
  equal(result.value.residue.length, 0, `${path}: ${result.value.residue.length} byte(s) of residue`);
  equal(
    result.warnings.filter((warning) => warning.includes("residue")).length,
    0,
    `${path}: residue warning`,
  );
  deepEqual(unwrap(write(result.value)), bytes, `${path}: byte-identical round-trip`);
}

test(
  "every sample actor parses with zero trailing bytes and round-trips exactly",
  { skip: sampleActors.length === 0 ? "legacy fixtures are not fetched" : false },
  () => {
    for (const path of sampleActors) {
      const bytes = new Uint8Array(readFileSync(path));
      const reader = new BinaryReader(bytes, path);
      const lower = path.toLowerCase();
      if (lower.endsWith(".tem")) {
        checkActor(path, bytes, reader, readCharacter(reader), writeCharacter);
      } else if (lower.endsWith(".itm")) {
        checkActor(path, bytes, reader, readItem(reader), writeItem);
      } else {
        checkActor(path, bytes, reader, readEnemy(reader), writeEnemy);
      }
    }
  },
);

test(
  "the shipped demo actor samples pin their documented layouts",
  { skip: sampleActors.length === 0 ? "legacy fixtures are not fetched" : false },
  () => {
    const startTem = sample(join("demo", "Chrs", "start.tem"));
    const startBytes = new Uint8Array(readFileSync(startTem));
    const character = unwrap(readCharacter(new BinaryReader(startBytes, startTem)));
    equal(character.minor, 8);
    equal(character.bodySlots.length, 7);
    equal(character.bodySlots[0], 0, "byte 0 is padding");
    equal(character.idleTime, 3, "characters store idleTime first");
    equal(character.speed, 0.05);
    equal(character.vectorBases?.length, 2, "stored bound 1 means two bases");
    equal(character.maxLevel, 0, "0 disables level progression");

    const manItm = sample(join("demo", "Item", "man.itm"));
    const manBytes = new Uint8Array(readFileSync(manItm));
    const item = unwrap(readItem(new BinaryReader(manBytes, manItm)));
    equal(item.minor, 7);
    equal(item.speed, 0.1, "items store speed first");
    equal(item.idleTime, 3);
    equal(item.vectorBases?.length, 2);

    // The two samples the layout test used to skip still pin their own round-trip.
    for (const [suffix, read] of [[join("Basic", "Chrs", "start.tem"), readCharacter], [join("demo", "Item", "oldman.itm"), readItem]] as const) {
      const path = sample(suffix);
      const bytes = new Uint8Array(readFileSync(path));
      const reader = new BinaryReader(bytes, path);
      checkActor(path, bytes, reader, read(reader), suffix.endsWith(".tem") ? writeCharacter : writeItem);
    }

    const pirateEne = sample(join("demo", "Enemy", "pirate.ene"));
    const pirateBytes = new Uint8Array(readFileSync(pirateEne));
    const enemy = unwrap(readEnemy(new BinaryReader(pirateBytes, pirateEne)));
    equal(enemy.minor, 1);
    equal(enemy.stances.length, 6, "stored bound 5 yields six slots");
    equal(enemy.stances[5], "", "slot 5 is unused");
  },
);

test("the committed character version examples parse with zero trailing bytes and round-trip", () => {
  for (const minor of [3, 4, 5, 6, 7, 8]) {
    const file = join(repoRoot, "docs", "spec", "examples", "versions", "character", `character_minor${minor}.tem`);
    const bytes = new Uint8Array(readFileSync(file));
    const reader = new BinaryReader(bytes, file);
    const character = unwrap(readCharacter(reader));
    equal(reader.remaining, 0, `minor ${minor}: trailing bytes`);
    equal(character.residue.length, 0, `minor ${minor}: residue bytes`);
    equal(character.minor, minor, `minor ${minor}: expected minor`);
    if (minor < 5) {
      equal(character.legacyGraphics !== undefined, true, `minor ${minor}: legacy graphics present`);
      equal(character.legacyGraphics?.walkFrames.length, 16, `minor ${minor}: 16 walk frames`);
      equal(character.legacyGraphics?.battleTiles.length, 64, `minor ${minor}: 64 battle tiles`);
      equal(character.legacyGraphics?.restTiles.length, 4, `minor ${minor}: 4 rest tiles`);
      equal(character.legacyGraphics?.customFrames.length, 10, `minor ${minor}: 10 custom frames`);
      equal(character.battleSounds?.length, 4, `minor ${minor}: 4 battle sounds`);
      equal(character.firstLevelExp, 50, `minor ${minor}: first-level exp`);
    } else {
      equal(character.legacyGraphics, undefined, `minor ${minor}: no legacy graphics`);
    }
    deepEqual(unwrap(writeCharacter(character)), bytes, `minor ${minor}: byte-identical round-trip`);
  }
});

// --- Writers refuse what their readers would refuse (#640 / 23.1) ------------------------------------------

/** The message a writer fails with, so a refusal can be checked for its named field and range. */
function refusal<T>(model: T, write: (model: T) => Result<Uint8Array>): string {
  const result = write(model);
  equal(result.ok, false, "the writer was expected to fail");
  if (result.ok) throw new Error("unreachable");
  return result.error.message;
}

test("a vector base or point list over the i16 upper bound is refused instead of wrapped", () => {
  // docs/spec/formats/character.md#layout stores both counts as an i16 upper bound, so 32768 is the
  // last representable count: a larger one wrapped to a negative bound that re-read as "none".
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const point = { x: 0, y: 0 };
  const tooManyPoints = refusal({ ...character, vectorBases: [{ points: Array.from({ length: 32_769 }, () => point) }] }, writeCharacter);
  equal(tooManyPoints.includes("32769"), true, tooManyPoints);
  equal(tooManyPoints.includes("32768"), true, tooManyPoints);
  const tooManyBases = refusal({ ...character, vectorBases: Array.from({ length: 32_769 }, () => ({ points: [] })) }, writeCharacter);
  equal(tooManyBases.includes("32769"), true, tooManyBases);

  const atBound = unwrap(writeCharacter({ ...character, vectorBases: [{ points: Array.from({ length: 32_768 }, () => point) }] }));
  const reread = unwrap(readCharacter(new BinaryReader(atBound)));
  equal(reread.vectorBases?.[0]?.points.length, 32_768, "the point bound itself is representable");
  deepEqual(unwrap(writeCharacter(reread)), atBound, "byte-identical round-trip at the point bound");

  const atBoundBases = unwrap(writeCharacter({ ...character, vectorBases: Array.from({ length: 32_768 }, () => ({ points: [] })) }));
  const basesReread = unwrap(readCharacter(new BinaryReader(atBoundBases)));
  equal(basesReread.vectorBases?.length, 32_768, "the base bound itself is representable");
  deepEqual(unwrap(writeCharacter(basesReread)), atBoundBases, "byte-identical round-trip at the base bound");
});

test("an i16 actor scalar outside its range is refused instead of wrapping", () => {
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const experience = refusal({ ...character, experienceIncrease: 40_000 }, writeCharacter);
  equal(experience.includes("experienceIncrease"), true, experience);
  equal(experience.includes("-32768..32767"), true, experience);
  const increase = refusal({ ...character, levelIncreases: [5, 40_000, 5, 5] }, writeCharacter);
  equal(increase.includes("levelIncreases[1]"), true, increase);

  // The extremes are representable and keep their bytes.
  const extremes = unwrap(writeCharacter({ ...character, experienceIncrease: -32_768, levelIncreases: [32_767, -32_768, 0, 1] }));
  const reread = unwrap(readCharacter(new BinaryReader(extremes)));
  equal(reread.experienceIncrease, -32_768);
  deepEqual(reread.levelIncreases, [32_767, -32_768, 0, 1]);

  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy())));
  const critical = refusal({ ...enemy, criticalOn: 40_000 }, writeEnemy);
  equal(critical.includes("criticalOn"), true, critical);
  const item = unwrap(readItem(new BinaryReader(buildItem())));
  const price = refusal({ ...item, minor: 2, buyPrice: 40_000 }, writeItem);
  equal(price.includes("buyPrice"), true, price);
  equal(price.includes("-32768..32767"), true, "a minor below 3 stores prices as i16");
});

test("a stored idle field the model omits is refused rather than written as zero", () => {
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter({ minor: 7 }))));
  const noIdle = refusal({ ...character, idleTime: undefined }, writeCharacter);
  equal(noIdle.includes("idleTime"), true, noIdle);
  const noSpeed = refusal({ ...character, speed: undefined }, writeCharacter);
  equal(noSpeed.includes("speed"), true, noSpeed);

  const item = unwrap(readItem(new BinaryReader(buildItem({ minor: 5 }))));
  const itemIdle = refusal({ ...item, idleTime: undefined }, writeItem);
  equal(itemIdle.includes("idleTime"), true, itemIdle);

  // Below the minor that stores them, absence is correct: the bytes are unchanged.
  const older = unwrap(readCharacter(new BinaryReader(buildCharacter({ minor: 6 }))));
  deepEqual(unwrap(writeCharacter({ ...older, idleTime: undefined, speed: undefined })), buildCharacter({ minor: 6 }));
});

test("an actor writer refuses a wrong magic and an unlisted minor", () => {
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const magic = refusal({ ...character, magic: "RPGTLKIT ITEM" }, writeCharacter);
  equal(magic.includes("\"RPGTLKIT CHAR\""), true, magic);
  const minor = refusal({ ...character, minor: 9 }, writeCharacter);
  equal(minor.includes("0..8"), true, minor);

  const item = unwrap(readItem(new BinaryReader(buildItem())));
  const itemMinor = refusal({ ...item, minor: 8 }, writeItem);
  equal(itemMinor.includes("0..7"), true, itemMinor);

  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy())));
  const enemyMinor = refusal({ ...enemy, minor: 2 }, writeEnemy);
  equal(enemyMinor.includes("unsupported minor version 2"), true, enemyMinor);
});

test("the remaining int and byte actor scalars are checked too", () => {
  // A stat, an enum byte and a fixed flag list each wrap in the same way an i16 does,
  // so each is refused with the field named rather than encoded as another value.
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const stat = refusal({ ...character, stats: { ...character.stats, hp: 2_147_483_648 } }, writeCharacter);
  equal(stat.includes("hp"), true, stat);
  const level = refusal({ ...character, maxLevel: 2_147_483_648 }, writeCharacter);
  equal(level.includes("maxLevel"), true, level);
  const flag = refusal({ ...character, hasSpecialMoves: 200 }, writeCharacter);
  equal(flag.includes("hasSpecialMoves"), true, flag);
  const bodySlot = refusal({ ...character, bodySlots: [0, 1, 200, 1, 1, 1, 1] }, writeCharacter);
  equal(bodySlot.includes("body slots[2]"), true, bodySlot);
  const sizeType = refusal({ ...character, sizeType: 200 }, writeCharacter);
  equal(sizeType.includes("sizeType"), true, sizeType);

  const item = unwrap(readItem(new BinaryReader(buildItem())));
  const useFlag = refusal({ ...item, equipable: 200 }, writeItem);
  equal(useFlag.includes("use flags[0]"), true, useFlag);

  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy())));
  const enemyHp = refusal({ ...enemy, hp: 2_147_483_648 }, writeEnemy);
  equal(enemyHp.includes("hp"), true, enemyHp);
  const ai = refusal({ ...enemy, aiLevel: 200 }, writeEnemy);
  equal(ai.includes("aiLevel"), true, ai);
  const reward = refusal({ ...enemy, experienceReward: 2_147_483_648 }, writeEnemy);
  equal(reward.includes("experienceReward"), true, reward);
});

test("each actor writer refuses a negative major and accepts 0", () => {
  // docs/spec/formats/README.md#header-and-version rules a negative version field invalid, and every reader
  // refuses one at its major field, so the writer must not hand back such a file.
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  const characterMajor = refusal({ ...character, major: -1 }, writeCharacter);
  equal(characterMajor.includes("major version -1"), true, characterMajor);
  const zero = unwrap(readCharacter(new BinaryReader(unwrap(writeCharacter({ ...character, major: 0 })))));
  equal(zero.major, 0, "a zero major is a version the reader accepts");

  const item = unwrap(readItem(new BinaryReader(buildItem())));
  equal(refusal({ ...item, major: -1 }, writeItem).includes("major version -1"), true);

  const enemy = unwrap(readEnemy(new BinaryReader(buildEnemy())));
  equal(refusal({ ...enemy, major: -1 }, writeEnemy).includes("major version -1"), true);
});

test("each width refuses one past both ends and accepts both ends", () => {
  // The boundary itself must stay representable: a check that also refused the
  // documented extremes would reject valid files.
  const character = unwrap(readCharacter(new BinaryReader(buildCharacter())));
  equal(refusal({ ...character, hasSpecialMoves: 128 }, writeCharacter).includes("i8 field holds -128..127"), true);
  equal(unwrap(readCharacter(new BinaryReader(unwrap(writeCharacter({ ...character, hasSpecialMoves: 127 }))))).hasSpecialMoves, 127);
  equal(unwrap(readCharacter(new BinaryReader(unwrap(writeCharacter({ ...character, hasSpecialMoves: -128 }))))).hasSpecialMoves, -128);

  equal(refusal({ ...character, experienceIncrease: 32_768 }, writeCharacter).includes("i16 field holds -32768..32767"), true);
  equal(refusal({ ...character, experienceIncrease: -32_769 }, writeCharacter).includes("i16 field holds -32768..32767"), true);

  equal(refusal({ ...character, maxLevel: 2_147_483_648 }, writeCharacter).includes("i32 field holds -2147483648..2147483647"), true);
  equal(refusal({ ...character, maxLevel: -2_147_483_649 }, writeCharacter).includes("i32 field holds -2147483648..2147483647"), true);
  const maxLevel = unwrap(readCharacter(new BinaryReader(unwrap(writeCharacter({ ...character, maxLevel: 2_147_483_647 })))));
  equal(maxLevel.maxLevel, 2_147_483_647, "the i32 maximum is representable");
});

test("the committed item version examples parse with zero trailing bytes and round-trip", () => {
  for (const minor of [2, 3, 4, 5, 6, 7]) {
    const file = join(repoRoot, "docs", "spec", "examples", "versions", "item", `item_minor${minor}.itm`);
    const bytes = new Uint8Array(readFileSync(file));
    const reader = new BinaryReader(bytes, file);
    const item = unwrap(readItem(reader));
    equal(reader.remaining, 0, `minor ${minor}: trailing bytes`);
    equal(item.residue.length, 0, `minor ${minor}: residue bytes`);
    equal(item.minor, minor, `minor ${minor}: expected minor`);
    deepEqual(unwrap(writeItem(item)), bytes, `minor ${minor}: byte-identical round-trip`);
  }
  const enemyFile = join(repoRoot, "docs", "spec", "examples", "versions", "enemy", "enemy_minor1.ene");
  const enemyBytes = new Uint8Array(readFileSync(enemyFile));
  const enemyReader = new BinaryReader(enemyBytes, enemyFile);
  const enemy = unwrap(readEnemy(enemyReader));
  equal(enemyReader.remaining, 0, "the enemy example has no trailing bytes");
  deepEqual(unwrap(writeEnemy(enemy)), enemyBytes, "the enemy example round-trips byte-identically");
});
