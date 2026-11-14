/**
 * Story 13.2 evidence-only, framework-free pixel primitive. This is deliberately not a registered document kind,
 * persisted format, host provider, or production API; it makes the operation/command boundary concrete for evaluation.
 */
export type Rgba = readonly [number, number, number, number];

export interface PixelRaster {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export interface PixelPatch {
  readonly x: number;
  readonly y: number;
  readonly before: Rgba;
  readonly after: Rgba;
}

/** One accepted gesture can be serialized as one command containing all changed pixels. */
export interface PixelStrokeCommand {
  readonly type: "paint-stroke";
  readonly width: number;
  readonly height: number;
  readonly patches: readonly PixelPatch[];
}

/** Rasterize an inclusive Bresenham line without mutating the source image or depending on DOM/framework APIs. */
export function paintLine(image: PixelRaster, from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>, color: Rgba): PixelStrokeCommand {
  validateImage(image);
  if (!Number.isSafeInteger(from.x) || !Number.isSafeInteger(from.y) || !Number.isSafeInteger(to.x) || !Number.isSafeInteger(to.y)) throw new RangeError("Pixel line coordinates must be safe integers.");
  if (color.length !== 4 || color.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new RangeError("RGBA channels must be integers from 0 through 255.");
  }

  const patches: PixelPatch[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;

  while (true) {
    if (x >= 0 && x < image.width && y >= 0 && y < image.height) {
      const offset = (y * image.width + x) * 4;
      const before: Rgba = [image.pixels[offset]!, image.pixels[offset + 1]!, image.pixels[offset + 2]!, image.pixels[offset + 3]!];
      if (!sameColor(before, color)) patches.push({ x, y, before, after: color });
    }
    if (x === to.x && y === to.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x += sx; }
    if (doubled <= dx) { error += dx; y += sy; }
  }

  return { type: "paint-stroke", width: image.width, height: image.height, patches };
}

/** Apply or reverse a command atomically; a mismatched source pixel refuses the entire operation. */
export function applyPixelStroke(image: PixelRaster, command: PixelStrokeCommand, reverse = false): PixelRaster | null {
  validateImage(image);
  if (command.type !== "paint-stroke" || command.width !== image.width || command.height !== image.height) return null;

  for (const patch of command.patches) {
    if (!Number.isSafeInteger(patch.x) || !Number.isSafeInteger(patch.y) || patch.x < 0 || patch.x >= image.width || patch.y < 0 || patch.y >= image.height) return null;
    const offset = (patch.y * image.width + patch.x) * 4;
    const expected = reverse ? patch.after : patch.before;
    if (!sameColor([image.pixels[offset]!, image.pixels[offset + 1]!, image.pixels[offset + 2]!, image.pixels[offset + 3]!], expected)) return null;
  }

  const pixels = image.pixels.slice();
  for (const patch of command.patches) {
    const offset = (patch.y * image.width + patch.x) * 4;
    const color = reverse ? patch.before : patch.after;
    pixels.set(color, offset);
  }
  return { width: image.width, height: image.height, pixels };
}

function validateImage(image: PixelRaster): void {
  if (!Number.isSafeInteger(image.width) || image.width <= 0 || !Number.isSafeInteger(image.height) || image.height <= 0 || image.pixels.length !== image.width * image.height * 4) {
    throw new RangeError("Pixel raster dimensions must match its RGBA byte array.");
  }
}


function sameColor(left: Rgba, right: Rgba): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] && left[3] === right[3];
}
