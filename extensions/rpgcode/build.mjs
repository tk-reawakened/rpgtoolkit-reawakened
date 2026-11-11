import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const nodePaths = [
  join(root, "node_modules"),
  join(here, "node_modules"),
  join(root, "packages/lsp/node_modules"),
];

mkdirSync(join(here, "dist"), { recursive: true });
mkdirSync(join(here, "server"), { recursive: true });

// Desktop (node) extension host client.
await build({
  entryPoints: [join(here, "src/extension.ts")],
  outfile: join(here, "dist/extension.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  external: ["vscode"],
  nodePaths,
  logLevel: "warning",
});

// Browser (web) extension host client.
await build({
  entryPoints: [join(here, "src/extension.browser.ts")],
  outfile: join(here, "dist/extension.browser.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  external: ["vscode"],
  nodePaths,
  logLevel: "warning",
});

// Self-contained stdio language server for the packaged desktop extension.
await build({
  entryPoints: [join(root, "packages/lsp/bin/stdio.ts")],
  outfile: join(here, "server/stdio.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: false,
  logLevel: "warning",
  nodePaths,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

// Self-contained web-worker language server for the vscode.dev/web build.
await build({
  entryPoints: [join(here, "src/server.worker.ts")],
  outfile: join(here, "dist/server.worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "warning",
  nodePaths,
});


console.log("Built extensions/rpgcode (desktop client, browser client, node server, web worker server)");
