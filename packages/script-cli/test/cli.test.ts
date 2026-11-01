/**
 * Tests for `tkr script` subcommands and the result envelope.
 */

import { equal, ok, strictEqual, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

void test("test fails loudly on an owner-gated matcher", () => {
  const { result } = runTest([fixture("gated-project")], true, true);
  assertEnvelope(result);
  strictEqual(result.exitCode, 1);
  ok(result.diagnostics.some((d) => d.code === "spec.owner-gated-matcher"));
  ok(result.diagnostics.some((d) => d.message.includes("toThrow")));
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
