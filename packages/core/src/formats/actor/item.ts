/**
 * Reading and writing an item — an inventory object, a piece of equipment or a
 * board NPC (docs/spec/formats/item.md#layout, magic `RPGTLKIT ITEM`).
 *
 * Pure (G2). The reader never throws (AD-18) and the writer reproduces the
 * bytes `readItem` consumed exactly, including empty slots and any residue.
 * docs/spec/formats/item.md#layout carries two traps this file pins: items store `speed` before `idleTime` (the
 * reverse of characters (docs/spec/formats/character.md#layout)), and the custom-stance block sits right
 * after the ten movement strings at `minor = 4` but after the idle animations
 * and speed/idleTime at `minor >= 5`.
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import {
  DIRECTIONAL_ANIMATION_COUNT,
  EQUIP_BONUS_COUNT,
  EQUIP_SLOT_COUNT,
  ITEM_BASES_MINOR,
  ITEM_CHARACTER_SLOTS,
  ITEM_DETECT_OFFSET,
  ITEM_I32_MINOR,
  ITEM_IDLE_MINOR,
  ITEM_MAGIC,
  ITEM_MAX_MINOR,
  ITEM_MIN_MINOR,
  ITEM_MOVEMENT_MINOR,
  ITEM_SECTION,
  ITEM_USE_FLAG_COUNT,
  LEGACY_REST_TILE_COUNT,
  LEGACY_WALK_FRAME_COUNT,
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
  type Item,
  type LegacyWalk,
  type LegacyWalkFrame,
} from "./model.ts";
import { TextLineReader } from "../text/line-reader.ts";
import { checkMajor, checkI8, checkI16, checkI32, checkMagic, checkMinor } from "../validate.ts";

/** An empty placeholder item for zero-byte files (Z-1). */
export function createEmptyItem(): Item {
  return {
    magic: ITEM_MAGIC,
    major: 2,
    minor: 0,
    name: "",
    description: "",
    equipable: 0,
    menuUsable: 0,
    boardUsable: 0,
    battleUsable: 0,
    usedBy: 0,
    allowedCharacters: Array(ITEM_CHARACTER_SLOTS).fill(""),
    buyPrice: 0,
    sellPrice: 0,
    keyItem: 0,
    equipSlots: Array(EQUIP_SLOT_COUNT).fill(0),
    accessoryName: "",
    equipBonus: Array(EQUIP_BONUS_COUNT).fill(0),
    onEquipProgram: "",
    onRemoveProgram: "",
    menuUseHp: 0,
    menuUseSmp: 0,
    menuUseProgram: "",
    battleUseHp: 0,
    battleUseSmp: 0,
    battleUseProgram: "",
    battleAnimation: "",
    multitaskProgram: "",
    activationProgram: "",
    sizeType: 0,
    movementAnimations: undefined,
    restAnimation: undefined,
    reservedAnimation: undefined,
    idleAnimations: undefined,
    speed: undefined,
    idleTime: undefined,
    customStances: undefined,
    vectorBases: undefined,
    legacyWalk: undefined,
    residue: new Uint8Array(0),
  };
}

