/**
 * Reading and writing an enemy (docs/spec/formats/enemy.md#layout, magic `RPGTLKIT ENEMY`).
 *
 * Pure (G2). `readEnemy` dispatches on the minor: the binary 2.1 form, minor 1,
 * and the 2.0 line-oriented text form, minor 0 (`readTextEnemy`).
 * The reader never throws (AD-18) and the writer reproduces the bytes
 * `readEnemy` consumed exactly, including the unused stance slot 5 and the
 * empty files of the bounded lists.
 */

import { ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { checkMajor, checkI8, checkI16, checkI32, checkMagic, checkMinor } from "../validate.ts";
import {
  ENEMY_BINARY_MINOR,
  ENEMY_DETECT_OFFSET,
  ENEMY_MAGIC,
  ENEMY_SECTION,
  actorError,
  readBoundedStrings,
  readStances,
  writeBoundedStrings,
  writeStances,
  writerError,
  type Enemy,
} from "./model.ts";

/** Read an enemy from `reader` (docs/spec/formats/enemy.md#layout). */
export function readEnemy(reader: BinaryReader): Result<Enemy> {
  const start = reader.offset;
  const header = reader.header();
  // docs/spec/formats/enemy.md#layout places the detection byte at offset 14, just past the magic; the probe
  // does not move the cursor, so the header is read first and the detection
  // checked before any header error.
  const detection = reader.isBinaryAt(start + ENEMY_DETECT_OFFSET);
  if (detection.ok && !detection.value) {
    return readTextEnemy(reader);
  }
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== ENEMY_MAGIC) {
    return actorError(
      reader,
      start,
      ENEMY_SECTION,
      `not an enemy: magic is "${header.value.magic}", expected "${ENEMY_MAGIC}"`,
    );
  }
  if (header.value.minor !== ENEMY_BINARY_MINOR) {
    return actorError(
      reader,
      reader.offset - 2,
      ENEMY_SECTION,
      `unsupported enemy minor version ${header.value.minor}: only the binary 2.1 form (minor ${ENEMY_BINARY_MINOR}) exists`,
    );
  }

  const name = reader.str();
  if (!name.ok) {
    return name;
  }
  const hp = reader.i32();
  if (!hp.ok) {
    return hp;
  }
  const smp = reader.i32();
  if (!smp.ok) {
    return smp;
  }
  const fp = reader.i32();
  if (!fp.ok) {
    return fp;
  }
  const dp = reader.i32();
  if (!dp.ok) {
    return dp;
  }
  const canRun = reader.i8();
  if (!canRun.ok) {
    return canRun;
  }
  const criticalOn = reader.i16();
  if (!criticalOn.ok) {
    return criticalOn;
  }
  const criticalBy = reader.i16();
  if (!criticalBy.ok) {
    return criticalBy;
  }

  const specialMoves = readBoundedStrings(reader);
  if (!specialMoves.ok) {
    return specialMoves;
  }
  const weaknesses = readBoundedStrings(reader);
  if (!weaknesses.ok) {
    return weaknesses;
  }
  const strengths = readBoundedStrings(reader);
  if (!strengths.ok) {
    return strengths;
  }

  const aiLevel = reader.i8();
  if (!aiLevel.ok) {
    return aiLevel;
  }
  const customAi = reader.i8();
  if (!customAi.ok) {
    return customAi;
  }
  const aiProgram = reader.str();
  if (!aiProgram.ok) {
    return aiProgram;
  }
  const experienceReward = reader.i32();
  if (!experienceReward.ok) {
    return experienceReward;
  }
  const goldReward = reader.i32();
  if (!goldReward.ok) {
    return goldReward;
  }
  const defeatProgram = reader.str();
  if (!defeatProgram.ok) {
    return defeatProgram;
  }
  const runAwayProgram = reader.str();
  if (!runAwayProgram.ok) {
    return runAwayProgram;
  }

  // The stance upper bound is stored as 5, yielding six slots 0..5; slot 5 is
  // unused, kept so the indices stay stable (docs/spec/formats/enemy.md#layout).
  const stances = readBoundedStrings(reader);
  if (!stances.ok) {
    return stances;
  }

  // The custom-stance bound is an `i32`, not the `i16` legacy readers used
  // (docs/spec/formats/enemy.md#layout).
  const customStances = readStances(reader, ENEMY_SECTION);
  if (!customStances.ok) {
    return customStances;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the enemy were kept as residue (docs/spec/formats/enemy.md#layout)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor: header.value.minor,
      name: name.value,
      hp: hp.value,
      smp: smp.value,
      fp: fp.value,
      dp: dp.value,
      canRun: canRun.value,
      criticalOn: criticalOn.value,
      criticalBy: criticalBy.value,
      specialMoves: specialMoves.value,
      weaknesses: weaknesses.value,
      strengths: strengths.value,
      aiLevel: aiLevel.value,
      customAi: customAi.value,
      aiProgram: aiProgram.value,
      experienceReward: experienceReward.value,
      goldReward: goldReward.value,
      defeatProgram: defeatProgram.value,
      runAwayProgram: runAwayProgram.value,
      stances: stances.value,
      customStances: customStances.value,
      residue: residue.value,
    },
    warnings,
  );
}

