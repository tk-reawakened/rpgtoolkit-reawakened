// Runs the spike with the repository's own Playwright (1.64.0) and Chromium, outside the browser lane:
//   node tools/spikes/e11-editor/install.mjs && node tools/spikes/e11-editor/build.mjs
//   pnpm exec playwright test -c tools/spikes/e11-editor/playwright.config.mjs
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { here, outDir } from "./env.mjs";

const port = Number(process.env.TKR_SPIKE_PORT ?? "4199");
export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.mjs$/,
  outputDir: join(outDir, "test-results"),
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 800 }, trace: "off" },
  webServer: {
    command: `node ${join(here, "server.mjs")} --port ${port}`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
