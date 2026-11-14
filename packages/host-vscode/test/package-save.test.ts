import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { PreparedGamePackage } from "@tk-reawakened/editor-model";
import { savePackageWithSaveAs, type PackageSavePort } from "../src/package-save.ts";
import { validatePackageDestination } from "../src/package-destination.ts";

function prepared(): PreparedGamePackage {
  return {
    package: { fileName: "game.tpk", bytes: new TextEncoder().encode("archive") },
    descriptor: { fileName: "game.tpk.json", bytes: new TextEncoder().encode(JSON.stringify({ schema: 1, file: "game.tpk", sha256: "hash", size: 7, gameId: "id", title: "Game", version: "1" })) },
    includedFiles: [], excludedFiles: [],
  };
}

function port(overrides: Partial<PackageSavePort<string>> = {}) {
  const writes: [string, Uint8Array][] = [];
  let replaced: readonly string[] = [];
  const value: PackageSavePort<string> = {
    chooseDestination: async () => "out/game.tpk",
    fileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    sibling: (path, name) => `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`,
    describe: (path) => path,
    validateDestination: async () => undefined,
    inspect: async () => "missing",
    confirmReplace: async (paths) => { replaced = paths; return false; },
    write: async (path, bytes) => { writes.push([path, bytes]); },
    ...overrides,
  };
  return { value, writes, replaced: () => replaced };
}

test("package Save As confirms both existing siblings before replacing and writes descriptor naming chosen archive", async () => {
  let confirms = 0;
  const fs = port({
    inspect: async () => "file",
    confirmReplace: async (paths) => { confirms += 1; deepEqual(paths, ["out/game.tpk", "out/game.tpk.json"]); return true; },
  });
  const result = await savePackageWithSaveAs(fs.value, prepared());
  ok(result.ok);
  equal(confirms, 1);
  equal(fs.writes.length, 2);
  equal(fs.writes[0]?.[0], "out/game.tpk");
  equal(new TextDecoder().decode(fs.writes[1]?.[1]), JSON.stringify({ schema: 1, file: "game.tpk", sha256: "hash", size: 7, gameId: "id", title: "Game", version: "1" }, null, 2) + "\n");
});

test("package Save As cancellation leaves existing files untouched", async () => {
  const fs = port({ inspect: async () => "file", confirmReplace: async () => false });
  const result = await savePackageWithSaveAs(fs.value, prepared());
  equal(result.ok, false);
  if (!result.ok) equal(result.cancelled, true);
  equal(fs.writes.length, 0);
});

test("package Save As refuses symbolic links at either output before writing", async () => {
  for (const link of ["out/game.tpk", "out/game.tpk.json"]) {
    let confirmations = 0;
    const fs = port({
      inspect: async (path) => path === link ? "link" : "missing",
      confirmReplace: async () => { confirmations += 1; return true; },
    });
    const result = await savePackageWithSaveAs(fs.value, prepared());
    equal(result.ok, false);
    if (!result.ok) ok(result.message.includes("symbolic link"));
    equal(confirmations, 0);
    equal(fs.writes.length, 0);
  }
});

test("package Save As reports an incomplete pair when descriptor write fails", async () => {
  const fs = port({ write: async (path, bytes) => { if (path.endsWith(".json")) throw new Error("disk full"); fs.writes.push([path, bytes]); } });
  const result = await savePackageWithSaveAs(fs.value, prepared());
  equal(result.ok, false);
  if (!result.ok) ok(result.message.includes("export is incomplete"));
  deepEqual(fs.writes.map(([path]) => path), ["out/game.tpk"]);
});

test("package destinations are restricted to the reserved project export folder or outside the project", () => {
  const root = { scheme: "file", authority: "", path: "/work/game" };
  equal(validatePackageDestination(root, { ...root, path: "/work/game/.tkr-exports/game.tpk" }), undefined);
  equal(validatePackageDestination(root, { ...root, path: "/work/game/.tkr-exports/nested/game.tpk" })?.includes("save outside"), true);
  equal(validatePackageDestination(root, { ...root, path: "/work/game/Releases/game.tpk" })?.includes(".tkr-exports"), true);
  equal(validatePackageDestination(root, { ...root, path: "/work/elsewhere/game.tpk" }), undefined);
  equal(validatePackageDestination(root, { ...root, scheme: "vscode-remote", authority: "ssh-host", path: "/work/game/Releases/game.tpk" }), undefined);
});

test("package Save As refuses non-reserved in-project destinations before inspecting or writing", async () => {
  let inspected = 0;
  const fs = port({
    chooseDestination: async () => "/project/Releases/game.tpk",
    validateDestination: async () => "Choose .tkr-exports under this project or save outside the project folder.",
    inspect: async () => { inspected += 1; return "missing"; },
  });
  const result = await savePackageWithSaveAs(fs.value, prepared());
  equal(result.ok, false);
  if (!result.ok) ok(result.message.includes("save outside the project folder"));
  equal(inspected, 0);
  equal(fs.writes.length, 0);
});
