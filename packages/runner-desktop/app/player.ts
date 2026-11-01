/**
 * The desktop player page (entry 9.11): the shared page from `runner-web`, run against the preload bridge.
 */

import { bootPlayerPage } from "@tk-reawakened/runner-web";
import type { DesktopHost } from "../src/preload.ts";

declare global {
  interface Window {
    __desktop?: Awaited<ReturnType<typeof bootPlayerPage>>;
    desktop?: DesktopHost;
  }
}

void (async () => {
  const report = await bootPlayerPage(window.desktop);
  window.__desktop = report;
  document.title = `desktop: ${report.error ?? report.stateHash}`;
  await window.desktop?.report(report);
})();
