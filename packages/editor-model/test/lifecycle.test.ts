// The lifecycle edges the host conformance suite (tools/editor-vscode-test/test/host-conformance.test.ts) does not reach
// through a host's own actions: the model's change-on-disk rules, path resolution, and the workspace's guards.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity, createMainDocument, openMainDocument } from "../src/index.ts";
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
