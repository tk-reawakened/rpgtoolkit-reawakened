/**
 * Reading and writing a battle background (`docs/spec/formats/battle-data.md#fight-background-bkg`): the binary layout
 * of `RPGTLKIT BKG`.
 *
 * Pure (G2): the reader consumes a `BinaryReader` the caller positioned and
 * the writer fills a `BinaryWriter`; neither touches a host. A wrong magic, a
 * text-form file or a short read is a `Result` carrying a located `FormatError`
 * and is never thrown (AD-18).
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { checkI16, checkMagic, checkMinor } from "../validate.ts";
import {
  BATTLE_BACKGROUND_DETECT_OFFSET,
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_BACKGROUND_SECTION,
  BATTLE_MAX_MINOR,
  BATTLE_MIN_MINOR,
  type BattleBackground,
  type BattleBackgroundTint,
  unsupportedBattleMinor,
} from "./model.ts";

/**
 * Read a battle background from `reader` (`docs/spec/formats/battle-data.md#fight-background-bkg`).
 *
 * `docs/spec/formats/battle-data.md#fight-background-bkg` lists the detection byte at offset 12 before the header; the probe does
 * not move the cursor, so the header is read first and the detection checked
 * before any header error — a text file has no NUL-terminated magic to read,
 * and a file too short to carry the detection byte reports the header's own
 * short read rather than the probe's out-of-range error. A non-NUL detection
 * byte means the 2.x text form, which is read by `readTextBattleBackground`.
 * Otherwise the magic, the `minor`-range check
 * and the six `str` fields are read in order; bytes after the last sound
 * are kept as `residue` (`docs/spec/formats/README.md#bytes-after-the-last-documented-field`).
 */
export function readBattleBackground(reader: BinaryReader): Result<BattleBackground> {
  const start = reader.offset;
  const header = reader.header();
  const detectAt = start + BATTLE_BACKGROUND_DETECT_OFFSET;
  const probe = reader.isBinaryAt(detectAt);
  if (probe.ok && !probe.value) {
    return readTextBattleBackground(reader);
  }
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== BATTLE_BACKGROUND_MAGIC) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: start,
      section: BATTLE_BACKGROUND_SECTION,
      message: `not a battle background: magic is "${header.value.magic}", expected "${BATTLE_BACKGROUND_MAGIC}"`,
    });
  }
  if (header.value.minor < BATTLE_MIN_MINOR || header.value.minor > BATTLE_MAX_MINOR) {
    return err(
      unsupportedBattleMinor(
        reader,
        reader.offset - 2,
        BATTLE_BACKGROUND_SECTION,
        BATTLE_BACKGROUND_MAGIC,
        header.value.minor,
      ),
    );
  }

  const image = reader.str();
  if (!image.ok) {
    return image;
  }
  const music = reader.str();
  if (!music.ok) {
    return music;
  }
  const menuMoveSound = reader.str();
  if (!menuMoveSound.ok) {
    return menuMoveSound;
  }
  const menuChooseSound = reader.str();
  if (!menuChooseSound.ok) {
    return menuChooseSound;
  }
  const readySound = reader.str();
  if (!readySound.ok) {
    return readySound;
  }
  const cantDoSound = reader.str();
  if (!cantDoSound.ok) {
    return cantDoSound;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the battle background were kept as residue (docs/spec/formats/battle-data.md#fight-background-bkg, docs/spec/formats/README.md#bytes-after-the-last-documented-field)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor: header.value.minor,
      image: image.value,
      music: music.value,
      menuMoveSound: menuMoveSound.value,
      menuChooseSound: menuChooseSound.value,
      readySound: readySound.value,
      cantDoSound: cantDoSound.value,
      residue: residue.value,
    },
    warnings,
  );
}

/**
 * Serialise `model` to the battle-background layout (`docs/spec/formats/battle-data.md#fight-background-bkg`),
 * reproducing the bytes a `readBattleBackground` of the same model consumed.
 * Only an unencodable string can fail.
 */
