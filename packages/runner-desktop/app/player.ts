/**
 * The desktop player page (entry 9.11): the shared page from `runner-web`, run against the preload bridge.
 */

import { bootPlayerPage } from "@tk-reawakened/runner-web";

declare global {
  interface Window {
    __desktop?: Awaited<ReturnType<typeof bootPlayerPage>>;
    desktop?: Parameters<typeof bootPlayerPage>[0] extends infer Host ? Host : never;
  }
}

void (async () => {
  const report = await bootPlayerPage(window.desktop as never);
  window.__desktop = report;
  document.title = `desktop: ${report.error ?? report.stateHash}`;
})();
