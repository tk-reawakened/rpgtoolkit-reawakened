import { deepEqual, equal, ok, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { internalErrorResult, stableStringify, type ScriptResult } from "../src/index.ts";
import { loadSchema, problems } from "./schema.ts";

/**
 * Entry 10.9 acceptance (docs/spec/engine/rpgcode-tooling.md#tool-9): every subcommand exits with its documented
 * code on a clean, a diagnostic, a lint-failing and a formatting-different tree, writes the documented envelope
 * (validated here against the committed schema, not a hand-written guard), keeps stdout for the envelope and
 * puts the readable report on stderr, and `index --json` writes a document the entry-4 schema accepts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "dist", "cli.js");
const resultSchema = loadSchema("tkr-script-result.schema.json");
const indexSchema = loadSchema("tkr-script-index.schema.json");
const fixture = (...parts: string[]) => join(here, "fixtures", ...parts);

const CLEAN = 'x = 1\nmwin("hello")\n';
const SYNTAX_ERROR = "x = (\n";
const LINT_FAILING = "nope()\n";
const FORMAT_DIFFERENT = 'if (1) {\nmwin("hi")\n}\n';
const SIGIL = "x! = 1\n";

const roots: string[] = [];
function tree(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "tkr-exit-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
after(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

type Run = { readonly code: number | null; readonly stdout: string; readonly stderr: string };
function tkr(args: readonly string[], cwd?: string): Run {
  const run = spawnSync("node", [cliPath, "script", ...args], { cwd, encoding: "utf8" });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Run with `--json` and hold the whole of stdout to be the schema-valid envelope the exit code agrees with. */
function json(args: readonly string[], cwd?: string): { readonly run: Run; readonly result: ScriptResult } {
  const run = tkr([...args, "--json"], cwd);
  const result = JSON.parse(run.stdout) as ScriptResult;
  deepEqual(problems(result, resultSchema), [], run.stdout);
  strictEqual(result.exitCode, run.code, "the envelope's exitCode is the process exit code");
  strictEqual(result.status, run.code === 0 ? "ok" : run.code === 1 ? "findings" : "error");
  return { run, result };
}

test("check: 0 on a clean tree, 1 on a parser diagnostic, 1 on a lint failure that names its file", () => {
  const clean = json(["check", tree({ "ok.prg": CLEAN })]);
  strictEqual(clean.run.code, 0);
  deepEqual(clean.result.diagnostics, []);

  const broken = json(["check", tree({ "bad.prg": SYNTAX_ERROR })]);
  strictEqual(broken.run.code, 1);
  strictEqual(broken.result.diagnostics[0]!.file, "bad.prg");

  const lintFailing = json(["check", tree({ "lint.prg": LINT_FAILING })]);
  strictEqual(lintFailing.run.code, 1);
  const finding = lintFailing.result.diagnostics.find((item) => item.rule === "lint/unknown-command");
  ok(finding, stableStringify(lintFailing.result));
  strictEqual(finding.file, "lint.prg", "a lint finding names the program it is in");
  ok(lintFailing.run.stderr.includes("lint.prg:1:1"), lintFailing.run.stderr);
});

test("check: a warning with an autofix is a schema-valid diagnostic and does not fail the tree", () => {
  const { run, result } = json(["check", tree({ "sigil.prg": SIGIL })]);
  strictEqual(run.code, 0);
  const warning = result.diagnostics.find((item) => item.rule === "dialect/sigil");
  ok(warning, stableStringify(result));
  strictEqual(warning.severity, "warning");
});

test("check: a program that uses `this` is content, never an internal error", () => {
  const { run, result } = json(["check", tree({ "obj.prg": "same = context == this\n" })]);
  strictEqual(run.code, 0, stableStringify(result));
});

test("fmt: 0 on a formatted tree, 1 when a file would change, and the rewrite makes the next check clean", () => {
  const clean = json(["fmt", "--check", tree({ "ok.prg": CLEAN })]);
  strictEqual(clean.run.code, 0);

  const dir = tree({ "messy.prg": FORMAT_DIFFERENT });
  const different = json(["fmt", "--check", dir]);
  strictEqual(different.run.code, 1);
  strictEqual(different.result.summary.changed, 1);
  strictEqual(readFileSync(join(dir, "messy.prg"), "utf8"), FORMAT_DIFFERENT, "--check writes nothing");

  const written = json(["fmt", dir]);
  strictEqual(written.run.code, 0, "formatting successfully is not a finding");
  notEqualText(readFileSync(join(dir, "messy.prg"), "utf8"), FORMAT_DIFFERENT);
  strictEqual(json(["fmt", "--check", dir]).run.code, 0);
});

function notEqualText(actual: string, unexpected: string): void {
  ok(actual !== unexpected, "the file was rewritten");
}

test("index: 0 and a document the entry-4 schema accepts, to stdout, to a file, and --check against it", () => {
  const dir = tree({ "main.prg": 'function twice(n) { return n + n }\nx = twice(2)\n' });
  const { run, result } = json(["index", dir]);
  strictEqual(run.code, 0);
  const document = (result.results as { document: unknown }).document;
  deepEqual(problems(document, indexSchema), []);

  const plain = tkr(["index", dir]);
  strictEqual(plain.code, 0);
  deepEqual(problems(JSON.parse(plain.stdout), indexSchema), []);

  const out = join(dir, "..", `index-${Date.now()}.json`);
  roots.push(out);
  strictEqual(tkr(["index", dir, "--out", out]).code, 0);
  deepEqual(JSON.parse(readFileSync(out, "utf8")), document);
  strictEqual(tkr(["index", dir, "--check", "--out", out]).code, 0);
  writeFileSync(out, "{}\n");
  strictEqual(tkr(["index", dir, "--check", "--out", out]).code, 1);
  strictEqual(tkr(["index", dir, "--check", "--out", join(dir, "missing.json")]).code, 2);
  strictEqual(tkr(["index", dir, "--check"]).code, 2, "--check needs a committed file to compare with");
});

test("docs: the reference is byte-stable between runs, and --check is 0 when it matches, 1 when it differs, 2 without a file", () => {
  const first = tkr(["docs"]);
  const second = tkr(["docs"]);
  strictEqual(first.code, 0);
  strictEqual(first.stdout, second.stdout);
  ok(first.stdout.startsWith("# RPGCode quick reference"));
  ok(first.stdout.includes("# RPGCode language reference"));
  ok(first.stdout.includes("## `len`"));
  strictEqual(json(["docs"]).run.code, 0);

  const dir = tree({});
  const out = join(dir, "reference.md");
  strictEqual(tkr(["docs", "--out", out]).code, 0);
  strictEqual(readFileSync(out, "utf8"), first.stdout);
  strictEqual(tkr(["docs", "--check", "--out", out]).code, 0);
  writeFileSync(out, "stale\n");
  const drift = json(["docs", "--check", "--out", out]);
  strictEqual(drift.run.code, 1);
  strictEqual(tkr(["docs", "--check", "--out", join(dir, "missing.md")]).code, 2);
  strictEqual(tkr(["docs", "--check"]).code, 2);
});

test("test: 0 when every case passes, 1 on a failing case, 1 on a skip in strict mode and 0 with --no-strict", () => {
  strictEqual(json(["test", fixture("pass-project")]).run.code, 0);
  const failing = json(["test", fixture("spec-project")]);
  strictEqual(failing.run.code, 1);
  ok(failing.result.diagnostics.some((item) => item.message.includes("fails")), stableStringify(failing.result));
  strictEqual(json(["test", fixture("skip-project")]).run.code, 1);
  strictEqual(json(["test", fixture("skip-project"), "--no-strict"]).run.code, 0);
  ok(failing.run.stderr.includes("1 failed"), failing.run.stderr);
});

test("every subcommand exits 2 on a usage or configuration error and writes nothing", () => {
  const dir = tree({ "ok.prg": CLEAN, "tkr-lint.json": "not json" });
  const missing = join(dir, "nope");
  for (const subcommand of ["check", "fmt", "test", "index"]) {
    const { run, result } = json([subcommand, missing]);
    strictEqual(run.code, 2, `${subcommand} on a missing path`);
    strictEqual(result.subcommand, subcommand);
    ok(result.diagnostics.some((item) => item.code === "tkr.usage"));
    const unknownOption = json([subcommand, dir, "--bogus"]);
    strictEqual(unknownOption.run.code, 2, `${subcommand} with an unknown option`);
    strictEqual(unknownOption.result.subcommand, subcommand);
  }
  strictEqual(json(["frobnicate"]).run.code, 2);
  strictEqual(json(["check", dir], dir).run.code, 2, "an invalid project config");
  strictEqual(json(["check"]).run.code, 2, "no path");
  deepEqual(readdirSync(dir).sort(), ["ok.prg", "tkr-lint.json"]);
  ok(!existsSync(missing));
});

test("exit 3 is the tool failing: an envelope under the subcommand that ran, valid against the schema", () => {
  for (const subcommand of ["check", "fmt", "test", "docs", "index"] as const) {
    const result = internalErrorResult(subcommand, new Error("boom"));
    deepEqual(problems(JSON.parse(stableStringify(result)), resultSchema), []);
    strictEqual(result.subcommand, subcommand);
    strictEqual(result.exitCode, 3);
    strictEqual(result.status, "error");
    strictEqual(result.diagnostics[0]!.code, "tkr.internal");
  }
  equal(internalErrorResult("check", "").diagnostics[0]!.message.length > 0, true, "the schema needs a non-empty message");
});
