import {
  PACKAGE_ROOT,
  assetKey,
  composeBoard,
  createAssetIndex,
  decodeTexture,
  decodeTileTexture,
  hydrateBoard,
  rasterize,
  type AssetKey,
  type AssetRoot,
  type DecodedTexture,
  type DrawList,
  BinaryReader,
  readBoard,
  type WorldBoard,
  resolveAsset,
  foldPath,
} from "@tk-reawakened/core";
import { boardExtent } from "./board-geometry.ts";
import { projectLayoutForDocumentPath } from "./reserved-folders.ts";
import { previewBoardSprites } from "./board-sprite-preview.ts";
import type { FileSystemService } from "@tk-reawakened/platform-services";

/**
 * A picture of a board made by the one board compositor (AD-29): the board is hydrated and composed exactly as the
 * engine's `viewbrd` preview does it (`core/engine`, `prepareBoardPreviews`), then replayed by the core rasteriser. The
 * editor owns no renderer of its own, so what an author sees is the engine's own composition of the same bytes.
 */

/** The project files a preview reads: the folder listing and a project-bound read, both from platform-services. */
export type PreviewStorage = Pick<FileSystemService, "list" | "readProject">;

/**
 * What a view asks the picture to show. It is plain JSON so it can cross a webview bridge. Hiding changes only the picture:
 * a hidden layer's tiles and images are left out, and the board file is never touched.
 */
export interface BoardPreviewRequest {
  /** The layers drawn, counted from 0; every layer when absent. */
  readonly visibleLayers?: readonly number[];
  /** Whether the board's background image is drawn; it is when absent. */
  readonly showBackground?: boolean;
  /** Whether placed item sprites are drawn. The default preserves the engine's `viewbrd` picture. */
  readonly showSprites?: boolean;
}

/** The truthful visual extent for one stored board object. `index` is its raw board slot, including empty slots. */
export interface BoardObjectBounds {
  readonly kind: "sprites" | "images";
  readonly index: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly placeholder: boolean;
}

export interface BoardPreviewOptions extends BoardPreviewRequest {
  /** Where tile and picture references resolve; the package layout by default. */
  readonly root?: AssetRoot;
  /** The engine tick the picture is composed at; animated tiles show the frame for this tick. */
  readonly tick?: number;
}

/** What a view shows: the picture, or why there is none. It holds no command list, so a host can post it to a webview. */
export type BoardPicture =
  | {
      readonly ok: true;
      readonly width: number;
      readonly height: number;
      /** `width × height` RGBA bytes, row-major. */
      readonly rgba: Uint8Array;
      /** Files the board names that the project does not hold or the decoders refuse; their cells are drawn empty. */
      readonly warnings: readonly string[];
      readonly objectBounds: readonly BoardObjectBounds[];
    }
  | { readonly ok: false; readonly message: string };

export type BoardPreview =
  | (Extract<BoardPicture, { readonly ok: true }> & {
      /** The command list the compositor emitted: the same value the engine's frame holds for this board. */
      readonly drawList: DrawList;
    })
  | Extract<BoardPicture, { readonly ok: false }>;

/** The most pixels a preview draws (about 62×62 top-down tiles), so one picture stays a few megabytes. */
const MAX_PREVIEW_PIXELS = 4_000_000;
/** The most files a project listing walk reads, so a preview over a huge project stays bounded. */
const MAX_FILES = 20000;

/** The asset root beside a canonical Game/<project>/Boards file, or the package root for loose boards (AD-5). */
export function boardPreviewRootForPath(path: string): AssetRoot {
  const projectFolder = projectLayoutForDocumentPath(path).projectFolder;
  const folded = foldPath(projectFolder);
  if (!folded.startsWith("game/")) return PACKAGE_ROOT;
  return { kind: "game", projectPath: folded.slice("game/".length) };
}

