/**
 * Reading and writing a status effect (`docs/spec/formats/battle-data.md#status-effect-ste`): the binary layout of
 * `RPGTLKIT STATUSE`.
 *
 * Pure (G2): the reader consumes a `BinaryReader` the caller positioned and
 * the writer fills a `BinaryWriter`; neither touches a host. A wrong magic, a
 * text-form file or a short read is a `Result` carrying a located `FormatError`
 * and is never thrown (AD-18). The per-round amounts stay signed — a negative
 * `hpPerRound` or `smpPerRound` heals (`docs/spec/formats/battle-data.md#status-effect-ste`).
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { checkI16, checkMagic, checkMinor } from "../validate.ts";
import {
  BATTLE_MAX_MINOR,
  BATTLE_MIN_MINOR,
  STATUS_EFFECT_DETECT_OFFSET,
  STATUS_EFFECT_MAGIC,
  STATUS_EFFECT_SECTION,
  type StatusEffect,
  unsupportedBattleMinor,
} from "./model.ts";

/**
 * Read a status effect from `reader` (`docs/spec/formats/battle-data.md#status-effect-ste`).
 *
 * `docs/spec/formats/battle-data.md#status-effect-ste` lists the detection byte at offset 16 before the header; the probe does
 * not move the cursor, so the header is read first and the detection checked
 * before any header error — a text file has no NUL-terminated magic to read,
 * and a file too short to carry the detection byte reports the header's own
 * short read rather than the probe's out-of-range error. A non-NUL detection
 * byte means the 2.x text form, which is read by `readTextStatusEffect`.
 * Otherwise the magic, the `minor`-range check
 * and the field list are read in order; bytes after the program are kept
 * as `residue` (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 */
export function readStatusEffect(reader: BinaryReader): Result<StatusEffect> {
  const start = reader.offset;
  const header = reader.header();
  const detectAt = start + STATUS_EFFECT_DETECT_OFFSET;
  const probe = reader.isBinaryAt(detectAt);
  if (probe.ok && !probe.value) {
    return readTextStatusEffect(reader);
  }
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== STATUS_EFFECT_MAGIC) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: start,
      section: STATUS_EFFECT_SECTION,
      message: `not a status effect: magic is "${header.value.magic}", expected "${STATUS_EFFECT_MAGIC}"`,
    });
  }
  if (header.value.minor < BATTLE_MIN_MINOR || header.value.minor > BATTLE_MAX_MINOR) {
    return err(
      unsupportedBattleMinor(
        reader,
        reader.offset - 2,
        STATUS_EFFECT_SECTION,
        STATUS_EFFECT_MAGIC,
        header.value.minor,
      ),
    );
  }

  const name = reader.str();
  if (!name.ok) {
    return name;
  }
  const rounds = reader.i16();
  if (!rounds.ok) {
    return rounds;
  }
  const speedUp = reader.i16();
  if (!speedUp.ok) {
    return speedUp;
  }
  const slowDown = reader.i16();
  if (!slowDown.ok) {
    return slowDown;
  }
  const disable = reader.i16();
  if (!disable.ok) {
    return disable;
  }
  const hpEnabled = reader.i16();
  if (!hpEnabled.ok) {
    return hpEnabled;
  }
  const hpPerRound = reader.i16();
  if (!hpPerRound.ok) {
    return hpPerRound;
  }
  const smpEnabled = reader.i16();
  if (!smpEnabled.ok) {
    return smpEnabled;
  }
  const smpPerRound = reader.i16();
  if (!smpPerRound.ok) {
    return smpPerRound;
  }
  const runProgram = reader.i16();
  if (!runProgram.ok) {
    return runProgram;
  }
  const program = reader.str();
  if (!program.ok) {
    return program;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the status effect were kept as residue (docs/spec/formats/battle-data.md#status-effect-ste, docs/spec/formats/README.md#bytes-after-the-last-documented-field)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor: header.value.minor,
      name: name.value,
      rounds: rounds.value,
      speedUp: speedUp.value,
      slowDown: slowDown.value,
      disable: disable.value,
      hpEnabled: hpEnabled.value,
      hpPerRound: hpPerRound.value,
      smpEnabled: smpEnabled.value,
      smpPerRound: smpPerRound.value,
      runProgram: runProgram.value,
      program: program.value,
      residue: residue.value,
    },
    warnings,
  );
}

/**
 * Serialise `model` to the status-effect layout (`docs/spec/formats/battle-data.md#status-effect-ste`), reproducing
 * the bytes a `readStatusEffect` of the same model consumed. Only an
 * unencodable string can fail.
 */
