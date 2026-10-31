// The battle-data formats of docs/spec/formats/battle-data.md (AD-18): special moves,
// status effects(docs/spec/formats/battle-data.md#status-effect-ste) and battle backgrounds(docs/spec/formats/battle-data.md#fight-background-bkg). The tests cover the
// magic/major/minor header, each field's documented width and signedness, the
// signed per-round amounts of a status effect, empty versus non-empty strings,
// the text-form detection byte, located errors and byte-identical round-trips,
// plus the sample battle files when the fixtures have been fetched.
//
// The readers never throw, so the tests assert on values and on the error's
// offset and section rather than on exceptions.
import { test } from "node:test";
import { deepEqual, equal } from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BATTLE_BACKGROUND_MAGIC,
  BATTLE_BACKGROUND_SECTION,
  BinaryReader,
  BinaryWriter,
  SPECIAL_MOVE_MAGIC,
  SPECIAL_MOVE_SECTION,
  STATUS_EFFECT_MAGIC,
  STATUS_EFFECT_SECTION,
  readBattleBackground,
  readSpecialMove,
  readStatusEffect,
  writeBattleBackground,
  writeSpecialMove,
  writeStatusEffect,
} from "../src/index.ts";
import type { BattleBackground, Result, SpecialMove, StatusEffect } from "../src/index.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..", "..", "..");

/** Unwrap a result the test expects to succeed. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`);
  }
  return result.value;
}

/** A 7-bit-ASCII byte array for building a text-form file in a test. */
function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}

/** The fields a synthetic special move lets a test vary. */
interface SpcOptions {
  readonly magic?: string;
  readonly major?: number;
  readonly minor?: number;
  readonly name?: string;
  readonly damage?: number;
  readonly smpCost?: number;
  readonly program?: string;
  readonly targetSmpDrain?: number;
  readonly usableInBattle?: number;
  readonly usableFromMenu?: number;
  readonly statusEffect?: string;
  readonly animation?: string;
  readonly description?: string;
  /** Extra bytes after the last field, to prove they survive as residue. */
  readonly tail?: readonly number[];
}

/** Serialise a synthetic special move. */
function buildSpc(options: SpcOptions = {}): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(options.magic ?? SPECIAL_MOVE_MAGIC);
  writer.i16(options.major ?? 2);
  writer.i16(options.minor ?? 2);
  writer.str(options.name ?? "Fireball");
  writer.i32(options.damage ?? 40);
  writer.i32(options.smpCost ?? 5);
  writer.str(options.program ?? "");
  writer.i32(options.targetSmpDrain ?? 0);
  writer.i8(options.usableInBattle ?? 1);
  writer.i8(options.usableFromMenu ?? 0);
  writer.str(options.statusEffect ?? "");
  writer.str(options.animation ?? "fire.anm");
  writer.str(options.description ?? "A ball of fire");
  if (options.tail !== undefined) {
    writer.writeBytes(new Uint8Array(options.tail));
  }
  return writer.toBytes();
}

/** The fields a synthetic status effect lets a test vary. */
interface SteOptions {
  readonly magic?: string;
  readonly major?: number;
  readonly minor?: number;
  readonly name?: string;
  readonly rounds?: number;
  readonly speedUp?: number;
  readonly slowDown?: number;
  readonly disable?: number;
  readonly hpEnabled?: number;
  readonly hpPerRound?: number;
  readonly smpEnabled?: number;
  readonly smpPerRound?: number;
  readonly runProgram?: number;
  readonly program?: string;
  /** Extra bytes after the last field, to prove they survive as residue. */
  readonly tail?: readonly number[];
}

