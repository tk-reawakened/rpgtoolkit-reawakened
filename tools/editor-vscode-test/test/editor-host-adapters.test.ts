import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openMainDocument, type MainDocumentSnapshot } from "@tk-reawakened/editor-model";
import { createVscodeFileSystemWithPort, handleEditorHostRequest, recoverMainDocument, RemoteDocument, type VscodeApi, type VscodeFileSystemPort } from "@tk-reawakened/host-vscode/testing";
import type { ViewDocument } from "@tk-reawakened/editor-ui";

let mount: typeof import("@tk-reawakened/editor-ui").mount;
const gamePath = "Main/example.gam";
let act: (callback: () => void | Promise<void>) => Promise<void> | void;

before(async () => {
  GlobalRegistrator.register();
  ({ mount } = await import("@tk-reawakened/editor-ui"));
  ({ act } = await import("preact/test-utils"));
});
after(() => GlobalRegistrator.unregister());

test("real web and VS Code adapters keep mounted title edits dirty and named after write rejection", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const { createWebFileSystem } = await import("@tk-reawakened/host-web/testing");
  const webFs = createWebFileSystem(webRoot(original), "web-project");
  const webOpened = await openMainDocument(webFs, createDocumentIdentity("web-project", gamePath));
  ok(webOpened.ok);
  const webElement = document.createElement("div");
  document.body.append(webElement);
  await assertFailedMountedSave(webOpened.document, webElement);
  const webBytes = await webFs.read(gamePath);
  ok(webBytes.ok);
  deepEqual(webBytes.value, original);

  const vscodeBytes = original.slice();
  const root = { path: "/project" };
  const permission = Object.assign(new Error("workspace is read-only"), { code: "NoPermissions" });
  const vscodePort: VscodeFileSystemPort<typeof root> = {
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory() { return []; },
    async readFile(uri) { if (uri.path !== "/project/Main/example.gam") throw Object.assign(new Error("missing"), { code: "FileNotFound" }); return vscodeBytes.slice(); },
    async createDirectory() {},
    async writeFile() { throw permission; },
    async stat() { return { type: 1, size: vscodeBytes.length, mtime: 1 }; },
    async delete() {},
    async rename() {},
    async watch() { return { dispose() {} }; },
    errorCode(error) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined; },
  };
  const vscodeFs = createVscodeFileSystemWithPort(root, vscodePort, "file:///project");
  const vscodeOpened = await openMainDocument(vscodeFs, createDocumentIdentity("file:///project", gamePath));
  ok(vscodeOpened.ok);
  const hostDocument = {
    model: vscodeOpened.document,
    didEdit: (_editId: string) => undefined,
    saveThroughWorkbench: () => vscodeOpened.document.save(),
  };
  let remote!: RemoteDocument;
  const api: VscodeApi = {
    postMessage: (request) => { void handleEditorHostRequest(hostDocument, request, (reply) => remote.receive(reply)); },
    getState: () => undefined,
    setState: () => undefined,
  };
  remote = new RemoteDocument(vscodeOpened.document.getSnapshot(), api);
  const vscodeElement = document.createElement("div");
  document.body.append(vscodeElement);
  await assertFailedMountedSave(remote, vscodeElement);
  deepEqual(vscodeBytes, original);
});

