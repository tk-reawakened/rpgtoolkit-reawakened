/**
 * Reading and writing a special move (`docs/spec/formats/battle-data.md#special-move-spc`): the binary layout of
 * `RPGTLKIT SPLMOVE`.
 *
 * Pure (G2): the reader consumes a `BinaryReader` the caller positioned and
 * the writer fills a `BinaryWriter`; neither touches a host. A wrong magic, a
 * text-form file or a short read is a `Result` carrying a located `FormatError`
 * and is never thrown (AD-18). The reader consumes the whole file, keeping any
 * bytes after the last field as `residue`(docs/spec/formats/README.md#bytes-after-the-last-documented-field), so a caller sees
 * `remaining === 0`.
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { checkMajor, checkI8, checkI32, checkMagic, checkMinor } from "../validate.ts";
import {
  BATTLE_MAX_MINOR,
  BATTLE_MIN_MINOR,
  SPECIAL_MOVE_DETECT_OFFSET,
  SPECIAL_MOVE_MAGIC,
  SPECIAL_MOVE_SECTION,
  type SpecialMove,
  unsupportedBattleMinor,
} from "./model.ts";

/** An empty placeholder special move for zero-byte files (Z-1). */
export function createEmptySpecialMove(): SpecialMove {
  return {
    magic: SPECIAL_MOVE_MAGIC,
    major: 2,
    minor: 2,
    name: "",
    damage: 0,
    smpCost: 0,
    program: "",
    targetSmpDrain: 0,
    usableInBattle: 0,
    usableFromMenu: 0,
    statusEffect: "",
    animation: "",
    description: "",
    residue: new Uint8Array(0),
  };
}

/**
 * Read a special move from `reader` (`docs/spec/formats/battle-data.md#special-move-spc`).
 *
 * The header is read first and the detection byte at offset 16 (`docs/spec/formats/README.md#header-and-version`,
 * `docs/spec/formats/battle-data.md#special-move-spc`) probed without moving the cursor: a non-NUL byte means the 2.x text form,
 * which is read by `readTextSpecialMove` rather than parsed as binary.
 * A file too short to carry the detection byte is not an error here — the
 * header's own error is reported instead. Otherwise the `minor`-range check and
 * the field list are read in order; bytes after the description are kept as
 * `residue` (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 */
export function readSpecialMove(reader: BinaryReader): Result<SpecialMove> {
  const start = reader.offset;
  // docs/spec/formats/battle-data.md#special-move-spc lists the detection byte first and the header second; the probe does
  // not move the cursor, so the header is read first and the detection checked
  // before any header error — a text file has no NUL-terminated magic to read.
  const header = reader.header();
  const detectAt = start + SPECIAL_MOVE_DETECT_OFFSET;
  const detection = reader.isBinaryAt(detectAt);

  if (detection.ok && !detection.value) {
    return readTextSpecialMove(reader);
  }
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== SPECIAL_MOVE_MAGIC) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: start,
      section: SPECIAL_MOVE_SECTION,
      message: `not a special move: magic is "${header.value.magic}", expected "${SPECIAL_MOVE_MAGIC}"`,
    });
  }
  if (header.value.minor < BATTLE_MIN_MINOR || header.value.minor > BATTLE_MAX_MINOR) {
    return err(
      unsupportedBattleMinor(
        reader,
        reader.offset - 2,
        SPECIAL_MOVE_SECTION,
        SPECIAL_MOVE_MAGIC,
        header.value.minor,
      ),
    );
  }

  const name = reader.str();
  if (!name.ok) {
    return name;
  }
  const damage = reader.i32();
  if (!damage.ok) {
    return damage;
  }
  const smpCost = reader.i32();
  if (!smpCost.ok) {
    return smpCost;
  }
  const program = reader.str();
  if (!program.ok) {
    return program;
  }
  const targetSmpDrain = reader.i32();
  if (!targetSmpDrain.ok) {
    return targetSmpDrain;
  }
  const usableInBattle = reader.i8();
  if (!usableInBattle.ok) {
    return usableInBattle;
  }
  const usableFromMenu = reader.i8();
  if (!usableFromMenu.ok) {
    return usableFromMenu;
  }
  const statusEffect = reader.str();
  if (!statusEffect.ok) {
    return statusEffect;
  }
  const animation = reader.str();
  if (!animation.ok) {
    return animation;
  }
  const description = reader.str();
  if (!description.ok) {
    return description;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the special move were kept as residue (docs/spec/formats/battle-data.md#special-move-spc, docs/spec/formats/README.md#bytes-after-the-last-documented-field)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor: header.value.minor,
      name: name.value,
      damage: damage.value,
      smpCost: smpCost.value,
      program: program.value,
      targetSmpDrain: targetSmpDrain.value,
      usableInBattle: usableInBattle.value,
      usableFromMenu: usableFromMenu.value,
      statusEffect: statusEffect.value,
      animation: animation.value,
      description: description.value,
      residue: residue.value,
    },
    warnings,
  );
}