/** Parse a Toolkit 2 line-oriented text item (docs/spec/formats/legacy/text-formats.md#item). */
export function readTextItem(bytes: Uint8Array, path?: string): Result<Item> {
  const reader = new TextLineReader(bytes, path);

  const magic = reader.nextLine("magic", ITEM_SECTION);
  if (!magic.ok) return magic;
  if (magic.value.trim() !== ITEM_MAGIC) {
    return err({
      ...(path === undefined ? {} : { path }),
      offset: 0,
      section: ITEM_SECTION,
      message: `not an item: magic is "${magic.value}", expected "${ITEM_MAGIC}"`,
    });
  }

  const major = reader.nextInt("major", ITEM_SECTION);
  if (!major.ok) return major;
  const minor = reader.nextInt("minor", ITEM_SECTION);
  if (!minor.ok) return minor;

  const name = reader.nextLine("itemName", ITEM_SECTION);
  if (!name.ok) return name;

  const equipable = reader.nextInt("equipYN", ITEM_SECTION, 0);
  if (!equipable.ok) return equipable;
  const menuUsable = reader.nextInt("menuYN", ITEM_SECTION, 0);
  if (!menuUsable.ok) return menuUsable;
  const boardUsable = reader.nextInt("boardYN", ITEM_SECTION, 0);
  if (!boardUsable.ok) return boardUsable;
  const battleUsable = reader.nextInt("fightYN", ITEM_SECTION, 0);
  if (!battleUsable.ok) return battleUsable;

  const equipSlots: number[] = [0];
  for (let k = 1; k <= 7; k++) {
    const slot = reader.nextInt(`equipSlot[${k}]`, ITEM_SECTION, 0);
    if (!slot.ok) return slot;
    equipSlots.push(slot.value);
  }

  const accessoryName = reader.nextLine("accessory", ITEM_SECTION);
  if (!accessoryName.ok) return accessoryName;

  const equipHp = reader.nextInt("equipHP", ITEM_SECTION, 0);
  if (!equipHp.ok) return equipHp;
  const equipDp = reader.nextInt("equipDP", ITEM_SECTION, 0);
  if (!equipDp.ok) return equipDp;
  const equipFp = reader.nextInt("equipFP", ITEM_SECTION, 0);
  if (!equipFp.ok) return equipFp;
  const equipSm = reader.nextInt("equipSM", ITEM_SECTION, 0);
  if (!equipSm.ok) return equipSm;
  const equipBonus = [equipHp.value, equipDp.value, equipFp.value, equipSm.value];

  const onEquipProgram = reader.nextLine("prgEquip", ITEM_SECTION);
  if (!onEquipProgram.ok) return onEquipProgram;
  const onRemoveProgram = reader.nextLine("prgRemove", ITEM_SECTION);
  if (!onRemoveProgram.ok) return onRemoveProgram;

  const menuUseHp = reader.nextInt("menuHP", ITEM_SECTION, 0);
  if (!menuUseHp.ok) return menuUseHp;
  const menuUseSmp = reader.nextInt("menuSM", ITEM_SECTION, 0);
  if (!menuUseSmp.ok) return menuUseSmp;
  const menuUseProgram = reader.nextLine("prgMenuUse", ITEM_SECTION);
  if (!menuUseProgram.ok) return menuUseProgram;

  const battleUseHp = reader.nextInt("fightHP", ITEM_SECTION, 0);
  if (!battleUseHp.ok) return battleUseHp;
  const battleUseSmp = reader.nextInt("fightSM", ITEM_SECTION, 0);
  if (!battleUseSmp.ok) return battleUseSmp;
  const battleUseProgram = reader.nextLine("prgFightUse", ITEM_SECTION);
  if (!battleUseProgram.ok) return battleUseProgram;

  const multitaskProgram = reader.nextLine("prgOnBoard", ITEM_SECTION);
  if (!multitaskProgram.ok) return multitaskProgram;
  const activationProgram = reader.nextLine("prgPickUp", ITEM_SECTION);
  if (!activationProgram.ok) return activationProgram;

  let sizeType = 0;
  if (minor.value === 1) {
    const st = reader.nextInt("sizeType", ITEM_SECTION, 0);
    if (!st.ok) return st;
    sizeType = st.value;
  }

  let legacyWalk: LegacyWalk | undefined;
  if (sizeType === 0) {
    for (let k = 0; k < 17; k++) {
      const first = reader.nextLine(`picturePixel[${k}][0]`, ITEM_SECTION);
      if (!first.ok) return first;
      if (first.value.trim() === "-2") {
        continue;
      }
      for (let p = 1; p < 1024; p++) {
        const pix = reader.nextLine(`picturePixel[${k}][${p}]`, ITEM_SECTION);
        if (!pix.ok) return pix;
       }
     }
   } else {
     const frames: LegacyWalkFrame[] = [];
     for (let k = 0; k < 16; k++) {
       const top = reader.nextLine(`walkFrame[${k}].top`, ITEM_SECTION);
       if (!top.ok) return top;
       const bottom = reader.nextLine(`walkFrame[${k}].bottom`, ITEM_SECTION);
       if (!bottom.ok) return bottom;
       frames.push({ top: top.value, bottom: bottom.value });
     }
     const restTop = reader.nextLine("restTop", ITEM_SECTION);
     if (!restTop.ok) return restTop;
     const restBottom = reader.nextLine("restBottom", ITEM_SECTION);
     if (!restBottom.ok) return restBottom;
     legacyWalk = { frames, restTiles: [restTop.value, restBottom.value] };
   }

   const usedBy = reader.nextInt("usedBy", ITEM_SECTION, 0);
   if (!usedBy.ok) return usedBy;

   const allowedCharacters: string[] = [""];
   for (let k = 1; k <= 50; k++) {
     const handle = reader.nextLine(`allowedCharacter[${k}]`, ITEM_SECTION);
     if (!handle.ok) return handle;
     allowedCharacters.push(handle.value);
   }

   const buyPrice = reader.nextInt("buyPrice", ITEM_SECTION, 0);
   if (!buyPrice.ok) return buyPrice;
   const sellPrice = reader.nextInt("sellPrice", ITEM_SECTION, 0);
   if (!sellPrice.ok) return sellPrice;
   const keyItem = reader.nextInt("keyItem", ITEM_SECTION, 0);
   if (!keyItem.ok) return keyItem;

   const description = reader.nextLine("description", ITEM_SECTION);
   if (!description.ok) return description;
   const battleAnimation = reader.nextLine("animation", ITEM_SECTION);
   if (!battleAnimation.ok) return battleAnimation;

   const finished = reader.finish(ITEM_SECTION);
   if (!finished.ok) return finished;

   return ok({
     magic: ITEM_MAGIC,
     major: major.value,
     minor: minor.value,
     name: name.value,
     description: description.value,
     equipable: equipable.value,
     menuUsable: menuUsable.value,
     boardUsable: boardUsable.value,
     battleUsable: battleUsable.value,
     usedBy: usedBy.value,
     allowedCharacters,
     buyPrice: buyPrice.value,
     sellPrice: sellPrice.value,
     keyItem: keyItem.value,
     equipSlots,
     accessoryName: accessoryName.value,
     equipBonus,
     onEquipProgram: onEquipProgram.value,
     onRemoveProgram: onRemoveProgram.value,
     menuUseHp: menuUseHp.value,
     menuUseSmp: menuUseSmp.value,
     menuUseProgram: menuUseProgram.value,
     battleUseHp: battleUseHp.value,
     battleUseSmp: battleUseSmp.value,
     battleUseProgram: battleUseProgram.value,
     battleAnimation: battleAnimation.value,
     multitaskProgram: multitaskProgram.value,
     activationProgram: activationProgram.value,
     sizeType,
     movementAnimations: undefined,
     restAnimation: undefined,
     reservedAnimation: undefined,
     idleAnimations: undefined,
     speed: undefined,
     idleTime: undefined,
     customStances: undefined,
     vectorBases: undefined,
     legacyWalk,
     residue: new Uint8Array(0),
   });
 }


