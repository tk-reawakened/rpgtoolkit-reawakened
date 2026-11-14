// The `run` surface (AD-20, ADR 0022 D8): the three launches stay distinct, a launch the host cannot do is refused with
// its reason, a file the launch names that the project lacks is refused by name, and a run is given a frozen copy of the
// saved files with a snapshot that identifies them by SHA-256.
import { test } from "node:test";
import { createHash } from "node:crypto";
import { deepEqual, equal, notDeepEqual, notEqual, ok } from "node:assert/strict";
import { prepareRun, type GameLaunch, type ProgramLaunch, type RunStatus } from "../src/index.ts";
import { createMemoryPlatformServices } from "../src/testing.ts";

const text = (value: string): Uint8Array => new Uint8Array([...value].map((character) => character.charCodeAt(0)));
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const FILES = {
  "Main/game.gam": text("main"),
  "Boards/start.brd": text("start board"),
  "Boards/cave.brd": text("cave board"),
  "Prg/hello.prg": text("mwin(\"hi\");"),
  "Prg/sys_test.prg": text("creator's own program"),
  "Chrs/hero.tem": text("hero"),
  "Bitmap/window.png": text("window"),
};
const ALL_RUNS = ["runGame", "runBoard", "runProgram"] as const;
const game: GameLaunch = { kind: "game", main: "Main/game.gam", projectFolder: "" };
const program: ProgramLaunch = {
  kind: "program",
  main: "Main/game.gam",
  projectFolder: "",
  program: "Prg/hello.prg",
  fixture: { id: "editor test settings", font: "Arial", fontSize: 14, windowGraphic: "Bitmap/window.png", party: ["Chrs/hero.tem"], start: { board: "Boards/cave.brd", x: 9, y: 5, layer: 1 } },
};

test("a game run records its kind, the main file's SHA-256 and a manifest over the rest, and no start", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  ok(host.run);
  const started = await host.run.startGame(game);
  ok(started.ok);
  const snapshot = started.value.snapshot;
  equal(snapshot.kind, "game");
  equal(snapshot.project, "memory-project");
  deepEqual(snapshot.targets, [{ path: "Main/game.gam", sha256: sha(FILES["Main/game.gam"]) }]);
  equal(snapshot.manifestFiles, 6);
  equal(snapshot.start, null);
  deepEqual(snapshot.party, []);
  equal(snapshot.seed, 0);
  equal(snapshot.fixture, null);
  equal(snapshot.runner, "memory-runner");
  equal(started.value.status().state, "running");
});

test("game, board and program launches are distinct: each records its own kind, targets and start", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  const board = await host.run!.startGame({ kind: "board", main: "Main/game.gam", projectFolder: "", start: { board: "boards/START.brd", x: 3, y: 4, layer: 1 }, party: ["Chrs/hero.tem"], seed: 7 });
  ok(board.ok);
  equal(board.value.snapshot.kind, "board");
  deepEqual(board.value.snapshot.targets.map((target) => target.path), ["Main/game.gam", "Boards/start.brd"], "paths are reported as stored");
  deepEqual(board.value.snapshot.start, { board: "Boards/start.brd", x: 3, y: 4, layer: 1 }, "a board launch identifies where it starts");
  deepEqual(board.value.snapshot.party, ["Chrs/hero.tem"]);
  equal(board.value.snapshot.seed, 7);

  const tested = await host.run!.startProgram(program);
  ok(tested.ok);
  equal(tested.value.snapshot.kind, "program");
  deepEqual(tested.value.snapshot.targets, [
    { path: "Main/game.gam", sha256: sha(FILES["Main/game.gam"]) },
    { path: "Prg/hello.prg", sha256: sha(FILES["Prg/hello.prg"]) },
    { path: "Boards/cave.brd", sha256: sha(FILES["Boards/cave.brd"]) },
  ]);
  equal(tested.value.snapshot.fixture, "editor test settings");
  equal(tested.value.snapshot.manifestFiles, 4);
  notEqual(board.value.snapshot.manifest, tested.value.snapshot.manifest, "different targets leave different files in the manifest");
});

