import { deepEqual, equal, match, doesNotMatch } from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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

test("watch reruns all files after a real edit without losing other failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-watch-"));
  writeFileSync(join(root, "a.spec.prg"), 'it("a", () => { expect(1).toBe(2) })');
  writeFileSync(join(root, "b.spec.prg"), 'it("b", () => { expect(1).toBe(2) })');
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
      watcher.on("error", reject);
      writeFileSync(join(root, "a.spec.prg"), 'it("a", () => { expect(1).toBe(1) })');
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI watch exits with the latest full-run status", { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-cli-watch-"));
  const filename = join(root, "case.spec.prg");
  writeFileSync(filename, 'it("case", () => { expect(1).toBe(1) })');
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "script", "test", root, "--watch"], { stdio: ["ignore", "pipe", "pipe"] });
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
      child.kill("SIGINT");
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
  try { await done; } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});

test("JUnit watch replaces one XML report and preserves a focused-run warning", { timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-junit-watch-"));
  const filename = join(root, "case.spec.prg");
  const report = join(root, "report.xml");
  writeFileSync(filename, 'only("case", () => { expect(1).toBe(1) })');
  const child = spawn(process.execPath, [new URL("../dist/cli.js", import.meta.url).pathname, "script", "test", root, "--watch", "--reporter", "junit", "--out", report], { stdio: ["ignore", "pipe", "pipe"] });
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  let output = "";
  let stage = 0;
  child.stderr.on("data", (bytes: Buffer) => {
    output += bytes.toString();
    if (stage === 0 && output.includes("1 passed, 0 failed")) {
      stage = 1;
      output = "";
      rmSync(report);
    } else if (stage === 1 && output.includes("1 passed, 0 failed")) {
      stage = 2;
      output = "";
      writeFileSync(filename, 'only("case", () => { expect(1).toBe(2) })');
    } else if (stage === 2 && output.includes("0 passed, 1 failed")) {
      child.kill("SIGINT");
    }
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
  try { await done; } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});
