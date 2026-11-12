import { expect, test, _electron as electron, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      boardKey(): string | null;
      engine: { drawList(alpha: number, include: { shading: boolean; images: boolean; sprites: boolean }): { commands: readonly DrawCommand[] } | null };
    };
  }
}

/** Write a two-tile board with one closed vector and a main file carrying the given Graphics settings. */
function buildGame(directory: string, main: Partial<MainFile>): void {
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
    properties: { ...empty.properties, backgroundColour: { r: 0, g: 0, b: 0 }, ambient: { r: 0, g: 0, b: 0 }, start: { x: 16, y: 16, layer: 1 } },
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
  for (const [path, bytes] of files) {
    const full = join(directory, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
}

/** The same files the browser will fetch, as a package the lane's server can hand out. */
function packageFor(name: string, main: Partial<MainFile>): { readonly path: string; readonly bytes: Uint8Array } {
  const directory = mkdtempSync(join(tmpdir(), `tkr-overlays-${name}-`));
  try {
    buildGame(directory, main);
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

test("the project's overlays draw in the visible player exactly as they do headless, and the title carries the count", async ({ page }) => {
  test.setTimeout(120_000);
  const pkg = packageFor("overlay-project", { drawVectorsFlags: 1, pathColor: { r: 10, g: 20, b: 30 }, showFpsInTitle: 1 });
  const expected = headlessOverlays(pkg.bytes);
  expect(expected.length, "the headless run must draw the closed vector").toBe(4);

  await page.goto(`/packages/runner-web/app/index.html?package=${pkg.path}`);
  await page.waitForFunction(() => window.__live?.board != null, undefined, { timeout: 90_000 });
  expect(await overlayCommandsInBrowser(page)).toEqual(expected);

  // The title is refreshed once a second from presented frames: "Debug Overlays  N vectors, F FPS".
  await expect.poll(() => page.title(), { timeout: 10_000 }).toMatch(/^Debug Overlays \d+ vectors, \d+ FPS$/);
  expect(await page.title()).toContain("1 vectors");
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
  const pkg = packageFor("overlay-flag", { drawVectorsFlags: 0, showFpsInTitle: 0 });
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
      "--debug-vectors",
      "--diagnostics",
    ],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0", ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}) },
  });
  try {
    const playerWindow = await player.firstWindow();
    await playerWindow.waitForFunction(() => {
      const session = window.__session;
      return session !== undefined && session.boardKey() !== null;
    }, undefined, { timeout: 90_000 });
    const drawn = await playerWindow.evaluate(() => {
      const session = window.__session;
      const list = session?.engine.drawList(0, { shading: false, images: false, sprites: false });
      return list === null || list === undefined ? 0 : list.commands.filter((command) => command.kind === "line").length;
    });
    expect(drawn, "the per-run flag turns the board-vector overlay on").toBe(4);
    // The diagnostics strip is a runner feature and appears only when asked for.
    await expect(playerWindow.locator("#diagnostics")).toBeVisible();
    expect(await playerWindow.textContent("#diagnostics")).toMatch(/tick \d+/);
  } finally {
    await player.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  expect(readFileSync(join(root, pkg.path)).equals(before), "the run must not rewrite the package").toBe(true);
});
