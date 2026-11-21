/**
 * Project-level checks of the art a tileset or asset pack names: each source image must exist,
 * and every source cell or crop the document uses must lie inside the image's real size.
 *
 * The module is pure: the host decodes images and supplies their dimensions through `lookup`
 * (`null` for a missing or unreadable image). Documents that cannot be read are skipped here;
 * `checkDocuments` already reports them.
 */

import { readAssetPack } from "./asset-pack.ts";
import type { NativeArtReport } from "./check.ts";
import type { DocumentInput } from "./document.ts";
import { compareText } from "./fold.ts";
import { extensionOf, lookupExtension } from "./registry.ts";
import { readTile, type NativeTileSample } from "./tile.ts";
import { readTileset, tilesetCellBounds, tilesetCellReferences } from "./tileset.ts";

export type ImageSize = { readonly width: number; readonly height: number };

type Lookup = (path: string) => ImageSize | null;

/**
 * Check the source files and source regions of every tileset and asset pack among `inputs`
 * against the image sizes `lookup` supplies. Reports are ordered by document path, then by
 * position in the document.
 */
export function checkProjectArtAssets(inputs: readonly DocumentInput[], lookup: Lookup): NativeArtReport[] {
  const sizes = new Map<string, ImageSize | null>();
  const sizeOf = (file: string): ImageSize | null => {
    if (!sizes.has(file)) sizes.set(file, lookup(file));
    return sizes.get(file) ?? null;
  };

  const reports: NativeArtReport[] = [];
  const ordered = [...inputs].sort((left, right) => compareText(left.path, right.path));
  for (const input of ordered) {
    if (!("text" in input)) continue;
    const contract = lookupExtension(extensionOf(input.path) ?? "")?.contract;
    if (contract === "tileset") checkTilesetArt(input.path, input.text, sizeOf, reports);
    else if (contract === "tile") checkTileArt(input.path, input.text, sizeOf, reports);
    else if (contract === "asset-pack") checkAssetPackArt(input.path, input.text, sizeOf, reports);
  }
  return reports;
}

function missing(path: string, field: string, file: string): NativeArtReport {
  return { class: "native-art", path, field, message: `source image ${file} is missing or unreadable`, line: null };
}

/** A tile's ordinary raster samples: each file must exist and contain the authored rectangle. */
function checkTileArt(path: string, text: string, sizeOf: Lookup, reports: NativeArtReport[]): void {
  const result = readTile(text);
  if (!result.ok) return;
  const { tile } = result;
  const samples: { readonly sample: NativeTileSample; readonly field: string }[] =
    tile.visual.sample !== undefined
      ? [{ sample: tile.visual.sample, field: "visual.sample" }]
      : tile.visual.cels.map((cel, index) => ({ sample: cel.sample, field: `visual.cels[${index}].sample` }));
  for (const { sample, field } of samples) {
    if (!("file" in sample)) continue;
    const size = sizeOf(sample.file);
    if (size === null) {
      reports.push(missing(path, `${field}.file`, sample.file));
      continue;
    }
    const [x, y, width, height] = sample.rect;
    if (x + width > size.width || y + height > size.height) {
      reports.push({
        class: "native-art",
        path,
        field: `${field}.rect`,
        message: `rectangle [${x}, ${y}, ${width}, ${height}] is outside ${sample.file}: its ${size.width}x${size.height} pixels do not contain it`,
        line: null,
      });
    }
  }
}

function checkTilesetArt(path: string, text: string, sizeOf: Lookup, reports: NativeArtReport[]): void {
  const result = readTileset(text);
  if (!result.ok) return;
  const { tileset } = result;

  tileset.sources?.forEach((source, index) => {
    if (sizeOf(source.file) === null) reports.push(missing(path, `sources[${index}].file`, source.file));
  });

  for (const reference of tilesetCellReferences(tileset)) {
    const source = tileset.sources?.find((candidate) => candidate.id === reference.source);
    if (source === undefined) continue;
    const size = sizeOf(source.file);
    if (size === null) continue;
    const bounds = tilesetCellBounds(source.grid, size.width, size.height);
    const [column, row] = reference.cell;
    if (column >= bounds.columns || row >= bounds.rows) {
      reports.push({
        class: "native-art",
        path,
        field: reference.path,
        message: `cell [${column}, ${row}] of source ${source.id} is outside ${source.file}: ` +
          `its ${size.width}x${size.height} pixels hold ${bounds.columns} columns by ${bounds.rows} rows`,
        line: null,
      });
    }
  }
}

function checkAssetPackArt(path: string, text: string, sizeOf: Lookup, reports: NativeArtReport[]): void {
  const result = readAssetPack(text);
  if (!result.ok) return;
  const { assetPack } = result;

  assetPack.sources.forEach((source, index) => {
    if (sizeOf(source.file) === null) reports.push(missing(path, `sources[${index}].file`, source.file));
  });

  assetPack.assets.forEach((asset, assetIndex) => {
    asset.visuals.forEach((visual, visualIndex) => {
      const source = assetPack.sources.find((candidate) => candidate.id === visual.source);
      if (source === undefined) return;
      const size = sizeOf(source.file);
      if (size === null) return;
      const [x, y, width, height] = visual.rect;
      if (x < 0 || y < 0 || x + width > size.width || y + height > size.height) {
        reports.push({
          class: "native-art",
          path,
          field: `assets[${assetIndex}].visuals[${visualIndex}].rect`,
          message: `crop [${x}, ${y}, ${width}, ${height}] of asset ${asset.id} is outside ${source.file} (${size.width}x${size.height} pixels)`,
          line: null,
        });
      }
    });
  });
}
