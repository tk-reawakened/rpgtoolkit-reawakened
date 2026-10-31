// Flat ESLint config for the workspace (docs/guardrails.md G1–G3, AD-13, AD-24, AD-6).
//
// Scope of the rules below:
//   * G1 (step-machine VM)        -> packages/core/src/script/**
//   * G2, G3, AD-13, AD-24, AD-6   -> packages/core/src/**
//
// The script scope is a superset of the core scope, so the two configs below
// compose the shared restriction lists rather than overriding one another.
// Inline configuration is refused outright (`noInlineConfig`) and the
// violation fixtures under packages/core/test/fixtures/** are ignored here;
// the core lint-rule test lints their contents against these same rules.
import { builtinModules } from "node:module";
import { guardrails } from "./tools/eslint-plugin-guardrails/index.js";
import tseslint from "typescript-eslint";

const sourceFiles = ["**/*.{ts,tsx,mts,cts}"];
const coreSourceFiles = ["packages/core/src/**/*.{ts,tsx,mts,cts}"];
const scriptSourceFiles = ["packages/core/src/script/**/*.{ts,tsx,mts,cts}"];

// Host environments `core` must never touch (G2 rule 1) plus the sources of
// non-determinism (G3 rule 1/4) and console logging (AD-24).
const bannedGlobals = [
  // DOM / browser
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "screen",
  "fetch",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "alert",
  "confirm",
  "prompt",
  "getComputedStyle",
  "matchMedia",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "SharedWorker",
  "EventSource",
  "Image",
  "Audio",
  "HTMLElement",
  "HTMLCanvasElement",
  "HTMLImageElement",
  "HTMLVideoElement",
  "OffscreenCanvas",
  "createImageBitmap",
  "atob",
  "btoa",
  // Node
  "process",
  "Buffer",
  "global",
  "__dirname",
  "__filename",
  "require",
  "module",
  "exports",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  // determinism and diagnostics
  "Date",
  "performance",
  "Intl",
  "console",
].map((name) => ({
  name,
  message: `G2/G3/AD-24: \`${name}\` is banned in core; core takes a port instead.`,
}));

// G1 rule 4: script threads are statuses and plain data, never async machinery.
const scriptVmGlobals = [
  { name: "Promise", message: "G1.4: the VM yields statuses; it never uses Promises." },
  { name: "queueMicrotask", message: "G1.4: the VM has no microtask scheduling." },
];

const scriptVmSyntax = [
  {
    selector:
      ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)[generator=true]",
    message: "G1.4: script threads are not generators.",
  },
  {
    selector:
      ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)[async=true]",
    message: "G1.4: script threads are not async functions.",
  },
  { selector: "AwaitExpression", message: "G1.4: the VM yields statuses; it never awaits." },
  { selector: "ForOfStatement[await=true]", message: "G1.4: the VM never uses `for await`." },
];

// Node's own built-in module list (includes `domain`, `sys`, `fs/promises`, …).
const bareBuiltins = builtinModules.filter((name) => !name.startsWith("node:"));
const topLevelBuiltins = bareBuiltins.filter((name) => !name.includes("/"));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (names) => names.map(escapeRegExp).join("|");

// Anchored so relative imports (`./stream/index.ts`) and package subpaths
// (`some-lib/util`) are never matched.
const nodeBuiltinSource = `^(?:node:.*|(?:${alternation(bareBuiltins)})(?:/.*)?)$`;
// The dynamic-import selector lives inside an esquery `/…/` literal, so it must
// not contain an unescaped slash; top-level names plus a lookahead cover
// subpaths such as `fs/promises`.
const nodeBuiltinDynamic = `^(?:node:|(?:${alternation(topLevelBuiltins)}))(?![a-zA-Z0-9_-])`;

// AD-6: core imports `fflate/browser` and only its synchronous APIs.
const fflateAsyncExports = [
  // Callback/worker-backed functions.
  "compress",
  "decompress",
  "deflate",
  "gzip",
  "gunzip",
  "inflate",
  "unzip",
  "unzlib",
  "zip",
  "zlib",
  // Worker-backed streaming classes (`esm/browser.d.ts` in fflate 0.8.3).
  "AsyncCompress",
  "AsyncDeflate",
  "AsyncInflate",
  "AsyncGzip",
  "AsyncGunzip",
  "AsyncZlib",
  "AsyncUnzlib",
  "AsyncDecompress",
  "AsyncZipDeflate",
  "AsyncZipInflate",
  "AsyncUnzipInflate",
];

