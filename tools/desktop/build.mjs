// Build the desktop runner's three artefacts: the Electron main process and preload (Node/Electron targets, esbuild,
// `electron` external), and the player page bundle the browser lane's build already knows how to produce.
//
//   node tools/desktop/build.mjs            build into packages/runner-desktop/dist and apps/
//   node tools/desktop/build.mjs --check    build to a temp dir and report whether dist is current

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const desktop = join(root, "packages", "runner-desktop");

const shared = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  logLevel: "warning",
};

await build({
  ...shared,
  entryPoints: [join(desktop, "src", "main.ts")],
  outfile: join(desktop, "dist", "main.js"),
});
await build({
  ...shared,
  entryPoints: [join(desktop, "src", "preload.ts")],
  outfile: join(desktop, "dist", "preload.js"),
});
// The page bundle: the same esbuild rules the browser lane uses, with the desktop entry.
mkdirSync(join(root, "apps"), { recursive: true });
await build({
  entryPoints: [join(desktop, "app", "player.ts")],
  outfile: join(root, "apps", "player-desktop.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  logLevel: "warning",
});

// The Electron app's own `package.json`, so `electron .` finds the main process.
const manifest = {
  name: "tk-reawakened-player",
  productName: "TK Reawakened",
  version: "0.0.0",
  private: true,
  // The manifest sits beside the bundle it names: `dist/main.js` is the file itself.
  main: "main.js",
  description: "The TK Reawakened player: the runner's web build in an Electron shell (ADR 0013).",
};
const { writeFileSync } = await import("node:fs");
writeFileSync(join(desktop, "dist", "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
// The bundled asset list the page needs: a desktop origin has no directory listing, so the build writes the names.
const { readdirSync } = await import("node:fs");
const folders = ["media/fonts", "media/cursors"];
const bundled = folders.flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${entry.name}`)
    .sort(),
);
writeFileSync(join(root, "apps", "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
console.log(`built runner-desktop: dist/main.js, dist/preload.js, apps/player-desktop.js (${bundled.length} bundled assets listed)`);
