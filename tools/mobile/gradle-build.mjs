// Assemble the mobile debug APK with bounded, classified retries (#2721).
//
//   cd packages/runner-mobile/android
//   node ../../../tools/mobile/gradle-build.mjs --attempts 3 --delays 10000,30000
//
// The generated Android project is gitignored (`.gitignore`), so the Gradle tuning lives here rather than in a committed
// `gradle.properties`: every invocation passes the internal retry budget and backoff properties and runs with `--info`,
// so Gradle's own retries and the underlying status codes appear in the log and in `attempts.json`. A build that exits 0
// without a non-empty APK is a loud failure, not a success; the APK and an `attempts.json` record are copied to
// `artifacts/mobile-build/` for the job.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyGradleFailure, runWithRetry } from "./gradle-retry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/** Where Gradle writes the debug APK, relative to the Android project. */
export const APK_RELATIVE = join("app", "build", "outputs", "apk", "debug", "app-debug.apk");

/** The Gradle arguments for every attempt. `--info` makes Gradle's own retries and status codes visible. */
export function gradleArguments() {
  return [
    "assembleDebug",
    "--no-daemon",
    "--console=plain",
    "--info",
    "-Dorg.gradle.internal.repository.max.retries=6",
    "-Dorg.gradle.internal.repository.initial.backoff=1000",
  ];
}

function defaultRun({ cwd, remainingMs }) {
  const result = spawnSync(join(cwd, process.platform === "win32" ? "gradlew.bat" : "gradlew"), gradleArguments(), {
    cwd,
    encoding: "utf8",
    timeout: Math.max(1_000, Math.min(remainingMs, 15 * 60_000)),
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
  const timedOut = result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM";
  return {
    status: timedOut ? 1 : (result.status ?? 1),
    stdout: result.stdout ?? "",
    stderr: `${result.stderr ?? ""}${timedOut ? `\ngradle build timed out after ${Math.min(remainingMs, 15 * 60_000)} ms` : ""}${result.error && !timedOut ? `\n${String(result.error)}` : ""}`,
  };
}

function lastLines(text, count) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line !== "");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

function writeMetadata(outDir, metadata) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "attempts.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

/**
 * Build the APK, verify it, and write `artifacts/mobile-build/`. Throws (with `exitCode` 1) on exhaustion or on a build
 * that claims success without an APK; `attempts.json` is written on both outcomes so CI keeps the evidence.
 */
export async function buildDebugApk({
  cwd = join(root, "packages", "runner-mobile", "android"),
  outDir = join(root, "artifacts", "mobile-build"),
  attempts = 3,
  delays = [10_000, 30_000],
  deadlineMs = 20 * 60_000,
  run,
  exists = existsSync,
  size = (path) => statSync(path).size,
  copy = copyFileSync,
  now = Date.now,
  sleep,
  log = (line) => console.log(line),
} = {}) {
  const apkPath = join(cwd, APK_RELATIVE);
  const started = now();
  const metadata = {
    schema: 1,
    attemptsRequested: attempts,
    attempts: 0,
    result: "failed",
    elapsedMs: 0,
    classifications: [],
    apk: null,
  };
  const finish = (reason, exitCode = 1) => {
    metadata.error = reason;
    metadata.elapsedMs = now() - started;
    writeMetadata(outDir, metadata);
    const error = new Error(reason);
    error.exitCode = exitCode;
    throw error;
  };
  const result = await runWithRetry({
    run: (request) => (run ?? defaultRun)({ ...request, cwd }),
    classify: classifyGradleFailure,
    attempts,
    delays,
    deadlineMs,
    now,
    sleep,
    log,
  });
  metadata.attempts = result.attempts;
  metadata.classifications = result.results.map((record) => ({
    attempt: record.attempt,
    status: record.status,
    retryable: record.classification.retryable,
    evidence: record.classification.evidence,
    permanent: record.classification.permanent,
  }));
  if (!result.ok) {
    const evidence = [...new Set(result.results.flatMap((record) => [...record.classification.evidence, ...record.classification.permanent]))];
    const last = result.results.at(-1);
    const output = lastLines(`${last?.stdout ?? ""}\n${last?.stderr ?? ""}`, 60);
    finish([
      `gradle assembleDebug failed after ${result.attempts} attempt(s)`,
      evidence.length > 0 ? `evidence:\n  ${evidence.join("\n  ")}` : "evidence: no recognisable Gradle diagnostic",
      `last output:\n${output}`,
    ].join("\n"));
  }
  if (!exists(apkPath)) {
    finish(`gradle exited 0 but produced no APK at ${apkPath}`);
  }
  const bytes = size(apkPath);
  if (!(bytes > 0)) {
    finish(`gradle exited 0 but its APK at ${apkPath} is empty (${bytes} bytes)`);
  }
  mkdirSync(outDir, { recursive: true });
  const copied = join(outDir, "app-debug.apk");
  copy(apkPath, copied);
  metadata.result = "passed";
  metadata.apk = { path: copied, bytes };
  metadata.elapsedMs = now() - started;
  writeMetadata(outDir, metadata);
  log(`gradle assembleDebug produced ${bytes} bytes after ${result.attempts} attempt(s)`);
  return metadata;
}

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

async function main() {
  try {
    await buildDebugApk({
      cwd: resolve(argument("--cwd", join(root, "packages", "runner-mobile", "android"))),
      outDir: resolve(argument("--out", join(root, "artifacts", "mobile-build"))),
      attempts: Number(argument("--attempts", "3")),
      delays: String(argument("--delays", "10000,30000")).split(",").map(Number),
      deadlineMs: Number(argument("--deadline-ms", String(20 * 60_000))),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error?.exitCode ?? 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
