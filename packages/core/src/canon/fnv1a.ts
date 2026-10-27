/**
 * FNV-1a 64-bit over UTF-8 bytes (AD-11).
 *
 * The specification is the BigInt form:
 *
 * ```ts
 * hash = 0xcbf29ce484222325n;
 * for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
 * ```
 *
 * `stateHash` runs on every `advance`, so the shipped implementation keeps the
 * 64-bit accumulator as two 32-bit limbs and multiplies with `Math.imul`
 * instead, allocating nothing per byte. The BigInt form stays as the test
 * oracle; the two agree on the fixed vectors and on generated strings.
 */

import { utf8Encode } from "./utf8.ts";

// 0xcbf29ce484222325 split into 32-bit halves.
const OFFSET_BASIS_HIGH = 0xcbf29ce4;
const OFFSET_BASIS_LOW = 0x84222325;

// 0x100000001b3 = 2^40 + 0x1b3, so the prime's high limb is 0x100 and the low
// limb is 0x1b3.
const PRIME_LOW = 0x1b3;

/**
 * The 16-lowercase-hex FNV-1a 64-bit hash of `input`. A string is encoded to
 * UTF-8 first, so `fnv1a64("a")` hashes the same byte as `fnv1a64(utf8Encode("a"))`.
 */
export type Fnv1a64State = { high: number; low: number };

/** A fresh FNV-1a accumulator at the offset basis. */
export function createFnv1a64State(): Fnv1a64State {
  return { high: OFFSET_BASIS_HIGH, low: OFFSET_BASIS_LOW };
}

/** Continue an FNV-1a accumulator over another string or byte sequence. */
export function fnv1a64Update(input: string | Uint8Array, state: Fnv1a64State): void {
  process(input, state, true);
}

/** Continue over ASCII text without constructing an intermediate UTF-8 buffer. */
export function fnv1a64UpdateAscii(input: string, state: Fnv1a64State): void {
  let high = state.high;
  let low = state.low;
  for (let i = 0; i < input.length; i += 1) {
    low = (low ^ input.charCodeAt(i)) >>> 0;
    const productLow = Math.imul(low & 0xffff, PRIME_LOW);
    const productHigh = Math.imul(low >>> 16, PRIME_LOW);
    const middle = (productHigh + (productLow >>> 16)) >>> 0;
    const nextLow = (((middle & 0xffff) << 16) | (productLow & 0xffff)) >>> 0;
    high = (Math.imul(high, PRIME_LOW) + (low << 8) + (middle >>> 16)) >>> 0;
    low = nextLow;
  }
  state.high = high;
  state.low = low;
}

/** Format the current FNV-1a accumulator as 16 lowercase hexadecimal digits. */
export function fnv1a64Finish(state: Fnv1a64State): string {
  return formatHash(state.high, state.low);
}

/**
 * The 16-lowercase-hex FNV-1a 64-bit hash of `input`. A string is encoded to
 * UTF-8 first, so `fnv1a64("a")` hashes the same byte as `fnv1a64(utf8Encode("a"))`.
 */
export function fnv1a64(input: string | Uint8Array): string {
  return process(input, undefined, false)!;
}

function process(
  input: string | Uint8Array,
  state: Fnv1a64State | undefined,
  updateOnly: boolean,
): string | undefined {
  const bytes = typeof input === "string" ? utf8Encode(input) : input;
  let high = state?.high ?? OFFSET_BASIS_HIGH;
  let low = state?.low ?? OFFSET_BASIS_LOW;

  for (let i = 0; i < bytes.length; i++) {
    low = (low ^ bytes[i]!) >>> 0;

    // low * 0x1b3 as a 48-bit product, kept in two limbs.
    const productLow = Math.imul(low & 0xffff, PRIME_LOW);
    const productHigh = Math.imul(low >>> 16, PRIME_LOW);
    const middle = (productHigh + (productLow >>> 16)) >>> 0;

    const nextLow = (((middle & 0xffff) << 16) | (productLow & 0xffff)) >>> 0;
    const carry = middle >>> 16;

    // high * primeLow + low * primeHigh + carry, mod 2^32. The prime's high
    // limb is 0x100, so low * primeHigh is low << 8.
    high = (Math.imul(high, PRIME_LOW) + (low << 8) + carry) >>> 0;
    low = nextLow;
  }

  if (state !== undefined) {
    state.high = high;
    state.low = low;
  }
  return updateOnly ? undefined : formatHash(high, low);
}

function formatHash(high: number, low: number): string {
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
