// Browser bundle build (D-8): esbuild, one IIFE per entry point, no runtime import().
//
//   node tools/browser/build.mjs
//
// Bundles the player page and the conformance page from the same `tsc -b` output the headless runner uses, into
// `apps/`. Nothing here is a dev server: the bundles are the artefacts the lane serves.

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "apps");

const entries = [
  { in: join(root, "packages/runner-web/app/main.ts"), out: "player.js" },
  { in: join(root, "packages/runner-web/app/vectors.ts"), out: "vectors.js" },
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
