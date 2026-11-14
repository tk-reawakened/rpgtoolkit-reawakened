import { createHash } from "node:crypto";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { exampleBoard } from "./fixtures.ts";
import { createDocumentWorkspace, prepareGamePackage, publishGamePackage } from "../src/index.ts";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
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

test("project publication writes a sibling descriptor without replacing existing outputs", async () => {
  const { host, workspace, services } = packageHost(authoredFiles());
  const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(prepared.ok, prepared.ok ? "" : prepared.message);
  host.answerSavePaths("Build/renamed-game.tpk");
  const published = await publishGamePackage(services, "Main/demo.gam", prepared.value);
  ok(published.ok, published.ok ? "" : published.message);
  equal(published.path, "Build/renamed-game.tpk");
  const archive = host.bytesOf("Build/renamed-game.tpk");
  const sidecar = host.bytesOf("Build/renamed-game.tpk.json");
  ok(archive !== undefined);
  ok(sidecar !== undefined);
  const descriptor = JSON.parse(utf8Decode(sidecar)) as Record<string, unknown>;
  equal(descriptor["file"], "renamed-game.tpk");

  host.answerSavePaths("Build/renamed-game.tpk");
  const collision = await publishGamePackage(services, "Main/demo.gam", prepared.value);
  equal(collision.ok, false);
  equal(host.bytesOf("Build/renamed-game.tpk")?.byteLength, archive.byteLength);
  host.answerSavePaths(null);
  const cancelled = await publishGamePackage(services, "Main/demo.gam", prepared.value);
  equal(cancelled.ok, false);
  equal(host.bytesOf("Build/renamed-game.tpk")?.byteLength, archive.byteLength);
  workspace.dispose();
});
test("concurrent exports to the same destination serialize and never replace the first package", async () => {
  const { host, workspace, services } = packageHost(authoredFiles());
  const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(prepared.ok, prepared.ok ? "" : prepared.message);
  host.answerSavePaths("Build/concurrent.tpk", "Build/concurrent.tpk");
  const outcomes = await Promise.all([
    publishGamePackage(services, "Main/demo.gam", prepared.value),
    publishGamePackage(services, "Main/demo.gam", prepared.value),
  ]);
  equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  equal(outcomes.filter((outcome) => !outcome.ok && outcome.message.includes("already exists")).length, 1);
  ok(host.bytesOf("Build/concurrent.tpk") !== undefined);
  ok(host.bytesOf("Build/concurrent.tpk.json") !== undefined);
  workspace.dispose();
});

test("failed temporary writes clean every attempted file and report cleanup failures", async () => {
  for (const failedWrite of ["package", "descriptor"] as const) {
    const { host, workspace, services } = packageHost(authoredFiles());
    const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
    ok(prepared.ok, prepared.ok ? "" : prepared.message);
    const writes: string[] = [];
    const deletes: string[] = [];
    const fs = {
      ...host.fs,
      async write(path: string, bytes: Uint8Array) {
        writes.push(path);
        const shouldFail = failedWrite === "package"
          ? writes.length === 1
          : path.includes(".json.") && path.endsWith(".tkr-package-tmp");
        if (shouldFail) {
          const partial = await host.fs.write(path, bytes.subarray(0, Math.min(1, bytes.byteLength)));
          ok(partial.ok);
          return platformError("io-error", `simulated partial ${failedWrite} write`);
        }
        return host.fs.write(path, bytes);
      },
      async delete(path: string) {
        deletes.push(path);
        return host.fs.delete(path);
      },
    };
    host.answerSavePaths(`Build/${failedWrite}.tpk`);
    const failed = await publishGamePackage({ ...services, fs }, "Main/demo.gam", prepared.value);
    equal(failed.ok, false);
    equal(deletes.length, 2);
    for (const path of writes) {
      const read = await host.fs.read(path);
      ok(!read.ok, `partial temporary file ${path} was removed`);
    }
    workspace.dispose();
  }

  const { host, workspace, services } = packageHost(authoredFiles());
  const prepared = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(prepared.ok, prepared.ok ? "" : prepared.message);
  let partialPath = "";
  const failingFs = {
    ...host.fs,
    async write(path: string, bytes: Uint8Array) {
      partialPath = path;
      const partial = await host.fs.write(path, bytes.subarray(0, 1));
      ok(partial.ok);
      return platformError("io-error", "simulated partial package write");
    },
    async delete(path: string) {
      return path === partialPath ? platformError("permission-denied", "cleanup denied") : host.fs.delete(path);
    },
  };
  host.answerSavePaths("Build/left-behind.tpk");
  const failed = await publishGamePackage({ ...services, fs: failingFs }, "Main/demo.gam", prepared.value);
  equal(failed.ok, false);
  if (!failed.ok) {
    match(failed.message, /Cleanup failed/);
    match(failed.message, new RegExp(partialPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  workspace.dispose();
});
