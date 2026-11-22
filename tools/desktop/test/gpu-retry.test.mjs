import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { stopChild } from "../child-process.mjs";
import { classifyLaunchFailure, gpuFallbackArgs, InfrastructureError, launchWithRecovery } from "../gpu-retry.mjs";
import { measure } from "../measure.mjs";

// The real CI lines from #2169. The empty shader log is the symptom of a dead GPU process, never a shader bug.
const GPU_LINES = [
  "Exiting GPU process due to errors during initialization",
  "GPU state invalid after WaitForGetOffsetInRange",
  "render-webgl2: shader compilation failed: ",
  "render-webgl2: the WebGL2 context was lost",
  "render-webgl2: no WebGL2 context",
];

// A real game/format/launch regression. Retrying any of these must be impossible.
const OTHER_LINES = [
  "render-webgl2: shader compilation failed: ERROR: 0:12: 'float' : syntax error",
  "expected launch step argument, got undefined",
  "tick: expected 120, got undefined",
  "No game was chosen: pass --game",
];

test("the classifier treats GPU-process death and an empty shader log as infrastructure", () => {
  for (const line of GPU_LINES) {
    const evidence = line.trim();
    assert.deepEqual(classifyLaunchFailure({ message: line }), { kind: "gpu", evidence: [evidence] }, line);
    assert.deepEqual(classifyLaunchFailure({ log: `prefix\n${line}\nsuffix` }), { kind: "gpu", evidence: [evidence] }, line);
  }
});

test("the classifier rethrows everything else, including a non-empty shader log", () => {
  for (const line of OTHER_LINES) {
    assert.deepEqual(classifyLaunchFailure({ message: line }), { kind: "other", evidence: [] }, line);
    assert.deepEqual(classifyLaunchFailure({ log: line }), { kind: "other", evidence: [] }, line);
  }
  assert.deepEqual(classifyLaunchFailure({}), { kind: "other", evidence: [] });
});

test("only a retry forces the ANGLE SwiftShader arguments", () => {
  assert.deepEqual(gpuFallbackArgs("darwin", 0), []);
  assert.deepEqual(gpuFallbackArgs("linux", 0), ["--enable-unsafe-swiftshader"]);
  for (const platform of ["darwin", "win32", "linux"]) {
    const retry = gpuFallbackArgs(platform, 1);
    assert.ok(retry.includes("--use-gl=angle"), platform);
    assert.ok(retry.includes("--use-angle=swiftshader"), platform);
    assert.ok(retry.includes("--enable-unsafe-swiftshader"), platform);
  }
  assert.deepEqual(gpuFallbackArgs("linux", 2), [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-dev-shm-usage",
  ]);
});

const gpuFailure = (message = "render-webgl2: shader compilation failed: ") =>
  Object.assign(new Error(message), { log: "Exiting GPU process due to errors during initialization" });

test("a transient GPU failure retries with doubling backoff and reports the attempt count", async () => {
  const calls = [];
  const delays = [];
  const outcome = await launchWithRecovery({
    attempt: async (index) => {
      calls.push(index);
      if (index < 2) throw gpuFailure();
      return { report: "ok" };
    },
    attempts: 3,
    initialBackoffMs: 2_000,
    maxBackoffMs: 8_000,
    delay: async (ms) => { delays.push(ms); },
  });
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(delays, [2_000, 4_000]);
  assert.equal(outcome.attempts, 3);
  assert.deepEqual(outcome.value, { report: "ok" });
  assert.ok(outcome.evidence.includes("Exiting GPU process due to errors during initialization"));
});

test("a non-GPU failure is rethrown once, unchanged, so a retry cannot hide it", async () => {
  let calls = 0;
  const failure = Object.assign(new Error("expected launch step argument, got undefined"), { log: "sha256 mismatch" });
  await assert.rejects(
    launchWithRecovery({
      attempt: async () => {
        calls += 1;
        throw failure;
      },
      delay: async () => { throw new Error("a non-GPU failure must not wait or retry"); },
    }),
    (error) => error === failure,
  );
  assert.equal(calls, 1);
});

