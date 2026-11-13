/**
 * Board hydration (docs/spec/formats/board.md#vector-layout-minor-4-and-later,
 * docs/spec/formats/legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector,
 * docs/spec/formats/legacy/text-formats.md#board-toolkit-2-text). This module
 * creates only JSON-safe state; asset bytes remain in the engine cache.
 */
import type { AssetKey } from "../ports/keys.ts";
import { frameAt, TICKS_PER_SECOND } from "../time/index.ts";
import { BinaryReader } from "../formats/binary/reader.ts";
import { resolveAsset, resolveTileReference } from "../formats/resolver/resolver.ts";
import type { AssetIndex, AssetRoot } from "../formats/resolver/model.ts";
import { readBoard } from "../formats/board/reader.ts";
import { boardGrid, type Board } from "../formats/board/model.ts";
import { convertPreVectorBoard } from "../formats/board/pre-vector-convert.ts";
import { readPreVectorBoard } from "../formats/board/pre-vector-reader.ts";
import { readTileAnimation } from "../formats/tile-animation/reader.ts";
import { readTileBitmap, tileBitmapCell } from "../formats/tile-bitmap/index.ts";
import { readTileset, tileDimensions } from "../formats/tileset/index.ts";
import { bakeLights } from "../render/shade.ts";
import type {
  WorldBoard,
  WorldImage,
  WorldItem,
  WorldLight,
  WorldPoint,
  WorldProgram,
  WorldShadeLayer,
  WorldTile,
  WorldTileset,
  WorldVector,
  WorldRgb,
} from "./model.ts";

export type HydratedBoard = { readonly board: WorldBoard; readonly dependencies: readonly AssetKey[] };
export type HydrationError = { readonly path: string; readonly offset: number; readonly section: string; readonly message: string };

function formatError(error: { readonly path?: string; readonly offset: number; readonly section: string; readonly message: string }, fallback: string): HydrationError {
  return { ...error, path: error.path ?? fallback };
}

/** Decode vector, pre-vector binary, and Toolkit 2 text boards into one Board model. */
export function readHydratableBoard(key: AssetKey, bytes: Uint8Array): { readonly value: Board | null; readonly error: HydrationError | null } {
  const vector = readBoard(new BinaryReader(bytes, key));
  if (vector.ok) return { value: vector.value, error: null };
  const minor = bytes.length >= 19 && bytes[14] === 0
    ? (bytes[17] ?? 0) | ((bytes[18] ?? 0) << 8)
    : -1;
  if (minor !== 2 && minor !== 3) return { value: null, error: formatError(vector.error, key) };
  const old = readPreVectorBoard(new BinaryReader(bytes, key));
  if (!old.ok) return { value: null, error: formatError(old.error, key) };
  const converted = convertPreVectorBoard(old.value);
  if (!converted.ok) return { value: null, error: formatError(converted.error, key) };
  return { value: converted.value, error: null };
}

function addDependency(asset: AssetKey, dependencies: AssetKey[], seen: Set<AssetKey>): void {
  if (seen.has(asset)) return;
  seen.add(asset);
  dependencies.push(asset);
}

function ticksPerFrame(speed: number): number {
  return Math.max(1, Math.floor(TICKS_PER_SECOND / speed + 0.5));
}
function rgb(value: { readonly r: number; readonly g: number; readonly b: number }): WorldRgb {
  return { r: value.r, g: value.g, b: value.b };
}

function points(values: readonly { readonly x: number; readonly y: number }[]): WorldPoint[] {
  return values.map((value) => ({ x: value.x, y: value.y }));
}

function image(value: {
  readonly file: string;
  readonly left: number;
  readonly top: number;
  readonly layer: number;
  readonly drawType: number;
  readonly transparent: { readonly r: number; readonly g: number; readonly b: number };
  readonly reserved: number;
}): WorldImage {
  return { ...value, transparent: rgb(value.transparent) };
}

function shadeLayer(value: {
  readonly castLayer: number;
  readonly records: readonly { readonly runCount: number; readonly r: number; readonly g: number; readonly b: number }[];
}): WorldShadeLayer {
  return { castLayer: value.castLayer, records: value.records.map((record) => ({ ...record })) };
}

