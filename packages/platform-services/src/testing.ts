// The in-memory double of platform-services (AD-22 `./testing`). It is a working implementation of the interface over
// a `Map`, not a recording stub: files, folders, watches, settings and projects behave as a host's would, and a test
// can make writes fail on purpose. It reads no clock and no random source: modification times come from a counter, so a
// run is the same every time (G3).
import { bindProjectFileSystem, type DirectoryEntry, type FileChange, type FileKind, type FileStat } from "./fs.ts";
import { platformError, platformOk, type Disposable, type PlatformError, type PlatformResult } from "./result.ts";
import { createRunHandle, LAUNCH_CAPABILITY, launchUnavailable, prepareRun, type Launch, type RunHandle, type RunSnapshot, type RunStartGuard, type RunStatus } from "./run.ts";
import type {
  Capability,
  DialogQuestion,
  FilePickRequest,
  OutsideFile,
  DocumentEdited,
  PlatformServices,
  ProjectHandle,
  SavePathRequest,
  SettingsLayer,
  SettingValue,
} from "./services.ts";

/** What a test can do beyond the interface. */
export interface MemoryPlatformServices extends PlatformServices {
  /** Put a file in place with no watch event, as if it was there when the project opened. */
  seed(path: string, bytes: Uint8Array): void;
  /** A copy of the file's bytes, or `undefined` when there is no such file. */
  bytesOf(path: string): Uint8Array | undefined;
  /** Every `document.edited` message received, in order. */
  readonly editedEvents: readonly DocumentEdited[];
  /** How many watches are live (a disposed watch is not counted). */
  watchCount(): number;
  /** Make every later `fs.write` fail with `error` and change nothing; `null` restores normal writes. */
  failWrites(error: PlatformError | null): void;
  /**
   * Answer later `dialogs.ask` questions in turn with these choice ids. A question asked when none is left is dismissed
   * and answers its `cancel`; an id the question does not offer rejects the call, so a test cannot answer the wrong one.
   */
  answerQuestions(...ids: readonly string[]): void;
  /** Answer later `dialogs.pickSavePath` requests in turn; `null` cancels, and with none left a request is cancelled. */
  answerSavePaths(...paths: readonly (string | null)[]): void;
  /** Answer later `dialogs.pickFile` requests in turn; `null` cancels, and with none left a request is cancelled. */
  answerFilePicks(...files: readonly (OutsideFile | null)[]): void;
  /** Every `dialogs.pickFile` request, in order. */
  readonly filePickRequests: readonly FilePickRequest[];
  /** The project paths `shell.openExternal` was asked to open, in order. */
  readonly openedExternally: readonly string[];
  /** Every question `dialogs.ask` was asked, in order. */
  readonly questions: readonly DialogQuestion<string>[];
  /** Every `dialogs.pickSavePath` request, in order. */
  readonly savePathRequests: readonly SavePathRequest[];
  /** Every run the double started, in order, with the frozen files it was given. */
  readonly runs: readonly MemoryRun[];
}

/**
 * One run of the double. It runs no engine: a test plays the runner, moving the run through `report` (a tick, a board, a
 * stall, the end) the way a host's runner would, and reads `files` to see exactly what the run was given.
 */
export interface MemoryRun {
  readonly launch: Launch;
  readonly snapshot: RunSnapshot;
  /** The bytes the run was given, frozen at launch: later writes to the project never change them (ADR 0022 D8.4). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly handle: RunHandle;
  /** Change the run's status as its runner would; a finished run ignores it. */
  report(status: Partial<RunStatus>): void;
  /** Whether `handle.stop()` was called. */
  stopped(): boolean;
}

/** What the double starts with. */
export interface MemoryPlatformOptions {
  /** The project `project.open()` returns; default `{ id: "memory-project", name: "Memory project" }`. */
  readonly project?: ProjectHandle;
  /** Files present at the start, by project-relative path. */
  readonly files?: Readonly<Record<string, Uint8Array>>;
  /**
   * Capabilities the double declares; default `folderWrite`, `fileWatch`, `stableProjectHandle`, `conflictReload` and
   * `conflictAutoSave`. A test that runs games names `runGame`, `runBoard` or `runProgram`.
   */
  readonly capabilities?: readonly Capability[];
  /** Why the double cannot do a launch whose capability it was made without; a fixed sentence by default. */
  readonly runRefusal?: string;
}

