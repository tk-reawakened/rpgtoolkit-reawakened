import { boardGrid, createEmptyBoard, writeBoard, type BoardImage, type BoardRgb, type BoardShadeRecord, type BoardTileRun, type BoardVector, type Result } from "@tk-reawakened/core";
import type { Scene } from "@tk-reawakened/native-data";

const PROJECTION = { "2d": 0, "iso-stacked": 1, "iso-rotated": 2 } as const;
const VECTOR = { none: 0, solid: 1, under: 2, unidirectional: 4, stairs: 8, waypoint: 16 } as const;
const LIGHT = { ellipse: 0, gradient: 1, "clipped-gradient": 2 } as const;
const IMAGE = { normal: 0, parallax: 1, stretch: 2 } as const;
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type FloorReference = { readonly floor?: string; readonly layer?: number };

/** Already resolved by the scene compiler; layout and bounds are checked by the board writer. */
export type ResolvedSceneBoard = {
  readonly lut: readonly string[];
  /** The logical grid only, floor-major, then row-major. */
  readonly cells: readonly number[];
  readonly generatedVectors: readonly BoardVector[];
  readonly generatedImages: readonly BoardImage[];
};

const flag = (value: boolean | undefined): number => value ? -1 : 0;
const point = ([x, y]: readonly [number, number]) => ({ x, y });
const rgb = ([r, g, b]: readonly [number, number, number]): BoardRgb => ({ r, g, b });
const imageType = (value: keyof typeof IMAGE | undefined): number => IMAGE[value ?? "normal"];

/** The native reader has already validated the standard padded base64 spelling. */
function residue(value: string | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array(0);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let bits = 0;
  let available = 0;
  let out = 0;
  for (let i = 0; i < value.length - padding; i += 1) {
    bits = (bits << 6) | BASE64.indexOf(value.charAt(i));
    available += 6;
    if (available >= 8) {
      available -= 8;
      bytes[out++] = bits >>> available;
    }
  }
  return bytes;
}

function tileRuns(cells: readonly number[], floorCells: number, excess: number): BoardTileRun[] {
  const runs: BoardTileRun[] = [];
  for (let start = 0; start < cells.length; start += floorCells) {
    const end = start + floorCells;
    for (let i = start; i < end;) {
      const lutIndex = cells[i]!;
      const begin = i++;
      while (i < end && cells[i] === lutIndex) i += 1;
      let count = i - begin + (i === cells.length ? excess : 0);
      while (count > 32_768) {
        const prefix = Math.min(32_768, count - excessForLastRun(i, cells.length, excess));
        runs.push({ lutIndex, count: prefix, marker: prefix > 1 });
        count -= prefix;
      }
      runs.push({ lutIndex, count, marker: count > 1 });
    }
  }
  return runs;
}

// Leave at least one logical cell in the record that carries the full overshoot.
function excessForLastRun(end: number, total: number, excess: number): number {
  return end === total ? excess + 1 : 0;
}

function shades(shading: NonNullable<Scene["shading"]>[number]): BoardShadeRecord[] {
  const records: BoardShadeRecord[] = [];
  const excess = shading.legacy?.excessCells?.[0] ?? 0;
  for (let i = 0; i < shading.cells.length;) {
    const [first, r, g, b] = shading.cells[i++]!;
    let count = first;
    while (i < shading.cells.length) {
      const [next, nr, ng, nb] = shading.cells[i]!;
      if (r !== nr || g !== ng || b !== nb) break;
      count += next;
      i += 1;
    }
    if (i === shading.cells.length) count += excess;
    while (count > 32_767) {
      const prefix = Math.min(32_767, count - excessForLastRun(i, shading.cells.length, excess));
      records.push({ runCount: prefix, r, g, b });
      count -= prefix;
    }
    records.push({ runCount: count, r, g, b });
  }
  return records;
}

/**
 * Write the final binary stage of a validated scene build, preserving authored
 * table slots and appending resolved records (native-scene.md#build-from-a-scene-to-a-board).
 */
