import type { Tint } from "../ports/draw.ts";
import type { WorldBoard, WorldLight, WorldPoint, WorldRgb, WorldShadeLayer, WorldShadeRecord } from "../world/model.ts";

/** The maximum signed tint carried by one draw command (AD-3). */
export const MAX_TINT = 1020;
const FIXED = 1_000_000;

const zero = (): Tint => ({ r: 0, g: 0, b: 0 });

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function addRgb(a: WorldRgb | Tint, b: WorldRgb | Tint): Tint {
  return {
    r: clamp(a.r + b.r, -MAX_TINT, MAX_TINT),
    g: clamp(a.g + b.g, -MAX_TINT, MAX_TINT),
    b: clamp(a.b + b.b, -MAX_TINT, MAX_TINT),
  };
}

/** Add board and script ambient once, before a tile blit is emitted. */
export function ambientTint(board: Pick<WorldBoard, "ambient"> & { readonly activeAmbient?: WorldRgb }, globalAmbient: Tint = zero()): Tint {
  return addRgb(board.activeAmbient ?? board.ambient, globalAmbient);
}

function recordTint(records: readonly WorldShadeRecord[], cell: number): Tint {
  let cursor = 0;
  for (const record of records) {
    const count = record.runCount > 1 ? record.runCount : 1;
    if (cell < cursor + count) return { r: record.r, g: record.g, b: record.b };
    cursor += count;
  }
  return zero();
}

/**
 * Return the pre-summed tint for one 1-based board layer and stored-grid cell.
 * Shade records are data: no legacy/pre-vector conversion is repeated here.
 */
export function cellTint(
  board: Pick<WorldBoard, "ambient" | "gridWidth" | "sizeX" | "shadeLayers"> & { readonly activeAmbient?: WorldRgb },
  layer: number,
  x: number,
  y: number,
  globalAmbient: Tint = zero(),
): Tint {
  const ambient = board.activeAmbient ?? board.ambient;
  let red = ambient.r + globalAmbient.r;
  let green = ambient.g + globalAmbient.g;
  let blue = ambient.b + globalAmbient.b;
  const width = board.gridWidth ?? board.sizeX;
  if (x < 0 || y < 0 || x >= width) return { r: clamp(red, -MAX_TINT, MAX_TINT), g: clamp(green, -MAX_TINT, MAX_TINT), b: clamp(blue, -MAX_TINT, MAX_TINT) };
  const cell = y * width + x;
  for (const shade of board.shadeLayers ?? []) {
    if (shade.castLayer === 0 || shade.castLayer >= layer) {
      const contribution = recordTint(shade.records, cell);
      red += contribution.r;
      green += contribution.g;
      blue += contribution.b;
    }
  }
  return { r: clamp(red, -MAX_TINT, MAX_TINT), g: clamp(green, -MAX_TINT, MAX_TINT), b: clamp(blue, -MAX_TINT, MAX_TINT) };
}

/** A tint carried as numerators over `FIXED`, so each light's value is exact until it is rounded. */
type Fraction = { readonly r: number; readonly g: number; readonly b: number };

/** `edge + (end − edge) × weight`, as numerators over `FIXED`; `weight` runs 0…`FIXED`. */
function colourFraction(colours: readonly WorldRgb[], weight: number): Fraction {
  const edge = colours[0] ?? { r: 0, g: 0, b: 0 };
  const end = colours[1] ?? edge;
  return {
    r: edge.r * FIXED + (end.r - edge.r) * weight,
    g: edge.g * FIXED + (end.g - edge.g) * weight,
    b: edge.b * FIXED + (end.b - edge.b) * weight,
  };
}

/** Where a gradient's two nodes put the point: `null` when the nodes coincide, else the exact projection numerator and the axis length squared. */
function projection(point: WorldPoint, start: WorldPoint, end: WorldPoint): { readonly numerator: number; readonly lengthSquared: number } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return null;
  return { numerator: (point.x - start.x) * dx + (point.y - start.y) * dy, lengthSquared };
}

/**
 * The spotlight weight (`FIXED` at the centre, 0 at the edge) or `null` outside it
 * (docs/spec/formats/board.md#lights). Node 1 is the centre; the longer of the two radius points sets the rotation
 * (node 2 on a tie) and the shorter supplies only its length. The edge and everything beyond it add nothing, and a zero
 * radius lights nothing.
 */
function ellipseWeight(light: WorldLight, point: WorldPoint): number | null {
  const first = light.nodes[0];
  const centre = light.nodes[1];
  const last = light.nodes[2];
  if (first === undefined || centre === undefined || last === undefined) return null;
  const firstSquared = (first.x - centre.x) * (first.x - centre.x) + (first.y - centre.y) * (first.y - centre.y);
  const lastSquared = (last.x - centre.x) * (last.x - centre.x) + (last.y - centre.y) * (last.y - centre.y);
  const major = firstSquared > lastSquared ? first : last;
  const majorSquared = Math.max(firstSquared, lastSquared);
  const minorSquared = Math.min(firstSquared, lastSquared);
  if (majorSquared === 0 || minorSquared === 0) return null;
  const mx = major.x - centre.x;
  const my = major.y - centre.y;
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  const along = dx * mx + dy * my;
  const across = dy * mx - dx * my;
  // Normalized radius squared is (along² × minor + across² × major) / (major² × minor), compared exactly.
  const bigMajor = BigInt(majorSquared);
  const bigMinor = BigInt(minorSquared);
  const bigAlong = BigInt(along);
  const bigAcross = BigInt(across);
  const numerator = bigAlong * bigAlong * bigMinor + bigAcross * bigAcross * bigMajor;
  const denominator = bigMajor * bigMajor * bigMinor;
  if (numerator >= denominator) return null;
  const radius = Math.sqrt(Number(numerator) / Number(denominator));
  return FIXED - Math.trunc(radius * FIXED);
}

