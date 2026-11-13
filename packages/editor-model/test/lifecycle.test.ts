// The lifecycle edges the host conformance suite (tools/editor-vscode-test/test/host-conformance.test.ts) does not reach
// through a host's own actions: the model's change-on-disk rules, path resolution, and the workspace's guards.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createDocumentWorkspace, createMainDocument, openMainDocument } from "../src/index.ts";
import { resolveDocumentPath } from "../src/workspace.ts";
import { exampleMain, titleOf, withTitle } from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

async function open(bytes = exampleMain(9)) {
  const host = createMemoryPlatformServices({ files: { [PATH]: bytes } });
  const opened = await openMainDocument(host.fs, identity);
  ok(opened.ok);
  return { host, doc: opened.document };
}

test("a save reads the file first and writes nothing when another program changed it (ADR 0022 D3.5)", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Mine" });
  host.seed(PATH, withTitle(original, "Theirs"));
  const saved = await doc.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "conflict");
  equal(saved.failure.document, PATH);
  deepEqual(host.bytesOf(PATH), withTitle(original, "Theirs"), "the other version is untouched");
  equal(doc.getSnapshot().dirty, true, "the local work stays");
  deepEqual(doc.getSnapshot().conflict, {
    document: PATH,
    kind: "changed",
    externalTitle: "Theirs",
    message: `${PATH} was changed on disk by another program. Your version and the one on disk are both kept until you choose.`,
  });
  const second = await doc.save();
  ok(!second.ok);
  equal(second.failure.kind, "conflict", "a second save still writes nothing");
  deepEqual(host.bytesOf(PATH), withTitle(original, "Theirs"));

  ok(doc.resolveConflict("keep-local").ok);
  equal(doc.getSnapshot().conflict, null);
  ok((await doc.save()).ok, "keeping the local version writes it");
  equal(titleOf(host.bytesOf(PATH)!), "Mine");
  equal(doc.getSnapshot().dirty, false);
});

test("loading the version on disk replaces the content and starts a new history; a missing file cannot be loaded", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Mine" });
  const firstEdit = doc.getSnapshot().edits[0]!.editId;
  host.seed(PATH, withTitle(original, "Theirs"));
  equal(await doc.checkExternal(), "conflict");
  ok(doc.resolveConflict("reload").ok);
  equal(doc.getSnapshot().gameTitle, "Theirs");
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().canUndo, false, "a new history over the file on disk");
  equal(doc.undo(firstEdit).ok, false, "the old edit id is stale");
  equal(titleOf(host.bytesOf(PATH)!), "Theirs", "nothing was written");

  host.seed(PATH, withTitle(original, "Again"));
  equal(await doc.checkExternal(), "reloaded", "a clean document follows the file");
  equal(doc.getSnapshot().gameTitle, "Again");
  host.fs.delete(PATH);
  doc.apply({ type: "set-game-title", title: "Back" });
  equal(await doc.checkExternal(), "conflict");
  equal(doc.getSnapshot().conflict?.kind, "deleted");
  equal(doc.getSnapshot().conflict?.externalTitle, null);
  equal(doc.resolveConflict("reload").ok, false, "there is no version to load");
  ok(doc.resolveConflict("keep-local").ok, "keeping it means the next save creates the file again");
  ok((await doc.save()).ok);
  equal(titleOf(host.bytesOf(PATH)!), "Back");
});

test("revert returns to the saved revision and keeps the history before it, or reloads a changed file with a new history", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Saved" });
  ok((await doc.save()).ok);
  const savedEdit = doc.getSnapshot().edits[0]!.editId;
  doc.apply({ type: "set-game-title", title: "Later" });
  ok((await doc.revert()).ok);
  equal(doc.getSnapshot().gameTitle, "Saved");
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().canUndo, true, "the history before the save point is kept");
  equal(doc.getSnapshot().canRedo, false, "what came after it is dropped");
  ok(doc.undo(savedEdit).ok);
  equal(doc.getSnapshot().gameTitle, "Example Game");

  host.seed(PATH, withTitle(original, "Outside"));
  ok((await doc.revert()).ok, "the file changed: revert takes it");
  equal(doc.getSnapshot().gameTitle, "Outside");
  equal(doc.getSnapshot().canUndo, false);
  equal(doc.getSnapshot().dirty, false, "the file on disk is what the document holds");
});

