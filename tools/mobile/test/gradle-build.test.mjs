import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { APK_RELATIVE, buildDebugApk, gradleArguments } from "../gradle-build.mjs";

const MAVEN = "https://repo.maven.apache.org/maven2/javax/annotation/javax.annotation-api/1.3.2/javax.annotation-api-1.3.2.pom";
const RATE_LIMIT = `> Could not GET '${MAVEN}'. Received status code 429 from server: Too Many Requests`;

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "gradle-build-test-"));
  return {
    cwd: dir,
    outDir: join(dir, "out"),
    apk: join(dir, APK_RELATIVE),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const success = { status: 0, stdout: "BUILD SUCCESSFUL", stderr: "" };
const rateLimited = { status: 1, stdout: "FAILURE: Build failed with an exception.", stderr: RATE_LIMIT };

test("gradleArguments pass the retry budget and add --info only from the second attempt", () => {
  const first = gradleArguments(0);
  assert.ok(first.includes("assembleDebug"));
  assert.ok(first.includes("--no-daemon"));
  assert.ok(first.includes("--console=plain"));
  assert.ok(first.includes("-Dorg.gradle.internal.repository.max.retries=6"));
  assert.ok(first.includes("-Dorg.gradle.internal.repository.initial.backoff=1000"));
  assert.equal(first.includes("--info"), false);
  assert.equal(gradleArguments(1).includes("--info"), true);
});

test("a 429 retry that succeeds copies the APK and records both attempts", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    const calls = [];
    const sleeps = [];
    const metadata = await buildDebugApk({
      cwd,
      outDir,
      attempts: 2,
      delays: [10_000],
      run: async ({ attempt }) => {
        calls.push(attempt);
        return attempt === 0 ? rateLimited : success;
      },
      exists: () => true,
      size: () => 12_345,
      copy: () => {},
      sleep: async (ms) => { sleeps.push(ms); },
      now: () => 0,
      log: () => {},
    });
    assert.equal(metadata.result, "passed");
    assert.equal(metadata.attempts, 2);
    assert.equal(metadata.apk.bytes, 12_345);
    assert.deepEqual(calls, [0, 1]);
    assert.deepEqual(sleeps, [10_000]);
    const written = JSON.parse(readFileSync(join(outDir, "attempts.json"), "utf8"));
    assert.equal(written.result, "passed");
    assert.equal(written.classifications[0].retryable, true);
    assert.equal(written.classifications[1].status, 0);
  } finally {
    cleanup();
  }
});

test("a build that exits 0 without an APK fails loudly and is not retried", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    let calls = 0;
    await assert.rejects(
      buildDebugApk({
        cwd,
        outDir,
        run: async () => {
          calls += 1;
          return success;
        },
        exists: () => false,
        now: () => 0,
        log: () => {},
      }),
      /produced no APK/,
    );
    assert.equal(calls, 1);
    const written = JSON.parse(readFileSync(join(outDir, "attempts.json"), "utf8"));
    assert.equal(written.result, "failed");
  } finally {
    cleanup();
  }
});

test("a zero-byte APK is a failure", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    await assert.rejects(
      buildDebugApk({
        cwd,
        outDir,
        run: async () => success,
        exists: () => true,
        size: () => 0,
        now: () => 0,
        log: () => {},
      }),
      /is empty/,
    );
  } finally {
    cleanup();
  }
});

test("a persistent 429 fails with the coordinate, repository and attempt count", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    const error = await buildDebugApk({
      cwd,
      outDir,
      run: async () => rateLimited,
      sleep: async () => {},
      now: () => 0,
      log: () => {},
    }).catch((caught) => caught);
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /after 3 attempt\(s\)/);
    assert.match(error.message, /javax\.annotation-api/);
    assert.match(error.message, /repo\.maven\.apache\.org/);
    assert.match(error.message, /Too Many Requests/);
  } finally {
    cleanup();
  }
});

test("a 404 is permanent: exactly one attempt, with its evidence", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    let calls = 0;
    const error = await buildDebugApk({
      cwd,
      outDir,
      run: async () => {
        calls += 1;
        return { status: 1, stdout: "", stderr: "> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 404 from server: Not Found" };
      },
      sleep: async () => { throw new Error("must not wait"); },
      now: () => 0,
      log: () => {},
    }).catch((caught) => caught);
    assert.equal(calls, 1);
    assert.match(error.message, /status code 404/);
    const written = JSON.parse(readFileSync(join(outDir, "attempts.json"), "utf8"));
    assert.equal(written.attempts, 1);
    assert.deepEqual(written.classifications[0].permanent.some((line) => line.includes("404")), true);
  } finally {
    cleanup();
  }
});

test("the copied APK keeps the debug output name the proof installs", async () => {
  const { cwd, outDir, cleanup } = workspace();
  try {
    let copied = null;
    await buildDebugApk({
      cwd,
      outDir,
      run: async () => success,
      exists: () => true,
      size: () => 7,
      copy: (from, to) => { copied = { from, to }; writeFileSync(to, "apk"); },
      now: () => 0,
      log: () => {},
    });
    assert.equal(copied.from, join(cwd, APK_RELATIVE));
    assert.equal(copied.to, join(outDir, "app-debug.apk"));
  } finally {
    cleanup();
  }
});
