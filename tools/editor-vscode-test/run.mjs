import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { compositeTileBitmap, createEmptyBoard, expandTileToRgba, readTileBitmap, readTileset, tileDimensions, TILE_BITMAP_MAGIC, writeBoard, writeTileBitmap, BinaryReader, projectFolder, readMainFile, readPreVectorBoard } from "@tk-reawakened/core";
import { buildNewBoard, encodeScenePng } from "@tk-reawakened/editor-model";
import { boardPropertiesProofFiles } from "./board-properties-proof.ts";
import { boardObjectsProofFiles } from "./board-objects-proof.ts";
import { connectedAuthoringProofFiles } from "./connected-authoring-proof.ts";
import { runVscodeScriptWorkflowProof, scriptWorkflowProofFiles } from "./script-workflow-proof.ts";
import { runVscodeBoardPropertiesProof, runVscodeBoardObjectsProof, runVscodeConnectedAuthoringProof, runVscodeAnimationProof, runVscodeFontProof, runVscodeBattleDataProof, requestNativeReload, runVscodeAutosaveCommandProof, runVscodeBoardProof, runVscodeBoardUpgradeProof, runVscodeCreatorTestsProof, runVscodeGuardProof, runVscodeLaunchProof, runVscodeNewProjectProof, runVscodeProgramProof, runVscodeRunAndDebugProof, runVscodeSpriteWebProof, runVscodeWebProof } from "./web-proof.ts";
import { runVscodeDesignProof } from "./design-proof.ts";
import { NATIVE_CLIP_PROOF_PATH, runVscodeNativeClipProof } from "./native-clip-proof.ts";
import { NATIVE_SCENE_PROOF_PATH, runVscodeNativeSceneProof } from "./native-scene-proof.ts";
import { runVscodeBoardImportProof } from "./board-import-proof.ts";
import { geometryProofFiles } from "./native-geometry-fixture.ts";
import { runVscodeNativeGeometryProof } from "./native-geometry-vscode-proof.ts";
import { runVscodeVisualEventsProof, VISUAL_EVENTS_PROOF_PATH } from "./visual-events-proof.ts";
import { cleanupTestRun, combineProofErrors, trackProcess, waitForHttpServer } from "./lifecycle.ts";
import { startPersistentFs } from "./persistent-fs.mjs";
import { createProofDirectories } from "./proof-directories.mjs";
import { createCreatorTestFiles } from "./creator-tests-fixture.mjs";
import { CREATOR_PROJECT, runVscodeCreatorAcceptanceProof } from "./creator-acceptance-proof.ts";

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
if (process.env.TKR_VSCODE_BOARD_UPGRADE_PROOF === "1" && process.env.TKR_VSCODE_CREATOR_ACCEPTANCE_PROOF === "1") {
  throw new Error("TKR_VSCODE_BOARD_UPGRADE_PROOF cannot be combined with another VS Code proof mode");
}
if (process.env.TKR_VSCODE_CREATOR_ACCEPTANCE_PROOF === "1") {
  // The creator-acceptance lane owns its whole journey: an empty workspace, the real New project wizard, authored edits
  // through the shipped editors, then the reviewed export handed as exact bytes to the portable playback oracle.
  try {
    await runCreatorAcceptanceLane({ root, harness, extension, port });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
const gameFiles = await findGameFiles(workspace);
if (gameFiles.length !== 1 || resolve(workspace, game) !== gameFiles[0]) {
  throw new Error(`The VS Code web proof workspace must contain exactly one .gam file, matching --game; found ${gameFiles.length}`);
}
await access(gameFiles[0]);
const assetWorkspace = await proofAssetDirectory(workspace, gameFiles[0]);
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
const designProof = process.env.TKR_VSCODE_DESIGN_PROOF === "1";
const designPhase = process.env.TKR_EDITOR_DESIGN_PHASE;
const designOutput = process.env.TKR_EDITOR_DESIGN_OUT;
const designCaseFilter = process.env.TKR_EDITOR_DESIGN_CASES;
const designThemeFilter = process.env.TKR_EDITOR_DESIGN_THEMES;
const designPaneFilter = process.env.TKR_EDITOR_DESIGN_PANES;
if (designProof && (designPhase !== "before" && designPhase !== "after")) throw new Error("TKR_EDITOR_DESIGN_PHASE must be before or after when TKR_VSCODE_DESIGN_PROOF=1");
if (designProof && (designOutput === undefined || !designOutput.startsWith("/") || resolve(designOutput) === root || resolve(designOutput).startsWith(`${root}/`))) {
  throw new Error("TKR_EDITOR_DESIGN_OUT must be an absolute destination outside the repository root");
}
await access(resolve(harness, "node_modules/.bin/vscode-test-web"));
const animationProof = process.env.TKR_VSCODE_ANIMATION_PROOF === "1";
const nativeClipProof = process.env.TKR_VSCODE_NATIVE_CLIP_PROOF === "1";
const nativeSceneProof = process.env.TKR_VSCODE_NATIVE_SCENE_PROOF === "1";
const boardPropertiesProof = process.env.TKR_VSCODE_BOARD_PROPERTIES_PROOF === "1";
const boardObjectsProof = process.env.TKR_VSCODE_BOARD_OBJECTS_PROOF === "1";
const connectedAuthoringProof = process.env.TKR_VSCODE_CONNECTED_AUTHORING_PROOF === "1";
const launchProof = process.env.TKR_VSCODE_LAUNCH_PROOF === "1";
const boardProof = process.env.TKR_VSCODE_BOARD_PROOF === "1";
const boardUpgradeProof = process.env.TKR_VSCODE_BOARD_UPGRADE_PROOF === "1";
const programProof = process.env.TKR_VSCODE_PROGRAM_PROOF === "1";
const guardProof = process.env.TKR_VSCODE_GUARD_PROOF === "1";
const newProjectProof = process.env.TKR_VSCODE_NEW_PROJECT_PROOF === "1";
const autosaveCommandProof = process.env.TKR_VSCODE_AUTOSAVE_COMMAND_PROOF === "1";
const historyProof = process.env.TKR_VSCODE_HISTORY_PROOF === "1";
const skipSpriteProof = process.env.TKR_VSCODE_SKIP_SPRITE_PROOF === "1";
const workbenchSaveShortcutProof = process.env.TKR_VSCODE_WORKBENCH_SAVE_PROOF === "1";
const creatorTestsProof = process.env.TKR_VSCODE_CREATOR_TESTS_PROOF === "1";
const visualEventsProof = process.env.TKR_VSCODE_VISUAL_EVENTS_PROOF === "1";
const scriptWorkflowProof = process.env.TKR_VSCODE_SCRIPT_WORKFLOW_PROOF === "1";
const fontProof = process.env.TKR_VSCODE_FONT_PROOF === "1";
const battleDataProof = process.env.TKR_VSCODE_BATTLE_DATA_PROOF === "1";
if (designProof && (nativeClipProof || nativeSceneProof || connectedAuthoringProof || animationProof || boardPropertiesProof || boardObjectsProof || boardUpgradeProof || launchProof || boardProof || programProof || guardProof || newProjectProof || autosaveCommandProof || historyProof || skipSpriteProof || workbenchSaveShortcutProof || creatorTestsProof || scriptWorkflowProof || fontProof || visualEventsProof || battleDataProof)) {
  throw new Error("TKR_VSCODE_DESIGN_PROOF cannot be combined with another VS Code proof mode");
}
if (boardUpgradeProof && (
  nativeClipProof || nativeSceneProof || designProof || boardPropertiesProof || boardObjectsProof || connectedAuthoringProof ||
  animationProof || launchProof || boardProof || programProof || guardProof || newProjectProof || autosaveCommandProof ||
  historyProof || skipSpriteProof || workbenchSaveShortcutProof || creatorTestsProof || visualEventsProof || scriptWorkflowProof ||
  fontProof || battleDataProof
)) {
  throw new Error("TKR_VSCODE_BOARD_UPGRADE_PROOF cannot be combined with another VS Code proof mode");
}
if (creatorTestsProof) await access(resolve(extension, "dist/creator-tests-webview.js"));
if (visualEventsProof) {
  await access(resolve(extension, "dist/visual-events.js"));
  await access(resolve(extension, "dist/visual-events-webview.js"));
}
if ((nativeClipProof || nativeSceneProof || designProof || boardPropertiesProof || boardObjectsProof || boardUpgradeProof || connectedAuthoringProof || animationProof || launchProof || boardProof || programProof || guardProof || newProjectProof || autosaveCommandProof || skipSpriteProof || workbenchSaveShortcutProof || creatorTestsProof || scriptWorkflowProof || fontProof || visualEventsProof || battleDataProof) && game !== "Main/example.gam") throw new Error("The focused VS Code web proof requires docs/spec/examples/game and --game Main/example.gam");
const fullProofChoices = game === "Main/example.gam" && workspace === resolve(root, "docs/spec/examples/game") ? ["cancel", "keep", "connected"] : ["cancel", "keep"];
for (const choice of nativeClipProof || nativeSceneProof || designProof || boardPropertiesProof || boardObjectsProof || boardUpgradeProof || connectedAuthoringProof || animationProof || historyProof || skipSpriteProof || autosaveCommandProof || workbenchSaveShortcutProof || creatorTestsProof || scriptWorkflowProof || fontProof || visualEventsProof || battleDataProof ? ["cancel"] : launchProof || boardProof || programProof || guardProof || newProjectProof ? ["cancel"] : fullProofChoices) {
  const connectedPass = connectedAuthoringProof || choice === "connected";
  const { workspace: proofWorkspace, profile: browserProfile } = await createProofDirectories(gameFiles[0], game, undefined, undefined, assetWorkspace);
  let boardUpgradeAssets = [];
  if (visualEventsProof) {
    const fixture = resolve(root, "docs/spec/examples/game/Game/Example");
    const project = resolve(proofWorkspace, "Game/Example");
    await cp(fixture, project, { recursive: true });
    await cp(resolve(root, "media/cursors/tkr-arrow.png"), resolve(project, "Bitmap/window.png"));
    const target = resolve(proofWorkspace, VISUAL_EVENTS_PROOF_PATH);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from("// native visual event proof\r\n// handwritten opaque line\r\n", "utf8"));
  }
  if (creatorTestsProof) for (const file of createCreatorTestFiles()) {
    const target = resolve(proofWorkspace, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  if (scriptWorkflowProof) for (const file of scriptWorkflowProofFiles()) {
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
  const nativeClipBytes = new Uint8Array(await readFile(resolve(root, "docs/spec/examples/native/animation-clip/valid/sword-swing.tkranm")));
  await writeFile(resolve(proofWorkspace, NATIVE_CLIP_PROOF_PATH), nativeClipBytes);
  const nativeSceneBytes = nativeSceneProof ? new TextEncoder().encode("contract: scene\nversion: 1.0.0-pre.2\nprojection: 2d\nsize: {width: 2, height: 2}\nfloors: [{id: ground, tiles: [[1, 1], [3, 0]]}]\ntilePalette: [{}, {legacy: village.tst1}]\nstart: {x: 16, y: 31, floor: ground}\n") : undefined;
  if (nativeSceneBytes !== undefined) {
    await mkdir(resolve(proofWorkspace, "Boards"), { recursive: true });
    await writeFile(resolve(proofWorkspace, NATIVE_SCENE_PROOF_PATH), nativeSceneBytes);
    // A supported older board (minor 3, pre-vector): the legacy editor cannot open it for editing, but Import as Scene can.
    await copyFile(resolve(root, "docs/spec/examples/versions/board/board_minor3.brd"), resolve(proofWorkspace, "Boards/older-board.brd"));
    await copyFile(resolve(root, "docs/spec/examples/game/Game/Example/Chrs/ada.tem"), resolve(proofWorkspace, "Chrs/ada.tem"));
    for (const { path, bytes } of geometryProofFiles()) {
      const target = resolve(proofWorkspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  if (boardUpgradeProof) {
    const legacyPath = resolve(root, "fixtures/legacy/Caoquest/Boards/red.brd");
    const legacyBytes = new Uint8Array(await readFile(legacyPath));
    const parsedLegacy = readPreVectorBoard(new BinaryReader(legacyBytes, legacyPath));
    if (!parsedLegacy.ok || parsedLegacy.value.major !== 2 || parsedLegacy.value.minor !== 2) {
      throw new Error("The pinned Caoquest red.brd fixture must be a readable minor-2.2 board.");
    }
    const legacyBoardPath = resolve(proofWorkspace, "Game/Example/Boards/red.brd");
    await mkdir(dirname(legacyBoardPath), { recursive: true });
    await writeFile(legacyBoardPath, legacyBytes);
    const tileset = new Uint8Array(6 + 218 * 1024);
    const tilesetHeader = new DataView(tileset.buffer);
    tilesetHeader.setUint16(0, 20, true);
    tilesetHeader.setUint16(2, 218, true);
    tilesetHeader.setUint16(4, 3, true);
    for (let tile = 0; tile < 218; tile += 1) {
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          tileset[6 + tile * 1024 + y * 32 + x] = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 42 : 213);
        }
      }
    }
    // Board tile 7 uses tileset entry 6 at the legacy (2, 2) start; village tile 1 uses entry 0 at pixel start (2, 2).
    const villageTileset = new Uint8Array(6 + 22 * 3072);
    const villageHeader = new DataView(villageTileset.buffer);
    villageHeader.setUint16(0, 20, true);
    villageHeader.setUint16(2, 22, true);
    villageHeader.setUint16(4, 1, true);
    for (let tile = 0; tile < 22; tile += 1) {
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) {
          const offset = 6 + tile * 3072 + (y * 32 + x) * 3;
          const shade = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 42 : 213;
          villageTileset[offset] = shade;
          villageTileset[offset + 1] = shade;
          villageTileset[offset + 2] = shade;
        }
      }
    }
    const programFiles = [...new Set(parsedLegacy.value.programs.map(({ file }) => file).filter((file) => file.length > 0))]
      .map((file) => ({ path: `Game/Example/Prg/${file}`, bytes: new Uint8Array() }));
    const itemBytes = new Uint8Array(await readFile(resolve(root, "docs/spec/examples/versions/item/item_minor7.itm")));
    const boardAssets = [
      { path: "Game/Example/Tiles/forest_set.tst", bytes: tileset },
      { path: "Game/Example/Tiles/village.tst", bytes: villageTileset },
      { path: "Game/Example/Bitmap/background.JPG", bytes: encodeScenePng({ w: 2, h: 2, rgba: new Uint8Array([42, 42, 42, 255, 42, 42, 42, 255, 42, 42, 42, 255, 42, 42, 42, 255]) }) },
      { path: "Game/Example/Music/Town.mid", bytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 4, 0, 0xff, 0x2f, 0]) },
      ...programFiles,
      ...["gem.itm", "red.itm"].map((file) => ({ path: `Game/Example/Item/${file}`, bytes: itemBytes })),
    ];
    boardUpgradeAssets = boardAssets;
  }
  const boardPath = "Boards/village.brd";
  const otherBoardPath = "Boards/other.brd";
  const artPath = "Tiles/art.tst";
  const otherArtPath = "Tiles/other.tst";
  // A 2 × 2 board naming tile 2 of art.tst in its first cell and leaving its last cell empty: the browser proof edits the
  // saved artwork, then paints the empty cell with the same brush and reads the composed pixel back.
  const artBoardPath = "Boards/art-source.brd";
  const artBoardBytes = (() => {
    const written = writeBoard({
      ...createEmptyBoard(), sizeX: 2, sizeY: 2, sizeL: 1, layerTitles: ["", ""],
      lut: ["", "art.tst2"], tileMatrix: [1, 0, 1, 1],
      tileRuns: [
        { lutIndex: 1, count: 1, marker: false },
        { lutIndex: 0, count: 1, marker: false },
        { lutIndex: 1, count: 2, marker: true },
      ],
    });
    if (!written.ok) throw new Error(`Could not create the art source board: ${written.error.message}`);
    return written.value;
  })();
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
    writeFile(resolve(proofWorkspace, artBoardPath), artBoardBytes),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, artPath)),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, otherArtPath)),
    copyFile(resolve(root, "docs/spec/examples/versions/tileset/tileset_detail1.tst"), resolve(proofWorkspace, "Tiles/village.tst")),
    writeFile(resolve(proofWorkspace, bitmapPath), createBitmapBytes(false)),
    writeFile(resolve(proofWorkspace, otherBitmapPath), createOtherBitmapBytes()),
  ]);
  if (connectedPass) {
    // The linked-provider regression is a wrong project root. Remove the loose-folder assets the
    // generic harness seeds, so only the real Game/Example ownership can satisfy this proof.
    await Promise.all(["Bitmap", "Bkrounds", "Boards", "Chrs", "Enemy", "Item", "Misc", "Prg", "SpcMove", "StatusE", "Tiles"]
      .map((folder) => rm(resolve(proofWorkspace, folder), { recursive: true, force: true })));
    await cp(resolve(workspace, "Game"), resolve(proofWorkspace, "Game"), { recursive: true });
    for (const file of connectedAuthoringProofFiles()) {
      const target = resolve(proofWorkspace, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes);
    }
  }
  let persistentFs;
  let browser;
  let trackedProcess;
  let failure;
  let cleanupErrors = [];
  const routeErrors = [];
  const browserDiagnostics = [];
  const probeDiagnostics = [];
  const historyPreviewTraceDiagnostics = [];
  const settlementTraceDiagnostics = [];
  let settlementWebviewInstrumentationCount = 0;
  try {
    if (designProof) {
      await copyFile(resolve(root, "docs/spec/examples/game/Main/example.gam"), resolve(proofWorkspace, game));
      const sourceFixture = resolve(root, "docs/spec/examples/game/Game/Example");
      await cp(sourceFixture, resolve(proofWorkspace, "Game/Example"), { recursive: true, force: true });
      const authoredGame = new Uint8Array(await readFile(resolve(root, "docs/spec/examples/game/Main/example.gam")));
      const providedGame = new Uint8Array(await readFile(resolve(proofWorkspace, game)));
      if (authoredGame.length !== providedGame.length || !authoredGame.every((byte, index) => byte === providedGame[index])) {
        throw new Error("Design proof requires the authored docs/spec/examples/game/Main/example.gam fixture");
      }
    }
    if (launchProof || boardProof || boardUpgradeProof || programProof || guardProof || historyProof) {
      await cp(resolve(workspace, "Game"), resolve(proofWorkspace, "Game"), { recursive: true });
      if (boardUpgradeProof) {
        for (const file of boardUpgradeAssets) {
          const target = resolve(proofWorkspace, file.path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, file.bytes);
        }
      }
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
        ...(designProof ? ["--commit=863bc0ba9e89df07ecf700ce40f2fa35b2a3b123"] : []),
        `--extensionDevelopmentPath=${extension}`, `--extensionPath=${resolve(harness, "probe-extension")}`,
        `--extensionPath=${resolve(root, "extensions/rpgcode")}`,
        `--port=${port}`, `--folder-uri=tkr-testfs://${persistentFs.authority}/`,
        `--testRunnerDataDir=${process.env.TKR_VSCODE_TEST_DATA_DIR ?? resolve(root, ".vscode-test-web")}`,
        // An explicit cached SDK build avoids an unrelated latest-build lookup during local/offline proofs.
        ...(process.env.TKR_VSCODE_TEST_COMMIT === undefined ? [] : [`--commit=${process.env.TKR_VSCODE_TEST_COMMIT}`]),
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
      const resolveEditorReplacement = boardUpgradeProof
        ? `resolveCustomEditor: async (document2, panel) => {
            globalThis.__tkrSettlementTrace = (side, details = {}) => (${trace})("settlement", JSON.stringify({ side, timestamp: performance.timeOrigin + performance.now(), ...details }));
            const logSettlement = (stage, details = {}) => {
              void globalThis.__tkrSettlementTrace("host", { stage, resource: document2.uri.path, viewType: panel.viewType, ...details }).catch((error) => console.error("[proof trace]", error));
            };
            void (${trace})("resolve", JSON.stringify({ resource: document2.uri.toString(), viewType: panel.viewType })).catch((error) => console.error("[proof trace]", error));`
        : `resolveCustomEditor: async (document2, panel) => { void (${trace})("resolve", JSON.stringify({ resource: document2.uri.toString(), viewType: panel.viewType })).catch((error) => console.error("[proof trace]", error));`;
      const probes = [
        [
          "openCustomDocument: (uri, openContext) => core.openCustomDocument(uri, openContext.backupId)",
          `openCustomDocument: (uri, openContext) => { void (${trace})("open", uri.path).then(() => (${trace})("open-uri", uri.toString())).catch((error) => console.error("[proof trace]", error)); return core.openCustomDocument(uri, openContext.backupId); }`,
        ],
        [
          "resolveCustomEditor: async (document2, panel) => {",
          resolveEditorReplacement,
        ],
        [
          "saveCustomDocument: (document2) => core.saveCustomDocument(document2)",
          `saveCustomDocument: (document2) => { void (${trace})("save", document2.uri.path).then(() => (${trace})("save-uri", document2.uri.toString())).catch((error) => console.error("[proof trace]", error)); return core.saveCustomDocument(document2); }`,
        ],
      ];
      if (boardUpgradeProof) {
        const settlementAdapter = /postMessage: \((\w+)\) => panel\.webview\.postMessage\(\1\),\n([ \t]*)onDidReceiveMessage: \(listener\) => panel\.webview\.onDidReceiveMessage\(listener\),\n\2onDidDispose: \(listener\) => panel\.onDidDispose\(listener\)(,?)/g;
        const adapterMatches = [...source.matchAll(settlementAdapter)];
        if (adapterMatches.length !== 1) throw new Error("Built VS Code settlement adapter no longer matches the proof instrumentation");
        const [, messageBinding, indent, trailingComma] = adapterMatches[0];
        source = source.replace(settlementAdapter, `postMessage: (${messageBinding}) => {
${indent}  if (${messageBinding}.type !== "settle") return panel.webview.postMessage(${messageBinding});
${indent}  logSettlement("send", { requestId: ${messageBinding}.requestId, reason: ${messageBinding}.reason, saveLock: ${messageBinding}.saveLock });
${indent}  const posted = panel.webview.postMessage(${messageBinding});
${indent}  void posted.then(
${indent}    (delivered) => { logSettlement("post-result", { requestId: ${messageBinding}.requestId, delivered }); },
${indent}    (error) => { logSettlement("post-reject", { requestId: ${messageBinding}.requestId, errorName: error?.name ?? typeof error }); },
${indent}  ).catch((error) => console.error("[proof trace]", error));
${indent}  return posted;
${indent}},
${indent}onDidReceiveMessage: (listener) => panel.webview.onDidReceiveMessage((message) => {
${indent}  if (message?.type === "settled") logSettlement("reply-received", { requestId: message.requestId, ok: message.ok !== false, kind: message.kind });
${indent}  listener(message);
${indent}}),
${indent}onDidDispose: (listener) => panel.onDidDispose(() => {
${indent}  logSettlement("panel-dispose", {});
${indent}  listener();
${indent}})${trailingComma}`);
      }
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
      if (boardUpgradeProof) {
        const coreTimeout = /const timer = startTimer\(\(\) => (\w+)\(false\)\);/g;
        const timeoutMatches = [...source.matchAll(coreTimeout)];
        if (timeoutMatches.length !== 1) throw new Error("Settlement timeout no longer matches the proof instrumentation");
        source = source.replace(coreTimeout, (_match, answer) => `const timer = startTimer(() => { if (typeof globalThis.__tkrSettlementTrace === "function") void globalThis.__tkrSettlementTrace("core", { stage: "timeout", requestId, path: this.model.identity.path }).catch(() => undefined); ${answer}(false); });`);
        const coreDetach = "this.#views.delete(target);";
        if (source.split(coreDetach).length !== 2) throw new Error("Settlement disposal no longer matches the proof instrumentation");
        source = source.replace(coreDetach, `if (typeof globalThis.__tkrSettlementTrace === "function") void globalThis.__tkrSettlementTrace("core", { stage: "view-detach", path: this.model.identity.path, waitingIds: [...target.waiting.keys()] }).catch(() => undefined); ${coreDetach}`);
        const coreReply = /for \(const view of this\.#views\) view\.waiting\.get\((\w+)\)\?\.\((\w+), (\w+), (\w+)\);/g;
        const replyMatches = [...source.matchAll(coreReply)];
        if (replyMatches.length !== 1) throw new Error("Settlement reply dispatch no longer matches the proof instrumentation");
        source = source.replace(coreReply, (_match, requestId, settled, message, kind) => `if (typeof globalThis.__tkrSettlementTrace === "function") void globalThis.__tkrSettlementTrace("core", { stage: "reply-dispatch", requestId: ${requestId}, settled: ${settled}, kind: ${kind}, waitingViews: [...this.#views].filter((view) => view.waiting.has(${requestId})).length }).catch(() => undefined); for (const view of this.#views) view.waiting.get(${requestId})?.(${settled}, ${message}, ${kind});`);
      }
      await route.fulfill({ response, body: source });
    });
    const webviewRoute = captureRouteErrors(async (route) => {
      const response = await route.fetch();
      let source = await response.text();
      const earlyAck = /if \((\w+)\.data\.type === "settle" && remoteDocument === (?:undefined|void 0)\) \{/g;
      const earlyAckMatches = [...source.matchAll(earlyAck)];
      if (earlyAckMatches.length === 0) {
        await route.fulfill({ response, body: source });
        return;
      }
      if (earlyAckMatches.length !== 1) throw new Error("Webview early settlement branch no longer matches the proof instrumentation");
      settlementWebviewInstrumentationCount += 1;
      const earlyEvent = earlyAckMatches[0][1];
      source = source.replace(earlyAck, (_match, eventBinding) => `if (${eventBinding}.data.type === "settle" && remoteDocument === void 0) {
    console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "early-ack", requestId: ${eventBinding}.data.requestId, reason: ${eventBinding}.data.reason }));`);
      const earlyReply = /api\.postMessage\(\{\s*type: "settled",\s*requestId: (\w+)\.data\.requestId\s*\}\);/g;
      const earlyReplyMatches = [...source.matchAll(earlyReply)];
      if (earlyReplyMatches.length !== 1 || earlyReplyMatches[0][1] !== earlyEvent) throw new Error("Webview early settlement reply no longer matches the proof instrumentation");
      source = source.replace(earlyReply, (_match, eventBinding) => `console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "early-reply-post", requestId: ${eventBinding}.data.requestId }));
    try {
      api.postMessage({ type: "settled", requestId: ${eventBinding}.data.requestId });
      console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "early-reply-return", requestId: ${eventBinding}.data.requestId }));
    } catch (error) {
      console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "early-reply-throw", requestId: ${eventBinding}.data.requestId, errorName: error?.name ?? typeof error }));
      throw error;
    }`);
      const documentReceive = 'if (message.type === "settle") {';
      if (source.split(documentReceive).length !== 2) throw new Error("Webview settlement receiver no longer matches the proof instrumentation");
      source = source.replace(documentReceive, `${documentReceive}
      console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "document-receive", requestId: message.requestId, reason: message.reason, saveLock: message.saveLock, busy: this.pendingEdits.busy(), holdsDraft: this.pendingEdits.holdsDraft() }));`);
      const pendingSettle = /void this\.pendingEdits\.settle\(message\.reason\)\.then\(\(outcome\) => this\.vscode\.postMessage\(\{([\s\S]*?)\n\s*\}\)\);/g;
      if ([...source.matchAll(pendingSettle)].length !== 1) throw new Error("Webview pending-edits settlement no longer matches the proof instrumentation");
      source = source.replace(pendingSettle, (_match, fields) => `void this.pendingEdits.settle(message.reason).then((outcome) => {
        console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "pending-outcome", requestId, outcome, busy: this.pendingEdits.busy(), holdsDraft: this.pendingEdits.holdsDraft() }));
        console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "reply-post", requestId }));
        try {
          this.vscode.postMessage({${fields}
          });
          console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "reply-post-return", requestId }));
        } catch (error) {
          console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "reply-post-throw", requestId, errorName: error?.name ?? typeof error }));
          throw error;
        }
      });`);
      const dispatch = /^([ \t]*)remoteDocument\?\.receive\((\w+)\.data\);/gm;
      const dispatchMatches = [...source.matchAll(dispatch)];
      if (dispatchMatches.length !== 1) throw new Error("Webview message dispatch no longer matches the proof instrumentation");
      source = source.replace(dispatch, (_match, indent, eventBinding) => `${indent}if (${eventBinding}.data.type === "settle") console.log("[tkr-vscode-settlement-trace]", JSON.stringify({ side: "webview", stage: "document-dispatch", requestId: ${eventBinding}.data.requestId, hasDocument: remoteDocument !== void 0 }));
${indent}remoteDocument?.receive(${eventBinding}.data);`);
      const webviewTracePattern = 'JSON.stringify({ side: "webview", stage:';
      const webviewTraceCount = source.split(webviewTracePattern).length - 1;
      if (webviewTraceCount !== 10) throw new Error(`Expected 10 settlement webview trace points, found ${webviewTraceCount}`);
      source = source.replaceAll(webviewTracePattern, 'JSON.stringify({ side: "webview", timestamp: performance.timeOrigin + performance.now(), stage:');
      await route.fulfill({ response, body: source });
    });
    const registerContextRoutes = async () => {
      await browser.route("**/static/extensions/0/extension.js", providerRoute);
      await browser.route("**/static/devextensions/dist/extension.browser.js", browserExtensionRoute);
      if (boardUpgradeProof) await browser.route("**/webview.js", webviewRoute);
    };
    await registerContextRoutes();
    const recordBrowserDiagnostic = (message) => { if (browserDiagnostics.length < 100) browserDiagnostics.push(message.replaceAll(persistentFs.token, "[redacted]")); };
    const styleCspViolations = [];
    const recordSettlementTrace = (message) => {
      const clean = message.replaceAll(persistentFs.token, "[redacted]");
      const marker = "[tkr-vscode-settlement-trace]";
      const payload = clean.slice(clean.indexOf(marker) + marker.length).trim();
      try {
        settlementTraceDiagnostics.push(JSON.parse(payload));
      } catch {
        settlementTraceDiagnostics.push({ side: "webview", raw: clean });
      }
      if (settlementTraceDiagnostics.length > 128) settlementTraceDiagnostics.shift();
    };
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
        if (text.includes("[tkr-vscode-settlement-trace]")) {
          recordSettlementTrace(`[console] ${text}`);
          return;
        }
        if (designProof && /(?:violates|violating).*Content Security Policy.*style-src/i.test(text)) styleCspViolations.push(text.replaceAll(persistentFs.token, "[redacted]"));
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
    const readBacking = async (path = game) => new Uint8Array(await persistentFs.observe(() => readFile(resolve(proofWorkspace, path))));
    const writeBacking = async (path, bytes) => {
      const target = resolve(proofWorkspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    };
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
    const proveBoardProperties = async () => {
      // Add this story's project-folder fixtures only when its proof begins: adding Game/Example
      // earlier would change the older root-folder scenarios' effective asset layout.
      for (const file of boardPropertiesProofFiles()) {
        await mkdir(dirname(resolve(proofWorkspace, file.path)), { recursive: true });
        await writeBacking(file.path, file.bytes);
      }
      await runVscodeBoardPropertiesProof(page, expect, workbenchUrl, readBacking);
      console.log("vscode.dev board properties, linked native programs, return and startup ownership proof passed");
    };
    const proveBoardObjects = async () => {
      for (const file of boardObjectsProofFiles()) {
        await mkdir(dirname(resolve(proofWorkspace, file.path)), { recursive: true });
        await writeBacking(file.path, file.bytes);
      }
      await runVscodeBoardObjectsProof(page, expect, workbenchUrl, readBacking);
      console.log("vscode.dev board objects, definition visits, native confirmation and saved-record proof passed");
    };
    const proveConnectedAuthoring = async () => {
      await runVscodeConnectedAuthoringProof(page, expect, workbenchUrl, readBacking);
      console.log("vscode.dev connected authoring, saved-source identity and immutable run-snapshot proof passed");
    };
    const proveNativeClip = async () => {
      await writeBacking("Misc/invalid-utf8.tkranm", Buffer.concat([nativeClipBytes, Buffer.from([10, 35, 32, 255, 10])]));
      await runVscodeNativeClipProof(page, expect, workbenchUrl, readBacking, nativeClipBytes);
      await rm(resolve(proofWorkspace, "Misc/invalid-utf8.tkranm"));
      console.log("vscode.dev native clip edit, one-line save and reopen proof passed");
    };
    if (nativeSceneBytes !== undefined) {
      await runVscodeNativeSceneProof(page, expect, workbenchUrl, readBacking, writeBacking, nativeSceneBytes);
      console.log("vscode.dev native scene preview, terrain edit, save, recovery and play proof passed");
      await runVscodeBoardImportProof(page, expect, readBacking, {
        listScenes: async () => {
          try {
            return (await readdir(resolve(proofWorkspace, "Boards"))).filter((name) => name.toLowerCase().endsWith(".tkrscn"));
          } catch (error) {
            if (error?.code === "ENOENT") return [];
            throw error;
          }
        },
        historyContains: async (bytes) => {
          const blob = resolve(proofWorkspace, ".tkr-history/blobs", createHash("sha256").update(bytes).digest("hex"));
          try {
            return (await persistentFs.observe(() => readFile(blob))).equals(Buffer.from(bytes));
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        },
      });
      console.log("vscode.dev board import review, cancel, one scene and authorized first-build history proof passed");
      await runVscodeNativeGeometryProof(page, expect, readBacking);
      console.log("vscode.dev shared native tile and pack geometry, move, copy, delete and board rebuild proof passed");
    } else if (visualEventsProof) {
      await runVscodeVisualEventsProof(page, expect, workbenchUrl, readBacking);
      console.log("VS Code native Visual events edit, one-URI undo/navigation, close/reopen reconstruction, clean diagnostics, CRLF save and player dismissal proof passed");
    } else if (nativeClipProof) {
      await proveNativeClip();
    } else if (designProof) {
      await page.goto(workbenchUrl, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".monaco-workbench")).toBeVisible();
      await runVscodeDesignProof(page, expect, {
        root,
        extension,
        workspace: proofWorkspace,
        game,
        phase: designPhase,
        output: designOutput,
        caseFilter: designCaseFilter,
        themeFilter: designThemeFilter,
        paneFilter: designPaneFilter,
      });
      if (styleCspViolations.length > 0) throw new Error(`Design proof violated style CSP:\n${styleCspViolations.join("\n")}`);
      console.log(`VS Code native editor design ${designPhase} evidence captured at ${designOutput}`);
    } else if (scriptWorkflowProof) {
      const groups = async (project = "") => {
        try { return (await readdir(resolve(proofWorkspace, project, ".tkr-history/groups"))).sort(); }
        catch (error) { if (error?.code === "ENOENT") return []; throw error; }
      };
      await runVscodeScriptWorkflowProof(page, expect, workbenchUrl, readBacking, writeBacking, groups);
      console.log("vscode.dev native reviewed script format, cancellation, opt-out, save, cleanup, migration and retired-folder proof passed");
    } else if (connectedPass) {
      await proveConnectedAuthoring();
    } else if (boardObjectsProof) {
      await proveBoardObjects();
    } else if (boardPropertiesProof) {
      await proveBoardProperties();
    } else if (creatorTestsProof) {
      const { runCreatorSpecs } = await import(pathToFileURL(resolve(root, "packages/script-spec/dist/browser.js")).href);
      await runVscodeCreatorTestsProof(page, expect, workbenchUrl, runCreatorSpecs, {
        readBacking, writeBacking, withBackingWriteRefused, readWriteEvents: persistentFs.writeEvents,
        pauseWrite: persistentFs.pauseWrite, resumeWrite: persistentFs.resumeWrite,
      });
      console.log("VS Code saved creator-test command, actual frame, source link, snapshot hashes and headless parity proof passed");
    } else if (animationProof) {
      await runVscodeAnimationProof(page, expect, workbenchUrl, { readBacking, withBackingWriteRefused });
      console.log("vscode.dev animation creation, partial-write retry and persistent recovery proof passed");
    } else if (battleDataProof) {
      await runVscodeBattleDataProof(page, expect, workbenchUrl, { readBacking, writeBacking });
      console.log("vscode.dev battle-background editor: all six links survive native Save All and reopen; TBM uses the custom editor, PNG/WAV use native Open, and audio audition is unavailable in this host");
    } else if (fontProof) {
      await runVscodeFontProof(page, expect, workbenchUrl, { readBacking });
      console.log("vscode.dev bitmap font creation, pointer and keyboard drawing, preview pixels, save and reopen proof passed");
    } else if (newProjectProof) {
      await proveNewProject();
    } else if (guardProof) {
      await runVscodeGuardProof(page, expect, workbenchUrl, game, readBacking,
        new Uint8Array(await readFile(gameFiles[0])), await createWebAdapterBytes(gameFiles[0], game, "Race saved"));
      console.log("vscode.dev save and concurrent-edit guard proof passed");
    } else if (boardUpgradeProof) {
      await runVscodeBoardUpgradeProof(page, expect, workbenchUrl, readBacking, persistentFs.readEvents);
      console.log("vscode.dev board coordinate conversion, workbench save, native undo, close/reopen and runner output proof passed");
    } else if (boardProof) {
      await runVscodeRunAndDebugProof(page, expect, workbenchUrl);
      console.log("vscode.dev Run and Debug board launch, restart, stop and tab-close proof passed");
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
        choice, boardPath, otherBoardPath, artPath, otherArtPath, artBoardPath, bitmapPath, otherBitmapPath,
        bitmapSaved: createBitmapBytes(true), bitmapPicture: (edited) => expectedBitmapPicture(createBitmapBytes(edited)),
        canvasBoards: canvasBoards.map(({ path, label, coordType }) => ({ path, label, coordType })),
      });
      console.log("vscode.dev autosave command palette proof passed");
    } else {
      if (choice === "cancel" && !skipSpriteProof) {
        await proveNativeClip();
      }
      if (choice === "cancel" && !skipSpriteProof) {
        await runVscodeAnimationProof(page, expect, workbenchUrl, { readBacking, withBackingWriteRefused });
        console.log("vscode.dev animation creation, partial-write retry and persistent recovery proof passed");
        await runVscodeSpriteWebProof(page, expect, workbenchUrl, spritePath, spriteBytes, { readBacking });
        console.log("vscode.dev sprite save/reopen proof passed");
      }
      await runVscodeWebProof(page, expect, workbenchUrl, game, title, expectedBytes, recoveredTitle, recoveredBytes, autosaveTitle, autosaveBytes, {
        restart, readBacking, writeBacking, withBackingWriteRefused, readHostEvents: persistentFs.events,
        pauseWrite: persistentFs.pauseWrite, resumeWrite: persistentFs.resumeWrite, writeEvents: persistentFs.writeEvents, externalBytes, sentinelTitle, sentinelBytes,
        choice, boardPath, otherBoardPath, artPath, otherArtPath, artBoardPath, bitmapPath, otherBitmapPath,
        bitmapSaved: createBitmapBytes(true), bitmapPicture: (edited) => expectedBitmapPicture(createBitmapBytes(edited)),
        canvasBoards: canvasBoards.map(({ path, label, coordType }) => ({ path, label, coordType })),
        ...(workbenchSaveShortcutProof ? { saveViaWorkbenchShortcut: process.platform === "darwin" ? "Meta+S" : "Control+S" } : {}),
      });
      console.log(`vscode.dev settings, board, art and bitmap proof passed (${choice})`);
      if (choice === "cancel") await proveNewProject();
      if (choice === "cancel") await proveBoardProperties();
      if (choice === "cancel") await proveBoardObjects();
    }
  } catch (error) {
    failure = error;
    if (designProof && browser !== undefined) {
      const failedPage = browser.pages().at(-1);
      if (failedPage !== undefined) {
        try {
          await mkdir(designOutput, { recursive: true });
          await failedPage.screenshot({ path: resolve(designOutput, "failure.png"), fullPage: true, timeout: 5_000 });
          const themeStatusHtml = await failedPage.locator(".statusbar-item").filter({ hasText: /^TKR design ·/ }).evaluateAll((items) => items.map((item) => item.outerHTML));
          await writeFile(resolve(designOutput, "failure-theme-status.json"), JSON.stringify({ failed: true, themeStatusHtml }, null, 2) + "\n");
        } catch (diagnosticError) { cleanupErrors.push(diagnosticError); }
      }
    }
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
  if (boardUpgradeProof) {
    const hostTrace = persistentFs === undefined
      ? []
      : persistentFs.events().filter(({ kind }) => kind === "settlement").map(({ value }) => {
        const clean = value.replaceAll(persistentFs.token, "[redacted]");
        try {
          return JSON.parse(clean);
        } catch {
          return { side: "host", raw: clean };
        }
      });
    const hostSent = hostTrace.some((event) => event.side === "host" && event.stage === "send");
    const webviewReceived = settlementTraceDiagnostics.some((event) => event.side === "webview" && (event.stage === "document-receive" || event.stage === "early-ack"));
    if (settlementWebviewInstrumentationCount === 0) cleanupErrors.push(new Error("Board-upgrade proof did not load the settlement-instrumented webview bundle"));
    if (!hostSent) cleanupErrors.push(new Error("Board-upgrade proof did not execute the host settlement-send probe"));
    if (!webviewReceived) cleanupErrors.push(new Error("Board-upgrade proof did not execute the webview settlement-receive probe"));
    const trace = [...hostTrace, ...settlementTraceDiagnostics].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
    const traceLines = [];
    for (let index = 0; index < trace.length;) {
      const timestamp = trace[index].timestamp ?? 0;
      let end = index + 1;
      while (end < trace.length && (trace[end].timestamp ?? 0) === timestamp) end += 1;
      const events = trace.slice(index, end);
      traceLines.push(events.length > 1
        ? `${index + 1}-${end} unordered tie timestamp=${timestamp}: ${JSON.stringify(events)}`
        : `${index + 1} ${JSON.stringify(events[0])}`);
      index = end;
    }
    console.error(`[vscode-web:settlement-trace]\n${traceLines.length > 0 ? traceLines.join("\n") : "(no settlement events)"}`);
    console.error(`[vscode-web:settlement-trace-coverage] host-send=${hostSent} webview-receive=${webviewReceived} rewritten-bundles=${settlementWebviewInstrumentationCount}`);
  }
  const proofFailure = combineProofErrors(failure, cleanupErrors);
  if (proofFailure !== undefined) {
    if (browserDiagnostics.length > 0) console.error(`[vscode-web:failure-diagnostics]\n${browserDiagnostics.join("\n")}`);
    if (historyPreviewTraceDiagnostics.length > 0) console.error(`[vscode-web:history-preview-trace]\n${historyPreviewTraceDiagnostics.join("\n")}`);
    if (probeDiagnostics.length > 0) console.error(`[vscode-web:probe-diagnostics]\n${probeDiagnostics.join("\n")}`);
    throw proofFailure;
  }
}

