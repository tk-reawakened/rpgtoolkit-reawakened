// Runs the RPGCode debugger, or the control probe, inside VS Code for the Web (#950).
//
//   node tools/vscode-web/run.mjs            the RPGCode debugger scenario (CI)
//   node tools/vscode-web/run.mjs --probe    the control probe extension
//
// `PROBE_FORMAT=cjs|iife` chooses the probe's module format, which is how the harness shows
// that a web extension's `browser` entry must be CommonJS: an IIFE bundle loads with no
// `activate` export, the host never enters it, and `startDebugging` then answers
// "Couldn't find a debug adapter descriptor".
//
// `@vscode/test-web` serves a real VS Code web build with the extension installed and the
// fixture folder mounted, runs the test module in the web extension host, and exits non-zero
// when an assertion fails. The VS Code build is downloaded once into `.vscode-test-web/`.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const probe = process.argv.includes("--probe");
const extensionPath = probe
  ? join(here, "fixtures", "minimal-extension")
  : join(root, "extensions", "rpgcode");
const testsPath = join(extensionPath, "dist", "web-tests.js");
const fixturePath = join(root, "packages", "dap", "test", "fixtures", "probe");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

if (!existsSync(join(extensionPath, "package.json"))) throw new Error(`${extensionPath} has no package.json`);
if (!existsSync(join(fixturePath, "Prg", "probe.prg"))) throw new Error(`${fixturePath} is not the 10.10 fixture`);

// The scenarios drive the *bundled* extension, so it is built first; its own `node_modules`
// must already be installed (`npm --prefix extensions/rpgcode install`).
if (!probe) run(process.execPath, [join(root, "extensions", "rpgcode", "build.mjs")]);
// The program-editing scenario also drives the editor extension's commands (story 11.7), so it is built and loaded too.
const editorExtension = join(root, "extensions", "editor");
if (!probe) {
  run(process.execPath, [join(root, "packages", "host-vscode", "build.mjs")]);
  run(process.execPath, [join(editorExtension, "build.mjs")]);
}
run(process.execPath, [join(here, "build.mjs")]);

const { runTests } = await import("@vscode/test-web");
// Scenarios write files and settings; keep their workspace separate from committed fixtures.
const fixtureRoot = mkdtempSync(join(tmpdir(), "tkr-vscode-web-"));
const fixtureCopy = join(fixtureRoot, "probe");
try {
  cpSync(fixturePath, fixtureCopy, { recursive: true });
  await runTests({
    browserType: "chromium",
    quality: "stable",
    headless: true,
    extensionDevelopmentPath: extensionPath,
    ...(probe ? {} : { extensionPaths: [editorExtension] }),
    extensionTestsPath: testsPath,
    folderPath: fixtureCopy,
    // A lane that runs beside another local server needs its own port.
    port: Number(process.env.VSCODE_WEB_PORT ?? "3111"),
    // The download is kept between runs (CI caches this folder).
    testRunnerDataDir: join(root, ".vscode-test-web"),
    verbose: process.env.VSCODE_WEB_VERBOSE === "true",
  });
  console.log(probe ? "vscode-web: the control probe passed" : "vscode-web: the debugger scenario passed in VS Code for the Web");
} catch (error) {
  console.error(probe ? "vscode-web: the control probe failed" : "vscode-web: the debugger scenario failed");
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  const log = join(root, ".vscode-test-web", "log.txt");
  if (existsSync(log)) console.error(readFileSync(log, "utf8"));
  process.exitCode = 1;
} finally {
  try { rmSync(fixtureRoot, { recursive: true, force: true }); }
  catch (error) { console.error("vscode-web: temporary fixture cleanup failed", error); process.exitCode = 1; }
}
