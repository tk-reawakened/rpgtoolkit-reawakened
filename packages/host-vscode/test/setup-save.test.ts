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

const destination = "project/.tkr-exports/game.setup.zip";

/** An in-memory host whose move operation has the same non-overwriting contract as the VS Code adapter. */
function port(options: {
  readonly existing?: string;
  readonly overrides?: Partial<Omit<SetupSavePort<string>, "replace">>;
  readonly writeOverrides?: Partial<SetupWritePort<string>>;
} = {}) {
  const files = new Map<string, string>();
  if (options.existing !== undefined) files.set(destination, options.existing);
  const replaced: Uint8Array[] = [];
  const writePort: SetupWritePort<string> = {
    write: async (staging, bytes) => { files.set(staging, new TextDecoder().decode(bytes)); },
    rename: async (source, target) => {
      if (files.has(target)) throw new Error(`destination already exists: ${target}`);
      const contents = files.get(source);
      if (contents === undefined) throw new Error(`source does not exist: ${source}`);
      files.delete(source);
      files.set(target, contents);
    },
    remove: async (path) => {
      if (!files.delete(path)) throw new Error(`file does not exist: ${path}`);
    },
    stagingName: () => "game.setup.zip.partial-fixed",
    sibling: (path, name) => `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`,
    describe: (path) => path,
    ...options.writeOverrides,
  };
  const value: SetupSavePort<string> = {
    chooseDestination: async () => destination,
    fileName: (path) => path.slice(path.lastIndexOf("/") + 1),
    describe: (path) => path,
    validateDestination: async () => undefined,
    inspect: async (path) => files.has(path) ? "file" : "missing",
    confirmReplace: async () => true,
    replace: async (path, bytes, replaceExisting) => {
      replaced.push(bytes);
      return replaceSetupFile(writePort, path, bytes, replaceExisting);
    },
    ...options.overrides,
  };
  return { value, files, replaced, writePort };
}

