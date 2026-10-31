/**
 * Reading and writing a player character (docs/spec/formats/character.md#layout, magic
 * `RPGTLKIT CHAR`).
 *
 * Pure (G2): both functions consume/produce a caller-supplied byte buffer and
 * never touch a host. The reader never throws (AD-18): a wrong magic, an
 * unsupported minor, the 2.x text form and a truncated file all come back as a
 * located `FormatError`. The writer emits the version the model carries and
 * reproduces the bytes `readCharacter` consumed exactly, so an unmodified
 * character writes back byte for byte.
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import {
  ACCESSORY_SLOT_COUNT,
  BATTLE_SOUND_COUNT,
  BATTLE_STANCE_SLOTS,
  BODY_SLOT_COUNT,
  CHARACTER_DETECT_OFFSET,
  CHARACTER_MAGIC,
  CHARACTER_MAX_MINOR,
  CHARACTER_MIN_MINOR,
  CHARACTER_SECTION,
  CHARACTER_VARIABLE_SLOTS,
  DIRECTIONAL_ANIMATION_COUNT,
  LEGACY_CHARACTER_BATTLE_TILE_COUNT,
  LEGACY_CHARACTER_CUSTOM_FRAME_COUNT,
  LEGACY_CHARACTER_REST_TILE_COUNT,
  LEGACY_CHARACTER_WALK_FRAME_COUNT,
  LEVEL_INCREASE_COUNT,
  SPECIAL_MOVE_SLOTS,
  actorError,
  readBases,
  readBytes,
  readStances,
  readStrings,
  writeBases,
  writeFixedBytes,
  writeFixedStrings,
  writeStances,
  writerError,
  type ActorBase,
  type ActorStance,
  type Character,
  type CharacterStats,
  type CharacterSpecialMove,
  type LegacyCharacterGraphics,
  type LegacyWalkFrame,
} from "./model.ts";

import { TextLineReader } from "../text/line-reader.ts";
import { checkMajor, checkI8, checkI16, checkI32, checkMagic, checkMinor } from "../validate.ts";

/** An empty placeholder character for zero-byte files (Z-1). */
export function createEmptyCharacter(): Character {
  return {
    magic: CHARACTER_MAGIC,
    major: 2,
    minor: 0,
    name: "",
    variableNames: Array(CHARACTER_VARIABLE_SLOTS).fill(""),
    stats: {
      experience: 0,
      hp: 0,
      maxHp: 0,
      dp: 0,
      fp: 0,
      smp: 0,
      maxSmp: 0,
      level: 0,
    },
    profilePicture: "",
    specialMoves: Array(SPECIAL_MOVE_SLOTS).fill({
      file: "",
      minExp: 0,
      minLevel: 0,
      condVar: "",
      condValue: "",
    }),
    specialMoveCategory: "",
    hasSpecialMoves: 1,
    accessorySlots: Array(ACCESSORY_SLOT_COUNT).fill(""),
    bodySlots: Array(BODY_SLOT_COUNT).fill(0),
    firstLevelExp: 0,
    experienceIncrease: 0,
    maxLevel: 0,
    levelIncreases: Array(LEVEL_INCREASE_COUNT).fill(0),
    battleSounds: undefined,
    levelUpProgram: "",
    levelUpType: 0,
    sizeType: 0,
    movementAnimations: undefined,
    battleStances: undefined,
    idleAnimations: undefined,
    idleTime: undefined,
    speed: undefined,
    customStances: undefined,
    vectorBases: undefined,
    legacyGraphics: undefined,
    residue: new Uint8Array(0),
  };
}

