import { deepEqual, equal, notEqual, match, doesNotMatch, rejects } from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server, type Socket } from "node:net";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { runSpecProject, watchSpecProject } from "@tk-reawakened/script-spec";
import { parseArgs, runTest } from "../src/index.ts";

const nested = [
  'describe("outer & more", () => {',
  '  describe("inner", () => {',
  '    it("passes", () => { expect(1).toBe(1) })',
  '    it("fails <bad>", () => { expect(1).toBe(2) })',
  '  })',
  '})',
].join("\n");

const watchTimeout = process.env.TKR_WATCH_CANCELLATION_PROBE === "1" ? 150 : 10000;
const watchDeadlockTimeout = 60000;

function onceStop(stop: () => void): () => void {
  let requested = false;
  return () => {
    if (requested) return;
    requested = true;
    stop();
  };
}

test("repeated output notifications request watch shutdown only once", () => {
  let calls = 0;
  const stop = onceStop(() => { calls++; });
  stop();
  stop();
  stop();
  equal(calls, 1);
});

/** Reap the watcher before removing its directory; preserve the directory if termination itself stalls. */
async function cleanupWatcherChild(child: ChildProcess, closed: Promise<void>, root: string): Promise<void> {
  child.kill("SIGKILL");
  let timer: NodeJS.Timeout | undefined;
  try {
    // A real deadline is required only as a fail-safe if the OS never reaps the killed process.
    await Promise.race([
      closed,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`watch child did not close; preserved ${root}`)); }, 2000);
      }),
    ]);
    rmSync(root, { recursive: true, force: true });
  } finally {
    clearTimeout(timer);
  }
}

test("nested names and selected cases survive every deterministic reporter", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-report-"));
  try {
    writeFileSync(join(root, "nested.spec.prg"), nested);
    const project = runSpecProject(root);
    deepEqual(project.files[0]!.cases.map((item) => [item.groups, item.name, item.ok]), [
      [["outer & more", "inner"], "passes", true],
      [["outer & more", "inner"], "fails <bad>", false],
    ]);
    const selected = runSpecProject(root, { name: "inner > passes" });
    deepEqual(selected.files[0]!.cases.map((item) => item.name), ["passes"]);
    equal(runSpecProject(root, { name: "missing" }).files[0]!.cases.length, 0);
    const spec = runTest([root], true, false);
    equal(spec.result.exitCode, 1);
    match(spec.text, /PASS outer & more > inner > passes/);
    match(spec.text, /FAIL outer & more > inner > fails <bad>/);
    const junit = runTest([root], true, false, "", "junit");
    match(junit.text, /classname="nested.spec.prg &gt; outer &amp; more &gt; inner" name="fails &lt;bad&gt;"/);
    match(junit.text, /<failure>/);
    const xmlCheck = spawnSync("python3", ["-c", "import sys, xml.etree.ElementTree as E; E.fromstring(sys.stdin.read())"], { input: junit.text });
    equal(xmlCheck.status, 0, xmlCheck.stderr.toString());
    equal(junit.text, runTest([root], true, false, "", "junit").text);
    const json = runTest([root], true, true);
    deepEqual((JSON.parse(json.text) as { results: { files: typeof project.files } }).results.files[0]!.cases[0]!.groups, ["outer & more", "inner"]);
    const filtered = runTest([root], true, false, "passes");
    equal(filtered.result.exitCode, 0);
    doesNotMatch(filtered.text, /fails <bad>/);
    const cli = spawnSync(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "script", "test", root, "--name", "passes", "--reporter=json"], { encoding: "utf8" });
    equal(cli.status, 0, cli.stderr);
    match(cli.stdout, /"passes"/);
    doesNotMatch(cli.stdout, /fails <bad>/);
    equal(parseArgs(["node", "tkr", "script", "test", "--reporter", "junit", "--json"]).ok, false);
    writeFileSync(join(root, "focused.spec.prg"), 'only("focus", () => { expect(1).toBe(1) })');
    const focusedJunit = runTest([root], true, false, "", "junit");
    match(focusedJunit.text, /<system-out>only\(\) narrowed the run/);
    writeFileSync(join(root, "empty.spec.prg"), 'value = 1');
    const focused = runSpecProject(root, { name: "not present" });
    equal(focused.failures.length, 1);
    match(focused.failures[0]!, /empty.spec.prg: spec.no-cases/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("watch reruns all files after a real edit without losing other failures", { timeout: watchTimeout }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tkr-watch-"));
  writeFileSync(join(root, "a.spec.prg"), 'it("a", () => { expect(1).toBe(2) })');
  writeFileSync(join(root, "b.spec.prg"), 'it("b", () => { expect(1).toBe(2) })');
  let stop: (() => void) | undefined;
  t.after(() => { stop?.(); rmSync(root, { recursive: true, force: true }); });
  try {
    await new Promise<void>((resolve, reject) => {
      let initial = true;
      const watcher = watchSpecProject(root, {}, (report) => {
        if (initial) { initial = false; return; }
        try {
          equal(report.failures.length, 1);
          match(report.failures[0]!, /b.spec.prg/);
          watcher.close();
          resolve();
        } catch (error) { watcher.close(); reject(error); }
      });
      stop = () => { watcher.close(); };
      watcher.on("error", (error) => { watcher.close(); reject(error); });
      writeFileSync(join(root, "a.spec.prg"), 'it("a", () => { expect(1).toBe(1) })');
    });
  } finally { stop?.(); }
});

test("CLI watch exits with the latest full-run status", { timeout: watchTimeout }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tkr-cli-watch-"));
  const filename = join(root, "case.spec.prg");
  writeFileSync(filename, 'it("case", () => { expect(1).toBe(1) })');
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "script", "test", root, "--watch"], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise<void>((resolve) => { child.once("close", () => { resolve(); }); });
  const stop = onceStop(() => { child.kill("SIGINT"); });
  t.after(() => cleanupWatcherChild(child, closed, root));
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  let output = "";
  let changed = false;
  child.stdout.on("data", (bytes: Buffer) => {
    output += bytes.toString();
    if (!changed && output.includes("1 passed, 0 failed")) {
      changed = true;
      writeFileSync(filename, 'it("case", () => { expect(1).toBe(2) })');
    } else if (changed && output.includes("0 passed, 1 failed")) {
      stop();
    }
  });
  child.on("error", rejectDone);
  child.on("exit", (code, signal) => {
    try {
      equal(signal, null);
      equal(code, 1);
      resolveDone();
    } catch (error) { rejectDone(error); }
  });
  await done;
});

