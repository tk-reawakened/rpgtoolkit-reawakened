// The mobile wrapper's host services (entry 9.12): the same four calls as the desktop preload, over an injectable
// filesystem, with AD-17's keys and the same refusal of an escaping path. A stub stands in for Capacitor's plugin, so the
// rules are checked without a device.

import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { Directory } from "@capacitor/filesystem";
import { createMobileHost, safeRelative, type MobileFilesystem } from "../src/storage.ts";

/** A filesystem stub stores the same base64 string the native plugin writes, keyed by its AD-17 path. */
function memoryFilesystem(): MobileFilesystem & { readonly files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async writeFile({ path, data, directory }) {
      equal(directory, Directory.Data, "native data stays in app-private storage");
      if (typeof data !== "string") throw new TypeError("native binary writes must be base64 text");
      files.set(path, data);
      return { uri: `file://${path}` };
    },
    async readFile({ path, directory }) {
      equal(directory, Directory.Data, "native data stays in app-private storage");
      const found = files.get(path);
      if (found === undefined) throw new Error("absent");
      return { data: found };
    },
    async readdir({ path, directory }) {
      equal(directory, Directory.Data, "native data stays in app-private storage");
      const prefix = `${path}/`;
      const entries = new Map<string, "directory" | "file">();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        const separator = remainder.indexOf("/");
        const name = separator < 0 ? remainder : remainder.slice(0, separator);
        entries.set(name, separator < 0 ? "file" : "directory");
      }
      return {
        files: [...entries].map(([name, type]) => ({
          name,
          type,
          size: 0,
          uri: `file://${path}/${name}`,
          mtime: 0,
        })),
      };
    },
  };
}

test("a save round-trips under AD-17's keys and native base64 storage", async () => {
  const filesystem = memoryFilesystem();
  const host = createMobileHost({ filesystem, readPackage: async () => null });
  const bytes = new Uint8Array([1, 2, 3]);
  equal(await host.writeBlob("saves", "game-a", "slot-1.json", bytes), true);
  equal(await host.writeBlob("saves", "game-a", "nested/slot-1.json", bytes), true);
  equal(await host.writeBlob("saves", "game-a", "nested/deep/value.dat", bytes), true);
  equal(filesystem.files.get("saves/game-a/slot-1.json"), "AQID", "native writes receive base64 text");
  deepEqual([...(await host.readBlob("saves", "game-a", "slot-1.json")) ?? []], [1, 2, 3]);
  ok(filesystem.files.has("saves/game-a/slot-1.json"), "the key layout is the desktop's");
  deepEqual(await host.listBlobs("saves", "game-a"), [
    "nested/deep/value.dat",
    "nested/slot-1.json",
    "slot-1.json",
  ]);
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
  const bytes = new TextEncoder().encode("hello");
  const filesystem: MobileFilesystem = {
    async writeFile() {
      throw new Error("not used");
    },
    async readFile() {
      let text = "";
      for (const byte of bytes) text += String.fromCharCode(byte);
      return { data: btoa(text) };
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
