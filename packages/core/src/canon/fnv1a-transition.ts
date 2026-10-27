/**
 * Exact FNV-1a transitions for an ASCII segment. For h = 256q + r, XOR
 * changes only r, so the segment maps q affinely with one correction for
 * each of the 256 possible r values. The table is independent of the prefix.
 */
import type { Fnv1a64State } from "./fnv1a.ts";

const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;
const BLOCK_PRIME = 0x1b3;

export type FnvAsciiTransition = {
  readonly high: Uint32Array;
  readonly low: Uint32Array;
  readonly multiplier: bigint;
};

/** Build a transition for ASCII input; the caller has already checked it. */
export function buildFnvAsciiTransition(input: string): FnvAsciiTransition {
  const high = new Uint32Array(256);
  const low = new Uint32Array(256);
  for (let r = 0; r < 256; r += 1) low[r] = r;
  for (let i = 0; i < input.length; i += 1) {
    const byte = input.charCodeAt(i);
    for (let r = 0; r < 256; r += 1) {
      const current = (low[r]! ^ byte) >>> 0;
      const productLow = Math.imul(current & 0xffff, BLOCK_PRIME);
      const productHigh = Math.imul(current >>> 16, BLOCK_PRIME);
      const middle = (productHigh + (productLow >>> 16)) >>> 0;
      high[r] = (Math.imul(high[r]!, BLOCK_PRIME) + (current << 8) + (middle >>> 16)) >>> 0;
      low[r] = (((middle & 0xffff) << 16) | (productLow & 0xffff)) >>> 0;
    }
  }
  let multiplier = 1n;
  let factor = PRIME;
  let length = input.length;
  while (length > 0) {
    if (length % 2 !== 0) multiplier = (multiplier * factor) & MASK;
    factor = (factor * factor) & MASK;
    length = Math.floor(length / 2);
  }
  return { high, low, multiplier };
}

/** Apply the exact transition to any incoming FNV accumulator. */
export function applyFnvAsciiTransition(transition: FnvAsciiTransition, state: Fnv1a64State): void {
  const r = state.low & 255;
  const upper = (BigInt(state.high) << 32n) | BigInt((state.low & 0xffffff00) >>> 0);
  const correction = (BigInt(transition.high[r]!) << 32n) | BigInt(transition.low[r]!);
  const result = (upper * transition.multiplier + correction) & MASK;
  state.high = Number(result >> 32n);
  state.low = Number(result & 0xffffffffn);
}

/** A stack that evicts the oldest inactive key first, protecting the current plan. */
export function staleFnvTransitionKeys<T>(cache: ReadonlyMap<string, T>, blocks: readonly string[]): string[] {
  const active = new Set(blocks);
  return [...cache.keys()].filter((key) => !active.has(key)).reverse();
}
