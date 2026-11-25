import { foldPath } from "@tk-reawakened/core";
import { SCRIPT_TRANSFORM_REQUEST } from "@tk-reawakened/lsp/protocol";
import { webCheckpointEnvironment } from "./checkpoints.ts";
import {
  createAnimationFile, createCheckpointGroups,
  asMainDocument,
  asProgramDocument,
  createScriptReview,
  planScriptWorkflow,
  SCRIPT_TRANSFORM_IDS,
  SCRIPT_TRANSFORM_INFO,
  scriptProviderOver,
  type OpenScriptProgram,
  type ScriptTransformId,
  type ScriptTransformProvider,
  type ScriptWorkflowEnvironment,
  type WorkbenchCommand,
  asksBeforeCreating,
  createAssetPicker,
  createBoardFile,
  createDocumentIdentity,
  createLauncher,
  type AssetKind,
  createLayoutModel,
  createPreferences,
  createWizardHistory,
  HISTORY_SETTING_IDS,
  createProgramFile,
  createFontFile,
  suggestFontPath,
  createProjectTree,
  createTabs,
  createVisits,
  reservedFolder,
  listCandidates,
  linkFor,
  kindForPath,
  referencePath,
  newBoardSettingsFrom,
  prepareGamePackage,
  programPreferencesFrom,
  readBoardTemplate,
  rememberNewBoard,
  suggestProgramPath,
  uniqueBoardName,
  importSavedBoardAsScene,
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
  createBoardCoordinateUpgradeCommand,
  projectLayoutOfMain,
  projectLayoutOfMainFromBytes,
  projectLayoutOwnerForDocumentPath,
  resolveReservedFolderPath,
  DEFAULT_WORKBENCH_PANELS,
  upgradeBoardCopy,
  type ProjectLayoutOwner,
} from "@tk-reawakened/editor-model";
import { createCreatorTestsController, leaseLanguageClient, mountCheckpoints, mountAssetPicker, mountNewBoard, mountPreferences, mountRunStatus, mountScriptWorkflow, mountShell, type LanguageLease, type SourceVisit, type ViewHandle } from "@tk-reawakened/editor-ui";
import { mountDocumentView, programPreferencesModelFor, type DocumentView, type WebProject } from "./index.ts";
import { rootFolderOf } from "./language.ts";
import { platformError, platformOk } from "@tk-reawakened/platform-services";

/** The setting that keeps the layout: panel identifiers, sides, visibility and sizes only (ADR 0022 D7.1). */
const LAYOUT_SETTING = "workbench.layout";
/** Which saved run setup the Run button runs, in the user settings layer (ADR 0022 D8.7). */
const RUN_SETUP_SETTING = "run.setup";

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
  /** Resolve the declared owner and type-folder layout for any project-relative document path. */
  ownerForDocumentPath(path: string): Promise<ProjectLayoutOwner>;
  /** Show a folder-aware picker over the workbench and resolve with its outcome; unchosen leaves the field as it was. */
  pickAsset(request: PickAssetRequest, originPath?: string): Promise<PickOutcome>;
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
  /**
   * Review and apply a script workflow (story 13.16, T-42, T-43, T-44, T-46): format, normalise capitalisation, update
   * older syntax or clean up, over the program in front or every program in the project. The language server's result for
   * each program is shown beside the original, the author can leave any program out or cancel, and nothing is written
   * until Apply (docs/spec/engine/rpgcode-tooling.md#tool-11). Resolves when the review closes.
   */
  reviewScripts(transform: ScriptTransformId): Promise<void>;
  /**
   * Make a new bitmap font (T-65) and open it in a tab. The author names it in the Save dialog, which starts from the first
   * free name in the project's Font folder; the file is version 2.0 with all 256 glyphs empty and is never made over a file.
   * Resolves with the new font's path, or `null` when nothing was made.
   */
  newFont(): Promise<string | null>;
  /** The layout as identifiers and numbers. */
  saveLayout(): SavedLayout;
  dispose(): void;
}