export function writeBattleBackground(model: BattleBackground): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, BATTLE_BACKGROUND_SECTION, model.magic, BATTLE_BACKGROUND_MAGIC);
  if (headerMagic !== undefined) return headerMagic;
  const headerMinor = checkMinor(writer, BATTLE_BACKGROUND_SECTION, model.minor, BATTLE_MIN_MINOR, BATTLE_MAX_MINOR);
  if (headerMinor !== undefined) return headerMinor;

  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return magic;
  }
  const headerMajor = checkI16(writer, BATTLE_BACKGROUND_SECTION, "major", model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  writer.i16(model.minor);
  for (const value of [
    model.image,
    model.music,
    model.menuMoveSound,
    model.menuChooseSound,
    model.readySound,
    model.cantDoSound,
  ]) {
    const written = writer.str(value);
    if (!written.ok) {
      return written;
    }
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}

/** Read a Toolkit 2 minor 0 text battle background (docs/spec/formats/legacy/text-formats.md#fight-background). */
function readTextBattleBackground(reader: BinaryReader): Result<BattleBackground> {
  const lineReader = new TextLineReader(reader.bytes, reader.path, reader.offset);
  const header = lineReader.nextLine("header", BATTLE_BACKGROUND_SECTION);
  if (!header.ok) return header;
  if (header.value.trim().toUpperCase() !== BATTLE_BACKGROUND_MAGIC.toUpperCase()) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: 0,
      section: BATTLE_BACKGROUND_SECTION,
      message: `not a battle background: magic is "${header.value}", expected "${BATTLE_BACKGROUND_MAGIC}"`,
    });
  }
  const major = lineReader.nextInt("major", BATTLE_BACKGROUND_SECTION);
  if (!major.ok) return major;
  const minor = lineReader.nextInt("minor", BATTLE_BACKGROUND_SECTION);
  if (!minor.ok) return minor;
  if (minor.value !== 0) {
    return err({
      ...(reader.path === undefined ? {} : { path: reader.path }),
      offset: lineReader.offset,
      section: BATTLE_BACKGROUND_SECTION,
      message: `unsupported text battle background minor version ${minor.value}: expected 0`,
    });
  }

  // 19 x 11 tile grid = 209 lines
  const tiles: string[] = [];
  for (let i = 0; i < 209; i++) {
    const tile = lineReader.nextLine(`tile[${i}]`, BATTLE_BACKGROUND_SECTION);
    if (!tile.ok) return tile;
    tiles.push(tile.value);
  }

  const music = lineReader.nextLine("music", BATTLE_BACKGROUND_SECTION);
  if (!music.ok) return music;
  const selectSound = lineReader.nextLine("selectSound", BATTLE_BACKGROUND_SECTION);
  if (!selectSound.ok) return selectSound;
  const chooseSound = lineReader.nextLine("chooseSound", BATTLE_BACKGROUND_SECTION);
  if (!chooseSound.ok) return chooseSound;
  const readySound = lineReader.nextLine("readySound", BATTLE_BACKGROUND_SECTION);
  if (!readySound.ok) return readySound;
  const cantDoSound = lineReader.nextLine("cantDoSound", BATTLE_BACKGROUND_SECTION);
  if (!cantDoSound.ok) return cantDoSound;

  // Line 218 is reserved (Q9, legacy fact)
  const reserved = lineReader.nextLine("reserved", BATTLE_BACKGROUND_SECTION);
  if (!reserved.ok) return reserved;

  // 19 x 11 x 3 RGB tint lines = 627 lines
  const tints: BattleBackgroundTint[] = [];
  for (let i = 0; i < 209; i++) {
    const r = lineReader.nextInt(`tint[${i}].r`, BATTLE_BACKGROUND_SECTION, 0);
    if (!r.ok) return r;
    const g = lineReader.nextInt(`tint[${i}].g`, BATTLE_BACKGROUND_SECTION, 0);
    if (!g.ok) return g;
    const b = lineReader.nextInt(`tint[${i}].b`, BATTLE_BACKGROUND_SECTION, 0);
    if (!b.ok) return b;
    tints.push({ r: r.value, g: g.value, b: b.value });
  }

  const finished = lineReader.finish(BATTLE_BACKGROUND_SECTION);
  if (!finished.ok) return finished;

  reader.seek(lineReader.offset);

  return ok({
    magic: BATTLE_BACKGROUND_MAGIC,
    major: major.value,
    minor: minor.value,
    image: "",
    music: music.value,
    menuMoveSound: selectSound.value,
    menuChooseSound: chooseSound.value,
    readySound: readySound.value,
    cantDoSound: cantDoSound.value,
    residue: new Uint8Array(0),
    tiles,
    tints,
  });
}
