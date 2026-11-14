// The lifecycle edges the host conformance suite (tools/editor-vscode-test/test/host-conformance.test.ts) does not reach
// through a host's own actions: the model's change-on-disk rules, path resolution, and the workspace's guards.
import { deepEqual, equal, notEqual, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createDocumentWorkspace, createEditTracker, createMainDocument, createPendingEdits, openMainDocument } from "../src/index.ts";
import { resolveDocumentPath } from "../src/workspace.ts";
import { exampleMain, titleOf, withTitle } from "./fixtures.ts";

/** The game title of a document the workspace opened, which the workspace types by lifecycle only. */
function titleOfDocument(document: { getSnapshot(): unknown }): string {
  return (document.getSnapshot() as { readonly gameTitle: string }).gameTitle;
}

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

test("checkExternal compares the last known baseline after a failed write, and an identical revision is not a conflict", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  doc.apply({ type: "set-game-title", title: "Written" });
  host.failWrites({ code: "io-error", message: "the disk went away" });
  ok(!(await doc.save()).ok);
  equal(await doc.checkExternal(), "unchanged", "the disk still matches the baseline");
  host.failWrites(null);
  ok((await doc.save()).ok, "a save after a failed one compares before retrying");

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

/** A held-write test fails, rather than hangs, if a regression makes it wait on a write that is never released. */
const HELD = { timeout: 1_000 };

/** A workspace whose first write waits for `release`; later writes go straight through. */
async function workspaceWithHeldWrite() {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  let started!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = true;
  const fs = {
    ...host.fs,
    async writeProject(projectId: string, path: string, bytes: Uint8Array) {
      if (held) {
        held = false;
        started();
        await gate;
      }
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: { fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  return { host, workspace, doc: opened.document, writing, release };
}

test("save then close keeps edits accepted during the write open and dirty (D3.3, D3.6)", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Saved revision" }).ok);
  host.answerQuestions("save");
  const closing = workspace.close(doc);
  await writing;
  ok(doc.apply({ type: "set-game-title", title: "Later edit" }).ok);
  release();
  deepEqual(await closing, { closed: false, reason: "cancelled" });
  equal(titleOf(host.bytesOf(PATH)!), "Saved revision");
  equal(titleOfDocument(doc), "Later edit");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(workspace.documents(), [doc]);
  const reopened = await workspace.open(PATH);
  ok(reopened.ok);
  equal(reopened.document, doc);
});

test("Save As retains the source when its write misses a later edit (D3.4)", HELD, async () => {
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
  equal(titleOfDocument(doc), "Later edit");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(workspace.documents(), [doc], "the partially written copy is not silently registered");
  const reopened = await workspace.open(PATH);
  ok(reopened.ok);
  equal(reopened.document, doc);
  host.answerSavePaths("Main/copy.gam");
  host.answerQuestions("replace");
  const retried = await workspace.saveAs(doc);
  ok(retried.ok, "retrying the same destination is not blocked by an invisible open document");
  equal(titleOfDocument(retried.document), "Later edit");
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Later edit");
});

test("an edit while opening a written Save As copy does not register a hidden destination", HELD, async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  let started!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fs = {
    ...host.fs,
    async readProject(projectId: string, path: string) {
      if (path === "Main/copy.gam") { started(); await gate; }
      return host.fs.readProject(projectId, path);
    },
  };
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: { fs, dialogs: host.dialogs, capabilities: host.capabilities } });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-game-title", title: "Written" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const saving = workspace.saveAs(opened.document);
  await reading;
  ok(opened.document.apply({ type: "set-game-title", title: "Later" }).ok);
  release();
  const result = await saving;
  ok(!result.ok);
  equal(result.reason, "failed");
  deepEqual(workspace.documents(), [opened.document]);
  equal(titleOfDocument(opened.document), "Later");
  equal(opened.document.getSnapshot().dirty, true);
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Written");
});

test("a Save As destination is reserved against competing saves and opens until its write finishes", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Copy" }).ok);
  host.answerSavePaths("Main/copy.gam", "Main/copy.gam");
  const first = workspace.saveAs(doc);
  await writing;
  // Only the first write is held, so a competing Save As that got past the reservation would finish here and succeed.
  const second = await workspace.saveAs(doc);
  ok(!second.ok, "a second Save As to the reserved destination is refused");
  equal(second.reason, "failed");
  // An open that did not wait for the reservation would read the destination before the held write made it.
  const opening = workspace.open("Main/copy.gam");
  release();
  const saved = await first;
  ok(saved.ok);
  const opened = await opening;
  ok(opened.ok, "an open during the reservation waits for the copy");
  equal(opened.document, saved.document);
  equal(titleOfDocument(opened.document), "Copy");
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Copy");
});

