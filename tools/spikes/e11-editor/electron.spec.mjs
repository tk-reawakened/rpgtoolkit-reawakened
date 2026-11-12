// The same probes in Electron 45 (the repository's pinned shell, ADR 0013) over a privileged app:// scheme, with the web
// host's policy. Electron's runtime and scheme, not a packaged editor: the repository has no desktop editor host yet.
import { createRequire } from "node:module";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { here, webHostPolicy, withDirectives } from "./env.mjs";
import { monacoChecks, runKeyboardSteps } from "./checks.mjs";
import { open, record, violations } from "./probe.mjs";

const electronPath = createRequire(join(here, "..", "..", "..", "package.json"))("electron");
const origin = "app://spike";
const web = webHostPolicy();
const relaxed = withDirectives(web, { "font-src": "'self'", "style-src-attr": "'unsafe-inline'", "style-src-elem": "'self' 'unsafe-inline'" });

test("Electron app://: dockview + keyboard layer, and Monaco under the web policy and the proposed relaxation", async () => {
  const application = await electron.launch({ executablePath: electronPath, args: [join(here, "electron-main.mjs")] });
  try {
    const versions = await application.evaluate(({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, name: app.getName() }));
    const page = await application.firstWindow();
    const result = { versions, policyWeb: web, policyRelaxed: relaxed };

    const dockLog = await open(page, { bundle: "dock-dockview-kbd", csp: web, origin });
    await page.waitForFunction(() => window.spikeReady === true);
    result.dockAfterLoad = await violations(page);
    result.keyboardSteps = await runKeyboardSteps(page);
    result.dockAfterSteps = await violations(page);
    result.dockPageErrors = dockLog.pageErrors;

    for (const [name, csp] of [["web-host", web], ["web-host+font+attr+elem-unsafe", relaxed]]) {
      const log = await open(page, { bundle: "monaco-core-classic", csp, origin, root: "editor" });
      result[`monaco ${name}`] = { ...(await monacoChecks(page)), pageErrors: log.pageErrors };
    }
    record("electron", "app-scheme", result);
    expect(result.keyboardSteps.filter((s) => !s.pass).map((s) => s.label)).toEqual([]);
    expect(result["monaco web-host+font+attr+elem-unsafe"].afterUse.total).toBe(0);
  } finally {
    await application.close();
  }
});
