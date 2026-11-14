import { createHash } from "node:crypto";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { exampleBoard } from "./fixtures.ts";
import { createDocumentWorkspace, prepareGamePackage, publishGamePackage } from "../src/index.ts";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformOk } from "@tk-reawakened/platform-services";
import { loadPackage, newProjectMainFile, readDistributionManifest, utf8Decode, utf8Encode, writeMainFile } from "@tk-reawakened/core";

function authoredMain(startupPrg = "start.prg", initBoard = "start.brd"): Uint8Array {
  const result = writeMainFile({ ...newProjectMainFile(), gameTitle: "A Test Game", startupPrg, initBoard });
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
  ] as const) {
    const { workspace, services } = packageHost(files);
    const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
    equal(outcome.ok, false);
    if (!outcome.ok) ok(outcome.message.includes(missingLabel), outcome.message);
    workspace.dispose();
  }
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
