// Throwaway spike harness for epic 11's two open editor decisions (docking library; Monaco's CSP `style-src`).
// Nothing here ships, is built by CI or is part of the pnpm workspace. The candidate libraries are installed by
// `install.mjs` into a directory OUTSIDE the checkout, so they never enter `package.json`, the lockfile,
// `pnpm licence` or `pnpm audit --prod`. Evidence: docs/findings/dock-library/ and docs/findings/monaco-csp/.
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..", "..");
/** Where `install.mjs` puts the candidate libraries (never inside the checkout). */
export const depsDir = resolve(process.env.TKR_SPIKE_DEPS ?? join(tmpdir(), "tkr-e11-spike-deps"));
/** Where `build.mjs` writes bundles and the specs write raw results (never inside the checkout). */
export const outDir = resolve(process.env.TKR_SPIKE_OUT ?? join(tmpdir(), "tkr-e11-spike-out"));
export const deps = JSON.parse(readFileSync(join(here, "deps.json"), "utf8"));

if (depsDir.startsWith(repoRoot + "/") || outDir.startsWith(repoRoot + "/")) {
  throw new Error("TKR_SPIKE_DEPS and TKR_SPIKE_OUT must be outside the checkout so nothing enters the workspace");
}

/** The web host's policy, read verbatim from the page the browser editor ships. */
export function webHostPolicy() {
  const html = readFileSync(join(repoRoot, "tools/browser/editor-web/index.html"), "utf8");
  const match = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  if (!match) throw new Error("tools/browser/editor-web/index.html has no CSP meta tag");
  return match[1];
}

/** The VS Code webview's policy template, read verbatim from host-vscode, with `${webview.cspSource}` and the nonce
 * substituted. In a real webview `cspSource` is the resource origin; here it is the spike server's origin. */
export function vscodeWebviewPolicy(cspSource, nonce) {
  const source = readFileSync(join(repoRoot, "packages/host-vscode/src/extension.ts"), "utf8");
  const match = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(source);
  if (!match) throw new Error("packages/host-vscode/src/extension.ts has no CSP template");
  return match[1].replaceAll("${webview.cspSource}", cspSource).replaceAll("${nonce}", nonce);
}

/** Adds or replaces directives in a policy string; `null` removes one. */
export function withDirectives(policy, changes) {
  const directives = policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...values] = part.split(/\s+/);
      return [name, values.join(" ")];
    });
  const map = new Map(directives);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) map.delete(name);
    else map.set(name, value);
  }
  return [...map].map(([name, value]) => (value ? `${name} ${value}` : name)).join("; ");
}
