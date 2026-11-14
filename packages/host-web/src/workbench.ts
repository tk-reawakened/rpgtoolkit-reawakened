import {
  createAssetPicker,
  type AssetKind,
  createLayoutModel,
  createPreferences,
  createProjectTree,
  createTabs,
  createVisits,
  type AnyDocument,
  type LayoutModel,
  type PickOutcome,
  type ProjectLayout,
  type ProjectTree,
  type ReturnResult,
  type SavedLayout,
  type Tabs,
  type VisitResult,
  type Visits,
} from "@tk-reawakened/editor-model";
import { mountAssetPicker, mountPreferences, mountShell, type ViewHandle } from "@tk-reawakened/editor-ui";
import { mountDocumentView, type DocumentView, type WebProject } from "./index.ts";

/** The setting that keeps the layout: panel identifiers, sides, visibility and sizes only (ADR 0022 D7.1). */
const LAYOUT_SETTING = "workbench.layout";

export interface WorkbenchOptions {
  /** Where the project's type folders are; the project root by default. */
  readonly projectLayout?: ProjectLayout;
}

/** What an asset picker is asked for: a folder (by asset kind), the extensions the field takes, and what the field is called. */
export interface PickAssetRequest {
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
  readonly field: string;
  /** The picker's title, when it should say more than the field. */
  readonly title?: string;
}

export interface Workbench {
  readonly tree: ProjectTree;
  readonly tabs: Tabs;
  readonly layout: LayoutModel;
  readonly visits: Visits;
  /** Open the file the way its route says; a Toolkit document opens in a tab (or comes to the front, if it is open). */
  openPath(path: string): Promise<void>;
  /** Follow a link from `origin` to `path` in a tab, remembering where it came from. */
  visit(origin: AnyDocument, path: string): Promise<VisitResult>;
  /** Go back to where the latest visit started, opening it again if it was closed. */
  returnFromVisit(): Promise<ReturnResult>;
  /** Show a folder-aware picker over the workbench and resolve with its outcome; unchosen leaves the field as it was. */
  pickAsset(request: PickAssetRequest): Promise<PickOutcome>;
  /**
   * Show the editor preferences over the workbench (T-08). They are read from and saved to the host's settings (the
   * browser's storage for the user layer, `.tkr/editor-settings.json` for the project layer) and never to the game.
   * Escape or the Close button closes them and gives focus back to where it was. Opening them twice shows one.
   */
  openPreferences(): void;
  /** The layout as identifiers and numbers. */
  saveLayout(): SavedLayout;
  dispose(): void;
}

/**
 * The browser host's workbench (stories 11.4, T-01 to T-05): the shell of Files and Game panels and document tabs over
 * one project, the editors mounted into the shell's editor slot, linked visits, and the asset picker. Tabs hold the
 * documents' view leases; the editors it mounts hold none, so closing a tab is the one place unsaved work is asked about.
 */