/**
 * One VS Code Web acceptance journey from an empty destination to a reviewed export, then the same bytes in an isolated
 * player. This lane never reads the editor's workspace from the player: it starts a separate Chromium context with
 * service workers blocked, and the playback oracle routes only the captured archive and descriptor.
 */
async function runCreatorAcceptanceLane({ root, harness, extension, port }) {
  const laneWorkspace = await mkdtemp(join(tmpdir(), "tkr-vscode-creator-acceptance-"));
  const profile = await mkdtemp(join(tmpdir(), "tkr-vscode-creator-acceptance-profile-"));
  const workbenchUrl = `http://localhost:${port}/`;
  const readinessUrl = `http://127.0.0.1:${port}/`;
  const diagnostics = [];
  let browser;
  let playerBrowser;
  let playerServer;
  let buildProcess;
  let workbench;
  let persistentFs;
  const cleanupErrors = [];
  const routeErrors = [];
  try {
    // The destination the wizard writes into must start empty, and the window must not auto-save authored documents.
    await mkdir(laneWorkspace, { recursive: true });
    await mkdir(join(laneWorkspace, ".vscode"), { recursive: true });
    await writeFile(join(laneWorkspace, ".vscode", "settings.json"), `${JSON.stringify({ "files.autoSave": "off" }, null, 2)}\n`);
    await mkdir(join(laneWorkspace, CREATOR_PROJECT), { recursive: true });

    persistentFs = await startPersistentFs(laneWorkspace, `http://localhost:${port}`);
    workbench = trackProcess(spawn(resolve(harness, "node_modules/.bin/vscode-test-web"), [
      "--host=localhost", "--browser=none",
      `--extensionDevelopmentPath=${extension}`,
      `--extensionPath=${resolve(harness, "probe-extension")}`,
      `--extensionPath=${resolve(root, "extensions/rpgcode")}`,
      `--port=${port}`, `--folder-uri=tkr-testfs://${persistentFs.authority}/`,
      `--testRunnerDataDir=${process.env.TKR_VSCODE_TEST_DATA_DIR ?? resolve(root, ".vscode-test-web")}`,
      ...(process.env.TKR_VSCODE_TEST_COMMIT === undefined ? [] : [`--commit=${process.env.TKR_VSCODE_TEST_COMMIT}`]),
    ], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" ") },
    }));
    await Promise.race([waitForHttpServer(workbench.child, readinessUrl), workbench.error]);

    browser = await chromium.launchPersistentContext(profile, { headless: true });
    // The proof filesystem authenticates every request with this run's token, which the probe extension embeds as a
    // placeholder; serve its source with the token in place or every workspace read fails with invalid credentials.
    await browser.route("**/static/extensions/0/extension.js", async (route) => {
      try {
        const response = await route.fetch();
        const source = await response.text();
        if (source.split("__TKR_PROOF_SECRET__").length !== 2) throw new Error("Proof provider no longer matches the credential injection");
        await route.fulfill({ response, body: source.replace("__TKR_PROOF_SECRET__", persistentFs.token) });
      } catch (error) {
        routeErrors.push(error);
        try { await route.continue(); } catch (continuationError) { routeErrors.push(continuationError); }
      }
    });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && diagnostics.length < 100) diagnostics.push(message.text().replaceAll(persistentFs.token, "[redacted]"));
    });
    page.on("pageerror", (error) => { if (diagnostics.length < 100) diagnostics.push(`[pageerror] ${error.stack ?? error.message}`); });
    page.on("requestfailed", (request) => { if (diagnostics.length < 100) diagnostics.push(`[requestfailed] ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`); });

    const artifact = await runVscodeCreatorAcceptanceProof(page, expect, workbenchUrl, {
      readBacking: async (path) => new Uint8Array(await persistentFs.observe(() => readFile(join(laneWorkspace, path)))),
      writeBacking: async (path, bytes) => {
        const target = join(laneWorkspace, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
      },
      backingExists: async (path) => {
        try { await stat(join(laneWorkspace, path)); return true; }
        catch (error) { if (error?.code === "ENOENT") return false; throw error; }
      },
    });
    console.log("vscode.dev fresh project authoring, reopen and reviewed export proof passed");

    // The player lane needs the browser bundles the web runner loads; the desktop build does not produce them.
    buildProcess = trackProcess(spawn(process.execPath, [resolve(root, "tools/browser/build.mjs")], { cwd: root, stdio: "inherit" }));
    const buildCode = await buildProcess.closed;
    if (buildCode !== 0 || buildProcess.errors.length > 0) throw new Error(`The web runner bundle build failed with ${buildCode}`);
    buildProcess = undefined;

    const playerPort = await freePort();
    playerServer = trackProcess(spawn(process.execPath, [resolve(root, "tools/browser/serve.mjs"), "--port", String(playerPort)], { cwd: root, stdio: "inherit" }));
    await Promise.race([waitForHttpServer(playerServer.child, `http://127.0.0.1:${playerPort}/health`), playerServer.error]);
    const playerUrl = `http://127.0.0.1:${playerPort}/packages/runner-web/app/index.html`;

    const { provePackagePlayback } = await import("./package-playback.ts").catch((error) => {
      throw new Error(`The portable playback oracle (tools/editor-vscode-test/package-playback.ts) is missing: ${error.message}`);
    });
    playerBrowser = await chromium.launch({ headless: true });
    const playerContext = await playerBrowser.newContext({ serviceWorkers: "block" });
    const playerPage = await playerContext.newPage();
    await provePackagePlayback(playerPage, expect, {
      archiveName: artifact.archiveName,
      archive: artifact.archive,
      descriptor: artifact.descriptor,
    }, {
      board: "boards/start.brd",
      // The engine boots initBoard at the board's authored start (column 2, row 2, layer 1 -> x 48, y 63); the startup
      // program ends without a wait, so no dismissal key is needed.
      start: { x: 48, y: 63 },
      // South walking uses the walk animation authored on the character; the authored board has no solid regions.
      movement: { key: "ArrowDown", axis: "y", direction: 1 },
      playerUrl,
    });
    console.log(`vscode.dev exported package booted and responded to authored input in an isolated runner (${artifact.archiveName})`);
  } finally {
    if (diagnostics.length > 0) console.error(`[vscode-creator-acceptance-diagnostics]\n${diagnostics.join("\n")}`);
    if (playerBrowser !== undefined) { try { await playerBrowser.close(); } catch (error) { cleanupErrors.push(error); } }
    if (playerServer !== undefined) {
      try { playerServer.child.kill("SIGTERM"); await playerServer.closed; } catch (error) { cleanupErrors.push(error); }
      cleanupErrors.push(...playerServer.errors);
    }
    if (buildProcess !== undefined) {
      try { buildProcess.child.kill("SIGTERM"); await buildProcess.closed; } catch (error) { cleanupErrors.push(error); }
    }
    cleanupErrors.push(...await cleanupTestRun(browser, workbench, laneWorkspace));
    cleanupErrors.push(...routeErrors);
    if (persistentFs !== undefined) { try { await persistentFs.close(); } catch (error) { cleanupErrors.push(error); } }
    try { await rm(profile, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "The creator acceptance lane could not clean up");
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

/** These authoring/package scenarios use the loose-folder form, not the surrounding legacy Toolkit tree. */
async function proofAssetDirectory(directory, mainFile) {
  const parsed = readMainFile(new BinaryReader(new Uint8Array(await readFile(mainFile)), mainFile));
  if (!parsed.ok) throw parsed.error;
  const path = projectFolder("", parsed.value);
  if (path.split("/").includes("..")) throw new Error("The proof game's project folder must stay inside its workspace");
  const candidate = resolve(directory, path);
  try {
    return (await stat(candidate)).isDirectory() ? candidate : directory;
  } catch (error) {
    if (error?.code === "ENOENT") return directory;
    throw error;
  }
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




