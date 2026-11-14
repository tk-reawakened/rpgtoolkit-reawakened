import { createDocumentWorkspace, previewBoard, type AnyDocument, type DocumentViewLease, type DocumentWorkspace, type WorkspaceOpenResult } from "@tk-reawakened/editor-model";
import type { Capability, DialogService, PlatformServices, ProjectHandle } from "@tk-reawakened/platform-services";
import { bindProjectFileSystem, platformError, platformOk } from "@tk-reawakened/platform-services";
import { mount, type BoardViewDocument, type ViewContext, type ViewDocument, type ViewHandle } from "@tk-reawakened/editor-ui";
import { canPickFile, createPageDialogs, pickOutsideFile } from "./dialogs.ts";
import { createWebFileSystem } from "./filesystem.ts";
import { createWebSettings, type UserSettingsStorage } from "./settings.ts";
import { recentWebProjects, registerWebProject, restoreWebProject } from "./projects.ts";
import { createWebRunService } from "./run.ts";

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
  /** Retire this project from its host session; accepted operations remain bound to their original project. */
  deactivate(): void;
}

/** What a browser project is made with; `dialogs` defaults to the page's own modal dialogs. */
export interface WebProjectOptions {
  readonly dialogs?: DialogService;
  /** URL of this deployment's same-origin runner-web player page. Without it, launching is unavailable. */
  readonly playerUrl?: string;
  /** Where the user layer of the editor settings is kept; the page's `localStorage` by default, memory when there is none. */
  readonly userSettings?: UserSettingsStorage | null;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (this: Window, options: { readonly mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

/** The capabilities of a folder the File System Access API opened and the browser registered as a stable project. */
const FOLDER_CAPABILITIES: readonly Capability[] = ["folderWrite", "stableProjectHandle", "conflictReload", "conflictAutoSave"];

/** Open a directory with the browser's native picker; stable identity requires successful IndexedDB registration. */
export async function openWebProject(options: WebProjectOptions = {}): Promise<WebProject | null> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (typeof picker !== "function") return null;
  try {
    const root = await picker.call(window, { mode: "readwrite" });
    const project = await registerWebProject(root);
    return project ? createFolderProject(root, project, options) : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

/** Restore a recent folder only from an explicit user action, allowing permission prompts at that point. */
export async function reopenWebProject(id: string, options: WebProjectOptions = {}): Promise<WebProject | null> {
  const restored = await restoreWebProject(id);
  return restored ? createFolderProject(restored.root, restored.handle, options) : null;
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
  if (options.playerUrl !== undefined) capabilities.add("runGame");
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
    ...(options.playerUrl === undefined ? {} : { run: createWebRunService(fs, project.id, options.playerUrl) }),
  };
  return { services, project, sessionCopy: false, workspace, deactivate: () => { active = false; workspace.dispose(); } };
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
  };
  return { services, project, sessionCopy: true, workspace, deactivate: () => { active = false; workspace.dispose(); } };
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
  if (document.kind !== "board") return document as unknown as ViewDocument;
  const board = document as unknown as Omit<BoardViewDocument, "preview">;
  // Explicit forwarding: a document's methods read its private fields, so they are called on the document itself.
  const view: BoardViewDocument = {
    kind: board.kind,
    identity: board.identity,
    getSnapshot: () => board.getSnapshot(),
    subscribe: (listener) => board.subscribe(listener),
    apply: (command) => board.apply(command),
    save: () => board.save(),
    resolveConflict: (choice) => board.resolveConflict(choice),
    preview: async () => {
      const preview = await previewBoard(project.services.fs, project.project.id, document.serialize());
      return preview.ok ? { ok: true as const, width: preview.width, height: preview.height, rgba: preview.rgba, warnings: preview.warnings } : preview;
    },
  };
  return view;
}

/** A mounted view with no ownership of its document: whoever mounted it holds the document's lease. */
export interface DocumentView extends ViewHandle {
  hide(): void;
  show(element: HTMLElement): void;
}

/** Mount the view of `document`'s kind into `element`. It holds no lease: the caller (a tab, or `mountEditor`) does. */
export function mountDocumentView(project: WebProject, document: AnyDocument, element: HTMLElement): DocumentView {
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
    mounted = mount(container, { document: viewDocument, services: project.services });
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