/** Parse a Toolkit 2 line-oriented text character (docs/spec/formats/legacy/text-formats.md#character). */
export function readTextCharacter(bytes: Uint8Array, path?: string): Result<Character> {
  const reader = new TextLineReader(bytes, path);

  const magic = reader.nextLine("magic", CHARACTER_SECTION);
  if (!magic.ok) return magic;
  if (magic.value.trim() !== CHARACTER_MAGIC) {
    return err({
      ...(path === undefined ? {} : { path }),
      offset: 0,
      section: CHARACTER_SECTION,
      message: `not a character: magic is "${magic.value}", expected "${CHARACTER_MAGIC}"`,
    });
  }

  const major = reader.nextInt("major", CHARACTER_SECTION);
  if (!major.ok) return major;
  const minor = reader.nextInt("minor", CHARACTER_SECTION);
  if (!minor.ok) return minor;

  const name = reader.nextLine("name", CHARACTER_SECTION);
  if (!name.ok) return name;

  const variableNames: string[] = [];
  for (let i = 0; i < CHARACTER_VARIABLE_SLOTS; i++) {
    const v = reader.nextLine(`variableNames[${i}]`, CHARACTER_SECTION);
    if (!v.ok) return v;
    variableNames.push(v.value);
  }

  const exp = reader.nextInt("experience", CHARACTER_SECTION, 0);
  if (!exp.ok) return exp;
  const hp = reader.nextInt("health", CHARACTER_SECTION, 0);
  if (!hp.ok) return hp;
  const maxHp = reader.nextInt("maxHealth", CHARACTER_SECTION, 0);
  if (!maxHp.ok) return maxHp;
  const dp = reader.nextInt("defense", CHARACTER_SECTION, 0);
  if (!dp.ok) return dp;
  const fp = reader.nextInt("fight", CHARACTER_SECTION, 0);
  if (!fp.ok) return fp;
  const smp = reader.nextInt("smp", CHARACTER_SECTION, 0);
  if (!smp.ok) return smp;
  const maxSmp = reader.nextInt("maxSmp", CHARACTER_SECTION, 0);
  if (!maxSmp.ok) return maxSmp;
  const level = reader.nextInt("level", CHARACTER_SECTION, 0);
  if (!level.ok) return level;

  const stats: CharacterStats = {
    experience: exp.value,
    hp: hp.value,
    maxHp: maxHp.value,
    dp: dp.value,
    fp: fp.value,
    smp: smp.value,
    maxSmp: maxSmp.value,
    level: level.value,
  };

  const profilePic = reader.nextLine("profilePic", CHARACTER_SECTION);
  if (!profilePic.ok) return profilePic;

  const specialMoves: CharacterSpecialMove[] = [];
  for (let i = 0; i < SPECIAL_MOVE_SLOTS; i++) {
    const file = reader.nextLine(`specialMove[${i}].file`, CHARACTER_SECTION);
    if (!file.ok) return file;
    const minExp = reader.nextInt(`specialMove[${i}].minExp`, CHARACTER_SECTION, 0);
    if (!minExp.ok) return minExp;
    const minLevel = reader.nextInt(`specialMove[${i}].minLevel`, CHARACTER_SECTION, 0);
    if (!minLevel.ok) return minLevel;
    const condVar = reader.nextLine(`specialMove[${i}].condVar`, CHARACTER_SECTION);
    if (!condVar.ok) return condVar;
    const condValue = reader.nextLine(`specialMove[${i}].condValue`, CHARACTER_SECTION);
    if (!condValue.ok) return condValue;

    specialMoves.push({
      file: file.value,
      minExp: minExp.value,
      minLevel: minLevel.value,
      condVar: condVar.value,
      condValue: condValue.value,
    });
  }

  const specialMoveCategory = reader.nextLine("specialMoveName", CHARACTER_SECTION);
  if (!specialMoveCategory.ok) return specialMoveCategory;
  const hasSpecialMoves = reader.nextInt("smYN", CHARACTER_SECTION, 1);
  if (!hasSpecialMoves.ok) return hasSpecialMoves;

  let sizeType = 0;
  if (minor.value > 0) {
    const st = reader.nextInt("sizeType", CHARACTER_SECTION, 0);
    if (!st.ok) return st;
    sizeType = st.value;
  }

  let legacyGraphics: LegacyCharacterGraphics | undefined;

  if (sizeType === 0) {
    for (let k = 0; k < 16 * 1024; k++) {
      const l = reader.nextLine("walkPixel", CHARACTER_SECTION);
      if (!l.ok) return l;
    }
    for (let k = 0; k < 4 * 1024 * 4; k++) {
      const l = reader.nextLine("battlePixel", CHARACTER_SECTION);
      if (!l.ok) return l;
    }
    for (let k = 0; k < 1024; k++) {
      const l = reader.nextLine("restPixel", CHARACTER_SECTION);
      if (!l.ok) return l;
    }
    for (let k = 0; k < 10 * 1024; k++) {
      const l = reader.nextLine("customPixel", CHARACTER_SECTION);
      if (!l.ok) return l;
    }
  } else {
    const walkFrames: LegacyWalkFrame[] = [];
    for (let k = 0; k < 16; k++) {
      const top = reader.nextLine(`walkFrame[${k}].top`, CHARACTER_SECTION);
      if (!top.ok) return top;
      const bottom = reader.nextLine(`walkFrame[${k}].bottom`, CHARACTER_SECTION);
      if (!bottom.ok) return bottom;
      walkFrames.push({ top: top.value, bottom: bottom.value });
    }
    const battleTiles: string[] = [];
    const restTiles: string[] = [];
    if (minor.value === 1) {
      for (let k = 0; k < 32; k++) {
        const l = reader.nextLine(`battleTile[${k}]`, CHARACTER_SECTION);
        if (!l.ok) return l;
        battleTiles.push(l.value);
      }
      for (let k = 0; k < 2; k++) {
        const l = reader.nextLine(`restTile[${k}]`, CHARACTER_SECTION);
        if (!l.ok) return l;
        restTiles.push(l.value);
      }
    } else {
      for (let k = 0; k < 64; k++) {
        const l = reader.nextLine(`battleTile[${k}]`, CHARACTER_SECTION);
        if (!l.ok) return l;
        battleTiles.push(l.value);
      }
      for (let k = 0; k < 4; k++) {
        const l = reader.nextLine(`restTile[${k}]`, CHARACTER_SECTION);
        if (!l.ok) return l;
        restTiles.push(l.value);
      }
    }
    const customFrames: LegacyWalkFrame[] = [];
    for (let k = 0; k < 10; k++) {
      const top = reader.nextLine(`customFrame[${k}].top`, CHARACTER_SECTION);
      if (!top.ok) return top;
      const bottom = reader.nextLine(`customFrame[${k}].bottom`, CHARACTER_SECTION);
      if (!bottom.ok) return bottom;
      customFrames.push({ top: top.value, bottom: bottom.value });
    }
    legacyGraphics = { walkFrames, battleTiles, restTiles, customFrames };
  }

  const accessorySlots: string[] = [""];
  for (let k = 1; k <= 10; k++) {
    const acc = reader.nextLine(`accessory[${k}]`, CHARACTER_SECTION);
    if (!acc.ok) return acc;
    accessorySlots.push(acc.value);
  }

  const bodySlots: number[] = [0];
  for (let k = 1; k <= 6; k++) {
    const slot = reader.nextInt(`bodySlot[${k}]`, CHARACTER_SECTION, 0);
    if (!slot.ok) return slot;
    bodySlots.push(slot.value);
  }

  const levelType = reader.nextInt("levelType", CHARACTER_SECTION, 0);
  if (!levelType.ok) return levelType;
  const expInc = reader.nextInt("experienceIncrease", CHARACTER_SECTION, 0);
  if (!expInc.ok) return expInc;
  const maxLevel = reader.nextInt("maxLevel", CHARACTER_SECTION, 0);
  if (!maxLevel.ok) return maxLevel;

  const levelIncreases: number[] = [];
  for (const field of ["levelHp", "levelDp", "levelFp", "levelSm"]) {
    const inc = reader.nextInt(field, CHARACTER_SECTION, 0);
    if (!inc.ok) return inc;
    levelIncreases.push(inc.value);
  }

  const battleSounds: string[] = [];
  for (const field of ["swipeSound", "defendSound", "specialSound", "deathSound"]) {
    const snd = reader.nextLine(field, CHARACTER_SECTION);
    if (!snd.ok) return snd;
    battleSounds.push(snd.value);
  }

  const levelUpPrg = reader.nextLine("levelUpProgram", CHARACTER_SECTION);
  if (!levelUpPrg.ok) return levelUpPrg;
  const levelUpType = reader.nextInt("levelUpType", CHARACTER_SECTION, 0);
  if (!levelUpType.ok) return levelUpType;

  const finished = reader.finish(CHARACTER_SECTION);
  if (!finished.ok) return finished;

  return ok({
    magic: CHARACTER_MAGIC,
    major: major.value,
    minor: minor.value,
    name: name.value,
    variableNames,
    stats,
    profilePicture: profilePic.value,
    specialMoves,
    specialMoveCategory: specialMoveCategory.value,
    hasSpecialMoves: hasSpecialMoves.value,
    accessorySlots,
    bodySlots,
    firstLevelExp: levelType.value,
    experienceIncrease: expInc.value,
    maxLevel: maxLevel.value,
    levelIncreases,
    battleSounds,
    levelUpProgram: levelUpPrg.value,
    levelUpType: levelUpType.value,
    sizeType,
    movementAnimations: undefined,
    battleStances: undefined,
    idleAnimations: undefined,
    idleTime: undefined,
    speed: undefined,
    customStances: undefined,
    vectorBases: undefined,
    legacyGraphics,
    residue: new Uint8Array(0),
  });
}

