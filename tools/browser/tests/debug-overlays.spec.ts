import { expect, test, errors, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  assetKey,
  createAssetIndex,
  createEmptyBoard,
  createEmptyCharacter,
  createEmptyMainFile,
  createEngine,
  PACKAGE_ROOT,
  writeBoard,
  writeCharacter,
  writeMainFile,
  writeTileset,
  type AssetKey,
  type DrawCommand,
  type InputRecord,
  type MainFile,
} from "@tk-reawakened/core";
import { distributionPackage } from "@tk-reawakened/runner-web";
import { writePackage } from "../../make-package/run.mjs";
import { electronBinary } from "../../desktop/electron-binary.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

/**
 * #1863 / entry 9.32: a project's `drawVectors` and `bFpsInTitleBar` mean what the Graphics tab says. The visible player
 * and a headless engine over the same package must emit the same overlay commands, the title must carry the board's
 * vector count and the measured frame rate, and a per-run desktop flag must add one overlay without touching the
 * package or the project's own file.
 */

type OverlayCommand = Extract<DrawCommand, { kind: "line" }>;

declare global {
  interface Window {
    __live?: { readonly board: string | null };
    __session?: {
      readonly gameId: string;
      boardKey(): string | null;
      engine: { drawList(alpha: number, include: { shading: boolean; images: boolean; sprites: boolean }): { commands: readonly DrawCommand[] } | null };
    };
  }
}

