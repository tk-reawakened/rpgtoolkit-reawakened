// The launcher (T-07, T-41; ADR 0022 D8): a launch the host cannot do is refused with its reason before anything is
// saved, unsaved work is saved before the run, a failed save stops the run and names the document, and the run reads
// exactly the saved revision.
import { createHash } from "node:crypto";
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import type { Capability, GameLaunch, ProgramLaunch } from "@tk-reawakened/platform-services";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentWorkspace, createLauncher } from "../src/index.ts";
import { exampleMain, titleOf, withTitle } from "./fixtures.ts";

const MAIN = "Main/example.gam";
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const game: GameLaunch = { kind: "game", main: MAIN, projectFolder: "" };
const program: ProgramLaunch = { kind: "program", main: MAIN, projectFolder: "", program: "Prg/hello.prg", fixture: { id: "fixture", party: [] } };

async function setUp(capabilities: readonly Capability[] = ["folderWrite", "runGame", "runBoard", "runProgram"]) {
  const host = createMemoryPlatformServices({
    files: { [MAIN]: exampleMain(9), "Prg/hello.prg": new Uint8Array([0x31]), "Boards/a.brd": new Uint8Array([2]) },
    capabilities,
    runRefusal: "its runner boots only from the main file.",
  });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(MAIN);
  ok(opened.ok);
  const launcher = createLauncher({ services: host, workspace });
  return { host, workspace, document: opened.document, launcher };
}

test("unsaved work is saved before the run, and the run reads exactly that revision (D8.2, D8.3)", async () => {
  const { host, document, launcher } = await setUp();
  ok(document.apply({ type: "set-game-title", title: "Saved before run" }).ok);
  const outcome = await launcher.launch(game);
  ok(outcome.ok);
  const saved = host.bytesOf(MAIN)!;
  equal(titleOf(saved), "Saved before run");
  equal(document.getSnapshot().dirty, false);
  deepEqual(outcome.handle.snapshot.targets, [{ path: MAIN, sha256: sha(saved) }], "the snapshot identifies the saved revision");
  deepEqual(host.runs[0]!.files.get(MAIN), saved);
});

test("a failed save stops the launch and names the document; nothing runs from unsaved memory", async () => {
  const { host, document, launcher } = await setUp();
  const before = host.bytesOf(MAIN)!;
  ok(document.apply({ type: "set-game-title", title: "Never ran" }).ok);
  host.failWrites({ code: "permission-denied", message: "the disk is read-only" });
  const outcome = await launcher.launch(game);
  ok(!outcome.ok);
  equal(outcome.reason, "save-failed");
  ok(outcome.reason === "save-failed" && outcome.document === MAIN);
  ok(outcome.message.startsWith(`${MAIN} could not be saved`), outcome.message);
  equal(host.runs.length, 0, "the stale revision on disk was not launched");
  deepEqual(host.bytesOf(MAIN), before);
  equal(document.getSnapshot().dirty, true, "the work stays");
});

test("a document still unsaved after saving stops the launch", async () => {
  const { host, document } = await setUp();
  ok(document.apply({ type: "set-game-title", title: "Edited while saving" }).ok);
  // A workspace whose save finished before this edit: the document is still dirty when the launcher checks.
  const launcher = createLauncher({ services: host, workspace: { saveAll: async () => [], documents: () => [document] } });
  const outcome = await launcher.launch(game);
  ok(!outcome.ok);
  equal(outcome.reason, "unsaved");
  equal(host.runs.length, 0);
});

test("an edit saved during snapshot preparation prevents the stale snapshot from starting", async () => {
  const { host, document, launcher } = await setUp();
  const originalRead = host.fs.readProject.bind(host.fs);
  let resume!: () => void;
  let observed!: () => void;
  const blocked = new Promise<void>((resolve) => { observed = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  let first = true;
  Object.defineProperty(host.fs, "readProject", { configurable: true, value: async (project: string, path: string) => {
    const result = await originalRead(project, path);
    if (first) { first = false; observed(); await release; }
    return result;
  } });
  const pending = launcher.launch(game);
  await blocked;
  ok(document.apply({ type: "set-game-title", title: "Changed during preparation" }).ok);
  ok((await document.save()).ok, "even a clean newer revision must invalidate the older snapshot");
  resume();
  const outcome = await pending;
  ok(!outcome.ok);
  equal(outcome.reason, "unsaved");
  equal(host.runs.length, 0);
});

test("a launch the host cannot do is refused with the host's reason, before anything is saved (D8.6)", async () => {
  const { host, document, launcher } = await setUp(["folderWrite", "runGame"]);
  equal(launcher.unavailable("game"), null);
  equal(launcher.unavailable("program"), "This host cannot run a program test: its runner boots only from the main file.");
  ok(document.apply({ type: "set-game-title", title: "Not saved by a refused launch" }).ok);
  const outcome = await launcher.launch(program);
  ok(!outcome.ok);
  equal(outcome.reason, "unavailable");
  equal(outcome.message, "This host cannot run a program test: its runner boots only from the main file.");
  equal(titleOf(host.bytesOf(MAIN)!), titleOf(exampleMain(9)), "a refused launch saves nothing");
  equal(document.getSnapshot().dirty, true);

  const bare = createLauncher({ services: createMemoryPlatformServices(), workspace: { saveAll: async () => [], documents: () => [] } });
  equal(bare.unavailable("board"), "This host cannot start a board test: it has no game runner.");
});

test("a launch naming a file the project lacks is refused with the host's sentence", async () => {
  const { launcher } = await setUp();
  const outcome = await launcher.launch({ kind: "board", main: MAIN, projectFolder: "", start: { board: "Boards/none.brd", x: 1, y: 1, layer: 1 }, party: ["Chrs/hero.tem"] });
  ok(!outcome.ok);
  equal(outcome.reason, "refused");
  equal(outcome.message, "The run needs the board Boards/none.brd, which the project does not have.");
});

test("a later edit and save never reach the running game; a new launch is a new snapshot (D8.4)", async () => {
  const { host, document, launcher } = await setUp();
  const first = await launcher.launch(game);
  ok(first.ok);
  ok(document.apply({ type: "set-game-title", title: "After the run started" }).ok);
  const second = await launcher.launch(game);
  ok(second.ok);
  deepEqual(host.runs[0]!.files.get(MAIN), exampleMain(9));
  deepEqual(host.runs[1]!.files.get(MAIN), withTitle(exampleMain(9), "After the run started"));
  ok(first.handle.snapshot.targets[0]!.sha256 !== second.handle.snapshot.targets[0]!.sha256);
});
