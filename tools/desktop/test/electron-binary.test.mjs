import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { electronBinaryAt } from "../electron-binary.mjs";

const helper = new URL("../electron-binary.mjs", import.meta.url).href;

test("concurrent resolvers complete one installation before returning its executable", async () => {
  const root = mkdtempSync(join(tmpdir(), "electron-lock-test-"));
  try {
    writeFileSync(join(root, "install.js"), `
const fs = require('node:fs');
const crypto = require('node:crypto');
fs.appendFileSync('installs', 'install\\n');
crypto.pbkdf2Sync('x', 'y', 25000, 32, 'sha256');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/electron', 'complete');
fs.writeFileSync('path.txt', 'electron');
`);
    const script = `import { electronBinaryAt } from ${JSON.stringify(helper)}; process.stdout.write('ready\\n'); process.stdin.once('data', () => { process.stdout.write(electronBinaryAt(process.argv[1]) + '\\n'); });`;
    const workers = Array.from({ length: 2 }, () => spawn(process.execPath, ["--input-type=module", "-e", script, root], { stdio: ["pipe", "pipe", "pipe"] }));
    const results = workers.map((worker) => new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      worker.stdout.on("data", (chunk) => { stdout += chunk; });
      worker.stderr.on("data", (chunk) => { stderr += chunk; });
      worker.on("error", reject);
      worker.on("close", (code) => resolve({ code, stdout, stderr }));
    }));
    await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
      worker.stdout.once("data", resolve);
      worker.once("error", reject);
    })));
    for (const worker of workers) worker.stdin.end("start");
    for (const result of await Promise.all(results)) {
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /ready/);
      assert.ok(result.stdout.includes(join(root, "dist", "electron")));
    }
    assert.equal(readFileSync(join(root, "installs"), "utf8"), "install\n");
    assert.equal(readFileSync(join(root, "dist", "electron"), "utf8"), "complete");
    assert.equal(existsSync(join(root, ".tkr-electron-install.lock")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an installer failure is propagated and releases the lock", () => {
  const root = mkdtempSync(join(tmpdir(), "electron-lock-failure-"));
  try {
    writeFileSync(join(root, "install.js"), "process.exit(23);\n");
    assert.throws(() => electronBinaryAt(root), (error) => error.status === 23);
    assert.equal(existsSync(join(root, ".tkr-electron-install.lock")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