/** Read the legacy two-tile-tall walk frames of a minor < 4 item (docs/spec/formats/item.md#layout). */
function readLegacyWalk(reader: BinaryReader): Result<LegacyWalk> {
  const frames: LegacyWalkFrame[] = [];
  for (let i = 0; i < LEGACY_WALK_FRAME_COUNT; i += 1) {
    const top = reader.str();
    if (!top.ok) {
      return top;
    }
    const bottom = reader.str();
    if (!bottom.ok) {
      return bottom;
    }
    frames.push({ top: top.value, bottom: bottom.value });
  }
  const restTiles = readStrings(reader, LEGACY_REST_TILE_COUNT);
  if (!restTiles.ok) {
    return restTiles;
  }
  return ok({ frames, restTiles: restTiles.value });
}

/** Read an item from `reader` (docs/spec/formats/item.md#layout). */
export function readItem(reader: BinaryReader): Result<Item> {
  const start = reader.offset;

  if (reader.remaining === 0) {
    return actorError(reader, start, ITEM_SECTION, "unexpected end of data reading magic: need 1 byte(s), 0 remain");
  }

  // docs/spec/formats/item.md#layout requires the byte at offset 13 to be 0 to mark the binary form; the
  // probe does not move the cursor, so the header is read first and the
  // detection checked before any header error.
  const detection = reader.isBinaryAt(start + ITEM_DETECT_OFFSET);
  if (detection.ok && !detection.value) {
    const bytes = reader.readBytes(reader.remaining);
    if (!bytes.ok) {
      return bytes;
    }
    return readTextItem(bytes.value, reader.path);
  }
  const header = reader.header();
  if (!header.ok) {
    return header;
  }
  if (header.value.magic !== ITEM_MAGIC) {
    return actorError(
      reader,
      start,
      ITEM_SECTION,
      `not an item: magic is "${header.value.magic}", expected "${ITEM_MAGIC}"`,
    );
  }
  if (header.value.minor < ITEM_MIN_MINOR || header.value.minor > ITEM_MAX_MINOR) {
    return actorError(
      reader,
      reader.offset - 2,
      ITEM_SECTION,
      `unsupported item minor version ${header.value.minor}: this reader implements ${ITEM_MIN_MINOR}..${ITEM_MAX_MINOR}`,
    );
  }
  const minor = header.value.minor;
  const wide = minor >= ITEM_I32_MINOR;

  const name = reader.str();
  if (!name.ok) {
    return name;
  }
  const description = reader.str();
  if (!description.ok) {
    return description;
  }
  const flags = readBytes(reader, ITEM_USE_FLAG_COUNT);
  if (!flags.ok) {
    return flags;
  }
  const allowedCharacters = readStrings(reader, ITEM_CHARACTER_SLOTS);
  if (!allowedCharacters.ok) {
    return allowedCharacters;
  }

  const buy = wide ? reader.i32() : reader.i16();
  if (!buy.ok) {
    return buy;
  }
  const buyPrice = buy.value;
  const sell = wide ? reader.i32() : reader.i16();
  if (!sell.ok) {
    return sell;
  }
  const sellPrice = sell.value;

  const keyItem = reader.i8();
  if (!keyItem.ok) {
    return keyItem;
  }
  const equipSlots = readBytes(reader, EQUIP_SLOT_COUNT);
  if (!equipSlots.ok) {
    return equipSlots;
  }
  const accessoryName = reader.str();
  if (!accessoryName.ok) {
    return accessoryName;
  }

  const equipBonus: number[] = [];
  for (let i = 0; i < EQUIP_BONUS_COUNT; i += 1) {
    const value = wide ? reader.i32() : reader.i16();
    if (!value.ok) {
      return value;
    }
    equipBonus.push(value.value);
  }

  const onEquipProgram = reader.str();
  if (!onEquipProgram.ok) {
    return onEquipProgram;
  }
  const onRemoveProgram = reader.str();
  if (!onRemoveProgram.ok) {
    return onRemoveProgram;
  }

  const menuUseHp = wide ? reader.i32() : reader.i16();
  if (!menuUseHp.ok) {
    return menuUseHp;
  }
  const menuUseSmp = wide ? reader.i32() : reader.i16();
  if (!menuUseSmp.ok) {
    return menuUseSmp;
  }
  const menuUseProgram = reader.str();
  if (!menuUseProgram.ok) {
    return menuUseProgram;
  }

  const battleUseHp = wide ? reader.i32() : reader.i16();
  if (!battleUseHp.ok) {
    return battleUseHp;
  }
  const battleUseSmp = wide ? reader.i32() : reader.i16();
  if (!battleUseSmp.ok) {
    return battleUseSmp;
  }
  const battleUseProgram = reader.str();
  if (!battleUseProgram.ok) {
    return battleUseProgram;
  }

  const battleAnimation = reader.str();
  if (!battleAnimation.ok) {
    return battleAnimation;
  }
  const multitaskProgram = reader.str();
  if (!multitaskProgram.ok) {
    return multitaskProgram;
  }
  const activationProgram = reader.str();
  if (!activationProgram.ok) {
    return activationProgram;
  }
  const sizeType = reader.i8();
  if (!sizeType.ok) {
    return sizeType;
  }

  let movementAnimations: string[] | undefined;
  let restAnimation: string | undefined;
  let reservedAnimation: string | undefined;
  let idleAnimations: string[] | undefined;
  let speed: number | undefined;
  let idleTime: number | undefined;
  let customStances: ActorStance[] | undefined;
  let vectorBases: ActorBase[] | undefined;
  let legacyWalk: LegacyWalk | undefined;

  if (minor >= ITEM_MOVEMENT_MINOR) {
    const movements = readStrings(reader, DIRECTIONAL_ANIMATION_COUNT);
    if (!movements.ok) {
      return movements;
    }
    movementAnimations = movements.value;
    const rest = reader.str();
    if (!rest.ok) {
      return rest;
    }
    restAnimation = rest.value;
    const reserved = reader.str();
    if (!reserved.ok) {
      return reserved;
    }
    reservedAnimation = reserved.value;
  }
  if (minor >= ITEM_IDLE_MINOR) {
    const idle = readStrings(reader, DIRECTIONAL_ANIMATION_COUNT);
    if (!idle.ok) {
      return idle;
    }
    idleAnimations = idle.value;
    // Items store speed first, then idleTime — the opposite of characters.
    const speedSeconds = reader.f64();
    if (!speedSeconds.ok) {
      return speedSeconds;
    }
    speed = speedSeconds.value;
    const idleSeconds = reader.f64();
    if (!idleSeconds.ok) {
      return idleSeconds;
    }
    idleTime = idleSeconds.value;
  }
  if (minor >= ITEM_MOVEMENT_MINOR) {
    const stances = readStances(reader, ITEM_SECTION);
    if (!stances.ok) {
      return stances;
    }
    customStances = stances.value;
  }
  if (minor >= ITEM_BASES_MINOR) {
    const bases = readBases(reader, ITEM_SECTION);
    if (!bases.ok) {
      return bases;
    }
    vectorBases = bases.value;
  }
  if (minor < ITEM_MOVEMENT_MINOR) {
    const walk = readLegacyWalk(reader);
    if (!walk.ok) {
      return walk;
    }
    legacyWalk = walk.value;
  }

  const residue = reader.readBytes(reader.remaining);
  if (!residue.ok) {
    return residue;
  }
  const warnings: string[] = [];
  if (residue.value.length > 0) {
    warnings.push(
      `${residue.value.length} trailing byte(s) after the item were kept as residue (docs/spec/formats/item.md#layout)`,
    );
  }

  return ok(
    {
      magic: header.value.magic,
      major: header.value.major,
      minor,
      name: name.value,
      description: description.value,
      equipable: flags.value[0] ?? 0,
      menuUsable: flags.value[1] ?? 0,
      boardUsable: flags.value[2] ?? 0,
      battleUsable: flags.value[3] ?? 0,
      usedBy: flags.value[4] ?? 0,
      allowedCharacters: allowedCharacters.value,
      buyPrice,
      sellPrice,
      keyItem: keyItem.value,
      equipSlots: equipSlots.value,
      accessoryName: accessoryName.value,
      equipBonus,
      onEquipProgram: onEquipProgram.value,
      onRemoveProgram: onRemoveProgram.value,
      menuUseHp: menuUseHp.value,
      menuUseSmp: menuUseSmp.value,
      menuUseProgram: menuUseProgram.value,
      battleUseHp: battleUseHp.value,
      battleUseSmp: battleUseSmp.value,
      battleUseProgram: battleUseProgram.value,
      battleAnimation: battleAnimation.value,
      multitaskProgram: multitaskProgram.value,
      activationProgram: activationProgram.value,
      sizeType: sizeType.value,
      movementAnimations,
      restAnimation,
      reservedAnimation,
      idleAnimations,
      speed,
      idleTime,
      customStances,
      vectorBases,
      legacyWalk,
      residue: residue.value,
    },
    warnings,
  );
}