test("exhausted GPU attempts fail loudly as infrastructure and name every attempt", async () => {
  let calls = 0;
  const error = await launchWithRecovery({
    attempt: async () => {
      calls += 1;
      throw gpuFailure();
    },
    attempts: 3,
    delay: async () => {},
  }).catch((caught) => caught);
  assert.ok(error instanceof InfrastructureError);
  assert.equal(error.kind, "infrastructure");
  assert.equal(error.attempts.length, 3);
  assert.equal(calls, 3);
  assert.match(error.message, /infrastructure/);
  assert.match(error.message, /attempt 1: gpu \(.*Exiting GPU process due to errors during initialization/);
  assert.match(error.message, /attempt 3: gpu/);
  assert.match(error.message, /last log:\n/);
});

/** A child process stand-in: records signals and closes only when told to. */
class FakeChild extends EventEmitter {
  constructor(onSignal = () => {}) {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
    this.unrefCalls = 0;
    this.onSignal = onSignal;
  }
  kill(signal) {
    this.signals.push(signal);
    this.onSignal(signal, this);
    return true;
  }
  unref() {
    this.unrefCalls += 1;
  }
}

test("stopChild escalates a SIGTERM-ignoring child to SIGKILL within its bounds", async () => {
  const child = new FakeChild((signal, self) => {
    if (signal === "SIGKILL") {
      self.exitCode = 137;
      self.signalCode = "SIGKILL";
      self.emit("close", 137, "SIGKILL");
    }
  });
  const waits = [];
  const result = await stopChild(child, { graceMs: 5_000, killMs: 2_000, delay: async (ms) => { waits.push(ms); } });
  assert.deepEqual(result, { exited: true, escalated: true });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(waits, [5_000, 2_000]);
});

test("stopChild returns exited:false after the bound instead of hanging", async () => {
  const child = new FakeChild();
  const waits = [];
  const result = await stopChild(child, { graceMs: 5_000, killMs: 2_000, delay: async (ms) => { waits.push(ms); } });
  assert.deepEqual(result, { exited: false, escalated: true });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(waits, [5_000, 2_000]);
  assert.equal(child.unrefCalls, 1);
});

test("stopChild does not signal a child that has already exited", async () => {
  const child = new FakeChild();
  child.exitCode = 0;
  const result = await stopChild(child, { delay: async () => { throw new Error("must not wait"); } });
  assert.deepEqual(result, { exited: true, escalated: false });
  assert.deepEqual(child.signals, []);
});

test("stopChild resolves as soon as SIGTERM closes the child, without escalating", async () => {
  const child = new FakeChild((signal, self) => {
    if (signal !== "SIGTERM") return;
    self.exitCode = 0;
    self.signalCode = "SIGTERM";
    self.emit("close", 0, "SIGTERM");
  });
  const result = await stopChild(child, { graceMs: 5_000, killMs: 2_000, delay: async () => {} });
  assert.deepEqual(result, { exited: true, escalated: false });
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("measure retries a GPU launch failure and succeeds from the second attempt's report", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-gpu-retry-"));
  const helper = join(dir, "attempt.mjs");
  writeFileSync(helper, `
    import { writeFileSync } from "node:fs";
    const report = process.env.DESKTOP_MEASURE_REPORT;
    if (report.endsWith("report-attempt-1.json")) {
      process.stderr.write("Exiting GPU process due to errors during initialization\\n");
      process.exitCode = 1;
    } else {
      writeFileSync(report, JSON.stringify({ resolvedBy: "argument", error: null, tick: 120 }));
    }
  `);
  try {
    const measured = await measure({
      game: "test.tpk",
      command: [process.execPath, helper],
      attempts: 2,
      timeoutMs: 5_000,
      delay: async () => {},
    });
    assert.equal(measured.attempts, 2);
    assert.equal(measured.report.resolvedBy, "argument");
    assert.equal(measured.report.error, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a persistent GPU failure is written as infrastructure evidence, not a bare timeout", { timeout: 1000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "desktop-gpu-fail-"));
  const out = join(dir, "nested", "failure.json");
  const helper = join(dir, "always-gpu.mjs");
  writeFileSync(helper, "process.stderr.write('GPU state invalid after WaitForGetOffsetInRange\\n'); process.exitCode = 1;\n");
  try {
    await assert.rejects(
      measure({
        game: "test.tpk",
        out,
        command: [process.execPath, helper],
        attempts: 2,
        timeoutMs: 5_000,
        delay: async () => {},
      }),
      (error) => error instanceof InfrastructureError,
    );
    const failure = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(failure.infrastructure, true);
    assert.equal(failure.attempts.length, 2);
    assert.match(failure.error, /GPU state invalid/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