const DEFAULT_PROJECT: ProjectHandle = { id: "memory-project", name: "Memory project" };
const DEFAULT_CAPABILITIES: readonly Capability[] = ["folderWrite", "fileWatch", "stableProjectHandle", "conflictReload", "conflictAutoSave"];

interface Entry {
  /** The path as first written: case is kept for listings and events. */
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly modifiedMs: number;
}

/** ASCII fold of ADR 0022 D1.1: `A`–`Z` to `a`–`z` and nothing else. */
function fold(path: string): string {
  let out = "";
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    out += code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : path.charAt(index);
  }
  return out;
}

/** `undefined` when `path` is a valid project-relative path (the root only when `allowRoot`); otherwise the reason. */
function invalidPath(path: string, allowRoot: boolean): string | undefined {
  if (path === "") return allowRoot ? undefined : "a file path cannot be empty";
  if (path.includes("\\")) return `"${path}" uses \\; project paths use /`;
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      return `"${path}" must be project-relative with no empty, "." or ".." segment`;
    }
  }
  return undefined;
}

/** Make an in-memory host: a project of files, settings and a recorded `document.edited` stream. */
export function createMemoryPlatformServices(options: MemoryPlatformOptions = {}): MemoryPlatformServices {
  const project = options.project ?? DEFAULT_PROJECT;
  const capabilities = new Set<Capability>(options.capabilities ?? DEFAULT_CAPABILITIES);
  const files = new Map<string, Entry>();
  const watches = new Set<{ readonly root: string; readonly onChange: (change: FileChange) => void }>();
  const settingValues = new Map<string, SettingValue>();
  const edited: DocumentEdited[] = [];
  let tick = 0;
  let writeFailure: PlatformError | null = null;
  const questionAnswers: string[] = [];
  const pathAnswers: (string | null)[] = [];
  const questions: DialogQuestion<string>[] = [];
  const savePathRequests: SavePathRequest[] = [];
  const fileAnswers: (OutsideFile | null)[] = [];
  const filePickRequests: FilePickRequest[] = [];
  const openedExternally: string[] = [];

  const touch = (): number => {
    tick += 1;
    return tick;
  };
  const emit = (change: FileChange): void => {
    const target = fold(change.path);
    for (const watch of [...watches]) {
      if (watch.root === "" || target === watch.root || target.startsWith(`${watch.root}/`)) watch.onChange(change);
    }
  };
  const folderExists = (key: string): boolean => {
    if (key === "") return true;
    for (const candidate of files.keys()) if (candidate.startsWith(`${key}/`)) return true;
    return false;
  };
  /** The first proper ancestor of `key` that is a file, as its stored path; such a path cannot have anything below it. */
  const fileAncestor = (key: string): string | undefined => {
    let slash = key.indexOf("/");
    while (slash !== -1) {
      const entry = files.get(key.slice(0, slash));
      if (entry !== undefined) return entry.path;
      slash = key.indexOf("/", slash + 1);
    }
    return undefined;
  };
  const put = (path: string, bytes: Uint8Array): FileChange["kind"] => {
    const key = fold(path);
    const existing = files.get(key);
    files.set(key, { path: existing?.path ?? path, bytes: bytes.slice(), modifiedMs: touch() });
    return existing === undefined ? "created" : "changed";
  };

  for (const [path, bytes] of Object.entries(options.files ?? {})) put(path, bytes);

  const fs = bindProjectFileSystem(project.id, {
    list(path): Promise<PlatformResult<readonly DirectoryEntry[]>> {
      const invalid = invalidPath(path, true);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      const key = fold(path);
      if (files.has(key)) return Promise.resolve(platformError("not-a-directory", `${path} is a file`));
      if (!folderExists(key)) return Promise.resolve(platformError("not-found", `${path} does not exist`));
      const prefix = key === "" ? "" : `${key}/`;
      const found = new Map<string, DirectoryEntry>();
      for (const [candidate, entry] of files) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = entry.path.slice(prefix.length);
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const kind: FileKind = slash === -1 ? "file" : "directory";
        found.set(fold(name), { name, kind });
      }
      return Promise.resolve(platformOk([...found.values()]));
    },
    read(path): Promise<PlatformResult<Uint8Array>> {
      const invalid = invalidPath(path, false);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      const entry = files.get(fold(path));
      if (entry !== undefined) return Promise.resolve(platformOk(entry.bytes.slice()));
      return Promise.resolve(
        folderExists(fold(path))
          ? platformError("is-a-directory", `${path} is a folder`)
          : platformError("not-found", `${path} does not exist`),
      );
    },
    write(path, bytes): Promise<PlatformResult<void>> {
      const invalid = invalidPath(path, false);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      if (writeFailure !== null) return Promise.resolve({ ok: false, error: writeFailure });
      const key = fold(path);
      if (folderExists(key)) return Promise.resolve(platformError("is-a-directory", `${path} is a folder`));
      const blocker = fileAncestor(key);
      if (blocker !== undefined) return Promise.resolve(platformError("not-a-directory", `${blocker} is a file`));
      const kind = put(path, bytes);
      emit({ kind, path: files.get(key)?.path ?? path });
      return Promise.resolve(platformOk(undefined));
    },
    stat(path): Promise<PlatformResult<FileStat>> {
      const invalid = invalidPath(path, true);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      const key = fold(path);
      const entry = files.get(key);
      if (entry !== undefined) {
        return Promise.resolve(platformOk({ kind: "file", size: entry.bytes.length, modifiedMs: entry.modifiedMs }));
      }
      if (!folderExists(key)) return Promise.resolve(platformError("not-found", `${path} does not exist`));
      return Promise.resolve(platformOk({ kind: "directory", size: 0, modifiedMs: tick }));
    },
    delete(path): Promise<PlatformResult<void>> {
      const invalid = invalidPath(path, false);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      const key = fold(path);
      const removed: Entry[] = [];
      for (const [candidate, entry] of [...files]) {
        if (candidate === key || candidate.startsWith(`${key}/`)) {
          files.delete(candidate);
          removed.push(entry);
        }
      }
      if (removed.length === 0) return Promise.resolve(platformError("not-found", `${path} does not exist`));
      touch();
      for (const entry of removed) emit({ kind: "deleted", path: entry.path });
      return Promise.resolve(platformOk(undefined));
    },
    rename(from, to): Promise<PlatformResult<void>> {
      const invalidFrom = invalidPath(from, false);
      if (invalidFrom !== undefined) return Promise.resolve(platformError("invalid-path", invalidFrom));
      const invalidTo = invalidPath(to, false);
      if (invalidTo !== undefined) return Promise.resolve(platformError("invalid-path", invalidTo));
      const fromKey = fold(from);
      const toKey = fold(to);
      const moving = [...files].filter(([key]) => key === fromKey || key.startsWith(`${fromKey}/`));
      if (moving.length === 0) return Promise.resolve(platformError("not-found", `${from} does not exist`));
      if (toKey.startsWith(`${fromKey}/`)) {
        return Promise.resolve(platformError("invalid-path", `${from} cannot be moved into itself (${to})`));
      }
      // The destination may be the source itself under another case; it is taken only when something else holds it.
      if (toKey !== fromKey && (files.has(toKey) || folderExists(toKey))) {
        return Promise.resolve(platformError("already-exists", `${to} already exists`));
      }
      const blocker = fileAncestor(toKey);
      if (blocker !== undefined) return Promise.resolve(platformError("not-a-directory", `${blocker} is a file`));
      for (const [key, entry] of moving) {
        files.delete(key);
        const movedPath = `${to}${entry.path.slice(from.length)}`;
        files.set(`${toKey}${key.slice(fromKey.length)}`, { path: movedPath, bytes: entry.bytes, modifiedMs: touch() });
        emit({ kind: "deleted", path: entry.path });
        emit({ kind: "created", path: movedPath });
      }
      return Promise.resolve(platformOk(undefined));
    },
    watch(path, onChange): Promise<PlatformResult<Disposable>> {
      const invalid = invalidPath(path, true);
      if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
      if (!capabilities.has("fileWatch")) {
        return Promise.resolve(platformError("unavailable", "this host cannot watch files"));
      }
      const watch = { root: fold(path), onChange };
      watches.add(watch);
      return Promise.resolve(platformOk({ dispose: () => void watches.delete(watch) }));
    },
  });

  const settingKey = (layer: SettingsLayer, id: string): string => `${layer}\u0000${id}`;

  const runs: MemoryRun[] = [];
  const refusal = options.runRefusal ?? "the memory host was made without that capability.";
  const unavailable: Partial<Record<Launch["kind"], string>> = {};
  for (const kind of ["game", "board", "program"] as const) if (!capabilities.has(LAUNCH_CAPABILITY[kind])) unavailable[kind] = refusal;
  const start = async (launch: Launch, guard?: RunStartGuard): Promise<PlatformResult<RunHandle>> => {
    const reason = unavailable[launch.kind];
    if (reason !== undefined) return launchUnavailable(launch.kind, reason);
    const prepared = await prepareRun(fs, launch, { projectId: project.id, runner: "memory-runner" });
    if (!prepared.ok) return prepared;
    const allowed = guard?.();
    if (allowed !== undefined && !allowed.ok) return allowed;
    let stopped = false;
    const { handle, report } = createRunHandle(prepared.value.snapshot, () => { stopped = true; });
    runs.push({ launch, snapshot: prepared.value.snapshot, files: prepared.value.files, handle, report, stopped: () => stopped });
    report({ state: "running" });
    return platformOk(handle);
  };
  const runsAnything = Object.keys(unavailable).length < 3;

  return {
    capabilities,
    fs,
    project: {
      open: () => Promise.resolve(platformOk(project)),
      recent: () => Promise.resolve(platformOk([project])),
    },
    settings: {
      get: (layer, id) => Promise.resolve(platformOk(settingValues.get(settingKey(layer, id)) ?? null)),
      set: (layer, id, value) => {
        if (value === null) settingValues.delete(settingKey(layer, id));
        else settingValues.set(settingKey(layer, id), value);
        return Promise.resolve(platformOk(undefined));
      },
    },
    document: {
      edited: (event) => {
        edited.push(event);
      },
    },
    dialogs: {
      ask: <Id extends string>(question: DialogQuestion<Id>): Promise<Id> => {
        questions.push(question);
        const answer = questionAnswers.shift();
        if (answer === undefined) return Promise.resolve(question.cancel);
        const chosen = question.choices.find((choice) => choice.id === answer);
        if (chosen === undefined) {
          return Promise.reject(new Error(`"${answer}" is not an answer to "${question.message}"`));
        }
        return Promise.resolve(chosen.id);
      },
      pickSavePath: (request) => {
        savePathRequests.push(request);
        return Promise.resolve(pathAnswers.length === 0 ? null : pathAnswers.shift() ?? null);
      },
      pickFile: (request) => {
        filePickRequests.push(request);
        const answer = fileAnswers.shift() ?? null;
        return Promise.resolve(answer === null ? null : { name: answer.name, bytes: answer.bytes.slice() });
      },
    },
    shell: {
      openExternal: (path) => {
        const invalid = invalidPath(path, false);
        if (invalid !== undefined) return Promise.resolve(platformError("invalid-path", invalid));
        if (!files.has(fold(path))) return Promise.resolve(platformError("not-found", `File not found: ${path}`));
        openedExternally.push(path);
        return Promise.resolve(platformOk(undefined));
      },
    },
    ...(runsAnything ? { run: { unavailable, startGame: start, startProgram: start } } : {}),
    seed: (path, bytes) => {
      put(path, bytes);
    },
    bytesOf: (path) => files.get(fold(path))?.bytes.slice(),
    editedEvents: edited,
    watchCount: () => watches.size,
    failWrites: (error) => {
      writeFailure = error;
    },
    answerQuestions: (...ids) => {
      questionAnswers.push(...ids);
    },
    answerSavePaths: (...paths) => {
      pathAnswers.push(...paths);
    },
    answerFilePicks: (...picks) => {
      fileAnswers.push(...picks);
    },
    filePickRequests,
    openedExternally,
    questions,
    savePathRequests,
    runs,
  };
}
