// The closing suite, one command (entry 9.14): every game of `golden/closing/plan.json` played in both hosts against the
// committed baseline, plus the packaged single-file game in both.
//
//   pnpm closing:suite
//
// 1. node     — `runner-headless closing`: the reference run, which is also what wrote `golden/regression/closing.json`
// 2. browser  — `tools/browser/tests/closing.spec.ts`: all eight games in headless Chromium, with the packaged demo
// 3. desktop  — `tools/desktop/build.mjs` then `measure.mjs --closing`: the same suite inside the built Electron player
//
// Every part runs even when an earlier one fails, so one broken host cannot hide the others, and the command exits
// non-zero if any part did not pass. `--skip=<part>` runs the rest (used when a CI job already covers a part).

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const skipped = new Set(process.argv.filter((argument) => argument.startsWith("--skip=")).map((argument) => argument.slice("--skip=".length)));

/** Run one part, printing its own output; never throws, so the next part still runs. */
function part(name, command, args) {
  if (skipped.has(name)) {
    console.log(`closing:suite ${name}: skipped by --skip=${name}`);
    return { name, ok: true, skipped: true };
  }
  process.stdout.write(`\nclosing:suite ${name} …\n`);
  try {
    execFileSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
    return { name, ok: true, skipped: false };
  } catch {
    return { name, ok: false, skipped: false };
  }
}

const results = [];
results.push(part("node", process.execPath, [join(root, "packages", "runner-headless", "dist", "cli.js"), "closing"]));
results.push(part("browser", pnpm, ["exec", "playwright", "test", "tools/browser/tests/closing.spec.ts"]));

// The desktop suite needs a built bundle; when the build fails, report that rather than a confusing suite error.
if (!skipped.has("desktop")) {
  const build = part("desktop-build", process.execPath, ["tools/desktop/build.mjs"]);
  results.push(build);
  if (build.ok) results.push(part("desktop-suite", process.execPath, ["tools/desktop/measure.mjs", "--closing"]));
}

const parts = results;
const failed = parts.filter((entry) => !entry.ok);
console.log("\nclosing:suite");
for (const entry of parts) {
  console.log(`  ${entry.ok ? "ok  " : "FAIL"} ${entry.name}${entry.skipped ? " (skipped)" : ""}`);
}
if (failed.length > 0) {
  console.error(`closing:suite: ${failed.length} part(s) failed: ${failed.map((entry) => entry.name).join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("closing:suite: every host matches the committed closing baseline");
}
