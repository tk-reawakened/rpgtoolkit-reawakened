// Build the mobile wrapper's inputs: the page bundle the Capacitor project carries, and the `dist/` webDir a device
// build syncs. It builds **the same page** the desktop shell runs (`runner-web`'s shared `bootPlayerPage`), which is
// runners.md#mobile's MUST NOT: a platform difference is a host service, never a second renderer, input path or asset
// source.
//
//   node tools/mobile/build.mjs

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const mobile = join(root, "packages", "runner-mobile");

await build({
  entryPoints: [join(mobile, "app", "player.ts")],
  outfile: join(root, "apps", "player-mobile.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  logLevel: "warning",
});

// The webDir Capacitor syncs into the native projects: the page, its bundle and the bundled-asset list.
mkdirSync(join(mobile, "dist"), { recursive: true });
cpSync(join(mobile, "app", "player.html"), join(mobile, "dist", "index.html"));
mkdirSync(join(mobile, "dist", "apps"), { recursive: true });
cpSync(join(root, "apps", "player-mobile.js"), join(mobile, "dist", "apps", "player-mobile.js"));
// The bundled-asset list the page reads: written here too, so the mobile build does not depend on the desktop's.
const { readdirSync, writeFileSync } = await import("node:fs");
const folders = ["media/fonts", "media/cursors"];
const bundled = folders.flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${entry.name}`)
    .sort(),
);
writeFileSync(join(root, "apps", "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
cpSync(join(root, "apps", "bundled.json"), join(mobile, "dist", "apps", "bundled.json"));
console.log("built runner-mobile: apps/player-mobile.js and dist/ (the Capacitor webDir)");
void readFileSync;
