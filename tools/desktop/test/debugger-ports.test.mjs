import assert from "node:assert/strict";
import { test } from "node:test";
import { browserDebuggingPort, waitForDebuggerPort } from "../debugger-ports.mjs";

const stillRunning = new Promise(() => {});

function fileError(code) {
  return Object.assign(new Error(`transient read failure: ${code}`), { code });
}

test("retries missing and temporarily locked DevToolsActivePort until its port is readable", async () => {
  let reads = 0;
  const waits = [];
  const port = await waitForDebuggerPort(
    "Chromium remote-debugging port",
    () => browserDebuggingPort("/isolated/profile", (path, encoding) => {
      assert.match(path, /DevToolsActivePort$/);
      assert.equal(encoding, "utf8");
      reads += 1;
      if (reads === 1) throw fileError("ENOENT");
      if (reads === 2) throw fileError("EBUSY");
      if (reads === 3) throw fileError("EPERM");
      return "49152\n/devtools/browser/test-id\n";
    }),
    stillRunning,
    { attempts: 4, intervalMs: 25, delay: async (ms) => waits.push(ms) },
  );

  assert.equal(port, 49152);
  assert.equal(reads, 4);
  assert.deepEqual(waits, [25, 25, 25]);
});

test("surfaces unexpected profile I/O errors without retrying", async () => {
  const failure = fileError("EIO");
  let reads = 0;

  await assert.rejects(
    waitForDebuggerPort(
      "Chromium remote-debugging port",
      () => browserDebuggingPort("/isolated/profile", () => {
        reads += 1;
        throw failure;
      }),
      stillRunning,
      { attempts: 5, intervalMs: 25, delay: async () => {} },
    ),
    (error) => error === failure,
  );
  assert.equal(reads, 1);
});
