// Measure the desktop runner on this machine (entry 9.11). It launches the built Electron shell against the same
// workspace, opens a distribution package **from disk** through the desktop asset source, and reports what the page
// measured: the app:// scheme, no service worker, the tick-120 hashes, WebGL2, the D-7 blend bound, audio of the
// expected length, and the same draw list rendering the same frame as the reference rasteriser.
//
//   node tools/desktop/measure.mjs --package fixtures/packages/demo.tpk --out tools/desktop/measurements/<os>.json
//
// The report is written by the Electron main process (`--report`), so nothing here is inferred from stdout. Running it
// needs a display: macOS and Windows runners have one; Linux needs Xvfb (`xvfb-run -a`).

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { electronBinary } from "./electron-binary.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : fallback;
}

/** The package to open, built from the fetched sample game when the caller names none. */
function packagePath() {
  const named = argument("--package", null);
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

/** Launch the shell, wait for the page's report, and return it. */
export async function measure(options = {}) {
  const pkg = options.package ?? packagePath();
  const reportPath = join(mkdtempSync(join(tmpdir(), "desktop-measure-")), "report.json");
  const binary = electronBinary();
  const child = spawn(
    binary,
    [
      // The app directory is the built one: its `package.json` names `main.js`, and the preload sits beside it.
      join(root, "packages", "runner-desktop", "dist"),
      // Headless Linux CI runners (Xvfb) have no GPU; use Chromium's software WebGL2 path.
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      "--package", pkg,
      "--page", "packages/runner-desktop/app/player.html",
      "--report", reportPath,
      "--quit-after",
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
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let report = null;
  while (Date.now() < deadline) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  child.kill();
  if (report === null) throw new Error(`no report within the deadline; log:\n${log.join("")}`);
  return { report, log: log.join(""), package: pkg };
}

const out = argument("--out", null);
const measured = await measure();
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
  // The path is relative to the repository so the record is portable between machines.
  package: measured.package.replace(`${root}/`, ""),
  ...measured.report,
};
if (out !== null) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), `${JSON.stringify(record, null, 2)}\n`);
}
console.log(JSON.stringify(record, null, 2));
if (record.error !== null) process.exitCode = 1;