test("Save As succeeds when a save of the same revision finishes during its write (#2222)", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Copied and saved" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const saving = workspace.saveAs(doc);
  await writing;
  ok((await doc.save()).ok, "the plain save of the same revision finishes while Save As is writing");
  equal(doc.getSnapshot().dirty, false);
  release();
  const result = await saving;
  ok(result.ok, "finishing a save is not an edit, so Save As still succeeds");
  equal(titleOfDocument(result.document), "Copied and saved");
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Copied and saved");
});

test("Save As keeps the source when an external change becomes a conflict during its write (#2222)", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const saving = workspace.saveAs(doc);
  await writing;
  host.seed(PATH, withTitle(exampleMain(9), "Theirs"));
  equal(await doc.checkExternal(), "conflict", "the change on disk now waits for the user's choice");
  equal(doc.getSnapshot().edits.length, 1, "the edits in force did not change");
  release();
  const result = await saving;
  ok(!result.ok, "a change that now waits for a choice is a different revision, so Save As does not close the source");
  equal(result.reason, "failed");
  deepEqual(workspace.documents(), [doc]);
  notEqual(doc.getSnapshot().conflict, null, "the waiting choice stays with the source");
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Mine", "the copy holds the revision it captured");
});

test("Save As keeps the source when an undo and a new edit during its write leave the same number of edits (#2222)", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  ok(doc.apply({ type: "set-game-title", title: "Copied" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const saving = workspace.saveAs(doc);
  await writing;
  ok(doc.undo().ok);
  ok(doc.apply({ type: "set-game-title", title: "Replaced" }).ok);
  equal(doc.getSnapshot().edits.length, 1, "as many edits in force as when the copy was taken, but a different latest one");
  release();
  const result = await saving;
  ok(!result.ok, "the copy does not hold the edit now in force");
  equal(result.reason, "failed");
  deepEqual(workspace.documents(), [doc]);
  equal(titleOfDocument(doc), "Replaced");
  equal(doc.getSnapshot().dirty, true);
  equal(titleOf(host.bytesOf("Main/copy.gam")!), "Copied");
});

test("a view attached while the last view's close is saving keeps the document open (D3.7)", HELD, async () => {
  const { host, workspace, doc, writing, release } = await workspaceWithHeldWrite();
  const closing = workspace.attachView(doc);
  ok(doc.apply({ type: "set-game-title", title: "Saved on close" }).ok);
  host.answerQuestions("save");
  const result = closing.close();
  await writing;
  const added = workspace.attachView(doc);
  release();
  deepEqual(await result, { closed: true }, "the closing view closes once its save is written");
  equal(titleOf(host.bytesOf(PATH)!), "Saved on close");
  deepEqual(workspace.documents(), [doc], "the view attached meanwhile still owns the document");
  ok(doc.apply({ type: "set-game-title", title: "Edited in the new view" }).ok);
  host.answerQuestions("cancel");
  deepEqual(await added.close(), { closed: false, reason: "cancelled" }, "its close is now the last one, so it asks");
  equal(titleOfDocument(doc), "Edited in the new view");
  closing.dispose();
  added.dispose();
});

test("Save As from one of two views opens the copy and keeps the source for the other view (D1.3, D3.7)", HELD, async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const doc = opened.document;
  const saving = workspace.attachView(doc);
  const other = workspace.attachView(doc);
  ok(doc.apply({ type: "set-game-title", title: "Shared then copied" }).ok);
  host.answerSavePaths("Main/copy.gam");
  const result = await workspace.saveAs(doc);
  ok(result.ok);
  equal(titleOfDocument(result.document), "Shared then copied");
  deepEqual(workspace.documents(), [doc, result.document], "the other view's source stays open beside the copy");
  saving.dispose();
  equal(doc.getSnapshot().dirty, true, "the source keeps its unsaved edit (D1.3)");
  host.answerQuestions("cancel");
  deepEqual(await other.close(), { closed: false, reason: "cancelled" }, "the remaining view's close still asks before losing it");
  deepEqual(workspace.documents(), [doc, result.document]);
  other.dispose();
});

test("concurrent view closes cannot both bypass the last dirty view's confirmation (D3.7)", HELD, async () => {
  const { host, workspace, doc } = await workspaceWithHeldWrite();
  const first = workspace.attachView(doc);
  const second = workspace.attachView(doc);
  ok(doc.apply({ type: "set-game-title", title: "Still here" }).ok);
  host.answerQuestions("cancel");
  const results = await Promise.all([first.close(), second.close()]);
  deepEqual(results, [{ closed: true }, { closed: false, reason: "cancelled" }]);
  equal(host.questions.length, 1);
  deepEqual(workspace.documents(), [doc]);
  equal(titleOfDocument(doc), "Still here");
  first.dispose();
  second.dispose();
});

test("a failed save followed by an external edit conflicts on retry without overwriting either version", async () => {
  const original = exampleMain(9);
  const { host, doc } = await open(original);
  ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
  host.failWrites({ code: "io-error", message: "write failed" });
  const failed = await doc.save();
  ok(!failed.ok);
  equal(failed.failure.kind, "write");
  const external = withTitle(original, "Theirs");
  host.seed(PATH, external);
  host.failWrites(null);

  const retry = await doc.save();
  ok(!retry.ok);
  equal(retry.failure.kind, "conflict");
  equal(doc.getSnapshot().conflict?.externalTitle, "Theirs");
  equal(doc.getSnapshot().gameTitle, "Mine");
  equal(doc.getSnapshot().dirty, true);
  deepEqual(host.bytesOf(PATH), external);
  ok(doc.resolveConflict("keep-local").ok);
  ok((await doc.save()).ok);
  equal(titleOf(host.bytesOf(PATH)!), "Mine");
});

test("a retry cannot write if its disk comparison cannot be read", async () => {
  const original = exampleMain(9);
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  let failRead = false;
  let writes = 0;
  const opened = await openMainDocument({
    readProject: (projectId, path) => failRead
      ? Promise.resolve({ ok: false, error: { code: "io-error", message: "read failed" } })
      : host.fs.readProject(projectId, path),
    writeProject: (projectId, path, bytes) => {
      writes += 1;
      return host.fs.writeProject(projectId, path, bytes);
    },
  }, identity);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
  host.failWrites({ code: "io-error", message: "write failed" });
  ok(!(await doc.save()).ok);
  host.failWrites(null);
  failRead = true;
  const retry = await doc.save();
  ok(!retry.ok);
  equal(retry.failure.kind, "write");
  equal(writes, 1);
  equal(doc.getSnapshot().dirty, true);
  deepEqual(host.bytesOf(PATH), original);
});

for (const checkBeforeRetry of [false, true]) {
  test(`a fully written but non-durable revision remains dirty${checkBeforeRetry ? " after checkExternal" : " on direct retry"}`, async () => {
    const original = exampleMain(9);
    const host = createMemoryPlatformServices({ files: { [PATH]: original } });
    let writes = 0;
    const opened = await openMainDocument({
      readProject: (projectId, path) => host.fs.readProject(projectId, path),
      writeProject: async (projectId, path, bytes) => {
        writes += 1;
        const written = await host.fs.writeProject(projectId, path, bytes);
        if (!written.ok) return written;
        if (writes <= 2) return { ok: false, error: { code: "io-error", message: "fsync failed" } };
        return written;
      },
    }, identity);
    ok(opened.ok);
    const doc = opened.document;
    ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
    const first = await doc.save();
    ok(!first.ok);
    equal(first.failure.kind, "write");
    deepEqual(host.bytesOf(PATH), doc.serialize(), "the failed host write nevertheless stored the entire revision");
    equal(doc.getSnapshot().dirty, true);

    if (checkBeforeRetry) {
      equal(await doc.checkExternal(), "unknown");
      equal(doc.getSnapshot().dirty, true, "reading the bytes does not prove durability");
      equal(doc.getSnapshot().conflict, null);
    }
    const retry = await doc.save();
    ok(!retry.ok, "an identical file cannot make a failed host write succeed");
    equal(retry.failure.kind, "write");
    equal(writes, 2, "retry actually writes");
    equal(doc.getSnapshot().dirty, true);

    ok((await doc.save()).ok, "only a successful host write report marks the revision saved");
    equal(writes, 3);
    equal(doc.getSnapshot().dirty, false);
    equal(doc.getSnapshot().saveError, null);
  });
}

test("revert to a failed write's bytes cannot certify that revision as durable", async () => {
  const original = exampleMain(9);
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  let writes = 0;
  const opened = await openMainDocument({
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      writes += 1;
      const written = await host.fs.writeProject(projectId, path, bytes);
      if (writes === 1 && written.ok) return { ok: false, error: { code: "io-error", message: "close failed" } };
      return written;
    },
  }, identity);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Mine" }).ok);
  ok(!(await doc.save()).ok);
  ok((await doc.revert()).ok);
  equal(doc.getSnapshot().gameTitle, "Mine");
  equal(doc.getSnapshot().dirty, true, "reloading bytes does not prove the failed write was durable");
  ok((await doc.save()).ok);
  equal(writes, 2);
  equal(doc.getSnapshot().dirty, false);
});

