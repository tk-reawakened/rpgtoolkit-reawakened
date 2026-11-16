/**
 * Exact FNV-1a segment transitions. For h = 256q + r, XOR with a byte changes
 * only r, so each segment is affine in q for a fixed incoming low byte r. A
 * lane is learned only when it occurs: an unseen r still requires one segment
 * scan. The argument holds for any byte sequence, so a non-ASCII segment uses
 * the same transition over its UTF-8 bytes (`createFnvAsciiTransition` takes
 * the byte length, which equals the string length only for ASCII).
 */
import { fnv1a64Update, fnv1a64UpdateAscii, type Fnv1a64State } from "./fnv1a.ts";

const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

export type FnvAsciiTransition = {
  readonly high: Uint32Array;
  readonly low: Uint32Array;
  readonly seen: Uint8Array;
  readonly multiplier: bigint;
};

export function createFnvAsciiTransition(length: number): FnvAsciiTransition {
  let multiplier = 1n;
  let factor = PRIME;
  while (length > 0) {
    if (length % 2 !== 0) multiplier = (multiplier * factor) & MASK;
    factor = (factor * factor) & MASK;
    length = Math.floor(length / 2);
  }
  return { high: new Uint32Array(256), low: new Uint32Array(256), seen: new Uint8Array(256), multiplier };
}

/** Hash an ASCII segment exactly, learning its incoming low-byte lane on a miss. */
export function applyFnvAsciiTransition(transition: FnvAsciiTransition, input: string, state: Fnv1a64State): void {
  applyTransition(transition, input, state);
}

/**
 * Hash a segment's UTF-8 bytes exactly, learning its incoming low-byte lane on a miss. The transition must have
 * been created with `bytes.length`.
 */
export function applyFnvByteTransition(transition: FnvAsciiTransition, bytes: Uint8Array, state: Fnv1a64State): void {
  applyTransition(transition, bytes, state);
}

function applyTransition(transition: FnvAsciiTransition, input: string | Uint8Array, state: Fnv1a64State): void {
  const r = state.low & 255;
  const upper = (BigInt(state.high) << 32n) | BigInt((state.low & 0xffffff00) >>> 0);
  if (transition.seen[r] === 0) {
    if (typeof input === "string") fnv1a64UpdateAscii(input, state);
    else fnv1a64Update(input, state);
    const output = (BigInt(state.high) << 32n) | BigInt(state.low);
    const correction = (output - upper * transition.multiplier) & MASK;
    transition.high[r] = Number(correction >> 32n);
    transition.low[r] = Number(correction & 0xffffffffn);
    transition.seen[r] = 1;
    return;
  }
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