const g2Syntax = [
  {
    // AD-13: `Math` is an allowlist. `random` is handled below.
    selector:
      "MemberExpression[object.name='Math'][property.name!=/^(abs|ceil|floor|round|trunc|sign|min|max|fround|imul|clz32|sqrt|random)$/]",
    message:
      "AD-13: only the allowlisted Math members are exact; use core/fmath for the rest.",
  },
  {
    selector: "BinaryExpression[operator='**']",
    message: "AD-13: `**` is implementation-approximated; use core/fmath.pow.",
  },
  {
    selector: "AssignmentExpression[operator='**=']",
    message: "AD-13: `**=` is implementation-approximated; use core/fmath.pow.",
  },
  {
    selector: "MemberExpression[property.name=/^toLocale/]",
    message: "G3.4: locale-sensitive APIs are banned in core.",
  },
  {
    selector: `ImportExpression[source.value=/${nodeBuiltinDynamic}/]`,
    message: "G2.1: core must not import Node built-ins.",
  },
  {
    // `no-restricted-imports` does not visit an ImportExpression, so the fflate and workspace-package bans need a
    // selector of their own or `await import("fflate")` slips past both rules.
    selector: "ImportExpression[source.value=/^fflate(?:\\/(?!browser$).*)?$/]",
    message: "AD-6: core may import only the `fflate/browser` sync APIs.",
  },
  {
    selector: "ImportExpression[source.value=/^@tk-reawakened\\//]",
    message: "G2.3: core must not import other workspace packages.",
  },
];

// Rule options factored out so the script scope composes the same restrictions.
const restrictedImports = [
  "error",
  {
    paths: [
      {
        name: "fflate/browser",
        importNames: fflateAsyncExports,
        message: "AD-6: core uses only the synchronous fflate APIs.",
      },
    ],
    patterns: [
      // The only allowed fflate specifier is the sync `fflate/browser` subpath.
      {
        regex: "^fflate(?:/(?!browser$).*)?$",
        message: "AD-6: core may import only the `fflate/browser` sync APIs.",
      },
      { regex: nodeBuiltinSource, message: "G2.1: core must not import Node built-ins." },
      { group: ["@tk-reawakened/*"], message: "G2.3: core must not import other workspace packages." },
    ],
  },
];

const restrictedMath = [
  "error",
  {
    object: "Math",
    property: "random",
    message: "G3.1: draw randomness from the injected seedable RNG, not Math.random.",
  },
];

const restrictedGlobals = (globals) => [
  "error",
  { globals, checkGlobalObject: true },
];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "packages/core/test/fixtures/**",
      // Local trees that are not this checkout's source. Flat config does not
      // read `.gitignore`, so without these `eslint .` parses every other
      // branch checked out under `.worktrees/` (thousands of files) and the
      // fetched sample games. Lint checks the repository, not a neighbour's
      // working copy.
      ".worktrees/**",
      "fixtures/**",
      ".serena/**",
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      // Declared so `no-restricted-globals`' `checkGlobalObject` can see
      // `globalThis.Date`, `globalThis.setTimeout` and the like (G2/G3).
      globals: { globalThis: "readonly" },
    },
  },
  {
    // Refuse inline configuration outright. `eslint-disable` and `/* eslint */`
    // comments have no effect, so an attempted suppression is reported rather
    // than silently hiding a violation. Guard-rail suppressions are reported by
    // the plugin below.
    files: sourceFiles,
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  },
  {
    files: coreSourceFiles,
    rules: {
      "no-restricted-globals": restrictedGlobals(bannedGlobals),
      "no-restricted-imports": restrictedImports,
      "no-restricted-properties": restrictedMath,
      "no-restricted-syntax": ["error", ...g2Syntax],
    },
  },
  {
    files: scriptSourceFiles,
    rules: {
      "no-restricted-globals": restrictedGlobals([...bannedGlobals, ...scriptVmGlobals]),
      "no-restricted-syntax": ["error", ...g2Syntax, ...scriptVmSyntax],
    },
  },
  {
    plugins: { guardrails },
    rules: {
      "guardrails/no-unmarked-suppression": "error",
      "guardrails/no-escaping-relative-import": "error",
    },
  },
];