export function writeStatusEffect(model: StatusEffect): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, STATUS_EFFECT_SECTION, model.magic, STATUS_EFFECT_MAGIC);
  if (headerMagic !== undefined) return headerMagic;
  const headerMinor = checkMinor(writer, STATUS_EFFECT_SECTION, model.minor, BATTLE_MIN_MINOR, BATTLE_MAX_MINOR);
  if (headerMinor !== undefined) return headerMinor;

  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return magic;
  }
  const headerMajor = checkI16(writer, STATUS_EFFECT_SECTION, "major", model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  writer.i16(model.minor);
  const name = writer.str(model.name);
  if (!name.ok) {
    return name;
  }
  const scalars = [
    ["rounds", model.rounds],
    ["speedUp", model.speedUp],
    ["slowDown", model.slowDown],
    ["disable", model.disable],
    ["hpEnabled", model.hpEnabled],
    ["hpPerRound", model.hpPerRound],
    ["smpEnabled", model.smpEnabled],
    ["smpPerRound", model.smpPerRound],
    ["runProgram", model.runProgram],
  ] as const;
  for (const [field, value] of scalars) {
    const checked = checkI16(writer, STATUS_EFFECT_SECTION, field, value);
    if (checked !== undefined) return checked;
    writer.i16(value);
  }
  const program = writer.str(model.program);
  if (!program.ok) {
    return program;
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}

/** Read a Toolkit 2 minor 0 text status effect (docs/spec/formats/legacy/text-formats.md#status-effect). */
function readTextStatusEffect(reader: BinaryReader): Result<StatusEffect> {
  const lineReader = new TextLineReader(reader.bytes, reader.path, reader.offset);
  const header = lineReader.nextLine("header", STATUS_EFFECT_SECTION);
  if (!header.ok) return header;
  if (header.value.trim().toUpperCase() !== STATUS_EFFECT_MAGIC.toUpperCase()) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: 0,
      section: STATUS_EFFECT_SECTION,
      message: `not a status effect: magic is "${header.value}", expected "${STATUS_EFFECT_MAGIC}"`,
    });
  }
  const major = lineReader.nextInt("major", STATUS_EFFECT_SECTION);
  if (!major.ok) return major;
  const minor = lineReader.nextInt("minor", STATUS_EFFECT_SECTION);
  if (!minor.ok) return minor;
  if (minor.value !== 0) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: lineReader.offset,
      section: STATUS_EFFECT_SECTION,
      message: `unsupported text status effect minor version ${minor.value}: expected 0`,
    });
  }
  const name = lineReader.nextLine("name", STATUS_EFFECT_SECTION);
  if (!name.ok) return name;
  const rounds = lineReader.nextInt("rounds", STATUS_EFFECT_SECTION);
  if (!rounds.ok) return rounds;
  const speed = lineReader.nextInt("speed", STATUS_EFFECT_SECTION);
  if (!speed.ok) return speed;
  const slow = lineReader.nextInt("slow", STATUS_EFFECT_SECTION);
  if (!slow.ok) return slow;
  const disable = lineReader.nextInt("disable", STATUS_EFFECT_SECTION);
  if (!disable.ok) return disable;
  const hp = lineReader.nextInt("hp", STATUS_EFFECT_SECTION);
  if (!hp.ok) return hp;
  const hpAmount = lineReader.nextInt("hpAmount", STATUS_EFFECT_SECTION);
  if (!hpAmount.ok) return hpAmount;
  const smp = lineReader.nextInt("smp", STATUS_EFFECT_SECTION);
  if (!smp.ok) return smp;
  const smpAmount = lineReader.nextInt("smpAmount", STATUS_EFFECT_SECTION);
  if (!smpAmount.ok) return smpAmount;
  const code = lineReader.nextInt("code", STATUS_EFFECT_SECTION);
  if (!code.ok) return code;
  const prg = lineReader.nextLine("prg", STATUS_EFFECT_SECTION);
  if (!prg.ok) return prg;

  const finished = lineReader.finish(STATUS_EFFECT_SECTION);
  if (!finished.ok) return finished;

  reader.seek(lineReader.offset);

  return ok({
    magic: STATUS_EFFECT_MAGIC,
    major: major.value,
    minor: minor.value,
    name: name.value,
    rounds: rounds.value,
    speedUp: speed.value,
    slowDown: slow.value,
    disable: disable.value,
    hpEnabled: hp.value,
    hpPerRound: hpAmount.value,
    smpEnabled: smp.value,
    smpPerRound: smpAmount.value,
    runProgram: code.value,
    program: prg.value,
    residue: new Uint8Array(0),
  });
}