/** Serialise a synthetic status effect. */
function buildSte(options: SteOptions = {}): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(options.magic ?? STATUS_EFFECT_MAGIC);
  writer.i16(options.major ?? 2);
  writer.i16(options.minor ?? 2);
  writer.str(options.name ?? "Poison");
  writer.i16(options.rounds ?? 3);
  writer.i16(options.speedUp ?? 0);
  writer.i16(options.slowDown ?? -2);
  writer.i16(options.disable ?? 0);
  writer.i16(options.hpEnabled ?? 1);
  writer.i16(options.hpPerRound ?? -5);
  writer.i16(options.smpEnabled ?? 0);
  writer.i16(options.smpPerRound ?? 0);
  writer.i16(options.runProgram ?? 0);
  writer.str(options.program ?? "");
  if (options.tail !== undefined) {
    writer.writeBytes(new Uint8Array(options.tail));
  }
  return writer.toBytes();
}

/** The fields a synthetic battle background lets a test vary. */
interface BkgOptions {
  readonly magic?: string;
  readonly major?: number;
  readonly minor?: number;
  readonly image?: string;
  readonly music?: string;
  readonly menuMoveSound?: string;
  readonly menuChooseSound?: string;
  readonly readySound?: string;
  readonly cantDoSound?: string;
  /** Extra bytes after the last field, to prove they survive as residue. */
  readonly tail?: readonly number[];
}

/** Serialise a synthetic battle background. */
function buildBkg(options: BkgOptions = {}): Uint8Array {
  const writer = new BinaryWriter();
  writer.str(options.magic ?? BATTLE_BACKGROUND_MAGIC);
  writer.i16(options.major ?? 2);
  writer.i16(options.minor ?? 2);
  writer.str(options.image ?? "field.bmp");
  writer.str(options.music ?? "battle.mid");
  writer.str(options.menuMoveSound ?? "move.wav");
  writer.str(options.menuChooseSound ?? "");
  writer.str(options.readySound ?? "ready.wav");
  writer.str(options.cantDoSound ?? "cant.wav");
  if (options.tail !== undefined) {
    writer.writeBytes(new Uint8Array(options.tail));
  }
  return writer.toBytes();
}

// --- Special moves(docs/spec/formats/battle-data.md#special-move-spc) ---------------------------------------------------

test("reads a special move's header and every field", () => {
  const reader = new BinaryReader(buildSpc());
  const move = unwrap(readSpecialMove(reader));
  equal(move.magic, SPECIAL_MOVE_MAGIC);
  equal(move.major, 2);
  equal(move.minor, 2);
  equal(move.name, "Fireball");
  equal(move.damage, 40);
  equal(move.smpCost, 5);
  equal(move.program, "");
  equal(move.targetSmpDrain, 0);
  equal(move.usableInBattle, 1);
  equal(move.usableFromMenu, 0);
  equal(move.statusEffect, "");
  equal(move.animation, "fire.anm");
  equal(move.description, "A ball of fire");
  equal(reader.remaining, 0);
});

test("a special move keeps i32 and i8 signedness", () => {
  const move = unwrap(
    readSpecialMove(
      new BinaryReader(
        buildSpc({
          damage: -2147483648,
          smpCost: 2147483647,
          targetSmpDrain: -7,
          usableInBattle: -1,
          usableFromMenu: 1,
        }),
      ),
    ),
  );
  equal(move.damage, -2147483648);
  equal(move.smpCost, 2147483647);
  equal(move.targetSmpDrain, -7);
  equal(move.usableInBattle, -1);
  equal(move.usableFromMenu, 1);
});

test("a special move distinguishes empty from non-empty strings", () => {
  const move = unwrap(
    readSpecialMove(
      new BinaryReader(
        buildSpc({ name: "", program: "prg", statusEffect: "poison.ste", description: "" }),
      ),
    ),
  );
  equal(move.name, "");
  equal(move.program, "prg");
  equal(move.statusEffect, "poison.ste");
  equal(move.description, "");
});

test("a wrong special-move magic is an error at offset 0", () => {
  const bytes = buildSpc({ magic: "RPGTLKIT SPLMOVX" });
  const result = readSpecialMove(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 0);
  equal(result.error.section, SPECIAL_MOVE_SECTION);
});

test("a truncated text-form special move fails at unexpected EOF", () => {
  const bytes = ascii("RPGTLKIT SPLMOVE\r\n2\r\n0\r\nFireball\r\n");
  const result = readSpecialMove(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 34);
  equal(result.error.section, SPECIAL_MOVE_SECTION);
  equal(result.error.message.includes("unexpected end of file"), true);
});

