// The VS Code custom editor provider's Save As in a multi-root workspace (ADR 0022 D1.1, D3.4, D14.7; #2206). Each
// workspace folder is a project, and the source document's project stays the project of its lifecycle: Save As may
// write inside that project only. These cases drive the real provider (`createGameEditorProvider`) through its port,
// with two workspace folders over one in-memory disk, and play the workbench's part of Save As: it calls
// `saveCustomDocumentAs`, and only when that resolves does it treat the source as saved and open the destination.
import { deepEqual, equal, match, ok, rejects } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { asMainDocument } from "@tk-reawakened/editor-model";
import type { DialogService } from "@tk-reawakened/platform-services";
import {
  createGameEditorProvider,
  createVscodeFileSystemWithPort,
  vscodeCapabilities,
  type GameDocument,
  type GameEditEvent,
  type GameEditorProvider,
  type VscodeFileSystemPort,
  type WorkspaceFolderLike,
} from "@tk-reawakened/host-vscode/testing";
import { GAME, retitled } from "../conformance/suite.ts";

interface Uri { readonly path: string }

const fixture = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));
const ALPHA: WorkspaceFolderLike<Uri> = { uri: { path: "/alpha" }, key: "file:///alpha" };
const BETA: WorkspaceFolderLike<Uri> = { uri: { path: "/beta" }, key: "file:///beta" };

