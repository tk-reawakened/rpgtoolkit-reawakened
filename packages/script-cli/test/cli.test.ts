/**
 * Tests for `tkr script` subcommands and the result envelope.
 */

import { deepEqual, equal, ok, strictEqual, throws } from "node:assert/strict";
import { createEmptyBoard, newProjectMainFile, writeBoard, writeMainFile } from "@tk-reawakened/core";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isScriptResult,
  parseArgs,
  RESULT_SCHEMA,
  runCheck,
  runDocs,
  runFmt,
  runIndex,
  runTest,
  stableStringify,
  type ScriptResult,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "fixtures", ...parts);

function assertEnvelope(result: ScriptResult): void {
  ok(isScriptResult(result), stableStringify(result));
  strictEqual(result.schema, RESULT_SCHEMA);
  strictEqual(result.tool, "tkr");
}

void test("check reports no findings for a clean file", () => {
  const { result, text } = runCheck([fixture("check", "ok.prg")], true);
  assertEnvelope(result);
  strictEqual(result.subcommand, "check");
  strictEqual(result.exitCode, 0);
  strictEqual(result.status, "ok");
  strictEqual(result.diagnostics.length, 0);
  ok(text.includes("\"status\": \"ok\""));
});

void test("check reports a parser diagnostic for a broken file", () => {
  const { result } = runCheck([fixture("check", "bad.prg")], true);
  assertEnvelope(result);
  strictEqual(result.exitCode, 1);
  strictEqual(result.status, "findings");
  strictEqual(result.diagnostics.length, 1);
  strictEqual(result.diagnostics[0]!.severity, "error");
  ok(result.diagnostics[0]!.file.includes("bad.prg"));
});