/**
 * Append a `wide ? i32 : i16` value (docs/spec/formats/item.md#layout: `i32` at `minor >= 3`,
 * applied to prices, equip bonuses and the menu/battle use deltas).
 */
function writeWide(
  writer: BinaryWriter,
  field: string,
  value: number,
  wide: boolean,
): Result<never> | undefined {
  // An i16 value above its range wraps and re-reads as a different number, so
  // the narrow branch refuses it (docs/spec/formats/README.md#primitive-encoding).
  const checked = wide
    ? checkI32(writer, ITEM_SECTION, field, value)
    : checkI16(writer, ITEM_SECTION, field, value);
  if (checked !== undefined) return checked;
  if (wide) {
    writer.i32(value);
  } else {
    writer.i16(value);
  }
  return undefined;
}

/** Serialise `model` to the item layout (docs/spec/formats/item.md#layout). */
export function writeItem(model: Item): Result<Uint8Array> {
  const writer = new BinaryWriter();
  const headerMagic = checkMagic(writer, ITEM_SECTION, model.magic, ITEM_MAGIC);
  if (headerMagic !== undefined) return headerMagic;
  const headerMinor = checkMinor(writer, ITEM_SECTION, model.minor, ITEM_MIN_MINOR, ITEM_MAX_MINOR);
  if (headerMinor !== undefined) return headerMinor;
  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return writerError(writer, ITEM_SECTION, `magic: ${magic.error.message}`);
  }
  const headerMajor = checkMajor(writer, ITEM_SECTION, model.major);
  if (headerMajor !== undefined) return headerMajor;
  writer.i16(model.major);
  writer.i16(model.minor);
  const wide = model.minor >= ITEM_I32_MINOR;

  const name = writer.str(model.name);
  if (!name.ok) {
    return writerError(writer, ITEM_SECTION, `name: ${name.error.message}`);
  }
  const description = writer.str(model.description);
  if (!description.ok) {
    return writerError(writer, ITEM_SECTION, `description: ${description.error.message}`);
  }
  const flags = writeFixedBytes(
    writer,
    [model.equipable, model.menuUsable, model.boardUsable, model.battleUsable, model.usedBy],
    ITEM_USE_FLAG_COUNT,
    ITEM_SECTION,
    "use flags",
  );
  if (!flags.ok) {
    return flags;
  }
  const characters = writeFixedStrings(
    writer,
    model.allowedCharacters,
    ITEM_CHARACTER_SLOTS,
    ITEM_SECTION,
    "allowed character handles",
  );
  if (!characters.ok) {
    return characters;
  }

  for (const [field, value] of [["buyPrice", model.buyPrice], ["sellPrice", model.sellPrice]] as const) {
    const price = writeWide(writer, field, value, wide);
    if (price !== undefined) return price;
  }
  const keyItem = checkI8(writer, ITEM_SECTION, "keyItem", model.keyItem);
  if (keyItem !== undefined) return keyItem;
  writer.i8(model.keyItem);
  const slots = writeFixedBytes(
    writer,
    model.equipSlots,
    EQUIP_SLOT_COUNT,
    ITEM_SECTION,
    "equip slots",
  );
  if (!slots.ok) {
    return slots;
  }
  const accessoryName = writer.str(model.accessoryName);
  if (!accessoryName.ok) {
    return writerError(writer, ITEM_SECTION, `accessory name: ${accessoryName.error.message}`);
  }
  if (model.equipBonus.length !== EQUIP_BONUS_COUNT) {
    return writerError(
      writer,
      ITEM_SECTION,
      `equip bonuses need exactly ${EQUIP_BONUS_COUNT} entries but the model has ${model.equipBonus.length}`,
    );
  }
  for (const [index, value] of model.equipBonus.entries()) {
    const bonus = writeWide(writer, `equipBonus[${index}]`, value, wide);
    if (bonus !== undefined) return bonus;
  }

  const onEquipProgram = writer.str(model.onEquipProgram);
  if (!onEquipProgram.ok) {
    return writerError(writer, ITEM_SECTION, `on-equip program: ${onEquipProgram.error.message}`);
  }
  const onRemoveProgram = writer.str(model.onRemoveProgram);
  if (!onRemoveProgram.ok) {
    return writerError(writer, ITEM_SECTION, `on-remove program: ${onRemoveProgram.error.message}`);
  }
  const menuUseHp = writeWide(writer, "menuUseHp", model.menuUseHp, wide);
  if (menuUseHp !== undefined) return menuUseHp;
  const menuUseSmp = writeWide(writer, "menuUseSmp", model.menuUseSmp, wide);
  if (menuUseSmp !== undefined) return menuUseSmp;
  const menuUseProgram = writer.str(model.menuUseProgram);
  if (!menuUseProgram.ok) {
    return writerError(writer, ITEM_SECTION, `menu-use program: ${menuUseProgram.error.message}`);
  }
  const battleUseHp = writeWide(writer, "battleUseHp", model.battleUseHp, wide);
  if (battleUseHp !== undefined) return battleUseHp;
  const battleUseSmp = writeWide(writer, "battleUseSmp", model.battleUseSmp, wide);
  if (battleUseSmp !== undefined) return battleUseSmp;
  const battleUseProgram = writer.str(model.battleUseProgram);
  if (!battleUseProgram.ok) {
    return writerError(writer, ITEM_SECTION, `battle-use program: ${battleUseProgram.error.message}`);
  }

  const battleAnimation = writer.str(model.battleAnimation);
  if (!battleAnimation.ok) {
    return writerError(writer, ITEM_SECTION, `battle animation: ${battleAnimation.error.message}`);
  }
  const multitaskProgram = writer.str(model.multitaskProgram);
  if (!multitaskProgram.ok) {
    return writerError(writer, ITEM_SECTION, `multitask program: ${multitaskProgram.error.message}`);
  }
  const activationProgram = writer.str(model.activationProgram);
  if (!activationProgram.ok) {
    return writerError(writer, ITEM_SECTION, `activation program: ${activationProgram.error.message}`);
  }
  const sizeType = checkI8(writer, ITEM_SECTION, "sizeType", model.sizeType);
  if (sizeType !== undefined) return sizeType;
  writer.i8(model.sizeType);

  if (model.minor >= ITEM_MOVEMENT_MINOR) {
    const movements = writeFixedStrings(
      writer,
      model.movementAnimations ?? [],
      DIRECTIONAL_ANIMATION_COUNT,
      ITEM_SECTION,
      "movement animations",
    );
    if (!movements.ok) {
      return movements;
    }
    const restAnimation = writer.str(model.restAnimation ?? "");
    if (!restAnimation.ok) {
      return writerError(writer, ITEM_SECTION, `rest animation: ${restAnimation.error.message}`);
    }
    const reservedAnimation = writer.str(model.reservedAnimation ?? "");
    if (!reservedAnimation.ok) {
      return writerError(
        writer,
        ITEM_SECTION,
        `reserved animation: ${reservedAnimation.error.message}`,
      );
    }
  }
  if (model.minor >= ITEM_IDLE_MINOR) {
    const idle = writeFixedStrings(
      writer,
      model.idleAnimations ?? [],
      DIRECTIONAL_ANIMATION_COUNT,
      ITEM_SECTION,
      "idle animations",
    );
    if (!idle.ok) {
      return idle;
    }
    if (model.speed === undefined) {
      return writerError(writer, ITEM_SECTION, "speed is undefined but minor >= 5 stores it (docs/spec/formats/item.md#layout)");
    }
    if (model.idleTime === undefined) {
      return writerError(writer, ITEM_SECTION, "idleTime is undefined but minor >= 5 stores it (docs/spec/formats/item.md#layout)");
    }
    writer.f64(model.speed);
    writer.f64(model.idleTime);
  }
  if (model.minor >= ITEM_MOVEMENT_MINOR) {
    const stances = writeStances(writer, model.customStances ?? [], ITEM_SECTION);
    if (!stances.ok) {
      return stances;
    }
  }
  if (model.minor >= ITEM_BASES_MINOR) {
    const bases = writeBases(writer, model.vectorBases ?? [], ITEM_SECTION);
    if (!bases.ok) {
      return bases;
    }
  }
  if (model.minor < ITEM_MOVEMENT_MINOR) {
    const walk = model.legacyWalk;
    if (walk === undefined || walk.frames.length !== LEGACY_WALK_FRAME_COUNT) {
      return writerError(
        writer,
        ITEM_SECTION,
        `a minor < 4 item needs exactly ${LEGACY_WALK_FRAME_COUNT} legacy walk frames`,
      );
    }
    for (const frame of walk.frames) {
      const top = writer.str(frame.top);
      if (!top.ok) {
        return writerError(writer, ITEM_SECTION, `legacy walk frame top: ${top.error.message}`);
      }
      const bottom = writer.str(frame.bottom);
      if (!bottom.ok) {
        return writerError(writer, ITEM_SECTION, `legacy walk frame bottom: ${bottom.error.message}`);
      }
    }
    const rest = writeFixedStrings(
      writer,
      walk.restTiles,
      LEGACY_REST_TILE_COUNT,
      ITEM_SECTION,
      "legacy rest tiles",
    );
    if (!rest.ok) {
      return rest;
    }
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}
