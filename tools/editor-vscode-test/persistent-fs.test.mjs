import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { openProofFile, readRequestBody, startPersistentFs } from "./persistent-fs.mjs";

test("the proof filesystem persists bytes and confines authenticated operations", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-fs-test-"));
  const outside = await mkdtemp(join(tmpdir(), "tkr-proof-fs-outside-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    await writeFile(join(outside, "secret"), "outside");
    await symlink(outside, join(root, "escape"));
    bridge = await startPersistentFs(root, origin, 1024);
    const [, port] = bridge.authority.split(".");
    const token = bridge.token;
    assert.equal(bridge.authority.includes(token), false);
    const request = async (body, actualToken = token, actualOrigin = origin) => {
      const response = await fetch(`http://127.0.0.1:${port}/${actualToken}`, {
        method: "POST", headers: { origin: actualOrigin, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, body: response.status === 403 ? null : await response.json() };
    };
    const write = await request({ op: "writeFile", path: "/game.gam", create: true, overwrite: true, data: Buffer.from("saved bytes").toString("base64") });
    assert.equal(write.status, 200);
    assert.equal(write.body.result.created, true);
    assert.equal(await readFile(join(root, "game.gam"), "utf8"), "saved bytes");
    await writeFile(join(root, "game.gam"), "external bytes");
    const refused = await request({ op: "writeFile", path: "/game.gam", create: false, overwrite: false, data: Buffer.from("wrong").toString("base64") });
    const overwrite = await request({ op: "writeFile", path: "/game.gam", create: true, overwrite: true, data: Buffer.from("new external bytes").toString("base64") });
    assert.equal(overwrite.body.result.created, false);
    assert.equal(refused.body.error, "EEXIST");
    assert.equal(await readFile(join(root, "game.gam"), "utf8"), "new external bytes");
    const read = await request({ op: "readFile", path: "/game.gam" });
    assert.equal(Buffer.from(read.body.result, "base64").toString(), "new external bytes");
    const workerRead = await request({ op: "readFile", path: "/game.gam" }, token, "http://v--abc123.localhost:34567");
    assert.equal(Buffer.from(workerRead.body.result, "base64").toString(), "new external bytes");
    assert.equal((await request({ op: "createDirectory", path: "/nested/child" })).status, 200);
    assert.equal((await request({ op: "stat", path: "/nested/child" })).body.result.type, 2);
    assert.equal((await request({ op: "trace", kind: "save", value: "/game.gam" }, "wrong")).status, 403);
    assert.deepEqual(bridge.events(), []);
    assert.equal((await request({ op: "trace", kind: "save", value: "/game.gam" })).status, 200);
    assert.deepEqual(bridge.events(), [{ kind: "save", value: "/game.gam" }]);
    for (const path of ["/../secret", "/escape/secret", "/bad\\path", "/a//b", "/a/./b"]) {
      assert.equal((await request({ op: "readFile", path })).status, 400, path);
    }
    assert.equal((await request({ op: "readFile", path: "/game.gam" }, "wrong")).status, 403);
    assert.equal((await request({ op: "readFile", path: "/game.gam" }, token, "http://attacker.invalid")).status, 403);
    assert.equal(await readFile(join(outside, "secret"), "utf8"), "outside");
  } finally {
    if (bridge) await bridge.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("request decoding handles split UTF-8 and counts bytes", async () => {
  const body = Buffer.from(JSON.stringify({ value: "é".repeat(600) }));
  const split = body.indexOf(Buffer.from("é")) + 1;
  async function* chunks() {
    yield body.subarray(0, split);
    yield body.subarray(split);
  }
  assert.equal(JSON.parse(await readRequestBody(chunks(), body.length)).value, "é".repeat(600));
  await assert.rejects(readRequestBody(chunks(), 1024), { code: "EFBIG" });
});

test("the VS Code provider reports creation and later changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-events-test-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    bridge = await startPersistentFs(root, origin);
    const events = [];
    let provider;
    const vscode = {
      FileChangeType: { Created: 1, Changed: 2, Deleted: 3 },
      StatusBarAlignment: { Left: 1 },
      window: { createStatusBarItem() { return { text: "", show() {}, dispose() {} }; } },
      EventEmitter: class { event() {} fire(changes) { events.push(...changes); } },
      workspace: { registerFileSystemProvider(_scheme, value) { provider = value; return {}; } },
      commands: { registerCommand() { return {}; } },
    };
    const source = (await readFile(new URL("./probe-extension/extension.js", import.meta.url), "utf8"))
      .replace("__TKR_PROOF_SECRET__", bridge.token);
    const module = { exports: {} };
    runInNewContext(source, {
      require: () => vscode, module, console, btoa,
      fetch: (url, options) => fetch(url, { ...options, headers: { ...options.headers, origin } }),
    });
    module.exports.activate({ subscriptions: [] });
    const uri = { authority: bridge.authority, path: "/created.gam" };
    await provider.writeFile(uri, Buffer.from("first"), { create: true, overwrite: true });
    await provider.writeFile(uri, Buffer.from("second"), { create: true, overwrite: true });
    assert.deepEqual(events.map((event) => event.type), [vscode.FileChangeType.Created, vscode.FileChangeType.Changed]);
    assert.equal(await readFile(join(root, "created.gam"), "utf8"), "second");
  } finally {
    if (bridge) await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a file deleted between exclusive create and overwrite is reported as created", async () => {
  const calls = [];
  const handle = {};
  const file = await openProofFile("game.gam", constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, true, true, async (_path, flags) => {
    calls.push(flags);
    if (calls.length === 1) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    if (calls.length === 2) throw Object.assign(new Error("removed"), { code: "ENOENT" });
    return handle;
  });
  assert.deepEqual(file, { file: handle, created: true });
  assert.equal(calls.length, 3);
  assert.ok(calls[0] & constants.O_EXCL);
  assert.equal(calls[1] & constants.O_CREAT, 0);
  assert.ok(calls[2] & constants.O_EXCL);
});