void test("check --project uses the selected main file, project root, includes and entry files", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-lint-project-"));
  try {
    const main = writeMainFile({ ...newProjectMainFile(), projectPath: "Game/Quest", startupPrg: "START.PRG", initBoard: "start.brd", menuPlugin: "", fightPlugin: "", packagePlugins: [] });
    if (!main.ok) throw new Error(main.error.message);
    const mainPath = join(root, "Main", "game.gam");
    const programs = join(root, "Game", "Quest", "Prg");
    const boards = join(root, "Game", "Quest", "Boards");
    mkdirSync(dirname(mainPath));
    mkdirSync(join(programs, "Prg"), { recursive: true });
    mkdirSync(boards);
    writeFileSync(mainPath, main.value);
    const start = join(programs, "start.prg");
    writeFileSync(start, '#include "Prg/Prg/tools.prg"\nused()\n');
    writeFileSync(join(programs, "Prg", "tools.prg"), "function spare() { return 1 }\nfunction used() { return 2 }\nfunction triggered() { return 3 }\n");
    const board = writeBoard({
      ...createEmptyBoard(),
      sizeX: 1, sizeY: 1, sizeL: 1, tileMatrix: [0], tileRuns: [{ lutIndex: 0, count: 1, marker: false }], layerTitles: ["", ""],
      programs: [{
        program: "triggered()", graphic: "", initialVar: "", initialValue: "", finalVar: "", finalValue: "",
        activate: 0, activationType: 0, repeatDistance: 0, layer: 1, closed: 0, points: [], handle: "",
      }],
    });
    if (!board.ok) throw new Error(board.error.message);
    writeFileSync(join(boards, "start.brd"), board.value);
    writeFileSync(join(root, "tkr-lint.json"), JSON.stringify({ severity: { "lint/unused-function": "warning" } }));

    const args = parseArgs(["node", "tkr", "script", "check", "--project", mainPath]);
    ok(args.ok);
    equal(args.args.project, mainPath);
    const checked = () => runCheck([], true, undefined, mainPath);
    const unused = (result: ScriptResult) => result.diagnostics.filter((item) => item.code === "lint/unused-function");
    const { result } = checked();
    assertEnvelope(result);
    deepEqual(unused(result).map((item) => [item.file, item.range.start.line, item.severity]), [["Game/Quest/Prg/Prg/tools.prg", 1, "warning"]]);
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "script", "check", "--project", mainPath, "--json"], { encoding: "utf8" });
    strictEqual(cli.status, 0, cli.stderr);
    deepEqual(JSON.parse(cli.stdout), result);
    writeFileSync(start, '#include "missing.prg"\n');
    const missingInclude = checked();
    deepEqual(unused(missingInclude.result), []);
    ok(missingInclude.result.diagnostics.some((item) => item.code === "lint/unresolved-include"));
    ok(missingInclude.human.includes("lint/unused-function (incomplete-project)"));

    rmSync(start);
    const missingStartup = checked();
    deepEqual(unused(missingStartup.result), []);
    ok(missingStartup.human.includes("lint/unused-function (incomplete-project)"));

    rmSync(mainPath);
    strictEqual(checked().result.exitCode, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fmtChanged(results: unknown): readonly string[] {
  if (typeof results !== "object" || results === null) return [];
  const changed = (results as Record<string, unknown>).changed;
  return Array.isArray(changed) ? changed.filter((item): item is string => typeof item === "string") : [];
}

void test("fmt --check reports files that would change", () => {
  const { result } = runFmt([fixture("fmt")], "tk3", true, true);
  assertEnvelope(result);
  strictEqual(result.subcommand, "fmt");
  strictEqual(result.exitCode, 1);
  ok(result.summary.changed > 0);
  ok(fmtChanged(result.results).some((path) => path.includes("messy.prg")));
});

void test("fmt --check is clean when nothing would change", () => {
  const { result } = runCheck([fixture("check", "ok.prg")], true);
  strictEqual(result.exitCode, 0);
});

void test("index produces a TOOL-6 document", () => {
  const { result, text } = runIndex([fixture("check", "ok.prg")], false, null, true);
  assertEnvelope(result);
  strictEqual(result.subcommand, "index");
  strictEqual(result.exitCode, 0);
  ok(text.includes("\"schema\": \"tkr-index/1.0\""));
});

void test("docs produces a quick reference", () => {
  const { result, text } = runDocs(false, null, true);
  assertEnvelope(result);
  strictEqual(result.subcommand, "docs");
  strictEqual(result.exitCode, 0);
  ok(text.includes("# RPGCode quick reference"));
});

void test("test reports a failing case with exit 1", () => {
  const { result } = runTest([fixture("spec-project")], true, true);
  assertEnvelope(result);
  strictEqual(result.subcommand, "test");
  strictEqual(result.status, "findings");
  strictEqual(result.exitCode, 1);
  ok(result.summary.failed > 0);
});

void test("test reports a strict skip as a failure", () => {
  const { result } = runTest([fixture("skip-project")], true, true);
  assertEnvelope(result);
  ok(result.summary.skipped > 0);
  strictEqual(result.exitCode, 1);
});

void test("test runs the array, closeness, throw and group-hook matchers instead of refusing them", () => {
  const { result } = runTest([fixture("matchers-project")], true, true);
  assertEnvelope(result);
  strictEqual(result.exitCode, 0, stableStringify(result));
  strictEqual(result.status, "ok");
  strictEqual(result.summary.passed, 5);
  strictEqual(result.summary.failed, 0);
  strictEqual(result.diagnostics.length, 0);
});

void test("test fails a spec file that registers no case, at line 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "tkr-no-cases-"));
  writeFileSync(join(dir, "empty.spec.prg"), 'describe("nothing", () => { })\n');
  try {
    const { result } = runTest([dir], true, true);
    assertEnvelope(result);
    strictEqual(result.exitCode, 1);
    strictEqual(result.summary.failed, 1);
    ok(result.diagnostics.some((d) => d.message.includes("spec.no-cases") && d.message.includes("line 1")), stableStringify(result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("stable output bytes are identical for identical inputs", () => {
  const first = runCheck([fixture("check", "ok.prg")], true).result;
  const second = runCheck([fixture("check", "ok.prg")], true).result;
  equal(stableStringify(first), stableStringify(second));
});

// ====================================================== real CLI process

const cliPath = join(here, "..", "dist", "cli.js");

function runCli(args: readonly string[], cwd?: string): { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf8" });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parseCliJson(stdout: string): ScriptResult {
  return JSON.parse(stdout) as ScriptResult;
}

void test("parseArgs requires the script group", () => {
  const missing = parseArgs(["node", "tkr"]);
  strictEqual(missing.ok, false);
  ok(missing.ok === false && missing.message.includes("script"));

  const wrongGroup = parseArgs(["node", "tkr", "lint", "ok.prg"]);
  strictEqual(wrongGroup.ok, false);
  ok(wrongGroup.ok === false && wrongGroup.message.includes('"script"'));

  const good = parseArgs(["node", "tkr", "script", "check", "ok.prg"]);
  strictEqual(good.ok, true);
  if (good.ok) strictEqual(good.args.subcommand, "check");
});

void test("tkr script check succeeds on a good path", () => {
  const { exitCode, stdout } = runCli(["script", "check", fixture("check", "ok.prg"), "--json"]);
  strictEqual(exitCode, 0);
  const result = parseCliJson(stdout);
  assertEnvelope(result);
  strictEqual(result.subcommand, "check");
  strictEqual(result.status, "ok");
});

void test("tkr script check exits 2 for an invalid project config", () => {
  const dir = mkdtempSync(join(tmpdir(), "tkr-invalid-config-"));
  writeFileSync(join(dir, "tkr-lint.json"), "not json");
  writeFileSync(join(dir, "ok.prg"), "// ok\n");
  try {
    const { exitCode, stdout } = runCli(["script", "check", ".", "--json"], dir);
    strictEqual(exitCode, 2);
    const result = parseCliJson(stdout);
    assertEnvelope(result);
    strictEqual(result.subcommand, "check");
    strictEqual(result.status, "error");
    ok(result.diagnostics.some((d) => d.code === "tkr.config" && d.message.includes("invalid JSON")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("tkr script check exits 2 for a nonexistent path", () => {
  const { exitCode, stdout } = runCli(["script", "check", fixture("check", "does-not-exist.prg"), "--json"]);
  strictEqual(exitCode, 2);
  const result = parseCliJson(stdout);
  assertEnvelope(result);
  strictEqual(result.subcommand, "check");
  strictEqual(result.status, "error");
  ok(result.diagnostics.some((d) => d.code === "tkr.usage" && d.message.includes("no such file or directory")));
});

void test("parse-failure envelope reports the attempted subcommand", () => {
  const { exitCode, stdout } = runCli(["script", "frobnicate", "--json"]);
  strictEqual(exitCode, 2);
  const result = parseCliJson(stdout);
  assertEnvelope(result);
  strictEqual(result.subcommand, "check");
  const results = result.results as Record<string, unknown> | null;
  ok(results !== null && typeof results === "object");
  strictEqual(results!.attemptedSubcommand, "frobnicate");
});

function lintResults(results: unknown): { readonly disabledRules: readonly string[]; readonly ignoredRanges: number; readonly unassessed: readonly { readonly rule: string; readonly reason: string }[] } {
  const lint = (results as { readonly lint?: unknown }).lint;
  ok(typeof lint === "object" && lint !== null, stableStringify(results));
  return lint as ReturnType<typeof lintResults>;
}

void test("check exposes the lint summary and names unassessed rules instead of reading as fully checked", () => {
  const dir = mkdtempSync(join(tmpdir(), "tkr-unassessed-"));
  try {
    writeFileSync(join(dir, "main.prg"), "function f() {\n    local(x) = 1\n}\n");
    const unstated = runCheck([join(dir, "main.prg")], true);
    deepEqualRules(lintResults(unstated.result.results).unassessed.map((entry) => `${entry.rule}:${entry.reason}`), [
      "lint/unused-variable:unknown-dialect",
      "lint/unused-label:unknown-dialect",
      "lint/unreachable-code:unknown-dialect",
      "lint/deprecated-command:unknown-dialect",
      "lint/obsolete-command:unknown-dialect",
      "style/format:unknown-dialect",
      "lint/unused-function:incomplete-project",
    ]);
    ok(unstated.human.includes("not fully checked: lint/unused-variable (unknown-dialect)"), unstated.human);
    strictEqual(unstated.result.diagnostics.length, 0);

    const stated = runCheck([join(dir, "main.prg")], true, "tk3");
    deepEqualRules(stated.result.diagnostics.map((diagnostic) => diagnostic.rule ?? ""), ["lint/unused-variable"]);
    deepEqualRules(lintResults(stated.result.results).unassessed.map((entry) => `${entry.rule}:${entry.reason}`), ["lint/unused-function:incomplete-project"]);

    const parsed = parseArgs(["node", "tkr", "script", "check", "--dialect", "tk3", "main.prg"]);
    ok(parsed.ok && parsed.args.dialectGiven && parsed.args.dialect === "tk3");
    const defaulted = parseArgs(["node", "tkr", "script", "check", "main.prg"]);
    ok(defaulted.ok && !defaulted.args.dialectGiven);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function deepEqualRules(actual: readonly string[], expected: readonly string[]): void {
  strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

void test("check --dialect tk2 parses Toolkit 2.x source as Toolkit 2.x before linting", () => {
  const dir = mkdtempSync(join(tmpdir(), "tkr-tk2-"));
  try {
    writeFileSync(join(dir, "talk.prg"), "Hello there, traveller.\n#mwin(\"x\")\n");
    const tk3 = runCheck([join(dir, "talk.prg")], true);
    const tk2 = runCheck([join(dir, "talk.prg")], true, "tk2");
    ok(tk3.result.diagnostics.some((diagnostic) => diagnostic.rule === undefined), stableStringify(tk3.result));
    strictEqual(tk2.result.diagnostics.filter((diagnostic) => diagnostic.rule === undefined).length, 0, stableStringify(tk2.result));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
