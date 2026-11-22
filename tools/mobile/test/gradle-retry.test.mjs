import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyGradleFailure, runWithRetry } from "../gradle-retry.mjs";

const MAVEN = "https://repo.maven.apache.org/maven2/javax/annotation/javax.annotation-api/1.3.2/javax.annotation-api-1.3.2.pom";
// The real line from run 43741557090 on #2721.
const RATE_LIMIT = `> Could not GET '${MAVEN}'. Received status code 429 from server: Too Many Requests`;

test("a real 429 names its URL and repository as retryable evidence", () => {
  const result = classifyGradleFailure(`FAILURE: Build failed with an exception.\n${RATE_LIMIT}`);
  assert.equal(result.retryable, true);
  assert.equal(result.permanent.length, 0);
  assert.ok(result.evidence.some((line) => line.includes(MAVEN) && line.includes("repo.maven.apache.org")));
});

test("5xx, timeouts and resets are retryable", () => {
  for (const line of [
    "> Could not GET 'https://dl.google.com/dl/android/maven2/com/google/guava/guava/33.3.1-jre/guava-33.3.1-jre.pom'. Received status code 503 from server: Service Unavailable",
    "Read timed out",
    "Connection reset",
    "Could not resolve host: repo.maven.apache.org",
  ]) {
    assert.equal(classifyGradleFailure(line).retryable, true, line);
  }
});

test("an explicit 404 is permanent and never retried", () => {
  const result = classifyGradleFailure("> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 404 from server: Not Found");
  assert.equal(result.retryable, false);
  assert.ok(result.permanent.length > 0);
});

test("the receipt: Gradle's post-retry \"Could not find\" output is ambiguous and retryable", () => {
  // This is exactly how the #2721 failure surfaces once Gradle has exhausted its own 429 retries and `--info` was off.
  const receipt = [
    "Could not resolve all files for configuration ':app:debugRuntimeClasspath'.",
    "> Could not find com.google.guava:guava:33.3.1-jre.",
    "  Searched in the following locations:",
    "    - https://dl.google.com/dl/android/maven2/com/google/guava/guava/33.3.1-jre/guava-33.3.1-jre.pom",
    "    - https://repo.maven.apache.org/maven2/com/google/guava/guava/33.3.1-jre/guava-33.3.1-jre.pom",
  ].join("\n");
  const result = classifyGradleFailure(receipt);
  assert.equal(result.retryable, true);
  assert.ok(result.evidence.some((line) => line.includes("guava")));
  assert.ok(result.evidence.some((line) => line.includes("Searched in the following locations")));
});

test("a permanent marker wins when transient text appears alongside it", () => {
  const result = classifyGradleFailure([
    RATE_LIMIT,
    "> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 404 from server: Not Found",
  ].join("\n"));
  assert.equal(result.retryable, false);
  assert.ok(result.permanent.some((line) => line.includes("status code 404")));
});

test("ambiguous output beside an explicit 404 stays permanent", () => {
  const result = classifyGradleFailure([
    "> Could not find com.google.guava:guava:33.3.1-jre.",
    "  Received status code 404 from server: Not Found",
  ].join("\n"));
  assert.equal(result.retryable, false);
  assert.ok(result.permanent.some((line) => line.includes("404")));
});

test("a Kotlin compile failure is permanent", () => {
  const result = classifyGradleFailure("e: file:///x/app/src/main/MainActivity.kt: (12, 5): Unresolved reference: missing");
  assert.equal(result.retryable, false);
  assert.ok(result.permanent.some((line) => line.includes("Unresolved reference")));
});

test("a resolution failure with no transient marker is not retried", () => {
  const result = classifyGradleFailure("Could not resolve all files for configuration ':app:debugRuntimeClasspath'.");
  assert.equal(result.retryable, false);
  assert.deepEqual(result.evidence, []);
});

test("a resolution failure annotated by a 429 is retried and keeps both lines as evidence", () => {
  const result = classifyGradleFailure([
    "Could not resolve all files for configuration ':app:debugRuntimeClasspath'.",
    RATE_LIMIT,
  ].join("\n"));
  assert.equal(result.retryable, true);
  assert.ok(result.evidence.some((line) => line.includes("debugRuntimeClasspath")));
  assert.ok(result.evidence.some((line) => line.includes("429")));
});

function scripted(outputs) {
  const calls = [];
  const sleep = [];
  const run = async (request) => {
    calls.push(request.attempt);
    return outputs[Math.min(request.attempt, outputs.length - 1)];
  };
  return { calls, sleep, run };
}

const failed = (text) => ({ status: 1, stdout: "FAILURE: Build failed with an exception.", stderr: text });

test("two 429s then a success run three times with 10s and 30s backoff", async () => {
  const { calls, sleep, run } = scripted([failed(RATE_LIMIT), failed(RATE_LIMIT), { status: 0, stdout: "BUILD SUCCESSFUL", stderr: "" }]);
  const result = await runWithRetry({ run, sleep: async (ms) => { sleep.push(ms); }, now: () => 0 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(sleep, [10_000, 30_000]);
  assert.deepEqual(result.results.map((record) => record.status), [1, 1, 0]);
});

test("a 429 every time stops after the bounded attempts and reports each one", async () => {
  const { calls, sleep, run } = scripted([failed(RATE_LIMIT)]);
  const result = await runWithRetry({ run, sleep: async (ms) => { sleep.push(ms); }, now: () => 0 });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.equal(result.results.length, 3);
  assert.deepEqual(sleep, [10_000, 30_000]);
});

test("a permanent failure gets exactly one attempt", async () => {
  const { calls, run } = scripted([failed("> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 404 from server: Not Found")]);
  const result = await runWithRetry({ run, sleep: async () => { throw new Error("must not wait"); }, now: () => 0 });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(result.results[0].classification.retryable, false);
});

test("an unrecognised failure is never retried", async () => {
  const { calls, run } = scripted([failed("Unknown Gradle failure")]);
  const result = await runWithRetry({ run, sleep: async () => { throw new Error("must not wait"); }, now: () => 0 });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
});

test("an exhausted overall deadline starts no further attempt", async () => {
  let calls = 0;
  const result = await runWithRetry({
    run: async () => {
      calls += 1;
      return { status: 0, stdout: "", stderr: "" };
    },
    deadlineMs: 0,
    now: () => 0,
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  assert.equal(result.attempts, 0);
});
