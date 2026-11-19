import { decodeTexture, tileDimensions, tilesetDetail, writeTileset, type DecodedTexture, type TilesetTile } from "@tk-reawakened/core";
import { checkTileset, type Tileset } from "@tk-reawakened/native-data";
import { encodeSceneTile } from "./scene-tile-encoder.ts";

export type SceneTilesetBuildResult =
  | { readonly ok: true; readonly target: string; readonly name: string; readonly bytes: Uint8Array; readonly tiles: readonly { readonly id: string; readonly name: string; readonly index: number; readonly role: Tileset["tiles"][number]["role"]; readonly collision: Tileset["tiles"][number]["collision"] }[]; readonly notes: readonly { readonly path: string; readonly message: string }[] }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

/** Build the image portion of a native tileset; placement metadata is returned for scene lowering. */
export async function lowerSceneTileset(
  document: Tileset,
  loadSource: (path: string) => Promise<Uint8Array | null>,
): Promise<SceneTilesetBuildResult> {
  const problems: { path: string; message: string }[] = [...checkTileset(document)];
  if (problems.length > 0) return { ok: false, problems };
  const notes: { path: string; message: string }[] = [];
  if (document.tags !== undefined) notes.push({ path: "tags", message: "Tags remain in the native tileset source; they are not encoded in legacy .tst." });
  if (document.metadata !== undefined) notes.push({ path: "metadata", message: "Metadata remains in the native tileset source; it is not encoded in legacy .tst." });
  if (document.pluginData !== undefined) notes.push({ path: "pluginData", message: "Opaque plugin data remains in the native tileset source; it is not encoded in legacy .tst." });
  if (document.isoBlocks !== undefined && document.isoBlocks.length > 0) problems.push({ path: "isoBlocks", message: "Isometric block composition and output mapping are not specified." });
  if (document.autotiles !== undefined && document.autotiles.length > 0) problems.push({ path: "autotiles", message: "Autotile composition and canonical output mapping are not specified." });
  document.tiles.forEach((tile, i) => {
    if (tile.kitbash !== undefined && tile.kitbash.length > 0) problems.push({ path: `tiles[${i}].kitbash`, message: "Kitbash transformation geometry is not specified." });
  });
  const detail = tilesetDetail(document.outputBinding.detail);
  if (detail === undefined) problems.push({ path: "outputBinding.detail", message: `Unsupported tileset detail ${document.outputBinding.detail}.` });
  else if (detail.isometric) problems.push({ path: "outputBinding.detail", message: "Isometric detail 150 cannot be lowered to the specified .tst output." });
  if (document.tiles.length > 32767) problems.push({ path: "tiles", message: "Tile count exceeds the .tst limit of 32767." });
  if (problems.length > 0 || detail === undefined) return { ok: false, problems };
  const size = tileDimensions(detail);
  if (document.cellSize[0] !== size.width || document.cellSize[1] !== size.height) {
    return { ok: false, problems: [{ path: "cellSize", message: `Detail ${detail.code} requires ${size.width}×${size.height} cells; resizing is not specified.` }] };
  }
  const images = new Map<string, DecodedTexture>();
  const byFile = new Map<string, DecodedTexture>();
  for (const [i, source] of document.sources.entries()) {
    if (source.grid.width !== size.width || source.grid.height !== size.height) {
      problems.push({ path: `sources[${i}].grid`, message: `Grid cells must match the ${size.width}×${size.height} output cell size; resizing is not specified.` });
      continue;
    }
    let image = byFile.get(source.file);
    if (image === undefined) {
      let bytes: Uint8Array | null;
      try { bytes = await loadSource(source.file); }
      catch (error) {
        problems.push({ path: `sources[${i}].file`, message: `Cannot load ${source.file}: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (bytes === null) {
        problems.push({ path: `sources[${i}].file`, message: `Source ${source.file} was not found.` });
        continue;
      }
      if (bytes.length >= 4 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) {
        problems.push({ path: `sources[${i}].file`, message: "GIF source animation/frame selection is not specified." });
        continue;
      }
      const decoded = decodeTexture(bytes, source.file);
      if (!decoded.ok) {
        problems.push({ path: `sources[${i}].file`, message: `Cannot decode ${source.file}: ${decoded.error.message}` });
        continue;
      }
      if (decoded.warnings.length > 0) {
        problems.push({ path: `sources[${i}].file`, message: `Source decoding reported: ${decoded.warnings.join("; ")}` });
        continue;
      }
      image = decoded.value;
      byFile.set(source.file, image);
    }
    images.set(source.id, image);
  }
  if (problems.length > 0) return { ok: false, problems };
  const sources = new Map(document.sources.map((source) => [source.id, source]));
  const encoded: TilesetTile[] = [];
  for (const [i, tile] of document.tiles.entries()) {
    const source = sources.get(tile.source)!;
    const image = images.get(tile.source)!;
    const x = source.grid.marginX + tile.cell[0] * (source.grid.width + source.grid.gapX);
    const y = source.grid.marginY + tile.cell[1] * (source.grid.height + source.grid.gapY);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x + size.width > image.w || y + size.height > image.h) {
      problems.push({ path: `tiles[${i}].cell`, message: `Cell [${tile.cell.join(", ")}] lies outside source ${source.id} (${image.w}×${image.h}); partial cells are not addressable.` });
      continue;
    }
    const pixels = new Uint8Array(size.width * size.height * 4);
    for (let row = 0; row < size.height; row++) for (let col = 0; col < size.width; col++) {
      const from = ((y + row) * image.w + x + col) * 4;
      const to = (row * size.width + col) * 4;
      const r = image.rgba[from]!, g = image.rgba[from + 1]!, b = image.rgba[from + 2]!;
      const key = source.transparent.mode === "colorKey" && source.transparent.color[0] === r && source.transparent.color[1] === g && source.transparent.color[2] === b;
      const alpha = key ? 0 : image.rgba[from + 3]!;
      if (alpha === 0) {
        pixels[to] = 0; pixels[to + 1] = detail.bytesPerPixel === 3 ? 1 : 0; pixels[to + 2] = detail.bytesPerPixel === 3 ? 2 : 0;
      } else {
        pixels[to] = r; pixels[to + 1] = g; pixels[to + 2] = b;
      }
      pixels[to + 3] = alpha;
    }
    const result = encodeSceneTile(detail.code, { width: size.width, height: size.height, pixels });
    if (!result.ok) {
      const location = result.error.x === undefined ? "" : ` at pixel (${result.error.x}, ${result.error.y})`;
      problems.push({ path: `tiles[${i}]`, message: `${result.error.message}${location}` });
    } else encoded.push(result.tile);
  }
  if (problems.length > 0) return { ok: false, problems };
  const written = writeTileset({ version: 20, detail, tiles: encoded, residue: new Uint8Array() });
  if (!written.ok) return { ok: false, problems: [{ path: "outputBinding", message: written.error.message }] };
  return { ok: true, target: document.outputBinding.target, name: document.name, bytes: written.value, tiles: document.tiles.map((tile, i) => ({ id: tile.id, name: tile.name, index: i + 1, role: tile.role, collision: tile.collision })), notes };
}
