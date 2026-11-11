/**
 * `runner-desktop` — the **player's** Electron main process (entry 9.11; ADR 0013 decisions 1 to 3).
 *
 * It is a shell around the `runner-web` build, plus the player's launch resolution and library (entry 9.10): which game
 * to open is decided by `docs/spec/engine/runners.md#install`'s fixed order, and the registry that order's last step
 * reads is `library.json` in the application-data directory (`docs/spec/engine/launcher.md#storage-and-registry`). No
 * window chrome and no editor code or editor chrome at all (that is `host-desktop`).
 *
 * Two rules shape this file:
 *
 * 1. **Pages come over `app://`, never `loadFile`.** The scheme is registered **before `app.ready`** as `standard`,
 *    `secure`, `supportFetchAPI` and `corsEnabled`, so an `AudioWorklet` module loads and `fetch` works, which `file://`
 *    refuses (ADR 0013). **No service worker** is registered and `allowServiceWorkers` is never claimed: the PWA is the
 *    only artefact with one.
 * 2. **The host services live here, behind a narrow preload bridge.** A package is read as bytes from disk (a path or a
 *    drag-and-drop) and handed to the page's `packageFiles`; a save blob goes to AD-17's keys under the `GameId` the
 *    descriptor carries. The page keeps one asset source and one input path, exactly as in the browser.
 *
 * `guardrail-exception: G6 ADR-0013` — the Electron binary embeds a Chromium inventory with two licences our gate blocks;
 * the exception and its inventory check are recorded once for both applications in ADR 0013.
 */

import { app, BrowserWindow, ipcMain, protocol } from "electron";

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { LaunchInfo } from "@tk-reawakened/runner-web";

import { libraryRows, readLibraryFile, verifyEntry } from "./library.ts";
import { argumentValue, deepLinkFromArgv, deepLinkPath, resolveLaunchTarget, type LaunchResolution } from "./launch.ts";
import { quitPlayer, quitWhenLastWindowCloses } from "./lifecycle.ts";

/** The privileged scheme. Registered at module load, which is before `app.ready` by construction. */
export const APP_SCHEME = "app";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".sf2": "application/octet-stream",
  ".tpk": "application/octet-stream",
  ".wav": "audio/wav",
  ".mid": "audio/midi",
  ".ttf": "font/ttf",
  ".fnt": "application/octet-stream",
};

/** The directory pages and data are served from: `--serve <dir>`, defaulting to the app's own resources. */
function serveRoot(): string {
  const at = process.argv.indexOf("--serve");
  return resolve(at >= 0 ? process.argv[at + 1] ?? "." : join(app.getAppPath(), "resources"));
}

// A harness points the app at its own data directory before anything reads it; the cold-start cases each need their own
// (entry 9.10). `app.setPath` must run before `app.ready`, which is why it sits at module load.
const userDataDirectory = argumentValue(process.argv, "--user-data-dir");
if (userDataDirectory !== null) app.setPath("userData", resolve(userDataDirectory));

/**
 * The application's resources directory, where an export bakes `game.tpk`. Packaged, that is Electron's own
 * `resources`; unpackaged, `--resources <dir>` stands in so the read slot can be proved without an installer.
 */
function resourcesRoot(): string {
  const named = argumentValue(process.argv, "--resources");
  if (named !== null) return resolve(named);
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
}

/** The installed `library.json`, in the application-data directory beside the saves. */
function libraryPath(): string {
  return join(app.getPath("userData"), "library.json");
}

/** The link the OS delivered, which joins `process.argv` when the first step is resolved. */
let pendingDeepLink: string | null = null;

/** The player's window, kept so a deep link delivered later can reload it onto the named game. */
let playerWindow: BrowserWindow | null = null;