/** Serialise `model` to the enemy layout (docs/spec/formats/enemy.md#layout). */
export function writeEnemy(model: Enemy): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, ENEMY_SECTION, model.magic, ENEMY_MAGIC);
  if (headerMagic !== undefined) return headerMagic;
  const headerMinor = checkMinor(writer, ENEMY_SECTION, model.minor, ENEMY_BINARY_MINOR, ENEMY_BINARY_MINOR);
  if (headerMinor !== undefined) return headerMinor;
  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return writerError(writer, ENEMY_SECTION, `magic: ${magic.error.message}`);
  }
  const headerMajor = checkMajor(writer, ENEMY_SECTION, model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  writer.i16(model.minor);

  const name = writer.str(model.name);
  if (!name.ok) {
    return writerError(writer, ENEMY_SECTION, `name: ${name.error.message}`);
  }
  const vitals = [["hp", model.hp], ["smp", model.smp], ["fp", model.fp], ["dp", model.dp]] as const;
  for (const [field, value] of vitals) {
    const checked = checkI32(writer, ENEMY_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i32(value);
  }
  const canRun = checkI8(writer, ENEMY_SECTION, "canRun", model.canRun);
  if (canRun !== undefined) return canRun;
  writer.i8(model.canRun);
  for (const [field, value] of [["criticalOn", model.criticalOn], ["criticalBy", model.criticalBy]] as const) {
    const checked = checkI16(writer, ENEMY_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i16(value);
  }

  const moves = writeBoundedStrings(writer, model.specialMoves, ENEMY_SECTION, "special moves");
  if (!moves.ok) {
    return moves;
  }
  const weaknesses = writeBoundedStrings(writer, model.weaknesses, ENEMY_SECTION, "weaknesses");
  if (!weaknesses.ok) {
    return weaknesses;
  }
  const strengths = writeBoundedStrings(writer, model.strengths, ENEMY_SECTION, "strengths");
  if (!strengths.ok) {
    return strengths;
  }

  for (const [field, value] of [["aiLevel", model.aiLevel], ["customAi", model.customAi]] as const) {
    const checked = checkI8(writer, ENEMY_SECTION, field, value);
    if (checked !== undefined) return checked;
  }
  writer.i8(model.aiLevel);
  writer.i8(model.customAi);
  const aiProgram = writer.str(model.aiProgram);
  if (!aiProgram.ok) {
    return writerError(writer, ENEMY_SECTION, `AI program: ${aiProgram.error.message}`);
  }
  for (const [field, value] of [["experienceReward", model.experienceReward], ["goldReward", model.goldReward]] as const) {
    const checked = checkI32(writer, ENEMY_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i32(value);
  }
  const defeatProgram = writer.str(model.defeatProgram);
  if (!defeatProgram.ok) {
    return writerError(writer, ENEMY_SECTION, `defeat program: ${defeatProgram.error.message}`);
  }
  const runAwayProgram = writer.str(model.runAwayProgram);
  if (!runAwayProgram.ok) {
    return writerError(writer, ENEMY_SECTION, `run-away program: ${runAwayProgram.error.message}`);
  }

  const stances = writeBoundedStrings(writer, model.stances, ENEMY_SECTION, "stance animations");
  if (!stances.ok) {
    return stances;
  }
  const custom = writeStances(writer, model.customStances, ENEMY_SECTION);
  if (!custom.ok) {
    return custom;
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}

/** Read a Toolkit 2 minor 0 text enemy (docs/spec/formats/legacy/text-formats.md#enemy). */
function readTextEnemy(reader: BinaryReader): Result<Enemy> {
  const lineReader = new TextLineReader(reader.bytes, reader.path, reader.offset);
  const header = lineReader.nextLine("header", ENEMY_SECTION);
  if (!header.ok) return header;
  if (header.value.trim().toUpperCase() !== ENEMY_MAGIC.toUpperCase()) {
    return actorError(
      reader,
      0,
      ENEMY_SECTION,
      `not an enemy: header is "${header.value}", expected "${ENEMY_MAGIC}"`,
    );
  }
  const major = lineReader.nextInt("major", ENEMY_SECTION);
  if (!major.ok) return major;
  const minor = lineReader.nextInt("minor", ENEMY_SECTION);
  if (!minor.ok) return minor;
  if (minor.value !== 0) {
    return actorError(
      reader,
      lineReader.offset,
      ENEMY_SECTION,
      `unsupported text enemy minor version ${minor.value}: expected 0`,
    );
  }
  const name = lineReader.nextLine("name", ENEMY_SECTION);
  if (!name.ok) return name;
  const hp = lineReader.nextInt("hp", ENEMY_SECTION);
  if (!hp.ok) return hp;
  const smp = lineReader.nextInt("smp", ENEMY_SECTION);
  if (!smp.ok) return smp;
  const fp = lineReader.nextInt("fp", ENEMY_SECTION);
  if (!fp.ok) return fp;
  const dp = lineReader.nextInt("dp", ENEMY_SECTION);
  if (!dp.ok) return dp;
  const canRun = lineReader.nextInt("canRun", ENEMY_SECTION);
  if (!canRun.ok) return canRun;
  const takeCrit = lineReader.nextInt("takeCrit", ENEMY_SECTION);
  if (!takeCrit.ok) return takeCrit;
  const giveCrit = lineReader.nextInt("giveCrit", ENEMY_SECTION);
  if (!giveCrit.ok) return giveCrit;

  const width = lineReader.nextInt("width", ENEMY_SECTION);
  if (!width.ok) return width;
  const height = lineReader.nextInt("height", ENEMY_SECTION);
  if (!height.ok) return height;

  // Fixed 19 x 7 tile grid = 133 lines (R-20)
  const tileGrid: string[] = [];
  for (let i = 0; i < 133; i++) {
    const tile = lineReader.nextLine(`tile[${i}]`, ENEMY_SECTION);
    if (!tile.ok) return tile;
    tileGrid.push(tile.value);
  }

  // 101 pairs of (specialMove, weakness) = 202 lines
  const specialMoves: string[] = [];
  const weaknesses: string[] = [];
  for (let i = 0; i < 101; i++) {
    const move = lineReader.nextLine(`specialMove[${i}]`, ENEMY_SECTION);
    if (!move.ok) return move;
    specialMoves.push(move.value);
    const weak = lineReader.nextLine(`weakness[${i}]`, ENEMY_SECTION);
    if (!weak.ok) return weak;
    weaknesses.push(weak.value);
  }

  const ai = lineReader.nextInt("ai", ENEMY_SECTION);
  if (!ai.ok) return ai;
  const useCode = lineReader.nextInt("useCode", ENEMY_SECTION);
  if (!useCode.ok) return useCode;
  const prg = lineReader.nextLine("prg", ENEMY_SECTION);
  if (!prg.ok) return prg;
  const exp = lineReader.nextInt("exp", ENEMY_SECTION);
  if (!exp.ok) return exp;
  const gp = lineReader.nextInt("gp", ENEMY_SECTION);
  if (!gp.ok) return gp;
  const winPrg = lineReader.nextLine("winPrg", ENEMY_SECTION);
  if (!winPrg.ok) return winPrg;
  const runPrg = lineReader.nextLine("runPrg", ENEMY_SECTION);
  if (!runPrg.ok) return runPrg;

  // 4 ignored lines (sound cues)
  for (let i = 0; i < 4; i++) {
    const ignored = lineReader.nextLine(`ignored[${i}]`, ENEMY_SECTION);
    if (!ignored.ok) return ignored;
  }

  // 4 combat animations: FIGHT, DEFEND, SPECIAL, DIE
  const fight = lineReader.nextLine("FIGHT animation", ENEMY_SECTION);
  if (!fight.ok) return fight;
  const defend = lineReader.nextLine("DEFEND animation", ENEMY_SECTION);
  if (!defend.ok) return defend;
  const special = lineReader.nextLine("SPECIAL animation", ENEMY_SECTION);
  if (!special.ok) return special;
  const die = lineReader.nextLine("DIE animation", ENEMY_SECTION);
  if (!die.ok) return die;

  const finished = lineReader.finish(ENEMY_SECTION);
  if (!finished.ok) return finished;

  reader.seek(lineReader.offset);

  return ok({
    magic: ENEMY_MAGIC,
    major: major.value,
    minor: minor.value,
    name: name.value,
    hp: hp.value,
    smp: smp.value,
    fp: fp.value,
    dp: dp.value,
    canRun: canRun.value,
    criticalOn: takeCrit.value,
    criticalBy: giveCrit.value,
    specialMoves,
    weaknesses,
    strengths: [],
    aiLevel: ai.value,
    customAi: useCode.value,
    aiProgram: prg.value,
    experienceReward: exp.value,
    goldReward: gp.value,
    defeatProgram: winPrg.value,
    runAwayProgram: runPrg.value,
    stances: ["", fight.value, defend.value, special.value, die.value, ""],
    customStances: [],
    residue: new Uint8Array(0),
    width: width.value,
    height: height.value,
    tileGrid,
  });
}
