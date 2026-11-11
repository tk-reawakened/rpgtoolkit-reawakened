import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, loadGraph, selectPackages, testFiles, main } from "../affected.mjs";

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "affected-"));
  try {
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(root, "tools/deps"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    const dirs = ["core", "base", "middle", "leaf", "empty"];
    for (const name of dirs) {
      mkdirSync(join(root, "packages", name, "test"), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name, dependencies: name === "middle" ? { base: "workspace:*" } : name === "leaf" ? { middle: "workspace:*" } : {} }));
      if (name !== "empty") writeFileSync(join(root, "packages", name, "test/a.test.ts"), "");
    }
    writeFileSync(join(root, "tools/deps/edges.json"), JSON.stringify({ packages: dirs, edges: [["base", "middle"], ["middle", "leaf"]] }));
    fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}

test("leaf, transitive dependents, core, shared, fixtures and empty selection", () => fixture((root) => {
  const graph = loadGraph(root);
  assert.deepEqual(selectPackages(["packages/leaf/src/a.ts"], graph).packages, ["leaf"]);
  assert.deepEqual(selectPackages(["packages/base/src/a.ts"], graph).packages, ["base", "leaf", "middle"]);
  for (const path of ["packages/core/a", "package.json", "packages/leaf/test/fixtures/a", "packages/missing/a"]) assert.equal(selectPackages([path], graph).packages.length, 5);
  assert.deepEqual(selectPackages([], graph).packages, []);
  assert.deepEqual(testFiles(root, ["empty"]), []);
  assert.deepEqual(testFiles(root, ["leaf"]), ["packages/leaf/test/a.test.ts"]);
}));

test("runner changes select web CSP tests and web downstream dependents", () => {
  const packages = ["runner-desktop", "runner-mobile", "runner-harness", "runner-web", "runner-future", "editor-ui", "other"];
  const graph = { packages, edges: [["runner-web", "editor-ui"]] };
  for (const path of ["packages/runner-desktop/src/main.ts", "packages/runner-mobile/app/player.html", "packages/runner-harness/src/index.ts", "packages/runner-future/app/page.html"]) {
    const selected = selectPackages([path], graph).packages;
    assert.ok(selected.includes("runner-web"), path);
    assert.ok(selected.includes("editor-ui"), path);
    assert.ok(!selected.includes("other"), path);
  }
});

test("graph rejects incomplete package and dependency data", () => fixture((root) => {
  const path = join(root, "tools/deps/edges.json");
  writeFileSync(path, JSON.stringify({ packages: ["base"], edges: [] }));
  assert.throws(() => loadGraph(root), /coverage/);
  writeFileSync(path, JSON.stringify({ packages: ["core", "base", "middle", "leaf", "empty"], edges: [["base", "middle"]] }));
  assert.throws(() => loadGraph(root), /missing dependency/);
  writeFileSync(path, "{");
  assert.throws(() => loadGraph(root));
}));

test("Git enumeration includes committed, staged, unstaged, renamed and untracked paths", () => fixture((root) => {
  git(root, "init", "-q"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "packages/leaf/old name"), "old");
  writeFileSync(join(root, "packages/leaf/cancelled"), "original");
  git(root, "add", "."); git(root, "commit", "-qm", "initial");
  const base = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "packages/base/committed"), "commit"); git(root, "add", "."); git(root, "commit", "-qm", "change");
  renameSync(join(root, "packages/leaf/old name"), join(root, "packages/leaf/new name"));
  writeFileSync(join(root, "packages/leaf/cancelled"), "staged");
  git(root, "add", "-A");
  writeFileSync(join(root, "packages/leaf/cancelled"), "original");
  writeFileSync(join(root, "packages/middle/unstaged"), "untracked");
  writeFileSync(join(root, "packages/base/package.json"), "changed");
  assert.deepEqual(new Set(changedPaths(root, base)), new Set(["packages/base/committed", "packages/base/package.json", "packages/leaf/old name", "packages/leaf/new name", "packages/leaf/cancelled", "packages/middle/unstaged"]));
  assert.throws(() => changedPaths(root, "--invalid"));
}));

test("empty change and testless package never start the build", () => fixture((root) => {
  git(root, "init", "-q"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "Test"); git(root, "add", "."); git(root, "commit", "-qm", "initial");
  assert.equal(main(["--base", "HEAD"], root), 0);
  writeFileSync(join(root, "packages/empty/change"), "x");
  assert.equal(main(["--base", "HEAD"], root), 0);
}));

for (const fault of ["invalid base", "invalid graph"]) test(`CLI falls back to all tests for ${fault}`, () => fixture((root) => {
  mkdirSync(join(root, "tools/no-skips"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const file of ["run.mjs", "durations.mjs", "affected.mjs"]) copyFileSync(new URL(`../${file}`, import.meta.url), join(root, "tools/no-skips", file));
  writeFileSync(join(root, "bin/pnpm"), "#!/bin/sh\nexit 0\n"); chmodSync(join(root, "bin/pnpm"), 0o755);
  for (const name of ["core", "base", "middle", "leaf"]) writeFileSync(join(root, "packages", name, "test/a.test.ts"), `const test = require("node:test"); test("${name}", () => {});`);
  writeFileSync(join(root, "bin/git"), "#!/bin/sh\nexit 1\n"); chmodSync(join(root, "bin/git"), 0o755);
  if (fault === "invalid graph") writeFileSync(join(root, "tools/deps/edges.json"), "broken");
  const result = spawnSync(process.execPath, ["tools/no-skips/affected.mjs", "--base", fault === "invalid base" ? "missing-ref" : "HEAD"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /selecting all tests/);
  assert.match(result.stdout, /4 test files/);
}));
