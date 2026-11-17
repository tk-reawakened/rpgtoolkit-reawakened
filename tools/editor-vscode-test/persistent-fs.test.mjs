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
    assert.equal((await request({ op: "trace", kind: "trace-marker", value: "unexpected" })).status, 400);
    assert.deepEqual(bridge.events(), [{ kind: "save", value: "/game.gam" }]);
    assert.equal((await request({ op: "trace", kind: "save-request", value: "/game.gam" })).status, 200);
    const saveReached = bridge.pauseSave();
    let saveResponseReceived = false;
    const pausedSaveResponse = request({ op: "trace", kind: "save-request", value: "/game.gam" }).then((result) => {
      saveResponseReceived = true;
      return result;
    });
    await saveReached;
    assert.equal(saveResponseReceived, false, "the save request must remain pending at the configured boundary");
    bridge.resumeSave();
    assert.equal((await pausedSaveResponse).status, 200);
    assert.deepEqual(bridge.events(), [
      { kind: "save", value: "/game.gam" },
      { kind: "save-request", value: "/game.gam" },
      { kind: "save-request", value: "/game.gam" },
    ]);
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
test("the proof filesystem can reject history writes while allowing native text writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-history-write-failure-test-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    bridge = await startPersistentFs(root, origin);
    const [, port] = bridge.authority.split(".");
    const request = async (body) => fetch(`http://127.0.0.1:${port}/${bridge.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
    bridge.failWritesUnder("/.tkr-history");
    const historyWrite = await request({
      op: "writeFile", path: "/.tkr-history/entries/one.json", create: true, overwrite: true,
      data: Buffer.from("history").toString("base64"),
    });
    assert.equal(historyWrite.status, 400);
    assert.equal((await historyWrite.json()).error, "EACCES");
    const nativeWrite = await request({
      op: "writeFile", path: "/start.prg", create: true, overwrite: true,
      data: Buffer.from("saved native text").toString("base64"),
    });
    assert.equal(nativeWrite.status, 200);
    assert.deepEqual(await nativeWrite.json(), { result: { created: true } });
    assert.equal(await readFile(join(root, "start.prg"), "utf8"), "saved native text");
    assert.deepEqual(bridge.failedWriteEvents(), [{ kind: "write-failed", path: "/.tkr-history/entries/one.json" }]);
    assert.deepEqual(bridge.writeOperationEvents(), [
      { kind: "write-request", path: "/.tkr-history/entries/one.json" },
      { kind: "write-failed", path: "/.tkr-history/entries/one.json" },
      { kind: "write-request", path: "/start.prg" },
      { kind: "write", path: "/start.prg" },
    ]);
    bridge.allowWrites();
  } finally {
    if (bridge) { bridge.allowWrites(); await bridge.close(); }
    await rm(root, { recursive: true, force: true });
  }
});
test("the proof filesystem can pause a workspace write before it reaches disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-write-gate-test-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    await writeFile(join(root, "game.gam"), "before");
    bridge = await startPersistentFs(root, origin);
    const [, port] = bridge.authority.split(".");
    const reached = bridge.pauseWrite("/game.gam");
    const pending = fetch(`http://127.0.0.1:${port}/${bridge.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ op: "writeFile", path: "/game.gam", create: false, overwrite: true, data: Buffer.from("after").toString("base64") }),
    });
    await reached;
    assert.deepEqual(bridge.writeEvents(), [{ kind: "write-request", path: "/game.gam" }]);
    assert.equal(await readFile(join(root, "game.gam"), "utf8"), "before");
    bridge.resumeWrite();
    const response = await pending;
    assert.equal(response.status, 200);
    await response.json();
    assert.deepEqual(bridge.writeEvents(), [
      { kind: "write-request", path: "/game.gam" },
      { kind: "write", path: "/game.gam" },
    ]);
    assert.equal(await readFile(join(root, "game.gam"), "utf8"), "after");
  } finally {
    if (bridge) { bridge.resumeWrite(); await bridge.close(); }
    await rm(root, { recursive: true, force: true });
  }
});
test("the proof filesystem can pause a matching workspace read before it reaches the caller", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-read-gate-test-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    await writeFile(join(root, "game.gam"), "saved");
    bridge = await startPersistentFs(root, origin);
    const [, port] = bridge.authority.split(".");
    const request = () => fetch(`http://127.0.0.1:${port}/${bridge.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ op: "readFile", path: "/game.gam" }),
    });
    const reached = bridge.pauseRead("/game.gam");
    const pending = request();
    await reached;
    assert.deepEqual(bridge.readEvents(), [{ kind: "readFile", path: "/game.gam" }]);
    bridge.resumeRead();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(Buffer.from((await response.json()).result, "base64").toString(), "saved");
  } finally {
    if (bridge) { bridge.resumeRead(); await bridge.close(); }
    await rm(root, { recursive: true, force: true });
  }
});
test("a native restore seam arms the existing filesystem read gate for exactly its matching read", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-native-restore-gate-test-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    await writeFile(join(root, "game.prg"), "saved");
    bridge = await startPersistentFs(root, origin);
    const [, port] = bridge.authority.split(".");
    const request = (body) => fetch(`http://127.0.0.1:${port}/${bridge.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(body),
    });
    const reached = bridge.pauseNativeRestoreRead("/game.prg");
    assert.equal((await request({ op: "armNativeRestoreRead", path: "/game.prg" })).status, 200);
    const pending = request({ op: "readFile", path: "/game.prg" });
    await reached;
    assert.deepEqual(bridge.nativeRestoreReadEvents(), [{ kind: "readFile", path: "/game.prg" }]);
    assert.deepEqual(bridge.readEvents(), [{ kind: "readFile", path: "/game.prg" }]);
    bridge.resumeRead();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(Buffer.from((await response.json()).result, "base64").toString(), "saved");
  } finally {
    if (bridge) { bridge.resumeRead(); await bridge.close(); }
    await rm(root, { recursive: true, force: true });
  }
});

