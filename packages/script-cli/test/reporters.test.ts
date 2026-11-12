import { deepEqual, equal, match, doesNotMatch } from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "script", "test", root, "--watch"], { stdio: ["ignore", "pipe", "pipe"] });
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

test("JUnit watch replaces one XML report and preserves a focused-run warning", { timeout: watchTimeout }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "tkr-junit-watch-"));
  const filename = join(root, "case.spec.prg");
  const report = join(root, "report.xml");
  writeFileSync(filename, 'only("case", () => { expect(1).toBe(1) })');
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "script", "test", root, "--watch", "--reporter", "junit", "--out", report], { stdio: ["ignore", "pipe", "pipe"] });
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

async function runWatchProbe(pattern: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [
    "--test",
    `--test-name-pattern=${pattern}`,
    fileURLToPath(import.meta.url),
  ], { env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => {
    // Only a fail-safe: a leaked watcher must not hang the parent test process.
    const timer = setTimeout(() => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already reaped. */ }
      } else child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      reject(new Error(`watch probe did not exit\n${stdout}\n${stderr}`));
    }, 8000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code); });
  });
  return { status, stdout, stderr };
}

function watchProbeEnv(fixtureName: string, sandbox: string): NodeJS.ProcessEnv {
  const fixture = fileURLToPath(new URL(`./fixtures/${fixtureName}`, import.meta.url));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${JSON.stringify(fixture)}`,
    TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox,
  };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test("JUnit watch reruns even when generated output events are lost", { timeout: 12000 }, async (t) => {
  // Exercise real OS watchers while dropping report-file notifications, not source-file notifications.
  const sandbox = mkdtempSync(join(tmpdir(), "tkr-watch-probe-"));
  t.after(() => { rmSync(sandbox, { recursive: true, force: true }); });
  const probe = await runWatchProbe("JUnit watch replaces", watchProbeEnv("suppress-output-watch.mjs", sandbox));
  equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
  match(probe.stdout, /pass 1/);
  deepEqual(readdirSync(sandbox), []);
});

test("watch test cancellation closes real watchers and child processes", { timeout: 12000 }, async (t) => {
  // This subprocess exercises real cancellation and process teardown; fake timers cannot prove handle cleanup.
  const sandbox = mkdtempSync(join(tmpdir(), "tkr-watch-probe-"));
  t.after(() => { rmSync(sandbox, { recursive: true, force: true }); });
  const env = watchProbeEnv("suppress-watch.mjs", sandbox);
  env.TKR_WATCH_CANCELLATION_PROBE = "1";
  const probe = await runWatchProbe("watch reruns all files|CLI watch exits|JUnit watch replaces", env);
  equal(probe.status, 1, `${probe.stdout}\n${probe.stderr}`);
  match(probe.stdout, /cancelled 3/);
  match(probe.stdout, /test timed out/);
  deepEqual(readdirSync(sandbox), []);
});
