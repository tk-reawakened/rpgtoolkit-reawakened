import { documentId, foldId, type SceneTerrainCellTile } from "@tk-reawakened/native-data";

type SceneRun = readonly [count: number, index: number];

/** The validated scene fields needed to lower resolved terrain cells. */
export type TerrainPaletteScene = {
  readonly projection: "2d" | "iso-stacked" | "iso-rotated";
  readonly size: { readonly width: number; readonly height: number };
  readonly floors: readonly { readonly id: string; readonly tiles?: readonly SceneRun[] }[];
  readonly tilePalette?: readonly SceneTerrainCellTile[];
  readonly legacy?: { readonly excessTiles?: SceneRun };
};

export type TerrainPaletteCell = { readonly tile: SceneTerrainCellTile; readonly path: string };
export type TerrainPaletteResult =
  | { readonly ok: true; readonly palette: readonly SceneTerrainCellTile[] | null; readonly floors: readonly { readonly id: string; readonly tiles: readonly SceneRun[] }[] }
  | { readonly ok: false; readonly problems: readonly { readonly code: string; readonly path: string; readonly message: string }[] };

/** Convert validated sparse, row-major cell replacements to board palette slots and floor runs. */
export function lowerSceneTerrainPalette(
  scene: TerrainPaletteScene,
  replacements: ReadonlyMap<string, ReadonlyMap<number, TerrainPaletteCell>>,
): TerrainPaletteResult {
  // docs/design/terrain-scene-contract-proposal.md#resolved-cell-and-what-the-board-receives
  const width = scene.projection === "iso-rotated" ? scene.size.width + scene.size.height : scene.size.width;
  const height = scene.projection === "iso-rotated" ? width : scene.size.height;
  const cellCount = width * height;
  let palette: SceneTerrainCellTile[] | null = scene.tilePalette === undefined ? null : [...scene.tilePalette];
  const indices = new Map<string, number>();
  const key = (tile: SceneTerrainCellTile): string | null => tile.tile !== undefined
    ? `tile:${foldId(documentId(tile.tile))}`
    : tile.legacy !== undefined ? `legacy:${tile.legacy}` : null;
  palette?.forEach((tile, index) => {
    const id = key(tile);
    if (id !== null && !indices.has(id)) indices.set(id, index);
  });
  const floors: { id: string; tiles: SceneRun[] }[] = [];
  for (const floor of scene.floors) {
    const tiles: [number, number][] = [];
    const append = (count: number, index: number): void => {
      if (count === 0) return;
      const last = tiles[tiles.length - 1];
      if (last !== undefined && last[1] === index) last[0] += count;
      else tiles.push([count, index]);
    };
    const cells = [...(replacements.get(floor.id) ?? [])].sort((a, b) => a[0] - b[0]);
    const base = floor.tiles ?? [[cellCount, 0] as const];
    let run = 0;
    let position = 0;
    let remaining = base[0]![0];
    const copyBase = (count: number): void => {
      while (count > 0) {
        const take = Math.min(count, remaining);
        append(take, base[run]![1]);
        count -= take;
        position += take;
        remaining -= take;
        if (remaining === 0 && run + 1 < base.length) remaining = base[++run]![0];
      }
    };
    for (const [cell, replacement] of cells) {
      copyBase(cell - position);
      const id = key(replacement.tile);
      let index = id === null ? 0 : indices.get(id);
      if (index === undefined) {
        if (palette === null) palette = [{}];
        if (palette.length >= 32_768) {
          return { ok: false, problems: [{ code: "terrain-palette-overflow", path: replacement.path, message: "The resolved tile exceeds the board's 32768-slot tile palette limit." }] };
        }
        index = palette.length;
        palette.push(replacement.tile);
        indices.set(id!, index);
      }
      copyBase(1);
      // Replace the just-copied cell while keeping runs maximal.
      const last = tiles[tiles.length - 1]!;
      if (last[0] === 1) tiles.pop();
      else last[0] -= 1;
      append(1, index);
    }
    copyBase(cellCount - position);
    floors.push({ id: floor.id, tiles });
  }
  const excess = scene.legacy?.excessTiles;
  const lastFloor = floors[floors.length - 1];
  const lastIndex = lastFloor?.tiles[lastFloor.tiles.length - 1]?.[1];
  if (excess !== undefined && excess[1] !== lastIndex) {
    return { ok: false, problems: [{ code: "terrain-excess-tiles-mismatch", path: "legacy.excessTiles", message: "The excess tile index must match the resolved last cell's palette index." }] };
  }
  return { ok: true, palette, floors };
}
