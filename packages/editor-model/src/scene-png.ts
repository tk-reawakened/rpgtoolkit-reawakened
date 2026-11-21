import type { DecodedTexture } from "@tk-reawakened/core";

const MAX_PIXELS = 100_000_000;

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  writeU32(result, 0, data.length);
  for (let i = 0; i < 4; i += 1) result[4 + i] = type.charCodeAt(i);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < data.length + 8; i += 1) {
    crc ^= result[i]!;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0);
  }
  writeU32(result, data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** Encode top-first straight RGBA pixels as a deterministic, lossless PNG. */
export function encodeScenePng(image: DecodedTexture): Uint8Array {
  const { w, h, rgba } = image;
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0 || w * h > MAX_PIXELS) {
    throw new RangeError("PNG dimensions must be positive integers with at most 100000000 pixels");
  }
  if (rgba.length !== w * h * 4) throw new RangeError("PNG RGBA length must match dimensions");

  // First occurrence defines the palette order. Alpha is part of the colour, including when it is zero.
  const palette = new Map<number, number>();
  for (let i = 0; i < rgba.length; i += 4) {
    const key = ((rgba[i]! << 24) | (rgba[i + 1]! << 16) | (rgba[i + 2]! << 8) | rgba[i + 3]!) >>> 0;
    if (!palette.has(key)) {
      palette.set(key, palette.size);
      if (palette.size > 256) break;
    }
  }
  const indexed = palette.size <= 256;
  const stride = w * (indexed ? 1 : 4);
  const scan = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const target = y * (stride + 1) + 1;
    if (!indexed) scan.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), target);
    else for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const key = ((rgba[i]! << 24) | (rgba[i + 1]! << 16) | (rgba[i + 2]! << 8) | rgba[i + 3]!) >>> 0;
      scan[target + x] = palette.get(key)!;
    }
  }

  // A zlib stream of stored DEFLATE blocks avoids host-specific compression output.
  const blocks = Math.ceil(scan.length / 65535);
  const zlib = new Uint8Array(2 + scan.length + blocks * 5 + 4);
  zlib[0] = 0x78; zlib[1] = 0x01;
  let pos = 2;
  let a = 1, b = 0;
  for (let offset = 0; offset < scan.length;) {
    const length = Math.min(65535, scan.length - offset);
    zlib[pos++] = offset + length === scan.length ? 1 : 0;
    zlib[pos++] = length & 255; zlib[pos++] = length >>> 8;
    zlib[pos++] = (~length) & 255; zlib[pos++] = ((~length) >>> 8) & 255;
    const block = scan.subarray(offset, offset + length);
    zlib.set(block, pos); pos += length;
    for (const byte of block) { a = (a + byte) % 65521; b = (b + a) % 65521; }
    offset += length;
  }
  writeU32(zlib, pos, ((b << 16) | a) >>> 0);

  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, w); writeU32(ihdr, 4, h);
  ihdr[8] = 8; ihdr[9] = indexed ? 3 : 6;
  const chunks = [chunk("IHDR", ihdr)];
  if (indexed) {
    const rgb = new Uint8Array(palette.size * 3);
    const alpha = new Uint8Array(palette.size);
    for (const [key, index] of palette) {
      rgb[index * 3] = key >>> 24; rgb[index * 3 + 1] = key >>> 16; rgb[index * 3 + 2] = key >>> 8;
      alpha[index] = key;
    }
    chunks.push(chunk("PLTE", rgb), chunk("tRNS", alpha));
  }
  chunks.push(chunk("IDAT", zlib), chunk("IEND", new Uint8Array(0)));
  const size = 8 + chunks.reduce((total, part) => total + part.length, 0);
  const png = new Uint8Array(size);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  for (const part of chunks) { png.set(part, offset); offset += part.length; }
  return png;
}
