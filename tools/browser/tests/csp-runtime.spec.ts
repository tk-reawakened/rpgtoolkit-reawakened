import { expect, test, type Route } from "@playwright/test";

const PLAYER_PAGE = "/packages/runner-web/app/index.html";
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i;

test("runner page executes allowed scripts and blocks injected inline script at runtime", async ({ page }) => {
  // This switch is only for the explicit perturbation run: remove the actual shipped page's CSP
  // response tag, then prove this same assertion fails because the forbidden code executes.
  if (process.env.CSP_PROBE_WEAKENED === "1") {
    await page.route(`**${PLAYER_PAGE}`, async (route: Route) => {
      const response = await route.fetch();
      const html = await response.text();
      expect(html).toMatch(POLICY);
      await route.fulfill({ response, body: html.replace(POLICY, "") });
    });
  }

  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      const target = window as Window & { __cspViolations?: { directive: string; blockedURI: string }[] };
      (target.__cspViolations ??= []).push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });

  const allowedScript = page.waitForResponse((response) =>
    response.url().endsWith("/apps/player.js") && response.ok(),
  );
  await page.goto(PLAYER_PAGE);
  await allowedScript;
  await expect.poll(() => page.locator("#report").textContent()).not.toBe("booting…");
  await expect.poll(() => page.evaluate(() => (window as Window & { __report?: unknown }).__report)).not.toBeUndefined();

  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__cspDisallowedScriptRan = true;";
    document.body.append(script);
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { __cspDisallowedScriptRan?: boolean }).__cspDisallowedScriptRan)).toBeUndefined();
  await expect.poll(() => page.evaluate(() => (window as Window & { __cspViolations?: { directive: string; blockedURI: string }[] }).__cspViolations ?? []))
    .toContainEqual({ directive: "script-src-elem", blockedURI: "inline" });
});
