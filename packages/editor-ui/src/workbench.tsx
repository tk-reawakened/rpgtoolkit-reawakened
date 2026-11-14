import { PANEL_SIZE_STEP, type LayoutModel, type PanelState } from "@tk-reawakened/editor-model";
import type { ComponentChildren } from "preact";
import { useDocumentSnapshot } from "./use-document.ts";

/** How far one arrow key moves a panel's edge, and how far with Shift held. */
const STEP = 16;
const BIG_STEP = 64;

export interface WorkbenchProps {
  readonly layout: LayoutModel;
  /** The content of each panel, by the panel's identifier. A panel with no content here is not drawn (it may be a build that does not have it). */
  readonly panels: Readonly<Record<string, ComponentChildren>>;
  /** The tab strip, shown above the editor area. */
  readonly tabs: ComponentChildren;
  /** The active editor. */
  readonly children: ComponentChildren;
}

/**
 * A panel's size is a class, `tkr-size-<n>` for `n × 16` pixels: a style attribute is not allowed under the strict policy
 * and the CSS object model would write one back into the markup (ADR 0025 decision 6). The host's stylesheet defines the
 * classes; the layout keeps every size a whole multiple of 16.
 */
function Sized({ panel, children }: { readonly panel: PanelState; readonly children: ComponentChildren }) {
  return (
    <aside class={`tkr-panel tkr-panel-${panel.side} tkr-size-${panel.size / PANEL_SIZE_STEP}`} id={`tkr-panel-${panel.id}`} aria-label={panel.title}>
      {children}
    </aside>
  );
}

/**
 * The browser and desktop workbench (T-01, T-02): panels docked to the sides and bottom, a show/hide button for each,
 * and a separator between each panel and the editors that Left and Right (or Up and Down for the bottom) resize and Enter
 * hides. The keyboard does everything the pointer can. Panels hold views; hiding a panel removes its view and nothing
 * else (ADR 0022 D7.1): the layout holds no document.
 */
export function Workbench({ layout, panels, tabs, children }: WorkbenchProps) {
  const states = useDocumentSnapshot({ getSnapshot: () => layout.getPanels(), subscribe: (listener) => layout.subscribe(listener) });
  const shown = (side: PanelState["side"]): PanelState[] => states.filter((panel) => panel.side === side && panel.visible && panels[panel.id] !== undefined);
  const separator = (panel: PanelState) => {
    const vertical = panel.side === "bottom";
    // The arrow that moves the edge away from the panel grows it: a left panel's edge is on its right, a right panel's on
    // its left, and a bottom panel's on its top.
    const grow = (event: KeyboardEvent, amount: number): void => {
      const away = vertical ? "ArrowUp" : panel.side === "left" ? "ArrowRight" : "ArrowLeft";
      layout.resize(panel.id, event.key === away ? amount : -amount);
    };
    return (
      <div
        key={`${panel.id}-sep`}
        class="tkr-separator"
        role="separator"
        tabIndex={0}
        aria-orientation={vertical ? "horizontal" : "vertical"}
        aria-label={`Resize ${panel.title}`}
        aria-controls={`tkr-panel-${panel.id}`}
        aria-valuemin={panel.minSize}
        aria-valuemax={panel.maxSize}
        aria-valuenow={panel.size}
        onKeyDown={(event) => {
          const arrows = vertical ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
          if (arrows.includes(event.key)) {
            event.preventDefault();
            grow(event, event.shiftKey ? BIG_STEP : STEP);
          } else if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            layout.hide(panel.id);
          }
        }}
      />
    );
  };
  const dock = (side: PanelState["side"]) => shown(side).flatMap((panel) => {
    const content = <Sized key={panel.id} panel={panel}>{panels[panel.id]}</Sized>;
    // The separator sits between the panel and the editor area.
    return side === "left" ? [content, separator(panel)] : [separator(panel), content];
  });

  return (
    <div class="tkr-workbench">
      <div class="tkr-panel-toggles" role="toolbar" aria-label="Panels">
        {states.filter((panel) => panels[panel.id] !== undefined).map((panel) => (
          <button
            key={panel.id}
            type="button"
            class="tkr-panel-toggle"
            aria-pressed={panel.visible}
            aria-controls={`tkr-panel-${panel.id}`}
            onClick={() => layout.toggle(panel.id)}
          >
            {panel.title}
          </button>
        ))}
      </div>
      <div class="tkr-workbench-body">
        <div class="tkr-dock tkr-dock-left">{dock("left")}</div>
        <main class="tkr-editor-area">
          {tabs}
          <div class="tkr-editor">{children}</div>
          <div class="tkr-dock tkr-dock-bottom">{dock("bottom")}</div>
        </main>
        <div class="tkr-dock tkr-dock-right">{dock("right")}</div>
      </div>
    </div>
  );
}
