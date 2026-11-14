import {
  createAssetPicker,
  type AssetKind,
  createLayoutModel,
  createPreferences,
  createProjectTree,
  createTabs,
  createVisits,
  prepareGamePackage,
  publishGamePackage,
  type PreparedGamePackage,
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
function samePackageProposal(a: PreparedGamePackage, b: PreparedGamePackage): boolean {
  const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
    return true;
  };
  const samePaths = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((path, index) => path === right[index]);
  return sameBytes(a.package.bytes, b.package.bytes)
    && sameBytes(a.descriptor.bytes, b.descriptor.bytes)
    && samePaths(a.includedFiles, b.includedFiles)
    && samePaths(a.excludedFiles, b.excludedFiles);
}

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
          entry = { document, view: mountDocumentView(project, document, container), shownIn: container };
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

  const shell: ViewHandle = mountShell(element, {
    layout,
    tabs,
    tree,
    projectLayout,
    fs: services.fs,
    canWriteFolder: services.capabilities.has("folderWrite"),
    version,
    onOpened: (result) => {
      if (result.via === "document") show(result.document);
    },
    onOpenPath: (path) => { void openPath(path); },
    onPackage: async (mainPath, releaseVersion) => {
      const prepared = await prepareGamePackage({ workspace, services, mainPath, version: releaseVersion });
      return prepared.ok ? { ok: true, prepared: prepared.value } : prepared;
    },
    onPublish: async (mainPath, releaseVersion, reviewed) => {
      const fresh = await prepareGamePackage({ workspace, services, mainPath, version: releaseVersion });
      if (!fresh.ok) return fresh;
      if (!samePackageProposal(reviewed, fresh.value)) {
        return { ok: false, message: "Project files or release version changed since preflight. Prepare and review the package again." };
      }
      const published = await publishGamePackage(services, mainPath, fresh.value);
      return published.ok ? { ok: true, destination: published.path } : published;
    },
    onDownload: async (artifact) => {
      const result = await services.packageExport?.downloadFile(artifact.fileName, artifact.bytes);
      return result === undefined ? { ok: false, message: "This host does not provide downloads." }
        : result.ok ? { ok: true } : { ok: false, message: result.error.message };
    },
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
