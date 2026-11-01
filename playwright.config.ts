import { defineConfig } from "@playwright/test";

// The browser lane (D-9): one headless Chromium project, a required `gate` dependency, fixtures fetched first.
// ADR 0015 records why Playwright is dev-only and why its licence needed no exception.
const port = 4173;

export default defineConfig({
  testDir: "tools/browser/tests",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
    launchOptions: {
      args: [
        // Headless Chromium normally suspends AudioContexts until a user gesture; the audio lane asserts a real
        // running graph, so disable the autoplay gate.
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: {
    command:
      // The package fixture is generated from the fetched sample game, so the package boot needs no committed archive.
      "node tools/browser/build.mjs && (test -d fixtures/legacy/demo && node tools/make-package/run.mjs fixtures/legacy/demo" +
      " --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo || true)" +
      " && node tools/browser/serve.mjs --port " + port,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
