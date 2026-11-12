import { createDocumentIdentity, openMainDocument, type MainDocument, type OpenResult } from "@tk-reawakened/editor-model";
import type { PlatformServices, ProjectHandle, SettingValue, SettingsLayer } from "@tk-reawakened/platform-services";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
import { mount, type ViewHandle } from "@tk-reawakened/editor-ui";
import { createWebFileSystem } from "./filesystem.ts";
import { recentWebProjects, registerWebProject, restoreWebProject } from "./projects.ts";

export interface WebProject { readonly services: PlatformServices; readonly project: ProjectHandle; readonly sessionCopy: boolean }
type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (this: Window, options: { readonly mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

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

function createFolderProject(root: FileSystemDirectoryHandle, project: ProjectHandle): WebProject {
  const values = new Map<string, SettingValue>();
  const services: PlatformServices = {
    capabilities: new Set(["folderWrite", "stableProjectHandle"]),
    fs: createWebFileSystem(root),
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
    document: { edited: () => undefined },
  };
  return { services, project, sessionCopy: false };
}


/** A file-only browser session is explicitly a copy: writes stay in this page's memory, never in the source file. */
export function createSessionCopy(fileName: string, bytes: Uint8Array): WebProject {
  const memory = new Map<string, Uint8Array>([[fileName, bytes.slice()]]);
  const project: ProjectHandle = { id: `session:${crypto.randomUUID()}`, name: `${fileName} (session copy)` };
  const valid = (path: string, allowRoot = false): boolean => path === "" ? allowRoot : !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  const invalid = (path: string) => platformError("invalid-path", `Invalid project path: ${path}`);
  const unavailable = () => platformError("unavailable", "This session copy does not support folder watching or persistent writes.");
  const services: PlatformServices = {
    capabilities: new Set(),
    fs: {
      list: async (path) => {
        if (!valid(path, true)) return invalid(path);
        if (path !== "") return memory.has(path) ? platformError("not-a-directory", `Not a directory: ${path}`) : platformError("not-found", `Folder not found: ${path}`);
        return platformOk([...memory.keys()].map((name) => ({ name, kind: "file" as const })));
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
    },
    project: { open: async () => platformOk(project), recent: async () => platformOk([project]) },
    settings: { get: async () => platformOk(null), set: async () => platformError("unavailable", "Settings are unavailable in a session copy.") },
    document: { edited: () => undefined },
  };
  return { services, project, sessionCopy: true };
}

/** Mount the same view and authoritative model used by other hosts. The caller owns the returned view handle. */
export async function openGameSettings(project: WebProject, path: string, element: HTMLElement): Promise<OpenResult | { readonly document: MainDocument; readonly view: ViewHandle }> {
  const identity = createDocumentIdentity(project.project.id, path);
  const opened = await openMainDocument(project.services.fs, identity);
  if (!opened.ok) return opened;
  const mounted = mount(element, { document: opened.document, services: project.services });
  const notice = project.sessionCopy ? element.ownerDocument.createElement("p") : null;
  if (notice) {
    notice.setAttribute("role", "status");
    notice.textContent = `${project.project.name} is a session copy. Changes stay in this browser session and are not saved to the original file.`;
    element.append(notice);
  }
  const view: ViewHandle = { dispose: () => { mounted.dispose(); notice?.remove(); } };
  return { document: opened.document, view };
}

export { createWebFileSystem } from "./filesystem.ts";