/** Write a two-tile board with one closed vector and a main file carrying the given Graphics settings. */
function buildGame(directory: string, main: Partial<MainFile>, withSave: boolean): void {
  const written = writeMainFile({
    ...createEmptyMainFile(),
    major: 2,
    minor: 9,
    gameTitle: "Debug Overlays",
    startupPrg: "",
    initBoard: "start.brd",
    initChar: "hero.tem",
    ...main,
  });
  if (!written.ok) throw new Error(written.error.message);
  const empty = createEmptyBoard();
  const board = writeBoard({
    ...empty,
    sizeX: 2,
    sizeY: 2,
    sizeL: 1,
    tileMatrix: [0, 0, 0, 0],
    tileRuns: [{ lutIndex: 0, count: 4, marker: true }],
    layerTitles: ["", ""],
    lut: ["tile.tst1"],
    properties: { ...empty.properties, backgroundColour: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, start: { x: 16, y: 16, layer: 1 }, enterPrg: withSave ? "save.prg" : "" },
    vectors: [{ points: [{ x: 8, y: 8 }, { x: 40, y: 8 }, { x: 40, y: 40 }, { x: 8, y: 40 }], attributes: 0, closed: 1, layer: 1, type: 1, handle: "" }],
  });
  if (!board.ok) throw new Error(board.error.message);
  const character = writeCharacter({ ...createEmptyCharacter(), minor: 5, name: "Hero", movementAnimations: Array(8).fill(""), battleStances: ["", "", "", "", "", ""] });
  if (!character.ok) throw new Error(character.error.message);
  const tileset = writeTileset({ version: 20, detail: { code: 1, size: 32, bytesPerPixel: 3, isometric: false }, tiles: [{ pixels: new Uint8Array(32 * 32 * 3).fill(255) }], residue: new Uint8Array() });
  if (!tileset.ok) throw new Error(tileset.error.message);
  const files: [string, Uint8Array][] = [
    ["Main/debug.gam", written.value],
    ["Boards/start.brd", new Uint8Array(board.value)],
    ["Chrs/hero.tem", new Uint8Array(character.value)],
    ["Tiles/tile.tst", tileset.value],
  ];
  if (withSave) files.push(["Prg/save.prg", new TextEncoder().encode('save("overlay-proof")\nend()\n')]);
  for (const [path, bytes] of files) {
    const full = join(directory, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
}

/** The same files the browser will fetch, as a package the lane's server can hand out. */
function packageFor(name: string, main: Partial<MainFile>, withSave = false): { readonly path: string; readonly bytes: Uint8Array } {
  const directory = mkdtempSync(join(tmpdir(), `tkr-overlays-${name}-`));
  try {
    buildGame(directory, main, withSave);
    const out = join(root, "fixtures", "packages", `${name}.tpk`);
    mkdirSync(dirname(out), { recursive: true });
    writePackage(directory, { out, title: name });
    const bytes = new Uint8Array(readFileSync(out));
    return { path: `fixtures/packages/${name}.tpk`, bytes };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The overlay commands a headless engine emits for the same package files. */
function headlessOverlays(bytes: Uint8Array): readonly OverlayCommand[] {
  const loaded = distributionPackage("debug.tpk", bytes);
  const files = new Map<AssetKey, Uint8Array>([...loaded.files].map(([path, fileBytes]) => [assetKey(path), fileBytes] as const));
  // The same window and camera the live page uses, or the overlay coordinates would differ by the camera offset alone.
  let latest: Parameters<NonNullable<Parameters<typeof createEngine>[0]["cameraTarget"]>["getPlayerPosition"]> extends never ? never : { sprites: { players: readonly { id: string; controlled: boolean; x: number; y: number }[]; selectedPlayer: string | null } } | null = null;
  const engine = createEngine({
    seed: 0,
    assetIndex: createAssetIndex([...loaded.files.keys()]),
    assetRoot: PACKAGE_ROOT,
    mainFile: loaded.main,
    gameIdentity: "debug-overlays-headless",
    width: 640,
    height: 480,
    maxTicks: 400,
    startup: { presence: { hasPlayer: () => true }, savedGame: { load: () => ({ kind: "missing" }), restored: () => false } },
    cameraTarget: {
      getPlayerPosition: () => {
        const actor = latest?.sprites.players.find((player) => player.id === latest?.sprites.selectedPlayer) ?? latest?.sprites.players.find((player) => player.controlled);
        return actor === undefined ? null : { x: actor.x, y: actor.y };
      },
      getEntityPosition: () => null,
    },
    phaseRegistrations: [{ phase: "audio", run: (state) => { latest = state as typeof latest; } }],
  });
  const step = (replies: InputRecord[] = []): void => {
    const report = engine.advance(1, replies);
    const answers: InputRecord[] = [];
    for (const request of report.requests) {
      if ("key" in request && typeof (request as { key?: unknown }).key === "string") {
        const key = (request as { key: string }).key;
        answers.push({ tick: report.tickAfter, event: { kind: "asset", reqId: (request as { reqId: number }).reqId, bytes: files.get(assetKey(key)) ?? null } });
      }
    }
    if (answers.length > 0) step(answers);
  };
  for (let tick = 0; tick < 80; tick += 1) step();
  const list = engine.drawList(0, { shading: false, images: false, sprites: false });
  return list === null ? [] : list.commands.filter((command): command is OverlayCommand => command.kind === "line");
}

async function overlayCommandsInBrowser(page: Page): Promise<readonly OverlayCommand[]> {
  return page.evaluate(() => {
    const session = window.__session;
    const list = session?.engine.drawList(0, { shading: false, images: false, sprites: false });
    return list === null || list === undefined ? [] : list.commands.filter((command): command is OverlayCommand => command.kind === "line");
  });
}

/** Preserve actual Electron boot evidence; a renderer error is not a ninety-second readiness mystery (#2088). */
async function desktopBoard(player: ElectronApplication): Promise<Page> {
  const events: string[] = [];
  const record = (kind: string, value: unknown): void => {
    events.push(`${kind}: ${String(value).slice(0, 2_000)}`);
    if (events.length > 64) events.shift();
  };
  const child = player.process();
  child.stdout?.on("data", (value: unknown) => record("stdout", value));
  child.stderr?.on("data", (value: unknown) => record("stderr", value));
  const observed = new Set<Page>();
  const observe = (page: Page): void => {
    if (observed.has(page)) return;
    observed.add(page);
    page.on("console", (message) => record(`console/${message.type()}`, message.text()));
    page.on("pageerror", (error) => record("pageerror", error));
    page.on("requestfailed", (request) => record("requestfailed", `${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) record("response", `${response.status()} ${response.url()}`); });
  };
  player.on("window", observe);
  for (const page of player.windows()) observe(page);
  let page: Page | undefined;
  const deadline = Date.now() + 90_000;
  let pause = 100;
  try {
    for (;;) {
      const slice = Math.min(2_000, Math.max(1, deadline - Date.now()));
      try {
        page ??= await player.firstWindow({ timeout: slice });
        await page.waitForFunction(() => {
          const live = window.__live;
          if (live !== undefined && "error" in live && typeof live.error === "string") throw new Error(`Desktop player failed: ${live.error}`);
          return window.__session !== undefined && window.__session.boardKey() !== null;
        }, undefined, { timeout: slice, polling: 100 });
        return page;
      } catch (error) {
        if (!(error instanceof errors.TimeoutError) || Date.now() >= deadline) throw error;
        await delay(Math.min(pause, deadline - Date.now()));
        pause = Math.min(pause * 2, 1_000);
      }
    }
  } catch (error) {
    let alarm: ReturnType<typeof setTimeout> | undefined;
    let state: unknown = { unavailable: "No Electron window was obtained." };
    try {
      if (page !== undefined) state = await Promise.race([
        page.evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          status: document.querySelector("#live-status")?.textContent ?? null,
          live: window.__live ?? null,
          session: window.__session === undefined ? null : { gameId: window.__session.gameId, board: window.__session.boardKey() },
          geometry: ["viewport", "screen"].map((id) => {
            const box = document.getElementById(id)?.getBoundingClientRect();
            return { id, width: box?.width ?? null, height: box?.height ?? null };
          }),
        })),
        new Promise<never>((_resolve, reject) => { alarm = setTimeout(() => reject(new Error("Electron state inspection timed out")), 1_000); }),
      ]);
    } catch (inspectionError) {
      state = { unavailable: String(inspectionError) };
    } finally {
      clearTimeout(alarm);
    }
    try {
      const statePath = test.info().outputPath("desktop-boot-state.json");
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify({ error: String(error), windows: player.windows().map((window) => window.url()), exitCode: child.exitCode, state, events }, null, 2));
      console.error("Electron boot evidence:", statePath);
    } catch (attachmentError) {
      console.error("Could not preserve Electron boot state:", attachmentError);
    }
    if (page !== undefined && !page.isClosed()) {
      try {
        await page.screenshot({ path: test.info().outputPath("desktop-boot-window.png"), timeout: 2_000 });
      } catch (screenshotError) {
        console.error("Could not capture Electron boot window:", screenshotError);
      }
    }
    throw error;
  }
}

test("the project's overlays draw in the visible player exactly as they do headless, and the title carries the count", async ({ page }) => {
  test.setTimeout(120_000);
  const pkg = packageFor("overlay-project", { drawVectorsFlags: 1, pathColor: { r: 10, g: 20, b: 30 }, showFpsInTitle: 1 });
  const expected = headlessOverlays(pkg.bytes);
  expect(expected.length, "the headless run must draw the closed vector").toBe(4);

  await page.goto(`/packages/runner-web/app/index.html?package=${pkg.path}`);
  await page.waitForFunction(() => window.__live?.board != null, undefined, { timeout: 90_000 });
  expect(await overlayCommandsInBrowser(page)).toEqual(expected);

  // Wait for a title refresh after the live board is ready; do not accept an initial count.
  await expect.poll(() => page.title(), { timeout: 10_000 }).toMatch(/^Debug Overlays 1 vectors, \d+ FPS$/);
});

test("a project without drawVectors draws no overlays and keeps its plain title", async ({ page }) => {
  test.setTimeout(120_000);
  const pkg = packageFor("overlay-plain", { drawVectorsFlags: 0, showFpsInTitle: 0 });
  await page.goto(`/packages/runner-web/app/index.html?package=${pkg.path}`);
  await page.waitForFunction(() => window.__live?.board != null, undefined, { timeout: 90_000 });
  expect(await overlayCommandsInBrowser(page)).toEqual([]);
  expect(await page.title()).not.toContain("vectors");
});

test("a per-run desktop flag adds one overlay without touching the package", async () => {
  test.setTimeout(120_000);
  const pkg = packageFor("overlay-flag", { drawVectorsFlags: 0, showFpsInTitle: 0 }, true);
  const before = readFileSync(join(root, pkg.path));
  const dataDir = mkdtempSync(join(tmpdir(), "tkr-overlays-desktop-"));
  const player = await electron.launch({
    executablePath: electronBinary(),
    args: [
      join(root, "packages/runner-desktop/dist"),
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      "--game", join(root, pkg.path),
      "--user-data-dir", dataDir,
      "--page", "packages/runner-desktop/app/player.html",
      "--",
      "--debug", "board",
      "--debug-colour", "#0a14ff",
      "--fps",
      "--diagnostics",
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}) },
  }).catch((error: unknown) => {
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  });
  try {
    const playerWindow = await desktopBoard(player);
    const drawn = await overlayCommandsInBrowser(playerWindow);
    expect(drawn, "the per-run flag turns the board-vector overlay on").toHaveLength(4);
    expect(drawn.every((line) => line.rgb.r === 10 && line.rgb.g === 20 && line.rgb.b === 255)).toBe(true);
    await expect.poll(() => playerWindow.title(), { timeout: 10_000 }).toMatch(/^Debug Overlays 1 vectors, \d+ FPS$/);
    await expect.poll(() => playerWindow.evaluate(async () => {
      const session = window.__session;
      const host = (window as unknown as { desktop: { listBlobs(area: "saves", gameId: string): Promise<string[]> } }).desktop;
      return session === undefined ? [] : host.listBlobs("saves", session.gameId);
    }), { timeout: 30_000, message: "the board entry program completes its game save" }).not.toEqual([]);
    // The diagnostics strip is a runner feature and appears only when asked for.
    await expect(playerWindow.locator("#diagnostics")).toBeVisible();
    expect(await playerWindow.textContent("#diagnostics")).toMatch(/tick \d+/);
  } finally {
    await player.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  expect(readFileSync(join(root, pkg.path)).equals(before), "the run must not rewrite the package").toBe(true);
});

// This exercises the real Electron launch boundary; a parser unit test cannot prove the strip stays hidden.
test("a desktop overlay does not enable the diagnostics strip", async () => {
  test.setTimeout(120_000);
  const pkg = packageFor("overlay-no-diagnostics", { drawVectorsFlags: 0, showFpsInTitle: 0 });
  const dataDir = mkdtempSync(join(tmpdir(), "tkr-overlays-desktop-"));
  const player = await electron.launch({
    executablePath: electronBinary(),
    args: [
      join(root, "packages/runner-desktop/dist"),
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      "--game", join(root, pkg.path),
      "--user-data-dir", dataDir,
      "--page", "packages/runner-desktop/app/player.html",
      "--", "--debug", "board",
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}) },
  }).catch((error: unknown) => {
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  });
  try {
    const playerWindow = await desktopBoard(player);
    expect(await overlayCommandsInBrowser(playerWindow)).toHaveLength(4);
    await expect(playerWindow.locator("#diagnostics")).toBeHidden();
  } finally {
    await player.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