function light(value: {
  readonly layer: number;
  readonly type: number;
  readonly nodes: readonly { readonly x: number; readonly y: number }[];
  readonly colours: readonly { readonly r: number; readonly g: number; readonly b: number }[];
}): WorldLight {
  return { layer: value.layer, type: value.type, nodes: points(value.nodes), colours: value.colours.map(rgb) };
}

function vector(value: {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly attributes: number;
  readonly closed: number;
  readonly layer: number;
  readonly type: number;
  readonly handle: string;
}): WorldVector {
  return { ...value, points: points(value.points) };
}

function program(value: {
  readonly program: string;
  readonly graphic: string;
  readonly initialVar: string;
  readonly initialValue: string;
  readonly finalVar: string;
  readonly finalValue: string;
  readonly activate: number;
  readonly activationType: number;
  readonly repeatDistance: number;
  readonly layer: number;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly closed: number;
  readonly handle: string;
}): WorldProgram {
  return { ...value, points: points(value.points) };
}


function itemFromSprite(sprite: Board["sprites"][number], slot: number): WorldItem {
  return { slot, ...sprite };
}

function tileInfo(
  asset: AssetKey,
  bytes: Uint8Array,
): { readonly metadata: WorldTileset | null; readonly error: HydrationError | null } {
  const lower = asset.toLowerCase();
  if (!lower.endsWith(".tst") && !lower.endsWith(".iso")) return { metadata: null, error: null };
  const parsed = readTileset(bytes, asset);
  if (!parsed.ok) return { metadata: null, error: formatError(parsed.error, asset) };
  const native = tileDimensions(parsed.value.detail);
  const logicalWidth = parsed.value.detail.size === 16 ? 32 : native.width;
  const logicalHeight = parsed.value.detail.size === 16 ? 32 : native.height;
  return {
    metadata: { asset, nativeWidth: native.width, nativeHeight: native.height, width: logicalWidth, height: logicalHeight },
    error: null,
  };
}

function worldBoard(
  key: AssetKey,
  board: Board,
  layers: WorldBoard["layers"],
  tileMetadata: readonly WorldTileset[],
  images: readonly WorldImage[],
): WorldBoard {
  const grid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  const coord = board.coordType & 3;
  const width = coord === 0 ? board.sizeX * 32 : 64 * board.sizeX - 32;
  const height = coord === 1 ? 16 * board.sizeY - 16 : board.sizeY * 32;
  const props = board.properties;
  const rawItems = board.sprites.map(itemFromSprite);
  const items = rawItems.filter((item) => item.itemFile.length > 0);
  const hydrated: WorldBoard = {
    key,
    coordType: board.coordType,
    sizeX: board.sizeX,
    sizeY: board.sizeY,
    sizeL: board.sizeL,
    gridWidth: grid.width,
    gridHeight: grid.height,
    width,
    height,
    background: rgb(props.backgroundColour),
    ambient: rgb(props.ambient),
    backgroundImage: props.backgroundImage,
    backgroundDrawType: props.backgroundDrawType,
    backgroundMusic: props.backgroundMusic,
    enterPrg: props.enterPrg,
    battleBackground: props.battleBackground,
    battleSkill: props.battleSkill,
    allowBattles: props.allowBattles,
    disableSaving: props.disableSaving,
    layers,
    lut: [...board.lut],
    tileMatrix: [...board.tileMatrix],
    shadeLayers: board.shadeLayers.map(shadeLayer),
    lights: board.lights.map(light),
    vectors: board.vectors.map(vector),
    programs: board.programs.map(program),
    rawItems,
    items,
    images: images.map((value) => ({ ...value, ...(value.cells === undefined ? {} : { cells: value.cells.map((cell) => ({ ...cell })) }) })),
    threads: [...board.threads],
    constants: [...board.constants],
    layerTitles: [...board.layerTitles],
    links: { ...board.links },
    start: {
      x: props.start.x > 0 ? props.start.x : 64,
      y: props.start.y > 0 ? props.start.y : 64,
      layer: props.start.layer > 0 ? props.start.layer : 1,
    },
    tilesets: [...tileMetadata],
    runtime: {
      tileEdits: [],
      tileTypes: Array.from({ length: board.sizeL * grid.width * grid.height }, () => "NORMAL"),
    },
  };
  return bakeLights(hydrated);
}

