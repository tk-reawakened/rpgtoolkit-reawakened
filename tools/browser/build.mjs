// Browser bundle build (D-8): esbuild, one IIFE per entry point, no runtime import().
//
//   node tools/browser/build.mjs
//
// Bundles the player page and the conformance page from the same `tsc -b` output the headless runner uses, into
// `apps/`. Nothing here is a dev server: the bundles are the artefacts the lane serves.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions } from "./bundle-options.mjs";
import { writeClosingManifest } from "../closing/manifest.mjs";
import { assertNoBuildOutputCollisions, hostBuildOutput } from "../build-outputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
assertNoBuildOutputCollisions();
const out = join(root, "apps", "browser");

const entries = [
  { in: join(root, "packages/runner-web/app/main.ts"), out: "player.js" },
  { in: join(root, "packages/runner-web/app/vectors.ts"), out: "vectors.js" },
  { in: join(root, "packages/runner-web/app/agreement.ts"), out: "agreement.js" },
  { in: join(root, "packages/runner-web/app/parity.ts"), out: "parity.js" },
  { in: join(root, "packages/runner-web/app/closing.ts"), out: "closing.js" },
  { in: join(root, "packages/runner-web/app/audio.ts"), out: "audio.js" },
  { in: join(root, "packages/runner-web/app/video.ts"), out: "video.js" },
  { in: join(root, "packages/runner-web/app/storage.ts"), out: "storage.js" },
  { in: join(root, "packages/runner-web/src/decode-worker.ts"), out: "decode-worker.js" },
  { in: join(root, "packages/runner-web/src/audio-worklet.ts"), out: "audio-worklet.js" },
  { in: join(root, "packages/runner-web/app/decode.ts"), out: "decode.js" },
  { in: join(root, "packages/runner-web/app/worker-probe.ts"), out: "worker-probe.js" },
];

mkdirSync(out, { recursive: true });
for (const entry of entries) {
  await build({
    entryPoints: [entry.in],
    outfile: hostBuildOutput(root, "browser", entry.out),
    ...bundleOptions,
    // The worker and the AudioWorklet are single-file IIFE bundles with no runtime import(); so is every page entry.
  });
  console.log(`built apps/browser/${entry.out}`);
}
const editorWebOut = join(here, "editor-web", "dist", "editor-web.js");
mkdirSync(dirname(editorWebOut), { recursive: true });
copyFileSync(join(root, "packages/editor-ui/src/tileset-browser.css"), join(dirname(editorWebOut), "tileset-browser.css"));
await build({
  entryPoints: [join(here, "editor-web", "main.tsx")],
  outfile: editorWebOut,
  ...bundleOptions,
  alias: {
    ...bundleOptions.alias,
    "@tk-reawakened/host-web": join(root, "packages/host-web/src/index.ts"),
    "@tk-reawakened/editor-model": join(root, "packages/editor-model/src/index.ts"),
    "@tk-reawakened/editor-ui": join(root, "packages/editor-ui/src/index.ts"),
  },
});
console.log("built tools/browser/editor-web/dist/editor-web.js");

// No browser artefact may contain a WebAssembly module: the page's strict `script-src 'self'` forbids instantiation, and
// the only dependency that ships one (the Vorbis decoder) is aliased to a stub (#1325,
// `docs/spec/engine/runners.md#csp-and-banks`). A bundle that starts carrying `AGFzbQ` again would violate the policy at
// runtime, so the build says so here rather than in a browser console.
for (const entry of entries) {
  const bundled = readFileSync(hostBuildOutput(root, "browser", entry.out), "utf8");
  if (bundled.includes("AGFzbQ")) throw new Error(`apps/browser/${entry.out} contains a WebAssembly module; the browser player forbids instantiation`);
}

// The browser page owns its bundled-asset manifest. Desktop and mobile emit their own host-specific copies from the same
// source folders, so building one host can never overwrite another host's index.
const folders = ["media/fonts", "media/cursors", "media/soundfonts", "stock/stock_menu", "stock/stock_battle", "stock/stock_rpg"];
const bundled = folders.flatMap((folder) =>
  readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${folder}/${entry.name}`)
    .sort(),
);
writeFileSync(hostBuildOutput(root, "browser", "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
console.log(`built apps/browser/closing-files.json (${writeClosingManifest(root, "browser")} fetched games listed)`);
console.log(`built apps/browser/bundled.json (${bundled.length} bundled assets listed)`);

// Precache manifest (issue #934): listing app shell files, content-derived version, and bundled assets.
const shellFiles = [
  "packages/runner-web/app/index.html",
  "apps/browser/player.js",
  "apps/browser/decode-worker.js",
  "apps/browser/audio-worklet.js",
  "apps/browser/bundled.json",
  "golden/closing/plan.json",
];
const hasher = createHash("sha256");
for (const rel of shellFiles) {
  const full = join(root, rel);
  if (existsSync(full)) {
    hasher.update(rel);
    hasher.update(readFileSync(full));
  }
}
for (const rel of bundled) {
  const full = join(root, rel);
  if (existsSync(full)) {
    hasher.update(rel);
    hasher.update(readFileSync(full));
  }
}
const version = hasher.digest("hex").slice(0, 16);

const precache = {
  version,
  shell: [
    "/packages/runner-web/app/index.html",
    "/apps/browser/player.js",
    "/apps/browser/decode-worker.js",
    "/apps/browser/audio-worklet.js",
    "/apps/browser/bundled.json",
    "/apps/browser/precache.json",
    "/golden/closing/plan.json",
  ],
  bundled: bundled.map((path) => `/${path}`),
};
writeFileSync(hostBuildOutput(root, "browser", "precache.json"), `${JSON.stringify(precache, null, 2)}\n`);
console.log(`built apps/browser/precache.json (version ${version}, ${precache.shell.length + precache.bundled.length} precached URLs)`);

// The service worker bundle embeds the content-derived version and precache manifest
await build({
  entryPoints: [join(root, "packages/runner-web/src/service-worker.ts")],
  outfile: hostBuildOutput(root, "browser", "service-worker.js"),
  ...bundleOptions,
  define: {
    "__SERVICE_WORKER_VERSION__": JSON.stringify(version),
    "__PRECACHE_MANIFEST__": JSON.stringify(JSON.stringify(precache)),
  },
});
console.log(`built apps/service-worker.js (version ${version})`);