export function createWorkbench(project: WebProject, element: HTMLElement, options: WorkbenchOptions = {}): Workbench {
  const projectLayout = options.projectLayout ?? { projectFolder: "" };
  const { workspace, services } = project;
  const tree = createProjectTree({ services, workspace });
  const tabs = createTabs(workspace);
  const visits = createVisits(workspace);
  const layout = createLayoutModel([
    { id: "files", title: "Files", side: "left", visible: true, size: 240, minSize: 128, maxSize: 480 },
    { id: "game", title: "Game", side: "left", visible: false, size: 240, minSize: 128, maxSize: 480 },
  ]);
  let slot: HTMLElement | null = null;
  const views = new Map<string, { readonly document: AnyDocument; readonly view: DocumentView; shownIn: HTMLElement | null }>();
  let version = 0;
  let disposed = false;
  let openPrefs: (() => void) | null = null;

  // Restore the saved layout without waiting for it: the defaults show until it arrives.
  void services.settings.get("user", LAYOUT_SETTING).then((saved) => {
    if (disposed || !saved.ok || typeof saved.value !== "string") return;
    try {
      layout.restore(JSON.parse(saved.value));
    } catch {
      // A layout that is not JSON is ignored; the defaults stay.
    }
  });
  const saveLayout = (): SavedLayout => layout.save();
  const unsubscribeLayout = layout.subscribe(() => {
    void services.settings.set("user", LAYOUT_SETTING, JSON.stringify(saveLayout()));
  });

  /** Bring the editors in line with the tabs: the active tab's editor is in the slot, the others are hidden, a closed tab's is gone. */
  const sync = (): void => {
    if (disposed) return;
    const snapshot = tabs.getSnapshot();
    const open = new Set(snapshot.tabs.map((tab) => tab.key));
    for (const [key, entry] of [...views]) {
      if (!open.has(key)) {
        entry.view.dispose();
        views.delete(key);
      }
    }
    if (slot === null) return;
    for (const tab of snapshot.tabs) {
      const document = workspace.documents().find((candidate) => candidate.identity.key === tab.key);
      if (document === undefined) continue;
      let entry = views.get(tab.key);
      if (tab.key === snapshot.active) {
        if (entry === undefined) {
          const container = slot.ownerDocument.createElement("div");
          container.className = "tkr-editor-pane";
          slot.append(container);
          entry = { document, view: mountDocumentView(project, document, container, projectLayout, openSource), shownIn: container };
          views.set(tab.key, entry);
        } else if (entry.shownIn === null) {
          const container = slot.ownerDocument.createElement("div");
          container.className = "tkr-editor-pane";
          slot.append(container);
          entry.view.show(container);
          entry.shownIn = container;
        }
      } else if (entry !== undefined && entry.shownIn !== null) {
        entry.view.hide();
        entry.shownIn.remove();
        entry.shownIn = null;
      }
    }
    for (const pane of [...slot.children]) if (pane.childNodes.length === 0) pane.remove();
  };
  const unsubscribeTabs = tabs.subscribe(sync);

  const show = (document: AnyDocument): void => {
    tabs.open(document);
    version += 1;
  };
  const openPath = async (path: string): Promise<void> => {
    const result = await tree.open(path);
    if (result.ok && result.via === "document") show(result.document);
  };
  /** What the tileset browser's "edit source" asks for: the file in a tab, or why it did not open. */
  const openSource = async (path: string): Promise<string | null> => {
    const result = await tree.open(path);
    if (!result.ok) return "message" in result.error ? result.error.message : result.error.error.message;
    if (result.via === "document") show(result.document);
    return null;
  };

  const shell: ViewHandle = mountShell(element, {
    layout,
    tabs,
    tree,
    projectLayout,
    fs: services.fs,
    version,
    onOpened: (result) => {
      if (result.via === "document") show(result.document);
    },
    onOpenPath: (path) => { void openPath(path); },
    onEditorElement: (editorElement) => {
      slot = editorElement;
      sync();
    },
  });

  return {
    tree,
    tabs,
    layout,
    visits,
    openPath,
    async visit(origin, path) {
      const result = await visits.visit(origin, path);
      if (result.ok) show(result.document);
      return result;
    },
    async returnFromVisit() {
      const result = await visits.returnFromVisit();
      if (result.ok) show(result.document);
      return result;
    },
    pickAsset(request) {
      const doc = element.ownerDocument;
      const before = doc.activeElement;
      const picker = createAssetPicker({
        services: { fs: services.fs, dialogs: services.dialogs, capabilities: services.capabilities },
        layout: projectLayout,
        kind: request.kind,
        extensions: request.extensions,
        field: request.field,
      });
      const overlay = doc.createElement("div");
      overlay.className = "tkr-picker-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", request.title ?? `Choose ${request.field}`);
      element.append(overlay);
      return new Promise<PickOutcome>((resolve) => {
        const handle = mountAssetPicker(overlay, {
          picker,
          title: request.title ?? `Choose ${request.field}`,
          onDone: (outcome) => {
            handle.dispose();
            overlay.remove();
            // Focus goes back to where the user was, so a keyboard user is not dropped at the top of the page.
            if (before instanceof HTMLElement) before.focus();
            resolve(outcome);
          },
        });
        overlay.querySelector<HTMLElement>('[role="option"], button')?.focus();
      });
    },
    openPreferences() {
      if (openPrefs !== null) return;
      const doc = element.ownerDocument;
      const before = doc.activeElement;
      const overlay = doc.createElement("div");
      overlay.className = "tkr-picker-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Editor preferences");
      const body = doc.createElement("div");
      const close = doc.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      overlay.append(close, body);
      element.append(overlay);
      const preferences = createPreferences({ settings: services.settings, projectLayer: services.capabilities.has("folderWrite") });
      const handle = mountPreferences(body, { preferences });
      const closePreferences = (): void => {
        if (openPrefs === null) return;
        openPrefs = null;
        handle.dispose();
        preferences.dispose();
        overlay.remove();
        if (before instanceof HTMLElement) before.focus();
      };
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closePreferences();
      });
      close.addEventListener("click", closePreferences);
      openPrefs = closePreferences;
      close.focus();
    },
    saveLayout,
    dispose() {
      openPrefs?.();
      disposed = true;
      unsubscribeTabs();
      unsubscribeLayout();
      for (const entry of views.values()) entry.view.dispose();
      views.clear();
      shell.dispose();
      tabs.dispose();
      tree.dispose();
    },
  };
}
