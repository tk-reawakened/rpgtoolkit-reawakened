// Spike B: Monaco 0.57.0 (and CodeMirror 6 for comparison) under the repository's editor policies and the narrowest
// relaxations that could make Monaco work. Every policy string is built from the repository's own policy text and
// recorded verbatim in the results ($TKR_SPIKE_OUT/results/editor/*.json).
import { expect, test } from "@playwright/test";
import { vscodeWebviewPolicy, webHostPolicy, withDirectives } from "./env.mjs";
import { codemirrorChecks, monacoChecks } from "./checks.mjs";
import { NONCE, open, record } from "./probe.mjs";

const web = webHostPolicy();
const font = { "font-src": "'self'" };
const attr = { "style-src-attr": "'unsafe-inline'" };
const policies = (origin) => {
  const vscode = vscodeWebviewPolicy(origin, NONCE);
  return {
    "web-host": { csp: web },
    "web-host+font": { csp: withDirectives(web, font) },
    "web-host+font+attr": { csp: withDirectives(web, { ...font, ...attr }) },
    "web-host+font+attr+elem-unsafe": { csp: withDirectives(web, { ...font, ...attr, "style-src-elem": "'self' 'unsafe-inline'" }) },
    "web-host+font+style-unsafe-inline": { csp: withDirectives(web, { ...font, "style-src": "'self' 'unsafe-inline'" }) },
    "web-host+font+attr+elem-nonce": { csp: withDirectives(web, { ...font, ...attr, "style-src-elem": `'self' 'nonce-${NONCE}'` }), nonce: NONCE },
    "web-host+font+attr+elem-unsafe+worker-blob": { csp: withDirectives(web, { ...font, ...attr, "style-src-elem": "'self' 'unsafe-inline'", "worker-src": "'self' blob:" }) },
    "vscode-webview": { csp: vscode, nonce: NONCE },
    "vscode-webview+font+attr+worker": { csp: withDirectives(vscode, { "font-src": origin, ...attr, "worker-src": "'self'" }), nonce: NONCE },
  };
};

const cases = [
  ["monaco-core-classic", "web-host"],
  ["monaco-core-classic", "web-host+font"],
  ["monaco-core-classic", "web-host+font+attr"],
  ["monaco-core-classic", "web-host+font+attr+elem-unsafe"],
  ["monaco-core-classic", "web-host+font+style-unsafe-inline"],
  ["monaco-core-nonce", "web-host+font+attr+elem-nonce"],
  ["monaco-core-blob", "web-host+font+attr+elem-unsafe"],
  ["monaco-core-blob", "web-host+font+attr+elem-unsafe+worker-blob"],
  ["monaco-core-classic", "vscode-webview"],
  ["monaco-core-nonce", "vscode-webview"],
  ["monaco-core-nonce", "vscode-webview+font+attr+worker"],
  ["monaco-full", "web-host+font+attr+elem-unsafe"],
  ["codemirror", "web-host"],
  ["codemirror", "vscode-webview"],
  ["codemirror-shadow", "web-host"],
];

for (const [bundle, policyName] of cases) {
  test(`${bundle} under ${policyName}`, async ({ page, baseURL }) => {
    const policy = policies(baseURL)[policyName];
    const workerRequests = [];
    page.on("request", (request) => {
      if (/worker/.test(request.url())) workerRequests.push(request.url().replace(baseURL, ""));
    });
    const log = await open(page, { bundle, csp: policy.csp, nonce: policy.nonce, root: "editor" });
    const checks = bundle.startsWith("codemirror") ? await codemirrorChecks(page) : await monacoChecks(page);
    const result = {
      bundle,
      policyName,
      policy: policy.csp,
      nonce: policy.nonce ?? null,
      ...checks,
      workerRequests,
      console: log.console.filter((entry) => entry.type === "error" || entry.type === "warning").map((entry) => entry.text).filter((text, index, all) => all.indexOf(text) === index).slice(0, 12),
      pageErrors: log.pageErrors,
    };
    record("editor", `${bundle}--${policyName}`, result);
    expect(result.typed).toBe(true);
    expect(result.undone).toBe(true);
    expect(result.render.linesPositioned).toBe(true);
    const working = bundle === "codemirror-shadow" ||
      (bundle === "codemirror" && policyName === "vscode-webview") ||
      (bundle.startsWith("monaco") && (
        policyName === "web-host+font+style-unsafe-inline" ||
        policyName === "web-host+font+attr+elem-nonce" ||
        policyName === "web-host+font+attr+elem-unsafe+worker-blob" ||
        policyName === "vscode-webview+font+attr+worker" ||
        (policyName === "web-host+font+attr+elem-unsafe" && bundle !== "monaco-core-blob")
      ));
    if (working) {
      expect(result.afterUse.total).toBe(0);
      expect(result.render.tokensColoured).toBe(true);
      expect(result.find.visible).toBe(true);
      if (bundle.startsWith("monaco")) {
        expect(result.render.currentLineWidth).toBeGreaterThan(0);
        expect(result.find.codiconFont).toBe("loaded");
        expect(result.worker.messages).toBeGreaterThan(0);
        expect(result.worker.errors).toEqual([]);
        expect(result.suggest.rows).toBeGreaterThan(0);
      }
    } else if (bundle === "monaco-core-blob") {
      expect(result.afterUse.byDirective["worker-src"]).toBeGreaterThan(0);
      expect(result.worker.messages).toBe(0);
    } else {
      expect(result.afterUse.total).toBeGreaterThan(0);
      if (bundle === "codemirror") expect(result.afterUse.byDirective["style-src-elem"]).toBeGreaterThan(0);
      else expect(result.afterUse.byDirective[policyName === "vscode-webview" && bundle === "monaco-core-nonce" ? "style-src-attr" : "style-src-elem"]).toBeGreaterThan(0);
    }
  });
}

test("Monaco's default keybindings, for the docking layer's collision check", async ({ page }) => {
  await open(page, { bundle: "monaco-core-classic", csp: withDirectives(web, { ...font, ...attr, "style-src-elem": "'self' 'unsafe-inline'" }), root: "editor" });
  await page.waitForFunction(() => window.__monaco?.ready === true);
  const keybindings = await page.evaluate(() => window.__monaco.keybindings());
  const dockKeys = ["f6", "shift+f6"];
  const collisions = keybindings.filter((binding) => dockKeys.includes(binding.key.toLowerCase()));
  record("editor", "monaco-keybindings", { count: keybindings.length, dockKeys, collisions, keybindings });
  expect(keybindings.length).toBeGreaterThan(50);
});
