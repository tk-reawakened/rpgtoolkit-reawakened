// Build the mobile wrapper's inputs: the page bundle the Capacitor project carries, and the `dist/` webDir a device
// build syncs. It builds **the same page** the desktop shell runs (`runner-web`'s shared `bootPlayerPage`), which is
// runners.md#mobile's MUST NOT: a platform difference is a host service, never a second renderer, input path or asset
// source.
//
//   node tools/mobile/build.mjs

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

// The webDir Capacitor syncs into the native projects: the page, its bundle, the bundled-asset list and the assets themselves.
mkdirSync(join(mobile, "dist"), { recursive: true });
cpSync(join(mobile, "app", "player.html"), join(mobile, "dist", "index.html"));
mkdirSync(join(mobile, "dist", "apps"), { recursive: true });
cpSync(join(root, "apps", "player-mobile.js"), join(mobile, "dist", "apps", "player-mobile.js"));

// The bundled-asset list the page reads, plus the actual font/cursor files, so fetches work on a device without a dev server.
const { readdirSync, writeFileSync } = await import("node:fs");
const folders = ["media/fonts", "media/cursors"];
const bundled = folders.flatMap((folder) => {
  mkdirSync(join(mobile, "dist", folder), { recursive: true });
  return readdirSync(join(root, folder), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const relative = `${folder}/${entry.name}`;
      cpSync(join(root, folder, entry.name), join(mobile, "dist", relative));
      return relative;
    })
    .sort();
});
writeFileSync(join(root, "apps", "bundled.json"), `${JSON.stringify({ folders, files: bundled }, null, 2)}\n`);
cpSync(join(root, "apps", "bundled.json"), join(mobile, "dist", "apps", "bundled.json"));

// The package the mobile player boots. `pnpm make-package` builds it from the fixture if it is not already present.
const demoPackage = join(root, "fixtures", "packages", "demo.tpk");
const demoDescriptor = join(root, "fixtures", "packages", "demo.tpk.json");
if (!existsSync(demoPackage) || !existsSync(demoDescriptor)) {
  throw new Error("demo.tpk and its descriptor must be built first; run `pnpm make-package fixtures/packages/demo` or `pnpm fixtures:fetch`");
}
mkdirSync(join(mobile, "dist", "public"), { recursive: true });
// The shared measurement page (`bootPlayerPage`) fetches the package from the webDir by its bundled name.
cpSync(demoPackage, join(mobile, "dist", "public", "game.tpk"));

// Measurement fixtures the shared page needs. The dev-server/browser-test path serves the repo root; on a device only
// `dist/` is served, so copy the exact fetch paths the page uses.
const fixtures = [
  "golden/closing/plan.json",
  "tools/fixtures/conformance/raster/vectors.json",
  "packages/core/test/fixtures/audio/files/pcm16-mono-8000.wav",
];
for (const fixture of fixtures) {
  const destination = join(mobile, "dist", fixture);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, fixture), destination);
}

console.log("built runner-mobile: apps/player-mobile.js and dist/ (the Capacitor webDir)");
void readFileSync;
