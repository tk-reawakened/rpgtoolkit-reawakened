import { test } from "node:test";
import { deepEqual, equal, throws } from "node:assert/strict";
import { classifyChanges, parseNameOnlyZ } from "../classify-changes.mjs";

const FULL = { full: true, bun: true };

test("allowlisted prose and planning files skip the expensive suites", () => {
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "docs/adr/0001-typescript-core.md",
    "docs/guardrails.md",
    "_bmad-output/initiative/plan.md",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
  ]) {
    deepEqual(classifyChanges([path]), { full: false, bun: false }, path);
  }
});

test("normative spec changes run Node unit and golden jobs without Bun", () => {
  deepEqual(classifyChanges(["docs/spec/examples/README.md"]), { full: true, bun: false });
});

test("stock RPGCode changes run Node unit and golden jobs without Bun", () => {
  for (const path of ["stock/demo.prg", "stock/common/events.rnc"]) {
    deepEqual(classifyChanges([path]), { full: true, bun: false }, path);
  }
});

test("authored RPGCode fixture changes run Bun as part of the packages tier", () => {
  deepEqual(classifyChanges(["packages/core/test/fixtures/authored/example.prg"]), {
    full: true,
    bun: true,
  });
});

test("package, golden, tool, workflow, and toolchain changes run all suites", () => {
  for (const path of [
    "packages/core/src/index.ts",
    "golden/ledger.json",
    "tools/fixtures/sources.json",
    "tools/ci/classify-changes.mjs",
    ".github/workflows/ci.yml",
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
  ]) {
    deepEqual(classifyChanges([path]), FULL, path);
  }
});

test("unclassified paths fail closed to the complete suite", () => {
  deepEqual(classifyChanges(["LICENSE"]), FULL);
  deepEqual(classifyChanges([".github/dependabot.yml"]), FULL);
});

test("an inert path cannot hide an active path in a mixed diff", () => {
  deepEqual(classifyChanges(["README.md", "docs/spec/engine/runtime.md"]), {
    full: true,
    bun: false,
  });
});

test("empty, forced, and invalid diffs run the complete suite", () => {
  deepEqual(classifyChanges([]), FULL);
  deepEqual(classifyChanges(["README.md"], { forceFull: true }), FULL);
  deepEqual(classifyChanges(null), FULL);
  deepEqual(classifyChanges(["README.md", ""]), FULL);
  deepEqual(classifyChanges(["../outside.md"]), FULL);
  deepEqual(classifyChanges(["README.md"], null), FULL);
});

test("NUL-delimited diff paths parse without splitting spaces", () => {
  deepEqual(parseNameOnlyZ("README.md\0docs/spec/a page.md\0"), [
    "README.md",
    "docs/spec/a page.md",
  ]);
  deepEqual(parseNameOnlyZ(""), []);
  equal(parseNameOnlyZ("README.md\0")[0], "README.md");
});

test("malformed diff input is rejected for the CLI fail-safe", () => {
  throws(() => parseNameOnlyZ("README.md"), /NUL-terminated/);
  throws(() => parseNameOnlyZ("README.md\0\0"), /empty path/);
  throws(() => parseNameOnlyZ(null), /string/);
});