for (const choice of ["keep-local", "reload", "revert"] as const) {
  for (const checkFirst of [false, true]) {
    test(`an old failed write cannot bypass ${checkFirst ? "external check" : "save"} after ${choice} accepts a new baseline`, async () => {
      const original = exampleMain(9);
      const host = createMemoryPlatformServices({ files: { [PATH]: original } });
      let writes = 0;
      const opened = await openMainDocument({
        readProject: (projectId, path) => host.fs.readProject(projectId, path),
        writeProject: async (projectId, path, bytes) => {
          writes += 1;
          const written = await host.fs.writeProject(projectId, path, bytes);
          if (writes === 1 && written.ok) return { ok: false, error: { code: "io-error", message: "fsync failed" } };
          return written;
        },
      }, identity);
      ok(opened.ok);
      const doc = opened.document;
      ok(doc.apply({ type: "set-game-title", title: "A" }).ok);
      const oldFailedBytes = doc.serialize();
      ok(!(await doc.save()).ok);
      deepEqual(host.bytesOf(PATH), oldFailedBytes);

      host.seed(PATH, withTitle(original, "B"));
      equal(await doc.checkExternal(), "conflict");
      if (choice === "revert") {
        ok((await doc.revert()).ok);
      } else {
        ok(doc.resolveConflict(choice).ok);
      }
      ok(doc.apply({ type: "set-game-title", title: "C" }).ok);
      host.seed(PATH, oldFailedBytes);

      if (checkFirst) {
        equal(await doc.checkExternal(), "conflict", "the old failed bytes are a new external change");
        equal(doc.getSnapshot().conflict?.externalTitle, "A");
      }
      const retry = await doc.save();
      ok(!retry.ok);
      equal(retry.failure.kind, "conflict");
      equal(writes, 1, "the host is never asked to replace the external bytes");
      deepEqual(host.bytesOf(PATH), oldFailedBytes);
      equal(doc.getSnapshot().gameTitle, "C");
      equal(doc.getSnapshot().dirty, true);
    });
  }
}

