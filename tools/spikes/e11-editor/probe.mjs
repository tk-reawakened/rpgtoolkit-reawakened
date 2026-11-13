// Shared probe helpers for the spike specs: violation capture, page opening and result files.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outDir } from "./env.mjs";

export const NONCE = "c3Bpa2Utbm9uY2UtMjAyNi0xMS0xMg";

/** Opens `/b/<bundle>.html` under `csp` and records every `securitypolicyviolation`, console message and page error. */
export async function open(page, { bundle, csp, nonce = null, root = "dock", origin = "" }) {
  const log = { console: [], pageErrors: [] };
  page.on("console", (message) => log.console.push({ type: message.type(), text: message.text().slice(0, 300) }));
  page.on("pageerror", (error) => log.pageErrors.push(String(error).slice(0, 300)));
  await installViolationProbe(page);
  const query = new URLSearchParams({ csp, root });
  if (nonce) query.set("nonce", nonce);
  await page.goto(`${origin}/b/${bundle}.html?${query}`);
  return log;
}

/** Records every `securitypolicyviolation` in every frame of `target` (a page or a browser context) as `window.__violations`. */
export async function installViolationProbe(target) {
  await target.addInitScript(() => {
    // A reused page (Electron) accumulates init scripts; only the first installs the listener.
    if (window.__violations) return;
    window.__violations = [];
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        window.__violations.push({
          directive: event.effectiveDirective,
          blockedURI: event.blockedURI,
          sample: (event.sample || "").slice(0, 60),
          source: (event.sourceFile || "").split("/").pop(),
        });
      },
      true,
    );
  });
}

/** Violations so far, grouped as `directive -> count` plus a few distinct samples. */
export async function violations(page) {
  const list = await page.evaluate(() => window.__violations ?? []);
  const byDirective = {};
  const samples = {};
  for (const violation of list) {
    byDirective[violation.directive] = (byDirective[violation.directive] ?? 0) + 1;
    const key = `${violation.directive} ${violation.blockedURI} ${violation.sample}`;
    samples[key] ??= violation;
  }
  return { total: list.length, byDirective, samples: Object.values(samples).slice(0, 12) };
}

export function record(group, name, data) {
  const dir = join(outDir, "results", group);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
