/**
 * A pure UTF-8 encoder (G2, G3, AD-11).
 *
 * `core` may not import `TextEncoder`, `Buffer` or any host global, so the
 * encoder is written out. It parses surrogate pairs and throws `TypeError` on
 * an unpaired surrogate, as RFC 8785 §3.2.2.2 requires.
 */

/**
 * Encode `value` to its UTF-8 bytes. Throws `TypeError` on an unpaired
 * surrogate, which `JSON.stringify` would silently pass through.
 */
export function utf8Encode(value: string): Uint8Array {
  // First pass: the exact byte length, so the result is one allocation.
  let length = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      length += 1;
    } else if (code < 0x800) {
      length += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) {
        throw new TypeError("utf8Encode: unpaired high surrogate");
      }
      length += 4;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("utf8Encode: unpaired low surrogate");
    } else {
      length += 3;
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes[offset++] = code;
    } else if (code < 0x800) {
      bytes[offset++] = 0xc0 | (code >> 6);
      bytes[offset++] = 0x80 | (code & 0x3f);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(i + 1);
      const point = 0x10000 + (((code & 0x3ff) << 10) | (low & 0x3ff));
      bytes[offset++] = 0xf0 | (point >> 18);
      bytes[offset++] = 0x80 | ((point >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((point >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (point & 0x3f);
      i++;
    } else {
      bytes[offset++] = 0xe0 | (code >> 12);
      bytes[offset++] = 0x80 | ((code >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (code & 0x3f);
    }
  }
  return bytes;
}

/** Decode strict UTF-8 bytes without relying on host codecs. */
export function utf8Decode(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset++]!;
    if (first < 0x80) {
      result += String.fromCharCode(first);
      continue;
    }
    if (first >= 0xc2 && first <= 0xdf) {
      const second = bytes[offset++]!;
      if ((second & 0xc0) !== 0x80) throw new TypeError("utf8Decode: invalid UTF-8 sequence");
      result += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      continue;
    }
    if (first >= 0xe0 && first <= 0xef) {
      const second = bytes[offset++]!;
      const third = bytes[offset++]!;
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 ||
          (first === 0xe0 && second < 0xa0) || (first === 0xed && second >= 0xa0)) {
        throw new TypeError("utf8Decode: invalid UTF-8 sequence");
      }
      const point = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      result += String.fromCharCode(point);
      continue;
    }
    if (first >= 0xf0 && first <= 0xf4) {
      const second = bytes[offset++]!;
      const third = bytes[offset++]!;
      const fourth = bytes[offset++]!;
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 || (fourth & 0xc0) !== 0x80 ||
          (first === 0xf0 && second < 0x90) || (first === 0xf4 && second > 0x8f)) {
        throw new TypeError("utf8Decode: invalid UTF-8 sequence");
      }
      const point = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      const scalar = point - 0x10000;
      result += String.fromCharCode(0xd800 | (scalar >> 10), 0xdc00 | (scalar & 0x3ff));
      continue;
    }
    throw new TypeError("utf8Decode: invalid UTF-8 sequence");
  }
  return result;
}
