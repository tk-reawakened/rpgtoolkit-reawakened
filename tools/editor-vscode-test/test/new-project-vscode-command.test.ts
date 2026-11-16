// Story 11.10, the "RPG Toolkit: New project" command as the extension registers it. The real `extension.ts` is bundled
// against a fake `vscode` module (an in-memory `workspace.fs`, scripted input boxes, pick lists and folder dialog, and a
// workspace whose folders the test controls), so the command's own wiring runs: the questions, the folder dialog, the
// writes through the real workspace adapter, and how the created project is opened (inside a folder already open, added
// to the workspace, or opened as the folder of an empty window and its main file opened after the restart).
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { before, test } from "node:test";
import { build } from "esbuild";

const FAKE_VSCODE = `
import { posix } from "node:path";
const files = new Map();
const folders = new Set(["/"]);
const listeners = new Set();
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 };
export const UIKind = { Desktop: 1, Web: 2 };
export class FileSystemError extends Error { constructor(message, code) { super(message); this.code = code; } }
export class Uri {
  constructor(scheme, path) { this.scheme = scheme; this.path = path; }
  static file(path) { return new Uri("file", path); }
  static parse(text) { const match = /^([a-z]+):\\/\\/(.*)$/.exec(text); return new Uri(match[1], match[2]); }
  static joinPath(base, ...parts) { return new Uri(base.scheme, posix.join(base.path, ...parts)); }
  with(change) { return new Uri(this.scheme, change.path ?? this.path); }
  toString() { return this.scheme + "://" + this.path; }
  get fsPath() { return this.path; }
}
const parentOf = (path) => path.slice(0, path.lastIndexOf("/")) || "/";
const state = { workspaceFolders: undefined, workspaceFile: "/test.code-workspace", calls: [], errors: [], answers: { input: [], pick: [], folder: [] }, globalState: new Map(), commands: new Map(), updated: [], restartOnUpdate: false, refuseWorkspaceUpdate: false, onWorkspaceUpdate: undefined };
const missing = (uri) => new FileSystemError(uri.path + " was not found", "FileNotFound");
export const workspace = {
  get workspaceFolders() { return state.workspaceFolders; },
  get workspaceFile() { return state.workspaceFile === undefined ? undefined : Uri.file(state.workspaceFile); },
  getWorkspaceFolder(uri) { return (state.workspaceFolders ?? []).find((folder) => uri.path === folder.uri.path || uri.path.startsWith(folder.uri.path.replace(/\\/$/, "") + "/")); },
  updateWorkspaceFolders(start, remove, ...add) {
    state.updated.push(add.map((item) => item.uri.toString()));
    if (state.refuseWorkspaceUpdate) return false;
    state.workspaceFolders = [...(state.workspaceFolders ?? []), ...add.map((item) => ({ uri: item.uri, name: item.uri.path.split("/").at(-1), index: 0 }))];
    state.onWorkspaceUpdate?.();
    if (!state.restartOnUpdate) for (const listener of [...listeners]) listener({});
    return true;
  },
  onDidChangeWorkspaceFolders(listener) { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
  onDidChangeTextDocument() { return { dispose() {} }; },
  getConfiguration() { return { get: (_id, fallback) => fallback, inspect: () => undefined, update: async () => undefined }; },
  fs: {
    async readDirectory(uri) {
      const prefix = uri.path.replace(/\\/$/, "") + "/";
      const found = new Map();
      for (const path of files.keys()) if (path.startsWith(prefix)) { const rest = path.slice(prefix.length); const slash = rest.indexOf("/"); found.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 1 : 2); }
      for (const path of folders) if (path.startsWith(prefix) && path !== uri.path) { const rest = path.slice(prefix.length); found.set(rest.split("/")[0], 2); }
      if (found.size === 0 && !folders.has(uri.path)) throw missing(uri);
      return [...found];
    },
    async readFile(uri) { const bytes = files.get(uri.path); if (bytes === undefined) throw missing(uri); return bytes.slice(); },
    async createDirectory(uri) {
      if (files.has(uri.path)) throw new FileSystemError("a file exists", "FileExists");
      for (let path = uri.path; path !== "/" && !folders.has(path); path = parentOf(path)) folders.add(path);
    },
    async writeFile(uri, bytes) { if (state.refuseWrites) throw new FileSystemError("read-only", "NoPermissions"); files.set(uri.path, bytes.slice()); },
    async stat(uri) { const bytes = files.get(uri.path); if (bytes !== undefined) return { type: 1, size: bytes.length, mtime: 0 }; if (folders.has(uri.path)) return { type: 2, size: 0, mtime: 0 }; throw missing(uri); },
    async delete(uri) { files.delete(uri.path); },
    async rename() { throw new Error("not used"); },
  },
};
export const window = {
  async showInputBox(options) { const answer = state.answers.input.shift(); if (typeof answer === "string") { const problem = options.validateInput?.(answer); if (problem) throw new Error("the answer " + JSON.stringify(answer) + " was refused: " + problem); } return answer; },
  async showQuickPick(rows, options) { state.calls.push(["quickPick", options.title, rows.map((row) => row.id + (row.description === "Not available" ? ":unavailable" : ""))]); const wanted = state.answers.pick.shift(); return wanted === undefined ? undefined : rows.filter((row) => wanted.includes(row.id)); },
  async showOpenDialog(options) { state.calls.push(["openDialog", options.title, options.canSelectFolders, options.canSelectFiles]); const answer = state.answers.folder.shift(); return answer === undefined ? undefined : [Uri.file(answer)]; },
  async showErrorMessage(message) { state.errors.push(message); },
  async showWarningMessage() {},
};
export const commands = {
  registerCommand(id, handler) { state.commands.set(id, handler); return { dispose() {} }; },
  async executeCommand(id, ...args) { state.calls.push(["command", id, ...args.map(String)]); },
};
export const env = { uiKind: 1 };
globalThis.__tkrFakeVscode = { state, files, folders, listeners };
`;