test("a short special move reports the field offset", () => {
  const bytes = buildSpc().slice(0, 30);
  const result = readSpecialMove(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  // magic (17) + major (2) + minor (2) + name (9): the damage `i32` starts here.
  equal(result.error.offset, 30);
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
});

test("a special move too short to probe reports a located error", () => {
  // The probe at offset 16 is past the end of these three bytes; that is not
  // fatal, so the unterminated magic's own docs/spec/formats/README.md#primitive-encoding error is what the caller sees.
  const result = readSpecialMove(new BinaryReader(new Uint8Array([82, 80, 71])));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 0);
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
});

test("a parsed anonymised special move writes back byte-for-byte", () => {
  // The committed fixture is a real legacy special move with every string field
  // anonymised, so this round-trip does not share the writer's primitives with
  // its input (ticket 2.22).
  const bytes = new Uint8Array(readFileSync(join(testDir, "fixtures", "anonymised", "spc-1.spc")));
  const move = unwrap(readSpecialMove(new BinaryReader(bytes)));
  deepEqual(unwrap(writeSpecialMove(move)), bytes);
});

test("a field-varying synthetic special move writes back byte-for-byte", () => {
  // Kept alongside the fixture round-trip: a negative i32 damage, a -1 i8 flag
  // and an empty trailing string are field variations no committed fixture has.
  const bytes = buildSpc({ name: "Ice", damage: -3, usableFromMenu: -1, description: "" });
  const move = unwrap(readSpecialMove(new BinaryReader(bytes)));
  deepEqual(unwrap(writeSpecialMove(move)), bytes);
});

test("a special move keeps trailing bytes as residue with one warning", () => {
  const bytes = buildSpc({ tail: [0xde, 0xad, 0xbe, 0xef] });
  const reader = new BinaryReader(bytes);
  const result = readSpecialMove(reader);
  equal(result.ok, true);
  const move = unwrap(result);
  deepEqual(move.residue, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  equal(result.ok && result.warnings.length, 1);
  equal(reader.remaining, 0);
  deepEqual(unwrap(writeSpecialMove(move)), bytes);
});

test("a clean synthetic special move has no residue and no warnings", () => {
  const result = readSpecialMove(new BinaryReader(buildSpc()));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.residue.length, 0);
  equal(result.warnings.length, 0);
});

test("an unencodable special-move string fails the writer", () => {
  const model: SpecialMove = {
    magic: SPECIAL_MOVE_MAGIC,
    major: 2,
    minor: 2,
    name: "bad\u0100",
    damage: 1,
    smpCost: 1,
    program: "",
    targetSmpDrain: 0,
    usableInBattle: 1,
    usableFromMenu: 1,
    statusEffect: "",
    animation: "",
    description: "",
    residue: new Uint8Array(0),
  };
  equal(writeSpecialMove(model).ok, false);
});

// --- Status effects(docs/spec/formats/battle-data.md#status-effect-ste) --------------------------------------------------

test("reads a status effect's header and every field", () => {
  // Distinct non-zero values for the five `i16`s that used to be 0 pin the
  // field order: a reader that swapped two of them would fail here.
  const reader = new BinaryReader(
    buildSte({ speedUp: 4, disable: 7, smpEnabled: 2, smpPerRound: -6, runProgram: 9 }),
  );
  const effect = unwrap(readStatusEffect(reader));
  equal(effect.magic, STATUS_EFFECT_MAGIC);
  equal(effect.major, 2);
  equal(effect.minor, 2);
  equal(effect.name, "Poison");
  equal(effect.rounds, 3);
  equal(effect.speedUp, 4);
  equal(effect.slowDown, -2);
  equal(effect.disable, 7);
  equal(effect.hpEnabled, 1);
  equal(effect.hpPerRound, -5);
  equal(effect.smpEnabled, 2);
  equal(effect.smpPerRound, -6);
  equal(effect.runProgram, 9);
  equal(effect.program, "");
  equal(reader.remaining, 0);
});

