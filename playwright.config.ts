import { defineConfig } from "@playwright/test";

// The browser lane (D-9) runs headless Chromium; the aggregate CI gate requires every proof.
// ADR 0015 records why Playwright is dev-only and why its licence needed no exception.
// Parallel local lanes must use different ports; CI and ordinary local runs keep the default.
const port = Number(process.env.PLAYWRIGHT_PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PLAYWRIGHT_PORT must be a valid TCP port");

const suite = process.env.TKR_BROWSER_SUITE;
if (suite !== undefined && suite !== "editor-web" && suite !== "player") {
  throw new Error(`Invalid TKR_BROWSER_SUITE: ${suite}`);
}
const editorSpecs = /(?:^|[/\\])editor-[^/\\]+\.spec\.ts$/;

export default defineConfig({
  testDir: "tools/browser/tests",
  ...(suite === "editor-web" ? { testMatch: editorSpecs } : suite === "player" ? { testIgnore: editorSpecs } : {}),
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
    command: suite === "editor-web"
      ? `node tools/browser/build.mjs && node tools/browser/serve.mjs --port ${port}`
      :
      // The package fixture is generated from the fetched sample game, so the package boot needs no committed archive.
      // The desktop bundles too: `desktop-parity.spec.ts` launches the built player beside the PWA page, and a lane that
      // needs an artefact must build it rather than trusting the developer to have run another script.
      "node tools/desktop/build.mjs && node tools/browser/build.mjs && (test -d fixtures/legacy/demo && node tools/make-package/run.mjs fixtures/legacy/demo" +
      " --closing-plan golden/closing/plan.json --game demo --out fixtures/packages/demo.tpk --title Demo || true)" +
      " && node tools/mobile/build.mjs && node tools/browser/serve.mjs --port " + port,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