/** One light's value at a point as numerators over `FIXED`, or `null` when it adds nothing there. */
function lightFraction(light: WorldLight, point: WorldPoint): Fraction | null {
  if (light.type === 0) {
    const weight = ellipseWeight(light, point);
    return weight === null ? null : colourFraction(light.colours, weight);
  }
  const start = light.nodes[0];
  const end = light.nodes[1];
  if (start === undefined || end === undefined) return null;
  const axis = projection(point, start, end);
  if (axis === null) return null;
  // A plain gradient clamps to its end colours; a clipped one lights only the band between the two perpendicular lines (edges inside).
  if (light.type === 2 && (axis.numerator < 0 || axis.numerator > axis.lengthSquared)) return null;
  return colourFraction(light.colours, clamp(Math.trunc((axis.numerator * FIXED) / axis.lengthSquared), 0, FIXED));
}

/** Add a light's exact value to a running whole-number total and round the sum toward zero. */
function addFraction(total: number, fraction: number): number {
  return Math.trunc((total * FIXED + fraction) / FIXED);
}

/**
 * The board pixel at which a stored-grid cell is tested against lights (docs/spec/formats/board.md#lights): the cell's
 * top-left corner on a square board, the centre of the tile's diamond on isometric boards. Cells are numbered from 1.
 */
export function lightSamplePoint(coordType: number, sizeX: number, x: number, y: number): WorldPoint {
  const col = x + 1;
  const row = y + 1;
  if ((coordType & 2) !== 0) return { x: (col - row + sizeX) * 32, y: (col + row - sizeX) * 16 - 16 };
  if ((coordType & 1) !== 0) return { x: col * 64 - (row % 2 === 1 ? 32 : 64), y: row * 16 - 16 };
  return { x: x * 32, y: y * 32 };
}

function compress(cells: readonly Tint[]): WorldShadeRecord[] {
  const records: WorldShadeRecord[] = [];
  for (const cell of cells) {
    const previous = records[records.length - 1];
    if (previous !== undefined && previous.r === cell.r && previous.g === cell.g && previous.b === cell.b) {
      records[records.length - 1] = { ...previous, runCount: previous.runCount + 1 };
    } else {
      records.push({ runCount: 1, r: cell.r, g: cell.g, b: cell.b });
    }
  }
  return records;
}


/** A shade layer's cells as three whole numbers each, row by row; short layers read as zero. */
function decodeRecords(records: readonly WorldShadeRecord[], cells: number): Tint[] {
  const out: Tint[] = [];
  for (const record of records) {
    const count = record.runCount > 1 ? record.runCount : 1;
    for (let index = 0; index < count && out.length < cells; index += 1) out.push({ r: record.r, g: record.g, b: record.b });
  }
  while (out.length < cells) out.push(zero());
  return out;
}

/** The grid of a board's cells as the lights see them: its size, and how a cell maps to a board pixel. */
export interface LightGrid {
  readonly width: number;
  readonly height: number;
  readonly coordType?: number;
  /** The logical board width in tiles, used by isometric-rotated placement. */
  readonly sizeX?: number;
}

/**
 * Add lights into a shade layer's cells. Each light's exact value joins the running total (the painted shade plus the
 * earlier lights) and the sum is rounded toward zero, once per light, with no clamp (docs/spec/formats/board.md#lights).
 */
export function rasterizeLights(lights: readonly WorldLight[], grid: LightGrid, painted: readonly WorldShadeRecord[] = []): WorldShadeLayer {
  const cells = decodeRecords(painted, grid.width * grid.height);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const point = lightSamplePoint(grid.coordType ?? 0, grid.sizeX ?? grid.width, x, y);
      const cell = cells[y * grid.width + x] ?? zero();
      let { r, g, b } = cell;
      for (const light of lights) {
        const fraction = lightFraction(light, point);
        if (fraction === null) continue;
        r = addFraction(r, fraction.r);
        g = addFraction(g, fraction.g);
        b = addFraction(b, fraction.b);
      }
      cells[y * grid.width + x] = { r, g, b };
    }
  }
  return { castLayer: 0, records: compress(cells) };
}

/**
 * Bake source lights into the board's one shading layer; runtime state retains no light objects. The painted shade is
 * loaded first and the lights add to it; a board with no shading gets a layer cast onto every layer.
 */
export function bakeLights(board: WorldBoard): WorldBoard {
  const lights = board.lights ?? [];
  if (lights.length === 0) return { ...board, lights: [] };
  const width = board.gridWidth ?? board.sizeX;
  const height = board.gridHeight ?? board.sizeY;
  const existing = board.shadeLayers ?? [];
  const first = existing[0];
  const baked = rasterizeLights(lights, { width, height, coordType: board.coordType, sizeX: board.sizeX }, first?.records ?? []);
  const layer: WorldShadeLayer = { castLayer: first?.castLayer ?? 0, records: baked.records };
  return { ...board, shadeLayers: first === undefined ? [layer] : [layer, ...existing.slice(1)], lights: [] };
}

/** Add two already-computed tints without letting a draw command exceed AD-3. */
export function addTint(a: Tint, b: Tint): Tint {
  return addRgb(a, b);
}