test("negative per-round amounts are preserved (they heal)", () => {
  const effect = unwrap(
    readStatusEffect(new BinaryReader(buildSte({ hpPerRound: -12, smpPerRound: -34 }))),
  );
  equal(effect.hpPerRound, -12);
  equal(effect.smpPerRound, -34);
  const out = unwrap(writeStatusEffect(effect));
  deepEqual(out, buildSte({ hpPerRound: -12, smpPerRound: -34 }));
});

test("an i16 field's signedness is preserved at the extremes", () => {
  const effect = unwrap(
    readStatusEffect(new BinaryReader(buildSte({ rounds: -32768, speedUp: 32767 }))),
  );
  equal(effect.rounds, -32768);
  equal(effect.speedUp, 32767);
});

test("a wrong status-effect magic is an error at offset 0", () => {
  const bytes = buildSte({ magic: "RPGTLKIT STATUSX" });
  const result = readStatusEffect(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 0);
  equal(result.error.section, STATUS_EFFECT_SECTION);
});

test("a truncated text-form status effect fails at unexpected EOF", () => {
  const bytes = ascii("RPGTLKIT STATUSE\r\n2\r\n0\r\nPoison\r\n");
  const result = readStatusEffect(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 32);
  equal(result.error.section, STATUS_EFFECT_SECTION);
  equal(result.error.message.includes("unexpected end of file"), true);
});

test("a parsed anonymised status effect writes back byte-for-byte", () => {
  const bytes = new Uint8Array(readFileSync(join(testDir, "fixtures", "anonymised", "ste-1.ste")));
  const effect = unwrap(readStatusEffect(new BinaryReader(bytes)));
  deepEqual(unwrap(writeStatusEffect(effect)), bytes);
});

test("a field-varying synthetic status effect writes back byte-for-byte", () => {
  // Kept alongside the fixture round-trip: `ste-1` decodes to zero for
  // `smpEnabled`, `runProgram` and `program`, so only this test pins them.
  const bytes = buildSte({
    name: "",
    rounds: 1,
    speedUp: 4,
    disable: 7,
    smpEnabled: 2,
    smpPerRound: -6,
    runProgram: 9,
    hpPerRound: -1,
    program: "poison.prg",
  });
  const effect = unwrap(readStatusEffect(new BinaryReader(bytes)));
  deepEqual(unwrap(writeStatusEffect(effect)), bytes);
});

test("a status effect keeps trailing bytes as residue with one warning", () => {
  const bytes = buildSte({ tail: [1, 2, 3] });
  const reader = new BinaryReader(bytes);
  const result = readStatusEffect(reader);
  equal(result.ok, true);
  const effect = unwrap(result);
  deepEqual(effect.residue, new Uint8Array([1, 2, 3]));
  equal(result.ok && result.warnings.length, 1);
  equal(reader.remaining, 0);
  deepEqual(unwrap(writeStatusEffect(effect)), bytes);
});

test("a clean synthetic status effect has no residue and no warnings", () => {
  const result = readStatusEffect(new BinaryReader(buildSte()));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.residue.length, 0);
  equal(result.warnings.length, 0);
});

// --- Battle backgrounds(docs/spec/formats/battle-data.md#fight-background-bkg) ---------------------------------------------

test("reads a battle background's header and six string fields", () => {
  const reader = new BinaryReader(buildBkg());
  const background = unwrap(readBattleBackground(reader));
  equal(background.magic, BATTLE_BACKGROUND_MAGIC);
  equal(background.major, 2);
  equal(background.minor, 2);
  equal(background.image, "field.bmp");
  equal(background.music, "battle.mid");
  equal(background.menuMoveSound, "move.wav");
  equal(background.menuChooseSound, "");
  equal(background.readySound, "ready.wav");
  equal(background.cantDoSound, "cant.wav");
  equal(reader.remaining, 0);
});

