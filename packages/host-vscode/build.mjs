import { build } from "esbuild";
import { cp, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const strictBrowserAlias = { "stb-vorbis": resolve(root, "../../tools/browser/stb-vorbis-stub.mjs") };
const out = resolve(root, "dist");
await mkdir(out, { recursive: true });
await Promise.all([
  build({ entryPoints: [resolve(root, "src/activate.ts")], outfile: resolve(out, "extension.js"), bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], sourcemap: true }),
  build({ entryPoints: [resolve(root, "src/activate.ts")], outfile: resolve(out, "extension.browser.js"), bundle: true, platform: "browser", format: "cjs", target: "es2022", external: ["vscode"], sourcemap: true, alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "src/webview.tsx")], outfile: resolve(out, "webview.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "src/terrain-scene-webview.tsx")], outfile: resolve(out, "terrain-scene.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "src/creator-tests-webview.tsx")], outfile: resolve(out, "creator-tests-webview.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "src/visual-events.ts")], outfile: resolve(out, "visual-events.js"), bundle: true, platform: "node", format: "esm", target: "node20", external: ["vscode", "@tk-reawakened/editor-model", "@tk-reawakened/editor-ui"], sourcemap: true }),
  // Keep the extension-host module separate from the browser-only webview bundle.
  build({ entryPoints: [resolve(root, "src/visual-events-webview.tsx")], outfile: resolve(out, "visual-events-webview.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "src/visual-fixtures-webview.tsx")], outfile: resolve(out, "visual-fixtures-webview.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", sourcemap: true, jsx: "automatic", jsxImportSource: "preact", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "../runner-web/app/main.ts")], outfile: resolve(out, "player.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "../runner-web/src/audio-worklet.ts")], outfile: resolve(out, "audio-worklet.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", alias: strictBrowserAlias }),
  build({ entryPoints: [resolve(root, "../runner-web/src/decode-worker.ts")], outfile: resolve(out, "decode-worker.js"), bundle: true, platform: "browser", format: "iife", target: "es2022", alias: strictBrowserAlias }),
]);
// Match the strict-browser build guard: an eagerly embedded decoder violates the native webview's existing policy.
for (const file of ["extension.browser.js", "webview.js", "terrain-scene.js", "creator-tests-webview.js", "visual-events-webview.js", "visual-fixtures-webview.js", "player.js", "audio-worklet.js", "decode-worker.js"]) {
  if ((await readFile(resolve(out, file), "utf8")).includes("AGFzbQ")) {
    throw new Error(`${file} contains an eager WebAssembly module; the VS Code webview forbids instantiation`);
  }
}
await cp(resolve(root, "../editor-ui/src/tileset-browser.css"), resolve(out, "tileset-browser.css"));
await cp(resolve(root, "../editor-ui/src/skin-view.css"), resolve(out, "skin-view.css"));
await cp(resolve(root, "../editor-ui/src/tileset-art.css"), resolve(out, "tileset-art.css"));
await cp(resolve(root, "../editor-ui/src/board-objects.css"), resolve(out, "board-objects.css"));
await cp(resolve(root, "../editor-ui/src/visual-events.css"), resolve(out, "visual-events.css"));
await cp(resolve(root, "../editor-ui/src/tileset-browser.css"), resolve(out, "terrain-scene.css"));