/** Hydrate a board into JSON-safe world state; decoded bytes remain in the caller cache. */
export function hydrateBoard(
  key: AssetKey,
  bytes: Uint8Array,
  index: AssetIndex,
  root: AssetRoot,
  assets: ReadonlyMap<AssetKey, Uint8Array>,
  tick = 0,
): { readonly value: HydratedBoard | null; readonly error: HydrationError | null; readonly missing: AssetKey | null } {
  const parsed = readHydratableBoard(key, bytes);
  if (parsed.error !== null || parsed.value === null) return { value: null, error: parsed.error, missing: null };
  const board = parsed.value;
  const grid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  const dependencies: AssetKey[] = [];
  const depSet = new Set<AssetKey>();
  const backgroundImage = board.properties.backgroundImage;
  if (backgroundImage !== undefined && backgroundImage !== "") {
    const background = resolveAsset(index, root, "bitmaps", backgroundImage);
    if (background.ok) {
      addDependency(background.value, dependencies, depSet);
      if (!assets.has(background.value)) return { value: null, error: null, missing: background.value };
    }
  }
  const resolved: (WorldTile | null)[] = [];
  const metadata = new Map<AssetKey, WorldTileset>();
  for (const reference of board.lut) {
    if (reference === "") {
      resolved.push(null);
      continue;
    }
    const result = resolveTileReference(index, root, reference);
    if (!result.ok) return { value: null, error: formatError(result.error, reference), missing: null };
    if (result.value.kind === "empty") {
      resolved.push(null);
      continue;
    }
    let asset = result.value.asset;
    let tile = result.value.kind === "tileset" || result.value.kind === "isometric" ? result.value.tile : 1;
    addDependency(asset, dependencies, depSet);
    if (result.value.kind === "animatedTile") {
      const animationBytes = assets.get(asset);
      if (animationBytes === undefined) return { value: null, error: null, missing: asset };
      const animation = readTileAnimation(new BinaryReader(animationBytes, asset));
      if (!animation.ok) return { value: null, error: formatError(animation.error, asset), missing: null };
      const frameIndex = frameAt(0, tick, ticksPerFrame(animation.value.speed), animation.value.frames.length, true);
      const frame = frameIndex < 0 ? "" : animation.value.frames[frameIndex] ?? "";
      if (frame === "") {
        resolved.push(null);
        continue;
      }
      const selected = resolveTileReference(index, root, frame);
      if (!selected.ok) return { value: null, error: formatError(selected.error, frame), missing: null };
      if (selected.value.kind === "empty") {
        resolved.push(null);
        continue;
      }
      asset = selected.value.asset;
      tile = selected.value.kind === "tileset" || selected.value.kind === "isometric" ? selected.value.tile : 1;
      addDependency(asset, dependencies, depSet);
    }
    const tileBytes = assets.get(asset);
    if (tileBytes === undefined) return { value: null, error: null, missing: asset };
    const info = tileInfo(asset, tileBytes);
    if (info.error !== null) return { value: null, error: info.error, missing: null };
    if (info.metadata !== null) metadata.set(asset, info.metadata);
    const dimensions = info.metadata;
    resolved.push({
      asset,
      tile,
      ...(dimensions === null ? {} : {
        nativeWidth: dimensions.nativeWidth,
        nativeHeight: dimensions.nativeHeight,
        width: dimensions.width,
        height: dimensions.height,
      }),
    });
  }
  const hydratedImages: WorldImage[] = [];
  for (const source of board.images) {
    const resolvedImage = resolveAsset(index, root, "bitmaps", source.file);
    if (!resolvedImage.ok) {
      hydratedImages.push(image(source));
      continue;
    }
    addDependency(resolvedImage.value, dependencies, depSet);
    const imageBytes = assets.get(resolvedImage.value);
    if (imageBytes === undefined) {
      return { value: null, error: null, missing: resolvedImage.value };
    }
    const isTileBitmap = source.file.toLowerCase().endsWith(".tbm");
    if (!isTileBitmap) {
      hydratedImages.push({ ...image(source), asset: resolvedImage.value });
      continue;
    }
    const parsedBitmap = readTileBitmap(new BinaryReader(imageBytes, resolvedImage.value));
    if (!parsedBitmap.ok) return { value: null, error: formatError(parsedBitmap.error, resolvedImage.value), missing: null };
    const cells: NonNullable<WorldImage["cells"]> = [];
    const columns = Math.max(0, parsedBitmap.value.width);
    const rows = Math.max(0, parsedBitmap.value.height);
    for (let x = 0; x < columns; x += 1) {
      for (let y = 0; y < rows; y += 1) {
        const bitmapCell = tileBitmapCell(parsedBitmap.value, x, y);
        if (bitmapCell === undefined || bitmapCell.tile === "") continue;
        const tileResult = resolveTileReference(index, root, bitmapCell.tile);
        if (!tileResult.ok) return { value: null, error: formatError(tileResult.error, bitmapCell.tile), missing: null };
        if (tileResult.value.kind === "empty") continue;
        let selectedTile = tileResult.value;
        if (selectedTile.kind === "animatedTile") {
          addDependency(selectedTile.asset, dependencies, depSet);
          const animationBytes = assets.get(selectedTile.asset);
          if (animationBytes === undefined) return { value: null, error: null, missing: selectedTile.asset };
          const animation = readTileAnimation(new BinaryReader(animationBytes, selectedTile.asset));
          if (!animation.ok) return { value: null, error: formatError(animation.error, selectedTile.asset), missing: null };
          const frameIndex = frameAt(0, tick, ticksPerFrame(animation.value.speed), animation.value.frames.length, true);
          const frame = frameIndex < 0 ? "" : animation.value.frames[frameIndex] ?? "";
          if (frame === "") continue;
          const frameResult = resolveTileReference(index, root, frame);
          if (!frameResult.ok) return { value: null, error: formatError(frameResult.error, frame), missing: null };
          if (frameResult.value.kind === "empty") continue;
          addDependency(frameResult.value.asset, dependencies, depSet);
          selectedTile = frameResult.value;
        }
        const tileAsset = selectedTile.asset;
        const tileNumber = selectedTile.kind === "tileset" || selectedTile.kind === "isometric" ? selectedTile.tile : 1;
        addDependency(tileAsset, dependencies, depSet);
        const tileBytes = assets.get(tileAsset);
        if (tileBytes === undefined) return { value: null, error: null, missing: tileAsset };
        const info = tileInfo(tileAsset, tileBytes);
        if (info.error !== null) return { value: null, error: info.error, missing: null };
        if (info.metadata !== null) metadata.set(tileAsset, info.metadata);
        cells.push({
          x,
          y,
          tile: {
            asset: tileAsset,
            tile: tileNumber,
            ...(info.metadata === null ? {} : {
              nativeWidth: info.metadata.nativeWidth,
              nativeHeight: info.metadata.nativeHeight,
              width: info.metadata.width,
              height: info.metadata.height,
            }),
          },
          tint: { r: bitmapCell.r, g: bitmapCell.g, b: bitmapCell.b },
        });
      }
    }
    hydratedImages.push({
      ...image(source),
      asset: resolvedImage.value,
      width: columns * 32,
      height: rows * 32,
      cells,
    });
  }
  const layers = Array.from({ length: board.sizeL }, (_, layer) => ({
    tiles: Array.from({ length: grid.width * grid.height }, (_, cell) => {
      const lutIndex = board.tileMatrix[layer * grid.width * grid.height + cell] ?? 0;
      return resolved[lutIndex] ?? null;
    }),
  }));
  return { value: { board: worldBoard(key, board, layers, [...metadata.values()], hydratedImages), dependencies }, error: null, missing: null };
}
