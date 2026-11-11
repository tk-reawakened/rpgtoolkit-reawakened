// The closing suite needs every fetched game's files, and neither host can list a directory: a PWA origin has no
// directory listing over HTTP, and the desktop shell serves static paths over `app://`. The build writes the list beside
// the bundles, exactly as `apps/bundled.json` does for shared assets, and both hosts fetch the same manifest.
//
// The manifest is data about fetched fixtures, so it is written only when they are present: a checkout that has not run
// `pnpm fixtures:fetch` gets an empty map and the suite reports the games as unreachable instead of failing the build.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CLOSING_MANIFEST_PATH = "apps/closing-files.json";

/** `fixtures/legacy/<game>/**` as `/`-separated paths, sorted, one list per game. */
export function closingGames(root) {
  const legacy = resolve(root, "fixtures", "legacy");
  if (!existsSync(legacy)) return {};
  const games = {};
  for (const game of readdirSync(legacy, { withFileTypes: true })) {
    if (!game.isDirectory()) continue;
    const directory = join(legacy, game.name);
    const files = readdirSync(directory, { recursive: true, encoding: "utf8" })
      .map((path) => String(path).split("\\").join("/"))
      .filter((path) => statSync(join(directory, path)).isFile())
      .sort();
    if (files.length > 0) games[game.name] = files;
  }
  return games;
}

/** Write `apps/closing-files.json` and return the game count. */
export function writeClosingManifest(root) {
  const games = closingGames(root);
  const out = join(root, CLOSING_MANIFEST_PATH);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ schema: 1, games }, null, 2)}\n`);
  return Object.keys(games).length;
}