/** The minor whose first-level-exp field is an `i8` rather than an `i32`(docs/spec/formats/character.md#layout). */
const FIRST_LEVEL_EXP_I8_MINOR = 3;

/** Read one special-move slot (docs/spec/formats/character.md#layout). */
function readSpecialMove(reader: BinaryReader): Result<CharacterSpecialMove> {
  const file = reader.str();
  if (!file.ok) {
    return file;
  }
  const minExp = reader.i32();
  if (!minExp.ok) {
    return minExp;
  }
  const minLevel = reader.i32();
  if (!minLevel.ok) {
    return minLevel;
  }
  const condVar = reader.str();
  if (!condVar.ok) {
    return condVar;
  }
  const condValue = reader.str();
  if (!condValue.ok) {
    return condValue;
  }
  return ok({
    file: file.value,
    minExp: minExp.value,
    minLevel: minLevel.value,
    condVar: condVar.value,
    condValue: condValue.value,
  });
}


/** Read the 120 legacy tile names of a minor < 5 character(docs/spec/formats/character.md#layout). */
function readLegacyCharacterGraphics(
  reader: BinaryReader,
): Result<LegacyCharacterGraphics> {
  const walkFrames: LegacyWalkFrame[] = [];
  for (let i = 0; i < LEGACY_CHARACTER_WALK_FRAME_COUNT; i += 1) {
    const top = reader.str();
    if (!top.ok) {
      return top;
    }
    const bottom = reader.str();
    if (!bottom.ok) {
      return bottom;
    }
    walkFrames.push({ top: top.value, bottom: bottom.value });
  }

  const battleTiles = readStrings(reader, LEGACY_CHARACTER_BATTLE_TILE_COUNT);
  if (!battleTiles.ok) {
    return battleTiles;
  }

  const restTiles = readStrings(reader, LEGACY_CHARACTER_REST_TILE_COUNT);
  if (!restTiles.ok) {
    return restTiles;
  }

  const customFrames: LegacyWalkFrame[] = [];
  for (let i = 0; i < LEGACY_CHARACTER_CUSTOM_FRAME_COUNT; i += 1) {
    const top = reader.str();
    if (!top.ok) {
      return top;
    }
    const bottom = reader.str();
    if (!bottom.ok) {
      return bottom;
    }
    customFrames.push({ top: top.value, bottom: bottom.value });
  }

  return ok({
    walkFrames,
    battleTiles: battleTiles.value,
    restTiles: restTiles.value,
    customFrames,
  });
}
/** Read the eight `i32` initial stats in file order (docs/spec/formats/character.md#layout). */
function readStats(reader: BinaryReader): Result<CharacterStats> {
  const order: ("experience" | "hp" | "maxHp" | "dp" | "fp" | "smp" | "maxSmp" | "level")[] = [
    "experience",
    "hp",
    "maxHp",
    "dp",
    "fp",
    "smp",
    "maxSmp",
    "level",
  ];
  const stats: Record<string, number> = {};
  for (const name of order) {
    const value = reader.i32();
    if (!value.ok) {
      return value;
    }
    stats[name] = value.value;
  }
  return ok(stats as unknown as CharacterStats);
}

