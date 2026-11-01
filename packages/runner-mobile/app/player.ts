/**
 * The mobile player page (entry 9.12): the **same** shared page as the desktop shell, run against the mobile host.
 *
 * The wrapper adds no renderer, input path or asset source of its own; on a device the host is Capacitor's `Filesystem`,
 * and the package is the one the app carries or the player picked. Nothing here knows it is on a phone.
 */

import { Filesystem } from "@capacitor/filesystem";
import { bootPlayerPage } from "@tk-reawakened/runner-web";
import { createMobileHost, type MobileFilesystem } from "../src/storage.ts";

declare global {
  interface Window {
    __mobile?: unknown;
    Capacitor?: { Plugins?: { Filesystem?: MobileFilesystem } };
  }
}

void (async () => {
  const filesystem = window.Capacitor?.Plugins?.Filesystem ?? Filesystem;
  const host = createMobileHost({
    filesystem,
    // The package is a web asset in Capacitor's bundled webDir, not writable native storage.
    readPackage: async () => {
      try {
        const response = await fetch("/public/game.tpk");
        if (!response.ok) return null;
        return {
          name: "game.tpk",
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      } catch {
        return null;
      }
    },
  });
  const report = await bootPlayerPage(host);
  window.__mobile = report;
  document.title = `mobile: ${report.error ?? report.stateHash}`;
})();
