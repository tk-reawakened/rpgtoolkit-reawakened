import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createEmptyBoard, writeBoard } from "@tk-reawakened/core";
import { requestNativeReload, runVscodeSpriteWebProof, runVscodeWebProof } from "./web-proof.ts";
import { cleanupTestRun, combineProofErrors, trackProcess, waitForHttpServer } from "./lifecycle.ts";
import { startPersistentFs } from "./persistent-fs.mjs";
import { createProofDirectories } from "./proof-directories.mjs";

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
if (game.split("/").at(-1).toLowerCase() === "__tkr_sentinel.gam") throw new Error("--game cannot use the reserved proof sentinel name");
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
const spritePath = "Chrs/__tkr_sprite_proof.tem";
const spriteFile = resolve(root, "docs/spec/examples/versions/character/character_minor8.tem");
const spritePreviewGifFile = resolve(root, "packages/core/test/fixtures/authored/gif-anim89a.gif");
await access(spritePreviewGifFile);
await access(spriteFile);
const spriteBytes = new Uint8Array(await readFile(spriteFile));
const title = `VS Code web proof ${Date.now()}`;
const recoveredTitle = `${title} recovered`;
const autosaveTitle = `${title} autosaved`;
const externalTitle = `${title} external`;
const sentinelTitle = `${title} unrelated dirty editor`;
const [expectedBytes, recoveredBytes, autosaveBytes, externalBytes, sentinelBytes] = await Promise.all([
  createWebAdapterBytes(gameFiles[0], game, title),
  createWebAdapterBytes(gameFiles[0], game, recoveredTitle),
  createWebAdapterBytes(gameFiles[0], game, autosaveTitle),
  createWebAdapterBytes(gameFiles[0], game, externalTitle),
  createWebAdapterBytes(gameFiles[0], "__tkr_sentinel.gam", sentinelTitle),
]);
await access(resolve(harness, "node_modules/.bin/vscode-test-web"));
for (const choice of ["cancel", "keep"]) {
  const { workspace: proofWorkspace, profile: browserProfile } = await createProofDirectories(gameFiles[0], game);
  const spriteDirectory = resolve(proofWorkspace, "Chrs");
  await mkdir(spriteDirectory, { recursive: true });
  await copyFile(spriteFile, resolve(proofWorkspace, spritePath));
  await mkdir(resolve(proofWorkspace, "Misc"), { recursive: true });
  await copyFile(spritePreviewGifFile, resolve(proofWorkspace, "Misc/vscode-web-proof.gif"));
  const boardPath = "Boards/village.brd";
  const otherBoardPath = "Boards/other.brd";
  const boardBytes = createBoardBytes();
  await mkdir(resolve(proofWorkspace, "Boards"), { recursive: true });
  await mkdir(resolve(proofWorkspace, "Tiles"), { recursive: true });
  await Promise.all([
    writeFile(resolve(proofWorkspace, boardPath), boardBytes),
    writeFile(resolve(proofWorkspace, otherBoardPath), boardBytes),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, "Tiles/village.tst")),
  ]);
  let persistentFs;
  let browser;
  let trackedProcess;
  let failure;
  let cleanupErrors = [];
  const browserDiagnostics = [];
  try {
    persistentFs = await startPersistentFs(proofWorkspace, `http://localhost:${port}`);
    const workbenchUrl = `http://localhost:${port}/`;
    const readinessUrl = `http://127.0.0.1:${port}/`;
    const startWorkbench = async () => {
      const child = spawn(resolve(harness, "node_modules/.bin/vscode-test-web"), [
        "--host=localhost", "--browser=none",
        `--extensionDevelopmentPath=${extension}`, `--extensionPath=${resolve(harness, "probe-extension")}`,
        `--port=${port}`, `--folder-uri=tkr-testfs://${persistentFs.authority}/`,
      ], {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" "),
        },
      });
      trackedProcess = trackProcess(child);
      await Promise.race([waitForHttpServer(child, readinessUrl), trackedProcess.error]);
    };
    await startWorkbench();
    browser = await chromium.launchPersistentContext(browserProfile, { headless: true });
    // Observe the actual built host adapter at its dispatch boundary without adding a production test hook.
    // A changed build shape fails closed rather than silently losing this safety assertion.
    await browser.route("**/static/extensions/0/extension.js", async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      if (source.split("__TKR_PROOF_SECRET__").length !== 2) throw new Error("Proof provider no longer matches the credential injection");
      await route.fulfill({ response, body: source.replace("__TKR_PROOF_SECRET__", persistentFs.token) });
    });
    await browser.route("**/static/devextensions/dist/extension.browser.js", async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      const [, bridgePort] = persistentFs.authority.split(".");
      const token = persistentFs.token;
      const trace = `async (kind, value) => { const response = await fetch("http://127.0.0.1:${bridgePort}/${token}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "trace", kind, value }) }); if (!response.ok) throw new Error("Proof trace failed"); }`;
      // The bundler numbers the `vscode` namespace by how many modules import it, so the name is read from the build.
      const namespace = /saveEditor: async \(uri\) => await (vscode\d*)\.workspace\.save\(uri\)/.exec(source)?.[1];
      if (namespace === undefined) throw new Error("Built VS Code adapter no longer matches the proof instrumentation");
      const probes = [
        [
          `saveEditor: async (uri) => await ${namespace}.workspace.save(uri)`,
          `saveEditor: async (uri) => { await (${trace})("save-request", uri.path); return await ${namespace}.workspace.save(uri); }`,
        ],
        [
          "saveCustomDocument: (document2) => core.saveCustomDocument(document2)",
          `saveCustomDocument: async (document2) => { await (${trace})("save", document2.uri.path); return core.saveCustomDocument(document2); }`,
        ],
        [
          "revertCustomDocument: (document2) => core.revertCustomDocument(document2)",
          `revertCustomDocument: async (document2) => { await (${trace})("revert", document2.uri.path); return core.revertCustomDocument(document2); }`,
        ],
      ];
      for (const [before, after] of probes) {
        if (source.split(before).length !== 2) throw new Error("Built VS Code adapter no longer matches the proof instrumentation");
        source = source.replace(before, after);
      }
      await route.fulfill({ response, body: source });
    });
    const recordBrowserDiagnostic = (message) => { if (browserDiagnostics.length < 100) browserDiagnostics.push(message.replaceAll(persistentFs.token, "[redacted]")); };
    const newPage = async () => {
      const page = await browser.newPage();
      page.on("console", (message) => {
        if (message.type() === "error" || /CommandService#executeCommand workbench\.action\.reloadWindow|\[vscode-web-proof-probe\] requesting native reload/.test(message.text())) {
          recordBrowserDiagnostic(`[console] ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => recordBrowserDiagnostic(`[pageerror] ${error.stack ?? error.message}`));
      page.on("requestfailed", (request) => recordBrowserDiagnostic(`[requestfailed] ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`));
      return page;
    };
    const page = await newPage();
    const restart = async (currentPage, offlineBytes) => {
      const extensionFrame = currentPage.frames().find((frame) => frame.url().includes("webWorkerExtensionHostIframe.html"));
      if (extensionFrame === undefined) throw new Error("The web extension host was not running before restart");
      const paused = Promise.withResolvers();
      const release = Promise.withResolvers();
      const continued = Promise.withResolvers();
      const script = "**/workbench.web.main.internal.js";
      const holdBootstrap = async (route) => {
        paused.resolve();
        await release.promise;
        try {
          await route.continue();
          continued.resolve();
        } catch (error) {
          continued.resolve(error);
        }
      };
      await currentPage.route(script, holdBootstrap);
      try {
        await requestNativeReload(currentPage, expect);
        const timeout = Promise.withResolvers();
        const timer = setTimeout(() => timeout.reject(new Error("Workbench bootstrap did not pause")), 30_000);
        try { await Promise.race([paused.promise, timeout.promise]); } finally { clearTimeout(timer); }
        if (!extensionFrame.isDetached()) throw new Error("The previous extension host did not stop before offline mutation");
        trackedProcess.child.kill("SIGTERM");
        const code = await trackedProcess.closed;
        if (code !== 0 || trackedProcess.errors.length) throw new Error(`VS Code web workbench did not stop cleanly: ${code}`);
        trackedProcess = undefined;
        if (offlineBytes !== undefined) await writeFile(resolve(proofWorkspace, game), offlineBytes);
        await startWorkbench();
        release.resolve();
        const routeError = await continued.promise;
        if (routeError) throw routeError;
        await currentPage.unroute(script, holdBootstrap);
        return currentPage;
      } finally {
        release.resolve();
      }
    };
    const readBacking = async (path = game) => new Uint8Array(await readFile(resolve(proofWorkspace, path)));
    if (choice === "cancel") {
      await runVscodeSpriteWebProof(page, expect, workbenchUrl, spritePath, spriteBytes, { readBacking });
      console.log("vscode.dev sprite save/reopen proof passed");
    }
    await runVscodeWebProof(page, expect, workbenchUrl, game, title, expectedBytes, recoveredTitle, recoveredBytes, autosaveTitle, autosaveBytes, { restart, readBacking, readHostEvents: persistentFs.events, pauseSave: persistentFs.pauseSave, resumeSave: persistentFs.resumeSave, externalBytes, sentinelTitle, sentinelBytes, choice, boardPath, otherBoardPath });
    console.log(`vscode.dev settings and board proof passed (${choice})`);
  } catch (error) {
    failure = error;
  } finally {
    cleanupErrors.push(...await cleanupTestRun(browser, trackedProcess, proofWorkspace));
    if (persistentFs !== undefined) {
      try { await persistentFs.close(); } catch (error) { cleanupErrors.push(error); }
    }
    try { await rm(browserProfile, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  }
  const proofFailure = combineProofErrors(failure, cleanupErrors);
  if (proofFailure !== undefined) {
    if (browserDiagnostics.length > 0) console.error(`[vscode-web:failure-diagnostics]\n${browserDiagnostics.join("\n")}`);
    throw proofFailure;
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
function createBoardBytes() {
  const empty = createEmptyBoard();
  const board = {
    ...empty,
    sizeX: 2,
    sizeY: 2,
    sizeL: 1,
    layerTitles: ["", ""],
    lut: ["", "village.tst1", "village.tst2"],
    tileMatrix: [1, 2, 2, 1],
    tileRuns: [
      { lutIndex: 1, count: 1, marker: false },
      { lutIndex: 2, count: 1, marker: true },
      { lutIndex: 2, count: 1, marker: false },
      { lutIndex: 1, count: 1, marker: false },
    ],
  };
  const written = writeBoard(board);
  if (!written.ok) throw new Error(`Could not create authored board proof fixture: ${written.error.message}`);
  return written.value;
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




