import { BinaryReader, compositeTileBitmap, readTileBitmap, type TileBitmapTile } from "@tk-reawakened/core";
import type { BoardPicture, PreviewStorage } from "./board-preview.ts";
import { listCandidates } from "./reserved-folders.ts";
import { createTileSourcePreviewer } from "./tile-source-preview.ts";

/**
 * The picture of a tile bitmap as the engine composes it (`docs/spec/formats/tiles.md#tile-bitmap-tbm`): the cells are
 * resolved through the project's tile files exactly as the shared browser resolves them, then laid out and shaded by the
 * core compositor, so the editor owns no second renderer (AD-29). It has the shape of a board's picture, because a host
 * already carries that one to a webview.
 */
export type TileBitmapPicture = BoardPicture;

/** The tile sources a cell can name. */
const TILE_EXTENSIONS = [".tst", ".iso", ".tan", ".gph"];

/** The most pixels a preview draws: the editor's largest bitmap (40 × 40 tiles) is under 1.7 million. */
const MAX_PREVIEW_PIXELS = 4_000_000;

/** A fully transparent pixel, drawn in place of a tile the project does not hold, so the other cells still show. */
const MISSING_TILE: TileBitmapTile = { w: 1, h: 1, rgba: new Uint8Array(4) };

/**
 * Compose the tile bitmap in `bytes` (`document.serialize()`: what the document holds now, saved or not) over the tiles
 * of the project `projectId`. A cell whose tile the project does not hold or cannot decode is drawn empty and named in
 * `warnings`; it is never an error, so one missing tileset does not hide the rest of the picture.
 */
export async function previewTileBitmap(storage: PreviewStorage, projectId: string, bytes: Uint8Array): Promise<TileBitmapPicture> {
  const read = readTileBitmap(new BinaryReader(bytes, "preview.tbm"));
  if (!read.ok) return { ok: false, message: `The tile bitmap cannot be previewed: ${read.error.message}` };
  const bitmap = read.value;
  if (bitmap.width < 1 || bitmap.height < 1) return { ok: false, message: "This tile bitmap has no drawn cells, so there is no picture." };
  if (bitmap.width * bitmap.height * 32 * 32 > MAX_PREVIEW_PIXELS) {
    return { ok: false, message: `This tile bitmap is larger than the ${MAX_PREVIEW_PIXELS / 1_000_000} million pixels the preview draws.` };
  }
  const listed = await listCandidates(storage, { projectFolder: "" }, "tiles", TILE_EXTENSIONS);
  const previewer = createTileSourcePreviewer(listed.candidates, async (path) => {
    const file = await storage.readProject(projectId, path);
    return file.ok ? file.value : null;
  });
  const tiles = new Map<string, TileBitmapTile>();
  const warnings: string[] = listed.failures.map(({ path, error }) => `${path}: ${error.message}`);
  for (let x = 0; x < bitmap.width; x += 1) {
    for (let y = 0; y < bitmap.height; y += 1) {
      const tile = bitmap.cells[x * (bitmap.height + 1) + y]?.tile ?? "";
      if (tile === "" || tiles.has(tile)) continue;
      const found = await previewer.previewTile(tile);
      if (found === undefined) {
        warnings.push(`${tile}: the project holds no such tile, so its cells are drawn empty.`);
        tiles.set(tile, MISSING_TILE);
      } else {
        tiles.set(tile, { w: found.width, h: found.height, rgba: found.pixels });
      }
    }
  }
  const composed = compositeTileBitmap(bitmap, tiles);
  if (!composed.ok) return { ok: false, message: composed.error.message };
  return { ok: true, width: composed.value.w, height: composed.value.h, rgba: composed.value.rgba, warnings };
}
