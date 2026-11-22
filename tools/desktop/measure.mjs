// Measure the desktop runner on this machine (entry 9.11; the launch cases are entry 9.10). It launches the built
// Electron shell against the same workspace and reports what the page measured: which launch step named the game, the
// app:// scheme, no service worker, the tick-120 hashes, WebGL2, the D-7 blend bound, audio of the expected length, and
// the same draw list rendering the same frame as the reference rasteriser.
//
//   node tools/desktop/measure.mjs --case argument --out tools/desktop/measurements/<os>-argument.json
//   node tools/desktop/measure.mjs --case player-json|baked|library|library-empty --out <file>
//
// Each case lays out the directories its rule reads — a `player.json`, a baked `resources/game.tpk`, a `library.json`,
// an empty one — and launches with its own `--user-data-dir`, so nothing leaks between cases or between runs. The
// record is written by the Electron main process (`--report`), so no number here is inferred from stdout. Running it
// needs a display: macOS and Windows runners have one; Linux needs Xvfb (`xvfb-run -a`).

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { electronBinary } from "./electron-binary.mjs";
import { stopChild } from "./child-process.mjs";
import { classifyLaunchFailure, gpuFallbackArgs, InfrastructureError, launchWithRecovery } from "./gpu-retry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

/** The cases this harness can run, and the launch step each must report. */
export const CASES = ["argument", "player-json", "baked", "library", "library-empty"];

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

/** The demo package and its descriptor, built from the fetched sample game. */
function packagePath() {
  const named = argument("--game", null);
  if (named !== null) return resolve(named);
  const out = join(root, "fixtures", "packages", "demo.tpk");
  execFileSync(
    process.execPath,
    [join(root, "tools", "make-package", "run.mjs"), join(root, "fixtures", "legacy", "demo"),
      "--closing-plan", join(root, "golden", "closing", "plan.json"), "--game", "demo", "--out", out, "--title", "Demo"],
    { cwd: root, stdio: "inherit" },
  );
  return out;
}

/**
 * Lay out one case's world and return the arguments that reach it. Each case gets a fresh temporary directory: a
 * `--user-data-dir` of its own, plus `player.json` or `library.json` inside it when the case reads one, or a separate
 * `--resources` directory for the baked default.
 */
export function caseSetup(name, pkg) {
  const descriptor = JSON.parse(readFileSync(`${pkg}.json`, "utf8"));
  const directory = mkdtempSync(join(tmpdir(), `tkr-launch-${name}-`));
  const dataDir = join(directory, "data");
  mkdirSync(dataDir, { recursive: true });
  const base = ["--user-data-dir", dataDir];
  switch (name) {
    case "argument":
      return { case: name, expected: "argument", picked: null, directory, launchArgs: [...base, "--game", pkg] };
    case "player-json":
      writeFileSync(join(dataDir, "player.json"), `${JSON.stringify({ schema: 1, defaultGame: pkg }, null, 2)}\n`);
      return { case: name, expected: "config", picked: null, directory, launchArgs: base };
    case "baked": {
      const resources = join(directory, "resources");
      mkdirSync(resources, { recursive: true });
      copyFileSync(pkg, join(resources, "game.tpk"));
      copyFileSync(`${pkg}.json`, join(resources, "game.tpk.json"));
      return { case: name, expected: "baked", picked: null, directory, launchArgs: [...base, "--resources", resources] };
    }
    case "library": {
      const registry = {
        schema: 1,
        defaultGameId: descriptor.gameId,
        entries: [{
          gameId: descriptor.gameId,
          title: descriptor.title,
          version: descriptor.version,
          sha256: descriptor.sha256,
          size: descriptor.size,
          packageLocation: pkg,
          installedAt: new Date().toISOString(),
          lastPlayedAt: null,
        }],
      };
      writeFileSync(join(dataDir, "library.json"), `${JSON.stringify(registry, null, 2)}\n`);
      return { case: name, expected: "library", picked: descriptor.gameId, directory, launchArgs: base };
    }
    case "library-empty":
      return { case: name, expected: "none", picked: null, directory, launchArgs: base };
    default:
      throw new Error(`unknown --case ${name}; expected one of ${CASES.join(", ")}`);
  }
}

/**
 * Delete a case's temporary world once its child has exited. Windows keeps a handle open for a moment after `kill()`, so
 * this retries and then gives up: failing to delete a temporary directory must never turn a passing case into an error.
 */
