// The mobile wrapper's host services (entry 9.12): the same four calls as the desktop preload, over an injectable
// filesystem, with AD-17's keys and the same refusal of an escaping path. A stub stands in for Capacitor's plugin, so the
// rules are checked without a device.

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMobileHost, safeRelative, type MobileFilesystem } from "../src/storage.ts";

/** A filesystem the tests can read back: a map keyed by the absolute path the wrapper asked for. */
function memoryFilesystem(): MobileFilesystem & { readonly files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async writeFile({ path, data }) {
      files.set(path, new Uint8Array(data));
    },
    async readFile({ path }) {
      const found = files.get(path);
      if (found === undefined) throw new Error("absent");
      return { data: found };
    },
    async readdir({ path }) {
      const names = [...files.keys()]
        .filter((key) => key.startsWith(`${path}/`))
        .map((key) => key.slice(path.length + 1));
      return { files: names.map((name) => ({ name, type: "file" })) };
    },
  };
}

test("a save round-trips under AD-17's keys, in the area and game the caller names", async () => {
  const filesystem = memoryFilesystem();
  const host = createMobileHost({ filesystem, readPackage: async () => null });
  const bytes = new Uint8Array([1, 2, 3]);
  equal(await host.writeBlob("saves", "game-a", "slot-1.json", bytes), true);
  deepEqual([...(await host.readBlob("saves", "game-a", "slot-1.json")) ?? []], [1, 2, 3]);
  ok(filesystem.files.has("saves/game-a/slot-1.json"), "the key layout is the desktop's");
  deepEqual(await host.listBlobs("saves", "game-a"), ["slot-1.json"]);
  deepEqual(await host.listBlobs("saves", "game-b"), [], "another game's area is empty");
});

test("an escaping path is refused before the platform sees it", async () => {
  const filesystem = memoryFilesystem();
  const host = createMobileHost({ filesystem, readPackage: async () => null });
  equal(await host.writeBlob("saves", "game-a", "../outside.json", new Uint8Array([1])), false);
  equal(await host.writeBlob("saves", "../game", "slot.json", new Uint8Array([1])), false);
  equal(await host.readBlob("saves", "game-a", "/etc/passwd"), null);
  equal(filesystem.files.size, 0, "nothing reached the filesystem");
  equal(safeRelative("/absolute"), null);
  equal(safeRelative("C:drive"), null);
  equal(safeRelative("a/../b"), null);
  equal(safeRelative("a/b.json"), "a/b.json");
});

test("a base64 read is decoded, because Capacitor returns text for a binary file", async () => {
  const bytes = Uint8Array.from(Buffer.from("hello"));
  const filesystem: MobileFilesystem = {
    async writeFile() {
      throw new Error("not used");
    },
    async readFile() {
      return { data: Buffer.from(bytes).toString("base64") };
    },
    async readdir() {
      return { files: [] };
    },
  };
  const host = createMobileHost({ filesystem, readPackage: async () => null });
  deepEqual([...(await host.readBlob("saves", "game-a", "x.bin")) ?? []], [104, 101, 108, 108, 111]);
});

test("the package comes from the host, and its absence is null rather than a crash", async () => {
  const filesystem = memoryFilesystem();
  const present = createMobileHost({
    filesystem,
    readPackage: async () => ({ name: "game.tpk", bytes: new Uint8Array([0x50, 0x4b]) }),
  });
  const opened = await present.openPackage();
  equal(opened?.name, "game.tpk");
  equal(opened?.bytes.length, 2);
  const absent = createMobileHost({ filesystem, readPackage: async () => null });
  equal(await absent.openPackage(), null);
});