test("JUnit watch replaces one XML report and preserves a focused-run warning", { timeout: process.env.TKR_WATCH_CANCELLATION_PROBE === "1" ? watchTimeout : watchDeadlockTimeout }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tkr-junit-watch-"));
  const filename = join(root, "case.spec.prg");
  const report = join(root, "report.xml");
  writeFileSync(filename, 'only("case", () => { expect(1).toBe(1) })');
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "script", "test", root, "--watch", "--reporter", "junit", "--out", report], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise<void>((resolve) => { child.once("close", () => { resolve(); }); });
  const stop = onceStop(() => { child.kill("SIGINT"); });
  t.after(() => cleanupWatcherChild(child, closed, root));
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  let output = "";
  let stage = 0;
  child.stderr.on("data", (bytes: Buffer) => {
    output += bytes.toString();
    try {
      if (stage === 0 && output.includes("1 passed, 0 failed")) {
        // The first report is emitted after the existing spec file is being watched.
        match(readFileSync(report, "utf8"), /name="case"/);
        stage = 1;
        output = "";
        writeFileSync(filename, 'only("revised", () => { expect(1).toBe(1) })');
      } else if (stage === 1 && output.includes("1 passed, 0 failed")
        && readFileSync(report, "utf8").includes('name="revised"')) {
        stage = 2;
        output = "";
        writeFileSync(filename, 'only("revised", () => { expect(1).toBe(2) })');
      } else if (stage === 2 && output.includes("0 passed, 1 failed")) {
        stop();
      }
    } catch (error) { rejectDone(error); }
  });
  child.on("error", rejectDone);
  child.on("exit", (code, signal) => {
    try {
      equal(signal, null);
      equal(code, 1);
      const text = readFileSync(report, "utf8");
      match(text, /<failure>/);
      match(text, /<system-out>only\(\) narrowed the run/);
      const parsed = spawnSync("python3", ["-c", "import sys, xml.etree.ElementTree as E; E.fromstring(sys.stdin.read())"], { input: text });
      equal(parsed.status, 0, parsed.stderr.toString());
      resolveDone();
    } catch (error) { rejectDone(error); }
  });
  await done;
});

