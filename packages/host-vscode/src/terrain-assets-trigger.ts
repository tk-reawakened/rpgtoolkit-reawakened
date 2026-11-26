/**
 * When a native scene's tilesets must be read again in VS Code. A tileset edit is read after the typing pause, but a save
 * is read at once: with autosave off the pause before saving reads the bytes on disk, which are still the old ones.
 */
const RECIPE = /\.(?:tkrtst|tkrtle)$/i;

export function isTilesetDocumentPath(path: string): boolean {
  return RECIPE.test(path);
}

export interface TilesetRefreshTrigger {
  /** A text change in `path`: re-read once, after the typing pause, and only for a tileset. */
  edited(path: string): void;
  /** A save of `path`: re-read now, cancelling the pending pause, and only for a tileset. */
  saved(path: string): void;
  /** Whether a debounced read is waiting (for tests and for a clean dispose). */
  readonly pending: boolean;
  dispose(): void;
}

export function createTilesetRefreshTrigger(reload: () => void, delayMs = 250): TilesetRefreshTrigger {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  return {
    edited(path) {
      if (!isTilesetDocumentPath(path)) return;
      cancel();
      timer = setTimeout(() => { timer = undefined; reload(); }, delayMs);
    },
    saved(path) {
      if (!isTilesetDocumentPath(path)) return;
      cancel();
      reload();
    },
    get pending() { return timer !== undefined; },
    dispose: cancel,
  };
}
