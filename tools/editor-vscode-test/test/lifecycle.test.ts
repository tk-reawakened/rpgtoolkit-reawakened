import assert from "node:assert/strict";
import { getDefaultResultOrder, setDefaultResultOrder } from "node:dns";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cleanupTestRun, combineProofErrors, trackProcess, waitForHttpServer } from "../lifecycle.ts";

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
