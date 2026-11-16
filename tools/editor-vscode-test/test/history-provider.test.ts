// The custom-editor provider's own lifecycles carry the history sink (#2836): a recovered document opened through
// `openCustomDocument` with a backup id, and `saveCustomDocumentAs` over an existing destination. Both are driven through
// the real provider entrypoints, and their outcomes are read back from the project's timeline.
import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BinaryReader, readMainFile, writeMainFile } from "@tk-reawakened/core";
import type { DialogService } from "@tk-reawakened/platform-services";
import {
  createGameEditorProvider,
  createVscodeFileSystemWithPort,
  resolveRecoveryConflict,
  vscodeCapabilities,
  type GameEditEvent,
  type GameEditorProvider,
  type VscodeFileSystemPort,
  type WorkspaceFolderLike,
} from "@tk-reawakened/host-vscode/testing";

interface Uri { readonly path: string }
const FOLDER: WorkspaceFolderLike<Uri> = { uri: { path: "/project" }, key: "file:///project" };
const GAME = "Main/example.gam";
const COPY = "Main/copy.gam";
const fixture = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url)));
const titleOf = (bytes: Uint8Array): string => {
  const read = readMainFile(new BinaryReader(bytes, GAME));
  return read.ok ? read.value.gameTitle : "";
};

function harness(options: { readonly backup?: Uint8Array } = {}) {
  const files = new Map<string, Uint8Array>([[`/project/${GAME}`, fixture.slice()]]);
  const missing = (uri: Uri) => Object.assign(new Error(`${uri.path} was not found`), { code: "FileNotFound" });
  const port: VscodeFileSystemPort<Uri> = {
    isSymbolicLink: (type) => (type & 64) !== 0,
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory(uri) {
      const prefix = `${uri.path}/`;
      const entries = new Map<string, number>();
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        entries.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? 1 : 2);
      }
      if (entries.size === 0) throw missing(uri);
      return [...entries];
    },
    async readFile(uri) { const bytes = files.get(uri.path); if (bytes === undefined) throw missing(uri); return bytes.slice(); },
    async createDirectory() {},
    async writeFile(uri, bytes) { files.set(uri.path, bytes.slice()); },
    async stat(uri) {
      const bytes = files.get(uri.path);
      if (bytes !== undefined) return { type: 1, size: bytes.length, mtime: 0 };
      if ([...files.keys()].some((path) => path.startsWith(`${uri.path}/`))) return { type: 2, size: 0, mtime: 0 };
      throw missing(uri);
    },
    async delete() { throw new Error("not used"); },
    async rename() { throw new Error("not used"); },
    async watch() { return { dispose() {} }; },
    errorCode: (error) => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined),
  };
  const never: DialogService = {
    ask: () => Promise.reject(new Error("the provider asked a question; in VS Code the workbench asks")),
    pickSavePath: () => Promise.reject(new Error("the provider asked for a path; in VS Code the workbench asks")),
  };
  const edits: GameEditEvent<Uri>[] = [];
  const provider: GameEditorProvider<Uri> = createGameEditorProvider<Uri>({
    capabilities: vscodeCapabilities(false),
    folderOf: (uri) => (uri.path.startsWith("/project/") ? FOLDER : undefined),
    fileSystem: (folder) => createVscodeFileSystemWithPort(folder.uri, port, folder.key),
    dialogs: () => never,
    readBackup: async () => options.backup ?? fixture,
    writeBackup: () => Promise.reject(new Error("not used")),
    deleteBackup: () => Promise.reject(new Error("not used")),
    uriFor: () => { throw new Error("not used"); },
    openEditor: () => Promise.reject(new Error("not used")),
    quickPick: () => Promise.reject(new Error("not used")),
    saveEditor: () => Promise.reject(new Error("not used")),
  }, (event) => { edits.push(event); });
  const timeline = async (path: string) => (await provider.workspaceFor(FOLDER).workspace.history.documentTimeline(path));
  return { files, provider, edits, timeline };
}

test("a backup opened through openCustomDocument keeps the disk version it replaces when the user keeps their recovered work (#2836)", async () => {
  const backupTitle = "Recovered while closed";
  const read = readMainFile(new BinaryReader(fixture, GAME));
  ok(read.ok);
  const written = writeMainFile({ ...read.value, gameTitle: backupTitle });
  ok(written.ok);
  const { provider, files, timeline } = harness({ backup: written.value });
  // The backup is what VS Code hands over: the recovered model differs from the disk file, so recovery is a conflict.
  const document = await provider.openCustomDocument({ path: `/project/${GAME}` }, "backup");
  // The recovery wrapper is not an `AnyDocument`; the helper takes the provider's document as the host does.
  const resolved = await resolveRecoveryConflict(document as never, "keep-local");
  ok(resolved.ok, resolved.ok ? "" : resolved.message);
  await provider.saveCustomDocument(document);
  equal(titleOf(files.get(`/project/${GAME}`)!), backupTitle, "the recovered work reached the disk");
  const entries = await timeline(GAME);
  ok(entries.some((entry) => entry.reason === "before-conflict-resolution"), `the replaced disk version is kept in history; reasons: ${entries.map((entry) => entry.reason).join(", ")}`);
});

test("saveCustomDocumentAs over an existing destination keeps that destination's previous bytes (#2836)", async () => {
  const { provider, files, timeline } = harness();
  files.set(`/project/${COPY}`, fixture.slice());
  const document = await provider.openCustomDocument({ path: `/project/${GAME}` }, undefined);
  const edited = document.model.apply({ type: "set-game-title", title: "Copy through the provider" });
  ok(edited.ok);
  document.didEdit(edited.editId);
  await provider.saveCustomDocumentAs(document, { path: `/project/${COPY}` });
  equal(titleOf(files.get(`/project/${COPY}`)!), "Copy through the provider");
  const entries = await timeline(COPY);
  const kept = await Promise.all(entries.map(async (entry) => (await provider.workspaceFor(FOLDER).workspace.history.preview(entry.id))!.bytes));
  ok(kept.some((bytes) => Buffer.compare(Buffer.from(bytes), Buffer.from(fixture)) === 0), `the destination's previous bytes are kept; reasons: ${entries.map((entry) => entry.reason).join(", ")}`);
});
