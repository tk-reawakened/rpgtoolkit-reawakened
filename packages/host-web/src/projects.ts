import type { ProjectHandle } from "@tk-reawakened/platform-services";

const DATABASE = "tkr-editor-projects";
const STORE = "projects";
const VERSION = 1;

type DirectoryHandle = FileSystemDirectoryHandle & {
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
  requestPermission(options: { readonly mode: "readwrite" }): Promise<PermissionState>;
};

interface StoredProject {
  readonly id: string;
  readonly name: string;
  readonly root: DirectoryHandle;
  readonly lastOpened: number;
}

export interface RestoredWebProject {
  readonly handle: ProjectHandle;
  readonly root: FileSystemDirectoryHandle;
}

let recentRecords: readonly StoredProject[] | null = null;
let projectsDatabase: IDBDatabase | null = null;
let projectsDatabaseOpening: Promise<IDBDatabase | null> | null = null;
function openDatabase(): Promise<IDBDatabase | null> {
  if (projectsDatabase !== null) return Promise.resolve(projectsDatabase);
  if (projectsDatabaseOpening !== null) return projectsDatabaseOpening;
  const opening = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => {
        projectsDatabase = request.result;
        request.result.onversionchange = () => {
          request.result.close();
          if (projectsDatabase === request.result) projectsDatabase = null;
        };
        resolve(request.result);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  projectsDatabaseOpening = opening;
  void opening.then(() => { if (projectsDatabaseOpening === opening) projectsDatabaseOpening = null; });
  return opening;
}

async function readProjects(): Promise<readonly StoredProject[] | null> {
  const database = await openDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    let request: IDBRequest<StoredProject[]>;
    try {
      request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeProject(project: StoredProject): Promise<boolean> {
  const database = await openDatabase();
  if (!database) return false;
  return new Promise((resolve) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(project);
      transaction.oncomplete = () => resolve(true);
      transaction.onabort = transaction.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function sameEntry(left: DirectoryHandle, right: DirectoryHandle): Promise<boolean> {
  try { return await left.isSameEntry(right); }
  catch { return false; }
}

export function createUniqueWebProjectId(existing: ReadonlySet<string>, nextId: () => string = () => crypto.randomUUID()): string {
  for (;;) {
    const id = `web:${nextId()}`;
    if (!existing.has(id)) return id;
  }
}

/** Persist a selected handle before it is advertised as a stable project. */
export async function registerWebProject(root: FileSystemDirectoryHandle): Promise<ProjectHandle | null> {
  const projects = await readProjects();
  if (!projects) return null;
  const typedRoot = root as DirectoryHandle;
  for (const stored of projects) {
    if (await sameEntry(stored.root, typedRoot)) {
      const refreshed = { ...stored, name: root.name, root: typedRoot, lastOpened: Date.now() };
      if (!await writeProject(refreshed)) return null;
      recentRecords = projects.map((project) => project.id === stored.id ? refreshed : project);
      return { id: stored.id, name: root.name };
    }
  }
  const project = { id: createUniqueWebProjectId(new Set(projects.map(({ id }) => id))), name: root.name, root: typedRoot, lastOpened: Date.now() };
  if (!await writeProject(project)) return null;
  recentRecords = [...projects, project];
  return { id: project.id, name: project.name };
}

/** List remembered identities in most-recently-opened order without prompting for permission. */
export async function recentWebProjects(): Promise<readonly ProjectHandle[] | null> {
  const projects = await readProjects();
  if (!projects) return null;
  recentRecords = projects;
  return [...projects].sort((left, right) => right.lastOpened - left.lastOpened).map(({ id, name }) => ({ id, name }));
}

/** Restore a warmed recent handle from a direct user action, requesting permission before crossing an async boundary. */
export async function restoreWebProject(id: string): Promise<RestoredWebProject | null> {
  const stored = recentRecords?.find((project) => project.id === id);
  if (!stored) return null;
  try {
    const permission = await stored.root.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") return null;
    const refreshed = { ...stored, lastOpened: Date.now() };
    if (await writeProject(refreshed)) {
      recentRecords = recentRecords?.map((project) => project.id === stored.id ? refreshed : project) ?? [refreshed];
    }
    return { handle: { id: stored.id, name: stored.name }, root: stored.root };
  } catch {
    return null;
  }
}

