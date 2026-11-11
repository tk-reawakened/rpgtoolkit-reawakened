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

/** Launch the shell, wait for the page's report, and return it. */
export async function measure(options = {}) {
  const pkg = options.game ?? packagePath();
  const reportPath = join(mkdtempSync(join(tmpdir(), "desktop-measure-")), "report.json");
  const binary = options.command?.[0] ?? electronBinary();
  const child = spawn(
    binary,
    options.command?.slice(1) ?? [
      // The app directory is the built one: its `package.json` names `main.js`, and the preload sits beside it.
      join(root, "packages", "runner-desktop", "dist"),
      // Headless Linux CI runners (Xvfb) have no GPU; use Chromium's software WebGL2 path.
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      ...(options.launchArgs ?? ["--game", pkg]),
      "--page", "packages/runner-desktop/app/player-measure.html",
      "--report", reportPath,
    ],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "0",
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
  const deadline = started + (options.timeoutMs ?? 120_000);
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
  if (report !== null) {
    child.kill();
    return { report, log: log.join(""), package: pkg };
  }
  const timedOut = exit === null;
  if (timedOut) {
    child.kill();
    exit = await closed;
  }
  const output = log.join("");
  const message = timedOut
    ? `no report within the deadline; log:\n${output}`
    : `Electron child exited before writing a report (${spawnError ? spawnError.message : exit.signal ? `signal ${exit.signal}` : `exit code ${exit.code}`}); log:\n${output}`;
  if (options.out != null) {
    const failure = {
      os: process.platform,
      arch: process.arch,
      measuredAt: new Date().toISOString(),
      case: options.case ?? null,
      package: pkg.replace(`${root}/`, ""),
      error: message,
      exitCode: exit.code,
      signal: exit.signal,
      output,
      elapsedMs: Date.now() - started,
    };
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), `${JSON.stringify(failure, null, 2)}\n`);
  }
  throw new Error(message);
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
