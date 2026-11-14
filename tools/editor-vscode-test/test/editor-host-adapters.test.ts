import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_EDITOR_PREFERENCES, asMainDocument, createDocumentIdentity, openMainDocument, type MainDocumentSnapshot } from "@tk-reawakened/editor-model";
import { createVscodeFileSystemWithPort, handleEditorHostRequest, recoverMainDocument, resolveRecoveryConflict, RemoteDocument, vscodeCapabilities, type VscodeApi, type VscodeFileSystemPort } from "@tk-reawakened/host-vscode/testing";
import { createBrowserSession } from "@tk-reawakened/editor-ui/browser-session";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
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
  const browserSession = createBrowserSession();
  const hostDocument = {
    model: vscodeOpened.document,
    capabilities: vscodeCapabilities(true),
    browserSession,
    browserList: (path: string) => vscodeFs.list(path),
    browserRead: (path: string) => vscodeFs.read(path),
    didEdit: (_editId: string) => undefined,
    preview: async () => ({ ok: false as const, message: "A main file has no picture." }),
    boardPreferences: () => DEFAULT_EDITOR_PREFERENCES,
    visit: async () => ({ ok: false as const, message: "not used" }),
    returnFromVisit: async () => ({ ok: false as const, message: "not used" }),
    pickAsset: async () => ({ chosen: false as const }),
    saveThroughWorkbench: () => vscodeOpened.document.save(),
    resolveConflict: async (choice: "keep-local" | "reload") => vscodeOpened.document.resolveConflict(choice),
  };
  let remote!: RemoteDocument;
  const api: VscodeApi = {
    postMessage: (request) => { void handleEditorHostRequest(hostDocument, request, (reply) => remote.receive(reply)); },
    getState: () => undefined,
    setState: () => undefined,
  };
  remote = new RemoteDocument("main", vscodeOpened.document.getSnapshot(), browserSession.getSnapshot(), api);
  const vscodeElement = document.createElement("div");
  document.body.append(vscodeElement);
  await assertFailedMountedSave(remote as unknown as ViewDocument, vscodeElement);
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
    capabilities: vscodeCapabilities(true),
    browserSession: createBrowserSession(),
    browserList: (path: string) => vscodeFs.list(path),
    browserRead: (path: string) => vscodeFs.read(path),
    didEdit: () => undefined,
    preview: async () => ({ ok: false as const, message: "A main file has no picture." }),
    boardPreferences: () => DEFAULT_EDITOR_PREFERENCES,
    visit: async () => ({ ok: false as const, message: "not used" }),
    returnFromVisit: async () => ({ ok: false as const, message: "not used" }),
    pickAsset: async () => ({ chosen: false as const }),
    saveThroughWorkbench: async () => {
      workbenchSaveCalls += 1;
      return vscodeOpened.document.save();
    },
    resolveConflict: async (choice: "keep-local" | "reload") => vscodeOpened.document.resolveConflict(choice),
  };
  await handleEditorHostRequest(hostDocument, { type: "save", requestId: "save-1" }, (reply) => {
    if (reply.type !== "save-result") return;
    vscodeSaveSucceeded = reply.result.ok;
    savedSnapshots.push(reply.snapshot as MainDocumentSnapshot);
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

test("VS Code backup recovery requires an explicit choice before saving", async () => {
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
  const recovered = await recoverMainDocument(createVscodeFileSystemWithPort(root, port, "file:///project"), identity, backup);
  ok(recovered.ok);
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, title);
  equal(recovered.document.getSnapshot().dirty, true);
  const refused = await recovered.document.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "conflict");
  deepEqual(files.get("/project/Main/example.gam"), original);
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  const saved = await recovered.document.save();
  ok(saved.ok);
  deepEqual(files.get("/project/Main/example.gam"), backup);
});