test("checkExternal reports unknown after a failed write, and a file already holding this revision is not a conflict", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Written" });
  host.failWrites({ code: "io-error", message: "the disk went away" });
  ok(!(await doc.save()).ok);
  equal(await doc.checkExternal(), "unknown", "the failed write may have left anything");
  host.failWrites(null);
  ok((await doc.save()).ok, "a save after a failed one writes without a compare");

  const second = await open(original);
  second.doc.apply({ type: "set-game-title", title: "Same" });
  const bytes = second.doc.serialize();
  second.host.seed(PATH, bytes);
  ok((await second.doc.save()).ok);
  equal(second.doc.getSnapshot().dirty, false, "another editor wrote exactly this revision: nothing to write, and clean");
});

test("Save As writes the content to a new identity and leaves this document's identity, history and dirty state alone (D1.3)", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Copy me" });
  const target = createDocumentIdentity("memory-project", "Main/copy.gam");
  ok((await doc.saveAs(host.fs, target)).ok);
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Copy me");
  deepEqual(host.bytesOf(PATH), original, "the source file is unchanged");
  equal(doc.identity.key, identity.key, "the source keeps its identity");
  equal(doc.getSnapshot().dirty, true, "and its unsaved work");

  const readOnlyHost = createMemoryPlatformServices({ files: { [PATH]: original } });
  const text = createMainDocument({ readProject: async () => ({ ok: true, value: new Uint8Array() }), writeProject: async () => ({ ok: true, value: undefined }) }, identity, exampleMain(9));
  ok(text.ok);
  const copied = await text.document.saveAs(readOnlyHost.fs, createDocumentIdentity("memory-project", "Main/copy2.gam"));
  ok(copied.ok);
  deepEqual(text.document.serialize(), original, "a read-only document copies its file, never a conversion");
});

test("a path resolves to the spelling the project stores, and two entries that differ only in case are refused with both named", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/Example.GAM": exampleMain(9), "Prg/a.prg": new Uint8Array([1]) } });
  deepEqual(await resolveDocumentPath(host.fs, "main/example.gam"), { ok: true, path: "Main/Example.GAM", exists: true });
  deepEqual(await resolveDocumentPath(host.fs, "Prg/New.prg"), { ok: true, path: "Prg/New.prg", exists: false });
  deepEqual(await resolveDocumentPath(host.fs, "Missing/x.gam"), { ok: true, path: "Missing/x.gam", exists: false }, "a missing folder is a new path");
  // The in-memory double folds case like the engine's asset keys, so it cannot hold two names that differ only in case;
  // a real folder can, and this listing shows both.
  const twins = {
    list: async (path: string) => ({
      ok: true as const,
      value: path === "" ? [{ name: "Main", kind: "directory" as const }] : [{ name: "second.gam", kind: "file" as const }, { name: "SECOND.gam", kind: "file" as const }],
    }),
  };
  const twin = await resolveDocumentPath(twins, "Main/Second.gam");
  ok(!twin.ok && twin.kind === "case-conflict");
  deepEqual([...twin.paths], ["Main/SECOND.gam", "Main/second.gam"]);
});

