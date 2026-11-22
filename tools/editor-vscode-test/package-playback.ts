import { createHash } from "node:crypto";
import type { Expect, Page } from "@playwright/test";

/** The exact bytes a reviewed export produced: the archive and its sibling install descriptor. */
export interface PackagedGameBytes {
  /** The download's file name, which the descriptor must name. */
  readonly archiveName: string;
  readonly archive: Uint8Array;
  /** The descriptor download's bytes, not a rebuilt copy of them. */
  readonly descriptor: Uint8Array;
}

/** What the authored package must do once it is the only thing the player has. */
export interface PackagePlaybackExpectation {
  /** The normalized board key the player reports, for example `boards/start.brd`. */
  readonly board: string;
  /** A real key whose gameplay movement is observable in the player's reported position. */
  readonly movement: { readonly key: string; readonly axis: "x" | "y"; readonly direction: 1 | -1 };
  readonly start?: { readonly x: number; readonly y: number };
  /** Dismiss a deliberate startup wait before asserting the authored board. */
  readonly startupKey?: string;
  readonly beforeStartupKey?: (page: Page, expect: Expect) => Promise<void>;
  /** The player page to boot; the packaged runner by default. */
  readonly playerUrl?: string;
}

interface RunnerWindow extends Window {
  __live?: {
    readonly tick: number;
    readonly player: { readonly x: number; readonly y: number } | null;
    readonly board: string | null;
    readonly error?: string;
  };
}

const DEFAULT_PLAYER = "/packages/runner-web/app/index.html";

/**
 * Verify a descriptor against the archive it names, then serve only those bytes at the player's package URLs.
 * Nothing here reads the editor's source folder: the player gets a network response carrying the reviewed bytes.
 */
export async function bootPublishedPackage(page: Page, expect: Expect, game: PackagedGameBytes, playerPath = DEFAULT_PLAYER): Promise<void> {
  const descriptor = JSON.parse(new TextDecoder().decode(game.descriptor)) as {
    readonly file?: unknown;
    readonly sha256?: unknown;
    readonly size?: unknown;
  };
  expect(descriptor.file, "the descriptor names the downloaded archive").toBe(game.archiveName);
  expect(descriptor.size, "the descriptor records the archive's exact byte length").toBe(game.archive.byteLength);
  expect(descriptor.sha256, "the descriptor records the archive's exact SHA-256").toBe(createHash("sha256").update(game.archive).digest("hex"));

  const archive = Buffer.from(game.archive);
  await page.route(`**/${game.archiveName}`, (route) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers()["range"] ?? "");
    if (range === null) {
      return route.fulfill({
        status: 200,
        headers: { "accept-ranges": "bytes", "content-length": String(archive.length) },
        contentType: "application/octet-stream",
        body: archive,
      });
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start >= archive.length || end < start) {
      return route.fulfill({ status: 416, headers: { "content-range": `bytes */${archive.length}` } });
    }
    const last = Math.min(end, archive.length - 1);
    return route.fulfill({
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${last}/${archive.length}`,
        "content-length": String(last - start + 1),
      },
      contentType: "application/octet-stream",
      body: archive.subarray(start, last + 1),
    });
  });
  await page.route(`**/${game.archiveName}.json`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: Buffer.from(game.descriptor) }),
  );

  const url = new URL(playerPath, "http://127.0.0.1");
  url.searchParams.set("package", game.archiveName);
  url.searchParams.set("mode", "whole");
  await page.goto(/^[a-z]+:\/\//i.test(playerPath) ? url.href : `${url.pathname}${url.search}`);
}

function live(page: Page): Promise<RunnerWindow["__live"]> {
  return page.evaluate(() => (window as RunnerWindow).__live);
}

/**
 * Boot the reviewed archive in the real web runner and prove authored, input-driven play.
 *
 * The caller supplies a fresh isolated page with no editor source folder. Movement is observed in the
 * player's own reported position after pressing a real key.
 */
export async function provePackagePlayback(
  page: Page,
  expect: Expect,
  game: PackagedGameBytes,
  expectation: PackagePlaybackExpectation,
): Promise<void> {
  await bootPublishedPackage(page, expect, game, expectation.playerUrl);
  await page.waitForFunction(() => (window as RunnerWindow).__live !== undefined, undefined, { timeout: 45_000 });
  await page.locator("#screen").focus();
  await expectation.beforeStartupKey?.(page, expect);
  if (expectation.startupKey !== undefined) await page.keyboard.press(expectation.startupKey);
  await expect.poll(async () => {
    const frame = await live(page);
    if (frame?.error !== undefined) throw new Error(frame.error);
    return frame?.player == null ? null : frame.board;
  }, { timeout: 30_000, message: "the packaged game reaches the authored board" }).toBe(expectation.board);

  const boundary = await live(page);
  if (boundary?.player == null) throw new Error("the player did not report a position on the authored board");
  if (expectation.start !== undefined) expect(boundary.player).toMatchObject(expectation.start);
  const start = boundary.player[expectation.movement.axis];
  await page.keyboard.down(expectation.movement.key);
  try {
    await page.waitForFunction(
      ({ axis, direction, start }) => {
        const player = (window as RunnerWindow).__live?.player;
        return player !== null && player !== undefined && (player[axis] - start) * direction > 0;
      },
      { axis: expectation.movement.axis, direction: expectation.movement.direction, start },
      { timeout: 15_000 },
    );
  } finally {
    await page.keyboard.up(expectation.movement.key);
  }
  const moved = await live(page);
  expect(moved?.error).toBeUndefined();
  expect(moved?.board).toBe(expectation.board);
  if (moved?.player == null) throw new Error("the player stopped reporting a position while walking");
  expect((moved.player[expectation.movement.axis] - start) * expectation.movement.direction).toBeGreaterThan(0);
}
