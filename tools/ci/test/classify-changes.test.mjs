import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { classifyChanges } from "../classify-changes.mjs";

const full = { runExpensive: true };
const inert = { runExpensive: false };
const pr = (paths) => classifyChanges(paths, "pull_request");

test("only allowlisted prose and planning paths are inert", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "docs/guardrails.md",
    "docs/adr/0001-example.md",
    "_bmad-output/initiative/ticket.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature.md",
  ]) deepEqual(pr([path]), inert, path);
  deepEqual(pr(["README.md", "docs/adr/0001-example.md"]), inert);
});

test("unknown, executable, normative, and test-data paths run everything", () => {
  for (const path of [
    "unknown.md/nested.md",
    "docs/other.md",
    "_bmad-output/config.yaml",
    ".github/ISSUE_TEMPLATE/execute.sh",
    "packages/core/README.md",
    "tools/ci/README.md",
    "stock/scripts/readme.md",
    "golden/README.md",
    "docs/spec/README.md",
    ".github/workflows/README.md",
    ".github/workflows/ci.yml",
    "stock/main.prg",
    "package.json",
  ]) deepEqual(pr([path]), full, path);
  deepEqual(pr(["README.md", "packages/core/src/index.ts"]), full);
});

test("empty or malformed lists and paths fail closed", () => {
  for (const paths of [
    [], null, undefined, "README.md", {}, [null], [42], [""],
    ["/README.md"], ["C:/README.md"], ["../README.md"],
    ["docs/../README.md"], ["./README.md"], ["docs//file.md"],
    ["docs\\adr\\0001.md"], ["README.md\n"], ["README.md\0"],
    ["READ\ufffdME.md"], new Array(1),
  ]) deepEqual(pr(paths), full, String(paths));
});

test("pushes and unknown or malformed event names run everything", () => {
  for (const event of ["push", "workflow_dispatch", "", undefined, null, {}, true]) {
    deepEqual(classifyChanges(["README.md"], event), full, String(event));
  }
});

test("a rename is safe only when both old and new paths are inert", () => {
  // The caller must use --no-renames so a rename supplies deletion and addition.
  deepEqual(pr(["README.md", "docs/adr/new.md"]), inert);
  deepEqual(pr(["packages/core/source.ts", "README.md"]), full);
  deepEqual(pr(["README.md", "packages/core/source.ts"]), full);
  deepEqual(pr([".github/workflows/old.yml", "docs/adr/old.md"]), full);
});
