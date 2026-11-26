import type { SceneTerrainCellTile, TerrainScenePack, TerrainSceneTileset } from "@tk-reawakened/editor-model";

/** Everything a mounted scene view reads from files other than the scene: the tilesets, their terrains' roles and the packs. */
export interface TerrainSceneAssets {
  readonly tilesets: readonly TerrainSceneTileset[];
  readonly assetTiles: readonly { readonly label: string; readonly tile: SceneTerrainCellTile }[];
  readonly packs: readonly TerrainScenePack[];
}

/** A host-owned source of those assets: the view subscribes, the host re-reads after a recipe changes. */
export interface TerrainSceneAssetSource {
  getSnapshot(): TerrainSceneAssets;
  subscribe(listener: () => void): () => void;
}

export interface MutableTerrainSceneAssets {
  readonly source: TerrainSceneAssetSource;
  /** Replace the assets. Returns `false`, and notifies nobody, when the new assets are identical to the current ones. */
  set(next: TerrainSceneAssets): boolean;
}

/**
 * One asset source per mounted scene. A refresh that finds the same recipes (the common case: the scene was edited, no
 * tileset was) is a no-op, so the view keeps its selected terrain, tool and scroll position instead of being reset.
 * Hosts must still order their reads: only the newest read may `set`.
 */
export function createTerrainSceneAssets(initial: TerrainSceneAssets): MutableTerrainSceneAssets {
  let snapshot = initial;
  let key = assetsKey(initial);
  const listeners = new Set<() => void>();
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    set(next) {
      const nextKey = assetsKey(next);
      if (nextKey === key) return false;
      snapshot = next;
      key = nextKey;
      for (const listener of [...listeners]) listener();
      return true;
    },
  };
}

/** What makes two asset reads the same: the ids, labels, rules and problems, in the order the inventory read them. */
function assetsKey(assets: TerrainSceneAssets): string {
  return JSON.stringify(assets);
}
