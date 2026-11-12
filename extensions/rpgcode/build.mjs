import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
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

// Browser (web) extension host client. The web extension host loads this file as a module and
// reads `exports.activate`, so it must be CommonJS: an IIFE bundle (what this lane shipped
// until #950) exports nothing, the host never enters `activate`, and every contribution the
// extension makes on the web — the language client and the debug adapter — is silently dead.
await build({
  entryPoints: [join(here, "src/extension.browser.ts")],
  outfile: join(here, "dist/extension.browser.js"),
  bundle: true,
  format: "cjs",
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


// The debug adapter is a VS Code inline implementation (TOOL-1, TOOL-8; AD-21), so both
// hosts must carry the factory and the manifest must contribute the debugger. A bundle
// that dropped it would still start, so the check is here rather than in a test that
// reads source: this is what a vscode.dev load actually runs.
const manifest = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const contributesDebugger = Array.isArray(manifest.contributes?.debuggers)
  && manifest.contributes.debuggers.some((entry) => entry?.type === "rpgcode");
if (!contributesDebugger) {
  throw new Error("package.json must contribute the \"rpgcode\" debugger");
}
for (const bundle of ["dist/extension.browser.js", "dist/extension.js"]) {
  const text = readFileSync(join(here, bundle), "utf8");
  for (const marker of ["registerDebugAdapterDescriptorFactory", "DebugAdapterInlineImplementation", "handleMessage"]) {
    if (!text.includes(marker)) throw new Error(`${bundle} does not register the RPGCode debug adapter (missing ${marker})`);
  }
}

console.log("Built extensions/rpgcode (desktop client, browser client, node server, web worker server, debug adapter)");
