import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { runVscodeWebProof } from "./web-proof.ts";
import { cleanupTestRun, combineProofErrors, trackProcess, waitForHttpServer } from "./lifecycle.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const harness = resolve(root, "tools/editor-vscode-test");
const args = parseArgs(process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2));
const extension = resolve(root, args.extension);
const workspace = resolve(root, args.workspace);
const game = args.game.replaceAll("\\", "/");
const configuredPort = process.env.TKR_VSCODE_TEST_PORT;
const port = configuredPort === undefined ? await freePort() : Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("TKR_VSCODE_TEST_PORT must be a valid TCP port");
if (game.startsWith("/") || game.split("/").includes("..") || !game.toLowerCase().endsWith(".gam")) throw new Error("--game must be a workspace-relative .gam path");
await access(resolve(extension, "package.json"));
const manifest = JSON.parse(await readFile(resolve(extension, "package.json"), "utf8"));
if (`${manifest.publisher}.${manifest.name}` !== "tk-reawakened.editor") throw new Error("The built extension must have the id tk-reawakened.editor");
await access(resolve(extension, manifest.main));
await access(resolve(extension, manifest.browser));
await access(resolve(extension, "dist/webview.js"));
await access(workspace);
const gameFiles = await findGameFiles(workspace);
if (gameFiles.length !== 1 || resolve(workspace, game) !== gameFiles[0]) {
  throw new Error(`The VS Code web proof workspace must contain exactly one .gam file, matching --game; found ${gameFiles.length}`);
}
await access(gameFiles[0]);
const title = `VS Code web proof ${Date.now()}`;
const recoveredTitle = `${title} recovered`;
const [expectedBytes, recoveredBytes] = await Promise.all([
  createWebAdapterBytes(gameFiles[0], game, title),
  createWebAdapterBytes(gameFiles[0], game, recoveredTitle),
]);
await access(resolve(harness, "node_modules/.bin/vscode-test-web"));
const cdpPort = await freePort();
const proofWorkspace = await createProofWorkspace(gameFiles[0], game);
let browser;
let trackedProcess;
let failure;
let cleanupErrors = [];
const browserDiagnostics = [];
try {
  const child = spawn(resolve(harness, "node_modules/.bin/vscode-test-web"), [
    "--host=localhost", "--browserType=chromium", `--browserOption=--remote-debugging-port=${cdpPort}`,
    `--extensionDevelopmentPath=${extension}`, `--extensionPath=${resolve(harness, "probe-extension")}`,
    `--port=${port}`, proofWorkspace,
  ], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" "),
    },
  });
  trackedProcess = trackProcess(child);
  const workbenchUrl = `http://localhost:${port}/`;
  const readinessUrl = `http://127.0.0.1:${port}/`;
  await Promise.race([waitForHttpServer(child, readinessUrl), trackedProcess.error]);
  browser = await connectBrowser(child, cdpPort);
  const { page } = await waitForBrowserPage(browser, child);
  const recordBrowserDiagnostic = (message) => { if (browserDiagnostics.length < 100) browserDiagnostics.push(message); };
  page.on("console", (message) => { if (message.type() === "error") recordBrowserDiagnostic(`[console] ${message.text()}`); });
  page.on("pageerror", (error) => recordBrowserDiagnostic(`[pageerror] ${error.stack ?? error.message}`));
  page.on("requestfailed", (request) => recordBrowserDiagnostic(`[requestfailed] ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`));
  await runVscodeWebProof(page, expect, workbenchUrl, game, title, expectedBytes, recoveredTitle, recoveredBytes);
  console.log("vscode.dev settings proof passed");
} catch (error) {
  failure = error;
} finally {
  cleanupErrors = await cleanupTestRun(browser, trackedProcess, proofWorkspace);
}
const proofFailure = combineProofErrors(failure, cleanupErrors);
if (proofFailure !== undefined) {
  if (browserDiagnostics.length > 0) console.error(`[vscode-web:failure-diagnostics]\n${browserDiagnostics.join("\n")}`);
  throw proofFailure;
}
async function createProofWorkspace(gameFile, gamePath) {
  const directory = await mkdtemp(join(tmpdir(), "tkr-editor-vscode-proof-"));
  try {
    const gameCopy = resolve(directory, gamePath);
    await mkdir(dirname(gameCopy), { recursive: true });
    await copyFile(gameFile, gameCopy);
    const settingsDirectory = resolve(directory, ".vscode");
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(resolve(settingsDirectory, "settings.json"), `${JSON.stringify({ "files.autoSave": "off" }, null, 2)}\n`);
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function createWebAdapterBytes(file, gamePath, title) {
  const [web, model] = await Promise.all([
    import(pathToFileURL(resolve(root, "packages/host-web/dist/index.js")).href),
    import(pathToFileURL(resolve(root, "packages/editor-model/dist/index.js")).href),
  ]);
  const original = new Uint8Array(await readFile(file));
  const project = web.createSessionCopy(gamePath, original);
  const identity = model.createDocumentIdentity(project.project.id, gamePath);
  const opened = await model.openMainDocument(project.services.fs, identity);
  if (!opened.ok) throw new Error(`The web adapter could not open the proof game: ${opened.error.error.message}`);
  const edit = opened.document.apply({ type: "set-game-title", title });
  if (!edit.ok) throw new Error(`The web adapter rejected the proof title: ${edit.rejection.message}`);
  const saved = await opened.document.save();
  if (!saved.ok) throw new Error(`The web adapter could not save the proof game: ${saved.failure.message}`);
  const bytes = await project.services.fs.read(gamePath);
  if (!bytes.ok) throw new Error(`The web adapter could not read saved proof bytes: ${bytes.error.message}`);
  const reopened = await model.openMainDocument(project.services.fs, identity);
  if (!reopened.ok || reopened.document.getSnapshot().gameTitle !== title) throw new Error("The web adapter failed to reopen the saved proof title");
  return bytes.value;
}

async function findGameFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findGameFiles(path));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gam")) files.push(path);
  }
  return files;
}


function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!["--extension", "--workspace", "--game"].includes(key) || parsed[key]) throw usage();
    parsed[key] = values[index + 1];
    index += 1;
  }
  if (["--extension", "--workspace", "--game"].some((key) => typeof parsed[key] !== "string" || !parsed[key])) throw usage();
  return { extension: parsed["--extension"], workspace: parsed["--workspace"], game: parsed["--game"] };
}

function usage() { return new Error("Usage: pnpm --dir tools/editor-vscode-test proof -- --extension <built-extension> --workspace <fixture-workspace> --game <relative.gam>"); }

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, "127.0.0.1", resolveListen).once("error", reject));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Could not allocate a local port");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function connectBrowser(child, debugPort) {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vscode-test-web exited early (${child.exitCode})`);
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); }
    catch (error) { lastError = error; }
    await delay(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  throw new Error(`Timed out attaching to vscode-test-web Chromium: ${String(lastError)}`);
}

async function waitForBrowserPage(browser, child) {
  const deadline = Date.now() + 30_000;
  let pause = 100;
  let observedContexts = 0;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vscode-test-web exited before opening a browser page (${child.exitCode})`);
    const contexts = browser.contexts();
    observedContexts = contexts.length;
    for (const context of contexts) {
      const page = context.pages()[0];
      if (page) return { context, page };
    }
    await delay(pause);
    pause = Math.min(pause * 2, 1_000);
  }
  throw new Error(`Timed out waiting for vscode-test-web to create its initial page (${observedContexts} browser context(s) observed)`);
}