test("a memory host's project switch fails a document's save without writing either project (ADR 0022 D1.1)", async () => {
  const a = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) } });
  const b = createMemoryPlatformServices({ project: { id: "b", name: "B" }, files: { [PATH]: exampleMain(9) } });
  const shared = { readProject: (projectId: string, path: string) => a.fs.readProject(projectId, path), writeProject: (projectId: string, path: string, bytes: Uint8Array) => b.fs.writeProject(projectId, path, bytes) };
  const opened = await openMainDocument(shared, identity);
  ok(opened.ok);
  opened.document.apply({ type: "set-game-title", title: "Nowhere" });
  const saved = await opened.document.save();
  ok(!saved.ok);
  equal(saved.failure.document, PATH);
  deepEqual(a.bytesOf(PATH), exampleMain(9));
  deepEqual(b.bytesOf(PATH), exampleMain(9));
});

test("revert refuses rather than discarding an edit accepted after the user chose to revert (ADR 0022 D3.6)", async () => {
  const { doc } = await open();
  doc.apply({ type: "set-game-title", title: "Saved" });
  ok((await doc.save()).ok);
  const head = doc.getSnapshot().edits.at(-1)?.editId ?? null;
  doc.apply({ type: "set-game-title", title: "Typed while the revert was pending" });
  const refused = await doc.revert(head);
  ok(!refused.ok);
  equal(refused.failure.kind, "changed");
  equal(doc.getSnapshot().gameTitle, "Typed while the revert was pending", "the work the user was not told about is kept");
  equal(doc.getSnapshot().dirty, true);
  const reverting = await doc.revert(doc.getSnapshot().edits.at(-1)?.editId ?? null);
  ok(reverting.ok, "with the current edit named, the revert goes ahead");
  equal(doc.getSnapshot().gameTitle, "Saved");
});

async function workspaceWithHeldWrite() {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  let started!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fs = {
    ...host.fs,
    async writeProject(projectId: string, path: string, bytes: Uint8Array) {
      started();
      await gate;
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: { fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  return { host, workspace, doc: opened.document, writing, release };
}

test("save then close keeps edits accepted during the write open and dirty (D3.3, D3.6)", async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Saved revision" }).ok);
  host.answerQuestions("save");
  const closing = workspace.close(doc);
  await writing;
  ok(doc.apply({ type: "set-game-title", title: "Later edit" }).ok);
  release();
  deepEqual(await closing, { closed: false, reason: "cancelled" });
  equal(titleOf(host.bytesOf(PATH)!), "Saved revision");
  equal(doc.getSnapshot().gameTitle, "Later edit");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(workspace.documents(), [doc]);
  const reopened = await workspace.open(PATH);
  ok(reopened.ok);
  equal(reopened.document, doc);
});

test("Save As retains the source when its write misses a later edit (D3.4)", async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Copied revision" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const saving = workspace.saveAs(doc);
  await writing;
  ok(doc.apply({ type: "set-game-title", title: "Later edit" }).ok);
  release();
  const result = await saving;
  ok(!result.ok);
  equal(result.reason, "failed");
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Copied revision");
  equal(doc.getSnapshot().gameTitle, "Later edit");
  equal(doc.getSnapshot().dirty, true);
  ok(workspace.documents().includes(doc));
  const reopened = await workspace.open(PATH);
  ok(reopened.ok);
  equal(reopened.document, doc);
  const destination = await workspace.open("Main/copy.gam");
  ok(destination.ok);
  equal(destination.document.getSnapshot().gameTitle, "Copied revision");
});

test("concurrent view closes cannot both bypass the last dirty view's confirmation (D3.7)", async () => {
  const { host, workspace, doc } = await workspaceWithHeldWrite();
  const first = workspace.attachView(doc);
  const second = workspace.attachView(doc);
  ok(doc.apply({ type: "set-game-title", title: "Still here" }).ok);
  host.answerQuestions("cancel");
  const results = await Promise.all([first.close(), second.close()]);
  deepEqual(results, [{ closed: true }, { closed: false, reason: "cancelled" }]);
  equal(host.questions.length, 1);
  deepEqual(workspace.documents(), [doc]);
  equal(doc.getSnapshot().gameTitle, "Still here");
  first.dispose();
  second.dispose();
});