function removeCaseDirectory(directory) {
  if (directory === null) return;
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    console.error(`measure: left ${directory} behind (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Spawn one launch attempt, wait for its report, and stop the child on both the success and failure paths. The stop is
 * bounded (#2169): the old code killed without awaiting on success, so the next case could launch while the last GPU
 * process was still tearing down, and awaited an unbounded `close` on the timeout path, which is the twenty-minute hang.
 */
async function launchOnce({ options, pkg, reportPath, timeoutMs, attempt }) {
  const binary = options.command?.[0] ?? electronBinary();
  const child = spawn(
    binary,
    options.command === undefined
      ? [
        // The app directory is the built one: its `package.json` names `main.js`, and the preload sits beside it.
        join(root, "packages", "runner-desktop", "dist"),
        // Headless Linux CI runners (Xvfb) have no GPU; attempt 0 uses Chromium's software WebGL2 path, and a retry
        // forces ANGLE's SwiftShader explicitly.
        ...gpuFallbackArgs(process.platform, attempt),
        "--serve", root,
        ...(options.launchArgs ?? ["--game", pkg]),
        "--page", options.page ?? "packages/runner-desktop/app/player-measure.html",
        "--report", reportPath,
      ]
      : options.command.slice(1),
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
        // An injected command writes its report here; the real shell receives the same path through `--report`.
        DESKTOP_MEASURE_REPORT: reportPath,
        // The npm-installed Electron binary is user-owned, so the Linux SUID sandbox helper is not configured.
        // Disable sandboxing for the measurement harness only; interactive play still uses the OS sandbox by default.
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
    },
  );
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  const started = Date.now();
  const deadline = started + timeoutMs;
  let spawnError = null;
  child.on("error", (error) => { spawnError = error; });
  const closed = new Promise((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }));
  });
  let exit = null;
  let report = null;
  while (Date.now() < deadline) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
      break;
    } catch {
      let timer;
      exit = await Promise.race([
        closed,
        new Promise((resolveWait) => {
          timer = setTimeout(() => resolveWait(null), Math.min(250, Math.max(0, deadline - Date.now())));
        }),
      ]);
      clearTimeout(timer);
      if (exit !== null) {
        // The report may have been written between the last read and the child's exit.
        try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { /* no complete report */ }
        break;
      }
    }
  }
  const output = log.join("");
  if (report !== null) {
    // Success still waits for the child to be gone before the next attempt or case can start.
    await stopChild(child);
    // The measurement page writes its failure into the report (`report.error`). Classify only that string: a GPU
    // failure there is the same infrastructure failure as one detected from the log, so it enters the recovery path
    // instead of being returned (#2169). Classifying the whole log here could let incidental GPU noise mask a real
    // hash or launch regression that the page reported.
    const pageError = typeof report.error === "string" ? report.error : "";
    if (pageError !== "" && classifyLaunchFailure({ message: pageError }).kind === "gpu") {
      const error = new Error(pageError);
      error.log = output;
      throw error;
    }
    return { report, log: output, package: pkg };
  }
  const timedOut = exit === null;
  const stop = await stopChild(child);
  if (timedOut && stop.exited) exit = { code: child.exitCode ?? null, signal: child.signalCode ?? null };
  const message = !stop.exited
    ? `Electron did not exit after SIGKILL; log:\n${output}`
    : timedOut
      ? `no report within the deadline; log:\n${output}`
      : `Electron child exited before writing a report (${spawnError ? spawnError.message : exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`}); log:\n${output}`;
  const error = new Error(message);
  error.log = output;
  error.exitCode = exit?.code ?? null;
  error.signal = exit?.signal ?? null;
  throw error;
}

/**
 * Launch the shell and return the page's report. A failure the classifier calls infrastructure (a dead GPU) is retried
 * with software WebGL2, bounded backoff and a fresh report path per attempt; a persistent GPU failure is an
 * `InfrastructureError` that names the evidence. Any other failure is rethrown after one attempt (#2169).
 */
export async function measure(options = {}) {
  const pkg = options.game ?? packagePath();
  const reportDirectory = mkdtempSync(join(tmpdir(), "desktop-measure-"));
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();
  try {
    const outcome = await launchWithRecovery({
      attempt: (attempt) => launchOnce({
        options,
        pkg,
        // A fresh path per attempt: a partial report from a crashed attempt must never be read as success.
        reportPath: join(reportDirectory, `report-attempt-${attempt + 1}.json`),
        timeoutMs,
        attempt,
      }),
      attempts: options.attempts ?? 3,
      initialBackoffMs: options.initialBackoffMs ?? 2_000,
      maxBackoffMs: options.maxBackoffMs ?? 8_000,
      delay: options.delay,
    });
    return { ...outcome.value, attempts: outcome.attempts };
  } catch (error) {
    const infrastructure = error instanceof InfrastructureError;
    const message = error instanceof Error ? error.message : String(error);
    if (options.out != null) {
      const failure = {
        os: process.platform,
        arch: process.arch,
        measuredAt: new Date().toISOString(),
        case: options.case ?? null,
        package: pkg.replace(`${root}/`, ""),
        error: message,
        infrastructure,
        exitCode: error.exitCode ?? null,
        signal: error.signal ?? null,
        output: error.log ?? "",
        elapsedMs: Date.now() - started,
        ...(Array.isArray(error.attempts) ? { attempts: error.attempts } : {}),
      };
      mkdirSync(dirname(resolve(options.out)), { recursive: true });
      writeFileSync(resolve(options.out), `${JSON.stringify(failure, null, 2)}\n`);
    }
    if (infrastructure) {
      const summary = message.split(/\r?\n/).slice(0, 12).join(" / ");
      console.error(`::error title=desktop GPU unavailable (${process.platform})::${summary}`);
    }
    throw error;
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

/**
 * The expectations for one case, checked against the page's report. A case that names a game must open it and agree
 * with the committed closing baseline; the empty-library case must say why nothing opened, which is its whole point.
 */
export function caseProblem(setup, record) {
  if (setup.expected === "none") {
    if (record.resolvedBy !== "none") return `expected launch step none, got ${JSON.stringify(record.resolvedBy)}`;
    if (typeof record.error !== "string" || !record.error.includes("No game was chosen")) {
      return `expected the stated reason for an empty library, got ${JSON.stringify(record.error)}`;
    }
    return null;
  }
  // A game-opening case whose page failed must say so: without this, a GPU or package failure surfaced only as
  // `tick: expected 120, got undefined`, which hides the cause (#2169).
  if (typeof record.error === "string" && record.error !== "") {
    return `the page reported an error: ${record.error}`;
  }
  if (record.resolvedBy !== setup.expected) {
    return `expected launch step ${setup.expected}, got ${JSON.stringify(record.resolvedBy)}`;
  }
  if (setup.picked !== null && record.picked !== setup.picked) {
    return `expected the library entry ${setup.picked}, got ${JSON.stringify(record.picked)}`;
  }
  return null;
}

/** The committed closing baseline for `demo`'s board frame, or nulls when the file or frame is absent. */
function baselineExpectation() {
  const baselinePath = resolve(root, "golden", "regression", "closing.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const demoBoard = baseline.games?.demo?.frames?.find((frame) => frame.label === "board" && frame.tick === 120);
  return {
    path: baselinePath,
    expected: {
      scheme: "app",
      serviceWorkers: 0,
      tick: demoBoard?.tick ?? 120,
      stateHash: demoBoard?.stateHash ?? null,
      drawHash: demoBoard?.drawHash ?? null,
    },
  };
}

async function main() {
  const out = argument("--out", null);
  const name = argument("--case", null);
  // The closing suite (entry 9.14): the page runs the whole plan in Electron and compares it with the committed baseline,
  // so this mode reports the suite's own verdict and has no single-frame expectation to check.
  if (process.argv.includes("--closing")) {
    const measured = await measure({ out, case: "closing", page: "packages/runner-desktop/app/player-measure.html?closing" });
    const record = { os: process.platform, arch: process.arch, measuredAt: new Date().toISOString(), ...measured.report };
    if (out !== null) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(resolve(out), `${JSON.stringify(record, null, 2)}\n`);
    }
    const closing = record.closing;
    for (const line of closing?.lines ?? []) console.log(line);
    const problems = [];
    if (closing === undefined) problems.push("the page reported no closing suite");
    else {
      if (closing.ok !== true) problems.push("the closing suite failed");
      if ((closing.packaged?.ok ?? false) !== true) problems.push(`the packaged demo failed: ${closing.packaged?.error ?? "not run"}`);
      for (const game of closing.games) if (game.batchProblems.length > 0) problems.push(`${game.name}: ${game.batchProblems.join("; ")}`);
    }
    if (record.error !== null) problems.push(record.error);
    if (problems.length > 0) {
      console.error(`desktop closing suite failed:\n  ${problems.join("\n  ")}`);
      process.exitCode = 1;
    }
    console.log(JSON.stringify({ os: record.os, closing: { ok: closing?.ok ?? false, games: closing?.games.length ?? 0, packaged: closing?.packaged?.ok ?? false } }));
    return;
  }
  const setup = name === null ? { case: null, expected: "argument", picked: null, directory: null, launchArgs: undefined } : caseSetup(name, packagePath());
  let measured;
  try {
    measured = await measure({ out, case: setup.case, launchArgs: setup.launchArgs });
  } finally {
    removeCaseDirectory(setup.directory);
  }
  const record = {
    os: process.platform,
    arch: process.arch,
    electron: execFileSync(electronBinary(), ["--version"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
        ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
      },
    }).trim(),
    measuredAt: new Date().toISOString(),
    case: setup.case,
    // The path is relative to the repository so the record is portable between machines.
    package: measured.package.replace(`${root}/`, ""),
    ...measured.report,
  };
  if (out !== null) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), `${JSON.stringify(record, null, 2)}\n`);
  }

  const problems = [];
  const launchProblem = caseProblem(setup, record);
  if (launchProblem !== null) problems.push(launchProblem);

  // A case that opened a game also has to have rendered the committed frame: the launch step must not change the answer.
  if (setup.expected !== "none") {
    const baseline = baselineExpectation();
    for (const [key, expected] of Object.entries(baseline.expected)) {
      if (expected === null) continue;
      if (record[key] !== expected) problems.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(record[key])}`);
    }
  }
  if (problems.length > 0) {
    console.error(`desktop measurement ${setup.case ?? ""} does not match its expectation (${resolve(root, "golden", "regression", "closing.json")}):\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }

  console.log(JSON.stringify(record, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
