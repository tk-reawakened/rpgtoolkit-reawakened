import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, chmod, copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { compositeTileBitmap, createEmptyBoard, expandTileToRgba, readTileBitmap, readTileset, tileDimensions, TILE_BITMAP_MAGIC, writeBoard, writeTileBitmap, BinaryReader } from "@tk-reawakened/core";
import { buildNewBoard } from "@tk-reawakened/editor-model";
import { runVscodeAnimationProof, requestNativeReload, runVscodeAutosaveCommandProof, runVscodeBoardProof, runVscodeCreatorTestsProof, runVscodeGuardProof, runVscodeLaunchProof, runVscodeNewProjectProof, runVscodeProgramProof, runVscodeSpriteWebProof, runVscodeWebProof } from "./web-proof.ts";
import { cleanupTestRun, combineProofErrors, trackProcess, waitForHttpServer } from "./lifecycle.ts";
import { startPersistentFs } from "./persistent-fs.mjs";
import { createProofDirectories } from "./proof-directories.mjs";
import { createCreatorTestFiles } from "./creator-tests-fixture.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const harness = resolve(root, "tools/editor-vscode-test");
const args = parseArgs(process.argv[2] === "--" ? process.argv.slice(3) : process.argv.slice(2));
const extension = resolve(root, args.extension);
await access(resolve(root, "extensions/rpgcode/dist/extension.browser.js"));
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
await access(resolve(root, "extensions/rpgcode/dist/extension.browser.js"));
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
const animationProof = process.env.TKR_VSCODE_ANIMATION_PROOF === "1";
const launchProof = process.env.TKR_VSCODE_LAUNCH_PROOF === "1";
const boardProof = process.env.TKR_VSCODE_BOARD_PROOF === "1";
const programProof = process.env.TKR_VSCODE_PROGRAM_PROOF === "1";
const guardProof = process.env.TKR_VSCODE_GUARD_PROOF === "1";
const newProjectProof = process.env.TKR_VSCODE_NEW_PROJECT_PROOF === "1";
const autosaveCommandProof = process.env.TKR_VSCODE_AUTOSAVE_COMMAND_PROOF === "1";
const historyProof = process.env.TKR_VSCODE_HISTORY_PROOF === "1";
const skipSpriteProof = process.env.TKR_VSCODE_SKIP_SPRITE_PROOF === "1";
const workbenchSaveShortcutProof = process.env.TKR_VSCODE_WORKBENCH_SAVE_PROOF === "1";
const creatorTestsProof = process.env.TKR_VSCODE_CREATOR_TESTS_PROOF === "1";
if (creatorTestsProof) await access(resolve(extension, "dist/creator-tests-webview.js"));
if ((animationProof || launchProof || boardProof || programProof || guardProof || historyProof || newProjectProof || autosaveCommandProof || skipSpriteProof || workbenchSaveShortcutProof || creatorTestsProof) && game !== "Main/example.gam") throw new Error("The focused VS Code web proof requires docs/spec/examples/game and --game Main/example.gam");
for (const choice of animationProof || historyProof || skipSpriteProof || autosaveCommandProof || workbenchSaveShortcutProof || creatorTestsProof ? ["cancel"] : launchProof || boardProof || programProof || guardProof || newProjectProof ? ["cancel"] : ["cancel", "keep"]) {
  const { workspace: proofWorkspace, profile: browserProfile } = await createProofDirectories(gameFiles[0], game, undefined, undefined, workspace);
  if (creatorTestsProof) for (const file of createCreatorTestFiles()) {
    const target = resolve(proofWorkspace, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  const spriteDirectory = resolve(proofWorkspace, "Chrs");
  await mkdir(spriteDirectory, { recursive: true });
  await copyFile(spriteFile, resolve(proofWorkspace, spritePath));
  if (historyProof) await copyFile(spriteFile, resolve(proofWorkspace, "Chrs/ada.tem"));
  await mkdir(resolve(proofWorkspace, "Misc"), { recursive: true });
  await copyFile(spritePreviewGifFile, resolve(proofWorkspace, "Misc/vscode-web-proof.gif"));
  const boardPath = "Boards/village.brd";
  const otherBoardPath = "Boards/other.brd";
  const artPath = "Tiles/art.tst";
  const otherArtPath = "Tiles/other.tst";
  const bitmapPath = "Bitmap/house.tbm";
  const otherBitmapPath = "Bitmap/other.tbm";
 
  const boardBytes = createBoardBytes();
  await mkdir(resolve(proofWorkspace, "Boards"), { recursive: true });
  await mkdir(resolve(proofWorkspace, "Bitmap"), { recursive: true });
  await copyFile(spritePreviewGifFile, resolve(proofWorkspace, "Bitmap/a.gif"));
  await copyFile(spritePreviewGifFile, resolve(proofWorkspace, "Bitmap/z.gif"));
  await mkdir(resolve(proofWorkspace, "Tiles"), { recursive: true });
  const canvasBoards = [["2d", "top-down", 0], ["iso-stacked", "iso-stacked", 1], ["iso-rotated", "iso-rotated", 2]].map(([system, label, coordType]) => ({ system, label, coordType, path: `Boards/canvas-${label}.brd` }));
  await Promise.all([
    ...canvasBoards.map(async ({ system, path }) => {
      const built = buildNewBoard({ name: "canvas", coordSystem: system, pixelCoordinates: false, width: 8, height: 8, layers: 2, backgroundImage: "", template: null });
      if (!built.ok) throw new Error(`Could not create the canvas proof board: ${built.message}`);
      await writeFile(resolve(proofWorkspace, path), built.bytes);
    }),
    writeFile(resolve(proofWorkspace, boardPath), boardBytes),
    writeFile(resolve(proofWorkspace, otherBoardPath), boardBytes),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, artPath)),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, otherArtPath)),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, "Tiles/village.tst")),
    writeFile(resolve(proofWorkspace, bitmapPath), createBitmapBytes(false)),
    writeFile(resolve(proofWorkspace, otherBitmapPath), createOtherBitmapBytes()),
  ]);
  let persistentFs;
  let browser;
  let trackedProcess;
  let failure;
  let cleanupErrors = [];
  const routeErrors = [];
  const browserDiagnostics = [];
  const probeDiagnostics = [];
  const historyPreviewTraceDiagnostics = [];
  try {
    if (launchProof || boardProof || programProof || guardProof || historyProof) {
      await cp(resolve(workspace, "Game"), resolve(proofWorkspace, "Game"), { recursive: true });
      if (programProof || guardProof) await cp(resolve(root, "media/cursors/tkr-arrow.png"), resolve(proofWorkspace, "Game/Example/Bitmap/window.png"));
      const startProgram = boardProof || programProof || guardProof
        ? 'mwin("VS CODE FIXTURE PROOF")\nwait()\n'
        : 'mwin("Ready")\nwait()\nmwincls()\nsend("village.brd",2,2,1)\nwait()\n';
      await writeFile(resolve(proofWorkspace, "Game/Example/Prg/start.prg"), startProgram);
      if (historyProof) {
        await mkdir(resolve(proofWorkspace, "Prg"), { recursive: true });
        await writeFile(resolve(proofWorkspace, "Prg/start.prg"), startProgram);
      }
    }
    persistentFs = await startPersistentFs(proofWorkspace, `http://localhost:${port}`);
    const workbenchUrl = `http://localhost:${port}/`;
    const readinessUrl = `http://127.0.0.1:${port}/`;
    const startWorkbench = async () => {
      const child = spawn(resolve(harness, "node_modules/.bin/vscode-test-web"), [
        "--host=localhost", "--browser=none",
        `--extensionDevelopmentPath=${extension}`, `--extensionPath=${resolve(harness, "probe-extension")}`,
        `--extensionPath=${resolve(root, "extensions/rpgcode")}`,
        `--port=${port}`, `--folder-uri=tkr-testfs://${persistentFs.authority}/`,
        `--testRunnerDataDir=${process.env.TKR_VSCODE_TEST_DATA_DIR ?? resolve(root, ".vscode-test-web")}`,
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
    // A changed build shape fails closed rather than silently losing this safety assertion.
    const captureRouteErrors = (handler) => async (route) => {
      try {
        await handler(route);
      } catch (error) {
        routeErrors.push(error);
        try { await route.continue(); } catch (continuationError) { routeErrors.push(continuationError); }
      }
    };
    const providerRoute = captureRouteErrors(async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      if (source.split("__TKR_PROOF_SECRET__").length !== 2) throw new Error("Proof provider no longer matches the credential injection");
      await route.fulfill({ response, body: source.replace("__TKR_PROOF_SECRET__", persistentFs.token) });
    });
    const browserExtensionRoute = captureRouteErrors(async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      const [, bridgePort] = persistentFs.authority.split(".");
      const token = persistentFs.token;
      const trace = `async (kind, value) => { const response = await fetch("http://127.0.0.1:${bridgePort}/${token}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "trace", kind, value }) }); if (!response.ok) throw new Error("Proof trace failed"); }`;
      const restoreGate = `async (uri) => { const response = await fetch("http://127.0.0.1:${bridgePort}/${token}", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "armNativeRestoreRead", path: uri.path }) }); if (!response.ok) throw new Error("Native restore proof gate failed"); }`;
      const probes = [
        [
          "openCustomDocument: (uri, openContext) => core.openCustomDocument(uri, openContext.backupId)",
          `openCustomDocument: (uri, openContext) => { void (${trace})("open", uri.path).then(() => (${trace})("open-uri", uri.toString())).catch((error) => console.error("[proof trace]", error)); return core.openCustomDocument(uri, openContext.backupId); }`,
        ],
        [
          "resolveCustomEditor: async (document2, panel) => {",
          `resolveCustomEditor: async (document2, panel) => { void (${trace})("resolve", JSON.stringify({ resource: document2.uri.toString(), viewType: panel.viewType })).catch((error) => console.error("[proof trace]", error));`,
        ],
        [
          "saveCustomDocument: (document2) => core.saveCustomDocument(document2)",
          `saveCustomDocument: (document2) => { void (${trace})("save", document2.uri.path).then(() => (${trace})("save-uri", document2.uri.toString())).catch((error) => console.error("[proof trace]", error)); return core.saveCustomDocument(document2); }`,
        ],
      ];
      for (const [before, after] of probes) {
        if (source.split(before).length !== 2) throw new Error("Built VS Code adapter no longer matches the proof instrumentation");
        source = source.replace(before, after);
      }
      const typedEditListener = /if \((\w+)\.includes\((\w+)\.document\.model\.kind\)\) listener\(\2\);/g;
      if ([...source.matchAll(typedEditListener)].length !== 1) throw new Error("Typed editor event listener no longer matches the proof instrumentation");
      source = source.replace(typedEditListener, (_match, kinds, event) => `if (${kinds}.includes(${event}.document.model.kind)) { void (${trace})("edit", JSON.stringify({ resource: ${event}.document.uri.toString(), modelKind: ${event}.document.model.kind, registeredKinds: ${kinds}, label: ${event}.label })).catch((error) => console.error("[proof trace]", error)); listener(${event}); }`);
      const nativeRestoreRead = /const current = wasDirty \? new TextEncoder\(\)\.encode\(textBeforeRead\) : await (vscode\d+)\.workspace\.fs\.readFile\(uri\);/g;
      if ([...source.matchAll(nativeRestoreRead)].length !== 1) throw new Error("Native restore read no longer matches the proof gate");
      source = source.replace(nativeRestoreRead, (_match, vscodeBinding) => `const current = wasDirty ? new TextEncoder().encode(textBeforeRead) : await (async () => { await (${restoreGate})(uri); return ${vscodeBinding}.workspace.fs.readFile(uri); })();`);
      await route.fulfill({ response, body: source });
    });
    const registerContextRoutes = async () => {
      await browser.route("**/static/extensions/0/extension.js", providerRoute);
      await browser.route("**/static/devextensions/dist/extension.browser.js", browserExtensionRoute);
    };
    await registerContextRoutes();
    const recordBrowserDiagnostic = (message) => { if (browserDiagnostics.length < 100) browserDiagnostics.push(message.replaceAll(persistentFs.token, "[redacted]")); };
    let historyPreviewTraceSequence = 0;
    const recordHistoryPreviewTrace = (message) => {
      const clean = message.replaceAll(persistentFs.token, "[redacted]");
      const stage = /\[(?:history|editor)-preview-trace\]\s+([\w-]+)/.exec(clean)?.[1] ?? "untyped";
      const requestId = /\brequestId:\s*([^\s,}]+)/.exec(clean)?.[1] ?? "none";
      historyPreviewTraceDiagnostics.push(`${++historyPreviewTraceSequence} stage=${stage} requestId=${requestId} ${clean}`);
      if (historyPreviewTraceDiagnostics.length > 128) historyPreviewTraceDiagnostics.shift();
    };
    const newPage = async () => {
      const page = await browser.newPage();
      page.on("console", (message) => {
        const text = message.text();
        if (text.includes("[history-preview-trace]") || text.includes("[editor-preview-trace]")) {
          recordHistoryPreviewTrace(`[console] ${text}`);
        }
        if (text.includes("[vscode-web-proof-probe]") && probeDiagnostics.length < 100) {
          probeDiagnostics.push(`[console] ${text.replaceAll(persistentFs.token, "[redacted]")}`);
        }
        if (message.type() === "error" || /CommandService#executeCommand workbench\.action\.reloadWindow/.test(text)) {
          recordBrowserDiagnostic(`[console] ${text}`);
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
        await browser.unrouteAll({ behavior: "wait" });
        trackedProcess.child.kill("SIGTERM");
        const code = await trackedProcess.closed;
        if (code !== 0 || trackedProcess.errors.length) throw new Error(`VS Code web workbench did not stop cleanly: ${code}`);
        trackedProcess = undefined;
        if (offlineBytes !== undefined) await writeFile(resolve(proofWorkspace, game), offlineBytes);
        await startWorkbench();
        await registerContextRoutes();
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
    const writeBacking = async (path, bytes) => { await writeFile(resolve(proofWorkspace, path), bytes); };
    const withBackingWriteRefused = async (path, check) => {
      const target = resolve(proofWorkspace, path);
      const mode = (await stat(target)).mode & 0o777;
      await chmod(target, mode & ~0o222);
      let failure;
      const cleanupErrors = [];
      try { await check(); } catch (error) { failure = error; }
      try { await chmod(target, mode); } catch (error) { cleanupErrors.push(error); }
      const combined = combineProofErrors(failure, cleanupErrors);
      if (combined !== undefined) throw combined;
    };
    const proveNewProject = async () => {
      await mkdir(resolve(proofWorkspace, "__tkr_new_project"), { recursive: true });
      await writeFile(resolve(proofWorkspace, "__tkr_new_project/keep.txt"), "Keep this file");
      const bitmapPath = "__tkr_new_project/Bitmap/history.tbm";
      await mkdir(resolve(proofWorkspace, "__tkr_new_project/Bitmap"), { recursive: true });
      await mkdir(resolve(proofWorkspace, "__tkr_new_project/Tiles"), { recursive: true });
      await writeFile(resolve(proofWorkspace, bitmapPath), createBitmapBytes(false));
      await copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, "__tkr_new_project/Tiles/village.tst"));
      const tree = async () => (await readdir(proofWorkspace, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .map((entry) => relative(proofWorkspace, resolve(entry.parentPath ?? proofWorkspace, entry.name)).replaceAll("\\", "/") + (entry.isDirectory() ? "/" : ""))
        .sort();
      await runVscodeNewProjectProof(page, expect, workbenchUrl, tree, readBacking, {
        bitmapPath, bitmapPictureForBytes: expectedBitmapPicture,
        previewTrace: () => historyPreviewTraceDiagnostics.slice(),
        pauseWrite: persistentFs.pauseWrite,
        resumeWrite: persistentFs.resumeWrite,
        pauseNativeRestoreRead: persistentFs.pauseNativeRestoreRead,
        resumeRead: persistentFs.resumeRead,
        writeEvents: persistentFs.writeEvents,
        nativeRestoreReadEvents: persistentFs.nativeRestoreReadEvents,
        readEvents: persistentFs.readEvents,
        writeOperationEvents: persistentFs.writeOperationEvents,
        failedWriteEvents: persistentFs.failedWriteEvents,
        failWritesUnder: persistentFs.failWritesUnder,
        allowWrites: persistentFs.allowWrites,
        writeBacking,
      });
      console.log("vscode.dev real New project picker, creation and automatic-open proof passed");
    };
    if (creatorTestsProof) {
      const { runCreatorSpecs } = await import(pathToFileURL(resolve(root, "packages/script-spec/dist/browser.js")).href);
      await runVscodeCreatorTestsProof(page, expect, workbenchUrl, runCreatorSpecs, {
        readBacking, writeBacking, withBackingWriteRefused, readWriteEvents: persistentFs.writeEvents,
        pauseWrite: persistentFs.pauseWrite, resumeWrite: persistentFs.resumeWrite,
      });
      console.log("VS Code saved creator-test command, actual frame, source link, snapshot hashes and headless parity proof passed");
    } else if (animationProof) {
      await runVscodeAnimationProof(page, expect, workbenchUrl, { readBacking, withBackingWriteRefused });
      console.log("vscode.dev animation creation, partial-write retry and persistent recovery proof passed");
    } else if (newProjectProof) {
      await proveNewProject();
    } else if (guardProof) {
      await runVscodeGuardProof(page, expect, workbenchUrl, game, readBacking,
        new Uint8Array(await readFile(gameFiles[0])), await createWebAdapterBytes(gameFiles[0], game, "Race saved"));
      console.log("vscode.dev save and concurrent-edit guard proof passed");
    } else if (boardProof) {
      await runVscodeBoardProof(page, expect, workbenchUrl);
      console.log("vscode.dev fresh board launch proof passed");
    } else if (programProof) {
      await runVscodeProgramProof(page, expect, workbenchUrl);
      console.log("vscode.dev fixture program proof passed");
    } else if (launchProof) {
      const launchBytes = await createWebAdapterBytes(gameFiles[0], game, "VS Code launch proof");
      await runVscodeLaunchProof(page, expect, workbenchUrl, game, readBacking, launchBytes);
      console.log("vscode.dev live player launch proof passed");
    } else if (autosaveCommandProof) {
      await runVscodeAutosaveCommandProof(page, expect, workbenchUrl, game, autosaveTitle, autosaveBytes, {
        readBacking, writeBacking, withBackingWriteRefused, readHostEvents: persistentFs.events,
        pauseSave: persistentFs.pauseSave, resumeSave: persistentFs.resumeSave, externalBytes, sentinelTitle, sentinelBytes,
        choice, boardPath, otherBoardPath, artPath, otherArtPath, bitmapPath, otherBitmapPath,
        bitmapSaved: createBitmapBytes(true), bitmapPicture: (edited) => expectedBitmapPicture(createBitmapBytes(edited)),
        canvasBoards: canvasBoards.map(({ path, label, coordType }) => ({ path, label, coordType })),
      });
      console.log("vscode.dev autosave command palette proof passed");
    } else {
      if (choice === "cancel" && !skipSpriteProof) {
        await runVscodeAnimationProof(page, expect, workbenchUrl, { readBacking, withBackingWriteRefused });
        console.log("vscode.dev animation creation, partial-write retry and persistent recovery proof passed");
        await runVscodeSpriteWebProof(page, expect, workbenchUrl, spritePath, spriteBytes, { readBacking });
        console.log("vscode.dev sprite save/reopen proof passed");
      }
      await runVscodeWebProof(page, expect, workbenchUrl, game, title, expectedBytes, recoveredTitle, recoveredBytes, autosaveTitle, autosaveBytes, {
        restart, readBacking, writeBacking, withBackingWriteRefused, readHostEvents: persistentFs.events,
        pauseWrite: persistentFs.pauseWrite, resumeWrite: persistentFs.resumeWrite, writeEvents: persistentFs.writeEvents, externalBytes, sentinelTitle, sentinelBytes,
        choice, boardPath, otherBoardPath, artPath, otherArtPath, bitmapPath, otherBitmapPath,
        bitmapSaved: createBitmapBytes(true), bitmapPicture: (edited) => expectedBitmapPicture(createBitmapBytes(edited)),
        canvasBoards: canvasBoards.map(({ path, label, coordType }) => ({ path, label, coordType })),
        ...(workbenchSaveShortcutProof ? { saveViaWorkbenchShortcut: process.platform === "darwin" ? "Meta+S" : "Control+S" } : {}),
      });
      console.log(`vscode.dev settings, board, art and bitmap proof passed (${choice})`);
      if (choice === "cancel") await proveNewProject();
    }
  } catch (error) {
    failure = error;
  } finally {
    if (browser !== undefined) {
      try { await browser.unrouteAll({ behavior: "wait" }); } catch (error) { cleanupErrors.push(error); }
    }
    cleanupErrors.push(...await cleanupTestRun(browser, trackedProcess, proofWorkspace));
    cleanupErrors.push(...routeErrors);
    if (persistentFs !== undefined) {
      try { await persistentFs.close(); } catch (error) { cleanupErrors.push(error); }
    }
    try { await rm(browserProfile, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  }
  const proofFailure = combineProofErrors(failure, cleanupErrors);
  if (proofFailure !== undefined) {
    if (browserDiagnostics.length > 0) console.error(`[vscode-web:failure-diagnostics]\n${browserDiagnostics.join("\n")}`);
    if (historyPreviewTraceDiagnostics.length > 0) console.error(`[vscode-web:history-preview-trace]\n${historyPreviewTraceDiagnostics.join("\n")}`);
    if (probeDiagnostics.length > 0) console.error(`[vscode-web:probe-diagnostics]\n${probeDiagnostics.join("\n")}`);
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
/** The 2 × 2 proof bitmap: tile 1 plain except a shaded tile 2 at column 2, row 1; `edited` is what the proof's two edits must leave in the file. */
function createBitmapBytes(edited) {
  const cell = (tile, r = 0, g = 0, b = 0) => ({ tile, r, g, b });
  const pad = cell("pad.gph", 1, 2, 3);
  const first = edited ? cell("village.tst1", -255, 0, 0) : cell("village.tst1");
  const second = edited ? cell("village.tst1", 10, -20, 30) : cell("village.tst2", 10, -20, 30);
  // x outer, y inner, with the stored extra column and row after the drawn cells (docs/spec/formats/tiles.md#tile-bitmap-tbm).
  const cells = [first, cell("village.tst1"), pad, second, cell("village.tst1"), pad, pad, pad, pad];
  const written = writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 2, height: 2, cells, residue: Uint8Array.from([7, 7, 7]) });
  if (!written.ok) throw new Error(`Could not create authored tile bitmap proof fixture: ${written.error.message}`);
  return written.value;
}

/** The 3 × 1 bitmap the Edit tile bitmap action must open: every cell is tile 2 shaded (1, 2, 3), unlike the 2 × 2 proof bitmap. */
function createOtherBitmapBytes() {
  const cell = (tile, r = 0, g = 0, b = 0) => ({ tile, r, g, b });
  const pad = cell("pad.gph", 1, 2, 3);
  const shaded = cell("village.tst2", 1, 2, 3);
  const written = writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 3, height: 1, cells: [shaded, pad, shaded, pad, shaded, pad, pad, pad], residue: new Uint8Array() });
  if (!written.ok) throw new Error(`Could not create authored second tile bitmap proof fixture: ${written.error.message}`);
  return written.value;
}

/** What the core compositor makes of `bytes` over the proof tileset: the oracle the proof compares the webview's canvas with. */
function expectedBitmapPicture(bytes) {
  const tilesetBytes = readFileSync(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"));
  const tileset = readTileset(new Uint8Array(tilesetBytes), "village.tst");
  const bitmap = readTileBitmap(new BinaryReader(bytes, "proof.tbm"));
  if (!tileset.ok || !bitmap.ok) throw new Error("Could not read the proof bitmap or tileset for the pixel oracle");
  const { width, height } = tileDimensions(tileset.value.detail);
  const tiles = new Map();
  tileset.value.tiles.forEach((_, index) => {
    const column = expandTileToRgba(tileset.value, index);
    if (!column.ok) throw new Error(column.error.message);
    const rgba = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x += 1) for (let y = 0; y < height; y += 1) rgba.set(column.value.subarray((x * height + y) * 4, (x * height + y) * 4 + 4), (y * width + x) * 4);
    tiles.set(`village.tst${index + 1}`, { w: width, h: height, rgba });
  });
  const composed = compositeTileBitmap(bitmap.value, tiles);
  if (!composed.ok) throw new Error(composed.error.message);
  return { width: composed.value.w, height: composed.value.h, data: [...composed.value.rgba] };
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




