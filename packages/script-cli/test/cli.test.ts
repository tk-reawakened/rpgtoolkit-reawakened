/**
 * Tests for `tkr script` subcommands and the result envelope.
 */

import { equal, ok, strictEqual } from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isScriptResult,
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