test("the setup Save As suggests the ZIP name and writes one reviewed archive", async () => {
  let suggested = "";
  const host = port({ overrides: { chooseDestination: async (name) => { suggested = name; return destination; } } });
  const result = await saveSetupWithSaveAs(host.value, setup());
  ok(result.ok);
  equal(suggested, "game.setup.zip");
  deepEqual(host.replaced.map((bytes) => new TextDecoder().decode(bytes)), ["setup archive"]);
  equal(host.files.get(destination), "setup archive");
  if (result.ok) {
    ok(result.message.includes(`Setup saved to ${destination}`));
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
  equal(untouched.files.get(destination), "previous setup");

  const declined = port({ existing: "previous setup", overrides: { confirmReplace: async () => false } });
  const second = await saveSetupWithSaveAs(declined.value, setup());
  equal(second.ok, false);
  if (!second.ok) equal(second.cancelled, true);
  equal(declined.replaced.length, 0);
  equal(declined.files.get(destination), "previous setup");
});

test("a failed setup write removes only its owned partial staging file", async () => {
  const host = port({
    existing: "previous setup",
    writeOverrides: {
      write: async (staging) => { host.files.set(staging, "partial"); throw new Error("disk full"); },
    },
  });
  const result = await saveSetupWithSaveAs(host.value, setup());
  equal(result.ok, false);
  if (!result.ok) ok(result.message.includes("disk full"));
  equal(host.files.get(destination), "previous setup");
  equal(host.files.has(`${destination}.partial-fixed`), false);
});

test("the setup save refuses symbolic links, non-file destinations, and invalid project folders", async () => {
  for (const kind of ["link", "directory", "other"] as const) {
    const host = port({ existing: "previous setup", overrides: { inspect: async () => kind } });
    const result = await saveSetupWithSaveAs(host.value, setup());
    equal(result.ok, false);
    if (!result.ok) ok(kind === "link" ? result.message.includes("symbolic link") : result.message.includes("not a regular file"));
    equal(host.replaced.length, 0);
    equal(host.files.get(destination), "previous setup");
  }
  const outside = port({ overrides: { validateDestination: async () => "Choose .tkr-exports under this project or save outside the project folder." } });
  const refused = await saveSetupWithSaveAs(outside.value, setup());
  equal(refused.ok, false);
  if (!refused.ok) ok(refused.message.includes("save outside the project folder"));
  equal(outside.replaced.length, 0);
});

test("confirmed replacement stages, moves old bytes to a sibling backup, then publishes and removes it", async () => {
  const files = new Map<string, string>([[destination, "previous setup"]]);
  const calls: string[] = [];
  const filePort: SetupWritePort<string> = {
    write: async (staging, bytes) => { calls.push(`write:${staging}`); files.set(staging, new TextDecoder().decode(bytes)); },
    rename: async (source, target) => {
      calls.push(`rename:${source}->${target}`);
      if (files.has(target)) throw new Error(`destination already exists: ${target}`);
      const contents = files.get(source);
      if (contents === undefined) throw new Error(`source does not exist: ${source}`);
      files.delete(source);
      files.set(target, contents);
    },
    remove: async (path) => { calls.push(`remove:${path}`); files.delete(path); },
    stagingName: () => "game.setup.zip.partial-unique",
    sibling: (path, name) => `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`,
    describe: (path) => path,
  };
  const warning = await replaceSetupFile(filePort, destination, new TextEncoder().encode("new setup"), true);
  equal(warning, null);
  deepEqual(calls, [
    "write:project/.tkr-exports/game.setup.zip.partial-unique",
    "rename:project/.tkr-exports/game.setup.zip->project/.tkr-exports/game.setup.zip.partial-unique.previous",
    "rename:project/.tkr-exports/game.setup.zip.partial-unique->project/.tkr-exports/game.setup.zip",
    "remove:project/.tkr-exports/game.setup.zip.partial-unique.previous",
  ]);
  equal(files.get(destination), "new setup");
  equal(files.has("project/.tkr-exports/game.setup.zip.partial-unique"), false);
  equal(files.has("project/.tkr-exports/game.setup.zip.partial-unique.previous"), false);
});

test("a non-replacing publish rejects an existing destination without overwriting it", async () => {
  const host = port({ existing: "arrived after inspection" });
  await rejects(
    () => replaceSetupFile(host.writePort, destination, new TextEncoder().encode("new setup"), false),
    /destination already exists/,
  );
  equal(host.files.get(destination), "arrived after inspection");
  equal(host.files.has("project/.tkr-exports/game.setup.zip.partial-fixed"), false);
});

test("a failed publish restores the old setup without overwriting the destination", async () => {
  const host = port({
    existing: "previous setup",
    writeOverrides: {
      rename: async (source, target) => {
        if (source.endsWith(".partial-fixed") && target === destination) throw new Error("publish refused");
        if (host.files.has(target)) throw new Error(`destination already exists: ${target}`);
        const contents = host.files.get(source);
        if (contents === undefined) throw new Error(`source does not exist: ${source}`);
        host.files.delete(source);
        host.files.set(target, contents);
      },
    },
  });
  await rejects(() => replaceSetupFile(host.writePort, destination, new TextEncoder().encode("new setup"), true), /publish refused/);
  equal(host.files.get(destination), "previous setup");
  equal(host.files.has("project/.tkr-exports/game.setup.zip.partial-fixed.previous"), false);
  equal(host.files.has("project/.tkr-exports/game.setup.zip.partial-fixed"), false);
});

test("a refused rollback preserves the previous ZIP at its exact backup path and reports why", async () => {
  const host = port({
    existing: "previous setup",
    writeOverrides: {
      rename: async (source, target) => {
        if (source.endsWith(".partial-fixed") && target === destination) {
          host.files.set(destination, "file arrived during publish");
          throw new Error("publish refused");
        }
        if (host.files.has(target)) throw new Error(`destination already exists: ${target}`);
        const contents = host.files.get(source);
        if (contents === undefined) throw new Error(`source does not exist: ${source}`);
        host.files.delete(source);
        host.files.set(target, contents);
      },
    },
  });
  await rejects(
    () => replaceSetupFile(host.writePort, destination, new TextEncoder().encode("new setup"), true),
    (error: unknown) => error instanceof Error
      && error.message.includes("game.setup.zip.partial-fixed.previous")
      && error.message.includes("publish refused")
      && error.message.includes("destination already exists"),
  );
  equal(host.files.get(destination), "file arrived during publish");
  equal(host.files.get("project/.tkr-exports/game.setup.zip.partial-fixed.previous"), "previous setup");
  equal(host.files.has("project/.tkr-exports/game.setup.zip.partial-fixed"), false);
});

test("an ambiguous backup move failure reports its potential recovery path without deleting it", async () => {
  const host = port({
    existing: "previous setup",
    writeOverrides: {
      rename: async (source, target) => {
        if (target.endsWith(".previous")) {
          const contents = host.files.get(source);
          if (contents !== undefined) {
            host.files.delete(source);
            host.files.set(target, contents);
          }
          throw new Error("provider rejected final resolve");
        }
        if (host.files.has(target)) throw new Error(`destination already exists: ${target}`);
        const contents = host.files.get(source);
        if (contents === undefined) throw new Error(`source does not exist: ${source}`);
        host.files.delete(source);
        host.files.set(target, contents);
      },
    },
  });
  await rejects(
    () => replaceSetupFile(host.writePort, destination, new TextEncoder().encode("new setup"), true),
    (error: unknown) => error instanceof Error
      && error.message.includes("game.setup.zip.partial-fixed.previous")
      && error.message.includes("provider rejected final resolve"),
  );
  equal(host.files.has(destination), false);
  equal(host.files.get("project/.tkr-exports/game.setup.zip.partial-fixed.previous"), "previous setup");
  equal(host.files.has("project/.tkr-exports/game.setup.zip.partial-fixed"), false);
});

test("a successful replacement reports the path and reason if old-backup cleanup fails", async () => {
  const host = port({
    existing: "previous setup",
    writeOverrides: {
      remove: async (path) => {
        if (path.endsWith(".previous")) throw new Error("cleanup denied");
        host.files.delete(path);
      },
    },
  });
  const result = await replaceSetupFile(host.writePort, destination, new TextEncoder().encode("new setup"), true);
  ok(result?.includes("game.setup.zip.partial-fixed.previous"));
  ok(result.includes("cleanup denied"));
  equal(host.files.get(destination), "new setup");
  equal(host.files.get("project/.tkr-exports/game.setup.zip.partial-fixed.previous"), "previous setup");
});
