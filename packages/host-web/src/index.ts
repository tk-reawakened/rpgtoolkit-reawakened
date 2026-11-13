import { createDocumentWorkspace, type DocumentViewLease, type DocumentWorkspace, type MainDocument, type WorkspaceOpenResult } from "@tk-reawakened/editor-model";
import type { Capability, DialogService, PlatformServices, ProjectHandle, SettingValue, SettingsLayer } from "@tk-reawakened/platform-services";
import { bindProjectFileSystem, platformError, platformOk } from "@tk-reawakened/platform-services";
import { mount, type ViewHandle } from "@tk-reawakened/editor-ui";
import { createPageDialogs } from "./dialogs.ts";
import { createWebFileSystem } from "./filesystem.ts";
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
  /** Retire this project from its host session; accepted operations remain bound to their original project. */
  deactivate(): void;
}

/** What a browser project is made with; `dialogs` defaults to the page's own modal dialogs. */
export interface WebProjectOptions {
  readonly dialogs?: DialogService;
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (this: Window, options: { readonly mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

/** The capabilities of a folder the File System Access API opened and the browser registered as a stable project. */
const FOLDER_CAPABILITIES: readonly Capability[] = ["folderWrite", "stableProjectHandle"];

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
  };
}

/** A project over a folder handle the host has already registered under `project` (or a test's own handle). */
export function createFolderProject(root: FileSystemDirectoryHandle, project: ProjectHandle, options: WebProjectOptions = {}): WebProject {
  let active = true;
  const values = new Map<string, SettingValue>();
  const capabilities = new Set(FOLDER_CAPABILITIES);
  const fs = bindProjectFileSystem(project.id, createWebFileSystem(root, project.id), () => active);
  const dialogs = options.dialogs ?? pageDialogs();
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
    settings: {
      get: async (layer, id) => platformOk(values.get(`${layer}:${id}`) ?? null),
      set: async (layer: SettingsLayer, id: string, value) => {
        const key = `${layer}:${id}`;
        if (value === null) values.delete(key); else values.set(key, value);
        return platformOk(undefined);
      },
    },
    document: workspace.document,
    dialogs,
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
    settings: { get: async () => platformOk(null), set: async () => platformError("unavailable", "Settings are unavailable in a session copy.") },
    document: workspace.document,
    dialogs,
  };
  return { services, project, sessionCopy: true, workspace, deactivate: () => { active = false; workspace.dispose(); } };
}

/** One editor tab owns a lease even while its mounted view is hidden. */
export interface GameSettingsView extends ViewHandle, DocumentViewLease {
  hide(): void;
  show(element: HTMLElement): void;
}

/** A mounted settings view over a workspace document, or why the document did not open. */
export type GameSettingsOpenResult =
  | Exclude<WorkspaceOpenResult, { readonly ok: true }>
  | { readonly ok: true; readonly document: MainDocument; readonly view: GameSettingsView };

/**
 * Open `path` in the project's workspace (one model per document, D1.2). Hide destroys only the mounted UI; closing
 * the tab goes through its lease, and disposing an abandoned tab releases its ownership (D3.7).
 */
export async function openGameSettings(project: WebProject, path: string, element: HTMLElement): Promise<GameSettingsOpenResult> {
  const opened = await project.workspace.open(path);
  if (!opened.ok) return opened;
  return { ok: true, document: opened.document, view: mountGameSettings(project, opened.document, element) };
}

/** Make a view owner over a document the project already has open. */
export function mountGameSettings(project: WebProject, document: MainDocument, element: HTMLElement): GameSettingsView {
  const lease = project.workspace.attachView(document);
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
    mounted = mount(container, { document, services: project.services });
    notice = project.sessionCopy ? container.ownerDocument.createElement("p") : null;
    if (notice) {
      notice.setAttribute("role", "status");
      notice.textContent = `${project.project.name} is a session copy. Changes stay in this browser session and are not saved to the original file.`;
      container.append(notice);
    }
  };
  show(element);
  return { close: () => lease.close(), hide, show, dispose: () => { hide(); lease.dispose(); disposed = true; } };
}

export { createPageDialogs } from "./dialogs.ts";
export { createWebFileSystem } from "./filesystem.ts";
