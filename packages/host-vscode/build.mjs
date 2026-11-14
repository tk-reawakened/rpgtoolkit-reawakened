import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "dist");
await mkdir(out, { recursive: true });
await Promise.all([
  build({ entryPoints: [resolve(root, "src/activate.ts")], outfile: resolve(out, "extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], sourcemap: true }),
  build({ entryPoints: [resolve(root, "src/activate.ts")], outfile: resolve(out, "extension.browser.js"), bundle: true, platform: "browser", format: "cjs", target: "es2022", external: ["vscode"], sourcemap: true }),
  build({ entryPoints: [resolve(root, "src/webview.tsx")], outfile: resolve(out, "webview.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact" }),
]);
await cp(resolve(root, "../editor-ui/src/tileset-browser.css"), resolve(out, "tileset-browser.css"));
await cp(resolve(root, "../editor-ui/src/tileset-art.css"), resolve(out, "tileset-art.css"));