test("revert refuses edits accepted during its disk read, even when the file changed", async () => {
  for (const changedDisk of [false, true]) {
    const original = exampleMain(9);
    const host = createMemoryPlatformServices({ files: { [PATH]: original } });
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reading = new Promise<void>((resolve) => { started = resolve; });
    let hold = false;
    const storage = {
      readProject: async (projectId: string, path: string) => {
        if (hold) {
          started();
          await held;
        }
        return host.fs.readProject(projectId, path);
      },
      writeProject: host.fs.writeProject.bind(host.fs),
    };
    const opened = await openMainDocument(storage, identity);
    ok(opened.ok);
    const doc = opened.document;
    ok(doc.apply({ type: "set-game-title", title: "Before" }).ok);
    const head = doc.getSnapshot().edits.at(-1)!.editId;
    if (changedDisk) host.seed(PATH, withTitle(original, "Outside"));
    hold = true;
    const reverting = doc.revert(head);
    await reading;
    ok(doc.apply({ type: "set-game-title", title: "During read" }).ok);
    release();
    const result = await reverting;
    ok(!result.ok);
    equal(result.failure.kind, "changed");
    equal(doc.getSnapshot().gameTitle, "During read");
    equal(doc.getSnapshot().dirty, true);
    equal(doc.getSnapshot().edits.length, 2);
    ok(doc.undo().ok);
    equal(doc.getSnapshot().gameTitle, "Before");
  }
});

