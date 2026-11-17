import { webCheckpointEnvironment } from "./checkpoints.ts";
import {
  createAnimationFile, createCheckpointGroups,
  asksBeforeCreating,
  createAssetPicker,
  createBoardFile,
  createLauncher,
  type AssetKind,
  createLayoutModel,
  createPreferences,
  createWizardHistory,
  HISTORY_SETTING_IDS,
  createProgramFile,
  createProjectTree,
  createTabs,
  createVisits,
  DEFAULT_WORKBENCH_PANELS,
  listCandidates,
  newBoardSettingsFrom,
  prepareGamePackage,
  programPreferencesFrom,
  readBoardTemplate,
  rememberNewBoard,
  suggestProgramPath,
  uniqueBoardName,
  type AnyDocument,
  type CreateBoardResult,
  type NewBoardSettings,
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
import { createCreatorTestsController, mountCheckpoints, mountAssetPicker, mountNewBoard, mountPreferences, mountShell, type ViewHandle } from "@tk-reawakened/editor-ui";
import { mountDocumentView, programPreferencesModelFor, type DocumentView, type WebProject } from "./index.ts";
import { platformError, platformOk } from "@tk-reawakened/platform-services";

/** The setting that keeps the layout: panel identifiers, sides, visibility and sizes only (ADR 0022 D7.1). */
const LAYOUT_SETTING = "workbench.layout";

export interface WorkbenchOptions {
  /** Where the project's type folders are; the project root by default. */
  readonly projectLayout?: ProjectLayout;
  /** The running project's main file (`.gam`), so program editors give the language server the project; none by default. */
  readonly main?: string;
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
  /**
   * Make a new board (T-20) and open it in a tab. With "Ask before creating a board" on, the new-board questions are shown
   * over the workbench, starting from the last choices; with it off, the board is made from those choices with the first
   * free name. A board is never made over a file. Resolves with the new board's path, or `null` when nothing was made
   * (cancelled, refused or failed; a refusal is said in a dialog).
   */
  newBoard(): Promise<string | null>;
  /**
   * Make a new program (T-40) and open it in a tab. The author names it in the Save dialog, which starts from the first free
   * name in the programs folder; the file starts with the header template of the preferences and is never made over a file.
   * Resolves with the new program's path, or `null` when nothing was made (cancelled, refused or failed; a refusal is said in a dialog).
   */
  newProgram(): Promise<string | null>;
  newAnimation(): Promise<string | null>;
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
  const main = options.main ?? null;
  const { workspace, services } = project;
  const tree = createProjectTree({ services, workspace });
  const tabs = createTabs(workspace);
  const visits = createVisits(workspace);
  const layout = createLayoutModel(DEFAULT_WORKBENCH_PANELS);
  let slot: HTMLElement | null = null;
  const views = new Map<string, { readonly document: AnyDocument; readonly view: DocumentView; shownIn: HTMLElement | null }>();
  let version = 0;
  let disposed = false;
  let openPrefs: (() => void) | null = null;
  let openNewBoard: (() => void) | null = null;
  /** Each run's pane, by its tab key. A pane is hidden, never detached, while another tab is in front: moving the player's frame would reload it. */
  const runPanes = new Map<string, HTMLElement>();
  let runs = 0;

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
      const pane = runPanes.get(tab.key);
      if (pane !== undefined) {
        if (pane.parentElement !== slot) slot.append(pane);
        pane.hidden = tab.key !== snapshot.active;
        continue;
      }
      const document = workspace.documents().find((candidate) => candidate.identity.key === tab.key);
      if (document === undefined) continue;
      let entry = views.get(tab.key);
      if (tab.key === snapshot.active) {
        if (entry === undefined) {
          const container = slot.ownerDocument.createElement("div");
          container.className = "tkr-editor-pane";
          slot.append(container);
          entry = { document, view: mountDocumentView(project, document, container, projectLayout, openSource, {
            pickAsset: (request) => workbench.pickAsset(request),
          }, main), shownIn: container };
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

  const tell = (message: string): Promise<unknown> =>
    services.dialogs.ask({ message, detail: "Nothing else was changed.", choices: [{ id: "ok", label: "OK" }], cancel: "ok" });

  const newBoard = async (): Promise<string | null> => {
    if (openNewBoard !== null || disposed) return null;
    const preferences = createPreferences({ settings: services.settings, projectLayer: services.capabilities.has("folderWrite") });
    await preferences.refresh();
    const remembered = newBoardSettingsFrom(preferences.getSnapshot());
    const finish = async (settings: NewBoardSettings): Promise<CreateBoardResult> => {
      const result = await createBoardFile(services.fs, projectLayout, settings, createWizardHistory(workspace.checkpoints));
      if (!result.ok) return result;
      const problem = await rememberNewBoard(preferences, settings);
      await tree.refresh();
      await openPath(result.path);
      if (problem !== null) await tell(problem);
      return result;
    };
    if (!asksBeforeCreating(preferences.getSnapshot())) {
      const result = await finish({ ...remembered, name: await uniqueBoardName(services.fs, projectLayout) });
      preferences.dispose();
      if (result.ok) return result.path;
      await tell(result.message);
      return null;
    }
    const candidates = await listCandidates(services.fs, projectLayout, "boards", [".brd"]);
    const doc = element.ownerDocument;
    const before = doc.activeElement;
    const overlay = doc.createElement("div");
    overlay.className = "tkr-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "New board");
    element.append(overlay);
    return new Promise<string | null>((resolve) => {
      const close = (path: string | null): void => {
        if (openNewBoard === null) return;
        openNewBoard = null;
        handle.dispose();
        preferences.dispose();
        overlay.remove();
        if (before instanceof HTMLElement) before.focus();
        resolve(path);
      };
      const handle = mountNewBoard(overlay, {
        initial: remembered,
        templates: candidates.candidates.map((candidate) => ({ path: candidate.path, name: candidate.reference })),
        describeTemplate: async (path) => {
          const described = await readBoardTemplate(services.fs, path);
          return described.ok ? described.settings : described.message;
        },
        onCreate: async (settings) => {
          const result = await finish(settings);
          if (!result.ok) return result;
          close(result.path);
          return { ok: true };
        },
        onCancel: () => close(null),
      });
      openNewBoard = () => close(null);
    });
  };

  const newProgram = async (): Promise<string | null> => {
    await tell("New program checks for an existing path before writing. If another application creates the same path after that check, the write may replace that file.");
    const chosen = await services.dialogs.pickSavePath({ document: "the new program", suggested: await suggestProgramPath(services.fs, projectLayout) });
    if (chosen === null) return null;
    const preferences = createPreferences({ settings: services.settings, projectLayer: services.capabilities.has("folderWrite") });
    await preferences.refresh();
    const { headerTemplate } = programPreferencesFrom(preferences.getSnapshot());
    preferences.dispose();
    const result = await createProgramFile(services.fs, chosen, headerTemplate);
    if (!result.ok) {
      await tell(result.message);
      return null;
    }
    await tree.refresh();
    await openPath(result.path);
    return result.path;
  };

  const newAnimation = async (): Promise<string | null> => {
    const path = await services.dialogs.pickSavePath({ document: "the new animation", suggested: "Misc/new-animation.anm" });
    if (path === null) return null;
    const result = await createAnimationFile(webCheckpointEnvironment(project), path);
    if (!result.ok) { await tell(result.error.message); return null; }
    if (result.value.files.some((file) => file.status !== "written")) { await tell("Animation creation stopped. Open Project recovery to review and retry."); return null; }
    await tree.refresh(); await openPath(result.value.files[0]!.path);
    return result.value.files[0]!.path;
  };
  const recovery = (): void => {
    const dialog = document.createElement("dialog");
    const content = document.createElement("div");
    const close = document.createElement("button"); close.textContent = "Close recovery";
    dialog.append(content, close); element.append(dialog);
    const view = mountCheckpoints(content, createCheckpointGroups(webCheckpointEnvironment(project)));
    const dispose = (): void => { view.dispose(); dialog.remove(); void tree.refresh(); };
    close.addEventListener("click", () => dialog.close()); dialog.addEventListener("close", dispose, { once: true });
    dialog.showModal();
  };

  const creatorTests = createCreatorTestsController({
    fs: services.fs,
    host: {
      project: project.project.id,
      async prepare() {
        for (const entry of await workspace.saveAll()) {
          if (!entry.result.ok) return platformError("io-error", `${entry.document} could not be saved (${entry.result.failure.message}), so no saved tests were started.`);
        }
        if (disposed) return platformError("unavailable", "The project was closed, so no saved tests were started.");
        const dirty = workspace.documents().find((document) => document.getSnapshot().dirty || workspace.pendingEdits(document).busy());
        if (dirty !== undefined) return platformError("unavailable", `${dirty.identity.path} changed while saving; save it and run saved tests again.`);
        const saved = workspace.documents().map((document) => ({ document, snapshot: document.getSnapshot() }));
        return platformOk(() => {
          if (disposed) return platformError("unavailable", "The project was closed, so no saved tests were started.");
          const current = workspace.documents();
          const changed = saved.find(({ document, snapshot }) => !current.includes(document) || document.getSnapshot() !== snapshot)?.document
            ?? current.find((document) => document.getSnapshot().dirty || workspace.pendingEdits(document).busy());
          return changed === undefined ? platformOk(undefined)
            : platformError("unavailable", `${changed.identity.path} changed while saved test files were being read; save it and run again.`);
        });
      },
      async openSource(path, line, column) {
        if (disposed) return platformError("unavailable", "The project was closed; its program cannot be opened here.");
        const result = await tree.open(path);
        if (disposed) return platformError("unavailable", "The project was closed; its program cannot be opened here.");
        if (!result.ok) return platformError("io-error", "message" in result.error ? result.error.message : result.error.error.message);
        if (result.via !== "document" || result.document.kind !== "program") return platformError("unavailable", `${path} did not open as a program in this workspace.`);
        show(result.document);
        const view = views.get(result.document.identity.key)?.view;
        if (view?.revealSource === undefined) return platformError("unavailable", "The program editor is not available for source navigation.");
        view.revealSource(line, column);
        return platformOk(undefined);
      },
    },
  });


  // A run shows its player in a "Running game" tab: closing the tab stops the run, and a run that ends closes its tab.
  project.setRunPresenter({
    show(frame, stop) {
      runs += 1;
      const key = `run:${runs}`;
      const pane = element.ownerDocument.createElement("div");
      pane.className = "tkr-editor-pane tkr-run-pane";
      pane.append(frame);
      runPanes.set(key, pane);
      tabs.openView({
        key,
        title: "Running game",
        kind: "run",
        close: () => {
          runPanes.delete(key);
          pane.remove();
          stop();
        },
      });
      return () => { void tabs.close(key); };
    },
  });
  const launcher = createLauncher({ services, workspace });
  const shellWorkspace = {
    ...workspace,
    historyPanel: {
      files: services.fs,
      mountPreview: (previewElement: HTMLElement, previewDocument: AnyDocument) => mountDocumentView(project, previewDocument, previewElement, projectLayout, openSource, undefined, main),
      offer: {
        isEnabled: async () => {
          const stored = await services.settings.get("user", HISTORY_SETTING_IDS.offerIgnore);
          return !(stored.ok && stored.value === false);
        },
        onNever: () => { void services.settings.set("user", HISTORY_SETTING_IDS.offerIgnore, false); },
      },
    },
  };
  const shell: ViewHandle = mountShell(element, {
    layout,
    tabs,
    tree,
    projectLayout,
    fs: services.fs,
    workspace: shellWorkspace,
    launcher,
    creatorTests,
    browser: { session: project.browserSession, fs: services.fs, layout: projectLayout, openSource },
    version,
    onOpened: (result) => {
      if (result.via === "document") show(result.document);
    },
    onOpenPath: (path) => { void openPath(path); },
    onPackage: async (mainPath, releaseVersion) => {
      const prepared = await prepareGamePackage({ workspace, services, mainPath, version: releaseVersion });
      return prepared.ok ? { ok: true, prepared: prepared.value } : prepared;
    },
    onDownload: async (artifact) => {
      const result = await services.packageExport?.downloadFile(artifact.fileName, artifact.bytes);
      return result === undefined ? { ok: false, message: "This host provides no way to save package files, so the package cannot be exported from here." }
        : result.ok ? { ok: true } : { ok: false, message: result.error.message };
    },
    onNewBoard: () => { void newBoard(); },
    onNewAnimation: () => { void newAnimation(); },
    onRecovery: recovery,
    onNewProgram: () => { void newProgram(); },
    onOpenPreferences: () => { workbench.openPreferences(); },
    onEditorElement: (editorElement) => {
      slot = editorElement;
      sync();
    },
  });

  const workbench: Workbench = {
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
      const preferences = programPreferencesModelFor(project);
      const handle = mountPreferences(body, { preferences });
      const closePreferences = (): void => {
        if (openPrefs === null) return;
        openPrefs = null;
        handle.dispose();
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
    newBoard,
    newProgram,
    newAnimation,
    saveLayout,
    dispose() {
      openPrefs?.();
      openNewBoard?.();
      disposed = true;
      project.setRunPresenter(null);
      launcher.dispose();
      creatorTests.dispose();
      unsubscribeTabs();
      unsubscribeLayout();
      for (const entry of views.values()) entry.view.dispose();
      views.clear();
      shell.dispose();
      tabs.dispose();
      tree.dispose();
    },
  };
  return workbench;
}