test("a battle background distinguishes empty from non-empty strings", () => {
  const background = unwrap(
    readBattleBackground(
      new BinaryReader(
        buildBkg({ image: "", music: "m.mid", menuMoveSound: "", readySound: "r.wav" }),
      ),
    ),
  );
  equal(background.image, "");
  equal(background.music, "m.mid");
  equal(background.menuMoveSound, "");
  equal(background.readySound, "r.wav");
});

test("a wrong battle-background magic is an error at offset 0", () => {
  const bytes = buildBkg({ magic: "RPGTLKIT BKX" });
  const result = readBattleBackground(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 0);
  equal(result.error.section, BATTLE_BACKGROUND_SECTION);
});

test("a truncated text-form battle background fails at unexpected EOF", () => {
  const bytes = ascii("RPGTLKIT BKG\r\n2\r\n0\r\nfield.bmp\r\n");
  const result = readBattleBackground(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.offset, 31);
  equal(result.error.section, BATTLE_BACKGROUND_SECTION);
  equal(result.error.message.includes("unexpected end of file"), true);
});

test("a short battle background reports the field offset", () => {
  const bytes = buildBkg().slice(0, 21);
  const result = readBattleBackground(new BinaryReader(bytes));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  // magic (13) + major (2) + minor (2): the image string starts here.
  equal(result.error.offset, 17);
});

test("a parsed battle background writes back byte-for-byte", () => {
  const bytes = buildBkg({ image: "", music: "", menuChooseSound: "ch.wav" });
  const background = unwrap(readBattleBackground(new BinaryReader(bytes)));
  deepEqual(unwrap(writeBattleBackground(background)), bytes);
});

test("a battle background keeps trailing bytes as residue with one warning", () => {
  const bytes = buildBkg({ tail: [0x00, 0xff] });
  const reader = new BinaryReader(bytes);
  const result = readBattleBackground(reader);
  equal(result.ok, true);
  const background = unwrap(result);
  deepEqual(background.residue, new Uint8Array([0x00, 0xff]));
  equal(result.ok && result.warnings.length, 1);
  equal(reader.remaining, 0);
  deepEqual(unwrap(writeBattleBackground(background)), bytes);
});

test("a clean synthetic battle background has no residue and no warnings", () => {
  const result = readBattleBackground(new BinaryReader(buildBkg()));
  equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  equal(result.value.residue.length, 0);
  equal(result.warnings.length, 0);
});

test("an unencodable battle-background string fails the writer", () => {
  const model: BattleBackground = {
    magic: BATTLE_BACKGROUND_MAGIC,
    major: 2,
    minor: 2,
    image: "",
    music: "bad\u0100.mid",
    menuMoveSound: "",
    menuChooseSound: "",
    readySound: "",
    cantDoSound: "",
    residue: new Uint8Array(0),
  };
  equal(writeBattleBackground(model).ok, false);
});

// --- Version ranges(docs/spec/formats/battle-data.md#special-move-spc, docs/spec/formats/README.md#header-and-version ---------------------------------------

/** A battle format's reader with its magic-derived minor-field offset(docs/spec/formats/README.md#header-and-version). */
const battleVersionCases: readonly {
  readonly name: string;
  readonly section: string;
  readonly minorOffset: number;
  readonly read: (reader: BinaryReader) => Result<{ readonly minor: number }>;
  readonly build: (minor: number) => Uint8Array;
}[] = [
  { name: ".spc", section: SPECIAL_MOVE_SECTION, minorOffset: 19, read: readSpecialMove, build: (minor) => buildSpc({ minor }) },
  { name: ".ste", section: STATUS_EFFECT_SECTION, minorOffset: 19, read: readStatusEffect, build: (minor) => buildSte({ minor }) },
  { name: ".bkg", section: BATTLE_BACKGROUND_SECTION, minorOffset: 15, read: readBattleBackground, build: (minor) => buildBkg({ minor }) },
];

test("each battle format accepts minor 2 and 3", () => {
  for (const { name, read, build } of battleVersionCases) {
    for (const minor of [2, 3]) {
      equal(unwrap(read(new BinaryReader(build(minor)))).minor, minor, `${name}: minor ${minor} is accepted`);
    }
  }
});

