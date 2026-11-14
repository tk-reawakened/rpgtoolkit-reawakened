import { createHash } from "node:crypto";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { exampleBoard } from "./fixtures.ts";
import { createDocumentWorkspace, packageDescriptorFor, prepareGamePackage } from "../src/index.ts";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformOk } from "@tk-reawakened/platform-services";
import { PACKAGE_LIMITS, loadPackage, newProjectMainFile, readDistributionManifest, utf8Decode, utf8Encode, writeMainFile } from "@tk-reawakened/core";

function authoredMain(startupPrg = "start.prg", initBoard = "start.brd", initChar = ""): Uint8Array {
  const result = writeMainFile({ ...newProjectMainFile(), gameTitle: "A Test Game", startupPrg, initBoard, initChar });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function packageHost(files: Readonly<Record<string, Uint8Array>> = {}) {
  const host = createMemoryPlatformServices({ files });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const packageExport = {
    async sha256(bytes: Uint8Array) {
      return platformOk(createHash("sha256").update(bytes).digest("hex"));
    },
    async downloadFile() {
      return platformOk(undefined);
    },
  };
  return { host, workspace, services: { fs: host.fs, dialogs: host.dialogs, packageExport } };
}

function authoredFiles(startupPrg = "start.prg", initBoard = "start.brd"): Readonly<Record<string, Uint8Array>> {
  return {
    "Main/demo.gam": authoredMain(startupPrg, initBoard),
    "Prg/start.prg": utf8Encode("END\n"),
    "Boards/start.brd": exampleBoard(4),
    "Main/other.gam": utf8Encode("not the selected game"),
    "Saved/save.sav": utf8Encode("save"),
    "Prg/smoke.spec.prg": utf8Encode("test only"),
    "Boards/editor.tkrscn": utf8Encode("editor scene"),
    "Tiles/editor.tkrTile": utf8Encode("editor tiles"),
    "Packs/editor.tkrpack": utf8Encode("editor package"),
    ".tkr-history/snapshot.bin": utf8Encode("history"),
  };
}

test("preflight creates a readable playable TPK and exact sibling install descriptor with auditable exclusions", async () => {
  const { workspace, services } = packageHost(authoredFiles());
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1.2.3" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  const prepared = outcome.value;

  deepEqual([...prepared.includedFiles].sort(), ["Boards/start.brd", "Main/demo.gam", "Prg/start.prg"]);
  for (const path of ["Main/other.gam", "Saved/save.sav", "Prg/smoke.spec.prg", "Boards/editor.tkrscn", "Tiles/editor.tkrTile", "Packs/editor.tkrpack", ".tkr-history/snapshot.bin"]) {
    ok(prepared.excludedFiles.includes(path), `${path} should be reported as excluded`);
  }

  const loaded = loadPackage({ kind: "tpk", name: prepared.package.fileName, bytes: prepared.package.bytes });
  ok(loaded.ok, loaded.ok ? "" : loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  ok(manifest.ok, manifest.ok ? "" : manifest.error.message);
  equal(manifest.value.main, "Main/demo.gam");
  deepEqual(new Set(manifest.value.index), new Set(prepared.includedFiles));

  const descriptor = JSON.parse(utf8Decode(prepared.descriptor.bytes)) as Record<string, unknown>;
  deepEqual(Object.keys(descriptor), ["schema", "file", "sha256", "size", "gameId", "title", "version"]);
  equal(descriptor["schema"], 1);
  equal(descriptor["file"], prepared.package.fileName);
  equal(descriptor["sha256"], createHash("sha256").update(prepared.package.bytes).digest("hex"));
  equal(descriptor["size"], prepared.package.bytes.byteLength);
  equal(descriptor["title"], "A Test Game");
  equal(descriptor["version"], "1.2.3");
  workspace.dispose();
});

test("file-only suffix exclusions do not discard folders whose names use editor-only extensions", async () => {
  const { workspace, services } = packageHost({
    ...authoredFiles(),
    "Bitmap/menu.tkrtile/background.png": utf8Encode("background image"),
  });
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  ok(outcome.value.includedFiles.includes("Bitmap/menu.tkrtile/background.png"));
  workspace.dispose();
});

test("preflight refuses a missing startup program or initial board", async () => {
  for (const [files, missingLabel] of [
    [authoredFiles("missing.prg"), "startup program"],
    [authoredFiles("start.prg", "missing.brd"), "initial board"],
    [{ ...authoredFiles(), "Main/demo.gam": authoredMain("start.prg", "start.brd", "missing.tem") }, "initial character"],
  ] as const) {
    const { workspace, services } = packageHost(files);
    const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
    equal(outcome.ok, false);
    if (!outcome.ok) ok(outcome.message.includes(missingLabel), outcome.message);
    workspace.dispose();
  }
});
test("preflight checks a declared initial character and includes it when present", async () => {
  const files = {
    ...authoredFiles(),
    "Main/demo.gam": authoredMain("start.prg", "start.brd", "hero.tem"),
    "Chrs/hero.tem": utf8Encode("character"),
  };
  const { workspace, services } = packageHost(files);
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  ok(outcome.value.includedFiles.includes("Chrs/hero.tem"));
  workspace.dispose();
});

test("preflight refuses symbolic links before reading through them", async () => {
  const { host, workspace, services } = packageHost(authoredFiles());
  const reads: string[] = [];
  const fs = {
    ...host.fs,
    async list(path: string) {
      return path === "" ? platformOk([{ name: "external", kind: "link" as const }]) : host.fs.list(path);
    },
    async read(path: string) {
      reads.push(path);
      return host.fs.read(path);
    },
  };
  const result = await prepareGamePackage({
    workspace,
    services: { ...services, fs },
    mainPath: "Main/demo.gam",
    version: "1",
  });
  equal(result.ok, false);
  if (!result.ok) match(result.message, /symbolic link.*L23/);
  deepEqual(reads, []);
  workspace.dispose();
});

test("preflight refuses a directory replaced by a symbolic link during listing before reading outside files", async () => {
  const { host, workspace, services } = packageHost({
    ...authoredFiles(),
    "Data/original.bin": utf8Encode("inside"),
  });
  let dataStats = 0;
  const reads: string[] = [];
  const fs = {
    ...host.fs,
    async list(path: string) {
      return path === "Data" ? platformOk([{ name: "outside.bin", kind: "file" as const }]) : host.fs.list(path);
    },
    async stat(path: string) {
      if (path === "Data" && ++dataStats === 2) {
        return platformOk({ kind: "link" as const, size: 0, modifiedMs: 0 });
      }
      return host.fs.stat(path);
    },
    async read(path: string) {
      reads.push(path);
      return host.fs.read(path);
    },
  };
  const result = await prepareGamePackage({
    workspace,
    services: { ...services, fs },
    mainPath: "Main/demo.gam",
    version: "1",
  });
  equal(result.ok, false);
  if (!result.ok) match(result.message, /symbolic link.*Data.*L23/);
  deepEqual(reads, []);
  workspace.dispose();
});

test("preflight checks listed file sizes before reading and rechecks the bytes returned", async () => {
  const first = packageHost(authoredFiles());
  let startupReads = 0;
  const tooLargeStatFs = {
    ...first.host.fs,
    async stat(path: string) {
      return path === "Prg/start.prg"
        ? platformOk({ kind: "file" as const, size: PACKAGE_LIMITS.maxEntryUncompressedBytes + 1, modifiedMs: 0 })
        : first.host.fs.stat(path);
    },
    async read(path: string) {
      if (path === "Prg/start.prg") startupReads += 1;
      return first.host.fs.read(path);
    },
  };
  const beforeRead = await prepareGamePackage({
    workspace: first.workspace,
    services: { ...first.services, fs: tooLargeStatFs },
    mainPath: "Main/demo.gam",
    version: "1",
  });
  equal(beforeRead.ok, false);
  equal(startupReads, 0, "the host-reported oversized file is not read");
  first.workspace.dispose();

  const second = packageHost(authoredFiles());
  const reportedLength = new Proxy(new Uint8Array(), {
    get(target, property) {
      return property === "byteLength" ? PACKAGE_LIMITS.maxEntryUncompressedBytes + 1 : Reflect.get(target, property, target);
    },
  }) as Uint8Array;
  const tooLargeReadFs = {
    ...second.host.fs,
    async read(path: string) {
      return path === "Prg/start.prg" ? platformOk(reportedLength) : second.host.fs.read(path);
    },
  };
  const afterRead = await prepareGamePackage({
    workspace: second.workspace,
    services: { ...second.services, fs: tooLargeReadFs },
    mainPath: "Main/demo.gam",
    version: "1",
  });
  equal(afterRead.ok, false);
  if (!afterRead.ok) match(afterRead.message, /Prg\/start\.prg exceeds the per-file package limit/);
  second.workspace.dispose();
});

test("a package saved under an author-chosen name gets a descriptor that names that file and nothing else changes", async () => {
  const { workspace, services } = packageHost(authoredFiles());
  const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "2.0" });
  ok(prepared.ok, prepared.ok ? "" : prepared.message);
  const renamed = packageDescriptorFor(prepared.value, "renamed-game.tpk");
  ok(renamed.ok, renamed.ok ? "" : renamed.message);
  const original = JSON.parse(utf8Decode(prepared.value.descriptor.bytes)) as Record<string, unknown>;
  const descriptor = JSON.parse(utf8Decode(renamed.bytes)) as Record<string, unknown>;
  deepEqual(Object.keys(descriptor), ["schema", "file", "sha256", "size", "gameId", "title", "version"]);
  equal(descriptor["file"], "renamed-game.tpk");
  for (const field of ["schema", "sha256", "size", "gameId", "title", "version"]) deepEqual(descriptor[field], original[field]);
  equal(descriptor["sha256"], createHash("sha256").update(prepared.value.package.bytes).digest("hex"));

  const sameName = packageDescriptorFor(prepared.value, prepared.value.package.fileName);
  ok(sameName.ok, sameName.ok ? "" : sameName.message);
  deepEqual(sameName.bytes, prepared.value.descriptor.bytes);
  workspace.dispose();
});

test("a descriptor is refused for a name that is not a plain .tpk file name", async () => {
  const { workspace, services } = packageHost(authoredFiles());
  const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(prepared.ok, prepared.ok ? "" : prepared.message);
  for (const name of ["game.zip", ".tpk", "Build/game.tpk", "Build\\game.tpk", ""]) {
    const refused = packageDescriptorFor(prepared.value, name);
    equal(refused.ok, false, `${JSON.stringify(name)} should be refused`);
    if (!refused.ok) match(refused.message, /\.tpk/);
  }
  workspace.dispose();
});
