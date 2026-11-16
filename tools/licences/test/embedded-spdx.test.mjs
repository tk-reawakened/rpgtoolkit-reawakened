import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { embeddedSpdx } from "../embedded-spdx.mjs";
import { evaluateLicense, loadBlueOakList, loadConfig } from "../check.mjs";

const policy = {
  ...loadConfig(fileURLToPath(new URL("../config.json", import.meta.url))),
  blueOakList: loadBlueOakList(fileURLToPath(new URL("../blue-oak-list.json", import.meta.url))),
};

test("a permissive package declaration cannot hide copyleft in its distributed root bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "embedded-spdx-"));
  try {
    writeFileSync(join(dir, "index.js"), "/* SPDX-License-Identifier: LGPL-3.0-or-later\n * embedded component */\nexport {};\n");
    writeFileSync(join(dir, "index.cjs"), "/* SPDX-License-Identifier: MIT */\nmodule.exports = {};\n");
    const findings = embeddedSpdx(dir);
    assert.equal(evaluateLicense("MIT", policy, "direct").pass, true);
    assert.deepEqual(findings.map(({ path, expressions }) => ({ path, expressions })), [
      { path: "index.js", expressions: ["LGPL-3.0-or-later"] },
      { path: "index.cjs", expressions: ["MIT"] },
    ]);
    assert.equal(evaluateLicense(findings[0].expressions[0], policy, "transitive").pass, false);
    assert.equal(evaluateLicense(findings[1].expressions[0], policy, "transitive").pass, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the inventory command rejects a root bundle with embedded copyleft despite an MIT package", () => {
  const root = mkdtempSync(join(tmpdir(), "licence-inventory-"));
  try {
    const tools = join(root, "tools/licences");
    const fixture = join(tools, "fixtures/git-engine");
    const installed = join(fixture, "node_modules/example");
    mkdirSync(installed, { recursive: true });
    mkdirSync(join(root, "docs/findings/git-engine-g6-inventory"), { recursive: true });
    for (const file of ["inventory-git-engine.mjs", "embedded-spdx.mjs", "check.mjs", "config.json", "blue-oak-list.json"]) {
      copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(tools, file));
    }
    writeFileSync(join(fixture, "package.json"), JSON.stringify({ dependencies: { example: "1.0.0" } }));
    writeFileSync(join(fixture, "package-lock.json"), JSON.stringify({ packages: {
      "": { dependencies: { example: "1.0.0" } },
      "node_modules/example": { version: "1.0.0", license: "MIT", resolved: "https://example.invalid/example.tgz", integrity: "sha512-example" },
    } }));
    writeFileSync(join(installed, "package.json"), JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }));
    const bundle = join(installed, "index.js");
    writeFileSync(bundle, "/* SPDX-License-Identifier: LGPL-3.0-or-later */");
    const script = join(tools, "inventory-git-engine.mjs");
    assert.equal(spawnSync(process.execPath, [script, "--write"]).status, 0);
    const rejected = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    assert.equal(rejected.status, 1, rejected.stderr);
    const inventory = JSON.parse(readFileSync(join(root, "docs/findings/git-engine-g6-inventory/inventory.json"), "utf8"));
    assert.equal(inventory.packages[0].g6, "fail");
    assert.match(inventory.gateFailures[0], /LGPL-3\.0-or-later/);
    writeFileSync(bundle, "/* SPDX-License-Identifier: MIT */");
    assert.equal(spawnSync(process.execPath, [script, "--write"]).status, 0);
    const permitted = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    assert.equal(permitted.status, 0, permitted.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
