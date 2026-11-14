import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { savePackageWithSaveAs, type PackageSavePort } from "@tk-reawakened/host-vscode/testing";

interface Destination { readonly path: string }

const descriptor = {
  schema: 1,
  file: "game.tpk",
  sha256: "ab".repeat(32),
  size: 3,
  gameId: "game-id",
  title: "Game",
  version: "1.0.0",
};
const prepared = {
  package: { fileName: "game.tpk", bytes: new Uint8Array([1, 2, 3]) },
  descriptor: { fileName: "game.tpk.json", bytes: new TextEncoder().encode(`${JSON.stringify(descriptor, null, 2)}\n`) },
  includedFiles: ["Main/game.gam"],
  excludedFiles: [],
};

function harness(options: {
  readonly chosen?: string | undefined;
  readonly existing?: readonly string[];
  readonly replace?: boolean;
  readonly failWrite?: (path: string) => boolean;
  readonly failExists?: boolean;
} = {}) {
  const files = new Map<string, Uint8Array>(options.existing?.map((path) => [path, new Uint8Array([9])]) ?? []);
  const asked: string[][] = [];
  const port: PackageSavePort<Destination> = {
    chooseDestination: async () => options.chosen === undefined ? undefined : { path: options.chosen },
    fileName: (destination) => destination.path.slice(destination.path.lastIndexOf("/") + 1),
    sibling: (destination, name) => ({ path: `${destination.path.slice(0, destination.path.lastIndexOf("/") + 1)}${name}` }),
    describe: (destination) => destination.path,
    exists: async (destination) => {
      if (options.failExists === true) throw new Error("stat refused");
      return files.has(destination.path);
    },
    confirmReplace: async (existing) => {
      asked.push(existing.map((destination) => destination.path));
      return options.replace === true;
    },
    write: async (destination, bytes) => {
      if (options.failWrite?.(destination.path) === true) {
        files.set(destination.path, bytes.slice(0, 1));
        throw new Error("disk full");
      }
      files.set(destination.path, bytes.slice());
    },
  };
  return { port, files, asked };
}

const text = (bytes: Uint8Array | undefined): Record<string, unknown> => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

test("Save As writes the package and a descriptor that names the author's chosen file", async () => {
  const { port, files, asked } = harness({ chosen: "/project/Build/renamed.tpk" });
  const saved = await savePackageWithSaveAs(port, prepared);
  ok(saved.ok, saved.message);
  deepEqual(files.get("/project/Build/renamed.tpk"), prepared.package.bytes);
  const written = text(files.get("/project/Build/renamed.tpk.json"));
  equal(written["file"], "renamed.tpk");
  equal(written["sha256"], descriptor.sha256);
  equal(written["version"], "1.0.0");
  deepEqual(asked, [], "nothing existed, so nothing was asked");
});

test("Save As cancelled writes nothing", async () => {
  const { port, files } = harness();
  const saved = await savePackageWithSaveAs(port, prepared);
  equal(saved.ok, false);
  if (!saved.ok) equal(saved.cancelled, true);
  equal(files.size, 0);
});

test("a name that is not .tpk is refused before anything is written", async () => {
  const { port, files } = harness({ chosen: "/project/game.zip" });
  const saved = await savePackageWithSaveAs(port, prepared);
  equal(saved.ok, false);
  if (!saved.ok) {
    equal(saved.cancelled, false);
    match(saved.message, /\.tpk.*Nothing was written/);
  }
  equal(files.size, 0);
});

test("existing outputs are replaced only after the author confirms, and declining leaves them untouched", async () => {
  const declined = harness({ chosen: "/project/game.tpk", existing: ["/project/game.tpk", "/project/game.tpk.json"], replace: false });
  const refused = await savePackageWithSaveAs(declined.port, prepared);
  equal(refused.ok, false);
  if (!refused.ok) equal(refused.cancelled, true);
  deepEqual(declined.asked, [["/project/game.tpk", "/project/game.tpk.json"]]);
  deepEqual(declined.files.get("/project/game.tpk"), new Uint8Array([9]));
  deepEqual(declined.files.get("/project/game.tpk.json"), new Uint8Array([9]));

  const accepted = harness({ chosen: "/project/game.tpk", existing: ["/project/game.tpk.json"], replace: true });
  const replaced = await savePackageWithSaveAs(accepted.port, prepared);
  ok(replaced.ok, replaced.message);
  deepEqual(accepted.asked, [["/project/game.tpk.json"]]);
  deepEqual(accepted.files.get("/project/game.tpk"), prepared.package.bytes);
  equal(text(accepted.files.get("/project/game.tpk.json"))["file"], "game.tpk");
});

test("a destination that cannot be checked is refused rather than overwritten blind", async () => {
  const { port, files } = harness({ chosen: "/project/game.tpk", failExists: true });
  const saved = await savePackageWithSaveAs(port, prepared);
  equal(saved.ok, false);
  if (!saved.ok) match(saved.message, /Could not check .*stat refused.*Nothing was written/);
  equal(files.size, 0);
});

test("a failed descriptor write reports the package as saved and the export as incomplete", async () => {
  const { port, files } = harness({ chosen: "/project/game.tpk", failWrite: (path) => path.endsWith(".json") });
  const saved = await savePackageWithSaveAs(port, prepared);
  equal(saved.ok, false);
  if (!saved.ok) {
    equal(saved.cancelled, false);
    match(saved.message, /package was saved to \/project\/game\.tpk.*descriptor could not be saved.*disk full.*incomplete/);
  }
  deepEqual(files.get("/project/game.tpk"), prepared.package.bytes);
});

test("a failed package write never writes the descriptor", async () => {
  const { port, files } = harness({ chosen: "/project/game.tpk", failWrite: (path) => path.endsWith(".tpk") });
  const saved = await savePackageWithSaveAs(port, prepared);
  equal(saved.ok, false);
  if (!saved.ok) match(saved.message, /Could not save \/project\/game\.tpk.*disk full.*descriptor was not written/);
  equal(files.has("/project/game.tpk.json"), false);
});
