// The `.gam` document of ADR 0022 D2 and D3: bytes plus a serialisable command stack over the reader and writer of
// `core`, saved through platform-services. Every case runs on real `.gam` bytes against the in-memory double.
import { test } from "node:test";
import { deepEqual, equal, match, notEqual, ok } from "node:assert/strict";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createDocumentIdentity,
  createMainDocument,
  openMainDocument,
  type DocumentStorage,
  type MainDocument,
} from "../src/index.ts";
import { firstDifference } from "../src/main-document.ts";
import {
  concat,
  cp1252Bytes,
  exampleMain,
  exampleTextMain,
  exampleTk1Main,
  titleOf,
  trailingBlocks,
  withTitle,
  withTitleBytes,
} from "./fixtures.ts";

const PATH = "Main/example.gam";
const identity = createDocumentIdentity("memory-project", PATH);

function hostWith(bytes: Uint8Array): MemoryPlatformServices {
  return createMemoryPlatformServices({ files: { [PATH]: bytes } });
}

async function open(host: MemoryPlatformServices): Promise<MainDocument> {
  const opened = await openMainDocument(host.fs, identity);
  if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened.error)}`);
  return opened.document;
}

function stored(host: MemoryPlatformServices): Uint8Array {
  const bytes = host.bytesOf(PATH);
  if (bytes === undefined) throw new Error("the file is gone");
  return bytes;
}

for (const minor of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  test(`minor ${minor}: edit the title, save and reopen; every other byte and the minor are kept`, async () => {
    const original = exampleMain(minor);
    const host = hostWith(original);
    const doc = await open(host);
    equal(doc.getSnapshot().readOnly, null, "the writer re-emits this minor, so the document is read-write");
    equal(doc.getSnapshot().minor, minor);
    equal(doc.getSnapshot().gameTitle, "Example Game");

    const edit = doc.apply({ type: "set-game-title", title: "Renamed Quest" });
    ok(edit.ok);
    const saved = await doc.save();
    ok(saved.ok);

    // The oracle splices the new title into the original bytes by hand; the document must have written exactly that.
    deepEqual(stored(host), withTitle(original, "Renamed Quest"));
    equal(titleOf(stored(host)), "Renamed Quest");

    const reopened = await open(host);
    equal(reopened.getSnapshot().gameTitle, "Renamed Quest");
    equal(reopened.getSnapshot().minor, minor);
    equal(reopened.getSnapshot().dirty, false);
  });
}

test("the title edited back to its first value writes the original bytes exactly", async () => {
  const original = exampleMain(9);
  const host = hostWith(original);
  const doc = await open(host);
  doc.apply({ type: "set-game-title", title: "Other" });
  await doc.save();
  doc.apply({ type: "set-game-title", title: "Example Game" });
  await doc.save();
  deepEqual(stored(host), original);
});

test("unknown trailing data survives: package list, audio block and opaque residue are written back untouched", async () => {
  const original = concat(exampleMain(9), trailingBlocks());
  const host = hostWith(original);
  const doc = await open(host);
  equal(doc.getSnapshot().readOnly, null);
  doc.apply({ type: "set-game-title", title: "A much longer title than the one the file had" });
  ok((await doc.save()).ok);
  deepEqual(stored(host), withTitle(original, "A much longer title than the one the file had"));
  const tail = stored(host).subarray(stored(host).length - trailingBlocks().length);
  deepEqual(tail, trailingBlocks(), "the blocks after the last documented row are byte for byte what they were");
});

test("opaque residue alone is kept at every minor that can carry it", async () => {
  for (const minor of [0, 3, 6, 9]) {
    const original = concat(exampleMain(minor), Uint8Array.from([1, 2, 3, 4, 5]));
    const host = hostWith(original);
    const doc = await open(host);
    doc.apply({ type: "set-game-title", title: "X" });
    ok((await doc.save()).ok);
    deepEqual(stored(host), withTitle(original, "X"), `minor ${minor}`);
  }
});

test("saving a document nobody edited writes nothing", async () => {
  const host = hostWith(exampleMain(9));
  let writes = 0;
  const counting: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: (projectId, path, bytes) => {
      writes += 1;
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(counting, identity);
  ok(opened.ok);
  ok((await opened.document.save()).ok);
  equal(writes, 0);
});

test("dirty follows the applied commands, not the number of edits (ADR 0022 D3.2)", async () => {
  const host = hostWith(exampleMain(9));
  const doc = await open(host);
  const dirty = () => doc.getSnapshot().dirty;
  equal(dirty(), false, "a fresh document is clean");
  doc.apply({ type: "set-game-title", title: "One" });
  equal(dirty(), true);
  doc.undo();
  equal(dirty(), false, "undone back to what is on disk");
  doc.redo();
  equal(dirty(), true);
  await doc.save();
  equal(dirty(), false, "saved");
  doc.undo();
  equal(dirty(), true, "undoing a saved edit differs from the file");
  doc.redo();
  equal(dirty(), false, "redone to the saved state");
  // Undo, then a different edit: the saved state can never be reached again, so the document stays dirty.
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Two" });
  equal(dirty(), true);
  doc.undo();
  equal(dirty(), true, "back at zero edits is not the saved state either: the file holds the first edit");
});

test("undo and redo walk the stack; an edit id from the host must name the edit it undoes (AD-19)", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  const first = doc.apply({ type: "set-game-title", title: "One" });
  const second = doc.apply({ type: "set-game-title", title: "Two" });
  ok(first.ok && second.ok);
  notEqual(first.editId, second.editId);
  equal(doc.getSnapshot().canUndo, true);
  equal(doc.getSnapshot().canRedo, false);

  deepEqual(doc.undo(first.editId), { ok: false, reason: "stale-edit" }, "only the latest edit can be undone by id");
  equal(doc.getSnapshot().gameTitle, "Two");
  deepEqual(doc.undo(second.editId), { ok: true, editId: second.editId });
  equal(doc.getSnapshot().gameTitle, "One");
  equal(doc.getSnapshot().canRedo, true);
  deepEqual(doc.redo(first.editId), { ok: false, reason: "stale-edit" });
  deepEqual(doc.redo(second.editId), { ok: true, editId: second.editId });
  equal(doc.getSnapshot().gameTitle, "Two");
  doc.undo();
  doc.undo();
  equal(doc.getSnapshot().gameTitle, "Example Game");
  deepEqual(doc.undo(), { ok: false, reason: "nothing-to-undo" });
  doc.redo();
  doc.redo();
  deepEqual(doc.redo(), { ok: false, reason: "nothing-to-redo" });
});

test("a new edit after an undo discards what could have been redone", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  doc.apply({ type: "set-game-title", title: "One" });
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Other" });
  equal(doc.getSnapshot().canRedo, false);
  deepEqual(doc.redo(), { ok: false, reason: "nothing-to-redo" });
  equal(doc.getSnapshot().gameTitle, "Other");
});

test("the command stack is plain data: stored, parsed and replayed on a fresh document it gives the same bytes", async () => {
  const original = exampleMain(9);
  const hostA = hostWith(original);
  const docA = await open(hostA);
  docA.apply({ type: "set-game-title", title: "First" });
  docA.apply({ type: "set-game-title", title: "Second" });
  await docA.save();

  const edits = JSON.parse(JSON.stringify(docA.getSnapshot().edits)) as ReturnType<MainDocument["getSnapshot"]>["edits"];
  const hostB = hostWith(original);
  const docB = await open(hostB);
  for (const edit of edits) ok(docB.apply(edit.command).ok);
  await docB.save();
  deepEqual(stored(hostB), stored(hostA));
});

test("a refused command changes nothing: no new snapshot, no notification, no edit id spent", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  let notified = 0;
  doc.subscribe(() => {
    notified += 1;
  });
  const before = doc.getSnapshot();
  for (const title of ["日本語", "has\u0000nul", "emoji \u{1f600}"]) {
    const result = doc.apply({ type: "set-game-title", title });
    equal(result.ok, false, title);
    if (!result.ok) {
      equal(result.rejection.reason, "invalid");
      ok(result.rejection.message.length > 0);
    }
  }
  equal(doc.getSnapshot(), before, "the same snapshot object: nothing changed");
  equal(notified, 0);
  const accepted = doc.apply({ type: "set-game-title", title: "Fine" });
  ok(accepted.ok);
  equal(accepted.editId, "edit-1", "refused commands did not take an id");
});

test("a Windows-1252 title is stored as its code-page bytes: the 0x80-0x9F block differs from Latin-1", async () => {
  const host = hostWith(exampleMain(9));
  const doc = await open(host);
  // Every character here sits in 0x80-0x9F in Windows-1252 (euro sign, curly quotes, dashes, ellipsis, trade mark), where
  // Latin-1 has control characters, plus two that Latin-1 and Windows-1252 share (é, ñ). The oracle is a hand-written byte table.
  const title = "\u20ac5 \u201cquoted\u201d \u2018x\u2019 \u2013 \u2026 \u2122 \u00e9\u00f1";
  const expected = [0x80, 0x35, 0x20, 0x93, 0x71, 0x75, 0x6f, 0x74, 0x65, 0x64, 0x94, 0x20, 0x91, 0x78, 0x92, 0x20, 0x96, 0x20, 0x85, 0x20, 0x99, 0x20, 0xe9, 0xf1];
  deepEqual([...cp1252Bytes(title)], expected, "the oracle itself");
  ok(doc.apply({ type: "set-game-title", title }).ok);
  ok((await doc.save()).ok);
  deepEqual(stored(host), withTitleBytes(exampleMain(9), Uint8Array.from(expected)));
  const reopened = await open(host);
  equal(reopened.getSnapshot().gameTitle, title, "and read back as the same text");
});

test("a character Windows-1252 cannot store is refused, and the five undefined bytes keep their own code point (README code-page round trip)", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  // U+0080 is a Latin-1 control character; Windows-1252 puts the euro sign at byte 0x80, so U+0080 has no byte.
  const refused = doc.apply({ type: "set-game-title", title: "a\u0080b" });
  ok(!refused.ok);
  equal(refused.rejection.reason, "invalid");
  match(refused.rejection.message, /U\+0080/);
  // U+0081 is one of the five bytes Windows-1252 leaves undefined; the repository's rule is that it is stored as byte 0x81.
  const host = hostWith(exampleMain(9));
  const second = await open(host);
  ok(second.apply({ type: "set-game-title", title: "a\u0081b" }).ok);
  ok((await second.save()).ok);
  deepEqual(stored(host), withTitleBytes(exampleMain(9), Uint8Array.from([0x61, 0x81, 0x62])));
});

test("a failed save keeps the model dirty, keeps every edit, names the document and can be retried (ADR 0022 D3.3)", async () => {
  const original = exampleMain(9);
  const host = hostWith(original);
  const doc = await open(host);
  doc.apply({ type: "set-game-title", title: "Unsaved" });
  host.failWrites({ code: "permission-denied", message: "the folder is read-only" });

  const result = await doc.save();
  ok(!result.ok);
  equal(result.failure.kind, "write");
  equal(result.failure.code, "permission-denied");
  equal(result.failure.document, PATH);
  ok(result.failure.message.includes(PATH), result.failure.message);
  ok(result.failure.message.includes("the folder is read-only"), result.failure.message);

  const snapshot = doc.getSnapshot();
  equal(snapshot.dirty, true, "not marked clean");
  equal(snapshot.gameTitle, "Unsaved", "the edit is still in the model");
  equal(snapshot.saving, false);
  deepEqual(snapshot.saveError, result.failure, "the error is exposed on the snapshot");
  equal(snapshot.canUndo, true, "the undo stack is intact");
  deepEqual(stored(host), original, "the file on disk was not touched");

  host.failWrites(null);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().saveError, null, "a later successful save clears the error");
  deepEqual(stored(host), withTitle(original, "Unsaved"));
});

test("an edit made while a save is in flight stays dirty and is not lost", async () => {
  const host = hostWith(exampleMain(9));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      await gate;
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(slow, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "First" });
  const saving = doc.save();
  equal(doc.getSnapshot().saving, true);
  doc.apply({ type: "set-game-title", title: "Second" });
  release();
  ok((await saving).ok);

  equal(titleOf(stored(host)), "First", "the revision that was captured is the one written");
  equal(doc.getSnapshot().gameTitle, "Second");
  equal(doc.getSnapshot().dirty, true, "the later edit is not marked saved by an earlier save");
  ok((await doc.save()).ok);
  equal(titleOf(stored(host)), "Second");
  equal(doc.getSnapshot().dirty, false);
});

test("an undo and a different edit during a save leave the written revision out of the history: still dirty", async () => {
  const host = hostWith(exampleMain(9));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      await gate;
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(slow, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "Written" });
  const saving = doc.save();
  doc.undo();
  doc.apply({ type: "set-game-title", title: "Different" });
  release();
  ok((await saving).ok);
  equal(titleOf(stored(host)), "Written");
  equal(doc.getSnapshot().gameTitle, "Different");
  equal(doc.getSnapshot().dirty, true);
});

test("saves run one after another: the second write does not start until the first has finished", async () => {
  const host = hostWith(exampleMain(9));
  const started: string[] = [];
  const finished: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const logging: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      const title = titleOf(bytes);
      started.push(title);
      // The first write is the slow one: it finishes after the second would have, if the second were allowed to start.
      if (title === "A") await gate;
      const result = await host.fs.writeProject(projectId, path, bytes);
      finished.push(title);
      return result;
    },
  };
  const opened = await openMainDocument(logging, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "A" });
  const first = doc.save();
  doc.apply({ type: "set-game-title", title: "B" });
  const second = doc.save();
  await new Promise((resolve) => setTimeout(resolve, 0));
  deepEqual(started, ["A"], "the second write waits for the first");
  release();
  await Promise.all([first, second]);
  deepEqual(started, ["A", "B"]);
  deepEqual(finished, ["A", "B"], "the later revision is the one left on disk");
  equal(titleOf(stored(host)), "B");
  equal(doc.getSnapshot().dirty, false);
});

test("a main file the writer cannot reproduce opens read-only with the reason; it is never offered read-write (ADR 0022 D2.1)", async () => {
  const text = exampleTextMain();
  const host = hostWith(text);
  const doc = await open(host);
  const snapshot = doc.getSnapshot();
  ok(snapshot.readOnly !== null, "a Toolkit 2 text main file has no same-version writer");
  equal(snapshot.readOnly.code, "no-same-version-writer");
  // The reason names the text form itself, not whatever the binary writer happened to trip over (a reserved run the text
  // reader leaves empty) and not a byte offset from a comparison that is never made.
  match(snapshot.readOnly.message, /Toolkit 2 text main file/);
  match(snapshot.readOnly.message, /no writer/);
  ok(!/reserved run|byte\(s\)|offset/.test(snapshot.readOnly.message), snapshot.readOnly.message);
  equal(snapshot.gameTitle, "Example Game", "it can still be viewed");
  equal(snapshot.canUndo, false);
  equal(snapshot.canRedo, false);

  const applied = doc.apply({ type: "set-game-title", title: "Nope" });
  ok(!applied.ok);
  equal(applied.rejection.reason, "read-only");
  deepEqual(doc.undo(), { ok: false, reason: "read-only" });
  deepEqual(doc.redo(), { ok: false, reason: "read-only" });
  const saved = await doc.save();
  ok(!saved.ok);
  equal(saved.failure.kind, "read-only");
  ok(saved.failure.message.includes(PATH));
  equal(doc.getSnapshot().dirty, false);
  deepEqual(stored(host), text, "nothing was written");
});

test("a binary main file the writer would change opens read-only too, naming the first byte that would differ", async () => {
  // One byte of a length field zeroed in the minor 9 example: the reader still accepts the file and keeps the tail as
  // residue, but the writer derives its list bounds from the lists and would write other bytes. Saving it would alter
  // the file, so it is not offered read-write (ADR 0022 D2.1; AD-18).
  const odd = exampleMain(9);
  odd[1820] = 0;
  const host = hostWith(odd);
  const doc = await open(host);
  const reason = doc.getSnapshot().readOnly;
  ok(reason !== null);
  equal(reason.code, "no-same-version-writer");
  match(reason.message, /minor 9/);
  match(reason.message, /offset \d+/);
  const applied = doc.apply({ type: "set-game-title", title: "Nope" });
  ok(!applied.ok);
  equal(applied.rejection.reason, "read-only");
  deepEqual(stored(host), odd);
});

test("open fails whole, with the reason, for a file the reader refuses or the host cannot read", async () => {
  const tk1 = await openMainDocument(hostWith(exampleTk1Main()).fs, identity);
  ok(!tk1.ok);
  equal(tk1.error.kind, "format");
  equal(tk1.error.document, PATH);
  if (tk1.error.kind === "format") {
    equal(tk1.error.error.offset, 0);
    ok(tk1.error.error.message.length > 0);
  }

  const future = exampleMain(9);
  future[0x10] = 10;
  const refused = await openMainDocument(hostWith(future).fs, identity);
  ok(!refused.ok);
  equal(refused.error.kind, "format");

  const missing = await openMainDocument(createMemoryPlatformServices().fs, identity);
  ok(!missing.ok);
  equal(missing.error.kind, "read");
  if (missing.error.kind === "read") equal(missing.error.error.code, "not-found");
});

test("getSnapshot is stable between changes and subscribe delivers each change until it is removed", async () => {
  const doc = await open(hostWith(exampleMain(9)));
  equal(doc.getSnapshot(), doc.getSnapshot());
  let calls = 0;
  const stop = doc.subscribe(() => {
    calls += 1;
  });
  const first = doc.getSnapshot();
  doc.apply({ type: "set-game-title", title: "One" });
  equal(calls, 1);
  notEqual(doc.getSnapshot(), first);
  doc.undo();
  doc.redo();
  equal(calls, 3);
  stop();
  doc.apply({ type: "set-game-title", title: "Two" });
  equal(calls, 3, "a removed listener hears nothing");
  stop();
});

test("identity: the handle and the ASCII-folded, slash-normalised path; Unicode case is not folded (ADR 0022 D1)", () => {
  const a = createDocumentIdentity("p", "Main/Example.gam");
  const b = createDocumentIdentity("p", "main\\EXAMPLE.GAM");
  equal(a.key, b.key, "a path that folds to an existing key names that document");
  equal(b.path, "main/EXAMPLE.GAM", "the path keeps its case and uses /");
  notEqual(a.key, createDocumentIdentity("q", "Main/Example.gam").key, "another project handle is another document");
  notEqual(
    createDocumentIdentity("p", "main/\u212Aey.gam").key,
    createDocumentIdentity("p", "main/key.gam").key,
    "U+212A KELVIN SIGN is not the letter k",
  );
  // The handle and the path cannot be re-split into one another.
  notEqual(createDocumentIdentity("a:1", "b").key, createDocumentIdentity("a", "1:b").key);
});

test("a document can be made over bytes already in hand", () => {
  const storage = createMemoryPlatformServices().fs;
  const made = createMainDocument(storage, identity, exampleMain(9));
  ok(made.ok);
  equal(made.document.getSnapshot().gameTitle, "Example Game");
  const bad = createMainDocument(storage, identity, new Uint8Array(0));
  ok(!bad.ok);
});

test("firstDifference: the first differing byte, or the length of the shorter one when one is a prefix of the other", () => {
  const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
  equal(firstDifference(bytes(1, 2, 3), bytes(1, 2, 3)), null);
  equal(firstDifference(bytes(), bytes()), null);
  equal(firstDifference(bytes(1, 2, 3), bytes(1, 9, 3)), 1);
  equal(firstDifference(bytes(1, 2), bytes(1, 2, 3)), 2, "the writer's bytes end first");
  equal(firstDifference(bytes(1, 2, 3), bytes(1, 2)), 2, "the file's bytes end first");
  equal(firstDifference(bytes(), bytes(7)), 0);
});

test("a failed write may leave the file in an unknown state: undoing back to the saved state still needs a real write (ADR 0022 D3.3)", async () => {
  const original = exampleMain(9);
  const host = hostWith(original);
  let writes = 0;
  // A host whose failed write has already truncated the file, which `fs.write` is allowed to do (platform-services fs.ts).
  const truncating: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      writes += 1;
      if (writes === 1) {
        host.seed(path, new Uint8Array(0));
        return { ok: false, error: { code: "io-error", message: "the disk went away" } };
      }
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(truncating, identity);
  ok(opened.ok);
  const doc = opened.document;
  ok(doc.apply({ type: "set-game-title", title: "Edited" }).ok);
  ok(!(await doc.save()).ok);
  deepEqual(stored(host), new Uint8Array(0), "the failed write left the file truncated");

  ok(doc.undo().ok);
  equal(doc.getSnapshot().gameTitle, "Example Game");
  equal(doc.getSnapshot().dirty, true, "back at the opened state, but the file no longer holds it");
  ok((await doc.save()).ok);
  equal(writes, 2, "the save really wrote");
  deepEqual(stored(host), original, "and put the document back on disk");
  equal(doc.getSnapshot().dirty, false);
  equal(doc.getSnapshot().saveError, null);
});

test("a write that throws or rejects is a failed save that names the document, and the next save still writes (ADR 0022 D3.3)", async () => {
  for (const how of ["throws", "rejects"] as const) {
    const host = hostWith(exampleMain(9));
    let calls = 0;
    const flaky: DocumentStorage = {
      readProject: (projectId, path) => host.fs.readProject(projectId, path),
      writeProject: (projectId, path, bytes) => {
        calls += 1;
        if (calls === 1) {
          if (how === "throws") throw new Error("the host blew up");
          return Promise.reject(new Error("the host blew up"));
        }
        return host.fs.writeProject(projectId, path, bytes);
      },
    };
    const opened = await openMainDocument(flaky, identity);
    ok(opened.ok);
    const doc = opened.document;
    doc.apply({ type: "set-game-title", title: "Once" });
    const first = await doc.save();
    ok(!first.ok, how);
    equal(first.failure.kind, "write");
    equal(first.failure.code, null, "the host gave no error code");
    equal(first.failure.document, PATH);
    ok(first.failure.message.includes(PATH) && first.failure.message.includes("the host blew up"), first.failure.message);
    deepEqual(doc.getSnapshot().saveError, first.failure, "the first failure is on the snapshot, not lost");
    equal(doc.getSnapshot().saving, false, `${how}: saving does not stay true, so Save is not disabled for good`);
    equal(doc.getSnapshot().dirty, true);

    const second = await doc.save();
    ok(second.ok, `${how}: the queue is still alive`);
    equal(calls, 2, "the later save reached the host");
    equal(titleOf(stored(host)), "Once");
    equal(doc.getSnapshot().saveError, null);
    equal(doc.getSnapshot().dirty, false);
  }
});

test("a subscriber that throws does not break a change, a save or the other subscribers", async () => {
  const host = hostWith(exampleMain(9));
  const doc = await open(host);
  let heard = 0;
  doc.subscribe(() => {
    throw new Error("a broken view");
  });
  doc.subscribe(() => {
    heard += 1;
  });
  const applied = doc.apply({ type: "set-game-title", title: "Loud" });
  ok(applied.ok, "apply reports its own outcome, not the listener's");
  equal(heard, 1);
  const saved = await doc.save();
  ok(saved.ok, "the save is done and reports it");
  equal(doc.getSnapshot().saving, false);
  equal(doc.getSnapshot().dirty, false);
  ok(heard >= 3, `the other subscriber heard the save start and finish (${heard})`);
  doc.apply({ type: "set-game-title", title: "Louder" });
  const again = await doc.save();
  ok(again.ok, "later saves still write");
  equal(titleOf(stored(host)), "Louder");
});

test("a failure is shown only until a later save starts, and a successful save clears it (the snapshot comment, ADR 0022 D3.3)", async () => {
  const host = hostWith(exampleMain(9));
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = false;
  const storage: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      if (hold) await gate;
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(storage, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "T" });
  host.failWrites({ code: "io-error", message: "first" });
  ok(!(await doc.save()).ok);
  equal(doc.getSnapshot().saveError?.message.includes("first"), true);

  // A later save starts: the old failure goes at once, not when this save ends.
  host.failWrites(null);
  hold = true;
  const retry = doc.save();
  equal(doc.getSnapshot().saving, true);
  equal(doc.getSnapshot().saveError, null, "the stale failure is not shown beside \"Saving…\"");
  release();
  ok((await retry).ok);
  equal(doc.getSnapshot().saveError, null);

  // Undo after a failed save does not leave a clean-looking document next to the old failure.
  hold = false;
  doc.apply({ type: "set-game-title", title: "U" });
  host.failWrites({ code: "io-error", message: "second" });
  ok(!(await doc.save()).ok);
  doc.undo();
  const snapshot = doc.getSnapshot();
  equal(snapshot.dirty === false && snapshot.saveError !== null, false, "never clean and failed at once");
  host.failWrites(null);
  ok((await doc.save()).ok);
  equal(doc.getSnapshot().saveError, null, "a save that returns ok leaves no failure behind");
});

test("a save queued behind a failing one clears that failure when it starts and succeeds", async () => {
  const host = hostWith(exampleMain(9));
  let calls = 0;
  const failFirst: DocumentStorage = {
    readProject: (projectId, path) => host.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      calls += 1;
      if (calls === 1) return { ok: false, error: { code: "io-error", message: "only the first" } };
      return host.fs.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(failFirst, identity);
  ok(opened.ok);
  const doc = opened.document;
  doc.apply({ type: "set-game-title", title: "Queued" });
  const first = doc.save();
  const second = doc.save();
  ok(!(await first).ok);
  ok((await second).ok);
  equal(doc.getSnapshot().saveError, null, "the later save's success is the last word");
  equal(doc.getSnapshot().dirty, false);
  equal(titleOf(stored(host)), "Queued");
});

test("document saves cannot be redirected by a project switch, including during an asynchronous write", async () => {
  const original = exampleMain(9);
  const projectA = hostWith(original);
  const projectB = createMemoryPlatformServices({ project: { id: "project-b", name: "B" }, files: { [PATH]: original } });
  let active = projectA;
  let resume!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let pause = false;
  const storage: DocumentStorage = {
    readProject: (projectId, path) => active.fs.readProject(projectId, path),
    writeProject: async (projectId, path, bytes) => {
      const target = active.fs;
      if (pause) { started(); await gate; }
      return target.writeProject(projectId, path, bytes);
    },
  };
  const opened = await openMainDocument(storage, identity);
  ok(opened.ok);
  opened.document.apply({ type: "set-game-title", title: "Project A" });
  active = projectB;
  const wrongProject = await openMainDocument(storage, identity);
  ok(!wrongProject.ok);
  equal(wrongProject.error.kind, "read");
  const refused = await opened.document.save();
  ok(!refused.ok);
  equal(refused.failure.document, PATH);
  deepEqual(stored(projectA), original);
  deepEqual(stored(projectB), original);
  ok(opened.document.getSnapshot().dirty);

  active = projectA;
  pause = true;
  const saving = opened.document.save();
  await entered;
  active = projectB;
  resume();
  ok((await saving).ok);
  equal(titleOf(stored(projectA)), "Project A");
  deepEqual(stored(projectB), original);
});
