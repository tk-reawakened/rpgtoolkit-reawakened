import assert from "node:assert/strict";
import test from "node:test";
import { createRunHandle, platformError, platformOk, type PlatformResult, type RunHandle, type RunSnapshot, type RunStatus } from "@tk-reawakened/platform-services";
import { RunDebugSession } from "../src/run-debug-adapter.ts";

const SNAPSHOT: RunSnapshot = {
  kind: "board", project: "file:///work/quest", targets: [{ path: "Main/quest.gam", sha256: "a".repeat(64) }],
  manifest: "b".repeat(64), manifestFiles: 3, start: { board: "Boards/village.brd", x: 2, y: 2, layer: 1 }, party: ["Chrs/ada.tem"],
  seed: 23, fixture: null, fixtureSettings: null, runner: "runner-web", stateHash: null,
};

type Message = Record<string, unknown> & { type: string; event?: string; command?: string; success?: boolean; body?: Record<string, unknown> };

/** A session over a fake run service: each start makes a new handle (a new snapshot) and records what it was given. */
function harness(results: Array<"ok" | "refuse"> = ["ok", "ok"]) {
  const sent: Message[] = [];
  const started: Array<Readonly<Record<string, unknown>>> = [];
  const runs: Array<{ handle: RunHandle; report(status: Partial<RunStatus>): void; stopped: boolean }> = [];
  const session = new RunDebugSession(async (configuration): Promise<PlatformResult<RunHandle>> => {
    started.push(configuration);
    if (results.shift() === "refuse") return platformError("unavailable", "A saved file changed while the run was being prepared; run it again.");
    const run = { stopped: false } as { handle: RunHandle; report(status: Partial<RunStatus>): void; stopped: boolean };
    const made = createRunHandle({ ...SNAPSHOT, seed: SNAPSHOT.seed + runs.length }, () => { run.stopped = true; });
    run.handle = made.handle;
    run.report = made.report;
    runs.push(run);
    return platformOk(made.handle);
  }, (message) => sent.push(message as Message));
  let seq = 1;
  const request = async (command: string, args?: unknown): Promise<Message> => {
    const id = seq++;
    session.handle({ seq: id, type: "request", command, arguments: args });
    for (let turn = 0; turn < 20; turn += 1) {
      const response = sent.find((message) => message.type === "response" && message.request_seq === id);
      if (response !== undefined) return response;
      await Promise.resolve();
    }
    throw new Error(`no response to ${command}`);
  };
  const events = (name: string) => sent.filter((message) => message.type === "event" && message.event === name);
  const console = () => events("output").map((message) => String(message.body?.output)).join("");
  return { session, sent, started, runs, request, events, console };
}

test("initialize declares restart and terminate, no breakpoints, then says it is initialized", async () => {
  const run = harness();
  const response = await run.request("initialize", { adapterID: "tkr" });
  assert.equal(response.success, true);
  assert.deepEqual(response.body, { supportsConfigurationDoneRequest: true, supportsRestartRequest: true, supportsTerminateRequest: true });
  assert.equal(run.events("initialized").length, 1);
  const breakpoints = await run.request("setBreakpoints", { source: { path: "/work/quest/Prg/a.prg" }, breakpoints: [{ line: 3 }] });
  assert.deepEqual((breakpoints.body?.breakpoints as Array<{ verified: boolean; line: number }>).map(({ verified, line }) => ({ verified, line })), [{ verified: false, line: 3 }]);
  assert.deepEqual((await run.request("threads")).body, { threads: [] });
  assert.equal((await run.request("stepIn")).success, false);
});

