import { BinaryReader, readTileBitmap } from "@tk-reawakened/core";
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
  const rendered = await previewer.previewSource({ reference: "preview.tbm", path: "preview.tbm", name: "preview.tbm" }, bytes);
  if (!rendered.ok) return { ok: false, message: `The tile bitmap cannot be previewed: ${rendered.message}` };
  if (rendered.value.kind !== "bitmap" || rendered.value.preview === null) return { ok: false, message: "This tile bitmap has no drawn cells, so there is no picture." };
  const { width, height, pixels } = rendered.value.preview;
  const warnings = [
    ...listed.failures.map(({ path, error }) => `${path}: ${error.message}`),
    ...rendered.value.missing.map((tile) => `${tile}: the project holds no such tile, so its cells are drawn empty.`),
  ];
  return { ok: true, width, height, rgba: pixels, warnings };
}
