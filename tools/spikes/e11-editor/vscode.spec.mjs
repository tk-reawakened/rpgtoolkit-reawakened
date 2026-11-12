// Monaco inside a real VS Code for the Web webview (the stable build @vscode/test-web downloads), under host-vscode's
// own CSP template. ADR 0021 decision 2 keeps Monaco out of VS Code (native text editors are used there); this run
// answers what it would take if a webview ever embedded it, and checks the Chromium simulation of that policy.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { here, outDir, repoRoot } from "./env.mjs";
import { monacoChecks } from "./checks.mjs";
import { record } from "./probe.mjs";

const template = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(join(repoRoot, "packages/host-vscode/src/extension.ts"), "utf8"))[1];
const variants = {
  verbatim: { bundle: "monaco-core-classic", extra: {} },
  "proposed+fetch-blob-worker": {
    bundle: "monaco-core-nonce-fetchblob",
    extra: { "font-src": "${webview.cspSource}", "style-src-attr": "'unsafe-inline'", "connect-src": "${webview.cspSource}", "worker-src": "blob:" },
  },
  "proposed+resource-origin-worker": {
    bundle: "monaco-core-nonce",
    extra: { "font-src": "${webview.cspSource}", "style-src-attr": "'unsafe-inline'", "worker-src": "${webview.cspSource}" },
  },
};
const port = Number(process.env.TKR_SPIKE_VSCODE_PORT ?? "3197");

async function waitFor(url, child) {
  for (let i = 0; i < 600; i++) {
    if (child.exitCode !== null) throw new Error(`vscode-test-web exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("vscode-test-web did not start");
}

for (const [name, variant] of Object.entries(variants)) {
  test(`Monaco in a real VS Code web webview: ${name}`, async ({ page }) => {
    test.setTimeout(600_000);
    const extension = join(outDir, "vscode-ext");
    rmSync(extension, { recursive: true, force: true });
    cpSync(join(here, "vscode-ext"), extension, { recursive: true });
    mkdirSync(join(extension, "media"));
    for (const file of [`${variant.bundle}.js`, `${variant.bundle}.css`, "codicon.ttf", "editor.worker.js"]) cpSync(join(outDir, "bundles", file), join(extension, "media", file));
    writeFileSync(join(extension, "media", "variant.json"), JSON.stringify({ bundle: variant.bundle, template, extra: variant.extra }));
    const workspace = join(outDir, "vscode-workspace");
    mkdirSync(workspace, { recursive: true });
    const server = spawn(
      process.execPath,
      [join(repoRoot, "node_modules/@vscode/test-web/out/server/index.js"), "--browser", "none", "--quality", "stable", "--extensionDevelopmentPath", extension, "--port", String(port), "--testRunnerDataDir", join(outDir, ".vscode-test-web"), workspace],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.resume();
    server.stderr.resume();
    try {
      await waitFor(`http://localhost:${port}/`, server);
      const consoleErrors = [];
      page.on("console", (message) => {
        if (/Content Security Policy|Worker|worker/.test(message.text()) && (message.type() === "error" || message.type() === "warning")) consoleErrors.push(`${message.type()}: ${message.text().slice(0, 300)}`);
      });
      await page.goto(`http://localhost:${port}/`);
      let frame;
      for (let i = 0; i < 240 && !frame; i++) {
        for (const candidate of page.frames()) {
          if (await candidate.evaluate(() => window.__monaco?.ready === true).catch(() => false)) frame = candidate;
        }
        if (!frame) await page.waitForTimeout(500);
      }
      expect(frame, "the webview frame running Monaco").toBeTruthy();
      const target = {
        evaluate: frame.evaluate.bind(frame),
        waitForFunction: frame.waitForFunction.bind(frame),
        locator: frame.locator.bind(frame),
        waitForTimeout: page.waitForTimeout.bind(page),
        keyboard: page.keyboard,
      };
      const checks = await monacoChecks(target);
      const result = {
        variant: name,
        bundle: variant.bundle,
        frameUrl: frame.url().replace(/id=[^&]+/, "id=…"),
        policy: await frame.evaluate(() => document.querySelector('meta[name="tkr-csp"]')?.content),
        vscode: readdirSync(join(outDir, ".vscode-test-web"))
          .filter((entry) => entry.startsWith("vscode-web-"))
          .map((entry) => `${JSON.parse(readFileSync(join(outDir, ".vscode-test-web", entry, "package.json"), "utf8")).version} (${entry})`),
        ...checks,
        consoleErrors: [...new Set(consoleErrors.map((text) => text.replace(/sha256-[^']+/g, "sha256-…")))].slice(0, 40),
      };
      record("vscode", name, result);
      expect(result.typed).toBe(true);
    } finally {
      server.kill();
    }
  });
}