test("launch starts one run, shows its snapshot, and reports state and diagnostics to the Debug Console", async () => {
  const run = harness();
  await run.request("initialize");
  const response = await run.request("launch", { launch: "board", name: "Test board" });
  assert.equal(response.success, true);
  assert.deepEqual(run.started, [{ launch: "board", name: "Test board" }]);
  assert.match(run.console(), /Run snapshot: board launch, runner runner-web, seed 23\./);
  assert.match(run.console(), /Main\/quest\.gam {2}sha256 a{64}/);
  run.runs[0]!.report({ state: "running", tick: 4, board: "Boards/village.brd" });
  run.runs[0]!.report({ tick: 5 });
  run.runs[0]!.report({ diagnostics: [{ code: "E-UNKNOWN-COMMAND", file: "Prg/a.prg", line: 7, message: "Unknown command Foo" }] });
  const output = run.console();
  assert.equal(output.match(/Running at tick/g)?.length, 1, "a tick alone is not a state change");
  assert.match(output, /Running at tick 4 on Boards\/village\.brd\./);
  const diagnostic = run.events("output").find((message) => message.body?.category === "stderr");
  assert.equal(diagnostic?.body?.output, "Prg/a.prg:7: E-UNKNOWN-COMMAND: Unknown command Foo\n");
  assert.deepEqual(diagnostic?.body?.source, { name: "a.prg", path: "Prg/a.prg" });
  assert.equal(run.events("terminated").length, 0);
});

test("a run that ends, or whose tab is closed, ends the debug session", async () => {
  const run = harness();
  await run.request("launch", { launch: "game" });
  run.runs[0]!.report({ state: "ended", message: "The player closed.", stateHash: "0123456789abcdef" });
  assert.deepEqual(run.events("exited").map((message) => message.body), [{ exitCode: 0 }]);
  assert.equal(run.events("terminated").length, 1);
  assert.match(run.console(), /Run ended at tick 0: The player closed\. State hash 0123456789abcdef\./);
});

test("Stop from the toolbar stops the run handle", async () => {
  const run = harness();
  await run.request("launch", { launch: "game" });
  const response = await run.request("terminate");
  assert.equal(response.success, true);
  assert.equal(run.runs[0]!.stopped, true);
  assert.equal(run.runs[0]!.handle.status().state, "ended");
  assert.equal(run.events("terminated").length, 1);
  await run.request("disconnect");
  assert.equal(run.events("terminated").length, 1);
});

test("Restart stops the old run and starts the configuration again with a new snapshot", async () => {
  const run = harness();
  await run.request("launch", { launch: "game", main: "Main/quest.gam" });
  const response = await run.request("restart", { arguments: { launch: "game", main: "Main/quest.gam", seed: 4 } });
  assert.equal(response.success, true);
  assert.equal(run.runs.length, 2);
  assert.equal(run.runs[0]!.stopped, true);
  assert.equal(run.runs[1]!.stopped, false);
  assert.notDeepEqual(run.runs[1]!.handle.snapshot, run.runs[0]!.handle.snapshot);
  assert.deepEqual(run.started.at(-1), { launch: "game", main: "Main/quest.gam", seed: 4 });
  assert.equal(run.events("terminated").length, 0, "the old run's end does not end the session");
  run.runs[1]!.report({ state: "failed", message: "Missing board." });
  assert.deepEqual(run.events("exited").map((message) => message.body), [{ exitCode: 1 }]);
  assert.equal(run.events("terminated").length, 1);
});

test("a refused start answers the launch with the run service's reason", async () => {
  const run = harness(["refuse"]);
  const response = await run.request("launch", { launch: "game" });
  assert.equal(response.success, false);
  assert.match(String(response.message), /saved file changed/);
  assert.equal(run.runs.length, 0);
});

test("a run that starts after the session was stopped is stopped at once", async () => {
  const run = harness();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const session = new RunDebugSession(async () => {
    await gate;
    const made = createRunHandle(SNAPSHOT, () => {});
    run.runs.push({ handle: made.handle, report: made.report, stopped: false });
    return platformOk(made.handle);
  }, (message) => run.sent.push(message as Message));
  session.handle({ seq: 1, type: "request", command: "launch", arguments: {} });
  session.dispose();
  release();
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  assert.equal(run.runs[0]?.handle.status().state, "ended");
});