test("hot-exit recovery preserves both versions when the title changed while VS Code was closed", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async (_project: string, _path: string, bytes: Uint8Array) => {
      writes += 1;
      disk = bytes.slice();
      return { ok: true as const, value: undefined };
    },
  };
  const local = await openMainDocument(storage, identity);
  ok(local.ok);
  ok(local.document.apply({ type: "set-game-title", title: "Unsaved before exit" }).ok);
  const backup = local.document.serialize();
  const external = await openMainDocument(storage, identity);
  ok(external.ok);
  ok(external.document.apply({ type: "set-game-title", title: "Changed while closed" }).ok);
  disk = external.document.serialize();
  const externalBytes = disk.slice();

  const recovered = await recoverMainDocument(storage, identity, backup);
  ok(recovered.ok);
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Unsaved before exit");
  equal(recovered.document.getSnapshot().conflict?.externalTitle, "Changed while closed");
  deepEqual(recovered.document.serialize(), backup);
  const refused = await recovered.document.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "conflict");
  equal(writes, 0);
  deepEqual(disk, externalBytes);
  deepEqual(recovered.document.serialize(), backup);
  equal(recovered.document.getSnapshot().dirty, true);
  const recoveredAgain = await recoverMainDocument(storage, identity, recovered.document.serialize());
  ok(recoveredAgain.ok);
  equal(asMainDocument(recoveredAgain.document).getSnapshot().gameTitle, "Unsaved before exit");
  equal(recoveredAgain.document.getSnapshot().conflict?.externalTitle, "Changed while closed");
  const refusedAgain = await recoveredAgain.document.save();
  ok(!refusedAgain.ok);
  equal(refusedAgain.failure.kind, "conflict");
  equal(writes, 0);
  deepEqual(disk, externalBytes);
  ok((await resolveRecoveryConflict(recovered.document, "reload")).ok);
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Changed while closed");
  deepEqual(disk, externalBytes);
});

for (const watcher of [true, false]) test(`recovery Keep retains matching local revision before later disk change (${watcher ? "watcher" : "save"})`, async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async (_project: string, _path: string, bytes: Uint8Array) => { writes += 1; disk = bytes.slice(); return { ok: true as const, value: undefined }; },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "Recovered B" }).ok);
  const local = recovered.document.serialize();
  disk = local.slice();
  equal(await recovered.document.checkExternal(), "conflict");
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  equal(recovered.document.getSnapshot().dirty, true, "Keep must not certify the recovered revision as saved");
  const external = await openMainDocument(storage, identity);
  ok(external.ok);
  ok(external.document.apply({ type: "set-game-title", title: "External C" }).ok);
  disk = external.document.serialize();
  const externalBytes = disk.slice();
  if (watcher) equal(await recovered.document.checkExternal(), "conflict");
  else {
    const result = await recovered.document.save();
    ok(!result.ok);
    equal(result.failure.kind, "conflict");
  }
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Recovered B");
  equal(recovered.document.getSnapshot().dirty, true);
  deepEqual(disk, externalBytes);
  equal(writes, 0);
});

for (const watcher of [true, false]) test(`matching recovery requires a successful write (${watcher ? "watched" : "unobserved"} match)`, async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async (_project: string, _path: string, bytes: Uint8Array) => { writes += 1; disk = bytes.slice(); return { ok: true as const, value: undefined }; },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "B" }).ok);
  disk = recovered.document.serialize();
  await recovered.document.checkExternal();
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "C" }).ok);
  disk = recovered.document.serialize();
  if (watcher) equal(await recovered.document.checkExternal(), "unchanged");
  equal(recovered.document.getSnapshot().dirty, true, "another matching disk revision cannot certify recovery");
  ok((await recovered.document.save()).ok);
  equal(writes, 1, "even equal disk bytes require a durable host write");
  equal(recovered.document.getSnapshot().dirty, false);
});

