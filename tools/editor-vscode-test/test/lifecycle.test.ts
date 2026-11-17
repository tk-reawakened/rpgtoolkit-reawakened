import assert from "node:assert/strict";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { autosaveSetting, cleanupTestRun, combineProofErrors, decodePersistedBytes, openedDocumentUri, trackProcess, waitForHttpServer } from "../lifecycle.ts";

test("autosave observations tolerate an incomplete write without accepting invalid settings", () => {
  const bytes = (value: string) => new TextEncoder().encode(value);
  assert.match(String(autosaveSetting(bytes('{"files.autoSave":'))), /^invalid settings JSON:/);
  assert.equal(autosaveSetting(bytes('{"files.autoSave":"afterDelay"}')), "afterDelay");
  assert.equal(autosaveSetting(bytes("null")), "invalid settings JSON: expected an object");
  assert.notEqual(autosaveSetting(bytes('{"files.autoSave":"off"}')), "afterDelay");
});

test("the persisted-byte probe can observe an empty file without accepting malformed payloads", () => {
  const empty = decodePersistedBytes("", "panel");
  assert.deepEqual(empty, new Uint8Array());
  assert.notDeepEqual(empty, new Uint8Array([1, 2]), "an empty observation cannot satisfy a nonempty save");
  assert.deepEqual(decodePersistedBytes("AQI=", "panel"), new Uint8Array([1, 2]));
  assert.throws(() => decodePersistedBytes("AQ?=", "panel"), /panel.*valid Base64/);
  assert.throws(() => decodePersistedBytes("A", "panel"), /panel.*valid Base64/);
});

test("opened document correlation decodes filenames and ignores stale or unrelated URI paths", () => {
  for (const [path, uri] of [
    ["Main/My Game #100%?.gam", "tkr-testfs://proof/project/Main/My%20Game%20%23100%25%3F.gam"],
    ["Main/é.gam", "tkr-testfs://proof/project/Main/%C3%A9.gam"],
    ["Main/literal%20.gam", "tkr-testfs://proof/project/Main/literal%2520.gam"],
  ] as const) {
    const events = [
      { kind: "open-uri", value: "tkr-testfs://proof/project/Misc/earlier.anm" },
      { kind: "open-uri", value: `tkr-testfs://proof/unrelated?file=${uri}` },
      { kind: "save", value: uri },
      { kind: "open-uri", value: uri },
    ];
    assert.equal(openedDocumentUri(events, path), uri);
    assert.equal(openedDocumentUri(events.slice(0, -1), path), undefined);
  }
});

test("the process tracker captures asynchronous spawn errors and observes close", async () => {
  const missingExecutable = join(tmpdir(), `missing-vscode-test-${randomUUID()}`);
  const process = trackProcess(spawn(missingExecutable));
  await assert.rejects(process.error, (error: NodeJS.ErrnoException) => error.code === "ENOENT");
  await process.closed;
});

test("IPv4-first DNS keeps a localhost workbench reachable through its IPv4 readiness probe", async () => {
  const previousOrder = getDefaultResultOrder();
  setDefaultResultOrder("ipv4first");
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.statusCode = requests === 1 ? 503 : 200;
    response.end("workbench");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "localhost", resolve).once("error", reject);
    });
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    await waitForHttpServer({ exitCode: null }, `http://127.0.0.1:${address.port}/`);
    assert.equal(requests, 2);
  } finally {
    setDefaultResultOrder(previousOrder);
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test("cleanup attempts removal and preserves the proof error with teardown failures", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "tkr-lifecycle-test-"));
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const tracked = trackProcess(child);
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }),
    tracked.error,
  ]);

  const primary = new Error("proof assertion failed");
  const closeFailure = new Error("browser close failed");
  const cleanupErrors = await cleanupTestRun({ close: async () => { throw closeFailure; } }, tracked, workspace);
  const combined = combineProofErrors(primary, cleanupErrors);

  assert.ok(combined instanceof AggregateError);
  assert.deepEqual(combined.errors, [primary, closeFailure]);
  await assert.rejects(access(workspace), { code: "ENOENT" });
});

for (const holdClose of [false, true]) {
  test(holdClose ? "cleanup bounds a missing close receipt after forcing the server to stop" : "cleanup escalates a SIGTERM-ignoring server and removes its workspace", async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), "tkr-lifecycle-stubborn-"));
    const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => process.send("term-received")); process.stdin.resume(); process.send("ready");'], { stdio: ["pipe", "ignore", "inherit", "ipc"] });
    const tracked = trackProcess(child);
    let releaseClose: (() => void) | undefined;
    const receipt = holdClose ? new Promise<void>((resolve) => { releaseClose = resolve; }) : undefined;
    const observed = holdClose ? { ...tracked, closed: tracked.closed.then(async (code) => { await receipt; return code; }) } : tracked;
    const kill = t.mock.method(child, "kill");
    const unref = t.mock.method(child, "unref");
    let cleanup: Promise<unknown[]> | undefined;
    try {
      await Promise.race([once(child, "message"), tracked.error]);
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const acknowledgement = once(child, "message");
      cleanup = cleanupTestRun(undefined, observed, workspace);
      const [signal] = await acknowledgement;
      assert.equal(signal, "term-received");
      t.mock.timers.tick(60_000);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(kill.mock.calls.some((call) => call.arguments[0] === "SIGKILL"), "the unresponsive real server must receive a forced stop");
      if (holdClose) {
        t.mock.timers.tick(60_000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.ok(unref.mock.callCount() > 0, "a missing close receipt must not keep the proof process alive");
      }
      const errors = await cleanup;
      assert.match(String(errors[0]), /SIGTERM.*SIGKILL/);
      if (holdClose) assert.ok(errors.some((error) => /did not close after SIGKILL/.test(String(error))));
      const primary = new Error("original authoring proof failed");
      const combined = combineProofErrors(primary, errors);
      assert.ok(combined instanceof AggregateError);
      assert.equal(combined.errors[0], primary);
      await assert.rejects(access(workspace), { code: "ENOENT" });
    } finally {
      releaseClose?.();
      child.kill("SIGKILL");
      await tracked.closed;
      await cleanup;
      await rm(workspace, { recursive: true, force: true });
    }
  });
}