interface BrowserProjectLayoutOwner extends ProjectLayoutOwner {
  readonly prospectiveLayout: ProjectLayout | null;
}
async function declaredProjectLayouts(
  project: WebProject,
  selectedMain: string | null,
  requireReadable = false,
): Promise<readonly BrowserProjectLayoutOwner[]> {
  const paths = new Set<string>();
  if (selectedMain !== null) paths.add(selectedMain);
  const visit = async (folder: string): Promise<void> => {
    const listed = await project.services.fs.list(folder);
    if (!listed.ok) {
      if (listed.error.code === "not-found") return;
      if (requireReadable) throw new Error(`Could not list ${folder || "."}: ${listed.error.message}`);
      return;
    }
    for (const entry of listed.value) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") await visit(path);
      else if (entry.kind === "file" && /\.gam$/i.test(entry.name)) paths.add(path);
    }
  };
  await visit("");
  const owners = await Promise.all([...paths].map(async (mainPath): Promise<BrowserProjectLayoutOwner | null> => {
    const readable = await project.services.fs.readProject(project.project.id, mainPath);
    if (!readable.ok) {
      if (readable.error.code === "not-found") return null;
      if (requireReadable) throw new Error(`Could not read ${mainPath}: ${readable.error.message}`);
      return { mainPath, layout: { projectFolder: "" }, prospectiveLayout: null };
    }
    const layout = await projectLayoutOfMainFromBytes(project.services.fs, readable.value, mainPath);
    const prospective = requireReadable
      ? await projectLayoutOfMainFromBytes(project.services.fs, readable.value, mainPath, true)
      : null;
    return {
      mainPath,
      layout,
      prospectiveLayout: prospective !== null
        && foldPath(prospective.projectFolder) !== foldPath(layout.projectFolder) ? prospective : null,
    };
  }));
  return owners.filter((owner): owner is BrowserProjectLayoutOwner => owner !== null);
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
  let declaredLayouts: Promise<readonly BrowserProjectLayoutOwner[]> | null = null;
  let knownLayouts: readonly BrowserProjectLayoutOwner[] | null = null;
  const layouts = (): Promise<readonly BrowserProjectLayoutOwner[]> => {
    declaredLayouts ??= declaredProjectLayouts(project, main).then((owners) => {
      knownLayouts = owners;
      return owners;
    });
    return declaredLayouts;
  };
  const refreshLayouts = async (): Promise<readonly BrowserProjectLayoutOwner[]> => {
    const owners = await declaredProjectLayouts(project, main, true);
    knownLayouts = owners;
    declaredLayouts = Promise.resolve(owners);
    return owners;
  };
  const fallbackOwnerForPath = (path: string): ProjectLayoutOwner => {
    const selectedFolder = foldPath(projectLayout.projectFolder).replace(/^\/+|\/+$/g, "");
    const foldedPath = foldPath(path);
    if (selectedFolder !== "" && (foldedPath === selectedFolder || foldedPath.startsWith(`${selectedFolder}/`))) {
      return { mainPath: main, layout: projectLayout };
    }
    if (selectedFolder === "" && main !== null) return { mainPath: main, layout: projectLayout };
    return { mainPath: null, layout: { projectFolder: "" } };
  };
  const ownerForPathSync = (path: string): ProjectLayoutOwner =>
    (knownLayouts === null ? null : projectLayoutOwnerForDocumentPath(path, knownLayouts)) ?? fallbackOwnerForPath(path);
  const ownersByDocument = new Map<string, ProjectLayoutOwner>();
  const ownerForPath = async (path: string): Promise<ProjectLayoutOwner> => {
    const owner = projectLayoutOwnerForDocumentPath(path, await layouts());
    return owner ?? fallbackOwnerForPath(path);
  };
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

  /**
   * Select a visit's one-based tile in the artwork editor already open for `document`, without changing its document,
   * drafts or history. A view still to be mounted is told by `sync` through the same handle before anything else touches it.
   */
  const revealSourceTile = (document: AnyDocument, tile: number | null): void => {
    if (tile === null || document.kind !== "tileset") return;
    views.get(document.identity.key)?.view.revealTile?.(tile);
  };

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
      const owner = ownersByDocument.get(tab.key) ?? { mainPath: main, layout: projectLayout };
      let entry = views.get(tab.key);
      if (tab.key === snapshot.active) {
        if (entry === undefined) {
          const container = slot.ownerDocument.createElement("div");
          container.className = "tkr-editor-pane";
          slot.append(container);
          entry = { document, view: mountDocumentView(project, document, container, owner.layout, async (visit) => {
            const result = await visits.visit(document, visit.path);
            if (!result.ok) return "message" in result.error ? result.error.message : result.error.error.message;
            await show(result.document);
            revealSourceTile(result.document, visit.tile);
            return null;
          }, {
            pickAsset: (request) => workbench.pickAsset(request, document.identity.path),
            open: async (path) => {
              const kind = kindForPath(path)?.id;
              const layout = owner.layout;
              if (kind !== "board" && kind !== "program" && kind !== "item" && kind !== "character" && kind !== "tile-bitmap" && kind !== "animation") return "This value is inline code or has no linked asset editor. Its text has not been changed.";
              const folder = kind === "board" ? "boards" : kind === "program" ? "programs" : kind === "item" ? "items" : kind === "character" ? "characters" : kind === "tile-bitmap" ? "bitmaps" : "animations";
              const target = kind === "animation" ? path : referencePath(layout, folder, path);
              const visited = await visits.visit(document, target);
              if (!visited.ok) return "message" in visited.error ? visited.error.message : visited.error.error.message;
              await show(visited.document);
              return null;
            },
            returnFromVisit: async () => {
              const returned = await visits.returnFromVisit();
              if (!returned.ok) return returned.message;
              await show(returned.document);
              return returned.message;
            },
            setInitialBoard: async (boardPath) => {
              if (owner.mainPath === null) return "No owning main game file is available, so this board cannot be made the initial board.";
              const link = linkFor(owner.layout, "boards", boardPath);
              if (!link.inside) return "This board is outside the owning game's Boards folder. The initial board has not changed.";
              const opened = await workspace.open(owner.mainPath);
              if (!opened.ok) return "message" in opened.error ? opened.error.message : opened.error.error.message;
              if (opened.document.kind !== "main") return `${owner.mainPath} is not a main game document.`;
              const result = asMainDocument(opened.document).apply({ type: "apply-settings", changes: { initBoard: link.reference } });
              if (!result.ok) return result.rejection.message;
              const edit = opened.document.getSnapshot().edits.find((entry) => entry.editId === result.editId);
              services.document.edited({ document: opened.document.identity.key, editId: result.editId, label: edit?.label ?? "Set initial board" });
              return "Initial board changed in the main game file. Save that file separately.";
            },
            ...(owner.mainPath === null ? {} : {
              get initialBoardPath() {
                const mainDocument = workspace.documents().find((candidate) => candidate.identity.path === owner.mainPath && candidate.kind === "main");
                const reference = mainDocument === undefined ? "" : asMainDocument(mainDocument).getSnapshot().settings.initBoard;
                return reference === "" ? "" : referencePath(owner.layout, "boards", reference);
              },
            }),
          }, owner.mainPath, importBoard, (operation) => {
            const command = boardUpgradeCommands.find(({ id }) => id === `board.upgrade.${operation}`);
            if (command !== undefined) void command.run();
          }), shownIn: container };
          views.set(tab.key, entry);
        } else if (entry.shownIn === null) {
          const container = slot.ownerDocument.createElement("div");
          container.className = "tkr-editor-pane";
          slot.append(container);
          entry.view.show(container);
          entry.shownIn = container;
        } else if (entry.shownIn.hidden) {
          entry.shownIn.hidden = false;
          entry.view.refreshAssets?.();
        }
      } else if (entry !== undefined && entry.shownIn !== null) {
        // Retain the document's mounted view so a linked visit returns to its cursor, selection and draft.
        entry.shownIn.hidden = true;
      }
    }
    for (const pane of [...slot.children]) if (pane.childNodes.length === 0) pane.remove();
  };
  const unsubscribeTabs = tabs.subscribe(sync);

  const show = async (document: AnyDocument): Promise<string | null> => {
    try {
      ownersByDocument.set(document.identity.key, await ownerForPath(document.identity.path));
    } catch (error) {
      return `Could not resolve the owning game's layout for ${document.identity.path}: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (disposed) return "The workbench is closed.";
    tabs.open(document);
    version += 1;
    return null;
  };
  const openPath = async (path: string): Promise<void> => {
    const result = await tree.open(path);
    if (result.ok && result.via === "document") {
      const problem = await show(result.document);
      if (problem !== null) await tell(problem);
    }
  };
  /** What the tileset browser's "edit source" asks for: the file in a tab at its tile, or why it did not open. */
  const openSource = async (visit: SourceVisit): Promise<string | null> => {
    const result = await tree.open(visit.path);
    if (!result.ok) return "message" in result.error ? result.error.message : result.error.error.message;
    if (result.via !== "document") return null;
    const problem = await show(result.document);
    if (problem !== null) return problem;
    revealSourceTile(result.document, visit.tile);
    return null;
  };

  /**
   * Import the file selected in Files as a same-stem scene and open it through the ordinary open route. Older boards
   * reach this even when their legacy view refuses them; a board open in a tab is refused while it has unsaved edits.
   */
  const importBoard = async (path: string) => {
    const { key } = createDocumentIdentity(project.project.id, path);
    const imported = await importSavedBoardAsScene({
      fs: services.fs,
      dialogs: services.dialogs,
      projectId: project.project.id,
      boardPath: path,
      hasPendingEdits: () => {
        const live = workspace.documents().find((candidate) => candidate.identity.key === key);
        if (live === undefined) return false;
        const snapshot = live.getSnapshot();
        return snapshot.dirty || snapshot.saving || snapshot.conflict !== null || workspace.pendingEdits(live).busy();
      },
    });
    if (!imported.ok) return imported;
    if (imported.value === null) return platformOk(undefined);
    // Both the board and Files routes update the tree before opening the new scene.
    await tree.refresh();
    const reason = await openSource({ path: imported.value, tile: null });
    return reason === null ? platformOk(undefined) : platformError("io-error", `${imported.value} was created but could not be opened: ${reason}`);
  };

  const tell = (message: string): Promise<unknown> =>
    services.dialogs.ask({ message, detail: "Nothing else was changed.", choices: [{ id: "ok", label: "OK" }], cancel: "ok" });

  let closeScripts: (() => void) | null = null;
  let scriptsBusy = false;

  /** The programs open in a tab, as the workflow reads and edits them; a compiled program has no text and is not one. */
  const openScriptPrograms = (): readonly OpenScriptProgram[] =>
    workspace.documents().filter((document) => document.kind === "program").flatMap((document) => {
      const program = asProgramDocument(document);
      if (program.getSnapshot().compiled) return [];
      return [{
        path: program.identity.path,
        text: () => program.getSnapshot().text,
        busy: () => workspace.pendingEdits(document).busy(),
        replace: async (label, next) => {
          if (workspace.pendingEdits(document).busy()) return { ok: false as const, message: "it has typing that is still being applied; try again in a moment" };
          const result = program.apply({ type: "edit-text", label, edits: [{ from: 0, to: program.getSnapshot().text.length, text: next }] });
          return result.ok ? { ok: true as const } : { ok: false as const, message: result.rejection.message };
        },
      }];
    });

  const runScriptReview = async (transform: ScriptTransformId): Promise<void> => {
    // Typing a view has sent but the document has not answered is settled first, so the plan reads what the author sees.
    for (const document of workspace.documents()) if (document.kind === "program") await workspace.pendingEdits(document).settle();
    let lease: LanguageLease | null = null;
    let provider: ScriptTransformProvider | null = null;
    let mainUri: string | undefined;
    let unavailableReason: string | undefined;
    if (services.language === undefined || !services.capabilities.has("languageServer")) {
      unavailableReason = "This host has no language server, so programs cannot be formatted or updated here.";
    } else {
      const leased = await leaseLanguageClient(services.language, main === null ? null : { main });
      if (leased.ok) {
        lease = leased.lease;
        const { client } = leased.lease;
        provider = scriptProviderOver((params) => client.request(SCRIPT_TRANSFORM_REQUEST, params), (path) => client.uriOf(path));
        mainUri = main === null ? undefined : client.uriOf(main);
      } else unavailableReason = `The language server did not start: ${leased.message}.`;
    }
    if (disposed) {
      lease?.release();
      return;
    }
    const environment: ScriptWorkflowEnvironment = {
      fs: { ...services.fs, write: (path, bytes) => services.fs.writeProject(project.project.id, path, bytes) },
      provider,
      ...(unavailableReason === undefined ? {} : { unavailableReason }),
      history: createWizardHistory(workspace.checkpoints),
      openPrograms: openScriptPrograms,
      root: main === null ? "" : rootFolderOf(main),
      ...(mainUri === undefined ? {} : { projectMainUri: mainUri }),
      ...(main === null ? {} : { projectMainPath: main }),
      isProjectCurrent: () => !disposed,
    };
    const snapshot = tabs.getSnapshot();
    const activePath = snapshot.tabs.find((tab) => tab.key === snapshot.active)?.path ?? null;
    const doc = element.ownerDocument;
    const before = doc.activeElement;
    const overlay = doc.createElement("div");
    overlay.className = "tkr-picker-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${SCRIPT_TRANSFORM_INFO[transform].name} (reviewed)`);
    // The page, not the workbench element: a re-render of the shell must never take the open review away.
    doc.body.append(overlay);
    const wasInert = element.hasAttribute("inert");
    element.setAttribute("inert", "");
    await new Promise<void>((resolve) => {
      const close = (): void => {
        // Only the review that owns the overlay may close it: a late callback from a cancelled review must never tear
        // down a review opened after it.
        if (closeScripts !== close) return;
        closeScripts = null;
        handle.dispose();
        lease?.release();
        overlay.remove();
        if (!wasInert) element.removeAttribute("inert");
        void tree.refresh();
        if (before instanceof HTMLElement) before.focus();
        resolve();
      };
      const handle = mountScriptWorkflow(overlay, {
        transform,
        activeProgram: activePath !== null && /\.(prg|rnc)$/i.test(activePath) ? activePath : null,
        plan: (scope, control) => planScriptWorkflow(environment, transform, scope, control),
        review: (plan) => createScriptReview(environment, plan),
        onClose: close,
      });
      closeScripts = close;
    });
  };

  const reviewScripts = async (transform: ScriptTransformId): Promise<void> => {
    if (scriptsBusy || disposed) return;
    scriptsBusy = true;
    try {
      await runScriptReview(transform);
    } finally {
      scriptsBusy = false;
    }
  };

  /** Every reviewed script workflow is a command of the menu and the palette (ADR 0038). */
  const scriptCommands: readonly WorkbenchCommand[] = SCRIPT_TRANSFORM_IDS.map((id) => ({
    id: `script.${id}`,
    category: "Edit",
    label: `${SCRIPT_TRANSFORM_INFO[id].name} (reviewed)…`,
    run: () => reviewScripts(id),
  }));

  const pendingBoardEdits = (boardPath: string): boolean => {
    const document = workspace.documents().find((candidate) => candidate.kind === "board" && candidate.identity.path === boardPath);
    if (document === undefined) return false;
    const snapshot = document.getSnapshot();
    return snapshot.dirty || snapshot.saving || snapshot.conflict !== null || workspace.pendingEdits(document).busy();
  };
  const activeBoardDocument = (): AnyDocument | null => {
    const active = tabs.getSnapshot().active;
    return active === null ? null : workspace.documents().find((document) => document.identity.key === active && document.kind === "board") ?? null;
  };
  const upgradeCopy = async (boardPath: string, operation: "stacked-to-rotated" | "tile-to-pixel" | "pre-vector", isPending: () => boolean): Promise<void> => {
    const owner = await ownerForPath(boardPath).catch(async (error: unknown) => {
      await tell(`Could not resolve the board's game owner: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (owner === null) return;
    const result = await upgradeBoardCopy({
      fs: services.fs,
      dialogs: services.dialogs,
      projectId: project.project.id,
      boardPath,
      boardsRoot: reservedFolder(owner.layout, "boards"),
      operation,
      hasPendingEdits: isPending,
      hasPendingEditsNow: isPending,
      isDestinationOpen: (destination) => workspace.documents().some((document) => document.identity.path === destination),
      isDestinationOwnedBySource: async (destination) => {
        const freshOwners = await refreshLayouts();
        const sourceOwner = projectLayoutOwnerForDocumentPath(boardPath, freshOwners);
        const destinationOwners = freshOwners.map(({ prospectiveLayout, ...candidate }) => ({
          ...candidate,
          layout: prospectiveLayout ?? candidate.layout,
        }));
        const destinationOwner = projectLayoutOwnerForDocumentPath(destination, destinationOwners);
        if (sourceOwner === null || destinationOwner === null
          || sourceOwner.mainPath !== owner.mainPath
          || foldPath(sourceOwner.layout.projectFolder) !== foldPath(owner.layout.projectFolder)
          || destinationOwner.mainPath !== sourceOwner.mainPath
          || foldPath(destinationOwner.layout.projectFolder) !== foldPath(sourceOwner.layout.projectFolder)) return false;
        const sourceBoardsRoot = await resolveReservedFolderPath(services.fs, reservedFolder(sourceOwner.layout, "boards"));
        if (sourceBoardsRoot.failure !== null) return false;
        const rootPrefix = `${foldPath(sourceBoardsRoot.path).replace(/\/+$/g, "")}/`;
        return foldPath(boardPath).startsWith(rootPrefix)
          && foldPath(destination).startsWith(rootPrefix);
      },
      createExclusive: null,
    }).catch(async (error: unknown) => {
      await tell(`Could not validate board ownership: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (result === null) return;
    if (!result.ok) {
      await tell(result.error.message);
      return;
    }
    if (result.value === null) return;
    const { destination, bytes } = result.value;
    await tree.refresh();
    const opened = await tree.open(destination);
    if (!opened.ok) {
      await tell("message" in opened.error ? opened.error.message : opened.error.error.message);
      return;
    }
    if (opened.via !== "document") return;
    const problem = await show(opened.document);
    if (problem !== null) {
      await tell(problem);
      return;
    }
    const reopened = opened.document.serialize();
    const snapshot = opened.document.getSnapshot();
    if (reopened.length !== bytes.length || reopened.some((value, index) => value !== bytes[index])
      || snapshot.dirty || snapshot.saving || snapshot.conflict !== null) {
      await tell(`The copy ${destination} did not reopen as the reviewed, clean baseline. No conversion was applied.`);
      return;
    }
    if (operation === "pre-vector") return;
    if (opened.document.kind !== "board") {
      await tell(`The upgraded copy ${destination} did not reopen as a board.`);
      return;
    }
    const command = createBoardCoordinateUpgradeCommand(reopened, operation);
    if (!command.ok) {
      await tell(`The copy ${destination} was opened but its coordinate conversion was refused: ${command.message}`);
      return;
    }
    const applied = opened.document.apply(command.value);
    if (!applied.ok) {
      await tell(`The copy ${destination} was opened but its coordinate conversion was refused: ${applied.rejection.message}`);
      return;
    }
    const saved = await opened.document.save();
    if (!saved.ok) await tell(saved.failure.message);
  };
  const coordinateUpgradeCommand = (operation: "stacked-to-rotated" | "tile-to-pixel", label: string): WorkbenchCommand => ({
    id: `board.upgrade.${operation}`,
    category: "Edit",
    label,
    run: async () => {
      const document = activeBoardDocument();
      if (document === null) {
        await tell("Open a saved board before choosing a coordinate upgrade.");
        return;
      }
      await upgradeCopy(document.identity.path, operation, () => pendingBoardEdits(document.identity.path));
    },
  });
  const boardUpgradeCommands: readonly WorkbenchCommand[] = [
    coordinateUpgradeCommand("stacked-to-rotated", "Convert active board from iso-stacked to iso-rotated…"),
    coordinateUpgradeCommand("tile-to-pixel", "Convert active board from tile to pixel coordinates…"),
    {
      id: "board.upgrade.pre-vector",
      category: "File",
      label: "Upgrade a pre-vector board…",
      run: async () => {
        let owners: readonly ProjectLayoutOwner[];
        try {
          owners = await refreshLayouts();
        } catch (error) {
          await tell(`Could not refresh game ownership: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        const candidateLayouts = [{ projectFolder: "" }, projectLayout, ...owners.map(({ layout }) => layout)];
        const byPath = new Map<string, { readonly path: string; readonly reference: string }>();
        const failures: { readonly path: string; readonly error: { readonly message: string } }[] = [];
        for (const candidateLayout of candidateLayouts) {
          const found = await listCandidates(services.fs, candidateLayout, "boards", [".brd"]);
          failures.push(...found.failures);
          for (const candidate of found.candidates) {
            const key = foldPath(candidate.path);
            const previous = byPath.get(key);
            if (previous !== undefined && previous.path !== candidate.path) {
              failures.push({
                path: candidate.path,
                error: { message: `Case-fold collision with ${previous.path}; board selection is ambiguous.` },
              });
              continue;
            }
            byPath.set(key, candidate);
          }
        }
        if (failures.length > 0) {
          await tell(`Could not list all board files: ${failures.map(({ path, error }) => `${path}: ${error.message}`).join("; ")}`);
          return;
        }
        const candidates = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
        if (candidates.length === 0) {
          await tell("This project has no boards to upgrade.");
          return;
        }
        const choices = [
          ...candidates.map(({ path }) => ({ id: path, label: path })),
          { id: "cancel", label: "Cancel" },
        ];
        const selected = await services.dialogs.ask<string>({
          message: "Choose a board to upgrade",
          detail: "Only minor-2 or minor-3 pre-vector boards are accepted. The original is retained.",
          choices,
          cancel: "cancel",
        });
        if (selected === "cancel") return;
        await upgradeCopy(selected, "pre-vector", () => pendingBoardEdits(selected));
      },
    },
  ];

  const newBoard = async (): Promise<string | null> => {
    if (openNewBoard !== null || disposed) return null;
    const preferences = createPreferences({ settings: services.settings, projectLayer: services.capabilities.has("folderWrite") });
    await preferences.refresh();
    const remembered = newBoardSettingsFrom(preferences.getSnapshot());
    const finish = async (settings: NewBoardSettings): Promise<CreateBoardResult> => {
      const result = await createBoardFile(services.fs, projectLayout, settings, createWizardHistory(workspace.checkpoints), project.project.id);
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
  const newFont = async (): Promise<string | null> => {
    await tell("New font checks for an existing path before writing. If another application creates the same path after that check, the write may replace that file.");
    const chosen = await services.dialogs.pickSavePath({ document: "the new font", suggested: await suggestFontPath(services.fs, projectLayout) });
    if (chosen === null) return null;
    const result = await createFontFile(services.fs, chosen, projectLayout);
    if (!result.ok) {
      await tell(result.message);
      return null;
    }
    await tree.refresh();
    await openPath(result.path);
    return result.path;
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
        const problem = await show(result.document);
        if (problem !== null) return platformError("unavailable", problem);
        const view = views.get(result.document.identity.key)?.view;
        if (view?.revealSource === undefined) return platformError("unavailable", "The program editor is not available for source navigation.");
        view.revealSource(line, column);
        return platformOk(undefined);
      },
    },
  });


  // A run shows its player and its status in a "Running game" tab (ADR 0022 D8.7). When the run is over the player goes
  // and the status stays, saying how it ended, until the tab is closed or the next run replaces it. Closing the tab stops
  // the run.
  project.setRunPresenter({
    show(frame, run) {
      for (const key of [...runPanes.keys()]) void tabs.close(key);
      runs += 1;
      const key = `run:${runs}`;
      const doc = element.ownerDocument;
      const pane = doc.createElement("div");
      pane.className = "tkr-editor-pane tkr-run-pane";
      const status = doc.createElement("div");
      status.className = "tkr-run-pane-status";
      pane.append(frame, status);
      const statusView = mountRunStatus(status, run);
      runPanes.set(key, pane);
      tabs.openView({
        key,
        title: "Running game",
        kind: "run",
        close: () => {
          runPanes.delete(key);
          statusView.dispose();
          pane.remove();
          run.stop();
        },
      });
      return () => { frame.remove(); };
    },
  });
  const launcher = createLauncher({ services, workspace });
  const shellWorkspace = {
    ...workspace,
    historyPanel: {
      files: services.fs,
      mountPreview: async (previewElement: HTMLElement, previewDocument: AnyDocument) => {
        const owner = await ownerForPath(previewDocument.identity.path);
        return mountDocumentView(project, previewDocument, previewElement, owner.layout, openSource, undefined, owner.mainPath);
      },
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
    projectLayoutForPath: (path) => path === null ? projectLayout : ownerForPathSync(path).layout,
    mainForPath: (path) => path === null ? main : ownerForPathSync(path).mainPath,
    fs: services.fs,
    workspace: shellWorkspace,
    launcher,
    extraCommands: [...scriptCommands, ...boardUpgradeCommands],
    creatorTests,
    ...(options.main === undefined ? {} : { main: options.main }),
    runSetups: {
      fs: services.fs,
      readOnly: services.capabilities.has("folderWrite") ? null : "This is a session copy, so run setups cannot be saved to the project.",
    },
    runMemory: {
      get: async () => {
        const saved = await services.settings.get("user", RUN_SETUP_SETTING);
        return saved.ok && typeof saved.value === "string" ? saved.value : null;
      },
      set: (name) => { void services.settings.set("user", RUN_SETUP_SETTING, name); },
    },
    browser: { session: project.browserSession, fs: services.fs, layout: projectLayout, openSource },
    onReturnFromVisit: async () => {
      const returned = await visits.returnFromVisit();
      if (!returned.ok) return returned.message;
      const problem = await show(returned.document);
      if (problem !== null) return problem;
      return returned.message;
    },
    version,
    onOpened: (result) => {
      if (result.via === "document") void show(result.document).then((problem) => problem === null ? undefined : tell(problem));
    },
    onOpenPath: (path) => { void openPath(path); },
    onImportBoard: async (path) => {
      const result = await importBoard(path);
      return result.ok ? null : result.error.message;
    },
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
    onNewFont: () => { void newFont(); },
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
    ownerForDocumentPath: ownerForPath,
    async visit(origin, path) {
      const result = await visits.visit(origin, path);
      if (result.ok) {
        const problem = await show(result.document);
        if (problem !== null) await tell(problem);
      }
      return result;
    },
    async returnFromVisit() {
      const result = await visits.returnFromVisit();
      if (result.ok) {
        const problem = await show(result.document);
        if (problem !== null) await tell(problem);
      }
      return result;
    },
    async pickAsset(request, originPath) {
      const owner = await ownerForPath(originPath ?? main ?? "");
      const doc = element.ownerDocument;
      const before = doc.activeElement;
      const picker = createAssetPicker({
        services: { fs: services.fs, dialogs: services.dialogs, capabilities: services.capabilities },
        layout: owner.layout,
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
      const panel = doc.createElement("div");
      panel.className = "tkr-picker";
      const body = doc.createElement("div");
      const close = doc.createElement("button");
      close.type = "button";
      close.textContent = "Close";
      panel.append(close, body);
      overlay.append(panel);
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
    reviewScripts,
    newFont,
    saveLayout,
    dispose() {
      openPrefs?.();
      openNewBoard?.();
      closeScripts?.();
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
