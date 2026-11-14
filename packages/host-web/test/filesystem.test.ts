import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { publishGamePackage } from "@tk-reawakened/editor-model";
import { platformError } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createWebFileSystem } from "../src/filesystem.ts";

type FakeFile = { bytes: Uint8Array; denyWrite?: boolean };
type FakeNode = FakeDirectory | FakeFile;

class FakeDirectory {
  readonly kind = "directory";
  readonly children = new Map<string, FakeNode>();
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirectory> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectory) return existing;
    if (existing) throw new DOMException("Not a directory", "TypeMismatchError");
    if (!options?.create) throw new DOMException("Not found", "NotFoundError");
    const child = new FakeDirectory();
    this.children.set(name, child);
    return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectory) throw new DOMException("Is a directory", "TypeMismatchError");
    if (!existing && !options?.create) throw new DOMException("Not found", "NotFoundError");
    const file = existing ?? { bytes: new Uint8Array() };
    this.children.set(name, file);
    return {
      getFile: async () => ({ size: file.bytes.length, lastModified: 1, arrayBuffer: async () => file.bytes.slice().buffer } as File),
      createWritable: async () => {
        if (file.denyWrite) throw new DOMException("Permission denied", "NotAllowedError");
        let staged = new Uint8Array();
        return { write: async (bytes: ArrayBuffer) => { staged = new Uint8Array(bytes.slice(0)); }, close: async () => { file.bytes = staged; } } as FileSystemWritableFileStream;
      },
    } as FileSystemFileHandle;
  }
  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, child] of this.children) yield [name, child instanceof FakeDirectory ? { kind: "directory" } as FileSystemDirectoryHandle : { kind: "file" } as FileSystemFileHandle];
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new DOMException("Not found", "NotFoundError");
  }
}

function fixture() {
  const root = new FakeDirectory();
  root.children.set("game.gam", { bytes: new Uint8Array([1, 2, 3]) });
  return { root, fs: createWebFileSystem(root as unknown as FileSystemDirectoryHandle, "project") };
}

test("web filesystem obeys project-relative path, file operation and unsupported-operation contracts", async () => {
  const { fs } = fixture();
  const listing = await fs.list("");
  ok(listing.ok);
  deepEqual(listing.value, [{ name: "game.gam", kind: "file" }]);
  const root = await fs.stat("");
  ok(root.ok);
  equal(root.value.kind, "directory");
  for (const path of ["../game.gam", "/game.gam", "Main\\game.gam", "Main//game.gam"]) {
    const result = await fs.read(path);
    ok(!result.ok && result.error.code === "invalid-path", path);
  }
  const written = await fs.write("Main/sub.gam", new Uint8Array([4, 5]));
  ok(written.ok);
  const nested = await fs.read("Main/sub.gam");
  ok(nested.ok);
  deepEqual([...nested.value], [4, 5]);
  const renamed = await fs.rename("game.gam", "copy.gam");
  ok(!renamed.ok && renamed.error.code === "unavailable");
  const watched = await fs.watch("", () => undefined);
  ok(!watched.ok && watched.error.code === "unavailable");
});

test("web filesystem distinguishes a final directory from a non-directory parent during file access", async () => {
  const { root, fs } = fixture();
  root.children.set("folder", new FakeDirectory());
  for (const result of [await fs.read("folder"), await fs.write("folder", new Uint8Array([1]))]) {
    ok(!result.ok);
    equal(result.error.code, "is-a-directory");
  }
  for (const result of [await fs.read("game.gam/child"), await fs.write("game.gam/child", new Uint8Array([1]))]) {
    ok(!result.ok);
    equal(result.error.code, "not-a-directory");
  }
});

test("web filesystem reports a refused durable write and preserves the prior bytes", async () => {
  const { root, fs } = fixture();
  const file = root.children.get("game.gam");
  if (!file || file instanceof FakeDirectory) throw new Error("fixture file missing");
  file.denyWrite = true;
  const result = await fs.write("game.gam", new Uint8Array([9, 9]));
  ok(!result.ok);
  equal(result.error.code, "permission-denied");
  deepEqual([...file.bytes], [1, 2, 3]);
});

test("web filesystem refuses package publication when it cannot reserve output files without rename", async () => {
  const { root, fs } = fixture();
  const host = createMemoryPlatformServices();
  const prepared = {
    package: { fileName: "game.tpk", bytes: new Uint8Array([1, 2, 3]) },
    descriptor: {
      fileName: "game.tpk.json",
      bytes: new TextEncoder().encode(JSON.stringify({
        schema: 1,
        file: "game.tpk",
        sha256: "0".repeat(64),
        size: 3,
        gameId: "game-id",
        title: "Game",
        version: "1.0.0",
      })),
    },
    includedFiles: [],
    excludedFiles: [],
  };
  host.answerSavePaths("Build/game.tpk");
  const refused = await publishGamePackage({ fs, dialogs: host.dialogs }, "Main/game.gam", prepared);
  equal(refused.ok, false);
  if (!refused.ok) match(refused.message, /cannot safely publish/i);
  ok(!root.children.has("Build"), "unsafe direct publication creates no output");
});

test("an independent writer racing the no-rename probe keeps its package and descriptor untouched", async () => {
  const { root, fs } = fixture();
  const host = createMemoryPlatformServices();
  const prepared = {
    package: { fileName: "game.tpk", bytes: new Uint8Array([1, 2, 3]) },
    descriptor: {
      fileName: "game.tpk.json",
      bytes: new TextEncoder().encode(JSON.stringify({
        schema: 1,
        file: "game.tpk",
        sha256: "0".repeat(64),
        size: 3,
        gameId: "game-id",
        title: "Game",
        version: "1.0.0",
      })),
    },
    includedFiles: [],
    excludedFiles: [],
  };
  const externalPackage = new Uint8Array([8, 8, 8]);
  const externalDescriptor = new Uint8Array([7, 7]);
  let raced = false;
  const racingFs = {
    ...fs,
    async rename() {
      raced = true;
      ok((await fs.write("Build/game.tpk", externalPackage)).ok);
      ok((await fs.write("Build/game.tpk.json", externalDescriptor)).ok);
      return platformError("unavailable", "Atomic rename is unavailable.");
    },
  };
  host.answerSavePaths("Build/game.tpk");
  const refused = await publishGamePackage({ fs: racingFs, dialogs: host.dialogs }, "Main/game.gam", prepared);
  equal(refused.ok, false);
  equal(raced, true);
  const archive = await fs.read("Build/game.tpk");
  const descriptor = await fs.read("Build/game.tpk.json");
  ok(archive.ok);
  ok(descriptor.ok);
  deepEqual(archive.value, externalPackage);
  deepEqual(descriptor.value, externalDescriptor);
  ok(root.children.has("Build"));
});
