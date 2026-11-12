import { strict as assert } from "node:assert";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { corpusBaseline } from "../check-corpus.mjs";

const configured = readFileSync("tools/fixtures/sources.json", "utf8");
const current = configured.replace('"games": ["demo", "Basic"],\n      "mainPath": "build/main",\n      "mainFiles": ["demo.gam"]', '"games": ["demo", "Basic"]');
const withDemoMain = current.replace('"games": ["demo", "Basic"]', '"games": ["demo", "Basic"],\n      "mainPath": "build/main",\n      "mainFiles": ["demo.gam"]');

test("each exact authorized fixture configuration selects its complete baseline", () => {
  assert.equal(corpusBaseline(current), "golden/legacy-corpus.json");
  assert.equal(corpusBaseline(withDemoMain), "golden/legacy-corpus-demo-main.json");
  assert.throws(() => corpusBaseline(`${current} `), /unknown fixture source configuration/);
});

test("an unknown configuration fails before running the dump", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-corpus-config-"));
  try {
    mkdirSync(join(root, "tools", "fixtures"), { recursive: true });
    writeFileSync(join(root, "tools", "fixtures", "sources.json"), `${current} `);
    const result = spawnSync(process.execPath, [resolve("tools/fixtures/check-corpus.mjs")], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown fixture source configuration/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an authorized configuration cannot pass without running the dump", () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-corpus-no-dump-"));
  try {
    mkdirSync(join(root, "tools", "fixtures"), { recursive: true });
    writeFileSync(join(root, "tools", "fixtures", "sources.json"), current);
    const result = spawnSync(process.execPath, [resolve("tools/fixtures/check-corpus.mjs")], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot find module/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