/** Read a character from `reader` (docs/spec/formats/character.md#layout). */
export function readCharacter(reader: BinaryReader): Result<Character> {
  const start = reader.offset;

  if (reader.remaining === 0) {
    return actorError(reader, start, CHARACTER_SECTION, "unexpected end of data reading magic: need 1 byte(s), 0 remain");
  }

  // docs/spec/formats/character.md#layout places the detection byte at offset 13, just past the magic; the probe
  // does not move the cursor, so the header is read first and the detection
  // checked before any header error — a text character has no binary magic.
  const detection = reader.isBinaryAt(start + CHARACTER_DETECT_OFFSET);
  if (detection.ok && !detection.value) {
    const bytes = reader.readBytes(reader.remaining);
    if (!bytes.ok) {
      return bytes;
    }
    return readTextCharacter(bytes.value, reader.path);
  }
  const header = reader.header();
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== CHARACTER_MAGIC) {
    return actorError(
      reader,
      start,
      CHARACTER_SECTION,
      `not a character: magic is "${header.value.magic}", expected "${CHARACTER_MAGIC}"`,
    );
  }
  if (header.value.minor < CHARACTER_MIN_MINOR || header.value.minor > CHARACTER_MAX_MINOR) {
    return actorError(
      reader,
      reader.offset - 2,
      CHARACTER_SECTION,
      `unsupported character minor version ${header.value.minor}: this reader implements ${CHARACTER_MIN_MINOR}..${CHARACTER_MAX_MINOR}`,
    );
  }
  const minor = header.value.minor;

  const name = reader.str();
  if (!name.ok) {
    return name;
  }
  const variableNames = readStrings(reader, CHARACTER_VARIABLE_SLOTS);
  if (!variableNames.ok) {
    return variableNames;
  }
  const stats = readStats(reader);
  if (!stats.ok) {
    return stats;
  }
  const profilePicture = reader.str();
  if (!profilePicture.ok) {
    return profilePicture;
  }

  const specialMoves: CharacterSpecialMove[] = [];
  for (let i = 0; i < SPECIAL_MOVE_SLOTS; i += 1) {
    const move = readSpecialMove(reader);
    if (!move.ok) {
      return move;
    }
    specialMoves.push(move.value);
  }

  const specialMoveCategory = reader.str();
  if (!specialMoveCategory.ok) {
    return specialMoveCategory;
  }
  const hasSpecialMoves = reader.i8();
  if (!hasSpecialMoves.ok) {
    return hasSpecialMoves;
  }
  const accessorySlots = readStrings(reader, ACCESSORY_SLOT_COUNT);
  if (!accessorySlots.ok) {
    return accessorySlots;
  }
  const bodySlots = readBytes(reader, BODY_SLOT_COUNT);
  if (!bodySlots.ok) {
    return bodySlots;
  }

  let firstLevelExp: number;
  if (minor === FIRST_LEVEL_EXP_I8_MINOR) {
    const value = reader.i8();
    if (!value.ok) {
      return value;
    }
    firstLevelExp = value.value;
  } else {
    const value = reader.i32();
    if (!value.ok) {
      return value;
    }
    firstLevelExp = value.value;
  }

  const experienceIncrease = reader.i16();
  if (!experienceIncrease.ok) {
    return experienceIncrease;
  }
  const maxLevel = reader.i32();
  if (!maxLevel.ok) {
    return maxLevel;
  }
  const levelIncreases: number[] = [];
  for (let i = 0; i < LEVEL_INCREASE_COUNT; i += 1) {
    const value = reader.i16();
    if (!value.ok) {
      return value;
    }
    levelIncreases.push(value.value);
  }

  let battleSounds: string[] | undefined;
  if (minor < 5) {
    const sounds = readStrings(reader, BATTLE_SOUND_COUNT);
    if (!sounds.ok) {
      return sounds;
    }
    battleSounds = sounds.value;
  }

  const levelUpProgram = reader.str();
  if (!levelUpProgram.ok) {
    return levelUpProgram;
  }
  const levelUpType = reader.i8();
  if (!levelUpType.ok) {
    return levelUpType;
  }
  const sizeType = reader.i8();
  if (!sizeType.ok) {
    return sizeType;
  }

  let movementAnimations: string[] | undefined;
  let battleStances: string[] | undefined;
  let idleAnimations: string[] | undefined;
  let idleTime: number | undefined;
  let speed: number | undefined;
  let customStances: ActorStance[] | undefined;
  let vectorBases: ActorBase[] | undefined;
  let legacyGraphics: LegacyCharacterGraphics | undefined;

  if (minor >= 5) {
    const movements = readStrings(reader, DIRECTIONAL_ANIMATION_COUNT);
    if (!movements.ok) {
      return movements;
    }
    movementAnimations = movements.value;
    const stances = readStrings(reader, BATTLE_STANCE_SLOTS);
    if (!stances.ok) {
      return stances;
    }
    battleStances = stances.value;
  }
  if (minor >= 6) {
    const idle = readStrings(reader, DIRECTIONAL_ANIMATION_COUNT);
    if (!idle.ok) {
      return idle;
    }
    idleAnimations = idle.value;
  }
  if (minor >= 7) {
    const idleSeconds = reader.f64();
    if (!idleSeconds.ok) {
      return idleSeconds;
    }
    idleTime = idleSeconds.value;
    const speedSeconds = reader.f64();
    if (!speedSeconds.ok) {
      return speedSeconds;
    }
    speed = speedSeconds.value;
  }
  if (minor >= 5) {
    const stances = readStances(reader, CHARACTER_SECTION);
    if (!stances.ok) {
      return stances;
    }
    customStances = stances.value;
  }
  if (minor >= 8) {
    const bases = readBases(reader, CHARACTER_SECTION);
    if (!bases.ok) {
      return bases;
    }
    vectorBases = bases.value;
  }
  if (minor < 5) {
    const legacy = readLegacyCharacterGraphics(reader);
    if (!legacy.ok) {
      return legacy;
    }
    legacyGraphics = legacy.value;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the character were kept as residue (docs/spec/formats/character.md#layout)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor,
      name: name.value,
      variableNames: variableNames.value,
      stats: stats.value,
      profilePicture: profilePicture.value,
      specialMoves,
      specialMoveCategory: specialMoveCategory.value,
      hasSpecialMoves: hasSpecialMoves.value,
      accessorySlots: accessorySlots.value,
      bodySlots: bodySlots.value,
      firstLevelExp,
      experienceIncrease: experienceIncrease.value,
      maxLevel: maxLevel.value,
      levelIncreases,
      battleSounds,
      levelUpProgram: levelUpProgram.value,
      levelUpType: levelUpType.value,
      sizeType: sizeType.value,
      movementAnimations,
      battleStances,
      idleAnimations,
      idleTime,
      speed,
      customStances,
      vectorBases,
      legacyGraphics,
      residue: residue.value,
    },
    warnings,
  );
}