/** Two workspace folders, `/alpha` and `other`, each holding `Main/example.gam`, and every call the provider makes into either of them. */
function workspace(other: WorkspaceFolderLike<Uri> = BETA) {
  const files = new Map<string, Uint8Array>([
    [`/alpha/${GAME}`, retitled(fixture, "Alpha game")],
    [`${other.uri.path.replace(/\/$/, "")}/${GAME}`, retitled(fixture, "Beta game")],
  ]);
  /** Absolute paths the provider read, checked or wrote, in order. */
  const touched: string[] = [];
  /** The folder keys the provider asked for a file system or dialogs: a project workspace it made for that folder. */
  const projects: string[] = [];
  const missing = (uri: Uri) => Object.assign(new Error(`${uri.path} was not found`), { code: "FileNotFound" });
  const port: VscodeFileSystemPort<Uri> = {
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory(uri) {
      touched.push(uri.path);
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
    async readFile(uri) {
      touched.push(uri.path);
      const bytes = files.get(uri.path);
      if (bytes === undefined) throw missing(uri);
      return bytes.slice();
    },
    async createDirectory(uri) { touched.push(uri.path); },
    async writeFile(uri, bytes) {
      touched.push(uri.path);
      files.set(uri.path, bytes.slice());
    },
    async stat(uri) {
      touched.push(uri.path);
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
  /** The workbench's undo stack: one entry per fired edit event. */
  const edits: GameEditEvent<Uri>[] = [];
  const provider: GameEditorProvider<Uri> = createGameEditorProvider<Uri>({
    capabilities: vscodeCapabilities(false),
    // VS Code's `getWorkspaceFolder`: the folder containing the URI, or none.
    folderOf: (uri) => [ALPHA, other].find((folder) => uri.path.startsWith(`${folder.uri.path.replace(/\/$/, "")}/`)),
    fileSystem: (folder) => {
      projects.push(folder.key);
      return createVscodeFileSystemWithPort(folder.uri, port, folder.key);
    },
    dialogs: (folder) => {
      projects.push(folder.key);
      return never;
    },
    readBackup: () => Promise.reject(new Error("not used")),
    writeBackup: () => Promise.reject(new Error("not used")),
    deleteBackup: () => Promise.reject(new Error("not used")),
    uriFor: () => { throw new Error("not used"); },
    openEditor: () => Promise.reject(new Error("not used")),
    quickPick: () => Promise.reject(new Error("not used")),
    saveEditor: () => Promise.reject(new Error("not used")),
  }, (event) => { edits.push(event); });

  /** Open `path` and edit its title, as a user typing in the view would: the model accepts it and the workbench records it. */
  const openEdited = async (path: string, title: string): Promise<GameDocument<Uri>> => {
    const document = await provider.openCustomDocument({ path }, undefined);
    const edited = document.model.apply({ type: "set-game-title", title });
    ok(edited.ok);
    document.didEdit(edited.editId);
    return document;
  };
  return { files, touched, projects, edits, provider, openEdited };
}

/** The bytes on disk, copied, so a later write cannot change what a test compares against. */
function snapshot(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
}

test("Save As to a destination inside the source's own workspace folder writes the copy and leaves the source file", async () => {
  const { files, provider, openEdited } = workspace();
  const original = files.get(`/alpha/${GAME}`)!.slice();
  const source = await openEdited(`/alpha/${GAME}`, "Copied within alpha");
  const copied = source.model.serialize();

  await provider.saveCustomDocumentAs(source, { path: "/alpha/Main/copy.gam" });

  deepEqual(files.get("/alpha/Main/copy.gam"), copied, "the destination holds the source's edits");
  deepEqual(files.get(`/alpha/${GAME}`), original, "Save As leaves the source file unchanged");
  // The workbench now opens the destination, as a document of the same project.
  const copy = await provider.openCustomDocument({ path: "/alpha/Main/copy.gam" }, undefined);
  equal(copy.model.identity.projectId, ALPHA.key);
  equal(asMainDocument(copy.model).getSnapshot().gameTitle, "Copied within alpha");
  equal(copy.model.getSnapshot().dirty, false, "the copy opens clean");
});

test("Save As to a destination outside every workspace folder is refused without writing", async () => {
  const { files, provider, edits, openEdited } = workspace();
  const source = await openEdited(`/alpha/${GAME}`, "Kept after refusal");
  const before = snapshot(files);

  await rejects(provider.saveCustomDocumentAs(source, { path: "/elsewhere/copy.gam" }), /outside the open workspace folders.*Nothing was written/);

  deepEqual(files, before, "nothing was written anywhere");
  equal(source.model.getSnapshot().dirty, true, "the source keeps its unsaved work");
  equal(asMainDocument(source.model).getSnapshot().gameTitle, "Kept after refusal");
  equal(edits.length, 1, "the workbench's edit stack is untouched");
});

test("Save As into a second workspace folder's project is refused before that project is touched (#2206)", async () => {
  const { files, touched, projects, provider, edits, openEdited } = workspace();
  const source = await openEdited(`/alpha/${GAME}`, "Stays in alpha");
  const before = snapshot(files);
  touched.length = 0;

  await rejects(
    provider.saveCustomDocumentAs(source, { path: "/beta/Main/copy.gam" }),
    (error: Error) => {
      match(error.message, /copy\.gam is in another workspace folder \(beta\)/);
      match(error.message, /Main\/example\.gam/);
      match(error.message, /Nothing was written\.$/);
      return true;
    },
  );

  deepEqual(files, before, "nothing was written in either folder");
  deepEqual(touched, [], "the provider did not read, check or write the destination folder");
  deepEqual(projects, [ALPHA.key, ALPHA.key], "no project workspace was made for the destination's folder");
  equal(source.model.identity.projectId, ALPHA.key, "the source stays bound to its own project");
  equal(source.model.getSnapshot().dirty, true, "the refused Save As leaves the source dirty");
  equal(asMainDocument(source.model).getSnapshot().gameTitle, "Stays in alpha");
  equal(edits.length, 1, "the workbench's edit stack is untouched");

  // The source's own save still works after the refusal, and only then is it clean.
  await provider.saveCustomDocument(source);
  equal(source.model.getSnapshot().dirty, false, "a successful save marks the source clean");
  deepEqual(files.get(`/alpha/${GAME}`), source.model.serialize(), "and writes its own file");
  equal(files.has("/beta/Main/copy.gam"), false);
});

test("Save As over a document open in a second workspace folder is refused and leaves that document as it was", async () => {
  const { files, projects, provider, openEdited } = workspace();
  const other = await provider.openCustomDocument({ path: `/beta/${GAME}` }, undefined);
  const source = await openEdited(`/alpha/${GAME}`, "Not over beta");
  const before = snapshot(files);
  const madeBefore = [...projects];

  await rejects(provider.saveCustomDocumentAs(source, { path: `/beta/${GAME}` }), /another workspace folder \(beta\).*Nothing was written/);

  deepEqual(files, before, "beta's file keeps its bytes");
  deepEqual(projects, madeBefore, "no further project state was made");
  equal(asMainDocument(other.model).getSnapshot().gameTitle, "Beta game", "beta's open document is unchanged");
  equal(other.model.getSnapshot().dirty, false);
  equal(source.model.getSnapshot().dirty, true, "the source keeps its unsaved work");
  equal(asMainDocument(source.model).getSnapshot().gameTitle, "Not over beta");
});

test("the refusal names a root workspace folder by its path, not by an empty name", async () => {
  const ROOT: WorkspaceFolderLike<Uri> = { uri: { path: "/" }, key: "file:///" };
  const { files, projects, provider, openEdited } = workspace(ROOT);
  const source = await openEdited(`/alpha/${GAME}`, "Not into the root folder");
  const before = snapshot(files);

  await rejects(provider.saveCustomDocumentAs(source, { path: "/Main/copy.gam" }), (error: Error) => {
    match(error.message, /copy\.gam is in another workspace folder \(\/\); /);
    return true;
  });

  deepEqual(files, before, "nothing was written");
  deepEqual(projects, [ALPHA.key, ALPHA.key], "no project workspace was made for the root folder");
  equal(source.model.getSnapshot().dirty, true, "the source keeps its unsaved work");
});