async function runWatchProbe(pattern: string, env: NodeJS.ProcessEnv, sandbox: string, t: TestContext, signal?: AbortSignal, onRoot?: (pid: number) => void): Promise<{ status: number | null; stdout: string; stderr: string }> {
  let server: Server | undefined;
  let releaseBarrier = (): void => {};
  const sockets = new Set<Socket>();
  if (process.platform === "win32") {
    const pipe = `\\\\.\\pipe\\tkr-watch-${process.pid}-${basename(sandbox)}`;
    let released = false;
    server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => { sockets.delete(socket); });
      if (released) socket.end("ready");
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(pipe, resolve);
    });
    releaseBarrier = () => {
      released = true;
      for (const socket of sockets) socket.end("ready");
    };
    env = {
      ...env,
      TKR_WATCH_JOB_PIPE: pipe,
      NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${new URL("./fixtures/watch-job-barrier.mjs", import.meta.url).href}`,
    };
  }
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("./fixtures/watch-supervisor.mjs", import.meta.url)),
    "--test",
    `--test-name-pattern=${pattern}`,
    fileURLToPath(import.meta.url),
  ], { env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr!.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const close = new Promise<void>((resolve) => { child.once("close", () => { resolve(); }); });
  let stopping: Promise<void> | undefined;
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.on("message", (message: { type: string; pid?: number; code?: number | null; message?: string }) => {
      if (message.type === "root" && message.pid !== undefined) onRoot?.(message.pid);
      if (message.type === "exit") resolve(message.code ?? null);
      if (message.type === "error") reject(new Error(message.message));
    });
    child.once("exit", (code, childSignal) => {
      if (stopping === undefined) {
        // The supervisor is the group anchor. Clean up immediately if it dies unexpectedly.
        if (process.platform !== "win32" && child.pid !== undefined) {
          try { process.kill(-child.pid, "SIGKILL"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error); }
        }
        reject(new Error(`watch supervisor exited unexpectedly (${code}, ${childSignal})`));
      }
    });
  });
  let job: ChildProcess | undefined;
  let jobClosed: Promise<number | null> | undefined;
  let jobError = "";
  let stoppingRequested = false;
  const stop = (): Promise<void> => {
    stoppingRequested = true;
    stopping ??= (async () => {
      if (process.platform === "win32") {
        if (job !== undefined) {
          job.stdin?.end();
          const code = await jobClosed!;
          if (code !== 0) {
            child.kill("SIGKILL");
            await close;
            for (const socket of sockets) socket.destroy();
            server?.close();
            throw new Error(`watch job helper exited with ${code}: ${jobError}`);
          }
        } else child.kill("SIGKILL"); // Still held at the barrier, with no descendants.
      } else if (child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
      await close;
      for (const socket of sockets) socket.destroy();
      if (server !== undefined) await new Promise<void>((resolve, reject) => {
        server!.close((error) => { if (error) reject(error); else resolve(); });
      });
    })();
    return stopping;
  };
  let reason: string | undefined;
  let rejectTermination!: (error: unknown) => void;
  const terminationFailure = new Promise<never>((_resolve, reject) => { rejectTermination = reject; });
  const abort = (message: string): void => {
    if (reason !== undefined) return;
    reason = message;
    void stop().then(
      () => { rejectTermination(new Error(`${message}\n${stdout}\n${stderr}`)); },
      rejectTermination,
    );
  };
  const onAbort = (): void => { abort("watch probe cancelled"); };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  // Only a deadlock fail-safe; ordinary success follows the root's exit event.
  const timer = setTimeout(() => { abort("watch probe deadlocked"); }, watchDeadlockTimeout + 30000);
  t.after(async () => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await stop();
    rmSync(sandbox, { recursive: true, force: true });
  });
  if (process.platform === "win32" && !stoppingRequested) {
    job = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File",
      fileURLToPath(new URL("./fixtures/watch-job.ps1", import.meta.url)), String(child.pid)],
    { stdio: ["pipe", "pipe", "pipe"] });
    jobClosed = new Promise<number | null>((resolve) => { job!.once("close", resolve); });
    job.stdin!.on("error", (error) => { jobError += `\n${error.message}`; });
    job.stderr!.setEncoding("utf8").on("data", (chunk: string) => { jobError += chunk; });
    const ready = new Promise<void>((resolve, reject) => {
      let output = "";
      job!.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
        output += chunk;
        if (output.includes("READY")) resolve();
      });
      job!.once("error", reject);
      job!.once("close", (code) => { reject(new Error(`watch job setup failed (${code}): ${jobError}`)); });
    });
    await Promise.race([ready, terminationFailure, completion.then(() => { throw new Error("watch supervisor exited before job setup"); })]);
    if (!stoppingRequested) releaseBarrier();
  }
  const status = await Promise.race([completion, terminationFailure]);
  await stop();
  if (reason !== undefined) throw new Error(`${reason}\n${stdout}\n${stderr}`);
  return { status, stdout, stderr };
}

function watchProbeEnv(fixtureName: string, sandbox: string): NodeJS.ProcessEnv {
  const fixture = new URL(`./fixtures/${fixtureName}`, import.meta.url).href;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${fixture}`,
    TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox,
  };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test("JUnit watch reruns even when generated output events are lost", async (t) => {
  // Exercise real OS watchers while dropping report-file notifications, not source-file notifications.
  const sandbox = mkdtempSync(join(tmpdir(), "tkr-watch-probe-"));
  const probe = await runWatchProbe("JUnit watch replaces", watchProbeEnv("suppress-output-watch.mjs", sandbox), sandbox, t);
  equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
  match(probe.stdout, /pass 1/);
  deepEqual(readdirSync(sandbox), []);
});

