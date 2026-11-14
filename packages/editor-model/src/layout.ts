/**
 * The workbench layout of the browser host and the desktop host (T-01, T-02, ADR 0022 D7): which panels there are, which
 * are shown, where they dock and how big they are, and the tabs of the open documents. It is plain data and commands, so
 * a keyboard and a pointer reach the same actions, and no document, history or unsaved edit is ever held here (D7.1): a
 * layout names panels and tabs by identifier only, so closing or hiding one disposes a view and nothing else.
 *
 * No docking library is chosen yet (ADR 0028 is proposed); this is the part every candidate needs and none of them owns.
 * VS Code uses its own editor groups and views and does not use this.
 */

export type DockSide = "left" | "right" | "bottom";

export interface PanelDefinition {
  /** A stable identifier; saved layouts name panels by it. */
  readonly id: string;
  /** A name for the panel's tab and its show/hide menu. */
  readonly title: string;
  readonly side: DockSide;
  readonly visible: boolean;
  /**
   * Size in pixels along the dock's own axis (width for left and right, height for bottom), in whole `PANEL_SIZE_STEP`s:
   * a size is shown by a class (`tkr-size-<size / 16>`), never a style attribute, which the strict policy forbids
   * (ADR 0025 decision 6). A size that is not a multiple is rounded to the nearest one.
   */
  readonly size: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/** The unit every panel size is a multiple of, in pixels. */
export const PANEL_SIZE_STEP = 16;

export interface PanelState {
  readonly id: string;
  readonly title: string;
  readonly side: DockSide;
  readonly visible: boolean;
  readonly size: number;
  readonly minSize: number;
  readonly maxSize: number;
}

/** What a saved layout holds: identifiers and numbers, nothing else. */
export interface SavedLayout {
  readonly panels: readonly { readonly id: string; readonly side: DockSide; readonly visible: boolean; readonly size: number }[];
}

export interface LayoutModel {
  getPanels(): readonly PanelState[];
  subscribe(listener: () => void): () => void;
  show(id: string): void;
  hide(id: string): void;
  toggle(id: string): void;
  /** Change the size by `delta`, clamped to the panel's own limits. */
  resize(id: string, delta: number): void;
  /** Dock the panel at `side`. */
  move(id: string, side: DockSide): void;
  /** The layout as identifiers and numbers. */
  save(): SavedLayout;
  /**
   * Apply a saved layout. A panel the saved layout does not know keeps its default; a saved panel that is not defined now
   * is ignored (a layout from a build with other panels still restores), and a bad value is clamped or ignored.
   */
  restore(saved: unknown): void;
}

const SIDES: readonly DockSide[] = ["left", "right", "bottom"];

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** The nearest multiple of the size step. */
function snap(value: number): number {
  return Math.round(value / PANEL_SIZE_STEP) * PANEL_SIZE_STEP;
}

export function createLayoutModel(definitions: readonly PanelDefinition[]): LayoutModel {
  const listeners = new Set<() => void>();
  let panels: readonly PanelState[] = definitions.map((definition) => {
    const minSize = Math.ceil(definition.minSize / PANEL_SIZE_STEP) * PANEL_SIZE_STEP;
    const maxSize = Math.max(minSize, Math.floor(definition.maxSize / PANEL_SIZE_STEP) * PANEL_SIZE_STEP);
    return { ...definition, minSize, maxSize, size: clamp(snap(definition.size), minSize, maxSize) };
  });
  const publish = (next: readonly PanelState[]): void => {
    panels = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A view that cannot update is that view's fault; the layout it missed is still current.
      }
    }
  };
  const change = (id: string, edit: (panel: PanelState) => PanelState): void => {
    const index = panels.findIndex((panel) => panel.id === id);
    if (index === -1) return;
    const next = edit(panels[index]!);
    if (next === panels[index]) return;
    publish(panels.map((panel, at) => (at === index ? next : panel)));
  };
  return {
    getPanels: () => panels,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    show: (id) => change(id, (panel) => (panel.visible ? panel : { ...panel, visible: true })),
    hide: (id) => change(id, (panel) => (panel.visible ? { ...panel, visible: false } : panel)),
    toggle: (id) => change(id, (panel) => ({ ...panel, visible: !panel.visible })),
    resize: (id, delta) =>
      change(id, (panel) => {
        const size = clamp(snap(panel.size + delta), panel.minSize, panel.maxSize);
        return size === panel.size ? panel : { ...panel, size };
      }),
    move: (id, side) => change(id, (panel) => (panel.side === side || !SIDES.includes(side) ? panel : { ...panel, side })),
    save: () => ({ panels: panels.map((panel) => ({ id: panel.id, side: panel.side, visible: panel.visible, size: panel.size })) }),
    restore(saved) {
      if (typeof saved !== "object" || saved === null || !("panels" in saved) || !Array.isArray(saved.panels)) return;
      let next = panels;
      for (const entry of saved.panels as unknown[]) {
        if (typeof entry !== "object" || entry === null || !("id" in entry) || typeof entry.id !== "string") continue;
        const at = next.findIndex((panel) => panel.id === entry.id);
        if (at === -1) continue;
        const current = next[at]!;
        const side = "side" in entry && typeof entry.side === "string" && (SIDES as readonly string[]).includes(entry.side) ? (entry.side as DockSide) : current.side;
        const visible = "visible" in entry && typeof entry.visible === "boolean" ? entry.visible : current.visible;
        const size = "size" in entry && typeof entry.size === "number" && Number.isFinite(entry.size) ? clamp(snap(entry.size), current.minSize, current.maxSize) : current.size;
        next = next.map((panel, index) => (index === at ? { ...panel, side, visible, size } : panel));
      }
      publish(next);
    },
  };
}
