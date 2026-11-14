import { createDocumentWorkspace, createPreferences, editorPreferencesFrom, previewBoard, previewTileBitmap, type AnyDocument, type DocumentViewLease, type DocumentWorkspace, type ProjectLayout, type WorkspaceOpenResult } from "@tk-reawakened/editor-model";
import type { Capability, DialogService, PackageExportService, PlatformServices, ProjectHandle } from "@tk-reawakened/platform-services";
import { bindProjectFileSystem, platformError, platformOk } from "@tk-reawakened/platform-services";
import { createBrowserSession, mount, type BoardPreferencesSource, type BoardViewDocument, type BrowserSession, type TileBitmapViewDocument, type ViewContext, type ViewDocument, type ViewHandle } from "@tk-reawakened/editor-ui";
import { canPickFile, createPageDialogs, pickOutsideFile } from "./dialogs.ts";
import { createWebFileSystem } from "./filesystem.ts";
import { createWebSettings, type UserSettingsStorage } from "./settings.ts";
import { recentWebProjects, registerWebProject, restoreWebProject } from "./projects.ts";

/**
 * A project open in the browser host. Its `workspace` is the host's workbench: one model per document, undo by `editId`,
 * save all, close and revert that ask first, and Save As (ADR 0022 D3). The browser keeps no backup of unsaved work and
 * cannot watch files, so neither `backup` nor `fileWatch` is declared: a change another program makes is found when the
 * document is saved (D3.5, D11.3).
 */
export interface WebProject {
  readonly services: PlatformServices;
  readonly project: ProjectHandle;
  readonly sessionCopy: boolean;
  readonly workspace: DocumentWorkspace;
  /** Browser selection and scroll are retained per this project, shared only by its mounted views. */
  readonly browserSession: BrowserSession;
  /** Retire this project from its host session; accepted operations remain bound to their original project. */
  deactivate(): void;
}