test("each battle format refuses a minor outside 2..3 at the minor field", () => {
  for (const { name, section, minorOffset, read, build } of battleVersionCases) {
    for (const minor of [0, 1, 4, 99]) {
      const result = read(new BinaryReader(build(minor)));
      equal(result.ok, false, `${name}: minor ${minor} is refused`);
      if (result.ok) {
        continue;
      }
      equal(result.error.section, section, `${name}: minor ${minor} section`);
      equal(result.error.offset, minorOffset, `${name}: minor ${minor} offset`);
    }
  }
});

test("each battle format refuses a negative minor at its own byte", () => {
  for (const { name, minorOffset, read, build } of battleVersionCases) {
    const result = read(new BinaryReader(build(-1)));
    equal(result.ok, false, `${name}: negative minor is refused`);
    if (result.ok) {
      continue;
    }
    equal(result.error.section, "docs/spec/formats/README.md#header-and-version", `${name}: negative minor section`);
    equal(result.error.offset, minorOffset, `${name}: negative minor offset`);
  }
});

test("a truncated status effect reports the header's short read before the detection byte", () => {
  // 16 bytes is the whole magic with no terminator, so the header read fails at
  // offset 0(docs/spec/formats/README.md#primitive-encoding); the detection byte at offset 16 is past the end and must
  // not be the error a caller sees (it was, before the reader read the header
  // first).
  const result = readStatusEffect(new BinaryReader(buildSte().slice(0, 16)));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
  equal(result.error.offset, 0);
});

test("a truncated battle background reports the header's short read before the detection byte", () => {
  // 12 bytes is the whole magic with no terminator: the header read fails at
  // offset 0(docs/spec/formats/README.md#primitive-encoding) rather than the detection probe at offset 12.
  const result = readBattleBackground(new BinaryReader(buildBkg().slice(0, 12)));
  equal(result.ok, false);
  if (result.ok) {
    return;
  }
  equal(result.error.section, "docs/spec/formats/README.md#primitive-encoding");
  equal(result.error.offset, 0);
});

// --- Sample fixtures (guard-rail G5 rule 4: fetched, never committed) --------

/** Every path under `root` whose lower-cased name ends with one of `suffixes`. */
function collect(root: string, suffixes: readonly string[]): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true })
    .filter((name) => suffixes.some((suffix) => name.toLowerCase().endsWith(suffix)))
    .map((name) => join(root, name));
}

const sampleBattle = [
  ...collect(join(repoRoot, "fixtures", "legacy", "demo"), [".bkg", ".spc", ".ste"]),
  ...collect(join(repoRoot, "fixtures", "legacy", "Basic"), [".bkg", ".spc", ".ste"]),
];

/** Check one parsed sample: no trailing bytes, no residue, exact round-trip. */
function checkBattle<T extends { readonly residue: Uint8Array }>(
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
  "every sample battle file parses with zero trailing bytes and round-trips exactly",
  { skip: sampleBattle.length === 0 ? "legacy fixtures are not fetched" : false },
  () => {
    for (const path of sampleBattle) {
      const bytes = new Uint8Array(readFileSync(path));
      const reader = new BinaryReader(bytes, path);
      const lower = path.toLowerCase();
      if (lower.endsWith(".bkg")) {
        checkBattle(path, bytes, reader, readBattleBackground(reader), writeBattleBackground);
      } else if (lower.endsWith(".spc")) {
        checkBattle(path, bytes, reader, readSpecialMove(reader), writeSpecialMove);
      } else {
        checkBattle(path, bytes, reader, readStatusEffect(reader), writeStatusEffect);
      }
    }
  },
);

test(
  "the shipped demo battle samples pin their documented layouts",
  { skip: sampleBattle.length === 0 ? "legacy fixtures are not fetched" : false },
  () => {
    const bkg = sampleBattle.find((path) => path.endsWith(join("demo", "Bkrounds", "bkg.bkg")));
    if (bkg !== undefined) {
      const bytes = new Uint8Array(readFileSync(bkg));
      const background = unwrap(readBattleBackground(new BinaryReader(bytes, bkg)));
      equal(background.minor, 3);
      equal(background.image, "bkg.jpg");
      equal(background.music, "VIP - Boss1.mid");
    }
  },
);