/** The hydrated board with the layers and background the request hides taken out of the picture only. */
function visibleBoard(board: WorldBoard, request: BoardPreviewRequest): WorldBoard {
  if (request.visibleLayers === undefined && request.showBackground !== false) return board;
  const visible = request.visibleLayers === undefined ? null : new Set(request.visibleLayers);
  return {
    ...board,
    ...(request.showBackground === false ? { backgroundImage: "" } : {}),
    layers: visible === null ? board.layers : board.layers.map((layer, index) => (visible.has(index) ? layer : { ...layer, tiles: [] })),
    ...(visible === null || board.images === undefined ? {} : { images: board.images.filter((image) => visible.has(image.layer - 1)) }),
  };
}

async function projectPaths(storage: PreviewStorage): Promise<string[] | string> {
  const paths: string[] = [];
  const folders = [""];
  while (folders.length > 0) {
    const folder = folders.pop()!;
    const listed = await storage.list(folder);
    if (!listed.ok) {
      if (folder === "") return `The project's files could not be listed: ${listed.error.message}`;
      continue;
    }
    for (const entry of listed.value) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") folders.push(path);
      else if (entry.kind === "file") paths.push(path);
    }
    if (paths.length > MAX_FILES) return `The project holds more than ${MAX_FILES} files; the board preview reads no further.`;
  }
  return paths.sort();
}

/**
 * Compose the board in `boardBytes` (`document.serialize()`: what the document holds now, saved or not) over the assets of the project `projectId`.
 * Every layout is composed by the one compositor: top-down, iso-stacked and iso-rotated boards alike.
 */