/** What a browser project is made with; `dialogs` defaults to the page's own modal dialogs. */
export interface WebProjectOptions {
  readonly dialogs?: DialogService;
  /** Where the user layer of the editor settings is kept; the page's `localStorage` by default, memory when there is none. */
  readonly userSettings?: UserSettingsStorage | null;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (this: Window, options: { readonly mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

/** The capabilities of a folder the File System Access API opened and the browser registered as a stable project. */
const FOLDER_CAPABILITIES: readonly Capability[] = ["folderWrite", "stableProjectHandle", "conflictReload", "conflictAutoSave"];

/** Open a directory with the browser's native picker; stable identity requires successful IndexedDB registration. */
export async function openWebProject(): Promise<WebProject | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    const root = await picker.call(window, { mode: "readwrite" });
    const project = await registerWebProject(root);
    return project ? createFolderProject(root, project) : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Restore a recent folder only from an explicit user action, allowing permission prompts at that point. */
export async function reopenWebProject(id: string): Promise<WebProject | null> {
  const restored = await restoreWebProject(id);
  return restored ? createFolderProject(restored.root, restored.handle) : null;
}

/** Read recent projects without prompting; null means browser persistence is unavailable. */
export async function listRecentWebProjects(): Promise<readonly ProjectHandle[] | null> {
  return recentWebProjects();
}

/**
 * The page's dialogs, made on the first question. A host built without a page (a Node test, or a document opened before
 * anything is asked) never touches a global `document`.
 */
function pageDialogs(): DialogService {
  let made: DialogService | null = null;
  return {
    ask: (question) => (made ??= createPageDialogs(document)).ask(question),
    pickSavePath: (request) => (made ??= createPageDialogs(document)).pickSavePath(request),
    // Present only where the browser has a file picker, so the `pickFile` capability is honest (T-05).
    ...(typeof window !== "undefined" && canPickFile(window) ? { pickFile: (request: Parameters<NonNullable<DialogService["pickFile"]>>[0]) => pickOutsideFile(window, request) } : {}),
  };
}

function webPackageExport(doc: Document | null): PackageExportService {
  return {
    async sha256(bytes) {
      try {
        const crypto = doc?.defaultView?.crypto;
        if (crypto === undefined || crypto.subtle === undefined) return platformError("unavailable", "Web Crypto is unavailable for the package digest.");
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer));
        const hex = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        return platformOk(hex);
      } catch {
        return platformError("io-error", "Could not calculate the package SHA-256 digest.");
      }
    },
    async downloadFile(fileName, bytes) {
      if (fileName.includes("/") || fileName.includes(String.fromCharCode(92))) return platformError("invalid-path", "The download name must be a file name.");
      if (doc === null) return platformError("unavailable", "Browser downloads are unavailable in this document.");
      const view = doc.defaultView;
      if (view === null) return platformError("unavailable", "Browser downloads are unavailable in this document.");
      let url: string | null = null;
      try {
        url = view.URL.createObjectURL(new view.Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/octet-stream" }));
        const anchor = doc.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.hidden = true;
        doc.body.append(anchor);
        anchor.click();
        anchor.remove();
        view.setTimeout(() => { if (url !== null) view.URL.revokeObjectURL(url); }, 0);
        return platformOk(undefined);
      } catch {
        if (url !== null) view.URL.revokeObjectURL(url);
        return platformError("io-error", `Could not start the download for ${fileName}.`);
      }
    },
  };
}

function webUserStorage(options: WebProjectOptions): UserSettingsStorage | null {
  if (options.userSettings !== undefined) return options.userSettings;
  return typeof localStorage === "undefined" ? null : localStorage;
}

/** A project over a folder handle the host has already registered under `project` (or a test's own handle). */
export function createFolderProject(root: FileSystemDirectoryHandle, project: ProjectHandle, options: WebProjectOptions = {}): WebProject {
  let active = true;
  const capabilities = new Set(FOLDER_CAPABILITIES);
  const fs = bindProjectFileSystem(project.id, createWebFileSystem(root, project.id), () => active);
  const dialogs = options.dialogs ?? pageDialogs();
  // The browser cannot hand a file to the operating system's default application, so `openExternal` is not declared: the
  // file tree says so instead of pretending (T-03).
  if (dialogs.pickFile !== undefined) capabilities.add("pickFile");
  const workspace = createDocumentWorkspace({ projectId: project.id, services: { fs, dialogs, capabilities } });
  const services: PlatformServices = {
    capabilities,
    fs,
    project: {
      open: async () => platformOk(project),
      recent: async () => {
        const recent = await recentWebProjects();
        return recent ? platformOk(recent) : platformError("unavailable", "Browser project persistence is unavailable.");
      },
    },
    settings: createWebSettings(fs, webUserStorage(options), capabilities.has("folderWrite")),
    document: workspace.document,
    dialogs,
    packageExport: webPackageExport(typeof document === "undefined" ? null : document),
  };
  return { services, project, sessionCopy: false, workspace, browserSession: createBrowserSession(), deactivate: () => { active = false; workspace.dispose(); } };
}


/** A file-only browser session is explicitly a copy: writes stay in this page's memory, never in the source file. */
export function createSessionCopy(fileName: string, bytes: Uint8Array, options: WebProjectOptions = {}): WebProject {
  const memory = new Map<string, Uint8Array>([[fileName, bytes.slice()]]);
  let active = true;
  const project: ProjectHandle = { id: `session:${crypto.randomUUID()}`, name: `${fileName} (session copy)` };
  const valid = (path: string, allowRoot = false): boolean => path === "" ? allowRoot : !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  const invalid = (path: string) => platformError("invalid-path", `Invalid project path: ${path}`);
  const unavailable = () => platformError("unavailable", "This session copy does not support folder watching or persistent writes.");
  const capabilities = new Set<Capability>();
  const fs = bindProjectFileSystem(project.id, {
    list: async (path) => {
      if (!valid(path, true)) return invalid(path);
      if (memory.has(path)) return platformError("not-a-directory", `Not a directory: ${path}`);
      const prefix = path === "" ? "" : `${path}/`;
      const found = new Map<string, "file" | "directory">();
      for (const key of memory.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        found.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? "file" : "directory");
      }
      return found.size === 0 ? platformError("not-found", `Folder not found: ${path || "."}`) : platformOk([...found].map(([name, kind]) => ({ name, kind })));
    },
    read: async (path) => !valid(path) ? invalid(path) : memory.has(path) ? platformOk(memory.get(path)!.slice()) : platformError("not-found", `File not found: ${path}`),
    write: async (path, data) => {
      if (!valid(path)) return invalid(path);
      memory.set(path, data.slice());
      return platformOk(undefined);
    },
    stat: async (path) => {
      if (!valid(path, true)) return invalid(path);
      if (path === "") return platformOk({ kind: "directory", size: 0, modifiedMs: 0 });
      const data = memory.get(path);
      return data ? platformOk({ kind: "file", size: data.length, modifiedMs: 0 }) : platformError("not-found", `File not found: ${path}`);
    },
    delete: async (path) => {
      if (!valid(path)) return invalid(path);
      return memory.delete(path) ? platformOk(undefined) : platformError("not-found", `File not found: ${path}`);
    },
    rename: async (from, to) => !valid(from) ? invalid(from) : !valid(to) ? invalid(to) : unavailable(),
    watch: async (path) => !valid(path, true) ? invalid(path) : unavailable(),
  }, () => active);
  const dialogs = options.dialogs ?? pageDialogs();
  const workspace = createDocumentWorkspace({ projectId: project.id, services: { fs, dialogs, capabilities } });
  const services: PlatformServices = {
    capabilities,
    fs,
    project: { open: async () => platformOk(project), recent: async () => platformOk([project]) },
    settings: createWebSettings(fs, webUserStorage(options), false),
    document: workspace.document,
    dialogs,
    packageExport: webPackageExport(typeof document === "undefined" ? null : document),
  };
  return { services, project, sessionCopy: true, workspace, browserSession: createBrowserSession(), deactivate: () => { active = false; workspace.dispose(); } };
}

/** One editor tab owns a lease even while its mounted view is hidden. */
export interface EditorView extends ViewHandle, DocumentViewLease {
  hide(): void;
  show(element: HTMLElement): void;
}

/** @deprecated The first editor was the game settings; the same view handle serves every kind (ADR 0026). */
export type GameSettingsView = EditorView;

/** A mounted view over a workspace document, or why the document did not open. */
export type EditorOpenResult =
  | Exclude<WorkspaceOpenResult, { readonly ok: true }>
  | { readonly ok: true; readonly document: AnyDocument; readonly view: EditorView };

/** @deprecated Use `EditorOpenResult`. */
export type GameSettingsOpenResult = EditorOpenResult;

/**
 * Open `path` in the project's workspace (one model per document, D1.2) and mount the view of its kind. Hide destroys
 * only the mounted UI; closing the tab goes through its lease, and disposing an abandoned tab releases its ownership (D3.7).
 */
export async function openEditor(project: WebProject, path: string, element: HTMLElement): Promise<EditorOpenResult> {
  const opened = await project.workspace.open(path);
  if (!opened.ok) return opened;
  return { ok: true, document: opened.document, view: mountEditor(project, opened.document, element) };
}

/** @deprecated The name of the first editor; it opens a document of any registered kind. */
export const openGameSettings = openEditor;

/**
 * What a view binds to for `document`: the workspace's document itself, with a board's picture composed from this
 * project's files by the one board compositor (AD-29). The workspace types a document by its lifecycle only, so the
 * kind is what says which command and snapshot types it has.
 */
function viewDocumentFor(project: WebProject, document: AnyDocument): ViewContext["document"] {
  if (document.kind === "tile-bitmap") {
    const bitmap = document as unknown as Omit<TileBitmapViewDocument, "preview">;
    const view: TileBitmapViewDocument = {
      kind: bitmap.kind,
      identity: bitmap.identity,
      getSnapshot: () => bitmap.getSnapshot(),
      subscribe: (listener) => bitmap.subscribe(listener),
      apply: (command) => bitmap.apply(command),
      save: () => bitmap.save(),
      resolveConflict: (choice) => bitmap.resolveConflict(choice),
      preview: () => previewTileBitmap(project.services.fs, project.project.id, document.serialize()),
    };
    return view;
  }
  if (document.kind !== "board") return document as unknown as ViewDocument;
  const board = document as unknown as Omit<BoardViewDocument, "preview" | "undo" | "redo"> & Required<Pick<BoardViewDocument, "undo" | "redo">>;
  // Explicit forwarding: a document's methods read its private fields, so they are called on the document itself.
  const view: BoardViewDocument = {
    kind: board.kind,
    identity: board.identity,
    getSnapshot: () => board.getSnapshot(),
    subscribe: (listener) => board.subscribe(listener),
    apply: (command) => board.apply(command),
    save: () => board.save(),
    resolveConflict: (choice) => board.resolveConflict(choice),
    preview: async (request) => {
      const preview = await previewBoard(project.services.fs, project.project.id, document.serialize(), request);
      return preview.ok ? { ok: true as const, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
    },
    // The workspace keeps no stack of its own for the view: Undo and Redo are the document's.
    undo: () => board.undo(),
    redo: () => board.redo(),
  };
  return view;
}

const boardPreferenceSources = new WeakMap<WebProject, BoardPreferencesSource>();

/** The board-editor preferences of a project, read from its settings (T-33) once and shared by every board view of it. */
function boardPreferencesFor(project: WebProject): BoardPreferencesSource {
  const known = boardPreferenceSources.get(project);
  if (known !== undefined) return known;
  const preferences = createPreferences({ settings: project.services.settings, projectLayer: project.services.capabilities.has("folderWrite") });
  void preferences.refresh();
  const source: BoardPreferencesSource = { get: () => editorPreferencesFrom(preferences.getSnapshot()), subscribe: (listener) => preferences.subscribe(listener) };
  boardPreferenceSources.set(project, source);
  return source;
}

/** A mounted view with no ownership of its document: whoever mounted it holds the document's lease. */
export interface DocumentView extends ViewHandle {
  hide(): void;
  show(element: HTMLElement): void;
}

/** Mount the view of `document`'s kind into `element`. It holds no lease: the caller (a tab, or `mountEditor`) does. */
export function mountDocumentView(
  project: WebProject,
  document: AnyDocument,
  element: HTMLElement,
  projectLayout: ProjectLayout = { projectFolder: "" },
  openSource?: (path: string) => Promise<string | null>,
): DocumentView {
  const viewDocument = viewDocumentFor(project, document);
  let mounted: ViewHandle | null = null;
  let notice: HTMLElement | null = null;
  let disposed = false;
  const hide = (): void => {
    mounted?.dispose();
    mounted = null;
    notice?.remove();
    notice = null;
  };
  const show = (container: HTMLElement): void => {
    if (disposed || mounted !== null) throw new Error("Cannot show a disposed or already mounted editor view.");
    mounted = mount(container, {
      document: viewDocument,
      services: project.services,
      browser: { session: project.browserSession, fs: project.services.fs, layout: projectLayout, ...(openSource === undefined ? {} : { openSource }) },
      boardPreferences: boardPreferencesFor(project),
    });
    notice = project.sessionCopy ? container.ownerDocument.createElement("p") : null;
    if (notice) {
      notice.setAttribute("role", "status");
      notice.textContent = `${project.project.name} is a session copy. Changes stay in this browser session and are not saved to the original file.`;
      container.append(notice);
    }
  };
  show(element);
  return { hide, show, dispose: () => { hide(); disposed = true; } };
}

/** Make a view owner over a document the project already has open. */
export function mountEditor(project: WebProject, document: AnyDocument, element: HTMLElement): EditorView {
  const lease = project.workspace.attachView(document);
  const view = mountDocumentView(project, document, element);
  return { close: () => lease.close(), hide: view.hide, show: view.show, dispose: () => { view.dispose(); lease.dispose(); } };
}

/** @deprecated The name of the first editor; it mounts a document of any registered kind. */
export const mountGameSettings = mountEditor;

export { createPageDialogs } from "./dialogs.ts";
export { createWorkbench, type Workbench, type WorkbenchOptions } from "./workbench.ts";
export { createWebFileSystem } from "./filesystem.ts";
export { createWebSettings, PROJECT_SETTINGS_PATH, type UserSettingsStorage } from "./settings.ts";
