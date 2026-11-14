export type BrowserAssetKind = "tiles" | "bitmaps";

/** The size in tiles of a tile bitmap chosen as a whole stamp brush (T-24). */
export interface BrowserStamp {
  readonly width: number;
  readonly height: number;
}

/** One explicitly chosen source, retained while panels and board tabs change. */
export interface BrowserSelection {
  readonly kind: BrowserAssetKind;
  readonly path: string;
  readonly reference: string;
  readonly label: string;
  /** A complete tile reference can be placed in a board cell; other sources remain browse-only until their editor/tool exists. */
  readonly boardTile: string | null;
  /** A tile bitmap is a whole stamp brush: its size in tiles. `null` for a source that is not a stamp. `path` names the `.tbm`, which a placing tool reads. */
  readonly stamp: BrowserStamp | null;
}

export interface BrowserState {
  readonly selection: BrowserSelection | null;
  readonly path: string | null;
  readonly scrollTop: number;
}

export type BrowserStateChange =
  | { readonly field: "selection"; readonly value: BrowserSelection | null }
  | { readonly field: "path"; readonly value: string | null }
  | { readonly field: "scrollTop"; readonly value: number };

export type BrowserStatePatch = readonly BrowserStateChange[];

export interface BrowserSession {
  getSnapshot(): BrowserState;
  subscribe(listener: (patch: BrowserStatePatch) => void): () => void;
  update(update: Partial<BrowserState>): void;
}

/** A host-owned session is shared only by views in the same project/workspace. */
export function createBrowserSession(initial: BrowserState = { selection: null, path: null, scrollTop: 0 }): BrowserSession {
  let snapshot = initial;
  const listeners = new Set<(patch: BrowserStatePatch) => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(update) {
      snapshot = { ...snapshot, ...update };
      const patch: BrowserStateChange[] = [];
      if (update.selection !== undefined) patch.push({ field: "selection", value: update.selection });
      if (update.path !== undefined) patch.push({ field: "path", value: update.path });
      if (update.scrollTop !== undefined) patch.push({ field: "scrollTop", value: update.scrollTop });
      for (const listener of listeners) listener(patch);
    },
  };
}

