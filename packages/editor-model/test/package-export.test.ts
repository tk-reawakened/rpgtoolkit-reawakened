import { createHash } from "node:crypto";
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { exampleBoard } from "./fixtures.ts";
import { createCheckpointGroups, createDocumentWorkspace, prepareGamePackage } from "../src/index.ts";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformOk } from "@tk-reawakened/platform-services";
import { PACKAGE_LIMITS, loadPackage, newProjectMainFile, readDistributionManifest, utf8Decode, utf8Encode, writeMainFile } from "@tk-reawakened/core";

function authoredMain(startupPrg = "start.prg", initBoard = "start.brd", initChar = "", gameTitle = "A Test Game"): Uint8Array {
  const result = writeMainFile({ ...newProjectMainFile(), gameTitle, startupPrg, initBoard, initChar });
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

function authoredFiles(startupPrg = "start.prg", initBoard = "start.brd", scriptSpecPath = "Prg/script-spec/startup.prg"): Readonly<Record<string, Uint8Array>> {
  return {
    "Main/demo.gam": authoredMain(startupPrg, initBoard),
    "Prg/start.prg": utf8Encode("END\n"),
    "Boards/start.brd": exampleBoard(4),
    "Main/other.gam": utf8Encode("not the selected game"),
    "Saved/save.sav": utf8Encode("save"),
    "Prg/smoke.spec.prg": utf8Encode("test only"),
    [scriptSpecPath]: utf8Encode("test-only library"),
    "Boards/editor.tkrscn": utf8Encode("editor scene"),
    "Tiles/editor.tkrTile": utf8Encode("editor tiles"),
    "Packs/editor.tkrpack": utf8Encode("editor package"),
    ".tkr-history/snapshot.bin": utf8Encode("history"),
    ".TKR-Tests/Boards/wall.brd": utf8Encode("fixture board"),
    ".TKR-Tests/Prg/helper.prg": utf8Encode("fixture helper"),
  };
}

test("preflight creates a readable playable TPK and exact sibling install descriptor with auditable exclusions", async () => {
  const { workspace, services } = packageHost({
    ...authoredFiles("start.prg", "start.brd", "Prg/Script-Spec/startup.prg"),
    "Prg/script-spec-extra/startup.prg": utf8Encode("ordinary sibling program"),
    "Media/Prg/script-spec/startup.prg": utf8Encode("ordinary media asset"),
  });
  const groups = createCheckpointGroups({ fs: services.fs, projectId: "memory-project", hash: async (bytes) => createHash("sha256").update(bytes).digest("hex"), newId: () => "export-proof", time: () => "2026-11-15", guard: async () => null, consent: async () => true });
  const checkpoint = await groups.commit([{ path: "Prg/start.prg", bytes: utf8Encode("END\n") }]); ok(checkpoint.ok);
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1.2.3" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  const prepared = outcome.value;
  ok(prepared.excludedFiles.some((path) => path.startsWith(".tkr-history/groups/")));
  ok(prepared.excludedFiles.some((path) => path.startsWith(".tkr-history/contents/")));
  ok(prepared.excludedFiles.some((path) => path.startsWith(".tkr-history/progress/")));

  deepEqual([...prepared.includedFiles].sort(), ["Boards/start.brd", "Main/demo.gam", "Media/Prg/script-spec/startup.prg", "Prg/script-spec-extra/startup.prg", "Prg/start.prg"]);
  for (const path of ["Main/other.gam", "Saved/save.sav", "Prg/smoke.spec.prg", "Prg/Script-Spec/startup.prg", "Boards/editor.tkrscn", "Tiles/editor.tkrTile", "Packs/editor.tkrpack", ".tkr-history/snapshot.bin", ".TKR-Tests/Boards/wall.brd", ".TKR-Tests/Prg/helper.prg"]) {
    ok(prepared.excludedFiles.includes(path), `${path} should be reported as excluded`);
  }

  ok(!prepared.includedFiles.some((path) => path.startsWith(".tkr-history")), "history is never an included file");
  const loaded = loadPackage({ kind: "tpk", name: prepared.package.fileName, bytes: prepared.package.bytes });
  ok(loaded.ok, loaded.ok ? "" : loaded.error.message);
  const manifest = readDistributionManifest(loaded.value);
  ok(manifest.ok, manifest.ok ? "" : manifest.error.message);
  equal(manifest.value.main, "Main/demo.gam");
  ok(!loaded.value.files.some((file) => file.path.startsWith(".tkr-history")), "the produced archive holds no history record");
  deepEqual(new Set(manifest.value.index), new Set(prepared.includedFiles));
  const shipped = loaded.value.files.map((file) => file.path.toLowerCase());
  deepEqual(shipped.filter((path) => path.includes(".tkr-tests") || path.endsWith(".spec.prg")), [], "the produced package holds no creator-test file");
  deepEqual(shipped.filter((path) => path.startsWith("prg/script-spec/")), [], "the produced package holds no root-relative script-spec helper");
  ok(shipped.includes("media/prg/script-spec/startup.prg"), "a similarly named folder outside Prg remains an asset");

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

test("preflight excludes every reserved export while retaining package assets elsewhere after project edits", async () => {
  const files = {
    ...authoredFiles(),
    "Main/demo.gam": authoredMain("start.prg", "start.brd", "", "Edited Game"),
    ".tkr-exports/Edited-Game.tpk": utf8Encode("previous archive"),
    ".tkr-exports/Edited-Game.tpk.json": utf8Encode("previous descriptor"),
    ".tkr-exports/older/another.tpk": utf8Encode("another prior archive"),
    ".tkr-exports/older/another.tpk.json": utf8Encode("another prior descriptor"),
    "Misc/catalogue.tpk": utf8Encode("ordinary project data"),
    "Misc/catalogue.tpk.json": utf8Encode("ordinary project metadata"),
  };
  const { workspace, services } = packageHost(files);
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "2" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  for (const path of [".tkr-exports/Edited-Game.tpk", ".tkr-exports/Edited-Game.tpk.json", ".tkr-exports/older/another.tpk", ".tkr-exports/older/another.tpk.json"]) {
    ok(!outcome.value.includedFiles.includes(path), `${path} should not be recursively packaged`);
    ok(outcome.value.excludedFiles.includes(path), `${path} should be reported as excluded`);
  }
  ok(outcome.value.includedFiles.includes("Misc/catalogue.tpk"));
  ok(outcome.value.includedFiles.includes("Misc/catalogue.tpk.json"));
  workspace.dispose();
});

test("preflight accepts an empty optional startup program without a program asset", async () => {
  const files = Object.fromEntries(Object.entries(authoredFiles("", "start.brd")).filter(([path]) => path !== "Prg/start.prg"));
  const { workspace, services } = packageHost(files);
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1" });
  ok(outcome.ok, outcome.ok ? "" : outcome.message);
  ok(!outcome.value.includedFiles.some((path) => path.startsWith("Prg/")));
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
  if (!result.ok) match(result.message, /symbolic link.*cannot follow symbolic links safely.*not packaged.*L23/);
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
  if (!result.ok) match(result.message, /symbolic link.*Data.*cannot follow symbolic links safely.*not packaged.*L23/);
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

test("a leaky inventory cannot hand the author an archive holding an excluded file: the produced bytes are checked (#2842)", async () => {
  const { workspace, services } = packageHost(authoredFiles("start.prg", "start.brd", "Prg/Script-Spec/startup.prg"));
  // Every excluded class is really present in the project and really reaches the inventory, as a broken filter would let it.
  const outcome = await prepareGamePackage({ workspace, services, mainPath: "Main/demo.gam", version: "1.2.3", inventoryFilter: () => false });
  ok(!outcome.ok, "the export is refused");
  for (const path of ["Main/other.gam", "Saved/save.sav", "Prg/smoke.spec.prg", "Prg/Script-Spec/startup.prg", "Boards/editor.tkrscn", ".tkr-history/snapshot.bin", ".TKR-Tests/Boards/wall.brd", ".TKR-Tests/Prg/helper.prg"]) {
    ok(outcome.message.includes(path), `${path} is named in the refusal: ${outcome.message}`);
  }
  match(outcome.message, /archive it produced holds files that must never be packaged/);
  // Nothing was handed out: no package, no descriptor.
  deepEqual(Object.keys(outcome).includes("value"), false);
});
