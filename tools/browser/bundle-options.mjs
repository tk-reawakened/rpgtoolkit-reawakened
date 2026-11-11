import { fileURLToPath } from "node:url";

// The esbuild options every browser bundle shares (ADR 0015 decision 1; ADR 0025 decision 2): one IIFE, no runtime
// import(), no plugin. JSX is esbuild's built-in transform, the automatic runtime with `preact` as the import source,
// which is what `tsconfig.editor-ui.json` tells `tsc -b` (`jsx: react-jsx`, `jsxImportSource: preact`); the toolchain
// test fails if the two drift. The options only matter for `.tsx` files; other entries are unaffected.
//
// `stb-vorbis` is aliased to a stub (#1325, `docs/spec/engine/runners.md#csp-and-banks`): the MIDI dependency imports its
// Vorbis decoder eagerly, and that module instantiates WebAssembly at import time, which the browser player's strict
// `script-src 'self'` forbids. The stub keeps the SF2 path initialising and refuses SF3, so the shipped player
// instantiates no WebAssembly. The desktop and measurement bundles keep the real decoder.
export const bundleOptions = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  sourcemap: false,
  logLevel: "warning",
  jsx: "automatic",
  jsxImportSource: "preact",
  alias: {
    "stb-vorbis": fileURLToPath(new URL("./stb-vorbis-stub.mjs", import.meta.url)),
  },
};