test("two rejected recovery choices never discard local work when disk first matches it", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async () => { writes += 1; return { ok: true as const, value: undefined }; },
  };
  const browserFs = createMemoryPlatformServices().fs;
  const source = await openMainDocument(storage, identity);
  ok(source.ok);
  ok(source.document.apply({ type: "set-game-title", title: "External B" }).ok);
  disk = source.document.serialize();
  const recovered = await recoverMainDocument(storage, identity, original); // Observes B.
  ok(recovered.ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "Recovered C" }).ok);
  const backup = recovered.document.serialize();
  const outcomes: boolean[] = [];
  const bridge = {
    model: recovered.document,
    capabilities: vscodeCapabilities(false),
    browserSession: createBrowserSession(),
    browserList: (path: string) => browserFs.list(path),
    browserRead: (path: string) => browserFs.read(path),
    didEdit: () => undefined,
    preview: async () => ({ ok: false as const, message: "A main file has no picture." }),
    boardPreferences: () => DEFAULT_EDITOR_PREFERENCES,
    visit: async () => ({ ok: false as const, message: "not used" }),
    returnFromVisit: async () => ({ ok: false as const, message: "not used" }),
    pickAsset: async () => ({ chosen: false as const }),
    saveThroughWorkbench: () => recovered.document.save(),
    resolveConflict: (choice: "keep-local" | "reload") => resolveRecoveryConflict(recovered.document, choice),
  };
  const choose = async () => handleEditorHostRequest(bridge, { type: "resolve-conflict", choice: "keep-local", requestId: "choice" }, (reply) => {
    if (reply.type === "conflict-result") {
      outcomes.push(reply.result.ok);
      equal((reply.snapshot as MainDocumentSnapshot).gameTitle, "Recovered C");
      equal(reply.snapshot.dirty, true);
    }
  });
  disk = backup.slice(); // C equals local but differs from observed B and the opened backup.
  await choose();
  deepEqual(outcomes, [false]);
  deepEqual(recovered.document.serialize(), backup);
  equal(recovered.document.getSnapshot().conflict?.externalTitle, "Recovered C");
  ok(source.document.apply({ type: "set-game-title", title: "External D" }).ok);
  disk = source.document.serialize();
  const external = disk.slice();
  await choose();
  deepEqual(outcomes, [false, false]);
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Recovered C");
  equal(recovered.document.getSnapshot().conflict?.externalTitle, "External D");
  equal(recovered.document.getSnapshot().dirty, true);
  deepEqual(recovered.document.serialize(), backup);
  deepEqual(disk, external);
  equal(writes, 0);
});

test("a later disk change still prevents saving after choosing the recovered version", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async (_project: string, _path: string, bytes: Uint8Array) => {
      writes += 1;
      disk = bytes.slice();
      return { ok: true as const, value: undefined };
    },
  };
  const source = await openMainDocument(storage, identity);
  ok(source.ok);
  ok(source.document.apply({ type: "set-game-title", title: "Recovered" }).ok);
  const recovered = await recoverMainDocument(storage, identity, source.document.serialize());
  ok(recovered.ok);
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  ok(source.document.apply({ type: "set-game-title", title: "Changed again" }).ok);
  disk = source.document.serialize();
  const newer = disk.slice();
  const saved = await recovered.document.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "conflict");
  equal(writes, 0);
  deepEqual(disk, newer);
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Recovered");
});

test("even identical disk and backup bytes need a recovery decision before save", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let writes = 0;
  const storage = {
    readProject: async () => ({ ok: true as const, value: original.slice() }),
    writeProject: async () => { writes += 1; return { ok: true as const, value: undefined }; },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  equal(recovered.document.getSnapshot().conflict?.externalTitle, asMainDocument(recovered.document).getSnapshot().gameTitle);
  const refused = await recovered.document.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "conflict");
  equal(writes, 0);
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
  ok((await recovered.document.save()).ok);
});

