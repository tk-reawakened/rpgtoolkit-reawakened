import { deepEqual, equal, match, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges, parseNameOnlyZ } from "../classify-changes.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..", "classify-changes.mjs");
const pr = (paths) => classifyChanges(paths, "pull_request");
const runs = (paths, reason) => {
  const verdict = pr(paths);
  equal(verdict.runExpensive, true, `${JSON.stringify(paths)} must run`);
  if (reason !== undefined) match(verdict.reason, reason);
  match(verdict.reason, /^full: /u);
};
const defers = (paths) => {
  const verdict = pr(paths);
  equal(verdict.runExpensive, false, `${JSON.stringify(paths)} must defer`);
  match(verdict.reason, /^inert: /u);
  return verdict;
};

test("only allowlisted prose and planning paths are inert, and the reason names them", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "docs/guardrails.md",
    "docs/adr/0001-example.md",
    "_bmad-output/initiative/ticket.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature.md",
  ]) deepEqual(defers([path]), { runExpensive: false, reason: `inert: ${path}` });
  equal(defers(["README.md", "docs/adr/0001-example.md"]).reason, "inert: README.md, docs/adr/0001-example.md");
});

test("a long inert list is summarised in the reason", () => {
  const paths = Array.from({ length: 13 }, (_, index) => `docs/adr/${index}.md`);
  const { reason } = defers(paths);
  match(reason, /docs\/adr\/9\.md \(\+3 more\)$/u);
});

test("a non-inert path forces a run and the reason names it", () => {
  deepEqual(pr(["tools/ci/classify-changes.mjs"]), { runExpensive: true, reason: "full: tools/ci/classify-changes.mjs" });
  deepEqual(pr(["README.md", "packages/core/src/index.ts", "docs/adr/a.md"]), {
    runExpensive: true,
    reason: "full: packages/core/src/index.ts",
  });
  deepEqual(pr(["a.ts", "b.ts"]), { runExpensive: true, reason: "full: a.ts (+1 more not inert)" });
});