test("revert refuses an edit made and undone during its disk read", async () => {
  const original = exampleMain(9);
  const host = createMemoryPlatformServices({ files: { [PATH]: original } });
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const reading = new Promise<void>((resolve) => { started = resolve; });
  let hold = false;
  const opened = await openMainDocument({
    readProject: async (projectId, path) => {
      if (hold) {
        started();
        await held;
      }
      return host.fs.readProject(projectId, path);
    },
    writeProject: host.fs.writeProject.bind(host.fs),
  }, identity);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Before" }).ok);
  hold = true;
  const reverting = doc.revert();
  await reading;
  ok(doc.apply({ type: "set-game-title", title: "Later" }).ok);
  ok(doc.undo().ok);
  release();
  const result = await reverting;
  ok(!result.ok);
  equal(result.failure.kind, "changed");
  equal(doc.getSnapshot().gameTitle, "Before");
  equal(doc.getSnapshot().canRedo, true);
  ok(doc.redo().ok);
  equal(doc.getSnapshot().gameTitle, "Later");
});

/** A view that accepted a title edit from the user but can give it to the document only when `release` is called (#2613). */
function queuedTitleEdit(doc: { apply(command: { type: "set-game-title"; title: string }): unknown }, title: string) {
  const tracker = createEditTracker();
  const done = tracker.begin();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  void gate.then(() => {
    doc.apply({ type: "set-game-title", title });
    done();
  });
  return { tracker, release };
}

test("pending edits settle only once every registered view is idle, including work submitted while waiting (#2613)", async () => {
  const pending = createPendingEdits();
  const first = createEditTracker();
  const second = createEditTracker();
  pending.register(first);
  const unregister = pending.register(second);
  equal(pending.busy(), false);
  const endFirst = first.begin();
  equal(pending.busy(), true);
  let settled = false;
  const waiting = pending.settle().then(() => { settled = true; });
  await Promise.resolve();
  equal(settled, false);
  // Work that arrives during the wait, in the other view, is waited for too.
  const endSecond = second.begin();
  endFirst();
  await Promise.resolve();
  await Promise.resolve();
  equal(settled, false, "the second view's later work is still pending");
  endSecond();
  await waiting;
  equal(settled, true);
  // An unregistered view is no longer waited for.
  unregister();
  second.begin();
  equal(pending.busy(), false);
  await pending.settle();
});

test("Save All writes an edit a view still holds, instead of finding its document clean (#2613)", HELD, async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "First" }).ok);
  const held = queuedTitleEdit(doc as never, "Second, queued behind an acknowledgement");
  workspace.pendingEdits(doc).register(held.tracker);
  const saving = workspace.saveAll();
  await Promise.resolve();
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain(9)), "nothing is written while an edit is still held");
  held.release();
  const results = await saving;
  deepEqual(results.map((entry) => [entry.document, entry.result.ok]), [[PATH, true]]);
  equal(titleOf(host.bytesOf(PATH)!), "Second, queued behind an acknowledgement");
  equal(doc.getSnapshot().dirty, false);
});

test("Save All writes a document whose only edit is still held", HELD, async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const held = queuedTitleEdit(opened.document as never, "Only edit");
  workspace.pendingEdits(opened.document).register(held.tracker);
  equal(opened.document.getSnapshot().dirty, false, "the document looks clean until the edit reaches it");
  const saving = workspace.saveAll();
  held.release();
  deepEqual((await saving).map((entry) => entry.result.ok), [true]);
  equal(titleOf(host.bytesOf(PATH)!), "Only edit");
});

test("closing a view waits for its held edit, then asks about it and saves it (#2613)", HELD, async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain(9) }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const doc = opened.document;
  const lease = workspace.attachView(doc);
  const held = queuedTitleEdit(doc as never, "Held at close");
  workspace.pendingEdits(doc).register(held.tracker);
  host.answerQuestions("save");
  const closing = lease.close();
  await Promise.resolve();
  equal(host.questions.length, 0, "the document is not judged clean or dirty before the held edit reaches it");
  held.release();
  deepEqual(await closing, { closed: true });
  equal(host.questions.length, 1, "the user was asked, because the held edit made the document dirty");
  equal(titleOf(host.bytesOf(PATH)!), "Held at close");
  lease.dispose();
});

test("revert waits for a held edit and discards it with the rest (#2613)", HELD, async () => {
  const original = exampleMain(9);
  const host = createMemoryPlatformServices({ files: { [PATH]: original }, capabilities: [] });
  const workspace = createDocumentWorkspace({ projectId: identity.projectId, services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Applied" }).ok);
  const held = queuedTitleEdit(doc as never, "Held");
  workspace.pendingEdits(doc).register(held.tracker);
  host.answerQuestions("revert");
  const reverting = workspace.revert(doc);
  held.release();
  ok((await reverting).ok);
  equal(titleOfDocument(doc), titleOf(original));
  equal(doc.getSnapshot().dirty, false, "the held edit did not land after the revert");
});