test("web and VS Code adapters persist identical edited bytes through the workbench save lifecycle (#2092)", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const { createWebFileSystem } = await import("@tk-reawakened/host-web/testing");
  const path = "/project/Main/example.gam";
  const webFs = createWebFileSystem(webRoot(original, false), "web-project");
  equal((await webFs.readProject("wrong-project", gamePath)).ok, false);
  equal((await webFs.writeProject("wrong-project", gamePath, new Uint8Array(0))).ok, false);
  const untouchedWeb = await webFs.read(gamePath);
  ok(untouchedWeb.ok);
  deepEqual(untouchedWeb.value, original);
  const webIdentity = createDocumentIdentity("web-project", gamePath);
  const webOpened = await openMainDocument(webFs, webIdentity);
  ok(webOpened.ok);
  const title = "Shared adapter save";
  const webEdit = webOpened.document.apply({ type: "set-game-title", title });
  ok(webEdit.ok);
  const webBackupBytes = webOpened.document.serialize();
  const webSaved = await webOpened.document.save();
  ok(webSaved.ok);
  const webPersisted = await webFs.read(gamePath);
  ok(webPersisted.ok);
  deepEqual(webPersisted.value, webBackupBytes);
  const webReopened = await openMainDocument(webFs, webIdentity);
  ok(webReopened.ok);
  equal(webReopened.document.getSnapshot().gameTitle, title);

  const vscodeRoot = { path: "/project" };
  const vscodeFiles = new Map([[path, original.slice()]]);
  const vscodePort: VscodeFileSystemPort<typeof vscodeRoot> = {
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory() { return []; },
    async readFile(uri) { const bytes = vscodeFiles.get(uri.path); if (!bytes) throw Object.assign(new Error("missing"), { code: "FileNotFound" }); return bytes.slice(); },
    async createDirectory() {},
    async writeFile(uri, bytes) { vscodeFiles.set(uri.path, bytes.slice()); },
    async stat(uri) { const bytes = vscodeFiles.get(uri.path); if (!bytes) throw Object.assign(new Error("missing"), { code: "FileNotFound" }); return { type: 1, size: bytes.length, mtime: 1 }; },
    async delete() {},
    async rename() {},
    async watch() { return { dispose() {} }; },
    errorCode(error) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined; },
  };
  const vscodeFs = createVscodeFileSystemWithPort(vscodeRoot, vscodePort, "file:///project");
  equal((await vscodeFs.readProject("wrong-project", gamePath)).ok, false);
  equal((await vscodeFs.writeProject("wrong-project", gamePath, new Uint8Array(0))).ok, false);
  deepEqual(vscodeFiles.get(path), original);
  const vscodeIdentity = createDocumentIdentity("file:///project", gamePath);
  const vscodeOpened = await openMainDocument(vscodeFs, vscodeIdentity);
  ok(vscodeOpened.ok);
  const vscodeEdit = vscodeOpened.document.apply({ type: "set-game-title", title });
  ok(vscodeEdit.ok);
  const vscodeBackupBytes = vscodeOpened.document.serialize();
  let workbenchSaveCalls = 0;
  let vscodeSaveSucceeded = false;
  const savedSnapshots: MainDocumentSnapshot[] = [];
  const hostDocument = {
    model: vscodeOpened.document,
    didEdit: () => undefined,
    saveThroughWorkbench: async () => {
      workbenchSaveCalls += 1;
      return vscodeOpened.document.save();
    },
  };
  await handleEditorHostRequest(hostDocument, { type: "save", requestId: "save-1" }, (reply) => {
    if (reply.type !== "save-result") return;
    vscodeSaveSucceeded = reply.result.ok;
    savedSnapshots.push(reply.snapshot);
  });
  equal(workbenchSaveCalls, 1, "the webview save request must use the host's VS Code save lifecycle");
  equal(vscodeSaveSucceeded, true);
  const savedSnapshot = savedSnapshots[0];
  ok(savedSnapshot);
  equal(savedSnapshot.dirty, false);
  const vscodeReopened = await openMainDocument(vscodeFs, vscodeIdentity);
  ok(vscodeReopened.ok);
  equal(vscodeReopened.document.getSnapshot().gameTitle, title);
  deepEqual(webPersisted.value, vscodeFiles.get(path));
  deepEqual(webBackupBytes, vscodeBackupBytes);
});