test("unknown, executable, normative, fixture and workflow paths run everything", () => {
  for (const path of [
    "unknown.md/nested.md",
    "docs/other.md",
    "docs/README.md",
    "_bmad-output/config.yaml",
    ".github/ISSUE_TEMPLATE/execute.sh",
    ".github/pull_request_template.md",
    "packages/core/README.md",
    "packages/core/src/index.ts",
    "tools/ci/README.md",
    "stock/scripts/readme.md",
    "stock/main.prg",
    "golden/README.md",
    "golden/ledger.json",
    "docs/spec/README.md",
    "docs/spec/examples/game/readme.md",
    ".github/workflows/README.md",
    ".github/workflows/ci.yml",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "LICENSE",
    "README.txt",
    "README.MD",
  ]) runs([path], new RegExp(`^full: ${path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u"));
});

test("an empty or non-array list fails closed", () => {
  runs([], /no changed paths/u);
  for (const value of [null, undefined, "README.md", {}, 7]) runs(value, /not an array/u);
});

test("malformed paths fail closed, even beside inert ones", () => {
  for (const bad of [
    null, 42, {}, "",
    "/README.md", "/etc/passwd",
    "C:/README.md", "c:README.md",
    "../README.md", "docs/../README.md", "docs/adr/..", "..",
    "./README.md", ".", "docs/./adr/a.md",
    "docs//adr/a.md", "docs/adr/", "docs/adr/a.md/",
    "docs\\adr\\0001.md", "README.md\\",
    "README.md\n", "README.md\r", "README\u0000.md", "README\u007f.md", "READ\ufffdME.md", "a\tb.md",
  ]) {
    runs([bad], /^full: malformed path/u);
    runs(["README.md", bad], /^full: malformed path/u);
    runs([bad, "README.md"], /^full: malformed path/u);
  }
  runs(new Array(1), /malformed path/u);
});

test("a malformed path's reason is a single escaped line", () => {
  const { reason } = pr(["bad\nname.md"]);
  equal(reason.includes("\n"), false);
  equal(reason, 'full: malformed path "bad\\nname.md"');
});

test("any event but pull_request runs everything", () => {
  for (const event of ["push", "workflow_dispatch", "merge_group", "pull_request_target", "", " pull_request", "PULL_REQUEST", undefined, null, {}, true]) {
    const verdict = classifyChanges(["README.md"], event);
    equal(verdict.runExpensive, true, String(event));
    match(verdict.reason, /^full: event .* is not pull_request$/u);
  }
  match(classifyChanges(["README.md"], "push").reason, /^full: event "push" is not pull_request$/u);
});

test("a rename is inert only when both its old and new paths are inert", () => {
  // `git diff --no-renames` reports a rename as a deletion plus an addition.
  defers(["docs/adr/old.md", "docs/adr/new.md"]);
  runs(["packages/core/old.ts", "README.md"], /^full: packages\/core\/old\.ts$/u);
  runs(["README.md", "packages/core/new.ts"], /^full: packages\/core\/new\.ts$/u);
  runs(["docs/adr/old.md", ".github/workflows/new.yml"], /^full: \.github\/workflows\/new\.yml$/u);
  runs(["stock/readme.md", "docs/adr/new.md"], /^full: stock\/readme\.md$/u);
});

test("the verdict never mutates or depends on the input list", () => {
  const paths = ["README.md"];
  const before = pr(paths);
  deepEqual(paths, ["README.md"]);
  deepEqual(pr(paths), before);
});

test("NUL-delimited diff paths parse without splitting on spaces or newlines", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  deepEqual(parseNameOnlyZ(bytes("README.md\0docs/spec/a page.md\0")), ["README.md", "docs/spec/a page.md"]);
  deepEqual(parseNameOnlyZ(bytes("a\nb.md\0")), ["a\nb.md"]);
  deepEqual(parseNameOnlyZ(bytes("")), []);
});

test("an unparseable diff throws instead of looking like an empty one", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  throws(() => parseNameOnlyZ(bytes("README.md")), /NUL-terminated/u);
  throws(() => parseNameOnlyZ(bytes("README.md\0\0")), /empty path/u);
  throws(() => parseNameOnlyZ(bytes("\0")), /empty path/u);
  throws(() => parseNameOnlyZ(new Uint8Array([0x52, 0xff, 0xfe, 0x00])), /encoded data was not valid|invalid/iu);
  throws(() => parseNameOnlyZ("README.md\0"), /bytes/u);
  throws(() => parseNameOnlyZ(null), /bytes/u);
});

const scratch = [];
after(() => {
  for (const directory of scratch) rmSync(directory, { recursive: true, force: true });
});

function runCli(input, event = "pull_request") {
  const directory = mkdtempSync(join(tmpdir(), "classify-"));
  scratch.push(directory);
  const outputFile = join(directory, "output");
  writeFileSync(outputFile, "");
  const result = spawnSync(process.execPath, [cli], {
    input,
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: outputFile },
  });
  return { ...result, output: readFileSync(outputFile, "utf8") };
}

test("CLI: an inert diff defers, prints the paths examined and writes the verdict", () => {
  const result = runCli("_bmad-output/x/plan.md\0README.md\0");
  equal(result.status, 0);
  equal(result.output, "full=false\nreason=inert: _bmad-output/x/plan.md, README.md\n");
  match(result.stdout, /changed paths examined \(2\):/u);
  match(result.stdout, /"_bmad-output\/x\/plan\.md"/u);
  match(result.stdout, /verdict: DEFER - inert: _bmad-output\/x\/plan\.md, README\.md/u);
});

test("CLI: a non-inert diff runs and names the path that forced it", () => {
  const result = runCli("README.md\0tools/ci/classify-changes.mjs\0");
  equal(result.status, 0);
  equal(result.output, "full=true\nreason=full: tools/ci/classify-changes.mjs\n");
  match(result.stdout, /verdict: RUN - full: tools\/ci\/classify-changes\.mjs/u);
});

test("CLI: an empty diff and a push both run", () => {
  deepEqual(
    [runCli("").status, runCli("").output],
    [0, "full=true\nreason=full: no changed paths\n"],
  );
  equal(runCli("README.md\0", "push").output, 'full=true\nreason=full: event "push" is not pull_request\n');
  equal(runCli("README.md\0", "").output.startsWith("full=true\n"), true);
});

test("CLI: an unparseable diff is a classifier failure that writes no verdict", () => {
  for (const input of ["README.md", "README.md\0\0", Buffer.from([0x52, 0xff, 0x00])]) {
    const result = runCli(input);
    equal(result.status, 1);
    equal(result.output, "");
    match(result.stderr, /classifier failure/u);
  }
});
