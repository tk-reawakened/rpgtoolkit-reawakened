// One local entry point for the foundation's existing adapter and actual-host proofs (#1711).
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const nativeEnv = { ...process.env };
for (const key of Object.keys(nativeEnv)) {
  if (key.startsWith("TKR_VSCODE_") && key.endsWith("_PROOF")) delete nativeEnv[key];
}
const results = [];
let workspaceRoot;

function run(name, command, args, env = process.env) {
  console.log(`\neditor:acceptance — ${name}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" && command.endsWith(".cmd") });
}
function part(name, command, args, env = process.env) {
  try {
    run(name, command, args, env);
    results.push({ name, ok: true });
  } catch (error) {
    console.error(error);
    results.push({ name, ok: false });
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, "127.0.0.1", resolveListen).once("error", reject));
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

try {
  console.log(`editor:acceptance — Node ${process.versions.node}; actual UI hosts run serially`);
  run("prepare workspace builds", pnpm, ["build"]);
  run("prepare browser-server fixtures", pnpm, ["fixtures:fetch"]);
  run("prepare language-extension dependencies", npm, ["--prefix", "extensions/rpgcode", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  part("dependency-graph failure controls", pnpm, ["graph:test"]);
  part("actual dependency graph", pnpm, ["graph"]);
  part("browser / VS Code desktop / VS Code web adapters: lifecycle, exact saves and engine boot", process.execPath, [
    "--test", "tools/editor-vscode-test/test/host-conformance.test.ts", "tools/editor-vscode-test/test/game-settings-hosts.test.ts",
  ]);
  part("PWA: workspace, pickers, new project, History, program language and fixture execution", pnpm, [
    "browser:test", "tools/browser/tests/editor-web-host.spec.ts", "tools/browser/tests/editor-history.spec.ts",
    "tools/browser/tests/editor-program.spec.ts", "tools/browser/tests/editor-creator-tests.spec.ts", "--workers=1",
  ], { ...process.env, PLAYWRIGHT_PORT: process.env.PLAYWRIGHT_PORT ?? String(await freePort()) });
  part("actual VS Code web: native program language and debugger", pnpm, ["vscode-web:test"], {
    ...process.env, VSCODE_WEB_PORT: process.env.VSCODE_WEB_PORT ?? String(await freePort()),
  });
  part("native proof filesystem and workspace guards", process.execPath, [
    "--test", "tools/editor-vscode-test/persistent-fs.test.mjs", "tools/editor-vscode-test/proof-directories.test.mjs",
  ]);

  workspaceRoot = mkdtempSync(join(tmpdir(), "tkr-editor-foundation-"));
  const workspace = join(workspaceRoot, "editor");
  const programWorkspace = join(workspaceRoot, "program");
  cpSync(join(root, "docs/spec/examples/game/Game/Example"), workspace, { recursive: true });
  cpSync(join(root, "docs/spec/examples/game"), programWorkspace, { recursive: true });
  mkdirSync(join(workspace, "Main"), { recursive: true });
  mkdirSync(join(workspace, ".vscode"), { recursive: true });
  copyFileSync(join(root, "docs/spec/examples/game/Main/example.gam"), join(workspace, "Main/example.gam"));
  writeFileSync(join(workspace, ".vscode/settings.json"), '{"files.autoSave":"off"}\n');
  // Match CI: root must not bypass the native physical write-refusal proof.
  const dropCapabilities = process.platform === "linux" && process.getuid() === 0;
  const nativeCommand = dropCapabilities ? "setpriv" : process.execPath;
  const nativeArgs = (target) => [
    ...(dropCapabilities ? ["--bounding-set=-dac_override,-dac_read_search", process.execPath] : []),
    "tools/editor-vscode-test/run.mjs", "--extension", "extensions/editor", "--workspace", target, "--game", "Main/example.gam",
  ];
  part("actual VS Code web: complete editor cancel/keep, fresh project and durable History", nativeCommand, nativeArgs(workspace), nativeEnv);
  nativeEnv.TKR_VSCODE_PROGRAM_PROOF = "1";
  part("actual VS Code web: saved fixture program execution", nativeCommand, nativeArgs(programWorkspace), nativeEnv);
  delete nativeEnv.TKR_VSCODE_PROGRAM_PROOF;
  nativeEnv.TKR_VSCODE_CREATOR_TESTS_PROOF = "1";
  part("actual VS Code web: saved creator tests and headless parity", nativeCommand, nativeArgs(workspace), nativeEnv);

  console.log("\neditor:acceptance results");
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} ${result.name}`);
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  else console.log("editor:acceptance — every requested foundation check passed");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (workspaceRoot !== undefined) {
    try { rmSync(workspaceRoot, { recursive: true, force: true }); }
    catch (error) { console.error("editor:acceptance — temporary workspace cleanup failed", error); process.exitCode = 1; }
  }
}
