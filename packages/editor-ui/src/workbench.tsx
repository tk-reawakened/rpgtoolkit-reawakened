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
  /** Optional IDE application menu and command palette bar rendered in the workbench header strip. */
  readonly headerBar?: ComponentChildren;
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

/** Compact 16×16 drawer toggle icons (left sidebar, right inspector, bottom panel). */
function DockCollapseIcon({ side }: { readonly side: PanelState["side"] }) {
  if (side === "left") {
    return (
      <svg class="tkr-dock-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25" />
        <rect x="2.5" y="3.5" width="4" height="9" rx="0.5" fill="currentColor" />
      </svg>
    );
  }
  if (side === "right") {
    return (
      <svg class="tkr-dock-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25" />
        <rect x="9.5" y="3.5" width="4" height="9" rx="0.5" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg class="tkr-dock-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.25" />
      <rect x="2.5" y="8.5" width="11" height="4" rx="0.5" fill="currentColor" />
    </svg>
  );
}

/**
 * The browser and desktop workbench (T-01, T-02): panels docked to the sides and bottom, per-drawer collapse icon
 * buttons, and a separator between each panel and the editors that Left and Right (or Up and Down for the bottom)
 * resize and Enter hides. The keyboard does everything the pointer can. Panels hold views; hiding a panel removes its
 * view and nothing else (ADR 0022 D7.1): the layout holds no document.
 */
export function Workbench({ layout, panels, tabs, headerBar, children }: WorkbenchProps) {
  const states = useDocumentSnapshot({ getSnapshot: () => layout.getPanels(), subscribe: (listener) => layout.subscribe(listener) });
  const available = (side: PanelState["side"]): PanelState[] =>
    states.filter((panel) => panel.side === side && panels[panel.id] !== undefined && panels[panel.id] !== null);
  const shown = (side: PanelState["side"]): PanelState[] => available(side).filter((panel) => panel.visible);
  const tilesetHidden = states.some((panel) => panel.id === "tileset" && !panel.visible);
  const toggleSide = (side: PanelState["side"]): void => {
    const sidePanels = available(side);
    if (sidePanels.length === 0) return;
    const anyVisible = sidePanels.some((panel) => panel.visible);
    for (const panel of sidePanels) {
      if (anyVisible && panel.visible) layout.hide(panel.id);
      else if (!anyVisible && !panel.visible) layout.show(panel.id);
    }
  };
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
  const dockHeader = (side: PanelState["side"]) => {
    const sidePanels = available(side);
    if (sidePanels.length === 0) return null;
    const expanded = sidePanels.some((panel) => panel.visible);
    const label = side === "left"
      ? (expanded ? "Collapse left sidebar" : "Expand left sidebar")
      : side === "right"
        ? (expanded ? "Collapse right inspector" : "Expand right inspector")
        : (expanded ? "Collapse Run panel" : "Expand Run panel");
    return (
      <div class={`tkr-dock-header tkr-dock-header-${side}`}>
        {side === "bottom" ? <span class="tkr-dock-header-title">{sidePanels.map((p) => p.title).join(" / ")}</span> : null}
        <button
          type="button"
          class="tkr-dock-collapse-btn"
          aria-label={label}
          aria-pressed={expanded}
          title={label}
          onClick={() => toggleSide(side)}
        >
          <DockCollapseIcon side={side} />
        </button>
      </div>
    );
  };

  const leftAvailable = available("left").length > 0;
  const leftExpanded = shown("left").length > 0;
  const rightAvailable = available("right").length > 0;
  const rightExpanded = shown("right").length > 0;
  const bottomAvailable = available("bottom").length > 0;
  const bottomExpanded = shown("bottom").length > 0;

  return (
    <div class="tkr-workbench" data-tileset-hidden={tilesetHidden ? "true" : undefined}>
      <div class="tkr-panel-toggles" role="toolbar" aria-label="Workbench bar">
        {headerBar}
      </div>
      <div class="tkr-workbench-body">
        {leftAvailable ? (
          <div class="tkr-dock tkr-dock-left" data-collapsed={leftExpanded ? "false" : "true"}>
            {dockHeader("left")}
            {dock("left")}
          </div>
        ) : null}
        <main class="tkr-editor-area">
          {tabs}
          <div class="tkr-editor">{children}</div>
          {bottomAvailable ? (
            <div class="tkr-dock tkr-dock-bottom" data-collapsed={bottomExpanded ? "false" : "true"}>
              {dockHeader("bottom")}
              {dock("bottom")}
            </div>
          ) : null}
        </main>
        {rightAvailable ? (
          <div class="tkr-dock tkr-dock-right" data-collapsed={rightExpanded ? "false" : "true"}>
            {dockHeader("right")}
            {dock("right")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
