/**
 * The battle-data models and their constants: special moves
 * (`docs/spec/formats/battle-data.md#special-move-spc`), status effects (`docs/spec/formats/battle-data.md#status-effect-ste`) and battle backgrounds (`docs/spec/formats/battle-data.md#fight-background-bkg`).
 *
 * Each of the three is a magic-and-version header (`str magic`, `i16 major`,
 * `i16` minor, `docs/spec/formats/README.md#header-and-version`) followed by a fixed field list. The models keep every
 * field verbatim plus any bytes after the last documented one as `residue`, so
 * a parsed file writes back byte-for-byte (AD-18, docs/spec/formats/README.md#bytes-after-the-last-documented-field.
 *
 * Each format also has a 2.x-era line-oriented text form. Its presence is
 * detected by the byte at a documented offset — `0x00` means binary, a CR/LF
 * means text (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/battle-data.md#special-move-spc`, `docs/spec/formats/battle-data.md#status-effect-ste`, `docs/spec/formats/battle-data.md#fight-background-bkg`). Each reader
 * dispatches on that byte to the binary layout or the text layout.
 */

import type { BinaryReader } from "../binary/reader.ts";
import type { FormatError } from "../result.ts";

/** The magic every binary special move starts with (`docs/spec/formats/battle-data.md#special-move-spc`). */
export const SPECIAL_MOVE_MAGIC = "RPGTLKIT SPLMOVE";

/**
 * The offset of the binary/text detection byte for `.spc` (`docs/spec/formats/battle-data.md#special-move-spc`):
 */
export const SPECIAL_MOVE_DETECT_OFFSET = 16;

/** The format specification section the special-move reader and writer implement (G7). */
export const SPECIAL_MOVE_SECTION = "docs/spec/formats/battle-data.md#special-move-spc";

/** The magic every binary status effect starts with (`docs/spec/formats/battle-data.md#status-effect-ste`). */
export const STATUS_EFFECT_MAGIC = "RPGTLKIT STATUSE";

/**
 * The offset of the binary/text detection byte for `.ste` (`docs/spec/formats/battle-data.md#status-effect-ste`):
 */
export const STATUS_EFFECT_DETECT_OFFSET = 16;

/** The format specification section the status-effect reader and writer implement (G7). */
export const STATUS_EFFECT_SECTION = "docs/spec/formats/battle-data.md#status-effect-ste";

/** The magic every binary battle background starts with (`docs/spec/formats/battle-data.md#fight-background-bkg`). */
export const BATTLE_BACKGROUND_MAGIC = "RPGTLKIT BKG";

/**
 * The offset of the binary/text detection byte for `.bkg` (`docs/spec/formats/battle-data.md#fight-background-bkg`):
 */
export const BATTLE_BACKGROUND_DETECT_OFFSET = 12;

/** The format specification section the battle-background reader and writer implement (G7). */
export const BATTLE_BACKGROUND_SECTION = "docs/spec/formats/battle-data.md#fight-background-bkg";

/**
 * The lowest `minor` the three battle formats accept (`docs/spec/formats/battle-data.md#special-move-spc`, `docs/spec/formats/battle-data.md#status-effect-ste`, `docs/spec/formats/battle-data.md#fight-background-bkg`):
 * the 2.x-era binary archive writes 2. Their field list does not vary across
 * the accepted range, so `minor` selects no layout; a lower value is reported
 * rather than guessed at(docs/spec/formats/README.md#header-and-version).
 */
export const BATTLE_MIN_MINOR = 2;

/**
 * The highest `minor` the three battle formats accept (`docs/spec/formats/battle-data.md#special-move-spc`, `docs/spec/formats/battle-data.md#status-effect-ste`, `docs/spec/formats/battle-data.md#fight-background-bkg`):
 * the 3.1.0 sample family writes 3. A higher value is reported rather than
 * guessed at(docs/spec/formats/README.md#header-and-version).
 */
export const BATTLE_MAX_MINOR = 3;

/** A parsed special move (`docs/spec/formats/battle-data.md#special-move-spc`). */
export interface SpecialMove {
  /** The magic string, `"RPGTLKIT SPLMOVE"` in a binary file (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/battle-data.md#special-move-spc`). */
  readonly magic: string;
  /** The major version; informational only(docs/spec/formats/README.md#header-and-version). */
  readonly major: number;
  /** The minor version(docs/spec/formats/README.md#header-and-version). */
  readonly minor: number;
  /** The move's name / handle(docs/spec/formats/battle-data.md#special-move-spc). */
  readonly name: string;
  /** The FP damage dealt (an `i32`, docs/spec/formats/battle-data.md#special-move-spc. */
  readonly damage: number;
  /** The SMP the move costs its user (an `i32`, docs/spec/formats/battle-data.md#special-move-spc. */
  readonly smpCost: number;
  /** The RPGCode program the move runs(docs/spec/formats/battle-data.md#special-move-spc). */
  readonly program: string;
  /** The SMP drained from the target (an `i32`, docs/spec/formats/battle-data.md#special-move-spc. */
  readonly targetSmpDrain: number;
  /** The raw `i8` battle byte, kept verbatim: **0 is usable in battle** and any non-zero value (1, or -1 in old files) is not usable (docs/spec/formats/battle-data.md#special-move-spc, docs/spec/formats/README.md#primitive-encoding). */
  readonly usableInBattle: number;
  /** The raw `i8` menu byte, kept verbatim: **0 is usable from the menu** and any non-zero value (1, or -1 in old files) is not usable (docs/spec/formats/battle-data.md#special-move-spc, docs/spec/formats/README.md#primitive-encoding). */
  readonly usableFromMenu: number;
  /** The status effect the move applies, by handle(docs/spec/formats/battle-data.md#special-move-spc). */
  readonly statusEffect: string;
  /** The animation the move plays, by reference(docs/spec/formats/battle-data.md#special-move-spc). */
  readonly animation: string;
  /** The move's one-line description(docs/spec/formats/battle-data.md#special-move-spc). */
  readonly description: string;
  /**
   * Bytes after the last documented field, kept so a write is byte-identical
   * (AD-18, docs/spec/formats/README.md#bytes-after-the-last-documented-field. The spec defines no trailing data, so a non-empty residue is
   * reported as a warning rather than dropped.
   */
  readonly residue: Uint8Array;
}

