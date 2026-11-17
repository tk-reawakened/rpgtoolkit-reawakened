import type { AnyDocument } from "./kinds.ts";
import type { CloseResult, DocumentViewLease, DocumentWorkspace } from "./workspace.ts";

/**
 * The tabs of the browser and desktop hosts (T-01): one tab per open document, however it was reached (a document opened
 * from the file tree and from a link is one tab, because the workspace holds one model per identity, ADR 0022 D1.2). A
 * tab owns a view lease, so closing a tab asks about unsaved work through the workspace and a document stays open while
 * any tab holds it. Tabs are named by the document's identity key, never by the document, so a layout saved with them
 * holds no content (D7.1).
 *
 * A host can also show something that is not a document in a tab, such as a running game (`openView`).
 * Such a tab has no unsaved work, so closing it asks nothing; it calls the view's own `close`.
 */

export interface TabState {
  /** The document's identity key, or a view tab's own key. */
  readonly key: string;
  /** The project-relative path, for the tab's title; a view tab's title. */
  readonly path: string;
  readonly kind: string;
  readonly dirty: boolean;
  /** Whether the tab shows a host view rather than a document. */
  readonly view?: true;
}

/** A tab that shows something other than a document. */
export interface TabView {
  /** Unique among the open tabs; it must not be a document identity key. */
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  /** Called once when the tab is closed (by the user or the host), after the tab is gone. */
  close(): void;
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
  /** Open a tab for a host view (or bring its tab to the front) and make it active. */
  openView(view: TabView): void;
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
  interface DocumentEntry {
    readonly key: string;
    readonly document: AnyDocument;
    readonly lease: DocumentViewLease;
    readonly unsubscribe: () => void;
  }
  interface ViewEntry {
    readonly key: string;
    readonly view: TabView;
  }
  type Entry = DocumentEntry | ViewEntry;
  let entries: Entry[] = [];
  let active: string | null = null;
  let snapshot: TabsSnapshot = { tabs: [], active: null };

  const build = (): TabsSnapshot => ({
    tabs: entries.map((entry): TabState => "view" in entry
      ? { key: entry.key, path: entry.view.title, kind: entry.view.kind, dirty: false, view: true }
      : { key: entry.key, path: entry.document.identity.path, kind: entry.document.kind, dirty: entry.document.getSnapshot().dirty }),
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
  const indexOf = (key: string): number => entries.findIndex((entry) => entry.key === key);

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
        entries = [...entries, { key, document, lease, unsubscribe: document.subscribe(publish) }];
      }
      active = key;
      publish();
    },
    openView(view) {
      if (indexOf(view.key) === -1) entries = [...entries, { key: view.key, view }];
      active = view.key;
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
      active = entries[(at + 1) % entries.length]!.key;
      publish();
    },
    previous() {
      if (entries.length === 0) return;
      const at = active === null ? 0 : indexOf(active);
      active = entries[(at - 1 + entries.length) % entries.length]!.key;
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
      if ("view" in entry) {
        entries = entries.filter((_, index) => index !== at);
        if (active === key) active = entries[Math.min(at, entries.length - 1)]?.key ?? null;
        publish();
        entry.view.close();
        return { closed: true };
      }
      const result = await entry.lease.close();
      if (!result.closed) return result;
      // The tab may already be gone if the document was closed another way while the question was open.
      const now = indexOf(key);
      if (now !== -1) {
        entry.unsubscribe();
        entries = entries.filter((_, index) => index !== now);
        if (active === key) active = entries[Math.min(now, entries.length - 1)]?.key ?? null;
      }
      publish();
      return result;
    },
    dispose() {
      const views: TabView[] = [];
      for (const entry of entries) {
        if ("view" in entry) {
          views.push(entry.view);
          continue;
        }
        entry.unsubscribe();
        entry.lease.dispose();
      }
      entries = [];
      active = null;
      listeners.clear();
      snapshot = { tabs: [], active: null };
      for (const view of views) view.close();
    },
  };
}
