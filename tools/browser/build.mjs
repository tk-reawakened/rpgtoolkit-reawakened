// Browser bundle build (D-8): esbuild, one IIFE per entry point, no runtime import().
//
//   node tools/browser/build.mjs
//
// Bundles the player page and the conformance page from the same `tsc -b` output the headless runner uses, into
// `apps/`. Nothing here is a dev server: the bundles are the artefacts the lane serves.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "apps");

const entries = [
  { in: join(root, "packages/runner-web/app/main.ts"), out: "player.js" },
  { in: join(root, "packages/runner-web/app/vectors.ts"), out: "vectors.js" },
  { in: join(root, "packages/runner-web/app/agreement.ts"), out: "agreement.js" },
  { in: join(root, "packages/runner-web/app/audio.ts"), out: "audio.js" },
  { in: join(root, "packages/runner-web/app/video.ts"), out: "video.js" },
  { in: join(root, "packages/runner-web/app/storage.ts"), out: "storage.js" },
];

mkdirSync(out, { recursive: true });
for (const entry of entries) {
  await build({
    entryPoints: [entry.in],
    outfile: join(out, entry.out),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    sourcemap: false,
    logLevel: "warning",
    // The worker and the AudioWorklet are single-file IIFE bundles with no runtime import(); so is every page entry.
  });
  console.log(`built apps/${entry.out}`);
}

// The browser page needs the same bundled-asset manifest the desktop build produces, so both runners can resolve
// shared fonts and cursors from the `apps/` static tree without fetching the whole package manifest on boot.
const folders = ["media/fonts", "media/cursors", "media/soundfonts"];
const bundled = folders.flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${entry.name}`)
    .sort(),
);
writeFileSync(join(out, "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
console.log(`built apps/bundled.json (${bundled.length} bundled assets listed)`);