export async function previewBoard(
  storage: PreviewStorage,
  projectId: string,
  boardBytes: Uint8Array,
  options: BoardPreviewOptions = {},
): Promise<BoardPreview> {
  const read = readBoard(new BinaryReader(boardBytes, "preview.brd"));
  if (!read.ok) return { ok: false, message: `The board cannot be previewed: ${read.error.message}` };
  const board = read.value;
  const extent = boardExtent(board);
  if (extent.width * extent.height > MAX_PREVIEW_PIXELS) {
    return { ok: false, message: `This board is larger than the ${MAX_PREVIEW_PIXELS / 1_000_000} million pixels the preview draws; edit it in the grid.` };
  }
  const paths = await projectPaths(storage);
  if (typeof paths === "string") return { ok: false, message: paths };
  let index = createAssetIndex(paths);
  const root = options.root ?? PACKAGE_ROOT;
  const pathOf = new Map<AssetKey, string>();
  paths.forEach((path, at) => pathOf.set(index.keys[at]!, path));
  const key = assetKey("preview.brd");
  const bytes = new Map<AssetKey, Uint8Array>();
  const warnings: string[] = [];
  const unavailable = new Set<AssetKey>();
  const imageAssets = new Set<AssetKey>();
  for (const image of board.images) {
    if (image.file === "") continue;
    const resolved = resolveAsset(index, root, "bitmaps", image.file);
    if (resolved.ok) imageAssets.add(resolved.value);
    else warnings.push(`${image.file}: the image is missing from this project.`);
  }
  const load = async (asset: AssetKey): Promise<Uint8Array | null> => {
    const cached = bytes.get(asset);
    if (cached !== undefined) return cached;
    if (unavailable.has(asset)) return null;
    const path = pathOf.get(asset);
    const result = path === undefined ? null : await storage.readProject(projectId, path);
    if (result === null || !result.ok) { unavailable.add(asset); return null; }
    bytes.set(asset, result.value);
    return result.value;
  };
  const omitImage = (asset: AssetKey, reason: string): void => {
    unavailable.add(asset);
    warnings.push(`${asset}: ${reason}`);
    index = createAssetIndex(paths.filter((path) => !unavailable.has(assetKey(path))));
  };
  // Reads are repeated until the board hydrates: each round names one file the hydrator needs and does not yet hold.
  for (;;) {
    const hydrated = hydrateBoard(key, boardBytes, index, root, bytes, options.tick ?? 0);
    if (hydrated.error !== null) {
      const asset = assetKey(hydrated.error.path);
      if (imageAssets.has(asset) && !unavailable.has(asset)) {
        omitImage(asset, hydrated.error.message);
        continue;
      }
      return { ok: false, message: `${hydrated.error.path}: ${hydrated.error.message}` };
    }
    if (hydrated.missing !== null) {
      if (await load(hydrated.missing) === null) {
        if (imageAssets.has(hydrated.missing)) { omitImage(hydrated.missing, "the image could not be read"); continue; }
        return { ok: false, message: `${hydrated.missing} could not be read for the preview.` };
      }
      continue;
    }
    if (hydrated.value === null) return { ok: false, message: "The board could not be prepared for the preview." };
    const textures = new Map<AssetKey, DecodedTexture>();
    let retryImages = false;
    for (const dependency of hydrated.value.dependencies) {
      const source = bytes.get(dependency);
      if (source === undefined) continue;
      // A tile bitmap is already hydrated into cells, not decoded as an ordinary picture texture.
      if (imageAssets.has(dependency) && dependency.toLowerCase().endsWith(".tbm")) continue;
      const tile = decodeTileTexture(dependency, source);
      if (tile.ok) {
        textures.set(dependency, tile.texture);
        continue;
      }
      if (tile.error !== null) {
        warnings.push(`${dependency}: ${tile.error.message}`);
        continue;
      }
      const picture = decodeTexture(source, dependency);
      if (picture.ok) textures.set(dependency, picture.value);
      else if (imageAssets.has(dependency)) { omitImage(dependency, picture.error.message); retryImages = true; }
      else warnings.push(`${dependency}: ${picture.error.message}`);
    }
    if (retryImages) continue;
    const width = Math.max(1, extent.width);
    const height = Math.max(1, extent.height);
    const spritePreview = options.showSprites === true
      ? await previewBoardSprites(board, index, root, load)
      : { draws: [], textures: new Map<AssetKey, DecodedTexture>(), bounds: [], warnings: [] };
    for (const [asset, texture] of spritePreview.textures) textures.set(asset, texture);
    warnings.push(...spritePreview.warnings);
    const visibleSprites = options.showSprites === true
      ? spritePreview.draws.filter((sprite) => options.visibleLayers === undefined || options.visibleLayers.includes(sprite.layer - 1))
      : [];
    const objectBounds: BoardObjectBounds[] = [
      ...(options.showSprites === true ? spritePreview.bounds
        .filter((bound) => {
          const sprite = board.sprites[bound.index];
          return sprite !== undefined && (options.visibleLayers === undefined || options.visibleLayers.includes(sprite.layer - 1));
        }).map((bound) => ({ kind: "sprites" as const, ...bound })) : []),
      ...board.images.flatMap((image, index) => {
        if (options.visibleLayers !== undefined && !options.visibleLayers.includes(image.layer - 1)) return [];
        const resolved = hydrated.value!.board.images?.[index];
        const texture = resolved?.asset === undefined ? undefined : textures.get(resolved.asset);
        const graphic = texture !== undefined || resolved?.cells !== undefined;
        const stretch = graphic && image.drawType === 2 && resolved?.cells === undefined;
        return [{ kind: "images" as const, index, left: stretch ? 0 : image.left, top: stretch ? 0 : image.top,
          width: stretch ? extent.width : resolved?.width ?? texture?.w ?? 32,
          height: stretch ? extent.height : resolved?.height ?? texture?.h ?? 32, placeholder: !graphic }];
      }),
    ];
    const drawList = composeBoard({
      board: visibleBoard(hydrated.value.board, options),
      tick: options.tick ?? 0,
      camera: { x: 0, y: 0 },
      viewport: { width, height },
      alpha: 0,
      include: { shading: true, images: true, sprites: options.showSprites === true },
      sprites: visibleSprites,
      assets: textures,
    });
    const rendered = rasterize(drawList, textures);
    if (rendered.error !== null) return { ok: false, message: rendered.error };
    return { ok: true, drawList, width: rendered.width, height: rendered.height, rgba: rendered.rgba, warnings, objectBounds };
  }
}