/**
 * Serialise `model` to the special-move layout (`docs/spec/formats/battle-data.md#special-move-spc`), reproducing
 * the bytes a `readSpecialMove` of the same model consumed. Only an
 * unencodable string can fail.
 */
export function writeSpecialMove(model: SpecialMove): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, SPECIAL_MOVE_SECTION, model.magic, SPECIAL_MOVE_MAGIC);
  if (headerMagic !== undefined) return headerMagic;

  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return magic;
  }
  const headerMajor = checkMajor(writer, SPECIAL_MOVE_SECTION, model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  const headerMinor = checkMinor(writer, SPECIAL_MOVE_SECTION, model.minor, BATTLE_MIN_MINOR, BATTLE_MAX_MINOR);
  if (headerMinor !== undefined) return headerMinor;
  writer.i16(model.minor);
  const name = writer.str(model.name);
  if (!name.ok) {
    return name;
  }
  for (const [field, value] of [["damage", model.damage], ["smpCost", model.smpCost]] as const) {
    const checked = checkI32(writer, SPECIAL_MOVE_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i32(value);
  }
  const program = writer.str(model.program);
  if (!program.ok) {
    return program;
  }
  const drain = checkI32(writer, SPECIAL_MOVE_SECTION, "targetSmpDrain", model.targetSmpDrain);
  if (drain !== undefined) return drain;
  writer.i32(model.targetSmpDrain);
  for (const [field, value] of [["usableInBattle", model.usableInBattle], ["usableFromMenu", model.usableFromMenu]] as const) {
    const checked = checkI8(writer, SPECIAL_MOVE_SECTION, field, value);
    if (checked !== undefined) return checked;
  }
  writer.i8(model.usableInBattle);
  writer.i8(model.usableFromMenu);
  for (const value of [model.statusEffect, model.animation, model.description]) {
    const written = writer.str(value);
    if (!written.ok) {
      return written;
    }
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}

/** Read a Toolkit 2 minor 0 text special move (docs/spec/formats/legacy/text-formats.md#special-move). */
function readTextSpecialMove(reader: BinaryReader): Result<SpecialMove> {
  const lineReader = new TextLineReader(reader.bytes, reader.path, reader.offset);
  const header = lineReader.nextLine("header", SPECIAL_MOVE_SECTION);
  if (!header.ok) return header;
  if (header.value.trim().toUpperCase() !== SPECIAL_MOVE_MAGIC.toUpperCase()) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: 0,
      section: SPECIAL_MOVE_SECTION,
      message: `not a special move: magic is "${header.value}", expected "${SPECIAL_MOVE_MAGIC}"`,
    });
  }
  const major = lineReader.nextInt("major", SPECIAL_MOVE_SECTION);
  if (!major.ok) return major;
  const minor = lineReader.nextInt("minor", SPECIAL_MOVE_SECTION);
  if (!minor.ok) return minor;
  if (minor.value !== 0) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: lineReader.offset,
      section: SPECIAL_MOVE_SECTION,
      message: `unsupported text special move minor version ${minor.value}: expected 0`,
    });
  }
  const name = lineReader.nextLine("name", SPECIAL_MOVE_SECTION);
  if (!name.ok) return name;
  const fp = lineReader.nextInt("fp", SPECIAL_MOVE_SECTION);
  if (!fp.ok) return fp;
  const smp = lineReader.nextInt("smp", SPECIAL_MOVE_SECTION);
  if (!smp.ok) return smp;
  const prg = lineReader.nextLine("prg", SPECIAL_MOVE_SECTION);
  if (!prg.ok) return prg;
  const targetSmp = lineReader.nextInt("targetSmp", SPECIAL_MOVE_SECTION);
  if (!targetSmp.ok) return targetSmp;
  const battle = lineReader.nextInt("battle", SPECIAL_MOVE_SECTION);
  if (!battle.ok) return battle;
  const menu = lineReader.nextInt("menu", SPECIAL_MOVE_SECTION);
  if (!menu.ok) return menu;
  const statusEffect = lineReader.nextLine("statusEffect", SPECIAL_MOVE_SECTION);
  if (!statusEffect.ok) return statusEffect;
  const animation = lineReader.nextLine("animation", SPECIAL_MOVE_SECTION);
  if (!animation.ok) return animation;
  const description = lineReader.nextLine("description", SPECIAL_MOVE_SECTION);
  if (!description.ok) return description;

  const finished = lineReader.finish(SPECIAL_MOVE_SECTION);
  if (!finished.ok) return finished;

  reader.seek(lineReader.offset);

  return ok({
    magic: SPECIAL_MOVE_MAGIC,
    major: major.value,
    minor: minor.value,
    name: name.value,
    damage: fp.value,
    smpCost: smp.value,
    program: prg.value,
    targetSmpDrain: targetSmp.value,
    usableInBattle: battle.value,
    usableFromMenu: menu.value,
    statusEffect: statusEffect.value,
    animation: animation.value,
    description: description.value,
    residue: new Uint8Array(0),
  });
}
