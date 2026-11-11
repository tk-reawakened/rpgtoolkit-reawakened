/**
 * The closing suite in the PWA build (entry 9.14): every game of `golden/closing/plan.json` booted through the same core
 * build the headless runner uses, compared with the committed baseline, PNGs and ledger, and — separately — the demo
 * game re-run from its distribution package so the packaged single-file load is proved in the browser too.
 *
 * Nothing here is a player: it runs the suite once and publishes the verdict for the browser lane to assert.
 */

import {
  closingBundled,
  closingManifestLoader,
  distributionPackage,
  fetchClosingManifest,
  fetchOptionalBytes,
  fetchOptionalText,
  packagedDemoRecord,
  runClosingCheck,
  type ClosingPageReport,
  type PackagedClosingReport,
} from "@tk-reawakened/runner-web";

declare global {
  interface Window {
    __closing?: (ClosingPageReport & { readonly packaged?: PackagedClosingReport; readonly error?: string }) | undefined;
  }
}

void (async () => {
  try {
    const planText = await fetchOptionalText("/golden/closing/plan.json");
    if (planText === undefined) throw new Error("/golden/closing/plan.json is absent");
    const bundled = await closingBundled();
    const load = closingManifestLoader("", await fetchClosingManifest());
    const report = await runClosingCheck({
      planText,
      baselineText: await fetchOptionalText("/golden/regression/closing.json"),
      ledgerText: await fetchOptionalText("/golden/ledger.json"),
      bundled,
      load,
      readPng: (path) => fetchOptionalBytes(`/${path}`),
    });
    const packaged = await packagedDemoRecord({
      planText,
      bundled,
      reference: report.games,
      packageFiles: (name, bytes) => distributionPackage(name, bytes).files,
    });
    // `exactOptionalPropertyTypes`: omit the key when the package is absent instead of writing `undefined`.
    window.__closing = { ...report, ...(packaged === undefined ? {} : { packaged }) };
  } catch (error) {
    window.__closing = { ok: false, lines: [], games: [], error: error instanceof Error ? error.message : String(error) };
  }
})();
