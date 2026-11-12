// Bundles the two extension entries the harness needs (#950):
//
//   extensions/rpgcode/dist/web-tests.js   the extension-host test module (CommonJS; the web
//                                          worker host refuses ES modules)
//   tools/vscode-web/fixtures/minimal-extension/dist/extension.js
//                                          the probe extension, in the format named by
//                                          `PROBE_FORMAT` (`cjs` by default, `iife` to
//                                          reproduce the "activate never runs" symptom)
//
// `vscode` is the host's own module in both cases, so it stays external.

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

// 1. The extension-host test module. It must live inside the served development extension
// folder (anywhere else has no extension host to launch it) and must be CommonJS.
const extensionDist = join(root, "extensions", "rpgcode", "dist");
mkdirSync(extensionDist, { recursive: true });
await build({
  entryPoints: [join(here, "tests", "index.ts")],
  outfile: join(extensionDist, "web-tests.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "warning",
});
console.log(`Built the VS Code web test module at ${resolve(extensionDist, "web-tests.js")}`);

// 2. The probe's control test, which lives inside the probe's own served folder.
const probeTestsDir = join(here, "fixtures", "minimal-extension", "dist");
mkdirSync(probeTestsDir, { recursive: true });
await build({
  entryPoints: [join(here, "tests", "probe.ts")],
  outfile: join(probeTestsDir, "web-tests.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["vscode"],
  logLevel: "warning",
});
console.log(`Built the probe control test at ${resolve(probeTestsDir, "web-tests.js")}`);

// 3. The probe extension, in the requested module format.
const probeFormat = process.env.PROBE_FORMAT ?? "cjs";
if (probeFormat !== "cjs" && probeFormat !== "iife") throw new Error(`PROBE_FORMAT must be cjs or iife, got ${probeFormat}`);
const probeDist = join(here, "fixtures", "minimal-extension", "dist");
await build({
  entryPoints: [join(here, "fixtures", "minimal-extension", "src", "extension.js")],
  outfile: join(probeDist, "extension.js"),
  bundle: true,
  format: probeFormat,
  platform: "browser",
  target: "es2022",
  external: ["vscode"],
  logLevel: "warning",
});
console.log(`Built the probe extension (${probeFormat}) at ${resolve(probeDist, "extension.js")}`);
