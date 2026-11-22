import { boardGrid, rasterizeLights, type BoardLight, type BoardPoint, type BoardRgb, type BoardShadeLayer } from "@tk-reawakened/core";
import { decodeShade, encodeShade, type BoardDocumentFields } from "./board-document.ts";

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

/**
 * Convert one light to shading: work out that light alone in an empty grid (rounding toward zero), add those whole numbers
 * to the board's one shading layer without clamping, and remove the light. The result goes in one `set-board-fields` command
 * so one undo brings the editable light back. A board with more than one shading layer is refused.
 */
export function convertLightToShading(board: LightBoard, index: number): ConvertResult {
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
  for (let at = 0; at < added.length; at += 1) into[at] = (into[at] ?? 0) + (added[at] ?? 0);
  return {
    ok: true,
    lights: board.lights.filter((_light, at) => at !== index),
    shadeLayers: [{ castLayer: existing.castLayer, records: encodeShade(into, cells) }],
  };
}
