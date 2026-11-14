import type { AnyDocument } from "./kinds.ts";
import type { CloseResult, DocumentViewLease, DocumentWorkspace } from "./workspace.ts";

/**
 * The tabs of the browser and desktop hosts (T-01): one tab per open document, however it was reached (a document opened
 * from the file tree and from a link is one tab, because the workspace holds one model per identity, ADR 0022 D1.2). A
 * tab owns a view lease, so closing a tab asks about unsaved work through the workspace and a document stays open while
 * any tab holds it. Tabs are named by the document's identity key, never by the document, so a layout saved with them
 * holds no content (D7.1).
 */

export interface TabState {
  /** The document's identity key. */
  readonly key: string;
  /** The project-relative path, for the tab's title. */
  readonly path: string;
  readonly kind: string;
  readonly dirty: boolean;
}

export interface TabsSnapshot {
  readonly tabs: readonly TabState[];
  /** The key of the tab in front, or `null` when there is none. */
  readonly active: string | null;
}

export interface Tabs {
  getSnapshot(): TabsSnapshot;
  subscribe(listener: () => void): () => void;
  /** Open a tab for `document` (or bring its tab to the front) and make it active. */
  open(document: AnyDocument): void;
  activate(key: string): void;
  /** Move to the next or previous tab, wrapping round. */
  next(): void;
  previous(): void;
  /** Reorder: put the tab `key` at `index`. */
  move(key: string, index: number): void;
  /** Close the tab, asking about unsaved work through the workspace. A cancelled close keeps the tab. */
  close(key: string): Promise<CloseResult>;
  dispose(): void;
}

export function createTabs(workspace: DocumentWorkspace): Tabs {
  const listeners = new Set<() => void>();
  interface Entry {
    readonly document: AnyDocument;
    readonly lease: DocumentViewLease;
    readonly unsubscribe: () => void;
  }
  let entries: Entry[] = [];
  let active: string | null = null;
  let snapshot: TabsSnapshot = { tabs: [], active: null };

  const build = (): TabsSnapshot => ({
    tabs: entries.map((entry) => ({ key: entry.document.identity.key, path: entry.document.identity.path, kind: entry.document.kind, dirty: entry.document.getSnapshot().dirty })),
    active,
  });
  const publish = (): void => {
    snapshot = build();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A view that cannot update is that view's fault; the snapshot it missed is still current.
      }
    }
  };
  const indexOf = (key: string): number => entries.findIndex((entry) => entry.document.identity.key === key);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    open(document) {
      const key = document.identity.key;
      if (indexOf(key) === -1) {
        const lease = workspace.attachView(document);
        entries = [...entries, { document, lease, unsubscribe: document.subscribe(publish) }];
      }
      active = key;
      publish();
    },
    activate(key) {
      if (indexOf(key) === -1 || active === key) return;
      active = key;
      publish();
    },
    next() {
      if (entries.length === 0) return;
      const at = active === null ? -1 : indexOf(active);
      active = entries[(at + 1) % entries.length]!.document.identity.key;
      publish();
    },
    previous() {
      if (entries.length === 0) return;
      const at = active === null ? 0 : indexOf(active);
      active = entries[(at - 1 + entries.length) % entries.length]!.document.identity.key;
      publish();
    },
    move(key, index) {
      const from = indexOf(key);
      if (from === -1) return;
      const to = Math.min(Math.max(0, Math.trunc(index)), entries.length - 1);
      if (to === from) return;
      const next = [...entries];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      entries = next;
      publish();
    },
    async close(key) {
      const at = indexOf(key);
      if (at === -1) return { closed: true };
      const entry = entries[at]!;
      const result = await entry.lease.close();
      if (!result.closed) return result;
      // The tab may already be gone if the document was closed another way while the question was open.
      const now = indexOf(key);
      if (now !== -1) {
        entries[now]!.unsubscribe();
        entries = entries.filter((_, index) => index !== now);
        if (active === key) active = entries[Math.min(now, entries.length - 1)]?.document.identity.key ?? null;
      }
      publish();
      return result;
    },
    dispose() {
      for (const entry of entries) {
        entry.unsubscribe();
        entry.lease.dispose();
      }
      entries = [];
      active = null;
      listeners.clear();
      snapshot = { tabs: [], active: null };
    },
  };
}