test("program snapshots retain the complete fixture, including every setting that changes execution", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  const first = await host.run!.startProgram(program);
  ok(first.ok);
  deepEqual(first.value.snapshot.fixtureSettings, program.fixture);
  for (const fixture of [
    { ...program.fixture, font: "Another Font" },
    { ...program.fixture, fontSize: 18 },
    { id: program.fixture.id, font: "Arial", fontSize: 14, party: program.fixture.party, start: program.fixture.start! },
  ]) {
    const other = await host.run!.startProgram({ ...program, fixture });
    ok(other.ok);
    notDeepEqual(other.value.snapshot, first.value.snapshot);
    equal(other.value.snapshot.fixture, first.value.snapshot.fixture, "the reference is preserved even when its contents change");
  }
});

test("a launch the host does not declare is refused with its reason, and nothing runs", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ["runGame"], runRefusal: "its runner boots only from the main file." });
  const refused = await host.run!.startProgram(program);
  ok(!refused.ok);
  equal(refused.error.code, "unavailable");
  equal(refused.error.message, "This host cannot run a program test: its runner boots only from the main file.");
  equal(host.runs.length, 0);
  equal(createMemoryPlatformServices({ files: FILES }).run, undefined, "a host that runs nothing has no run surface");
});

test("a file the launch names that the project lacks is refused by name", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  const missingBoard = await host.run!.startGame({ kind: "board", main: "Main/game.gam", projectFolder: "", start: { board: "Boards/gone.brd", x: 1, y: 1, layer: 1 }, party: [] });
  ok(!missingBoard.ok);
  equal(missingBoard.error.code, "not-found");
  equal(missingBoard.error.message, "The run needs the board Boards/gone.brd, which the project does not have.");
  const missingGraphic = await host.run!.startProgram({ ...program, fixture: { ...program.fixture, windowGraphic: "Bitmap/none.png" } });
  ok(!missingGraphic.ok);
  equal(missingGraphic.error.message, "The run needs the fixture window graphic Bitmap/none.png, which the project does not have.");
  const badStart = await host.run!.startGame({ kind: "board", main: "Main/game.gam", projectFolder: "", start: { board: "Boards/start.brd", x: 0, y: 1, layer: 1 }, party: [] });
  ok(!badStart.ok);
  equal(badStart.error.code, "invalid-request");
  equal(host.runs.length, 0);
});

test("a run keeps the bytes it was given: a later save neither reaches it nor keeps its snapshot", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  const first = await host.run!.startGame(game);
  ok(first.ok);
  ok((await host.fs.write("Boards/start.brd", text("edited board"))).ok);
  deepEqual(host.runs[0]!.files.get("Boards/start.brd"), FILES["Boards/start.brd"], "no hot reload (D8.4)");
  const second = await host.run!.startGame(game);
  ok(second.ok);
  deepEqual(second.value.snapshot.targets, first.value.snapshot.targets, "the main file did not change");
  notEqual(second.value.snapshot.manifest, first.value.snapshot.manifest, "the edited board changes the manifest, so the runs are told apart");
});

test("the manifest is SHA-256 over sorted, length-prefixed (path, hash) records", async () => {
  const host = createMemoryPlatformServices({ files: { "Main/game.gam": text("main"), "b": text("B"), "a/c": text("C") } });
  const prepared = await prepareRun(host.fs, game, { projectId: "memory-project", runner: "test" });
  ok(prepared.ok);
  const field = (value: string): string => `${value.length}:${value}`;
  const records = [`${field("b")}${field(sha(text("B")))}`, `${field("a/c")}${field(sha(text("C")))}`].sort();
  equal(prepared.value.snapshot.manifest, sha(text(records.map(field).join(""))));
});

test("a handle reports status changes until the run finishes, and stopping it ends it once", async () => {
  const host = createMemoryPlatformServices({ files: FILES, capabilities: ALL_RUNS });
  const started = await host.run!.startGame(game);
  ok(started.ok);
  const seen: RunStatus["state"][] = [];
  const listener = started.value.onStatus((status) => seen.push(status.state));
  host.runs[0]!.report({ state: "stalled", stalledOn: "Boards/start.brd", tick: 3 });
  equal(started.value.status().stalledOn, "Boards/start.brd");
  host.runs[0]!.report({ state: "running", stalledOn: null, board: "Boards/start.brd", tick: 4 });
  started.value.stop();
  started.value.stop();
  host.runs[0]!.report({ state: "running" });
  listener.dispose();
  deepEqual(seen, ["stalled", "running", "ended"]);
  equal(started.value.status().message, "The run was stopped.");
  ok(host.runs[0]!.stopped());
});