/** Resolve which game this launch opens, in the ruled order (`docs/spec/engine/runners.md#install`). */
function resolution(): LaunchResolution {
  return resolveLaunchTarget({
    argv: pendingDeepLink === null ? process.argv : [...process.argv, pendingDeepLink],
    executableDir: dirname(process.execPath),
    dataDir: app.getPath("userData"),
    resourcesDir: resourcesRoot(),
    isFile: (path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
    library: () => {
      const registry = readLibraryFile(libraryPath());
      return registry === null ? null : libraryRows(registry);
    },
    onWarning: (message) => console.error(`launch: ${message}`),
  });
}

/** What the page receives when a game is open: its bytes, its name, and the descriptor beside it when there is one. */
type OpenedGame = {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly descriptor: unknown;
  readonly path: string;
};

function readGame(path: string): OpenedGame {
  const bytes = new Uint8Array(readFileSync(path));
  let descriptor: unknown = null;
  try {
    descriptor = JSON.parse(readFileSync(`${path}.json`, "utf8")) as unknown;
  } catch {
    // A missing or unreadable sidecar is the page's to report; the bytes are still a package.
  }
  return { name: path.split(sep).at(-1) ?? "game.tpk", bytes, descriptor, path };
}

/** A library entry is opened only after its `sha256` and `size` match the bytes (`launcher.md#storage-and-registry`). */
function readLibraryGame(gameId: string): OpenedGame {
  const registry = readLibraryFile(libraryPath());
  if (registry === null) throw new Error(`no library registry at ${libraryPath()}`);
  const entry = registry.entries.find((candidate) => candidate.gameId === gameId);
  if (entry === undefined) throw new Error(`the library has no entry ${gameId}`);
  const bytes = new Uint8Array(readFileSync(entry.packageLocation));
  const verified = verifyEntry(entry, bytes);
  if (!verified.ok) throw new Error(verified.reason);
  return { ...readGame(entry.packageLocation), bytes };
}

/**
 * The game this launch opens, or `null` when the resolution names none. `gameId` opens a named library entry, which the
 * page does after a person picks one; without it the ruled order decides.
 */
function openGame(gameId: string | null): OpenedGame | null {
  const target = resolution();
  switch (target.step) {
    case "argument":
    case "deep-link":
    case "config":
    case "baked":
      return readGame(target.path);
    case "library":
      return gameId === null ? null : readLibraryGame(gameId);
    case "none":
      return null;
  }
}

/** What the page needs to draw the fallback view: the step, the rows to pick from, and the sentence that says why. */
function launchInfo(): LaunchInfo {
  const target = resolution();
  if (target.step === "library") {
    return { step: "library", rows: target.rows, reason: "No game was named; these are the installed games." };
  }
  if (target.step === "none") return { step: "none", rows: [], reason: target.reason };
  return { step: target.step, rows: [], reason: null };
}

/** Resolve one `app://player/<path>` request inside the served root, refusing anything that escapes it. */
export function resolveAppPath(root: string, url: string): string | null {
  const parsed = new URL(url);
  const relative = normalize(decodeURIComponent(parsed.pathname)).replaceAll("\\", "/").replace(/^\/+/, "");
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** The blob areas AD-17 names, under the runner's own storage. */
function blobRoot(area: "saves" | "files"): string {
  return join(app.getPath("userData"), area);
}

function registerIpc(): void {
  // The bytes for the game this launch opens; `gameId` picks a library entry the page offered. A resolution that refuses
  // a package (a hash or size mismatch, a missing file) rejects, so the page shows the reason instead of a blank canvas.
  ipcMain.handle("desktop:launch", (_event, gameId: string | null): OpenedGame | null => openGame(gameId ?? null));
  ipcMain.handle("desktop:launch.info", (): LaunchInfo => launchInfo());
  ipcMain.handle("desktop:quit", (): boolean => {
    quitPlayer(app);
    return true;
  });

  ipcMain.handle("desktop:blob.read", (_event, area: "saves" | "files", gameId: string, path: string): Uint8Array | null => {
    const full = resolve(join(blobRoot(area), gameId, path));
    if (!full.startsWith(blobRoot(area) + sep)) return null;
    try {
      return new Uint8Array(readFileSync(full));
    } catch {
      return null;
    }
  });

  ipcMain.handle("desktop:blob.write", (_event, area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): boolean => {
    const full = resolve(join(blobRoot(area), gameId, path));
    if (!full.startsWith(blobRoot(area) + sep)) return false;
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    return true;
  });

  ipcMain.handle("desktop:blob.list", (_event, area: "saves" | "files", gameId: string): string[] => {
    const root = join(blobRoot(area), gameId);
    if (!root.startsWith(blobRoot(area))) return [];
    try {
      return readdirSync(root, { recursive: true })
        .map((entry) => String(entry).replaceAll("\\", "/"))
        .filter((entry) => {
          try {
            return statSync(join(root, entry)).isFile();
          } catch {
            return false;
          }
        })
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle("desktop:report", (_event, report: unknown): boolean => {
    // The measurement harness reads this back; the player itself logs it.
    const at = process.argv.findIndex((argument) => argument === "--report");
    if (at >= 0 && process.argv[at + 1] !== undefined) writeFileSync(resolve(process.argv[at + 1]), `${JSON.stringify(report, null, 2)}\n`);
    return true;
  });
}

function serveAppProtocol(): void {
  const root = serveRoot();
  protocol.handle(APP_SCHEME, (request) => {
    const full = resolveAppPath(root, request.url);
    if (full === null) return new Response("not found", { status: 404 });
    try {
      const body = readFileSync(full);
      return new Response(body, { headers: { "content-type": TYPES[extname(full)] ?? "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 720,
    backgroundColor: "#000000",
    // No chrome of our own: the page draws everything, and the menu bar is the OS's.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The app directory is the built one, so the preload sits beside `main.js`.
      preload: join(app.getAppPath(), "preload.js"),
      // No service worker: the desktop application is already offline (ADR 0013 decision 3).
      devTools: process.argv.includes("--devtools"),
    },
  });
  const page = currentPage();
  // Diagnostics: a page that fails to load, or a renderer error, is reported on stderr instead of disappearing.
  window.webContents.on("console-message", (event) => console.error(`renderer[${event.level}]: ${event.message}`));
  window.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`load failed ${code} ${description} ${url}`));
  window.webContents.on("preload-error", (_event, path, error) => console.error(`preload error ${path}: ${error.message}`));
  window.loadURL(`${APP_SCHEME}://player/${page}`).catch((error: unknown) => console.error(`loadURL: ${String(error)}`));
  playerWindow = window;
  window.on("closed", () => {
    if (playerWindow === window) playerWindow = null;
  });
  return window;
}

/** The page this launch shows: the measurement page when a report was asked for, else the live player. */
function currentPage(): string {
  const named = argumentValue(process.argv, "--page");
  if (named !== null) return named;
  return argumentValue(process.argv, "--report") === null ? "player.html" : "player-measure.html";
}

/**
 * Reload onto a newly delivered deep link. The page boots from `launch()` on load, so a reload is the whole handoff;
 * nothing is re-resolved while a game is running.
 */
function acceptDeepLink(url: string): void {
  if (deepLinkPath(url) === null) {
    console.error(`deep link ${url} names no game`);
    return;
  }
  pendingDeepLink = url;
  const window = playerWindow;
  if (window === null || window.isDestroyed()) return;
  window.loadURL(`${APP_SCHEME}://player/${currentPage()}`).catch((error: unknown) => console.error(`loadURL: ${String(error)}`));
}

// A packaged player is the default handler for its own scheme; an unpackaged harness takes the link as an argument.
if (app.isPackaged) app.setAsDefaultProtocolClient("tkr");
app.on("open-url", (event, url) => {
  event.preventDefault();
  acceptDeepLink(url);
});
// One player per data directory: a second launch hands its link to the first and exits.
if (!app.requestSingleInstanceLock()) app.quit();
else app.on("second-instance", (_event, argv) => {
  const link = deepLinkFromArgv(argv);
  if (link !== null) acceptDeepLink(link);
});

registerIpc();
app.whenReady().then(() => {
  serveAppProtocol();
  createWindow();
});

// One game, one window: closing it ends the player, so no `activate` handler recreates a window on macOS.
quitWhenLastWindowCloses(app);

export { blobRoot, currentPage, libraryPath, openGame, serveRoot, pathToFileURL };