/** Serialise `model` to the character layout (docs/spec/formats/character.md#layout). */
export function writeCharacter(model: Character): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, CHARACTER_SECTION, model.magic, CHARACTER_MAGIC);
  if (headerMagic !== undefined) return headerMagic;
  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return writerError(writer, CHARACTER_SECTION, `magic: ${magic.error.message}`);
  }
  const headerMajor = checkMajor(writer, CHARACTER_SECTION, model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  const headerMinor = checkMinor(writer, CHARACTER_SECTION, model.minor, CHARACTER_MIN_MINOR, CHARACTER_MAX_MINOR);
  if (headerMinor !== undefined) return headerMinor;
  writer.i16(model.minor);

  const name = writer.str(model.name);
  if (!name.ok) {
    return writerError(writer, CHARACTER_SECTION, `name: ${name.error.message}`);
  }
  const names = writeFixedStrings(
    writer,
    model.variableNames,
    CHARACTER_VARIABLE_SLOTS,
    CHARACTER_SECTION,
    "script variable names",
  );
  if (!names.ok) {
    return names;
  }

  const stats = [
    ["experience", model.stats.experience],
    ["hp", model.stats.hp],
    ["maxHp", model.stats.maxHp],
    ["dp", model.stats.dp],
    ["fp", model.stats.fp],
    ["smp", model.stats.smp],
    ["maxSmp", model.stats.maxSmp],
    ["level", model.stats.level],
  ] as const;
  for (const [field, value] of stats) {
    const checked = checkI32(writer, CHARACTER_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i32(value);
  }

  const profilePicture = writer.str(model.profilePicture);
  if (!profilePicture.ok) {
    return writerError(writer, CHARACTER_SECTION, `profile picture: ${profilePicture.error.message}`);
  }
  // docs/spec/formats/character.md#layout stores each special-move slot as one record, not two blocks: emit the
  // file, minExp, minLevel, condVar and condValue of a slot together, in the
  // order `readSpecialMove` reads them.
  if (model.specialMoves.length !== SPECIAL_MOVE_SLOTS) {
    return writerError(
      writer,
      CHARACTER_SECTION,
      `special moves need exactly ${SPECIAL_MOVE_SLOTS} entries but the model has ${model.specialMoves.length}`,
    );
  }
  for (const [index, move] of model.specialMoves.entries()) {
    const file = writer.str(move.file);
    if (!file.ok) {
      return writerError(writer, CHARACTER_SECTION, `special-move file: ${file.error.message}`);
    }
    for (const [field, value] of [["minExp", move.minExp], ["minLevel", move.minLevel]] as const) {
      const checked = checkI32(writer, CHARACTER_SECTION, `specialMoves[${index}].${field}`, value);
      if (checked !== undefined) return checked;
      writer.i32(value);
    }
    const condVar = writer.str(move.condVar);
    if (!condVar.ok) {
      return writerError(
        writer,
        CHARACTER_SECTION,
        `special-move condition variable: ${condVar.error.message}`,
      );
    }
    const condValue = writer.str(move.condValue);
    if (!condValue.ok) {
      return writerError(
        writer,
        CHARACTER_SECTION,
        `special-move condition value: ${condValue.error.message}`,
      );
    }
  }

  const specialMoveCategory = writer.str(model.specialMoveCategory);
  if (!specialMoveCategory.ok) {
    return writerError(
      writer,
      CHARACTER_SECTION,
      `special-move category: ${specialMoveCategory.error.message}`,
    );
  }
  const hasSpecialMoves = checkI8(writer, CHARACTER_SECTION, "hasSpecialMoves", model.hasSpecialMoves);
  if (hasSpecialMoves !== undefined) return hasSpecialMoves;
  writer.i8(model.hasSpecialMoves);
  const accessories = writeFixedStrings(
    writer,
    model.accessorySlots,
    ACCESSORY_SLOT_COUNT,
    CHARACTER_SECTION,
    "accessory slot names",
  );
  if (!accessories.ok) {
    return accessories;
  }
  const body = writeFixedBytes(
    writer,
    model.bodySlots,
    BODY_SLOT_COUNT,
    CHARACTER_SECTION,
    "body slots",
  );
  if (!body.ok) {
    return body;
  }

  if (model.minor === FIRST_LEVEL_EXP_I8_MINOR) {
    const firstLevel = checkI8(writer, CHARACTER_SECTION, "firstLevelExp", model.firstLevelExp);
    if (firstLevel !== undefined) return firstLevel;
    writer.i8(model.firstLevelExp);
  } else {
    const firstLevel = checkI32(writer, CHARACTER_SECTION, "firstLevelExp", model.firstLevelExp);
    if (firstLevel !== undefined) return firstLevel;
    writer.i32(model.firstLevelExp);
  }
  const experience = checkI16(writer, CHARACTER_SECTION, "experienceIncrease", model.experienceIncrease);
  if (experience !== undefined) return experience;
  writer.i16(model.experienceIncrease);
  const maxLevel = checkI32(writer, CHARACTER_SECTION, "maxLevel", model.maxLevel);
  if (maxLevel !== undefined) return maxLevel;
  writer.i32(model.maxLevel);
  if (model.levelIncreases.length !== LEVEL_INCREASE_COUNT) {
    return writerError(
      writer,
      CHARACTER_SECTION,
      `per-level increases need exactly ${LEVEL_INCREASE_COUNT} entries but the model has ${model.levelIncreases.length}`,
    );
  }
  for (const [index, value] of model.levelIncreases.entries()) {
    const increase = checkI16(writer, CHARACTER_SECTION, `levelIncreases[${index}]`, value);
    if (increase !== undefined) return increase;
    writer.i16(value);
  }

  if (model.minor < 5) {
    const sounds = model.battleSounds ?? [];
    const written = writeFixedStrings(
      writer,
      sounds,
      BATTLE_SOUND_COUNT,
      CHARACTER_SECTION,
      "obsolete battle sounds",
    );
    if (!written.ok) {
      return written;
    }
  }

  const levelUpProgram = writer.str(model.levelUpProgram);
  if (!levelUpProgram.ok) {
    return writerError(writer, CHARACTER_SECTION, `level-up program: ${levelUpProgram.error.message}`);
  }
  for (const [field, value] of [["levelUpType", model.levelUpType], ["sizeType", model.sizeType]] as const) {
    const checked = checkI8(writer, CHARACTER_SECTION, field, value);
    if (checked !== undefined) return checked;
  }
  writer.i8(model.levelUpType);
  writer.i8(model.sizeType);
  if (model.minor < 5) {
    const legacy = model.legacyGraphics;
    if (legacy === undefined) {
      return writerError(
        writer,
        CHARACTER_SECTION,
        "a minor < 5 character requires legacy graphics",
      );
    }
    if (legacy.walkFrames.length !== LEGACY_CHARACTER_WALK_FRAME_COUNT) {
      return writerError(
        writer,
        CHARACTER_SECTION,
        `a minor < 5 character needs exactly ${LEGACY_CHARACTER_WALK_FRAME_COUNT} legacy walk frames but has ${legacy.walkFrames.length}`,
      );
    }
    for (const frame of legacy.walkFrames) {
      const top = writer.str(frame.top);
      if (!top.ok) {
        return writerError(writer, CHARACTER_SECTION, `legacy walk frame top: ${top.error.message}`);
      }
      const bottom = writer.str(frame.bottom);
      if (!bottom.ok) {
        return writerError(writer, CHARACTER_SECTION, `legacy walk frame bottom: ${bottom.error.message}`);
      }
    }
    const battle = writeFixedStrings(
      writer,
      legacy.battleTiles,
      LEGACY_CHARACTER_BATTLE_TILE_COUNT,
      CHARACTER_SECTION,
      "legacy battle tiles",
    );
    if (!battle.ok) {
      return battle;
    }
    const rest = writeFixedStrings(
      writer,
      legacy.restTiles,
      LEGACY_CHARACTER_REST_TILE_COUNT,
      CHARACTER_SECTION,
      "legacy rest tiles",
    );
    if (!rest.ok) {
      return rest;
    }
    if (legacy.customFrames.length !== LEGACY_CHARACTER_CUSTOM_FRAME_COUNT) {
      return writerError(
        writer,
        CHARACTER_SECTION,
        `a minor < 5 character needs exactly ${LEGACY_CHARACTER_CUSTOM_FRAME_COUNT} legacy custom frames but has ${legacy.customFrames.length}`,
      );
    }
    for (const frame of legacy.customFrames) {
      const top = writer.str(frame.top);
      if (!top.ok) {
        return writerError(writer, CHARACTER_SECTION, `legacy custom frame top: ${top.error.message}`);
      }
      const bottom = writer.str(frame.bottom);
      if (!bottom.ok) {
        return writerError(writer, CHARACTER_SECTION, `legacy custom frame bottom: ${bottom.error.message}`);
      }
    }
  }

  if (model.minor >= 5) {
    const movements = writeFixedStrings(
      writer,
      model.movementAnimations ?? [],
      DIRECTIONAL_ANIMATION_COUNT,
      CHARACTER_SECTION,
      "movement animations",
    );
    if (!movements.ok) {
      return movements;
    }
    const stances = writeFixedStrings(
      writer,
      model.battleStances ?? [],
      BATTLE_STANCE_SLOTS,
      CHARACTER_SECTION,
      "battle stances",
    );
    if (!stances.ok) {
      return stances;
    }
  }
  if (model.minor >= 6) {
    const idle = writeFixedStrings(
      writer,
      model.idleAnimations ?? [],
      DIRECTIONAL_ANIMATION_COUNT,
      CHARACTER_SECTION,
      "idle animations",
    );
    if (!idle.ok) {
      return idle;
    }
  }
  if (model.minor >= 7) {
    // The layout stores them from minor 7 on, so a model without them cannot be
    // encoded: the placeholder `0` would record an idle time of 0 seconds, not
    // the documented 3.0 s default.
    if (model.idleTime === undefined) {
      return writerError(writer, CHARACTER_SECTION, "idleTime is undefined but minor >= 7 stores it (docs/spec/formats/character.md#layout row 32)");
    }
    if (model.speed === undefined) {
      return writerError(writer, CHARACTER_SECTION, "speed is undefined but minor >= 7 stores it (docs/spec/formats/character.md#layout row 33)");
    }
    writer.f64(model.idleTime);
    writer.f64(model.speed);
  }
  if (model.minor >= 5) {
    const stances = writeStances(writer, model.customStances ?? [], CHARACTER_SECTION);
    if (!stances.ok) {
      return stances;
    }
  }
  if (model.minor >= 8) {
    const bases = writeBases(writer, model.vectorBases ?? [], CHARACTER_SECTION);
    if (!bases.ok) {
      return bases;
    }
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}