test("an unreadable disk version keeps recovery pending and cannot be accepted blindly", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let readable = false;
  let writes = 0;
  const storage = {
    readProject: async () => readable
      ? { ok: true as const, value: original.slice() }
      : { ok: false as const, error: { code: "io-error" as const, message: "unavailable" } },
    writeProject: async () => { writes += 1; return { ok: true as const, value: undefined }; },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  equal(recovered.document.getSnapshot().dirty, true);
  equal(recovered.document.undo().ok, false);
  equal((await resolveRecoveryConflict(recovered.document, "keep-local")).ok, false);
  const refused = await recovered.document.save();
  ok(!refused.ok);
  equal(refused.failure.kind, "conflict");
  equal(writes, 0);
  deepEqual(recovered.document.serialize(), original);
  readable = true;
  equal((await resolveRecoveryConflict(recovered.document, "keep-local")).ok, false);
  equal(recovered.document.getSnapshot().conflict?.externalTitle, asMainDocument(recovered.document).getSnapshot().gameTitle);
  ok((await resolveRecoveryConflict(recovered.document, "keep-local")).ok);
});

test("watcher checks cannot discard recovery after another writer matches a recovered edit", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  let disk: Uint8Array = original.slice();
  const storage = {
    readProject: async () => ({ ok: true as const, value: disk.slice() }),
    writeProject: async () => ({ ok: true as const, value: undefined }),
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "Same as disk" }).ok);
  disk = recovered.document.serialize();
  equal(await recovered.document.checkExternal(), "conflict");
  const external = await openMainDocument(storage, identity);
  ok(external.ok);
  ok(external.document.apply({ type: "set-game-title", title: "Changed again" }).ok);
  disk = external.document.serialize();
  equal(await recovered.document.checkExternal(), "conflict");
  equal(asMainDocument(recovered.document).getSnapshot().gameTitle, "Same as disk");
  equal(recovered.document.getSnapshot().conflict?.externalTitle, "Changed again");
});

test("recovered Save As to the same identity cannot bypass the conflict, while a copy can be saved", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  const writes: string[] = [];
  const storage = {
    readProject: async () => ({ ok: true as const, value: original.slice() }),
    writeProject: async (_project: string, path: string) => { writes.push(path); return { ok: true as const, value: undefined }; },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  const same = await recovered.document.saveAs(storage, createDocumentIdentity("file:///project", "main/EXAMPLE.gam"));
  ok(!same.ok);
  equal(same.failure.kind, "conflict");
  deepEqual(writes, []);
  ok((await recovered.document.saveAs(storage, createDocumentIdentity("file:///project", "Main/copy.gam"))).ok);
  deepEqual(writes, ["Main/copy.gam"]);
});

test("recovery can load identical disk bytes and discard later edits", async () => {
  const original = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor4.gam", import.meta.url)));
  const identity = createDocumentIdentity("file:///project", gamePath);
  const storage = {
    readProject: async () => ({ ok: true as const, value: original.slice() }),
    writeProject: async () => { throw new Error("reload must not write"); },
  };
  const recovered = await recoverMainDocument(storage, identity, original);
  ok(recovered.ok);
  ok(recovered.document.apply({ type: "set-game-title", title: "Later edit" }).ok);
  ok((await resolveRecoveryConflict(recovered.document, "reload")).ok);
  deepEqual(recovered.document.serialize(), original);
  equal(recovered.document.getSnapshot().dirty, false);
  equal(recovered.document.getSnapshot().conflict, null);
});

async function assertFailedMountedSave(doc: ViewDocument, element: HTMLElement): Promise<void> {
  const edited = await doc.apply({ type: "set-game-title", title: "Rejected save title" });
  ok(edited.ok);
  equal(doc.getSnapshot().dirty, true);
  let view: ReturnType<typeof mount> | undefined;
  await act(() => { view = mount(element, { document: doc, services: { document: { edited: () => undefined }, capabilities: new Set(["folderWrite"]) } }); });
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
