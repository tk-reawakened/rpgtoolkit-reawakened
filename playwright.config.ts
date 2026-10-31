import { defineConfig } from "@playwright/test";

// The browser lane (D-9): one headless Chromium project, a required `gate` dependency, fixtures fetched first.
// ADR 0015 records why Playwright is dev-only and why its licence needed no exception.
const port = 4173;

export default defineConfig({
  testDir: "tools/browser/tests",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "off" },
  webServer: {
    command: "node tools/browser/build.mjs && node tools/browser/serve.mjs --port " + port,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
