/**
 * Writer-side checks shared by the actor and battle writers (AD-18;
 * docs/spec/formats/README.md#primitive-encoding).
 *
 * `BinaryWriter` stores a number by masking it to its width, so an
 * out-of-range value is written as a *different* number rather than failing:
 * a 40000-point base re-reads as a negative bound and `experienceIncrease`
 * 40000 re-reads as `-25536`. A writer must never produce bytes its own reader
 * refuses or, worse, silently means something else, so every writer checks its
 * scalars, its list bounds and its header here first and returns a located
 * `FormatError` instead of writing.
 */

import type { BinaryWriter } from "./binary/writer.ts";
import { err, type Result } from "./result.ts";

/** The signed 8-bit range every `i8` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const I8_MIN = -128;
const I8_MAX = 127;

/** The signed 16-bit range every `i16` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const I16_MIN = -32_768;
const I16_MAX = 32_767;

/** The signed 32-bit range every `i32` field must fit (docs/spec/formats/README.md#primitive-encoding). */
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;

/** The most entries an `i16` upper bound can index (docs/spec/formats/README.md#counts-are-usually-upper-bounds). */
const MAX_LIST_ENTRIES = 32_768;

/**
 * A located error at the writer's current offset (AD-18), so a writer checks a
 * field immediately before writing it and the error names that field's own
 * first byte.
 */
function writerFailure(writer: BinaryWriter, section: string, message: string): Result<never> {
  return err({ offset: writer.toBytes().length, section, message });
}

function checkRange(
  writer: BinaryWriter,
  section: string,
  field: string,
  value: number,
  min: number,
  max: number,
  width: string,
): Result<never> | undefined {
  if (Number.isInteger(value) && value >= min && value <= max) return undefined;
  return writerFailure(
    writer,
    section,
    `${field} is ${value}; an ${width} field holds ${min}..${max} (docs/spec/formats/README.md#primitive-encoding)`,
  );
}

/** `undefined` when `value` fits an `i8`; otherwise a located error. */
export function checkI8(writer: BinaryWriter, section: string, field: string, value: number): Result<never> | undefined {
  return checkRange(writer, section, field, value, I8_MIN, I8_MAX, "i8");
}

/** `undefined` when `value` fits an `i16`; otherwise a located error. */
export function checkI16(writer: BinaryWriter, section: string, field: string, value: number): Result<never> | undefined {
  return checkRange(writer, section, field, value, I16_MIN, I16_MAX, "i16");
}

/** `undefined` when `value` fits an `i32`; otherwise a located error. */
export function checkI32(writer: BinaryWriter, section: string, field: string, value: number): Result<never> | undefined {
  return checkRange(writer, section, field, value, I32_MIN, I32_MAX, "i32");
}

/**
 * `undefined` when `major` is a version a reader accepts; otherwise a located
 * error. A reader refuses a negative version field
 * (docs/spec/formats/README.md#header-and-version), so the major is checked as a
 * non-negative `short` rather than as a signed one.
 */
export function checkMajor(writer: BinaryWriter, section: string, major: number): Result<never> | undefined {
  if (Number.isInteger(major) && major >= 0 && major <= I16_MAX) return undefined;
  return writerFailure(
    writer,
    section,
    `invalid major version ${major}: a version field is a non-negative short, 0..${I16_MAX}`,
  );
}

/**
 * `undefined` when `count` fits an `i16` upper bound; otherwise a located
 * error. The bound stores `count - 1`, so a count above 32768 wraps and
 * re-reads as "none" (docs/spec/formats/README.md#counts-are-usually-upper-bounds).
 */
export function checkListBound(
  writer: BinaryWriter,
  section: string,
  what: string,
  count: number,
): Result<never> | undefined {
  if (count <= MAX_LIST_ENTRIES) return undefined;
  return writerFailure(
    writer,
    section,
    `${what} has ${count} entries but the i16 upper bound holds at most ${MAX_LIST_ENTRIES}`,
  );
}

/** `undefined` when the model's magic is the documented one; otherwise a located error. */
export function checkMagic(
  writer: BinaryWriter,
  section: string,
  actual: string,
  expected: string,
): Result<never> | undefined {
  if (actual === expected) return undefined;
  return writerFailure(writer, section, `the magic "${actual}" is not "${expected}"; the reader refuses any other value`);
}

/**
 * `undefined` when `minor` is one the documented layout covers; otherwise a
 * located error. The range is the one the format page rules on, so a writer
 * cannot produce a file its own reader rejects.
 */
export function checkMinor(
  writer: BinaryWriter,
  section: string,
  minor: number,
  min: number,
  max: number,
): Result<never> | undefined {
  if (Number.isInteger(minor) && minor >= min && minor <= max) return undefined;
  const accepted = min === max ? `${min}` : `${min}..${max}`;
  return writerFailure(writer, section, `unsupported minor version ${minor}: this writer implements ${accepted}`);
}