test("the paused save barrier blocks native save callbacks until explicitly released", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-save-barrier-"));
  const origin = "http://localhost:34567";
  let bridge;
  try {
    bridge = await startPersistentFs(root, origin);
    const [, port] = bridge.authority.split(".");
    const request = async (kind) => {
      const response = await fetch(`http://127.0.0.1:${port}/${bridge.token}`, {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ op: "trace", kind, value: "/game.gam" }),
      });
      await response.json();
      return response.status;
    };
    for (const kind of ["save-request", "save"]) {
      const eventStart = bridge.events().length;
      bridge.pauseSave();
      let settled = false;
      const pending = request(kind).then((status) => { settled = true; return status; });
      let status;
      try {
        const deadline = Date.now() + 1000;
        while (bridge.events().length === eventStart && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        assert.deepEqual(bridge.events().slice(eventStart), [{ kind, value: "/game.gam" }]);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(settled, false, `${kind} must stay blocked until the save gate is released`);
      } finally {
        bridge.resumeSave();
        status = await pending;
      }
      assert.equal(status, 200);
    }
  } finally {
    if (bridge) await bridge.close();
    await rm(root, { recursive: true, force: true });
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
      FileSystemError: { Unavailable: (message) => new Error(message) },
      FileChangeType: { Created: 1, Changed: 2, Deleted: 3 },
      StatusBarAlignment: { Left: 1 },
      window: { createStatusBarItem() { return { text: "", show() {}, dispose() {} }; } },
      EventEmitter: class { event() {} fire(changes) { events.push(...changes); } },
      workspace: { registerFileSystemProvider(_scheme, value) { provider = value; return {}; } },
      commands: { registerCommand() { return {}; } },
      // The probe also watches `tkr` debug sessions (ADR 0037); this test exercises only its file system.
      debug: {
        onDidStartDebugSession() { return {}; },
        onDidTerminateDebugSession() { return {}; },
        registerDebugAdapterTrackerFactory() { return {}; },
      },
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
    const folder = { authority: bridge.authority, path: "/picker" };
    await provider.createDirectory(folder);
    await provider.writeFile({ ...folder, path: "/picker/board.brd" }, Buffer.from("board"), { create: true, overwrite: true });
    const directoryUri = { ...folder, path: "/picker/" };
    assert.equal((await provider.stat(directoryUri)).type, 2, "the workbench picker can stat a directory URI with its trailing separator");
    assert.deepEqual(await provider.readDirectory(directoryUri), [["board.brd", 1]], "the picker can navigate into the existing directory");
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
