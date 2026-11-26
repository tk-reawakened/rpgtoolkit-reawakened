import { boardGrid, rasterizeLights, type BoardLight, type BoardPoint, type BoardRgb, type BoardShadeLayer } from "@tk-reawakened/core";
import { decodeShade, encodeShade, STORED_SHADE_MAX, STORED_SHADE_MIN, type BoardDocumentFields, type BoardPrecondition } from "./board-document.ts";

/**
 * Pure light edits for the board editor (`docs/spec/formats/board.md#lights`). Every function returns the next stored
 * arrays for a `set-board-fields` command and never changes its input, so one edit is one undo step and nothing is saved
 * by looking at a light. Whole-number channels run −255…255; a spotlight has 3 nodes (0 and 2 are radius points, 1 is the
 * centre) and a gradient 2 (node 0 is the start, node 1 the end); colour 0 is the edge or start, colour 1 the centre or end.
 */

export type LightType = 0 | 1 | 2;

/** How far from the centre a new spotlight's radius points sit, and how long a new gradient is, in board pixels. */
export const NEW_LIGHT_SPAN = 160;

const CHANNEL_MIN = -255;
const CHANNEL_MAX = 255;

/** What a light edit needs of the board. */
export type LightBoard = Pick<BoardDocumentFields, "sizeX" | "sizeY" | "coordType" | "layers" | "lights" | "shadeLayers">;

export type LightEdit = { readonly ok: true; readonly lights: readonly BoardLight[] } | { readonly ok: false; readonly message: string };

const clampChannel = (value: number): number => Math.max(CHANNEL_MIN, Math.min(CHANNEL_MAX, Math.trunc(value)));
const clampColour = (colour: BoardRgb): BoardRgb => ({ r: clampChannel(colour.r), g: clampChannel(colour.g), b: clampChannel(colour.b) });

/**
 * A new light at `centre`. A spotlight is a circle with radius points 160 px above and to the left of the centre, stopped
 * at 0 at the board edge; a gradient runs 160 px to the right. Colour 1 is the brush shade and colour 0 is zero, so it
 * fades to nothing by default.
 */
export function newLight(type: LightType, centre: BoardPoint, brush: BoardRgb, layer = 1): BoardLight {
  const colours = [{ r: 0, g: 0, b: 0 }, clampColour(brush)];
  if (type === 0) {
    return { layer, type, colours, nodes: [{ x: centre.x, y: Math.max(0, centre.y - NEW_LIGHT_SPAN) }, centre, { x: Math.max(0, centre.x - NEW_LIGHT_SPAN), y: centre.y }] };
  }
  return { layer, type, colours, nodes: [centre, { x: centre.x + NEW_LIGHT_SPAN, y: centre.y }] };
}

export function addLight(board: LightBoard, light: BoardLight): readonly BoardLight[] {
  return [...board.lights, light];
}

export function removeLight(board: LightBoard, index: number): LightEdit {
  if (board.lights[index] === undefined) return { ok: false, message: `There is no light ${index + 1}.` };
  return { ok: true, lights: board.lights.filter((_light, at) => at !== index) };
}

/** Move one node to a whole-pixel position. */
export function moveLightNode(board: LightBoard, index: number, node: number, to: BoardPoint): LightEdit {
  const light = board.lights[index];
  if (light === undefined || light.nodes[node] === undefined) return { ok: false, message: `Light ${index + 1} has no node ${node + 1}.` };
  if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) return { ok: false, message: "A node position is whole pixels." };
  return { ok: true, lights: board.lights.map((entry, at) => at !== index ? entry : { ...entry, nodes: entry.nodes.map((point, n) => n === node ? { x: to.x, y: to.y } : point) }) };
}

/** Set one of a light's two colours; channels are clamped to −255…255 as they are typed. */
export function setLightColour(board: LightBoard, index: number, colour: 0 | 1, to: BoardRgb): LightEdit {
  const light = board.lights[index];
  if (light === undefined) return { ok: false, message: `There is no light ${index + 1}.` };
  return { ok: true, lights: board.lights.map((entry, at) => at !== index ? entry : { ...entry, colours: entry.colours.map((value, n) => n === colour ? clampColour(to) : value) }) };
}

/** Change a light's type. A plain and a clipped gradient keep their nodes; changing to or from a spotlight starts that shape afresh around the first node. */
export function setLightType(board: LightBoard, index: number, type: LightType): LightEdit {
  const light = board.lights[index];
  if (light === undefined) return { ok: false, message: `There is no light ${index + 1}.` };
  if (light.type === type) return { ok: true, lights: board.lights };
  const keeps = light.type !== 0 && type !== 0;
  const centre = light.type === 0 ? light.nodes[1] ?? { x: 0, y: 0 } : light.nodes[0] ?? { x: 0, y: 0 };
  const shape = keeps ? light.nodes : newLight(type, centre, { r: 0, g: 0, b: 0 }).nodes;
  return { ok: true, lights: board.lights.map((entry, at) => at !== index ? entry : { ...entry, type, nodes: shape }) };
}

export type ConvertResult =
  | { readonly ok: true; readonly lights: readonly BoardLight[]; readonly shadeLayers: readonly BoardShadeLayer[] }
  | { readonly ok: false; readonly message: string };

