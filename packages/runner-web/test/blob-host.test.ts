import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { blobPrefix, createBlobHost, createMemoryBlobBackend, type BlobBackend } from "../src/blob-host.ts";

// The host's contract: saves are isolated by area and GameId, a path is stored exactly as given (the session strips
// `<GameId>/` once), and a refused write is reported as state instead of vanishing. The IndexedDB backend itself is
// proved in a real browser (tools/browser/tests/storage.spec.ts).

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

test("a save written under one GameId is invisible to another GameId and to the other area", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend() });
  ok(await host.write("saves", "aaaa", "slot1", bytes(1, 2, 3)));
  deepEqual(await host.read("saves", "aaaa", "slot1"), bytes(1, 2, 3));
  equal(await host.read("saves", "bbbb", "slot1"), null, "a different GameId has no such save");
  equal(await host.read("files", "aaaa", "slot1"), null, "the files area is separate from saves");
  deepEqual(await host.list("saves", "aaaa"), ["slot1"]);
  deepEqual(await host.list("saves", "bbbb"), []);
  deepEqual(await host.list("files", "aaaa"), []);
});

test("ids that could be confused as prefixes of one another stay apart", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend() });
  await host.write("saves", "ab", "x", bytes(1));
  await host.write("saves", "a", "b/x", bytes(2));
  await host.write("saves", "a/b", "x", bytes(3));
  deepEqual(await host.read("saves", "ab", "x"), bytes(1));
  deepEqual(await host.read("saves", "a", "b/x"), bytes(2));
  deepEqual(await host.read("saves", "a/b", "x"), bytes(3));
  deepEqual(await host.list("saves", "a"), ["b/x"]);
  deepEqual(await host.list("saves", "a/b"), ["x"]);
  notEqualPrefix(blobPrefix("saves", "a/b"), blobPrefix("saves", "a"));
});

function notEqualPrefix(left: string, right: string): void {
  ok(!left.startsWith(right) && !right.startsWith(left), `${left} and ${right} must not nest`);
}

test("the host stores the relative path as given: a path that repeats the GameId is a different file, never stripped again", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend() });
  await host.write("saves", "aaaa", "aaaa/slot1", bytes(9));
  await host.write("saves", "aaaa", "slot1", bytes(1));
  deepEqual(await host.read("saves", "aaaa", "aaaa/slot1"), bytes(9));
  deepEqual(await host.read("saves", "aaaa", "slot1"), bytes(1));
  deepEqual(await host.list("saves", "aaaa"), ["aaaa/slot1", "slot1"]);
});

test("paths with separators, spaces and non-ASCII survive a list round trip", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend() });
  const paths = ["dir/sub/slot 2", "café", "a%2Fb", "x?y#z"];
  for (const path of paths) await host.write("files", "g", path, bytes(path.length));
  deepEqual(await host.list("files", "g"), [...paths].sort());
  for (const path of paths) deepEqual(await host.read("files", "g", path), bytes(path.length));
});

test("a write stores a copy: reusing the caller's buffer afterwards cannot change the save", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend() });
  const buffer = bytes(1, 2, 3);
  await host.write("saves", "g", "s", buffer);
  buffer.fill(0);
  deepEqual(await host.read("saves", "g", "s"), bytes(1, 2, 3));
});

test("a refused write for quota returns false, reports quota-limited, and leaves the earlier save readable", async () => {
  const host = createBlobHost({ backend: createMemoryBlobBackend(4) });
  ok(await host.write("saves", "g", "small", bytes(1, 2, 3)));
  equal(await host.write("saves", "g", "big", bytes(1, 2, 3, 4, 5)), false);
  const state = host.state();
  equal(state.quota, "limited");
  equal(state.failedWrites, 1);
  equal(state.writes, 2);
  ok(state.lastError?.includes("QuotaExceededError") === true);
  deepEqual(await host.read("saves", "g", "small"), bytes(1, 2, 3));
  equal(await host.read("saves", "g", "big"), null, "nothing half-written");
});

test("a write failure that is not quota fails the write without claiming the store is full", async () => {
  const failing: BlobBackend = {
    async get() { return null; },
    async put() { throw new Error("disk error"); },
    async keys() { return []; },
  };
  const host = createBlobHost({ backend: failing });
  equal(await host.write("saves", "g", "s", bytes(1)), false);
  equal(host.state().quota, "ok");
  ok(host.state().lastError?.includes("disk error") === true);
});

test("a read that fails is thrown, not reported as an empty slot", async () => {
  const failing: BlobBackend = {
    async get() { throw new Error("read failed"); },
    async put() {},
    async keys() { throw new Error("list failed"); },
  };
  const host = createBlobHost({ backend: failing });
  await refused(host.read("saves", "g", "s"), "read failed");
  await refused(host.list("saves", "g"), "list failed");
});

test("persistence is asked once, on the first write, and every outcome is reported rather than swallowed", async () => {
  let asked = 0;
  const granted = createBlobHost({ backend: createMemoryBlobBackend(), storage: { persist: async () => { asked += 1; return true; }, persisted: async () => false } });
  equal(granted.state().persisted, "not-requested", "nothing is asked before a save");
  await granted.write("saves", "g", "a", bytes(1));
  await granted.write("saves", "g", "b", bytes(1));
  equal(asked, 1);
  equal(granted.state().persisted, "granted");

  const already = createBlobHost({ backend: createMemoryBlobBackend(), storage: { persist: async () => false, persisted: async () => true } });
  await already.write("saves", "g", "a", bytes(1));
  equal(already.state().persisted, "granted", "already persistent is granted without a prompt");

  const denied = createBlobHost({ backend: createMemoryBlobBackend(), storage: { persist: async () => false, persisted: async () => false } });
  ok(await denied.write("saves", "g", "a", bytes(1)), "an unpersisted origin still saves");
  equal(denied.state().persisted, "denied");

  equal(createBlobHost({ backend: createMemoryBlobBackend() }).state().persisted, "not-requested");
  const none = createBlobHost({ backend: createMemoryBlobBackend() });
  await none.requestPersistence();
  equal(none.state().persisted, "unsupported");

  const broken = createBlobHost({ backend: createMemoryBlobBackend(), storage: { persist: async () => { throw new Error("policy"); } } });
  await broken.requestPersistence();
  equal(broken.state().persisted, "failed");
});

test("the memory backend refuses like a full store only when a write would not fit, and replacing a blob frees its old size", async () => {
  const backend = createMemoryBlobBackend(5);
  await backend.put("k", bytes(1, 2, 3, 4, 5));
  await refused(backend.put("other", bytes(1)), "the blob store is full");
  await backend.put("k", bytes(1, 2));
  await backend.put("other", bytes(1, 2, 3));
  deepEqual(await backend.keys(""), ["k", "other"]);
});

/** Resolves when `work` rejects with a message containing `text`; fails the test otherwise. */
async function refused(work: Promise<unknown>, text: string): Promise<void> {
  try {
    await work;
  } catch (error) {
    ok(error instanceof Error && error.message.includes(text), `expected a failure containing "${text}", got ${String(error)}`);
    return;
  }
  throw new Error(`expected a failure containing "${text}", but the work succeeded`);
}
