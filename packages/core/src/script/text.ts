/**
 * Character helpers for script strings (docs/spec/engine/rpgcode-functions.md#string-positions).
 *
 * Script string positions count Unicode code points, so a command never splits a surrogate pair. A lone surrogate in
 * game state would make the canonical form, the state hash and saves throw (RFC 8785).
 */

/** The string's characters, one code point per element; a lone surrogate, if one is passed in, stays one element. */
export function codePoints(value: string): string[] {
  return Array.from(value);
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** `value` with every unpaired surrogate replaced by U+FFFD, so it can enter game state. */
export function toWellFormed(value: string): string {
  return value.replace(LONE_SURROGATE, "�");
}