/** A parsed status effect (`docs/spec/formats/battle-data.md#status-effect-ste`). */
export interface StatusEffect {
  /** The magic string, `"RPGTLKIT STATUSE"` in a binary file (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/battle-data.md#status-effect-ste`). */
  readonly magic: string;
  /** The major version; informational only(docs/spec/formats/README.md#header-and-version). */
  readonly major: number;
  /** The minor version(docs/spec/formats/README.md#header-and-version). */
  readonly minor: number;
  /** The effect's name / handle(docs/spec/formats/battle-data.md#status-effect-ste). */
  readonly name: string;
  /** How many rounds the effect lasts (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly rounds: number;
  /** The speed bonus (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly speedUp: number;
  /** The speed penalty (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly slowDown: number;
  /** The raw `disable` value (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste, kept verbatim: the spec does not make it a flag, so any signed value, `-1` included, is stored as-is(docs/spec/formats/README.md#primitive-encoding). */
  readonly disable: number;
  /** Whether HP is affected: the raw `i16` is kept verbatim, non-zero is true and `-1` is possible(docs/spec/formats/README.md#primitive-encoding, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly hpEnabled: number;
  /** HP changed per round; negative heals (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly hpPerRound: number;
  /** Whether SMP is affected: the raw `i16` is kept verbatim, non-zero is true and `-1` is possible(docs/spec/formats/README.md#primitive-encoding, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly smpEnabled: number;
  /** SMP changed per round; negative heals (an `i16`, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly smpPerRound: number;
  /** Whether the program runs: the raw `i16` is kept verbatim, non-zero is true and `-1` is possible(docs/spec/formats/README.md#primitive-encoding, docs/spec/formats/battle-data.md#status-effect-ste. */
  readonly runProgram: number;
  /** The RPGCode program the effect runs(docs/spec/formats/battle-data.md#status-effect-ste). */
  readonly program: string;
  /**
   * Bytes after the last documented field, kept so a write is byte-identical
   * (AD-18, docs/spec/formats/README.md#bytes-after-the-last-documented-field. The spec defines no trailing data, so a non-empty residue is
   * reported as a warning rather than dropped.
   */
  readonly residue: Uint8Array;
}

/** RGB tint for one cell of a legacy text battle background. */
export interface BattleBackgroundTint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A parsed battle background (`docs/spec/formats/battle-data.md#fight-background-bkg`). */
export interface BattleBackground {
  /** The magic string, `"RPGTLKIT BKG"` in a binary file (`docs/spec/formats/README.md#header-and-version`, `docs/spec/formats/battle-data.md#fight-background-bkg`). */
  readonly magic: string;
  /** The major version; informational only(docs/spec/formats/README.md#header-and-version). */
  readonly major: number;
  /** The minor version(docs/spec/formats/README.md#header-and-version). */
  readonly minor: number;
  /** The background image reference(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly image: string;
  /** The music reference(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly music: string;
  /** The menu-move sound cue(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly menuMoveSound: string;
  /** The menu-choose sound cue(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly menuChooseSound: string;
  /** The "ready" sound cue(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly readySound: string;
  /** The "can't do that" sound cue(docs/spec/formats/battle-data.md#fight-background-bkg). */
  readonly cantDoSound: string;
  /**
   * Bytes after the last documented field, kept so a write is byte-identical
   * (AD-18, docs/spec/formats/README.md#bytes-after-the-last-documented-field. The spec defines no trailing data, so a non-empty residue is
   * reported as a warning rather than dropped.
   */
  readonly residue: Uint8Array;
  /** Fixed 19×11 tile grid (Toolkit 2 text background, minor 0). */
  readonly tiles?: readonly string[] | undefined;
  /** Fixed 19×11 tint values (Toolkit 2 text background, minor 0). */
  readonly tints?: readonly BattleBackgroundTint[] | undefined;
}

/**
 * Build the located `FormatError` a battle reader returns for a `minor` outside
 * the accepted `BATTLE_MIN_MINOR..BATTLE_MAX_MINOR` range (`docs/spec/formats/battle-data.md#special-move-spc`,
 * `docs/spec/formats/battle-data.md#status-effect-ste`, `docs/spec/formats/battle-data.md#fight-background-bkg`, `docs/spec/formats/README.md#header-and-version`). `offset` is the minor field's first byte; the error names
 */
export function unsupportedBattleMinor(
  reader: BinaryReader,
  offset: number,
  section: string,
  magic: string,
  minor: number,
): FormatError {
  return {
    ...(reader.path === undefined ? {} : { path: reader.path }),
    offset,
    section,
    message: `${magic}: unsupported minor version ${minor}: this reader implements ${BATTLE_MIN_MINOR}..${BATTLE_MAX_MINOR} (docs/spec/formats/README.md#header-and-version)`,
  };
}
