import { expect, test, _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { electronBinary, reportElectronLaunchFailure } from "../../desktop/electron-binary.mjs";

/**
 * Entry 9.10's two acceptance limbs that need a real host:
 *
 * 1. the same draw list renders the same frame in the PWA build and in the player, within the D-7 bound of one unit per
 *    channel — measured channel by channel, not by a hash; and
 * 2. a cold start with nothing configured shows the installed games and opens the one a person picks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

type Frame = {
  readonly width: number;
  readonly height: number;
  readonly worst: number;
  readonly rgba: string;
};

type ParityFrame = Frame & { readonly tick: number; readonly stateHash: string; readonly drawHash: string; readonly error?: string };

type LiveState = { readonly tick: number; readonly stateHash: string; readonly board: string | null; readonly error?: string };

declare global {
  interface Window {
    __frame?: Frame | null;
    __parity?: ParityFrame;
    __live?: LiveState;
  }
}

/** The committed baseline for the demo board at tick 120: the launch step must not change what is drawn. */
function demoBoard(): { readonly tick: number; readonly stateHash: string; readonly drawHash: string } {
  const baseline = JSON.parse(readFileSync(join(root, "golden/regression/closing.json"), "utf8")) as {
    games: Record<string, { frames: readonly { label: string; tick: number; stateHash: string; drawHash: string }[] }>;
  };
  const frame = baseline.games["demo"]?.frames.find((candidate) => candidate.label === "board" && candidate.tick === 120);
  if (frame === undefined) throw new Error("golden/regression/closing.json has no demo board frame at tick 120");
  return frame;
}

/** Launch the built player against the served workspace, with a data directory of its own. */
async function launchPlayer(page: string, dataDir: string, game: string | null) {
  return electron.launch({
    executablePath: electronBinary(),
    args: [
      join(root, "packages/runner-desktop/dist"),
      ...(process.platform === "linux" ? ["--enable-unsafe-swiftshader"] : []),
      "--serve", root,
      "--user-data-dir", dataDir,
      ...(game === null ? [] : ["--game", game]),
      "--page", page,
    ],
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "0",
      ...(process.platform === "linux" ? { ELECTRON_DISABLE_SANDBOX: "1" } : {}),
    },
  }).catch((error: unknown) => {
    reportElectronLaunchFailure(error);
    throw error;
  });
}

function bytesOf(frame: Frame): Buffer {
  return Buffer.from(frame.rgba, "base64");
}

test("the same draw list renders the same frame in the PWA build and in the player", async ({ page }) => {
  test.setTimeout(180_000);
  const baseline = demoBoard();

  await page.goto("/packages/runner-web/app/parity.html");
  await page.waitForFunction(() => window.__parity !== undefined, undefined, { timeout: 120_000 });
  const pwa = await page.evaluate(() => window.__parity);
  expect(pwa).toBeDefined();
  if (pwa === undefined) throw new Error("the PWA parity page published no frame");
  expect(pwa.error ?? null).toBeNull();
  expect(pwa.tick).toBe(baseline.tick);
  expect(pwa.stateHash).toBe(baseline.stateHash);
  expect(pwa.drawHash).toBe(baseline.drawHash);
  // The PWA build agrees with its own reference rasteriser exactly before it is compared with the player.
  expect(pwa.worst).toBe(0);

  const packagePath = join(root, "fixtures/packages/demo.tpk");
  const dataDir = mkdtempSync(join(tmpdir(), "tkr-parity-"));
  const player = await launchPlayer("packages/runner-desktop/app/player-measure.html?capture", dataDir, packagePath);
  try {
    const window = await player.firstWindow();
    window.on("console", (message) => console.log(`player[${message.type()}]: ${message.text()}`));
    // The measurement page resolves its game from the main process; the page's query only asks for pixels.
    await window.waitForFunction(() => window.__frame != null, undefined, { timeout: 120_000 });
    const presented = await window.evaluate(() => window.__frame);
    if (presented === null || presented === undefined) throw new Error("the player published no frame");

    expect(presented.width).toBe(pwa.width);
    expect(presented.height).toBe(pwa.height);
    const playerBytes = bytesOf(presented);
    const pwaBytes = bytesOf(pwa);
    expect(playerBytes.length).toBe(pwaBytes.length);
    let worst = 0;
    let at = "";
    for (let index = 0; index < playerBytes.length; index += 1) {
      const delta = Math.abs(playerBytes[index]! - pwaBytes[index]!);
      if (delta > worst) {
        worst = delta;
        at = `channel ${index % 4} of pixel ${Math.floor(index / 4)}`;
      }
    }
    console.log(`PWA vs player: worst channel delta ${worst}${worst === 0 ? "" : ` at ${at}`}`);
    // D-7: exact for colour key and tint, at most one unit per channel for blend arithmetic.
    expect(worst, `worst channel delta ${worst}${worst === 0 ? "" : ` at ${at}`}`).toBeLessThanOrEqual(1);
  } finally {
    await player.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a cold start with nothing configured lists the installed games and opens the one that is picked", async () => {
  test.setTimeout(180_000);
  const packagePath = join(root, "fixtures/packages/demo.tpk");
  const bytes = readFileSync(packagePath);
  const descriptor = JSON.parse(readFileSync(`${packagePath}.json`, "utf8")) as { gameId: string; title: string; version: string };
  const dataDir = mkdtempSync(join(tmpdir(), "tkr-library-"));
  writeFileSync(join(dataDir, "library.json"), JSON.stringify({
    schema: 1,
    defaultGameId: descriptor.gameId,
    entries: [{
      gameId: descriptor.gameId,
      title: descriptor.title,
      version: descriptor.version,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      packageLocation: packagePath,
      installedAt: "2026-11-10T00:00:00.000Z",
      lastPlayedAt: null,
    }],
  }, null, 2));

  const player = await launchPlayer("packages/runner-desktop/app/player.html", dataDir, null);
  try {
    const window = await player.firstWindow();
    // The fallback is not a blank window: it says why, and offers what is installed.
    await expect(window.locator("#live-status")).toContainText("No game was named", { timeout: 60_000 });
    const offered = window.getByRole("button", { name: `${descriptor.title} (${descriptor.version})` });
    await expect(offered).toBeVisible();

    await offered.click();
    // Opening the picked entry takes the same session path a configured launch does: one engine, ticking under the
    // injected clock. The demo sits on its title screens for the first several hundred ticks, so a board is not the
    // signal here — a running session with a state hash is.
    await window.waitForFunction(() => {
      const live = window.__live;
      return live !== undefined && live.error === undefined && live.tick > 30 && live.stateHash !== "";
    }, undefined, { timeout: 120_000 });
    const live = await window.evaluate(() => window.__live);
    if (live === undefined) throw new Error("the player published no live state");
    expect(live.error ?? null).toBeNull();
    expect(live.stateHash).not.toBe("");
    expect(live.tick).toBeGreaterThan(30);
  } finally {
    await player.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