// --- The battle writers refuse what their readers would refuse (#640 / 23.1) --------------------------------

/** The message a writer fails with, so a refusal can be checked for its named field. */
function refusal<T>(model: T, write: (model: T) => Result<Uint8Array>): string {
  const result = write(model);
  equal(result.ok, false, "the writer was expected to fail");
  if (result.ok) throw new Error("unreachable");
  return result.error.message;
}

test("a battle writer refuses an i16 field outside its range instead of wrapping it", () => {
  const effect = unwrap(readStatusEffect(new BinaryReader(buildSte())));
  const rounds = refusal({ ...effect, rounds: 40_000 }, writeStatusEffect);
  equal(rounds.includes("rounds"), true, rounds);
  equal(rounds.includes("-32768..32767"), true, rounds);
  const heal = refusal({ ...effect, hpPerRound: 40_000 }, writeStatusEffect);
  equal(heal.includes("hpPerRound"), true, heal);

  // The signed extremes are representable, and keep their bytes.
  const extremes = unwrap(writeStatusEffect({ ...effect, rounds: 32_767, hpPerRound: -32_768 }));
  const reread = unwrap(readStatusEffect(new BinaryReader(extremes)));
  equal(reread.rounds, 32_767);
  equal(reread.hpPerRound, -32_768);
  deepEqual(unwrap(writeStatusEffect(reread)), extremes, "byte-identical round-trip");
});

test("a battle writer refuses an out-of-range i32 or i8 field", () => {
  const move = unwrap(readSpecialMove(new BinaryReader(buildSpc())));
  const damage = refusal({ ...move, damage: 2_147_483_648 }, writeSpecialMove);
  equal(damage.includes("damage"), true, damage);
  equal(damage.includes("-2147483648..2147483647"), true, damage);
  const usable = refusal({ ...move, usableInBattle: 200 }, writeSpecialMove);
  equal(usable.includes("usableInBattle"), true, usable);
});

test("a battle writer refuses a wrong magic or an unlisted minor", () => {
  const move = unwrap(readSpecialMove(new BinaryReader(buildSpc())));
  const magic = refusal({ ...move, magic: "RPGTLKIT STATUSE" }, writeSpecialMove);
  equal(magic.includes("\"RPGTLKIT SPLMOVE\""), true, magic);
  const moveMinor = refusal({ ...move, minor: 7 }, writeSpecialMove);
  equal(moveMinor.includes("2..3"), true, moveMinor);

  const effect = unwrap(readStatusEffect(new BinaryReader(buildSte())));
  const effectMinor = refusal({ ...effect, minor: 1 }, writeStatusEffect);
  equal(effectMinor.includes("2..3"), true, effectMinor);

  const background = unwrap(readBattleBackground(new BinaryReader(buildBkg())));
  const backgroundMinor = refusal({ ...background, minor: 4 }, writeBattleBackground);
  equal(backgroundMinor.includes("2..3"), true, backgroundMinor);
});

test("a batched writer reports the refused field's own offset, not the block's start", () => {
  // FormatError.offset is the field's first byte (result.ts), so a check that
  // runs just before its write must not report an earlier sibling's position.
  const offsetOf = (model: StatusEffect): number => {
    const result = writeStatusEffect(model);
    equal(result.ok, false, "the writer was expected to fail");
    if (result.ok) throw new Error("unreachable");
    return result.error.offset;
  };
  const effect = unwrap(readStatusEffect(new BinaryReader(buildSte())));
  const rounds = offsetOf({ ...effect, rounds: 40_000 });
  const runProgram = offsetOf({ ...effect, runProgram: 40_000 });
  equal(runProgram - rounds, 16, "runProgram follows the eight rounds..smpPerRound i16 fields");
});
