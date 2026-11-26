import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { test } from "node:test";
import type { PreparedGameSetup } from "@tk-reawakened/editor-model";
import { replaceSetupFile, saveSetupWithSaveAs, type SetupSavePort, type SetupWritePort } from "../src/setup-save.ts";

function setup(): PreparedGameSetup {
  return {
    artifact: { fileName: "game.setup.zip", bytes: new TextEncoder().encode("setup archive") },
    package: { fileName: "game.tpk", bytes: new TextEncoder().encode("package") },
    descriptor: { fileName: "game.tpk.json", bytes: new TextEncoder().encode("descriptor") },
    instructions: { fileName: "README.txt", bytes: new TextEncoder().encode("instructions") },
  };
}

/** A fake host whose destination holds `existing` until a replacement succeeds. */
function port(options: { readonly existing?: string; readonly overrides?: Partial<SetupSavePort<string>> } = {}) {
  let stored = options.existing;
  const replaced: Uint8Array[] = [];
  const value: SetupSavePort<string> = {
    chooseDestination: async () => "project/.tkr-exports/game.setup.zip",
    fileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    describe: (path) => path,
    validateDestination: async () => undefined,
    inspect: async () => stored === undefined ? "missing" : "file",
    confirmReplace: async () => true,
    replace: async (_destination, bytes) => { replaced.push(bytes); stored = new TextDecoder().decode(bytes); },
    ...options.overrides,
  };
  return { value, replaced, stored: () => stored };
}

test("the setup Save As suggests the setup ZIP name and writes one reviewed archive", async () => {
  let suggested = "";
  const host = port({ overrides: { chooseDestination: async (name) => { suggested = name; return "out/game.setup.zip"; } } });
  const result = await saveSetupWithSaveAs(host.value, setup());
  ok(result.ok);
  equal(suggested, "game.setup.zip");
  deepEqual(host.replaced.map((bytes) => new TextDecoder().decode(bytes)), ["setup archive"]);
  if (result.ok) {
    ok(result.message.includes("Setup saved to out/game.setup.zip"));
    ok(result.message.includes("game.tpk") && result.message.includes("README.txt"));
    ok(result.message.includes("Nothing was signed"));
  }
});

test("cancelling the setup save writes nothing and keeps the previous ZIP", async () => {
  const untouched = port({ existing: "previous setup", overrides: { chooseDestination: async () => undefined } });
  const first = await saveSetupWithSaveAs(untouched.value, setup());
  equal(first.ok, false);
  if (!first.ok) equal(first.cancelled, true);
  equal(untouched.replaced.length, 0);
  equal(untouched.stored(), "previous setup");

  const declined = port({ existing: "previous setup", overrides: { confirmReplace: async () => false } });
  const second = await saveSetupWithSaveAs(declined.value, setup());
  equal(second.ok, false);
  if (!second.ok) equal(second.cancelled, true);
  equal(declined.replaced.length, 0);
  equal(declined.stored(), "previous setup");
});

test("a failed setup write leaves the previous ZIP and reports the cause", async () => {
  const host = port({ existing: "previous setup", overrides: { replace: async () => { throw new Error("disk full"); } } });
  const result = await saveSetupWithSaveAs(host.value, setup());
  equal(result.ok, false);
  if (!result.ok) {
    ok(result.message.includes("disk full"));
    ok(result.message.includes("previous setup file, if any, was left unchanged"));
  }
  equal(host.stored(), "previous setup");
});

test("the setup save refuses symbolic links, non-file destinations, and non-reserved project folders", async () => {
  for (const kind of ["link", "directory", "other"] as const) {
    const host = port({ existing: "previous setup", overrides: { inspect: async () => kind } });
    const result = await saveSetupWithSaveAs(host.value, setup());
    equal(result.ok, false);
    if (!result.ok) ok(kind === "link" ? result.message.includes("symbolic link") : result.message.includes("not a regular file"));
    equal(host.replaced.length, 0);
    equal(host.stored(), "previous setup");
  }
  const outside = port({ overrides: { validateDestination: async () => "Choose .tkr-exports under this project or save outside the project folder." } });
  const refused = await saveSetupWithSaveAs(outside.value, setup());
  equal(refused.ok, false);
  if (!refused.ok) ok(refused.message.includes("save outside the project folder"));
  equal(outside.replaced.length, 0);
});

test("a setup write stages beside the destination, then renames the finished file into place", async () => {
  const files = new Map<string, string>([["out/game.setup.zip", "previous setup"]]);
  const calls: string[] = [];
  const port: SetupWritePort<string> = {
    write: async (staging, bytes) => { calls.push(`write:${staging}`); files.set(staging, new TextDecoder().decode(bytes)); },
    rename: async (staging, destination) => { calls.push(`rename:${staging}->${destination}`); files.delete(staging); files.set(destination, "new setup"); },
    remove: async (staging) => { calls.push(`remove:${staging}`); files.delete(staging); },
    stagingName: () => "game.setup.zip.partial-fixed",
    sibling: (destination, name) => `${destination.slice(0, destination.lastIndexOf("/") + 1)}${name}`,
  };
  await replaceSetupFile(port, "out/game.setup.zip", new TextEncoder().encode("new setup"));
  deepEqual(calls, ["write:out/game.setup.zip.partial-fixed", "rename:out/game.setup.zip.partial-fixed->out/game.setup.zip"]);
  equal(files.get("out/game.setup.zip"), "new setup");
  equal(files.has("out/game.setup.zip.partial-fixed"), false, "the staging file never survives the rename");
});

test("a failed setup write or rename keeps the previous ZIP and removes only its staging file", async () => {
  const writeFailure = new Map<string, string>([["out/game.setup.zip", "previous setup"]]);
  const writePort: SetupWritePort<string> = {
    write: async (staging) => { writeFailure.set(staging, "partial"); throw new Error("disk full"); },
    rename: async () => { throw new Error("the rename must not run after a failed write"); },
    remove: async (staging) => { writeFailure.delete(staging); },
    stagingName: () => "game.setup.zip.partial-fixed",
    sibling: (destination, name) => `${destination.slice(0, destination.lastIndexOf("/") + 1)}${name}`,
  };
  await rejects(() => replaceSetupFile(writePort, "out/game.setup.zip", new TextEncoder().encode("new setup")), /disk full/);
  equal(writeFailure.get("out/game.setup.zip"), "previous setup", "the destination is untouched by a failed write");

  const renameFailure = new Map<string, string>([["out/game.setup.zip", "previous setup"]]);
  const removed: string[] = [];
  const renamePort: SetupWritePort<string> = {
    write: async (staging) => { renameFailure.set(staging, "new setup"); },
    rename: async () => { throw new Error("rename refused"); },
    remove: async (staging) => { removed.push(staging); renameFailure.delete(staging); },
    stagingName: () => "game.setup.zip.partial-fixed",
    sibling: (destination, name) => `${destination.slice(0, destination.lastIndexOf("/") + 1)}${name}`,
  };
  await rejects(() => replaceSetupFile(renamePort, "out/game.setup.zip", new TextEncoder().encode("new setup")), /rename refused/);
  equal(renameFailure.get("out/game.setup.zip"), "previous setup", "the destination is untouched by a failed rename");
  deepEqual(removed, ["out/game.setup.zip.partial-fixed"], "the staging file this save created is removed");
});