interface FakeState {
  workspaceFolders: { uri: { path: string; toString(): string }; name: string }[] | undefined;
  workspaceFile: string | undefined;
  calls: unknown[][];
  errors: string[];
  answers: { input: (string | undefined)[]; pick: (string[] | undefined)[]; folder: (string | undefined)[] };
  commands: Map<string, () => Promise<void>>;
  updated: string[][];
  restartOnUpdate: boolean;
  refuseWorkspaceUpdate: boolean;
  onWorkspaceUpdate?: () => void;
  refuseWrites?: boolean;
}
interface Fake { readonly state: FakeState; readonly files: Map<string, Uint8Array>; readonly folders: Set<string> }
interface Extension { registerNewProject(context: unknown): void }
interface Context { subscriptions: unknown[]; globalState: { get(key: string): unknown; update(key: string, value: unknown): Promise<void> } }

let dir = "";
let extension: Extension;
let fake: Fake;

let extensionSource = "";

before(async () => {
  const buildDirectory = await mkdtemp(join(tmpdir(), "tkr-vscode-command-build-"));
  try {
    const fakePath = join(buildDirectory, "fake-vscode.mjs");
    await writeFile(fakePath, FAKE_VSCODE);
    const bundle = await build({
      // Keep the real registration path, without retaining unrelated extension commands in this fixture.
      stdin: {
        contents: 'export { registerNewProject } from "./packages/host-vscode/src/extension.ts";',
        resolveDir: resolve("."),
        sourcefile: "new-project-command-fixture.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "preact",
      alias: { vscode: fakePath },
      logLevel: "silent",
    });
    extensionSource = bundle.outputFiles[0]!.text;
  } finally {
    await rm(buildDirectory, { recursive: true, force: true });
  }
});

async function load(): Promise<void> {
  dir = await mkdtemp(join(tmpdir(), "tkr-vscode-command-"));
  const bundled = join(dir, "extension.mjs");
  await writeFile(bundled, extensionSource);
  // Each runtime-selected temporary module owns fresh VS Code state; a static import would share it between cases.
  extension = await import(pathToFileURL(bundled).href) as Extension;
  // The bundle holds its own copy of the fake, which publishes its state here when it loads.
  fake = (globalThis as { __tkrFakeVscode?: Fake }).__tkrFakeVscode!;
}

function context(persisted: Map<string, unknown>): Context {
  return { subscriptions: [], globalState: { get: (key) => persisted.get(key), update: async (key, value) => { if (value === undefined) persisted.delete(key); else persisted.set(key, value); } } };
}

function reset(workspace: FakeState["workspaceFolders"]): void {
  const { state } = fake;
  state.workspaceFolders = workspace;
  state.workspaceFile = "/test.code-workspace";
  state.calls.length = 0;
  state.errors.length = 0;
  state.updated.length = 0;
  state.answers.input.length = 0;
  state.answers.pick.length = 0;
  state.answers.folder.length = 0;
  state.refuseWrites = false;
  state.restartOnUpdate = false;
  state.refuseWorkspaceUpdate = false;
  delete state.onWorkspaceUpdate;
  fake.files.clear();
  fake.folders.clear();
  // The folders a person can pick already exist, as they do in a real folder dialog.
  for (const existing of ["/", "/games", "/games/quest", "/elsewhere", "/elsewhere/quest", "/fresh", "/fresh/quest"]) fake.folders.add(existing);
}

const folderOf = (path: string) => ({ uri: { path, toString: () => `file://${path}` }, name: path.split("/").at(-1)! });
const commandCalls = (): unknown[][] => fake.state.calls.filter((call) => call[0] === "command");
const FOLDERS = ["Bitmap", "Bkrounds", "Boards", "Chrs", "Enemy", "Font", "Item", "Main", "Media", "Misc", "Plugin", "Prg", "SpcMove", "StatusE", "Tiles"];

async function run(persisted: Map<string, unknown>): Promise<void> {
  extension.registerNewProject(context(persisted));
  await fake.state.commands.get("tkr.newProject")!();
}

test("the extension's New project command asks and writes through the workspace adapter", async () => {
  await load();
  try {
    reset([folderOf("/games/quest")]);
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push(["start-program", "start-board"]);
    fake.state.answers.folder.push("/games/quest");
    await run(new Map());
    const pick = fake.state.calls.find((call) => call[0] === "quickPick")!;
    match(String(pick[1]), /nothing is copied unless you tick it/);
    deepEqual(pick[2], ["start-program", "start-board", "start-character", "builtin-menu-battle", "tiles:unavailable", "system-programs:unavailable", "music:unavailable"]);
    deepEqual(fake.state.calls.find((call) => call[0] === "openDialog"), ["openDialog", "New project: choose the destination folder", true, false]);
    for (const name of FOLDERS) ok(fake.folders.has(`/games/quest/${name}`), `${name} exists`);
    ok(fake.files.has("/games/quest/Main/Quest.gam") && fake.files.has("/games/quest/Prg/start.prg") && fake.files.has("/games/quest/Boards/start.brd"));
    equal(fake.files.has("/games/quest/Chrs/start.tem"), false);
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///games/quest/Main/Quest.gam"]]);
    deepEqual(fake.state.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a nested project gets its own workspace folder and opens its main file there", async () => {
  await load();
  try {
    reset([folderOf("/games")]);
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/games/quest");
    await run(new Map());
    deepEqual(fake.state.updated, [["file:///games/quest"]]);
    ok(fake.state.workspaceFolders?.some((folder) => folder.uri.path === "/games/quest"), "the destination is a workspace folder, not only covered by its parent");
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///games/quest/Main/Quest.gam"]]);
    ok(fake.files.has("/games/quest/Main/Quest.gam"));
    deepEqual(fake.state.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a project at an exact existing workspace folder opens without adding a duplicate", async () => {
  await load();
  try {
    reset([folderOf("/games")]);
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/games");
    await run(new Map());
    deepEqual(fake.state.updated, []);
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///games/Main/Quest.gam"]]);
    ok(fake.state.workspaceFolders?.some((folder) => folder.uri.path === "/games"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("single-folder conversion leaves the main file for reactivation, even if a folder event arrives before restart", async () => {
  for (const deliverFolderEvent of [true, false]) {
    await load();
    try {
      reset([folderOf("/work")]);
      fake.state.workspaceFile = undefined;
      const persisted = new Map<string, unknown>();
      fake.state.answers.input.push("Quest", "Quest.gam");
      fake.state.answers.pick.push([]);
      fake.state.answers.folder.push("/elsewhere/quest");
      fake.state.restartOnUpdate = !deliverFolderEvent;
      await run(persisted);
      deepEqual(commandCalls(), [], "the old extension host must not consume the new project's open");
      deepEqual([...persisted.values()], [{ folder: "file:///elsewhere/quest", main: "file:///elsewhere/quest/Main/Quest.gam" }]);

      fake.state.workspaceFile = "/converted.code-workspace";
      extension.registerNewProject(context(persisted));
      deepEqual(commandCalls(), [["command", "vscode.open", "file:///elsewhere/quest/Main/Quest.gam"]]);
      equal(persisted.size, 0, "the restarted activation consumes the pending open");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a refused workspace-folder update clears the pending open and reports the failure", async () => {
  await load();
  try {
    reset([folderOf("/work")]);
    const persisted = new Map<string, unknown>();
    fake.state.refuseWorkspaceUpdate = true;
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/elsewhere/quest");
    await run(persisted);
    equal(persisted.size, 0, "a failed folder update must not leave a stale open request");
    deepEqual(commandCalls(), []);
    match(fake.state.errors[0]!, /could not add it to the workspace/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a project outside the open folders is added to the workspace and its main file opens once it is there", async () => {
  await load();
  try {
    reset([folderOf("/work")]);
    const persisted = new Map<string, unknown>();
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/elsewhere/quest");
    await run(persisted);
    deepEqual(fake.state.updated, [["file:///elsewhere/quest"]]);
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///elsewhere/quest/Main/Quest.gam"]]);
    equal(persisted.size, 0, "the no-restart path consumes the request before opening the file");
    ok(fake.files.has("/elsewhere/quest/Main/Quest.gam"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("in an empty window the folder is opened and the main file is opened by the next activation, once, and only for that folder", async () => {
  await load();
  try {
    reset(undefined);
    const persisted = new Map<string, unknown>();
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push(["start-program"]);
    fake.state.answers.folder.push("/fresh/quest");
    await run(persisted);
    deepEqual(commandCalls(), [["command", "vscode.openFolder", "file:///fresh/quest"]]);
    deepEqual([...persisted.values()], [{ folder: "file:///fresh/quest", main: "file:///fresh/quest/Main/Quest.gam" }]);

    // An unrelated window activation must leave the request for the newly created folder intact.
    fake.state.calls.length = 0;
    fake.state.workspaceFolders = [folderOf("/other")];
    extension.registerNewProject(context(persisted));
    deepEqual(commandCalls(), []);
    deepEqual([...persisted.values()], [{ folder: "file:///fresh/quest", main: "file:///fresh/quest/Main/Quest.gam" }]);

    // The target window consumes and opens the main file exactly once.
    fake.state.workspaceFolders = [folderOf("/fresh/quest")];
    extension.registerNewProject(context(persisted));
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///fresh/quest/Main/Quest.gam"]]);
    equal(persisted.size, 0);
    extension.registerNewProject(context(persisted));
    equal(commandCalls().length, 1, "it is not opened again");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dismissing a question or the folder dialog writes and opens nothing, and a refused creation is reported and changes nothing", async () => {
  await load();
  try {
    reset([folderOf("/games")]);
    for (const answers of [{ input: [undefined], pick: [], folder: [] }, { input: ["Quest", undefined], pick: [], folder: [] }, { input: ["Quest", "Quest.gam"], pick: [undefined], folder: [] }, { input: ["Quest", "Quest.gam"], pick: [[]], folder: [] }]) {
      reset([folderOf("/games")]);
      fake.state.answers.input.push(...answers.input as (string | undefined)[]);
      fake.state.answers.pick.push(...answers.pick as (string[] | undefined)[]);
      await run(new Map());
      equal(fake.files.size, 0);
      equal(fake.folders.size, 7, "no folder was made");
      deepEqual(commandCalls(), []);
      deepEqual(fake.state.errors, []);
    }

    reset([folderOf("/games")]);
    fake.files.set("/games/quest/Main/Quest.gam", new Uint8Array([1, 2, 3]));
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/games/quest");
    await run(new Map());
    equal(fake.state.errors.length, 1);
    match(fake.state.errors[0]!, /Main\/Quest\.gam already exists; the editor refuses existing files.*Nothing was written/);
    deepEqual([...fake.files.get("/games/quest/Main/Quest.gam")!], [1, 2, 3]);
    deepEqual(commandCalls(), []);
    equal(fake.folders.has("/games/quest/Boards"), false, "no folder was made");

    reset([folderOf("/games")]);
    fake.state.refuseWrites = true;
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/games/quest");
    await run(new Map());
    // The group is recorded before the first write (D12.10 item 6), so a host that refuses writes at all is refused there and nothing is written.
    match(fake.state.errors[0]!, /history checkpoint could not be recorded.*Nothing was written/);
    deepEqual(commandCalls(), [], "a failed creation opens nothing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a selected folder's trailing separator does not change its existing workspace identity", async () => {
  await load();
  try {
    reset([folderOf("/games/quest")]);
    fake.state.answers.input.push("Quest", "Quest.gam");
    fake.state.answers.pick.push([]);
    fake.state.answers.folder.push("/games/quest/");
    await run(new Map());
    deepEqual(fake.state.updated, [], "the selected directory is already the workspace folder");
    deepEqual(commandCalls(), [["command", "vscode.open", "file:///games/quest/Main/Quest.gam"]]);
    ok(fake.files.has("/games/quest/Main/Quest.gam"));
    deepEqual(fake.state.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