export function writeResolvedSceneBoard(scene: Scene, resolved: ResolvedSceneBoard): Result<Uint8Array> {
  const defaults = createEmptyBoard();
  const sizeX = scene.size.width;
  const sizeY = scene.size.height;
  const sizeL = scene.floors.length;
  const coordType = PROJECTION[scene.projection] | (scene.pixelCoordinates ? 4 : 0);
  const grid = boardGrid(sizeX, sizeY, coordType);
  const floorCells = grid.width * grid.height;
  const excess = scene.legacy?.excessTiles;
  const cells = resolved.cells;
  if (cells.length !== floorCells * sizeL) {
    return { ok: false, error: { offset: 0, section: "floors", message: "Resolved tile cells do not cover the scene grid." } };
  }
  if (excess !== undefined && cells[cells.length - 1] !== excess[1]) {
    return { ok: false, error: { offset: 0, section: "legacy.excessTiles", message: "The last resolved tile no longer matches the stored overshoot." } };
  }
  const floorNumbers = new Map(scene.floors.map((floor, i) => [floor.id, i + 1]));
  const layer = (ref: FloorReference, fallback = 0): number => ref.floor === undefined ? (ref.layer ?? fallback) : floorNumbers.get(ref.floor)!;
  const background = scene.atmosphere?.background;
  return writeBoard({
    ...defaults,
    sizeX, sizeY, sizeL, coordType,
    lut: resolved.lut,
    tileMatrix: excess === undefined ? cells : cells.concat(Array<number>(excess[0]).fill(excess[1])),
    tileRuns: tileRuns(cells, floorCells, excess?.[0] ?? 0),
    shadeLayers: scene.shading?.map((entry) => ({ castLayer: layer(entry), records: shades(entry) })) ?? [],
    lights: scene.lights?.map((entry) => ({ layer: layer(entry), type: LIGHT[entry.type], nodes: entry.nodes.map(point), colours: entry.colors.map(rgb) })) ?? [],
    vectors: (scene.vectors ?? []).map<BoardVector>((entry) => ({
      points: entry.points.map(point),
      attributes: entry.type === "stairs" ? (entry.toFloor === undefined ? entry.toLayer! : floorNumbers.get(entry.toFloor)!) : (entry.attributes ?? 0),
      closed: flag(entry.closed), layer: layer(entry), type: VECTOR[entry.type], handle: entry.handle ?? "",
    })).concat(resolved.generatedVectors),
    programs: scene.triggers?.map((entry) => ({
      program: entry.program ?? "", graphic: entry.legacy?.graphic ?? "", handle: entry.legacy?.reserved ?? "",
      initialVar: entry.condition?.variable ?? "", initialValue: entry.condition?.value ?? "",
      finalVar: entry.afterRun?.variable ?? "", finalValue: entry.afterRun?.value ?? "",
      activate: entry.condition?.mode === "conditional" ? 1 : 0,
      activationType: (entry.activation?.keyPress ? 1 : 0) | (entry.activation?.repeat ? 2 : 0) | (entry.activation?.stopsMovement ? 4 : 0),
      repeatDistance: entry.activation?.repeatDistance ?? 0, layer: layer(entry),
      points: entry.points?.map(point) ?? [], closed: flag(entry.closed),
    })) ?? [],
    sprites: scene.items?.map((entry) => ({
      itemFile: entry.item ?? "", activationPrg: entry.activationProgram ?? "", multitaskPrg: entry.multitaskProgram ?? "",
      initialVar: entry.condition?.variable ?? "", initialValue: entry.condition?.value ?? "",
      finalVar: entry.afterRun?.variable ?? "", finalValue: entry.afterRun?.value ?? "",
      loadingVar: entry.loadCondition?.variable ?? "", loadingValue: entry.loadCondition?.value ?? "",
      activate: entry.condition?.mode === "conditional" ? 1 : 0,
      activationType: (entry.activation?.keyPress ? 1 : 0) | (entry.activation?.repeat ? 2 : 0),
      x: entry.x, y: entry.y, layer: layer(entry), reserved: entry.legacy?.reserved ?? -1,
    })) ?? [],
    images: (scene.images ?? []).map<BoardImage>((entry) => ({
      file: entry.source ?? "", left: entry.x, top: entry.y, layer: layer(entry),
      drawType: imageType(entry.type), transparent: rgb(entry.transparent), reserved: entry.legacy?.reserved ?? 100,
    })).concat(resolved.generatedImages),
    threads: scene.threads ?? [""], constants: scene.constants ?? [""],
    layerTitles: [scene.legacy?.layerTitleZero ?? "", ...scene.floors.map((floor) => floor.title ?? "")],
    links: { ...defaults.links, ...scene.links },
    properties: {
      backgroundImage: background?.image ?? "", backgroundDrawType: imageType(background?.type),
      backgroundColour: background?.color === undefined ? defaults.properties.backgroundColour : rgb(background.color),
      backgroundMusic: scene.atmosphere?.music ?? "", enterPrg: scene.enterProgram ?? "",
      battleBackground: scene.battle?.background ?? "", battleSkill: scene.battle?.skill ?? 0,
      allowBattles: flag(scene.battle?.allowed), disableSaving: flag(scene.savingDisabled),
      ambient: scene.atmosphere?.ambient === undefined ? defaults.properties.ambient : rgb(scene.atmosphere.ambient),
      start: scene.start === undefined ? defaults.properties.start : { x: scene.start.x ?? 64, y: scene.start.y ?? 64, layer: layer(scene.start, 1) },
    },
    residue: residue(scene.legacy?.trailingBytes),
  });
}
