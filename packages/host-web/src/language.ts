import { encodeBase64, isHookAssetPath, isProgramPath, projectRootUri, PROJECT_NOTIFICATION, type ProjectSnapshot, type ProjectSnapshotFile } from "@tk-reawakened/lsp/protocol";
import {
  platformError,
  platformOk,
  type FileSystemService,
  type LanguageClosed,
  type LanguageConnectOptions,
  type LanguageConnection,
  type LanguageMessage,
  type LanguageService,
  type PlatformResult,
} from "@tk-reawakened/platform-services";

/**
 * The browser host's `language.connect()` (AD-20, docs/spec/engine/rpgcode-tooling.md#tool-10-connect): one same-origin
 * classic worker per session running the transport-free server of `lsp`. The host is the server's client for the running
 * project: it reads the main file and the program inventory through its own file system, sends them as the
 * `rpgcode/project` snapshot, and sends a new one after a project file the server cares about is written.
 */

/** A bound on the inventory, so a mis-selected folder is reported instead of read (the early extension's limit). */
const MAX_FILES = 20_000;
const SKIPPED_FOLDERS = new Set(["node_modules", ".git", ".tkr-history", ".tkr-exports"]);
const SNAPSHOT_DEBOUNCE_MS = 500;

/** The URI the server knows project file `path` by: `file:///project/` and the encoded path, so a name with a space is one URI. */
export function projectFileUri(path: string): string {
  return `file:///project/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The folder, relative to the project, that holds the running project's files (TOOL-1 "Root"). */
function rootFolderOf(main: string): string {
  const folder = main.includes("/") ? main.slice(0, main.lastIndexOf("/")) : "";
  const name = folder.slice(folder.lastIndexOf("/") + 1);
  if (name.toLowerCase() === "main") return folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
  return folder;
}

async function inventory(fs: FileSystemService, folder: string, prefix: string, files: ProjectSnapshotFile[]): Promise<string | null> {
  const listed = await fs.list(folder);
  if (!listed.ok) return `${folder === "" ? "the project folder" : folder}: ${listed.error.message}`;
  const entries = [...listed.value].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    // A link is never followed (docs/spec/formats/packaging-and-paths.md, loose folder).
    if (entry.kind === "link") continue;
    if (entry.kind === "directory") {
      if (SKIPPED_FOLDERS.has(entry.name)) continue;
      const problem = await inventory(fs, path, relative, files);
      if (problem !== null) return problem;
      continue;
    }
    if (!isProgramPath(entry.name) && !isHookAssetPath(relative)) continue;
    if (files.length >= MAX_FILES) return `the project root holds more than ${MAX_FILES} program and script-hook files`;
    const read = await fs.read(path);
    if (!read.ok) return `${path}: ${read.error.message}`;
    files.push({ path: relative, uri: projectFileUri(path), bytes: encodeBase64(read.value) });
  }
  return null;
}

/** Read the running project into one snapshot; a failure is reported in the snapshot, never guessed around. */
export async function readProjectSnapshot(fs: FileSystemService, main: string | null, revision: number): Promise<ProjectSnapshot> {
  if (main === null) return { revision, main: null };
  const mainUri = projectFileUri(main);
  try {
    const mainBytes = await fs.read(main);
    if (!mainBytes.ok) return { revision, main: null, problem: `${main}: ${mainBytes.error.message}` };
    const rootFolder = rootFolderOf(main);
    const files: ProjectSnapshotFile[] = [];
    const problem = await inventory(fs, rootFolder, "", files);
    if (problem !== null) return { revision, main: null, problem };
    const lintPath = rootFolder === "" ? "tkr-lint.json" : `${rootFolder}/tkr-lint.json`;
    const lint = await fs.read(lintPath);
    const lintConfig = lint.ok ? { uri: projectFileUri(lintPath), text: new TextDecoder().decode(lint.value) } : null;
    return { revision, main: { uri: mainUri, bytes: encodeBase64(mainBytes.value) }, rootUri: projectRootUri(mainUri), files, lintConfig, hookInventoryComplete: true };
  } catch (error) {
    return { revision, main: null, problem: `${main}: ${messageOf(error)}` };
  }
}

export interface WebLanguageService extends LanguageService {
  /** Tell the service the project file `path` was written, so open sessions send the server a fresh snapshot. */
  notifyWritten(path: string): void;
}

export interface WebLanguageOptions {
  /** URL of the same-origin classic worker script that runs the server (`language-worker.js` from the host's build). */
  readonly workerUrl: string;
}

export function createWebLanguageService(fs: FileSystemService, options: WebLanguageOptions): WebLanguageService {
  const sessions = new Set<{ refresh(): void }>();
  return {
    notifyWritten(_path) {
      for (const session of [...sessions]) session.refresh();
    },
    async connect(connectOptions: LanguageConnectOptions): Promise<PlatformResult<LanguageConnection>> {
      let worker: Worker;
      try {
        worker = new Worker(options.workerUrl);
      } catch (error) {
        return platformError("unavailable", `The language worker could not start: ${messageOf(error)}`);
      }
      const listeners = new Set<(message: LanguageMessage) => void>();
      const closers = new Set<(closed: LanguageClosed) => void>();
      let closed: LanguageClosed | null = null;
      let revision = 0;
      /** The server takes the project once the client has finished the handshake (`initialized`). */
      let ready = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let sending: Promise<void> = Promise.resolve();
      const session = { refresh: () => scheduleSnapshot() };

      const end = (reason: LanguageClosed): void => {
        if (closed !== null) return;
        closed = reason;
        clearTimeout(timer ?? undefined);
        timer = null;
        sessions.delete(session);
        listeners.clear();
        worker.terminate();
        for (const closer of [...closers]) closer(reason);
        closers.clear();
      };
      // Snapshots go out one at a time, each with a higher revision than the last; a slow read never overtakes a later one.
      const sendSnapshot = (): void => {
        sending = sending.then(async () => {
          if (closed !== null) return;
          revision += 1;
          const snapshot = await readProjectSnapshot(fs, connectOptions.project?.main ?? null, revision);
          if (closed === null) worker.postMessage({ jsonrpc: "2.0", method: PROJECT_NOTIFICATION, params: snapshot });
        }).catch(() => undefined);
      };
      function scheduleSnapshot(): void {
        if (!ready) return;
        clearTimeout(timer ?? undefined);
        timer = setTimeout(() => {
          timer = null;
          sendSnapshot();
        }, SNAPSHOT_DEBOUNCE_MS);
      }
      worker.onmessage = (event: MessageEvent<LanguageMessage>) => {
        for (const listener of [...listeners]) listener(event.data);
      };
      worker.onerror = (event) => end({ reason: "transport-error", message: `The language worker failed${event.message === "" || event.message === undefined ? "." : `: ${event.message}`}` });
      worker.onmessageerror = () => end({ reason: "transport-error", message: "The language worker sent a message the page could not read." });
      sessions.add(session);
      return platformOk<LanguageConnection>({
        send(message) {
          if (closed !== null) return;
          worker.postMessage(message);
          if (message.method === "initialized" && !ready) {
            ready = true;
            sendSnapshot();
          }
        },
        onMessage(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
        onClose(listener) {
          if (closed !== null) {
            listener(closed);
            return () => {};
          }
          closers.add(listener);
          return () => void closers.delete(listener);
        },
        uriOf: projectFileUri,
        dispose: () => end({ reason: "disposed", message: "" }),
      });
    },
  };
}

/** A project file system that tells `onChanged` the path of every write, delete and rename that succeeds. */
export function notifyOnChange(fs: Omit<FileSystemService, "readProject" | "writeProject">, onChanged: (path: string) => void): Omit<FileSystemService, "readProject" | "writeProject"> {
  const after = async (result: Promise<PlatformResult<void>>, ...paths: readonly string[]): Promise<PlatformResult<void>> => {
    const done = await result;
    if (done.ok) for (const path of paths) onChanged(path);
    return done;
  };
  return {
    ...fs,
    write: (path, bytes) => after(fs.write(path, bytes), path),
    delete: (path) => after(fs.delete(path), path),
    rename: (from, to) => after(fs.rename(from, to), from, to),
  };
}
