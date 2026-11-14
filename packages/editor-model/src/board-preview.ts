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
  type Board,
  type DecodedTexture,
  type DrawList,
  writeBoard,
} from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";

/**
 * A picture of a board made by the one board compositor (AD-29): the board is hydrated and composed exactly as the
 * engine's `viewbrd` preview does it (`core/engine`, `prepareBoardPreviews`), then replayed by the core rasteriser. The
 * editor owns no renderer of its own, so what an author sees is the engine's own composition of the same bytes.
 */

/** The project files a preview reads: the folder listing and a project-bound read, both from platform-services. */
export type PreviewStorage = Pick<FileSystemService, "list" | "readProject">;

export interface BoardPreviewOptions {
  /** Where tile and picture references resolve; the package layout by default. */
  readonly root?: AssetRoot;
  /** The engine tick the picture is composed at; animated tiles show the frame for this tick. */
  readonly tick?: number;
}

export type BoardPreview =
  | {
      readonly ok: true;
      /** The command list the compositor emitted: the same value the engine's frame holds for this board. */
      readonly drawList: DrawList;
      readonly width: number;
      readonly height: number;
      /** `width × height` RGBA bytes, row-major. */
      readonly rgba: Uint8Array;
      /** Files the board names that the project does not hold or the decoders refuse; their cells are drawn empty. */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

/** The cell size of the top-down compositor (`docs/spec/formats/tiles.md`). */
const TILE_PIXELS = 32;
/** The most files a project listing walk reads, so a preview over a huge project stays bounded. */
const MAX_FILES = 20000;

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
      else paths.push(path);
    }
    if (paths.length > MAX_FILES) return `The project holds more than ${MAX_FILES} files; the board preview reads no further.`;
  }
  return paths.sort();
}

/**
 * Compose the board `board` (the model a document holds now, saved or not) over the assets of the project `projectId`.
 * Only a top-down board (`coordType` 0) is composed here; the isometric views are a later story.
 */
export async function previewBoard(
  storage: PreviewStorage,
  projectId: string,
  board: Board,
  options: BoardPreviewOptions = {},
): Promise<BoardPreview> {
  if (board.coordType !== 0) {
    return { ok: false, message: "The preview shows top-down boards only; this board uses an isometric coordinate system." };
  }
  const encoded = writeBoard(board);
  if (!encoded.ok) return { ok: false, message: `The board cannot be previewed: ${encoded.error.message}` };
  const paths = await projectPaths(storage);
  if (typeof paths === "string") return { ok: false, message: paths };
  const index = createAssetIndex(paths);
  const root = options.root ?? PACKAGE_ROOT;
  const pathOf = new Map<AssetKey, string>();
  paths.forEach((path, at) => pathOf.set(index.keys[at]!, path));
  const key = assetKey("preview.brd");
  const bytes = new Map<AssetKey, Uint8Array>();
  const warnings: string[] = [];
  // Reads are repeated until the board hydrates: each round names one file the hydrator needs and does not yet hold.
  for (;;) {
    const hydrated = hydrateBoard(key, encoded.value, index, root, bytes, options.tick ?? 0);
    if (hydrated.error !== null) return { ok: false, message: `${hydrated.error.path}: ${hydrated.error.message}` };
    if (hydrated.missing !== null) {
      const path = pathOf.get(hydrated.missing);
      const read = path === undefined ? null : await storage.readProject(projectId, path);
      if (read === null || !read.ok) return { ok: false, message: `${hydrated.missing} could not be read for the preview.` };
      bytes.set(hydrated.missing, read.value);
      continue;
    }
    if (hydrated.value === null) return { ok: false, message: "The board could not be prepared for the preview." };
    const textures = new Map<AssetKey, DecodedTexture>();
    for (const dependency of hydrated.value.dependencies) {
      const source = bytes.get(dependency);
      if (source === undefined) continue;
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
      else warnings.push(`${dependency}: ${picture.error.message}`);
    }
    const width = Math.max(1, board.sizeX * TILE_PIXELS);
    const height = Math.max(1, board.sizeY * TILE_PIXELS);
    // The flags of the engine's `viewbrd` preview: shading and pictures on, sprites off.
    const drawList = composeBoard({
      board: hydrated.value.board,
      tick: options.tick ?? 0,
      camera: { x: 0, y: 0 },
      viewport: { width, height },
      alpha: 0,
      include: { shading: true, images: true, sprites: false },
      assets: textures,
    });
    const rendered = rasterize(drawList, textures);
    if (rendered.error !== null) return { ok: false, message: rendered.error };
    return { ok: true, drawList, width: rendered.width, height: rendered.height, rgba: rendered.rgba, warnings };
  }
}