/** What converting one light would do, worked out without changing anything: the review step shows this before the author applies it. */
export interface LightConversionPreview {
  readonly ok: true;
  /** The stored arrays an Apply would submit in one `set-board-fields` command. */
  readonly lights: readonly BoardLight[];
  readonly shadeLayers: readonly BoardShadeLayer[];
  /** The light as it stands, so Apply can tell the author reviewed this very light and not an edited one. */
  readonly light: BoardLight;
  /**
   * What the stored board must still hold for Apply to run: the lights and shading this preview was worked out from. Apply sends
   * it with the command, and the document checks it against the stored board, so a second editor's edit refuses the Apply.
   */
  readonly precondition: BoardPrecondition;
  /** Shade cells across and down. */
  readonly width: number;
  readonly height: number;
  /** What the light adds to each cell, three whole numbers per cell (r, g, b), row by row. */
  readonly added: Int32Array;
  /** Cells where the light adds anything. */
  readonly cellsChanged: number;
  /** The smallest rectangle holding every changed cell, in 1-based column and row numbers; `null` when nothing changes. */
  readonly bounds: { readonly column0: number; readonly row0: number; readonly column1: number; readonly row1: number } | null;
  /** Cells whose total shade would pass ±255, which the picture draws clamped. */
  readonly cellsPastDrawRange: number;
  /** Whether the board has no shading yet, so converting creates the shading layer. */
  readonly createsShadingLayer: boolean;
}

export type LightConversionOutcome = LightConversionPreview | { readonly ok: false; readonly message: string };

const FIELD_NAMES = ["red", "green", "blue"] as const;

/**
 * Work out converting one light into the board's one shading layer without changing anything: that light alone in an empty
 * grid (rounding toward zero) is added to the existing shading with no clamp, and the light is removed. A board with more
 * than one shading layer, shading that covers more cells than the grid, or a total no stored shade can hold is refused with a
 * reason and the cells it affects (docs/spec/formats/board.md#lights).
 */
export function previewLightConversion(board: LightBoard, index: number): LightConversionOutcome {
  const light = board.lights[index];
  if (light === undefined) return { ok: false, message: `There is no light ${index + 1}.` };
  if (board.shadeLayers.length > 1) return { ok: false, message: "This board has more than one shading layer; only one is meaningful, so a light cannot be converted into it." };
  const grid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  const cells = grid.width * grid.height;
  const plain = { layer: light.layer, type: light.type, nodes: light.nodes.map((node) => ({ x: node.x, y: node.y })), colours: light.colours.map((colour) => ({ r: colour.r, g: colour.g, b: colour.b })) };
  const baked = rasterizeLights([plain], { width: grid.width, height: grid.height, coordType: board.coordType, sizeX: board.sizeX });
  const added = decodeShade(baked, cells);
  const existing = board.shadeLayers[0] ?? { castLayer: board.layers, records: [] };
  const into = decodeShade(existing, cells);
  if (added === null || into === null) return { ok: false, message: "This board's shading covers more cells than its grid, so a light cannot be converted into it." };
  let cellsChanged = 0;
  let cellsPastDrawRange = 0;
  let column0 = grid.width;
  let row0 = grid.height;
  let column1 = -1;
  let row1 = -1;
  const overflowing: string[] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    const x = cell % grid.width;
    const y = Math.floor(cell / grid.width);
    let changed = false;
    let past = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const at = cell * 3 + channel;
      const add = added[at] ?? 0;
      const total = (into[at] ?? 0) + add;
      if (add !== 0) changed = true;
      if (total < STORED_SHADE_MIN || total > STORED_SHADE_MAX) overflowing.push(`column ${x + 1}, row ${y + 1} ${FIELD_NAMES[channel]}`);
      if (total < -255 || total > 255) past = true;
      into[at] = total;
    }
    if (changed) {
      cellsChanged += 1;
      column0 = Math.min(column0, x); column1 = Math.max(column1, x);
      row0 = Math.min(row0, y); row1 = Math.max(row1, y);
    }
    if (past) cellsPastDrawRange += 1;
  }
  if (overflowing.length > 0) {
    const shown = overflowing.slice(0, 3).join("; ");
    return { ok: false, message: `Converting would push the shading past what a board can store (${STORED_SHADE_MIN} to ${STORED_SHADE_MAX}) in ${overflowing.length} place${overflowing.length === 1 ? "" : "s"}, for example ${shown}. Nothing was changed.` };
  }
  return {
    ok: true,
    lights: board.lights.filter((_light, at) => at !== index),
    shadeLayers: [{ castLayer: existing.castLayer, records: encodeShade(into, cells) }],
    light,
    precondition: { lights: board.lights, shadeLayers: board.shadeLayers },
    width: grid.width,
    height: grid.height,
    added,
    cellsChanged,
    bounds: cellsChanged === 0 ? null : { column0: column0 + 1, row0: row0 + 1, column1: column1 + 1, row1: row1 + 1 },
    cellsPastDrawRange,
    createsShadingLayer: board.shadeLayers.length === 0,
  };
}

/**
 * Convert one light to shading in one step, for callers that have already reviewed it: see {@link previewLightConversion}.
 * The result goes in one `set-board-fields` command so one undo brings the editable light back.
 */
export function convertLightToShading(board: LightBoard, index: number): ConvertResult {
  const preview = previewLightConversion(board, index);
  return preview.ok ? { ok: true, lights: preview.lights, shadeLayers: preview.shadeLayers } : preview;
}