test("VS Code backup recovery restores serialized edits as dirty and saves them to the original file", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  const source = await openMainDocument({ readProject: async () => ({ ok: true, value: original }), writeProject: async () => ({ ok: true, value: undefined }) }, identity);
  ok(source.ok);
  const title = "Recovered unsaved title";
  const edit = source.document.apply({ type: "set-game-title", title });
  ok(edit.ok);
  const backup = source.document.serialize();
  const files = new Map([["/project/Main/example.gam", original.slice()]]);
  const root = { path: "/project" };
  const port: VscodeFileSystemPort<typeof root> = {
    isDirectory: (type) => (type & 2) !== 0,
    joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
    parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
    async readDirectory() { return []; },
    async readFile(uri) { const bytes = files.get(uri.path); if (!bytes) throw Object.assign(new Error("missing"), { code: "FileNotFound" }); return bytes.slice(); },
    async createDirectory() {},
    async writeFile(uri, bytes) { files.set(uri.path, bytes.slice()); },
    async stat(uri) { const bytes = files.get(uri.path); if (!bytes) throw Object.assign(new Error("missing"), { code: "FileNotFound" }); return { type: 1, size: bytes.length, mtime: 1 }; },
    async delete() {},
    async rename() {},
    async watch() { return { dispose() {} }; },
    errorCode(error) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined; },
  };
  const recovered = recoverMainDocument(createVscodeFileSystemWithPort(root, port, "file:///project"), identity, backup);
  ok(recovered.ok);
  equal(recovered.document.getSnapshot().gameTitle, title);
  equal(recovered.document.getSnapshot().dirty, true);
  const saved = await recovered.document.save();
  ok(saved.ok);
  deepEqual(files.get("/project/Main/example.gam"), backup);
});

async function assertFailedMountedSave(doc: ViewDocument, element: HTMLElement): Promise<void> {
  const edited = await doc.apply({ type: "set-game-title", title: "Rejected save title" });
  ok(edited.ok);
  equal(doc.getSnapshot().dirty, true);
  let view: ReturnType<typeof mount> | undefined;
  await act(() => { view = mount(element, { document: doc, services: { document: { edited: () => undefined } } }); });
  const field = element.querySelector("input");
  const save = element.querySelector("button");
  ok(field && save);
  equal(field.value, "Rejected save title");
  const failed = waitForSnapshot(doc, (snapshot) => snapshot.saveError !== null && !snapshot.saving);
  await act(() => { save.click(); });
  await failed;
  equal(doc.getSnapshot().dirty, true);
  equal(field.value, "Rejected save title");
  equal(element.querySelector('[role="status"]')?.textContent, "Unsaved changes");
  const alert = element.querySelector('[role="alert"]')?.textContent ?? "";
  match(alert, /Main\/example\.gam/);
  match(alert, /read-only|refuses/i);
  await act(() => view?.dispose());
}

function waitForSnapshot(doc: ViewDocument, predicate: (snapshot: MainDocumentSnapshot) => boolean): Promise<void> {
  if (predicate(doc.getSnapshot())) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = doc.subscribe(() => {
      if (!predicate(doc.getSnapshot())) return;
      unsubscribe();
      resolve();
    });
  });
}

function webRoot(bytes: Uint8Array, rejectWrites = true): FileSystemDirectoryHandle {
  class Directory {
    readonly kind = "directory";
    readonly children = new Map<string, Directory | { readonly kind: "file"; bytes: Uint8Array }>();
    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
      const existing = this.children.get(name);
      if (existing?.kind === "directory") return existing as unknown as FileSystemDirectoryHandle;
      if (existing) throw new DOMException("Not a directory", "TypeMismatchError");
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      const child = new Directory();
      this.children.set(name, child);
      return child as unknown as FileSystemDirectoryHandle;
    }
    async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
      let file = this.children.get(name);
      if (file?.kind === "directory") throw new DOMException("Is a directory", "TypeMismatchError");
      if (!file && !options?.create) throw new DOMException("Not found", "NotFoundError");
      if (!file) { file = { kind: "file", bytes: new Uint8Array() }; this.children.set(name, file); }
      return {
        getFile: async () => ({ size: file.bytes.length, lastModified: 1, arrayBuffer: async () => file.bytes.slice().buffer } as File),
        createWritable: async () => {
          if (rejectWrites) throw new DOMException("The selected folder refuses writes", "NotAllowedError");
          let pending = file.bytes.slice();
          return {
            write: async (buffer: ArrayBuffer) => { pending = new Uint8Array(buffer.slice(0)); },
            close: async () => { file.bytes = pending; },
          } as FileSystemWritableFileStream;
        },
      } as FileSystemFileHandle;
    }
  }
  const root = new Directory();
  const folder = new Directory();
  folder.children.set("example.gam", { kind: "file", bytes: bytes.slice() });
  root.children.set("Main", folder);
  return root as unknown as FileSystemDirectoryHandle;
}