test("watch test cancellation closes real watchers and child processes", { timeout: 12000 }, async (t) => {
  // This subprocess exercises real cancellation and process teardown; fake timers cannot prove handle cleanup.
  const sandbox = mkdtempSync(join(tmpdir(), "tkr-watch-probe-"));
  // The probe owns sandbox cleanup after its subprocess has closed.
  const env = watchProbeEnv("suppress-watch.mjs", sandbox);
  env.TKR_WATCH_CANCELLATION_PROBE = "1";
  const probe = await runWatchProbe("watch reruns all files|CLI watch exits|JUnit watch replaces", env, sandbox, t);
  equal(probe.status, 1, `${probe.stdout}\n${probe.stderr}`);
  match(probe.stdout, /cancelled 3/);
  match(probe.stdout, /test timed out/);
  deepEqual(readdirSync(sandbox), []);
});

for (const failure of ["abort", "deadlock", "root-exit"] as const) test(`watch probe ${failure} stops a live CLI descendant and removes its sandbox`, { timeout: 120000 }, async (t) => {
  if (failure === "deadlock") t.mock.timers.enable({ apis: ["setTimeout"] });
  const sandbox = mkdtempSync(join(tmpdir(), "tkr-watch-abort-"));
  const marker = join(sandbox, "watch-ready");
  const env = watchProbeEnv("suppress-output-watch.mjs", sandbox);
  env.TKR_WATCH_READY = marker;
  const controller = new AbortController();
  const ready = new Promise<number>((resolve) => {
    const watcher = watch(sandbox, () => {
      if (!existsSync(marker)) return;
      watcher.close();
      resolve(Number(readFileSync(marker, "utf8")));
    });
    t.after(() => { watcher.close(); });
  });
  let rootReady!: (pid: number) => void;
  const root = new Promise<number>((resolve) => { rootReady = resolve; });
  const running = runWatchProbe("JUnit watch replaces", env, sandbox, t, controller.signal, rootReady);
  t.after(() => { equal(existsSync(sandbox), false); });
  const [pid, rootPid] = await Promise.race([
    Promise.all([ready, root]),
    running.then(() => { throw new Error("watch probe exited before CLI readiness"); }),
  ]);
  process.kill(pid, 0); // The marker comes from the actual CLI after opening its real watcher.
  if (failure === "root-exit") {
    process.kill(rootPid, "SIGKILL");
    const result = await running;
    notEqual(result.status, 0);
  } else {
    const cancelled = rejects(running, failure === "abort" ? /watch probe cancelled/ : /watch probe deadlocked/);
    if (failure === "abort") controller.abort();
    else t.mock.timers.tick(watchDeadlockTimeout + 30000);
    await cancelled;
  }
  if (process.platform === "win32") {
    const listing = spawnSync("tasklist", ["/fi", `PID eq ${pid}`, "/fo", "csv", "/nh"], { encoding: "utf8" });
    equal(listing.status, 0, listing.stderr);
    doesNotMatch(listing.stdout, new RegExp(`"${pid}"`));
  } else {
    // An orphaned, already-dead child can briefly remain as a zombie until init reaps it.
    const listing = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    if (listing.status === 0) match(listing.stdout.trim(), /^Z/);
    else equal(listing.status, 1, listing.stderr);
  }
});
