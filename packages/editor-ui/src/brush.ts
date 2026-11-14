export type BrowserAssetKind = "tiles" | "bitmaps";

/** One explicitly chosen source, retained while panels and board tabs change. */
export interface BrowserSelection {
  readonly kind: BrowserAssetKind;
  readonly path: string;
  readonly reference: string;
  readonly label: string;
  /** A complete tile reference can be placed in a board cell; other sources remain browse-only until their editor/tool exists. */
  readonly boardTile: string | null;
}

const listeners = new Set<() => void>();
let selection: BrowserSelection | null = null;
let browserPath: string | null = null;
let browserScrollTop = 0;

export function getBrowserSelection(): BrowserSelection | null {
  return selection;
}

export function selectBrowserSource(next: BrowserSelection): void {
  selection = next;
  for (const listener of listeners) listener();
}

export function subscribeBrowserSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBrowserContext(): { readonly path: string | null; readonly scrollTop: number } {
  return { path: browserPath, scrollTop: browserScrollTop };
}

export function retainBrowserContext(path: string | null, scrollTop: number): void {
  browserPath = path;
  browserScrollTop = scrollTop;
}
