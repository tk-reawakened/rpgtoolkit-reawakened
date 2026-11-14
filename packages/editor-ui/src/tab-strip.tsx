import type { Tabs } from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

export interface TabStripProps {
  readonly tabs: Tabs;
  /** Called when closing a tab did not close it (the user cancelled, or a save failed), to say so. */
  readonly onCloseRefused?: (path: string, reason: string) => void;
}

/**
 * The document tabs (T-01). The strip is one tab stop; Left, Right, Home and End move between tabs (and open the one
 * moved to), and Delete closes the focused tab through the workspace, which asks about unsaved work. A tab shows `•`
 * while its document has unsaved changes, in its accessible name as well as its text.
 */
export function TabStrip({ tabs, onCloseRefused }: TabStripProps) {
  const snapshot = useDocumentSnapshot(tabs);
  const [notice, setNotice] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const focus = useRef(false);

  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  });

  const close = (key: string, path: string): void => {
    void tabs.close(key).then((result) => {
      if (result.closed) {
        setNotice(null);
        return;
      }
      const reason = result.reason === "cancelled" ? `${path} was not closed.` : `${path} was not closed: ${result.failure.message}`;
      setNotice(reason);
      onCloseRefused?.(path, reason);
    });
  };
  const go = (index: number): void => {
    const target = snapshot.tabs[Math.max(0, Math.min(snapshot.tabs.length - 1, index))];
    if (target === undefined) return;
    focus.current = true;
    tabs.activate(target.key);
  };

  return (
    <div class="tkr-tabs">
      <div ref={strip} class="tkr-tabs-strip" role="tablist" aria-label="Open documents">
        {snapshot.tabs.map((tab, index) => (
          <div key={tab.key} class="tkr-tab-wrap">
            <button
              type="button"
              role="tab"
              class={tab.key === snapshot.active ? "tkr-tab tkr-tab-active" : "tkr-tab"}
              aria-selected={tab.key === snapshot.active}
              tabIndex={tab.key === snapshot.active ? 0 : -1}
              aria-label={`${tab.path}${tab.dirty ? ", unsaved changes" : ""}`}
              onClick={() => tabs.activate(tab.key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1 >= snapshot.tabs.length ? 0 : index + 1); }
                else if (event.key === "ArrowLeft") { event.preventDefault(); go(index === 0 ? snapshot.tabs.length - 1 : index - 1); }
                else if (event.key === "Home") { event.preventDefault(); go(0); }
                else if (event.key === "End") { event.preventDefault(); go(snapshot.tabs.length - 1); }
                else if (event.key === "Delete") { event.preventDefault(); close(tab.key, tab.path); }
              }}
            >
              {tab.path.slice(tab.path.lastIndexOf("/") + 1)}
              {tab.dirty ? " •" : ""}
            </button>
            <button type="button" class="tkr-tab-close" aria-label={`Close ${tab.path}`} onClick={() => close(tab.key, tab.path)}>×</button>
          </div>
        ))}
      </div>
      {notice === null ? null : <p class="tkr-tabs-notice" role="status">{notice}</p>}
    </div>
  );
}
