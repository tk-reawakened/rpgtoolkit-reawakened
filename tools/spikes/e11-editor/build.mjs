// Builds every spike bundle with the repository's browser options (tools/browser/bundle-options.mjs: one IIFE, ES2022,
// esbuild's JSX for Preact, no plugin) plus minification, then records sizes and a static scan of the library code that
// ended up in each bundle. Output: $TKR_SPIKE_OUT/bundles/* and $TKR_SPIKE_OUT/build.json.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "esbuild";
import { bundleOptions } from "../../browser/bundle-options.mjs";
import { findDynamicCode } from "../../editor-ui-toolchain/check-bundles.mjs";
import { deps, depsDir, here, outDir } from "./env.mjs";

const bundles = join(outDir, "bundles");
rmSync(bundles, { recursive: true, force: true });
mkdirSync(bundles, { recursive: true });
const nodeModules = realpathSync(join(depsDir, "node_modules"));
const monacoEsm = join(nodeModules, "monaco-editor/esm/vs/editor");

// Monaco's "everything but the bundled languages" set: editor.main's own imports minus languages/definitions and
// languages/features. Derived from the installed file so a version bump cannot silently change what is measured.
const monacoCore = readFileSync(join(monacoEsm, "editor.main.js"), "utf8")
  .split("\n")
  .filter((line) => /^import ['"]\.\.?\//.test(line) && !line.includes("/languages/"))
  .map((line) => line.replace(/'(\.\.?\/)/, (_match, prefix) => `'${join(monacoEsm, prefix)}`))
  .join("\n");

// The nonce experiment: give Monaco's two `<style>` creation sites the page's script nonce. This is a patch we would
// own; it is measured to see what a nonce buys, not proposed lightly.
const monacoNoncePatch = {
  name: "monaco-style-nonce",
  setup(builder) {
    builder.onLoad({ filter: /base[\\/]browser[\\/](domStylesheets|ui[\\/]contextview[\\/]contextview)\.js$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      const patched = source.replaceAll(
        "const style = document.createElement('style');",
        "const style = document.createElement('style'); if (globalThis.__tkrStyleNonce) style.nonce = globalThis.__tkrStyleNonce;",
      );
      if (patched === source) throw new Error(`nonce patch did not apply to ${args.path}`);
      return { contents: patched, loader: "js" };
    });
  },
};

const entries = [
  { name: "dock-dockview", lib: ["dockview", "dockview-core"], code: `import { startDockview } from "./proto/dock-dockview.mjs"; startDockview();` },
  { name: "dock-dockview-kbd", lib: ["dockview", "dockview-core"], code: `import { startDockview } from "./proto/dock-dockview.mjs"; import { installKeyboardLayer } from "./proto/dock-keyboard.mjs"; startDockview({ keyboardLayer: installKeyboardLayer });` },
  { name: "dock-dockspawn", lib: ["dock-spawn-ts"], code: `import { startDockspawn } from "./proto/dock-dockspawn.mjs"; startDockspawn();` },
  { name: "dock-lumino", lib: ["@lumino/"], code: `import { startLumino } from "./proto/dock-lumino.mjs"; startLumino();` },
  { name: "dock-golden", lib: ["golden-layout"], code: `import { startGolden } from "./proto/dock-golden.mjs"; // golden-layout defers its own init to DOMContentLoaded while the document is loading.\nif (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startGolden); else startGolden();` },
  { name: "monaco-core-classic", lib: ["monaco-editor", "marked", "dompurify"], code: `${monacoCore}\nimport "./proto/monaco.mjs";`, define: { __WORKER_MODE__: '"classic"' } },
  { name: "monaco-core-blob", lib: ["monaco-editor", "marked", "dompurify"], code: `${monacoCore}\nimport "./proto/monaco.mjs";`, define: { __WORKER_MODE__: '"blob"' } },
  {
    name: "monaco-core-nonce",
    lib: ["monaco-editor", "marked", "dompurify"],
    code: `${monacoCore}\nimport "./proto/monaco.mjs";`,
    define: { __WORKER_MODE__: '"classic"' },
    plugins: [monacoNoncePatch],
    banner: "globalThis.__tkrStyleNonce = document.currentScript && document.currentScript.nonce;",
  },
  {
    name: "monaco-core-nonce-fetchblob",
    lib: ["monaco-editor", "marked", "dompurify"],
    code: `${monacoCore}\nimport "./proto/monaco.mjs";`,
    define: { __WORKER_MODE__: '"fetch-blob"' },
    plugins: [monacoNoncePatch],
    banner: "globalThis.__tkrStyleNonce = document.currentScript && document.currentScript.nonce;",
  },
  { name: "monaco-full", lib: ["monaco-editor", "marked", "dompurify"], code: `import "monaco-editor/editor/editor.main.js";\nimport "./proto/monaco.mjs";`, define: { __WORKER_MODE__: '"classic"' } },
  { name: "codemirror", lib: ["codemirror", "@codemirror/", "@lezer/", "style-mod", "w3c-keyname", "crelt", "@marijn/"], code: `import "./proto/codemirror.mjs";`, define: { __SHADOW__: "false" } },
  { name: "codemirror-shadow", lib: ["codemirror", "@codemirror/", "@lezer/", "style-mod", "w3c-keyname", "crelt", "@marijn/"], code: `import "./proto/codemirror.mjs";`, define: { __SHADOW__: "true" } },
];

const scanPatterns = {
  setAttributeStyle: /setAttribute\(\s*["']style["']/g,
  innerHTML: /\.innerHTML\s*=(?!=)/g,
  insertAdjacentHTML: /insertAdjacentHTML\(/g,
  createStyleElement: /createElement\(\s*["']style["']\s*\)/g,
  styleAttributeInMarkup: /style=\\?["'][^"'\\]{0,40}/g,
  cssTextAssign: /\.cssText\s*=(?!=)/g,
  constructableStylesheet: /new\s+(?:[\w$.]+\.)?CSSStyleSheet\(|adoptedStyleSheets/g,
  newWorker: /new\s+Worker\(/g,
  blobUrl: /createObjectURL\(/g,
};

const size = (bytes) => ({
  bytes: bytes.length,
  gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
});
const packageOf = (path) => {
  const rel = relative(nodeModules, path);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(/[\\/]/);
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
};

const report = { node: process.version, esbuild: (await import("esbuild")).version, deps, monacoCoreImports: monacoCore.split("\n").length, bundles: {} };
for (const entry of entries) {
  const result = await build({
    ...bundleOptions,
    stdin: { contents: entry.code, resolveDir: here, sourcefile: `${entry.name}.entry.mjs`, loader: "js" },
    outfile: join(bundles, `${entry.name}.js`),
    nodePaths: [nodeModules],
    minify: true,
    metafile: true,
    loader: { ".ttf": "file", ".svg": "dataurl", ".png": "dataurl", ".gif": "dataurl" },
    assetNames: "[name]",
    define: { ...(entry.define ?? {}) },
    plugins: entry.plugins ?? [],
    banner: entry.banner ? { js: entry.banner } : undefined,
    logLevel: "error",
  });
  const outputs = {};
  const packages = {};
  for (const [file, output] of Object.entries(result.metafile.outputs)) {
    const bytes = readFileSync(file);
    outputs[basename(file)] = size(bytes);
    if (!file.endsWith(".js")) continue;
    outputs[basename(file)].dynamicCode = findDynamicCode(bytes.toString("utf8")).map(({ pattern, line, column }) => ({ pattern, line, column }));
    for (const [input, info] of Object.entries(output.inputs)) {
      const absolute = input.startsWith("/") ? input : join(process.cwd(), input);
      const name = packageOf(existsSync(absolute) ? realpathSync(absolute) : absolute) ?? (input.includes("node_modules/preact") ? "preact" : "spike code");
      packages[name] ??= { bytesInOutput: 0, files: 0, scan: Object.fromEntries(Object.keys(scanPatterns).map((key) => [key, 0])) };
      packages[name].bytesInOutput += info.bytesInOutput;
      packages[name].files += 1;
      if (info.bytesInOutput === 0 || !/\.(m?js|cjs)$/.test(input)) continue;
      if (!existsSync(absolute)) continue;
      const source = readFileSync(absolute, "utf8");
      for (const [key, regex] of Object.entries(scanPatterns)) packages[name].scan[key] += [...source.matchAll(regex)].length;
    }
  }
  const libraryBytes = Object.entries(packages)
    .filter(([name]) => entry.lib.some((prefix) => name === prefix || name.startsWith(prefix)))
    .reduce((sum, [, info]) => sum + info.bytesInOutput, 0);
  report.bundles[entry.name] = { outputs, libraryBytesInOutput: libraryBytes, packages };
  console.log(`${entry.name}: ${Object.entries(outputs).map(([file, s]) => `${file} ${s.bytes} B (gz ${s.gzip})`).join(", ")}`);
}

for (const [name, format] of [["editor.worker", "iife"], ["editor.worker.module", "esm"]]) {
  const result = await build({
    entryPoints: [join(monacoEsm, "editor.worker.js")],
    outfile: join(bundles, `${name}.js`),
    bundle: true,
    format,
    target: "es2022",
    minify: true,
    metafile: true,
    logLevel: "error",
  });
  const file = Object.keys(result.metafile.outputs)[0];
  const bytes = readFileSync(file);
  report.bundles[name] = { outputs: { [basename(file)]: { ...size(bytes), dynamicCode: findDynamicCode(bytes.toString("utf8")).map(({ pattern, line, column }) => ({ pattern, line, column })) } } };
  console.log(`${name}: ${bytes.length} B`);
}

writeFileSync(join(outDir, "build.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${join(outDir, "build.json")}`);
