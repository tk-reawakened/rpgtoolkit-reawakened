import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { playwrightImageAgreement, repoRoot } from "../check-playwright-image.mjs";

const pkg = (version) => JSON.stringify({ devDependencies: { "@playwright/test": version } });

const workflow = (image, { extraJob = false } = {}) =>
  [
    "name: CI",
    "jobs:",
    "  checks:",
    "    runs-on: ubuntu-24.04",
    "  browser:",
    "    needs: [changes]",
    "    runs-on: ubuntu-24.04",
    ...(image === null ? [] : ["    container:", `      image: ${image}`, "      options: --ipc=host"]),
    "    steps:",
    "      - run: xvfb-run -a pnpm browser:test",
    "  mobile:",
    "    runs-on: ubuntu-24.04",
    ...(extraJob ? ["  other:", "    container:", "      image: mcr.microsoft.com/playwright:v9.9.9-noble"] : []),
    "",
  ].join("\n");

const IMAGE_164 = "mcr.microsoft.com/playwright:v1.64.0-noble";

test("passes when the browser job's image matches the pinned @playwright/test", () => {
  const result = playwrightImageAgreement({ packageJsonText: pkg("1.64.0"), workflowText: workflow(IMAGE_164) });
  assert.deepEqual(result, { ok: true, version: "1.64.0" });
});

test("fails on a deliberate mismatch: a Playwright bump that leaves the image behind", () => {
  const result = playwrightImageAgreement({ packageJsonText: pkg("1.65.0"), workflowText: workflow(IMAGE_164) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /v1\.64\.0 .* is 1\.65\.0/);
});

test("fails when the image tag is not a pinned version", () => {
  const result = playwrightImageAgreement({
    packageJsonText: pkg("1.64.0"),
    workflowText: workflow("mcr.microsoft.com/playwright:latest"),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exactly one/);
});

test("fails when the browser job runs in no container", () => {
  const result = playwrightImageAgreement({ packageJsonText: pkg("1.64.0"), workflowText: workflow(null) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /found 0/);
});

test("ignores images in other jobs", () => {
  const result = playwrightImageAgreement({
    packageJsonText: pkg("1.64.0"),
    workflowText: workflow(IMAGE_164, { extraJob: true }),
  });
  assert.equal(result.ok, true);
});

test("fails when @playwright/test is a range rather than an exact version", () => {
  const result = playwrightImageAgreement({ packageJsonText: pkg("^1.64.0"), workflowText: workflow(IMAGE_164) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /exact version/);
});

test("fails when the workflow has no browser job", () => {
  const result = playwrightImageAgreement({
    packageJsonText: pkg("1.64.0"),
    workflowText: "jobs:\n  checks:\n    runs-on: ubuntu-24.04\n",
  });
  assert.deepEqual(result, { ok: false, reason: "the workflow has no browser job" });
});

test("the repository's own package.json and CI workflow agree", () => {
  const result = playwrightImageAgreement({
    packageJsonText: readFileSync(join(repoRoot, "package.json"), "utf8"),
    workflowText: readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"),
  });
  assert.equal(result.ok, true, result.reason);
});
